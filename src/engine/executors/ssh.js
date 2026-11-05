/**
 * SSH 执行器（契约 §3.7）。
 *
 * ```js
 * export function createSshExecutor({ config, log, provisioner })
 * ```
 *
 * 返回的 Executor 与 local 执行器**接口完全一致**：
 *   { id:'ssh:<serverId>', kind:'ssh',
 *     probe(server), run(spec), readDir(server,path), stat(server,path),
 *     match(server,base,glob,opts), transferIn(server,local,remote),
 *     transferOut(server,remote,local), dispose() }
 *
 * 实现要点：
 * - ssh2 是**可选依赖**：只在真正建连时 `await import('ssh2')`；缺失时抛清晰错误；
 * - 连接按 serverId 复用（transport 工厂持有连接池），dispose() 时统一关闭；
 * - run(spec) 的命令行由 `ssh/shell.js` 安全构造（逐参数单引号转义），
 *   **用户输入不进入 shell 解释**；唯一例外是显式 script（用户脚本本身）；
 * - 远端 pid 不可靠（命令由登录 shell 承载），取消是「尽力终止」，如实标注 pidKnown:false。
 */
import {
  RemoteCommandError,
  RemotePathError,
  SshError,
} from './ssh/errors.js';
import { createSshTransportFactory } from './ssh/transport.js';
import { assertAuthConfig } from './ssh/auth.js';
import { buildCommandLine, assertInsideBase, normalizeRemotePath, resolveRemotePath } from './ssh/shell.js';
import {
  ensureRemoteDir,
  guardRemotePath,
  listDir,
  realPath,
  statPath,
  transferIn as fsTransferIn,
  transferOut as fsTransferOut,
  walkFiles,
} from './ssh/remote-fs.js';
import {
  loadFilterPaths,
  loadMatchOne,
  matchEntries,
  matchWithFilterPaths,
  normalizePatterns,
  requirePattern,
  withImplicitInclude,
} from './ssh/glob.js';
import { buildProbeScript, composeProbe, emptyProbe } from '../provision/probe.js';
import { emitLog, normalizeError, truncate } from './ssh/util.js';

export { buildCommandLine } from './ssh/shell.js';
export { loadSsh2, createSshTransportFactory, createSsh2Transport } from './ssh/transport.js';
export { SshDependencyError, SshConnectionError, SSH2_MISSING_HINT } from './ssh/errors.js';
export { composeProbe } from '../provision/probe.js';
export { fallbackMatchOne, fallbackFilterPaths, globToRegExp, withImplicitInclude } from './ssh/glob.js';

/**
 * @param {object} options
 * @param {object} options.server 契约 §2.3 的 Server（必填）
 * @param {object} [options.config] 插件配置
 * @param {unknown} [options.log]
 * @param {unknown} [options.provisioner]
 * @param {unknown} [options.ctx]
 * @param {Function} [options.transportFor] 注入自定义 transport（**verifier 的 mock 注入点**）
 * @param {unknown} [options.loadModule] 注入假 ssh2 模块
 * @param {Function} [options.transportFactory] 复用外部连接池
 */
export function createSshExecutor(options = {}) {
  const { server, config = {}, log, provisioner, ctx, transportFor, loadModule, transportFactory, credentials } = options;

  if (!server || typeof server !== 'object') {
    throw new SshError('createSshExecutor 需要 server 参数', 'missing-server');
  }
  // 配置级安全守卫：无论 ssh2 是否安装、是否真的建连，
  // kind:'ssh' + auth.type:'none' 都必须立刻被拒（禁止静默无认证连接）。
  assertAuthConfig(server);
  const serverId = String(server.id ?? server.host ?? 'unknown');
  const maxReadBytes = Number(config.maxReadBytes ?? 8 * 1024 * 1024);

  const factory =
    transportFactory ||
    createSshTransportFactory({ config, log, ctx, transportFor, loadModule, credentials });

  /** 每条连接访问 base 路径的确认缓存（避免每次操作都多一次 realpath 往返）。 */
  const baseCache = new Map();

  /** 当前阶段：契约 §2.5 的 phase 字段，引擎可读写。 */
  const state = { phase: 'queued', disposed: false };

  /** 取 transport（同一 server 复用连接）。 */
  async function transport() {
    if (state.disposed) throw new SshError('执行器已 dispose，无法继续使用', 'executor-disposed');
    return factory.open(server);
  }

  /**
   * 解析并校验远端路径（契约 §5.3 containment）。
   * base 取 server.workdir（未配置时为远端 home 或 `/`）。
   */
  async function safePath(target, opts = {}) {
    const tr = await transport();
    const base = baseOf(tr);
    const raw = String(target ?? '');
    const resolved = raw.startsWith('/') ? normalizeRemotePath(raw) : resolveRemotePath(base, raw, homeOf(tr));
    if (opts.allowOutsideBase === true) return resolved;

    // 词法 containment 先行（挡住 ../ 越界）
    guardRemotePath(base, resolved);

    // 若远端支持 realpath，再做一次真实路径校验（挡住符号链接逃逸）
    if (config.verifyRealpath !== false) {
      try {
        const sftp = await tr.sftp();
        const cacheKey = `${base}\u0000${resolved}`;
        if (baseCache.get(cacheKey) === true) return resolved;
        const real = await realPath(sftp, resolved);
        const realBase = await realPath(sftp, base);
        if (real && realBase) {
          guardRemotePath(realBase, real);
          baseCache.set(cacheKey, true);
        }
      } catch {
        // realpath 失败（例如目标尚不存在）：回退到词法校验结果
      }
    }
    return resolved;
  }

  function baseOf(tr) {
    return normalizeRemotePath(server.workdir || tr.remoteHome || '/');
  }

  function homeOf(tr) {
    return tr.remoteHome || server.home || '';
  }

  const executor = {
    id: `ssh:${serverId}`,
    kind: 'ssh',
    serverId,
    /** transport 厂（测试可直接替换/检查连接池） */
    transportFactory: factory,

    get phase() {
      return state.phase;
    },
    set phase(value) {
      state.phase = value;
    },

    /**
     * 探测远端环境（契约 §3.7 probe → server.probe 形状）。
     * @param {object} [targetServer]
     */
    async probe(targetServer) {
      const target = targetServer || server;
      state.phase = 'connecting';
      const tr = await transport();
      state.phase = 'running';
      try {
        const res = await runCapture(tr, `/bin/sh -c ${shellQuote(buildProbeScript())}`, {
          timeoutMs: Number(config.probeTimeoutMs ?? 20_000),
        });
        if (res.exitCode !== 0 && !res.stdout.trim()) {
          return emptyProbe(`探测脚本退出码 ${res.exitCode}${res.stderr ? `：${truncate(res.stderr, 200)}` : ''}`);
        }
        const { probe } = composeProbe(res.stdout, { exitCode: res.exitCode, stderr: res.stderr });
        // 写回 server.probe（与契约 §3.8 的 probe 行为保持一致）
        try {
          target.probe = probe;
        } catch {
          /* 冻结对象忽略 */
        }
        return probe;
      } finally {
        state.phase = 'settled';
      }
    },

    /**
     * 执行命令（契约 §3.7）。
     *
     * spec: { argv, script, cwd, env, timeoutMs, signal, label, onData }
     * handle: { done: Promise<{exitCode,signal}>, cancel(), phase }
     */
    async run(spec = {}) {
      const tr = await transport();
      const command = buildCommandLine({
        argv: spec.argv,
        script: spec.script,
        cwd: spec.cwd || server.workdir || '',
        env: spec.env,
        sudo: spec.sudo ?? spec.elevated,
        shell: spec.shell || server.shell || '',
        home: homeOf(tr),
      });

      const label = spec.label || 'ssh.run';
      state.phase = 'running';
      emitLog(log, 'debug', `[${label}] ${executor.id} $ ${truncate(command, 500)}`);

      const timeoutMs = Number(spec.timeoutMs ?? config.defaultTimeoutMs ?? 600_000);
      /** @type {AbortController|null} */
      let timeoutController = null;
      let timer = null;
      const signals = [spec.signal].filter(Boolean);
      if (timeoutMs > 0) {
        timeoutController = new AbortController();
        signals.push(timeoutController.signal);
        timer = setTimeout(() => timeoutController.abort(new Error('timeout')), timeoutMs);
        timer.unref?.();
      }
      const merged = signals.length > 1 ? AbortSignal.any(signals) : signals[0];

      const onData = typeof spec.onData === 'function' ? spec.onData : null;
      const handle = await tr.exec({
        command,
        timeoutMs: 0, // 超时由上面的 AbortController 统一管理，避免两条超时路径
        signal: merged,
        onStdout: (text) => onData?.({ text, stream: 'stdout' }),
        onStderr: (text) => onData?.({ text, stream: 'stderr' }),
      });

      const done = (async () => {
        state.phase = 'draining';
        try {
          const result = await handle.done;
          const timedOut = Boolean(result.timedOut) || Boolean(timeoutController?.signal.aborted && !result.canceled);
          if (timedOut) {
            emitLog(log, 'warn', `[${label}] 执行超时（${timeoutMs}ms），已请求终止远端命令。`);
          }
          return {
            exitCode: result.exitCode,
            signal: timedOut ? 'TIMEOUT' : result.signal,
            timedOut,
            canceled: Boolean(result.canceled),
            // 如实标注：SSH 通道拿不到可靠的远端 pid
            pidKnown: false,
          };
        } finally {
          if (timer) clearTimeout(timer);
          state.phase = 'settled';
        }
      })();

      const cancelHandle = (reason) => {
        try {
          handle.cancel(reason);
        } catch {
          /* 忽略 */
        }
      };

      return {
        done,
        cancel: cancelHandle,
        get phase() {
          return state.phase;
        },
        set phase(value) {
          state.phase = value;
        },
        command,
      };
    },

    /** 列出远端目录（契约 §3.7）。 */
    async readDir(targetServer, dirPath) {
      const tr = await transport();
      const resolved = await safePath(dirPath);
      const sftp = await tr.sftp();
      return await listDir(sftp, resolved);
    },

    /** 远端 stat（契约 §3.7）。 */
    async stat(targetServer, targetPath) {
      const tr = await transport();
      const resolved = await safePath(targetPath);
      const sftp = await tr.sftp();
      return await statPath(sftp, resolved);
    },

    /**
     * 远端 glob 匹配（契约 §3.7 / §3.7.1）。
     *
     * 签名：`match(server, base, patterns, opts)`，`patterns` 可为 string 或 string[]。
     * 语义采用 **`filterPaths`（唯一权威）**：最后一个命中的模式决定归属，
     * 正模式 → `matched`，`!` 模式 → `ignored`，都不命中 → 两者都不进；
     * 仅含取反模式时隐式补 `**`（`['!**\/*.map']` ≡ `['**','!**\/*.map']`）。
     *
     * 实现策略：SFTP 遍历候选文件 + **复用 src/model/glob.js 的 filterPaths/matchesRaw**
     * 做本地匹配。刻意**不用 `find`**：那需要把用户 glob 交给远端 shell 解释，违反 §5.1。
     *
     * @returns {Promise<{matched:Array<{path:string,size:number}>, ignored:Array<{path:string,size:number}>, truncated:boolean, total:number, patterns:string[], source:string, errors?:string[]}>}
     */
    async match(targetServer, base, patterns, opts = {}) {
      const list = normalizePatterns(patterns);
      if (list.length === 0) {
        throw new RemotePathError('match() 需要非空 glob（string 或 string[]）', 'empty-glob');
      }
      const tr = await transport();
      const resolvedBase = await safePath(base || '.');
      const sftp = await tr.sftp();
      const matcher = await loadFilterPaths();

      // 枚举 base 之下的候选文件（walk 自带上限）
      const maxEntries = Number(opts.maxEntries ?? config.maxMatchEntries ?? 20_000);
      const walk = await walkFiles(sftp, resolvedBase, {
        maxEntries,
        maxDepth: Number(opts.maxDepth ?? 12),
        signal: opts.signal,
        log,
      });

      // 相对 pattern 展开成 base 下的绝对形式，保证与枚举出的绝对路径可比
      const absolutePatterns = list.map((p) => {
        const negated = p.startsWith('!');
        const body = negated ? p.slice(1) : p;
        if (body.startsWith('/')) return p;
        const joined = `${resolvedBase === '/' ? '' : resolvedBase}/${body}`;
        return negated ? `!${joined}` : joined;
      });

      const result = matchWithFilterPaths(matcher, absolutePatterns, walk.entries, {
        maxEntries,
        caseSensitive: opts.caseSensitive !== false,
      });

      const truncated = result.truncated || walk.truncated;
      if (truncated) {
        emitLog(log, 'warn', `远端匹配达到上限（maxEntries=${maxEntries}），结果可能不完整。`);
      }
      return {
        matched: result.matched,
        ignored: result.ignored,
        truncated,
        total: result.total,
        // 回传**用户口径**的模式（含隐式补的 `**`），而不是内部展开成绝对路径的形式，
        // 便于界面直接向用户解释「你写的模式被如何理解」。
        patterns: withImplicitInclude(list),
        source: matcher.source,
        errors: walk.errors,
      };
    },

    /** 上传（契约 §3.7）：目录递归。 */
    async transferIn(targetServer, localPath, remotePath) {
      const tr = await transport();
      const resolved = await safePath(remotePath);
      const sftp = await tr.sftp();
      state.phase = 'transferring';
      try {
        return await fsTransferIn(sftp, localPath, resolved, { log });
      } finally {
        state.phase = 'settled';
      }
    },

    /** 下载（契约 §3.7）：目录递归。 */
    async transferOut(targetServer, remotePath, localPath) {
      const tr = await transport();
      const resolved = await safePath(remotePath);
      const sftp = await tr.sftp();
      state.phase = 'transferring';
      try {
        return await fsTransferOut(sftp, resolved, localPath, { log });
      } finally {
        state.phase = 'settled';
      }
    },

    /** 读取小文件内容（text/日志用；有大小上限）。 */
    async readFile(targetServer, remotePath, opts = {}) {
      const tr = await transport();
      const resolved = await safePath(remotePath);
      const sftp = await tr.sftp();
      const info = await statPath(sftp, resolved);
      if (!info.exists) throw new RemotePathError(`远端文件不存在：${resolved}`, 'no-such-file');
      if (info.size > maxReadBytes && opts.force !== true) {
        throw new RemotePathError(
          `远端文件过大（${info.size} 字节 > 上限 ${maxReadBytes}），请改用 transferOut 下载。`,
          'file-too-large',
        );
      }
      const { invoke } = await import('./ssh/remote-fs.js');
      const data = await invoke(sftp, 'readFile', [resolved]);
      return typeof data === 'string' ? data : String(data);
    },

    /** 写入远端文件（如上传生成的脚本/产物）。 */
    async writeFile(targetServer, remotePath, content) {
      const tr = await transport();
      const resolved = await safePath(remotePath);
      const sftp = await tr.sftp();
      const { invoke } = await import('./ssh/remote-fs.js');
      await ensureRemoteDir(sftp, dirnamePosix(resolved));
      const payload = Buffer.isBuffer(content) ? content : Buffer.from(String(content ?? ''), 'utf8');
      await invoke(sftp, 'writeFile', [resolved, payload]);
      return { path: resolved, bytes: payload.length };
    },

    /** 建立远端目录。 */
    async mkdir(targetServer, remotePath) {
      const tr = await transport();
      const resolved = await safePath(remotePath);
      const sftp = await tr.sftp();
      await ensureRemoteDir(sftp, resolved);
      return { path: resolved };
    },

    /** 借给供给器用的低层执行能力（保持单一执行通道）。 */
    async execRaw(argv, opts = {}) {
      const tr = await transport();
      const command = buildCommandLine({
        argv,
        cwd: opts.cwd ?? server.workdir ?? '',
        env: opts.env,
        sudo: opts.sudo,
        home: homeOf(tr),
      });
      const res = await runCapture(tr, command, { timeoutMs: opts.timeoutMs ?? 60_000, signal: opts.signal });
      return { ...res, command };
    },

    /** 释放连接（契约 §3.7）。 */
    async dispose() {
      state.disposed = true;
      state.phase = 'settled';
      baseCache.clear();
      if (transportFactory) {
        // 外部池：只关自己这条，不影响同一池里的其它 server
        await factory.close?.(serverId);
        return;
      }
      await factory.closeAll?.();
    },

    /** 诊断信息（不属于契约，但便于前端展示连接来源）。 */
    describe() {
      return {
        id: executor.id,
        kind: 'ssh',
        host: server.host,
        port: server.port ?? 22,
        user: server.user,
        workdir: server.workdir || '',
        phase: state.phase,
        disposed: state.disposed,
      };
    },
  };

  // 供 verifier 断言「glob 确实复用了契约实现」
  executor.globSource = () => loadMatchOne().then((m) => ({ source: m.source, error: m.error }));

  return executor;
}

/** 单引号转义（探测脚本作为单个 argv 传递）。 */
function shellQuote(value) {
  return `'${String(value).split("'").join(`'\\''`)}'`;
}

/**
 * 在 transport 上执行一条已构造好的命令行，并收集全部输出。
 *
 * **transport 契约的最小面**：只需实现 `exec()`。
 * 若 transport 额外提供了 `readString()`（本插件自带的 ssh2 transport 就有），则优先用它；
 * 否则退化为「用 exec() 收集 stdout/stderr」。
 * 这样 verifier 的 mock 只实现 exec() 就能覆盖 probe/execRaw 等路径。
 *
 * @param {any} tr
 * @param {string} command
 * @param {{ timeoutMs?: number, signal?: AbortSignal }} [opts]
 * @returns {Promise<{ stdout: string, stderr: string, exitCode: number|null, signal: string|null, timedOut: boolean }>}
 */
export async function runCapture(tr, command, opts = {}) {
  if (typeof tr?.readString === 'function') {
    const res = await tr.readString(command, opts);
    return {
      stdout: res?.stdout ?? '',
      stderr: res?.stderr ?? '',
      exitCode: res?.exitCode ?? null,
      signal: res?.signal ?? null,
      timedOut: Boolean(res?.timedOut),
    };
  }
  if (typeof tr?.exec !== 'function') {
    throw new SshError('transport 既没有 readString() 也没有 exec()，无法执行命令', 'transport-incomplete');
  }
  const stdout = [];
  const stderr = [];
  const handle = await tr.exec({
    command,
    timeoutMs: opts.timeoutMs ?? 0,
    signal: opts.signal,
    onStdout: (text) => stdout.push(typeof text === 'string' ? text : text?.text ?? ''),
    onStderr: (text) => stderr.push(typeof text === 'string' ? text : text?.text ?? ''),
  });
  const result = await handle.done;
  return {
    stdout: stdout.join(''),
    stderr: stderr.join(''),
    exitCode: result?.exitCode ?? null,
    signal: result?.signal ?? null,
    timedOut: Boolean(result?.timedOut),
  };
}

function dirnamePosix(p) {
  const idx = String(p).lastIndexOf('/');
  if (idx <= 0) return '/';
  return String(p).slice(0, idx);
}

/** 便捷工厂：按契约从 server 列表批量建执行器（executors/index.js 可用）。 */
export function createSshExecutors(servers = [], options = {}) {
  return servers
    .filter((s) => s && (s.kind === 'ssh' || (s.host && s.host !== '127.0.0.1' && s.host !== 'localhost')))
    .map((s) => createSshExecutor({ ...options, server: s }));
}

export { assertInsideBase, ensureRemoteDir };
