/**
 * POSIX shell 引号与远端命令行构造。
 *
 * 安全约定（契约 §5.1）：命令一律以 argv 数组传递，用户输入绝不拼进 shell 命令行。
 * 本模块是把 argv 转成远端命令行的唯一入口，做法是**每个参数独立单引号转义**：
 * 单引号内除单引号本身外没有任何元字符，因此 `;`、`$()`、反引号、换行都会被当作字面量。
 *
 * 唯一例外是 `script`：那是用户显式提供的脚本内容，按其本意整体执行（在远端登录 shell 里）。
 */
import { RemotePathError } from './errors.js';

/** 未显式指定解释器时，用 POSIX 默认 shell 承载脚本文本（远端登录 shell 也一定是 POSIX）。 */
const DEFAULT_SCRIPT_SHELL = 'sh';

/**
 * 单引号转义一个参数（POSIX 安全）。
 * `a'b` → `'a'\''b'`；空串 → `''`。
 * @param {unknown} arg
 */
export function quoteArg(arg) {
  const s = arg == null ? '' : String(arg);
  return `'${s.split("'").join(`'\\''`)}'`;
}

/** 把一个参数列表转成可安全交给远端 shell 的命令行。 */
export function quoteArgv(argv) {
  return argv.map((arg) => quoteArg(arg)).join(' ');
}

/**
 * 环境变量前缀。
 * 契约：`env` 中值为 `undefined` 表示**删除该键**——用 `unset` 显式删除，
 * 否则远端登录 shell 里的同名变量会透传进来（例如遗留的 PYTHONPATH）。
 *
 * @param {Record<string, string|undefined|null>|undefined} env
 * @returns {string} 例如 `unset 'FOO'; env 'BAR=baz' cmd`
 */
export function buildEnvPrefix(env) {
  if (!env || typeof env !== 'object') return '';
  const set = [];
  const unset = [];
  for (const [name, value] of Object.entries(env)) {
    if (!isValidEnvName(name)) continue;
    if (value === undefined || value === null) unset.push(name);
    else set.push(`${name}=${String(value)}`);
  }
  const parts = [];
  if (unset.length > 0) parts.push(`unset ${unset.map((n) => quoteArg(n)).join(' ')}`);
  if (set.length > 0) parts.push(`env ${set.map((kv) => quoteArg(kv)).join(' ')}`);
  return parts.join('; ');
}

/** 合法的环境变量名（防止畸形键名注入）。 */
export function isValidEnvName(name) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(name ?? ''));
}

/**
 * 构造最终交给 `client.exec()` 的命令行。
 *
 * 顺序：`[sudo] [cd <cwd>] && [unset …; env …] <cmd>`
 *
 * @param {object} spec
 * @param {string[]} [spec.argv]  argv 数组（会被逐个转义）
 * @param {string} [spec.script]  用户脚本内容（原样执行，不转义——这是用户脚本本身）
 * @param {string[]} [spec.scriptArgv] 解释器 argv，脚本文本会作为**最后一个参数**追加
 *   （例如 `['python3','-c']` + script → `'python3' '-c' '<script>'`）。
 *   与 script 同时存在时优先于 shell：解释器已由调用方解析（可能是远端绝对路径）。
 * @param {string} [spec.cwd]     远端工作目录
 * @param {Record<string, string|undefined|null>} [spec.env]
 * @param {boolean|string} [spec.sudo] true 或用户名
 * @param {string} [spec.shell]   指定解释器（例如 /bin/bash）；只作用于 script
 */
export function buildCommandLine(spec = {}) {
  const { argv, script, scriptArgv, cwd, env, sudo, shell } = spec;

  let body;
  if (typeof script === 'string' && script.length > 0 && Array.isArray(scriptArgv) && scriptArgv.length > 0) {
    // 解释器 + 脚本作为独立 argv 参数：脚本内容永远是数据，不会被解释成命令行元字符。
    body = quoteArgv([...scriptArgv, script]);
  } else if (typeof script === 'string' && script.length > 0) {
    // 用户脚本：整体交给远端 shell；显式指定解释器时按**解释器家族**包裹（脚本始终是独立参数，安全）。
    //
    // 未指定解释器时不能把脚本文本裸拼在命令行里：一旦存在 env 前缀，
    // `env 'A=1' set -eu\n...` 会把首行当成 env 要执行的**命令名**（实测
    // `env: 'set': No such file or directory`，脚本第一行就被吃掉）。
    // 因此无 shell 时显式交给 POSIX shell 承载，脚本始终是一个独立参数。
    body = shell ? wrapScript(shell, script) : wrapScript(DEFAULT_SCRIPT_SHELL, script);
  } else if (Array.isArray(argv) && argv.length > 0) {
    body = quoteArgv(argv);
  } else {
    throw new RemotePathError('run() 需要 spec.argv 或 spec.script 之一', 'empty-command');
  }

  const prefix = buildEnvPrefix(env);
  let line = prefix ? `${prefix} ${body}` : body;

  if (cwd) {
    const target = expandTilde(String(cwd), spec.home);
    line = `cd ${quoteArg(target)} && ${line}`;
  }

  if (sudo) {
    // 非交互 sudo：-n 表示绝不提示密码（远端无 TTY），需要免密 sudo 或 NOPASSWD 规则。
    const asUser = typeof sudo === 'string' && sudo !== 'true' ? `-u ${quoteArg(sudo)} ` : '';
    line = `sudo -n ${asUser}sh -c ${quoteArg(line)}`;
  }

  return line;
}

/**
 * 用指定解释器包裹一段脚本文本（脚本始终作为**独立参数**，不做字符串拼接）。
 *
 * 必须按解释器家族选参数，否则跨平台会静默出错：
 * - POSIX shell（sh/bash/zsh/…）→ `-c`；
 * - `cmd`/`cmd.exe` → `/d /s /c`（cmd 没有 `-c`）；
 * - PowerShell → `-Command`，并显式 `exit $LASTEXITCODE` 传播退出码
 *   （`-Command` 默认不带出最后一条命令的退出码，会把失败报成 0）。
 *
 * @param {string} shell 解释器名或路径
 * @param {string} script 脚本文本
 * @returns {string} 形如 `'bash' -c '<script>'`
 */
export function wrapScript(shell, script) {
  const base = String(shell).split(/[\\/]/).pop().toLowerCase().replace(/\.exe$/, '');
  if (base === 'cmd') {
    return `${quoteArg(shell)} /d /s /c ${quoteArg(script)}`;
  }
  if (base === 'powershell' || base === 'pwsh') {
    return `${quoteArg(shell)} -NoLogo -NoProfile -NonInteractive -Command ${quoteArg(`${script}\nexit $LASTEXITCODE`)}`;
  }
  return `${quoteArg(shell)} -c ${quoteArg(script)}`;
}

/**
 * 展开开头的 `~`（SFTP 不会做 shell 展开，必须自己来）。
 * @param {string} p
 * @param {string} [home]
 */
export function expandTilde(p, home) {
  const s = String(p ?? '');
  if (!s.startsWith('~')) return s;
  if (!home) return s;
  if (s === '~') return home;
  if (s.startsWith('~/')) return `${home.replace(/\/+$/, '')}/${s.slice(2)}`;
  return s; // ~user 形式：交给远端，SDK 不猜
}

/** 归一化远端路径：折叠重复 `/`、去掉末尾 `/`（根目录除外）、解析 `.` 与 `..`。 */
export function normalizeRemotePath(p) {
  const s = String(p ?? '').trim();
  if (s === '') return '.';
  const absolute = s.startsWith('/');
  const out = [];
  for (const seg of s.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
      else if (!absolute) out.push('..');
      continue;
    }
    out.push(seg);
  }
  const joined = out.join('/');
  if (absolute) return `/${joined}`;
  return joined === '' ? '.' : joined;
}

/**
 * 以 base 为根解析相对路径（契约 §5.3 的 containment 校验）。
 * 相对路径拼到 base 下；绝对路径保持绝对（随后由 assertInsideBase 判定是否越界）。
 *
 * @param {string} base
 * @param {string} p
 * @param {string} [home]
 */
export function resolveRemotePath(base, p, home) {
  const target = expandTilde(String(p ?? ''), home);
  if (target.startsWith('/')) return normalizeRemotePath(target);
  const root = normalizeRemotePath(expandTilde(String(base ?? '/'), home));
  return normalizeRemotePath(`${root === '/' ? '' : root}/${target}`);
}

/**
 * 校验 target 位于 base 之内（含 base 自身）。
 * 注意：这里只做**词法** containment（远端 realpath 需要额外一次 readlink，
 * 由 Executor 在需要时用 `cd p && pwd -P` 加固），词法校验已能挡住绝大多数 `../` 越界。
 *
 * @returns {string} 归一化后的目标路径
 * @throws {RemotePathError}
 */
export function assertInsideBase(base, target) {
  const root = normalizeRemotePath(base);
  const t = normalizeRemotePath(target);
  if (root === '/' || root === '.') return t;
  if (t === root) return t;
  if (t.startsWith(`${root}/`)) return t;
  throw new RemotePathError(
    `路径越界：${t} 不在允许的根目录 ${root} 之内`,
    'path-outside-base',
    { base: root, target: t },
  );
}

/** 把 glob 的 base + 用户输入解析成一个「可能还不存在」的远端绝对路径。 */
export function joinRemote(base, ...parts) {
  const chunks = [String(base ?? ''), ...parts.map((p) => String(p ?? ''))].filter((s) => s.length > 0);
  return normalizeRemotePath(chunks.join('/'));
}

/** 判断一个 glob 是否含通配符（决定 match 是走遍历还是直接 stat）。 */
export function hasGlobMagic(pattern) {
  return /[*?[\]{}]/.test(String(pattern ?? ''));
}

/**
 * 从 glob 中切出「非通配前缀」作为遍历起点。
 * 例：`/srv/app/dist/**&#47;*.js` → { base: '/srv/app/dist', rest: '**&#47;*.js' }
 * （注释里用 &#47; 代表斜杠，避免 `*&#47;` 组合提前结束块注释。）
 */
export function splitGlobRoot(base, pattern) {
  const p = String(pattern ?? '');
  if (p.startsWith('/')) {
    const segments = p.split('/');
    const fixed = [];
    let i = 0;
    for (; i < segments.length; i += 1) {
      const seg = segments[i];
      if (seg === '') { fixed.push(seg); continue; }
      if (hasGlobMagic(seg)) break;
      fixed.push(seg);
    }
    const rootPath = fixed.join('/') || '/';
    const rest = segments.slice(i).join('/');
    return { base: normalizeRemotePath(rootPath), rest: rest || '' };
  }
  return { base: normalizeRemotePath(base || '.'), rest: p };
}

/** 把字节数转成人类可读。 */
export function humanBytes(bytes) {
  const n = Number(bytes) || 0;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)}${units[unit]}`;
}

/** 校验端口号。 */
export function normalizePort(port, fallback = 22) {
  const n = Number(port);
  if (!Number.isFinite(n) || n <= 0 || n > 65535) return fallback;
  return Math.floor(n);
}
