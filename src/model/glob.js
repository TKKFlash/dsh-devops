/**
 * 零依赖 glob 实现。
 *
 * 支持语法：
 *   - `*`       匹配任意字符（不跨 `/`）
 *   - `**`      跨 `/` 匹配任意层级；`a/**\/b` 也匹配 `a/b`
 *   - `?`       匹配单个字符（不跨 `/`）
 *   - `{a,b}`   花括号多选（可嵌套、可出现在路径片段中间）
 *   - `[abc]`、`[!abc]`/`[^abc]`  字符类
 *   - `!` 前缀  取反（仅第一个字符生效，可用 `\!` 转义为字面量 `!`）
 *
 * 路径统一把 `\` 归一成 `/` 再比较；不做 realpath、不访问文件系统。
 * 纯字符串 + 正则实现，不引入任何第三方库。
 */

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
      // alternative 自身可能还含花括号，继续递归展开
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
 * 编译一个 glob 模式。
 *
 * `test(path)` 与 `matchOne` **完全一致**：都应用 `!` 取反语义
 * （取反模式下，命中被排除项返回 false，不命中返回 true）。
 * `matchesRaw(path)` 暴露「模式本体是否命中」，供 `filterPaths` 区分
 * 「正模式命中」与「被 ! 排除」，两套语义因此不会互相污染。
 *
 * @param {string} pattern glob 模式，可用 `!` 前缀表示取反
 * @param {{caseSensitive?: boolean}} [options]
 * @returns {{test: (path: string) => boolean, matchesRaw: (path: string) => boolean,
 *            negated: boolean, source: string, pattern: string}}
 */
export function compile(pattern, { caseSensitive = true } = {}) {
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
 * 单模式匹配。
 *
 * 取反语义（与 `filterPaths` 的 ignored、以及远端降级实现一致）：
 * `!` 前缀表示「排除」——路径**命中被排除的模式时返回 false**，
 * 不命中时返回 true。这样 `matchOne('!*.md', 'a.md') === false`、
 * `matchOne('!*.md', 'a.js') === true`，本地与远端 glob 结论一致。
 *
 * @param {string} pattern
 * @param {string} path
 * @param {{caseSensitive?: boolean}} [options]
 * @returns {boolean}
 */
export function matchOne(pattern, path, options = {}) {
  return compile(pattern, options).test(path);
}

/**
 * 按模式列表把路径划分为「命中」与「被取反排除」两组。
 * 语义：对每个路径按顺序评估所有模式，**最后**命中的模式决定归属；
 * 命中正模式 → matched，命中 `!` 模式 → ignored，任何模式都没命中 → 两组都不进。
 * @param {string[]} patterns
 * @param {string[]} paths
 * @param {{caseSensitive?: boolean}} [options]
 * @returns {{matched: string[], ignored: string[], patterns: string[]}}
 */
export function filterPaths(patterns, paths, { caseSensitive = true } = {}) {
  const patternList = Array.isArray(patterns) ? patterns.map((p) => String(p)) : [];
  const compiled = patternList.map((p) => compile(p, { caseSensitive }));
  const matched = [];
  const ignored = [];
  const seen = new Set();
  for (const path of Array.isArray(paths) ? paths : []) {
    const key = String(path);
    if (seen.has(key)) continue;
    seen.add(key);
    let state = null;
    for (const candidate of compiled) {
      // 用 matchesRaw 而非 test：这里要判断「本体是否命中」，再按 negated 归类
      if (candidate.matchesRaw(key)) state = candidate.negated ? 'ignored' : 'matched';
    }
    if (state === 'matched') matched.push(key);
    else if (state === 'ignored') ignored.push(key);
  }
  return { matched, ignored, patterns: patternList };
}
