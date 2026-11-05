/**
 * SSH transport：把 ssh2 封装成**可注入、可替换**的最小接口。
 *
 * 为什么要多这一层（契约 task-3 硬要求）：
 * - verifier 必须能在**不连网、不装 ssh2** 的前提下做契约测试；
 * - ssh2 是可选依赖，只能在真正建连时 `await import('ssh2')`，不能顶层 import；
 * - 将来若要换实现（例如 openssh 子进程），只替换 transport 即可，Executor 不动。
 *
 * transport 接口（verifier 的 mock 只需实现这些）：
 *   transport.id                       // 'ssh:<serverId>'
 *   await transport.ensureConnected()  // 建连（幂等）
 *   transport.exec({ command, onStdout, onStderr, timeoutMs, signal })
 *        → { done: Promise<{exitCode, signal, timedOut}>, cancel(reason), command }
 *   await transport.sftp()             // → sftp 会话（readdir/stat/lstat/mkdir/fastPut/fastGet/…）
 *   transport.isConnected()
 *   await transport.close()
 *   transport.remoteHome               // 探测到/配置的远端 home（可空）
 */
import { createUtf8Decoder, emitLog, normalizeError, toText, truncate } from './util.js';
import {
  SSH2_MISSING_HINT,
  SshDependencyError,
  SshError,
  isModuleNotFound,
  toConnectionError,
} from './errors.js';
import { assertAuthConfig, createHostVerifier, resolveAuth } from './auth.js';
import { normalizePort } from './shell.js';

/**
 * 惰性加载 ssh2。只有真正要用 SSH 时才加载；缺失时抛**清晰、可操作**的错误。
 *
 * @param {object} [options]
 * @param {unknown} [options.module] 测试注入：直接给一个假的 ssh2 模块
 * @returns {Promise<any>}
 */
export async function loadSsh2(options = {}) {
  if (options.module) return options.module;
  try {
    const mod = await import('ssh2');
    return mod?.default && mod?.Client === undefined ? mod.default : mod;
  } catch (error) {
    if (isModuleNotFound(error, 'ssh2')) {
      throw new SshDependencyError(SSH2_MISSING_HINT);
    }
    throw new SshError(`加载 ssh2 失败：${normalizeError(error).message}`, 'ssh2-load-failed');
  }
}

/**
 * 创建 transport 工厂（含**连接复用池**：同一 serverId 复用一条连接）。
 *
 * @param {object} options
 * @param {object} [options.config] 插件配置（readyTimeout/keepaliveInterval/hostFingerprint…）
 * @param {unknown} [options.log]
 * @param {unknown} [options.ctx] 宿主上下文（惰性取 credentials）
 * @param {unknown} [options.loadModule] 测试注入的假 ssh2 模块
 * @param {Function} [options.transportFor] 完全自定义：给定 server 返回 transport（mock 注入点）
 */
export function createSshTransportFactory(options = {}) {
  const { config = {}, log, ctx, loadModule, transportFor, credentials } = options;
  /** @type {Map<string, { transport: any, promise: Promise<any>|null }>} */
  const pool = new Map();

  return {
    /**
     * 取得某个 server 的 transport（复用已建连接）。
     * @param {object} server
     */
    async open(server) {
      const id = String(server?.id ?? `${server?.host}:${server?.port}`);
      const existing = pool.get(id);
      if (existing && existing.transport && !existing.transport.isConnected?.() === false) {
        // isConnected() 明确为 true 才复用
        if (existing.transport.isConnected?.()) return existing.transport;
      }
      if (existing && existing.promise) return existing.promise;

      const promise = (async () => {
        const transport =
          typeof transportFor === 'function'
            ? await transportFor(server, { config, log, ctx })
            : createSsh2Transport({ server, config, log, ctx, loadModule, credentials });
        await transport.ensureConnected();
        return transport;
      })();

      pool.set(id, { transport: null, promise });
      try {
        const transport = await promise;
        pool.set(id, { transport, promise: null });
        return transport;
      } catch (error) {
        pool.delete(id);
        throw error;
      }
    },

    /** 连接池当前条目数（调试/测试用）。 */
    get size() {
      return pool.size;
    },

    /** 关闭某个 server 的连接。 */
    async close(id) {
      const entry = pool.get(String(id));
      if (!entry) return;
      pool.delete(String(id));
      try {
        await entry.transport?.close?.();
      } catch {
        /* 关闭失败无所谓 */
      }
    },

    /** 关闭全部连接（Executor.dispose() 调用）。 */
    async closeAll() {
      const entries = [...pool.values()];
      pool.clear();
      await Promise.all(
        entries.map(async (entry) => {
          try {
            const t = entry.transport || (await entry.promise?.catch(() => null));
            await t?.close?.();
          } catch {
            /* 忽略 */
          }
        }),
      );
    },
  };
}

/**
 * 基于 ssh2 的真实 transport。
 *
 * @param {object} options
 * @param {object} options.server 契约 §2.3 Server
 * @param {object} [options.config]
 * @param {unknown} [options.log]
 * @param {unknown} [options.ctx]
 * @param {unknown} [options.loadModule]
 */
export function createSsh2Transport({ server, config = {}, log, ctx, loadModule, credentials }) {
  const host = server?.host || '';
  const port = normalizePort(server?.port, 22);
  const user = server?.user || config.defaultUser || 'root';
  const label = `${user}@${host}:${port}`;
  const readyTimeout = Number(config.connectTimeoutMs ?? server?.connectTimeoutMs ?? 20_000);
  const keepaliveInterval = Number(config.keepaliveIntervalMs ?? 15_000);

  /** @type {any} */
  let client = null;
  /** @type {any} */
  let sftpSession = null;
  let connecting = null;
  let secrets = [];
  let closed = false;
  const openStreams = new Set();

  const transport = {
    id: `ssh:${server?.id ?? label}`,
    kind: 'ssh',
    label,
    remoteHome: server?.home || '',

    isConnected() {
      return Boolean(client) && !closed && client.__dshReady === true;
    },

    /** 建连（幂等）：认证、指纹、超时都在这里一次性完成，失败原因分类后抛出。 */
    async ensureConnected() {
      if (transport.isConnected()) return transport;
      if (connecting) return connecting;

      connecting = (async () => {
        // 先做认证配置校验（安全守卫），再加载可选依赖：
        // 这样 kind:'ssh' + auth.type:'none' 这类**配置层面的拒绝**不会被
        // 「ssh2 未安装」的报错掩盖掉，用户拿到的永远是真正的原因。
        assertAuthConfig(server);

        const ssh2 = await loadSsh2({ module: loadModule });
        const ClientCtor = ssh2?.Client || ssh2?.default?.Client || ssh2?.default;
        if (typeof ClientCtor !== 'function') {
          throw new SshError('ssh2 模块形状异常：找不到 Client 构造函数', 'ssh2-bad-module');
        }

        const authInfo = await resolveAuth(server, { ctx, config, log, credentials });
        secrets = authInfo.secrets;
        const verifier = createHostVerifier(server, config, log);

        if (!host) throw new SshError('服务器未配置 host，无法建立 SSH 连接', 'missing-host');

        const conn = new ClientCtor();
        conn.__dshReady = false;

        const params = {
          host,
          port,
          username: user,
          readyTimeout,
          keepaliveInterval,
          keepaliveCountMax: Number(config.keepaliveCountMax ?? 3),
          // 认证失败不静默重试：ssh2 的 authHandler 默认会穷举，这里显式限定为单一方式
          tryKeyboard: false,
          ...authInfo.auth,
        };
        if (verifier.hostVerifier) params.hostVerifier = verifier.hostVerifier;
        // 指纹严格校验模式下，ssh2 的 hostVerifier 返回 false 会直接报错，不会降级重试。

        emitLog(log, 'debug', `SSH 连接 ${label}（认证方式 ${authInfo.method}）…`);

        await new Promise((resolve, reject) => {
          const onReady = () => {
            cleanup();
            conn.__dshReady = true;
            emitLog(log, 'info', `SSH 已连接 ${label}`);
            resolve();
          };
          const onError = (error) => {
            cleanup();
            reject(toConnectionError(error, label));
          };
          const onClose = () => {
            cleanup();
            reject(toConnectionError(new Error('连接在握手完成前被关闭'), label));
          };
          const cleanup = () => {
            conn.off?.('ready', onReady);
            conn.off?.('error', onError);
            conn.off?.('close', onClose);
          };
          conn.on?.('ready', onReady);
          conn.on?.('error', onError);
          conn.on?.('close', onClose);
          try {
            conn.connect(params);
          } catch (error) {
            cleanup();
            reject(toConnectionError(error, label));
          }
        });

        // 连接级错误只记录，不抛出（避免未捕获异常）；具体失败在 exec 的 done 里体现。
        conn.on?.('error', (error) => {
          conn.__dshReady = false;
          emitLog(log, 'warn', `SSH 连接 ${label} 出错：${normalizeError(error).message}`);
        });
        conn.on?.('close', () => {
          conn.__dshReady = false;
        });

        client = conn;

        // 远端 home：`echo $HOME` 一次性探测，供 `~` 展开（SFTP 不做 shell 展开）。
        try {
          const home = await transport.readString('printf %s "$HOME"');
          if (home && home.startsWith('/')) transport.remoteHome = home.trim();
        } catch {
          /* 拿不到就用配置值 */
        }
        return transport;
      })();

      try {
        return await connecting;
      } finally {
        connecting = null;
      }
    },

    /**
     * 执行一条命令（**命令行已由 shell.js 安全构造**，本函数不再拼接用户输入）。
     *
     * @param {object} spec
     * @param {string} spec.command
     * @param {(text: string) => void} [spec.onStdout]
     * @param {(text: string) => void} [spec.onStderr]
     * @param {number} [spec.timeoutMs]
     * @param {AbortSignal} [spec.signal]
     */
    async exec(spec = {}) {
      await transport.ensureConnected();
      const command = String(spec.command ?? '');
      if (!command) throw new SshError('exec() 缺少 command', 'empty-command');

      const stream = await new Promise((resolve, reject) => {
        client.exec(command, (error, s) => (error ? reject(new SshError(`远端 exec 失败：${error.message}`, 'exec-failed')) : resolve(s)));
      });
      openStreams.add(stream);

      const decoderOut = createUtf8Decoder();
      const decoderErr = createUtf8Decoder();
      let settled = false;
      let canceled = false;
      let cancelReason = '';
      /** @type {NodeJS.Timeout|null} */
      let timer = null;

      const done = new Promise((resolve) => {
        const finish = (result) => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          openStreams.delete(stream);
          if (spec.signal && onAbort) spec.signal.removeEventListener('abort', onAbort);
          resolve({
            exitCode: result.exitCode ?? null,
            signal: result.signal ?? null,
            timedOut: Boolean(result.timedOut),
            canceled,
            cancelReason,
            // 如实标注：ssh2 只看得到通道级的退出码/信号，拿不到可靠的远端 pid。
            pidKnown: false,
          });
        };

        stream.on('data', (chunk) => {
          const text = decoderOut(chunk);
          if (text && spec.onStdout) safeCall(spec.onStdout, text);
        });
        stream.stderr?.on('data', (chunk) => {
          const text = decoderErr(chunk);
          if (text && spec.onStderr) safeCall(spec.onStderr, text);
        });
        stream.on('close', (code, signal) => {
          // 冲刷解码器尾巴（不完整多字节序列）
          const tailOut = decoderOut();
          const tailErr = decoderErr();
          if (tailOut && spec.onStdout) safeCall(spec.onStdout, tailOut);
          if (tailErr && spec.onStderr) safeCall(spec.onStderr, tailErr);
          finish({ exitCode: typeof code === 'number' ? code : null, signal: signal || null });
        });
        stream.on('error', (error) => {
          emitLog(log, 'warn', `SSH 命令流出错：${normalizeError(error).message}`);
          finish({ exitCode: null, signal: null });
        });

        if (spec.timeoutMs && Number(spec.timeoutMs) > 0) {
          timer = setTimeout(() => {
            cancel(`超时（${Number(spec.timeoutMs)}ms）`);
            finish({ exitCode: null, signal: 'TIMEOUT', timedOut: true });
          }, Number(spec.timeoutMs));
          timer.unref?.();
        }
      });

      const onAbort = spec.signal
        ? () => {
            cancel('调用方取消');
          }
        : null;
      if (onAbort) {
        if (spec.signal.aborted) onAbort();
        else spec.signal.addEventListener('abort', onAbort, { once: true });
      }

      /**
       * 取消：先发 SSH 信号请求，宽限期后强杀通道。
       * 远端 pid 不可靠（命令由登录 shell 承载），所以这里**只承诺尽力终止**。
       */
      function cancel(reason = '用户取消') {
        if (settled) return;
        canceled = true;
        cancelReason = reason;
        try {
          stream.signal?.('TERM');
        } catch {
          /* 部分服务端不支持 signal 请求 */
        }
        const grace = Number(config.cancelGraceMs ?? 3000);
        const killTimer = setTimeout(() => {
          try {
            stream.signal?.('KILL');
          } catch {
            /* 忽略 */
          }
          try {
            stream.close?.();
          } catch {
            /* 忽略 */
          }
          try {
            stream.destroy?.();
          } catch {
            /* 忽略 */
          }
        }, grace);
        killTimer.unref?.();
      }

      return { done, cancel, command, pidKnown: false };
    },

    /** 执行命令并收集全部输出（探测等短命令用）。 */
    async readString(command, options = {}) {
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
    },

    /** 取 SFTP 会话（懒创建 + 复用）。 */
    async sftp() {
      await transport.ensureConnected();
      if (sftpSession) return sftpSession;
      sftpSession = await new Promise((resolve, reject) => {
        client.sftp((error, sftp) => (error ? reject(new SshError(`建立 SFTP 会话失败：${error.message}`, 'sftp-failed')) : resolve(sftp)));
      });
      return sftpSession;
    },

    /** 关闭连接与会话（幂等）。 */
    async close() {
      closed = true;
      sftpSession = null;
      for (const stream of openStreams) {
        try {
          stream.close?.();
          stream.destroy?.();
        } catch {
          /* 忽略 */
        }
      }
      openStreams.clear();
      const conn = client;
      client = null;
      if (conn) {
        try {
          conn.end?.();
        } catch {
          /* 忽略 */
        }
      }
      emitLog(log, 'debug', `SSH 连接 ${label} 已关闭`);
    },

    /** 暴露给日志打码用（绝不外泄到日志内容里）。 */
    get secrets() {
      return secrets;
    },
  };

  return transport;
}

function safeCall(fn, arg) {
  try {
    fn(arg);
  } catch {
    /* 回调异常不能打断流读取 */
  }
}

/** 供错误信息使用的输出摘要（已截断）。 */
export function summarizeSshOutput(stdout, stderr) {
  return truncate(`${toText(stdout)}${toText(stderr)}`, 2000);
}
