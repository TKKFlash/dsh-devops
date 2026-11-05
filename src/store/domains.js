/**
 * 存储领域常量与默认值（契约 §2.4、§3.5）。
 *
 * 本文件只放「形状」相关的声明：表名、单例默认值、内置服务器构造，
 * 以及可选的 `storageDomain` 适配器。真正的读写实现在 `store.js`。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** 集合型表名（每张表一个 `<table>.json`）。 */
export const COLLECTION_TABLES = Object.freeze([
  'pipelines',
  'templates',
  'servers',
  'envsets',
  'snippets',
  'recent',
  'runs',
]);

/** 单例型表名（文件内容即该对象本身）。 */
export const SINGLETON_TABLES = Object.freeze(['settings']);

/** 全部表名。 */
export const TABLE_NAMES = Object.freeze([...COLLECTION_TABLES, ...SINGLETON_TABLES]);

/** 所有领域共用的格式版本（写入文件与导出物）。 */
export const DOMAIN_VERSION = 1;

/**
 * 解析「本机默认工作目录」——即内置 local 服务器的 workdir。
 *
 * 为什么必须有值：`engine/run.js` 的 cwd 优先级是
 * `job.workdir || server.workdir || process.cwd()`。若 workdir 留空，
 * 相对路径会落到**宿主进程的启动目录**（实测为 `C:\Users\Flash\.dsh`
 * 这种隐藏配置目录），用户写 `base: 'src'` 会解析成 `~/.dsh/src` 而必然落空，
 * 且报错只说「命中 0 个」，完全看不出是基准目录错了。
 *
 * 取值优先级（每个候选都要求**存在且是目录**，最终返回绝对路径）：
 *   0. 显式传入的 `options.workdir`（装配层知道真实项目目录时优先用它）；
 *   1. `ctx.workingDirectory.get(session)` —— 当前会话的有效目录（最准，但需要 session）；
 *   2. `ctx.workspaceRegistry.list()` 中**最近更新**的工作区
 *      （注意：注册表的数组顺序是「创建顺序」而非「最近使用」，
 *      实测 workspaceIds 首项并非当前项目，故按 updatedAt 取最近使用）；
 *   3. `ctx.workingDirectory.defaultDirectory` —— DSH 的部署级默认目录；
 *   4. `DSH_WORKSPACE` / `DSH_PROJECT_DIR` 环境事实；
 *   5. `homedir()` —— 比 `~/.dsh` 这类隐藏配置目录合理得多的兜底。
 *
 * 全部来源都取不到时返回 `homedir()`，**绝不返回空串**。
 *
 * @param {any} [ctx] 宿主上下文（可缺省；缺省即走环境/家目录兜底）
 * @param {{session?: any, workdir?: string}} [options]
 * @returns {string} 绝对路径
 */
export function describeLocalWorkdir(ctx, options = {}) {
  /** @type {Array<{path: string, source: string}>} */
  const candidates = [];
  const push = (value, source) => {
    if (typeof value === 'string' && value.trim() !== '') candidates.push({ path: value.trim(), source });
  };

  // 0) 显式覆盖
  push(options.workdir, 'explicit');

  // 宿主服务可能挂在 ctx 属性上，也可能只能通过 ctx.get(name) 取（见 index.js 的 safeGet）。
  const service = (key) => {
    if (!ctx) return null;
    try {
      if (ctx[key]) return ctx[key];
      if (typeof ctx.get === 'function') return ctx.get(key) ?? null;
    } catch {
      // 服务未就绪：按缺失处理
    }
    return null;
  };

  // 1) 当前会话的有效目录（最准确）
  const wd = service('workingDirectory');
  if (wd && typeof wd.get === 'function') {
    const session = options.session ?? ctx?.session;
    if (session) {
      try {
        push(wd.get(session), 'session-directory');
      } catch {
        // 会话未就绪等情形：继续尝试下一个来源
      }
    }
  }

  // 2) 最近使用的工作区（按 updatedAt 排序，而不是数组顺序）
  const registry = service('workspaceRegistry');
  if (registry && typeof registry.list === 'function') {
    try {
      const list = registry.list();
      if (Array.isArray(list)) {
        const withPath = list.filter((w) => w && typeof w.path === 'string' && w.path.trim() !== '');
        const timeOf = (w) => {
          const raw = w.updatedAt ?? w.createdAt;
          const ms = raw instanceof Date ? raw.getTime() : Date.parse(raw);
          return Number.isFinite(ms) ? ms : 0;
        };
        const sorted = [...withPath].sort((a, b) => timeOf(b) - timeOf(a));
        for (const ws of sorted) push(ws.path, `workspace:${ws.title ?? ws.id ?? 'unknown'}`);
      }
    } catch {
      // 注册表未就绪：继续
    }
  }

  // 3) DSH 部署级默认目录
  push(wd?.defaultDirectory, 'workingDirectory.defaultDirectory');

  // 4) 环境事实
  push(process.env.DSH_WORKSPACE, 'DSH_WORKSPACE');
  push(process.env.DSH_PROJECT_DIR, 'DSH_PROJECT_DIR');

  // 5) 家目录兜底（一定存在且是绝对路径）
  const home = os.homedir();
  if (home) candidates.push({ path: home, source: 'homedir' });

  for (const candidate of candidates) {
    try {
      const abs = path.resolve(candidate.path);
      if (fs.statSync(abs).isDirectory()) {
        return { path: abs, source: candidate.source };
      }
    } catch {
      // 路径不存在或无权访问：换下一个候选
    }
  }

  // 所有候选都不可用（极端情况）：仍返回一个绝对路径，绝不返回空串
  return { path: path.resolve(home || process.cwd()), source: 'last-resort' };
}

/**
 * 只要路径的便捷版本（`describeLocalWorkdir` 的薄封装）。
 * @param {any} [ctx]
 * @param {{session?: any, workdir?: string}} [options]
 * @returns {string}
 */
export function resolveLocalWorkdir(ctx, options = {}) {
  return describeLocalWorkdir(ctx, options).path;
}

/**
 * 构造内置 local 服务器（不可删除、不可改 kind）。
 *
 * 做成工厂而非冻结常量：workdir 需要按宿主实际的工作区解析出来，
 * 否则就是「默认为宿主 cwd 且无人知晓」。已存在的 local 记录不会被覆盖，
 * 只有缺失或以空 workdir 保存过时才补上解析值（见 store.js）。
 *
 * @param {any} [ctx] 宿主上下文
 * @param {{workdir?: string}} [options]
 * @returns {object}
 */
export function createLocalServer(ctx, options = {}) {
  const resolved = describeLocalWorkdir(ctx, options);
  return {
    id: 'local',
    name: '本机',
    kind: 'local',
    host: '127.0.0.1',
    // 本机执行不经 TCP，0 是「无端口」的哨兵值；
    // validateServer 对 kind:'local' 放行 0，ssh 才要求 1-65535。
    port: 0,
    user: '',
    auth: { type: 'none', keyRef: '', passwordRef: '' },
    shell: '',
    // 非空、绝对、语义可解释：相对路径的基准目录，用户可在界面覆盖
    workdir: resolved.path,
    // 记录该值来自哪个来源，便于前端/用户理解「为什么是这个目录」
    workdirSource: resolved.source,
    tags: [],
    defaultEnv: [],
    customEnv: [],
    envSetRefs: [],
    probe: { at: 0, os: '', arch: '', shell: '', workdir: '', runtime: {}, managers: [], sudo: 'none', error: '' },
    runtimes: {},
    allowProvision: false,
    createdAt: 0,
    updatedAt: 0,
  };
}

/**
 * 兼容用的静态内置 local 服务器（workdir 为解析后的家目录）。
 * 新代码请用 `createLocalServer(ctx)`，它能取到真实工作区。
 */
export const LOCAL_SERVER = Object.freeze(createLocalServer(undefined, { workdir: os.homedir() }));

/**
 * 全局设置默认值（契约 §2.4）。
 * @returns {object} 新的设置对象（调用方可安全修改）
 */
export function defaultSettings() {
  return {
    defaultServer: 'local',
    maxConcurrentRuns: 2,
    maxParallelSteps: 4,
    logRingBytes: 524288,
    logRetentionDays: 30,
    defaultShell: 'auto',
    statusBar: true,
    stuckSilenceSec: 60,
    allowCustomNodeCode: false,
  };
}

/** 设置项的合法范围（用于 set 时的轻量收敛，避免写入明显非法的值）。 */
export const SETTINGS_LIMITS = Object.freeze({
  maxConcurrentRuns: { min: 1, max: 64, integer: true },
  maxParallelSteps: { min: 1, max: 128, integer: true },
  logRingBytes: { min: 65536, max: 64 * 1024 * 1024, integer: true },
  logRetentionDays: { min: 0, max: 3650, integer: true },
  stuckSilenceSec: { min: 5, max: 86400, integer: true },
});

/**
 * 按默认值补齐设置对象（未知键保留，便于前向兼容）。
 * @param {object} patch
 * @returns {object}
 */
export function mergeSettings(patch) {
  const base = defaultSettings();
  if (!patch || typeof patch !== 'object') return base;
  const out = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    out[key] = value;
  }
  // 数值项做一次收敛；非法值直接回落到默认值而不是静默写坏
  for (const [key, limit] of Object.entries(SETTINGS_LIMITS)) {
    const value = out[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      if (value !== undefined) out[key] = base[key];
      continue;
    }
    let next = limit.integer ? Math.round(value) : value;
    if (next < limit.min) next = limit.min;
    if (next > limit.max) next = limit.max;
    out[key] = next;
  }
  return out;
}

/**
 * 尝试用宿主 `storageDomain` 打开一张领域表。
 *
 * 契约把 storageDomain 定为**可选路径**。真实实现（`@deepseek-ai/dsh-storage-domain`）
 * 要求用 `defineDomain` + zod schema 声明领域，而本插件是零运行时依赖，
 * 不能 import 它，也无法凭空构造其内部 schema。因此这里采用**鸭子类型**探测：
 * 只有当传入对象看起来提供了可直接使用的表接口时才采用它，否则返回 null，
 * 由调用方回退到文件后端（永不抛错、永不阻塞启动）。
 *
 * @param {any} storageDomain 宿主服务（可能是 ctx.storageDomain，也可能是其包装）
 * @param {string} table
 * @param {{log?: Function, domainName?: string}} [options]
 * @returns {Promise<{get:Function, put:Function, delete:Function, entries:Function}|null>}
 */
export async function tryOpenDomain(storageDomain, table, options = {}) {
  const warn = typeof options.log === 'function' ? options.log : () => {};
  if (!storageDomain || typeof storageDomain !== 'object') return null;
  try {
    // 形态 A：facility.open(spec) → handle.table(name)（DSH 官方形态）
    if (typeof storageDomain.open === 'function') {
      const spec = { name: options.domainName ?? 'dsh-devops', version: DOMAIN_VERSION, tables: { [table]: {} } };
      const handle = await storageDomain.open(spec);
      if (handle && typeof handle.table === 'function') {
        const domainTable = handle.table(table);
        if (
          domainTable &&
          typeof domainTable.get === 'function' &&
          typeof domainTable.put === 'function' &&
          typeof domainTable.delete === 'function'
        ) {
          return {
            get: (id) => domainTable.get(id),
            put: (id, value) => domainTable.put(id, value),
            delete: (id) => domainTable.delete(id),
            entries: () =>
              typeof domainTable.entries === 'function'
                ? domainTable.entries()
                : typeof domainTable.list === 'function'
                  ? domainTable.list()
                  : [],
            close: typeof handle.close === 'function' ? () => handle.close() : undefined,
          };
        }
      }
      return null;
    }
    // 形态 B：直接就是一族的表接口（测试替身常用）
    const direct = storageDomain.table;
    if (typeof direct === 'function') {
      const domainTable = direct(table);
      if (domainTable && typeof domainTable.get === 'function' && typeof domainTable.put === 'function') {
        return {
          get: (id) => domainTable.get(id),
          put: (id, value) => domainTable.put(id, value),
          delete: (id) => domainTable.delete(id),
          entries: () => (typeof domainTable.entries === 'function' ? domainTable.entries() : []),
        };
      }
    }
    return null;
  } catch (error) {
    // 领域路径不可用不是错误：明确告知后回退文件后端
    warn(`[dsh-devops] storageDomain 不可用（${error?.message ?? error}），回退到文件后端`);
    return null;
  }
}
