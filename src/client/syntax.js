/**
 * src/client/syntax.js —— 轻量语法着色引擎（零依赖、纯函数、可单测）。
 *
 * 设计约束：
 *  - 不依赖 DOM / React / h.js，纯字符串 -> token 数组，便于 Node 里直接单测；
 *  - 线性扫描（不是正则回溯），对长日志与超大脚本都能保持稳定；
 *  - 只产出语义 kind，**颜色由 CSS 决定**（.dsh-devops-tok-<kind>），
 *    这样深浅色主题、终端配色都能只改样式表。
 */

/** token 语义类别（CSS 类名后缀同值）。 */
const KINDS = [
  'plain', 'keyword', 'string', 'comment', 'number',
  'function', 'operator', 'builtin', 'variable', 'type',
];

const KIND = {};
for (const k of KINDS) KIND[k] = k;

/** 支持的语言（别名在 normalizeLanguage 里归一）。 */
const LANGUAGES = ['shell', 'python', 'javascript', 'json', 'yaml'];

const KEYWORDS = {
  shell: new Set(['if','then','else','elif','fi','for','while','until','do','done','case','esac','in','function','return','break','continue','local','readonly','declare','export','unset','set','shift','trap','source','alias','eval','exec','exit','test','true','false'].map((s) => s)),
  python: new Set(['and','as','assert','async','await','break','class','continue','def','del','elif','else','except','finally','for','from','global','if','import','in','is','lambda','nonlocal','not','or','pass','raise','return','try','while','with','yield','True','False','None']),
  javascript: new Set(['async','await','break','case','catch','class','const','continue','default','delete','do','else','export','extends','finally','for','function','if','import','in','instanceof','let','new','of','return','static','super','switch','this','throw','try','typeof','var','void','while','yield','true','false','null','undefined']),
  json: new Set(['true','false','null']),
  yaml: new Set(['true','false','null','yes','no','on','off']),
};

const BUILTINS = {
  shell: new Set(['echo','cd','pwd','printf','read','mkdir','rmdir','rm','cp','mv','ln','ls','cat','head','tail','grep','sed','awk','sort','uniq','wc','cut','tr','find','xargs','tar','gzip','zip','unzip','curl','wget','git','npm','npx','pnpm','yarn','node','python','python3','pip','pip3','docker','docker-compose','kubectl','helm','make','cmake','ssh','scp','rsync','systemctl','service','chmod','chown','sudo','apt','apt-get','yum','dnf','apk','brew','date','sleep','kill','ps','df','du','env']),
  python: new Set(['print','len','range','enumerate','zip','map','filter','sum','min','max','abs','round','sorted','reversed','open','isinstance','issubclass','getattr','setattr','hasattr','super','type','repr','format','input','iter','next','any','all','Exception','ValueError','TypeError','KeyError','RuntimeError','self','cls']),
  javascript: new Set(['console','require','module','exports','process','globalThis','JSON','Object','Array','Promise','Map','Set','WeakMap','Math','Date','RegExp','Error','String','Number','Boolean','Symbol','BigInt','parseInt','parseFloat','isNaN','setTimeout','setInterval','clearTimeout','document','window','fetch','URL','Blob','File']),
  json: new Set([]),
  yaml: new Set([]),
};

/** 语言别名归一。 */
function normalizeLanguage(language) {
  const raw = String(language || '').trim().toLowerCase();
  if (!raw) return 'shell';
  if (raw === 'js' || raw === 'jsx' || raw === 'ts' || raw === 'tsx' || raw === 'node' || raw === 'javascript') return 'javascript';
  if (raw === 'py' || raw === 'python' || raw === 'python3') return 'python';
  if (raw === 'sh' || raw === 'bash' || raw === 'zsh' || raw === 'shell' || raw === 'console' || raw === 'log') return 'shell';
  if (raw === 'yml' || raw === 'yaml') return 'yaml';
  if (raw === 'json') return 'json';
  return 'shell';
}

const IDENT_START = /[A-Za-z_$]/;
const IDENT = /[A-Za-z0-9_$]/;
const OPERATOR = /[+\-*/%=<>!&|^~?:;,.(){}\[\]]/;
const WORD_BREAK = /[+\-*/%=<>!&|^~?:;,.(){}\[\]'"$#\n]/;

function isDigit(c) { return c >= '0' && c <= '9'; }

/**
 * 把源码切成 token 数组。
 * @param {string} code
 * @param {string} language
 * @returns {Array<{text:string, kind:string}>} 换行作为单独的 plain token 保留
 */
function tokenize(code, language) {
  const lang = normalizeLanguage(language);
  const text = code === null || code === undefined ? '' : String(code);
  const out = [];
  const n = text.length;
  let i = 0;
  const push = (t, kind) => { if (t !== '') out.push({ text: t, kind: kind || KIND.plain }); };
  const hashComment = lang === 'python' || lang === 'shell' || lang === 'yaml';
  const slashComment = lang === 'javascript';
  const blockComment = lang === 'javascript';

  while (i < n) {
    const ch = text[i];

    if (ch === '\n') { push('\n', KIND.plain); i += 1; continue; }

    // 字符串优先于注释：'#' 或 '//' 出现在字符串里时按字符串处理
    if (ch === '"' || ch === "'" || (lang === 'javascript' && ch === '`')) {
      const triple = (lang === 'python') && text.slice(i, i + 3) === ch + ch + ch;
      if (triple) {
        let j = i + 3;
        while (j < n && text.slice(j, j + 3) !== ch + ch + ch) j += 1;
        j = Math.min(n, j + 3);
        push(text.slice(i, j), KIND.string);
        i = j; continue;
      }
      let j = i + 1;
      while (j < n && text[j] !== ch && text[j] !== '\n') {
        if (text[j] === '\\') j += 1;
        j += 1;
      }
      j = Math.min(n, j + 1);
      const literal = text.slice(i, j);
      // Shell 的双引号里 $VAR 仍会展开：把变量单独切出来着色，
      // 否则 "hi $NAME" 里的 $NAME 会被整段当字符串，配色失真。
      if (lang === 'shell' && ch === '"' && literal.indexOf('$') > 0) {
        let cursor = 0;
        const varRe = /\$\{[^}]*\}|\$[A-Za-z_][A-Za-z0-9_]*|\$[0-9@*#?$!-]/g;
        let vm = varRe.exec(literal);
        while (vm) {
          if (vm.index > cursor) push(literal.slice(cursor, vm.index), KIND.string);
          push(vm[0], KIND.variable);
          cursor = vm.index + vm[0].length;
          vm = varRe.exec(literal);
        }
        if (cursor < literal.length) push(literal.slice(cursor), KIND.string);
      } else {
        push(literal, KIND.string);
      }
      i = j; continue;
    }

    if (hashComment && ch === '#') {
      let j = i;
      while (j < n && text[j] !== '\n') j += 1;
      push(text.slice(i, j), KIND.comment);
      i = j; continue;
    }

    if (slashComment && ch === '/' && text[i + 1] === '/') {
      let j = i;
      while (j < n && text[j] !== '\n') j += 1;
      push(text.slice(i, j), KIND.comment);
      i = j; continue;
    }

    if (blockComment && ch === '/' && text[i + 1] === '*') {
      let j = i + 2;
      while (j < n && !(text[j] === '*' && text[j + 1] === '/')) j += 1;
      j = Math.min(n, j + 2);
      push(text.slice(i, j), KIND.comment);
      i = j; continue;
    }

    if (isDigit(ch) || (ch === '.' && isDigit(text[i + 1]))) {
      let j = i;
      while (j < n && /[0-9a-fA-FxXoObB._]/.test(text[j])) j += 1;
      push(text.slice(i, j), KIND.number);
      i = j; continue;
    }

    if (lang === 'shell' && ch === '$') {
      let j = i + 1;
      if (text[j] === '{') {
        while (j < n && text[j] !== '}') j += 1;
        j = Math.min(n, j + 1);
      } else {
        while (j < n && /[A-Za-z0-9_]/.test(text[j])) j += 1;
      }
      push(text.slice(i, j), KIND.variable);
      i = j; continue;
    }

    if (IDENT_START.test(ch)) {
      let j = i;
      while (j < n && IDENT.test(text[j])) j += 1;
      const word = text.slice(i, j);
      let k = j;
      while (k < n && (text[k] === ' ' || text[k] === '\t')) k += 1;
      let kind = KIND.plain;
      if (KEYWORDS[lang] && KEYWORDS[lang].has(word)) kind = KIND.keyword;
      else if (BUILTINS[lang] && BUILTINS[lang].has(word)) kind = KIND.builtin;
      else if (text[k] === '(') kind = KIND.function;
      else if ((lang === 'python' || lang === 'javascript') && /^[A-Z][A-Za-z0-9_]*$/.test(word)) kind = KIND.type;
      push(word, kind);
      i = j; continue;
    }

    if (OPERATOR.test(ch)) {
      let j = i + 1;
      while (j < n && /[+\-*/%=<>!&|^~?:]/.test(text[j])) j += 1;
      push(text.slice(i, j), KIND.operator);
      i = j; continue;
    }

    let j = i;
    while (j < n && !IDENT_START.test(text[j]) && !isDigit(text[j]) && !WORD_BREAK.test(text[j]) && text[j] !== '$' && text[j] !== '\n') j += 1;
    if (j === i) j = i + 1;
    push(text.slice(i, j), KIND.plain);
    i = j;
  }
  return out;
}

/**
 * 按行切分 token（代码编辑器/日志都是行式渲染）。
 * @returns {Array<Array<{text:string, kind:string}>>} 每行的 token 列表（行内不含 '\n'）
 */
function tokenizeLines(code, language) {
  const tokens = tokenize(code, language);
  const lines = [[]];
  for (const token of tokens) {
    const parts = String(token.text).split('\n');
    for (let p = 0; p < parts.length; p += 1) {
      if (p > 0) lines.push([]);
      if (parts[p] !== '') lines[lines.length - 1].push({ text: parts[p], kind: token.kind });
    }
  }
  return lines;
}

/** 单行着色（日志逐行调用；行内不补语的状态由调用方决定是否整段 tokenize）。 */
function tokenizeLine(line, language) {
  const parts = tokenize(String(line === null || line === undefined ? '' : line), language);
  return parts.filter((t) => t.text !== '\n');
}

/**
 * 猜测语言：shebang > python/js 特征 > json 形状 > 默认 shell。
 * 仅供日志面板的「自动」模式使用，猜错不影响可读性（可手动切换）。
 */
function detectLanguage(code) {
  const text = String(code || '');
  const first = (text.split('\n')[0] || '').trim();
  if (/^#!.*\bpython/.test(first)) return 'python';
  if (/^#!\//.test(first)) return 'shell';
  if (/(^|\n)\s*(def\s+\w+\s*\(|class\s+\w+|@\w+|from\s+[\w.]+\s+import\b)/.test(text)) return 'python';
  if (/\bprint\(|\bself\b|\bNone\b/.test(text)) return 'python';
  if (/(^|\n)\s*(const|let|var|function|import|export|async)\s|=>|\bconsole\.log\(/.test(text)) return 'javascript';
  const trimmed = text.trim();
  if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && /"\s*:/.test(text)) return 'json';
  return 'shell';
}

exports.KINDS = KINDS;
exports.KIND = KIND;
exports.LANGUAGES = LANGUAGES;
exports.normalizeLanguage = normalizeLanguage;
exports.tokenize = tokenize;
exports.tokenizeLines = tokenizeLines;
exports.tokenizeLine = tokenizeLine;
exports.detectLanguage = detectLanguage;
