/**
 * src/engine/nodes/expr.js —— condition.if 用的安全迷你表达式求值器
 *
 * **绝不使用 eval / new Function**。只实现一个手写词法 + 递归下降语法分析器，
 * 语法被严格限制为：
 *
 *   or      := and ( '||' and )*
 *   and     := cmp ( '&&' cmp )*
 *   cmp     := unary ( ('=='|'!='|'==='|'!=='|'>='|'<='|'>'|'<'|'=~'|'!~') unary )?
 *   unary   := '!' unary | primary
 *   primary := '(' or ')' | 数字 | 字符串 | true | false | null | undefined | 引用路径
 *
 * 引用路径形如 `steps.build.exitCode` / `env.ENV` / `params.tag` / `variables.X`。
 * 任何不在这套文法里的东西（函数调用、赋值、模板串、成员存取以外的东西）都是语法错误，
 * 因此不存在代码注入面。另外对危险标识符做黑名单二次拦截。
 */

/** 危险标识符黑名单（即使文法允许也拒绝解析） */
const BLOCKED_IDENTS = new Set([
  'process', 'globalThis', 'global', 'require', 'module', 'exports', 'import',
  'eval', 'Function', 'constructor', '__proto__', 'prototype', 'this', 'window',
  'document', 'fetch', 'Reflect', 'Proxy', 'Symbol', 'Object', 'Array',
]);

const MAX_EXPR_LENGTH = 2000;
const MAX_TOKENS = 400;

/** 词法分析 */
function tokenize(source) {
  const tokens = [];
  const text = String(source ?? '');
  if (text.length > MAX_EXPR_LENGTH) {
    throw new Error(`表达式过长（上限 ${MAX_EXPR_LENGTH} 字符）`);
  }
  let i = 0;
  const isDigit = (c) => c >= '0' && c <= '9';
  const isIdentStart = (c) => /[A-Za-z_$]/.test(c);
  const isIdentPart = (c) => /[A-Za-z0-9_$]/.test(c);

  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) { i += 1; continue; }

    // 多字符运算符（长优先）
    const three = text.slice(i, i + 3);
    const two = text.slice(i, i + 2);
    if (['===', '!=='].includes(three)) { tokens.push({ type: 'op', value: three, at: i }); i += 3; continue; }
    if (['==', '!=', '>=', '<=', '&&', '||', '=~', '!~'].includes(two)) {
      tokens.push({ type: 'op', value: two, at: i }); i += 2; continue;
    }
    if (['>', '<', '!'].includes(ch)) { tokens.push({ type: 'op', value: ch, at: i }); i += 1; continue; }
    if (ch === '(') { tokens.push({ type: 'lparen', value: ch, at: i }); i += 1; continue; }
    if (ch === ')') { tokens.push({ type: 'rparen', value: ch, at: i }); i += 1; continue; }

    // 字符串
    if (ch === '"' || ch === "'") {
      let out = '';
      let j = i + 1;
      let closed = false;
      while (j < text.length) {
        const c = text[j];
        if (c === '\\') {
          const next = text[j + 1];
          const map = { n: '\n', t: '\t', r: '\r', '\\': '\\', '"': '"', "'": "'" };
          out += map[next] ?? next;
          j += 2;
          continue;
        }
        if (c === ch) { closed = true; j += 1; break; }
        out += c;
        j += 1;
      }
      if (!closed) throw new Error(`字符串未闭合（位置 ${i}）`);
      tokens.push({ type: 'str', value: out, at: i });
      i = j;
      continue;
    }

    // 数字
    if (isDigit(ch) || (ch === '.' && isDigit(text[i + 1]))) {
      let j = i;
      while (j < text.length && /[0-9._]/.test(text[j])) j += 1;
      const raw = text.slice(i, j).replace(/_/g, '');
      const num = Number(raw);
      if (!Number.isFinite(num)) throw new Error(`非法数字：${raw}`);
      tokens.push({ type: 'num', value: num, at: i });
      i = j;
      continue;
    }

    // 引用路径
    if (isIdentStart(ch)) {
      let j = i;
      while (j < text.length && isIdentPart(text[j])) j += 1;
      const segments = [text.slice(i, j)];
      // 支持 .a.b 与 [0]
      for (;;) {
        if (text[j] === '.' && isIdentStart(text[j + 1])) {
          let k = j + 1;
          while (k < text.length && isIdentPart(text[k])) k += 1;
          segments.push(text.slice(j + 1, k));
          j = k;
          continue;
        }
        if (text[j] === '[' && isDigit(text[j + 1])) {
          let k = j + 1;
          while (k < text.length && isDigit(text[k])) k += 1;
          if (text[k] !== ']') throw new Error(`下标未闭合（位置 ${j}）`);
          segments.push(text.slice(j + 1, k));
          j = k + 1;
          continue;
        }
        break;
      }
      const head = segments[0];
      if (BLOCKED_IDENTS.has(head)) throw new Error(`表达式禁止使用标识符：${head}`);
      // 纯字面量
      if (segments.length === 1 && ['true', 'false', 'null', 'undefined'].includes(head)) {
        const values = { true: true, false: false, null: null, undefined: undefined };
        tokens.push({ type: 'lit', value: values[head], at: i });
      } else {
        tokens.push({ type: 'ref', value: segments, at: i });
      }
      i = j;
      continue;
    }

    throw new Error(`表达式含非法字符 ${JSON.stringify(ch)}（位置 ${i}）`);
  }

  if (tokens.length > MAX_TOKENS) throw new Error(`表达式过于复杂（token 上限 ${MAX_TOKENS}）`);
  tokens.push({ type: 'eof', value: null, at: text.length });
  return tokens;
}

/** 递归下降解析为 AST */
function parse(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const expectOp = (value) => {
    const token = peek();
    if (token.type === 'op' && token.value === value) { pos += 1; return true; }
    return false;
  };

  function parseOr() {
    let left = parseAnd();
    while (peek().type === 'op' && peek().value === '||') {
      next();
      left = { kind: 'logical', op: '||', left, right: parseAnd() };
    }
    return left;
  }

  function parseAnd() {
    let left = parseCmp();
    while (peek().type === 'op' && peek().value === '&&') {
      next();
      left = { kind: 'logical', op: '&&', left, right: parseCmp() };
    }
    return left;
  }

  function parseCmp() {
    const left = parseUnary();
    const token = peek();
    if (token.type === 'op' && ['==', '!=', '===', '!==', '>=', '<=', '>', '<', '=~', '!~'].includes(token.value)) {
      next();
      return { kind: 'compare', op: token.value, left, right: parseUnary() };
    }
    return left;
  }

  function parseUnary() {
    if (peek().type === 'op' && peek().value === '!') {
      next();
      return { kind: 'not', operand: parseUnary() };
    }
    return parsePrimary();
  }

  function parsePrimary() {
    const token = next();
    if (token.type === 'lparen') {
      const inner = parseOr();
      if (peek().type !== 'rparen') throw new Error('括号未闭合');
      next();
      return inner;
    }
    if (token.type === 'num' || token.type === 'str' || token.type === 'lit') {
      return { kind: 'literal', value: token.value };
    }
    if (token.type === 'ref') {
      return { kind: 'ref', path: token.value };
    }
    throw new Error(`表达式语法错误（位置 ${token.at}）`);
  }

  const ast = parseOr();
  if (peek().type !== 'eof') throw new Error(`表达式尾部有多余内容（位置 ${peek().at}）`);
  return ast;
}

/** 按路径从上下文取引用值 */
function readRef(context, segments) {
  let current = context;
  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object' && typeof current !== 'string') return undefined;
    current = current[segment];
  }
  return current;
}

/** 宽松相等（数字字符串与数字可比） */
function looseEquals(a, b) {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) {
    return (a ?? null) === (b ?? null);
  }
  if (typeof a === 'number' || typeof b === 'number') {
    const na = Number(a);
    const nb = Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na === nb;
  }
  return String(a) === String(b);
}

function compareValues(op, a, b) {
  switch (op) {
    case '==': return looseEquals(a, b);
    case '!=': return !looseEquals(a, b);
    case '===': return a === b;
    case '!==': return a !== b;
    case '=~':
    case '!~': {
      let re;
      try {
        re = b instanceof RegExp ? b : new RegExp(String(b));
      } catch (error) {
        throw new Error(`正则非法：${error?.message ?? error}`);
      }
      const hit = re.test(String(a ?? ''));
      return op === '=~' ? hit : !hit;
    }
    default: {
      const na = Number(a);
      const nb = Number(b);
      const numeric = !Number.isNaN(na) && !Number.isNaN(nb);
      const l = numeric ? na : String(a ?? '');
      const r = numeric ? nb : String(b ?? '');
      switch (op) {
        case '>': return l > r;
        case '>=': return l >= r;
        case '<': return l < r;
        case '<=': return l <= r;
        default: throw new Error(`未知比较运算符 ${op}`);
      }
    }
  }
}

function evaluateNode(node, context) {
  switch (node.kind) {
    case 'literal':
      return node.value;
    case 'ref':
      return readRef(context, node.path);
    case 'not':
      return !truthy(evaluateNode(node.operand, context));
    case 'logical': {
      if (node.op === '&&') {
        const left = evaluateNode(node.left, context);
        return truthy(left) ? evaluateNode(node.right, context) : left;
      }
      const left = evaluateNode(node.left, context);
      return truthy(left) ? left : evaluateNode(node.right, context);
    }
    case 'compare':
      return compareValues(node.op, evaluateNode(node.left, context), evaluateNode(node.right, context));
    default:
      throw new Error(`未知表达式节点 ${node.kind}`);
  }
}

/** JS 风格真值判断 */
export function truthy(value) {
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase();
    if (['', 'false', '0', 'no', 'off', 'null', 'undefined'].includes(lowered)) return false;
    return true;
  }
  return Boolean(value);
}

/**
 * 求值表达式。
 * @param {string} expression
 * @param {object} context 引用根（如 { env, steps, params, run, job }）
 * @returns {{value:any, truthy:boolean}}
 */
export function evaluateExpression(expression, context = {}) {
  const source = String(expression ?? '').trim();
  if (!source) throw new Error('表达式为空');
  const ast = parse(tokenize(source));
  const value = evaluateNode(ast, context);
  return { value, truthy: truthy(value) };
}

/** 只做语法校验（保存流水线时用） */
export function validateExpression(expression) {
  try {
    parse(tokenize(String(expression ?? '')));
    return { ok: true };
  } catch (error) {
    return { ok: false, message: String(error?.message ?? error) };
  }
}

export default { evaluateExpression, validateExpression, truthy };
