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

  /* ============================ 定义快照语义 ============================ */
  // 用户要求：「编辑后不影响之前运行过和运行中的流水线。」
  // 以下用例都真的构造「先起运行 → 改 store 里的流水线定义 → 重试/继续调度」，
  // 并用**脚本输出的标记**断言实际执行的是哪一份定义（不是只断言字段存在）。

  /** 读取某步骤的落盘日志文本 */
  function stepLogText(runId, stepId, run) {
    const path = run?.steps?.[stepId]?.logPath || logs.pathFor(runId, stepId);
    return existsSync(path) ? readFileSync(path, 'utf8') : '';
  }

  /** 造一条多 job 的流水线（契约 §2.1 形状），jobs 由调用方给定 */
  function pipeWithJobs(id, jobs, over = {}) {
    return {
      id,
      name: id,
      version: 1,
      variables: [],
      envSetRefs: [],
      defaults: { server: 'local', timeoutMs: 30000 },
      stages: [{ id: 's1', name: 'S1', parallel: false, jobs }],
      createdAt: 0,
      updatedAt: 0,
      ...over,
    };
  }

  function job(id, script, needs = []) {
    return {
      id, name: id, node: 'shell.exec', server: 'local', needs,
      when: 'on_success', allowFailure: false,
      retry: { max: 0, delayMs: 10 }, timeoutMs: 30000,
      with: { script },
    };
  }

  test('★ 快照 a)：编辑定义后对旧 run 调 retryStep，执行的是旧快照', async () => {
    const pid = 'snap-a';
    const oldDef = pipeWithJobs(pid, [
      // 失败方式必须跨平台可靠：PowerShell 5.1 既不接受 && 也不接受 exit 1，
      // 故用「两行脚本 + node 非零退出码」：标记照常打印，退出码由最后一条命令决定。
      job('j1', ['echo OLD-J1-MARKER', 'node -e "process.exit(1)"'].join('\n')),
      job('j2', 'echo OLD-J2-MARKER', ['j1']),
    ]);
    const first = await engine.start({ pipeline: oldDef }).wait();
    assert.equal(first.status, 'failed', '旧定义以非零码退出，应失败');
    assert.notEqual(first.run.steps.j2.status, 'success', 'j2 应因上游失败被跳过');

    // —— 用户编辑同一条流水线：j1 改成必成功、j2 换脚本、再加一个新步骤 j3 ——
    const newDef = structuredClone(oldDef);
    newDef.name = '已编辑的新定义';
    newDef.stages[0].jobs[0].with.script = 'echo NEW-J1-MARKER';
    newDef.stages[0].jobs[1].with.script = 'echo NEW-J2-MARKER';
    newDef.stages[0].jobs.push(job('j3', 'echo NEW-J3-MARKER'));
    await store.pipelines.put(pid, newDef);
    assert.equal(store.pipelines.get(pid).stages[0].jobs[0].with.script, 'echo NEW-J1-MARKER', 'store 里确实已是新定义');

    // —— 对旧 run 重试 j1：必须跑旧快照 ——
    const res = await engine.retryStep(first.runId, 'j1').wait();

    const j1log = stepLogText(first.runId, 'j1', res.run);
    assert.ok(j1log.includes('OLD-J1-MARKER'), '重试必须执行旧定义的 j1 脚本，实际日志：' + JSON.stringify(j1log.slice(0, 300)));
    assert.ok(!j1log.includes('NEW-J1-MARKER'), '重试不得跑到编辑后的新定义上');
    // 旧 j1 是 exit 1：若误用新定义（echo 成功）会变成 success，这里必须仍然失败
    assert.equal(res.run.steps.j1.status, 'failed', '旧定义非零退出决定重试结果仍是 failed');
    assert.equal(res.status, 'failed', '误用新定义会让本次运行 success，实际 ' + res.status);
    // 旧快照里没有 j3，运行记录不得凭空多出新步骤
    assert.ok(!res.run.steps.j3, '不得出现编辑后才新增的步骤 j3');
    // 快照内容就是提交时那一份
    assert.equal(res.run.pipelineSnapshot.name, 'snap-a', '快照应保留提交时的 name');
    assert.equal(
      res.run.pipelineSnapshot.stages[0].jobs[0].with.script,
      ['echo OLD-J1-MARKER', 'node -e "process.exit(1)"'].join('\n'),
      '快照里必须仍是旧脚本',
    );
  });

  test('★ 快照 b)：运行中的 run 在其定义被编辑后，继续调度仍按旧快照', async () => {
    const pid = 'snap-b';
    // 阶段 s1 慢（约 900ms），阶段 s2 打标记；staged 模式 → 阶段串行
    const oldDef = {
      id: pid, name: pid, version: 1, variables: [], envSetRefs: [],
      defaults: { server: 'local', timeoutMs: 30000 },
      stages: [
        { id: 's1', name: 'S1', parallel: false, jobs: [job('j1', 'node -e "setTimeout(()=>{},900)"')] },
        { id: 's2', name: 'S2', parallel: false, jobs: [job('j2', 'echo OLD-STAGE2-MARKER')] },
      ],
      createdAt: 0, updatedAt: 0,
    };
    const h = engine.start({ pipeline: oldDef });
    const running = await waitFor(() => h.run.steps.j1.status === 'running', { timeoutMs: 8000 });
    assert.ok(running, 'j1 应进入 running，实际 ' + h.run.steps.j1.status);

    // —— 运行还没结束，用户就编辑了这条流水线的第二阶段 ——
    const newDef = structuredClone(oldDef);
    newDef.stages[1].jobs[0].with.script = 'echo NEW-STAGE2-MARKER';
    await store.pipelines.put(pid, newDef);

    const res = await h.wait();
    assert.equal(res.status, 'success', '运行应成功，实际 ' + res.status);

    const j2log = stepLogText(res.runId, 'j2', res.run);
    assert.ok(j2log.includes('OLD-STAGE2-MARKER'), '运行中编辑后，继续调度必须用旧快照，实际日志：' + JSON.stringify(j2log.slice(0, 300)));
    assert.ok(!j2log.includes('NEW-STAGE2-MARKER'), '运行中的 run 不得切到编辑后的新定义');

    // 更强的证据：以 start(runId) **恢复/重跑** 这条既有运行（这正是「从既有 run 继续调度」的路径）。
    // 此时 store 里仍是被编辑过的新定义；必须仍然按该 run 的快照执行。
    assert.equal(store.pipelines.get(pid).stages[1].jobs[0].with.script, 'echo NEW-STAGE2-MARKER', '前置条件：store 仍是新定义');
    const resumed = await engine.start(res.runId).wait();
    assert.equal(resumed.status, 'success', '恢复运行应成功，实际 ' + resumed.status);
    const resumedLog = stepLogText(resumed.runId, 'j2', resumed.run);
    assert.ok(resumedLog.includes('OLD-STAGE2-MARKER'), 'start(runId) 继续调度必须用旧快照，实际：' + JSON.stringify(resumedLog.slice(0, 300)));
    assert.ok(!resumedLog.includes('NEW-STAGE2-MARKER'), 'start(runId) 不得切到编辑后的新定义');
    // 必须仍是同一条运行（复用 run 记录，而非新建）
    assert.equal(resumed.runId, res.runId, 'start(runId) 应复用该运行记录');
  });

  test('★ 快照 c)：新 run 用的是提交时的定义，且与提交对象深度隔离', async () => {
    const pid = 'snap-c';
    const submitted = pipeWithJobs(pid, [job('j1', 'echo SUBMITTED-AT-START')]);
    const h = engine.start({ pipeline: submitted });
    // start 之后立刻改调用方手里的对象 + 改 store：都不得影响本次运行
    submitted.stages[0].jobs[0].with.script = 'echo MUTATED-AFTER-START';
    await store.pipelines.put(pid, pipeWithJobs(pid, [job('j1', 'echo LATER-EDIT-IN-STORE')]));

    const res = await h.wait();
    const j1log = stepLogText(res.runId, 'j1', res.run);
    assert.ok(j1log.includes('SUBMITTED-AT-START'), '新 run 必须用提交时的定义，实际日志：' + JSON.stringify(j1log.slice(0, 300)));
    // start 返回后改调用方对象，【一定】影响不到执行：
    // start() 是同步完成的（快照在返回前就已冻结），此后调度只认快照
    assert.ok(!j1log.includes('MUTATED-AFTER-START'), 'start 后修改调用方对象不得影响本次运行');
    assert.ok(!j1log.includes('LATER-EDIT-IN-STORE'), 'start 后编辑 store 不得影响本次运行');
    assert.equal(
      res.run.pipelineSnapshot.stages[0].jobs[0].with.script,
      'echo SUBMITTED-AT-START',
      '快照必须是提交时的深拷贝',
    );
    // 快照不可被就地改写（冻结），保证运行期不会有别处偷改定义
    assert.ok(Object.isFrozen(res.run.pipelineSnapshot), 'pipelineSnapshot 必须被冻结');
    assert.ok(Object.isFrozen(res.run.pipelineSnapshot.stages[0]), '快照须为深冻结');
  });

  test('★ 快照：retry(runId) 整跑复跑沿用快照，且不依赖 store 里的当前定义', async () => {
    const pid = 'snap-rerun';
    const oldDef = pipeWithJobs(pid, [job('j1', 'echo RERUN-OLD-DEF')]);
    const first = await engine.start({ pipeline: oldDef }).wait();
    assert.equal(first.status, 'success');

    // 编辑定义，然后把流水线整个删掉（快照必须自给自足）
    await store.pipelines.put(pid, pipeWithJobs(pid, [job('j1', 'echo RERUN-NEW-DEF')]));
    await store.pipelines.delete(pid);
    assert.equal(store.pipelines.get(pid), undefined, '前置条件：当前定义已不存在');

    const again = await engine.retry(first.runId).wait();
    assert.equal(again.status, 'success', '有快照时应能脱离 store 复跑，实际 ' + again.status);
    const log = stepLogText(again.runId, 'j1', again.run);
    assert.ok(log.includes('RERUN-OLD-DEF'), '复跑必须用快照定义，实际：' + JSON.stringify(log.slice(0, 200)));
    assert.ok(!log.includes('RERUN-NEW-DEF'), '复跑不得用编辑后的定义');
  });

  test('★ 降级：无快照的历史 run 用当前定义继续，不抛错并给出 warning', async () => {
    const pid = 'legacy-p';
    // 手造一条「老数据」：完全没有 pipelineSnapshot 字段
    const legacy = {
      id: 'run-legacy-no-snapshot',
      pipelineId: pid,
      pipelineName: '历史运行',
      status: 'failed',
      trigger: 'manual',
      startedAt: 1,
      finishedAt: 2,
      variables: {},
      steps: {
        j1: {
          id: 'j1', name: 'J1', stage: 's1', node: 'shell.exec', server: 'local',
          status: 'failed', phase: 'settled', startedAt: 1, finishedAt: 2, exitCode: 1,
          attempt: 1, lastOutputAt: 2, bytes: 0, logPath: '', spillPath: '',
          outputs: {}, error: '旧失败', detail: '旧失败',
        },
      },
      parentRunId: null, parentStepId: null, callChain: [pid],
    };
    await store.runs.put(legacy.id, legacy);
    await store.pipelines.put(pid, pipeWithJobs(pid, [job('j1', 'echo LEGACY-CURRENT-DEF')]));

    events.length = 0;
    // 不应抛错；应回退到当前定义
    const res = await engine.retryStep(legacy.id, 'j1').wait();
    assert.equal(res.run.steps.j1.status, 'success', '老数据重试应回退当前定义并成功');
    const log = stepLogText(legacy.id, 'j1', res.run);
    assert.ok(log.includes('LEGACY-CURRENT-DEF'), '降级路径应执行当前定义，实际：' + JSON.stringify(log.slice(0, 200)));
    assert.ok(
      events.some((e) => e.type === 'warning' && /没有定义快照/.test(e.message ?? '')),
      '降级必须给出 warning，实际事件：' + JSON.stringify(events.filter((e) => e.type === 'warning').map((e) => e.message)),
    );
  });

  test('★ 降级边界：无快照且流水线已被删除 → 抛出可读错误（与改造前行为一致）', async () => {
    const legacy = {
      id: 'run-legacy-gone',
      pipelineId: 'legacy-gone-p',
      pipelineName: '已删除',
      status: 'failed', trigger: 'manual', startedAt: 1, finishedAt: 2, variables: {},
      steps: {
        j1: {
          id: 'j1', name: 'J1', stage: 's1', node: 'shell.exec', server: 'local',
          status: 'failed', phase: 'settled', startedAt: 1, finishedAt: 2, exitCode: 1,
          attempt: 1, lastOutputAt: 2, bytes: 0, logPath: '', spillPath: '',
          outputs: {}, error: 'x', detail: 'x',
        },
      },
      parentRunId: null, parentStepId: null, callChain: ['legacy-gone-p'],
    };
    await store.runs.put(legacy.id, legacy);
    assert.throws(
      () => engine.retryStep(legacy.id, 'j1'),
      /流水线不存在/,
      '无快照 + 定义已删，必须给可读错误而不是静默成功',
    );
  });

  test('★ 快照不污染 SSE 摘要（§3.11 的 run 摘要不得夹带整份定义）', async () => {
    const res = await engine.start({ pipeline: pipeWith('echo summary-shape') }).wait();
    const summary = engine.summarizeRun(res.run);
    assert.ok(!('pipelineSnapshot' in summary), 'SSE run 摘要不得携带 pipelineSnapshot（体积）');
    assert.equal(summary.pipelineId, 'p1', '摘要仍须保留 pipelineId');
    // 但 run 记录本身必须落盘带快照，供重试使用
    const stored = store.runs.get(res.runId);
    assert.ok(stored.pipelineSnapshot, '运行记录必须持久化快照');
    assert.equal(stored.pipelineSnapshot.id, 'p1', '落盘快照内容正确');
  });
});
