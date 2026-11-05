/**
 * src/logs/logstore.js —— 运行日志存储（契约 §3.6）
 *
 * 设计要点：
 * - 落盘格式：<dataDir>/runs/<runId>/steps/<stepId>.log，JSONL，每行
 *   {"seq":1,"ts":0,"stream":"stdout","text":"..."}
 * - seq 全局单调递增：base<<20 | counter，base 为**秒**级时间戳。
 *   说明：契约写的是 `timestamp<<20 | counter`。若 base 取毫秒，1.77e12<<20 ≈ 1.86e18
 *   会超过 Number.MAX_SAFE_INTEGER(9.007e15)，JSON 数字将丢失精度、续传比较出错。
 *   取秒级 base 后 seq 最大约 8.6e15（可用到 2242 年）仍精确可表示，且每秒有 1048576
 *   个 counter 槽位，全局有序与可续传语义完全保留。
 * - 打码在**写盘前**做：内存环与磁盘都只保存打码后的文本，读路径不可能泄漏密钥。
 * - append 为同步落盘（契约中 append 非 async）：保证 append() 返回后数据已在文件中，
 *   消除「写完立刻读」的竞态。写盘按 step 串行，天然无交错。
 * - 内存环有上限（ringBytes，按 step 计）；read 落后于环时 lossy:true 并给出 spillPath。
 */
import fs from 'node:fs';
import path from 'node:path';

/** seq = base * 2^20 + counter */
const SEQ_BITS = 1 << 20;
const SEQ_MASK = SEQ_BITS - 1;

/** 全局单调计数器（模块级，跨 run 有序） */
let seqBase = 0;
let seqCounter = 0;

/**
 * 生成下一个全局单调 seq。
 * 时钟回拨时保持单调（base 不回退）；同一秒内超过 100 万条则进位到下一秒。
 */
function nextSeq(nowMs = Date.now()) {
  let base = Math.floor(nowMs / 1000);
  if (base < seqBase) base = seqBase; // 时钟回拨保护
  if (base === seqBase) {
    seqCounter += 1;
    if (seqCounter > SEQ_MASK) {
      base += 1;
      seqCounter = 0;
    }
  } else {
    seqCounter = 0;
  }
  seqBase = base;
  return base * SEQ_BITS + seqCounter;
}

/** 规范化打码词表：去空、去重、长值优先（避免短值先把长值切碎） */
function compileMask(mask) {
  const seen = new Set();
  const out = [];
  const list = Array.isArray(mask) ? mask : [];
  for (const raw of list) {
    if (raw === null || raw === undefined) continue;
    const value = String(raw);
    if (!value) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  out.sort((a, b) => b.length - a.length);
  return out;
}

/** 对文本应用打码；maskValues 已按长值优先排序 */
function applyMask(text, maskValues, replacement) {
  if (!maskValues.length) return text;
  let out = text;
  for (const value of maskValues) {
    if (out.indexOf(value) !== -1) out = out.split(value).join(replacement);
  }
  return out;
}

/** 安全文件名：防止 stepId 越界写成路径穿越 */
function safeSegment(id, fallback) {
  const s = String(id ?? '');
  if (!s || s === '.' || s === '..') return fallback;
  if (s.includes('/') || s.includes('\\') || s.includes('\0')) {
    return s.replace(/[\\/\0]/g, '_');
  }
  return s;
}

/**
 * 创建日志存储。
 * @param {{dataDir:string, ringBytes?:number, mask?:string[], maskReplacement?:string}} options
 */
export function createLogStore(options = {}) {
  const dataDir = path.resolve(String(options.dataDir ?? process.cwd()));
  const runsDir = path.join(dataDir, 'runs');
  const ringBytes = Number.isFinite(options.ringBytes) && options.ringBytes > 0
    ? Math.floor(options.ringBytes)
    : 524288;
  const maskReplacement = typeof options.maskReplacement === 'string' && options.maskReplacement
    ? options.maskReplacement
    : '***';

  /** 可变打码词表（引擎可在运行期并入 resolveEnv 收集到的 secret 值） */
  let maskValues = compileMask(options.mask);

  /** @type {Map<string, StepState>} key = `${runId}\u0000${stepId}` */
  const steps = new Map();
  /** @type {Map<string, {dir:string, steps:Set<string>, at:number}>} */
  const runs = new Map();
  /** 已打开的 fd 顺序（用于 LRU 回收，避免句柄泄漏） */
  const openOrder = [];
  const MAX_OPEN_FILES = 128;

  let closed = false;

  /* ------------------------------------------------------------------ 内部 */

  function stepKey(runId, stepId) {
    return `${runId}\u0000${stepId}`;
  }

  function runDirFor(runId) {
    return path.join(runsDir, safeSegment(runId, 'run'));
  }

  function pathFor(runId, stepId) {
    return path.join(runDirFor(runId), 'steps', `${safeSegment(stepId, 'step')}.log`);
  }

  function ensureRunDirSync(runId) {
    const dir = runDirFor(runId);
    fs.mkdirSync(path.join(dir, 'steps'), { recursive: true });
    let entry = runs.get(runId);
    if (!entry) {
      entry = { dir, steps: new Set(), at: Date.now() };
      runs.set(runId, entry);
    }
    return entry;
  }

  function touchOpen(state) {
    const idx = openOrder.indexOf(state.key);
    if (idx !== -1) openOrder.splice(idx, 1);
    openOrder.push(state.key);
    while (openOrder.length > MAX_OPEN_FILES) {
      const oldest = openOrder.shift();
      const victim = steps.get(oldest);
      if (victim && victim.fd !== null) {
        try { fs.closeSync(victim.fd); } catch { /* 忽略 */ }
        victim.fd = null;
      }
    }
  }

  function createState(runId, stepId) {
    ensureRunDirSync(runId);
    const state = {
      key: stepKey(runId, stepId),
      runId,
      stepId,
      file: pathFor(runId, stepId),
      fd: null,
      /** 内存环：{seq, ts, stream, text, bytes} */
      ring: [],
      ringBytesUsed: 0,
      /** 因环溢出被丢弃的条数与最新的被丢弃 seq */
      dropped: 0,
      droppedMaxSeq: 0,
      /** 已写入总字节数（含已丢弃部分） */
      totalBytes: 0,
      /** 落盘总条数（含已丢弃部分） */
      totalCount: 0,
      loaded: false,
    };
    steps.set(state.key, state);
    runs.get(runId).steps.add(stepId);
    return state;
  }

  function getState(runId, stepId) {
    const key = stepKey(runId, stepId);
    let state = steps.get(key);
    if (!state) state = createState(runId, stepId);
    if (!state.loaded) loadFromDisk(state);
    return state;
  }

  /** 从磁盘 JSONL 回填内存环（进程重启后仍可 read）。只保留能装进 ringBytes 的尾部。 */
  function loadFromDisk(state) {
    state.loaded = true;
    let raw;
    try {
      raw = fs.readFileSync(state.file, 'utf8');
    } catch {
      return; // 文件不存在 = 新 step
    }
    const lines = raw.split('\n');
    for (const line of lines) {
      if (!line) continue;
      let rec;
      try {
        rec = JSON.parse(line);
      } catch {
        continue; // 容忍半截行（进程被强杀）
      }
      if (!rec || typeof rec.text !== 'string') continue;
      const bytes = Buffer.byteLength(line, 'utf8') + 1;
      pushRing(state, {
        seq: Number(rec.seq) || 0,
        ts: Number(rec.ts) || 0,
        stream: rec.stream === 'stderr' ? 'stderr' : 'stdout',
        text: rec.text,
        bytes,
      });
      state.totalBytes += bytes;
      state.totalCount += 1;
    }
  }

  /** 入环；超限则从头丢，并记录丢弃水位 */
  function pushRing(state, entry) {
    state.ring.push(entry);
    state.ringBytesUsed += entry.bytes;
    while (state.ringBytesUsed > ringBytes && state.ring.length > 1) {
      const evicted = state.ring.shift();
      state.ringBytesUsed -= evicted.bytes;
      state.dropped += 1;
      if (evicted.seq > state.droppedMaxSeq) state.droppedMaxSeq = evicted.seq;
    }
  }

  function openFd(state) {
    if (state.fd !== null) return state.fd;
    state.fd = fs.openSync(state.file, 'a');
    touchOpen(state);
    return state.fd;
  }

  /** 写一条 JSONL 记录（同步，保证 append 返回即可见） */
  function writeRecord(state, entry) {
    const record = {
      seq: entry.seq,
      ts: entry.ts,
      stream: entry.stream,
      text: entry.text,
    };
    const line = `${JSON.stringify(record)}\n`;
    try {
      const fd = openFd(state);
      fs.writeSync(fd, line);
    } catch (error) {
      // 日志写盘失败不应拖垮流水线，但必须让人看得见
      process.emitWarning(`dsh-devops: 写入日志失败 ${state.file}: ${error?.message ?? error}`);
    }
  }

  function serialize(state, from) {
    const lines = state.ring.filter((l) => l.seq > from).map((l) => ({
      seq: l.seq,
      ts: l.ts,
      stream: l.stream,
      text: l.text,
    }));
    const last = lines.length ? lines[lines.length - 1].seq : from;
    const lossy = state.dropped > 0 && from < state.droppedMaxSeq;
    return {
      lines,
      next: last,
      lossy,
      bytes: state.totalBytes,
      ...(lossy ? { spillPath: state.file, dropped: state.dropped } : {}),
    };
  }

  /* ------------------------------------------------------------------ 公开 */

  /**
   * 建目录：<dataDir>/runs/<runId>/steps/
   * @returns {Promise<string>} run 目录绝对路径
   */
  async function ensureRun(runId) {
    if (closed) throw new Error('logstore 已关闭');
    const entry = ensureRunDirSync(runId);
    entry.at = Date.now();
    return entry.dir;
  }

  /**
   * 追加日志（同步落盘）。
   * @param {string} runId
   * @param {string} stepId
   * @param {{text:string, stream?:'stdout'|'stderr', mask?:string[]}} payload
   * @returns {{seq:number, ts:number, stream:string, text:string}}
   */
  function append(runId, stepId, payload = {}) {
    if (closed) return { seq: 0, ts: 0, stream: 'stdout', text: '' };
    const state = getState(runId, stepId);
    const rawText = payload.text === null || payload.text === undefined ? '' : String(payload.text);
    const stream = payload.stream === 'stderr' ? 'stderr' : 'stdout';

    // 打码在写盘前：内存环与磁盘共享同一份已打码文本
    let text = applyMask(rawText, maskValues, maskReplacement);
    if (Array.isArray(payload.mask) && payload.mask.length) {
      text = applyMask(text, compileMask(payload.mask), maskReplacement);
    }

    const ts = Date.now();
    const seq = nextSeq(ts);
    const record = {
      seq,
      ts,
      stream,
      text,
      bytes: Buffer.byteLength(text, 'utf8') + 48,
    };
    writeRecord(state, record);
    state.totalBytes += record.bytes;
    state.totalCount += 1;
    pushRing(state, record);
    return { seq, ts, stream, text };
  }

  /**
   * 读取一个 step 的日志。
   * @param {{runId:string, stepId:string, from?:number}} query
   * @returns {{lines:Array<{seq:number,ts:number,stream:string,text:string}>, next:number, lossy:boolean, bytes:number, spillPath?:string}}
   */
  function read(query = {}) {
    const { runId, stepId } = query;
    const from = Number(query.from) || 0;
    if (!runId || !stepId) return { lines: [], next: from, lossy: false, bytes: 0 };
    const state = getState(runId, stepId);
    return serialize(state, from);
  }

  /**
   * 多步合并读（按 seq 全局有序）。
   * @param {string} runId
   * @param {number|string} fromStep 数字=全局 seq 水位；字符串=从该 step 之后开始
   */
  function readRun(runId, fromStep) {
    let from = 0;
    if (typeof fromStep === 'number' && Number.isFinite(fromStep)) {
      from = fromStep;
    } else if (typeof fromStep === 'string' && fromStep) {
      // 兼容「按 stepId 起点」的调用方式：取该 step 的末条 seq 作为水位
      const state = getState(runId, fromStep);
      const last = state.ring.length ? state.ring[state.ring.length - 1].seq : 0;
      from = last;
    }
    const entry = runs.get(runId);
    const stepIds = entry ? [...entry.steps] : [];
    const merged = [];
    let bytes = 0;
    let lossy = false;
    let spillPath = '';
    for (const stepId of stepIds) {
      const state = getState(runId, stepId);
      const part = serialize(state, from);
      merged.push(...part.lines);
      bytes += part.bytes;
      if (part.lossy) {
        lossy = true;
        spillPath = part.spillPath;
      }
    }
    merged.sort((a, b) => a.seq - b.seq);
    const next = merged.length ? merged[merged.length - 1].seq : from;
    return { lines: merged, next, lossy, bytes, ...(lossy && spillPath ? { spillPath } : {}) };
  }

  /** 列出所有 runId（目录扫描，含非本进程创建的） */
  function listRuns() {
    const ids = new Set(runs.keys());
    try {
      for (const name of fs.readdirSync(runsDir)) {
        const full = path.join(runsDir, name);
        try {
          if (fs.statSync(full).isDirectory()) ids.add(name);
        } catch { /* 忽略 */ }
      }
    } catch { /* runsDir 还不存在 */ }
    return [...ids].sort();
  }

  /**
   * 清理超过保留天数的 run 目录。
   * @param {number} retentionDays
   * @returns {Promise<{removed:string[], kept:number, errors:string[]}>}
   */
  async function cleanup(retentionDays) {
    const days = Number(retentionDays);
    if (!Number.isFinite(days) || days <= 0) return { removed: [], kept: 0, errors: [] };
    const cutoff = Date.now() - days * 86400000;
    const removed = [];
    const errors = [];
    let kept = 0;
    let entries = [];
    try {
      entries = fs.readdirSync(runsDir, { withFileTypes: true });
    } catch {
      return { removed, kept, errors };
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = path.join(runsDir, entry.name);
      let stat;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (stat.mtimeMs >= cutoff) {
        kept += 1;
        continue;
      }
      try {
        await fs.promises.rm(full, { recursive: true, force: true });
        removed.push(entry.name);
        const state = runs.get(entry.name);
        if (state) runs.delete(entry.name);
        for (const [key, value] of [...steps]) {
          if (value.runId === entry.name) {
            if (value.fd !== null) { try { fs.closeSync(value.fd); } catch { /* 忽略 */ } }
            steps.delete(key);
          }
        }
      } catch (error) {
        errors.push(`${entry.name}: ${error?.message ?? error}`);
      }
    }
    return { removed, kept, errors };
  }

  /** 替换打码词表（引擎在每次运行开始时并入本次 secret 值） */
  function setMask(next) {
    maskValues = compileMask(next);
    return maskValues.length;
  }

  /** 追加打码词（返回追加后的数量） */
  function addMask(values) {
    maskValues = compileMask([...maskValues, ...(Array.isArray(values) ? values : [])]);
    return maskValues.length;
  }

  /** 当前打码词条数（不返回明文，便于测试与自检） */
  function maskSize() {
    return maskValues.length;
  }

  /** 关闭所有句柄（宿主 dispose 时调用） */
  async function close() {
    closed = true;
    for (const state of steps.values()) {
      if (state.fd !== null) {
        try { fs.closeSync(state.fd); } catch { /* 忽略 */ }
        state.fd = null;
      }
    }
    openOrder.length = 0;
  }

  /** 自检统计（只读） */
  function stats() {
    return {
      runCount: runs.size,
      stepCount: steps.size,
      openFiles: openOrder.length,
      ringBytes,
      maskSize: maskValues.length,
    };
  }

  return {
    // 契约 §3.6
    ensureRun,
    append,
    read,
    readRun,
    listRuns,
    pathFor,
    cleanup,
    // 契约外补充（引擎/宿主用）
    setMask,
    addMask,
    maskSize,
    close,
    stats,
    dataDir,
    runsDir,
    ringBytes,
  };
}

export default createLogStore;
