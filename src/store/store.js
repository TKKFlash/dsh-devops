/**
 * Store：文件后端 + 内存权威快照（契约 §3.5）。
 *
 * 存储布局：
 *   <dataDir>/store/<table>.json       集合表：`{ "<id>": <value>, ... }`；settings：设置对象本身
 *   <table>.lock/                      mkdir 独占锁（跨进程互斥，零依赖）
 *
 * 并发与一致性：
 * - **内存是权威读快照**：`get/list/entries` 同步读内存，不碰磁盘。
 * - 每次写入串行化：进程内 promise 队列 + 跨进程 `mkdir` 锁。
 * - 落盘用「临时文件 → fsync → rename」，rename 在 POSIX 与 Windows 上都是原子的
 *   （Windows 上 fs.rename 覆盖已存在文件亦可，Node 走 MoveFileEx 的替换语义）。
 * - 写入成功后发 `store/changed`（`{table, id, action}`）。
 *
 * 可选 `storageDomain`：契约把它定为可选路径，且真实实现需要 zod 声明 schema。
 * 本插件零依赖，因此只在传入对象确实提供了可用的表接口时才采用，
 * 否则**明确告警并回退文件后端**（见 domains.js 的 tryOpenDomain）。
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  COLLECTION_TABLES,
  SINGLETON_TABLES,
  TABLE_NAMES,
  createLocalServer,
  defaultSettings,
  describeLocalWorkdir,
  mergeSettings,
  tryOpenDomain,
} from './domains.js';

/** 默认跨进程锁等待上限。 */
const DEFAULT_LOCK_TIMEOUT_MS = 10000;
/** 超过此时长的锁被视为死锁（持有者已崩溃），可强制清理。 */
const DEFAULT_STALE_LOCK_MS = 30000;
/** 锁重试的基础间隔。 */
const LOCK_RETRY_MS = 15;

/** 简单 sleep。 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 深拷贝（用于写入前隔离调用方的后续修改）；不支持时退回 JSON 往返。 */
function deepClone(value) {
  if (value === undefined) return value;
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
}

/** 文件是否存在。 */
async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * 取跨进程独占锁：`mkdir` 是原子的，成功即持锁。
 * @param {string} lockDir
 * @param {{timeoutMs?:number, staleMs?:number, log?:Function}} [options]
 * @returns {Promise<() => Promise<void>>} 释放函数
 */
async function acquireDirLock(lockDir, options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_LOCK_TIMEOUT_MS;
  const staleMs = Number.isFinite(options.staleMs) ? options.staleMs : DEFAULT_STALE_LOCK_MS;
  const warn = typeof options.log === 'function' ? options.log : () => {};
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;

  for (;;) {
    try {
      await fs.mkdir(lockDir);
      return async () => {
        try {
          await fs.rmdir(lockDir);
        } catch {
          // 已被清理（例如被判为陈旧）：无需报错
        }
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        // 父目录不存在等情况：建一次父目录后重试一次
        await fs.mkdir(path.dirname(lockDir), { recursive: true });
        if (attempt === 0) {
          attempt += 1;
          continue;
        }
        throw error;
      }
    }

    // 锁已存在：检查是否陈旧（持有者崩溃）
    try {
      const stat = await fs.stat(lockDir);
      if (staleMs > 0 && Date.now() - stat.mtimeMs > staleMs) {
        warn(`[dsh-devops] 发现陈旧锁并清理：${lockDir}`);
        await fs.rmdir(lockDir).catch(() => {});
        continue;
      }
    } catch {
      // 锁在我们检查时刚好被释放，下一轮重试即可
    }

    if (Date.now() >= deadline) {
      throw new Error(`获取文件锁超时（${timeoutMs}ms）：${lockDir}`);
    }
    attempt += 1;
    // 退避 + 抖动，避免多进程同频抢占
    await sleep(Math.min(LOCK_RETRY_MS + attempt * 5, 120) + Math.floor(Math.random() * 10));
  }
}

/** 原子写：临时文件 → fsync → rename。 */
async function atomicWriteFile(file, text) {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`);
  let handle;
  try {
    handle = await fs.open(tmp, 'w');
    await handle.writeFile(text, 'utf8');
    // 先落盘再改名，避免断电后 rename 出一个空文件
    await handle.sync().catch(() => {});
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
  try {
    await fs.rename(tmp, file);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
}

/**
 * 解析集合表文件内容。
 * 兼容两种形态：裸映射 `{id: value}`，或带版本包装 `{version, records:{...}}`。
 */
function parseCollection(text) {
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  if (typeof data.version === 'number' && data.records && typeof data.records === 'object' && !Array.isArray(data.records)) {
    return data.records;
  }
  return data;
}

/** 解析单例文件内容；兼容 `{version, value}` 包装与裸对象。 */
function parseSingleton(text) {
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  if ('value' in data && typeof data.value === 'object' && data.value !== null && !Array.isArray(data.value)) {
    return data.value;
  }
  return data;
}

/**
 * 创建一张文件表（契约 §3.5 的「内部用、测试可单独引用」导出）。
 *
 * @param {{
 *   name: string, file: string, log?: Function, onChanged?: Function,
 *   singleton?: boolean, initial?: any,
 *   lockTimeoutMs?: number, staleLockMs?: number
 * }} options
 * @returns {object} 集合表：get/list/entries/put/update/delete；
 *                   单例表额外提供 read/write/set。两种都提供 flush/close/reload。
 */
export function createFileTable(options = {}) {
  const name = String(options.name ?? 'table');
  const file = path.resolve(String(options.file ?? `${name}.json`));
  const lockDir = `${file}.lock`;
  const warn = typeof options.log === 'function' ? options.log : () => {};
  const onChanged = typeof options.onChanged === 'function' ? options.onChanged : null;
  const singleton = options.singleton === true;
  const lockTimeoutMs = options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const staleLockMs = options.staleLockMs ?? DEFAULT_STALE_LOCK_MS;

  /** 内存权威快照。 */
  let records = new Map();
  /** 本进程删除过的 id（持久化后清空），防止跨进程合并时复活已删键。 */
  let removed = new Set();
  /** 单例值。 */
  let single = singleton ? (options.initial !== undefined ? deepClone(options.initial) : null) : null;
  /** 写入队列（进程内串行）。 */
  let queue = Promise.resolve();
  let closed = false;
  let loaded = false;

  /** 把一次写操作排进队列。 */
  function enqueue(task) {
    const run = queue.then(task, task);
    // 队列本身不因单个任务失败而断裂
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** 读取磁盘上的集合内容；文件缺失或损坏时返回空表。 */
  async function readDiskRecords() {
    if (!(await exists(file))) return {};
    try {
      const text = await fs.readFile(file, 'utf8');
      if (text.trim() === '') return {};
      return parseCollection(text);
    } catch {
      return {};
    }
  }

  /**
   * 落盘集合表。
   *
   * 跨进程安全：同一张表可能被多个 DSH 实例同时打开，`<table>.lock` 只保证
   * 写入串行，若直接整表覆盖，另一进程新加的键会被抹掉。因此**在锁内先读盘**，
   * 把「磁盘上有、本进程内存里没有、且本进程没删过」的键并回来，
   * 再写完整快照并同步回内存。
   */
  async function persistCollection() {
    const disk = await readDiskRecords();
    const merged = new Map();
    for (const [key, value] of Object.entries(disk)) {
      if (!removed.has(key) && !records.has(key)) merged.set(key, value);
    }
    for (const [key, value] of records) merged.set(key, value);
    records = merged;
    removed = new Set();
    loaded = true;
    await atomicWriteFile(file, `${JSON.stringify(Object.fromEntries(merged), null, 2)}\n`);
  }

  /** 落盘单例。 */
  async function persistSingleton() {
    await atomicWriteFile(file, `${JSON.stringify(single, null, 2)}\n`);
  }

  /** 带锁执行一次「写内存 + 落盘」。 */
  async function withLock(task) {
    if (closed) {
      const error = new Error(`store 已关闭：${name}`);
      error.code = 'closed';
      throw error;
    }
    const release = await acquireDirLock(lockDir, { timeoutMs: lockTimeoutMs, staleMs: staleLockMs, log: warn });
    try {
      return await task();
    } finally {
      await release();
    }
  }

  /** 从磁盘加载初始快照（启动/重载用）。 */
  async function load() {
    await fs.mkdir(path.dirname(file), { recursive: true });
    if (!(await exists(file))) {
      // 首次启动：写入初始值，保证磁盘上有一份可读的基线
      if (singleton) {
        if (single === null) single = defaultSettings();
        await withLock(() => persistSingleton());
      } else if (options.initial && typeof options.initial === 'object') {
        records = new Map(Object.entries(deepClone(options.initial)));
        await withLock(() => persistCollection());
      } else {
        await withLock(() => persistCollection());
      }
      loaded = true;
      return;
    }
    const text = await fs.readFile(file, 'utf8');
    if (text.trim() === '') {
      // 空文件（例如上次写入被截断）：保持内存默认值并重写一份
      warn(`[dsh-devops] 存储文件为空，已重建：${file}`);
      await withLock(() => (singleton ? persistSingleton() : persistCollection()));
      loaded = true;
      return;
    }
    try {
      if (singleton) {
        const parsed = parseSingleton(text);
        if (parsed && typeof parsed === 'object') {
          single = { ...defaultSettings(), ...parsed };
        }
      } else {
        records = new Map(Object.entries(parseCollection(text)));
      }
    } catch (error) {
      // 损坏文件不能静默丢弃：备份后以空表继续，避免整个插件起不来
      const backup = `${file}.corrupt-${Date.now()}`;
      await fs.rename(file, backup).catch(() => {});
      warn(`[dsh-devops] 存储文件损坏已备份为 ${backup}：${error?.message ?? error}`);
      records = new Map();
      if (singleton) single = defaultSettings();
    }
    loaded = true;
  }

  const table = {
    /** 表名。 */
    get name() {
      return name;
    },
    /** 绝对文件路径（诊断用）。 */
    get file() {
      return file;
    },
    /** 是否单例表。 */
    get singleton() {
      return singleton;
    },

    /** 同步读一条记录。 */
    get(id) {
      if (singleton) return single;
      return records.get(String(id));
    },

    /** 同步列出全部记录（插入顺序）。 */
    list() {
      if (singleton) return single === null || single === undefined ? [] : [single];
      return [...records.values()];
    },

    /** 同步列出 `[id, value]`（插入顺序）。 */
    entries() {
      if (singleton) return single === null || single === undefined ? [] : [['global', single]];
      return [...records.entries()];
    },

    /**
     * 写入一条记录（原子落盘后才返回）。
     * @returns {Promise<any>} 写入的值
     */
    async put(id, value) {
      if (singleton) {
        return table.write(value);
      }
      const key = String(id ?? '');
      if (key === '') throw new TypeError('put 的 id 不能为空');
      const stored = deepClone(value);
      await enqueue(() =>
        withLock(async () => {
          records.set(key, stored);
          await persistCollection();
        }),
      );
      onChanged?.({ table: name, id: key, action: 'put' });
      return stored;
    },

    /**
     * 读改写一条记录；`fn` 收到当前值的副本。
     * 记录不存在时抛 `missing-key`（与领域层语义一致）；
     * `fn` 返回 `undefined` 表示放弃本次写入。
     * @returns {Promise<any>}
     */
    async update(id, fn) {
      if (typeof fn !== 'function') throw new TypeError('update 的第二个参数必须是函数');
      if (singleton) {
        const current = single === null || single === undefined ? {} : deepClone(single);
        const next = await fn(current);
        if (next === undefined) return single;
        return table.write(next);
      }
      const key = String(id ?? '');
      if (key === '') throw new TypeError('update 的 id 不能为空');
      const result = await enqueue(() =>
        withLock(async () => {
          if (!records.has(key)) {
            const error = new Error(`记录不存在：${name}/${key}`);
            error.code = 'missing-key';
            throw error;
          }
          const current = records.get(key);
          const next = await fn(deepClone(current));
          if (next === undefined) return current;
          const stored = deepClone(next);
          records.set(key, stored);
          await persistCollection();
          return stored;
        }),
      );
      if (result !== undefined) onChanged?.({ table: name, id: key, action: 'put' });
      return result;
    },

    /** 删除一条记录；不存在返回 false。内置 local 服务器不可删除。 */
    async delete(id) {
      if (singleton) return false;
      const key = String(id ?? '');
      // 契约 §2.3：内置 local 服务器不可删除
      if (name === 'servers' && key === 'local') {
        return false;
      }
      const removed0 = await enqueue(() =>
        withLock(async () => {
          // 本进程内存里没有，但磁盘上可能有（别的进程写的）：先读盘再判断
          const disk = await readDiskRecords();
          if (!records.has(key) && !(key in disk)) return false;
          records.delete(key);
          removed.add(key);
          await persistCollection();
          return true;
        }),
      );
      if (removed0) onChanged?.({ table: name, id: key, action: 'delete' });
      return removed0;
    },

    /** 单例读取（settings 用）。 */
    read() {
      return single;
    },

    /** 单例写入（settings 用）。 */
    async write(value) {
      const stored = deepClone(value);
      await enqueue(() =>
        withLock(async () => {
          single = stored;
          await persistSingleton();
        }),
      );
      onChanged?.({ table: name, id: 'global', action: 'put' });
      return stored;
    },

    /** 用补丁更新单例，自动补齐默认值并收敛数值范围。 */
    async set(patch) {
      const merged = mergeSettings({ ...(single ?? defaultSettings()), ...(patch ?? {}) });
      return table.write(merged);
    },

    /** 等待所有排队中的写入完成。 */
    async flush() {
      await queue;
    },

    /** 从磁盘重新加载快照（外部进程改过文件时用）。 */
    async reload() {
      // 显式重载 = 以磁盘为准，放弃本进程尚未落盘的删除墓碑
      if (!singleton) removed = new Set();
      await load();
      return table;
    },

    /** 是否已加载。 */
    get loaded() {
      return loaded;
    },

    /** 标记关闭（阻止后续写入）。 */
    close() {
      closed = true;
    },
  };

  return table;
}

/**
 * 创建 Store（契约 §3.5，异步工厂）。
 *
 * @param {{
 *   dataDir: string,
 *   log?: Function,
 *   storageDomain?: any,
 *   emit?: Function,       // 可选的 store/changed 发射器
 *   ctx?: any,             // 可选：若提供 ctx.emit 则用它发事件
 *   lockTimeoutMs?: number,
 *   staleLockMs?: number
 * }} options
 * @returns {Promise<object>} Store
 */
export async function createStore(options = {}) {
  const rawDir = options.dataDir;
  if (typeof rawDir !== 'string' || rawDir.trim() === '') {
    throw new TypeError('createStore 需要 dataDir');
  }
  const dataDir = path.resolve(rawDir);
  const storeDir = path.join(dataDir, 'store');
  const log = typeof options.log === 'function' ? options.log : () => {};
  const warn = (message) => {
    try {
      log(message);
    } catch {
      // 日志钩子自身出错不应影响存储
    }
  };

  const tableOptions = {
    log: warn,
    lockTimeoutMs: options.lockTimeoutMs,
    staleLockMs: options.staleLockMs,
  };

  // 事件发射：优先显式 emit，其次 ctx.emit
  const emit =
    typeof options.emit === 'function'
      ? options.emit
      : typeof options.ctx?.emit === 'function'
        ? (event, payload) => options.ctx.emit(event, payload)
        : null;
  const onChanged = emit
    ? (payload) => {
        try {
          emit('store/changed', payload);
        } catch (error) {
          warn(`[dsh-devops] store/changed 发射失败：${error?.message ?? error}`);
        }
      }
    : null;

  await fs.mkdir(storeDir, { recursive: true });

  /** 每张表一个后端；storageDomain 可用时优先，否则文件。 */
  const backends = new Map();
  const tables = {};

  for (const name of TABLE_NAMES) {
    const isSingleton = SINGLETON_TABLES.includes(name);
    const initial =
      name === 'servers'
        ? {
            local: {
              ...createLocalServer(options.ctx),
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          }
        : name === 'settings'
          ? defaultSettings()
          : name === 'pipelines' || name === 'templates' || name === 'envsets' || name === 'snippets' || name === 'recent' || name === 'runs'
            ? {}
            : undefined;

    const fileTable = createFileTable({
      name,
      file: path.join(storeDir, `${name}.json`),
      singleton: isSingleton,
      initial,
      onChanged,
      ...tableOptions,
    });

    // 可选 storageDomain 路径：不可用则静默回退文件后端（已告警）
    let domainHandle = null;
    if (options.storageDomain && !isSingleton) {
      domainHandle = await tryOpenDomain(options.storageDomain, name, { log: warn, domainName: 'dsh-devops' });
      if (domainHandle) {
        warn(`[dsh-devops] 表 ${name} 使用 storageDomain 后端`);
      }
    }

    if (domainHandle) {
      // 领域后端：内存快照由领域维护，这里做一层适配
      const map = new Map();
      const source = domainHandle.entries ? domainHandle.entries() : [];
      for (const entry of Array.isArray(source) ? source : []) {
        if (Array.isArray(entry) && entry.length === 2) map.set(String(entry[0]), entry[1]);
      }
      backends.set(name, { kind: 'domain', handle: domainHandle, map, table: fileTable });
      tables[name] = {
        get: (id) => map.get(String(id)),
        list: () => [...map.values()],
        entries: () => [...map.entries()],
        async put(id, value) {
          const key = String(id ?? '');
          if (key === '') throw new TypeError('put 的 id 不能为空');
          await domainHandle.put(key, deepClone(value));
          map.set(key, deepClone(value));
          onChanged?.({ table: name, id: key, action: 'put' });
          return value;
        },
        async update(id, fn) {
          if (typeof fn !== 'function') throw new TypeError('update 的第二个参数必须是函数');
          const key = String(id ?? '');
          const current = map.get(key);
          if (current === undefined) {
            const error = new Error(`记录不存在：${name}/${key}`);
            error.code = 'missing-key';
            throw error;
          }
          const next = await fn(deepClone(current));
          if (next === undefined) return current;
          await domainHandle.put(key, deepClone(next));
          map.set(key, deepClone(next));
          onChanged?.({ table: name, id: key, action: 'put' });
          return next;
        },
        async delete(id) {
          const key = String(id ?? '');
          if (!map.has(key)) return false;
          if (typeof domainHandle.delete === 'function') await domainHandle.delete(key);
          map.delete(key);
          onChanged?.({ table: name, id: key, action: 'delete' });
          return true;
        },
        async flush() {},
        async reload() {
          return this;
        },
      };
    } else {
      backends.set(name, { kind: 'file', table: fileTable });
      tables[name] = fileTable;
    }

    await (backends.get(name).kind === 'domain' ? Promise.resolve() : fileTable.reload());
  }

  // 内置 local 服务器必须始终存在（不可删除）；磁盘上被手工删掉时补回
  const localServer = tables.servers.get('local');
  if (!localServer) {
    await tables.servers.put('local', {
      ...createLocalServer(options.ctx),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  } else if (typeof localServer.workdir !== 'string' || localServer.workdir.trim() === '') {
    // 老数据自愈：workdir 为空时相对路径会落到宿主启动目录（如 ~/.dsh），
    // 用户写 base:'src' 必然落空且看不出原因。补上解析出的本机工作目录。
    const resolved = describeLocalWorkdir(options.ctx);
    await tables.servers.put('local', {
      ...localServer,
      workdir: resolved.path,
      workdirSource: resolved.source,
      updatedAt: Date.now(),
    });
    warn(
      `[dsh-devops] 内置 local 服务器未设置工作目录，已自动设为 ${resolved.path}` +
        `（来源 ${resolved.source}；相对路径以此为基准，可在界面修改）`,
    );
  }

  const store = {
    /** 数据根目录。 */
    dataDir,
    /** 存储目录。 */
    storeDir,
    pipelines: tables.pipelines,
    templates: tables.templates,
    servers: tables.servers,
    envsets: tables.envsets,
    snippets: tables.snippets,
    recent: tables.recent,
    runs: tables.runs,
    /** settings 单例：`get()` 同步、`set(patch)` 异步。 */
    settings: {
      get() {
        return tables.settings.read() ?? defaultSettings();
      },
      async set(patch) {
        return tables.settings.set(patch);
      },
    },
    /** 按名字取表（调试/通用访问）。 */
    table(name) {
      return tables[name];
    },
    /** 各表后端类型（诊断用）。 */
    backendKind(name) {
      return backends.get(name)?.kind ?? 'unknown';
    },
    /** 等待所有表写入落盘。 */
    async flush() {
      await Promise.all(Object.values(tables).map((t) => (typeof t.flush === 'function' ? t.flush() : Promise.resolve())));
    },
    /** 关闭：等待写入完成、释放可选领域句柄。 */
    async close() {
      await store.flush();
      for (const backend of backends.values()) {
        if (backend.kind === 'domain' && typeof backend.handle.close === 'function') {
          try {
            await backend.handle.close();
          } catch (error) {
            warn(`[dsh-devops] 关闭 storageDomain 失败：${error?.message ?? error}`);
          }
        }
        if (typeof backend.table?.close === 'function') backend.table.close();
      }
    },
  };

  return store;
}

/** 供测试与其它模块引用的表名清单。 */
export { COLLECTION_TABLES, SINGLETON_TABLES, TABLE_NAMES };
