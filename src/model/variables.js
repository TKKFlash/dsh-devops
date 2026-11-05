/**
 * 环境变量合并与密钥解析（契约 §3.2）。
 *
 * 合并顺序（后者覆盖前者，共 10 层）：
 *   processEnv → server.defaultEnv → server.customEnv → 引用的 envSets → pipeline.variables
 *   → stage.variables → job.env → job.envSetRefs → node.env → runtime 注入（PATH/解释器）
 *
 * 值语义：`null`、`undefined` 或空串都表示**删除该键**（最终映射为 `undefined`）。
 *
 * 密钥：`secret:true` 的条目其 `value` 存的是**引用名**（如 `PROD_SSH_KEY`），
 * 真值来自 `credentials.resolve(ref)`。DSH 的 `ctx.credentials.resolve` 是异步的，
 * 而契约规定 `resolveEnv` 是同步函数，因此本模块的策略是：
 *   1. 同步 `resolveEnv`：优先用注入的**同步**凭据读取器（`credentials.get/sync/readSync`
 *      或直接传一个同步函数），否则回退到 `processEnv[ref]`；
 *   2. 需要真正的 `ctx.credentials`（Promise）时用附加导出 `resolveEnvAsync`（同步版超集，
 *      额外返回 `unresolved` 列表），契约签名未变。
 * 无论走哪条路，secret 的真值都会进入 `masked`，供写日志前打码。
 */

/**
 * 环境变量表形态：`{ KEY: 'v' }` 或 `[{name,value,secret}]`。
 *
 * 关于 secret 条目的引用名：契约 §2.1 的字段是 `{name,value,secret}`，
 * **没有 `ref` 字段**，因此 `secret:true` 时 `value` 里存的就是**引用名**
 * （如 `{name:'TOKEN', value:'PROD_TOKEN', secret:true}`）。
 * 为兼容前端/工具可能写入 `ref` 的写法，这里同时接受 `ref` 作为别名（`value` 优先）。
 */
function toEntries(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .filter((item) => item && typeof item === 'object' && item.name)
      .map((item) => ({
        name: String(item.name),
        value: item.value !== undefined ? item.value : item.ref,
        secret: item.secret === true,
      }));
  }
  if (typeof value === 'object') {
    return Object.entries(value)
      .filter(([name]) => typeof name === 'string' && name !== '')
      .map(([name, v]) => {
        // 键值表形态下，值为对象时可携带 secret 标记
        if (v && typeof v === 'object' && !Array.isArray(v) && ('value' in v || 'ref' in v)) {
          return { name, value: v.value !== undefined ? v.value : v.ref, secret: v.secret === true };
        }
        return { name, value: v, secret: false };
      });
  }
  return [];
}

/** 把环境变量组列表（数组或 id→envset 映射）转成查找表。 */
function indexEnvSets(envSets) {
  const map = new Map();
  if (!envSets) return map;
  if (Array.isArray(envSets)) {
    for (const set of envSets) {
      if (set && typeof set === 'object' && set.id) map.set(String(set.id), set);
    }
    return map;
  }
  if (typeof envSets === 'object') {
    for (const [id, set] of Object.entries(envSets)) {
      if (set && typeof set === 'object') map.set(id, { id, ...set });
    }
  }
  return map;
}

/** 把任意值转成环境变量字符串；返回 undefined 表示删除该键。 */
function toEnvValue(raw) {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'string') return raw === '' ? undefined : raw;
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  // 对象/数组/函数不是合法的环境变量值，按删除处理（不静默 JSON 化）
  return undefined;
}

/**
 * 同步解析一个密钥引用。
 * 支持的 credentials 形态（按优先级）：
 *   - 函数：`credentials(ref) => string|undefined`
 *   - 对象上的同步方法：`get` / `resolveSync` / `sync` / `readSync` / `getSync` / `read`
 *
 * **安全约定**：凭据后端抛错时**必须向上抛出**，绝不能吞掉后当成「未配置」——
 * 否则密钥会静默变为空值，服务可能以匿名身份继续运行。
 * 只有「后端正常返回 undefined」才表示未配置（此时交由调用方回退 processEnv）。
 *
 * @returns {{value:string|undefined, resolved:boolean}}
 */
function resolveSecretSync(credentials, ref) {
  if (!ref) return { value: undefined, resolved: false };
  if (typeof credentials === 'function') {
    const value = credentials(ref);
    if (typeof value === 'string' && value !== '') return { value, resolved: true };
    return { value: undefined, resolved: false };
  }
  if (credentials && typeof credentials === 'object') {
    for (const method of ['get', 'resolveSync', 'sync', 'readSync', 'getSync', 'read']) {
      const fn = credentials[method];
      if (typeof fn !== 'function') continue;
      const value = fn.call(credentials, ref);
      // 异步实现（返回 Promise）在同步路径上不可用，跳过（由 resolveEnvAsync 处理）
      if (value && typeof value.then === 'function') continue;
      if (typeof value === 'string' && value !== '') return { value, resolved: true };
      if (value && typeof value === 'object' && typeof value.value === 'string' && value.value !== '') {
        return { value: value.value, resolved: true };
      }
      return { value: undefined, resolved: false };
    }
  }
  return { value: undefined, resolved: false };
}

/**
 * 异步解析一个密钥引用（用于真实 ctx.credentials）。
 * 凭据后端抛错时同样**向上抛出**（安全约定，见 resolveSecretSync）。
 */
async function resolveSecretAsync(credentials, ref) {
  if (!ref) return { value: undefined, resolved: false };
  if (credentials && typeof credentials.resolve === 'function') {
    const value = await credentials.resolve(ref);
    if (typeof value === 'string' && value !== '') return { value, resolved: true };
    if (value && typeof value === 'object' && typeof value.value === 'string' && value.value !== '') {
      return { value: value.value, resolved: true };
    }
    return { value: undefined, resolved: false };
  }
  if (credentials && typeof credentials.get === 'function') {
    const value = await credentials.get(ref);
    if (typeof value === 'string' && value !== '') return { value, resolved: true };
    if (value && typeof value === 'object' && typeof value.value === 'string' && value.value !== '') {
      return { value: value.value, resolved: true };
    }
    return { value: undefined, resolved: false };
  }
  if (typeof credentials === 'function') {
    const value = await credentials(ref);
    if (typeof value === 'string' && value !== '') return { value, resolved: true };
    return { value: undefined, resolved: false };
  }
  return { value: undefined, resolved: false };
}

/**
 * 判定 PATH 分隔符与目标平台。
 * 顺序：显式 `platform` → `server.probe.platform`/`probe.os` → 本机 `process.platform`。
 * 远端执行必须按**目标**平台选分隔符，不能沿用本机（Windows 控制端连 Linux 机是常见场景）。
 */
function resolvePlatform(input) {
  const raw =
    input?.platform ??
    input?.probe?.platform ??
    input?.server?.probe?.platform ??
    input?.server?.probe?.os ??
    process.platform;
  const value = String(raw ?? '').toLowerCase();
  const isWindows = value === 'win32' || value === 'windows' || value.startsWith('windows');
  return { isWindows, separator: isWindows ? ';' : ':' };
}

/**
 * 从 runtime 需求派生注入项：PATH 前插解释器目录，并给出解释器变量。
 *
 * **PATH 的基准来自已合并的层，而不是宿主的 `process.env`**：
 * 环境合并是「为目标机器构造环境」，远端机器的 PATH 绝不能混入控制端本机的 PATH。
 * 调用方若需要本机 PATH，应把它作为 `processEnv` 层传入。
 *
 * @param {Record<string,any>} runtime
 * @param {object} input 完整入参（用于解析目标平台）
 * @param {string|undefined} existingPath 已合并层里的 PATH（可能为 undefined）
 */
function runtimeInjections(runtime, input, existingPath) {
  const entries = [];
  if (!runtime || typeof runtime !== 'object') return entries;
  const { separator } = resolvePlatform(input);
  const dirs = [];
  for (const [key, raw] of Object.entries(runtime)) {
    if (typeof raw !== 'string' || raw === '') continue;
    const binPath = raw;
    const dir = binPath.replace(/[\\/][^\\/]*$/, '');
    if (dir) dirs.push(dir);
    if (key === 'python') entries.push({ name: 'PYTHON', value: binPath, layer: 'runtime' });
    else if (key === 'node') entries.push({ name: 'NODE', value: binPath, layer: 'runtime' });
    else if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) entries.push({ name: key.toUpperCase(), value: binPath, layer: 'runtime' });
  }
  if (dirs.length > 0) {
    const existing = typeof existingPath === 'string' ? existingPath : '';
    // 已在 PATH 中的目录不重复插入（避免多次运行时注入后 PATH 无限膨胀）
    const present = new Set(
      existing
        .split(separator)
        .map((p) => p.trim().replace(/[\\/]+$/, '').toLowerCase())
        .filter((p) => p !== ''),
    );
    const fresh = [];
    for (const dir of new Set(dirs)) {
      const key = dir.replace(/[\\/]+$/, '').toLowerCase();
      if (present.has(key) || fresh.some((d) => d.replace(/[\\/]+$/, '').toLowerCase() === key)) continue;
      fresh.push(dir);
    }
    if (fresh.length > 0) {
      const prefix = fresh.join(separator);
      entries.push({ name: 'PATH', value: existing ? `${prefix}${separator}${existing}` : prefix, layer: 'runtime' });
    }
  }
  return entries;
}

/** 组装本次解析要用到的全部层（带来源标签）。 */
function buildLayers(input) {
  const {
    processEnv,
    server,
    envSets,
    pipeline,
    stage,
    job,
    node,
  } = input;
  const setIndex = indexEnvSets(envSets);
  const layers = [];
  const push = (label, value) => {
    const entries = toEntries(value);
    if (entries.length > 0) layers.push({ label, entries });
  };
  const pushSets = (label, refs) => {
    if (!Array.isArray(refs)) return;
    for (const ref of refs) {
      const set = setIndex.get(String(ref));
      // 来源词汇表：`envset:<id>`（server/pipeline 引用）与 `job.envSet:<id>`
      if (set) push(`${label}${set.id ?? ref}`, set.vars ?? set.values ?? []);
    }
  };

  push('process', processEnv);
  push('server.defaultEnv', server?.defaultEnv);
  push('server.customEnv', server?.customEnv);
  pushSets('envset:', server?.envSetRefs);
  push('pipeline', pipeline?.variables);
  pushSets('envset:', pipeline?.envSetRefs);
  push('stage', stage?.variables);
  push('job', job?.env);
  pushSets('job.envSet:', job?.envSetRefs);
  push('node', node?.env);
  return layers;
}

/**
 * 收集本次合并涉及的全部密钥引用（去重），供异步预解析。
 * @returns {string[]}
 */
function collectSecretRefs(input) {
  const refs = new Set();
  for (const layer of buildLayers(input)) {
    for (const entry of layer.entries) {
      if (!entry.secret || !entry.name) continue;
      refs.add(typeof entry.value === 'string' && entry.value !== '' ? entry.value : entry.name);
    }
  }
  return [...refs];
}

/**
 * 唯一合并内核（同步）。
 * 密钥真值通过 `secretLookup(ref) → string|undefined` 取得，
 * 同步与异步两条路径共用同一套层序与覆盖语义，避免逻辑分叉。
 */
function mergeCore(input, secretLookup) {
  /** @type {Map<string, {value:string|undefined, source:string, secret:boolean, ref:string}>} */
  const merged = new Map();
  /** 该键是否被更高优先级层覆盖过（契约 §3.2：overridden 是布尔，不是计数）。 */
  const overridden = new Set();

  for (const layer of buildLayers(input)) {
    for (const entry of layer.entries) {
      const name = entry.name;
      if (!name) continue;
      let value;
      let secret = false;
      let ref = '';
      if (entry.secret) {
        secret = true;
        // secret 条目的 value 字段存的是**引用名**（契约 §2.1 没有 ref 字段）；
        // 引用名缺省时退回用变量名。
        ref = typeof entry.value === 'string' && entry.value !== '' ? entry.value : name;
        value = secretLookup(ref);
      } else {
        value = toEnvValue(entry.value);
      }
      // 同步路径下 credentials.resolve 是异步的、会被跳过：此时该键**未解析**，
      // 不能记成已解析（配合 unresolved 让调用方看见"密钥没拿到"）。
      if (merged.has(name)) overridden.add(name);
      merged.set(name, { value, source: layer.label, secret, ref });
    }
  }

  // runtime 注入放在最后（PATH/解释器）。PATH 基准取已合并层里的 PATH，
  // 而不是宿主 process.env——环境是「为目标机器构造的」。
  const mergedPath = merged.get('PATH')?.value;
  for (const entry of runtimeInjections(input.runtime, input, mergedPath)) {
    if (merged.has(entry.name)) overridden.add(entry.name);
    merged.set(entry.name, { value: entry.value, source: entry.layer, secret: false, ref: '' });
  }

  const env = {};
  const masked = [];
  const report = [];
  const unresolved = [];
  const seenMask = new Set();

  for (const [name, info] of merged) {
    env[name] = info.value;
    if (info.secret) {
      if (typeof info.value === 'string' && info.value !== '' && !seenMask.has(info.value)) {
        seenMask.add(info.value);
        masked.push(info.value);
      }
      if (info.value === undefined) unresolved.push({ name, ref: info.ref });
    }
    report.push({ name, source: info.source, overridden: overridden.has(name) });
  }

  return { env, masked, report, unresolved };
}

/**
 * 同步合并环境变量（契约签名，严格返回 `{ env, masked, report }` 三字段）。
 * @param {{
 *   processEnv?: Record<string,string>|Array<{name:string,value:any,secret?:boolean}>,
 *   server?: object, envSets?: Array|object, pipeline?: object, stage?: object,
 *   job?: object, node?: object, credentials?: any, runtime?: Record<string,any>,
 *   platform?: string, probe?: object
 * }} input
 * @returns {{env: Record<string,string|undefined>, masked: string[], report: Array<{name:string,source:string,overridden:boolean}>}}
 */
export function resolveEnv(input = {}) {
  // 同步凭据读取器不支持时回退 processEnv[ref]，保证「未配置」与「已配置」可区分
  const processEnv = input.processEnv && !Array.isArray(input.processEnv) ? input.processEnv : null;
  const { unresolved, ...result } = mergeCore(input, (ref) => {
    const resolved = resolveSecretSync(input.credentials, ref);
    if (resolved.resolved) return resolved.value;
    const fallback = processEnv ? processEnv[ref] : undefined;
    return typeof fallback === 'string' && fallback !== '' ? fallback : undefined;
  });
  return result;
}

/**
 * 附加导出（非契约必需）：当宿主提供的是异步 `ctx.credentials`（DSH 的真实形态）时用它。
 * 先异步解析全部密钥引用，再走同一个同步内核，层序与覆盖语义与 `resolveEnv` 完全一致。
 * 返回值是 `resolveEnv` 的超集：额外带 `unresolved`（未解析成功的密钥，便于提示「密钥未配置」）。
 * @param {object} input 同 resolveEnv
 * @returns {Promise<{env:object, masked:string[], report:Array, unresolved:Array<{name:string,ref:string}>}>}
 */
export async function resolveEnvAsync(input = {}) {
  const refs = collectSecretRefs(input);
  const resolvedMap = new Map();
  await Promise.all(
    refs.map(async (ref) => {
      const resolved = await resolveSecretAsync(input.credentials, ref);
      if (resolved.resolved) resolvedMap.set(ref, resolved.value);
    }),
  );
  const result = mergeCore(input, (ref) => resolvedMap.get(ref));
  return result;
}

/**
 * 附加导出（非契约必需）：把文本里出现的密钥值替换成 `***`。
 * 供日志/SSE/工具输出在写盘前调用。
 * @param {string} text
 * @param {string[]} masked
 * @returns {string}
 */
export function maskSecrets(text, masked) {
  let out = String(text ?? '');
  if (!Array.isArray(masked) || masked.length === 0) return out;
  // 先长后短，避免短密钥先把长密钥的一部分替换掉
  const ordered = [...new Set(masked.filter((m) => typeof m === 'string' && m !== ''))].sort(
    (a, b) => b.length - a.length,
  );
  for (const secret of ordered) {
    out = out.split(secret).join('***');
  }
  return out;
}

/**
 * 附加导出（非契约必需）：把 `{name,value,secret}` 数组转成键值表（密钥已打码）。
 * 用于前端「环境变量合并预览」。
 * @param {Array<{name:string,value:any,secret?:boolean}>} list
 * @returns {Record<string,string>}
 */
export function toEnvRecord(list) {
  const out = {};
  for (const entry of toEntries(list)) {
    if (!entry.name) continue;
    out[entry.name] = entry.secret ? '***' : String(entry.value ?? '');
  }
  return out;
}
