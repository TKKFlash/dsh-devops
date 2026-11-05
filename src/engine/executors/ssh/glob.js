/**
 * glob 复用桥：契约 §3.4 规定 `src/model/glob.js` 提供 `matchOne(pattern, path)`，
 * 由 host-core 实现。远端匹配必须复用它（不许另写一套语义）。
 *
 * 但并行开发期该文件可能尚未落地，且 Executor 可能在 host-core 交付前被 verifier 加载，
 * 因此这里做「运行期惰性加载 + 真实来源上报」：
 *   1. 优先 `import('../../../model/glob.js')`，取到 matchOne 就用真实现；
 *   2. 尚未落地时用内置降级实现，并把 `source` 标记为 'fallback'，便于测试如实判断；
 *   3. 降级只在「契约文件缺失」时触发，不会覆盖或改写契约实现。
 *
 * **防漂移**：`fallbackMatchOne` 是 `src/model/glob.js` 的**逐条镜像**（同一套
 * 花括号展开、同一套 translate 规则、同一套 `!` 取反与 `/**` 语义），
 * 因此「契约实现 vs 降级实现」的跨模块一致性测试在任何加载路径下都成立。
 * 一旦 model/glob.js 存在，运行期一律走契约实现；镜像只为契约文件缺失时兜底。
 */
import { RemotePathError } from './errors.js';

/** @type {{ fn: Function|null, source: 'model/glob'|'fallback', error: string|null, trying: Promise<any>|null,
 *           filterFn: Function|null, filterSource: 'model/glob'|'fallback', filterError: string|null, filterTrying: Promise<any>|null }} */
const cache = {
  fn: null,
  source: 'fallback',
  error: null,
  trying: null,
  filterFn: null,
  filterSource: 'fallback',
  filterError: null,
  filterTrying: null,
};

/**
 * 加载契约里的 matchOne。可重复调用（结果缓存）。
 * @returns {Promise<{ matchOne: Function, source: 'model/glob'|'fallback', error: string|null }>}
 */
export async function loadMatchOne() {
  if (cache.fn) return { matchOne: cache.fn, source: cache.source, error: cache.error };
  if (!cache.trying) {
    cache.trying = (async () => {
      try {
        const mod = await import('../../../model/glob.js');
        if (typeof mod?.matchOne === 'function') {
          cache.fn = mod.matchOne;
          cache.source = 'model/glob';
          cache.error = null;
          return;
        }
        cache.error = 'src/model/glob.js 未导出 matchOne';
      } catch (error) {
        cache.error = error?.message || String(error);
      }
      cache.fn = fallbackMatchOne;
      cache.source = 'fallback';
    })();
  }
  await cache.trying;
  return { matchOne: cache.fn, source: cache.source, error: cache.error };
}

/** 同步取用（未加载时直接给降级实现，避免调用点被迫 async）。 */
export function matchOneSync(pattern, path, opts) {
  const fn = cache.fn || fallbackMatchOne;
  return fn(pattern, path, opts);
}

/** 当前 glob 实现来源，供 probe/detail 如实标注。 */
export function globSource() {
  return { source: cache.fn ? cache.source : 'fallback', error: cache.error, loaded: Boolean(cache.fn) };
}

/** 仅供测试：重置缓存。 */
export function __resetGlobCache() {
  cache.fn = null;
  cache.source = 'fallback';
  cache.error = null;
  cache.trying = null;
  cache.filterFn = null;
  cache.filterSource = 'fallback';
  cache.filterError = null;
  cache.filterTrying = null;
}

/* ==================================================================== *
 * 以下为 src/model/glob.js 的镜像实现（仅在契约文件缺失时启用）。
 * 语义逐条对齐：`*` 不跨 `/`、`**` 跨 `/`、末尾 `/**` 也匹配目录本身、
 * `{a,b}` 可嵌套、`[abc]` / `[!abc]`、`\!` 转义为字面量 `!`、
 * `!` 前缀取反（matchOne 返回反转结果）。
 * ==================================================================== */

/** 把反斜杠分隔的路径归一成 `/` 分隔。 */
function normalizeSlashes(value) {
  return String(value ?? '').replace(/\\/g, '/');
}

/** 转义正则元字符。 */
function escapeRegExp(ch) {
  return /[.*+?^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch;
}

/** 按顶层逗号切分 `{a,b,c}` 的内部内容（忽略嵌套的花括号）。 */
function splitTopLevel(inner) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < inner.length; i += 1) {
    const c = inner[i];
    if (c === '\\') {
      current += c;
      if (i + 1 < inner.length) {
        current += inner[i + 1];
        i += 1;
      }
      continue;
    }
    if (c === '{') depth += 1;
    else if (c === '}') depth -= 1;
    if (c === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += c;
  }
  parts.push(current);
  return parts;
}

/** 展开花括号多选，返回所有等价模式（无花括号时返回自身）。 */
function expandBraces(pattern) {
  const start = pattern.indexOf('{');
  if (start === -1) return [pattern];
  let depth = 0;
  let end = -1;
  for (let i = start; i < pattern.length; i += 1) {
    const c = pattern[i];
    if (c === '\\') {
      i += 1;
      continue;
    }
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  // 花括号未闭合：按字面量处理
  if (end === -1) return [pattern];
  const prefix = pattern.slice(0, start);
  const suffix = pattern.slice(end + 1);
  const alternatives = splitTopLevel(pattern.slice(start + 1, end));
  const out = [];
  for (const alternative of alternatives) {
    for (const expandedSuffix of expandBraces(suffix)) {
      for (const expandedBody of expandBraces(alternative)) {
        out.push(prefix + expandedBody + expandedSuffix);
      }
    }
  }
  return out;
}

/** 把单个（已展开花括号的）glob 片段翻译成正则源码（不含首尾锚点）。 */
function translate(fragment) {
  let out = '';
  for (let i = 0; i < fragment.length; i += 1) {
    const c = fragment[i];
    if (c === '\\') {
      const next = fragment[i + 1];
      if (next === undefined) {
        out += '\\\\';
      } else {
        out += escapeRegExp(next);
        i += 1;
      }
      continue;
    }
    if (c === '*') {
      let stars = 1;
      while (fragment[i + 1] === '*') {
        stars += 1;
        i += 1;
      }
      if (stars >= 2) {
        if (fragment[i + 1] === '/') {
          // `**/` 匹配零个或多个路径片段（含末尾的斜杠）
          out += '(?:[^/]*/)*';
          i += 1;
        } else {
          out += '.*';
        }
      } else {
        out += '[^/]*';
      }
      continue;
    }
    if (c === '?') {
      out += '[^/]';
      continue;
    }
    if (c === '[') {
      let j = i + 1;
      let cls = '';
      if (fragment[j] === '!' || fragment[j] === '^') {
        cls += '^';
        j += 1;
      }
      if (fragment[j] === ']') {
        cls += '\\]';
        j += 1;
      }
      let closed = false;
      while (j < fragment.length) {
        if (fragment[j] === ']') {
          closed = true;
          break;
        }
        const ch = fragment[j];
        if (ch === '\\') cls += '\\\\';
        else if (ch === '^') cls += '\\^';
        else cls += ch;
        j += 1;
      }
      if (closed) {
        out += `[${cls}]`;
        i = j;
      } else {
        out += '\\[';
      }
      continue;
    }
    out += escapeRegExp(c);
  }
  return out;
}

/**
 * 编译一个 glob 模式（与契约实现同名同形的降级版）。
 *
 * `test(path)` 与 `matchOne` **完全一致**：都应用 `!` 取反语义
 * （取反模式下，命中被排除项返回 false，不命中返回 true）。
 * `matchesRaw(path)` 暴露「模式本体是否命中」，供需要区分「正模式命中」与
 * 「被 ! 排除」的调用方使用。
 *
 * @param {string} pattern
 * @param {{caseSensitive?: boolean}} [options]
 * @returns {{test:(path:string)=>boolean, matchesRaw:(path:string)=>boolean, negated:boolean, source:string, pattern:string}}
 */
export function fallbackCompile(pattern, { caseSensitive = true } = {}) {
  const raw = String(pattern ?? '');
  let negated = false;
  let body = raw;
  // `\!` 是转义的字面 `!`，不算取反
  if (body.startsWith('!')) {
    negated = true;
    body = body.slice(1);
  }
  const normalized = normalizeSlashes(body);
  const fragments = [];
  // 末尾 `/**` 同时匹配目录本身：dist/** 也命中 dist
  if (normalized.endsWith('/**')) {
    const prefix = normalized.slice(0, -3);
    for (const expanded of expandBraces(prefix)) {
      fragments.push(`${translate(expanded)}(?:/.*)?`);
    }
  } else {
    for (const expanded of expandBraces(normalized)) {
      fragments.push(translate(expanded));
    }
  }
  const source = fragments.join('|');
  const regex = new RegExp(`^(?:${source})$`, caseSensitive ? '' : 'i');
  const matchesRaw = (path) => regex.test(normalizeSlashes(path));
  return {
    pattern: raw,
    negated,
    source,
    matchesRaw,
    test(path) {
      const hit = matchesRaw(path);
      return negated ? !hit : hit;
    },
  };
}

/**
 * 契约 §3.4 语义的降级实现（`src/model/glob.js` 的镜像）。
 *
 * 取反语义：`!` 前缀表示「排除」——命中被排除的模式时返回 false，否则返回 true。
 * 即 `!*.md` 对 `a.md` 返回 false、对 `a.js` 返回 true，与契约实现完全一致。
 *
 * @param {string} pattern
 * @param {string} path
 * @param {{ caseSensitive?: boolean }} [opts]
 */
export function fallbackMatchOne(pattern, path, opts = {}) {
  return fallbackCompile(pattern, opts).test(path);
}

/**
 * 保留的兼容入口：把 glob 编译成带首尾锚点的正则。
 * 注意：与契约实现的 `compile()` 一致，`test()` 已含 `!` 取反语义。
 *
 * @param {string} glob
 * @returns {RegExp}
 */
export function globToRegExp(glob) {
  const compiled = fallbackCompile(glob);
  return new RegExp(`^(?:${compiled.source})$`);
}

/**
 * 加载契约里的 `filterPaths`（唯一权威的匹配口径，契约 §3.7.1）。
 * 与 `loadMatchOne` 同样的惰性策略：优先真实现，缺失时用镜像降级。
 *
 * @returns {Promise<{ filterPaths: Function, source: 'model/glob'|'fallback', error: string|null }>}
 */
export async function loadFilterPaths() {
  if (cache.filterFn) return { filterPaths: cache.filterFn, source: cache.filterSource, error: cache.filterError };
  if (!cache.filterTrying) {
    cache.filterTrying = (async () => {
      try {
        const mod = await import('../../../model/glob.js');
        if (typeof mod?.filterPaths === 'function') {
          cache.filterFn = mod.filterPaths;
          cache.filterSource = 'model/glob';
          cache.filterError = null;
          return;
        }
        cache.filterError = 'src/model/glob.js 未导出 filterPaths';
      } catch (error) {
        cache.filterError = error?.message || String(error);
      }
      cache.filterFn = fallbackFilterPaths;
      cache.filterSource = 'fallback';
    })();
  }
  await cache.filterTrying;
  return { filterPaths: cache.filterFn, source: cache.filterSource, error: cache.filterError };
}

/**
 * 归一化 patterns 参数：string | string[] → string[]（去空、保序）。
 * @param {string|string[]} patterns
 */
export function normalizePatterns(patterns) {
  const list = Array.isArray(patterns) ? patterns : [patterns];
  return list.map((p) => String(p ?? '').trim()).filter((p) => p !== '');
}

/**
 * 契约 §3.7.1 规则 3：**仅含取反模式时隐式补 `**`**。
 * `['!**\/*.map']` ≡ `['**','!**\/*.map']`，否则「排除某类文件」会得到空集（反直觉）。
 *
 * @param {string[]} patterns
 * @returns {string[]}
 */
export function withImplicitInclude(patterns) {
  const list = normalizePatterns(patterns);
  if (list.length === 0) return list;
  const allNegated = list.every((p) => p.startsWith('!'));
  return allNegated ? ['**', ...list] : list;
}

/**
 * 契约 §3.7.1 的降级实现（`src/model/glob.js` 的 `filterPaths` 镜像）。
 *
 * 语义：对每个路径按顺序评估所有模式，**最后一个命中的决定归属**；
 * 命中正模式 → matched，命中 `!` 模式 → ignored，都不命中 → 两组都不进。
 *
 * @param {string[]} patterns
 * @param {string[]} paths
 * @param {{caseSensitive?: boolean}} [options]
 * @returns {{matched:string[], ignored:string[], patterns:string[]}}
 */
export function fallbackFilterPaths(patterns, paths, { caseSensitive = true } = {}) {
  const patternList = normalizePatterns(patterns);
  const compiled = patternList.map((p) => fallbackCompile(p, { caseSensitive }));
  const matched = [];
  const ignored = [];
  const seen = new Set();
  for (const p of Array.isArray(paths) ? paths : []) {
    const key = String(p);
    if (seen.has(key)) continue;
    seen.add(key);
    let state = null;
    for (const candidate of compiled) {
      // 用 matchesRaw 判断「本体是否命中」，再按 negated 归类
      if (candidate.matchesRaw(key)) state = candidate.negated ? 'ignored' : 'matched';
    }
    if (state === 'matched') matched.push(key);
    else if (state === 'ignored') ignored.push(key);
  }
  return { matched, ignored, patterns: patternList };
}

/**
 * 按契约 §3.7.1 在候选路径上做匹配（复用 filterPaths 或镜像）。
 * 这是 `executor.match()` 的核心，**绝不用 matchOne 逐条过滤**
 * （单模式布尔无法表达「包含 + 排除」的组合）。
 *
 * @param {{ filterPaths: Function, source: string }} matcher
 * @param {string|string[]} patterns
 * @param {Array<{path:string,size?:number}>} entries 候选（已是完整路径）
 * @param {object} [opts]
 * @returns {{matched:Array<{path:string,size:number}>, ignored:Array<{path:string,size:number}>, truncated:boolean, total:number, patterns:string[], source:string}}
 */
export function matchWithFilterPaths(matcher, patterns, entries, opts = {}) {
  const list = withImplicitInclude(patterns);
  if (list.length === 0) {
    throw new RemotePathError('match() 需要至少一个非空 glob 模式', 'empty-glob');
  }
  const max = Number(opts.maxEntries ?? opts.maxResults ?? 20_000) || 20_000;
  const limited = entries.length > max ? entries.slice(0, max) : entries;
  const truncated = entries.length > max;

  const paths = limited.map((e) => e.path);
  const sizeByPath = new Map(limited.map((e) => [e.path, Number(e.size) || 0]));

  const { matched, ignored } = matcher.filterPaths(list, paths, {
    caseSensitive: opts.caseSensitive !== false,
  });

  return {
    matched: matched.map((p) => ({ path: p, size: sizeByPath.get(p) ?? 0 })),
    ignored: ignored.map((p) => ({ path: p, size: sizeByPath.get(p) ?? 0 })),
    truncated,
    total: paths.length,
    patterns: list,
    source: matcher.source,
  };
}

/**
 * 在远端文件列表上做匹配（保留的兼容入口，单模式场景）。
 * 新代码请用 `matchWithFilterPaths`（契约 §3.7.1 的唯一口径）。
 *
 * @param {{ matchOne: Function, source: string }} matcher
 * @param {string} base 远端根目录（用于把相对 pattern 展开成完整路径）
 * @param {string} pattern 用户 glob（允许 `!` 前缀取反）
 * @param {Array<{path:string,size?:number,isDir?:boolean,mtime?:number}>} entries
 * @param {object} [opts]
 * @returns {{ matched: Array<{path:string,size:number}>, ignored: string[], truncated: boolean, total: number, source: string }}
 */
export function matchEntries(matcher, base, pattern, entries, opts = {}) {
  const max = Number(opts.maxResults ?? opts.limit ?? 5000) || 5000;
  const caseSensitive = opts.caseSensitive !== false;
  const normalizedBase = String(base ?? '.').replace(/\/+$/, '');
  const matched = [];
  const ignored = [];
  let truncated = false;

  for (const entry of entries) {
    const full = entry.path.startsWith('/') ? entry.path : `${normalizedBase === '' ? '' : normalizedBase}/${entry.path}`;
    let hit;
    try {
      hit = matcher.matchOne(pattern, full, { caseSensitive });
    } catch {
      hit = false;
    }
    if (hit) {
      if (matched.length >= max) {
        truncated = true;
        continue;
      }
      matched.push({ path: full, size: Number(entry.size) || 0 });
    } else {
      ignored.push(full);
    }
  }
  return { matched, ignored, truncated, total: entries.length, source: matcher.source };
}

/** 防御：pattern 为空时直接报错，避免「匹配一切」造成的意外大结果集。 */
export function requirePattern(pattern) {
  if (typeof pattern !== 'string' || pattern.trim() === '') {
    throw new RemotePathError('match() 需要非空的 glob 参数', 'empty-glob');
  }
  return pattern.trim();
}
