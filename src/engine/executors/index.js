/**
 * src/engine/executors/index.js —— 执行器注册表（契约 §3.7）
 *
 * - resolve(server)：按 kind 与 isLocalHost(host) 判定走 local 还是 ssh。
 * - ssh 执行器由 remote 队友提供（./ssh.js），**惰性 import**：文件尚不存在时
 *   只有在真正需要 ssh 时才抛清晰错误，不影响纯本地场景。
 * - 每个 serverId 的 ssh 执行器做连接复用（同一实例多次 resolve 返回同一对象）。
 */
import { createLocalExecutor } from './local.js';

/** 视为「本机」的 host 取值 */
const LOCAL_HOSTS = new Set(['local', 'localhost', '127.0.0.1', '::1', '0.0.0.0', 'host.docker.internal']);

/**
 * 判定某个 server 是否应作为本机执行。
 * @param {object} server
 * @returns {boolean}
 */
export function isLocalHost(server) {
  if (!server) return true;
  if (server.kind === 'local') return true;
  if (server.kind === 'ssh') return false;
  const host = String(server.host ?? '').trim().toLowerCase();
  if (!host) return true;
  return LOCAL_HOSTS.has(host);
}

/** 惰性加载 ssh 执行器工厂（缺失时给出可执行的修复建议） */
let sshFactoryPromise = null;
async function loadSshFactory() {
  if (!sshFactoryPromise) {
    sshFactoryPromise = import('./ssh.js')
      .then((mod) => {
        const factory = mod.createSshExecutor ?? mod.default;
        if (typeof factory !== 'function') {
          throw new Error('src/engine/executors/ssh.js 未导出 createSshExecutor');
        }
        return factory;
      })
      .catch((error) => {
        sshFactoryPromise = null; // 允许稍后重试（文件可能后续落盘）
        const wrapped = new Error(
          `SSH 执行器不可用：${error?.message ?? error}。` +
          '请确认 src/engine/executors/ssh.js 已安装，或把服务器 kind 改为 local。',
        );
        wrapped.code = 'SSH_EXECUTOR_UNAVAILABLE';
        wrapped.cause = error;
        throw wrapped;
      });
  }
  return sshFactoryPromise;
}

/**
 * 创建执行器注册表。
 * @param {{ctx?:object, log?:object, provisioner?:object, config?:object}} options
 */
export function createExecutorRegistry(options = {}) {
  const { ctx, log, provisioner, config } = options;

  /** 本机执行器为单例 */
  const localExecutor = createLocalExecutor({ config, log });
  /** @type {Map<string, object>} serverId → ssh executor */
  const sshExecutors = new Map();
  /** 记录各 server 的身份，用于 list() */
  const known = new Map();
  known.set('local', { id: 'local', kind: 'local', serverId: 'local' });

  function serverIdOf(server) {
    return String(server?.id ?? server?.host ?? 'local');
  }

  /**
   * 解析 server 对应的执行器。
   * @param {object} server
   * @returns {object} Executor（local 为同步返回；ssh 场景下 resolveAsync 才是全功能入口）
   */
  function resolve(server) {
    if (isLocalHost(server)) {
      known.set('local', { id: 'local', kind: 'local', serverId: 'local' });
      return localExecutor;
    }
    const serverId = serverIdOf(server);
    const cached = sshExecutors.get(serverId);
    if (cached) return cached;

    // 首次使用：创建占位代理，真正调用方法时才惰性加载 ssh.js。
    // 这样 resolve() 保持同步（契约要求），失败在方法调用点以清晰错误抛出。
    const proxy = createLazySshExecutor(server, serverId, { config, log, provisioner, ctx });
    sshExecutors.set(serverId, proxy);
    known.set(serverId, { id: `ssh:${serverId}`, kind: 'ssh', serverId });
    return proxy;
  }

  /** 异步解析（供需要立刻知道 ssh 是否可用的调用方） */
  async function resolveAsync(server) {
    if (isLocalHost(server)) return resolve(server);
    const factory = await loadSshFactory();
    const serverId = serverIdOf(server);
    let executor = sshExecutors.get(serverId);
    if (!executor || executor.__lazy) {
      // 必须把 server 传给工厂：createSshExecutor 依赖它做认证配置校验
      // （auth.type:'none' 守卫）与连接参数解析。漏传会让**任何** SSH 服务器
      // 报「createSshExecutor 需要 server 参数」，表现为"测试连接"永远不通。
      executor = factory({ server, config, log, provisioner, ctx });
      executor.id = executor.id || `ssh:${serverId}`;
      executor.kind = 'ssh';
      sshExecutors.set(serverId, executor);
    }
    known.set(serverId, { id: executor.id, kind: 'ssh', serverId });
    return executor;
  }

  /**
   * 惰性 ssh 代理：所有方法首次调用时才 import('./ssh.js')。
   * 保持契约 §3.7 的完整接口面。
   */
  function createLazySshExecutor(server, serverId, deps) {
    const pending = new Map(); // method → Promise<real executor>
    async function real() {
      const factory = await loadSshFactory();
      // 同 resolveAsync：server 必须传下去，否则解析出的执行器缺认证上下文。
      const created = factory(Object.assign({}, deps, { server }));
      created.id = created.id || `ssh:${serverId}`;
      created.kind = 'ssh';
      // 创建成功后替换缓存，后续调用直接命中真实对象
      sshExecutors.set(serverId, created);
      return created;
    }
    function call(method, args) {
      if (!pending.has(method)) {
        pending.set(method, real().then((executor) => {
          if (typeof executor[method] !== 'function') {
            throw new Error(`ssh 执行器未实现方法 ${method}()`);
          }
          return executor[method](...args);
        }));
      }
      return pending.get(method);
    }
    return {
      __lazy: true,
      id: `ssh:${serverId}`,
      kind: 'ssh',
      // 能力标志必须在代理上就能读到：run.js 在调用 run() **之前**就要据此决定
      // 是否传 script（惰性代理此时还没创建真实执行器，读不到它的字段）。
      supportsScript: true,
      server,
      probe: (s) => call('probe', [s ?? server]),
      run: (spec) => call('run', [spec]),
      readDir: (s, p) => call('readDir', [s, p]),
      stat: (s, p) => call('stat', [s, p]),
      match: (s, b, g, o) => call('match', [s, b, g, o]),
      transferIn: (s, l, r) => call('transferIn', [s, l, r]),
      transferOut: (s, r, l) => call('transferOut', [s, r, l]),
      dispose: () => (sshExecutors.get(serverId)?.__lazy
        ? Promise.resolve()
        : call('dispose', [])),
    };
  }

  /** 列出已解析的执行器（契约 §3.7） */
  function list() {
    return [...known.values()].map((entry) => ({ ...entry }));
  }

  /** 释放全部执行器 */
  async function dispose() {
    const results = await Promise.allSettled([
      localExecutor.dispose(),
      ...[...sshExecutors.values()].map((executor) => (
        typeof executor.dispose === 'function' ? executor.dispose() : Promise.resolve()
      )),
    ]);
    sshExecutors.clear();
    known.clear();
    const errors = results.filter((r) => r.status === 'rejected').map((r) => String(r.reason?.message ?? r.reason));
    return { ok: errors.length === 0, errors };
  }

  return {
    resolve,
    resolveAsync,
    list,
    dispose,
    isLocalHost,
    localExecutor,
    // 便于测试与工具调用
    get size() { return sshExecutors.size; },
    sshAvailable: () => loadSshFactory().then(() => true, () => false),
  };
}

export { createLocalExecutor };
export default createExecutorRegistry;
