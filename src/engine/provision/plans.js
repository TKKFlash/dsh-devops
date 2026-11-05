/**
 * 环境供给「方案」定义：把「缺什么」翻译成「按什么顺序尝试」。
 *
 * 契约 §3.8 的优先级：
 *   Python → uv python install → pyenv install → 发行版包（apt/yum/dnf/apk）
 *   Node   → nvm/fnm/mise → 系统 node
 *   依赖   → 系统包管理器
 *
 * 安全约束：
 * - 所有命令都表达为 **argv 数组**（契约 §5.1），用户提供的版本号先经 `assertVersionSpec`
 *   白名单校验，绝不直接拼进命令行字符串；
 * - 需要 shell 的方案（nvm/pyenv 是 shell 函数）用 `/bin/bash -lc <固定脚本>`，
 *   版本号作为**独立 argv 元素**通过位置参数传入，仍然不是字符串拼接；
 * - 只有 `allowInstall:true` 时才会真正执行安装方案。
 */
import { quoteArgv } from '../executors/ssh/shell.js';
import { SshError } from '../executors/ssh/errors.js';

/** 版本规格白名单：`3`、`3.11`、`3.11.9`、`20.11.1`（可选 lts 之类的词也仅在 node 场景用）。 */
const VERSION_RE = /^\d{1,4}(\.\d{1,4}){0,3}$/;

/**
 * 校验版本规格，防止把任意字符串塞进命令。
 * @param {string} value
 * @param {string} what
 */
export function assertVersionSpec(value, what = '运行时') {
  const s = String(value ?? '').trim();
  if (s === '') throw new SshError(`${what}版本号不能为空`, 'bad-version-spec');
  if (!VERSION_RE.test(s)) {
    throw new SshError(
      `${what}版本号「${s}」不合法：只允许形如 3、3.11、3.11.9 的纯数字版本。`,
      'bad-version-spec',
    );
  }
  return s;
}

/** 包名白名单（发行版包名允许字母数字与 . _ + - :）。 */
const PACKAGE_RE = /^[A-Za-z0-9][A-Za-z0-9._+:-]{0,99}$/;

/** 校验包名。 */
export function assertPackageName(value) {
  const s = String(value ?? '').trim();
  if (!PACKAGE_RE.test(s)) {
    throw new SshError(`包名「${s}」不合法`, 'bad-package-name');
  }
  return s;
}

/** 用 `command -v -- "$1"` 在 PATH 里找可执行文件，名字走位置参数（不拼接）。 */
export function whichArgv(name) {
  return ['/bin/sh', '-c', 'command -v -- "$1" 2>/dev/null || true', 'dsh-which', String(name)];
}

/** 把 argv 变成可展示的字符串。 */
export function displayCommand(argv) {
  if (!Array.isArray(argv)) return String(argv);
  return argv.map(quoteArgIfNeeded).join(' ');
}

/**
 * 「需要才转义」的展示用引号：token 只含安全字符时不加引号，保证建议命令可读、可复制。
 * 安全集合刻意排除一切 shell 元字符（空白、引号、$、`、;、|、&、>、<、(、)、*、?、~、\ 等），
 * 因此不加引号的 token 不可能被 shell 解释成别的东西。
 * 注意：这只用于**展示**；真正执行仍走 `quoteArgv()` 的无条件单引号转义。
 */
export function quoteArgIfNeeded(arg) {
  const s = arg == null ? '' : String(arg);
  if (s === '') return "''";
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(s) ? s : quoteArgv([s]);
}

/** 发行版家族 → 包管理器命令。 */
export const PACKAGE_MANAGERS = {
  debian: { cmd: 'apt-get', install: ['apt-get', 'install', '-y'], update: ['apt-get', 'update', '-y'], needsSudo: true },
  rhel: { cmd: 'dnf', install: ['dnf', 'install', '-y'], update: null, needsSudo: true, alternatives: ['yum'] },
  alpine: { cmd: 'apk', install: ['apk', 'add', '--no-cache'], update: null, needsSudo: true },
  suse: { cmd: 'zypper', install: ['zypper', '--non-interactive', 'install'], update: null, needsSudo: true },
  arch: { cmd: 'pacman', install: ['pacman', '-S', '--noconfirm'], update: null, needsSudo: true },
  darwin: { cmd: 'brew', install: ['brew', 'install'], update: null, needsSudo: false },
};

/**
 * 依据 probe 结果挑选包管理器。
 * @param {object} probe
 * @returns {{ family: string, manager: object|null }}
 */
export function pickPackageManager(probe = {}) {
  const managers = Array.isArray(probe.managers) ? probe.managers : [];
  const has = (name) => managers.includes(name);
  if (has('apt-get') || has('apt')) return { family: 'debian', manager: PACKAGE_MANAGERS.debian };
  if (has('dnf')) return { family: 'rhel', manager: PACKAGE_MANAGERS.rhel };
  if (has('yum')) {
    const m = { ...PACKAGE_MANAGERS.rhel, cmd: 'yum', install: ['yum', 'install', '-y'] };
    return { family: 'rhel', manager: m };
  }
  if (has('apk')) return { family: 'alpine', manager: PACKAGE_MANAGERS.alpine };
  if (has('zypper')) return { family: 'suse', manager: PACKAGE_MANAGERS.suse };
  if (has('pacman')) return { family: 'arch', manager: PACKAGE_MANAGERS.arch };
  if (has('brew')) return { family: 'darwin', manager: PACKAGE_MANAGERS.darwin };
  return { family: 'unknown', manager: null };
}

/**
 * 探测「某个解释器候选」的 argv：直接执行 `<candidate> --version`。
 * @param {string} candidate 绝对路径或 PATH 中的名字
 */
export function versionArgv(candidate) {
  return [String(candidate), '--version'];
}

/**
 * Python 候选解释器列表（按优先级）。
 * 这些是**只读探测**，不安装任何东西。
 *
 * @param {string} version 请求的版本（如 3.11）
 * @param {object} probe
 * @param {Record<string,string>} paths probe 里拿到的工具绝对路径
 */
export function pythonCandidates(version, probe = {}, paths = {}) {
  const out = [];
  const vm = version; // 3.11
  const major = vm.split('.')[0];
  const push = (candidate, source) => {
    if (candidate && !out.some((c) => c.candidate === candidate)) out.push({ candidate, source });
  };

  // 0) 已经探测到的 python/python3
  if (paths.python) push(paths.python, 'path:python');
  if (paths.python3) push(paths.python3, 'path:python3');
  // 1) 明确的带版本名字（兼容 python3.11 / python3 / python）
  push(`python${vm}`, 'path');
  if (major && major !== vm) push(`python${major}`, 'path');
  push('python3', 'path');
  push('python', 'path');
  // 2) uv 管理的解释器
  push(`uv-python-${vm}`, 'uv');
  // 3) 常见绝对路径（发行版/官方安装器）
  for (const p of [
    `/usr/bin/python${vm}`,
    `/usr/local/bin/python${vm}`,
    `/usr/bin/python${major}`,
    `/usr/bin/python3`,
    `/usr/local/bin/python3`,
    `$HOME/.local/bin/python${vm}`,
    `$HOME/.pyenv/versions/${vm}/bin/python`,
    `$HOME/.pyenv/shims/python`,
  ]) {
    push(p, 'abs');
  }
  return out;
}

/**
 * 生成 Python 的**安装**方案（仅在 allowInstall=true 时被执行）。
 * 返回方案数组，按契约优先级排序。
 *
 * @param {object} context
 * @param {string} context.version 3.11
 * @param {object} context.probe
 * @param {Record<string,string>} context.paths
 * @param {object} context.config
 */
export function pythonInstallPlans({ version, probe = {}, paths = {}, config = {} }) {
  /** @type {Array<object>} */
  const plans = [];
  const managers = Array.isArray(probe.managers) ? probe.managers : [];

  // —— 方案 1：uv（若已安装）——
  if (paths.uv || managers.includes('uv')) {
    plans.push({
      id: 'uv:install',
      kind: 'uv',
      label: `uv python install ${version}`,
      needsSudo: false,
      steps: [
        {
          argv: [paths.uv || 'uv', 'python', 'install', version],
          label: `uv python install ${version}`,
        },
      ],
      // uv 安装后即可用 `uv python find` 定位解释器
      resolveArgv: [paths.uv || 'uv', 'python', 'find', version],
    });
  }

  // —— 方案 2：pyenv（若已安装）——
  if (paths.pyenv || managers.includes('pyenv')) {
    plans.push({
      id: 'pyenv:install',
      kind: 'pyenv',
      label: `pyenv install ${version}`,
      needsSudo: false,
      steps: [
        // pyenv 也是 shell 函数，但存在同名可执行文件；优先直接调用可执行文件
        { argv: [paths.pyenv || 'pyenv', 'install', '-s', version], label: `pyenv install -s ${version}` },
      ],
      resolveArgv: [paths.pyenv || 'pyenv', 'which', 'python'],
    });
  }

  // —— 方案 3：发行版包管理器 ——
  const { family, manager } = pickPackageManager(probe);
  if (manager) {
    // 不同发行版对「带小版本的 python」包名不一致，按家族给出候选包名
    const pkgCandidates = [];
    if (family === 'debian') {
      pkgCandidates.push(`python${version}`, `python${version.split('.').slice(0, 2).join('.')}`, 'python3');
    } else if (family === 'alpine') {
      pkgCandidates.push(`python3`, `python${version.split('.')[0]}`);
    } else if (family === 'rhel') {
      pkgCandidates.push(`python${version.split('.')[0]}`, 'python3');
    } else {
      pkgCandidates.push('python3', `python${version.split('.')[0]}`);
    }
    for (const pkg of [...new Set(pkgCandidates)]) {
      plans.push({
        id: `distro:${pkg}`,
        kind: 'package',
        label: `${manager.cmd} 安装 ${pkg}`,
        needsSudo: manager.needsSudo,
        package: pkg,
        family,
        steps: [
          ...(manager.update ? [{ argv: manager.update, label: `${manager.cmd} update`, needsSudo: manager.needsSudo, optional: true }] : []),
          { argv: [...manager.install, pkg], label: `${manager.cmd} install ${pkg}`, needsSudo: manager.needsSudo },
        ],
      });
    }
  }

  // —— 方案 4（默认关闭）：远端安装脚本 uv ——
  // `curl | sh` 会执行远端任意脚本，属于高危动作，必须显式开启才允许。
  if (config.allowRemoteInstallerScripts === true) {
    plans.push({
      id: 'uv:bootstrap',
      kind: 'installer-script',
      label: '用官方脚本安装 uv（高危：执行远程脚本）',
      needsSudo: false,
      highRisk: true,
      steps: [
        {
          argv: ['/bin/sh', '-c', 'curl -LsSf https://astral.sh/uv/install.sh | sh'],
          label: '安装 uv',
        },
      ],
      resolveArgv: ['$HOME/.local/bin/uv', 'python', 'find', version],
    });
  }

  return plans;
}

/**
 * Node 的安装方案：nvm / fnm / mise → 系统 node。
 * @param {object} context
 */
export function nodeInstallPlans({ version, probe = {}, paths = {}, config = {} }) {
  const plans = [];
  const managers = Array.isArray(probe.managers) ? probe.managers : [];
  const major = String(version).split('.')[0];

  // nvm 是 shell 函数，必须经 bash -lc；版本号走位置参数（$1），不是字符串拼接
  if (managers.includes('nvm')) {
    plans.push({
      id: 'nvm:install',
      kind: 'nvm',
      label: `nvm install ${version}`,
      needsSudo: false,
      steps: [
        {
          argv: [
            '/bin/bash',
            '-lc',
            'export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"; nvm install "$1" >/dev/null && nvm which "$1"',
            'dsh-nvm',
            version,
          ],
          label: `nvm install ${version}`,
        },
      ],
      capturePath: true,
    });
  }
  if (paths.fnm || managers.includes('fnm')) {
    plans.push({
      id: 'fnm:install',
      kind: 'fnm',
      label: `fnm install ${version}`,
      needsSudo: false,
      steps: [
        { argv: [paths.fnm || 'fnm', 'install', version], label: `fnm install ${version}` },
      ],
      resolveArgv: [paths.fnm || 'fnm', 'exec', '--using', version, '--', 'node', '-e', 'process.stdout.write(process.execPath)'],
    });
  }
  if (paths.mise || managers.includes('mise')) {
    plans.push({
      id: 'mise:install',
      kind: 'mise',
      label: `mise install node@${version}`,
      needsSudo: false,
      steps: [
        { argv: [paths.mise || 'mise', 'install', `node@${version}`], label: `mise install node@${version}` },
      ],
      resolveArgv: [paths.mise || 'mise', 'which', 'node'],
    });
  }

  const { family, manager } = pickPackageManager(probe);
  if (manager) {
    const pkg = family === 'alpine' ? 'nodejs' : family === 'darwin' ? 'node' : 'nodejs';
    plans.push({
      id: `distro:${pkg}`,
      kind: 'package',
      label: `${manager.cmd} 安装 ${pkg}`,
      needsSudo: manager.needsSudo,
      package: pkg,
      family,
      steps: [{ argv: [...manager.install, pkg], label: `${manager.cmd} install ${pkg}`, needsSudo: manager.needsSudo }],
    });
  } else if (major) {
    // 兜底：NodeSource（仅 debian/rhel），同样只在显式允许时出现
    plans.push({
      id: 'nodesource:setup',
      kind: 'installer-script',
      label: `NodeSource 安装 Node ${major}（高危：执行远程脚本）`,
      needsSudo: true,
      highRisk: true,
      steps: [
        {
          argv: ['/bin/sh', '-c', `curl -fsSL https://deb.nodesource.com/setup_${major}.x | bash - && apt-get install -y nodejs`],
          label: `NodeSource setup_${major}.x`,
        },
      ],
      disabledReason: '需要 allowRemoteInstallerScripts 显式开启',
      requiresConfig: 'allowRemoteInstallerScripts',
    });
  }
  return plans;
}

/** 依赖包的安装方案（系统包管理器）。 */
export function packageInstallPlans({ packages = [], probe = {} }) {
  const { family, manager } = pickPackageManager(probe);
  if (!manager) return [];
  return packages.map((pkg) => ({
    id: `pkg:${pkg}`,
    kind: 'package',
    label: `${manager.cmd} 安装 ${pkg}`,
    needsSudo: manager.needsSudo,
    package: pkg,
    family,
    steps: [{ argv: [...manager.install, pkg], label: `${manager.cmd} install ${pkg}`, needsSudo: manager.needsSudo }],
  }));
}

/**
 * 组装「可照做」的建议文本（allowInstall=false 时的核心交付物）。
 *
 * 会尽量列出**多个**可用方案（而不是只给第一个），因为用户环境各异：
 * 主方案可能需要 sudo 或额外配置，备选方案往往才是真正能照做的那条。
 *
 * @param {object} context
 * @param {Array<{key:string,label:string,plans:object[]}>} context.missing
 * @param {object} context.probe
 * @param {object} [context.server]
 * @param {object} [context.config] 用于判断需要显式开启的高危方案是否可用
 * @param {number} [context.maxPlans] 每项最多列几个方案
 * @returns {string}
 */
export function buildSuggestion({ missing = [], probe = {}, server = {}, config = {}, maxPlans = 3 }) {
  const lines = [];
  const host = server.name || server.id || '远端服务器';
  lines.push(`${host} 上缺少运行所需组件，当前未开启自动安装（allowInstall=false）。`);
  if (probe.os) {
    const sudoHint =
      probe.sudo === 'passwordless'
        ? '（免密 sudo 可用）'
        : probe.sudo === 'password'
          ? '（sudo 需要密码，需要 sudo 的方案无法非交互执行）'
          : '';
    lines.push(`已探测环境：${probe.os}${probe.arch ? ` / ${probe.arch}` : ''}${sudoHint}`);
  }
  lines.push('');
  lines.push('可选做法（任选其一）：');

  for (const item of missing) {
    lines.push(`· 缺少 ${item.label}`);

    // 过滤掉「当前配置下不可用」的方案，剩下的按优先级展示
    const usable = (item.plans || []).filter((plan) => {
      if (plan.requiresConfig && config[plan.requiresConfig] !== true) return false;
      return true;
    });

    if (usable.length === 0) {
      const blocked = (item.plans || [])[0];
      if (blocked?.requiresConfig) {
        lines.push(`    当前环境下没有已启用的自动化方案（方案 ${blocked.id} 需要 ${blocked.requiresConfig}=true）。`);
      } else {
        lines.push('    当前环境下没有可用的自动化方案，请手动安装后重新探测。');
      }
      lines.push('    手动安装完成后，在服务器页点「测试连接」即可刷新探测结果。');
      continue;
    }

    let shown = 0;
    for (const plan of usable) {
      if (shown >= maxPlans) break;
      const sudoUnavailable = plan.needsSudo && probe.sudo !== 'passwordless';
      const planCommands = plan.steps
        .filter((step) => !step.optional)
        .map((step) => `${(step.needsSudo ?? plan.needsSudo) ? 'sudo ' : ''}${displayCommand(step.argv)}`);
      if (planCommands.length === 0) continue;
      lines.push(`    ${planCommands.join('\n    ')}`);
      if (plan.highRisk) lines.push('      （注意：该方案会执行远程脚本，请先自行确认脚本内容）');
      if (sudoUnavailable) lines.push('      （该方案需要 sudo，请先在远端配置免密 sudo，或手动以 root 执行）');
      shown += 1;
    }
    if (shown === 0) lines.push('    当前环境下没有可用的自动化方案，请手动安装后重新探测。');
  }

  lines.push('');
  lines.push(
    '或在服务器设置中把 allowProvision 设为 true，并允许本插件执行安装（allowInstall=true），由插件按上述顺序自动尝试。',
  );
  return lines.join('\n');
}

/** 把「缺失项」整理成稳定的报告结构（供 actions/suggestion 复用）。 */
export function describeMissing(missing = []) {
  return missing.map((m) => ({
    key: m.key,
    label: m.label,
    plans: (m.plans || []).map((p) => ({ id: p.id, label: p.label, steps: p.steps.map((s) => displayCommand(s.argv)) })),
  }));
}
