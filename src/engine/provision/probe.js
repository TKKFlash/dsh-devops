/**
 * 远端环境探测：脚本构造 + 输出解析。
 *
 * 解析函数全部是**纯函数**，输入是远端命令的原始字符串样本，
 * 因此 verifier 可以拿 Ubuntu / Debian / CentOS / Alpine / macOS 等样本直接断言，
 * 不需要真实 SSH。
 *
 * 探测结果形状严格按契约 §2.3 的 `server.probe`：
 *   { at, os, arch, shell, workdir, runtime:{}, managers:[], sudo, error }
 */
import { nonEmptyLines } from '../executors/ssh/util.js';

/** 探测结果的空形状（error 为空表示成功）。 */
export function emptyProbe(error = '') {
  return {
    at: Date.now(),
    os: '',
    arch: '',
    shell: '',
    workdir: '',
    runtime: {},
    managers: [],
    sudo: 'none',
    error,
  };
}

/** 各段落标记。解析时以标记切分，避免不同发行版输出顺序差异导致错位。 */
const MARK = '##dsh##';

/**
 * 构造探测脚本。
 * 只用 POSIX sh 语法（不依赖 bash），所有命令都带 2>/dev/null 与失败兜底，
 * 因此即使某一项不存在也不会中断整体探测。
 */
export function buildProbeScript() {
  return [
    'set +e',
    `echo "${MARK}os_release"`,
    'cat /etc/os-release 2>/dev/null || cat /usr/lib/os-release 2>/dev/null || echo ""',
    'echo ""',
    `echo "${MARK}uname"`,
    'uname -s 2>/dev/null; uname -m 2>/dev/null; uname -r 2>/dev/null; uname -n 2>/dev/null',
    `echo "${MARK}shell"`,
    'printf "%s\\n" "${SHELL:-}"',
    'printf "%s\\n" "$0"',
    `echo "${MARK}workdir"`,
    'pwd -P 2>/dev/null || pwd 2>/dev/null',
    'printf "%s\\n" "$HOME"',
    `echo "${MARK}sudo"`,
    'if [ "$(id -u 2>/dev/null)" = "0" ]; then echo root; elif sudo -n true 2>/dev/null; then echo passwordless; elif command -v sudo >/dev/null 2>&1; then echo password; else echo none; fi',
    `echo "${MARK}tools"`,
    // 只输出「存在且有可执行路径」的工具；格式 name|path|version
    'for c in uv pyenv nvm fnm mise node npm npx pnpm yarn python python3 pip pip3 pipx git curl wget docker tar unzip make gcc; do',
    '  p=$(command -v "$c" 2>/dev/null) || continue',
    '  v=$("$c" --version 2>&1 | head -n 1)',
    '  case "$v" in *"command not found"*) v="" ;; esac',
    '  printf "%s|%s|%s\\n" "$c" "$p" "$v"',
    'done',
    `echo "${MARK}os_pm"`,
    'for m in apt-get apt yum dnf apk zypper pacman brew port; do command -v "$m" 2>/dev/null && echo "$m"; done',
    `echo "${MARK}end"`,
  ].join('\n');
}

/**
 * 解析 `key=value` 形式（/etc/os-release）。
 * 处理引号、注释、转义；忽略重复键的后者以外的噪声。
 *
 * @param {string} text
 * @returns {Record<string,string>}
 */
export function parseOsRelease(text) {
  const out = {};
  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    value = value.replace(/\\(["'\\$`])/g, '$1');
    out[key] = value;
  }
  return out;
}

/** 发行版 id / id_like → 包管理器家族。 */
export function detectOsFamily(id, idLike) {
  const tokens = `${id} ${idLike}`.toLowerCase().split(/\s+/).filter(Boolean);
  /** @type {[string, string[]][]} */
  const table = [
    ['debian', ['debian', 'ubuntu', 'linuxmint', 'kali', 'raspbian', 'pop', 'elementary', 'deepin', 'zorin']],
    ['rhel', ['rhel', 'centos', 'fedora', 'rocky', 'almalinux', 'ol', 'amzn', 'scientific', 'cloudlinux']],
    ['alpine', ['alpine']],
    ['suse', ['suse', 'opensuse', 'sles', 'opensuse-leap', 'opensuse-tumbleweed']],
    ['arch', ['arch', 'manjaro', 'endeavouros', 'garuda']],
    ['gentoo', ['gentoo', 'funtoo']],
    ['darwin', ['darwin', 'macos']],
    ['bsd', ['freebsd', 'openbsd', 'netbsd']],
  ];
  for (const [family, ids] of table) {
    if (tokens.some((token) => ids.includes(token))) return family;
  }
  return 'unknown';
}

/**
 * 解析 os-release 成人类可读的 os 字符串 + 家族信息。
 * 缺 /etc/os-release 时回退到 uname（见 composeProbe）。
 *
 * @param {string} text
 * @returns {{ os: string, family: string, id: string, version: string, pretty: string }}
 */
export function parseOs(text) {
  const kv = parseOsRelease(text);
  const id = (kv.ID || '').toLowerCase();
  const idLike = (kv.ID_LIKE || '').toLowerCase();
  const version = kv.VERSION_ID || kv.VERSION || '';
  const pretty = kv.PRETTY_NAME || kv.NAME || '';
  let os = pretty.trim();
  if (!os) os = [kv.NAME || id, version].filter(Boolean).join(' ').trim();
  if (!os) os = '';
  // 规范化成 "ubuntu 22.04" 这样便于展示与比较的形式
  if (id) {
    const base = pretty ? pretty.replace(/^["']|["']$/g, '').trim() : `${id} ${version}`.trim();
    os = base || id;
  }
  return { os, family: detectOsFamily(id, idLike), id, version, pretty };
}

/** 解析 uname 输出（-s / -m / -r / -n 各占一行）。 */
export function parseUname(text) {
  const lines = nonEmptyLines(text);
  return {
    sysname: lines[0] || '',
    arch: lines[1] || '',
    release: lines[2] || '',
    hostname: lines[3] || '',
  };
}

/** 解析 shell 段（第一行 $SHELL，第二行 $0）。 */
export function parseShellSection(text) {
  const lines = nonEmptyLines(text);
  const shell = lines[0] || '';
  const invoked = lines[1] || '';
  return { shell: shell || invoked, invokedAs: invoked };
}

/** 解析 workdir 段（第一行 pwd，第二行 $HOME）。 */
export function parseWorkdirSection(text) {
  const lines = nonEmptyLines(text);
  return { workdir: lines[0] || '', home: lines[1] || '' };
}

/**
 * 解析 sudo 段。
 * root → 本身就免密；passwordless → 免密 sudo 可用；password → 需要密码；none → 没装 sudo。
 */
export function parseSudoSection(text) {
  const line = (nonEmptyLines(text)[0] || '').toLowerCase();
  if (line === 'root') return 'none';
  if (line === 'passwordless') return 'passwordless';
  if (line === 'password') return 'password';
  return 'none';
}

/**
 * 解析工具段：每行 `name|path|version`。
 * @param {string} text
 * @returns {Array<{ name: string, path: string, version: string }>}
 */
export function parseToolsSection(text) {
  const out = [];
  for (const line of nonEmptyLines(text)) {
    const parts = line.split('|');
    if (parts.length < 2) continue;
    const name = parts[0].trim();
    const p = parts[1].trim();
    if (!name || !p) continue;
    out.push({ name, path: p, version: (parts[2] || '').trim() });
  }
  return out;
}

/** 解析包管理器列表段。 */
export function parseManagersSection(text) {
  return nonEmptyLines(text);
}

/**
 * 从版本输出里抽出规范版本号。
 * 覆盖：`Python 3.11.9`、`v20.11.0`、`git version 2.43.0`、`uv 0.4.18`、
 * `nodejs v20.11.0`、`GNU bash, version 5.2.21(1)-release`、`3.11.9`。
 *
 * @param {string} text
 * @returns {string} 形如 '3.11.9'；抽不到返回 ''
 */
export function parseVersionString(text) {
  const s = String(text ?? '');
  if (!s.trim()) return '';
  // 优先取 `x.y` 或 `x.y.z`（版本号必须至少两位，避免把 `v1` 之类误判成主版本）
  const m = s.match(/(\d+\.\d+(?:\.\d+)?(?:[-+._][0-9A-Za-z.]+)?)/);
  return m ? m[1] : '';
}

/** 只取主版本号：'3.11.9' → '3.11'；'20.11.0' → '20'（Node 的语义是主版本）。 */
export function majorOf(version, digits = 2) {
  const parts = String(version ?? '').split('.');
  return parts.slice(0, digits).join('.');
}

/**
 * 把工具探测结果归类进 runtime 映射与 managers 列表。
 *
 * runtime 键用契约 §2.4/§3.8 的语义键：python / node / npm / git / docker / uv / pyenv …
 * managers 只列**包/版本管理器**（前端据此决定「一键安装」的可选方案）。
 *
 * @param {Array<{name:string,path:string,version:string}>} tools
 * @returns {{ runtime: Record<string,string>, managers: string[], paths: Record<string,string> }}
 */
export function classifyTools(tools) {
  const runtime = {};
  const paths = {};
  const managers = [];
  const managerNames = new Set(['uv', 'pyenv', 'nvm', 'fnm', 'mise', 'apt-get', 'apt', 'yum', 'dnf', 'apk', 'zypper', 'pacman', 'brew', 'port']);
  const runtimeNames = new Set(['python', 'python3', 'node', 'npm', 'npx', 'pnpm', 'yarn', 'pip', 'pip3', 'pipx', 'git', 'docker', 'curl', 'wget', 'tar', 'make', 'gcc', 'unzip']);

  for (const tool of tools) {
    const version = parseVersionString(tool.version);
    if (tool.path) paths[tool.name] = tool.path;
    if (managerNames.has(tool.name)) {
      managers.push(tool.name);
      if (version) runtime[tool.name] = version;
      continue;
    }
    if (runtimeNames.has(tool.name)) {
      if (version) runtime[tool.name] = version;
      else runtime[tool.name] = runtime[tool.name] || '';
    }
  }
  // python3 与 python 是同一解释器的两个名字：统一暴露 `python`
  if (!runtime.python) {
    if (runtime.python3) runtime.python = runtime.python3;
  }
  if (!runtime.pip) {
    if (runtime.pip3) runtime.pip = runtime.pip3;
  }
  return { runtime, managers, paths };
}

/**
 * 按标记切分探测脚本输出。
 * @param {string} text
 * @returns {Record<string,string>}
 */
export function splitProbeSections(text) {
  const sections = {};
  let current = null;
  const buffer = [];
  const flush = () => {
    if (current) sections[current] = buffer.join('\n');
    buffer.length = 0;
  };
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith(MARK)) {
      flush();
      current = trimmed.slice(MARK.length).trim();
      continue;
    }
    if (current) buffer.push(line);
  }
  flush();
  return sections;
}

/**
 * 组装最终 probe 对象（契约 §2.3）。
 *
 * @param {string} stdout 探测脚本原始输出
 * @param {object} [options]
 * @param {number} [options.exitCode]
 * @param {string} [options.stderr]
 * @param {string} [options.error] 外部传入的错误（例如连接失败）
 * @returns {{ probe: object, paths: Record<string,string>, family: string }}
 */
export function composeProbe(stdout, options = {}) {
  const sections = splitProbeSections(stdout);
  const osInfo = parseOs(sections.os_release || '');
  const uname = parseUname(sections.uname || '');
  const shellInfo = parseShellSection(sections.shell || '');
  const workdirInfo = parseWorkdirSection(sections.workdir || '');
  const sudo = parseSudoSection(sections.sudo || '');
  const tools = parseToolsSection(sections.tools || '');
  const { runtime, managers, paths } = classifyTools(tools);
  for (const m of parseManagersSection(sections.os_pm || '')) {
    if (!managers.includes(m)) managers.push(m);
  }

  const isWindows = /mingw|msys|cygwin/i.test(uname.sysname || '');
  let os = osInfo.os;
  if (!os) {
    if (isWindows) os = `windows (${uname.sysname})`;
    else if (uname.sysname === 'Darwin') os = `macos ${uname.release || ''}`.trim();
    else if (uname.sysname === 'Linux') os = `linux ${uname.release || ''}`.trim();
    else os = uname.sysname || '';
  }

  let error = options.error || '';
  if (!error && options.exitCode != null && options.exitCode !== 0) {
    error = `探测脚本退出码 ${options.exitCode}${options.stderr ? `：${String(options.stderr).trim().slice(0, 200)}` : ''}`;
  }

  const probe = {
    at: Date.now(),
    os,
    arch: uname.arch || '',
    shell: shellInfo.shell || '',
    workdir: workdirInfo.workdir || '',
    runtime,
    managers,
    sudo,
    error,
  };
  return { probe, paths, family: osInfo.family, uname, home: workdirInfo.home || '' };
}

/** 从 runtime 映射推断 OS 家族（未拿到 os-release 时的兜底）。 */
export function inferFamilyFromProbe(probe) {
  const managers = Array.isArray(probe?.managers) ? probe.managers : [];
  if (managers.includes('apk')) return 'alpine';
  if (managers.includes('apt-get') || managers.includes('apt')) return 'debian';
  if (managers.includes('dnf') || managers.includes('yum')) return 'rhel';
  if (managers.includes('zypper')) return 'suse';
  if (managers.includes('pacman')) return 'arch';
  if (managers.includes('brew') || managers.includes('port')) return 'darwin';
  return 'unknown';
}

/** 让 verifier 能断言格式契约：probe 的键集合必须与契约一致。 */
export const PROBE_KEYS = ['at', 'os', 'arch', 'shell', 'workdir', 'runtime', 'managers', 'sudo', 'error'];

/** 校验一个 probe 对象是否符合契约形状。 */
export function isValidProbeShape(probe) {
  if (!probe || typeof probe !== 'object') return false;
  return PROBE_KEYS.every((key) => key in probe);
}
