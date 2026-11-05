/**
 * src/engine/executors/local.js —— 本机执行器（契约 §3.7）
 *
 * 安全要点：
 * - 一律用 argv 数组 spawn，`shell: false`。用户输入绝不拼进命令行，
 *   唯一例外是 shell 节点**显式**传入的脚本内容（那是用户自己的脚本文本）。
 * - env 中值为 undefined 表示「删除该键」，执行前过滤掉。
 * - 路径访问做 realpath containment 校验（可配置 roots；默认不限制但始终规范化）。
 * - Windows 下 Node 的 SIGTERM/SIGKILL 都映射为 TerminateProcess；取消流程统一为
 *   「先温和信号 → 宽限期 → 强杀」，并等待 exit 事件确认进程真的结束。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const IS_WINDOWS = process.platform === 'win32';
/** 温和信号 → 强杀的宽限期 */
const DEFAULT_KILL_GRACE_MS = 3000;

/** 懒加载 model/glob.js（host-core 负责）；缺失时回退到内置匹配器 */
let globModulePromise = null;
async function loadGlobModule() {
  if (!globModulePromise) {
    globModulePromise = import('../../model/glob.js').catch(() => null);
  }
  return globModulePromise;
}

/** 内置的最小 glob 匹配器（仅当 model/glob.js 不可用时兜底） */
function fallbackMatchOne(pattern, target) {
  let negated = false;
  let pat = String(pattern ?? '');
  if (pat.startsWith('!')) {
    negated = true;
    pat = pat.slice(1);
  }
  let re = '';
  for (let i = 0; i < pat.length; i += 1) {
    const ch = pat[i];
    if (ch === '*') {
      if (pat[i + 1] === '*') {
        re += '.*';
        i += 1;
        if (pat[i + 1] === '/') i += 1;
      } else {
        re += '[^/]*';
      }
    } else if (ch === '?') {
      re += '[^/]';
    } else if (ch === '{') {
      const end = pat.indexOf('}', i);
      if (end === -1) { re += '\\{'; } else {
        const parts = pat.slice(i + 1, end).split(',').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        re += `(?:${parts.join('|')})`;
        i = end;
      }
    } else {
      re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  const hit = new RegExp(`^${re}$`).test(target);
  return negated ? !hit : hit;
}

/** 统一的路径规范化：Windows 用 \，其它用 / */
function toPosix(p) {
  return String(p).split(path.sep).join('/');
}

/**
 * 真实路径解析：对不存在的路径，回溯到最近存在的祖先再拼接（realpath 失败不致命）。
 */
async function realpathDeep(target) {
  const abs = path.resolve(target);
  const parts = [];
  let current = abs;
  for (;;) {
    try {
      const real = await fsp.realpath(current);
      return parts.length ? path.join(real, ...parts.reverse()) : real;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return abs;
      parts.push(path.basename(current));
      current = parent;
    }
  }
}

/**
 * 子进程输出解码（Windows 中文的关键安全网）。
 *
 * Windows 上子进程可能用两种编码写出：
 * - UTF-8（现代工具；或我们已设置 [Console]::OutputEncoding=UTF8 的 PowerShell）
 * - ANSI/CP936/GBK（老工具、未设编码的 PowerShell 5.1 默认输出）
 *
 * 直接 `toString('utf8')` 会把 GBK 字节解成乱码（如 "鏉ヨ嚜"），且**不可逆**。
 * 因此按「严格 UTF-8 优先，失败回退 GBK」判定：
 * - 合法 UTF-8（含纯 ASCII）→ 按 UTF-8，绝不误伤正确内容
 * - 非法 UTF-8 字节序列 → 判定为 GBK/ANSI 输出
 *
 * 流式注意：分块可能把多字节字符切成两半，此时合法 UTF-8 尾部会「显得非法」。
 * 为不误判，先检查是否只是被截断；是则按 UTF-8 宽松解码，由后续 chunk 补齐。
 */
const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true });
const GBK_DECODER = new TextDecoder('gbk', { fatal: false });

/** 判断 buffer 末尾是否为「被截断的合法 UTF-8 多字节序列」 */
function endsWithPartialUtf8(buffer) {
  const len = buffer.length;
  for (let back = 1; back <= Math.min(3, len); back += 1) {
    const byte = buffer[len - back];
    if (byte === undefined) return false;
    if ((byte & 0xc0) === 0x80) continue; // 续接字节，继续往前找起始字节
    let need = 0;
    if ((byte & 0x80) === 0x00) need = 1;
    else if ((byte & 0xe0) === 0xc0) need = 2;
    else if ((byte & 0xf0) === 0xe0) need = 3;
    else if ((byte & 0xf8) === 0xf0) need = 4;
    else return false; // 非法起始字节
    return need > back; // 声明长度 > 已有字节数 → 被截断
  }
  return false;
}

/**
 * 解码一个输出 chunk。
 * @param {Buffer} buffer
 * @returns {string}
 */
function decodeChunk(buffer) {
  if (!buffer || buffer.length === 0) return '';
  try {
    return STRICT_UTF8.decode(buffer);
  } catch {
    if (endsWithPartialUtf8(buffer)) return buffer.toString('utf8'); // 尾字符被截断，等下一块补齐
    return GBK_DECODER.decode(buffer); // GBK/ANSI 输出
  }
}

/**
 * 创建本机执行器。
 * @param {{config?:object, log?:object, roots?:string[]|null, killGraceMs?:number}} options
 */
export function createLocalExecutor(options = {}) {
  const config = options.config ?? {};
  /** 允许访问的根目录；null = 不限制（仅做 realpath 规范化） */
  const roots = Array.isArray(options.roots) && options.roots.length
    ? options.roots.map((r) => path.resolve(r))
    : null;
  const killGraceMs = Number.isFinite(options.killGraceMs) ? options.killGraceMs : DEFAULT_KILL_GRACE_MS;
  /** 本执行器启动的子进程集合（dispose 时统一回收） */
  const live = new Set();
  let disposed = false;

  /** containment 校验 */
  async function resolvePath(target) {
    if (typeof target !== 'string' || !target) {
      throw new Error('路径不能为空');
    }
    const real = await realpathDeep(target);
    if (roots) {
      const normalized = IS_WINDOWS ? real.toLowerCase() : real;
      const ok = roots.some((root) => {
        const r = IS_WINDOWS ? root.toLowerCase() : root;
        return normalized === r || normalized.startsWith(r.endsWith(path.sep) ? r : r + path.sep);
      });
      if (!ok) {
        const error = new Error(`路径越界，拒绝访问：${target}`);
        error.code = 'PATH_OUT_OF_BOUNDS';
        throw error;
      }
    }
    return real;
  }

  /**
   * 执行一个命令。
   * @param {{argv:string[], cwd?:string, env?:object, timeoutMs?:number, signal?:AbortSignal,
   *          label?:string, onData?:(chunk:{text:string,stream:string})=>void, windowsHide?:boolean}} spec
   * @returns {{done:Promise<{exitCode:number|null,signal:string|null,timedOut:boolean,durationMs:number}>, cancel:Function, phase:string, pid:number|null}}
   */
  function run(spec = {}) {
    const argv = Array.isArray(spec.argv) ? spec.argv : [];
    if (!argv.length || typeof argv[0] !== 'string' || !argv[0]) {
      return {
        done: Promise.reject(new Error('argv 不能为空：argv[0] 必须是可执行文件路径')),
        cancel() {},
        get phase() { return 'settled'; },
        set phase(_v) {},
        pid: null,
      };
    }
    if (disposed) {
      return {
        done: Promise.reject(new Error('执行器已释放（dispose）')),
        cancel() {},
        get phase() { return 'settled'; },
        set phase(_v) {},
        pid: null,
      };
    }

    // env：undefined / 空串 删除，其余转字符串
    const env = {};
    const source = spec.env && typeof spec.env === 'object' ? spec.env : process.env;
    for (const [key, value] of Object.entries(source)) {
      if (value === undefined || value === null) continue;
      env[key] = String(value);
    }

    const cwd = spec.cwd ? path.resolve(spec.cwd) : process.cwd();
    const timeoutMs = Number.isFinite(spec.timeoutMs) && spec.timeoutMs > 0 ? spec.timeoutMs : 0;
    const startedAt = Date.now();

    /** @type {'queued'|'running'|'draining'|'settled'} */
    let phase = 'running';
    let child = null;
    let settled = false;
    let timedOut = false;
    let cancelRequested = false;
    let killTimer = null;
    let escalationTimer = null;
    let hardStopTimer = null;
    /** 已观测到的退出信息（exit 事件早于 close 到达） */
    let seenExitCode = null;
    let seenSignal = null;

    let resolveDone;
    let rejectDone;
    const done = new Promise((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
    });

    const emit = (text, stream) => {
      if (!text) return;
      try {
        spec.onData?.({ text, stream });
      } catch { /* 回调异常不得影响执行 */ }
    };

    const finalize = (exitCode, signal) => {
      if (settled) return;
      settled = true;
      phase = 'settled';
      if (killTimer) { clearTimeout(killTimer); killTimer = null; }
      if (escalationTimer) { clearTimeout(escalationTimer); escalationTimer = null; }
      if (hardStopTimer) { clearTimeout(hardStopTimer); hardStopTimer = null; }
      if (child) live.delete(child);
      if (spec.signal) {
        try { spec.signal.removeEventListener('abort', onAbort); } catch { /* 忽略 */ }
      }
      // 被信号/强杀时为 null，回退到已记录的退出码或约定的 130
      const resolvedCode = exitCode === undefined || exitCode === null
        ? (seenExitCode ?? (cancelRequested ? 130 : null))
        : exitCode;
      resolveDone({
        exitCode: resolvedCode,
        signal: signal ?? seenSignal ?? null,
        timedOut,
        canceled: cancelRequested,
        durationMs: Date.now() - startedAt,
      });
    };

    /**
     * 温和终止整棵进程树（SIGTERM 语义）。
     *
     * Windows 说明：Node 的 child.kill('SIGTERM') 只是 TerminateProcess，而且只杀直接子进程。
     * 若先杀 cmd.exe，孙进程（如 ping/sleep）会变成孤儿并继续持有 stdout/stderr 管道，
     * 之后 taskkill /T 再也无法通过父 pid 找到它，'close' 事件会被拖到孙进程自然结束。
     * 因此 Windows 上用 `taskkill /pid <pid> /t`（不带 /F）作为温和终止——它作用于整棵树。
     * POSIX 用真正的 SIGTERM。
     */
    const gracefulStop = () => {
      if (settled || !child) return;
      if (IS_WINDOWS && child.pid) {
        spawn('taskkill', ['/pid', String(child.pid), '/t'], { stdio: 'ignore', windowsHide: true })
          .on('error', () => {
            try { child.kill('SIGTERM'); } catch { /* 忽略 */ }
          });
        return;
      }
      try { child.kill('SIGTERM'); } catch { /* 进程可能已退出 */ }
    };

    /**
     * 强杀整棵进程树（SIGKILL 语义）。
     * Windows：taskkill /T /F 连同子进程一起强制终止（Node 的 SIGKILL 做不到）。
     * POSIX：直接 SIGKILL。
     */
    const hardKill = () => {
      if (settled || !child) return;
      if (IS_WINDOWS && child.pid) {
        try {
          spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true })
            .on('error', () => {
              try { child.kill('SIGKILL'); } catch { /* 忽略 */ }
            });
        } catch { /* 忽略 */ }
        return;
      }
      try { child.kill('SIGKILL'); } catch { /* 忽略 */ }
    };

    /** 温和终止 → 宽限期 → 强杀整树 → 兜底结算 */
    const terminate = (reason) => {
      if (!child || settled) return;
      // 已经在终止流程中：不重复触发（取消与超时可能同时到达，避免重复 taskkill 与重复日志）
      if (cancelRequested) return;
      cancelRequested = true;
      phase = 'draining';
      gracefulStop();
      if (escalationTimer) clearTimeout(escalationTimer);
      escalationTimer = setTimeout(() => {
        if (settled) return;
        hardKill();
      }, killGraceMs);
      if (escalationTimer.unref) escalationTimer.unref();
      // 兜底：即使管道一直不关闭（孙进程僵持），也要在有限时间内结算，
      // 否则 cancel()/超时的 done 会永久挂起。
      if (hardStopTimer) clearTimeout(hardStopTimer);
      const hardStopMs = killGraceMs + 2000;
      hardStopTimer = setTimeout(() => {
        if (settled) return;
        hardKill();
        // 再给 1500ms 让 'close' 到达；仍不到则销毁管道并直接结算
        setTimeout(() => {
          if (settled) return;
          if (child) {
            try { child.stdout?.destroy(); } catch { /* 忽略 */ }
            try { child.stderr?.destroy(); } catch { /* 忽略 */ }
          }
          finalize(seenExitCode, seenSignal);
        }, 1500).unref?.();
      }, hardStopMs);
      if (hardStopTimer.unref) hardStopTimer.unref();
      emit(`[engine] 收到${reason}，正在终止进程（宽限 ${killGraceMs}ms 后强杀整棵进程树）\n`, 'stderr');
    };

    function onAbort() {
      terminate('取消信号');
    }

    if (spec.signal) {
      if (spec.signal.aborted) {
        // 已经取消：不启动进程
        queueMicrotask(() => {
          cancelRequested = true;
          finalize(null, 'SIGTERM');
        });
        return {
          done,
          cancel: () => terminate('取消'),
          get phase() { return phase; },
          set phase(v) { phase = v; },
          get pid() { return child?.pid ?? null; },
        };
      }
      spec.signal.addEventListener('abort', onAbort, { once: true });
    }

    try {
      child = spawn(argv[0], argv.slice(1), {
        cwd,
        env,
        shell: false,
        windowsHide: spec.windowsHide !== false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      emit(`[engine] 无法启动进程 ${argv[0]}：${error?.message ?? error}\n`, 'stderr');
      queueMicrotask(() => finalize(null, null));
      return {
        done,
        cancel: () => {},
        get phase() { return phase; },
        set phase(v) { phase = v; },
        pid: null,
      };
    }

    live.add(child);

    // 启动失败（ENOENT 等）以 error 事件呈现，转为 exitCode 127
    child.on('error', (error) => {
      emit(`[engine] 进程错误：${error?.message ?? error}\n`, 'stderr');
      finalize(127, null);
    });

    child.stdout?.on('data', (buffer) => emit(decodeChunk(buffer), 'stdout'));
    child.stderr?.on('data', (buffer) => emit(decodeChunk(buffer), 'stderr'));

    // exit 先于 close 到达：记录退出码/信号，供管道迟迟不关闭时兜底结算使用
    child.on('exit', (code, signal) => {
      seenExitCode = code === undefined ? null : code;
      seenSignal = signal ?? null;
    });

    // close 而非 exit：确保 stdio 已排空，日志不丢尾
    child.on('close', (code, signal) => {
      finalize(code === undefined ? null : code, signal);
    });

    if (timeoutMs > 0) {
      killTimer = setTimeout(() => {
        if (settled) return;
        timedOut = true;
        emit(`[engine] 执行超时（${timeoutMs}ms），正在终止\n`, 'stderr');
        terminate('超时');
      }, timeoutMs);
      // 进程超时计时器是活跃工作，不可 unref（否则宿主可能在进程结束前退出）
    }

    const handle = {
      done,
      cancel: () => terminate('取消'),
      get phase() { return phase; },
      set phase(value) { phase = value; },
      get pid() { return child?.pid ?? null; },
      get alive() { return !settled; },
    };
    return handle;
  }

  /* ------------------------------------------------------- 文件系统操作 */

  async function readDir(server, target) {
    const dir = await resolvePath(target);
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    const out = [];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      let stat = null;
      try {
        stat = await fsp.stat(full);
      } catch { /* 断链等，跳过元数据 */ }
      out.push({
        name: entry.name,
        isDir: entry.isDirectory() || Boolean(stat?.isDirectory()),
        size: stat?.size ?? 0,
        mtime: stat?.mtimeMs ?? 0,
      });
    }
    out.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
    return out;
  }

  async function stat(server, target) {
    try {
      const full = await resolvePath(target);
      const info = await fsp.stat(full);
      return {
        exists: true,
        isDir: info.isDirectory(),
        size: info.size,
        mtime: info.mtimeMs,
        mode: info.mode,
      };
    } catch (error) {
      if (error?.code === 'PATH_OUT_OF_BOUNDS') throw error;
      return { exists: false, isDir: false, size: 0, mtime: 0 };
    }
  }

  /**
   * 把模式列表规范化为契约 §3.7.1 的语义。
   * 规则：仅含取反模式时隐式补一条「全部匹配」的正模式，
   * 否则用户写「排除」会得到空集（例如只写排除 .map 的取反模式 ≡ 全部匹配再排除 .map）。
   * 空模式列表视为错误：绝不能退化成「匹配一切」。
   */
  function normalizePatterns(input) {
    const list = (Array.isArray(input) ? input : [input])
      .map((p) => String(p ?? '').trim())
      .filter((p) => p !== '');
    if (!list.length) {
      const error = new Error('glob 模式不能为空（空模式会匹配一切，已拒绝执行）');
      error.code = 'EMPTY_GLOB';
      throw error;
    }
    const hasPositive = list.some((p) => !p.startsWith('!'));
    if (hasPositive) return { patterns: list, implicitAll: false };
    return { patterns: ['**', ...list], implicitAll: true };
  }

  /**
   * glob 匹配（在 base 下遍历）——契约 §3.7.1。
   *
   * 语义：每个候选按顺序评估所有模式，**最后一个命中的决定归属**：
   * 命中正模式 → matched；命中 `!` 模式 → ignored；都没命中 → 都不进。
   *
   * @param {object} server
   * @param {string} base
   * @param {string|string[]} patterns 单字符串与单元素数组等价
   * @param {{includeDirs?:boolean, maxEntries?:number, caseSensitive?:boolean, signal?:AbortSignal}} [opts]
   * @returns {Promise<{matched:Array<{path:string,size:number}>, ignored:Array<{path:string,size:number}>,
   *                    truncated:boolean, total:number, patterns:string[]}>}
   */
  async function match(server, base, patterns, opts = {}) {
    const root = await resolvePath(base);
    const maxEntries = Number.isFinite(opts.maxEntries) ? opts.maxEntries : 5000;
    const includeDirs = opts.includeDirs === true;
    const caseSensitive = opts.caseSensitive !== false;
    const normalized = normalizePatterns(patterns);

    const globModule = await loadGlobModule();

    // 收集候选（相对路径 → 元数据），避免为每个文件重复 stat
    /** @type {Map<string, {path:string,size:number,isDir:boolean}>} */
    const candidates = new Map();
    const stack = [root];
    let total = 0;
    let truncated = false;

    while (stack.length) {
      if (opts.signal?.aborted) break;
      if (candidates.size >= maxEntries) { truncated = true; break; }
      const dir = stack.pop();
      let entries;
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch { continue; }
      for (const entry of entries) {
        if (opts.signal?.aborted) break;
        const full = path.join(dir, entry.name);
        let isDir = entry.isDirectory();
        let size = 0;
        try {
          const info = await fsp.stat(full);
          isDir = info.isDirectory();
          size = info.size;
        } catch { /* 忽略不可读项 */ }
        if (isDir) stack.push(full);
        if (isDir && !includeDirs) continue;
        total += 1;
        candidates.set(toPosix(path.relative(root, full)), { path: full, size, isDir });
        if (candidates.size >= maxEntries) { truncated = true; break; }
      }
    }

    // 归属判定：优先用 model/glob.js 的 filterPaths（唯一权威语义）；
    // 不可用时回退到内置实现，保持同样的「最后命中决定归属」规则。
    let matchedKeys;
    let ignoredKeys;
    if (globModule?.filterPaths) {
      const result = globModule.filterPaths(normalized.patterns, [...candidates.keys()], { caseSensitive });
      matchedKeys = result.matched;
      ignoredKeys = result.ignored ?? [];
    } else {
      matchedKeys = [];
      ignoredKeys = [];
      const compiled = normalized.patterns.map((p) => compileFallback(p, caseSensitive));
      for (const key of candidates.keys()) {
        let state = null;
        for (const candidate of compiled) {
          if (candidate.matchesRaw(key)) state = candidate.negated ? 'ignored' : 'matched';
        }
        if (state === 'matched') matchedKeys.push(key);
        else if (state === 'ignored') ignoredKeys.push(key);
      }
    }

    const matched = matchedKeys.map((key) => candidates.get(key)).filter(Boolean)
      .map((item) => ({ path: item.path, size: item.size }));
    const ignored = ignoredKeys.map((key) => candidates.get(key)).filter(Boolean)
      .map((item) => ({ path: item.path, size: item.size }));

    return { matched, ignored, truncated, total, patterns: normalized.patterns };
  }

  /** 内置兜底编译器：与 model/glob.js 的 compile 语义对齐（negated + matchesRaw） */
  function compileFallback(pattern, caseSensitive) {
    let negated = false;
    let body = String(pattern ?? '');
    if (body.startsWith('!')) {
      negated = true;
      body = body.slice(1);
    }
    const source = body
      .split(path.sep === '\\' ? '\\' : '/').join('/')
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '\u0000')
      .replace(/\*/g, '[^/]*')
      .replace(/\u0000/g, '.*')
      .replace(/\?/g, '[^/]');
    const regex = new RegExp(`^(?:${source})$`, caseSensitive ? '' : 'i');
    const matchesRaw = (target) => regex.test(toPosix(target));
    return { pattern, negated, matchesRaw };
  }

  /** 复制（文件或目录递归） */
  async function copyRecursive(from, to) {
    const info = await fsp.lstat(from);
    if (info.isDirectory()) {
      await fsp.mkdir(to, { recursive: true });
      for (const entry of await fsp.readdir(from)) {
        await copyRecursive(path.join(from, entry), path.join(to, entry));
      }
      return;
    }
    await fsp.mkdir(path.dirname(to), { recursive: true });
    await fsp.copyFile(from, to);
  }

  async function transferIn(server, localPath, remotePath) {
    const from = await resolvePath(localPath);
    const to = await realpathDeep(remotePath); // 目标可能不存在，不做 roots 限制（同机写入）
    if (from === to) return { ok: true, from, to, bytes: 0 };
    await copyRecursive(from, to);
    const info = await fsp.stat(to);
    return { ok: true, from, to, bytes: info.isDirectory() ? 0 : info.size };
  }

  async function transferOut(server, remotePath, localPath) {
    const from = await resolvePath(remotePath);
    const to = await realpathDeep(localPath);
    await copyRecursive(from, to);
    const info = await fsp.stat(to);
    return { ok: true, from, to, bytes: info.isDirectory() ? 0 : info.size };
  }

  /* --------------------------------------------------------------- 探测 */

  /** 跑一条命令并收集输出（probe 用） */
  async function execCapture(argv, timeoutMs = 5000) {
    let stdout = '';
    let stderr = '';
    const handle = run({
      argv,
      timeoutMs,
      onData: (chunk) => {
        if (chunk.stream === 'stderr') stderr += chunk.text;
        else stdout += chunk.text;
      },
    });
    try {
      const result = await handle.done;
      return { ...result, stdout: stdout.trim(), stderr: stderr.trim() };
    } catch (error) {
      return { exitCode: null, signal: null, timedOut: false, stdout, stderr: String(error?.message ?? error) };
    }
  }

  /**
   * 探测本机环境（契约 §3.7 probe）。
   * @returns {Promise<{os:string,arch:string,shell:string,workdir:string,runtime:object,managers:string[],sudo:string,error:string}>}
   */
  async function probe(server) {
    const result = {
      os: `${os.type()} ${os.release()}`,
      arch: os.arch(),
      shell: '',
      workdir: server?.workdir || process.cwd(),
      runtime: {},
      managers: [],
      sudo: 'none',
      error: '',
    };

    try {
      // Node：当前进程即可信
      result.runtime.node = process.version.replace(/^v/, '');

      // 解释器探测（只用 argv，不经 shell）
      const probes = [
        ['python', ['python3', '--version'], /(\d+\.\d+\.\d+)/],
        ['python', ['python', '--version'], /(\d+\.\d+\.\d+)/],
        ['node', ['node', '--version'], /v?(\d+\.\d+\.\d+)/],
        ['git', ['git', '--version'], /(\d+\.\d+\.\d+)/],
      ];
      for (const [key, argv, re] of probes) {
        if (key === 'node' || result.runtime[key]) continue;
        const out = await execCapture(argv, 4000);
        const text = `${out.stdout}\n${out.stderr}`;
        const m = text.match(re);
        if (out.exitCode === 0 && m) {
          const found = await execCapture([IS_WINDOWS ? 'where' : 'which', argv[0]], 3000);
          result.runtime[key] = {
            version: m[1],
            path: found.stdout.split(/\r?\n/)[0] || argv[0],
          };
        }
      }

      // 包管理器 / 版本管理器探测
      const managers = ['apt-get', 'yum', 'dnf', 'apk', 'brew', 'winget', 'choco', 'uv', 'nvm', 'fnm', 'mise', 'pyenv'];
      for (const manager of managers) {
        const found = await execCapture([IS_WINDOWS ? 'where' : 'which', manager], 2500);
        if (found.exitCode === 0 && found.stdout) result.managers.push(manager);
      }

      if (IS_WINDOWS) {
        result.shell = process.env.COMSPEC || 'cmd.exe';
      } else {
        const shell = process.env.SHELL || '/bin/sh';
        result.shell = shell;
        const sudo = await execCapture(['sudo', '-n', 'true'], 2500);
        result.sudo = sudo.exitCode === 0 ? 'passwordless' : 'available';
        if (sudo.exitCode === 127) result.sudo = 'none';
      }
    } catch (error) {
      result.error = String(error?.message ?? error);
    }
    return result;
  }

  /** 释放：回收所有存活子进程与句柄 */
  async function dispose() {
    disposed = true;
    for (const child of [...live]) {
      try { child.kill('SIGKILL'); } catch { /* 忽略 */ }
    }
    live.clear();
  }

  return {
    id: 'local',
    kind: 'local',
    probe,
    run,
    readDir,
    stat,
    match,
    transferIn,
    transferOut,
    dispose,
    // 契约外补充
    resolvePath,
    isLocal: true,
    host: '127.0.0.1',
  };
}

export default createLocalExecutor;
