/**
 * src/engine/nodes/helpers.js —— 节点共享工具
 *
 * 提供：脚本执行（shell / node / python 共用）、argv 编码、字段构造器、
 * 危险命令拦截、跨平台临时路径与清理。
 */
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const IS_WINDOWS = process.platform === 'win32';

/* --------------------------------------------------------------- 字段构造器 */

/** 字段描述符构造器（统一补齐契约 §3.9 的键，便于前端稳定渲染） */
export function f(name, label, type, extra = {}) {
  return {
    name,
    label,
    type,
    required: false,
    placeholder: extra.placeholder ?? '',
    description: extra.description ?? '',
    default: extra.default ?? '',
    ...extra,
  };
}

export const F = {
  string: (name, label, extra = {}) => f(name, label, 'string', extra),
  text: (name, label, extra = {}) => f(name, label, 'text', extra),
  code: (name, label, language, extra = {}) => f(name, label, 'code', { language, ...extra }),
  dir: (name, label, extra = {}) => f(name, label, 'path.dir', extra),
  file: (name, label, extra = {}) => f(name, label, 'path.file', extra),
  // glob 支持多值：multiple:true 时前端渲染为多值输入（契约 §3.7.1 允许 patterns 为数组）
  glob: (name, label, extra = {}) => f(name, label, 'glob', { preview: true, ...extra }),
  enum: (name, label, options, extra = {}) => f(name, label, 'enum', { options: [...options], ...extra }),
  boolean: (name, label, extra = {}) => f(name, label, 'boolean', extra),
  number: (name, label, extra = {}) => f(name, label, 'number', extra),
  server: (name, label, extra = {}) => f(name, label, 'server', extra),
  runtime: (name, label, runtime, extra = {}) => f(name, label, 'runtime', { runtime, ...extra }),
  keyvalue: (name, label, extra = {}) => f(name, label, 'keyvalue', extra),
  multiselect: (name, label, options, extra = {}) => f(name, label, 'multiselect', { options: [...options], ...extra }),
  envset: (name, label, extra = {}) => f(name, label, 'ref:envset', extra),
  snippet: (name, label, extra = {}) => f(name, label, 'ref:snippet', extra),
  // ref:pipeline：引用另一条流水线。前端渲染为「可搜索下拉 + 可手填 id」，
  // 候选来自 App 下发的 fieldCtx.pipelines；仍允许填尚未创建的 id。
  pipeline: (name, label, extra = {}) => f(name, label, 'ref:pipeline', extra),
};

/* ------------------------------------------------------------------ 头指令 */

const HEADER_RE = /^\s*#\s*dsh:\s*([A-Za-z][\w-]*)\s*=\s*(.*)$/;

/**
 * 解析脚本文本头部的 `# dsh:key=value` 指令。
 * 节点参数可以覆盖这些指令；指令只用于「声明元数据」，不参与任何求值，
 * 因此不存在注入面。
 * @returns {{directives:Record<string,string>, body:string}}
 */
export function parseDirectives(script) {
  const directives = {};
  const lines = String(script ?? '').split(/\r?\n/);
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const match = line.match(HEADER_RE);
    if (match) {
      directives[match[1].toLowerCase()] = match[2].trim();
      index += 1;
      continue;
    }
    if (line.trim() === '' && index === 0) {
      // 允许开头一个空行
      index += 1;
      continue;
    }
    break;
  }
  return { directives, body: lines.slice(index).join('\n') };
}

/* ------------------------------------------------------------------ 危险命令 */

/** 明显破坏性的命令模式（默认拒绝，可由节点参数 allowDangerous 放行） */
const DANGEROUS_PATTERNS = [
  { re: /\brm\s+(-[A-Za-z]*[rR][A-Za-z]*f|-[A-Za-z]*f[A-Za-z]*[rR])\s+\/(?:\s|$)/, reason: '递归删除根目录（rm -rf /）' },
  { re: /\bmkfs(\.\w+)?\b/, reason: '格式化文件系统（mkfs）' },
  { re: /\bdd\b[^\n]*\bof=\/dev\/(sd|nvme|hd|vd)/, reason: '直接写裸设备（dd of=/dev/...）' },
  { re: /:\(\)\s*\{\s*:\|\s*:\s*&\s*\}\s*;\s*:/, reason: 'Fork 炸弹' },
  { re: /\b(shutdown|reboot|halt|poweroff)\b/, reason: '关机/重启命令' },
  { re: /\bchmod\s+-R\s+777\s+\/(?:\s|$)/, reason: '对根目录递归 chmod 777' },
  { re: />\s*\/dev\/(sd|nvme|hd|vd)/, reason: '重定向覆盖裸设备' },
  { re: /\bformat\s+[A-Za-z]:/i, reason: 'Windows 格式化磁盘' },
  { re: /\bRemove-Item\b[^\n]*-Recurse[^\n]*-Force[^\n]*\b[A-Za-z]:\\?\s*($|['"])/i, reason: '递归删除整个盘符' },
];

/**
 * 检查脚本是否包含明显破坏性命令。
 * @returns {{dangerous:boolean, reason:string}}
 */
export function checkDangerous(script) {
  const text = String(script ?? '');
  for (const { re, reason } of DANGEROUS_PATTERNS) {
    if (re.test(text)) return { dangerous: true, reason };
  }
  return { dangerous: false, reason: '' };
}

/* ------------------------------------------------------------------ 命令编码 */

/** UTF-8 BOM：Windows PowerShell 5.1 只有看到 BOM 才会按 UTF-8 读取 .ps1 源码 */
const UTF8_BOM = '\ufeff';

/**
 * PowerShell 前导语句：把控制台输入/输出编码都设为 UTF-8。
 * 否则 PS 5.1 会按 ANSI(CP936) 解码子进程输出，中文变乱码。
 */
const PS_UTF8_PREAMBLE =
  '[Console]::OutputEncoding=[Text.Encoding]::UTF8;'
  + '$OutputEncoding=[Text.Encoding]::UTF8;'
  + 'try{[Console]::InputEncoding=[Text.Encoding]::UTF8}catch{};';

/**
 * 构建 shell 执行的 argv 与临时文件信息。
 *
 * 安全约定：用户脚本内容**绝不拼进命令行例外是 PowerShell 的 -File 路径**。
 * 做法是把脚本写入临时文件，再把「文件路径」作为参数传给解释器
 * （路径由我们生成，不含用户内容），因此用户脚本正文永不进入 shell 命令行。
 *
 * Windows 编码（关键）：
 * - `.ps1` 必须带 UTF-8 **BOM**：PowerShell 5.1 读无 BOM 文件会按 ANSI(CP936) 解码，
 *   脚本里的中文在执行**之前**就已损坏（实测输出 "鏉ヨ嚜 HTTP ..." 这类乱码）。
 * - 同时用 `-Command` 包装设置 `[Console]::OutputEncoding`/`$OutputEncoding` 为 UTF-8，
 *   让子进程（node/python/git）的 UTF-8 字节被正确解码，而不是按 ANSI 误解。
 * - `-Command` 包装必须 `exit $LASTEXITCODE`，否则退出码会丢（全部变 0）。
 * - `.cmd` **不能加 BOM**（BOM 会破坏 `@echo off`，实测输出会把命令行本身回显出来）。
 *
 * @param {{script:string, shell?:string, windowsShell?:'cmd'|'powershell', workdir?:string}} options
 * @returns {Promise<{argv:string[], tmpFile:string, cleanup:()=>Promise<void>}>}
 */
export async function buildScriptInvocation(options = {}) {
  const script = String(options.script ?? '');
  const requested = String(options.shell ?? '').trim().toLowerCase();
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-devops-'));

  const isPowerShellName = (name) => ['powershell', 'powershell.exe', 'pwsh', 'pwsh.exe'].includes(name);
  const isCmdName = (name) => ['cmd', 'cmd.exe'].includes(name);
  const isPosixShellName = (name) => /(^|\/)(sh|bash|zsh|ksh|dash|fish)$/.test(name);

  /** PowerShell 单引号转义：把路径安全嵌进 -Command（路径由我们生成，仍做转义防御） */
  const psQuote = (value) => `'${String(value).replace(/'/g, "''")}'`;

  let argv;
  let file;
  if (IS_WINDOWS) {
    const usePowerShell = isPowerShellName(requested)
      || requested === 'powershell'
      || (!requested && !!process.env.PSModulePath && process.env.DSH_DEVOPS_SHELL !== 'cmd');
    if (isCmdName(requested)) {
      file = path.join(dir, 'script.cmd');
      await fsp.writeFile(file, script, 'utf8'); // cmd 不写 BOM
      argv = ['cmd.exe', '/d', '/s', '/c', file];
    } else if (usePowerShell) {
      file = path.join(dir, 'script.ps1');
      // BOM 是必须的：否则 PS 5.1 按 ANSI 读源码，中文在读取阶段就坏了
      await fsp.writeFile(file, `${UTF8_BOM}${script}`, 'utf8');
      const ps = (requested && isPowerShellName(requested)) ? requested : 'powershell.exe';
      // -Command 包装：设编码 → 执行脚本 → 传播退出码
      const command = `${PS_UTF8_PREAMBLE}& ${psQuote(file)}; exit $LASTEXITCODE`;
      argv = [ps, '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command];
    } else {
      file = path.join(dir, 'script.cmd');
      await fsp.writeFile(file, script, 'utf8');
      argv = ['cmd.exe', '/d', '/s', '/c', file];
    }
  } else if (requested === 'sh' || requested === 'posix' || requested === 'dash') {
    file = path.join(dir, 'script.sh');
    await fsp.writeFile(file, script, 'utf8');
    argv = ['/bin/sh', file];
  } else if (requested === 'python' || requested === 'python3') {
    file = path.join(dir, 'script.py');
    await fsp.writeFile(file, script, 'utf8');
    argv = ['python3', file];
  } else if (requested === 'node') {
    file = path.join(dir, 'script.mjs');
    await fsp.writeFile(file, script, 'utf8');
    argv = ['node', file];
  } else if (isPosixShellName(requested)) {
    file = path.join(dir, 'script.sh');
    await fsp.writeFile(file, script, 'utf8');
    argv = [requested.startsWith('/') ? requested : `/bin/${requested}`, file];
  } else {
    // 默认 bash 优先，退回 sh
    file = path.join(dir, 'script.sh');
    await fsp.writeFile(file, script, 'utf8');
    argv = ['/bin/bash', file];
  }

  const cleanup = async () => {
    try {
      await fsp.rm(dir, { recursive: true, force: true });
    } catch { /* 忽略 */ }
  };
  return { argv, tmpFile: file, cleanup };
}

/**
 * 生成 `-c <script>` 形式（内联脚本，不落临时文件）。
 *
 * 与 buildScriptInvocation 同理：Windows PowerShell 必须显式把控制台编码设为 UTF-8，
 * 否则子进程输出里的中文会按 ANSI(CP936) 被误解成乱码。
 * 注意：内联脚本会把用户脚本放进命令行，仅在「脚本由节点自身产生」时使用。
 */
export function inlineCommandArgv(shell, script) {
  const name = String(shell ?? '').toLowerCase();
  const text = String(script ?? '');
  if (IS_WINDOWS) {
    if (isPowerShell(name)) {
      return [name, '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', `${PS_UTF8_PREAMBLE}${text}`];
    }
    return ['cmd.exe', '/d', '/s', '/c', text];
  }
  if (name && name !== 'auto') return [name, '-c', text];
  return ['/bin/sh', '-c', text];
}

function isPowerShell(name) {
  return ['powershell', 'powershell.exe', 'pwsh', 'pwsh.exe'].includes(name);
}

/* -------------------------------------------------------------- 文件与路径 */

/** 递归复制 */
export async function copyRecursive(from, to) {
  const info = await fsp.lstat(from).catch(() => null);
  if (!info) throw new Error(`源路径不存在：${from}`);
  if (info.isDirectory()) {
    await fsp.mkdir(to, { recursive: true });
    for (const entry of await fsp.readdir(from)) {
      await copyRecursive(path.join(from, entry), path.join(to, entry));
    }
    return { isDir: true, bytes: 0 };
  }
  await fsp.mkdir(path.dirname(to), { recursive: true });
  await fsp.copyFile(from, to);
  return { isDir: false, bytes: info.size };
}

/** 解析工作目录：相对路径挂到 cwd 下 */
export function resolveWorkPath(cwd, target) {
  const value = String(target ?? '');
  if (!value) return cwd;
  return path.isAbsolute(value) ? value : path.resolve(cwd, value);
}

/* ------------------------------------------------------- 路径诊断（可读报错） */

/**
 * 描述当前步骤的工作目录及其来源。
 *
 * 用户最容易踩的坑：`base` 写相对路径（如 `src`）而基准目录（cwd）不是他以为的那个，
 * 于是「命中 0 个」被误判成 glob 写错。这里把**解析后的绝对路径**与**来源**都暴露出来。
 *
 * @param {object} rt
 * @returns {string} 例如 `"C:\proj"（来自 server.workdir）`
 */
export function describeCwd(rt) {
  const cwd = rt?.cwd ? String(rt.cwd) : '';
  if (!cwd) return '（未设置）';
  const source = rt?.cwdSource ? `，来自 ${rt.cwdSource}` : '';
  return `"${cwd}"${source}`;
}

/**
 * 把用户输入的路径解析成绝对路径，并给出一段可读的溯源说明。
 *
 * @param {object} rt
 * @param {string} input 用户原始输入（可能是相对路径）
 * @param {string} [fallbackCwd] 输入为空时的回退基准
 * @returns {{raw:string, abs:string, relative:boolean, source:string, describe:string}}
 */
export function resolveInputPath(rt, input, fallbackCwd) {
  const raw = String(input ?? '').trim();
  const cwd = String(fallbackCwd ?? rt?.cwd ?? '');
  const relative = raw !== '' && !path.isAbsolute(raw);
  const abs = raw === '' ? cwd : (relative ? path.resolve(cwd, raw) : raw);
  return {
    raw,
    abs,
    relative,
    source: raw === '' ? '回退到工作目录' : (relative ? '相对工作目录' : '绝对路径'),
    describe: raw === ''
      ? `${abs}（未指定，使用工作目录 ${describeCwd(rt)}）`
      : (relative
        ? `${abs}（输入="${raw}"，相对基准=cwd ${describeCwd(rt)}）`
        : `${abs}（输入为绝对路径）`),
  };
}

/**
 * 校验一个路径确实是存在的目录；不是则返回可读错误（含解析后的绝对路径与来源）。
 * 关键：把**解析后的绝对路径**打出来，用户看到 `~/.dsh/src` 立刻就知道该去设置工作目录。
 *
 * @param {object} rt
 * @param {string} abs 已解析的绝对路径
 * @param {string} describe 溯源说明（来自 resolveInputPath）
 * @param {string} label 字段名（如 `base` / `paths`）
 * @returns {Promise<string>} 空串表示通过；否则为错误文案
 */
export async function checkDirectory(rt, abs, describe, label = 'base') {
  const info = await Promise.resolve(rt.executor.stat(rt.server, abs)).catch(() => ({ exists: false }));
  if (!info.exists) {
    return `起始目录不存在：${describe}。请检查 ${label} 是否写对，或设置正确的服务器工作目录。`;
  }
  if (info.isDir === false) {
    return `起始目录不是目录（是一个文件）：${describe}。请把 ${label} 指向目录。`;
  }
  return '';
}

/** 读取节点输出（节点之间传递的小对象） */
export function stepOutput(rt, stepId, key, fallback = undefined) {
  const step = rt?.run?.steps?.[stepId];
  if (!step) return fallback;
  const outputs = step.outputs ?? {};
  if (key === undefined) return outputs;
  return outputs[key] === undefined ? fallback : outputs[key];
}

/** 把 kv 数组或对象统一成普通对象 */
export function toRecord(input) {
  if (!input) return {};
  if (Array.isArray(input)) {
    const out = {};
    for (const item of input) {
      if (!item) continue;
      if (typeof item === 'string') {
        const eq = item.indexOf('=');
        if (eq > 0) out[item.slice(0, eq)] = item.slice(eq + 1);
        continue;
      }
      if (item.name) out[item.name] = item.value;
    }
    return out;
  }
  if (typeof input === 'object') return { ...input };
  return {};
}

/* ---------------------------------------------------------------- 插值 */

/**
 * 唯一的节点侧插值入口（此前 5 个节点各写了一份 expand，行为已漂移）。
 *
 * 语法（两种花括号都认，宽容）：
 *   `${env.NAME}` / `${{ env.NAME }}`
 *   `${variables.NAME}` / `${{ variables.NAME }}`
 *   `${steps.<jobId>.outputs.<key>}`
 *   `${run.id}` `${run.pipelineId}` `${run.pipelineName}` `${run.status}`
 *   `${step.id}` `${step.name}`
 *   `${server.id}` `${server.name}` `${server.host}`
 *
 * 未定义的占位符**抛错**（与 model/template.js 的 interpolate 一致），
 * 绝不静默留空——静默留空会让「插值没生效」埋得很深。
 *
 * 正则 `\$\{\{?\s*([^}]*?)\s*\}?\}` 说明：
 * - `\{\{?` 匹配 `{` 或 `{{`；`\}?\}` 匹配 `}` 或 `}}`，因此 `${{ a }}` 整体被吞掉，
 *   不会残留 `}`；`[^}]*?` 保证路径里不含 `}`。
 */
const PLACEHOLDER_RE = /\$\{\{?\s*([^{}]*?)\s*\}?\}/g;

/** 按点路径取值（支持 `steps[0]` 与 `steps.0`）；undefined 视为未找到 */
function readPath(root, path) {
  if (!path) return { found: false, value: undefined };
  const tokens = String(path)
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .map((t) => t.trim())
    .filter((t) => t !== '');
  let current = root;
  for (const token of tokens) {
    if (current === null || current === undefined) return { found: false, value: undefined };
    if (typeof current !== 'object') return { found: false, value: undefined };
    if (!Object.prototype.hasOwnProperty.call(current, token)) return { found: false, value: undefined };
    current = current[token];
  }
  if (current === undefined) return { found: false, value: undefined };
  return { found: true, value: current };
}

/** 值 → 文本（对象转 JSON，null/undefined → 空串） */
function stringifyValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  return JSON.stringify(value);
}

/** 给「未定义」报错提供可用键提示 */
function availableKeys(root, path) {
  const head = String(path ?? '').split(/[.[]/)[0];
  const scope = head && root && typeof root === 'object' ? root[head] : root;
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) return '';
  const keys = Object.keys(scope).slice(0, 8);
  return keys.length ? `可用键：${keys.join('、')}` : '';
}

/**
 * 构造插值上下文（节点侧）。把 rt 里的运行/步骤/服务器/变量/环境摊平成可读路径。
 *
 * `variables` 的构成（用户最常用的一种）：
 *   pipeline.variables（静态定义）→ run.variables（运行期，含 env.set 写入）后者覆盖前者。
 * 注意契约里 pipeline.variables 是**数组** [{name,value}]，run.variables 是**对象**，
 * 因此统一用 toRecord 归一化。
 *
 * @param {object} rt
 * @param {object} [extra] 额外注入的上下文（如 { inputs }）
 */
export function buildInterpolationContext(rt = {}, extra = {}) {
  const env = rt.env && typeof rt.env === 'object' ? rt.env : {};
  const variables = {
    ...toRecord(rt.pipeline?.variables),
    ...toRecord(rt.run?.variables),
  };
  return {
    env,
    variables,
    pipeline: {
      id: rt.pipeline?.id ?? '',
      name: rt.pipeline?.name ?? '',
      variables,
    },
    run: {
      id: rt.run?.id ?? '',
      pipelineId: rt.run?.pipelineId ?? '',
      pipelineName: rt.run?.pipelineName ?? '',
      status: rt.run?.status ?? '',
      variables,
    },
    step: { id: rt.step?.id ?? '', name: rt.step?.name ?? '' },
    server: {
      id: rt.server?.id ?? '',
      name: rt.server?.name ?? '',
      host: rt.server?.host ?? '',
    },
    steps: rt.run?.steps ?? {},
    inputs: extra?.inputs ?? {},
  };
}

/**
 * 展开一段模板文本。
 *
 * @param {string} text
 * @param {object} rt 节点运行时上下文
 * @param {{inputs?:object, env?:object, lenient?:boolean}} [extra]
 *        - env：节点自带变量（优先于运行环境）
 *        - lenient：未定义时**原样保留**而不抛错。
 *          仅用于「内容可能本身就是含 ${} 的产物」的字段（如 file.write 写 .env/shell 脚本），
 *          其余场景一律严格抛错（与 model/template.js 一致）。
 * @returns {string}
 * @throws {Error} 严格模式下占位符未定义 / 值为 undefined 时
 */
export function expandTemplate(text, rt = {}, extra = {}) {
  if (text === null || text === undefined) return '';
  const source = String(text);
  if (!source.includes('${')) return source;

  const context = buildInterpolationContext(rt, extra);
  // extra.env：节点自带变量（如 file.write 的 env 参数）优先于运行环境
  if (extra?.env && typeof extra.env === 'object') {
    context.env = { ...context.env, ...extra.env };
  }

  return source.replace(PLACEHOLDER_RE, (match, rawPath) => {
    const path = String(rawPath ?? '').trim();
    if (!path) return match; // `${}` 不是占位符，原样保留

    let { found, value } = readPath(context, path);
    // 裸名简写：`${NAME}` ≡ `${env.NAME}`（缓存 key 等历史写法依赖它）
    if (!found && !path.includes('.')) {
      const viaEnv = readPath(context.env, path);
      if (viaEnv.found) ({ found, value } = viaEnv);
    }
    if (!found) {
      if (extra?.lenient === true) return match; // 宽松模式：原样保留
      const hint = availableKeys(context, path);
      const error = new Error(
        `插值占位符未定义：\${${path}}${hint ? `（${hint}）` : ''}。`
        + '可用形式：${env.NAME}、${variables.NAME}、${steps.<jobId>.outputs.<key>}、'
        + '${run.id|pipelineId|pipelineName|status}、${step.id|name}、${server.id|name|host}',
      );
      error.code = 'INTERPOLATION_UNDEFINED';
      error.placeholder = path;
      throw error;
    }
    return stringifyValue(value);
  });
}

/** 只做「是否含占位符」判断（用于跳过无占位符的快速路径） */
export function hasPlaceholder(text) {
  return typeof text === 'string' && text.includes('${');
}

/**
 * 递归展开对象/数组里的所有字符串（用于 with 参数整体插值）。
 * @param {any} value
 * @param {object} rt
 */
export function expandDeep(value, rt = {}) {
  if (typeof value === 'string') return expandTemplate(value, rt);
  if (Array.isArray(value)) return value.map((item) => expandDeep(item, rt));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = expandDeep(item, rt);
    return out;
  }
  return value;
}

/** 极小的 HTTP 客户端（零依赖，仅用 node:http/https） */
export async function httpRequest({ url, method = 'GET', headers = {}, body = null, timeoutMs = 30000, signal }) {
  const { request } = url.startsWith('https:') ? await import('node:https') : await import('node:http');
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: `${target.pathname}${target.search}`,
      method,
      headers,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    req.on('error', reject);
    if (timeoutMs > 0) req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`HTTP 请求超时（${timeoutMs}ms）`));
    });
    if (signal) {
      const onAbort = () => req.destroy(new Error('已取消'));
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    if (body !== null && body !== undefined) req.write(body);
    req.end();
  });
}

export { IS_WINDOWS };
