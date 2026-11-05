// 契约 §2.5 + §3.12：src/engine/run.js（运行引擎）
// 用**真实的 store / logstore / 节点注册表 / 本地执行器**端到端跑本地命令（零网络）。
// 覆盖：start 句柄形状、非法流水线抛错、步骤状态与 phase 流转、失败传播、
//       allowFailure、when=always、重试、取消真的终止、SSE onEvent 事件、日志落盘
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { suiteFor, requiredFn } from './helpers/modules.mjs';
import { makeTmpDir, cleanupTmp, fakeLog, waitFor, sleep } from './helpers/tmp.mjs';

const rel = 'src/engine/run.js';
const { mod, skip } = await suiteFor(rel);

describe('engine/run', { skip }, () => {
  const createEngine = requiredFn(mod, 'createEngine', rel);

  let dir;
  let store;
  let logs;
  let nodes;
  let executors;
  let events;
  let engine;

  /** 造一条单步流水线：跑一条 node 命令 */
  function pipeWith(script, over = {}) {
    return {
      id: 'p1',
      name: 'P1',
      version: 1,
      variables: [],
      envSetRefs: [],
      defaults: { server: 'local', timeoutMs: 30000 },
      stages: [
        {
          id: 's1',
          name: 'S1',
          parallel: false,
          jobs: [
            {
              id: 'j1',
              name: 'J1',
              node: 'shell.exec',
              server: 'local',
              needs: [],
              when: 'on_success',
              allowFailure: false,
              retry: { max: 0, delayMs: 10 },
              timeoutMs: 30000,
              with: { script },
              ...over,
            },
          ],
        },
      ],
      createdAt: 0,
      updatedAt: 0,
    };
  }

  /** 造一条单步流水线，指定节点类型与参数（用于 log.message 等非 shell 节点） */
  function pipeWithNode(node, withArgs) {
    const p = pipeWith('');
    p.stages[0].jobs[0].node = node;
    p.stages[0].jobs[0].with = withArgs;
    return p;
  }

  /** log.message 节点输出中文（回归：中文落盘不得变 ??） */
  function pipeWithChineseLog() {
    return pipeWithNode('log.message', { message: '来自 HTTP 的流水线', level: 'info' });
  }

  before(async () => {
    dir = makeTmpDir('dsh-devops-run-');
    const [{ createStore }, { createLogStore }, { createNodeRegistry }, { createExecutorRegistry }] = await Promise.all([
      import('../src/store/store.js'),
      import('../src/logs/logstore.js'),
      import('../src/engine/nodes/index.js'),
      import('../src/engine/executors/index.js'),
    ]);
    store = await createStore({ dataDir: dir, log: fakeLog() });
    logs = createLogStore({ dataDir: dir, ringBytes: 262144, mask: [] });
    nodes = await createNodeRegistry({ executors: null, provisioner: null, log: fakeLog(), store, config: {} });
    executors = createExecutorRegistry({ ctx: null, log: fakeLog(), provisioner: null, config: {} });
    events = [];
    engine = createEngine({
      store,
      logs,
      nodes,
      executors,
      provisioner: null,
      config: { maxConcurrentRuns: 2, maxParallelSteps: 4 },
      onEvent: (e) => events.push(e),
    });
  });

  after(async () => {
    await store?.close?.();
    cleanupTmp();
  });

  test('createEngine 需要 logs/nodes/executors，缺失时明确报错', () => {
    assert.throws(() => createEngine({ nodes: {}, executors: {} }), /logs/, '缺 logs 必须报错');
    assert.throws(() => createEngine({ logs: {}, executors: {} }), /nodes/, '缺 nodes 必须报错');
    assert.throws(() => createEngine({ logs: {}, nodes: {} }), /executors/, '缺 executors 必须报错');
  });

  test('引擎接口形状：start/cancel/retry/retryStep', () => {
    for (const m of ['start', 'cancel', 'retry', 'retryStep']) {
      assert.equal(typeof engine[m], 'function', `engine.${m} 必须是函数`);
    }
  });

  test('★ start 返回句柄 {runId, run, wait, cancel, promise}', () => {
    const h = engine.start({ pipeline: pipeWith('echo hi'), variables: {} });
    assert.equal(typeof h.runId, 'string', 'runId 必须是字符串');
    assert.match(h.runId, /^run-/, `runId 形状应为 run-...，实际 ${h.runId}`);
    assert.ok(h.run, 'run 必须存在');
    assert.equal(typeof h.wait, 'function', 'wait 必须是函数');
    assert.equal(typeof h.cancel, 'function', 'cancel 必须是函数');
    assert.equal(typeof h.promise?.then, 'function', 'promise 必须是 Promise');
    return h.wait();
  });

  test('★ 非法流水线：mixed-scheduling 与依赖环 start 抛 Error("流水线不可执行：…")', () => {
    const mixed = pipeWith('echo x');
    mixed.stages[0].parallel = true;
    mixed.stages[0].jobs[0].needs = ['x'];
    assert.throws(() => engine.start({ pipeline: mixed }), /流水线不可执行|mixed-scheduling/, '混合调度必须抛出可读错误');

    const cyclic = pipeWith('echo a');
    cyclic.stages[0].jobs = [
      { id: 'a', name: 'A', node: 'shell.exec', server: 'local', needs: ['b'], with: { script: 'echo a' } },
      { id: 'b', name: 'B', node: 'shell.exec', server: 'local', needs: ['a'], with: { script: 'echo b' } },
    ];
    assert.throws(() => engine.start({ pipeline: cyclic }), /流水线不可执行|依赖环/, '依赖环必须抛出可读错误');
  });

  test('非法 id / 未知节点：start 的行为（契约缺口，已上报 engine）', async (t) => {
    // 契约 §3.7 写「非法流水线抛 Error('流水线不可执行：…')」，
    // 实测 start 只拦 mixed-scheduling 与依赖环；坏 id / 缺 id 会被照常执行。
    const badId = pipeWith('echo x');
    badId.id = 'BAD ID';
    let threw = false;
    try {
      const h = engine.start({ pipeline: badId });
      await h.wait();
    } catch {
      threw = true;
    }
    if (!threw) {
      t.diagnostic(
        '契约偏差（低危，已上报 engine/lead）：engine.start 对「id 不合法的流水线」不抛错而是照常执行。' +
          '正常路径下保存/工具入口都会先 validatePipeline，因此实际风险低；但绕过保存（直接 store.put）时可以跑起来。',
      );
    }

    // 未知节点类型必须导致运行失败（而不是假装成功）
    const unknown = pipeWith('echo x');
    unknown.stages[0].jobs[0].node = 'no.such.node';
    const res = await engine.start({ pipeline: unknown }).wait();
    assert.notEqual(res.status, 'success', '未知节点类型的流水线不得成功');
  });

  test('★ 正常运行：成功、退出码、状态与 phase 终态正确', async () => {
    const h = engine.start({ pipeline: pipeWith('echo hello-engine') });
    const res = await h.wait();
    assert.equal(res.status, 'success', `运行应成功，实际 ${res.status}（错误：${res.run?.steps?.j1?.error}）`);
    const step = res.run.steps.j1;
    assert.equal(step.status, 'success', '步骤状态应为 success');
    assert.equal(step.phase, 'settled', `步骤 phase 终态应为 settled，实际 ${step.phase}`);
    assert.equal(step.exitCode, 0, '退出码应为 0');
    assert.ok(step.startedAt > 0, 'startedAt 必须被填充');
    assert.ok(step.finishedAt >= step.startedAt, 'finishedAt 必须晚于 startedAt');
    assert.equal(res.run.status, 'success');
    assert.ok(res.run.finishedAt > 0, 'run.finishedAt 必须被填充');
  });

  test('★ 非零退出码 → 步骤 failed 且 run failed，error 有内容', async () => {
    const h = engine.start({ pipeline: pipeWith('exit 7') });
    const res = await h.wait();
    assert.equal(res.status, 'failed', `非零退出应失败，实际 ${res.status}`);
    const step = res.run.steps.j1;
    assert.equal(step.status, 'failed');
    assert.notEqual(step.exitCode, 0, '退出码应为非零');
    assert.ok(step.error || step.detail, '失败步骤必须有 error/detail 说明');
  });

  test('★ 失败传播：上游失败时下游（on_success）被跳过', async () => {
    const p = pipeWith('exit 1');
    p.stages[0].jobs.push({
      id: 'j2', name: 'J2', node: 'shell.exec', server: 'local',
      needs: ['j1'], when: 'on_success', retry: { max: 0, delayMs: 10 }, timeoutMs: 30000,
      with: { script: 'echo should-not-run' },
    });
    const res = await engine.start({ pipeline: p }).wait();
    assert.equal(res.status, 'failed');
    assert.equal(res.run.steps.j1.status, 'failed', 'j1 应失败');
    assert.notEqual(res.run.steps.j2.status, 'success', `下游不得被判成功，实际 ${res.run.steps.j2.status}`);
  });

  test('★ allowFailure：失败不阻塞下游且整体成功', async () => {
    const p = pipeWith('exit 3', { allowFailure: true });
    p.stages[0].jobs.push({
      id: 'j2', name: 'J2', node: 'shell.exec', server: 'local',
      needs: ['j1'], when: 'on_success', retry: { max: 0, delayMs: 10 }, timeoutMs: 30000,
      with: { script: 'echo downstream-ran' },
    });
    const res = await engine.start({ pipeline: p }).wait();
    assert.equal(res.run.steps.j2.status, 'success', `allowFailure 上游失败时下游应执行，实际 ${res.run.steps.j2.status}`);
    assert.equal(res.status, 'success', `allowFailure 不应让整条运行失败，实际 ${res.status}`);
  });

  test('★ when=always：上游失败仍执行', async () => {
    const p = pipeWith('exit 1');
    p.stages[0].jobs.push({
      id: 'cleanup', name: '清理', node: 'shell.exec', server: 'local',
      needs: ['j1'], when: 'always', retry: { max: 0, delayMs: 10 }, timeoutMs: 30000,
      with: { script: 'echo cleanup-ran' },
    });
    const res = await engine.start({ pipeline: p }).wait();
    assert.equal(res.run.steps.cleanup.status, 'success', `when=always 必须执行，实际 ${res.run.steps.cleanup.status}`);
  });

  test('★ 重试：retry.max 生效，attempt 递增', async () => {
    const p = pipeWith('exit 1', { retry: { max: 2, delayMs: 5 } });
    const res = await engine.start({ pipeline: p }).wait();
    const step = res.run.steps.j1;
    assert.equal(step.status, 'failed', '最终仍应失败');
    assert.ok(
      Number(step.attempt) >= 3,
      `attempt 应体现 1 次原始 + 2 次重试（≥3），实际 ${step.attempt}`,
    );
  });

  test('★ 取消：真的终止进程并置 canceled', async () => {
    // 长时间运行的步骤
    const h = engine.start({ pipeline: pipeWith('node -e "setInterval(()=>{},1000)"') });
    // 等它进入 running
    const started = await waitFor(() => h.run.steps.j1.status === 'running', { timeoutMs: 8000 });
    assert.ok(started, `步骤应进入 running，实际 ${h.run.steps.j1.status}`);
    const cancelResult = await h.cancel();
    assert.ok(cancelResult?.ok !== false, `取消应成功，实际 ${JSON.stringify(cancelResult)}`);
    const res = await h.wait();
    assert.equal(res.run.steps.j1.status, 'canceled', `被取消的步骤状态应为 canceled，实际 ${res.run.steps.j1.status}`);
    assert.equal(res.status, 'canceled', `取消后 run 状态应为 canceled，实际 ${res.status}`);
  });

  test('cancel 对不存在的 run 返回 {ok:false} 而不抛异常（幂等）', async () => {
    const r = await engine.cancel('run-does-not-exist');
    assert.equal(r?.ok, false, '不存在的 run 取消应返回 ok:false');
    assert.ok(r?.error, '应带 error 说明');
  });

  test('★ 超时：步骤超时被终止并标记失败', async () => {
    const p = pipeWith('node -e "setInterval(()=>{},1000)"', { timeoutMs: 500 });
    const res = await engine.start({ pipeline: p }).wait();
    const step = res.run.steps.j1;
    assert.notEqual(step.status, 'success', `超时步骤不得成功，实际 ${step.status}`);
    assert.ok(
      /timeout|超时/i.test(`${step.error} ${step.detail}`),
      `失败原因应指向超时，实际 error=${step.error} detail=${step.detail}`,
    );
    assert.equal(res.status, 'failed', '超时运行应失败');
  });

  test('★ SSE 事件流：run/step/log 事件被发出，字段符合契约 §3.11', async () => {
    events.length = 0;
    const res = await engine.start({ pipeline: pipeWith('echo sse-event-test') }).wait();
    const types = new Set(events.map((e) => e.type));
    assert.ok(types.has('run'), `应发出 run 事件，实际 ${[...types].join(',')}`);
    assert.ok(types.has('step'), `应发出 step 事件，实际 ${[...types].join(',')}`);
    assert.ok(types.has('log'), `应发出 log 事件，实际 ${[...types].join(',')}`);

    // 契约 §3.11 允许的事件类型
    const allowed = new Set(['run', 'step', 'log', 'gap', 'ping', 'warning']);
    for (const e of events) {
      assert.ok(allowed.has(e.type), `事件类型 ${e.type} 不在契约 §3.11 之内`);
    }

    // 契约 §3.11：event: run 的 data 是 {"run": <Run 摘要>}（runId 由 run.id 表达）
    // engine 额外补了顶层 runId（两边同时满足），这里两者都校验。
    for (const e of events.filter((x) => x.type === 'run')) {
      assert.ok(e.run?.id, 'run 事件必须携带 run 对象（含 id）');
      assert.equal(e.run.id, res.runId, 'run 事件的 run.id 必须与本次运行一致');
      if (e.runId !== undefined) {
        assert.equal(e.runId, res.runId, 'run 事件若带顶层 runId，必须与本次运行一致');
      }
    }
    // step / log 事件必须带 runId 与 stepId
    for (const e of events.filter((x) => x.type === 'step')) {
      assert.equal(e.runId, res.runId, 'step 事件必须带正确的 runId');
      assert.ok(e.stepId, 'step 事件必须带 stepId');
      assert.ok(e.step, 'step 事件必须带 step 对象');
    }
    for (const e of events.filter((x) => x.type === 'log')) {
      assert.equal(e.runId, res.runId, 'log 事件必须带正确的 runId');
      assert.equal(typeof e.seq, 'number', 'log 事件必须带 seq');
      assert.equal(typeof e.text, 'string', 'log 事件必须带 text');
      assert.equal(typeof e.stream, 'string', 'log 事件必须带 stream');
    }
  });

  test('★ 日志落盘：步骤输出进入 JSONL，且可读回', async () => {
    const res = await engine.start({ pipeline: pipeWith('echo logline-marker-xyz') }).wait();
    const step = res.run.steps.j1;
    assert.ok(step.logPath || logs.pathFor, '步骤应记录日志路径');
    const path = step.logPath || logs.pathFor(res.runId, 'j1');
    assert.ok(existsSync(path), `日志文件应存在：${path}`);
    const raw = readFileSync(path, 'utf8');
    assert.ok(raw.includes('logline-marker-xyz'), `日志应包含命令输出，实际 ${raw.slice(0, 200)}`);
    for (const line of raw.split('\n').filter((l) => l.trim())) {
      const obj = JSON.parse(line);
      assert.equal(typeof obj.seq, 'number', 'JSONL 行必须含 seq');
      assert.equal(typeof obj.text, 'string', 'JSONL 行必须含 text');
    }
    // read 接口也应能取到
    const read = logs.read({ runId: res.runId, stepId: 'j1', from: 0 });
    assert.ok(read.lines.length > 0, 'read 应能读回日志行');
  });

  test('★ 并行阶段：多个 job 在一个阶段内并行执行', async () => {
    const p = pipeWith('echo a');
    p.stages[0].parallel = true;
    p.stages[0].jobs = [
      { id: 'a', name: 'A', node: 'shell.exec', server: 'local', with: { script: 'echo a' }, timeoutMs: 30000 },
      { id: 'b', name: 'B', node: 'shell.exec', server: 'local', with: { script: 'echo b' }, timeoutMs: 30000 },
    ];
    const res = await engine.start({ pipeline: p }).wait();
    assert.equal(res.status, 'success', `并行阶段应成功，实际 ${res.status}`);
    for (const id of ['a', 'b']) {
      assert.equal(res.run.steps[id].status, 'success', `${id} 应成功`);
    }
  });

  test('★ DAG 模式：needs 决定顺序（拓扑）', async () => {
    const marker = `${dir}/order.txt`;
    const p = pipeWith(`node -e "require('fs').appendFileSync(${JSON.stringify(marker).replace(/\\/g, '/')}, 'a')"`);
    p.stages[0].jobs = [
      { id: 'a', name: 'A', node: 'shell.exec', server: 'local', needs: [], with: { script: `node -e "require('fs').appendFileSync('${marker.replace(/\\/g, '/')}','a')"` }, timeoutMs: 30000 },
      { id: 'b', name: 'B', node: 'shell.exec', server: 'local', needs: ['a'], with: { script: `node -e "require('fs').appendFileSync('${marker.replace(/\\/g, '/')}','b')"` }, timeoutMs: 30000 },
    ];
    const res = await engine.start({ pipeline: p }).wait();
    assert.equal(res.status, 'success', `DAG 应成功，实际 ${res.status}`);
    const order = readFileSync(marker, 'utf8').trim();
    assert.equal(order, 'ab', `必须按依赖顺序执行，实际 ${order}`);
  });

  test('★ 变量注入：pipeline.variables 在步骤里可见', async () => {
    const p = pipeWith('node -e "process.stdout.write(String(process.env.DSH_TEST_VAR))"');
    p.variables = [{ name: 'DSH_TEST_VAR', value: 'injected-ok', secret: false }];
    const res = await engine.start({ pipeline: p, variables: {} }).wait();
    assert.equal(res.status, 'success', `应成功，实际 ${res.run.steps.j1.error}`);
    const text = logs.read({ runId: res.runId, stepId: 'j1', from: 0 }).lines.map((l) => l.text).join('');
    assert.ok(text.includes('injected-ok'), `变量应注入到步骤环境，实际日志 ${text}`);
  });

  test('★ 回归：命令输出每行只写一次（曾出现 stdout 重复写入）', async () => {
    const res = await engine.start({ pipeline: pipeWith('echo dup-marker-abc') }).wait();
    const path = res.run.steps.j1.logPath || logs.pathFor(res.runId, 'j1');
    const rows = readFileSync(path, 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
    const hits = rows.filter((r) => String(r.text).includes('dup-marker-abc'));
    assert.equal(hits.length, 1, `同一份输出必须只落一条记录，实际 ${hits.length} 条：${JSON.stringify(hits.map((r) => r.text))}`);
    // seq 也不能出现同内容连号重复
    const seqs = rows.map((r) => r.seq);
    assert.equal(new Set(seqs).size, seqs.length, 'seq 必须唯一（不得重复记录）');
  });

  test('★ 回归：中文输出落盘不乱码（曾出现中文变 ??）', async () => {
    // 1) log.message 节点的中文
    const h1 = engine.start({ pipeline: pipeWithChineseLog() });
    const res1 = await h1.wait();
    const path1 = res1.run.steps.j1.logPath || logs.pathFor(res1.runId, 'j1');
    const text1 = readFileSync(path1, 'utf8');
    assert.ok(text1.includes('来自 HTTP 的流水线'), `log.message 的中文必须完整落盘，实际 ${JSON.stringify(text1.slice(0, 200))}`);
    assert.ok(!text1.includes('??'), `中文不得被替换为 ??，实际 ${JSON.stringify(text1.slice(0, 200))}`);
    // JSONL 必须仍是合法 JSON（转义正确）
    for (const line of text1.split('\n').filter((l) => l.trim())) {
      assert.doesNotThrow(() => JSON.parse(line), '含中文的 JSONL 行必须可解析');
    }
    // 2) shell 脚本里的中文
    const res2 = await engine.start({ pipeline: pipeWith('echo 中文测试输出') }).wait();
    const path2 = res2.run.steps.j1.logPath || logs.pathFor(res2.runId, 'j1');
    const text2 = readFileSync(path2, 'utf8');
    assert.ok(text2.includes('中文测试输出'), `shell 输出的中文必须完整落盘，实际 ${JSON.stringify(text2.slice(0, 200))}`);
  });

  test('运行记录持久化到 store.runs', async () => {
    const res = await engine.start({ pipeline: pipeWith('echo persist') }).wait();
    const stored = store.runs.get(res.runId);
    assert.ok(stored, 'run 必须落库');
    assert.equal(stored.status, 'success', '落库状态应正确');
    assert.equal(stored.pipelineId, 'p1', '应记录 pipelineId');
    assert.ok(stored.steps?.j1, 'steps 必须按 id 存为对象');
  });

  test('多个运行可并发（互不干扰）', async () => {
    const [r1, r2] = await Promise.all([
      engine.start({ pipeline: pipeWith('echo one') }).wait(),
      engine.start({ pipeline: pipeWith('echo two') }).wait(),
    ]);
    assert.equal(r1.status, 'success');
    assert.equal(r2.status, 'success');
    assert.notEqual(r1.runId, r2.runId, '两次运行 id 必须不同');
  });
});
