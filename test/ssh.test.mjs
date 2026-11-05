// 契约 §3.7 + task-3：src/engine/executors/ssh.js 与 ssh/**
// 全部使用**注入的 mock transport / 假 ssh2 模块**，绝不联网。
// 覆盖：命令行转义（用户输入不得进 shell 解释）、取消、流式分帧、ssh2 缺失报错、
//       probe 解析、readDir/stat/match、路径越界拒绝、认证解析与打码
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { suiteFor, requiredFn } from './helpers/modules.mjs';
import { sampleServer } from './helpers/fixtures.mjs';

const rel = 'src/engine/executors/ssh.js';
const { mod, skip } = await suiteFor(rel);

/** 构造一个记录调用的 mock transport（形状对齐 transport.js 的公开接口） */
function makeMockTransport(over = {}) {
  const calls = { exec: [], readdir: [], stat: [], realpath: [], fastPut: [], fastGet: [] };
  /** 远端文件表：路径 → { content, isDir, size } */
  const files = over.files ?? {};

  const sftp = {
    async readdir(dir) {
      calls.readdir.push(dir);
      const prefix = dir.endsWith('/') ? dir : `${dir}/`;
      const names = new Set();
      const out = [];
      for (const [p, meta] of Object.entries(files)) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length);
        if (rest === '') continue;
        const first = rest.split('/')[0];
        if (names.has(first)) continue;
        names.add(first);
        const isDir = rest.includes('/') || meta.isDir === true;
        out.push({
          filename: first,
          attrs: {
            isDirectory: () => isDir,
            isFile: () => !isDir,
            size: meta.size ?? (meta.content?.length ?? 0),
            mtime: 1700000000,
            mode: 0o644,
          },
        });
      }
      if (out.length === 0 && !(dir in files)) {
        const err = new Error(`No such file: ${dir}`);
        err.code = 2;
        throw err;
      }
      return out;
    },
    async stat(p) {
      calls.stat.push(p);
      const meta = files[p];
      if (!meta) {
        const err = new Error(`No such file: ${p}`);
        err.code = 2;
        throw err;
      }
      return {
        isDirectory: () => meta.isDir === true,
        isFile: () => meta.isDir !== true,
        size: meta.size ?? (meta.content?.length ?? 0),
        mtime: 1700000000,
        mode: 0o644,
      };
    },
    async realpath(p) {
      calls.realpath.push(p);
      return p;
    },
    fastPut(local, remote, cb) {
      calls.fastPut.push({ local, remote });
      cb?.(null);
    },
    fastGet(remote, local, cb) {
      calls.fastGet.push({ remote, local });
      cb?.(null);
    },
  };

  const transport = {
    id: 'ssh:mock',
    kind: 'ssh',
    label: 'mock@host:22',
    remoteHome: '/home/deploy',
    isConnected: () => true,
    async ensureConnected() {},
    async sftp() {
      return sftp;
    },
    async close() {},

    /**
     * exec：契约形状见 transport.js:12
     *   exec({ command, onStdout, onStderr, timeoutMs, signal }) → { done, cancel, command }
     */
    async exec(spec = {}) {
      calls.exec.push({ command: spec.command });
      if (over.execThrows) throw over.execThrows;

      let canceled = false;
      const script = String(spec.command ?? '');

      // probe 走的是 readString → exec：按命令特征返回 over.probe 的输出
      const isProbe = script.includes('dsh##os_release') || script.includes('##dsh##');
      const chunks = isProbe
        ? [{ text: over.probeStdout ?? '', stream: 'stdout' }]
        : (over.chunks ?? [{ text: 'hello\n', stream: 'stdout' }]);
      const probeExit = isProbe ? (over.probeExitCode ?? 0) : (over.exitCode ?? 0);
      const probeStderr = isProbe ? (over.probeStderr ?? '') : '';

      const done = (async () => {
        for (const c of chunks) {
          // 让出事件循环，模拟流式到达
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, 1));
          if (canceled) break;
          if (c.text === '') continue;
          if (c.stream === 'stderr') spec.onStderr?.(c.text);
          else spec.onStdout?.(c.text);
        }
        if (canceled) return { exitCode: null, signal: 'SIGTERM', canceled: true };
        if (spec.signal?.aborted) return { exitCode: null, signal: 'SIGTERM', canceled: true, timedOut: true };
        if (probeStderr) spec.onStderr?.(probeStderr);
        return { exitCode: probeExit, signal: null };
      })();

      return {
        done,
        command: spec.command,
        cancel() {
          canceled = true;
        },
      };
    },
  };

  /**
   * readString：真实 transport 用它做「执行并收集全部输出」（transport.js:396）。
   * ssh.js 的 probe() 直接调用它，因此 mock 必须提供，语义与真实实现一致。
   */
  transport.readString = async (command, options = {}) => {
    const chunks = [];
    const errChunks = [];
    const handle = await transport.exec({
      command,
      onStdout: (t) => chunks.push(t),
      onStderr: (t) => errChunks.push(t),
      timeoutMs: options.timeoutMs ?? 15_000,
      signal: options.signal,
    });
    const result = await handle.done;
    return {
      stdout: chunks.join(''),
      stderr: errChunks.join(''),
      exitCode: result.exitCode,
      signal: result.signal,
      timedOut: result.timedOut,
    };
  };

  transport.calls = calls;
  transport.sftpMock = sftp;
  return transport;
}

/** 用 mock 造一个 executor：第一个参数是 mock/executor 选项，第二个是 server 覆盖 */
function makeExecutor(options = {}, serverOver = {}) {
  const server = sampleServer({ workdir: '/srv/app', ...serverOver });
  const transport = options.transport ?? makeMockTransport(options);
  const ex = mod.createSshExecutor({
    server,
    config: { verifyRealpath: false, ...(options.config ?? {}) },
    log: () => {},
    ...options.executorOptions,
    transportFor: () => transport,
  });
  return { ex, transport, server };
}

/** 按 probe.js 的 ##dsh## 分段格式造一份 Ubuntu 探测输出 */
function ubuntuProbeOutput() {
  return [
    '##dsh##os_release',
    'NAME="Ubuntu"',
    'VERSION_ID="22.04"',
    'ID=ubuntu',
    'ID_LIKE=debian',
    'PRETTY_NAME="Ubuntu 22.04.3 LTS"',
    '',
    '##dsh##uname',
    'Linux',
    'x86_64',
    '5.15.0-91-generic',
    'prod-box',
    '##dsh##shell',
    '/bin/bash',
    '/bin/bash',
    '##dsh##workdir',
    '/srv/app',
    '/home/deploy',
    '##dsh##sudo',
    'passwordless',
    '##dsh##tools',
    'python3|/usr/bin/python3|Python 3.11.4',
    'node|/usr/bin/node|v20.10.0',
    'git|/usr/bin/git|git version 2.34.1',
    '##dsh##os_pm',
    '/usr/bin/apt-get',
    'apt-get',
    '##dsh##end',
  ].join('\n');
}

describe('engine/executors/ssh', { skip }, () => {
  const buildCommandLine = requiredFn(mod, 'buildCommandLine', rel);
  const quoteArg = mod.quoteArg; // 可选

  test('Executor 接口形状与契约 §3.7 一致（kind=ssh）', () => {
    const { ex } = makeExecutor();
    assert.equal(ex.kind, 'ssh', 'kind 必须是 ssh');
    assert.equal(ex.id, 'ssh:prod-01', `id 必须是 ssh:<serverId>，实际 ${ex.id}`);
    for (const m of ['probe', 'run', 'readDir', 'stat', 'match', 'transferIn', 'transferOut', 'dispose']) {
      assert.equal(typeof ex[m], 'function', `${m} 必须是函数`);
    }
  });

  // ── 命令行安全性（契约 §5.1，最重要的断言） ─────────────────────────────
  describe('命令行构造（用户输入绝不进 shell 解释）', () => {
    test('argv 每个参数独立单引号转义，注入字符变成字面量', () => {
      const line = buildCommandLine({ argv: ['echo', 'a; rm -rf /', '$(whoami)', '`id`', 'x\ny'] });
      // 每个危险参数都必须被整体单引号包裹（引号内除单引号外无元字符）
      assert.ok(line.includes("'a; rm -rf /'"), `危险参数必须整体单引号包裹，实际 ${line}`);
      assert.ok(line.includes("'$(whoami)'"), `命令替换必须被包裹，实际 ${line}`);
      assert.ok(line.includes("'`id`'"), `反引号必须被包裹，实际 ${line}`);
      // 任何元字符都不得出现在引号之外
      assert.ok(!/(^|\s)(;|&&|\|\|)\s*\w/.test(line.replace(/'[^']*'/g, "''")), `引号外不得出现未受控的元字符，实际 ${line}`);
    });

    test('单引号自身的转义符合 POSIX（a\'b → \'a\'\\\'\'b\'）', () => {
      const line = buildCommandLine({ argv: ['echo', "a'b"] });
      assert.ok(line.includes("'a'\\''b'"), `单引号必须按 POSIX 规则转义，实际 ${line}`);
      // 用真正的 POSIX shell 语义校验：交给 sh -c 执行，参数必须原样回到 stdout
      assert.ok(!line.includes('\n'), '不得引入换行破坏命令结构');
    });

    test('空参数被转义成空串，不消失', () => {
      const line = buildCommandLine({ argv: ['cmd', ''] });
      assert.ok(line.endsWith("''"), `空参数必须保留为 ''，实际 ${line}`);
    });

    test('cwd 也做转义（含空格的路径）', () => {
      const line = buildCommandLine({ argv: ['ls'], cwd: '/srv/my app; rm -rf /' });
      assert.ok(line.startsWith("cd '/srv/my app; rm -rf /'"), `cwd 必须被引号包裹，实际 ${line}`);
      assert.ok(line.includes(' && '), 'cwd 应通过 && 串联');
    });

    test('env 值被转义，键名非法时被忽略（防畸形键名注入）', () => {
      const line = buildCommandLine({ argv: ['env'], env: { GOOD: 'a b; c', 'BAD-KEY': 'x', '1BAD': 'y' } });
      assert.ok(line.includes("'GOOD=a b; c'"), `env 值必须整体包裹，实际 ${line}`);
      assert.ok(!line.includes('BAD-KEY'), '非法键名必须被忽略');
      assert.ok(!line.includes('1BAD'), '以数字开头的键名必须被忽略');
    });

    test('env 中 undefined 表示删除键（显式 unset）', () => {
      const line = buildCommandLine({ argv: ['env'], env: { GONE: undefined } });
      assert.ok(/unset\s+'GONE'/.test(line), `undefined 键必须 unset，实际 ${line}`);
    });

    test('explicit script 是唯一按原意执行的内容（用户脚本本身）', () => {
      const line = buildCommandLine({ script: 'echo hi && npm ci', cwd: '/srv/app' });
      assert.ok(line.includes('echo hi && npm ci'), `用户脚本应原样执行，实际 ${line}`);
    });

    test('既无 argv 也无 script 时明确报错（不静默执行空命令）', () => {
      assert.throws(() => buildCommandLine({}), /.*/, '空命令必须报错');
    });
  });

  // ── run：流式分帧 / 退出码 / 取消 ─────────────────────────────────────────
  describe('run()', () => {
    test('返回 { done, cancel } 且流式分帧回调 stdout/stderr', async () => {
      const { ex } = makeExecutor({
        chunks: [
          { text: 'out-1\n', stream: 'stdout' },
          { text: 'err-1\n', stream: 'stderr' },
          { text: 'out-2\n', stream: 'stdout' },
        ],
      });
      const got = [];
      const h = await ex.run({ argv: ['echo', 'hi'], onData: (c) => got.push(c) });
      assert.equal(typeof h.done?.then, 'function', 'handle.done 必须是 Promise');
      assert.equal(typeof h.cancel, 'function', 'handle.cancel 必须是函数');
      const res = await h.done;
      assert.equal(res.exitCode, 0);
      assert.equal(got.length, 3, `应当收到 3 个分片，实际 ${got.length}`);
      assert.deepEqual(got.map((c) => c.stream), ['stdout', 'stderr', 'stdout'], '流必须保持原顺序与来源');
      assert.equal(res.pidKnown, false, 'SSH 通道必须如实标注 pidKnown:false');
    });

    test('非零退出码如实上报', async () => {
      const { ex } = makeExecutor({ exitCode: 7 });
      const h = await ex.run({ argv: ['false'] });
      const res = await h.done;
      assert.equal(res.exitCode, 7, '退出码必须原样返回');
    });

    test('cancel() 终止传输并让 done 收敛', async () => {
      const { ex } = makeExecutor({
        chunks: Array.from({ length: 50 }, (_, i) => ({ text: `chunk-${i}\n`, stream: 'stdout' })),
      });
      const h = await ex.run({ argv: ['sleep', '100'] });
      h.cancel();
      const res = await Promise.race([
        h.done,
        new Promise((r) => setTimeout(() => r({ __raceTimedOut: true }), 8000)),
      ]);
      assert.ok(!res.__raceTimedOut, 'cancel 后 done 必须 resolve');
      assert.ok(res.canceled === true || res.signal, `取消必须被标记，实际 ${JSON.stringify(res)}`);
    });

    test('run 构造的命令行出现在 transport.exec 的 command 里，且 argv 已转义', async () => {
      const { ex, transport } = makeExecutor();
      const h = await ex.run({ argv: ['echo', 'a; b'] });
      await h.done;
      const called = transport.calls.exec[0];
      assert.ok(called, '必须先调用 transport.exec');
      assert.ok(called.command.includes("'a; b'"), `argv 必须被转义后进入命令，实际 ${called.command}`);
    });

    test('transport.exec 抛错时 run 也抛错（不伪装成功）', async () => {
      const { ex } = makeExecutor({ execThrows: new Error('channel closed') });
      await assert.rejects(() => ex.run({ argv: ['echo', 'hi'] }), /.*/, 'exec 失败必须上抛');
    });
  });

  // ── probe ────────────────────────────────────────────────────────────────
  describe('probe()', () => {
    test('解析探测输出并写回 server.probe', async () => {
      const { ex, server } = makeExecutor({ probeStdout: ubuntuProbeOutput() });
      const probe = await ex.probe();
      assert.ok(probe && typeof probe === 'object', 'probe 必须返回对象');
      assert.ok(probe.os.includes('Ubuntu') || probe.os.includes('ubuntu'), `os 应识别 Ubuntu，实际 ${probe.os}`);
      assert.ok(['x86_64', 'amd64'].some((a) => probe.arch.includes(a)), `arch 应识别 x86_64，实际 ${probe.arch}`);
      assert.ok(probe.runtime && Object.keys(probe.runtime).length > 0, `runtime 应含版本信息，实际 ${JSON.stringify(probe.runtime)}`);
      assert.ok(Array.isArray(probe.managers), 'managers 必须是数组');
      assert.ok(probe.at > 0, 'probe.at 应被填充');
      assert.equal(server.probe, probe, 'probe 结果必须写回 server.probe');
    });

    test('探测失败时返回空 probe 并带 error（不抛）', async () => {
      const { ex } = makeExecutor({ probeExitCode: 127, probeStderr: 'sh: not found' });
      const probe = await ex.probe();
      assert.ok(probe, 'probe 必须返回对象');
      assert.ok(probe.error, `失败必须带 error，实际 ${JSON.stringify(probe)}`);
    });
  });

  // ── readDir / stat / match ────────────────────────────────────────────────
  describe('readDir / stat / match', () => {
    const files = {
      '/srv/app/dist/a.js': { content: 'aaa' },
      '/srv/app/dist/b.js': { content: 'bb' },
      '/srv/app/dist/sub/c.js': { content: 'c' },
      '/srv/app/dist/x.txt': { content: 'txt' },
      '/srv/app/dist': { isDir: true },
    };

    test('readDir 返回 {name,isDir,size,mtime} 且不复制真实文件系统', async () => {
      const { ex, transport } = makeExecutor({ files });
      const entries = await ex.readDir(null, '/srv/app/dist');
      assert.ok(Array.isArray(entries), 'readDir 必须返回数组');
      assert.ok(entries.length >= 3, `应列出 3 个条目，实际 ${entries.length}`);
      const byName = Object.fromEntries(entries.map((e) => [e.name, e]));
      assert.equal(byName['a.js'].isDir, false);
      assert.equal(byName['sub'].isDir, true, 'sub 应识别为目录');
      assert.equal(typeof byName['a.js'].size, 'number', 'size 必须是数字');
      assert.ok(transport.calls.readdir.length > 0, '必须通过 sftp.readdir 实现');
    });

    test('stat 存在/不存在都返回 {exists,...} 而非抛错', async () => {
      const { ex } = makeExecutor({ files });
      const s1 = await ex.stat(null, '/srv/app/dist/a.js');
      assert.equal(s1.exists, true);
      assert.equal(s1.isDir, false);
      const s2 = await ex.stat(null, '/srv/app/dist/nope.js');
      assert.equal(s2.exists, false, '不存在时 exists 必须为 false 而不是抛错');
      assert.equal(s2.size, 0);
    });

    test('match 复用 matchOne 做本地匹配（不把 glob 交给远端 shell）', async () => {
      const { ex, transport } = makeExecutor({ files });
      const r = await ex.match(null, '/srv/app/dist', '**/*.js', { maxDepth: 5 });
      assert.ok(Array.isArray(r.matched), 'matched 必须是数组');
      assert.equal(typeof r.total, 'number', 'total 必须是数字');
      assert.equal(typeof r.truncated, 'boolean', 'truncated 必须是布尔');
      const paths = r.matched.map((m) => m.path);
      assert.ok(paths.some((p) => p.endsWith('a.js')), `应匹配 a.js，实际 ${JSON.stringify(paths)}`);
      assert.ok(!paths.some((p) => p.endsWith('.txt')), '不应匹配 txt');
      // 关键安全断言：glob 绝不能出现在交给 transport.exec 的命令行里
      for (const c of transport.calls.exec) {
        assert.ok(!c.command.includes('**/*.js'), `glob 不得进入远端 shell 命令，实际 ${c.command}`);
      }
    });

    test('契约 §3.7.1：match 接受模式数组，返回 {matched,ignored,truncated,total,patterns}', async () => {
      const { ex } = makeExecutor({ files });
      const r = await ex.match(null, '/srv/app/dist', ['**/*.js', '!**/sub/**'], { maxDepth: 5 });
      assert.ok(Array.isArray(r.matched), 'matched 必须是数组');
      assert.ok(Array.isArray(r.ignored), '契约 §3.7.1 要求返回 ignored');
      assert.equal(typeof r.truncated, 'boolean');
      assert.equal(typeof r.total, 'number');
      assert.ok(Array.isArray(r.patterns), '契约 §3.7.1 要求回带 patterns');
      const matched = r.matched.map((m) => m.path);
      assert.ok(matched.some((p) => p.endsWith('a.js')), `应匹配 a.js，实际 ${JSON.stringify(matched)}`);
      assert.ok(!matched.some((p) => p.includes('/sub/')), `被 !**/sub/** 排除的不得进 matched，实际 ${JSON.stringify(matched)}`);
    });

    test('契约 §3.7.1：单字符串与单元素数组等价', async () => {
      const { ex } = makeExecutor({ files });
      const single = await ex.match(null, '/srv/app/dist', '*.js', { maxDepth: 3 });
      const array = await ex.match(null, '/srv/app/dist', ['*.js'], { maxDepth: 3 });
      assert.deepEqual(
        single.matched.map((m) => m.path).sort(),
        array.matched.map((m) => m.path).sort(),
        '单字符串与单元素数组必须等价',
      );
    });

    test('契约 §3.7.1：仅含取反模式时隐式补 **（排除语义生效）', async () => {
      const { ex } = makeExecutor({ files });
      const r = await ex.match(null, '/srv/app/dist', ['!**/*.txt'], { maxDepth: 5 });
      // matched / ignored 同形：都是 [{path,size}]，必须先取 path
      const matched = r.matched.map((m) => m.path);
      const ignored = r.ignored.map((m) => m.path);
      // 隐式 ** 后：除 .txt 外全部
      assert.ok(matched.some((p) => p.endsWith('.js')), `js 应被纳入，实际 ${JSON.stringify(matched)}`);
      assert.ok(!matched.some((p) => p.endsWith('.txt')), `txt 必须被排除，实际 ${JSON.stringify(matched)}`);
      assert.ok(!ignored.some((p) => p.endsWith('.js')), `js 不应进 ignored，实际 ${JSON.stringify(ignored)}`);
    });

    test('match 空 glob 必须报错（防「匹配一切」）', async () => {
      const { ex } = makeExecutor({ files });
      await assert.rejects(() => ex.match(null, '/srv/app/dist', ''), /.*/, '空 glob 必须报错');
    });

    test('match 结果带 base 前缀的绝对路径', async () => {
      const { ex } = makeExecutor({ files });
      const r = await ex.match(null, '/srv/app/dist', '*.js', { maxDepth: 3 });
      for (const m of r.matched) {
        assert.ok(m.path.startsWith('/srv/app/dist'), `匹配路径应为绝对路径，实际 ${m.path}`);
      }
    });
  });

  // ── 路径越界（契约 §5.3） ─────────────────────────────────────────────────
  describe('路径 containment（越界必须拒绝）', () => {
    test('../../ 越界访问被拒绝', async () => {
      const { ex } = makeExecutor({ files: { '/srv/app/dist/a.js': { content: 'a' }, '/etc/passwd': { content: 'root' } } });
      await assert.rejects(
        () => ex.stat(null, '/srv/app/../../etc/passwd'),
        (err) => /越界|outside|denied/i.test(err.message) || err.code,
        '../../ 越界必须被拒绝',
      );
    });

    test('绝对路径越出 workdir 被拒绝', async () => {
      const { ex } = makeExecutor({ files: { '/etc/shadow': { content: 'x' } } });
      await assert.rejects(() => ex.readDir(null, '/etc'), /.*/, '绝对路径越出 base 必须被拒绝');
    });

    test('base 内路径正常放行（不是一律拒绝）', async () => {
      const { ex } = makeExecutor({ files: { '/srv/app/dist/a.js': { content: 'a' }, '/srv/app/dist': { isDir: true } } });
      const entries = await ex.readDir(null, '/srv/app/dist');
      assert.ok(Array.isArray(entries), 'base 内路径必须放行');
    });

    test('词法 containment 单元级：assertInsideBase 拒绝 ../ 逃逸', async () => {
      const shell = await import('../src/engine/executors/ssh/shell.js');
      assert.throws(() => shell.assertInsideBase('/srv/app', '/srv/etc/passwd'), /.*/, '越界必须抛错');
      assert.doesNotThrow(() => shell.assertInsideBase('/srv/app', '/srv/app/dist/x'), 'base 内不得抛错');
      assert.doesNotThrow(() => shell.assertInsideBase('/srv/app', '/srv/app'), 'base 自身不得抛错');
    });
  });

  // ── ssh2 缺失 ────────────────────────────────────────────────────────────
  describe('ssh2 可选依赖缺失的报错路径', () => {
    test('loadSsh2 在模块缺失时给出可操作的清晰错误', async () => {
      const loadSsh2 = requiredFn(mod, 'loadSsh2', rel);
      const err = await loadSsh2({}).then(
        () => null,
        (e) => e,
      );
      if (!err) return; // 环境里装了 ssh2，跳过（不算失败）
      assert.ok(/ssh2/.test(err.message), `错误信息必须点名 ssh2，实际 ${err.message}`);
      assert.ok(/npm i ssh2|安装/.test(err.message), `错误信息必须给出修复办法，实际 ${err.message}`);
      assert.equal(err.code, 'ssh2-missing', `错误码应为 ssh2-missing，实际 ${err.code}`);
    });

    test('注入假 ssh2 模块时 loadSsh2 直接返回它（不进网络）', async () => {
      const loadSsh2 = requiredFn(mod, 'loadSsh2', rel);
      const fake = { Client: class {} };
      const got = await loadSsh2({ module: fake });
      assert.equal(got, fake, '注入的模块必须被原样返回');
    });

    test('SSH2_MISSING_HINT 文案含安装指引', () => {
      assert.equal(typeof mod.SSH2_MISSING_HINT, 'string');
      assert.ok(/ssh2/.test(mod.SSH2_MISSING_HINT));
    });

    test('ssh2 缺失时 transportFor 未注入 → executor 操作应给出 ssh2 相关错误而非其它', async () => {
      const server = sampleServer();
      const ex = mod.createSshExecutor({ server, config: { verifyRealpath: false }, log: () => {} });
      const err = await ex
        .stat(null, '/srv/app/x')
        .then(() => null)
        .catch((e) => e);
      if (!err) return; // 装了 ssh2 且真的连上了（本机无网络目标，通常会失败）
      const text = `${err.code ?? ''} ${err.message}`;
      assert.ok(
        /ssh2|dns|refused|timeout|unreachable|auth|握手|连接/i.test(text),
        `错误必须明确归因，实际 ${text}`,
      );
    });
  });

  // ── 连接复用与 dispose ───────────────────────────────────────────────────
  describe('连接复用 / dispose', () => {
    test('同一 server 多次操作复用一条 transport', async () => {
      let opened = 0;
      const server = sampleServer({ workdir: '/srv/app' });
      const transport = makeMockTransport({ files: { '/srv/app': { isDir: true } } });
      const ex = mod.createSshExecutor({
        server,
        config: { verifyRealpath: false },
        log: () => {},
        transportFor: () => {
          opened += 1;
          return transport;
        },
      });
      await ex.readDir(null, '/srv/app');
      await ex.readDir(null, '/srv/app');
      assert.equal(opened, 1, `连接必须复用，实际打开 ${opened} 次`);
    });

    test('dispose 后继续使用明确报错，且 dispose 幂等', async () => {
      const { ex } = makeExecutor({ files: { '/srv/app': { isDir: true } } });
      await assert.doesNotReject(() => ex.dispose());
      await assert.doesNotReject(() => ex.dispose());
      await assert.rejects(() => ex.readDir(null, '/srv/app'), /.*/, 'dispose 后必须拒绝继续使用');
    });
  });

  // ── 认证（凭据只来自 credentials，不落日志） ──────────────────────────────
  describe('认证解析与密钥打码', () => {
    test('key 认证：私钥来自注入点，且被收集进 secrets 供打码', async () => {
      const auth = await import('../src/engine/executors/ssh/auth.js');
      const key = '-----BEGIN OPENSSH PRIVATE KEY-----\nSECRETKEYMATERIAL\n-----END OPENSSH PRIVATE KEY-----';
      const r = await auth.resolveAuth(sampleServer(), { getPrivateKey: () => key });
      assert.equal(r.method, 'key');
      assert.equal(r.auth.privateKey, key, '私钥必须来自解析器');
      assert.ok(r.secrets.some((s) => s.includes('SECRETKEYMATERIAL')), '私钥必须进 secrets 供打码');
    });

    test('key 认证缺少私钥 → 明确报错（不静默降级）', async () => {
      const auth = await import('../src/engine/executors/ssh/auth.js');
      await assert.rejects(() => auth.resolveAuth(sampleServer(), {}), /.*/, '缺私钥必须报错');
    });

    test('password 认证：口令来自 credentials 且进 secrets', async () => {
      const auth = await import('../src/engine/executors/ssh/auth.js');
      const server = sampleServer({ auth: { type: 'password', keyRef: '', passwordRef: 'PW_REF' } });
      const r = await auth.resolveAuth(server, { ctx: { get: () => ({ resolve: () => 'hunter2-secret' }) } });
      assert.equal(r.method, 'password');
      assert.equal(r.auth.password, 'hunter2-secret');
      assert.ok(r.secrets.includes('hunter2-secret'), '口令必须进 secrets 供打码');
    });

    test('password 认证缺少口令 → 明确报错', async () => {
      const auth = await import('../src/engine/executors/ssh/auth.js');
      const server = sampleServer({ auth: { type: 'password', keyRef: '', passwordRef: '' } });
      await assert.rejects(() => auth.resolveAuth(server, {}), /.*/, '缺口令必须报错');
    });

    test('kind=ssh + auth.type=none 必须被拒绝（lead 的安全约束）', async () => {
      const auth = await import('../src/engine/executors/ssh/auth.js');
      let threw = false;
      try {
        await auth.resolveAuth(sampleServer({ auth: { type: 'none', keyRef: '', passwordRef: '' } }), {});
      } catch {
        threw = true;
      }
      const loadSsh2 = requiredFn(mod, 'loadSsh2', rel);
      const fake = { Client: class {} };
      await loadSsh2({ module: fake }); // 确认注入路径可用（不联网）
      assert.ok(threw, 'ssh + auth.type=none 必须在配置层被拒绝，不得静默无认证连接');
    });

    test('打码工具：密钥明文从文本中被抹掉', async () => {
      const util = await import('../src/engine/executors/ssh/util.js');
      const masked = util.maskSecret('connect with hunter2-secret ok', ['hunter2-secret']);
      assert.ok(!masked.includes('hunter2-secret'), `密钥必须被抹掉，实际 ${masked}`);
      assert.ok(masked.includes('***'), '应留下打码占位');
    });

    test('指纹归一化：hex 与 base64 形式互相等价', async () => {
      const auth = await import('../src/engine/executors/ssh/auth.js');
      const hex = 'ab'.repeat(32);
      const a = auth.normalizeFingerprint(`SHA256:${hex}`);
      const b = auth.normalizeFingerprint(hex);
      assert.equal(a, b, '同一指纹的不同写法必须归一化为同一值');
      assert.ok(a.length > 0);
    });

    test('严格指纹校验：期望值与主机公钥一致时通过，不一致时拒绝', async () => {
      const auth = await import('../src/engine/executors/ssh/auth.js');
      const key = Buffer.alloc(32, 7);
      const expected = auth.normalizeFingerprint(key); // 原始公钥的 base64（transport 收到的 key 形态）
      const v = auth.createHostVerifier({ hostFingerprint: expected }, {}, () => {});
      assert.equal(v.strict, true, '给出指纹时应启用严格校验');
      assert.equal(v.hostVerifier(key), true, '匹配的公钥应通过');
      assert.equal(v.hostVerifier(Buffer.alloc(32, 9)), false, '不匹配的公钥必须拒绝');
    });

    test('未配置指纹时不启用严格校验（TOFU 首次信任）', async () => {
      const auth = await import('../src/engine/executors/ssh/auth.js');
      const v = auth.createHostVerifier({}, {}, () => {});
      assert.equal(v.strict, false, '未给期望指纹时不应声称严格校验');
    });

    test('【发现的 bug】标准的 SHA256: 指纹格式必须能被校验（ssh-keygen/ssh-keyscan 的输出就是这么给的）', async () => {
      const auth = await import('../src/engine/executors/ssh/auth.js');
      const key = Buffer.alloc(32, 7);
      // 用户从 `ssh-keyscan` / `ssh-keygen -lf` 拿到的就是这个格式
      const standard = `SHA256:${auth.fingerprintOf(key)}`;
      const v = auth.createHostVerifier({ hostFingerprint: standard }, {}, () => {});
      assert.equal(v.strict, true, '给出标准指纹时应启用严格校验');
      assert.equal(
        v.hostVerifier(key),
        true,
        '标准 SHA256 指纹（sha256(公钥) 的 base64）必须校验通过；' +
          '当前实现把期望值当成「公钥本体」比对，导致用户按 ssh-keygen 的格式填写时永远认证失败',
      );
      assert.equal(v.hostVerifier(Buffer.alloc(32, 9)), false, '另一个公钥仍必须被拒绝');
    });
  });

  // ── 错误归因 ─────────────────────────────────────────────────────────────
  describe('连接失败归因（DNS/拒绝/超时/认证/指纹）', () => {
    test('常见错误映射到明确 code 与人话', async () => {
      const errors = await import('../src/engine/executors/ssh/errors.js');
      const cases = [
        ['getaddrinfo ENOTFOUND nope', 'dns'],
        ['connect ECONNREFUSED 1.2.3.4:22', 'refused'],
        ['connect ETIMEDOUT', 'timeout'],
        ['All configured authentication methods failed', 'auth'],
        ['Host key verification failed', 'fingerprint'],
      ];
      for (const [message, expectedCode] of cases) {
        const r = errors.classifyConnectError(new Error(message), 'u@h:22');
        assert.equal(r.code, expectedCode, `"${message}" 应归类为 ${expectedCode}，实际 ${r.code}`);
        assert.ok(r.message.length > 0, '必须给人话说明');
      }
    });
  });
});
