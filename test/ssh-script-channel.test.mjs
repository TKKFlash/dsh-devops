// 契约 §3.7 + task-3：SSH 脚本通道回归用例（FROZEN INTERFACE v1）
//
// 目的：为「shell.exec 在 SSH 服务器上无法执行」这个阻断级缺陷留下**能捕获它**的用例。
// 逐条对应交接文档 §9.2 的建议用例（编号写在用例名里），外加 Lead 补充的第 5 个改动点：
// **执行器对象（真实 + 惰性代理两条路径）必须暴露 supportsScript === true**。
//
// 铁律：绝不联网。SSH 一律走「注入的 mock transport」或「假执行器」，只断言
// 「引擎交给执行器的 spec」与「执行器发往远端的命令行」这两个可观察面。
//
// ── 根因回顾（为什么这些断言有效）────────────────────────────────────────
//   根因 0：run.js 调 async 的 ssh run() 时漏 await → handle 是 pending Promise，
//           handle.done === undefined → 抛 Cannot read properties of undefined
//           (reading 'finally')。§9.2 #2 专守它。
//   根因 1：shell.exec 用 buildScriptInvocation 在**控制端**落临时文件，再把该路径
//           当 argv 交下去；远端去执行一个它磁盘上并不存在的文件。§9.2 #1 守它。
//   根因 2：job.workdir 被 normalizePipeline 丢弃 + cwd 回落控制端 process.cwd()。
//           §9.2 #7 守它。
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { suiteFor, requiredFn } from './helpers/modules.mjs';
import { makeTmpDir, cleanupTmp, fakeLog } from './helpers/tmp.mjs';

const RUN_REL = 'src/engine/run.js';
const SSH_REL = 'src/engine/executors/ssh.js';
const REGISTRY_REL = 'src/engine/executors/index.js';
const SCHEMA_REL = 'src/model/schema.js';
const HELPERS_REL = 'src/engine/nodes/helpers.js';

const { mod: runMod, skip } = await suiteFor(RUN_REL);
const { mod: sshMod } = await suiteFor(SSH_REL);
const { mod: registryMod } = await suiteFor(REGISTRY_REL);
const { mod: schemaMod } = await suiteFor(SCHEMA_REL);
const { mod: helpersMod } = await suiteFor(HELPERS_REL);

/** 控制端临时目录：绝不能出现在发往远端的命令行里。 */
const CONTROLLER_TMP = tmpdir();
/** 控制端盘符路径（Windows 控制端特征）。 */
const CONTROLLER_DRIVE = /[A-Za-z]:[\\/]/;

/**
 * 断言一条「发往远端」的命令行没有夹带控制端的东西。
 * 这是本文件最核心的不变量：远端命令行是给**目标机**看的，控制端路径毫无意义。
 */
function assertNoControllerLeak(command, label) {
  assert.ok(typeof command === 'string' && command.length > 0, label + '：命令行必须非空');
  assert.ok(
    !CONTROLLER_DRIVE.test(command),
    label + '：命令行不得含控制端盘符路径，实际 ' + JSON.stringify(command),
  );
  assert.ok(
    !command.includes(CONTROLLER_TMP),
    label + '：命令行不得含控制端 os.tmpdir()（' + CONTROLLER_TMP + '），实际 ' + JSON.stringify(command),
  );
  assert.ok(
    !/cmd\.exe/i.test(command),
    label + '：命令行不得含控制端 cmd.exe，实际 ' + JSON.stringify(command),
  );
}

/* ===================================================================== *
 * 基础设施：假执行器 + 单步 shell.exec 端到端 harness
 * ===================================================================== */

/** 造一个只实现 run() 的假执行器；supportsScript 由能力标志决定（FROZEN §1/§5）。 */
function makeFakeExecutor({ kind = 'ssh', supportsScript = true } = {}) {
  const specs = [];
  const executor = {
    id: kind === 'ssh' ? 'ssh:fake' : 'local',
    kind,
    ...(supportsScript ? { supportsScript: true } : {}),
    async run(spec = {}) {
      specs.push(spec);
      return {
        done: Promise.resolve({ exitCode: 0, signal: null, cancelled: false, timedOut: false, durationMs: 1 }),
        cancel() {},
      };
    },
  };
  return { executor, specs };
}

/** 用假执行器直接顶替注册表（resolve 同步返回同一实例）。 */
function registryOf(executor) {
  return {
    resolve: () => executor,
    resolveAsync: async () => executor,
    list: () => [],
    isLocalHost: () => executor.kind === 'local',
    dispose: async () => ({ ok: true }),
  };
}

/** 单步 shell.exec 流水线；serverId 决定解析到哪个服务器。 */
function singleStepPipeline({ serverId = 'srv-ssh', withArgs = { script: 'echo hello' }, jobOver = {} } = {}) {
  return {
    id: 'p-ssh-channel',
    name: 'SSH 脚本通道',
    version: 1,
    variables: [],
    envSetRefs: [],
    defaults: { server: serverId, timeoutMs: 30000 },
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
            server: serverId,
            needs: [],
            when: 'on_success',
            allowFailure: false,
            retry: { max: 0, delayMs: 10 },
            timeoutMs: 30000,
            ...jobOver,
            with: withArgs,
          },
        ],
      },
    ],
    createdAt: 0,
    updatedAt: 0,
  };
}

/** kind:'ssh' 的样本服务器（形状对齐 test/helpers/fixtures.mjs 的 sampleServer）。 */
function sshServer(over = {}) {
  return {
    id: 'srv-ssh',
    name: '生产机',
    kind: 'ssh',
    host: '10.0.0.5',
    port: 22,
    user: 'deploy',
    auth: { type: 'key', keyRef: 'PROD_SSH_KEY', passwordRef: '' },
    shell: '',
    workdir: '/srv/app',
    tags: ['prod'],
    defaultEnv: [],
    customEnv: [],
    envSetRefs: [],
    probe: {
      at: 0, os: 'Ubuntu', arch: 'x86_64', shell: '/bin/bash', workdir: '/root',
      runtime: {}, managers: [], sudo: 'none', error: '',
    },
    runtimes: {},
    allowProvision: false,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

/**
 * 造一个只记录命令行、绝不联网的 mock transport（形状对齐 ssh.test.mjs 的 makeMockTransport）。
 */
function makeMockTransport(commands = []) {
  return {
    id: 'ssh:mock',
    kind: 'ssh',
    label: 'mock@host:22',
    remoteHome: '/home/deploy',
    isConnected: () => true,
    async ensureConnected() {},
    async close() {},
    async sftp() { throw new Error('本用例不应访问 sftp'); },
    async exec(spec = {}) {
      commands.push(spec.command);
      return {
        command: spec.command,
        done: Promise.resolve({ exitCode: 0, signal: null }),
        cancel() {},
      };
    },
  };
}

describe('engine/SSH 脚本通道（回归：shell.exec 跨机执行）', { skip }, () => {
  const createEngine = requiredFn(runMod, 'createEngine', RUN_REL);

  let createStore;
  let createLogStore;
  let createNodeRegistry;

  before(async () => {
    [{ createStore }, { createLogStore }, { createNodeRegistry }] = await Promise.all([
      import('../src/store/store.js'),
      import('../src/logs/logstore.js'),
      import('../src/engine/nodes/index.js'),
    ]);
  });

  after(async () => {
    cleanupTmp();
  });

  /**
   * 跑一步 shell.exec，返回 { res, step, specs }。
   * 注意 config.processEnv：默认情形下引擎会把**控制端** process.env 当作 env 合并层，
   * 那会让「命令行是否夹带控制端路径」的断言被合法输入干扰。因此凡是断言命令行
   * 洁净度的用例都显式给一个不含控制端路径的 processEnv，把断言面隔离到被测缺陷上。
   */
  async function runOneStep({ executor, server = sshServer(), pipeline = singleStepPipeline(), config = {} } = {}) {
    const dir = makeTmpDir('dsh-devops-run-');
    const store = await createStore({ dataDir: dir, log: fakeLog() });
    if (server && server.id !== 'local') await store.servers.put(server.id, server);
    const logs = createLogStore({ dataDir: dir, ringBytes: 262144, mask: [] });
    const nodes = await createNodeRegistry({ executors: null, provisioner: null, log: fakeLog(), store, config: {} });
    const engine = createEngine({
      store,
      logs,
      nodes,
      executors: registryOf(executor),
      provisioner: null,
      config: { maxConcurrentRuns: 1, maxParallelSteps: 2, ...config },
      onEvent: () => {},
    });
    const res = await engine.start({ pipeline }).wait();
    await store.close?.();
    return { res, step: res.run?.steps?.j1 };
  }

  /* =================================================================== *
   * §9.2 #1：SSH 目标 + shell.exec —— 脚本走 spec.script，绝不落控制端文件
   * =================================================================== */
  test('★ §9.2 #1 SSH 目标：脚本以 spec.script 交给执行器，argv 必须为 undefined', async () => {
    const script = 'set -eu\necho hello-from-remote\n';
    const { executor, specs } = makeFakeExecutor({ kind: 'ssh', supportsScript: true });
    const { res, step } = await runOneStep({
      executor,
      pipeline: singleStepPipeline({ withArgs: { script, shell: 'bash' } }),
    });

    assert.equal(res.status, 'success', '步骤应成功，实际 ' + res.status + '（' + (step?.error ?? '') + '）');
    assert.equal(specs.length, 1, '执行器 run() 必须被调用一次');
    const spec = specs[0];

    // 核心：脚本走 script 通道；argv 必须为空（老缺陷把控制端 script.cmd 路径塞进 argv）
    assert.ok('argv' in spec, 'spec 必须显式携带 argv 字段');
    assert.equal(spec.argv, undefined, 'SSH 脚本节点不得把 argv 交给执行器，实际 ' + JSON.stringify(spec.argv));
    assert.equal(spec.script, script, 'script 必须是用户脚本原文（逐字节一致）');
    assert.equal(spec.shell, 'bash', 'shell 应原样转发给执行器');

    // 顺带证明「不是恰好 argv 里没有盘符」：argv 整个不存在。
    const outCmd = String(step.outputs?.command ?? '');
    assert.ok(!/cmd\.exe/i.test(outCmd), 'outputs.command 不得回显 cmd.exe，实际 ' + outCmd);
  });

  test('★ §9.2 #1 真实 ssh 执行器：发往远端的命令行不含控制端盘符 / os.tmpdir() / cmd.exe，且脚本正文在命令行里', async () => {
    const createSshExecutor = requiredFn(sshMod, 'createSshExecutor', SSH_REL);
    const script = 'set -eu\necho remote-ok\n';
    const commands = [];
    const executor = createSshExecutor({
      server: sshServer(),
      config: { verifyRealpath: false },
      log: () => {},
      transportFor: () => makeMockTransport(commands),
    });

    const { res, step } = await runOneStep({
      executor,
      pipeline: singleStepPipeline({ withArgs: { script, shell: 'bash' } }),
      // 隔离 env 层，避免控制端 process.env 混入导致误判（见 runOneStep 注释）
      config: { processEnv: { KEEP: '1' } },
    });

    assert.equal(res.status, 'success', '步骤应成功，实际 ' + res.status + '（' + (step?.error ?? '') + '）');
    assert.equal(commands.length, 1, '必须恰好下发一条远端命令');
    const command = commands[0];

    // §9.2 #1 核心：控制端痕迹一个都不许有
    assertNoControllerLeak(command, '§9.2 #1 远端命令行');
    // 脚本正文必须在命令行里（走 spec.script 分支，而不是 quoteArgv(argv)）
    assert.ok(command.includes(script), '远端命令行必须含脚本正文，实际 ' + JSON.stringify(command));
    // FROZEN §2：shell 渲染为 '<shell>' -c '<script>'
    assert.ok(command.includes("'bash' -c '" + script + "'"), '命令行形态应为 cd/cwd + \'bash\' -c \'<script>\'，实际 ' + JSON.stringify(command));
  });

  /* =================================================================== *
   * §9.2 #2：await 回归 —— 根因 0 的专用守卫（修复前必然失败）
   * =================================================================== */
  test("★ §9.2 #2 await 回归：async run() 的 SSH 执行器跑一步，绝不出现 reading 'finally' 的引擎异常", async () => {
    // 这条在修复前必然失败：run.js 漏 await 时 handle 是 pending Promise，
    // handle.done === undefined，随即抛
    //   Cannot read properties of undefined (reading 'finally')
    // 被 executeOnce 的 catch 包成「shell.exec 执行异常：…」，步骤 failed。
    const { executor } = makeFakeExecutor({ kind: 'ssh', supportsScript: true });
    const { res, step } = await runOneStep({ executor });

    const surfaces = [step?.error, step?.detail, step?.outputs?.stderr, res?.error]
      .filter(Boolean)
      .join(' | ');
    assert.ok(!/reading 'finally'/.test(surfaces), '不得出现漏 await 的引擎异常，实际：' + surfaces);
    assert.ok(!/undefined.*finally/.test(surfaces), '不得出现 handle.done 为 undefined 的痕迹，实际：' + surfaces);
    assert.equal(step.status, 'success', 'async 执行器的步骤应正常收敛为 success，实际 ' + step.status + '（' + surfaces + '）');
  });

  test('★ §9.2 #2 复刻调用序列：同步 run 正常、async run 若漏 await 才会抛 finally', () => {
    // 复刻 run.js 的调用序列（交接文档 §12.2），把「漏 await 就会炸」这个机制钉住。
    function callLikeRunJs(executor) {
      const handle = executor.run({});
      try {
        // run.js 的原始调用序列：handle.done.finally(...)
        handle.done.finally(() => {}).catch(() => {});
        return 'ok';
      } catch (error) {
        return String(error?.message ?? error);
      }
    }

    const syncLike = { run: () => ({ done: Promise.resolve({ exitCode: 0 }), cancel() {} }) };
    const asyncLikeUnawaited = { run: async () => ({ done: Promise.resolve({ exitCode: 0 }), cancel() {} }) };

    assert.equal(callLikeRunJs(syncLike), 'ok', '同步 run（local 形态）必须正常');
    assert.match(
      callLikeRunJs(asyncLikeUnawaited),
      /finally/,
      'async run 未 await 时必须抛 finally 相关错误（证明该守卫能捕获根因 0）',
    );
  });

  /* =================================================================== *
   * §9.2 #5 / #6：转义与多行脚本整体性（纯函数层，离线确定性）
   * =================================================================== */
  describe('§9.2 #5/#6 远端命令行转义（quoteArg / buildCommandLine）', () => {
    const buildCommandLine = requiredFn(sshMod, 'buildCommandLine', SSH_REL);

    test('★ §9.2 #5 含单引号的脚本：按 POSIX 形态转义，不被拆散', () => {
      const script = 'echo "it\'s ok"';
      const line = buildCommandLine({ script, shell: 'bash' });
      // quoteArg 的 POSIX 转义：每个单引号变成 '\''，整段脚本再被一对单引号包裹。
      // 断言转义形态本身，以及「整段脚本是同一个被包裹的参数」（不被拆散）。
      const escaped = script.split("'").join("'\\''");
      assert.ok(line.includes("it'\\''s ok"), "单引号必须转义成 '\\'' 形态，实际 " + JSON.stringify(line));
      assert.ok(
        line.includes("'" + escaped + "'"),
        '整段脚本必须作为一个被单引号包裹的参数，实际 ' + JSON.stringify(line),
      );
      assert.ok(!line.includes('\n'), '不得引入换行破坏命令结构');
    });

    test('★ §9.2 #6 多行脚本 + ${VAR:-默认} / $(...) / set -eu：整体单引号包裹、不被拆散', () => {
      const script = [
        'set -eu',
        'APP=/opt/yuedong-erp/test',
        'echo "分支=[${BRANCH:-默认}]"',
        'echo "主机=$(hostname)"',
        '',
      ].join('\n');
      const line = buildCommandLine({ script, shell: 'bash' });

      // 脚本无单引号 → 转义形态就是「两边各一个单引号」的整块包裹。
      const expected = "'" + script + "'";
      assert.ok(line.includes(expected), '多行脚本必须被整体单引号包裹，实际 ' + JSON.stringify(line));
      for (const token of ['set -eu', '${BRANCH:-默认}', '$(hostname)']) {
        assert.ok(line.includes(token), '构造 ' + token + ' 必须原样保留，实际 ' + JSON.stringify(line));
      }
      assert.ok(line.endsWith(expected), '命令行应以被包裹的脚本收尾，实际 ' + JSON.stringify(line));
    });

    test('§9.2 #6 补充：scriptArgv 优先于 shell，脚本文本作为最后一个独立参数追加', () => {
      const script = 'print("hi")';
      const line = buildCommandLine({ script, shell: 'bash', scriptArgv: ['python3'] });
      assert.ok(
        line.includes("'python3' '" + script + "'"),
        "scriptArgv 存在时应渲染为 '<a0>' '<script>' 并优先于 shell，实际 " + JSON.stringify(line),
      );
      assert.ok(!line.includes("'bash' -c"), 'scriptArgv 优先时不得再渲染 shell -c');
    });

    test('§9.2 #6 补充：script 分支优先于 argv（不把 argv 拼进来）', () => {
      const line = buildCommandLine({
        argv: ['cmd.exe', '/d', '/s', '/c', 'C:\\Temp\\x.cmd'],
        script: 'echo real',
        shell: 'bash',
      });
      assert.ok(line.includes("'bash' -c 'echo real'"), 'script 必须优先，实际 ' + JSON.stringify(line));
      assert.ok(!line.includes('cmd.exe'), '走 script 分支时不得再拼接 argv');
    });

    test('★ 回归：无解释器 + 有 env 前缀时，脚本首行不得被 env 当成命令名', () => {
      // 真机实测缺陷：无 shell 且带附加环境变量时曾拼成
      //   env 'A=1' set -eu\necho hi
      // env 会把脚本首行当作要执行的命令名，报 env: 'set': No such file or directory，
      // 第一行被静默吃掉。现在必须由 POSIX shell 承载脚本文本。
      const script = 'set -eu\necho hi';
      const line = buildCommandLine({ script, env: { A: '1' }, cwd: '/root', home: '/root' });

      assert.ok(!/env '[^']*' set -eu/.test(line), '不得把脚本文本裸拼在 env 之后，实际 ' + JSON.stringify(line));
      assert.ok(
        line.includes("'sh' -c '" + script + "'"),
        "无显式 shell 时脚本应由 sh -c 承载（脚本仍是独立参数），实际 " + JSON.stringify(line),
      );
      // env 前缀本身必须保留（否则附加环境变量会丢）
      assert.ok(line.includes("env 'A=1'"), 'env 前缀必须保留，实际 ' + JSON.stringify(line));
    });

    test('★ 回归：纯 argv 路径不受脚本分支影响（本地/远端既有行为不变）', () => {
      // 修复「脚本承载方式」不得改动 argv 路径的命令行形态。
      const line = buildCommandLine({ argv: ['git', 'status'], env: { A: '1' }, cwd: '/root', home: '/root' });
      assert.equal(line, "cd '/root' && env 'A=1' 'git' 'status'", 'argv 路径命令行必须逐字节不变');
    });

  /* =================================================================== *
   * 补充：脚本长度 / NUL 前置拦截（方案 A 引入的 SSH 传输约束）
   * =================================================================== */
  describe('脚本长度与 NUL 前置拦截（OpenSSH MaxCommandLength）', () => {
    const createSshExecutor = requiredFn(sshMod, 'createSshExecutor', SSH_REL);

    /** 造一个记录是否被调用过的 mock transport。 */
    function guardTransport(calls) {
      return () => ({
        id: 'ssh:mock', kind: 'ssh', label: 'mock', remoteHome: '/root',
        isConnected: () => true,
        async ensureConnected() {}, async close() {},
        async sftp() { throw new Error('本用例不应访问 sftp'); },
        async exec(spec) {
          calls.push(spec.command);
          return { command: spec.command, done: Promise.resolve({ exitCode: 0, signal: null }), cancel() {} };
        },
      });
    }

    function makeExecutor(calls) {
      return createSshExecutor({
        server: sshServer({ workdir: '/root' }),
        config: {},
        log: () => {},
        transportFor: guardTransport(calls),
      });
    }

    test('★ 超长脚本：发车前拦下并报 REMOTE_COMMAND_TOO_LARGE（不得让 sshd 断连了事）', async () => {
      const calls = [];
      const executor = makeExecutor(calls);
      // 300KB 远超 OpenSSH 的 exec 请求上限（约 256KB）；若不拦截，sshd 会直接断连，
      // 客户端只看到 "exec request failed on channel 0"，用户完全看不出原因。
      await assert.rejects(
        () => executor.run({ script: '#' + 'x'.repeat(300 * 1024), cwd: '/root', onData: () => {} }),
        (error) => {
          assert.equal(error.code, 'REMOTE_COMMAND_TOO_LARGE', '错误码必须是 REMOTE_COMMAND_TOO_LARGE');
          assert.match(String(error.message), /过大/, '错误文案必须说明「命令行过大」');
          assert.ok(error.suggestion, '必须给出可照做的建议');
          return true;
        },
      );
      assert.equal(calls.length, 0, '必须在发车前拦下（transport.exec 不得被调用）');
    });

    test('★ 阈值内不误伤：150KB 脚本正常下发', async () => {
      const calls = [];
      const executor = makeExecutor(calls);
      const handle = await executor.run({ script: '#' + 'x'.repeat(150 * 1024), cwd: '/root', onData: () => {} });
      const res = await handle.done;
      assert.equal(res.exitCode, 0, '阈值内脚本必须正常执行');
      assert.equal(calls.length, 1, '阈值内必须真的下发命令（不得误伤）');
    });

    test('★ 含 NUL 字节的脚本：报 SCRIPT_CONTAINS_NUL 且不下发', async () => {
      const calls = [];
      const executor = makeExecutor(calls);
      await assert.rejects(
        () => executor.run({ script: 'echo a\u0000b', cwd: '/root', onData: () => {} }),
        (error) => {
          assert.equal(error.code, 'SCRIPT_CONTAINS_NUL', '错误码必须是 SCRIPT_CONTAINS_NUL');
          return true;
        },
      );
      assert.equal(calls.length, 0, 'NUL 脚本不得下发');
    });

    test('★ 正常脚本与纯 argv 不受拦截影响', async () => {
      const calls = [];
      const executor = makeExecutor(calls);
      const ok = await executor.run({ script: 'echo hi', cwd: '/root', onData: () => {} });
      assert.equal((await ok.done).exitCode, 0, '正常脚本必须成功');
      const argvHandle = await executor.run({ argv: ['git', 'status'], cwd: '/root', onData: () => {} });
      assert.equal((await argvHandle.done).exitCode, 0, 'argv 路径必须成功');
      assert.equal(calls.length, 2, '两条都应下发');
    });
  });

    test('§9.2 #6 补充：既无 script/argv/scriptArgv 时明确报错（不静默执行空命令）', () => {
      assert.throws(() => buildCommandLine({}), /.*/, '空命令必须报错');
    });
  });

  /* =================================================================== *
   * §9.2 #3 / #4：非法 shell 名 / Windows 控制端 + shell:"bash"
   * =================================================================== */
  describe('§9.2 #3/#4 shell 名严格校验（禁止静默降级成 cmd.exe 并报成功）', () => {
    test('★ §9.2 #4 非法 shell 名：buildScriptInvocation 必须抛 SHELL_UNSUPPORTED 且带可执行的中文建议', async () => {
      // 当前（task-2 未落地时）任何无法识别的 shell 名都被静默降级成 cmd.exe 并 exit 0
      // —— 正是这条用例要捕获的缺陷（FROZEN §7：必须抛错 + error.suggestion）。
      const buildScriptInvocation = requiredFn(helpersMod, 'buildScriptInvocation', HELPERS_REL);
      let thrown = null;
      try {
        const inv = await buildScriptInvocation({ script: 'echo hi', shell: 'definitely-not-a-shell-xyz' });
        await inv?.cleanup?.();
      } catch (error) {
        thrown = error;
      }
      assert.ok(thrown, '无法识别的 shell 名必须抛错（不得静默降级并返回成功）');
      assert.equal(thrown.code, 'SHELL_UNSUPPORTED', '错误必须带 code="SHELL_UNSUPPORTED"（FROZEN §7）');
      assert.ok(
        typeof thrown.suggestion === 'string' && thrown.suggestion.trim().length > 0,
        '错误必须带可执行的中文建议 suggestion（FROZEN §7）',
      );
    });

    test('★ §9.2 #4 端到端（本地路径）：非法 shell 名必须让步骤失败，而不是 exit 0 静默成功', async () => {
      const { executor } = makeFakeExecutor({ kind: 'local', supportsScript: false });
      const { res, step } = await runOneStep({
        executor,
        server: { id: 'local', name: '本机', kind: 'local', host: '127.0.0.1' },
        pipeline: singleStepPipeline({
          serverId: 'local',
          withArgs: { script: 'echo hi', shell: 'definitely-not-a-shell-xyz' },
        }),
      });
      assert.notEqual(
        res.status,
        'success',
        '非法 shell 名不得让步骤成功（当前为静默降级成 cmd.exe：task-2 待修缺陷）',
      );
      assert.notEqual(step.status, 'success', '非法 shell 名必须导致步骤失败');
      assert.ok(
        /SHELL_UNSUPPORTED|无法识别|不支持/.test(String(step.error ?? '') + String(step.outputs?.suggestion ?? '')),
        '失败原因应指向 shell 不受支持，实际 ' + step.error,
      );
    });

    test('★ §9.2 #3 Windows 控制端 + shell:"bash"：不得产出 cmd.exe（要么正确解析，要么明确报错）', async () => {
      const buildScriptInvocation = requiredFn(helpersMod, 'buildScriptInvocation', HELPERS_REL);
      if (process.platform !== 'win32') {
        // 非 Windows 控制端上 bash 是正常解释器，本用例靶心不成立。
        return;
      }
      let argv = null;
      let thrown = null;
      try {
        const inv = await buildScriptInvocation({ script: 'echo hi', shell: 'bash' });
        argv = inv.argv;
        await inv.cleanup?.();
      } catch (error) {
        thrown = error;
      }

      if (thrown) {
        // 「明确报错」是可接受的另一半：按 FROZEN §7 应带 SHELL_UNSUPPORTED + 建议
        assert.equal(thrown.code, 'SHELL_UNSUPPORTED', '明确报错时应带 SHELL_UNSUPPORTED，实际 ' + thrown.code);
        assert.ok(thrown.suggestion, '明确报错时必须给出可执行建议');
      } else {
        assert.ok(!/cmd\.exe/i.test(argv[0]), 'shell:"bash" 不得再产出 cmd.exe，实际 argv=' + JSON.stringify(argv));
        assert.ok(!/powershell/i.test(argv[0]), 'shell:"bash" 不得降级成 powershell，实际 argv=' + JSON.stringify(argv));
      }
    });

    test('★ §9.2 #3 补充：SSH 路径下非法 shell 名不得被悄悄换成 cmd.exe（远端命令行不含 cmd.exe）', async () => {
      const createSshExecutor = requiredFn(sshMod, 'createSshExecutor', SSH_REL);
      const commands = [];
      const executor = createSshExecutor({
        server: sshServer(),
        config: { verifyRealpath: false },
        log: () => {},
        transportFor: () => makeMockTransport(commands),
      });
      const { res } = await runOneStep({
        executor,
        pipeline: singleStepPipeline({ withArgs: { script: 'echo hi', shell: 'definitely-not-a-shell-xyz' } }),
        config: { processEnv: { KEEP: '1' } },
      });
      assert.equal(commands.length, 1, '必须下发一条远端命令');
      assert.ok(
        !/cmd\.exe/i.test(commands[0]),
        '非法 shell 名不得在 SSH 路径上降级成 cmd.exe，实际 ' + JSON.stringify(commands[0]),
      );
      assert.ok(
        commands[0].includes("'definitely-not-a-shell-xyz' -c"),
        'FROZEN 范围：SSH 路径原样转发 shell 名（helpers 层才负责抛 SHELL_UNSUPPORTED），实际 ' + JSON.stringify(commands[0]),
      );
      assert.ok(res.status === 'success' || res.status === 'failed', '运行必须如实收敛（本用例只守「不降级」）');
    });
  });

  /* =================================================================== *
   * §9.2 #7：job.workdir 保留 + cwd 生效
   * =================================================================== */
  describe('§9.2 #7 job.workdir 与 cwd 解析', () => {
    test('★ §9.2 #7 normalizePipeline 必须保留 job.workdir（原缺陷：白名单漏字段 → 静默丢弃）', () => {
      const normalizePipeline = requiredFn(schemaMod, 'normalizePipeline', SCHEMA_REL);
      const pipeline = singleStepPipeline({ jobOver: { workdir: '/opt/yuedong-erp/test' } });
      const normalized = normalizePipeline(pipeline);
      const job = normalized.stages[0].jobs[0];
      assert.equal(
        job.workdir,
        '/opt/yuedong-erp/test',
        '规范化后必须保留 job.workdir，实际 ' + JSON.stringify(job.workdir) + '（键存在：' + ('workdir' in job) + '）',
      );
    });

    test('★ §9.2 #7 job.workdir 生效：交给执行器的 cwd 等于 job.workdir', async () => {
      const { executor, specs } = makeFakeExecutor({ kind: 'ssh', supportsScript: true });
      const { res } = await runOneStep({
        executor,
        pipeline: singleStepPipeline({ jobOver: { workdir: '/opt/yuedong-erp/test' } }),
      });
      assert.equal(res.status, 'success', '步骤应成功，实际 ' + res.status);
      assert.equal(specs[0].cwd, '/opt/yuedong-erp/test', 'cwd 必须取 job.workdir，实际 ' + specs[0].cwd);
    });

    test('★ §9.2 #7 server.probe.workdir 回退：server.workdir 为空时用探测结果，而不是控制端 cwd', async () => {
      const { executor, specs } = makeFakeExecutor({ kind: 'ssh', supportsScript: true });
      const { res } = await runOneStep({
        executor,
        server: sshServer({ workdir: '', probe: { ...sshServer().probe, workdir: '/root' } }),
      });
      assert.equal(res.status, 'success', '步骤应成功，实际 ' + res.status);
      assert.equal(specs[0].cwd, '/root', 'cwd 应回退 server.probe.workdir，实际 ' + specs[0].cwd);
      assert.ok(!CONTROLLER_DRIVE.test(String(specs[0].cwd)), 'cwd 不得是控制端盘符路径，实际 ' + specs[0].cwd);
    });

    test('§9.2 #7 本地不回归：local 目标的 cwd 仍是引擎工作目录', async () => {
      const { executor, specs } = makeFakeExecutor({ kind: 'local', supportsScript: false });
      const { res } = await runOneStep({
        executor,
        server: { id: 'local', name: '本机', kind: 'local', host: '127.0.0.1' },
        pipeline: singleStepPipeline({ serverId: 'local' }),
      });
      assert.equal(res.status, 'success', '本地步骤应成功，实际 ' + res.status);
      assert.equal(specs[0].cwd, process.cwd(), 'local cwd 应是引擎进程工作目录，实际 ' + specs[0].cwd);
    });

    test('§9.2 #7 with.workdir 覆盖优先（既有能力不得回退）', async () => {
      const { executor, specs } = makeFakeExecutor({ kind: 'ssh', supportsScript: true });
      const { res } = await runOneStep({
        executor,
        pipeline: singleStepPipeline({
          jobOver: { workdir: '/opt/job-level' },
          withArgs: { script: 'echo hi', workdir: '/opt/step-level' },
        }),
      });
      assert.equal(res.status, 'success', '步骤应成功，实际 ' + res.status);
      assert.equal(specs[0].cwd, '/opt/step-level', 'with.workdir 应优先于 job.workdir，实际 ' + specs[0].cwd);
    });
  });

  /* =================================================================== *
   * §9.2 #10：PATH 不跨机泄漏
   * =================================================================== */
  describe('§9.2 #10 PATH 不跨机泄漏', () => {
    test('★ §9.2 #10 发往 SSH 远端的 env 不含控制端 process.env.PATH；本地仍保留兜底', async () => {
      const controllerPath = 'C:\\CONTROLLER_ONLY_BIN;C:\\WINDOWS';
      const savedPath = process.env.PATH;
      process.env.PATH = controllerPath;
      try {
        // SSH：processEnv 里**故意不含** PATH，模拟真机默认情形。
        // 修复前 run.js 无条件把控制端 PATH 兜底注入 childEnv → 会泄漏到远端。
        const { executor: sshExec, specs: sshSpecs } = makeFakeExecutor({ kind: 'ssh', supportsScript: true });
        const sshRun = await runOneStep({ executor: sshExec, config: { processEnv: { KEEP: '1' } } });
        assert.equal(sshRun.res.status, 'success', 'SSH 步骤应成功，实际 ' + sshRun.res.status);
        assert.notEqual(
          sshSpecs[0].env?.PATH,
          controllerPath,
          'SSH 的 env.PATH 不得等于控制端 process.env.PATH（跨机泄漏）',
        );

        // 反向对照：本地执行器仍按既有行为兜底注入控制端 PATH（零回归）。
        const { executor: localExec, specs: localSpecs } = makeFakeExecutor({ kind: 'local', supportsScript: false });
        const localRun = await runOneStep({
          executor: localExec,
          server: { id: 'local', name: '本机', kind: 'local', host: '127.0.0.1' },
          pipeline: singleStepPipeline({ serverId: 'local' }),
          config: { processEnv: { KEEP: '1' } },
        });
        assert.equal(localRun.res.status, 'success', '本地步骤应成功，实际 ' + localRun.res.status);
        assert.equal(
          localSpecs[0].env?.PATH,
          controllerPath,
          '本地执行器必须保留控制端 PATH 兜底（既有行为），实际 ' + JSON.stringify(localSpecs[0].env?.PATH),
        );
      } finally {
        if (savedPath === undefined) delete process.env.PATH;
        else process.env.PATH = savedPath;
      }
    });

    test('★ §9.2 #10 真实 ssh 执行器：远端命令行不携带控制端 PATH', async () => {
      const createSshExecutor = requiredFn(sshMod, 'createSshExecutor', SSH_REL);
      const commands = [];
      const executor = createSshExecutor({
        server: sshServer(),
        config: { verifyRealpath: false },
        log: () => {},
        transportFor: () => makeMockTransport(commands),
      });

      const savedPath = process.env.PATH;
      process.env.PATH = 'C:\\CONTROLLER_ONLY_BIN';
      try {
        const { res } = await runOneStep({ executor, config: { processEnv: { KEEP: '1' } } });
        assert.equal(res.status, 'success', 'SSH 步骤应成功，实际 ' + res.status);
      } finally {
        if (savedPath === undefined) delete process.env.PATH;
        else process.env.PATH = savedPath;
      }
      assert.equal(commands.length, 1, '必须恰好下发一条远端命令');
      assert.ok(
        !commands[0].includes('CONTROLLER_ONLY_BIN'),
        '远端命令行不得含控制端 PATH，实际 ' + JSON.stringify(commands[0]),
      );
    });
  });

  /* =================================================================== *
   * FROZEN §1 + §5：supportsScript 能力标志（真实 + 惰性代理两条路径）
   * =================================================================== */
  describe('能力标志 supportsScript（FROZEN §1 / §5）', () => {
    test('★ 真实 ssh 执行器对象暴露 supportsScript === true', () => {
      const createSshExecutor = requiredFn(sshMod, 'createSshExecutor', SSH_REL);
      const executor = createSshExecutor({
        server: sshServer(),
        config: { verifyRealpath: false },
        log: () => {},
        transportFor: () => makeMockTransport([]),
      });
      assert.equal(executor.supportsScript, true, 'ssh 执行器必须声明 supportsScript === true');
      assert.equal(executor.kind, 'ssh');
    });

    test('★ registry.resolve(sshServer) 返回的惰性代理也必须能读到 supportsScript === true', () => {
      // 这是文档漏掉的第 5 个改动点：run.js 在调用 run() 之前（真实执行器尚未惰性创建）
      // 就要据该标志决定是否传 script，因此代理上必须直接可读。
      const createExecutorRegistry = requiredFn(registryMod, 'createExecutorRegistry', REGISTRY_REL);
      const registry = createExecutorRegistry({ ctx: null, log: fakeLog(), provisioner: null, config: {} });
      const proxy = registry.resolve(sshServer());
      assert.equal(proxy.supportsScript, true, '惰性代理对象必须暴露 supportsScript === true');
      assert.equal(proxy.kind, 'ssh');
      assert.equal(registry.resolve(sshServer()).supportsScript, true, '同一 serverId 复用时能力标志必须保持');
    });

    test('★ local 执行器故意不声明 supportsScript（保证 local.js 零回归）', () => {
      const createExecutorRegistry = requiredFn(registryMod, 'createExecutorRegistry', REGISTRY_REL);
      const registry = createExecutorRegistry({ ctx: null, log: fakeLog(), provisioner: null, config: {} });
      const local = registry.resolve({ id: 'local', kind: 'local', host: '127.0.0.1' });
      assert.notEqual(local.supportsScript, true, 'local 执行器不得声明 supportsScript（否则会破坏既有本地路径）');
    });

    test('★ 门控：无 supportsScript 的执行器收不到 script/shell/scriptArgv，argv 永远转发且本地行为不变', async () => {
      const { executor, specs } = makeFakeExecutor({ kind: 'local', supportsScript: false });
      // 控制端平台上合法的解释器名（Windows 控制端上 bash 会按 FROZEN §7 明确报错，
      // 那是另一条用例的靶心；本条只守「脚本通道不转发」）。
      const localShell = process.platform === 'win32' ? 'cmd' : 'bash';
      const { res } = await runOneStep({
        executor,
        server: { id: 'local', name: '本机', kind: 'local', host: '127.0.0.1' },
        pipeline: singleStepPipeline({ serverId: 'local', withArgs: { script: 'echo hi', shell: localShell } }),
      });
      assert.equal(res.status, 'success', '本地步骤应成功，实际 ' + res.status);
      assert.equal(specs[0].script, undefined, '门控：无能力标志的执行器不得收到 script');
      assert.equal(specs[0].shell, undefined, '门控：无能力标志的执行器不得收到 shell');
      assert.equal(specs[0].scriptArgv, undefined, '门控：无能力标志的执行器不得收到 scriptArgv');
      assert.ok(Array.isArray(specs[0].argv) && specs[0].argv.length > 0, 'argv 必须永远转发');

      // local 的 argv 仍是控制端临时文件路径 —— 证明既有本地行为未被改动。
      assert.ok(
        specs[0].argv.some((a) => String(a).includes(CONTROLLER_TMP)),
        '本地脚本路径仍应落在控制端临时目录（既有行为），实际 ' + JSON.stringify(specs[0].argv),
      );
      if (process.platform === 'win32') {
        assert.ok(/cmd\.exe/i.test(specs[0].argv[0]), 'Windows 本地仍应产出 cmd.exe，实际 ' + JSON.stringify(specs[0].argv));
      }
    });
  });
});
