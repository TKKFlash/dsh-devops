/**
 * dsh-devops 前端产物 —— 由 scripts/build-client.mjs 自动生成，请勿手工编辑。
 * 修改界面请改 src/client/*.js，然后运行：node scripts/build-client.mjs
 */
window.__ModuleLoader__.load({
  id: "dsh-devops",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    // ---- 迷你模块表 ----------------------------------------------------
    var __defs = Object.create(null);
    var __cache = Object.create(null);
    function __def(id, fn) { __defs[id] = fn; }
    function __req(id) {
      var def = __defs[id];
      if (def === undefined) return require(id); // 宿主 module table（白名单）
      var hit = __cache[id];
      if (hit !== undefined) return hit.exports;
      var m = { exports: {} };
      __cache[id] = m;
      def(m, m.exports, __req);
      return m.exports;
    }
    function __has(id) { return __defs[id] !== undefined; }
    // -------------------------------------------------------------------

__def("./h.js", function (module, exports, require) {
/**
 * 渲染基元：只依赖宿主 module table 白名单里的 react。
 * 全部界面用 h(...) 构造，不引入 JSX（本工程没有编译器）。
 */
const React = require('react');

const h = React.createElement;

const Fragment = React.Fragment;

// React hooks 统一从这里取，避免各模块各自 require('react')。
const useState = React.useState;
const useEffect = React.useEffect;
const useMemo = React.useMemo;
const useCallback = React.useCallback;
const useRef = React.useRef;
const useReducer = React.useReducer;

/** 订阅外部数据源；优先用 React 18 的 useSyncExternalStore，缺失时降级。 */
const useSyncExternalStore =
  typeof React.useSyncExternalStore === 'function'
    ? React.useSyncExternalStore
    : function (subscribe, getSnapshot) {
        const [value, setValue] = useState(getSnapshot);
        useEffect(() => subscribe(() => setValue(getSnapshot())), [subscribe, getSnapshot]);
        return value;
      };

/** 拼接 className，过滤掉假值。 */
function cx() {
  let out = '';
  for (let i = 0; i < arguments.length; i += 1) {
    const piece = arguments[i];
    if (!piece) continue;
    out = out ? out + ' ' + piece : String(piece);
  }
  return out;
}

/** 毫秒 → 人读时长，例如 83s → "1m 23s"。 */
function fmtDuration(ms) {
  if (ms === null || ms === undefined || !isFinite(ms) || ms < 0) return '—';
  const total = Math.floor(ms / 1000);
  if (total < 60) return total + 's';
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m < 60) return m + 'm ' + String(s).padStart(2, '0') + 's';
  const hh = Math.floor(m / 60);
  return hh + 'h ' + String(m % 60).padStart(2, '0') + 'm';
}

/** 时间戳 → 本地时间文案。 */
function fmtTime(ts) {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

/** 时间戳 → 相对现在（「3 分钟前」）。 */
function fmtAgo(ts, now) {
  if (!ts) return '从未';
  const delta = (now || Date.now()) - ts;
  if (delta < 0) return '刚刚';
  if (delta < 60000) return Math.floor(delta / 1000) + ' 秒前';
  if (delta < 3600000) return Math.floor(delta / 60000) + ' 分钟前';
  if (delta < 86400000) return Math.floor(delta / 3600000) + ' 小时前';
  return Math.floor(delta / 86400000) + ' 天前';
}

function fmtBytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return (i === 0 ? v : v.toFixed(1)) + ' ' + units[i];
}

/** 截断长文本，保留头尾。 */
function ellipsis(text, max) {
  const s = String(text === null || text === undefined ? '' : text);
  const limit = max || 120;
  if (s.length <= limit) return s;
  return s.slice(0, limit - 1) + '…';
}

/** 深拷贝（结构化克隆优先，降级 JSON）。 */
function clone(value) {
  if (value === null || typeof value !== 'object') return value;
  try {
    if (typeof structuredClone === 'function') return structuredClone(value);
  } catch {
    /* 含函数时降级 */
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

/** 每秒触发一次重渲染，用于耗时/「多久没输出」这类纯本地走秒显示。 */
function useTick(active) {
  const [, force] = useReducer((n) => n + 1, 0);
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(force, 1000);
    return () => clearInterval(id);
  }, [active]);
  return undefined;
}

/** 防抖：返回一个稳定的包装函数。 */
function useDebounced(fn, delay) {
  const timer = useRef(null);
  const latest = useRef(fn);
  latest.current = fn;
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return useCallback(
    function () {
      const args = arguments;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => latest.current.apply(null, args), delay || 300);
    },
    [delay],
  );
}

/** 把可能的分组结构拍平。 */
function groupBy(items, keyOf) {
  const out = new Map();
  for (const item of items || []) {
    const key = keyOf(item);
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(item);
  }
  return out;
}

/**
 * 当前是否为 Windows 平台；判断不出时返回 false（保持 POSIX 风格）。
 * 只用于占位示例这类展示性判断，不参与任何逻辑分支。
 */
function isWindowsPlatform() {
  try {
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    return /Windows|Win32|Win64/i.test(ua);
  } catch {
    return false;
  }
}

/**
 * 与运行平台相符的路径占位示例。
 * Windows 上给 C:\... 才有参考价值；无法判断平台时保留 POSIX 风格。
 */
function pathPlaceholder(kind) {
  if (isWindowsPlatform()) {
    return kind === 'file' ? 'C:\\path\\to\\repo\\file.txt' : 'C:\\path\\to\\repo';
  }
  return kind === 'file' ? '/srv/app/file.txt' : '/srv/app';
}

/** 复制到剪贴板，返回 Promise<boolean>；非安全上下文降级为 execCommand。 */
async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 继续降级 */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', 'readonly');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

exports.h = h;
exports.React = React;
exports.Fragment = Fragment;
exports.useState = useState;
exports.useEffect = useEffect;
exports.useMemo = useMemo;
exports.useCallback = useCallback;
exports.useRef = useRef;
exports.useReducer = useReducer;
exports.useSyncExternalStore = useSyncExternalStore;
exports.cx = cx;
exports.fmtDuration = fmtDuration;
exports.fmtTime = fmtTime;
exports.fmtAgo = fmtAgo;
exports.fmtBytes = fmtBytes;
exports.ellipsis = ellipsis;
exports.clone = clone;
exports.useTick = useTick;
exports.useDebounced = useDebounced;
exports.groupBy = groupBy;
exports.copyText = copyText;
exports.isWindowsPlatform = isWindowsPlatform;
exports.pathPlaceholder = pathPlaceholder;
});

__def("./styles.js", function (module, exports, require) {
/**
 * 样式：一次性注入 <style>，类名前缀 .dsh-devops-，颜色只用 --dsw-alias-* token。
 * 深色模式无需额外处理——token 自身随主题切换。
 *
 * 设计语言抽取自参考实现（src/client/theme.ts + DevopsUI.module.css）：
 * 令牌层全部 var(<宿主 token>, <回退>)；胶囊按钮；color-mix 淡色徽标；
 * tab 下划线指示条；虚线空态卡；elevation 阴影。**只读消费 --dsw-alias-*，不重定义。**
 */

/** 只在首次调用时插入样式标签，重复调用无副作用。 */
function ensureStyles() {
  const ID = 'dsh-devops-style';
  if (document.getElementById(ID)) return;
  const style = document.createElement('style');
  style.id = ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

// 注意：r-lg / r-xl 用 fallback 串起来，兼容不同版本的 token 集合。
// 令牌层挂在 .dsh-devops-root 上而非 body/:root：主面板与状态栏根元素都带该类，
// 且宿主令牌是 body 级声明，作用域在这里才能稳定继承。
const CSS = `
.dsh-devops-root{
  /* ── 令牌层：每一项都是 var(<宿主 token>, <回退>)，宿主换肤/换主题整体跟随 ── */
  --dv-r-sm: var(--dsw-radius-sm, 6px);
  --dv-r-md: var(--dsw-radius-md, 8px);
  --dv-r-lg: var(--dsw-radius-lg, 12px);
  --dv-r-xl: var(--dsw-radius-panel, 16px);
  --dv-r-pill: 999px;
  --dv-border: var(--dsw-alias-border-l1, rgba(0,0,0,.06));
  --dv-border-2: var(--dsw-alias-border-l2, rgba(0,0,0,.1));
  --dv-border-3: var(--dsw-alias-border-l3, rgba(0,0,0,.14));
  --dv-border-4: var(--dsw-alias-border-l4, rgba(0,0,0,.18));
  --dv-fg: var(--dsw-alias-label-primary, #0f1115);
  --dv-fg-2: var(--dsw-alias-label-secondary, #61666b);
  --dv-fg-3: var(--dsw-alias-label-tertiary, #81858c);
  --dv-fg-4: var(--dsw-alias-label-dimmed, #b9bec6);
  --dv-caption: var(--dsw-alias-label-caption, #9aa0a6);
  --dv-surface: var(--dsw-alias-bg-layer-1, transparent);
  --dv-surface-2: var(--dsw-alias-bg-layer-2, transparent);
  --dv-surface-3: var(--dsw-alias-bg-layer-3, transparent);
  --dv-inset: var(--dsw-alias-bg-module-platform, var(--dsw-alias-bg-layer-2, transparent));
  --dv-input-bg: var(--dsw-alias-bg-layer-1, transparent);
  --dv-code-bg: var(--dsw-alias-markdown-code-block, transparent);
  --dv-primary: var(--dsw-alias-brand-primary, var(--dsw-alias-button-primary-fill, #4176e6));
  --dv-accent: var(--dsw-alias-state-business-primary, #4176e6);
  --dv-btn: var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary, #0f1115));
  --dv-btn-hover: var(--dsw-alias-button-primary-hover, var(--dsw-alias-brand-primary, #43454a));
  --dv-btn-fg: var(--dsw-alias-label-primary-foreground, #ffffff);
  --dv-hover: var(--dsw-alias-interactive-bg-hover, rgba(38,49,72,.06));
  --dv-active: var(--dsw-alias-interactive-bg-active, var(--dsw-alias-interactive-bg-hover, rgba(38,49,72,.1)));
  --dv-mask: var(--dsw-alias-bg-mask-1, rgba(0,0,0,.28));
  --dv-blur: var(--dsw-mask-blur, blur(2px));
  --dv-ok: var(--dsw-alias-state-success-primary, #22c55e);
  --dv-warn: var(--dsw-alias-state-warn-primary, #f59e0b);
  --dv-err: var(--dsw-alias-state-error-primary, #ec1313);
  --dv-err-soft: var(--dsw-alias-state-error-secondary, #f25a5a);
  --dv-busy: var(--dsw-alias-state-business-primary, #4176e6);
  --dv-idle: var(--dsw-alias-state-idle-primary, #9aa0a6);
  --dv-toast-bg: var(--dsw-alias-toast-bg, var(--dsw-alias-bg-layer-3, #353638));
  --dv-toast-fg: var(--dsw-alias-toast-label, var(--dsw-alias-label-primary, #f9fafb));
  --dv-elev-1: var(--dsw-elevation-panel, 0 4px 16px rgba(0,0,0,.16));
  --dv-elev-2: var(--dsw-elevation-prominent, 0 12px 40px rgba(0,0,0,.28));
  --dv-code-font: var(--dsw-font-family-code, monospace);
  --dv-font-xs: calc(10px + var(--dsh-content-font-delta, 0px));
  --dv-font-sm: var(--dsh-content-font-size-secondary, 12px);
  --dv-font: var(--dsh-content-font-size, 13px);
  --dv-font-lg: calc(15px + var(--dsh-content-font-delta, 0px));
  --dv-font-xl: calc(18px + var(--dsh-content-font-delta, 0px));
  --dv-t-fast: .12s;
  --dv-t: .16s;
  --dv-t-slow: .24s;
  --dv-ease: cubic-bezier(.2,.7,.3,1);

  /* ─────────────────────────────────────────────────────────────────────
     终端调色板：**自带深色，不跟随宿主主题变白**（用户明确要"黑色的 Linux 终端"）。
     固定色值集中在此定义，规则里只 var()/color-mix 复用——这样硬编码色值总量可控，
     且深浅主题下终端始终是深底浅字。
     ───────────────────────────────────────────────────────────────────── */
  --dv-term-bg: #0d1117;                                             /* 终端主底 */
  --dv-term-bg-2: color-mix(in srgb,var(--dv-term-bg) 88%,white);     /* 工具栏/行号槽 */
  --dv-term-bg-3: color-mix(in srgb,var(--dv-term-bg) 78%,white);     /* gap 提示条 */
  --dv-term-line: color-mix(in srgb,var(--dv-term-bg) 70%,white);     /* 终端内分隔线 */
  --dv-term-fg: #d6deeb;                                             /* 终端主文字 */
  --dv-term-dim: color-mix(in srgb,var(--dv-term-fg) 58%,var(--dv-term-bg));  /* 行号/次要 */
  --dv-term-stderr: #ff7b72;                                         /* stderr 偏红 */
  --dv-term-sel: color-mix(in srgb,var(--dv-term-fg) 24%,transparent);/* 选区 */
  --dv-term-mark: color-mix(in srgb,var(--dv-warn) 38%,transparent);  /* 过滤命中底 */
  --dv-term-font: var(--dsw-font-family-code,ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",Menlo,monospace);
  --dv-term-fs: 12.5px;
  --dv-term-lh: 1.6;
  --dv-term-pad-y: 8px;
  --dv-term-pad-x: 10px;

  /* ── 语法 token 调色板（syntax.js 的 kind → 类名）。深底上的可读色相，参考 One Dark。── */
  --dv-tok-keyword: #c792ea;   /* 关键字：紫 */
  --dv-tok-string: #c3e88d;    /* 字符串：绿 */
  --dv-tok-number: #f78c6c;    /* 数字：橙 */
  --dv-tok-function: #82aaff;  /* 函数：蓝 */
  --dv-tok-operator: #89ddff;  /* 运算符：青 */
  --dv-tok-builtin: #ffcb6b;   /* 内置：琥珀 */
  --dv-tok-variable: #7fdbca;  /* 变量：青绿 */
  --dv-tok-type: color-mix(in srgb,var(--dv-tok-builtin) 62%,white); /* 类型：浅黄（与内置拉开） */
  --dv-tok-comment: var(--dv-term-dim);                              /* 注释：灰（斜体） */
  --dv-tok-plain: var(--dv-term-fg);
  box-sizing:border-box;
  display:flex;
  min-height:0;
  height:100%;
  width:100%;
  color:var(--dv-fg);
  background:var(--dsw-alias-bg-base);
  font-size:var(--dv-font);
  line-height:20px;
}
.dsh-devops-root *,.dsh-devops-root *::before,.dsh-devops-root *::after{box-sizing:border-box}
.dsh-devops-root button{font-family:inherit}

/* ---------- 页内二级导航 ---------- */
.dsh-devops-nav{
  flex:none;width:132px;display:flex;flex-direction:column;gap:2px;
  padding:calc(var(--dsh-frame-top-clearance,0px) + 8px) 8px 12px 12px;
  border-right:0.5px solid var(--dv-border-3);
  overflow-y:auto;
}
.dsh-devops-nav-item{
  display:flex;align-items:center;gap:8px;width:100%;min-height:30px;padding:4px 8px;
  border:none;background:transparent;color:var(--dv-fg-2);border-radius:var(--dv-r-md);
  cursor:pointer;font-size:var(--dv-font);text-align:left;
  transition:background-color var(--dv-t) var(--dv-ease),color var(--dv-t) var(--dv-ease);
}
.dsh-devops-nav-item:hover{background:var(--dv-hover);color:var(--dv-fg)}
.dsh-devops-nav-item[data-active="true"]{background:var(--dv-active);color:var(--dv-fg);font-weight:500}
.dsh-devops-nav-dot{
  flex:none;display:inline-flex;align-items:center;justify-content:center;
  width:18px;height:18px;font-size:var(--dv-font);
}

/* ---------- 主区 ---------- */
.dsh-devops-main{flex:1;min-width:0;display:flex;flex-direction:column;min-height:0}
.dsh-devops-head{
  flex:none;display:flex;align-items:center;gap:10px;flex-wrap:wrap;
  padding:calc(var(--dsh-frame-top-clearance,0px) + 10px) 16px 10px 16px;
  border-bottom:0.5px solid var(--dv-border-3);
}
.dsh-devops-title{font-size:var(--dv-font-lg);font-weight:600;color:var(--dv-fg);margin:0}
.dsh-devops-sub{color:var(--dv-fg-3);font-size:var(--dv-font-sm)}
.dsh-devops-spacer{flex:1}
.dsh-devops-body{flex:1;min-height:0;overflow:auto;padding:14px 16px 24px 16px}
.dsh-devops-body[data-flush="true"]{padding:0;overflow:hidden;display:flex;flex-direction:column}

/* ---------- 状态条（页内） ---------- */
.dsh-devops-statusbar-inline{
  flex:none;display:flex;align-items:center;gap:12px;flex-wrap:wrap;
  padding:5px 16px;font-size:var(--dv-font-sm);color:var(--dv-fg-3);
  border-bottom:0.5px solid var(--dv-border-3);
  background:var(--dv-surface);
}
/* 徽标：淡色底 + 同色文字（color-mix），替代原先「描边 + 文字色」的单调写法 */
.dsh-devops-chip{
  display:inline-flex;align-items:center;gap:5px;padding:1px 8px;border-radius:var(--dv-r-pill);
  border:0.5px solid transparent;font-size:var(--dv-font-xs);font-weight:500;
  color:var(--dv-fg-2);background:color-mix(in srgb,var(--dv-fg-3) 14%,transparent);
  transition:background-color var(--dv-t) var(--dv-ease),color var(--dv-t) var(--dv-ease);
}
.dsh-devops-chip[data-tone="ok"]{color:var(--dv-ok);background:color-mix(in srgb,var(--dv-ok) 14%,transparent)}
.dsh-devops-chip[data-tone="warn"]{color:var(--dv-warn);background:color-mix(in srgb,var(--dv-warn) 16%,transparent)}
.dsh-devops-chip[data-tone="error"]{color:var(--dv-err-soft);background:color-mix(in srgb,var(--dv-err-soft) 14%,transparent)}
.dsh-devops-chip[data-tone="busy"]{color:var(--dv-busy);background:color-mix(in srgb,var(--dv-busy) 14%,transparent)}
.dsh-devops-dot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--dv-idle)}
.dsh-devops-dot[data-tone="ok"]{background:var(--dv-ok)}
.dsh-devops-dot[data-tone="warn"]{background:var(--dv-warn)}
.dsh-devops-dot[data-tone="error"]{background:var(--dv-err)}
.dsh-devops-dot[data-tone="busy"]{background:var(--dv-busy);animation:dsh-devops-pulse 1.2s ease-in-out infinite}
@keyframes dsh-devops-pulse{0%,100%{opacity:.35}50%{opacity:1}}

/* ---------- 通用控件：胶囊按钮 ---------- */
.dsh-devops-btn{
  display:inline-flex;align-items:center;justify-content:center;gap:6px;
  min-height:28px;padding:4px 12px;border-radius:var(--dv-r-pill);cursor:pointer;
  border:0.5px solid var(--dv-border);background:transparent;color:var(--dv-fg);
  font-size:var(--dv-font-sm);font-weight:500;white-space:nowrap;
  transition:background-color var(--dv-t) var(--dv-ease),border-color var(--dv-t) var(--dv-ease),
    color var(--dv-t) var(--dv-ease),box-shadow var(--dv-t) var(--dv-ease),transform var(--dv-t-fast) var(--dv-ease);
}
.dsh-devops-btn:hover:not(:disabled){background:var(--dv-hover);border-color:var(--dv-border-3)}
.dsh-devops-btn:active:not(:disabled){background:var(--dv-active);transform:translateY(0.5px)}
.dsh-devops-btn:focus-visible{outline:2px solid color-mix(in srgb,var(--dv-accent) 55%,transparent);outline-offset:1px}
.dsh-devops-btn:disabled{opacity:.45;cursor:default}
.dsh-devops-btn[data-variant="primary"]{
  background:var(--dv-btn);border-color:transparent;color:var(--dv-btn-fg);
  box-shadow:0 1px 2px rgba(0,0,0,.12);
}
.dsh-devops-btn[data-variant="primary"]:hover:not(:disabled){background:var(--dv-btn-hover);border-color:transparent}
.dsh-devops-btn[data-variant="primary"]:active:not(:disabled){background:var(--dv-btn-hover)}
.dsh-devops-btn[data-variant="danger"]{
  color:var(--dv-err-soft);border-color:transparent;
  background:color-mix(in srgb,var(--dv-err-soft) 12%,transparent);
}
.dsh-devops-btn[data-variant="danger"]:hover:not(:disabled){background:color-mix(in srgb,var(--dv-err-soft) 20%,transparent);border-color:transparent}
.dsh-devops-btn[data-variant="ghost"]{border-color:transparent;color:var(--dv-fg-2)}
.dsh-devops-btn[data-variant="ghost"]:hover:not(:disabled){background:var(--dv-hover);color:var(--dv-fg);border-color:transparent}
.dsh-devops-btn[data-size="sm"]{min-height:22px;padding:2px 9px;font-size:var(--dv-font-xs)}
.dsh-devops-btn[data-active="true"]{background:var(--dv-active);border-color:var(--dv-border-3);color:var(--dv-fg)}
.dsh-devops-input,.dsh-devops-select,.dsh-devops-textarea{
  /* min-width:0/max-width:100%：检查器很窄时控件必须能被压缩，
     否则会撑出横向滚动条（截图里"执行条件/服务器"被挤到看不见就是这个原因）。 */
  width:100%;min-width:0;max-width:100%;min-height:28px;padding:3px 9px;border-radius:var(--dv-r-md);
  border:0.5px solid var(--dv-border-2);background:var(--dv-input-bg);
  color:var(--dv-fg);font-size:var(--dv-font-sm);font-family:inherit;outline:none;
  transition:border-color var(--dv-t) var(--dv-ease),box-shadow var(--dv-t) var(--dv-ease),background-color var(--dv-t) var(--dv-ease);
}
.dsh-devops-input:hover:not(:disabled),.dsh-devops-select:hover:not(:disabled),.dsh-devops-textarea:hover:not(:disabled){border-color:var(--dv-border-3)}
.dsh-devops-input:focus,.dsh-devops-select:focus,.dsh-devops-textarea:focus{
  border-color:var(--dv-accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--dv-accent) 22%,transparent);
}
.dsh-devops-textarea{min-height:64px;resize:vertical;line-height:18px}
.dsh-devops-input::placeholder,.dsh-devops-textarea::placeholder{color:var(--dv-caption)}
.dsh-devops-select{cursor:pointer}
.dsh-devops-switch{
  position:relative;width:34px;height:18px;border-radius:var(--dv-r-pill);flex:none;cursor:pointer;
  border:0.5px solid var(--dv-border);background:var(--dv-surface-2);padding:0;
  transition:background-color var(--dv-t) var(--dv-ease),border-color var(--dv-t) var(--dv-ease);
}
.dsh-devops-switch[data-on="true"]{background:var(--dv-primary);border-color:transparent}
.dsh-devops-switch span{
  position:absolute;top:1px;left:1px;width:14px;height:14px;border-radius:50%;
  background:var(--dsw-alias-switch-thumb,#fff);
  transition:left var(--dv-t) var(--dv-ease);
}
.dsh-devops-switch[data-on="true"] span{left:17px}

/* ---------- 字段 / 检查器 ---------- */
.dsh-devops-field{display:flex;flex-direction:column;gap:4px;margin-bottom:10px}
.dsh-devops-field-head{display:flex;align-items:center;gap:6px;font-size:var(--dv-font-sm);color:var(--dv-fg-2)}
.dsh-devops-field-label{font-weight:500;color:var(--dv-fg)}
.dsh-devops-required{color:var(--dv-err)}
.dsh-devops-field-desc{font-size:var(--dv-font-xs);color:var(--dv-fg-3);line-height:16px}
.dsh-devops-field-row{display:flex;gap:6px;align-items:center;min-width:0;flex-wrap:wrap}
.dsh-devops-field-row>*{min-width:0}
.dsh-devops-field-error{font-size:var(--dv-font-xs);color:var(--dv-err-soft)}
.dsh-devops-hint{font-size:var(--dv-font-xs);color:var(--dv-fg-3)}
/* 代码编辑器 = 深色终端：着色层（pre）+ 透明 textarea 叠加。
   两层必须**严格同字体/行高/内边距**，textarea 文字透明、caret 可见，否则光标与着色错位。 */
.dsh-devops-code{
  display:flex;border:0.5px solid var(--dv-term-line);border-radius:var(--dv-r-md);
  overflow:hidden;background:var(--dv-term-bg);color:var(--dv-term-fg);
  font-family:var(--dv-term-font);font-size:var(--dv-term-fs);line-height:var(--dv-term-lh);
}
.dsh-devops-code-gutter{
  flex:none;display:flex;flex-direction:column;align-items:flex-end;
  padding:var(--dv-term-pad-y) 8px var(--dv-term-pad-y) 10px;
  background:var(--dv-term-bg-2);color:var(--dv-term-dim);
  border-right:0.5px solid var(--dv-term-line);
  user-select:none;font-family:inherit;font-size:inherit;line-height:inherit;
  white-space:pre;font-variant-numeric:tabular-nums;
}
.dsh-devops-code-lineno{display:block;line-height:inherit}
.dsh-devops-code-shell{position:relative;flex:1;min-width:0;display:flex;align-items:stretch}
.dsh-devops-code-hl{
  position:absolute;inset:0;margin:0;overflow:hidden;pointer-events:none;
  padding:var(--dv-term-pad-y) var(--dv-term-pad-x);
  font-family:inherit;font-size:inherit;line-height:inherit;
  white-space:pre;background:transparent;color:var(--dv-term-fg);
}
.dsh-devops-code-hline{white-space:pre}
.dsh-devops-code-area{
  position:relative;z-index:1;flex:1;min-width:0;min-height:110px;resize:vertical;
  padding:var(--dv-term-pad-y) var(--dv-term-pad-x);
  border:none;outline:none;background:transparent;
  color:transparent;caret-color:var(--dv-term-fg);
  font-family:inherit;font-size:inherit;line-height:inherit;
  white-space:pre;overflow-wrap:normal;overflow:auto;tab-size:2;
  /* 固定滚动条槽：否则出现滚动条时 textarea 变窄，长行会与高亮层横向错位。 */
  scrollbar-gutter:stable;
}
.dsh-devops-code-area::placeholder{color:var(--dv-term-dim)}
.dsh-devops-code-area::selection{background:var(--dv-term-sel);color:transparent}
.dsh-devops-monospace{font-family:var(--dv-code-font)}

/* ---------- 面板 / 卡片 ---------- */
.dsh-devops-card{
  border:0.5px solid var(--dv-border);border-radius:var(--dv-r-lg);
  background:var(--dv-surface);padding:12px;margin-bottom:12px;
  transition:border-color var(--dv-t) var(--dv-ease),background-color var(--dv-t) var(--dv-ease),
    box-shadow var(--dv-t) var(--dv-ease);
}
.dsh-devops-card:hover{border-color:var(--dv-border-2)}
.dsh-devops-card-head{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.dsh-devops-card-title{font-size:var(--dv-font);font-weight:600;color:var(--dv-fg);margin:0}
.dsh-devops-grid{display:grid;gap:12px}
.dsh-devops-grid[data-cols="2"]{grid-template-columns:repeat(auto-fill,minmax(240px,1fr))}
.dsh-devops-grid[data-cols="3"]{grid-template-columns:repeat(auto-fill,minmax(190px,1fr))}
.dsh-devops-kv{display:grid;grid-template-columns:auto 1fr;gap:3px 10px;font-size:var(--dv-font-sm)}
.dsh-devops-kv dt{color:var(--dv-fg-3)}
.dsh-devops-kv dd{margin:0;color:var(--dv-fg);word-break:break-all}
/* 空态：虚线边框卡片，hover 变色 */
.dsh-devops-empty{
  padding:22px;text-align:center;color:var(--dv-fg-3);font-size:var(--dv-font-sm);
  border:0.5px dashed var(--dv-border-3);border-radius:var(--dv-r-lg);background:transparent;
  transition:border-color var(--dv-t) var(--dv-ease),color var(--dv-t) var(--dv-ease),background-color var(--dv-t) var(--dv-ease);
}
.dsh-devops-empty:hover{border-color:var(--dv-primary);color:var(--dv-fg)}
.dsh-devops-list{display:flex;flex-direction:column;gap:4px}
.dsh-devops-list-row{
  display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:var(--dv-r-md);
  border:0.5px solid transparent;cursor:pointer;font-size:var(--dv-font-sm);
  transition:background-color var(--dv-t) var(--dv-ease),border-color var(--dv-t) var(--dv-ease);
}
.dsh-devops-list-row:hover{background:var(--dv-hover)}
.dsh-devops-list-row[data-active="true"]{background:var(--dv-active);border-color:var(--dv-border-2)}
.dsh-devops-truncate{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.dsh-devops-tag{
  display:inline-flex;align-items:center;padding:0 6px;border-radius:var(--dv-r-pill);
  border:0.5px solid transparent;font-size:var(--dv-font-xs);color:var(--dv-fg-3);
  background:color-mix(in srgb,var(--dv-fg-3) 12%,transparent);
}
.dsh-devops-link{color:var(--dsw-alias-link);cursor:pointer;background:none;border:none;padding:0;font-size:var(--dv-font-sm)}
.dsh-devops-link:hover{text-decoration:underline}

/* ---------- 页签（页内二级导航）：下划线指示条 + hover 底色 ---------- */
.dsh-devops-tabs{
  display:flex;align-items:center;gap:4px;margin-bottom:12px;
  border-bottom:0.5px solid var(--dv-border-2);overflow-x:auto;
}
.dsh-devops-tab{
  position:relative;display:inline-flex;align-items:center;gap:6px;
  padding:6px 12px;margin-bottom:-0.5px;border:none;background:transparent;
  color:var(--dv-fg-3);font-size:var(--dv-font-sm);font-weight:500;cursor:pointer;white-space:nowrap;
  border-radius:var(--dv-r-sm) var(--dv-r-sm) 0 0;
  transition:color var(--dv-t) var(--dv-ease),background-color var(--dv-t) var(--dv-ease);
}
.dsh-devops-tab::after{
  content:"";position:absolute;left:8px;right:8px;bottom:0;height:2px;border-radius:2px 2px 0 0;
  background:var(--dv-accent);opacity:0;
  transition:opacity var(--dv-t) var(--dv-ease);
}
.dsh-devops-tab:hover{color:var(--dv-fg);background:var(--dv-hover)}
.dsh-devops-tab[data-active="true"]{color:var(--dv-accent)}
.dsh-devops-tab[data-active="true"]::after{opacity:1}
.dsh-devops-tab-count{font-size:var(--dv-font-xs);font-weight:600;opacity:.75}

/* ---------- 表格 ---------- */
.dsh-devops-table{width:100%;border-collapse:collapse;font-size:var(--dv-font-sm)}
.dsh-devops-table th{
  text-align:left;font-weight:500;color:var(--dv-fg-3);padding:6px 8px;
  border-bottom:0.5px solid var(--dv-border-3);white-space:nowrap;
}
.dsh-devops-table td{padding:6px 8px;border-bottom:0.5px solid var(--dv-border-2);vertical-align:middle}
.dsh-devops-table tr:hover td{background:var(--dv-hover)}

/* ---------- 编辑器三栏 ---------- */
.dsh-devops-editor{flex:1;display:flex;min-height:0;position:relative}
.dsh-devops-palette{
  flex:none;width:190px;display:flex;flex-direction:column;min-height:0;
  border-right:0.5px solid var(--dv-border-3);overflow:hidden;
}
.dsh-devops-palette-scroll{flex:1;overflow:auto;padding:8px}
.dsh-devops-inspector{
  flex:none;width:288px;display:flex;flex-direction:column;min-height:0;
  border-left:0.5px solid var(--dv-border-3);overflow:hidden;
}
.dsh-devops-inspector-scroll{flex:1;overflow-y:auto;overflow-x:hidden;padding:10px;min-width:0}
/* ============ 编排画布：横向列布局（阶段 = 列，列内节点自上而下） ============ */
/* 外层两轴可滚；.dsh-devops-board 以 flex 行承载所有列，阶段多时横向滚动而不挤压。 */
.dsh-devops-canvas{flex:1;min-width:0;overflow:auto;position:relative;padding:10px 12px 14px}
.dsh-devops-canvas-notice{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.dsh-devops-board{
  position:relative;display:flex;flex-direction:row;align-items:flex-start;
  gap:14px;min-height:100%;padding-bottom:6px;
  /* 按内容撑开：列溢出后不被裁、依赖边层覆盖全部列、横向滚动能滚到末尾的新列。 */
  width:max-content;min-width:100%;
}
.dsh-devops-board-empty{width:100%}
.dsh-devops-edges{position:absolute;inset:0;pointer-events:none;overflow:visible;z-index:0}

.dsh-devops-column{
  position:relative;z-index:1;flex:0 0 auto;width:236px;display:flex;flex-direction:column;
  border:0.5px solid var(--dv-border);border-radius:var(--dv-r-lg);
  background:var(--dv-surface);
  transition:border-color .16s ease,box-shadow .16s ease,background-color .16s ease;
  animation:dsh-devops-rise .18s ease-out both;
}
.dsh-devops-column:hover{border-color:var(--dv-border-2)}
.dsh-devops-column[data-active="true"]{border-color:var(--dv-border-2);box-shadow:0 1px 8px var(--dsw-alias-bg-mask-1,rgba(0,0,0,.08))}
.dsh-devops-column[data-drop="true"]{
  border-color:var(--dsw-alias-state-business-primary);
  box-shadow:0 0 0 1px var(--dsw-alias-state-business-primary);
}
.dsh-devops-column-head{
  display:flex;align-items:center;gap:6px;padding:7px 9px 5px;
  border-bottom:0.5px solid var(--dv-border-2);
}
.dsh-devops-column-index{
  flex:none;display:inline-flex;align-items:center;justify-content:center;
  width:18px;height:18px;border-radius:50%;font-size:11px;
  background:var(--dv-surface-2);color:var(--dv-fg-2);
  border:0.5px solid var(--dv-border);
}
.dsh-devops-column-title{font-size:12px;font-weight:500;color:var(--dv-fg);cursor:text}
.dsh-devops-column-title:hover{color:var(--dsw-alias-link)}
.dsh-devops-column-tools{
  display:flex;align-items:center;gap:2px;flex-wrap:wrap;
  padding:5px 7px;border-bottom:0.5px solid var(--dv-border-2);
}
.dsh-devops-headbtn{
  display:inline-flex;align-items:center;gap:4px;min-height:20px;padding:1px 6px;
  border-radius:var(--dv-r-sm);border:0.5px solid transparent;background:transparent;
  color:var(--dv-fg-2);font-size:11px;cursor:pointer;
  transition:background-color .14s ease,color .14s ease,border-color .14s ease,transform .12s ease;
}
.dsh-devops-headbtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dv-fg)}
.dsh-devops-headbtn:active:not(:disabled){transform:scale(.94)}
.dsh-devops-headbtn[data-active="true"]{color:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary)}
.dsh-devops-headbtn:disabled{opacity:.4;cursor:default}
.dsh-devops-column-cards{
  display:flex;flex-direction:column;gap:8px;padding:9px;min-height:140px;
  transition:background-color .16s ease;
}
.dsh-devops-column[data-drop="true"] .dsh-devops-column-cards{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-devops-column-empty{
  flex:1;display:flex;align-items:center;justify-content:center;
  border:1px dashed var(--dv-border-2);border-radius:var(--dv-r-md);
  padding:14px 8px;color:var(--dv-fg-3);font-size:11px;text-align:center;
}
.dsh-devops-slot{position:relative}
.dsh-devops-slot[data-drop-before="true"]::before{
  content:"";position:absolute;left:0;right:0;top:-5px;height:2px;border-radius:2px;
  background:var(--dsw-alias-state-business-primary);
  animation:dsh-devops-drop-pulse .9s ease-in-out infinite;
}

/* ---------- 块状节点卡片 ---------- */
.dsh-devops-nodecard{
  display:flex;flex-direction:column;gap:5px;width:100%;padding:9px 10px;
  border:0.5px solid var(--dv-border);border-radius:var(--dv-r-md);
  background:var(--dv-surface-2);cursor:grab;user-select:none;
  box-shadow:0 1px 2px var(--dsw-alias-bg-mask-1,rgba(0,0,0,.06));
  transition:border-color .15s ease,box-shadow .15s ease,transform .15s ease,background-color .15s ease;
  animation:dsh-devops-card-in .18s ease-out both;
}
.dsh-devops-nodecard:hover{
  border-color:var(--dv-border-2);transform:translateY(-1px);
  box-shadow:0 4px 12px var(--dsw-alias-bg-mask-1,rgba(0,0,0,.14));
}
.dsh-devops-nodecard[data-selected="true"]{
  border-color:var(--dsw-alias-brand-primary);
  box-shadow:0 0 0 1px var(--dsw-alias-brand-primary),0 4px 12px var(--dsw-alias-bg-mask-1,rgba(0,0,0,.14));
}
.dsh-devops-nodecard[data-dragging="true"]{opacity:.45;transform:scale(.98)}
/* 节点卡状态色：左侧 3px 色条 + 极淡色底；running 呼吸。 */
.dsh-devops-nodecard[data-status="running"],.dsh-devops-nodecard[data-tone="busy"]{
  border-left:3px solid var(--dv-busy);
  background:color-mix(in srgb,var(--dv-busy) 8%,var(--dv-surface-2));
  animation:dsh-devops-breathe 2s ease-in-out infinite;
}
.dsh-devops-nodecard[data-status="success"],.dsh-devops-nodecard[data-tone="ok"]{
  border-left:3px solid var(--dv-ok);
  background:color-mix(in srgb,var(--dv-ok) 7%,var(--dv-surface-2));
}
.dsh-devops-nodecard[data-status="failed"],.dsh-devops-nodecard[data-tone="error"]{
  border-left:3px solid var(--dv-err);
  background:color-mix(in srgb,var(--dv-err) 8%,var(--dv-surface-2));
}
.dsh-devops-nodecard[data-status="canceled"],.dsh-devops-nodecard[data-tone="warn"]{
  border-left:3px solid var(--dv-warn);
  background:color-mix(in srgb,var(--dv-warn) 7%,var(--dv-surface-2));
}
.dsh-devops-nodecard[data-status="pending"],.dsh-devops-nodecard[data-status="skipped"],
.dsh-devops-nodecard[data-tone="idle"]{border-left:3px solid var(--dv-idle)}

/* 列表行 / 状态点也吃同一套状态色，保证「颜色即状态」在列表里一致。 */
.dsh-devops-list-row[data-status="failed"],.dsh-devops-list-row[data-tone="error"]{border-left:3px solid var(--dv-err)}
.dsh-devops-list-row[data-status="running"],.dsh-devops-list-row[data-tone="busy"]{border-left:3px solid var(--dv-busy)}
.dsh-devops-list-row[data-status="success"],.dsh-devops-list-row[data-tone="ok"]{border-left:3px solid var(--dv-ok)}
.dsh-devops-list-row[data-status="canceled"],.dsh-devops-list-row[data-tone="warn"]{border-left:3px solid var(--dv-warn)}
.dsh-devops-dot[data-tone="idle"],.dsh-devops-dot[data-tone="queued"]{background:var(--dv-idle)}
/* 失败计数徽标：明显可辨 */
.dsh-devops-chip[data-tone="error"]{font-weight:600}
/* info 语义色（中性提示） */
.dsh-devops-chip[data-tone="info"]{color:var(--dv-accent);background:color-mix(in srgb,var(--dv-accent) 14%,transparent)}
.dsh-devops-banner[data-tone="info"]{
  border-color:color-mix(in srgb,var(--dv-accent) 45%,transparent);
  background:color-mix(in srgb,var(--dv-accent) 10%,transparent);color:var(--dv-accent);
}
@keyframes dsh-devops-breathe{
  0%,100%{box-shadow:inset 3px 0 0 color-mix(in srgb,var(--dv-busy) 55%,transparent)}
  50%{box-shadow:inset 3px 0 0 color-mix(in srgb,var(--dv-busy) 100%,transparent)}
}
.dsh-devops-nodecard:active{cursor:grabbing}
.dsh-devops-nodecard-head{display:flex;align-items:center;gap:6px}
.dsh-devops-nodecard-index{
  flex:none;display:inline-flex;align-items:center;justify-content:center;
  min-width:16px;height:16px;padding:0 3px;border-radius:var(--dv-r-sm);
  background:var(--dv-surface-3);color:var(--dv-fg-3);font-size:10px;
}
.dsh-devops-nodecard-title{font-size:12px;font-weight:500;color:var(--dv-fg);flex:1}
.dsh-devops-nodecard-flag{
  flex:none;padding:0 5px;border-radius:999px;font-size:10px;
  color:var(--dv-warn);background:color-mix(in srgb,var(--dv-warn) 16%,transparent);
}
.dsh-devops-nodecard-type{font-size:10px;color:var(--dv-fg-3)}
.dsh-devops-nodecard-meta{
  display:grid;grid-template-columns:auto 1fr;gap:1px 8px;
  font-size:10px;color:var(--dv-fg-2);
}
.dsh-devops-nodecard-key{color:var(--dv-fg-3)}
.dsh-devops-nodecard-needs{display:flex;align-items:center;gap:4px;flex-wrap:wrap;font-size:10px}
.dsh-devops-nodecard-need{
  padding:0 5px;border-radius:999px;font-size:10px;
  background:color-mix(in srgb,var(--dv-accent) 14%,transparent);color:var(--dv-accent);
}
.dsh-devops-nodecard-foot{font-size:10px;color:var(--dv-fg-3)}

/* ---------- 就地新增阶段 ---------- */
.dsh-devops-addstage{
  display:inline-flex;align-items:center;justify-content:center;gap:5px;
  border:1px dashed var(--dv-border-2);border-radius:var(--dv-r-md);
  background:transparent;color:var(--dv-fg-3);cursor:pointer;
  font-size:11px;padding:4px 10px;white-space:nowrap;
  transition:border-color .15s ease,color .15s ease,background-color .15s ease,transform .15s ease;
}
.dsh-devops-addstage:hover{
  border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary);
  background:var(--dsw-alias-interactive-bg-hover);transform:translateX(2px);
}
.dsh-devops-addstage:active{transform:scale(.96)}
.dsh-devops-addstage[data-kind="head"]{padding:1px 6px;border-style:solid;border-color:transparent;min-height:20px;border-radius:var(--dv-r-sm)}
.dsh-devops-addstage[data-kind="head"]:hover{transform:none}
.dsh-devops-addstage[data-kind="gap"]{
  align-self:stretch;flex-direction:column;width:28px;min-height:140px;padding:8px 0;
  position:relative;z-index:1;
}
.dsh-devops-addstage[data-kind="gap"] .dsh-devops-addstage-label{writing-mode:vertical-rl;font-size:10px;letter-spacing:1px}
.dsh-devops-addstage[data-kind="end"]{
  align-self:flex-start;flex-direction:column;width:104px;min-height:140px;padding:10px 6px;
  position:relative;z-index:1;
}

/* ---------- 画布动效：仅 CSS transition/animation，无第三方动画库 ---------- */
@keyframes dsh-devops-rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@keyframes dsh-devops-card-in{from{opacity:0;transform:translateY(-4px) scale(.985)}to{opacity:1;transform:none}}
@keyframes dsh-devops-drop-pulse{0%,100%{opacity:1}50%{opacity:.45}}

/* 尊重系统「减少动态效果」：关掉画布上的动画与过渡，只保留状态差异。 */
@media (prefers-reduced-motion:reduce){
  .dsh-devops-column,.dsh-devops-nodecard,.dsh-devops-slot[data-drop-before="true"]::before,
  .dsh-devops-dot[data-tone="busy"]{animation:none}
  .dsh-devops-column,.dsh-devops-nodecard,.dsh-devops-addstage,.dsh-devops-headbtn,
  .dsh-devops-switch span,.dsh-devops-column-cards{transition:none}
  .dsh-devops-nodecard:hover,.dsh-devops-addstage:hover,.dsh-devops-nodecard[data-dragging="true"]{transform:none}
}
.dsh-devops-palette-item{
  display:flex;flex-direction:column;gap:1px;padding:5px 7px;border-radius:var(--dv-r-sm);
  cursor:pointer;border:0.5px solid transparent;margin-bottom:2px;
}
.dsh-devops-palette-item:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dv-border)}
.dsh-devops-edges{position:absolute;inset:0;pointer-events:none;overflow:visible}

/* ---------- 运行详情 ---------- */
.dsh-devops-progress{display:flex;align-items:center;gap:10px}
.dsh-devops-stepcard{
  border:0.5px solid var(--dv-border);border-radius:var(--dv-r-md);margin-bottom:6px;
  background:var(--dv-surface);overflow:hidden;
  transition:border-color var(--dv-t) var(--dv-ease),box-shadow var(--dv-t) var(--dv-ease);
}
.dsh-devops-stepcard:hover{box-shadow:var(--dv-elev-1)}
/* ---------- 状态色体系：颜色即状态（卡片/列头/列表点/徽标共用一套语义色） ----------
   data-status 用运行/步骤的真实状态名；data-tone 复用既有语义色调（ok/error/busy/warn/idle）。
   视觉语法：左侧 3px 色条 + 极淡色底，running 额外带呼吸动画。 */
.dsh-devops-stepcard[data-status="failed"],.dsh-devops-stepcard[data-tone="error"]{
  border-color:color-mix(in srgb,var(--dv-err) 45%,transparent);
  border-left:3px solid var(--dv-err);
  background:color-mix(in srgb,var(--dv-err) 7%,var(--dv-surface));
}
.dsh-devops-stepcard[data-status="running"],.dsh-devops-stepcard[data-tone="busy"]{
  border-color:color-mix(in srgb,var(--dv-busy) 45%,transparent);
  border-left:3px solid var(--dv-busy);
  background:color-mix(in srgb,var(--dv-busy) 7%,var(--dv-surface));
  animation:dsh-devops-breathe 2s ease-in-out infinite;
}
.dsh-devops-stepcard[data-status="success"],.dsh-devops-stepcard[data-tone="ok"]{
  border-left:3px solid var(--dv-ok);
  background:color-mix(in srgb,var(--dv-ok) 6%,var(--dv-surface));
}
.dsh-devops-stepcard[data-status="canceled"],.dsh-devops-stepcard[data-tone="warn"]{
  border-left:3px solid var(--dv-warn);
  background:color-mix(in srgb,var(--dv-warn) 6%,var(--dv-surface));
}
.dsh-devops-stepcard[data-status="pending"],.dsh-devops-stepcard[data-status="skipped"],
.dsh-devops-stepcard[data-tone="idle"]{
  border-left:3px solid var(--dv-idle);
  background:var(--dv-surface);
}

/* 列头着色：一列的整体状态一眼可辨（顶部 2px 色条 + 淡色底）。 */
.dsh-devops-column[data-status="running"] .dsh-devops-column-head,
.dsh-devops-column[data-tone="busy"] .dsh-devops-column-head{
  border-top:2px solid var(--dv-busy);
  background:color-mix(in srgb,var(--dv-busy) 9%,transparent);
}
.dsh-devops-column[data-status="success"] .dsh-devops-column-head,
.dsh-devops-column[data-tone="ok"] .dsh-devops-column-head{
  border-top:2px solid var(--dv-ok);
  background:color-mix(in srgb,var(--dv-ok) 9%,transparent);
}
.dsh-devops-column[data-status="failed"] .dsh-devops-column-head,
.dsh-devops-column[data-tone="error"] .dsh-devops-column-head{
  border-top:2px solid var(--dv-err);
  background:color-mix(in srgb,var(--dv-err) 9%,transparent);
}
.dsh-devops-column[data-status="canceled"] .dsh-devops-column-head,
.dsh-devops-column[data-tone="warn"] .dsh-devops-column-head{
  border-top:2px solid var(--dv-warn);
  background:color-mix(in srgb,var(--dv-warn) 9%,transparent);
}
/* 列本身也跟着状态走：边框染上状态色。 */
.dsh-devops-column[data-status="failed"],.dsh-devops-column[data-tone="error"]{border-color:color-mix(in srgb,var(--dv-err) 40%,transparent)}
.dsh-devops-column[data-status="running"],.dsh-devops-column[data-tone="busy"]{border-color:color-mix(in srgb,var(--dv-busy) 40%,transparent)}
.dsh-devops-column[data-status="success"],.dsh-devops-column[data-tone="ok"]{border-color:color-mix(in srgb,var(--dv-ok) 40%,transparent)}
.dsh-devops-column[data-status="canceled"],.dsh-devops-column[data-tone="warn"]{border-color:color-mix(in srgb,var(--dv-warn) 40%,transparent)}
.dsh-devops-stepcard-head{
  display:flex;align-items:center;gap:8px;padding:6px 9px;cursor:pointer;
}
.dsh-devops-stepcard-head:hover{background:var(--dv-hover)}
.dsh-devops-stepcard-title{font-size:var(--dv-font-sm);font-weight:500;color:var(--dv-fg)}
.dsh-devops-stepcard-meta{font-size:var(--dv-font-xs);color:var(--dv-fg-3);display:flex;gap:8px;flex-wrap:wrap}
.dsh-devops-phases{display:flex;gap:3px;align-items:center}
.dsh-devops-phase{
  width:14px;height:4px;border-radius:2px;background:var(--dv-surface-3);
}
.dsh-devops-phase[data-state="done"]{background:var(--dv-ok)}
.dsh-devops-phase[data-state="active"]{background:var(--dv-busy)}
.dsh-devops-phase[data-state="failed"]{background:var(--dv-err)}

/* ============ 日志 / 代码：深色终端（不随宿主浅色主题变白） ============ */
/* 终端三层：panel（容器）> logbar（工具栏，略浅一档）> logview（滚动区，主底）。 */
.dsh-devops-logpanel{
  display:flex;flex-direction:column;min-height:0;
  border:0.5px solid var(--dv-term-line);border-radius:var(--dv-r-md);
  background:var(--dv-term-bg);color:var(--dv-term-fg);overflow:hidden;
}
.dsh-devops-logbar{
  flex:none;display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:5px 8px;
  background:var(--dv-term-bg-2);color:var(--dv-term-fg);
  border-bottom:0.5px solid var(--dv-term-line);
}
/* 深色工具栏里的控件与徽标：提高对比度，避免"浅色控件配黑底"的割裂。 */
.dsh-devops-logbar .dsh-devops-hint{color:var(--dv-term-dim)}
.dsh-devops-logbar .dsh-devops-chip{background:color-mix(in srgb,var(--dv-term-fg) 12%,transparent);color:var(--dv-term-fg)}
.dsh-devops-logbar .dsh-devops-chip[data-tone="ok"]{color:var(--dv-ok);background:color-mix(in srgb,var(--dv-ok) 20%,transparent)}
.dsh-devops-logbar .dsh-devops-chip[data-tone="warn"]{color:var(--dv-warn);background:color-mix(in srgb,var(--dv-warn) 22%,transparent)}
.dsh-devops-logbar .dsh-devops-chip[data-tone="error"]{color:var(--dv-term-stderr);background:color-mix(in srgb,var(--dv-term-stderr) 20%,transparent)}
.dsh-devops-logbar .dsh-devops-btn{
  color:var(--dv-term-fg);border-color:color-mix(in srgb,var(--dv-term-fg) 22%,transparent);
}
.dsh-devops-logbar .dsh-devops-btn:hover:not(:disabled){background:color-mix(in srgb,var(--dv-term-fg) 14%,transparent)}
.dsh-devops-logbar .dsh-devops-btn[data-active="true"]{background:color-mix(in srgb,var(--dv-term-fg) 18%,transparent)}
.dsh-devops-logbar .dsh-devops-input{
  background:color-mix(in srgb,var(--dv-term-bg) 70%,white);color:var(--dv-term-fg);
  border-color:var(--dv-term-line);
}
.dsh-devops-logbar .dsh-devops-input::placeholder{color:var(--dv-term-dim)}

/* 语言选择器（终端工具栏）：复用深色终端配色。 */
.dsh-devops-langselect{
  min-height:24px;padding:2px 6px;border-radius:var(--dv-r-sm);
  background:color-mix(in srgb,var(--dv-term-bg) 70%,white);color:var(--dv-term-fg);
  border:0.5px solid var(--dv-term-line);font-family:var(--dv-term-font);font-size:var(--dv-font-xs);
  outline:none;cursor:pointer;
}
.dsh-devops-langselect:focus{border-color:var(--dv-tok-function)}
.dsh-devops-langselect option{background:var(--dv-term-bg);color:var(--dv-term-fg)}

.dsh-devops-logview{
  height:230px;overflow:auto;
  padding:var(--dv-term-pad-y) var(--dv-term-pad-x);
  background:var(--dv-term-bg);color:var(--dv-term-fg);
  font-family:var(--dv-term-font);font-size:var(--dv-term-fs);line-height:var(--dv-term-lh);
  white-space:pre-wrap;word-break:break-word;tab-size:2;
  caret-color:var(--dv-term-fg);
}
.dsh-devops-logview::selection,.dsh-devops-logline::selection,.dsh-devops-tok::selection{
  background:var(--dv-term-sel);color:inherit;
}
/* 静态日志行容器（与 logview 配套；深色底由 logview 提供）。 */
.dsh-devops-loglines{display:flex;flex-direction:column;min-width:0}
.dsh-devops-logline{
  /* 行号与行内容以内联方式并排：无 :has()/flex 依赖，旧 WebView 也稳。
     文本换行时悬挂缩进由 padding-left + text-indent 负值维持。 */
  display:block;padding-left:0;
  white-space:pre-wrap;word-break:break-word;tab-size:2;
  font-family:inherit;font-size:inherit;line-height:inherit;color:inherit;
}
/* 行内容（与行号并排；保留缩进与换行）。 */
.dsh-devops-logline-text{
  white-space:pre-wrap;word-break:break-word;
  font-family:inherit;font-size:inherit;line-height:inherit;color:inherit;
}
/* stderr 行：靠左侧红条 + 淡红底区分，**不覆盖 token 颜色**
   （用后代选择器改 color 会以更高特异性吃掉语法着色，反而违背"按编码类型上色"）。 */
.dsh-devops-logline[data-stream="stderr"]{
  color:var(--dv-term-stderr);
  border-left:2px solid var(--dv-term-stderr);
  background:color-mix(in srgb,var(--dv-term-stderr) 8%,transparent);
  padding-left:6px;
}
/* 行号槽。 */
.dsh-devops-logline-no{
  display:inline-block;min-width:2.6em;margin-right:10px;padding-right:8px;
  text-align:right;color:var(--dv-term-dim);user-select:none;
  border-right:0.5px solid var(--dv-term-line);
  font-variant-numeric:tabular-nums;
}
/* 过滤命中：深底上可读的半透明黄，且不得覆盖 token 颜色。 */
.dsh-devops-logview mark,.dsh-devops-logline mark{
  background:var(--dv-term-mark);color:inherit;border-radius:2px;padding:0 1px;
}
.dsh-devops-log-gap{
  margin:4px 0;padding:2px 8px;border-radius:var(--dv-r-sm);
  background:var(--dv-term-bg-3);color:var(--dv-term-dim);
  font-style:italic;font-size:var(--dv-font-xs);
}

/* ---------- 语法 token 调色板（syntax.js 的 kind；终端与代码框共用） ---------- */
.dsh-devops-tok{color:inherit}
.dsh-devops-tok-plain{color:var(--dv-tok-plain)}
.dsh-devops-tok-keyword{color:var(--dv-tok-keyword);font-weight:600}
.dsh-devops-tok-string{color:var(--dv-tok-string)}
.dsh-devops-tok-comment{color:var(--dv-tok-comment);font-style:italic}
.dsh-devops-tok-number{color:var(--dv-tok-number)}
.dsh-devops-tok-function{color:var(--dv-tok-function);font-weight:500}
.dsh-devops-tok-builtin{color:var(--dv-tok-builtin);font-weight:600}
.dsh-devops-tok-operator{color:var(--dv-tok-operator)}
.dsh-devops-tok-variable{color:var(--dv-tok-variable)}
.dsh-devops-tok-type{color:var(--dv-tok-type);font-weight:500}
/* 代码编辑器（浅色主题下也是深色终端）内同样是这套调色板。 */
.dsh-devops-code-hl .dsh-devops-tok-plain{color:var(--dv-tok-plain)}

/* ---------- 流水线详情：只读编排视图 + 右侧伸缩抽屉 ---------- */
/* 只读边界：不拖拽、不改名、不增删；卡片用默认光标且不做位移反馈。 */
.dsh-devops-detail{position:relative;display:flex;flex-direction:column;min-width:0;min-height:0;flex:1}
/* 详情页复用编辑器三栏骨架（.dsh-devops-editor），此处只做只读修饰。 */
.dsh-devops-detail-editor{flex:1}
.dsh-devops-readonly .dsh-devops-nodecard{cursor:default}
.dsh-devops-readonly .dsh-devops-nodecard:hover{transform:none;box-shadow:0 1px 2px var(--dsw-alias-bg-mask-1,rgba(0,0,0,.06))}
.dsh-devops-readonly .dsh-devops-nodecard:active{cursor:default}
.dsh-devops-readonly .dsh-devops-slot{cursor:default}
.dsh-devops-readonly .dsh-devops-column{animation:none}

.dsh-devops-drawer-layer{
  position:absolute;inset:0;z-index:800;display:flex;justify-content:flex-end;
}
.dsh-devops-drawer-layer[data-open="false"]{
  pointer-events:none;visibility:hidden;
  transition:visibility 0s linear var(--dv-t-slow);
}
.dsh-devops-drawer-mask{
  position:absolute;inset:0;background:var(--dv-mask);
  backdrop-filter:var(--dv-blur);
  opacity:0;transition:opacity var(--dv-t-slow) var(--dv-ease);
}
.dsh-devops-drawer-layer[data-open="true"] .dsh-devops-drawer-mask{opacity:1}
/* 低一档的模糊变体（默认已带轻微模糊，这里允许显式指定）。 */
.dsh-devops-drawer-mask[data-blur="true"]{backdrop-filter:var(--dv-blur)}

.dsh-devops-drawer{
  position:relative;z-index:1;display:flex;flex-direction:column;min-height:0;
  width:min(420px,100%);height:100%;
  border-left:0.5px solid var(--dv-border-2);
  background:var(--dv-surface);color:var(--dv-fg);
  box-shadow:var(--dv-elev-2);
  transform:translateX(100%);
  transition:transform var(--dv-t-slow) var(--dv-ease);
}
.dsh-devops-drawer-layer[data-open="true"] .dsh-devops-drawer{transform:none}

/* ── 圆角悬浮卡片形态：脱离右边缘、四周留白、高度自适应且受视口约束 ── */
.dsh-devops-drawer-layer[data-shape="floating"]{
  padding:16px;align-items:flex-start;
}
.dsh-devops-drawer-layer[data-shape="floating"][data-open="false"]{
  padding:16px;
}
.dsh-devops-drawer[data-variant="floating"]{
  height:auto;max-height:calc(100vh - 32px);max-height:calc(100dvh - 32px);
  margin-left:auto;
  border:0.5px solid var(--dv-border-2);border-left-width:0.5px;
  border-radius:var(--dv-r-xl);
  box-shadow:var(--dv-elev-2),0 2px 6px rgba(0,0,0,.16);
  transform:translateX(calc(100% + 24px));
}
.dsh-devops-drawer-layer[data-open="true"] .dsh-devops-drawer[data-variant="floating"]{transform:none}
/* 悬浮卡片的头部圆角跟随卡片，避免直角戳出圆角。 */
.dsh-devops-drawer[data-variant="floating"] .dsh-devops-drawer-head{
  border-radius:var(--dv-r-xl) var(--dv-r-xl) 0 0;
}
.dsh-devops-drawer[data-variant="floating"] .dsh-devops-drawer-body{
  flex:1;min-height:0;overflow:auto;
}

.dsh-devops-drawer-head{
  flex:none;display:flex;align-items:center;gap:8px;
  padding:10px 12px;border-bottom:0.5px solid var(--dv-border-2);
}
.dsh-devops-drawer-title{font-size:var(--dv-font);font-weight:600;color:var(--dv-fg);min-width:0}
.dsh-devops-drawer-body{
  flex:1;min-height:0;overflow:auto;padding:12px;
}
.dsh-devops-drawer-body [hidden]{display:none}
.dsh-devops-drawer-panel{display:flex;flex-direction:column;gap:8px;min-width:0}
/* 原始值小面板：与终端/语法调色板呼应（等宽、深底、浅字）。 */
.dsh-devops-drawer-raw{
  flex:1;min-width:0;padding:6px 9px;border-radius:var(--dv-r-sm);
  background:var(--dv-term-bg);border:0.5px solid var(--dv-term-line);
  color:var(--dv-term-fg);font-size:var(--dv-font-xs);
  font-family:var(--dv-term-font);
  word-break:break-all;white-space:pre-wrap;
}
@media (max-width:900px){
  .dsh-devops-drawer,.dsh-devops-drawer[data-variant="floating"]{width:100%}
  .dsh-devops-drawer-layer[data-shape="floating"]{padding:8px}
}

/* ---------- 全局状态栏（shell.overlay） ---------- */
/* 非整页场景（状态栏等）复用时，去掉整页工作台专属的尺寸/背景。 */
.dsh-devops-root--bare{
  width:auto;
  height:auto;
  min-height:0;
  display:block;
  background:transparent;
}

.dsh-devops-overlay{
  /* 状态栏：外壳固定右下角，外层可点击穿透，只有本体接收事件。 */
  position:fixed;z-index:900;right:12px;bottom:10px;
  pointer-events:none;display:flex;justify-content:flex-end;
  max-width:min(460px,calc(100vw - 24px));
}
.dsh-devops-overlay-bar{
  pointer-events:auto;display:flex;align-items:center;gap:10px;flex-wrap:wrap;
  padding:5px 11px;border-radius:var(--dv-r-pill);
  border:0.5px solid var(--dv-border-2);
  background:var(--dv-toast-bg);
  color:var(--dv-toast-fg);
  box-shadow:var(--dv-elev-1);
  font-size:var(--dv-font-sm);
  transition:background-color var(--dv-t) var(--dv-ease),box-shadow var(--dv-t) var(--dv-ease);
}
.dsh-devops-overlay-bar[data-clickable="true"]{cursor:pointer}
.dsh-devops-overlay-bar[data-clickable="true"]:hover{background:var(--dv-hover)}
.dsh-devops-overlay-seg{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
.dsh-devops-overlay-seg+.dsh-devops-overlay-seg{padding-left:10px;border-left:0.5px solid var(--dv-border-2)}
.dsh-devops-overlay-mono{font-variant-numeric:tabular-nums;font-family:var(--dv-code-font)}

/* ---------- 弹层 ---------- */
.dsh-devops-modal-backdrop{
  position:fixed;inset:0;z-index:1000;background:var(--dv-mask);
  backdrop-filter:var(--dv-blur);
  display:flex;align-items:center;justify-content:center;padding:24px;
  animation:dsh-devops-fade var(--dv-t-slow) var(--dv-ease) both;
}
.dsh-devops-modal{
  width:min(560px,100%);max-height:86vh;display:flex;flex-direction:column;
  border-radius:var(--dv-r-xl);border:0.5px solid var(--dv-border-2);
  background:var(--dv-surface);color:var(--dv-fg);
  box-shadow:var(--dv-elev-2);
  animation:dsh-devops-pop var(--dv-t-slow) var(--dv-ease) both;
}
.dsh-devops-modal[data-wide="true"]{width:min(880px,100%)}
.dsh-devops-modal-head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:0.5px solid var(--dv-border-2)}
.dsh-devops-modal-body{padding:14px;overflow:auto}
.dsh-devops-modal-foot{display:flex;justify-content:flex-end;gap:8px;padding:10px 14px;border-top:0.5px solid var(--dv-border-2)}
@keyframes dsh-devops-fade{from{opacity:0}to{opacity:1}}
@keyframes dsh-devops-pop{from{opacity:0;transform:translateY(6px) scale(.985)}to{opacity:1;transform:none}}

/* ---------- 浏览器 / 下拉候选 ---------- */
.dsh-devops-dropdown{
  position:absolute;z-index:1200;margin-top:2px;max-height:216px;overflow:auto;width:100%;
  border:0.5px solid var(--dv-border-2);border-radius:var(--dv-r-md);
  background:var(--dv-surface);
  box-shadow:var(--dv-elev-1);
}
.dsh-devops-dropdown-row{display:flex;align-items:center;gap:6px;padding:4px 8px;cursor:pointer;font-size:var(--dv-font-sm)}
.dsh-devops-dropdown-row:hover{background:var(--dv-hover)}
.dsh-devops-dropdown-note{padding:4px 8px;font-size:var(--dv-font-xs);color:var(--dv-fg-3)}
.dsh-devops-upload-preview{
  max-height:190px;overflow:auto;border:0.5px solid var(--dv-border-2);border-radius:var(--dv-r-md);
  padding:6px 8px;font-size:11.5px;font-family:var(--dv-code-font);
  background:var(--dv-surface-2);color:var(--dv-fg-2);
}
.dsh-devops-banner{
  border-radius:var(--dv-r-md);padding:8px 10px;margin-bottom:10px;font-size:var(--dv-font-sm);
  border:0.5px solid var(--dv-border-2);background:var(--dv-surface-2);color:var(--dv-fg-2);
}
.dsh-devops-banner[data-tone="error"]{border-color:color-mix(in srgb,var(--dv-err-soft) 45%,transparent);background:color-mix(in srgb,var(--dv-err-soft) 10%,transparent);color:var(--dv-err-soft)}
.dsh-devops-banner[data-tone="warn"]{border-color:color-mix(in srgb,var(--dv-warn) 45%,transparent);background:color-mix(in srgb,var(--dv-warn) 10%,transparent);color:var(--dv-warn)}
.dsh-devops-banner[data-tone="ok"]{border-color:color-mix(in srgb,var(--dv-ok) 45%,transparent);background:color-mix(in srgb,var(--dv-ok) 10%,transparent);color:var(--dv-ok)}


/* ---------- 检查器：可拖拽调宽 + 可收起（用户抱怨「拉也不能拉宽」） ---------- */
/* 宽度由外层 host 用内联 style 控制，这里只保证它能伸缩、且内部可滚。 */
.dsh-devops-inspector-host{
  flex:none;display:flex;min-height:0;min-width:0;
}
.dsh-devops-inspector-host>.dsh-devops-inspector{width:100%;border-left:none}
/* 拖拽手柄：窄条 + 中间可见的抓握提示；双击可在默认/最大化间切换。 */
.dsh-devops-inspector-resizer{
  flex:none;width:6px;cursor:col-resize;position:relative;
  background:transparent;transition:background var(--dv-t) var(--dv-ease);
}
.dsh-devops-inspector-resizer::after{
  content:'';position:absolute;top:0;bottom:0;left:2px;width:2px;border-radius:2px;
  background:var(--dv-border-2);transition:background var(--dv-t) var(--dv-ease);
}
.dsh-devops-inspector-resizer:hover::after,
.dsh-devops-inspector-resizer:active::after{background:var(--dv-accent)}
.dsh-devops-inspector-resizer[data-open="false"]{display:none}
/* 收起后的窄轨：只留一个展开按钮，把画布空间还给用户。 */
.dsh-devops-inspector-rail{
  flex:none;display:flex;align-items:flex-start;justify-content:center;
  width:28px;padding-top:8px;border-left:0.5px solid var(--dv-border-3);
}
.dsh-devops-inspector-head{
  flex:none;display:flex;align-items:center;gap:6px;
  padding:8px 10px;border-bottom:0.5px solid var(--dv-border-3);min-width:0;
}
.dsh-devops-inspector-head-title{font-size:var(--dv-font);font-weight:600;color:var(--dv-fg);min-width:0}

/* ---------- 代码编辑器：工具条 + 自动增高 + 放大编辑浮层 ---------- */
.dsh-devops-code-block{display:flex;flex-direction:column;gap:6px;min-width:0}
.dsh-devops-code-toolbar{display:flex;align-items:center;gap:8px;min-width:0}
.dsh-devops-code-lang{
  font-size:var(--dv-font-xs);font-weight:600;letter-spacing:.02em;
  color:var(--dv-tok-function);text-transform:none;
}
/* 面板窄时工具条仍要放得下：允许换行而不是把按钮挤没。 */
.dsh-devops-code-toolbar{flex-wrap:wrap}
.dsh-devops-code-expand{flex:none}
/* 自动增高：高度由 rows 属性驱动（CodeSurface 按内容算），这里只给出滚动边界。 */
.dsh-devops-code[data-fill="true"]{flex:1;min-height:0}
.dsh-devops-code[data-fill="true"] .dsh-devops-code-area{min-height:0;height:100%;resize:none}
.dsh-devops-code[data-fill="true"] .dsh-devops-code-hl{overflow:auto}

.dsh-devops-code-full-backdrop{
  position:fixed;inset:0;z-index:1400;display:flex;
  padding:calc(var(--dsh-frame-top-clearance,0px) + 24px) 24px 24px;
  background:var(--dv-mask);backdrop-filter:var(--dv-blur);
  animation:dsh-devops-fade var(--dv-t) var(--dv-ease);
}
.dsh-devops-code-full{
  flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;
  border:0.5px solid var(--dv-border-2);border-radius:var(--dv-r-xl);
  background:var(--dv-surface);box-shadow:var(--dv-elev-2);
  overflow:hidden;animation:dsh-devops-pop var(--dv-t) var(--dv-ease);
}
.dsh-devops-code-full-head{
  flex:none;display:flex;align-items:center;gap:8px;min-width:0;
  padding:10px 12px;border-bottom:0.5px solid var(--dv-border-3);
}
.dsh-devops-code-full-title{font-size:var(--dv-font);font-weight:600;color:var(--dv-fg);min-width:0}
/* 浮层里的编辑器撑满剩余空间，长脚本可以一次看很多行。 */
.dsh-devops-code-full .dsh-devops-code{
  flex:1;min-height:0;margin:12px;border-radius:var(--dv-r-md);
}
@keyframes dsh-devops-fade{from{opacity:0}to{opacity:1}}
@keyframes dsh-devops-pop{from{opacity:0;transform:translateY(6px) scale(.995)}to{opacity:1;transform:none}}

/* ---------- 节点编辑浮层：覆盖画布，而不是占一栏 ----------
   用户要求：「点击节点之后虚化背景……去点击编辑层之外的地方，编辑窗口会自动保存收起来」。
   与详情页的只读抽屉同一套视觉语言（圆角 + elevation + 遮罩虚化），但这里**可编辑**。 */
.dsh-devops-editor-sheet-layer{
  position:absolute;inset:0;z-index:900;display:flex;justify-content:flex-end;
  padding:16px;pointer-events:auto;
}
.dsh-devops-editor-sheet-layer[data-open="false"]{pointer-events:none;visibility:hidden}
/* 遮罩：半透明 + 轻微模糊（虚化背景）；点它就是「点编辑层之外」 */
.dsh-devops-editor-sheet-mask{
  position:absolute;inset:0;background:var(--dv-mask);
  backdrop-filter:var(--dv-blur);
  animation:dsh-devops-fade var(--dv-t) var(--dv-ease) both;
}
/* 浮层卡片：贴右侧但四周留白、脱离边缘，圆角 + 阴影 + 细边框，高度受视口约束。 */
.dsh-devops-editor-sheet{
  position:relative;z-index:1;display:flex;flex-direction:column;min-height:0;
  margin-left:auto;height:auto;max-height:calc(100vh - 32px);
  max-width:calc(100vw - 32px);
  border:0.5px solid var(--dv-border-2);border-radius:var(--dv-r-xl);
  background:var(--dv-surface);color:var(--dv-fg);
  box-shadow:var(--dv-elev-2),0 2px 8px var(--dsw-alias-bg-mask-1,rgba(0,0,0,.18));
  overflow:hidden;
  animation:dsh-devops-pop var(--dv-t-slow) var(--dv-ease) both;
}
.dsh-devops-editor-sheet-head{
  flex:none;display:flex;align-items:center;gap:8px;min-width:0;
  padding:10px 12px;border-bottom:0.5px solid var(--dv-border-2);
}
.dsh-devops-editor-sheet-title{font-size:var(--dv-font);font-weight:600;color:var(--dv-fg);min-width:0}
.dsh-devops-editor-sheet-body{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}
/* 浮层内嵌 Inspector：去掉侧栏的固定宽度与左边框，撑满卡片。 */
.dsh-devops-editor-sheet-body>.dsh-devops-inspector{width:100%;border-left:none;min-height:0}
.dsh-devops-editor-sheet-foot{
  flex:none;display:flex;align-items:center;gap:8px;
  padding:8px 12px;border-top:0.5px solid var(--dv-border-2);
  background:var(--dv-surface-2);
}
/* 左边缘拖拽手柄（附加能力：不拖也能用，默认宽度已舒适）。 */
.dsh-devops-editor-sheet-resizer{
  position:absolute;left:0;top:10px;bottom:10px;width:8px;
  cursor:col-resize;border-radius:var(--dv-r-sm);
  transition:background var(--dv-t) var(--dv-ease);
}
.dsh-devops-editor-sheet-resizer:hover{background:color-mix(in srgb,var(--dv-accent) 35%,transparent)}

/* 窄屏：浮层铺满可用宽度，仍保留四周留白与圆角。 */
@media (max-width:900px){
  .dsh-devops-editor-sheet-layer{padding:8px}
  .dsh-devops-editor-sheet{width:100% !important;max-height:calc(100vh - 16px)}
}

/* ---------- 滚动分区（task-11）：区域自身滚到底，不把滚动传给外层 ----------
   用户原话：「在节点窗口滑动应该只翻动节点那一个窗口」。
   overscroll-behavior:contain 就是这条诉求的正解。 */
.dsh-devops-canvas,
.dsh-devops-palette-scroll,
.dsh-devops-inspector-scroll,
.dsh-devops-logview,
.dsh-devops-detail-scroll,
.dsh-devops-drawer-body,
.dsh-devops-editor-sheet-body{overscroll-behavior:contain}
/* 详情页/运行详情的内部滚动区（页面自己管滚动，而不是整页动）。 */
.dsh-devops-detail-scroll{flex:1;min-height:0;min-width:0;overflow-y:auto;overflow-x:hidden}

/* 全局动效收敛：统一时长/缓动，并尊重系统「减少动态效果」。 */
@media (prefers-reduced-motion:reduce){
  .dsh-devops-btn,.dsh-devops-input,.dsh-devops-select,.dsh-devops-textarea,.dsh-devops-switch,
  .dsh-devops-switch span,.dsh-devops-card,.dsh-devops-empty,.dsh-devops-list-row,.dsh-devops-nav-item,
  .dsh-devops-tab,.dsh-devops-tab::after,.dsh-devops-chip,.dsh-devops-overlay-bar,.dsh-devops-stepcard,
  .dsh-devops-modal,.dsh-devops-modal-backdrop,.dsh-devops-drawer,.dsh-devops-drawer-mask,
  .dsh-devops-code-full,.dsh-devops-code-full-backdrop,.dsh-devops-inspector-resizer,
  .dsh-devops-drawer-layer[data-open="false"]{transition:none;animation:none}
  /* 状态卡的呼吸动画同样关闭，仅保留左侧色条与淡色底（静态可辨）。 */
  .dsh-devops-nodecard,.dsh-devops-column,.dsh-devops-column-cards,.dsh-devops-stepcard,
  .dsh-devops-nodecard[data-status],.dsh-devops-stepcard[data-status],
  .dsh-devops-nodecard[data-tone],.dsh-devops-stepcard[data-tone]{transition:none;animation:none}
}

@media (max-width:900px){
  .dsh-devops-palette{display:none}
  .dsh-devops-inspector{width:250px}
  .dsh-devops-nav{width:104px}
}
`;

exports.ensureStyles = ensureStyles;
exports.CSS = CSS;
});

__def("./api.js", function (module, exports, require) {
/**
 * HTTP 客户端：统一走 new URL('dsh-devops/api/...', document.baseURI)，
 * 反代到子路径时同样成立。响应形状见契约 §3.10：{ok,value} / {ok,message,code}。
 */

class ApiError extends Error {
  constructor(message, code, status) {
    super(message || '请求失败');
    this.name = 'ApiError';
    this.code = code || '';
    this.status = status || 0;
  }
}

/** 拼 API URL：baseURI 结尾带不带斜杠都能正确解析。 */
function apiUrl(path, query) {
  const clean = String(path).replace(/^\/+/, '');
  let url;
  try {
    let base = document.baseURI || '/';
    if (!base.endsWith('/')) base += '/';
    url = new URL('dsh-devops/api/' + clean, base);
  } catch {
    // baseURI 异常（极少数非标准环境）时退回相对当前路径
    url = new URL('dsh-devops/api/' + clean, window.location.href);
  }
  if (query) {
    for (const key of Object.keys(query)) {
      const value = query[key];
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

/** 低层请求：解析统一响应形状，失败抛 ApiError。 */
async function request(path, options) {
  const opts = options || {};
  const init = {
    method: opts.method || 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  };
  if (opts.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  if (opts.signal) init.signal = opts.signal;

  let res;
  try {
    res = await fetch(apiUrl(path, opts.query), init);
  } catch (error) {
    if (error && error.name === 'AbortError') throw error;
    throw new ApiError('无法连接插件后端：' + (error && error.message ? error.message : String(error)), 'network', 0);
  }

  let payload = null;
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      if (!res.ok) throw new ApiError('HTTP ' + res.status, 'http', res.status);
      throw new ApiError('后端返回了非 JSON 内容', 'bad-json', res.status);
    }
  }
  if (payload && payload.ok === true) return payload.value;
  const message = payload && payload.message ? payload.message : 'HTTP ' + res.status;
  throw new ApiError(message, (payload && payload.code) || 'http', res.status);
}

const get = (path, query, options) => request(path, Object.assign({ method: 'GET', query }, options));
const post = (path, body, options) => request(path, Object.assign({ method: 'POST', body }, options));
const put = (path, body, options) => request(path, Object.assign({ method: 'PUT', body }, options));
const del = (path, options) => request(path, Object.assign({ method: 'DELETE' }, options));

/** 契约 §3.10 全部端点的薄封装；页面只调用这里，不自己拼 URL。 */
const api = {
  ApiError,
  apiUrl,
  request,

  meta: () => get('meta'),

  listPipelines: () => get('pipelines'),
  getPipeline: (id) => get('pipelines/' + encodeURIComponent(id)),
  createPipeline: (pipeline) => post('pipelines', { pipeline }),
  updatePipeline: (id, pipeline) => put('pipelines/' + encodeURIComponent(id), { pipeline }),
  deletePipeline: (id) => del('pipelines/' + encodeURIComponent(id)),
  runPipeline: (id, variables) => post('pipelines/' + encodeURIComponent(id) + '/runs', { variables: variables || {} }),
  validatePipeline: (pipeline) => post('pipelines/validate', { pipeline }),

  listTemplates: () => get('templates'),
  getTemplate: (id) => get('templates/' + encodeURIComponent(id)),
  createTemplate: (template) => post('templates', { template }),
  updateTemplate: (id, template) => put('templates/' + encodeURIComponent(id), { template }),
  deleteTemplate: (id) => del('templates/' + encodeURIComponent(id)),
  instantiateTemplate: (id, params) => post('templates/' + encodeURIComponent(id) + '/instantiate', { params: params || {} }),
  templateFromPipeline: (payload) => post('templates/from-pipeline', payload),

  listRuns: (query) => get('runs', query),
  getRun: (id) => get('runs/' + encodeURIComponent(id)),
  cancelRun: (id) => post('runs/' + encodeURIComponent(id) + '/cancel', {}),
  retryRun: (id) => post('runs/' + encodeURIComponent(id) + '/retry', {}),
  retryStep: (id, stepId) => post('runs/' + encodeURIComponent(id) + '/retry-step', { stepId }),
  runLogs: (id, query) => get('runs/' + encodeURIComponent(id) + '/logs', query),

  listServers: () => get('servers'),
  createServer: (server) => post('servers', { server }),
  updateServer: (id, server) => put('servers/' + encodeURIComponent(id), { server }),
  deleteServer: (id) => del('servers/' + encodeURIComponent(id)),
  testServer: (id) => post('servers/' + encodeURIComponent(id) + '/test', {}),
  provisionServer: (id, runtime) => post('servers/' + encodeURIComponent(id) + '/provision', { runtime }),
  serverEnv: (id) => get('servers/' + encodeURIComponent(id) + '/env'),

  listEnvSets: () => get('envsets'),
  createEnvSet: (envset) => post('envsets', { envset }),
  updateEnvSet: (id, envset) => put('envsets/' + encodeURIComponent(id), { envset }),
  deleteEnvSet: (id) => del('envsets/' + encodeURIComponent(id)),

  listSnippets: () => get('snippets'),
  createSnippet: (snippet) => post('snippets', { snippet }),
  updateSnippet: (id, snippet) => put('snippets/' + encodeURIComponent(id), { snippet }),
  deleteSnippet: (id) => del('snippets/' + encodeURIComponent(id)),

  listRecent: (key) => get('recent', { key }),
  putRecent: (key, values) => post('recent', { key, values }),

  listNodes: () => get('nodes'),
  registerCustomNode: (descriptor) => post('nodes/custom', { descriptor }),
  deleteCustomNode: (type) => del('nodes/custom/' + encodeURIComponent(type)),

  fsList: (server, path) => get('fs/list', { server, path }),
  fsStat: (server, path) => get('fs/stat', { server, path }),
  fsMatch: (payload) => post('fs/match', payload),

  exportDoc: (kind, id) => get('export', { kind, id }),
  importDoc: (payload) => post('import', payload),

  getSettings: () => get('settings'),
  putSettings: (patch) => put('settings', patch),
};

exports.api = api;
exports.ApiError = ApiError;
exports.apiUrl = apiUrl;
});

__def("./sse.js", function (module, exports, require) {
/**
 * SSE 客户端：契约 §3.11。
 *   event: run   data: {"run": <Run 摘要>}
 *   event: step  data: {"stepId":"compile","step": <Step>}
 *   event: log   data: {"stepId":"compile","seq":12,"ts":0,"stream":"stdout","text":"..."}
 *   event: gap   data: {"stepId":"compile","from":1,"to":9}
 *   event: ping  data: {}
 * id: 行写全局 seq，断线用 Last-Event-ID 续传。
 *
 * 注意：EventSource 无法自定义请求头，因此续传用查询参数 from 表达；
 * 后端同时支持 Last-Event-ID 头与 from 查询参数时两者等价。
 */
const { apiUrl } = require('./api.js');

function createRunStream(runId, handlers) {
  const onEvent = handlers.onEvent || function () {};
  const onStatus = handlers.onStatus || function () {};
  let source = null;
  let closed = false;
  let lastId = handlers.lastEventId || 0;
  let retryTimer = null;
  let attempt = 0;

  function open() {
    if (closed) return;
    const url = apiUrl('runs/' + encodeURIComponent(runId) + '/events', lastId ? { from: lastId } : null);
    onStatus('connecting');
    try {
      source = new EventSource(url.toString(), { withCredentials: true });
    } catch (error) {
      onStatus('error', error);
      scheduleReconnect();
      return;
    }

    source.onopen = () => {
      attempt = 0;
      onStatus('open');
    };

    source.onerror = () => {
      // 浏览器自身会重连；这里只在 readyState=CLOSED 时接管，避免双重重连。
      onStatus('error');
      if (source && source.readyState === 2) {
        try {
          source.close();
        } catch {
          /* ignore */
        }
        source = null;
        scheduleReconnect();
      }
    };

    const names = ['run', 'step', 'log', 'gap', 'ping'];
    for (const name of names) {
      source.addEventListener(name, (message) => {
        if (message.lastEventId) {
          const num = Number(message.lastEventId);
          if (isFinite(num) && num > lastId) lastId = num;
        }
        let data = null;
        if (message.data) {
          try {
            data = JSON.parse(message.data);
          } catch {
            return; // 半截帧直接丢弃，等重连补
          }
        }
        onEvent(name, data || {}, lastId);
      });
    }
  }

  function scheduleReconnect() {
    if (closed || retryTimer) return;
    attempt += 1;
    const delay = Math.min(15000, 800 * Math.pow(1.7, Math.min(attempt, 5)));
    retryTimer = setTimeout(() => {
      retryTimer = null;
      open();
    }, delay);
  }

  open();

  return {
    close() {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      if (source) {
        try {
          source.close();
        } catch {
          /* ignore */
        }
      }
      source = null;
      onStatus('closed');
    },
    get lastEventId() {
      return lastId;
    },
  };
}

exports.createRunStream = createRunStream;
});

__def("./state.js", function (module, exports, require) {
/**
 * 全局状态中枢：一个极简的可订阅 store，页面用 useSyncExternalStore 订阅。
 * 不引任何状态管理库。
 */
const { useSyncExternalStore, useMemo } = require('./h.js');

function createStore(initialState) {
  let state = initialState;
  const listeners = new Set();

  function getState() {
    return state;
  }

  function emit() {
    for (const fn of Array.from(listeners)) {
      try {
        fn();
      } catch (error) {
        // 单个订阅者出错不能影响其它订阅者
        console.error('[dsh-devops] store listener error', error);
      }
    }
  }

  /** 接受「新状态对象」或「(prev) => patch/新对象」；浅合并。 */
  function setState(patch) {
    const next = typeof patch === 'function' ? patch(state) : patch;
    if (!next) return state;
    let changed = false;
    for (const key of Object.keys(next)) {
      if (state[key] !== next[key]) {
        changed = true;
        break;
      }
    }
    if (!changed) return state;
    state = Object.assign({}, state, next);
    emit();
    return state;
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return { getState, setState, subscribe };
}

/** 订阅整个 store。 */
function useStore(store) {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

/** 只订阅选中的切片；选择函数应返回稳定引用或原始值。 */
function useStoreSelect(store, selector) {
  const subscribe = store.subscribe;
  const getSnapshot = useMemo(() => () => selector(store.getState()), [store, selector]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

const KIND = {
  pipeline: 'pipelines',
  template: 'templates',
  server: 'servers',
  envset: 'envsets',
  snippet: 'snippets',
  run: 'runs',
  node: 'nodes',
  recent: 'recent',
};

/** 从列表数据里建立 id → 条目 的索引 Map。 */
function indexById(list) {
  const map = new Map();
  for (const item of list || []) {
    if (item && item.id) map.set(item.id, item);
  }
  return map;
}

/** 运行状态 → 语义色调。 */
function runTone(status) {
  if (status === 'success') return 'ok';
  if (status === 'failed') return 'error';
  if (status === 'running') return 'busy';
  if (status === 'canceled') return 'warn';
  return 'idle';
}

/** 步骤状态 → 语义色调。 */
function stepTone(status) {
  if (status === 'success') return 'ok';
  if (status === 'failed') return 'error';
  if (status === 'running') return 'busy';
  if (status === 'skipped') return 'idle';
  if (status === 'canceled') return 'warn';
  return 'idle';
}

const RUN_STATUS_TEXT = {
  queued: '排队中',
  running: '运行中',
  success: '成功',
  failed: '失败',
  canceled: '已取消',
};

const STEP_STATUS_TEXT = {
  pending: '等待',
  running: '运行中',
  success: '成功',
  failed: '失败',
  skipped: '已跳过',
  canceled: '已取消',
};

/** 契约 §2.5 的 phase 集合，顺序即阶段流转顺序。 */
const PHASES = ['queued', 'connecting', 'provisioning', 'transferring', 'running', 'draining', 'settled'];

const PHASE_TEXT = {
  queued: '排队',
  connecting: '建立连接',
  provisioning: '准备运行时',
  transferring: '传输文件',
  running: '执行中',
  draining: '收尾中',
  settled: '已结束',
};

exports.createStore = createStore;
exports.useStore = useStore;
exports.useStoreSelect = useStoreSelect;
exports.KIND = KIND;
exports.indexById = indexById;
exports.runTone = runTone;
exports.stepTone = stepTone;
exports.RUN_STATUS_TEXT = RUN_STATUS_TEXT;
exports.STEP_STATUS_TEXT = STEP_STATUS_TEXT;
exports.PHASES = PHASES;
exports.PHASE_TEXT = PHASE_TEXT;
});

__def("./ui.js", function (module, exports, require) {
/**
 * 通用 UI 组件：全部基于 h(...)，无第三方依赖。
 * 图标用内联 SVG（stroke 走 currentColor，自动跟随主题）。
 */
const { h, cx, useEffect, useMemo, useRef, useState } = require('./h.js');

/** 极简图标集：name → path 数据。 */
const ICON_PATHS = {
  terminal: 'M4 5h16v14H4z M7 9l2.5 2.5L7 14 M12 15h5',
  layers: 'M12 3l8 4.5-8 4.5-8-4.5z M4 12l8 4.5 8-4.5 M4 16.5L12 21l8-4.5',
  play: 'M7 4.5v15l12-7.5z',
  server: 'M4 5h16v5H4z M4 14h16v5H4z M7 7.5h.01 M7 16.5h.01',
  box: 'M12 3l8 4.5v9L12 21l-8-4.5v-9z M4 7.5l8 4.5 8-4.5 M12 12v9',
  database: 'M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3z M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6',
  grid: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z',
  settings: 'M12 15.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7z M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-2.9 1.2 2 2 0 11-4 0 1.7 1.7 0 00-2.9-1.2l-.1.1a2 2 0 11-2.8-2.8l.1-.1A1.7 1.7 0 003 15a2 2 0 010-4 1.7 1.7 0 001.2-2.9l-.1-.1a2 2 0 112.8-2.8l.1.1A1.7 1.7 0 0010 4.1 2 2 0 0114 4a1.7 1.7 0 002.9 1.2l.1-.1a2 2 0 112.8 2.8l-.1.1A1.7 1.7 0 0021 11a2 2 0 010 4z',
  refresh: 'M20 11a8 8 0 10-2.3 6.3 M20 5v6h-6',
  plus: 'M12 5v14 M5 12h14',
  trash: 'M4 7h16 M9 7V5h6v2 M6 7l1 13h10l1-13',
  check: 'M5 13l4 4L19 7',
  close: 'M6 6l12 12 M18 6L6 18',
  chevron: 'M9 6l6 6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
  copy: 'M9 9h11v11H9z M5 15V4h11',
  download: 'M12 4v11 M7 11l5 5 5-5 M5 20h14',
  clock: 'M12 21a9 9 0 100-18 9 9 0 000 18z M12 7v5l3 2',
  warn: 'M12 4l9 16H3z M12 10v4 M12 17h.01',
  sparkle: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z',
  history: 'M12 7v5l3 2 M3.5 12a8.5 8.5 0 1017 0 8.5 8.5 0 00-17 0 M3.5 12H1m2.5 0L5 9.4',
  pause: 'M8 5v14 M16 5v14',
  eye: 'M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z M12 15a3 3 0 100-6 3 3 0 000 6z',
};

/** 内联图标。size 默认 14，跟随父级文字色。 */
function Icon(props) {
  const size = props.size || 14;
  const d = ICON_PATHS[props.name] || ICON_PATHS.box;
  const paths = d.split(' M').map((seg, i) => (i === 0 ? seg : 'M' + seg));
  return h(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: props.strokeWidth || 1.6,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      style: { flex: 'none', display: 'block' },
      'aria-hidden': 'true',
    },
    paths.map((p, i) => h('path', { key: i, d: p })),
  );
}

/** 按钮。variant: default | primary | danger | ghost。 */
function Button(props) {
  return h(
    'button',
    {
      type: 'button',
      className: cx('dsh-devops-btn', props.className),
      'data-variant': props.variant || 'default',
      'data-size': props.size || 'md',
      'data-active': props.active ? 'true' : undefined,
      disabled: props.disabled || props.busy || undefined,
      title: props.title,
      onClick: props.onClick,
      style: props.style,
    },
    props.icon ? h(Icon, { name: props.icon, size: props.size === 'sm' ? 12 : 14 }) : null,
    props.label,
    props.children,
  );
}

/** 开关。 */
function Switch(props) {
  return h(
    'button',
    {
      type: 'button',
      className: 'dsh-devops-switch',
      'data-on': props.value ? 'true' : 'false',
      role: 'switch',
      'aria-checked': props.value ? 'true' : 'false',
      disabled: props.disabled || undefined,
      title: props.title,
      onClick: () => props.onChange && props.onChange(!props.value),
    },
    h('span', null),
  );
}

/** 单行/多行/下拉输入。 */
function TextInput(props) {
  const common = {
    className: cx('dsh-devops-input', props.className),
    value: props.value === undefined || props.value === null ? '' : props.value,
    placeholder: props.placeholder || '',
    disabled: props.disabled || undefined,
    readOnly: props.readOnly || undefined,
    spellCheck: false,
    onChange: (e) => props.onChange && props.onChange(e.target.value),
    onBlur: props.onBlur,
    onKeyDown: props.onKeyDown,
  };
  if (props.type === 'number') {
    return h('input', Object.assign({}, common, { type: 'number', min: props.min, max: props.max }));
  }
  if (props.type === 'password') {
    return h('input', Object.assign({}, common, { type: 'password' }));
  }
  return h('input', Object.assign({}, common, { type: 'text' }));
}

function TextArea(props) {
  return h('textarea', {
    className: cx('dsh-devops-textarea', props.className),
    value: props.value === undefined || props.value === null ? '' : props.value,
    placeholder: props.placeholder || '',
    rows: props.rows || 4,
    disabled: props.disabled || undefined,
    spellCheck: false,
    onChange: (e) => props.onChange && props.onChange(e.target.value),
  });
}

/** 单选下拉；value 为空时显示 placeholder 选项。 */
function Select(props) {
  const options = props.options || [];
  return h(
    'select',
    {
      className: cx('dsh-devops-select', props.className),
      value: props.value === undefined || props.value === null ? '' : String(props.value),
      disabled: props.disabled || undefined,
      onChange: (e) => props.onChange && props.onChange(e.target.value),
    },
    props.placeholder !== undefined ? h('option', { value: '' }, props.placeholder) : null,
    options.map((opt) => {
      const value = typeof opt === 'string' ? opt : opt.value;
      const label = typeof opt === 'string' ? opt : opt.label;
      return h('option', { key: String(value), value: String(value) }, label);
    }),
  );
}

/** 字段容器：label + 描述 + 子控件 + 错误，供所有类型化控件复用。 */
function Field(props) {
  return h(
    'div',
    { className: cx('dsh-devops-field', props.className) },
    h(
      'div',
      { className: 'dsh-devops-field-head' },
      h('span', { className: 'dsh-devops-field-label' }, props.label),
      props.required ? h('span', { className: 'dsh-devops-required' }, '*') : null,
      props.headExtra || null,
      props.tag ? h('span', { className: 'dsh-devops-tag' }, props.tag) : null,
    ),
    props.children,
    props.description ? h('div', { className: 'dsh-devops-field-desc' }, props.description) : null,
    props.error ? h('div', { className: 'dsh-devops-field-error' }, props.error) : null,
  );
}

/** 卡片。 */
function Card(props) {
  return h(
    'div',
    { className: cx('dsh-devops-card', props.className), style: props.style },
    props.title || props.headExtra
      ? h(
          'div',
          { className: 'dsh-devops-card-head' },
          props.title ? h('h3', { className: 'dsh-devops-card-title' }, props.title) : null,
          h('div', { className: 'dsh-devops-spacer' }),
          props.headExtra || null,
        )
      : null,
    props.children,
  );
}

function Empty(props) {
  return h('div', { className: 'dsh-devops-empty' }, props.text || '暂无数据');
}

/** 语义状态点/徽标。 */
function Chip(props) {
  return h(
    'span',
    { className: cx('dsh-devops-chip', props.className), 'data-tone': props.tone || undefined, title: props.title },
    props.dot ? h('span', { className: 'dsh-devops-dot', 'data-tone': props.tone || undefined }) : null,
    props.children,
  );
}

function StatusDot(props) {
  return h('span', {
    className: 'dsh-devops-dot',
    'data-tone': props.tone || undefined,
    title: props.title,
  });
}

/** 进度环：value/total，中心显示百分比。 */
function ProgressRing(props) {
  const size = props.size || 54;
  const stroke = props.stroke || 5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = props.total || 0;
  const value = props.value || 0;
  const ratio = total > 0 ? Math.max(0, Math.min(1, value / total)) : 0;
  const tone = props.tone || 'ok';
  const color =
    tone === 'error'
      ? 'var(--dsw-alias-state-error-primary)'
      : tone === 'busy'
        ? 'var(--dsw-alias-state-business-primary)'
        : 'var(--dsw-alias-state-success-primary)';
  return h(
    'div',
    { style: { position: 'relative', width: size + 'px', height: size + 'px', flex: 'none' } },
    h(
      'svg',
      { width: size, height: size, viewBox: '0 0 ' + size + ' ' + size },
      h('circle', {
        cx: size / 2,
        cy: size / 2,
        r: radius,
        fill: 'none',
        stroke: 'var(--dsw-alias-border-l3)',
        strokeWidth: stroke,
      }),
      h('circle', {
        cx: size / 2,
        cy: size / 2,
        r: radius,
        fill: 'none',
        stroke: color,
        strokeWidth: stroke,
        strokeLinecap: 'round',
        strokeDasharray: circumference,
        strokeDashoffset: circumference * (1 - ratio),
        transform: 'rotate(-90 ' + size / 2 + ' ' + size / 2 + ')',
        style: { transition: 'stroke-dashoffset .3s ease' },
      }),
    ),
    h(
      'div',
      {
        style: {
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '11px',
          fontWeight: 500,
          color: 'var(--dsw-alias-label-primary)',
        },
      },
      Math.round(ratio * 100) + '%',
    ),
  );
}

/** 模态层。 */
function Modal(props) {
  const onClose = props.onClose;
  useEffect(() => {
    if (!onClose) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return h(
    'div',
    {
      className: 'dsh-devops-modal-backdrop',
      onMouseDown: (e) => {
        if (e.target === e.currentTarget && onClose) onClose();
      },
    },
    h(
      'div',
      { className: 'dsh-devops-modal', 'data-wide': props.wide ? 'true' : undefined, role: 'dialog', 'aria-modal': 'true' },
      h(
        'div',
        { className: 'dsh-devops-modal-head' },
        h('span', { style: { fontSize: '13px', fontWeight: 500 } }, props.title),
        h('div', { className: 'dsh-devops-spacer' }),
        onClose ? h(Button, { variant: 'ghost', size: 'sm', icon: 'close', onClick: onClose, title: '关闭' }) : null,
      ),
      h('div', { className: 'dsh-devops-modal-body' }, props.children),
      props.footer ? h('div', { className: 'dsh-devops-modal-foot' }, props.footer) : null,
    ),
  );
}

/** 折叠区块。 */
function Collapsible(props) {
  const [open, setOpen] = useState(props.defaultOpen !== false);
  return h(
    'div',
    null,
    h(
      'button',
      {
        type: 'button',
        className: 'dsh-devops-btn',
        'data-variant': 'ghost',
        style: { width: '100%', justifyContent: 'flex-start', paddingLeft: 0 },
        onClick: () => setOpen(!open),
      },
      h(Icon, { name: open ? 'chevronDown' : 'chevron', size: 12 }),
      props.title,
    ),
    open ? props.children : null,
  );
}

/** 详情键值表。 */
function KV(props) {
  const entries = props.entries || [];
  if (entries.length === 0) return h(Empty, { text: props.emptyText || '—' });
  return h(
    'dl',
    { className: 'dsh-devops-kv' },
    entries.map((entry, i) =>
      h(
        'div',
        { key: i, style: { display: 'contents' } },
        h('dt', null, entry[0]),
        h('dd', null, entry[1] === null || entry[1] === undefined || entry[1] === '' ? '—' : entry[1]),
      ),
    ),
  );
}

/** 提示条。 */
function Banner(props) {
  if (!props.children) return null;
  return h('div', { className: 'dsh-devops-banner', 'data-tone': props.tone || undefined }, props.children);
}

/** 轻量 toast：返回 [节点, 显示函数]。 */
function useToast() {
  const [items, setItems] = useState([]);
  const idRef = useRef(0);

  function push(tone, text) {
    idRef.current += 1;
    const id = idRef.current;
    setItems((prev) => prev.concat([{ id, tone, text }]));
    setTimeout(() => setItems((prev) => prev.filter((it) => it.id !== id)), 4200);
  }

  const node = items.length
    ? h(
        'div',
        { style: { position: 'fixed', right: '16px', bottom: '64px', zIndex: 1100, display: 'flex', flexDirection: 'column', gap: '6px' } },
        items.map((it) =>
          h(
            'div',
            { key: it.id, className: 'dsh-devops-banner', 'data-tone': it.tone || 'ok', style: { marginBottom: 0, minWidth: '180px', background: 'var(--dsw-alias-toast-bg, var(--dsw-alias-bg-layer-2))' } },
            it.text,
          ),
        ),
      )
    : null;

  const api = useMemo(
    () => ({
      ok: (text) => push('ok', text),
      error: (text) => push('error', text),
      warn: (text) => push('warn', text),
    }),
    [],
  );

  return [node, api];
}

/** 空态/加载态包装。 */
function AsyncBox(props) {
  if (props.loading) return h('div', { className: 'dsh-devops-empty' }, props.loadingText || '加载中…');
  if (props.error) return h(Banner, { tone: 'error' }, String(props.error.message || props.error));
  return props.children;
}

exports.Icon = Icon;
exports.Button = Button;
exports.Switch = Switch;
exports.TextInput = TextInput;
exports.TextArea = TextArea;
exports.Select = Select;
exports.Field = Field;
exports.Card = Card;
exports.Empty = Empty;
exports.Chip = Chip;
exports.StatusDot = StatusDot;
exports.ProgressRing = ProgressRing;
exports.Modal = Modal;
exports.Collapsible = Collapsible;
exports.KV = KV;
exports.Banner = Banner;
exports.useToast = useToast;
exports.AsyncBox = AsyncBox;
});

__def("./syntax.js", function (module, exports, require) {
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
});

__def("./fields.js", function (module, exports, require) {
/**
 * 类型化控件库：严格按契约 §4「字段类型 → 控件映射」实现。
 * 控件完全由节点字段描述符驱动，新增节点无需改前端。
 *
 * 表格回顾：
 *  string 单行 | text 多行 | code 代码 | path.dir 目录 | path.file 文件
 *  glob glob+命中预览 | enum 下拉 | boolean 开关 | number 数字
 *  server 服务器 | runtime 运行时 | keyvalue 键值表 | multiselect 标签多选
 *  ref:envset 环境变量组引用 | ref:snippet 脚本片段引用 | ref:pipeline 流水线引用（可搜索）
 */
const { h, useState, useEffect, useRef, useMemo, ellipsis, fmtBytes } = require('./h.js');
const { Icon, Button, Switch, TextInput, TextArea, Select, Field, Chip, Empty } = require('./ui.js');
const { api } = require('./api.js');
// 共享语法着色引擎（零依赖纯函数）：token 只产出语义 kind，颜色由 CSS 决定。
const { normalizeLanguage, tokenizeLines } = require('./syntax.js');

/** 一个可被鼠标点击的锚点容器，用于放浏览/预览下拉。 */
function Anchor(props) {
  const ref = useRef(null);
  useEffect(() => {
    props.anchorRef && (props.anchorRef.current = ref.current);
  }, []);
  return h('div', { ref, style: { position: 'relative', flex: 1, minWidth: 0 } }, props.children);
}

/* ------------------------------------------------------------------ *
 * code：深色终端观感的代码编辑器（着色层 + 透明 textarea 叠加）
 * ------------------------------------------------------------------ */

/** 把一行 token 渲染成语法着色的 span（颜色全部由 CSS 的 .dsh-devops-tok-* 决定）。 */
function tokenSpans(tokens, keyPrefix) {
  return tokens.map((token, i) =>
    h('span', { key: keyPrefix + '-' + i, className: 'dsh-devops-tok dsh-devops-tok-' + token.kind }, token.text),
  );
}

/**
 * 代码编辑器。
 *
 * 实现要点：一个**可编辑的透明 textarea** 叠在**着色高亮层**之上，两层用完全相同的
 * 字体、行高、内边距与换行规则，因此光标与选区与看到的着色文本严丝合缝。
 * 这样既得到语法着色（textarea 本身无法着色），又不牺牲编辑体验。
 *
 * 尺寸：内联时**随内容自动增高**（上限 30 行后内部滚动），并额外提供
 * 「放大编辑」——全屏浮层里写长脚本，这是用户抱怨「写了很多就看不清」的正解。
 *
 * props: { field, value, onChange }
 */

/** 语言显示名（工具栏标签用）。 */
const CODE_LANG_LABEL = { shell: 'Shell', python: 'Python', javascript: 'JavaScript', json: 'JSON', yaml: 'YAML' };

/**
 * 代码编辑面：行号 + 着色层 + 透明输入层。
 * props: { value, language, onChange, placeholder, minRows, maxRows, fill }
 *   fill=true 时撑满父容器（全屏浮层用），否则按内容自动增高。
 */
function CodeSurface(props) {
  const value = props.value === undefined || props.value === null ? '' : String(props.value);
  const lang = props.language || 'shell';
  const lines = useMemo(() => tokenizeLines(value, lang), [value, lang]);
  const minRows = props.minRows || 8;
  const maxRows = props.maxRows || 30;
  const rows = props.fill ? 20 : Math.min(Math.max(lines.length + 1, minRows), maxRows);
  const lineCount = props.fill ? Math.max(lines.length, minRows) : rows;
  const hlRef = useRef(null);

  /** 高亮层跟随输入层滚动（长脚本滚动时必须严丝合缝）。 */
  function syncScroll(event) {
    const pre = hlRef.current;
    if (pre && pre.scrollTop !== undefined) {
      pre.scrollTop = event.target.scrollTop;
      pre.scrollLeft = event.target.scrollLeft;
    }
  }

  return h(
    'div',
    {
      className: 'dsh-devops-code',
      'data-language': lang,
      'data-fill': props.fill ? 'true' : undefined,
      'data-rows': String(rows),
    },
    h(
      'div',
      { className: 'dsh-devops-code-gutter', 'aria-hidden': 'true' },
      Array.from({ length: lineCount }, (_, i) => h('span', { key: i, className: 'dsh-devops-code-lineno' }, String(i + 1))),
    ),
    h(
      'div',
      { className: 'dsh-devops-code-shell' },
      h(
        'pre',
        { className: 'dsh-devops-code-hl', 'aria-hidden': 'true', ref: hlRef },
        lines.map((tokens, i) =>
          h('span', { key: i, className: 'dsh-devops-code-hline' }, tokenSpans(tokens, 'l' + i).concat([h('br', { key: 'br' })])),
        ),
      ),
      h('textarea', {
        className: 'dsh-devops-code-area',
        value,
        spellCheck: false,
        wrap: 'off',
        'data-language': lang,
        placeholder: props.placeholder || '',
        rows,
        onChange: (e) => props.onChange(e.target.value),
        onScroll: syncScroll,
        onKeyDown: (e) => {
          const el = e.target;
          // Tab 插入两个空格（Shift+Tab 暂不反缩进，保持行为可预期）
          if (e.key === 'Tab') {
            e.preventDefault();
            const start = el.selectionStart;
            const end = el.selectionEnd;
            const next = value.slice(0, start) + '  ' + value.slice(end);
            props.onChange(next);
            requestAnimationFrame(() => {
              el.selectionStart = el.selectionEnd = start + 2;
            });
          }
        },
      }),
    ),
  );
}

function CodeControl(props) {
  const field = props.field;
  const value = props.value === undefined || props.value === null ? '' : String(props.value);
  const lang = normalizeLanguage(field.language || 'shell');
  const [expanded, setExpanded] = useState(false);
  const lineCount = value === '' ? 0 : value.split('\n').length;

  // 放大编辑时支持 Esc 关闭（Node 测试环境没有 document，跳过）
  useEffect(() => {
    if (!expanded || typeof document === 'undefined') return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setExpanded(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [expanded]);

  return h(
    'div',
    { className: 'dsh-devops-code-block', 'data-language': lang, 'data-expanded': expanded ? 'true' : undefined },
    h(
      'div',
      { className: 'dsh-devops-code-toolbar' },
      h('span', { className: 'dsh-devops-code-lang' }, CODE_LANG_LABEL[lang] || lang),
      h('span', { className: 'dsh-devops-hint' }, lineCount + ' 行'),
      h('div', { className: 'dsh-devops-spacer' }),
      h(Button, {
        size: 'sm',
        icon: 'eye',
        label: '放大编辑',
        className: 'dsh-devops-code-expand',
        title: '在更大的编辑器中编写脚本（Esc 关闭）',
        onClick: () => setExpanded(true),
      }),
    ),
    h(CodeSurface, {
      value,
      language: lang,
      placeholder: field.placeholder || '',
      minRows: field.rows || 8,
      onChange: props.onChange,
    }),
    expanded
      ? h(
          'div',
          {
            className: 'dsh-devops-code-full-backdrop',
            onMouseDown: (e) => {
              if (e.target === e.currentTarget) setExpanded(false);
            },
          },
          h(
            'div',
            {
              className: 'dsh-devops-code-full',
              role: 'dialog',
              'aria-modal': 'true',
              'aria-label': '放大编辑脚本',
              'data-role': 'code-fullscreen',
            },
            h(
              'div',
              { className: 'dsh-devops-code-full-head' },
              h('span', { className: 'dsh-devops-code-full-title dsh-devops-truncate' }, field.label || field.name || '脚本'),
              h('span', { className: 'dsh-devops-tag dsh-devops-monospace' }, CODE_LANG_LABEL[lang] || lang),
              h('span', { className: 'dsh-devops-hint' }, lineCount + ' 行'),
              h('div', { className: 'dsh-devops-spacer' }),
              h(Button, {
                size: 'sm',
                variant: 'ghost',
                icon: 'close',
                label: '关闭',
                className: 'dsh-devops-code-full-close',
                title: '关闭（Esc）',
                onClick: () => setExpanded(false),
              }),
            ),
            h(CodeSurface, {
              value,
              language: lang,
              placeholder: field.placeholder || '',
              fill: true,
              minRows: 12,
              onChange: props.onChange,
            }),
          ),
        )
      : null,
  );
}
/* ------------------------------------------------------------------ *
 * path.dir / path.file：浏览 + 校验
 * ------------------------------------------------------------------ */

function PathControl(props) {
  const field = props.field;
  const isDir = field.type === 'path.dir';
  const value = props.value === undefined || props.value === null ? '' : String(props.value);
  const [open, setOpen] = useState(false);
  const [listing, setListing] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const serverId = props.resolveServer ? props.resolveServer(field.serverField) : props.serverId;
  const recentKey = 'field:' + field.type + (props.ownerId ? ':' + props.ownerId : '');

  const recents = props.recent ? props.recent(recentKey) : [];

  async function browse(path) {
    setBusy(true);
    setError('');
    try {
      const result = await api.fsList(serverId, path || value || '.');
      setListing(result);
      setOpen(true);
    } catch (err) {
      setError(err.message || String(err));
      setOpen(true);
      setListing(null);
    } finally {
      setBusy(false);
    }
  }

  function pick(path) {
    props.onChange(path);
    props.remember && props.remember(recentKey, path);
    setOpen(false);
  }

  return h(
    'div',
    null,
    h(
      'div',
      { className: 'dsh-devops-field-row' },
      h(Anchor, null,
        h(TextInput, {
          value,
          placeholder: field.placeholder || (isDir ? '/srv/app' : '/srv/app/file.txt'),
          onChange: (v) => props.onChange(v),
          onBlur: () => props.onBlur && props.onBlur(),
        }),
        open
          ? h(
              'div',
              { className: 'dsh-devops-dropdown' },
              h(
                'div',
                { className: 'dsh-devops-dropdown-note' },
                listing ? listing.path || value || '.' : error || '无法读取目录',
              ),
              listing && listing.parent
                ? h(
                    'div',
                    { className: 'dsh-devops-dropdown-row', onClick: () => browse(listing.parent) },
                    h(Icon, { name: 'chevron', size: 11 }),
                    '..',
                  )
                : null,
              listing && listing.entries && listing.entries.length
                ? listing.entries.map((entry) =>
                    h(
                      'div',
                      {
                        key: entry.name,
                        className: 'dsh-devops-dropdown-row',
                        onClick: () => (entry.isDir ? browse(joinPath(listing.path, entry.name)) : pick(joinPath(listing.path, entry.name))),
                      },
                      h(Icon, { name: entry.isDir ? 'box' : 'layers', size: 11 }),
                      h('span', { className: 'dsh-devops-truncate' }, entry.name),
                      entry.size ? h('span', { style: { marginLeft: 'auto', color: 'var(--dsw-alias-label-caption)' } }, fmtBytes(entry.size)) : null,
                    ),
                  )
                : null,
              h(
                'div',
                { className: 'dsh-devops-dropdown-note', style: { borderTop: '0.5px solid var(--dsw-alias-border-l2)' } },
                serverId ? '目标：' + serverId : '目标：本机',
              ),
            )
          : null,
      ),
      h(Button, { size: 'sm', icon: 'box', label: '浏览', busy, onClick: () => browse(value) }),
    ),
    error ? h('div', { className: 'dsh-devops-field-error' }, error) : null,
    recents && recents.length
      ? h(
          'div',
          { style: { display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '4px' } },
          recents.slice(0, 5).map((item) =>
            h(
              'button',
              {
                key: item,
                type: 'button',
                className: 'dsh-devops-tag',
                style: { cursor: 'pointer', background: 'none' },
                title: item,
                onClick: () => props.onChange(item),
              },
              ellipsis(item, 26),
            ),
          ),
        )
      : null,
  );
}

function joinPath(base, name) {
  if (!base || base === '.') return name;
  const sep = base.includes('\\') && !base.includes('/') ? '\\' : '/';
  return base.replace(/[\\/]+$/, '') + sep + name;
}

/* ------------------------------------------------------------------ *
 * glob：输入 + 命中预览（POST /fs/match）
 * ------------------------------------------------------------------ */

function GlobControl(props) {
  const field = props.field;
  const value = props.value === undefined || props.value === null ? '' : String(props.value);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const serverId = props.resolveServer ? props.resolveServer(field.serverField) : props.serverId;
  const base = props.resolveBase ? props.resolveBase(field.baseField) : '';

  async function runPreview() {
    if (!value) {
      setPreview(null);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await api.fsMatch({ server: serverId, base: base || '.', glob: value });
      setPreview(result);
    } catch (err) {
      setError(err.message || String(err));
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  // 用户停止输入 600ms 后自动预览，避免每敲一个字符就打一次后端。
  useEffect(() => {
    if (field.preview === false || !value) return undefined;
    const timer = setTimeout(runPreview, 600);
    return () => clearTimeout(timer);
  }, [value, base, serverId]);

  return h(
    'div',
    null,
    h(
      'div',
      { className: 'dsh-devops-field-row' },
      h(TextInput, {
        value,
        placeholder: field.placeholder || 'dist/**/*.js',
        onChange: (v) => props.onChange(v),
      }),
      h(Button, { size: 'sm', icon: 'eye', label: '预览', busy, onClick: runPreview }),
    ),
    error ? h('div', { className: 'dsh-devops-field-error' }, error) : null,
    preview && preview.matched
      ? h(
          'div',
          { className: 'dsh-devops-upload-preview', style: { marginTop: '6px' } },
          preview.matched.length === 0
            ? '没有命中任何文件'
            : preview.matched
                .slice(0, 40)
                .map((item) =>
                  h(
                    'div',
                    { key: item.path, className: 'dsh-devops-truncate' },
                    (item.path || '') + (item.size ? '  (' + fmtBytes(item.size) + ')' : ''),
                  ),
                ),
          preview.truncated ? h('div', { className: 'dsh-devops-log-gap' }, '结果已截断，共 ' + (preview.total || '?') + ' 项') : null,
        )
      : null,
  );
}

/* ------------------------------------------------------------------ *
 * runtime：版本下拉 + 安装
 * ------------------------------------------------------------------ */

const RUNTIME_VERSIONS = {
  python: ['3.13', '3.12', '3.11', '3.10', '3.9'],
  node: ['22', '20', '18'],
};

function RuntimeControl(props) {
  const field = props.field;
  const kind = field.runtime || 'python';
  const value = props.value === undefined || props.value === null ? '' : String(props.value);
  const serverId = props.serverId || props.defaultServer;
  const server = props.serverFor ? props.serverFor(serverId) : null;
  const installed = (server && server.runtimes) || {};
  const installedVersions = Object.keys(installed)
    .filter((key) => key.indexOf(kind + ':') === 0)
    .map((key) => key.slice(kind.length + 1));

  const options = useMemo(() => {
    const set = new Set(RUNTIME_VERSIONS[kind] || []);
    for (const v of installedVersions) set.add(v);
    return Array.from(set);
  }, [kind, installedVersions.join(',')]);

  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const current = value ? value.replace(kind + ':', '') : '';

  async function install(version) {
    if (!serverId || serverId === 'local') {
      setNote('本机运行时无需安装');
      return;
    }
    setBusy(true);
    setNote('');
    try {
      const result = await api.provisionServer(serverId, kind + ':' + version);
      if (result && result.ok === false) setNote(result.error || '安装失败');
      else setNote('已就绪：' + (result && result.resolved ? JSON.stringify(result.resolved) : version));
      props.onProvisioned && props.onProvisioned();
    } catch (err) {
      setNote(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  return h(
    'div',
    null,
    h(
      'div',
      { className: 'dsh-devops-field-row' },
      h(Select, {
        value: current,
        placeholder: field.placeholder || '（服务器默认）',
        options: options.map((v) => ({
          value: v,
          label: v + (installedVersions.includes(v) ? '  ✓ 已安装' : ''),
        })),
        onChange: (v) => props.onChange(v ? kind + ':' + v : ''),
      }),
      h(Button, {
        size: 'sm',
        icon: 'download',
        label: '安装',
        busy,
        disabled: !current,
        title: '在目标服务器上安装该运行时（需要服务器允许安装）',
        onClick: () => install(current),
      }),
    ),
    installedVersions.length
      ? h('div', { className: 'dsh-devops-hint', style: { marginTop: '3px' } }, '服务器已装：' + installedVersions.join('、'))
      : null,
    note ? h('div', { className: 'dsh-devops-hint', style: { marginTop: '3px' } }, note) : null,
  );
}

/* ------------------------------------------------------------------ *
 * keyvalue：键值表（支持密钥标记）
 * ------------------------------------------------------------------ */

function KeyValueControl(props) {
  const field = props.field;
  const rows = Array.isArray(props.value) ? props.value : [];

  function update(next) {
    props.onChange(next);
  }

  function setAt(index, patch) {
    update(rows.map((row, i) => (i === index ? Object.assign({}, row, patch) : row)));
  }

  return h(
    'div',
    { className: 'dsh-devops-list' },
    rows.map((row, index) =>
      h(
        'div',
        { key: index, className: 'dsh-devops-field-row' },
        h(TextInput, { value: row.name, placeholder: '名称', onChange: (v) => setAt(index, { name: v }) }),
        h(TextInput, {
          value: row.value,
          placeholder: '值',
          type: field.secret === true && row.secret ? 'password' : 'text',
          onChange: (v) => setAt(index, { value: v }),
        }),
        field.secret === true
          ? h(
              'button',
              {
                type: 'button',
                className: 'dsh-devops-btn',
                'data-size': 'sm',
                'data-active': row.secret ? 'true' : undefined,
                title: '标记为密钥（值来自凭据，不落明文）',
                onClick: () => setAt(index, { secret: !row.secret }),
              },
              h(Icon, { name: row.secret ? 'eye' : 'pause', size: 11 }),
            )
          : null,
        h(Button, {
          size: 'sm',
          variant: 'ghost',
          icon: 'close',
          title: '删除',
          onClick: () => update(rows.filter((_, i) => i !== index)),
        }),
      ),
    ),
    h(Button, {
      size: 'sm',
      icon: 'plus',
      label: '添加变量',
      onClick: () => update(rows.concat([{ name: '', value: '', secret: false }])),
    }),
  );
}

/* ------------------------------------------------------------------ *
 * multiselect：标签多选
 * ------------------------------------------------------------------ */

function MultiSelectControl(props) {
  const field = props.field;
  const value = Array.isArray(props.value) ? props.value : [];
  const options = props.options || field.options || [];
  const [draft, setDraft] = useState('');

  function toggle(option) {
    if (value.includes(option)) props.onChange(value.filter((v) => v !== option));
    else props.onChange(value.concat([option]));
  }

  function addFree() {
    const text = draft.trim();
    if (!text) return;
    if (!value.includes(text)) props.onChange(value.concat([text]));
    setDraft('');
  }

  return h(
    'div',
    null,
    h(
      'div',
      { style: { display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '6px' } },
      value.length ? value.map((v) => h(Chip, { key: v }, v)) : h('span', { className: 'dsh-devops-hint' }, '未选择'),
    ),
    options.length
      ? h(
          'div',
          { style: { display: 'flex', gap: '4px', flexWrap: 'wrap' } },
          options.map((option) =>
            h(Button, {
              key: option,
              size: 'sm',
              label: option,
              active: value.includes(option),
              onClick: () => toggle(option),
            }),
          ),
        )
      : null,
    h(
      'div',
      { className: 'dsh-devops-field-row', style: { marginTop: '6px' } },
      h(TextInput, { value: draft, placeholder: '自定义标签后回车', onChange: setDraft, onKeyDown: (e) => e.key === 'Enter' && addFree() }),
      h(Button, { size: 'sm', icon: 'plus', onClick: addFree }),
    ),
  );
}

/* ------------------------------------------------------------------ *
 * ref:envset / ref:snippet：引用选择
 * ------------------------------------------------------------------ */

/**
 * 读取字段控件的数据上下文（App 用 state 构造的纯数据包）。
 *
 * 宿主 ctx 是 Cordis context：读取未 inject 的服务属性会直接抛
 * `cannot get property "xxx" without inject`（渲染「引用脚本片段」字段时
 * 表现为整块面板报错）。字段数据只是可选增强，误传时退化为空值即可。
 */
function dataOf(ctx, key) {
  if (!ctx) return undefined;
  try {
    return ctx[key];
  } catch {
    return undefined;
  }
}

function RefControl(props) {
  const field = props.field;
  const isEnvSet = field.type === 'ref:envset';
  const value = props.value === undefined || props.value === null ? '' : String(props.value);
  const items = (isEnvSet ? props.envsets : props.snippets) || [];
  const selected = items.find((item) => item.id === value);

  return h(
    'div',
    null,
    h(
      'div',
      { className: 'dsh-devops-field-row' },
      h(Select, {
        value,
        placeholder: '（不引用）',
        options: items.map((item) => ({ value: item.id, label: item.name + '  ·  ' + item.id })),
        onChange: (v) => props.onChange(v),
      }),
    ),
    selected
      ? h(
          'div',
          { className: 'dsh-devops-upload-preview', style: { marginTop: '6px' } },
          isEnvSet
            ? (selected.vars || []).map((v) => v.name + '=' + (v.secret ? '••••••' : v.value)).join('\n') || '（空）'
            : selected.body || '',
        )
      : null,
  );
}

/* ------------------------------------------------------------------ *
 * ref:pipeline：流水线引用（可搜索下拉 + 可手填）
 * ------------------------------------------------------------------ */

/**
 * 大小写不敏感的模糊匹配。
 *
 * 两级策略（都要支持，用户要的是「输入名字能模糊匹配」）：
 *  1. 子串命中：优先级最高，命中位置越靠前、文本越短分越高；
 *  2. 子序列命中：按顺序散落出现也算（如 "bd" 命中 "build-deploy"），分数次之。
 *
 * @returns {{score:number, positions:number[]}|null} null 表示不匹配
 */
function fuzzyMatch(text, query) {
  const source = String(text === null || text === undefined ? '' : text);
  const needle = String(query === null || query === undefined ? '' : query).trim().toLowerCase();
  if (!needle) return { score: 0, positions: [] };
  if (!source) return null;

  const lower = source.toLowerCase();
  const at = lower.indexOf(needle);
  if (at >= 0) {
    const positions = [];
    for (let i = 0; i < needle.length; i += 1) positions.push(at + i);
    // 前缀命中额外加分；同样命中时短文本更相关
    return { score: 100 + (at === 0 ? 50 : 0) + Math.max(0, 20 - source.length), positions };
  }

  // 子序列：按顺序逐个找字符
  const positions = [];
  let qi = 0;
  for (let i = 0; i < lower.length && qi < needle.length; i += 1) {
    if (lower[i] === needle[qi]) {
      positions.push(i);
      qi += 1;
    }
  }
  if (qi === needle.length) return { score: 40 + Math.max(0, 10 - source.length / 4), positions };
  return null;
}

/**
 * 按查询词过滤流水线候选（纯函数，便于直接断言）。
 *
 * 匹配 name / id / description 三处，name 命中权重最高（用户是按名字找的）。
 * 查询词为空时返回全部（按名称排序），这样下拉一打开就能看到可选项。
 *
 * @returns {Array<{pipeline:object, score:number, namePositions:number[], idPositions:number[]}>}
 */
function matchPipelines(query, pipelines) {
  const list = Array.isArray(pipelines) ? pipelines : [];
  const needle = String(query === null || query === undefined ? '' : query).trim();
  const out = [];
  for (const item of list) {
    if (!item || !item.id) continue;
    const byName = fuzzyMatch(item.name || '', needle);
    const byId = fuzzyMatch(item.id, needle);
    const byDesc = needle ? fuzzyMatch(item.description || '', needle) : null;
    if (needle && !byName && !byId && !byDesc) continue;
    const score = Math.max(
      byName ? byName.score + 25 : 0,
      byId ? byId.score + 10 : 0,
      byDesc ? byDesc.score : 0,
    );
    out.push({
      pipeline: item,
      score,
      namePositions: byName ? byName.positions : [],
      idPositions: byId ? byId.positions : [],
    });
  }
  out.sort((a, b) =>
    (b.score - a.score)
    || String(a.pipeline.name || a.pipeline.id).localeCompare(String(b.pipeline.name || b.pipeline.id)));
  return out;
}

/** 把命中的字符高亮出来（不新增 CSS 类，用既有 token 内联着色）。 */
function highlightMatches(text, positions) {
  const source = String(text === null || text === undefined ? '' : text);
  const set = new Set(Array.isArray(positions) ? positions : []);
  if (set.size === 0) return source;
  const parts = [];
  let buffer = '';
  for (let i = 0; i < source.length; i += 1) {
    if (set.has(i)) {
      if (buffer) {
        parts.push(buffer);
        buffer = '';
      }
      parts.push(
        h(
          'mark',
          {
            key: 'h' + i,
            style: {
              background: 'var(--dsw-alias-state-warn-tertiary)',
              color: 'inherit',
              borderRadius: '2px',
              padding: '0 1px',
            },
          },
          source[i],
        ),
      );
    } else {
      buffer += source[i];
    }
  }
  if (buffer) parts.push(buffer);
  return parts;
}

/** 候选列表一次最多渲染多少条（超出给一句提示并可继续输入收窄）。 */
const PIPELINE_MAX_ROWS = 8;

/**
 * 流水线引用控件（ref:pipeline）。
 *
 * 与 ref:envset / ref:snippet 的静态 Select 不同，这里必须：
 *  - 可搜索：输入名称或 ID 都能模糊匹配（大小写不敏感）；
 *  - 显示名字而不只是 id（用户要的是「选择已有的流水线」）；
 *  - 仍允许手填任意 id（流水线可能尚未创建或来自导入）——输入框本身就是值；
 *  - 当前值不在候选里时显示「(未知流水线) xxx」而不是空白。
 *
 * props: { field, value, onChange, ctx }
 */
function PipelineRefControl(props) {
  const field = props.field || {};
  const value = props.value === undefined || props.value === null ? '' : String(props.value);
  // 候选来自 App 下发的 fieldCtx.pipelines；缺失/非数组时降级为空列表（不崩）。
  const raw = dataOf(props.ctx, 'pipelines');
  const pipelines = Array.isArray(raw) ? raw : [];
  const selected = pipelines.find((item) => item && item.id === value) || null;
  const matches = matchPipelines(value, pipelines);
  const shown = matches.slice(0, PIPELINE_MAX_ROWS);
  const hidden = matches.length - shown.length;
  const unknown = value !== '' && !selected;

  return h(
    'div',
    null,
    h(
      'div',
      { className: 'dsh-devops-field-row' },
      h(TextInput, {
        value,
        placeholder: field.placeholder || '输入流水线名称或 ID 搜索',
        onChange: (v) => props.onChange(v),
        onBlur: () => props.onBlur && props.onBlur(),
      }),
      value
        ? h(Button, { size: 'sm', variant: 'ghost', icon: 'close', title: '清除引用', onClick: () => props.onChange('') })
        : null,
    ),

    // 当前值的可读反馈：已知显示名字，未知显式标注，绝不静默留白
    h(
      'div',
      { style: { marginTop: '4px' } },
      selected
        ? h(
            'span',
            { className: 'dsh-devops-hint' },
            '当前：',
            h('span', { style: { color: 'var(--dsw-alias-label-primary)' } }, selected.name || selected.id),
            ' · ',
            h('span', { className: 'dsh-devops-monospace' }, selected.id),
          )
        : unknown
          ? h(Chip, { tone: 'warn', title: '候选里没有这条流水线，将按原样使用' }, '(未知流水线) ' + value)
          : h('span', { className: 'dsh-devops-hint' }, '未选择（可点下方候选，或直接输入 ID）'),
    ),

    pipelines.length === 0
      ? h('div', { className: 'dsh-devops-hint', style: { marginTop: '4px' } }, '没有可选的流水线（仍可直接输入 ID）')
      : shown.length === 0
        ? h('div', { className: 'dsh-devops-hint', style: { marginTop: '4px' } }, '没有匹配的流水线（可直接输入 ID 新建引用）')
        : h(
            'div',
            { className: 'dsh-devops-list', style: { marginTop: '6px', maxHeight: '190px', overflow: 'auto' } },
            shown.map((entry) =>
              h(
                'div',
                {
                  key: entry.pipeline.id,
                  className: 'dsh-devops-list-row',
                  'data-active': entry.pipeline.id === value ? 'true' : undefined,
                  role: 'button',
                  tabIndex: 0,
                  title: entry.pipeline.name ? entry.pipeline.name + ' · ' + entry.pipeline.id : entry.pipeline.id,
                  onClick: () => props.onChange(entry.pipeline.id),
                  onKeyDown: (event) => {
                    if (event && (event.key === 'Enter' || event.key === ' ')) {
                      if (event.preventDefault) event.preventDefault();
                      props.onChange(entry.pipeline.id);
                    }
                  },
                },
                h(
                  'span',
                  { className: 'dsh-devops-truncate' },
                  highlightMatches(entry.pipeline.name || entry.pipeline.id, entry.namePositions),
                ),
                h(
                  'span',
                  { className: 'dsh-devops-monospace', style: { color: 'var(--dsw-alias-label-tertiary)', flex: 'none' } },
                  highlightMatches(entry.pipeline.id, entry.idPositions),
                ),
                entry.pipeline.category
                  ? h('span', { className: 'dsh-devops-tag' }, entry.pipeline.category)
                  : null,
              ),
            ),
            hidden > 0
              ? h('div', { className: 'dsh-devops-hint' }, '还有 ' + hidden + ' 条匹配，继续输入可收窄')
              : null,
          ),
  );
}

/* ------------------------------------------------------------------ *
 * 分发器
 * ------------------------------------------------------------------ */

/** 枚举字段的候选值：静态 options、或 optionsFrom 语义来源。 */
function enumOptions(field, ctx) {
  if (Array.isArray(field.options) && field.options.length) return field.options;
  const from = field.optionsFrom;
  if (!from) return [];
  const servers = dataOf(ctx, 'servers') || [];
  if (from === 'server') return servers.map((s) => s.id);
  if (from === 'shell') return ['auto', 'bash', 'sh', 'zsh', 'pwsh', 'powershell', 'cmd'];
  if (from.indexOf('runtime:') === 0) {
    const kind = from.slice('runtime:'.length);
    const set = new Set(RUNTIME_VERSIONS[kind] || []);
    for (const server of servers) {
      for (const key of Object.keys(server.runtimes || {})) {
        if (key.indexOf(kind + ':') === 0) set.add(key.slice(kind.length + 1));
      }
    }
    return Array.from(set);
  }
  return [];
}

/**
 * 按字段描述符渲染一个控件。
 * props: { field, value, onChange, ctx, serverId, resolveServer, resolveBase }
 */
function FieldControl(props) {
  const field = props.field;
  const type = field.type || 'string';
  const value = props.value;
  const onChange = props.onChange || function () {};

  const common = { field, value, onChange, serverId: props.serverId };
  const resolved =
    props.resolveServer ? props.resolveServer(field.serverField) : props.serverId;

  let control = null;
  switch (type) {
    case 'text':
      control = h(TextArea, {
        value: value || '',
        rows: field.rows || 4,
        placeholder: field.placeholder || '',
        onChange,
      });
      break;
    case 'code':
      control = h(CodeControl, common);
      break;
    case 'path.dir':
    case 'path.file':
      control = h(PathControl, Object.assign({}, common, {
        resolveServer: props.resolveServer,
        recent: props.recent,
        remember: props.remember,
        ownerId: props.ownerId,
      }));
      break;
    case 'glob':
      control = h(GlobControl, Object.assign({}, common, {
        resolveServer: props.resolveServer,
        resolveBase: props.resolveBase,
      }));
      break;
    case 'enum':
      control = h(Select, {
        value: value === undefined ? '' : value,
        placeholder: field.placeholder || '（默认）',
        options: enumOptions(field, props.ctx),
        onChange,
      });
      break;
    case 'boolean':
      control = h(Switch, { value: value === true, onChange });
      break;
    case 'number':
      control = h(
        'div',
        { className: 'dsh-devops-field-row' },
        h(TextInput, {
          type: 'number',
          value: value === undefined || value === null ? '' : value,
          min: field.min,
          max: field.max,
          onChange: (v) => onChange(v === '' ? '' : Number(v)),
        }),
        h('span', { className: 'dsh-devops-hint' }, field.unit === 'ms' ? '秒' : field.unit || ''),
      );
      break;
    case 'server':
      control = h(Select, {
        value: value === undefined ? '' : value,
        placeholder: field.placeholder || '（用默认服务器）',
        options: (dataOf(props.ctx, 'servers') || []).map((s) => ({
          value: s.id,
          label: s.name + (s.kind === 'local' ? '（本机）' : ' · ' + (s.host || '')),
        })),
        onChange,
      });
      break;
    case 'runtime':
      control = h(RuntimeControl, Object.assign({}, common, {
        serverId: resolved,
        defaultServer: dataOf(props.ctx, 'defaultServer'),
        serverFor: props.serverFor,
        onProvisioned: props.onProvisioned,
      }));
      break;
    case 'keyvalue':
      control = h(KeyValueControl, common);
      break;
    case 'multiselect':
      control = h(MultiSelectControl, Object.assign({}, common, { options: props.optionValues }));
      break;
    case 'ref:envset':
      control = h(RefControl, Object.assign({}, common, { envsets: dataOf(props.ctx, 'envsets') }));
      break;
    case 'ref:snippet':
      control = h(RefControl, Object.assign({}, common, { snippets: dataOf(props.ctx, 'snippets') }));
      break;
    case 'ref:pipeline':
      // 候选来自 App 下发的 fieldCtx.pipelines（缺失时控件内降级为空列表）
      control = h(PipelineRefControl, Object.assign({}, common, { ctx: props.ctx }));
      break;
    case 'string':
    default:
      control = h(TextInput, {
        value: value === undefined || value === null ? '' : value,
        placeholder: field.placeholder || '',
        onChange,
      });
      break;
  }

  // number 字段显式标注单位时补一句；行内已显示就不重复。
  const desc = field.description || '';
  return h(Field, { label: field.label || field.name, required: field.required, description: desc }, control);
}

exports.FieldControl = FieldControl;
exports.CodeControl = CodeControl;
exports.PathControl = PathControl;
exports.GlobControl = GlobControl;
exports.RuntimeControl = RuntimeControl;
exports.KeyValueControl = KeyValueControl;
exports.MultiSelectControl = MultiSelectControl;
exports.RefControl = RefControl;
exports.PipelineRefControl = PipelineRefControl;
exports.matchPipelines = matchPipelines;
exports.fuzzyMatch = fuzzyMatch;
exports.enumOptions = enumOptions;
});

__def("./diagnostics.js", function (module, exports, require) {
/**
 * 卡住诊断：phase 流转 + 「已多久无输出」+ 临近超时倒计时 + 归因线索。
 * 全部基于步骤对象本地计算，前端每秒刷新，不轮询后端。
 */
const { h } = require('./h.js');
const { Icon } = require('./ui.js');
const { PHASES, PHASE_TEXT } = require('./state.js');

/** 步骤是否处于「进行中」——只有进行中的步骤才需要诊断。 */
function isLive(step) {
  return !!step && (step.status === 'running' || step.status === 'pending');
}

/**
 * 计算卡住诊断。
 * 返回 { live, silentMs, silentText, stuck, phaseIndex, timeoutLeftMs, nearTimeout,
 *        clues:[{tone,text}], elapsedMs }
 */
function diagnoseStep(step, options) {
  const opts = options || {};
  const now = opts.now || Date.now();
  const stuckSilenceSec = opts.stuckSilenceSec || 60;
  const out = {
    live: isLive(step),
    elapsedMs: 0,
    silentMs: 0,
    silentText: '',
    stuck: false,
    phaseIndex: -1,
    timeoutLeftMs: null,
    nearTimeout: false,
    clues: [],
  };
  if (!step) return out;

  const startedAt = step.startedAt || 0;
  if (startedAt) out.elapsedMs = Math.max(0, (step.finishedAt || now) - startedAt);

  const lastOutputAt = step.lastOutputAt || startedAt || 0;
  if (lastOutputAt) out.silentMs = Math.max(0, now - lastOutputAt);

  const phase = step.phase || 'queued';
  out.phaseIndex = PHASES.indexOf(phase);

  if (out.live) {
    // 「已 Xm Ys 无输出」——只有运行中且确实静默时才有意义
    if (out.silentMs > 0) {
      out.silentText = '已 ' + humanMs(out.silentMs) + ' 无输出';
      out.stuck = out.silentMs >= stuckSilenceSec * 1000;
    }
    if (step.timeoutMs && startedAt) {
      out.timeoutLeftMs = startedAt + step.timeoutMs - now;
      out.nearTimeout = out.timeoutLeftMs > 0 && out.timeoutLeftMs <= 60000;
    }
  }

  out.clues = buildClues(step, out, opts);
  return out;
}

function humanMs(ms) {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m === 0) return s + 's';
  return m + 'm ' + String(s).padStart(2, '0') + 's';
}

/** 归因线索：把「卡在哪一步」翻译成可执行的动作建议。 */
function buildClues(step, diag, opts) {
  const clues = [];
  const phase = step.phase || 'queued';
  const server = opts.server || null;
  const isRemote = server && server.kind === 'ssh';

  if (step.status === 'failed') {
    if (step.exitCode !== null && step.exitCode !== undefined && step.exitCode !== 0) {
      clues.push({ tone: 'error', text: '退出码 ' + step.exitCode + '，命令本身失败；先看日志末尾的非零退出原因。' });
    }
    if (step.error) clues.push({ tone: 'error', text: step.error });
    if (isRemote) clues.push({ tone: 'warn', text: '远端执行失败常见原因：SSH 认证/网络中断、目标路径不存在、运行时缺失（可用服务器页「一键安装」补齐）。' });
    return clues;
  }

  if (!diag.live) return clues;

  if (phase === 'connecting') {
    clues.push({ tone: 'warn', text: '长时间停留在「建立连接」：多为主机不可达或认证失败。到服务器页点「测试连接」核实。' });
  } else if (phase === 'provisioning') {
    clues.push({ tone: 'warn', text: '正在准备运行时（下载/编译解释器可能较慢）。若无输出超过阈值，检查服务器出网能力或改用已装版本。' });
  } else if (phase === 'transferring') {
    clues.push({ tone: 'warn', text: '文件传输中：大文件或慢链路会长时间无输出，属正常；若卡满超时考虑缩小 artifacts 范围。' });
  } else if (phase === 'draining') {
    clues.push({ tone: 'warn', text: '正在收尾：进程可能已退出但输出流尚未关闭。' });
  }

  if (phase === 'queued') {
    clues.push({ tone: 'warn', text: '排队中：并发已达到上限，等前面步骤结束后会自动开始。' });
  }

  if (diag.stuck) {
    clues.push({
      tone: 'warn',
      text: '疑似卡住：' + diag.silentText + '（阈值 ' + (opts.stuckSilenceSec || 60) + 's）。可查看日志确认是否有交互式提示在等待输入，必要时取消并重试。',
    });
  }
  if (diag.nearTimeout && diag.timeoutLeftMs !== null) {
    clues.push({ tone: 'error', text: '接近超时：剩余 ' + humanMs(diag.timeoutLeftMs) + '，超时后该步骤会被判失败。' });
  }
  if (step.attempt && step.attempt > 1) {
    clues.push({ tone: 'warn', text: '这是第 ' + step.attempt + ' 次尝试，前一次失败可能是瞬时故障。' });
  }
  return clues;
}

/** phase 流转小方块：走到的显示 done，当前显示 active。 */
function PhaseFlow(props) {
  const current = props.phase || 'queued';
  const index = PHASES.indexOf(current);
  const failed = props.status === 'failed';
  const settled = props.status === 'success';
  return h(
    'div',
    { className: 'dsh-devops-phases', title: '阶段：' + (PHASE_TEXT[current] || current) },
    PHASES.map((phase, i) => {
      let state = 'idle';
      if (i < index) state = 'done';
      else if (i === index) state = failed ? 'failed' : settled && phase === 'settled' ? 'done' : 'active';
      return h('span', { key: phase, className: 'dsh-devops-phase', 'data-state': state, title: PHASE_TEXT[phase] + '（' + phase + '）' });
    }),
    h('span', { style: { marginLeft: '4px', color: 'var(--dsw-alias-label-tertiary)' } }, PHASE_TEXT[current] || current),
  );
}

/** 卡住诊断行：静默时长 + 倒计时 + 线索。 */
function StuckPanel(props) {
  const diag = props.diag;
  if (!diag || !diag.live) return null;
  const parts = [];
  if (diag.silentText) parts.push(diag.silentText);
  if (diag.timeoutLeftMs !== null && diag.timeoutLeftMs !== undefined) parts.push('超时倒计时 ' + humanMs(Math.max(0, diag.timeoutLeftMs)));
  if (diag.elapsedMs) parts.push('已运行 ' + humanMs(diag.elapsedMs));

  return h(
    'div',
    { style: { padding: '6px 8px', borderTop: '0.5px solid var(--dsw-alias-border-l2)' } },
    h(
      'div',
      { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)' } },
      h(PhaseFlow, { phase: props.step && props.step.phase, status: props.step && props.step.status }),
      parts.length ? h('span', null, parts.join('  ·  ')) : null,
      diag.stuck ? h(Icon, { name: 'warn', size: 11 }) : null,
    ),
    diag.clues.length
      ? h(
          'div',
          { style: { marginTop: '5px', display: 'flex', flexDirection: 'column', gap: '3px' } },
          diag.clues.map((clue, i) =>
            h(
              'div',
              {
                key: i,
                style: {
                  fontSize: '11px',
                  color:
                    clue.tone === 'error'
                      ? 'var(--dsw-alias-state-error-primary)'
                      : clue.tone === 'warn'
                        ? 'var(--dsw-alias-state-warn-primary)'
                        : 'var(--dsw-alias-label-tertiary)',
                },
              },
              '· ' + clue.text,
            ),
          ),
        )
      : null,
  );
}

/**
 * 失败归因建议：根据 run 的步骤集合给出可操作建议。
 */
function attributionFor(run) {
  if (!run) return [];
  const steps = Object.keys(run.steps || {}).map((id) => run.steps[id]);
  const failed = steps.filter((s) => s.status === 'failed');
  if (!failed.length) return [];
  const tips = [];
  const first = failed[0];
  tips.push('首个失败的步骤是「' + (first.name || first.id) + '」，修它通常能连带解决后续失败。');
  if (failed.some((s) => s.exitCode === 127)) tips.push('出现退出码 127：命令或解释器不存在，检查运行时是否装好、PATH 是否包含。');
  if (failed.some((s) => s.exitCode === 126)) tips.push('出现退出码 126：文件不可执行，检查权限位。');
  if (failed.some((s) => s.error && /超时|timeout/i.test(s.error))) tips.push('存在超时失败：调大该步骤的 timeoutMs，或把长任务拆小。');
  if (failed.length > 1) tips.push('想只重跑失败的一步，用步骤卡片上的「重试此步」。');
  return tips;
}

exports.diagnoseStep = diagnoseStep;
exports.isLive = isLive;
exports.humanMs = humanMs;
exports.PhaseFlow = PhaseFlow;
exports.StuckPanel = StuckPanel;
exports.attributionFor = attributionFor;
});

__def("./logs.js", function (module, exports, require) {
/**
 * 实时日志面板：SSE 订阅（契约 §3.11）+ 历史补齐 + 自动滚动 + 暂停跟随 +
 * 关键字过滤 + 下载。
 *
 * 显示层（task-7）：
 *  - 深色终端观感：只加类名，**颜色与字体全部由 CSS 决定**（JS 里不写色值）；
 *  - 语法着色：走 `./syntax.js` 的 tokenizer，每个 token 渲染成
 *    `<span class="dsh-devops-tok dsh-devops-tok-<kind>">`，配色由样式表给；
 *  - 语言：打开时对首批历史内容自动识别一次（之后沿用），工具栏可手动切换，
 *    切到「纯文本」则整块不再产生 token span。
 */
const { h, useState, useEffect, useRef, useMemo, useCallback, fmtBytes } = require('./h.js');
const { Icon, Button, TextInput, Select } = require('./ui.js');
const { api } = require('./api.js');
const { createRunStream } = require('./sse.js');
const { tokenizeLine, detectLanguage, normalizeLanguage } = require('./syntax.js');

const MAX_LINES = 5000;
/** 自动识别语言时最多纳入的行数（猜一次就沿用，避免流式日志反复改判）。 */
const DETECT_SAMPLE_LINES = 60;
/** 纯实时流（打开时还没有历史）时，累积多少行后也识别一次语言。 */
const DETECT_STREAM_SAMPLE = 6;
/** 行 → token 的缓存上限（滚动/过滤会反复重渲染同一批行）。 */
const TOKEN_CACHE_MAX = 2000;

/** 语言切换项：auto 用自动识别，text 关闭着色。 */
const LANGUAGE_OPTIONS = [
  { value: 'auto', label: '自动' },
  { value: 'shell', label: 'Shell' },
  { value: 'python', label: 'Python' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'json', label: 'JSON' },
  { value: 'yaml', label: 'YAML' },
  { value: 'text', label: '纯文本' },
];

/**
 * 从若干行里识别语言：行可以是字符串，也可以是 {text} 形式。
 * @returns {string} 语言名；样本为空（或全是空白）时返回空串，表示「猜不出来，先不猜」
 */
function detectFromLines(lines) {
  const list = Array.isArray(lines) ? lines : [];
  const text = list
    .slice(0, DETECT_SAMPLE_LINES)
    .map((l) => {
      if (l === null || l === undefined) return '';
      if (typeof l === 'string') return l;
      return l.text === null || l.text === undefined ? '' : String(l.text);
    })
    .join('\n');
  if (!text.trim()) return '';
  return detectLanguage(text);
}

/** 纯文本模式：不产生任何语法 token。 */
function isPlainMode(mode) {
  const m = String(mode === null || mode === undefined ? '' : mode).trim().toLowerCase();
  return m === 'text' || m === 'plain' || m === 'none';
}

/**
 * 由「用户选择 + 自动识别结果」算出真正生效的语言；关闭着色时返回空串。
 * @param {string} mode auto | shell | python | javascript | json | yaml | text
 * @param {string} detected detectLanguage() 的结果
 */
function resolveLanguage(mode, detected) {
  if (isPlainMode(mode)) return '';
  if (!mode || mode === 'auto') return normalizeLanguage(detected || 'shell');
  return normalizeLanguage(mode);
}

/** 行 → token；language 为空串表示纯文本（整行一个 plain token，不包 span）。 */
function tokensForLine(text, language) {
  const raw = text === null || text === undefined ? '' : String(text);
  if (!language) return [{ text: raw, kind: 'plain' }];
  const key = language + '\u0000' + raw;
  const cached = tokenCache.get(key);
  if (cached) return cached;
  const tokens = tokenizeLine(raw, language);
  if (tokenCache.size >= TOKEN_CACHE_MAX) tokenCache.clear();
  tokenCache.set(key, tokens);
  return tokens;
}

/** 行→token 缓存（模块级；纯函数结果，可安全复用）。 */
const tokenCache = new Map();

/**
 * 在一个 token 的文本里标出过滤命中：大小写不敏感，只取第一处（与旧行为一致）。
 * @returns {Array<{text:string, hit:boolean}>}
 */
function splitHits(text, keyword) {
  const raw = text === null || text === undefined ? '' : String(text);
  const kw = String(keyword || '');
  if (!kw) return [{ text: raw, hit: false }];
  const idx = raw.toLowerCase().indexOf(kw.toLowerCase());
  if (idx < 0) return [{ text: raw, hit: false }];
  const parts = [];
  if (idx > 0) parts.push({ text: raw.slice(0, idx), hit: false });
  parts.push({ text: raw.slice(idx, idx + kw.length), hit: true });
  if (idx + kw.length < raw.length) parts.push({ text: raw.slice(idx + kw.length), hit: false });
  return parts;
}

/**
 * 渲染一行日志的正文节点。
 *  - 普通模式：token → `.dsh-devops-tok-<kind>` span（颜色由 CSS 决定）；
 *  - 纯文本模式：不着色，不产生任何 tok span；
 *  - 过滤命中：命中片段包 <mark>，**包在所属 token 的 span 内部**，不破坏着色。
 */
function renderLineContent(line, filter, language) {
  const tokens = tokensForLine(line && line.text, language);
  const nodes = [];
  tokens.forEach((token, ti) => {
    const pieces = filter ? splitHits(token.text, filter) : [{ text: token.text, hit: false }];
    pieces.forEach((piece, pi) => {
      const key = ti + '-' + pi;
      if (!language) {
        // 纯文本：不产生 tok span；命中仍用 mark 高亮
        nodes.push(piece.hit ? h('mark', { key }, piece.text) : piece.text);
        return;
      }
      nodes.push(
        h('span', { key, className: 'dsh-devops-tok dsh-devops-tok-' + token.kind }, piece.hit ? h('mark', null, piece.text) : piece.text),
      );
    });
  });
  return nodes;
}

/** 单条日志行：语法着色 + 过滤命中高亮；gap 行单独提示。纯函数，无 hook。 */
function LogLine(props) {
  const line = props.line;
  if (line.gap) {
    return h('div', { className: 'dsh-devops-log-gap' }, '—— 断线期间跳过了 seq ' + line.from + ' ~ ' + line.to + ' ——');
  }
  const language = props.language || '';
  return h(
    'div',
    {
      className: 'dsh-devops-logline',
      'data-stream': line.stream || 'stdout',
      'data-lang': language || 'plain',
      'data-seq': line.seq === undefined || line.seq === null ? undefined : String(line.seq),
    },
    props.lineNo
      ? h('span', { className: 'dsh-devops-logline-no', key: 'no' }, String(props.lineNo))
      : null,
    h('span', { className: 'dsh-devops-logline-text', key: 'text' }, renderLineContent(line, props.filter, language)),
  );
}

/**
 * 日志面板。
 * props: { runId, stepId, live, onClose, meta, language }
 */
function LogPanel(props) {
  const [lines, setLines] = useState([]);
  const [follow, setFollow] = useState(true);
  const [filter, setFilter] = useState('');
  const [status, setStatus] = useState(props.live ? 'connecting' : 'idle');
  const [bytes, setBytes] = useState(0);
  const [lossy, setLossy] = useState(false);
  const [langMode, setLangMode] = useState(props.language || 'auto');
  const [detected, setDetected] = useState('');
  const [showLineNo, setShowLineNo] = useState(true);
  const viewRef = useRef(null);
  const fromRef = useRef(0);
  const streamRef = useRef(null);
  const detectedRef = useRef(false);
  const sampleRef = useRef([]);

  /** 对这步骤的脚本/日志内容自动识别一次语言，之后沿用（不因流式新行改判）。 */
  const guessLanguage = useCallback((sample) => {
    if (detectedRef.current) return;
    const guess = detectFromLines(sample);
    if (!guess) return;
    detectedRef.current = true;
    setDetected(guess);
  }, []);

  /** 历史日志补齐（打开面板或重连后）。 */
  const loadHistory = useCallback(
    async (from) => {
      if (!props.runId) return;
      try {
        const result = await api.runLogs(props.runId, { stepId: props.stepId, from: from || 0 });
        if (!result) return;
        const next = result.lines || [];
        guessLanguage(next);
        fromRef.current = result.next || fromRef.current;
        setBytes(result.bytes || 0);
        setLossy(!!result.lossy);
        setLines((prev) => {
          const merged = prev.concat(next.map((l) => ({ seq: l.seq, ts: l.ts, stream: l.stream, text: l.text })));
          return merged.length > MAX_LINES ? merged.slice(merged.length - MAX_LINES) : merged;
        });
      } catch (error) {
        setStatus('error');
      }
    },
    [props.runId, props.stepId, guessLanguage],
  );

  // 面板打开就拉一次历史
  useEffect(() => {
    setLines([]);
    fromRef.current = 0;
    loadHistory(0);
  }, [loadHistory]);

  // 只有运行中的步骤才挂 SSE，已结束的步骤一次拉全即可，避免无谓连接
  useEffect(() => {
    if (!props.runId || !props.live) {
      setStatus(props.live ? 'connecting' : 'idle');
      return undefined;
    }
    const stream = createRunStream(props.runId, {
      lastEventId: fromRef.current,
      onStatus: (s) => setStatus(s),
      onEvent: (name, data) => {
        if (name === 'ping') return;
        if (name === 'log') {
          if (props.stepId && data.stepId && data.stepId !== props.stepId) return;
          // 打开时还没有历史（任务刚起）：先用前几行识别一次语言，之后沿用
          if (!detectedRef.current) {
            sampleRef.current.push(data.text || '');
            if (sampleRef.current.length >= DETECT_STREAM_SAMPLE) guessLanguage(sampleRef.current);
          }
          setLines((prev) => {
            const next = prev.concat([{ seq: data.seq, ts: data.ts, stream: data.stream, text: data.text }]);
            return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
          });
          setBytes((b) => b + (data.text ? data.text.length : 0));
          return;
        }
        if (name === 'gap') {
          if (props.stepId && data.stepId && data.stepId !== props.stepId) return;
          setLines((prev) => prev.concat([{ gap: true, from: data.from, to: data.to }]));
          return;
        }
        // run / step 事件交给上层，用回调透传
        props.onEvent && props.onEvent(name, data);
      },
    });
    streamRef.current = stream;
    return () => {
      streamRef.current = null;
      stream.close();
    };
  }, [props.runId, props.stepId, props.live]);

  // 自动跟随：新行到达时滚到底
  useEffect(() => {
    if (!follow) return;
    const el = viewRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, follow]);

  const visible = useMemo(() => {
    if (!filter) return lines;
    const lower = filter.toLowerCase();
    return lines.filter((line) => line.gap || (line.text || '').toLowerCase().includes(lower));
  }, [lines, filter]);

  const activeLanguage = resolveLanguage(langMode, detected);

  function jumpToEnd() {
    setFollow(true);
    const el = viewRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }

  function download() {
    const text = lines.map((l) => (l.gap ? '[gap ' + l.from + '-' + l.to + ']' : l.text)).join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (props.runId || 'run') + '-' + (props.stepId || 'all') + '.log';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  const statusText =
    status === 'open' ? '实时' : status === 'connecting' ? '连接中' : status === 'error' ? '已断开' : status === 'idle' ? '已结束' : '已关闭';
  const statusTone = status === 'open' ? 'ok' : status === 'error' ? 'error' : 'idle';
  const autoLabel = detected ? '自动（' + detected + '）' : '自动';
  const langOptions = LANGUAGE_OPTIONS.map((opt) =>
    opt.value === 'auto' ? { value: opt.value, label: autoLabel } : { value: opt.value, label: opt.label },
  );

  return h(
    'div',
    { className: 'dsh-devops-logpanel', 'data-lang': activeLanguage || 'text' },
    h(
      'div',
      { className: 'dsh-devops-logbar' },
      h('span', { className: 'dsh-devops-chip', 'data-tone': statusTone }, h('span', { className: 'dsh-devops-dot', 'data-tone': statusTone }), statusText),
      h(TextInput, {
        value: filter,
        placeholder: '过滤关键字',
        onChange: setFilter,
        className: 'dsh-devops-input',
        style: { width: '150px' },
      }),
      h(Select, {
        value: langMode,
        className: 'dsh-devops-langselect',
        options: langOptions,
        onChange: (value) => setLangMode(value),
      }),
      h(Button, {
        size: 'sm',
        active: showLineNo,
        icon: 'history',
        label: showLineNo ? '隐藏行号' : '显示行号',
        onClick: () => setShowLineNo(!showLineNo),
      }),
      h('span', { className: 'dsh-devops-hint' }, visible.length + ' 行 · ' + fmtBytes(bytes || 0)),
      lossy ? h('span', { className: 'dsh-devops-chip', 'data-tone': 'warn' }, '日志已滚出内存环') : null,
      h('div', { className: 'dsh-devops-spacer' }),
      h(Button, {
        size: 'sm',
        active: follow,
        icon: follow ? 'pause' : 'play',
        label: follow ? '暂停跟随' : '继续跟随',
        onClick: () => setFollow(!follow),
      }),
      h(Button, { size: 'sm', icon: 'download', label: '跳末尾', onClick: jumpToEnd }),
      h(Button, { size: 'sm', icon: 'download', label: '下载', onClick: download }),
      h(Button, { size: 'sm', icon: 'refresh', label: '刷新', onClick: () => loadHistory(0) }),
      props.onClose ? h(Button, { size: 'sm', variant: 'ghost', icon: 'close', onClick: props.onClose }) : null,
    ),
    h(
      'div',
      {
        className: 'dsh-devops-logview',
        ref: viewRef,
        'data-lang': activeLanguage || 'text',
        'data-lineno': showLineNo ? 'on' : 'off',
        // 用户手动往上滚时自动取消跟随，滚回底部再恢复
        onScroll: (e) => {
          const el = e.target;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          if (!atBottom && follow) setFollow(false);
          if (atBottom && !follow) setFollow(true);
        },
      },
      visible.length
        ? visible.map((line, i) =>
            h(LogLine, {
              key: (line.seq || 'g') + '-' + i,
              line,
              filter,
              language: activeLanguage,
              lineNo: showLineNo ? line.seq || i + 1 : 0,
            }),
          )
        : h('div', { className: 'dsh-devops-hint' }, status === 'connecting' ? '正在连接日志流…' : '暂无日志输出'),
    ),
  );
}

exports.LogPanel = LogPanel;
exports.LogLine = LogLine;
exports.detectFromLines = detectFromLines;
exports.LANGUAGE_OPTIONS = LANGUAGE_OPTIONS;
exports.resolveLanguage = resolveLanguage;
exports.renderLineContent = renderLineContent;
exports.tokensForLine = tokensForLine;
});

__def("./canvas.js", function (module, exports, require) {
/**
 * 流水线画布：横向编排（阶段 = 列，列内节点自上而下堆叠为块状卡片）。
 *
 * 设计要点：
 * - 阶段自左向右成列，画布横向可滚动；列头、列与列之间、画布末尾都能就地插入新阶段。
 * - 节点是块状卡片：序号 / 标题 / 节点类型 / 执行条件 / 服务器 / 超时 / needs / 产物。
 * - 动效只用 CSS transition/animation（见 styles.js），并尊重 prefers-reduced-motion。
 * - 所有结构变更都通过 props.onChange(完整新对象) 一次性提交完整新对象，
 *   保证不出现「基于过期 props 二次修改」的覆盖问题。
 *
 * 契约约束（docs/CONTRACT.md §2.1）：needs（DAG 调度）与阶段 parallel 不得混用。
 * 因此开启阶段并行前先检查，冲突时阻止提交并给出可见提示。
 */
const { h, useState, useEffect, useRef, useMemo } = require('./h.js');
const { Chip, Icon } = require('./ui.js');

/** 生成稳定 id：优先用安全字符集，冲突时加短随机后缀。 */
function makeId(prefix, existing) {
  const taken = new Set(existing || []);
  for (let i = 0; i < 40; i += 1) {
    const id = prefix + '-' + Math.random().toString(36).slice(2, 6);
    if (!taken.has(id)) return id;
  }
  return prefix + '-' + Date.now().toString(36);
}

/** 拖拽上下文：用模块级变量而非 dataTransfer，兼容性更好。 */
const dragState = { current: null };

/**
 * 二次确认。浏览器里有 window.confirm；Node 测试环境里没有 → 返回 undefined（视为已确认）。
 * 这样「有没有确认框」不会与「点了按钮是否提交」绑死：用例显式把 globalThis.confirm
 * 打成 () => false 就能验证取消分支。
 */
function browserConfirm(message) {
  if (typeof globalThis === 'undefined' || typeof globalThis.confirm !== 'function') return undefined;
  return globalThis.confirm(message);
}

/** 深拷贝：画布上所有结构变更都在副本上做，再整体提交。 */
function clonePipeline(pipeline) {
  return JSON.parse(JSON.stringify(pipeline || {}));
}

/** 新建 job 的默认形状，严格对齐契约 §2.1。 */
function newJob(id, descriptor) {
  const withDefaults = {};
  for (const field of descriptor.fields || []) {
    if (field.default !== undefined && field.default !== '') withDefaults[field.name] = field.default;
  }
  return {
    id,
    name: descriptor.title || descriptor.type,
    node: descriptor.type,
    server: '',
    needs: [],
    retry: { max: 0, delayMs: 1000 },
    timeoutMs: 600000,
    allowFailure: false,
    when: 'on_success',
    allowProvision: false,
    env: [],
    envSetRefs: [],
    with: withDefaults,
    artifacts: [],
    cache: { key: '', paths: [] },
  };
}

function collectJobIds(pipeline) {
  const ids = [];
  for (const stage of (pipeline && pipeline.stages) || []) {
    for (const job of stage.jobs || []) ids.push(job.id);
  }
  return ids;
}

/**
 * 流水线是否已声明 needs。
 * 契约 §2.1：任一 job 有非空 needs → 整条流水线走 DAG；此时不得再开启阶段并行。
 */
function pipelineHasNeeds(pipeline) {
  for (const stage of (pipeline && pipeline.stages) || []) {
    for (const job of stage.jobs || []) {
      if (job.needs && job.needs.length) return true;
    }
  }
  return false;
}

/**
 * 清掉所有 job 中指向「已被删除的 job」的 needs。
 *
 * 与 editor.js 的 deleteJob() 同一语义：删节点必须顺带清依赖，否则会留下悬空 needs。
 * 悬空 needs 的后果已实测（真实校验函数）：
 * - validatePipeline 报 stages[x].jobs[y].needs[z] / missing-field「依赖的作业不存在」
 * - buildGraph 报 job:x.needs / unknown-dependency，运行时抛「job j2 依赖了不存在的 job：j1」
 * 因此删除阶段时必须在**同一份新对象**里清理，保证删除后仍可通过校验、可运行。
 *
 * @param {{stages?: Array}} next 已改过的流水线副本（原地清理）
 * @param {string[]} removedIds 被删除的 job id
 * @returns {number} 被清掉的 needs 条数
 */
function cleanRemovedNeeds(next, removedIds) {
  const removed = new Set(removedIds || []);
  if (removed.size === 0) return 0;
  let cleaned = 0;
  for (const stage of (next && next.stages) || []) {
    for (const job of stage.jobs || []) {
      if (!Array.isArray(job.needs) || job.needs.length === 0) continue;
      const kept = job.needs.filter((n) => !removed.has(n));
      if (kept.length !== job.needs.length) {
        cleaned += job.needs.length - kept.length;
        job.needs = kept;
      }
    }
  }
  return cleaned;
}

/** 数值取一位小数，避免路径字符串里出现长浮点。 */
function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * 依赖边的几何计算（列布局专用，纯函数便于测试）。
 *
 * rect 形如 { left, top, width, height }，坐标同为「画布内容坐标系」。
 * 列布局下不能假设起止点左右相邻，故分三种走线：
 * - forward ：下游在右侧 → 出右边缘、入左边缘，横向控制点。
 * - vertical：上下游同列（上下相邻）→ 出下边缘、入上边缘，纵向控制点。
 * - backward：下游在左侧（跨列回指）→ 从卡片下方绕行，避免压住卡片。
 */
function buildEdgePath(a, b) {
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  const bx = b.left + b.width / 2;
  const by = b.top + b.height / 2;

  // 同列：水平中心几乎重合
  if (Math.abs(bx - ax) < 16) {
    const down = by >= ay;
    const x1 = ax;
    const y1 = down ? a.top + a.height : a.top;
    const x2 = bx;
    const y2 = down ? b.top : b.top + b.height;
    const my = (y1 + y2) / 2;
    return {
      kind: 'vertical',
      d:
        'M' + round1(x1) + ',' + round1(y1) +
        ' C' + round1(x1) + ',' + round1(my) +
        ' ' + round1(x2) + ',' + round1(my) +
        ' ' + round1(x2) + ',' + round1(y2),
    };
  }

  // 下游在右侧：右边缘 → 左边缘
  if (bx > ax) {
    const x1 = a.left + a.width;
    const y1 = ay;
    const x2 = b.left;
    const y2 = by;
    const dx = Math.max(28, (x2 - x1) / 2);
    return {
      kind: 'forward',
      d:
        'M' + round1(x1) + ',' + round1(y1) +
        ' C' + round1(x1 + dx) + ',' + round1(y1) +
        ' ' + round1(x2 - dx) + ',' + round1(y2) +
        ' ' + round1(x2) + ',' + round1(y2),
    };
  }

  // 反向（下游列在左侧）：从两张卡片下方绕行
  const x1 = ax;
  const y1 = a.top + a.height;
  const x2 = bx;
  const y2 = b.top + b.height;
  const cy = Math.max(y1, y2) + 22;
  return {
    kind: 'backward',
    d:
      'M' + round1(x1) + ',' + round1(y1) +
      ' C' + round1(x1) + ',' + round1(cy) +
      ' ' + round1(x2) + ',' + round1(cy) +
      ' ' + round1(x2) + ',' + round1(y2),
  };
}

/** 元素相对画布内容原点的矩形。 */
function rectOf(el, base) {
  const r = el.getBoundingClientRect();
  return { left: r.left - base.left, top: r.top - base.top, width: r.width, height: r.height };
}

/**
 * 块状节点卡片。
 * props: { job, stageId, index, selected, dragging, onSelect, onDragStart, onDragEnd, readonly }
 *
 * readonly=true 时同构复用为只读卡片（详情页等）：不设 draggable、不挂拖拽回调、
 * 文案也不再提示拖拽。只读分支不影响编辑器——编辑器不传 readonly，走的仍是原路径。
 */
function NodeCard(props) {
  const job = props.job;
  const readonly = props.readonly === true;
  const whenText = job.when === 'manual' ? '手动触发' : job.when === 'always' ? '总是执行' : '上游成功后';
  const seconds = job.timeoutMs ? Math.round(job.timeoutMs / 1000) : 0;
  const needs = job.needs || [];
  const artifacts = job.artifacts || [];

  /**
   * 状态色：把运行状态挂成 data-status / data-tone，颜色由 styles.js 决定。
   * 编辑器里通常没有运行数据（status 为 pending，保持中性）；
   * 详情页/运行页会把该节点最近一次执行状态传进来。
   */
  const status = props.status || 'pending';
  const statusTone =
    status === 'success' ? 'ok'
      : status === 'failed' ? 'error'
        : status === 'running' ? 'busy'
          : status === 'canceled' ? 'warn'
            : 'idle';

  const cardProps = {
    className: 'dsh-devops-nodecard',
    'data-role': 'node-card',
    'data-readonly': readonly ? 'true' : undefined,
    'data-selected': props.selected ? 'true' : undefined,
    'data-dragging': props.dragging ? 'true' : undefined,
    'data-status': status,
    'data-tone': statusTone,
    draggable: readonly ? false : true,
    title: readonly ? '点击查看节点信息' : '拖拽可调整顺序或移动到其它阶段',
    onClick: (e) => {
      if (e && e.stopPropagation) e.stopPropagation();
      if (props.onSelect) props.onSelect(job.id);
    },
  };
  if (!readonly) {
    cardProps.onDragStart = (e) => {
      dragState.current = { jobId: job.id, stageId: props.stageId };
      if (props.onDragStart) props.onDragStart(job.id);
      try {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', job.id);
      } catch {
        /* 某些环境不允许写 dataTransfer，忽略 */
      }
    };
    cardProps.onDragEnd = () => {
      dragState.current = null;
      if (props.onDragEnd) props.onDragEnd();
    };
  }

  return h(
    'div',
    cardProps,
    h(
      'div',
      { className: 'dsh-devops-nodecard-head' },
      props.index ? h('span', { className: 'dsh-devops-nodecard-index' }, String(props.index)) : null,
      h('span', { className: 'dsh-devops-nodecard-title dsh-devops-truncate' }, job.name || job.id),
      job.allowFailure ? h('span', { className: 'dsh-devops-nodecard-flag', title: '允许失败，失败不阻断后续' }, '容错') : null,
    ),
    h('div', { className: 'dsh-devops-nodecard-type dsh-devops-monospace dsh-devops-truncate', title: job.node }, job.node),
    h(
      'div',
      { className: 'dsh-devops-nodecard-meta' },
      h('span', { className: 'dsh-devops-nodecard-key' }, '执行条件'),
      h('span', { className: 'dsh-devops-truncate' }, whenText),
      h('span', { className: 'dsh-devops-nodecard-key' }, '服务器'),
      h('span', { className: 'dsh-devops-truncate' }, job.server || '（默认）'),
      seconds ? h('span', { className: 'dsh-devops-nodecard-key' }, '超时') : null,
      seconds ? h('span', null, seconds + 's') : null,
    ),
    needs.length
      ? h(
          'div',
          { className: 'dsh-devops-nodecard-needs' },
          h('span', { className: 'dsh-devops-nodecard-key' }, 'needs'),
          needs.map((need) => h('span', { key: need, className: 'dsh-devops-nodecard-need' }, need)),
        )
      : null,
    artifacts.length ? h('div', { className: 'dsh-devops-nodecard-foot' }, artifacts.length + ' 项产物') : null,
  );
}

/** 列头小按钮：统一 data-role 便于定位与测试。 */
function HeadButton(props) {
  return h(
    'button',
    {
      type: 'button',
      className: 'dsh-devops-headbtn',
      'data-role': props.role,
      'data-active': props.active ? 'true' : undefined,
      'data-disabled': props.disabled ? 'true' : undefined,
      title: props.title,
      'aria-label': props.title,
      disabled: props.disabled || undefined,
      onClick: (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        if (!props.disabled && props.onClick) props.onClick();
      },
    },
    props.icon ? h(Icon, { name: props.icon, size: 12 }) : null,
    props.label ? h('span', null, props.label) : null,
  );
}

/**
 * 「就地新增阶段」入口。
 * kind: 'gap'（列与列之间）| 'head'（列头）| 'end'（画布末尾追加）。
 * data-index 表示插入位置（新阶段将落在该下标）。
 */
function AddStageButton(props) {
  const label = props.label === undefined ? '阶段' : props.label;
  return h(
    'button',
    {
      type: 'button',
      className: 'dsh-devops-addstage',
      'data-role': 'add-stage',
      'data-kind': props.kind,
      'data-index': String(props.index),
      'data-after-stage': props.afterStage || undefined,
      title: props.title || '在此处插入新阶段',
      'aria-label': props.title || '在此处插入新阶段',
      onClick: (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        props.onClick();
      },
    },
    h(Icon, { name: 'plus', size: 12 }),
    label ? h('span', { className: 'dsh-devops-addstage-label' }, label) : null,
  );
}

/**
 * 画布。
 * props: { pipeline, onChange, selectedJob, onSelectJob, registerAddNode, toast }
 */
function Canvas(props) {
  const pipeline = props.pipeline;
  const stages = (pipeline && pipeline.stages) || [];

  const [dragOver, setDragOver] = useState(null);
  const [draggingJob, setDraggingJob] = useState('');
  const [activeStage, setActiveStage] = useState('');
  const [notice, setNotice] = useState('');
  const [edgePaths, setEdgePaths] = useState([]);
  const boardRef = useRef(null);
  const dropRef = useRef(null);

  /** 拖放目标同步写 ref：事件回调里不依赖可能过期的 state 闭包。 */
  function setDrop(next) {
    dropRef.current = next;
    setDragOver(next);
  }

  function warn(text) {
    setNotice(text);
    if (props.toast && props.toast.warn) props.toast.warn(text);
  }

  const jobIndex = useMemo(() => {
    const map = new Map();
    for (const stage of stages) {
      for (const job of stage.jobs || []) map.set(job.id, { job, stageId: stage.id });
    }
    return map;
  }, [stages]);

  /** 计算依赖边：按列布局的卡片位置走线（不再假设左右相邻）。 */
  useEffect(() => {
    function recompute() {
      const board = boardRef.current;
      if (!board || typeof board.getBoundingClientRect !== 'function') return;
      const base = board.getBoundingClientRect();
      const paths = [];
      for (const stage of stages) {
        for (const job of stage.jobs || []) {
          for (const need of job.needs || []) {
            if (!jobIndex.has(need)) continue;
            const fromEl = board.querySelector('[data-job="' + cssEscape(need) + '"]');
            const toEl = board.querySelector('[data-job="' + cssEscape(job.id) + '"]');
            if (!fromEl || !toEl) continue;
            const built = buildEdgePath(rectOf(fromEl, base), rectOf(toEl, base));
            paths.push({ key: need + '->' + job.id, d: built.d, kind: built.kind });
          }
        }
      }
      setEdgePaths(paths);
    }
    recompute();
    const board = boardRef.current;
    const observer = typeof ResizeObserver !== 'undefined' && board ? new ResizeObserver(recompute) : null;
    if (observer) observer.observe(board);
    if (typeof window !== 'undefined') window.addEventListener('resize', recompute);
    const timer = setTimeout(recompute, 60);
    return () => {
      if (observer) observer.disconnect();
      if (typeof window !== 'undefined') window.removeEventListener('resize', recompute);
      clearTimeout(timer);
    };
  }, [stages, jobIndex, props.selectedJob, activeStage]);

  /** 把节点加到指定阶段（若没有阶段则先建一个）。 */
  function addNodeToStage(descriptor, stageId) {
    const next = clonePipeline(pipeline);
    next.stages = next.stages || [];
    if (next.stages.length === 0) {
      next.stages.push({ id: makeId('stage', []), name: '构建', parallel: false, jobs: [] });
    }
    const target = stageId
      ? next.stages.find((s) => s.id === stageId)
      : next.stages.find((s) => s.id === activeStage) || next.stages[next.stages.length - 1];
    if (!target) return;
    const id = makeId((descriptor.type || 'step').split('.').pop(), collectJobIds(next));
    target.jobs = (target.jobs || []).concat([newJob(id, descriptor)]);
    props.onChange(next);
    if (props.onSelectJob) props.onSelectJob(id);
  }

  const addNodeRef = useRef(addNodeToStage);
  addNodeRef.current = addNodeToStage;
  useEffect(() => {
    if (props.registerAddNode) {
      props.registerAddNode((descriptor, stageId) => addNodeRef.current(descriptor, stageId));
    }
  });

  /** 移动节点（含跨阶段与列内插入到指定卡片之前）。 */
  function moveJob(jobId, fromStageId, toStageId, beforeJobId) {
    const next = clonePipeline(pipeline);
    next.stages = next.stages || [];
    const from = next.stages.find((s) => s.id === fromStageId);
    if (!from) return;
    const fromIdx = (from.jobs || []).findIndex((j) => j.id === jobId);
    if (fromIdx < 0) return;
    const moved = from.jobs.splice(fromIdx, 1)[0];
    const target = next.stages.find((s) => s.id === toStageId);
    if (!target) {
      from.jobs.splice(fromIdx, 0, moved);
      return;
    }
    target.jobs = target.jobs || [];
    if (beforeJobId && beforeJobId !== jobId) {
      const at = target.jobs.findIndex((j) => j.id === beforeJobId);
      if (at >= 0) target.jobs.splice(at, 0, moved);
      else target.jobs.push(moved);
    } else {
      target.jobs.push(moved);
    }
    // 同阶段且顺序未变则不提交（避免产生无意义的 onChange）
    if (fromStageId === toStageId) {
      const original = ((pipeline.stages || []).find((s) => s.id === fromStageId) || {}).jobs || [];
      if (original.map((j) => j.id).join('|') === target.jobs.map((j) => j.id).join('|')) return;
    }
    props.onChange(next);
  }

  /** 在指定下标插入阶段：默认 parallel:false（契约 §2.1 默认走阶段串行）。 */
  function insertStage(index) {
    const next = clonePipeline(pipeline);
    next.stages = next.stages || [];
    const at = Math.max(0, Math.min(typeof index === 'number' ? index : next.stages.length, next.stages.length));
    const stage = {
      id: makeId('stage', next.stages.map((s) => s.id)),
      name: '新阶段 ' + (at + 1),
      parallel: false,
      jobs: [],
    };
    next.stages.splice(at, 0, stage);
    props.onChange(next);
    setActiveStage(stage.id);
  }

  function updateStage(stageId, patch) {
    const next = clonePipeline(pipeline);
    const stage = (next.stages || []).find((s) => s.id === stageId);
    if (!stage) return;
    Object.assign(stage, patch);
    props.onChange(next);
  }

  /** 阶段「并行」开关：与 needs 冲突时阻止提交并提示（契约禁止混用）。 */
  function toggleParallel(stage) {
    if (!stage.parallel && pipelineHasNeeds(pipeline)) {
      warn('这条流水线已有节点声明了 needs（DAG 调度），契约不允许再开启阶段并行。请先清除相关 needs。');
      return;
    }
    updateStage(stage.id, { parallel: !stage.parallel });
  }

  /**
   * 删除整个阶段：先二次确认，再在**同一份新对象**里清掉所有指向被删节点的 needs。
   *
   * 现状缺陷（用户原话「删除整个阶段没有确认，删除之后就炸了」）：
   * 1. 全工程只有它没有确认框（删流水线/模板/服务器/环境变量组/自定义节点都有）。
   * 2. 只 filter 阶段、不清理 needs，留下悬空依赖 → 校验报 missing-field、运行抛
   *    「job j2 依赖了不存在的 job：j1」。
   *
   * browserConfirm 是模块级函数：浏览器里就是 window.confirm()；Node 测试环境里没有它
   * （返回 undefined）即视为「已确认」，从而让既有用例仍能走到提交分支。
   * 需要验证「取消不提交」时，用例把 globalThis.confirm 打成返回 false 即可。
   */
  function removeStage(stageId) {
    const stage = stages.find((s) => s.id === stageId);
    if (!stage) return;

    const removedIds = (stage.jobs || []).map((j) => j.id);
    const dependents = [];
    for (const s of stages) {
      for (const job of s.jobs || []) {
        if (removedIds.some((id) => (job.needs || []).includes(id))) dependents.push(job.id);
      }
    }

    const parts = ['确定删除阶段「' + (stage.name || stage.id) + '」？'];
    parts.push(removedIds.length ? '该阶段内 ' + removedIds.length + ' 个节点会被一并删除' : '该阶段内没有节点');
    if (dependents.length) {
      parts.push('；依赖这些节点的 ' + dependents.length + ' 个节点（' + dependents.join('、') + '）会自动移除相关 needs');
    }
    parts.push('。');

    // 只有在确认框**明确返回 false** 时才取消；返回 undefined（无确认框的环境）视为已确认。
    if (browserConfirm(parts.join('')) === false) return;

    const next = clonePipeline(pipeline);
    next.stages = (next.stages || []).filter((s) => s.id !== stageId);
    const cleaned = cleanRemovedNeeds(next, removedIds);

    // 同一次提交里提示清理结果；否则用户会以为依赖凭空消失。
    if (cleaned > 0) warn('已删除阶段「' + (stage.name || stage.id) + '」，并清理了 ' + cleaned + ' 条指向被删节点的 needs。');

    props.onChange(next);

    // 检查器不得停留在已不存在的节点上（否则右栏会显示一个幽灵节点）。
    const selectedStillExists = removedIds.some((id) => props.selectedJob === id);
    if (selectedStillExists && props.onSelectJob) props.onSelectJob(null);
  }

  function moveStage(stageId, delta) {
    const next = clonePipeline(pipeline);
    next.stages = next.stages || [];
    const idx = next.stages.findIndex((s) => s.id === stageId);
    const to = idx + delta;
    if (idx < 0 || to < 0 || to >= next.stages.length) return;
    const item = next.stages.splice(idx, 1)[0];
    next.stages.splice(to, 0, item);
    props.onChange(next);
  }

  function renameStage(stage) {
    if (typeof prompt !== 'function') return;
    const name = prompt('阶段名称', stage.name);
    if (name) updateStage(stage.id, { name });
  }

  const fallbackDescriptor = { type: 'shell.exec', title: '执行 Shell', fields: [{ name: 'script', default: '' }] };

  /** 渲染一列（阶段）。 */
  function columnNode(stage, stageIndex) {
    return h(
      'div',
      {
        key: stage.id,
        className: 'dsh-devops-column',
        'data-role': 'stage-column',
        'data-stage-id': stage.id,
        'data-parallel': stage.parallel ? 'true' : undefined,
        'data-active': activeStage === stage.id ? 'true' : undefined,
        'data-drop': dragOver && dragOver.stageId === stage.id ? 'true' : undefined,
        onClick: (e) => {
          if (e && e.stopPropagation) e.stopPropagation();
          setActiveStage(stage.id);
        },
      },
      h(
        'div',
        { className: 'dsh-devops-column-head' },
        h('span', { className: 'dsh-devops-column-index' }, String(stageIndex + 1)),
        h(
          'span',
          {
            className: 'dsh-devops-column-title dsh-devops-truncate',
            title: '双击可改名',
            onDoubleClick: (e) => {
              if (e && e.stopPropagation) e.stopPropagation();
              renameStage(stage);
            },
          },
          stage.name || stage.id,
        ),
        stage.parallel ? h(Chip, { tone: 'busy', title: '阶段内节点并行执行' }, '并行') : null,
        h('span', { className: 'dsh-devops-hint' }, (stage.jobs || []).length + ' 节点'),
      ),
      h(
        'div',
        { className: 'dsh-devops-column-tools' },
        h(HeadButton, {
          role: 'parallel-toggle',
          icon: stage.parallel ? 'pause' : 'grid',
          active: !!stage.parallel,
          title: stage.parallel ? '关闭阶段并行' : '开启阶段并行（与 needs 不能混用）',
          onClick: () => toggleParallel(stage),
        }),
        h(HeadButton, {
          role: 'stage-add-node',
          icon: 'plus',
          label: '节点',
          title: '在此阶段添加一个 Shell 节点',
          onClick: () => addNodeToStage(fallbackDescriptor, stage.id),
        }),
        h(AddStageButton, {
          kind: 'head',
          index: stageIndex + 1,
          afterStage: stage.id,
          title: '在此列右侧插入新阶段',
          label: '阶段',
          onClick: () => insertStage(stageIndex + 1),
        }),
        h('div', { className: 'dsh-devops-spacer' }),
        h(HeadButton, { role: 'stage-move-prev', icon: 'chevron', title: '左移阶段', disabled: stageIndex === 0, onClick: () => moveStage(stage.id, -1) }),
        h(HeadButton, {
          role: 'stage-move-next',
          icon: 'chevronDown',
          title: '右移阶段',
          disabled: stageIndex === stages.length - 1,
          onClick: () => moveStage(stage.id, 1),
        }),
        h(HeadButton, { role: 'stage-remove', icon: 'trash', title: '删除阶段', onClick: () => removeStage(stage.id) }),
      ),
      h(
        'div',
        {
          className: 'dsh-devops-column-cards',
          'data-role': 'stage-cards',
          onDragOver: (e) => {
            e.preventDefault();
            if (e.stopPropagation) e.stopPropagation();
            setDrop({ stageId: stage.id, before: null });
          },
          onDragLeave: () => {
            const cur = dropRef.current;
            if (cur && cur.stageId === stage.id && !cur.before) setDrop(null);
          },
          onDrop: (e) => {
            e.preventDefault();
            if (e.stopPropagation) e.stopPropagation();
            const data = dragState.current;
            const target = dropRef.current;
            setDrop(null);
            if (!data) return;
            const before = target && target.stageId === stage.id ? target.before : null;
            moveJob(data.jobId, data.stageId, stage.id, before);
          },
        },
        (stage.jobs || []).map((job, jobIndexInStage) =>
          h(
            'div',
            {
              key: job.id,
              className: 'dsh-devops-slot',
              'data-job': job.id,
              'data-drop-before':
                dragOver && dragOver.stageId === stage.id && dragOver.before === job.id ? 'true' : undefined,
              onDragOver: (e) => {
                e.preventDefault();
                if (e.stopPropagation) e.stopPropagation();
                setDrop({ stageId: stage.id, before: job.id });
              },
              onDrop: (e) => {
                e.preventDefault();
                if (e.stopPropagation) e.stopPropagation();
                const data = dragState.current;
                const target = dropRef.current;
                setDrop(null);
                if (!data) return;
                const before = target && target.stageId === stage.id ? target.before : job.id;
                moveJob(data.jobId, data.stageId, stage.id, before);
              },
            },
            h(NodeCard, {
              job,
              stageId: stage.id,
              index: jobIndexInStage + 1,
              selected: props.selectedJob === job.id,
              dragging: draggingJob === job.id,
              onSelect: props.onSelectJob,
              onDragStart: setDraggingJob,
              onDragEnd: () => setDraggingJob(''),
            }),
          ),
        ),
        (stage.jobs || []).length === 0 ? h('div', { className: 'dsh-devops-column-empty' }, '把节点拖到这里') : null,
      ),
    );
  }

  const boardChildren = [];
  stages.forEach((stage, stageIndex) => {
    boardChildren.push(columnNode(stage, stageIndex));
    if (stageIndex < stages.length - 1) {
      boardChildren.push(
        h(AddStageButton, {
          key: 'gap-' + stage.id,
          kind: 'gap',
          index: stageIndex + 1,
          afterStage: stage.id,
          title: '在这两列之间插入新阶段',
          label: '插入阶段',
          onClick: () => insertStage(stageIndex + 1),
        }),
      );
    }
  });
  boardChildren.push(
    h(AddStageButton, {
      key: 'add-stage-end',
      kind: 'end',
      index: stages.length,
      title: '在画布末尾追加一个阶段',
      label: '添加阶段',
      onClick: () => insertStage(stages.length),
    }),
  );

  return h(
    'div',
    {
      className: 'dsh-devops-canvas',
      'data-role': 'canvas',
      onClick: () => props.onSelectJob && props.onSelectJob(null),
    },
    notice
      ? h(
          'div',
          {
            className: 'dsh-devops-banner dsh-devops-canvas-notice',
            'data-role': 'canvas-notice',
            'data-tone': 'warn',
            role: 'alert',
          },
          h('span', null, notice),
          h('button', { type: 'button', className: 'dsh-devops-link', onClick: () => setNotice('') }, '知道了'),
        )
      : null,
    h(
      'div',
      { className: 'dsh-devops-board', 'data-role': 'board', ref: boardRef },
      h(
        'svg',
        { className: 'dsh-devops-edges', width: '100%', height: '100%', 'aria-hidden': 'true' },
        h(
          'defs',
          null,
          h(
            'marker',
            { id: 'dsh-devops-arrow', viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 6, markerHeight: 6, orient: 'auto' },
            h('path', { d: 'M0,0 L8,4 L0,8 z', fill: 'var(--dsw-alias-border-l4)' }),
          ),
        ),
        edgePaths.map((edge) =>
          h('path', {
            key: edge.key,
            'data-edge-kind': edge.kind,
            d: edge.d,
            fill: 'none',
            stroke: 'var(--dsw-alias-border-l4)',
            strokeWidth: 1.2,
            strokeDasharray: '4 3',
            markerEnd: 'url(#dsh-devops-arrow)',
          }),
        ),
      ),
      stages.length === 0
        ? h(
            'div',
            { className: 'dsh-devops-empty dsh-devops-board-empty', 'data-role': 'canvas-empty' },
            '还没有阶段：点右侧「添加阶段」，或直接点左侧节点面板里的任意节点开始编排。',
            h(
              'div',
              { style: { marginTop: '6px' } },
              '注意：当前没有可运行的节点，直接点「运行」会被拒绝（引擎会报「流水线不可执行：没有任何 job」）。',
            ),
          )
        : null,
      boardChildren,
    ),
  );
}

function cssEscape(value) {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(String(value));
  return String(value).replace(/["\\]/g, '\\$&');
}

/** 声明式能力标志：消费方（如详情页）据此决定是否复用本组件做只读卡片。 */
NodeCard.supportsReadonly = true;

exports.Canvas = Canvas;
exports.NodeCard = NodeCard;
exports.AddStageButton = AddStageButton;
exports.HeadButton = HeadButton;
exports.makeId = makeId;
exports.newJob = newJob;
exports.collectJobIds = collectJobIds;
exports.pipelineHasNeeds = pipelineHasNeeds;
exports.cleanRemovedNeeds = cleanRemovedNeeds;
exports.buildEdgePath = buildEdgePath;
exports.clonePipeline = clonePipeline;
exports.rectOf = rectOf;
});

__def("./ai.js", function (module, exports, require) {
/**
 * AI 联动入口：把流水线/失败运行编译成提示词，送进一个新会话。
 *
 * 降级链（任一层可用即停，全部不可用则复制到剪贴板）：
 *   1) ctx.get('uiWorkspace').startSession(undefined, { prompt, whenDraftExists })
 *      —— 新建会话并把提示词预填进 composer（正解）。
 *   2) ctx.get('conversation') 的入参面：requestDraftInitialization / send(text)。
 *   3) navigator.clipboard.writeText(prompt) + toast 提示去对话里粘贴。
 *
 * 任何一步抛错都继续往下降，绝不因为宿主能力缺失而中断用户操作。
 */
const { h, copyText } = require('./h.js');
const { Button } = require('./ui.js');

/** 从宿主 ctx 上安全取一个服务，取不到返回 null。 */
function safeGet(ctx, name) {
  if (!ctx) return null;
  try {
    if (typeof ctx.get === 'function') return ctx.get(name) || null;
  } catch {
    return null;
  }
  try {
    return ctx[name] || null;
  } catch {
    return null;
  }
}

/** 组装提示词尾部：要求按技能规范产出并先自校验。 */
function authoringTail() {
  return [
    '',
    '要求：',
    '1. 遵循 devops-pipeline-authoring 技能的规范来编排阶段、节点与依赖；',
    '2. 产出流水线后，先调用 devops_validate_pipeline 校验，确认无错误再交付；',
    '3. 明确说明每个节点的 server、needs、超时与重试取舍。',
  ].join('\n');
}

/** 把当前流水线编译成给模型的提示词。 */
function buildPipelinePrompt(pipeline, extra) {
  const lines = [];
  lines.push('我在用 dsh-devops 插件编排 CI/CD 流水线，请帮我完善它。');
  lines.push('');
  if (pipeline && (pipeline.name || pipeline.id)) {
    lines.push('流水线：' + (pipeline.name || pipeline.id));
    if (pipeline.description) lines.push('描述：' + pipeline.description);
    lines.push('调度模式：' + (hasNeeds(pipeline) ? 'DAG（按 needs 依赖）' : '阶段串行 + 阶段内并行开关'));
    lines.push('');
    lines.push('当前结构：');
    for (const stage of pipeline.stages || []) {
      lines.push('- 阶段「' + (stage.name || stage.id) + '」' + (stage.parallel ? '（并行）' : '（串行）'));
      for (const job of stage.jobs || []) {
        const bits = ['node=' + job.node];
        if (job.server) bits.push('server=' + job.server);
        if (job.needs && job.needs.length) bits.push('needs=' + job.needs.join(','));
        if (job.timeoutMs) bits.push('timeoutMs=' + job.timeoutMs);
        if (job.when && job.when !== 'on_success') bits.push('when=' + job.when);
        lines.push('  · ' + (job.name || job.id) + ' [' + bits.join(' ') + ']');
        if (job.with && Object.keys(job.with).length) lines.push('    参数：' + JSON.stringify(job.with).slice(0, 600));
      }
    }
    lines.push('');
    lines.push('完整 JSON：');
    lines.push('```json');
    lines.push(safeStringify(pipeline, 6000));
    lines.push('```');
  } else {
    lines.push('我还没有流水线定义，请从零帮我设计一条。');
  }
  if (extra) {
    lines.push('');
    lines.push(extra);
  }
  lines.push(authoringTail());
  return lines.join('\n');
}

/** 把失败的运行编译成诊断提示词：失败步骤 + stderr 尾部 + phase 历史。 */
function buildFailurePrompt(run, logs) {
  const lines = [];
  lines.push('我在用 dsh-devops 插件跑流水线，运行失败了，请帮我定位根因并给出修复步骤。');
  lines.push('');
  if (run) {
    lines.push('运行：' + run.id + '（流水线 ' + (run.pipelineName || run.pipelineId) + '）');
    lines.push('状态：' + run.status + '，触发方式：' + (run.trigger || 'manual'));
    lines.push('');
    lines.push('各步骤实况：');
    for (const id of Object.keys(run.steps || {})) {
      const step = run.steps[id];
      const bits = ['status=' + step.status, 'phase=' + (step.phase || '-')];
      if (step.exitCode !== null && step.exitCode !== undefined) bits.push('exitCode=' + step.exitCode);
      if (step.server) bits.push('server=' + step.server);
      if (step.attempt) bits.push('attempt=' + step.attempt);
      if (step.startedAt && step.finishedAt) bits.push('耗时=' + Math.round((step.finishedAt - step.startedAt) / 1000) + 's');
      lines.push('- ' + (step.name || id) + ' [' + bits.join(' ') + ']');
      if (step.error) lines.push('  错误：' + step.error);
      if (step.detail) lines.push('  细节：' + String(step.detail).slice(0, 400));
    }
    const failed = Object.keys(run.steps || {})
      .map((id) => run.steps[id])
      .filter((s) => s.status === 'failed');
    if (failed.length) {
      lines.push('');
      lines.push('失败集中在：' + failed.map((s) => s.name || s.id).join('、'));
    }
  }
  if (logs) {
    lines.push('');
    lines.push('失败步骤日志尾部（stderr 优先）：');
    lines.push('```');
    lines.push(String(logs).slice(-4000));
    lines.push('```');
  }
  lines.push('');
  lines.push('请指出最可能的根因，并给出具体到命令或配置项的修复建议；如果需要改流水线，给出可直接采用的 JSON 片段。');
  return lines.join('\n');
}

function hasNeeds(pipeline) {
  for (const stage of (pipeline && pipeline.stages) || []) {
    for (const job of stage.jobs || []) {
      if (job.needs && job.needs.length) return true;
    }
  }
  return false;
}

function safeStringify(value, limit) {
  try {
    const text = JSON.stringify(value, null, 2);
    return text.length > limit ? text.slice(0, limit) + '\n…（已截断）' : text;
  } catch {
    return '（无法序列化）';
  }
}

/**
 * 尝试用宿主能力把提示词送进会话。
 * @returns {ok:boolean, reason:string, how?:string}
 */
function sendViaHost(ctx, prompt) {
  // 1) uiWorkspace.startSession —— 新建会话并预填 composer
  const uiWorkspace = safeGet(ctx, 'uiWorkspace');
  if (uiWorkspace && typeof uiWorkspace.startSession === 'function') {
    try {
      uiWorkspace.startSession(undefined, { prompt, whenDraftExists: 'append' });
      return { ok: true, how: 'session', reason: '已新建会话并预填提示词' };
    } catch (error) {
      // 继续往下降
    }
  }

  // 2) 会话入参面：requestDraftInitialization / send(text)
  const conversation = safeGet(ctx, 'conversation') || safeGet(ctx, 'uiConversation');
  if (conversation) {
    const input = conversation.input;
    if (input && typeof input.requestDraftInitialization === 'function') {
      try {
        const result = input.requestDraftInitialization({ prompt, whenDraftExists: 'append' });
        if (result !== 'blocked') return { ok: true, how: 'draft', reason: '已预填会话草稿（' + result + '）' };
      } catch (error) {
        /* 继续 */
      }
    }
    if (input && typeof input.setDraft === 'function') {
      try {
        input.setDraft(prompt);
        return { ok: true, how: 'draft', reason: '已预填会话草稿' };
      } catch (error) {
        /* 继续 */
      }
    }
    if (typeof conversation.send === 'function') {
      try {
        conversation.send(prompt);
        return { ok: true, how: 'send', reason: '已发送到当前会话' };
      } catch (error) {
        /* 继续 */
      }
    }
  }
  return { ok: false, reason: '宿主未提供可用的会话服务' };
}

/**
 * AI 按钮：点击后走降级链。
 * props: { ctx, prompt: () => string, label, toast, title, size }
 */
function AiButton(props) {
  async function run(event) {
    if (event && event.stopPropagation) event.stopPropagation();
    const prompt = typeof props.prompt === 'function' ? props.prompt() : String(props.prompt || '');
    if (!prompt.trim()) {
      props.toast && props.toast.warn('没有可发送的内容');
      return;
    }

    const result = sendViaHost(props.ctx, prompt);
    if (result.ok) {
      props.toast && props.toast.ok(result.reason);
      if (props.onSent) props.onSent(result);
      return;
    }

    // 3) 兜底：复制到剪贴板
    const copied = await copyText(prompt);
    if (copied) {
      props.toast && props.toast.ok('提示词已复制，去对话里粘贴即可');
      if (props.onSent) props.onSent({ ok: true, how: 'clipboard' });
    } else {
      props.toast && props.toast.error('无法复制提示词：' + result.reason);
    }
  }

  return h(Button, {
    size: props.size || 'sm',
    icon: 'sparkle',
    label: props.label || '让 AI 帮我写',
    title: props.title || '新建会话并预填提示词；宿主不支持时复制到剪贴板',
    onClick: run,
  });
}

exports.AiButton = AiButton;
exports.buildPipelinePrompt = buildPipelinePrompt;
exports.buildFailurePrompt = buildFailurePrompt;
exports.sendViaHost = sendViaHost;
exports.authoringTail = authoringTail;
});

__def("./editor.js", function (module, exports, require) {
/**
 * 流水线编辑器：三栏布局。
 *   左 = 节点面板（按分类）+ 结构树
 *   中 = 画布（阶段泳道 / 拖拽 / 并行开关 / needs 依赖边）
 *   右 = 检查器（按节点字段描述符渲染表单 + 通用执行设置）
 */
const { h, useState, useEffect, useMemo, useRef, clone } = require('./h.js');
const { Button, TextInput, Select, Switch, Card, Field, Chip, KV, Empty, Banner, Modal } = require('./ui.js');
const { FieldControl } = require('./fields.js');
const { Canvas, makeId } = require('./canvas.js');
const { AiButton, buildPipelinePrompt } = require('./ai.js');
const { api } = require('./api.js');

/** 检查器宽度约束（px）：可拖拽区间与默认值（「流水线设置」侧栏用）。 */
const INSPECTOR_MIN = 260;
const INSPECTOR_MAX = 720;
const INSPECTOR_DEFAULT = 360;

/**
 * 节点编辑浮层宽度（px）：默认取用户要求的舒适区间（420~520），
 * 并可拖拽左边缘调宽（保留用户上轮要过的「可拉宽」能力，但不是主要交互）。
 */
const SHEET_MIN = 320;
const SHEET_MAX = 1100;
// 默认宽度调大：用户反馈「编辑框默认要更宽一点」——460px 下字段名与控件挤在一起，
// 长脚本也看不清。620px 能舒服放下标签+输入，同时不遮住画布内容。
const SHEET_DEFAULT = 620;

const CATEGORY_TEXT = {
  execute: '执行',
  file: '文件',
  artifact: '产物',
  control: '流程控制',
  wait: '等待',
  pipeline: '子流水线',
  server: '服务器',
  network: '网络',
  notify: '通知',
  util: '工具',
};

/** 左侧节点面板：按分类折叠 + 结构树。 */
function Palette(props) {
  const nodes = props.nodes || [];
  const [openCats, setOpenCats] = useState({});
  const [keyword, setKeyword] = useState('');

  const grouped = useMemo(() => {
    const map = new Map();
    for (const node of nodes) {
      const cat = node.category || 'util';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat).push(node);
    }
    return Array.from(map.entries());
  }, [nodes]);

  const filtered = keyword
    ? grouped
        .map(([cat, list]) => [cat, list.filter((n) => (n.title + n.type).toLowerCase().includes(keyword.toLowerCase()))])
        .filter(([, list]) => list.length)
    : grouped;

  return h(
    'div',
    { className: 'dsh-devops-palette' },
    h(
      'div',
      { style: { padding: '8px 8px 4px' } },
      h(TextInput, { value: keyword, placeholder: '搜索节点', onChange: setKeyword }),
    ),
    h(
      'div',
      { className: 'dsh-devops-palette-scroll' },
      h('div', { className: 'dsh-devops-hint', style: { margin: '4px 2px 6px' } }, '点击节点加入画布（加入选中的列，否则放入最后一列）'),
      filtered.map(([cat, list]) =>
        h(
          'div',
          { key: cat, style: { marginBottom: '8px' } },
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-devops-btn',
              'data-variant': 'ghost',
              'data-size': 'sm',
              style: { width: '100%', justifyContent: 'flex-start' },
              onClick: () => setOpenCats((prev) => Object.assign({}, prev, { [cat]: !prev[cat] })),
            },
            h('span', null, openCats[cat] === false ? '▸' : '▾'),
            CATEGORY_TEXT[cat] || cat,
            h('span', { className: 'dsh-devops-hint', style: { marginLeft: 'auto' } }, String(list.length)),
          ),
          openCats[cat] === false
            ? null
            : list.map((node) =>
                h(
                  'div',
                  {
                    key: node.type,
                    className: 'dsh-devops-palette-item',
                    title: (node.description || '') + '\n' + node.type,
                    onClick: () => props.onAddNode(node),
                  },
                  h('span', { style: { fontSize: '12px' } }, node.title || node.type),
                  h('span', { className: 'dsh-devops-hint' }, node.type),
                ),
              ),
        ),
      ),
      filtered.length === 0 ? h('div', { className: 'dsh-devops-hint' }, '没有匹配的节点') : null,
    ),
    props.structure
      ? h(
          'div',
          { style: { flex: 'none', maxHeight: '34%', overflow: 'auto', borderTop: '0.5px solid var(--dsw-alias-border-l3)', padding: '8px' } },
          h('div', { className: 'dsh-devops-hint', style: { marginBottom: '4px' } }, '结构树'),
          props.structure,
        )
      : null,
  );
}

/** 结构树：阶段 → 节点，点击定位到检查器。 */
function StructureTree(props) {
  const pipeline = props.pipeline;
  return h(
    'div',
    { className: 'dsh-devops-list' },
    (pipeline.stages || []).map((stage) =>
      h(
        'div',
        { key: stage.id },
        h('div', { className: 'dsh-devops-hint', style: { padding: '2px 4px' } }, (stage.parallel ? '∥ ' : '→ ') + (stage.name || stage.id)),
        (stage.jobs || []).map((job) =>
          h(
            'div',
            {
              key: job.id,
              className: 'dsh-devops-list-row',
              style: { paddingLeft: '14px' },
              'data-active': props.selectedJob === job.id ? 'true' : undefined,
              onClick: () => props.onSelectJob(job.id),
            },
            h('span', { className: 'dsh-devops-truncate' }, job.name || job.id),
          ),
        ),
      ),
    ),
  );
}

/** 检查器：节点字段 + 通用执行设置。 */
function Inspector(props) {
  const { job, node, pipeline } = props;
  if (!job) {
    return h(
      'div',
      { className: 'dsh-devops-inspector' },
      props.hideHead ? null : h(
      'div',
      { className: 'dsh-devops-inspector-head' },
      h('span', { className: 'dsh-devops-inspector-head-title' }, '流水线设置'),
      h('div', { className: 'dsh-devops-spacer' }),
      props.onCollapse
        ? h(Button, {
            size: 'sm',
            variant: 'ghost',
            icon: 'chevron',
            'data-role': 'inspector-collapse',
            title: '收起检查器',
            onClick: props.onCollapse,
          })
        : null,
    ),
      h(
        'div',
        { className: 'dsh-devops-inspector-scroll' },
        h('h3', { className: 'dsh-devops-card-title', style: { marginBottom: '8px' } }, '流水线设置'),
        h(
          Field,
          { label: '名称', required: true },
          h(TextInput, { value: pipeline.name || '', onChange: (v) => props.onPatchPipeline({ name: v }) }),
        ),
        h(Field, { label: '标识 id', description: '小写字母数字与 - _，用于引用' }, h(TextInput, { value: pipeline.id || '', onChange: (v) => props.onPatchPipeline({ id: v }) })),
        h(Field, { label: '描述' }, h(TextInput, { value: pipeline.description || '', onChange: (v) => props.onPatchPipeline({ description: v }) })),
        h(Field, { label: '分类' }, h(TextInput, { value: pipeline.category || '', onChange: (v) => props.onPatchPipeline({ category: v }) })),
        h(
          Field,
          { label: '标签' },
          h(TextInput, {
            value: (pipeline.tags || []).join(', '),
            placeholder: 'prod, nightly',
            onChange: (v) => props.onPatchPipeline({ tags: v.split(',').map((s) => s.trim()).filter(Boolean) }),
          }),
        ),
        h(
          'div',
          { style: { borderTop: '0.5px solid var(--dsw-alias-border-l3)', marginTop: '10px', paddingTop: '10px' } },
          h('h3', { className: 'dsh-devops-card-title', style: { marginBottom: '8px' } }, '变量'),
          h(VariableEditor, { variables: pipeline.variables || [], onChange: (v) => props.onPatchPipeline({ variables: v }) }),
        ),
        h(
          'div',
          { style: { marginTop: '10px' } },
          h(AiButton, { ctx: props.ctx, toast: props.toast, prompt: () => buildPipelinePrompt(pipeline), label: '让 AI 帮我写这条流水线' }),
        ),
      ),
    );
  }

  const fields = (node && node.fields) || [];
  const values = job.with || {};

  function setField(name, value) {
    const next = clone(values);
    if (value === undefined || value === '') delete next[name];
    else next[name] = value;
    props.onPatchJob({ with: next });
  }

  /** 把某个字段值提升为流水线参数（${{ params.x }}）。 */
  function promote(field) {
    const value = values[field.name];
    if (value === undefined || value === '') {
      props.toast.warn('该字段还没有值，无法提升为参数');
      return;
    }
    const paramName = prompt('参数名（英文字母/数字/下划线）', field.name);
    if (!paramName) return;
    const parameters = (props.pipeline.parameters || []).concat([
      {
        name: paramName,
        label: field.label || field.name,
        type: field.type === 'number' ? 'number' : 'string',
        required: !!field.required,
        default: String(value),
        options: [],
        field: field.name,
        description: field.description || '',
      },
    ]);
    props.onPatchPipeline({ parameters });
    setField(field.name, '${{ params.' + paramName + ' }}');
    props.toast.ok('已提升为参数 ${{ params.' + paramName + ' }}');
  }

  const allJobs = [];
  for (const stage of pipeline.stages || []) for (const j of stage.jobs || []) if (j.id !== job.id) allJobs.push(j);

  return h(
    'div',
    { className: 'dsh-devops-inspector' },
    props.hideHead ? null : h(
      'div',
      { className: 'dsh-devops-inspector-head' },
      h('span', { className: 'dsh-devops-inspector-head-title dsh-devops-truncate' }, node ? node.title || job.node : job.node),
      h('span', { className: 'dsh-devops-tag dsh-devops-monospace' }, job.id),
      h('div', { className: 'dsh-devops-spacer' }),
      props.onCollapse
        ? h(Button, {
            size: 'sm',
            variant: 'ghost',
            icon: 'chevron',
            'data-role': 'inspector-collapse',
            title: '收起检查器',
            onClick: props.onCollapse,
          })
        : null,
    ),
    h(
      'div',
      { className: 'dsh-devops-inspector-scroll' },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' } },
        h('h3', { className: 'dsh-devops-card-title' }, node ? node.title || job.node : job.node),
        h('span', { className: 'dsh-devops-tag' }, job.id),
      ),
      node && node.description ? h('div', { className: 'dsh-devops-hint', style: { marginBottom: '10px' } }, node.description) : null,

      h(Field, { label: '节点名称', required: true }, h(TextInput, { value: job.name || '', onChange: (v) => props.onPatchJob({ name: v }) })),
      h(
        Field,
        { label: '服务器', description: '留空表示用流水线默认服务器' },
        h(Select, {
          value: job.server || '',
          placeholder: '（用默认：' + (props.pipeline.defaults && props.pipeline.defaults.server) + '）',
          options: (props.servers || []).map((s) => ({ value: s.id, label: s.name + (s.kind === 'local' ? '（本机）' : '') })),
          onChange: (v) => props.onPatchJob({ server: v }),
        }),
      ),
      h(
        Field,
        { label: '执行时机' },
        h(Select, {
          value: job.when || 'on_success',
          options: [
            { value: 'on_success', label: '上游成功后' },
            { value: 'always', label: '总是执行' },
            { value: 'manual', label: '手动触发' },
          ],
          onChange: (v) => props.onPatchJob({ when: v }),
        }),
      ),
      h(
        Field,
        { label: '依赖（needs）', description: '选择依赖后整条流水线切换为 DAG 调度；不能与阶段「并行」混用' },
        h(NeedsPicker, {
          value: job.needs || [],
          candidates: allJobs,
          onChange: (v) => props.onPatchJob({ needs: v }),
        }),
      ),
      h(
        'div',
        { className: 'dsh-devops-field-row' },
        h(Field, { label: '超时（秒）' }, h(TextInput, { type: 'number', value: Math.round((job.timeoutMs || 600000) / 1000), onChange: (v) => props.onPatchJob({ timeoutMs: Number(v) * 1000 }) })),
        h(Field, { label: '重试次数' }, h(TextInput, { type: 'number', min: 0, value: (job.retry && job.retry.max) || 0, onChange: (v) => props.onPatchJob({ retry: Object.assign({ delayMs: 1000 }, job.retry, { max: Number(v) }) }) })),
      ),
      h(
        'div',
        { className: 'dsh-devops-field-row' },
        h(Field, { label: '允许失败' }, h(Switch, { value: !!job.allowFailure, onChange: (v) => props.onPatchJob({ allowFailure: v }) })),
        h(Field, { label: '允许安装运行时' }, h(Switch, { value: !!job.allowProvision, onChange: (v) => props.onPatchJob({ allowProvision: v }) })),
      ),

      fields.length
        ? h(
            'div',
            { style: { borderTop: '0.5px solid var(--dsw-alias-border-l3)', marginTop: '10px', paddingTop: '10px' } },
            h('div', { className: 'dsh-devops-field-head', style: { marginBottom: '8px' } }, h('span', { className: 'dsh-devops-field-label' }, '节点参数')),
            fields.map((field) =>
              h(
                'div',
                { key: field.name, style: { position: 'relative' } },
                h(FieldControl, {
                  field,
                  value: values[field.name],
                  onChange: (v) => setField(field.name, v),
                  ctx: props.fieldCtx,
                  serverId: job.server || (props.pipeline.defaults && props.pipeline.defaults.server),
                  resolveServer: (serverField) => {
                    if (!serverField) return job.server || (props.pipeline.defaults && props.pipeline.defaults.server);
                    const referenced = values[serverField];
                    return referenced || job.server || (props.pipeline.defaults && props.pipeline.defaults.server);
                  },
                  resolveBase: (baseField) => (baseField ? values[baseField] : ''),
                  serverFor: (id) => (props.servers || []).find((s) => s.id === id),
                  onProvisioned: props.onReload,
                  recent: props.recent,
                  remember: props.remember,
                  ownerId: job.id,
                }),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsh-devops-link',
                    style: { position: 'absolute', top: '0', right: '0', fontSize: '11px' },
                    title: '把当前值提升为流水线参数',
                    onClick: () => promote(field),
                  },
                  '提升为参数',
                ),
              ),
            ),
          )
        : h('div', { className: 'dsh-devops-hint' }, '该节点没有可配置参数'),

      node && node.outputs && node.outputs.length
        ? h(
            'div',
            { style: { marginTop: '10px' } },
            h('div', { className: 'dsh-devops-hint' }, '输出：' + node.outputs.map((o) => o.name + (o.type ? ':' + o.type : '')).join('、')),
          )
        : null,

      h(
        'div',
        { style: { display: 'flex', gap: '6px', marginTop: '12px', borderTop: '0.5px solid var(--dsw-alias-border-l3)', paddingTop: '10px' } },
        h(AiButton, {
          ctx: props.ctx,
          toast: props.toast,
          label: '让 AI 完善这个节点',
          prompt: () =>
            buildPipelinePrompt(
              props.pipeline,
              '我正在配置节点「' + (job.name || job.id) + '」（类型 ' + job.node + '），' +
                '它的可用字段是：' + JSON.stringify(fields.map((f) => ({ name: f.name, type: f.type, label: f.label }))) +
                '，当前值：' + JSON.stringify(values) + '。请给出该节点的推荐配置。',
            ),
        }),
      ),
    ),
  );
}

/** needs 多选：从同流水线其它节点里选依赖。 */
function NeedsPicker(props) {
  const candidates = props.candidates || [];
  if (candidates.length === 0) return h('div', { className: 'dsh-devops-hint' }, '没有其它节点可作为依赖');
  return h(
    'div',
    { style: { display: 'flex', gap: '4px', flexWrap: 'wrap' } },
    candidates.map((job) =>
      h(Button, {
        key: job.id,
        size: 'sm',
        label: job.name || job.id,
        active: props.value.includes(job.id),
        onClick: () => {
          if (props.value.includes(job.id)) props.onChange(props.value.filter((v) => v !== job.id));
          else props.onChange(props.value.concat([job.id]));
        },
      }),
    ),
  );
}

/** 流水线变量编辑（name/value/secret）。 */
function VariableEditor(props) {
  const rows = props.variables || [];
  function setAt(index, patch) {
    props.onChange(rows.map((row, i) => (i === index ? Object.assign({}, row, patch) : row)));
  }
  return h(
    'div',
    { className: 'dsh-devops-list' },
    rows.map((row, index) =>
      h(
        'div',
        { key: index, className: 'dsh-devops-field-row' },
        h(TextInput, { value: row.name, placeholder: '名称', onChange: (v) => setAt(index, { name: v }) }),
        h(TextInput, { value: row.value, placeholder: '值', type: row.secret ? 'password' : 'text', onChange: (v) => setAt(index, { value: v }) }),
        h(Button, {
          size: 'sm',
          variant: 'ghost',
          icon: row.secret ? 'eye' : 'pause',
          title: row.secret ? '密钥（来自凭据）' : '普通变量',
          active: !!row.secret,
          onClick: () => setAt(index, { secret: !row.secret }),
        }),
        h(Button, { size: 'sm', variant: 'ghost', icon: 'close', onClick: () => props.onChange(rows.filter((_, i) => i !== index)) }),
      ),
    ),
    h(Button, { size: 'sm', icon: 'plus', label: '添加变量', onClick: () => props.onChange(rows.concat([{ name: '', value: '', secret: false }])) }),
  );
}

/** 存为模板对话框：填名称/分类/描述。 */
function TemplateModal(props) {
  const [name, setName] = useState((props.pipeline.name || '') + ' 模板');
  const [category, setCategory] = useState(props.pipeline.category || '');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await api.templateFromPipeline({
        pipelineId: props.pipeline.id,
        name,
        category,
        description,
        templateId: makeId('tpl', []),
      });
      props.toast.ok('已存为模板');
      props.onClose();
      props.onSaved && props.onSaved();
    } catch (error) {
      props.toast.error(error.message || String(error));
    } finally {
      setBusy(false);
    }
  }

  return h(
    Modal,
    {
      title: '存为模板',
      onClose: props.onClose,
      footer: [h(Button, { key: 'c', label: '取消', onClick: props.onClose }), h(Button, { key: 's', label: '保存', variant: 'primary', busy, onClick: submit })],
    },
    h(Field, { label: '模板名称', required: true }, h(TextInput, { value: name, onChange: setName })),
    h(Field, { label: '分类' }, h(TextInput, { value: category, onChange: setCategory })),
    h(Field, { label: '描述' }, h(TextInput, { value: description, onChange: setDescription })),
    h('div', { className: 'dsh-devops-hint' }, '保存的是当前流水线的完整结构；密钥类变量只保留引用名。'),
  );
}

/** 运行对话框：运行前可覆盖流水线变量。 */
function RunModal(props) {
  const [vars, setVars] = useState(() => {
    const out = {};
    for (const v of props.pipeline.variables || []) out[v.name] = v.value;
    return out;
  });
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const result = await api.runPipeline(props.pipeline.id, vars);
      props.toast.ok('已开始运行：' + (result && result.runId ? result.runId : ''));
      props.onClose();
      props.onStarted && props.onStarted(result && (result.runId || result.id));
    } catch (error) {
      props.toast.error(error.message || String(error));
    } finally {
      setBusy(false);
    }
  }

  const declared = props.pipeline.variables || [];
  return h(
    Modal,
    {
      title: '运行「' + (props.pipeline.name || props.pipeline.id) + '」',
      onClose: props.onClose,
      footer: [h(Button, { key: 'c', label: '取消', onClick: props.onClose }), h(Button, { key: 'r', label: '开始运行', variant: 'primary', busy, onClick: submit })],
    },
    declared.length
      ? declared.map((v) =>
          h(Field, { key: v.name, label: v.name, description: v.secret ? '密钥变量（值来自凭据）' : '' },
            h(TextInput, { value: vars[v.name] || '', type: v.secret ? 'password' : 'text', onChange: (val) => setVars(Object.assign({}, vars, { [v.name]: val })) })),
        )
      : h('div', { className: 'dsh-devops-hint' }, '这条流水线没有声明变量，直接运行即可。'),
  );
}

/**
 * 编辑器主体。
 * props: { pipeline, onChange, nodes, servers, ctx, toast, onSave, onRun, onReload, recent, remember }
 */

/**
 * 节点编辑浮层：**覆盖在编排画布之上**的圆角卡片，而不是占一栏的固定检查器。
 *
 * 用户要求（原话）：「点击节点之后虚化背景……去点击编辑层之外的地方，
 * 编辑窗口会自动保存内容收起来。」因此：
 *  - 有选中节点时浮出（遮罩虚化 + elevation 阴影），**覆盖而非挤压**画布；
 *  - 点浮层外部（遮罩）→ 先提交/保存再收起；Esc 同样关闭；
 *  - 浮层内沿用 Inspector 的全部字段控件，不丢任何编辑能力；
 *  - 左边缘可拖拽调宽（附加能力；默认 SHEET_DEFAULT，用户不需要拉也能用）。
 *
 * 与「查看节点信息」（详情页只读抽屉）区分：这里是**可编辑**的编排浮层。
 */
function NodeEditSheet(props) {
  const job = props.job || null;
  const open = !!job;
  const [width, setWidth] = useState(() => {
    try {
      const saved = typeof localStorage !== 'undefined' ? Number(localStorage.getItem('dsh-devops.sheetWidth')) : 0;
      return saved >= SHEET_MIN && saved <= SHEET_MAX ? saved : SHEET_DEFAULT;
    } catch {
      return SHEET_DEFAULT;
    }
  });
  const dragRef = useRef(null);

  function persistWidth(value) {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem('dsh-devops.sheetWidth', String(Math.round(value)));
    } catch {
      /* 隐私模式等场景存不了，忽略 */
    }
  }

  /** 左边缘拖拽：向左拖变宽（浮层贴右侧）。 */
  function startResize(event) {
    if (event && event.preventDefault) event.preventDefault();
    if (event && event.stopPropagation) event.stopPropagation();
    const startX = event && event.clientX !== undefined ? event.clientX : 0;
    const startWidth = width;
    let latest = startWidth;
    dragRef.current = { startX, startWidth };
    const onMove = (e) => {
      const x = e && e.clientX !== undefined ? e.clientX : startX;
      const next = Math.max(SHEET_MIN, Math.min(SHEET_MAX, startWidth - (x - startX)));
      latest = next;
      setWidth(next);
    };
    const onUp = () => {
      if (typeof window === 'undefined') return;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      // 抬手时才落盘，避免拖动过程中反复写 localStorage
      persistWidth(latest);
      dragRef.current = null;
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    }
  }

  // Esc 关闭（与点外部同一条路径：先保存再收起）
  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    const onKey = (event) => {
      if (event && event.key === 'Escape' && props.onClose) props.onClose('esc');
    };
    document.addEventListener('keydown', onKey);
    return () => {
      if (document && document.removeEventListener) document.removeEventListener('keydown', onKey);
    };
  }, [open, props.onClose]);

  return h(
    'div',
    {
      className: 'dsh-devops-editor-sheet-layer',
      'data-role': 'node-edit-layer',
      // 浮层形态：覆盖画布，不挤压布局
      'data-shape': 'floating',
      'data-open': open ? 'true' : 'false',
      'aria-hidden': open ? 'false' : 'true',
    },
    // 遮罩：背景虚化；点它就是「点编辑层之外」→ 自动保存并收起
    h('div', {
      className: 'dsh-devops-editor-sheet-mask',
      'data-role': 'node-edit-mask',
      'data-blur': 'true',
      onClick: () => props.onClose && props.onClose('mask'),
    }),
    h(
      'aside',
      {
        className: 'dsh-devops-editor-sheet',
        'data-role': 'node-edit-sheet',
        'data-variant': 'floating',
        style: { width: width + 'px' },
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': '编辑节点',
        onClick: (event) => {
          // 点浮层内部不应关闭
          if (event && event.stopPropagation) event.stopPropagation();
        },
      },
      // 左边缘拖拽手柄（附加能力）
      h('div', {
        className: 'dsh-devops-editor-sheet-resizer',
        'data-role': 'node-edit-resizer',
        title: '拖拽调整浮层宽度',
        onMouseDown: startResize,
      }),
      h(
        'div',
        { className: 'dsh-devops-editor-sheet-head' },
        h('span', { className: 'dsh-devops-editor-sheet-title dsh-devops-truncate' },
          job ? (job.name || job.id) : ''),
        job ? h('span', { className: 'dsh-devops-tag dsh-devops-monospace' }, job.node) : null,
        h('div', { className: 'dsh-devops-spacer' }),
        h(Button, {
          size: 'sm',
          variant: 'ghost',
          icon: 'close',
          label: '完成',
          'data-role': 'node-edit-close',
          title: '保存并收起（Esc）',
          onClick: () => props.onClose && props.onClose('button'),
        }),
      ),
      h(
        'div',
        { className: 'dsh-devops-editor-sheet-body' },
        open
          ? h(Inspector, {
              job: props.job,
              node: props.node,
              pipeline: props.pipeline,
              servers: props.servers,
              ctx: props.ctx,
              fieldCtx: props.fieldCtx,
              toast: props.toast,
              onPatchJob: props.onPatchJob,
              onPatchPipeline: props.onPatchPipeline,
              onReload: props.onReload,
              recent: props.recent,
              remember: props.remember,
              hideHead: true,
            })
          : null,
      ),
      h(
        'div',
        { className: 'dsh-devops-editor-sheet-foot' },
        h('span', { className: 'dsh-devops-hint' }, '改动已即时保存；点浮层外部或按 Esc 收起'),
      ),
    ),
  );
}

function PipelineEditor(props) {
  const pipeline = props.pipeline;
  const [selectedJob, setSelectedJob] = useState(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const [validation, setValidation] = useState(null);
  const [busy, setBusy] = useState(false);
  const addNodeRef = useRef(null);

  /**
   * 检查器宽度：可拖拽调整并持久化到 localStorage。
   * 用户抱怨「这么窄一个，拉也不能拉宽」——右侧面板固定 288px 且不可调，
   * 写长脚本时完全不够用，因此这里给出可拖拽的边缘 + 收起/展开。
   */
  const [inspectorWidth, setInspectorWidth] = useState(() => {
    try {
      const saved = typeof localStorage !== 'undefined' ? Number(localStorage.getItem('dsh-devops.inspectorWidth')) : 0;
      return saved >= INSPECTOR_MIN && saved <= INSPECTOR_MAX ? saved : INSPECTOR_DEFAULT;
    } catch {
      return INSPECTOR_DEFAULT;
    }
  });
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const dragRef = useRef(null);

  /**
   * 本页自管滚动：挂载时告诉宿主「body 不要再整页滚」（app.js 的 onBodyFlush），
   * 卸载时恢复。否则子区域拿不到有界高度，画布的横向滚动条会被推到页面底部。
   */
  useEffect(() => {
    if (typeof props.onBodyFlush !== 'function') return undefined;
    props.onBodyFlush(true);
    return () => props.onBodyFlush(false);
  }, [props.onBodyFlush]);
  /**
   * 本次浮层会话里是否发生过编辑。
   * 字段控件是「改一次提交一次」（props.onChange 直接写上层 draft），
   * 所以关闭时内容本来就不会丢；这里额外记一笔，用于关闭时做一次显式的
   * **最终提交（flush）**，把「点外部 = 自动保存并收起」落成可观察的行为。
   */
  const sheetDirtyRef = useRef(false);

  function persistWidth(width) {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem('dsh-devops.inspectorWidth', String(Math.round(width)));
    } catch {
      /* 隐私模式等场景下存不了，忽略即可 */
    }
  }

  /** 拖拽分隔条：向左拖变宽、向右拖变窄（面板在右侧）。 */
  function startResize(event) {
    if (event && event.preventDefault) event.preventDefault();
    const startX = event && event.clientX !== undefined ? event.clientX : 0;
    const startWidth = inspectorWidth;
    dragRef.current = { startX, startWidth };

    const onMove = (e) => {
      const x = e && e.clientX !== undefined ? e.clientX : startX;
      const next = Math.max(INSPECTOR_MIN, Math.min(INSPECTOR_MAX, startWidth - (x - startX)));
      setInspectorWidth(next);
    };
    const onUp = () => {
      if (typeof window === 'undefined') return;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      dragRef.current = null;
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    }
  }

  /** 双击分隔条：在默认宽度与最大化之间切换（快捷操作）。 */
  function toggleWide() {
    const next = inspectorWidth >= INSPECTOR_MAX - 20 ? INSPECTOR_DEFAULT : INSPECTOR_MAX;
    setInspectorWidth(next);
    persistWidth(next);
  }

  const jobIndex = useMemo(() => {
    const map = new Map();
    for (const stage of (pipeline.stages || [])) for (const job of stage.jobs || []) map.set(job.id, job);
    return map;
  }, [pipeline]);

  // 删除阶段（或节点）后，原来的 selectedJob 可能已不在 jobIndex 里。
  // 这里天然安全降级：selected 为 null → Inspector 回落到「流水线设置」，
  // 顶部也不会再对一个不存在的节点显示「复制/删除节点」。不要改成抛错或保留旧对象。
  const selected = selectedJob ? jobIndex.get(selectedJob) : null;
  const selectedNode = selected ? (props.nodes || []).find((n) => n.type === selected.node) : null;

  function patchPipeline(patch) {
    props.onChange(Object.assign(clone(pipeline), patch));
  }

  function patchJob(patch) {
    // 契约 §2.1：needs（DAG 调度）与阶段 parallel 不得混用。
    // 画布侧已拦住「先有 needs 再开并行」，这里补上反方向：已有并行阶段时不再允许新增 needs。
    if (patch.needs && patch.needs.length) {
      const parallelStage = (pipeline.stages || []).find((s) => s.parallel);
      if (parallelStage) {
        props.toast.warn(
          '阶段「' + (parallelStage.name || parallelStage.id) + '」已开启并行，契约不允许再声明 needs（DAG 调度）。请先关闭该阶段的并行。',
        );
        return;
      }
    }
    const next = clone(pipeline);
    for (const stage of next.stages || []) {
      const idx = (stage.jobs || []).findIndex((j) => j.id === selectedJob);
      if (idx >= 0) stage.jobs[idx] = Object.assign(stage.jobs[idx], patch);
    }
    sheetDirtyRef.current = true;
    props.onChange(next);
  }

  /**
   * 收起编辑浮层。用户要求「点编辑层之外 → 自动保存内容收起来」：
   * 字段改动本来就是逐次通过 props.onChange 提交的（上层会写进 draft），
   * 这里再做一次「落定」——把当前 pipeline 交给 onSave 的轻量提交路径前先保证
   * 没有未提交的本地草稿；同时把浮层状态清空，回到纯画布视图。
   */
  function closeSheet(reason) {
    // 点浮层外部 / Esc / 点「完成」都走这里：
    // 有过编辑就做一次最终提交（flush），保证「自动保存」而不是「丢弃」。
    if (sheetDirtyRef.current) {
      props.onChange(clone(pipeline));
      sheetDirtyRef.current = false;
    }
    setSelectedJob(null);
    if (props.onSheetClose) props.onSheetClose(reason || 'close');
  }

  function deleteJob() {
    const next = clone(pipeline);
    for (const stage of next.stages || []) {
      stage.jobs = (stage.jobs || []).filter((j) => j.id !== selectedJob);
      // 顺带清掉别的节点对它的依赖，避免留下悬空 needs
      for (const job of stage.jobs) {
        job.needs = (job.needs || []).filter((n) => n !== selectedJob);
      }
    }
    props.onChange(next);
    setSelectedJob(null);
  }

  function duplicateJob() {
    const next = clone(pipeline);
    for (const stage of next.stages || []) {
      const idx = (stage.jobs || []).findIndex((j) => j.id === selectedJob);
      if (idx < 0) continue;
      const source = stage.jobs[idx];
      const copy = clone(source);
      copy.id = makeId(source.id.split('-')[0] || 'step', (next.stages || []).flatMap((s) => (s.jobs || []).map((j) => j.id)));
      copy.name = (source.name || source.id) + ' 副本';
      copy.needs = [];
      stage.jobs.splice(idx + 1, 0, copy);
      setSelectedJob(copy.id);
    }
    props.onChange(next);
  }

  async function validate() {
    setBusy(true);
    try {
      const result = await api.validatePipeline(pipeline);
      setValidation(result);
    } catch (error) {
      props.toast.error(error.message || String(error));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      await props.onSave(pipeline);
      props.toast.ok('已保存');
      setValidation(null);
    } catch (error) {
      props.toast.error(error.message || String(error));
    } finally {
      setBusy(false);
    }
  }

  const detection = detectScheduling(pipeline);

  return h(
    'div',
    { style: { flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 } },
    h(
      'div',
      { className: 'dsh-devops-head' },
      h('h2', { className: 'dsh-devops-title' }, pipeline.name || pipeline.id || '未命名流水线'),
      h(Chip, { tone: detection === 'dag' ? 'busy' : 'idle' }, detection === 'dag' ? 'DAG 调度' : '阶段调度'),
      h(Chip, null, (pipeline.stages || []).length + ' 阶段'),
      h(Chip, null, countJobs(pipeline) + ' 节点'),
      h('div', { className: 'dsh-devops-spacer' }),
      h(Button, { size: 'sm', icon: 'check', label: '校验', busy, onClick: validate }),
      h(Button, { size: 'sm', icon: 'box', label: '存为模板', onClick: () => setTemplateOpen(true) }),
      h(Button, { size: 'sm', icon: 'play', label: '运行', variant: 'primary', disabled: !pipeline.id, onClick: () => setRunOpen(true) }),
      h(Button, { size: 'sm', icon: 'check', label: '保存', onClick: save, busy }),
    ),
    validation
      ? h(
          'div',
          { style: { padding: '0 16px' } },
          validation.ok
            ? h(Banner, { tone: 'ok' }, '校验通过')
            : h(
                Banner,
                { tone: 'error' },
                h('div', { style: { fontWeight: 500, marginBottom: '4px' } }, '校验未通过，共 ' + (validation.errors || []).length + ' 个问题：'),
                (validation.errors || []).slice(0, 12).map((err, i) =>
                  h('div', { key: i, className: 'dsh-devops-monospace', style: { fontSize: '11px' } }, (err.path || '') + '  [' + (err.code || '') + ']  ' + (err.message || '')),
                ),
              ),
        )
      : null,
    h(
      'div',
      { className: 'dsh-devops-editor' },
      h(Palette, {
        nodes: props.nodes || [],
        onAddNode: (node) => addNodeRef.current && addNodeRef.current(node, undefined),
        structure: h(StructureTree, { pipeline, selectedJob, onSelectJob: setSelectedJob }),
      }),
      h(
        'div',
        // minHeight:0 必须显式给：flex 子项默认 min-height:auto 会拒绝收缩，
        // 画布会被内容撑高、自身 overflow:auto 失效（横向滚动条被推到页面底部够不着）。
        { style: { flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 } },
        h(
          'div',
          { className: 'dsh-devops-statusbar-inline' },
          h('span', null, '横向编排：阶段是列，节点在列内自上而下；拖拽可换列换序，双击列标题改名，列头或列间可插入新阶段'),
          h('div', { className: 'dsh-devops-spacer' }),
          selected
            ? h(
                'span',
                { style: { display: 'flex', gap: '6px' } },
                h(Button, { size: 'sm', label: '复制节点', onClick: duplicateJob }),
                h(Button, { size: 'sm', variant: 'danger', label: '删除节点', onClick: deleteJob }),
              )
            : null,
        ),
        // 0 节点：保存能成功、validate 也返回 ok（校验口径不看 job 数量），
        // 但引擎在 prepareGraph 里会抛「流水线不可执行：没有任何 job」。
        // 前端必须先把这条预判说清楚，避免用户到点「运行」那一刻才发现。
        countJobs(pipeline) === 0
          ? h(
              Banner,
              { tone: 'warn' },
              '当前没有可运行的节点：保存与校验都会通过，但点「运行」会被拒绝（引擎报「流水线不可执行：没有任何 job」）。请先在左侧节点面板添加节点。',
            )
          : null,
        h(Canvas, {
          pipeline,
          onChange: props.onChange,
          selectedJob,
          onSelectJob: setSelectedJob,
          toast: props.toast,
          registerAddNode: (fn) => {
            addNodeRef.current = fn;
          },
        }),
      ),
      // 可拖拽的分隔条：向左拖宽检查器（右侧面板），双击在默认/最大化间切换。
      // 注意：选中节点时**不占用这一栏** —— 编辑走覆盖画布的浮层（见下方 NodeEditSheet），
      // 这一栏只在「没有选中节点」（流水线设置）时保留。
      h('div', {
        className: 'dsh-devops-inspector-resizer',
        'data-role': 'inspector-resizer',
        'data-open': !selected && inspectorOpen ? 'true' : 'false',
        title: '拖拽调整宽度，双击在默认/最大化之间切换',
        onMouseDown: startResize,
        onDoubleClick: toggleWide,
      }),
      !selected && inspectorOpen
        ? h('div', { className: 'dsh-devops-inspector-host', style: { width: inspectorWidth + 'px' } },
            h(Inspector, {
              job: null,
              node: null,
              pipeline,
              servers: props.servers,
              ctx: props.ctx,
              fieldCtx: props.fieldCtx,
              toast: props.toast,
              onPatchJob: patchJob,
              onPatchPipeline: patchPipeline,
              onReload: props.onReload,
              recent: props.recent,
              remember: props.remember,
              onCollapse: () => setInspectorOpen(false),
            }))
        : null,
      !selected && !inspectorOpen
        ? h('div', { className: 'dsh-devops-inspector-rail' },
            h(Button, {
              size: 'sm',
              variant: 'ghost',
              icon: 'chevron',
              className: 'dsh-devops-inspector-toggle',
              'data-role': 'inspector-toggle',
              title: '展开检查器',
              onClick: () => setInspectorOpen(true),
            }))
        : null,
    ),
    // 节点编辑浮层：覆盖在画布之上（不挤压布局），点外部/Esc 自动保存并收起。
    // 只在选中节点时挂载 —— 收起后浮层与遮罩都不留在 DOM 里，
    // 避免一个隐藏的遮罩常驻并拦截画布点击。
    selected
      ? h(NodeEditSheet, {
          job: selected,
          node: selectedNode,
          pipeline,
          servers: props.servers,
          ctx: props.ctx,
          fieldCtx: props.fieldCtx,
          toast: props.toast,
          onPatchJob: patchJob,
          onPatchPipeline: patchPipeline,
          onReload: props.onReload,
          recent: props.recent,
          remember: props.remember,
          onClose: closeSheet,
        })
      : null,
    templateOpen ? h(TemplateModal, { pipeline, toast: props.toast, onClose: () => setTemplateOpen(false), onSaved: props.onTemplatesChanged }) : null,
    runOpen ? h(RunModal, { pipeline, toast: props.toast, onClose: () => setRunOpen(false), onStarted: props.onStarted }) : null,
  );
}

function countJobs(pipeline) {
  let n = 0;
  for (const stage of (pipeline || {}).stages || []) n += (stage.jobs || []).length;
  return n;
}

/** 本地判定调度模式，与后端 detectScheduling 语义一致（契约 §2.1）。 */
function detectScheduling(pipeline) {
  for (const stage of (pipeline || {}).stages || []) {
    for (const job of stage.jobs || []) {
      if (job.needs && job.needs.length) return 'dag';
    }
  }
  return 'staged';
}

exports.PipelineEditor = PipelineEditor;
exports.detectScheduling = detectScheduling;
exports.countJobs = countJobs;
});

__def("./page-overview.js", function (module, exports, require) {
/**
 * 概览页：服务器状态卡、最近运行、失败率与平均耗时。
 */
const { h, useEffect, useMemo, useState, fmtAgo, fmtDuration, fmtTime, useTick } = require('./h.js');
const { Card, Chip, StatusDot, Button, Empty, KV, ProgressRing, AsyncBox } = require('./ui.js');
const { api } = require('./api.js');
const { runTone, RUN_STATUS_TEXT } = require('./state.js');

function Overview(props) {
  const state = props.state;
  const [now, setNow] = useState(Date.now());
  const [probeBusy, setProbeBusy] = useState('');
  useTick(true);

  const runs = state.runs || [];
  const servers = state.servers || [];
  const pipelines = state.pipelines || [];

  /** 最近 50 次运行的统计。 */
  const stats = useMemo(() => {
    const finished = runs.filter((r) => r.status === 'success' || r.status === 'failed');
    const failed = finished.filter((r) => r.status === 'failed').length;
    const durations = finished
      .filter((r) => r.startedAt && r.finishedAt)
      .map((r) => r.finishedAt - r.startedAt);
    const avg = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
    return {
      total: runs.length,
      failed,
      rate: finished.length ? Math.round((failed / finished.length) * 100) : 0,
      avg,
      active: runs.filter((r) => r.status === 'running' || r.status === 'queued').length,
    };
  }, [runs]);

  async function probe(server) {
    setProbeBusy(server.id);
    try {
      await api.testServer(server.id);
      props.toast && props.toast.ok('已探测 ' + server.name);
      props.onReload && props.onReload();
    } catch (error) {
      props.toast && props.toast.error('探测失败：' + (error.message || error));
    } finally {
      setProbeBusy('');
    }
  }

  const nowTs = Date.now();

  return h(
    'div',
    null,
    h(
      'div',
      { className: 'dsh-devops-grid', 'data-cols': '3', style: { marginBottom: '12px' } },
      h(Card, { title: '运行概览' },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '14px' } },
          h(ProgressRing, {
            value: stats.total - stats.failed,
            total: stats.total || 1,
            tone: stats.rate > 30 ? 'error' : stats.rate > 0 ? 'busy' : 'ok',
          }),
          h(KV, {
            entries: [
              ['总运行', stats.total],
              ['活跃中', stats.active],
              ['失败率', stats.rate + '%'],
              ['平均耗时', stats.avg ? fmtDuration(stats.avg) : '—'],
            ],
          }),
        ),
      ),
      h(Card, { title: '流水线' },
        h(KV, {
          entries: [
            ['流水线数', pipelines.length],
            ['模板数', (state.templates || []).length],
            ['服务器数', servers.length],
            ['环境变量组', (state.envsets || []).length],
          ],
        }),
        h('div', { style: { marginTop: '8px' } },
          h(Button, { size: 'sm', icon: 'plus', label: '新建流水线', onClick: () => props.onNavigate('pipelines', { create: true }) })),
      ),
      h(Card, { title: '调度健康' },
        h(KV, {
          entries: [
            ['SSE 连接', state.sseStatus === 'open' ? '已连接' : state.sseStatus || '—'],
            ['卡住阈值', ((state.settings && state.settings.stuckSilenceSec) || 60) + 's'],
            ['并发上限', (state.settings && state.settings.maxConcurrentRuns) || 2],
            ['状态栏', state.settings && state.settings.statusBar === false ? '已关闭' : '开启'],
          ],
        }),
      ),
    ),

    h(Card, {
      title: '服务器状态',
      headExtra: h(Button, { size: 'sm', icon: 'refresh', label: '刷新', onClick: props.onReload }),
    },
      servers.length === 0
        ? h(Empty, { text: '还没有服务器，先去「服务器」页添加' })
        : h(
            'div',
            { className: 'dsh-devops-grid', 'data-cols': '2' },
            servers.map((server) => {
              const probeInfo = server.probe || {};
              const online = !!probeInfo.at && !probeInfo.error;
              return h(
                'div',
                { key: server.id, className: 'dsh-devops-card', style: { marginBottom: 0 } },
                h(
                  'div',
                  { className: 'dsh-devops-card-head' },
                  h(StatusDot, { tone: probeInfo.error ? 'error' : online ? 'ok' : 'idle', title: probeInfo.error || (online ? '在线' : '未探测') }),
                  h('span', { className: 'dsh-devops-card-title' }, server.name),
                  h(Chip, null, server.kind === 'local' ? '本机' : 'SSH'),
                  h('div', { className: 'dsh-devops-spacer' }),
                  h(Button, { size: 'sm', icon: 'refresh', label: '测试连接', busy: probeBusy === server.id, onClick: () => probe(server) }),
                ),
                h(KV, {
                  entries: [
                    ['地址', server.kind === 'local' ? '本机' : (server.host || '') + ':' + (server.port || 22)],
                    ['系统', probeInfo.os || '未探测'],
                    ['架构', probeInfo.arch || '—'],
                    ['工作目录', server.workdir || probeInfo.workdir || '—'],
                    ['已装运行时', Object.keys(server.runtimes || {}).join('、') || '—'],
                    ['最后探测', probeInfo.at ? fmtAgo(probeInfo.at, nowTs) : '从未'],
                  ],
                }),
                probeInfo.error ? h('div', { className: 'dsh-devops-field-error', style: { marginTop: '6px' } }, probeInfo.error) : null,
              );
            }),
          ),
    ),

    h(Card, {
      title: '最近运行',
      headExtra: h(Button, { size: 'sm', icon: 'history', label: '查看全部', onClick: () => props.onNavigate('runs') }),
    },
      runs.length === 0
        ? h(Empty, { text: '还没有运行记录' })
        : h(
            'table',
            { className: 'dsh-devops-table' },
            h('thead', null,
              h('tr', null,
                h('th', null, '运行'),
                h('th', null, '流水线'),
                h('th', null, '状态'),
                h('th', null, '耗时'),
                h('th', null, '开始时间'),
                h('th', null, ''),
              )),
            h('tbody', null,
              runs.slice(0, 8).map((run) =>
                h('tr', { key: run.id },
                  h('td', { className: 'dsh-devops-monospace' }, run.id),
                  h('td', null, run.pipelineName || run.pipelineId),
                  h('td', null, h(Chip, { tone: runTone(run.status), dot: true }, RUN_STATUS_TEXT[run.status] || run.status)),
                  h('td', null, run.finishedAt && run.startedAt ? fmtDuration(run.finishedAt - run.startedAt) : run.startedAt ? '进行中' : '—'),
                  h('td', null, fmtAgo(run.startedAt, nowTs)),
                  h('td', null, h(Button, { size: 'sm', variant: 'ghost', label: '详情', onClick: () => props.onOpenRun(run.id) })),
                ),
              )),
          ),
    ),
  );
}

exports.Overview = Overview;
});

__def("./page-pipelines.js", function (module, exports, require) {
/**
 * 流水线页：列表 + 详情 + 编辑器。
 *
 * 本次修复的可用性缺陷：
 *  - 列表里的流水线名过去是纯文本 span，看着像入口却点不动。现在名称是
 *    .dsh-devops-link 可点元素（role=button + 键盘可达），点击进入**详情**。
 *  - 新增详情视图：定义概览、阶段与节点、最近运行，以及「编辑」「运行」入口。
 *    详情里的「编辑」复用 app.js 的 navigate('pipelines', { edit: id }) 机制。
 */
const { h, useState, useEffect, useMemo, clone, fmtAgo, fmtTime, fmtDuration } = require('./h.js');
const { Button, TextInput, Select, Card, Empty, Chip, Banner, Modal, Field, KV } = require('./ui.js');
const { api } = require('./api.js');
const { PipelineEditor, detectScheduling, countJobs } = require('./editor.js');
const { LogPanel } = require('./logs.js');
/**
 * 只读编排视图复用画布的纯展示构件（NodeCard）。
 * canvas.js 归画布任务维护，这里只读引用；require 失败时降级为内置只读卡片，
 * 保证详情页在缺该模块（或测试用桩表未覆盖它）时仍然可用。
 */
let canvasModule = {};
try {
  canvasModule = require('./canvas.js') || {};
} catch (error) {
  canvasModule = {};
}
const { RUN_STATUS_TEXT, runTone } = require('./state.js');

/* ------------------------------------------------------------------ *
 * 视图记忆：离开 DevOps 界面再回来时恢复「视图位置」
 *
 * 背景：面板随侧边栏 slot 卸载，组件内 useState 全部清零，用户重进时
 * 会从列表/概览重新开始。这里把「视图位置」存进 sessionStorage，重进时
 * 按 id **重新取数据**恢复——绝不存整份流水线定义，避免显示过期内容。
 *
 * 键名与 app.js 的 VIEW_KEY 一致：app.js 未导出这套 helper（改它归属 Lead），
 * 且 app.js 已 require 本文件，反向 require 会成环；故此处按同一约定实现，
 * 读写同一份记忆、同一套合并语义。
 * ------------------------------------------------------------------ */
const VIEW_KEY = 'dsh-devops.view';

/** 安全读取视图记忆（隐私模式 / 无 storage / JSON 损坏时一律降级为 null）。 */
function readViewState() {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    const raw = sessionStorage.getItem(VIEW_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** 安全写入视图记忆（合并既有值；存不了不影响功能）。 */
function writeViewState(patch) {
  try {
    if (typeof sessionStorage === 'undefined') return;
    const current = readViewState() || {};
    sessionStorage.setItem(VIEW_KEY, JSON.stringify(Object.assign({}, current, patch)));
  } catch {
    /* 隐私模式等场景存不了，忽略即可 */
  }
}

/** 重置流水线页的视图记忆（回到列表；用户「退出某个状态」的出口）。 */
function resetPipelineView() {
  writeViewState({ pipelinesMode: 'list', pipelinesId: '', editPipelineId: '' });
}

/**
 * 解析流水线页要恢复的视图位置（纯函数，便于断言）。
 * 只认轻量标记：mode 仅 list|edit|detail，id 必须是非空字符串；
 * 任何非法/缺失组合一律降级为列表，绝不抛出。
 */
function resolvePipelineView(remembered) {
  const view = remembered && typeof remembered === 'object' ? remembered : null;
  if (!view) return { mode: 'list', id: '' };
  const mode = view.pipelinesMode === 'edit' || view.pipelinesMode === 'detail' ? view.pipelinesMode : 'list';
  const primary = typeof view.pipelinesId === 'string' && view.pipelinesId ? view.pipelinesId : '';
  const fallback = mode === 'edit' && typeof view.editPipelineId === 'string' ? view.editPipelineId : '';
  const id = primary || fallback || '';
  // mode 与 id 必须成对有效：mode 已降级为 list 时 id 一并清空，
  // 否则调用方可能拿一个陈旧 id 去做别的事。
  if (mode === 'list' || !id) return { mode: 'list', id: '' };
  return { mode, id };
}

/**
 * 按视图位置重新取数据（只按 id 现取，不读记忆里可能过期的数据）。
 * 返回 { ok:true, pipeline } 或 { ok:false, missing:true, message }，**绝不抛错**——
 * 目标已被删除时必须能优雅降级回列表，而不是白屏。
 */
async function loadPipelineForView(view, getPipeline) {
  const id = view && view.id;
  if (!id || typeof getPipeline !== 'function') return { ok: false, missing: true, message: '' };
  try {
    const pipeline = await getPipeline(id);
    if (!pipeline || !pipeline.id) return { ok: false, missing: true, message: '流水线不存在：' + id };
    return { ok: true, pipeline };
  } catch (error) {
    return { ok: false, missing: true, message: (error && error.message) || String(error) };
  }
}

/** 解析流水线列表的筛选状态（只认标量，非法值降级为空）。 */
function resolveListFilters(remembered) {
  const view = remembered && typeof remembered === 'object' ? remembered : null;
  return {
    keyword: view && typeof view.listKeyword === 'string' ? view.listKeyword : '',
    category: view && typeof view.listCategory === 'string' ? view.listCategory : '',
  };
}

/** 新建流水线时用的骨架，字段与契约 §2.1 对齐。 */
function blankPipeline() {
  return {
    id: 'pipeline-' + Math.random().toString(36).slice(2, 8),
    name: '未命名流水线',
    description: '',
    category: '',
    tags: [],
    favorite: false,
    owner: null,
    version: 1,
    variables: [],
    envSetRefs: [],
    defaults: { server: 'local', timeoutMs: 600000 },
    stages: [{ id: 'stage-' + Math.random().toString(36).slice(2, 6), name: '构建', parallel: false, jobs: [] }],
    createdAt: 0,
    updatedAt: 0,
  };
}

/** 该流水线是否有活跃运行（列表里给「运行中」提示用）。 */
function activeRunOf(runs, pipelineId) {
  return (runs || []).find(
    (r) => r && r.pipelineId === pipelineId && (r.status === 'running' || r.status === 'queued'),
  );
}

/**
 * 名称单元格：可点进详情，并在有活跃运行时补一个「运行中」徽标。
 *
 * 状态表达（task-8）：左侧状态点与失败计数都用 data-tone 驱动，
 * 组件里不写死任何色值 —— 颜色由 styles.js 的 .dsh-devops-dot[data-tone] 决定。
 */
function PipelineNameCell(props) {
  const pipeline = props.pipeline;
  const name = pipeline.name || '（未命名）';
  const active = props.activeRun;
  const recent = props.recentRun || null;
  const failedCount = props.failedCount || 0;
  const tone = active ? 'busy' : recent ? runTone(recent.status) : 'idle';
  const toneText = active
    ? RUN_STATUS_TEXT.running
    : recent
      ? RUN_STATUS_TEXT[recent.status] || recent.status
      : '还没有运行';
  return h(
    'span',
    { style: { display: 'inline-flex', alignItems: 'center', gap: '6px' } },
    h('span', {
      className: 'dsh-devops-dot',
      'data-tone': tone,
      'data-role': 'pipeline-status-dot',
      title: '最近状态：' + toneText,
    }),
    h(
      'span',
      {
        className: 'dsh-devops-link',
        style: { fontWeight: 500 },
        role: 'button',
        tabIndex: 0,
        title: '查看「' + name + '」的详情与运行情况',
        onClick: () => props.onOpen(pipeline.id),
        onKeyDown: (event) => {
          if (event && (event.key === 'Enter' || event.key === ' ')) {
            if (event.preventDefault) event.preventDefault();
            props.onOpen(pipeline.id);
          }
        },
      },
      name,
    ),
    active
      ? h(Chip, { tone: 'busy', dot: true, title: '该流水线正在运行：' + active.id }, '运行中')
      : null,
    failedCount > 0
      ? h(
          Chip,
          { tone: 'error', dot: true, title: '最近运行中有 ' + failedCount + ' 次失败' },
          failedCount + ' 次失败',
        )
      : null,
  );
}

/**
 * 按流水线汇总「最近一次运行」与「失败计数」，供列表用状态色表达。
 * 纯函数，缺 runs 时返回空表 —— 列表在没有运行数据时仍然是中性的。
 */
function runSummaryByPipeline(runs) {
  const out = {};
  for (const r of runs || []) {
    if (!r || !r.pipelineId) continue;
    const entry = out[r.pipelineId] || (out[r.pipelineId] = { latest: null, failed: 0 });
    if (!entry.latest || (r.startedAt || 0) > (entry.latest.startedAt || 0)) entry.latest = r;
    if (r.status === 'failed') entry.failed += 1;
  }
  return out;
}

function PipelineList(props) {
  const pipelines = props.pipelines || [];
  // 筛选条件也属于「视图位置」：离开再回来时保留搜索词与分类。
  const filters = resolveListFilters(props.remembered !== undefined ? props.remembered : readViewState());
  const [keyword, setKeyword] = useState(filters.keyword);
  const [category, setCategory] = useState(filters.category);
  const summaries = useMemo(() => runSummaryByPipeline(props.runs), [props.runs]);

  /**
   * 筛选条件变化即写入记忆（只存标量，不存列表数据）。
   *
   * 只写「本次变化的那一项」，由 writeViewState 与已存值合并；
   * 不可用 filters（派生自 props.remembered 的挂载快照）当基线，
   * 否则改分类会把刚输入的关键字覆盖回空值。
   */
  function patchFilter(patch) {
    const next = {};
    if (patch.keyword !== undefined) next.listKeyword = patch.keyword || '';
    if (patch.category !== undefined) next.listCategory = patch.category || '';
    writeViewState(next);
    if (patch.keyword !== undefined) setKeyword(patch.keyword);
    if (patch.category !== undefined) setCategory(patch.category);
  }

  const categories = useMemo(() => {
    const set = new Set();
    for (const p of pipelines) if (p.category) set.add(p.category);
    return Array.from(set);
  }, [pipelines]);

  const filtered = pipelines.filter((p) => {
    if (category && p.category !== category) return false;
    if (!keyword) return true;
    const hay = (p.name || '') + ' ' + (p.id || '') + ' ' + (p.description || '') + ' ' + (p.tags || []).join(' ');
    return hay.toLowerCase().includes(keyword.toLowerCase());
  });

  return h(
    'div',
    null,
    h(
      'div',
      { style: { display: 'flex', gap: '8px', marginBottom: '12px', alignItems: 'center' } },
      h('div', { style: { width: '220px' } }, h(TextInput, { value: keyword, placeholder: '搜索名称/描述/标签', onChange: (v) => patchFilter({ keyword: v }) })),
      h('div', { style: { width: '150px' } },
        h(Select, {
          value: category,
          placeholder: '全部分类',
          options: categories,
          onChange: (v) => patchFilter({ category: v }),
        })),
      h('div', { className: 'dsh-devops-spacer' }),
      h(Button, { size: 'sm', icon: 'plus', label: '新建流水线', variant: 'primary', onClick: props.onCreate }),
    ),
    filtered.length === 0
      ? h(Empty, { text: pipelines.length === 0 ? '还没有流水线，点右上角新建' : '没有匹配的流水线' })
      : h(
          'table',
          { className: 'dsh-devops-table' },
          h('thead', null,
            h('tr', null,
              h('th', null, '名称'),
              h('th', null, '标识'),
              h('th', null, '阶段'),
              h('th', null, '调度'),
              h('th', null, '分类'),
              h('th', null, '标签'),
              h('th', null, '更新时间'),
              h('th', null, '操作'),
            )),
          h('tbody', null,
            filtered.map((p) =>
              h('tr', { key: p.id },
                h('td', null, h(PipelineNameCell, {
                  pipeline: p,
                  activeRun: (props.activeRunsByPipeline || {})[p.id],
                  recentRun: (summaries[p.id] || {}).latest || null,
                  failedCount: (summaries[p.id] || {}).failed || 0,
                  onOpen: props.onOpen,
                })),
                h('td', { className: 'dsh-devops-monospace' }, p.id),
                h('td', null, (p.stages || []).length + ' / ' + countJobs(p)),
                h('td', null, h(Chip, { tone: detectScheduling(p) === 'dag' ? 'busy' : 'idle' }, detectScheduling(p) === 'dag' ? 'DAG' : '阶段')),
                h('td', null, p.category || '—'),
                h('td', null, (p.tags || []).map((t) => h('span', { key: t, className: 'dsh-devops-tag', style: { marginRight: '3px' } }, t))),
                h('td', null, fmtAgo(p.updatedAt)),
                h('td', null,
                  h('span', { style: { display: 'flex', gap: '4px' } },
                    h(Button, { size: 'sm', label: '详情', onClick: () => props.onOpen(p.id) }),
                    h(Button, { size: 'sm', label: '编辑', onClick: () => props.onEdit(p.id) }),
                    h(Button, { size: 'sm', icon: 'play', label: '运行', onClick: () => props.onRun(p) }),
                    h(Button, { size: 'sm', variant: 'danger', icon: 'trash', label: '删除', onClick: () => props.onDelete(p) }))),
              ),
            )),
        ),
  );
}

/* ------------------------------------------------------------------ *
 * 只读编排视图：与编辑器同构（阶段成列、节点为块状卡片），但不可编辑。
 * 节点卡片复用 src/client/canvas.js 导出的纯展示构件 NodeCard（画布任务维护），
 * require 不可用时降级为内置只读卡片，保证详情页在缺模块时仍可用。
 * ------------------------------------------------------------------ */

/** 兜底只读卡片：字段与 canvas.js 的 NodeCard 视觉契约一致（类名 + data-role）。 */
function DisplayNodeCard(props) {
  const job = props.job || {};
  const seconds = job.timeoutMs ? Math.round(job.timeoutMs / 1000) : 0;
  return h(
    'div',
    {
      className: 'dsh-devops-nodecard',
      'data-role': 'node-card',
      'data-readonly': 'true',
      'data-selected': props.selected ? 'true' : undefined,
      // 状态色：由父层给定，颜色交给 CSS 的 [data-status]/[data-tone]
      'data-status': props.status || 'pending',
      'data-tone': toneOfStatus(props.status || 'pending'),
      onClick: (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        if (props.onSelect) props.onSelect(job.id);
      },
    },
    h(
      'div',
      { className: 'dsh-devops-nodecard-head' },
      props.index ? h('span', { className: 'dsh-devops-nodecard-index' }, String(props.index)) : null,
      h('span', { className: 'dsh-devops-nodecard-title dsh-devops-truncate' }, job.name || job.id),
      job.allowFailure ? h('span', { className: 'dsh-devops-nodecard-flag', title: '允许失败，失败不阻断后续' }, '容错') : null,
    ),
    h('div', { className: 'dsh-devops-nodecard-type dsh-devops-monospace dsh-devops-truncate', title: job.node }, job.node),
    h(
      'div',
      { className: 'dsh-devops-nodecard-meta' },
      h('span', { className: 'dsh-devops-nodecard-key' }, '执行条件'),
      h('span', { className: 'dsh-devops-truncate' }, whenLabel(job.when)),
      h('span', { className: 'dsh-devops-nodecard-key' }, '服务器'),
      h('span', { className: 'dsh-devops-truncate' }, job.server || '（默认）'),
      seconds ? h('span', { className: 'dsh-devops-nodecard-key' }, '超时') : null,
      seconds ? h('span', null, seconds + 's') : null,
    ),
    (job.needs || []).length
      ? h(
          'div',
          { className: 'dsh-devops-nodecard-needs' },
          h('span', { className: 'dsh-devops-nodecard-key' }, 'needs'),
          (job.needs || []).map((need) => h('span', { key: need, className: 'dsh-devops-nodecard-need' }, need)),
        )
      : null,
    (job.artifacts || []).length ? h('div', { className: 'dsh-devops-nodecard-foot' }, (job.artifacts || []).length + ' 项产物') : null,
  );
}

/**
 * NodeCard 的取用策略：
 * canvas.js 目前的 NodeCard 带编辑期拖拽行为（draggable + onDragStart），不是纯展示构件。
 * 因此只在它显式声明了只读支持（NodeCard.supportsReadonly === true）时复用它；
 * 否则用字段/类名完全一致的 DisplayNodeCard，保证详情页**当下就是只读**。
 * canvas 负责人加上该标志后，这里会自动切换为复用，无需再改本文件。
 */
const NodeCard =
  typeof canvasModule.NodeCard === 'function' && canvasModule.NodeCard.supportsReadonly === true
    ? canvasModule.NodeCard
    : DisplayNodeCard;

/** 执行条件的中文文案（与画布一致）。 */
function whenLabel(when) {
  if (when === 'manual') return '手动触发';
  if (when === 'always') return '总是执行';
  return '上游成功后';
}

/** 原始字段值的展示文本（对象/数组走 JSON，长脚本保留换行）。 */
function rawValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch (error) {
    return String(value);
  }
}

/**
 * 找「该节点最近一次运行」：按开始时间倒序，取第一个确实包含该 step 的运行。
 * 运行摘要里没有 steps 明细时（列表接口不带）降级为最近一次运行，避免永远显示「没有运行记录」。
 */
function latestRunForStep(runs, pipelineId, stepId) {
  const mine = (runs || [])
    .filter((run) => run && run.pipelineId === pipelineId)
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  let fallback = null;
  for (const run of mine) {
    const steps = run.steps;
    if (steps && typeof steps === 'object') {
      if (Object.prototype.hasOwnProperty.call(steps, stepId)) return run;
      continue;
    }
    if (!fallback) fallback = run;
  }
  return fallback;
}

/** 状态 → 语义色调（与 state.js 的 run/step tone 口径一致，供 data-tone 使用）。 */
function toneOfStatus(status) {
  if (status === 'success') return 'ok';
  if (status === 'failed') return 'error';
  if (status === 'running') return 'busy';
  if (status === 'canceled') return 'warn';
  return 'idle';
}

/**
 * 一组运行里，某节点的**最近一次执行状态**（jobId → status）。
 * 运行没有 step 明细时返回 null，卡片保持中性 —— 不猜状态。
 */
function stepStatusMap(runs, pipelineId) {
  const mine = (runs || [])
    .filter((run) => run && run.pipelineId === pipelineId)
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  const out = {};
  for (const run of mine) {
    const steps = run.steps;
    if (!steps || typeof steps !== 'object') continue;
    for (const stepId of Object.keys(steps)) {
      if (!Object.prototype.hasOwnProperty.call(out, stepId)) {
        out[stepId] = (steps[stepId] && steps[stepId].status) || null;
      }
    }
  }
  return out;
}

/**
 * 只读编排画布：阶段成列、节点为块状卡片，与编辑器同构。
 * 与编辑器的差别全部集中在「没有任何结构变更入口」：无增删阶段、无拖拽投放、无列头工具。
 */
function ReadonlyBoard(props) {
  const pipeline = props.pipeline || {};
  const stages = pipeline.stages || [];
  /**
   * 节点/阶段状态由父层以纯函数给出（jobId → run status），
   * 这里只负责把状态挂成 data-status / data-tone，颜色一律交给 CSS。
   */
  const statusOf = props.stepStatusOf || (() => null);
  /** 阶段状态：任一节点失败 → failed；有运行中 → running；全部成功 → success；否则 pending。 */
  function stageStatus(stage) {
    const list = (stage.jobs || []).map((job) => statusOf(job.id)).filter(Boolean);
    if (list.length === 0) return 'pending';
    if (list.indexOf('failed') >= 0) return 'failed';
    if (list.indexOf('running') >= 0) return 'running';
    if (list.indexOf('queued') >= 0) return 'queued';
    if (list.every((s) => s === 'success' || s === 'skipped')) return 'success';
    return 'pending';
  }
  if (stages.length === 0) {
    return h(
      'div',
      { className: 'dsh-devops-board dsh-devops-readonly', 'data-role': 'readonly-board', 'data-readonly': 'true' },
      h('div', { className: 'dsh-devops-empty dsh-devops-board-empty' }, '这条流水线还没有阶段'),
    );
  }
  return h(
    'div',
    { className: 'dsh-devops-board dsh-devops-readonly', 'data-role': 'readonly-board', 'data-readonly': 'true' },
    stages.map((stage, stageIndex) =>
      h(
        'div',
        {
          key: stage.id || stageIndex,
          className: 'dsh-devops-column',
          'data-role': 'readonly-column',
          'data-stage-id': stage.id,
          'data-parallel': stage.parallel ? 'true' : undefined,
          // 阶段整体状态：列头据此着色
          'data-status': stageStatus(stage),
          'data-tone': toneOfStatus(stageStatus(stage)),
        },
        h(
          'div',
          { className: 'dsh-devops-column-head' },
          h('span', { className: 'dsh-devops-column-index' }, String(stageIndex + 1)),
          h('span', { className: 'dsh-devops-column-title dsh-devops-truncate' }, stage.name || stage.id),
          stage.parallel ? h(Chip, { tone: 'busy', title: '阶段内节点并行执行' }, '并行') : null,
          h('span', { className: 'dsh-devops-hint' }, (stage.jobs || []).length + ' 节点'),
        ),
        h(
          'div',
          { className: 'dsh-devops-column-cards', 'data-role': 'readonly-cards' },
          (stage.jobs || []).map((job, jobIndexInStage) =>
            h(
              'div',
              {
                key: job.id,
                className: 'dsh-devops-slot',
                'data-role': 'readonly-slot',
                'data-job': job.id,
                'data-readonly': 'true',
                'data-status': statusOf(job.id) || 'pending',
                'data-tone': toneOfStatus(statusOf(job.id) || 'pending'),
                role: 'button',
                tabIndex: 0,
                title: '查看节点「' + (job.name || job.id) + '」的信息与日志',
                onClick: () => props.onSelectJob && props.onSelectJob(job.id),
                onKeyDown: (event) => {
                  if (event && (event.key === 'Enter' || event.key === ' ')) {
                    if (event.preventDefault) event.preventDefault();
                    if (props.onSelectJob) props.onSelectJob(job.id);
                  }
                },
                // 只读：卡片自带 draggable，这里在容器上取消拖拽默认行为（画布任务可选加 readonly 支持）
                onDragStart: (event) => {
                  if (event && event.preventDefault) event.preventDefault();
                },
                onDragOver: (event) => {
                  if (event && event.preventDefault) event.preventDefault();
                },
                onDrop: (event) => {
                  if (event && event.preventDefault) event.preventDefault();
                },
              },
              h(NodeCard, {
                job,
                stageId: stage.id,
                index: jobIndexInStage + 1,
                readonly: true,
                status: statusOf(job.id) || 'pending',
                selected: props.selectedJob === job.id,
                onSelect: props.onSelectJob,
              }),
            ),
          ),
          (stage.jobs || []).length === 0 ? h('div', { className: 'dsh-devops-column-empty' }, '该阶段还没有节点') : null,
        ),
      ),
    ),
  );
}

/** 抽屉页签定义（内部切换界面）。 */
const DETAIL_TABS = [
  { id: 'info', label: '节点信息' },
  { id: 'log', label: '日志' },
];

/** 节点信息页：节点类型 / 字段原始值 / 服务器 / 执行条件 / 超时 / needs / 产物 等。 */
function NodeInfoPanel(props) {
  const job = props.job || {};
  const descriptor = props.descriptor || null;
  const withValues = job.with || {};
  const fieldLabel = (name) => {
    const fields = (descriptor && descriptor.fields) || [];
    const found = fields.find((f) => f && f.name === name);
    return found && found.label ? found.label : name;
  };
  const retry = job.retry || {};

  /**
   * 信息分「执行 / 依赖与产物 / 环境」三组，每组是一张卡片，
   * 而不是过去那样一整片扁平 KV —— 用户要的「分层」在这里落地。
   */
  const groups = [
    {
      id: 'exec',
      title: '执行',
      entries: [
        ['节点 id', h('span', { className: 'dsh-devops-monospace' }, job.id || '—')],
        ['名称', job.name || '—'],
        ['节点类型', h('span', { className: 'dsh-devops-monospace' }, job.node || '—')],
        ['所属阶段', props.stageName || '—'],
        ['执行条件', whenLabel(job.when)],
        ['服务器', job.server || props.defaultServer || '（默认）'],
        ['超时', job.timeoutMs ? Math.round(job.timeoutMs / 1000) + ' 秒（' + job.timeoutMs + ' ms）' : '—'],
        ['允许失败', job.allowFailure ? '是' : '否'],
        ['重试', retry.max ? '最多 ' + retry.max + ' 次，间隔 ' + (retry.delayMs || 0) + ' ms' : '不重试'],
      ],
    },
    {
      id: 'deps',
      title: '依赖与产物',
      entries: [
        ['needs', (job.needs || []).length ? (job.needs || []).join('、') : '无'],
        ['产物', (job.artifacts || []).length ? (job.artifacts || []).join('、') : '无'],
        ['缓存', job.cache && job.cache.key ? job.cache.key : '未配置'],
      ],
    },
    {
      id: 'env',
      title: '环境与准备',
      entries: [
        ['环境变量', (job.env || []).length ? (job.env || []).map((e) => e.name).join('、') : '无'],
        ['变量组引用', (job.envSetRefs || []).length ? (job.envSetRefs || []).join('、') : '无'],
        ['允许自动准备', job.allowProvision ? '是' : '否'],
      ],
    },
  ];

  const paramKeys = Object.keys(withValues);
  return h(
    'div',
    { className: 'dsh-devops-drawer-panel', 'data-role': 'drawer-panel-info' },
    descriptor && descriptor.description ? h('div', { className: 'dsh-devops-hint' }, descriptor.description) : null,
    groups.map((group) =>
      h(
        'div',
        { key: group.id, className: 'dsh-devops-card', 'data-role': 'drawer-info-group', 'data-group': group.id },
        h('div', { className: 'dsh-devops-card-head' },
          h('span', { className: 'dsh-devops-card-title' }, group.title)),
        h(KV, { entries: group.entries }),
      ),
    ),
    h('h3', { className: 'dsh-devops-card-title', style: { marginTop: '12px' } }, '节点参数（原始值）'),
    paramKeys.length === 0
      ? h('div', { className: 'dsh-devops-hint' }, '该节点没有参数')
      : paramKeys.map((key) =>
          h(
            'div',
            { key, className: 'dsh-devops-field-row' },
            h(
              'div',
              { className: 'dsh-devops-field-head' },
              h('span', { className: 'dsh-devops-field-label' }, fieldLabel(key)),
              h('span', { className: 'dsh-devops-hint' }, key),
            ),
            // 原始值：等宽深色小面板（与终端观感呼应），颜色/底色由 CSS 决定
            h('div', {
              className: 'dsh-devops-drawer-raw dsh-devops-monospace',
              'data-tone': 'code',
            }, rawValue(withValues[key])),
          ),
        ),
  );
}

/**
 * 日志页：复用既有的 LogPanel（实时流 / 过滤 / 下载 / 内存环提示），
 * 只负责「取该节点最近一次运行」这一件事；没有运行记录时给明确文案而不是空白。
 */
function NodeLogPanel(props) {
  const job = props.job || null;
  const run = props.run || null;
  const runId = run ? run.id : '';
  const stepId = job ? job.id : '';
  const live = !!(run && (run.status === 'running' || run.status === 'queued'));

  return h(
    'div',
    { className: 'dsh-devops-drawer-panel', 'data-role': 'drawer-panel-log' },
    h(
      'div',
      { className: 'dsh-devops-hint', style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' } },
      h('span', null, '来自最近一次运行 '),
      h('span', { className: 'dsh-devops-monospace' }, runId),
      run && run.status
        ? h(Chip, { tone: runTone(run.status) }, RUN_STATUS_TEXT[run.status] || run.status)
        : null,
    ),
    runId
      ? h(LogPanel, { runId, stepId, live })
      : h('div', { className: 'dsh-devops-hint', 'data-role': 'drawer-log-empty' }, '该节点还没有运行记录'),
  );
}

/**
 * 节点详情抽屉：**圆角悬浮卡片**，从右侧滑入并浮在内容上方。
 *
 * 形态契约（task-8，视觉由 styles.js 按属性落地，组件里不写死颜色/圆角）：
 *  - .dsh-devops-drawer-layer[data-shape="floating"]：四周留白的浮层容器（不再贴右边缘）；
 *  - .dsh-devops-drawer[data-variant="floating"]：圆角 + 阴影 + 细边框 + max-height 受视口约束；
 *  - .dsh-devops-drawer-mask[data-blur="true"]：半透明 + 轻微模糊遮罩。
 * 既有的 data-role / data-open / data-tab 契约与三种关闭方式（遮罩 / 关闭按钮 / Esc）保持不变。
 */
function DetailDrawer(props) {
  const job = props.job || null;
  const open = !!job;
  const [tab, setTab] = useState('info');
  const jobId = job ? job.id : '';

  // 抽屉打开时支持 Esc 关闭（Node 环境下没有 document，跳过）
  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    const onKey = (event) => {
      if (event && event.key === 'Escape' && props.onClose) props.onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      if (document && document.removeEventListener) document.removeEventListener('keydown', onKey);
    };
  }, [open, props.onClose]);

  // 换节点时回到「节点信息」，避免看到上一个节点的日志
  useEffect(() => {
    if (open) setTab('info');
  }, [jobId, open]);

  const infoActive = tab === 'info';
  return h(
    'div',
    {
      className: 'dsh-devops-drawer-layer',
      'data-role': 'detail-drawer',
      // 悬浮形态：脱离右边缘的浮层，而不是贴合边缘的全高面板
      'data-shape': 'floating',
      'data-open': open ? 'true' : 'false',
      'data-tab': tab,
      // 状态语义：整层可被 CSS 按运行状态着色（无运行记录时为 idle）
      'data-status': props.run && props.run.status ? props.run.status : 'idle',
      'data-tone': props.run && props.run.status ? runTone(props.run.status) : 'idle',
      'aria-hidden': open ? 'false' : 'true',
    },
    h('div', {
      className: 'dsh-devops-drawer-mask',
      'data-role': 'drawer-mask',
      // 半透明 + 轻微模糊
      'data-blur': 'true',
      onClick: () => props.onClose && props.onClose(),
    }),
    h(
      'aside',
      {
        className: 'dsh-devops-drawer',
        'data-role': 'drawer-panel',
        // 圆角悬浮卡片：圆角/阴影/边框/视口内最大高度由 CSS 按该属性落地
        'data-variant': 'floating',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': '节点详情',
      },
      h(
        'div',
        { className: 'dsh-devops-drawer-head' },
        h('span', { className: 'dsh-devops-drawer-title dsh-devops-truncate' }, job ? job.name || job.id : ''),
        job ? h('span', { className: 'dsh-devops-tag dsh-devops-monospace' }, job.node) : null,
        // 这次运行的执行状态：颜色承担语义（成功/失败/运行中/取消），无记录时不显示
        props.run && props.run.status
          ? h(
              Chip,
              { tone: runTone(props.run.status), dot: true, title: '最近一次运行的状态' },
              RUN_STATUS_TEXT[props.run.status] || props.run.status,
            )
          : null,
        h('div', { className: 'dsh-devops-spacer' }),
        h(Button, { variant: 'ghost', size: 'sm', icon: 'close', label: '关闭', title: '关闭抽屉（Esc）', onClick: () => props.onClose && props.onClose() }),
      ),
      h(
        'div',
        { className: 'dsh-devops-tabs', role: 'tablist', 'data-role': 'drawer-tabs' },
        DETAIL_TABS.map((item) =>
          h(
            'button',
            {
              key: item.id,
              type: 'button',
              role: 'tab',
              className: 'dsh-devops-tab',
              'data-role': 'drawer-tab',
              'data-tab': item.id,
              'data-active': tab === item.id ? 'true' : undefined,
              'aria-selected': tab === item.id ? 'true' : 'false',
              onClick: () => setTab(item.id),
            },
            item.label,
          ),
        ),
      ),
      h(
        'div',
        { className: 'dsh-devops-drawer-body' },
        h('div', { 'data-role': 'drawer-view', 'data-view': 'info', hidden: !infoActive },
          infoActive
            ? h(NodeInfoPanel, { job, stageName: props.stageName, descriptor: props.descriptor, defaultServer: props.defaultServer })
            : null),
        h('div', { 'data-role': 'drawer-view', 'data-view': 'log', hidden: infoActive },
          infoActive ? null : h(NodeLogPanel, { job, run: props.run })),
      ),
    ),
  );
}

/**
 * 流水线详情：与编辑器同构的**只读**编排视图 + 右侧伸缩抽屉 + 最近运行。
 *
 * 只读边界：不能拖拽、不能改名、不能增删阶段/节点、不能改字段；
 * 点击节点只在右侧弹出抽屉（不跳页），抽屉内可切换「节点信息 / 日志」。
 */
function PipelineDetail(props) {
  const pipeline = props.pipeline || {};
  const runs = props.runs || [];
  const nodes = props.nodes || [];
  const mine = runs
    .filter((run) => run && run.pipelineId === pipeline.id)
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  const active = mine.filter((run) => run.status === 'running' || run.status === 'queued');
  const stages = pipeline.stages || [];
  const scheduling = detectScheduling(pipeline);
  const now = Date.now();

  const [selectedJob, setSelectedJob] = useState(null);
  /**
   * 本页自管滚动（task-11）：详情页内部有画布/检查器滚动区，外层不该跟着滚。
   * 必须放在**提前 return 之前**，否则首次渲染少执行一个 hook → React #310。
   */
  useEffect(() => {
    if (typeof props.onBodyFlush !== 'function') return undefined;
    props.onBodyFlush(true);
    return () => props.onBodyFlush(false);
  }, [props.onBodyFlush]);
  const allJobs = useMemo(() => {
    const out = [];
    for (const stage of stages) {
      for (const job of stage.jobs || []) out.push({ job, stage });
    }
    return out;
  }, [pipeline]);
  // 节点/阶段状态：来自该流水线最近各次运行里该步骤的状态，用于 data-status 着色
  const stepStatus = useMemo(() => stepStatusMap(runs, pipeline.id), [runs, pipeline.id]);
  const statusOfStep = (jobId) => stepStatus[jobId] || null;
  const current = allJobs.find((entry) => entry.job.id === selectedJob) || null;
  const currentRun = current ? latestRunForStep(runs, pipeline.id, current.job.id) : null;
  const descriptor = current ? nodes.find((node) => node && node.type === current.job.node) || null : null;

  return h(
    'div',
    { className: 'dsh-devops-detail', 'data-role': 'pipeline-detail' },
    h(
      'div',
      { className: 'dsh-devops-head' },
      h(Button, { size: 'sm', icon: 'chevron', label: '← 流水线列表', onClick: props.onBack }),
      h('h2', { className: 'dsh-devops-title' }, pipeline.name || pipeline.id),
      h(Chip, { tone: scheduling === 'dag' ? 'busy' : 'idle' }, scheduling === 'dag' ? 'DAG 调度' : '阶段调度'),
      active.length ? h(Chip, { tone: 'busy', dot: true }, active.length + ' 个运行中') : null,
      h('div', { className: 'dsh-devops-spacer' }),
      h(Button, { size: 'sm', icon: 'refresh', label: '刷新', onClick: props.onReload }),
      h(Button, { size: 'sm', icon: 'play', label: '运行', variant: 'primary', onClick: () => props.onRun(pipeline) }),
      h(Button, { size: 'sm', label: '编辑', onClick: () => props.onEdit(pipeline.id) }),
    ),

    h(
      'div',
      { className: 'dsh-devops-editor dsh-devops-detail-editor' },
      h(
        'div',
        { className: 'dsh-devops-palette', 'data-role': 'detail-overview' },
        h(
          'div',
          { className: 'dsh-devops-palette-scroll' },
          h('h3', { className: 'dsh-devops-card-title' }, '定义概览'),
          h(KV, {
            entries: [
              ['标识', h('span', { className: 'dsh-devops-monospace' }, pipeline.id || '—')],
              ['描述', pipeline.description || '—'],
              ['分类', pipeline.category || '—'],
              ['标签', (pipeline.tags || []).length ? (pipeline.tags || []).join('、') : '—'],
              ['阶段 / 节点', stages.length + ' 阶段 / ' + countJobs(pipeline) + ' 节点'],
              ['调度模式', scheduling === 'dag' ? 'DAG（按 needs 依赖）' : '阶段串行（阶段内可并行）'],
              ['变量', (pipeline.variables || []).length ? (pipeline.variables || []).map((v) => v.name).join('、') : '无'],
              ['默认服务器', (pipeline.defaults && pipeline.defaults.server) || 'local'],
              ['更新时间', fmtTime(pipeline.updatedAt)],
            ],
          }),
        ),
      ),

      h(
        'div',
        // minHeight:0 必须保留：flex 子项默认 min-height:auto 会拒绝收缩，
        // 画布被内容撑高后自身滚动失效（用户报「滚哪都是整页动」）。
        { style: { flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 } },
        h(
          'div',
          { className: 'dsh-devops-statusbar-inline', 'data-role': 'detail-board-bar' },
          h('span', null, '阶段与节点：与编辑器同构的只读编排视图；点节点在右侧查看信息与日志'),
          h('div', { className: 'dsh-devops-spacer' }),
          h(Chip, null, stages.length + ' 阶段'),
          h(Chip, null, countJobs(pipeline) + ' 节点'),
        ),
        h(ReadonlyBoard, {
          pipeline,
          selectedJob,
          stepStatusOf: statusOfStep,
          onSelectJob: setSelectedJob,
        }),
      ),

      h(
        'div',
        { className: 'dsh-devops-inspector', 'data-role': 'detail-runs' },
        h(
          'div',
          { className: 'dsh-devops-inspector-scroll' },
          h('h3', { className: 'dsh-devops-card-title', style: { marginBottom: '8px' } }, '最近运行'),
          mine.length === 0
            ? h(Empty, { text: '这条流水线还没有运行记录，点右上角「运行」试试' })
            : h(
                'table',
                { className: 'dsh-devops-table' },
                h('thead', null,
                  h('tr', null,
                    h('th', null, '运行 id'),
                    h('th', null, '状态'),
                    h('th', null, '开始'),
                    h('th', null, '耗时'),
                    h('th', null, ''),
                  )),
                h('tbody', null,
                  mine.slice(0, 10).map((run) =>
                    h('tr', { key: run.id },
                      h('td', { className: 'dsh-devops-monospace' }, run.id),
                      h('td', null, h(Chip, { tone: runTone(run.status), dot: true }, RUN_STATUS_TEXT[run.status] || run.status)),
                      h('td', null, fmtAgo(run.startedAt, now)),
                      h('td', null, run.startedAt ? fmtDuration((run.finishedAt || now) - run.startedAt) : '—'),
                      h('td', null, h(Button, { size: 'sm', label: '查看运行', onClick: () => props.onOpenRun(run.id) })),
                    ),
                  )),
              ),
        ),
      ),
    ),

    h(DetailDrawer, {
      job: current ? current.job : null,
      stageName: current ? current.stage.name || current.stage.id : '',
      descriptor,
      run: currentRun,
      defaultServer: (pipeline.defaults && pipeline.defaults.server) || 'local',
      onClose: () => setSelectedJob(null),
    }),
  );
}

function Pipelines(props) {
  const [mode, setMode] = useState('list');
  const [draft, setDraft] = useState(null);
  const [detailId, setDetailId] = useState('');
  const [detailData, setDetailData] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  // 只有明确要求「新建」时才自动弹创建框。
  // （旧版写成 !!initialAction：从模板页创建完跳过来会无故弹出「新建流水线」模态框。）
  const [createOpen, setCreateOpen] = useState(!!(props.initialAction && props.initialAction.create));
  const [runTarget, setRunTarget] = useState(null);
  /**
   * 视图恢复是否已完成。
   * 用 state 而不是 ref：桩 hooks 下 useRef 每次返回新对象，无法用来防重入；
   * state 在真实 React 与桩环境下都能稳定表达「恢复只做一次」。
   */
  const [restored, setRestored] = useState(false);

  // 列表侧数据缺失时拉一次，保证直接进入编辑器也有内容
  useEffect(() => {
    if (props.state.pipelines.length === 0) props.onReload();
  }, []);

  /**
   * 编辑器路径自管滚动（task-11 协同）。
   * 只在 `Pipelines` 这一处声明（详情页在 PipelineDetail 内声明），
   * 避免两处同时 true/false 互相覆盖；editor.js 内部不再重复声明。
   */
  useEffect(() => {
    if (typeof props.onBodyFlush !== 'function') return undefined;
    if (mode !== 'edit') return undefined;
    props.onBodyFlush(true);
    return () => props.onBodyFlush(false);
  }, [props.onBodyFlush, mode]);

  /**
   * 恢复上次离开时的视图位置（mode + id）。
   *
   * 只读记忆里的**轻量标记**，再按 id 现取一份最新数据 —— 恢复的是「位置」，
   * 不是「陈旧内容」。以下情况一律降级回列表：没有记忆、记忆非法、目标已被删除、
   * 取数报错。显式跳转（initialAction）优先于记忆。
   */
  useEffect(() => {
    if (restored) return undefined;
    if (props.initialAction) {
      setRestored(true);
      return undefined;
    }
    const view = resolvePipelineView(props.remembered !== undefined ? props.remembered : readViewState());
    if (view.mode === 'list') {
      setRestored(true);
      return undefined;
    }
    let alive = true;
    setLoadingDetail(true);
    loadPipelineForView(view, (id) => api.getPipeline(id)).then((result) => {
      if (!alive) return;
      setLoadingDetail(false);
      if (!result.ok) {
        // 目标已被删除 / 取数失败：清掉记忆并回列表，绝不白屏
        resetPipelineView();
        setDetailId('');
        setMode('list');
        if (props.toast) props.toast.warn('上次打开的流水线已不存在，已回到列表');
        setRestored(true);
        return;
      }
      const pipeline = result.pipeline;
      setDetailId(pipeline.id);
      setDetailData(pipeline);
      if (view.mode === 'edit') {
        setDraft(pipeline);
        setMode('edit');
      } else {
        setMode('detail');
      }
      setRestored(true);
    });
    return () => {
      alive = false;
    };
  }, [restored]);

  /**
   * 外部跳转。app.js 的约定：
   *   { detail: id } → 进详情（概览/运行页的「查看流水线」）
   *   { edit: id }   → 直接进编辑器（运行详情的「编辑流水线」）
   *   { create: true } → 弹新建框
   *   { run: id }    → 弹运行框
   */
  useEffect(() => {
    const action = props.initialAction;
    if (!action) return;
    if (action.edit) openEditor(action.edit);
    else if (action.detail) openDetail(action.detail);
    else if (action.create) setCreateOpen(true);
    else if (action.run) {
      const target = (props.state.pipelines || []).find((p) => p.id === action.run);
      if (target) setRunTarget(target);
    }
  }, [props.initialAction]);

  function startCreate(id, name) {
    const base = blankPipeline();
    if (id) base.id = id;
    if (name) base.name = name;
    setDraft(base);
    setMode('edit');
    setCreateOpen(false);
    // 未保存的新草稿不写「编辑中」记忆：它在服务端并不存在，
    // 否则离开再回来会被恢复逻辑判为「已删除」并弹出误导性提示。
    resetPipelineView();
  }

  /** 打开编辑器（列表的「编辑」按钮、详情页的「编辑」都走这里）。 */
  async function openEditor(id) {
    try {
      const pipeline = await api.getPipeline(id);
      setDraft(pipeline);
      setDetailId(id);
      setDetailData(pipeline);
      setMode('edit');
      // 只记 id 与模式，不记定义本身
      writeViewState({ pipelinesMode: 'edit', pipelinesId: id, editPipelineId: id });
    } catch (error) {
      props.toast.error(error.message || String(error));
    }
  }

  /** 打开详情；列表里可能还没有完整定义，缺了就从后端取一份并缓存下来。 */
  async function openDetail(id) {
    setDetailId(id);
    setMode('detail');
    writeViewState({ pipelinesMode: 'detail', pipelinesId: id });
    const cached = (props.state.pipelines || []).find((p) => p.id === id);
    if (cached) {
      setDetailData(cached);
      return;
    }
    setDetailData(null);
    setLoadingDetail(true);
    try {
      const pipeline = await api.getPipeline(id);
      setDetailData(pipeline);
    } catch (error) {
      props.toast.error(error.message || String(error));
      setMode('list');
    } finally {
      setLoadingDetail(false);
    }
  }

  /** 详情页要展示的数据：优先用列表缓存（刷新后自动同步），否则用单独取到的那一份。 */
  const detailPipeline =
    (props.state.pipelines || []).find((p) => p.id === detailId) ||
    (detailData && detailData.id === detailId ? detailData : null);

  const activeRunsByPipeline = useMemo(() => {
    const map = {};
    for (const run of props.state.runs || []) {
      if (run && (run.status === 'running' || run.status === 'queued') && run.pipelineId && !map[run.pipelineId]) {
        map[run.pipelineId] = run;
      }
    }
    return map;
  }, [props.state.runs]);

  async function save(pipeline) {
    const exists = props.state.pipelines.some((p) => p.id === pipeline.id);
    if (exists) await api.updatePipeline(pipeline.id, pipeline);
    else await api.createPipeline(pipeline);
    await props.onReload();
  }

  async function remove(pipeline) {
    if (!confirm('确定删除流水线「' + (pipeline.name || pipeline.id) + '」？此操作不可撤销。')) return;
    try {
      await api.deletePipeline(pipeline.id);
      props.toast.ok('已删除');
      if (detailId === pipeline.id) {
        setDetailId('');
        backToList();
      }
      await props.onReload();
    } catch (error) {
      props.toast.error(error.message || String(error));
    }
  }

  if (mode === 'edit' && draft) {
    return h(PipelineEditor, {
      pipeline: draft,
      onChange: setDraft,
      nodes: props.state.nodes,
      servers: props.state.servers,
      ctx: props.ctx,
      fieldCtx: props.fieldCtx,
      toast: props.toast,
      recent: props.recent,
      remember: props.remember,
      // 选中节点的记忆由 app.js 下发、editor.js 消费（editor.js 归浮层任务）。
      // 这里只负责透传，不实现其内部选中逻辑。
      editMemory: props.editMemory,
      rememberEdit: props.rememberEdit,
      onSave: save,
      onReload: props.onReload,
      onTemplatesChanged: props.onTemplatesChanged,
      onStarted: (runId) => {
        props.onReload();
        if (runId) props.onOpenRun(runId);
      },
      // 回详情则记忆切到 detail；回列表则清记忆（用户明确退出编辑状态）
      onBack: () => (detailId ? openDetail(detailId) : backToList()),
    });
  }

  /** 回列表：同时把视图记忆重置为 list，用户不会被卡在详情/编辑器里出不来。 */
  function backToList() {
    resetPipelineView();
    setMode('list');
  }

  if (mode === 'detail') {
    if (!detailPipeline) {
      return h(
        'div',
        null,
        h(Button, { size: 'sm', icon: 'chevron', label: '← 流水线列表', onClick: backToList }),
        loadingDetail ? h(Empty, { text: '加载中…' }) : h(Empty, { text: '找不到这条流水线（可能已被删除）' }),
      );
    }
    return h(
      'div',
      null,
      h(PipelineDetail, {
        pipeline: detailPipeline,
        runs: props.state.runs,
        nodes: props.state.nodes,
        onBack: backToList,
        onEdit: openEditor,
        onRun: (p) => setRunTarget(p),
        onReload: props.onReload,
        onOpenRun: props.onOpenRun,
      }),
      runTarget ? h(QuickRunModal, {
        pipeline: runTarget,
        toast: props.toast,
        onClose: () => setRunTarget(null),
        onStarted: (runId) => {
          props.onReload();
          if (runId) props.onOpenRun(runId);
        },
      }) : null,
    );
  }

  return h(
    'div',
    null,
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' } },
      h('h2', { className: 'dsh-devops-title' }, '流水线'),
      h('span', { className: 'dsh-devops-hint' }, '点名称看详情，详情里可以编辑或运行'),
      h('div', { className: 'dsh-devops-spacer' }),
    ),
    h(PipelineList, {
      pipelines: props.state.pipelines,
      runs: props.state.runs,
      activeRunsByPipeline,
      onCreate: () => setCreateOpen(true),
      onOpen: openDetail,
      onEdit: openEditor,
      onRun: (p) => setRunTarget(p),
      onDelete: remove,
    }),
    createOpen ? h(CreateModal, { onClose: () => setCreateOpen(false), onCreate: startCreate }) : null,
    runTarget ? h(QuickRunModal, {
      pipeline: runTarget,
      toast: props.toast,
      onClose: () => setRunTarget(null),
      onStarted: (runId) => {
        props.onReload();
        if (runId) props.onOpenRun(runId);
      },
    }) : null,
  );
}

function CreateModal(props) {
  const [name, setName] = useState('新流水线');
  const [id, setId] = useState('pipeline-' + Math.random().toString(36).slice(2, 8));
  return h(
    Modal,
    {
      title: '新建流水线',
      onClose: props.onClose,
      footer: [
        h(Button, { key: 'c', label: '取消', onClick: props.onClose }),
        h(Button, {
          key: 'ok',
          label: '创建',
          variant: 'primary',
          disabled: !id,
          onClick: () => props.onCreate(id, name),
        }),
      ],
    },
    h(Field, { label: '名称', required: true }, h(TextInput, { value: name, onChange: setName })),
    h(Field, { label: '标识 id', required: true, description: '小写字母、数字、- 与 _' }, h(TextInput, { value: id, onChange: setId })),
    !/^[a-z0-9][a-z0-9-_]*$/.test(id) ? h(Banner, { tone: 'warn' }, '标识只能用小写字母、数字、- 和 _，且以字母或数字开头') : null,
  );
}

function QuickRunModal(props) {
  const [vars, setVars] = useState(() => {
    const out = {};
    for (const v of props.pipeline.variables || []) out[v.name] = v.value;
    return out;
  });
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const result = await api.runPipeline(props.pipeline.id, vars);
      props.toast.ok('已开始运行');
      const runId = result && (result.runId || result.id);
      props.onClose();
      props.onStarted(runId);
    } catch (error) {
      props.toast.error(error.message || String(error));
    } finally {
      setBusy(false);
    }
  }

  const declared = props.pipeline.variables || [];
  return h(
    Modal,
    {
      title: '运行「' + (props.pipeline.name || props.pipeline.id) + '」',
      onClose: props.onClose,
      footer: [h(Button, { key: 'c', label: '取消', onClick: props.onClose }), h(Button, { key: 'r', label: '开始运行', variant: 'primary', busy, onClick: submit })],
    },
    declared.length
      ? declared.map((v) =>
          h(Field, { key: v.name, label: v.name, description: v.secret ? '密钥变量' : '' },
            h(TextInput, { value: vars[v.name] || '', type: v.secret ? 'password' : 'text', onChange: (val) => setVars(Object.assign({}, vars, { [v.name]: val })) })))
      : h('div', { className: 'dsh-devops-hint' }, '没有声明变量，直接运行即可。'),
  );
}

exports.Pipelines = Pipelines;
exports.PipelineList = PipelineList;
exports.PipelineDetail = PipelineDetail;
exports.ReadonlyBoard = ReadonlyBoard;
exports.DetailDrawer = DetailDrawer;
exports.NodeInfoPanel = NodeInfoPanel;
exports.NodeLogPanel = NodeLogPanel;
exports.NodeCard = NodeCard;
exports.DETAIL_TABS = DETAIL_TABS;
exports.latestRunForStep = latestRunForStep;
exports.whenLabel = whenLabel;
exports.rawValue = rawValue;
exports.PipelineNameCell = PipelineNameCell;
exports.activeRunOf = activeRunOf;
exports.blankPipeline = blankPipeline;
exports.runSummaryByPipeline = runSummaryByPipeline;
exports.stepStatusMap = stepStatusMap;
exports.toneOfStatus = toneOfStatus;
exports.readViewState = readViewState;
exports.writeViewState = writeViewState;
exports.resetPipelineView = resetPipelineView;
exports.resolvePipelineView = resolvePipelineView;
exports.loadPipelineForView = loadPipelineForView;
exports.resolveListFilters = resolveListFilters;
});

__def("./page-templates.js", function (module, exports, require) {
/**
 * 模板页：列表（分类标签 + 搜索 + 收藏）+「从模板创建」按参数类型渲染表单
 * → 预览 → 创建；以及模板的新建/编辑/删除。
 *
 * 从流水线存模板在编辑器里完成（存为模板），这里负责消费。
 */
const { h, useState, useEffect, useMemo, clone } = require('./h.js');
const { Button, TextInput, Select, Card, Empty, Chip, Field, Modal, KV, Banner, Switch } = require('./ui.js');
const { FieldControl } = require('./fields.js');
const { api } = require('./api.js');

/* ------------------------------------------------------------------ *
 * 视图记忆（模板页筛选）：与 page-pipelines.js / app.js 同一套约定，
 * 读写 sessionStorage 的 'dsh-devops.view'，只存标量筛选条件。
 * ------------------------------------------------------------------ */
const VIEW_KEY = 'dsh-devops.view';

/** 安全读取视图记忆（无 storage / JSON 损坏时降级为 null）。 */
function readViewState() {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    const raw = sessionStorage.getItem(VIEW_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** 安全写入视图记忆（合并既有值；存不了不影响功能）。 */
function writeViewState(patch) {
  try {
    if (typeof sessionStorage === 'undefined') return;
    const current = readViewState() || {};
    sessionStorage.setItem(VIEW_KEY, JSON.stringify(Object.assign({}, current, patch)));
  } catch {
    /* 忽略：存不了不影响功能 */
  }
}

/** 解析模板页筛选状态（只认标量，非法值降级为空/关闭）。 */
function resolveTemplateFilters(remembered) {
  const view = remembered && typeof remembered === 'object' ? remembered : null;
  return {
    keyword: view && typeof view.templatesKeyword === 'string' ? view.templatesKeyword : '',
    category: view && typeof view.templatesCategory === 'string' ? view.templatesCategory : '',
    favOnly: !!(view && view.templatesFavOnly === true),
  };
}

/** 从模板参数生成一份表单初值。 */
function initialParams(template) {
  const out = {};
  for (const param of template.parameters || []) {
    out[param.name] = param.default !== undefined && param.default !== null ? param.default : param.type === 'boolean' ? false : '';
  }
  return out;
}

/** 校验必填参数。 */
function missingRequired(template, params) {
  const missing = [];
  for (const param of template.parameters || []) {
    if (!param.required) continue;
    const value = params[param.name];
    if (value === undefined || value === null || value === '') missing.push(param.label || param.name);
  }
  return missing;
}

/** 用模板参数即时预览插值结果（${{ params.x }}）。 */
function previewInterpolate(value, params) {
  if (typeof value === 'string') {
    return value.replace(/\$\{\{\s*params\.([A-Za-z0-9_]+)\s*\}\}/g, (all, name) => {
      const v = params[name];
      return v === undefined || v === '' ? all : String(v);
    });
  }
  if (Array.isArray(value)) return value.map((item) => previewInterpolate(item, params));
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) out[key] = previewInterpolate(value[key], params);
    return out;
  }
  return value;
}

/** 模板参数表单：完全按 parameter.type 分发到类型化控件。 */
function TemplateParamsForm(props) {
  return h(
    'div',
    null,
    (props.template.parameters || []).length === 0
      ? h('div', { className: 'dsh-devops-hint' }, '该模板没有参数，直接创建即可。')
      : (props.template.parameters || []).map((param) =>
          h(FieldControl, {
            key: param.name,
            // 模板参数与节点字段同构，直接复用同一套控件（契约 §4）
            field: Object.assign({}, param, {
              label: param.label || param.name,
              description: param.description || '',
              type: param.type || 'string',
              field: undefined,
            }),
            value: props.params[param.name],
            onChange: (v) => props.onChange(Object.assign({}, props.params, { [param.name]: v })),
            ctx: props.fieldCtx || props.ctx,
            serverId: props.state.settings && props.state.settings.defaultServer,
            serverFor: (id) => (props.state.servers || []).find((s) => s.id === id),
            recent: props.recent,
            remember: props.remember,
            ownerId: 'tpl-' + props.template.id + '-' + param.name,
          }),
        ),
  );
}

/** 「从模板创建」向导：填参数 → 预览 → 创建。 */
function InstantiateModal(props) {
  const template = props.template;
  const [params, setParams] = useState(() => initialParams(template));
  const [step, setStep] = useState('form');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState(template.name.replace(/模板$/, '').trim() || template.name);

  const missing = missingRequired(template, params);
  const localPreview = useMemo(() => previewInterpolate(template.body, params), [template, params]);

  async function doPreview() {
    setBusy(true);
    setError('');
    try {
      const result = await api.instantiateTemplate(template.id, params);
      setPreview(result && result.pipeline ? result.pipeline : result);
      setStep('preview');
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    setBusy(true);
    setError('');
    try {
      const pipeline = clone(preview || localPreview);
      pipeline.id = pipeline.id || template.id + '-' + Math.random().toString(36).slice(2, 6);
      if (name && name !== pipeline.name) pipeline.name = name;
      await api.createPipeline(pipeline);
      props.toast.ok('已从模板创建流水线');
      props.onClose();
      props.onCreated && props.onCreated(pipeline.id);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  return h(
    Modal,
    {
      title: '从模板创建：' + (template.name || template.id),
      wide: step === 'preview',
      onClose: props.onClose,
      footer:
        step === 'form'
          ? [
              h(Button, { key: 'c', label: '取消', onClick: props.onClose }),
              h(Button, { key: 'n', label: '预览', disabled: missing.length > 0, busy, onClick: doPreview }),
            ]
          : [
              h(Button, { key: 'b', label: '← 改参数', onClick: () => setStep('form') }),
              h(Button, { key: 'ok', label: '创建流水线', variant: 'primary', busy, onClick: create }),
            ],
    },
    error ? h(Banner, { tone: 'error' }, error) : null,
    step === 'form'
      ? h(
          'div',
          null,
          template.description ? h('div', { className: 'dsh-devops-hint', style: { marginBottom: '10px' } }, template.description) : null,
          h(Field, { label: '流水线名称' }, h(TextInput, { value: name, onChange: setName })),
          h(TemplateParamsForm, {
            template,
            params,
            onChange: setParams,
            ctx: props.ctx,
            fieldCtx: props.fieldCtx,
            state: props.state,
            recent: props.recent,
            remember: props.remember,
          }),
          missing.length ? h(Banner, { tone: 'warn' }, '还有必填参数未填：' + missing.join('、')) : null,
        )
      : h(
          'div',
          null,
          h('div', { className: 'dsh-devops-hint', style: { marginBottom: '8px' } }, '这是创建后将保存的流水线结构：'),
          h(
            'div',
            { style: { display: 'grid', gap: '10px' } },
            ((preview || localPreview).stages || []).map((stage) =>
              h(Card, { key: stage.id, title: (stage.name || stage.id) + (stage.parallel ? '（并行）' : '') },
                (stage.jobs || []).length === 0
                  ? h('div', { className: 'dsh-devops-hint' }, '（空阶段）')
                  : (stage.jobs || []).map((job) =>
                      h('div', { key: job.id, style: { marginBottom: '6px' } },
                        h('div', { style: { fontSize: '12px', fontWeight: 500 } }, (job.name || job.id) + '  ·  ' + job.node),
                        h('div', { className: 'dsh-devops-upload-preview', style: { marginTop: '3px' } }, JSON.stringify(job.with || {}, null, 2).slice(0, 400)),
                      ),
                    ),
              ),
            ),
          ),
        ),
  );
}

/** 模板列表。 */
function Templates(props) {
  const templates = props.state.templates || [];
  // 筛选条件属于「视图位置」：离开再回来时保留搜索词、分类与收藏过滤。
  const saved = resolveTemplateFilters(props.remembered !== undefined ? props.remembered : readViewState());
  const [keyword, setKeyword] = useState(saved.keyword);
  const [category, setCategory] = useState(saved.category);
  const [favOnly, setFavOnly] = useState(saved.favOnly);

  /**
   * 筛选变化即写入记忆（只存标量）。
   *
   * 只写「本次变化的那一项」：writeViewState 自己会与已存值合并。
   * 不能拿 saved 当基线合并 —— saved 派生自 props.remembered，
   * 那是 App 挂载时的快照、不会随我们的写入更新，
   * 否则「先输关键字、再切分类」会把关键字覆盖回空值。
   */
  function patchFilter(patch) {
    const next = {};
    if (patch.keyword !== undefined) next.templatesKeyword = patch.keyword || '';
    if (patch.category !== undefined) next.templatesCategory = patch.category || '';
    if (patch.favOnly !== undefined) next.templatesFavOnly = !!patch.favOnly;
    writeViewState(next);
    if (patch.keyword !== undefined) setKeyword(patch.keyword);
    if (patch.category !== undefined) setCategory(patch.category);
    if (patch.favOnly !== undefined) setFavOnly(patch.favOnly);
  }
  const [target, setTarget] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    props.onReload();
  }, []);

  const categories = useMemo(() => {
    const set = new Set();
    for (const t of templates) if (t.category) set.add(t.category);
    return Array.from(set);
  }, [templates]);

  const filtered = templates.filter((t) => {
    if (category && t.category !== category) return false;
    if (favOnly && !t.favorite) return false;
    if (!keyword) return true;
    const hay = (t.name || '') + ' ' + (t.id || '') + ' ' + (t.description || '') + ' ' + (t.tags || []).join(' ');
    return hay.toLowerCase().includes(keyword.toLowerCase());
  });

  async function toggleFavorite(template) {
    try {
      await api.updateTemplate(template.id, Object.assign({}, template, { favorite: !template.favorite }));
      props.onReload();
    } catch (error) {
      props.toast.error(error.message || String(error));
    }
  }

  async function remove(template) {
    if (!confirm('确定删除模板「' + (template.name || template.id) + '」？')) return;
    try {
      await api.deleteTemplate(template.id);
      props.toast.ok('已删除');
      props.onReload();
    } catch (error) {
      props.toast.error(error.message || String(error));
    }
  }

  return h(
    'div',
    null,
    h(
      'div',
      { style: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px' } },
      h('div', { style: { width: '220px' } }, h(TextInput, { value: keyword, placeholder: '搜索模板', onChange: (v) => patchFilter({ keyword: v }) })),
      h('div', { style: { width: '150px' } }, h(Select, { value: category, placeholder: '全部分类', options: categories, onChange: (v) => patchFilter({ category: v }) })),
      h(Button, { size: 'sm', icon: 'sparkle', label: '只看收藏', active: favOnly, onClick: () => patchFilter({ favOnly: !favOnly }) }),
      h('div', { className: 'dsh-devops-spacer' }),
      h(Button, { size: 'sm', icon: 'refresh', label: '刷新', busy, onClick: props.onReload }),
    ),
    filtered.length === 0
      ? h(Empty, { text: templates.length === 0 ? '还没有模板。到流水线编辑器里点「存为模板」即可创建。' : '没有匹配的模板' })
      : h(
          'div',
          { className: 'dsh-devops-grid', 'data-cols': '2' },
          filtered.map((template) =>
            h(Card, {
              key: template.id,
              title: template.name || template.id,
              headExtra: h(
                'span',
                { style: { display: 'flex', gap: '4px' } },
                h(Button, { size: 'sm', variant: 'ghost', icon: 'sparkle', title: template.favorite ? '取消收藏' : '收藏', active: !!template.favorite, onClick: () => toggleFavorite(template) }),
                h(Button, { size: 'sm', variant: 'danger', icon: 'trash', title: '删除', onClick: () => remove(template) }),
              ),
            },
              template.description ? h('div', { className: 'dsh-devops-hint', style: { marginBottom: '6px' } }, template.description) : null,
              h(KV, {
                entries: [
                  ['标识', h('span', { className: 'dsh-devops-monospace' }, template.id)],
                  ['分类', template.category || '—'],
                  ['参数', String((template.parameters || []).length)],
                  ['使用次数', String(template.usageCount || 0)],
                ],
              }),
              (template.parameters || []).length
                ? h('div', { style: { marginTop: '6px', display: 'flex', gap: '4px', flexWrap: 'wrap' } },
                    (template.parameters || []).map((p) =>
                      h(Chip, { key: p.name }, (p.label || p.name) + (p.required ? ' *' : '')),
                    ))
                : null,
              h('div', { style: { marginTop: '10px' } },
                h(Button, { size: 'sm', variant: 'primary', icon: 'plus', label: '从模板创建', onClick: () => setTarget(template) })),
            ),
          ),
        ),
    target ? h(InstantiateModal, {
      template: target,
      ctx: props.ctx,
      fieldCtx: props.fieldCtx,
      state: props.state,
      toast: props.toast,
      recent: props.recent,
      remember: props.remember,
      onClose: () => setTarget(null),
      onCreated: (id) => {
        props.onReload();
        props.onOpenPipeline && props.onOpenPipeline(id);
      },
    }) : null,
  );
}

exports.resolveTemplateFilters = resolveTemplateFilters;
exports.readViewState = readViewState;
exports.writeViewState = writeViewState;
exports.Templates = Templates;
exports.InstantiateModal = InstantiateModal;
exports.previewInterpolate = previewInterpolate;
});

__def("./page-runs.js", function (module, exports, require) {
/**
 * 运行页：运行列表 + 运行详情。
 * 详情包含进度环、阶段泳道、步骤卡片（点开看实时日志）、卡住诊断、失败归因。
 */
const { h, useState, useEffect, useMemo, useRef, useCallback, fmtDuration, fmtTime, fmtAgo, useTick, ellipsis } = require('./h.js');
const { Button, Card, Chip, Empty, ProgressRing, KV, Select, TextInput, Banner, StatusDot } = require('./ui.js');
const { api } = require('./api.js');
const { createRunStream } = require('./sse.js');
const { LogPanel } = require('./logs.js');
const { diagnoseStep, StuckPanel, PhaseFlow, humanMs, attributionFor } = require('./diagnostics.js');
const { AiButton, buildFailurePrompt } = require('./ai.js');
const { RUN_STATUS_TEXT, STEP_STATUS_TEXT, runTone, stepTone } = require('./state.js');
const { tokenizeLine, detectLanguage } = require('./syntax.js');

/**
 * 已结束步骤的静态日志：按**与实时日志同一套语法着色**渲染，
 * 避免同一份日志在「运行中」和「已结束」两种状态下观感不一致。
 * 语言按内容自动判断（日志通常是构建输出，猜错只是配色不同，不影响可读）。
 */
function StaticLogView(props) {
  const text = String(props.text || '');
  const maxLines = props.maxLines || 400;
  const all = text.split('\n');
  const shown = all.length > maxLines ? all.slice(all.length - maxLines) : all;
  const language = detectLanguage(text);
  return h(
    'div',
    { className: 'dsh-devops-loglines', 'data-language': language },
    shown.map((line, i) =>
      h(
        'div',
        { key: i, className: 'dsh-devops-logline' },
        tokenizeLine(line, language).map((token, j) =>
          h('span', { key: j, className: 'dsh-devops-tok dsh-devops-tok-' + token.kind }, token.text),
        ),
      ),
    ),
  );
}

/** 步骤耗时：进行中按当前时间算，结束后用 finishedAt。 */
function stepElapsed(step, now) {
  if (!step || !step.startedAt) return 0;
  return Math.max(0, (step.finishedAt || now) - step.startedAt);
}

/**
 * 步骤详情悬浮卡片：与流水线详情页**同一套形态契约**（圆角悬浮卡片 + 三个关闭方式）。
 *
 * 用户要求「不要一处侧栏一处卡片」：运行页这里同样把形态挂在既有类名 +
 * data-shape / data-variant / data-blur 属性上，视觉完全由 styles.js 决定。
 */
function StepDetailDrawer(props) {
  const step = props.step || null;
  const open = !!step;
  const [tab, setTab] = useState('info');

  // 打开时支持 Esc 关闭（Node 环境没有 document，跳过）
  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    const onKey = (event) => {
      if (event && event.key === 'Escape' && props.onClose) props.onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      if (document && document.removeEventListener) document.removeEventListener('keydown', onKey);
    };
  }, [open, props.onClose]);

  const infoActive = tab === 'info';
  const status = step ? step.status : '';
  const elapsed = step ? stepElapsed(step, props.now || Date.now()) : 0;
  const infoEntries = step
    ? [
        ['步骤 id', h('span', { className: 'dsh-devops-monospace' }, step.id || '—')],
        ['名称', step.name || '—'],
        ['节点类型', h('span', { className: 'dsh-devops-monospace' }, step.node || '—')],
        ['阶段', step.stage || '未分组'],
        ['状态', STEP_STATUS_TEXT[step.status] || step.status || '—'],
        ['服务器', step.server || '（默认）'],
        ['退出码', step.exitCode === null || step.exitCode === undefined ? '—' : String(step.exitCode)],
        ['耗时', elapsed ? fmtDuration(elapsed) : '—'],
        ['尝试次数', step.attempt ? String(step.attempt) : '1'],
        ['输出字节', step.bytes ? step.bytes + ' B' : '—'],
        ['phase', step.phase || '—'],
      ]
    : [];

  return h(
    'div',
    {
      className: 'dsh-devops-drawer-layer',
      'data-role': 'step-detail-drawer',
      'data-shape': 'floating',
      'data-open': open ? 'true' : 'false',
      'data-tab': tab,
      'data-status': status || 'idle',
      'data-tone': status ? stepTone(status) : 'idle',
      'aria-hidden': open ? 'false' : 'true',
    },
    h('div', {
      className: 'dsh-devops-drawer-mask',
      'data-role': 'step-drawer-mask',
      'data-blur': 'true',
      onClick: () => props.onClose && props.onClose(),
    }),
    h(
      'aside',
      {
        className: 'dsh-devops-drawer',
        'data-role': 'step-drawer-panel',
        'data-variant': 'floating',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': '步骤详情',
      },
      h(
        'div',
        { className: 'dsh-devops-drawer-head' },
        h('span', { className: 'dsh-devops-drawer-title dsh-devops-truncate' }, step ? step.name || step.id : ''),
        step ? h('span', { className: 'dsh-devops-tag dsh-devops-monospace' }, step.node) : null,
        step ? h(Chip, { tone: stepTone(step.status), dot: true }, STEP_STATUS_TEXT[step.status] || step.status) : null,
        h('div', { className: 'dsh-devops-spacer' }),
        h(Button, { variant: 'ghost', size: 'sm', icon: 'close', label: '关闭', title: '关闭（Esc）', onClick: () => props.onClose && props.onClose() }),
      ),
      h(
        'div',
        { className: 'dsh-devops-tabs', role: 'tablist', 'data-role': 'step-drawer-tabs' },
        [{ id: 'info', label: '步骤信息' }, { id: 'log', label: '日志' }].map((item) =>
          h(
            'button',
            {
              key: item.id,
              type: 'button',
              role: 'tab',
              className: 'dsh-devops-tab',
              'data-role': 'step-drawer-tab',
              'data-tab': item.id,
              'data-active': tab === item.id ? 'true' : undefined,
              'aria-selected': tab === item.id ? 'true' : 'false',
              onClick: () => setTab(item.id),
            },
            item.label,
          ),
        ),
      ),
      h(
        'div',
        { className: 'dsh-devops-drawer-body' },
        h('div', { 'data-role': 'step-drawer-view', 'data-view': 'info', hidden: !infoActive },
          infoActive
            ? h(
                'div',
                { className: 'dsh-devops-drawer-panel' },
                h(
                  'div',
                  { className: 'dsh-devops-card', 'data-role': 'step-info-group' },
                  h('div', { className: 'dsh-devops-card-head' }, h('span', { className: 'dsh-devops-card-title' }, '执行信息')),
                  h(KV, { entries: infoEntries }),
                ),
                step && step.error
                  ? h('div', { className: 'dsh-devops-card', 'data-role': 'step-error' },
                      h('div', { className: 'dsh-devops-card-head' }, h('span', { className: 'dsh-devops-card-title' }, '错误')),
                      h('div', { className: 'dsh-devops-drawer-raw dsh-devops-monospace', 'data-tone': 'error' }, String(step.error)))
                  : null,
              )
            : null),
        h('div', { 'data-role': 'step-drawer-view', 'data-view': 'log', hidden: infoActive },
          infoActive
            ? null
            : h(LogPanel, { runId: props.runId, stepId: step ? step.id : '', live: !!props.live, meta: { stuckSilenceSec: props.stuckSilenceSec } })),
      ),
    ),
  );
}

/** 一组步骤的整体状态：失败优先，其次运行中，再次排队，最后才是全部成功。 */
function laneStatus(list) {
  const items = list || [];
  if (items.length === 0) return 'pending';
  if (items.some((s) => s.status === 'failed')) return 'failed';
  if (items.some((s) => s.status === 'running')) return 'running';
  if (items.some((s) => s.status === 'queued' || s.status === 'pending')) return 'pending';
  if (items.every((s) => s.status === 'success' || s.status === 'skipped')) return 'success';
  return 'pending';
}

/** 单个步骤卡片：可展开实时日志。 */
function StepCard(props) {
  const { step, expanded, onToggle, runId, now, stuckSilenceSec, server, toast } = props;
  const [logs, setLogs] = useState('');
  const [loadingLogs, setLoadingLogs] = useState(false);
  const diag = diagnoseStep(step, { now, stuckSilenceSec, server });
  const isLive = step.status === 'running' || step.status === 'pending';

  // 展开且步骤已结束时，拉一次日志尾部，用于归因与 AI 解释
  useEffect(() => {
    if (!expanded || isLive) return undefined;
    let cancelled = false;
    setLoadingLogs(true);
    api.runLogs(runId, { stepId: step.id, from: 0 })
      .then((result) => {
        if (cancelled || !result) return;
        setLogs((result.lines || []).map((l) => l.text).join('\n'));
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoadingLogs(false));
    return () => {
      cancelled = true;
    };
  }, [expanded, isLive, runId, step.id]);

  async function retryStep(event) {
    event.stopPropagation();
    try {
      await api.retryStep(runId, step.id);
      toast.ok('已提交重试');
      props.onRetried && props.onRetried();
    } catch (error) {
      toast.error(error.message || String(error));
    }
  }

  return h(
    'div',
    // 状态色：data-status 为原始状态、data-tone 为语义色调，颜色一律交给 CSS
    { className: 'dsh-devops-stepcard', 'data-status': step.status, 'data-tone': stepTone(step.status) },
    h(
      'div',
      { className: 'dsh-devops-stepcard-head', onClick: onToggle },
      h('span', { style: { color: 'var(--dsw-alias-label-tertiary)' } }, expanded ? '▾' : '▸'),
      h(StatusDot, { tone: stepTone(step.status), title: STEP_STATUS_TEXT[step.status] || step.status }),
      h('span', { className: 'dsh-devops-stepcard-title' }, step.name || step.id),
      h('span', { className: 'dsh-devops-tag' }, step.node),
      isLive ? h(PhaseFlow, { phase: step.phase, status: step.status }) : null,
      h('div', { className: 'dsh-devops-spacer' }),
      h(
        'span',
        { className: 'dsh-devops-stepcard-meta' },
        h('span', null, STEP_STATUS_TEXT[step.status] || step.status),
        stepElapsed(step, now) ? h('span', null, fmtDuration(stepElapsed(step, now))) : null,
        step.exitCode !== null && step.exitCode !== undefined ? h('span', null, '退出码 ' + step.exitCode) : null,
        step.server ? h('span', null, step.server) : null,
        step.attempt > 1 ? h('span', null, '第 ' + step.attempt + ' 次') : null,
        step.bytes ? h('span', null, step.bytes + ' B') : null,
        isLive ? h('span', { style: { color: diag.stuck ? 'var(--dsw-alias-state-warn-primary)' : 'inherit' } }, diag.silentText) : null,
      ),
      // 统一的「查看详情」入口：悬浮卡片展示步骤原信息与日志
      props.onOpenDetail
        ? h(Button, {
            size: 'sm',
            variant: 'ghost',
            label: '详情',
            title: '在悬浮卡片中查看该步骤的信息与日志',
            onClick: (event) => {
              if (event && event.stopPropagation) event.stopPropagation();
              props.onOpenDetail(step);
            },
            style: { flex: 'none' },
          })
        : null,
      step.status === 'failed' && !isLive
        ? h(Button, {
            size: 'sm',
            icon: 'refresh',
            label: '重试此步',
            title: '只重试这一步',
            onClick: retryStep,
            style: { flex: 'none' },
          })
        : null,
    ),
    expanded
      ? h(
          'div',
          null,
          h(StuckPanel, { step, diag }),
          step.error ? h('div', { className: 'dsh-devops-banner', 'data-tone': 'error', style: { margin: '0 8px 6px' } }, step.error) : null,
          isLive
            ? h(LogPanel, { runId, stepId: step.id, live: true, meta: { stuckSilenceSec } })
            : h(
                'div',
                { className: 'dsh-devops-logpanel' },
                h(
                  'div',
                  { className: 'dsh-devops-logbar' },
                  h('span', { className: 'dsh-devops-chip' }, '已结束 · 静态日志'),
                  h('div', { className: 'dsh-devops-spacer' }),
                  h(AiButton, {
                    ctx: props.ctx,
                    toast,
                    label: '用 AI 解释失败',
                    prompt: () =>
                      buildFailurePrompt(
                        { id: runId, pipelineId: '', pipelineName: '', status: step.status, steps: { [step.id]: step } },
                        logs || '(无日志)',
                      ),
                  }),
                ),
                h(
                  'div',
                  { className: 'dsh-devops-logview', 'data-language': 'plain' },
                  loadingLogs
                    ? '加载日志中…'
                    : logs
                      ? h(StaticLogView, { text: logs, maxLines: 400 })
                      : '该步骤没有日志输出',
                ),
              ),
        )
      : null,
  );
}

/** 运行详情。 */
function RunDetail(props) {
  const runId = props.runId;
  const [run, setRun] = useState(null);
  const [error, setError] = useState('');
  // 展开的步骤 id 列表。过去是「单个 id 字符串」，但阶段头按钮写的是「全部展开」，
  // 实际只会展开第一条 —— 标签与行为不符，点了像没反应。
  const [expanded, setExpanded] = useState([]);
  // 悬浮详情卡片当前展示的步骤（null = 收起）
  const [detailStep, setDetailStep] = useState(null);
  const [sseStatus, setSseStatus] = useState('idle');
  const [now, setNow] = useState(Date.now());
  const streamRef = useRef(null);
  useTick(true);

  const load = useCallback(async () => {
    try {
      const value = await api.getRun(runId);
      setRun(value);
      setError('');
    } catch (err) {
      setError(err.message || String(err));
    }
  }, [runId]);

  useEffect(() => {
    load();
  }, [load]);

  // 每秒本地刷新耗时显示（不做后端轮询）
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // 运行未结束时挂 SSE，实时更新 run/step
  const live = run && (run.status === 'running' || run.status === 'queued');
  useEffect(() => {
    if (!runId || !live) {
      setSseStatus(run && !live ? 'idle' : 'connecting');
      return undefined;
    }
    const stream = createRunStream(runId, {
      onStatus: setSseStatus,
      onEvent: (name, data) => {
        if (name === 'run' && data.run) {
          setRun((prev) => Object.assign({}, prev || {}, data.run));
        } else if (name === 'step' && data.step) {
          setRun((prev) => {
            if (!prev) return prev;
            const steps = Object.assign({}, prev.steps);
            steps[data.stepId || data.step.id] = Object.assign({}, steps[data.stepId] || {}, data.step);
            return Object.assign({}, prev, { steps });
          });
          // 步骤结束时刷新一次完整运行，拿到最终状态与耗时
          if (data.step.status && data.step.status !== 'running') load();
        }
      },
    });
    streamRef.current = stream;
    return () => {
      streamRef.current = null;
      stream.close();
    };
  }, [runId, live, load]);

  /**
   * 声明「本页自管滚动」：运行详情内部有自己的滚动区（阶段泳道 + 步骤日志），
   * 外层 .dsh-devops-body 必须停止滚动，否则滚轮会带动整页、内部区域拿不到有界高度。
   * 进入时 true、卸载时 false；app.js 依此设置 body 的 data-flush。
   *
   * 必须在下面的提前 return **之前**（hooks 不能条件执行，否则触发 React #310）。
   */
  useEffect(() => {
    if (typeof props.onBodyFlush !== 'function') return undefined;
    props.onBodyFlush(true);
    return () => props.onBodyFlush(false);
  }, [props.onBodyFlush]);

  // ⚠️ hooks 必须无条件执行：不能放在下面的提前 return 之后，
  // 否则「首次无数据 → 数据到达」两次渲染的 hook 数量不同，React 会抛
  // "Rendered more hooks than during the previous render"（#310）。
  const steps = (run && run.steps) || {};
  const stepList = Object.keys(steps).map((id) => Object.assign({ id }, steps[id]));

  /** 按阶段分组：步骤带 stage 字段，没有则归到「未分组」。 */
  const lanes = useMemo(() => {
    const map = new Map();
    for (const step of stepList) {
      const key = step.stage || '';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(step);
    }
    return Array.from(map.entries());
  }, [stepList]);

  const counts = useMemo(() => {
    const out = { success: 0, failed: 0, running: 0, pending: 0, skipped: 0, canceled: 0 };
    for (const step of stepList) out[step.status] = (out[step.status] || 0) + 1;
    return out;
  }, [stepList]);

  /** 展开/收起单个步骤。 */
  function toggleStep(id) {
    setExpanded((prev) => (prev.indexOf(id) >= 0 ? prev.filter((x) => x !== id) : prev.concat([id])));
  }

  /** 展开/收起某个阶段下的全部步骤。 */
  function toggleLane(list) {
    const ids = list.map((s) => s.id);
    setExpanded((prev) => {
      const allOpen = ids.length > 0 && ids.every((id) => prev.indexOf(id) >= 0);
      if (allOpen) return prev.filter((id) => ids.indexOf(id) < 0);
      return prev.concat(ids.filter((id) => prev.indexOf(id) < 0));
    });
  }

  // hooks 全部执行完，现在才允许提前 return
  if (error) return h(Banner, { tone: 'error' }, error);
  if (!run) return h(Empty, { text: '加载中…' });

  const done = counts.success + counts.failed + counts.skipped + counts.canceled;
  const failed = counts.failed;
  const tips = attributionFor(run);
  const failedSteps = stepList.filter((s) => s.status === 'failed');

  async function cancel() {
    try {
      await api.cancelRun(runId);
      props.toast.ok('已请求取消');
      load();
    } catch (err) {
      props.toast.error(err.message || String(err));
    }
  }

  async function retry() {
    try {
      await api.retryRun(runId);
      props.toast.ok('已提交重跑');
      props.onReload && props.onReload();
    } catch (err) {
      props.toast.error(err.message || String(err));
    }
  }

  return h(
    'div',
    // 定位上下文：悬浮抽屉层是 absolute/inset:0，必须锚定在运行详情区域内
    { className: 'dsh-devops-detail', 'data-role': 'run-detail' },
    // 内部滚动区：外层 body 已 data-flush（不滚），运行详情的滚动由这里承担。
    // 悬浮抽屉层必须留在滚动区**之外**，否则遮罩会随内容滚走、盖不住视口。
    h(
      'div',
      { className: 'dsh-devops-detail-scroll', 'data-role': 'run-detail-scroll' },
      h(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' } },
      h(Button, { size: 'sm', icon: 'chevron', label: '← 运行列表', onClick: props.onBack }),
      h('h2', { className: 'dsh-devops-title', style: { margin: 0 } }, run.id),
      h(Chip, { tone: runTone(run.status), dot: true }, RUN_STATUS_TEXT[run.status] || run.status),
      run.pipelineId
        ? h(
            'span',
            {
              className: 'dsh-devops-link',
              role: 'button',
              tabIndex: 0,
              title: '查看「' + (run.pipelineName || run.pipelineId) + '」的详情',
              onClick: () => props.onOpenPipeline && props.onOpenPipeline(run.pipelineId),
              onKeyDown: (event) => {
                if (event && (event.key === 'Enter' || event.key === ' ')) {
                  event.preventDefault();
                  props.onOpenPipeline && props.onOpenPipeline(run.pipelineId);
                }
              },
            },
            run.pipelineName || run.pipelineId,
          )
        : h('span', { className: 'dsh-devops-hint' }, run.pipelineName || run.pipelineId),
      run.pipelineId
        ? h(Button, {
            size: 'sm',
            label: '编辑流水线',
            title: '打开这条运行所用流水线的编辑器',
            onClick: () => props.onEditPipeline && props.onEditPipeline(run.pipelineId),
          })
        : null,
      h('div', { className: 'dsh-devops-spacer' }),
      live ? h(Button, { size: 'sm', variant: 'danger', icon: 'close', label: '取消运行', onClick: cancel }) : null,
      failed > 0 ? h(Button, { size: 'sm', icon: 'refresh', label: '重跑全部', onClick: retry }) : null,
      h(Button, { size: 'sm', icon: 'refresh', label: '刷新', onClick: load }),
    ),

    h(
      'div',
      { className: 'dsh-devops-grid', 'data-cols': '2', style: { marginBottom: '12px' } },
      h(Card, { title: '进度' },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '14px' } },
          h(ProgressRing, {
            value: done,
            total: stepList.length || 1,
            tone: failed > 0 ? 'error' : live ? 'busy' : 'ok',
            size: 62,
          }),
          h(KV, {
            entries: [
              ['步骤', counts.success + ' 成功 / ' + failed + ' 失败 / ' + stepList.length + ' 总计'],
              ['耗时', run.startedAt ? fmtDuration((run.finishedAt || now) - run.startedAt) : '—'],
              ['开始', fmtTime(run.startedAt)],
              ['结束', run.finishedAt ? fmtTime(run.finishedAt) : '进行中'],
              ['触发', run.trigger || 'manual'],
            ],
          }),
        ),
      ),
      h(Card, { title: '诊断' },
        h(KV, {
          entries: [
            ['SSE', h(Chip, { tone: sseStatus === 'open' ? 'ok' : sseStatus === 'error' ? 'error' : 'idle' }, sseStatus === 'open' ? '实时连接' : sseStatus)],
            ['进行中步骤', String(counts.running)],
            ['队列中', String(counts.pending)],
            ['父运行', run.parentRunId || '—'],
          ],
        }),
        run.variables && Object.keys(run.variables).length
          ? h('div', { style: { marginTop: '8px' } },
              h('div', { className: 'dsh-devops-hint', style: { marginBottom: '3px' } }, '本次变量'),
              h('div', { className: 'dsh-devops-monospace', style: { fontSize: '11px' } },
                Object.keys(run.variables).map((k) => k + '=' + ellipsis(run.variables[k], 40)).join('  ')))
          : null,
      ),
    ),

    failed > 0
      ? h(Banner, { tone: 'error' },
          h('div', { style: { fontWeight: 500, marginBottom: '4px' } }, '失败归因'),
          tips.map((tip, i) => h('div', { key: i }, '· ' + tip)),
          h('div', { style: { marginTop: '8px' } },
            h(AiButton, {
              ctx: props.ctx,
              toast: props.toast,
              label: '用 AI 解释失败',
              prompt: () =>
                buildFailurePrompt(
                  run,
                  failedSteps
                    .map((s) => '### ' + (s.name || s.id) + '\n' + (s.error || '') )
                    .join('\n'),
                ),
            })),
        )
      : null,

    h(Card, { title: '阶段与步骤' },
      lanes.length === 0
        ? h(Empty, { text: '这次运行还没有步骤' })
        : lanes.map(([stage, list]) =>
            h(
              'div',
              {
                key: stage || 'ungrouped',
                style: { marginBottom: '10px' },
                // 注意：这里**不能**复用 .dsh-devops-column —— 那是横向编排的列，
                // 带 width:236px / flex:0 0 auto，会把运行页泳道挤成窄列。
                // 状态色改用头部状态点（data-tone）表达，布局保持原来的整宽泳道。
                'data-role': 'run-lane',
                'data-status': laneStatus(list),
                'data-tone': stepTone(laneStatus(list)),
              },
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' } },
                h(StatusDot, { tone: stepTone(laneStatus(list)), title: '该阶段整体状态：' + (STEP_STATUS_TEXT[laneStatus(list)] || laneStatus(list)) }),
                h('span', { style: { fontSize: '12px', fontWeight: 500 } }, stage || '未分组'),
                h('span', { className: 'dsh-devops-hint' }, list.length + ' 个步骤'),
                h('div', { className: 'dsh-devops-spacer' }),
                h(Button, {
                  size: 'sm',
                  variant: 'ghost',
                  label: list.length > 0 && list.every((s) => expanded.indexOf(s.id) >= 0) ? '全部收起' : '全部展开',
                  title: '展开或收起该阶段的全部步骤',
                  onClick: () => toggleLane(list),
                }),
              ),
              list.map((step) =>
                h(StepCard, {
                  key: step.id,
                  step,
                  runId,
                  now,
                  expanded: expanded.indexOf(step.id) >= 0,
                  onToggle: () => toggleStep(step.id),
                  stuckSilenceSec: (props.settings && props.settings.stuckSilenceSec) || 60,
                  server: (props.servers || []).find((s) => s.id === step.server),
                  toast: props.toast,
                  ctx: props.ctx,
                  onRetried: props.onReload,
                  onOpenDetail: setDetailStep,
                }),
              ),
            ),
          ),
    ),

    ),

    // 统一的悬浮详情卡片（与流水线详情页同一形态契约）——留在滚动区外
    h(StepDetailDrawer, {
      step: detailStep,
      runId,
      live: detailStep ? !!live : false,
      stuckSilenceSec: (props.settings && props.settings.stuckSilenceSec) || 60,
      now,
      onClose: () => setDetailStep(null),
    }),
  );
}

/** 运行列表页。 */
function Runs(props) {
  const runs = props.state.runs || [];
  const [filter, setFilter] = useState('');
  const [status, setStatus] = useState('');
  const [openId, setOpenId] = useState(props.initialRunId || '');
  const [now, setNow] = useState(Date.now());
  useTick(true);

  useEffect(() => {
    props.onReload();
  }, []);

  // 外部（状态栏/概览/编辑器）要求打开某次运行时同步
  useEffect(() => {
    if (props.initialRunId) setOpenId(props.initialRunId);
  }, [props.initialRunId]);

  if (openId) {
    return h(RunDetail, {
      runId: openId,
      toast: props.toast,
      ctx: props.ctx,
      servers: props.state.servers,
      settings: props.state.settings,
      onBack: () => setOpenId(''),
      onReload: props.onReload,
      onEditPipeline: props.onEditPipeline,
      onOpenPipeline: props.onOpenPipeline,
      // 「本页自管滚动」的声明通道（app.js 由 Lead 提供，这里逐层透传）。
      onBodyFlush: props.onBodyFlush,
    });
  }

  const filtered = runs.filter((r) => {
    if (status && r.status !== status) return false;
    if (!filter) return true;
    return (r.id + ' ' + (r.pipelineName || '') + ' ' + (r.pipelineId || '')).toLowerCase().includes(filter.toLowerCase());
  });

  const nowTs = Date.now();

  return h(
    'div',
    null,
    h(
      'div',
      { style: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px' } },
      h('div', { style: { width: '220px' } }, h(TextInput, { value: filter, placeholder: '搜索运行 id / 流水线', onChange: setFilter })),
      h('div', { style: { width: '140px' } },
        h(Select, {
          value: status,
          placeholder: '全部状态',
          options: Object.keys(RUN_STATUS_TEXT).map((k) => ({ value: k, label: RUN_STATUS_TEXT[k] })),
          onChange: setStatus,
        })),
      h('div', { className: 'dsh-devops-spacer' }),
      h(Button, { size: 'sm', icon: 'refresh', label: '刷新', onClick: props.onReload }),
    ),
    filtered.length === 0
      ? h(Empty, { text: runs.length === 0 ? '还没有运行记录' : '没有匹配的运行' })
      : h(
          'table',
          { className: 'dsh-devops-table' },
          h('thead', null,
            h('tr', null,
              h('th', null, '运行 id'),
              h('th', null, '流水线'),
              h('th', null, '状态'),
              h('th', null, '进度'),
              h('th', null, '耗时'),
              h('th', null, '开始'),
              h('th', null, ''),
            )),
          h('tbody', null,
            filtered.map((run) => {
              const steps = Object.values(run.steps || {});
              const doneCount = steps.filter((s) => s.status && s.status !== 'running' && s.status !== 'pending').length;
              return h('tr', { key: run.id },
                h('td', { className: 'dsh-devops-monospace' }, run.id),
                h('td', null,
                  run.pipelineId && props.onOpenPipeline
                    ? h(
                        'span',
                        {
                          className: 'dsh-devops-link',
                          role: 'button',
                          tabIndex: 0,
                          title: '查看「' + (run.pipelineName || run.pipelineId) + '」的详情',
                          onClick: () => props.onOpenPipeline(run.pipelineId),
                          onKeyDown: (event) => {
                            if (event && (event.key === 'Enter' || event.key === ' ')) {
                              event.preventDefault();
                              props.onOpenPipeline(run.pipelineId);
                            }
                          },
                        },
                        run.pipelineName || run.pipelineId,
                      )
                    : run.pipelineName || run.pipelineId),
                h('td', null, h(Chip, { tone: runTone(run.status), dot: true }, RUN_STATUS_TEXT[run.status] || run.status)),
                h('td', null, doneCount + ' / ' + steps.length),
                h('td', null, run.startedAt ? fmtDuration((run.finishedAt || nowTs) - run.startedAt) : '—'),
                h('td', null, fmtAgo(run.startedAt, nowTs)),
                h('td', null, h(Button, { size: 'sm', label: '详情', onClick: () => setOpenId(run.id) })),
              );
            }),
          ),
        ),
  );
}

exports.Runs = Runs;
exports.RunDetail = RunDetail;
exports.StaticLogView = StaticLogView;
exports.StepCard = StepCard;
exports.StepDetailDrawer = StepDetailDrawer;
exports.laneStatus = laneStatus;
});

__def("./page-servers.js", function (module, exports, require) {
/**
 * 服务器页：CRUD、测试连接、环境区块（探测结果 / 已装运行时 / 一键安装 / 延迟）。
 */
const { h, useState, useEffect, useMemo, clone, fmtAgo, fmtTime, pathPlaceholder } = require('./h.js');
const { Button, TextInput, Select, Switch, Card, Empty, Chip, Field, Modal, KV, Banner, StatusDot, Collapsible } = require('./ui.js');
const { api } = require('./api.js');

/**
 * 把 host-core 的 workdirSource 代码翻成人话。
 * 取值来自 src/store/domains.js 的 describeLocalWorkdir；未知代码原样显示，不吞掉信息。
 */
const WORKDIR_SOURCE_TEXT = {
  'session-directory': '当前会话的工作目录',
  'workingDirectory.defaultDirectory': 'DSH 默认工作目录',
  DSH_WORKSPACE: '环境变量 DSH_WORKSPACE',
  DSH_PROJECT_DIR: '环境变量 DSH_PROJECT_DIR',
  homedir: '用户主目录',
  'last-resort': '兜底的主目录',
  explicit: '显式指定',
};

function describeWorkdirSource(source) {
  if (!source) return '';
  if (WORKDIR_SOURCE_TEXT[source]) return WORKDIR_SOURCE_TEXT[source];
  // 工作区来源形如 workspace:my-project
  if (source.indexOf('workspace:') === 0) {
    const title = source.slice('workspace:'.length);
    return title && title !== 'unknown' ? '工作区「' + title + '」' : '最近使用的工作区';
  }
  return source;
}

/**
 * 工作目录字段的说明文案。
 *
 * 三种情形（未手动改过 / 已手动改过 / 没有来源字段）：
 *  - 没有 workdirSource（远端服务器、老数据）→ 不给提示，避免编造来源；
 *  - 本次编辑改过 workdir → 「已手动设置」；
 *  - 其余（确实由自动探测写入且未被改动）→ 点明「相对路径以它为基准」。
 */
function workdirHint(server, dirty) {
  const source = server.workdirSource;
  if (!source) return undefined;
  if (dirty) return '已手动设置：相对路径将以此目录为基准';
  return '自动探测自：' + describeWorkdirSource(source) + '（可修改）';
}

function blankServer() {
  return {
    id: 'server-' + Math.random().toString(36).slice(2, 7),
    name: '新服务器',
    kind: 'ssh',
    host: '',
    port: 22,
    user: '',
    auth: { type: 'key', keyRef: '', passwordRef: '', keyPath: '' },
    shell: '',
    workdir: '',
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

/** 环境预览：合并后的环境变量（密钥显示为掩码）。 */
function EnvPreview(props) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    setError('');
    try {
      setData(await api.serverEnv(props.server.id));
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  return h(
    Collapsible,
    { title: '环境变量合并预览', defaultOpen: false },
    h('div', { style: { paddingTop: '6px' } },
      h(Button, { size: 'sm', icon: 'eye', label: '拉取预览', busy, onClick: load }),
      error ? h(Banner, { tone: 'error' }, error) : null,
      data
        ? h(
            'div',
            { className: 'dsh-devops-upload-preview', style: { marginTop: '6px' } },
            Object.keys(data.env || {}).sort().map((key) =>
              h('div', { key }, key + ' = ' + (data.masked && data.masked.includes(data.env[key]) ? '••••••' : data.env[key])),
            ),
            (data.report || []).length
              ? h('div', { style: { marginTop: '6px', color: 'var(--dsw-alias-label-caption)' } },
                  (data.report || []).map((r, i) => h('div', { key: i }, r.name + ' ← ' + r.source + (r.overridden ? '（被覆盖）' : ''))))
              : null,
          )
        : null,
    ),
  );
}

/**
 * 私钥文件选择（task-13）：文本输入 + 「浏览」按钮，复用既有 api.fsList。
 *
 * 为什么不用 fields.js 的 PathControl：
 *  - PathControl 是**节点字段**控件，需要 field 描述符、serverField/resolveServer、
 *    recent/remember 等一组 props；而这里是「服务器自身的认证配置」，不是节点字段，
 *    硬套要伪造一堆 props，反而更脆；
 *  - 本机私钥始终在**本机**（auth.keyPath 的语义就是宿主机路径），
 *    因此浏览目标固定为 'local'，不需要 serverField 解析；
 *  - 既有 .dsh-devops-dropdown 系列样式可直接复用，零新增 CSS。
 *
 * 浏览失败不影响手填：用户在任何情况下都能直接粘贴绝对路径。
 */
function KeyFileField(props) {
  const [open, setOpen] = useState(false);
  const [listing, setListing] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const value = props.value === undefined || props.value === null ? '' : String(props.value);
  // 本机私钥固定浏览本机；不要用被编辑服务器的 id（那可能是远端 SSH 机）
  const browseServer = 'local';

  async function browse(path) {
    setBusy(true);
    setError('');
    try {
      const result = await api.fsList(browseServer, path || value || '.');
      setListing(result);
      setOpen(true);
    } catch (err) {
      // 降级要可见：提示错误但仍让用户手填，不留死点击
      setError(err.message || String(err));
      setListing(null);
      setOpen(true);
    } finally {
      setBusy(false);
    }
  }

  function pick(path) {
    props.onChange(path);
    setOpen(false);
  }

  function joinPath(base, name) {
    if (!base || base === '.') return name;
    const sep = base.indexOf('\\') !== -1 && base.indexOf('/') === -1 ? '\\' : '/';
    return base.replace(/[\\/]+$/, '') + sep + name;
  }

  return h(Field, {
    label: '私钥文件路径（本机）',
    description: '留空则用下方凭据名。优先于凭据名；文件只支持本机路径',
  },
    h('div', null,
      h('div', { className: 'dsh-devops-field-row' },
        h('div', { style: { position: 'relative', flex: 1 } },
          h(TextInput, {
            value,
            placeholder: pathPlaceholder('file'),
            onChange: (v) => props.onChange(v),
          }),
          open
            ? h('div', { className: 'dsh-devops-dropdown' },
                h('div', { className: 'dsh-devops-dropdown-note' },
                  listing ? (listing.path || value || '.') : (error || '无法读取目录')),
                listing && listing.parent
                  ? h('div', { className: 'dsh-devops-dropdown-row', onClick: () => browse(listing.parent) }, '..')
                  : null,
                listing && listing.entries && listing.entries.length
                  ? listing.entries.map((entry) =>
                      h('div', {
                        key: entry.name,
                        className: 'dsh-devops-dropdown-row',
                        onClick: () => (entry.isDir ? browse(joinPath(listing.path, entry.name)) : pick(joinPath(listing.path, entry.name))),
                      }, entry.name))
                  : null,
                h('div', { className: 'dsh-devops-dropdown-note', style: { borderTop: '0.5px solid var(--dsw-alias-border-l2)' } },
                  '在本机中选择私钥文件'),
              )
            : null),
        h(Button, { size: 'sm', icon: 'box', label: '浏览', busy, onClick: () => browse(value) }),
        open ? h(Button, { size: 'sm', variant: 'ghost', label: '关闭', onClick: () => setOpen(false) }) : null,
      ),
      value ? h('div', { className: 'dsh-devops-hint', style: { marginTop: '4px' } },
        '私钥内容只会在连接时读取，不会写入服务器配置，也不会出现在日志或导出里。') : null,
    ));
}

/** 服务器编辑弹层。 */
function ServerModal(props) {
  const [server, setServer] = useState(() => (props.server ? clone(props.server) : blankServer()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // 是否在本次编辑里手动改过工作目录：用于区分「自动探测值」与「用户自己的值」
  const [workdirDirty, setWorkdirDirty] = useState(false);
  const isLocal = server.kind === 'local';
  const isNew = !props.server;

  function patch(next) {
    setServer(Object.assign({}, server, next));
  }

  async function save() {
    setBusy(true);
    setError('');
    try {
      if (isNew) await api.createServer(server);
      else await api.updateServer(server.id, server);
      props.toast.ok('已保存');
      props.onClose();
      props.onSaved();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  return h(
    Modal,
    {
      title: isNew ? '新建服务器' : '编辑服务器：' + (props.server.name || props.server.id),
      onClose: props.onClose,
      footer: [
        h(Button, { key: 'c', label: '取消', onClick: props.onClose }),
        h(Button, { key: 's', label: '保存', variant: 'primary', busy, onClick: save }),
      ],
    },
    error ? h(Banner, { tone: 'error' }, error) : null,
    h(Field, { label: '名称', required: true }, h(TextInput, { value: server.name, onChange: (v) => patch({ name: v }) })),
    h(Field, { label: '标识 id', required: true, description: '本地服务器 id 固定为 local，不可改 kind' },
      h(TextInput, { value: server.id, disabled: server.id === 'local', onChange: (v) => patch({ id: v }) })),
    h(Field, { label: '类型' },
      h(Select, {
        value: server.kind,
        disabled: server.id === 'local',
        options: [{ value: 'local', label: '本机' }, { value: 'ssh', label: 'SSH' }],
        onChange: (v) => patch({ kind: v }),
      })),
    !isLocal
      ? h(
          'div',
          null,
          h(
            'div',
            { className: 'dsh-devops-field-row' },
            h(Field, { label: '主机', required: true }, h(TextInput, { value: server.host || '', placeholder: '10.0.0.5 或 host.example.com', onChange: (v) => patch({ host: v }) })),
            h(Field, { label: '端口' }, h(TextInput, { type: 'number', value: server.port || 22, onChange: (v) => patch({ port: Number(v) }) })),
          ),
          h(Field, { label: '用户名' }, h(TextInput, { value: server.user || '', onChange: (v) => patch({ user: v }) })),
          h(Field, { label: '认证方式' },
            h(Select, {
              value: (server.auth && server.auth.type) || 'key',
              options: [{ value: 'key', label: '私钥' }, { value: 'password', label: '密码' }],
              onChange: (v) => patch({ auth: Object.assign({}, server.auth, { type: v }) }),
            })),
          (server.auth && server.auth.type) === 'password'
            ? h(Field, { label: '密码凭据名', description: '来自 ctx.credentials，不写明文' },
                h(TextInput, { value: (server.auth && server.auth.passwordRef) || '', onChange: (v) => patch({ auth: Object.assign({}, server.auth, { passwordRef: v }) }) }))
            : h('div', null,
                h(KeyFileField, {
                  server,
                  value: (server.auth && server.auth.keyPath) || '',
                  onChange: (v) => patch({ auth: Object.assign({}, server.auth, { keyPath: v }) }),
                }),
                h(Field, { label: '私钥凭据名', description: '来自 ctx.credentials，不写明文；上方填了文件时以文件优先' },
                  h(TextInput, { value: (server.auth && server.auth.keyRef) || '', onChange: (v) => patch({ auth: Object.assign({}, server.auth, { keyRef: v }) }) }))),
        )
      : null,
    h(Field, {
      label: '工作目录',
      description: workdirHint(server, workdirDirty),
    }, h(TextInput, {
      value: server.workdir || '',
      // 占位示例按平台给：Windows 上 C:\... 才有参考价值
      placeholder: pathPlaceholder('dir'),
      onChange: (v) => {
        setWorkdirDirty(true);
        patch({ workdir: v });
      },
    })),
    h(Field, { label: 'Shell', description: '留空表示自动探测' }, h(TextInput, { value: server.shell || '', placeholder: 'auto', onChange: (v) => patch({ shell: v }) })),
    h(Field, { label: '标签' },
      h(TextInput, { value: (server.tags || []).join(', '), onChange: (v) => patch({ tags: v.split(',').map((s) => s.trim()).filter(Boolean) }) })),
    h(
      'div',
      { className: 'dsh-devops-field-row' },
      h(Field, { label: '允许在该机安装环境' }, h(Switch, { value: !!server.allowProvision, onChange: (v) => patch({ allowProvision: v }) })),
    ),
    h('div', { className: 'dsh-devops-hint' }, '密钥值只从凭据服务或本机私钥文件读取，日志与导出均不会出现明文。'),
  );
}

/** 运行时区块：已装运行时 + 一键安装。 */
function RuntimeSection(props) {
  const server = props.server;
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const runtimes = server.runtimes || {};

  async function install(spec) {
    setBusy(spec);
    setNote('');
    try {
      const result = await api.provisionServer(server.id, spec);
      if (result && result.ok === false) {
        setNote('未能自动提供：' + (result.error || '') + (result.suggestion ? '；建议：' + result.suggestion : ''));
      } else {
        setNote('已就绪：' + JSON.stringify((result && result.resolved) || {}));
      }
      props.onReload();
    } catch (error) {
      setNote(error.message || String(error));
    } finally {
      setBusy('');
    }
  }

  const candidates = ['python:3.11', 'python:3.12', 'node:20', 'node:22'];
  return h(
    Collapsible,
    { title: '运行时与环境', defaultOpen: true },
    h('div', { style: { paddingTop: '6px' } },
      Object.keys(runtimes).length
        ? h(KV, { entries: Object.keys(runtimes).map((key) => [key, (runtimes[key] && runtimes[key].path) || '已解析']) })
        : h('div', { className: 'dsh-devops-hint' }, '还没有解析过运行时'),
      h(
        'div',
        { style: { display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '6px' } },
        candidates.map((spec) =>
          h(Button, { key: spec, size: 'sm', icon: 'download', label: spec, busy: busy === spec, onClick: () => install(spec) }),
        ),
      ),
      h('div', { className: 'dsh-devops-hint', style: { marginTop: '4px' } },
        server.allowProvision ? '该服务器允许自动安装（策略：uv/pyenv/发行版包 → nvm/fnm/mise）' : '该服务器未允许自动安装，缺失时只会给出建议'),
      note ? h('div', { className: 'dsh-devops-field-error', style: { marginTop: '4px' } }, note) : null,
    ),
  );
}

function Servers(props) {
  const servers = props.state.servers || [];
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [detailId, setDetailId] = useState(props.initialServerId || '');

  useEffect(() => {
    props.onReload();
  }, []);

  async function probe(server) {
    setBusyId(server.id);
    try {
      const t0 = Date.now();
      const result = await api.testServer(server.id);
      const ms = Date.now() - t0;
      if (result && result.error) props.toast.error('探测失败：' + result.error);
      else props.toast.ok('连接正常（' + ms + 'ms）');
      await props.onReload();
    } catch (error) {
      props.toast.error('探测失败：' + (error.message || error));
    } finally {
      setBusyId('');
    }
  }

  async function remove(server) {
    if (!confirm('确定删除服务器「' + (server.name || server.id) + '」？')) return;
    try {
      await api.deleteServer(server.id);
      props.toast.ok('已删除');
      await props.onReload();
    } catch (error) {
      props.toast.error(error.message || String(error));
    }
  }

  return h(
    'div',
    null,
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' } },
      h('h2', { className: 'dsh-devops-title' }, '服务器'),
      h('div', { className: 'dsh-devops-spacer' }),
      h(Button, { size: 'sm', icon: 'plus', label: '添加服务器', variant: 'primary', onClick: () => setCreating(true) }),
    ),
    servers.length === 0
      ? h(Empty, { text: '还没有服务器' })
      : h(
          'div',
          { className: 'dsh-devops-grid', 'data-cols': '2' },
          servers.map((server) => {
            const probeInfo = server.probe || {};
            const online = !!probeInfo.at && !probeInfo.error;
            const open = detailId === server.id;
            return h(Card, {
              key: server.id,
              headExtra: h(
                'span',
                { style: { display: 'flex', gap: '4px' } },
                h(Button, { size: 'sm', icon: 'refresh', label: '测试连接', busy: busyId === server.id, onClick: () => probe(server) }),
                h(Button, { size: 'sm', label: '编辑', onClick: () => setEditing(server) }),
                server.id !== 'local' ? h(Button, { size: 'sm', variant: 'danger', icon: 'trash', onClick: () => remove(server) }) : null,
              ),
            },
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' } },
                h(StatusDot, { tone: probeInfo.error ? 'error' : online ? 'ok' : 'idle', title: probeInfo.error || (online ? '在线' : '未探测') }),
                h('span', { style: { fontWeight: 500 } }, server.name),
                h(Chip, null, server.kind === 'local' ? '本机' : 'SSH'),
                probeInfo.sudo && probeInfo.sudo !== 'none' ? h(Chip, null, 'sudo:' + probeInfo.sudo) : null,
                server.allowProvision ? h(Chip, { tone: 'warn' }, '可安装') : null,
              ),
              h(KV, {
                entries: [
                  ['id', h('span', { className: 'dsh-devops-monospace' }, server.id)],
                  ['地址', server.kind === 'local' ? '本机' : (server.host || '—') + ':' + (server.port || 22)],
                  ['用户', server.user || '—'],
                  ['系统', probeInfo.os || '未探测'],
                  ['运行时', Object.keys(server.runtimes || {}).length ? Object.keys(server.runtimes).join('、') : '—'],
                  ['管理器', (probeInfo.managers || []).join('、') || '—'],
                  ['最后探测', probeInfo.at ? fmtAgo(probeInfo.at) : '从未'],
                ],
              }),
              probeInfo.error ? h(Banner, { tone: 'error' }, probeInfo.error) : null,
              h('div', { style: { marginTop: '8px' } },
                h(Button, { size: 'sm', variant: 'ghost', label: open ? '收起详情' : '展开环境区块', onClick: () => setDetailId(open ? '' : server.id) })),
              open
                ? h('div', { style: { marginTop: '8px' } },
                    h(EnvPreview, { server }),
                    h(RuntimeSection, { server, onReload: props.onReload }),
                    probeInfo.runtime && Object.keys(probeInfo.runtime).length
                      ? h(Collapsible, { title: '探测到的运行时明细', defaultOpen: false },
                          h('div', { className: 'dsh-devops-upload-preview', style: { marginTop: '6px' } },
                            Object.keys(probeInfo.runtime).map((k) => h('div', { key: k }, k + ' → ' + probeInfo.runtime[k]))))
                      : null,
                    probeInfo.at ? h('div', { className: 'dsh-devops-hint', style: { marginTop: '6px' } }, '最后探测：' + fmtTime(probeInfo.at)) : null,
                  )
                : null,
            );
          }),
        ),
    creating ? h(ServerModal, { toast: props.toast, onClose: () => setCreating(false), onSaved: props.onReload }) : null,
    editing ? h(ServerModal, { server: editing, toast: props.toast, onClose: () => setEditing(null), onSaved: props.onReload }) : null,
  );
}

exports.Servers = Servers;
exports.blankServer = blankServer;
// 导出以下三项供测试直接验证（不影响界面行为）
exports.ServerModal = ServerModal;
// 导出私钥文件字段控件，供测试直接验证（不影响界面行为）
exports.KeyFileField = KeyFileField;
exports.workdirHint = workdirHint;
exports.describeWorkdirSource = describeWorkdirSource;
});

__def("./page-resources.js", function (module, exports, require) {
/**
 * 资源库页：环境变量组、脚本片段、历史输入。
 */
const { h, useState, useEffect, useMemo, clone, fmtAgo } = require('./h.js');
const { Button, TextInput, TextArea, Select, Card, Empty, Chip, Field, Modal, KV, Banner } = require('./ui.js');
const { api } = require('./api.js');

function blankEnvSet() {
  return { id: 'env-' + Math.random().toString(36).slice(2, 7), name: '新环境变量组', description: '', tags: [], vars: [], createdAt: 0, updatedAt: 0 };
}

function blankSnippet() {
  return { id: 'sn-' + Math.random().toString(36).slice(2, 7), name: '新脚本片段', language: 'shell', description: '', tags: [], body: '', usageCount: 0, createdAt: 0, updatedAt: 0 };
}

/** 环境变量组编辑。 */
function EnvSetModal(props) {
  const [envset, setEnvset] = useState(() => (props.envset ? clone(props.envset) : blankEnvSet()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isNew = !props.envset;

  function patch(next) {
    setEnvset(Object.assign({}, envset, next));
  }

  function setVarAt(index, p) {
    patch({ vars: envset.vars.map((v, i) => (i === index ? Object.assign({}, v, p) : v)) });
  }

  async function save() {
    setBusy(true);
    setError('');
    try {
      if (isNew) await api.createEnvSet(envset);
      else await api.updateEnvSet(envset.id, envset);
      props.toast.ok('已保存');
      props.onClose();
      props.onSaved();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  return h(
    Modal,
    {
      title: isNew ? '新建环境变量组' : '编辑：' + props.envset.name,
      onClose: props.onClose,
      footer: [h(Button, { key: 'c', label: '取消', onClick: props.onClose }), h(Button, { key: 's', label: '保存', variant: 'primary', busy, onClick: save })],
    },
    error ? h(Banner, { tone: 'error' }, error) : null,
    h(Field, { label: '名称', required: true }, h(TextInput, { value: envset.name, onChange: (v) => patch({ name: v }) })),
    h(Field, { label: '标识 id', required: true }, h(TextInput, { value: envset.id, onChange: (v) => patch({ id: v }) })),
    h(Field, { label: '描述' }, h(TextInput, { value: envset.description || '', onChange: (v) => patch({ description: v }) })),
    h(Field, { label: '标签' }, h(TextInput, { value: (envset.tags || []).join(', '), onChange: (v) => patch({ tags: v.split(',').map((s) => s.trim()).filter(Boolean) }) })),
    h('div', { className: 'dsh-devops-field-head', style: { marginTop: '8px' } }, h('span', { className: 'dsh-devops-field-label' }, '变量')),
    h(
      'div',
      { className: 'dsh-devops-list' },
      (envset.vars || []).map((row, index) =>
        h(
          'div',
          { key: index, className: 'dsh-devops-field-row' },
          h(TextInput, { value: row.name, placeholder: '名称', onChange: (v) => setVarAt(index, { name: v }) }),
          h(TextInput, { value: row.value, placeholder: '值', type: row.secret ? 'password' : 'text', onChange: (v) => setVarAt(index, { value: v }) }),
          h(Button, { size: 'sm', variant: 'ghost', icon: row.secret ? 'eye' : 'pause', title: '标记为密钥', onClick: () => setVarAt(index, { secret: !row.secret }) }),
          h(Button, { size: 'sm', variant: 'ghost', icon: 'close', onClick: () => patch({ vars: envset.vars.filter((_, i) => i !== index) }) }),
        ),
      ),
      h(Button, { size: 'sm', icon: 'plus', label: '添加变量', onClick: () => patch({ vars: (envset.vars || []).concat([{ name: '', value: '', secret: false }]) }) }),
    ),
  );
}

/** 脚本片段编辑。 */
function SnippetModal(props) {
  const [snippet, setSnippet] = useState(() => (props.snippet ? clone(props.snippet) : blankSnippet()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isNew = !props.snippet;

  function patch(next) {
    setSnippet(Object.assign({}, snippet, next));
  }

  async function save() {
    setBusy(true);
    setError('');
    try {
      if (isNew) await api.createSnippet(snippet);
      else await api.updateSnippet(snippet.id, snippet);
      props.toast.ok('已保存');
      props.onClose();
      props.onSaved();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  return h(
    Modal,
    {
      title: isNew ? '新建脚本片段' : '编辑：' + props.snippet.name,
      wide: true,
      onClose: props.onClose,
      footer: [h(Button, { key: 'c', label: '取消', onClick: props.onClose }), h(Button, { key: 's', label: '保存', variant: 'primary', busy, onClick: save })],
    },
    error ? h(Banner, { tone: 'error' }, error) : null,
    h(
      'div',
      { className: 'dsh-devops-field-row' },
      h(Field, { label: '名称', required: true }, h(TextInput, { value: snippet.name, onChange: (v) => patch({ name: v }) })),
      h(Field, { label: '语言' },
        h(Select, {
          value: snippet.language || 'shell',
          options: ['shell', 'python', 'javascript', 'json'],
          onChange: (v) => patch({ language: v }),
        })),
    ),
    h(Field, { label: '标识 id' }, h(TextInput, { value: snippet.id, onChange: (v) => patch({ id: v }) })),
    h(Field, { label: '描述' }, h(TextInput, { value: snippet.description || '', onChange: (v) => patch({ description: v }) })),
    h(Field, { label: '脚本内容', required: true }, h(TextArea, { value: snippet.body, rows: 10, onChange: (v) => patch({ body: v }) })),
  );
}

function Resources(props) {
  const [tab, setTab] = useState('envsets');
  const [keyword, setKeyword] = useState('');
  const [envTarget, setEnvTarget] = useState(null);
  const [envCreating, setEnvCreating] = useState(false);
  const [snTarget, setSnTarget] = useState(null);
  const [snCreating, setSnCreating] = useState(false);
  const [recentKeys, setRecentKeys] = useState([]);

  const envsets = props.state.envsets || [];
  const snippets = props.state.snippets || [];

  useEffect(() => {
    props.onReload();
  }, []);

  // 拉历史输入的 key 列表（recent 是 key → values 的集合）
  useEffect(() => {
    api.listRecent()
      .then((value) => {
        if (Array.isArray(value)) setRecentKeys(value);
        else if (value && value.entries) setRecentKeys(value.entries);
        else if (value && typeof value === 'object') setRecentKeys(Object.keys(value).map((key) => ({ key, values: value[key] })));
      })
      .catch(() => {});
  }, [tab]);

  const filteredEnv = envsets.filter((e) => !keyword || (e.name + e.id).toLowerCase().includes(keyword.toLowerCase()));
  const filteredSn = snippets.filter((s) => !keyword || (s.name + s.id + s.body).toLowerCase().includes(keyword.toLowerCase()));

  async function removeEnv(envset) {
    if (!confirm('确定删除环境变量组「' + envset.name + '」？')) return;
    try {
      await api.deleteEnvSet(envset.id);
      props.toast.ok('已删除');
      props.onReload();
    } catch (error) {
      props.toast.error(error.message || String(error));
    }
  }

  async function removeSn(snippet) {
    if (!confirm('确定删除脚本片段「' + snippet.name + '」？')) return;
    try {
      await api.deleteSnippet(snippet.id);
      props.toast.ok('已删除');
      props.onReload();
    } catch (error) {
      props.toast.error(error.message || String(error));
    }
  }

  return h(
    'div',
    null,
    h(
      'div',
      { style: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap' } },
      h(Button, { size: 'sm', label: '环境变量组', active: tab === 'envsets', onClick: () => setTab('envsets') }),
      h(Button, { size: 'sm', label: '脚本片段', active: tab === 'snippets', onClick: () => setTab('snippets') }),
      h(Button, { size: 'sm', label: '历史输入', active: tab === 'recent', onClick: () => setTab('recent') }),
      h('div', { style: { width: '180px' } }, h(TextInput, { value: keyword, placeholder: '搜索', onChange: setKeyword })),
      h('div', { className: 'dsh-devops-spacer' }),
      tab === 'envsets' ? h(Button, { size: 'sm', icon: 'plus', label: '新建变量组', variant: 'primary', onClick: () => setEnvCreating(true) }) : null,
      tab === 'snippets' ? h(Button, { size: 'sm', icon: 'plus', label: '新建片段', variant: 'primary', onClick: () => setSnCreating(true) }) : null,
    ),

    tab === 'envsets'
      ? filteredEnv.length === 0
        ? h(Empty, { text: '还没有环境变量组。变量组可在节点和服务器上被引用，避免重复填写。' })
        : h(
            'div',
            { className: 'dsh-devops-grid', 'data-cols': '2' },
            filteredEnv.map((envset) =>
              h(Card, {
                key: envset.id,
                title: envset.name,
                headExtra: h('span', { style: { display: 'flex', gap: '4px' } },
                  h(Button, { size: 'sm', label: '编辑', onClick: () => setEnvTarget(envset) }),
                  h(Button, { size: 'sm', variant: 'danger', icon: 'trash', onClick: () => removeEnv(envset) })),
              },
                envset.description ? h('div', { className: 'dsh-devops-hint', style: { marginBottom: '6px' } }, envset.description) : null,
                h(KV, { entries: [['标识', h('span', { className: 'dsh-devops-monospace' }, envset.id)], ['变量数', String((envset.vars || []).length)]] }),
                h('div', { className: 'dsh-devops-upload-preview', style: { marginTop: '6px' } },
                  (envset.vars || []).map((v) => h('div', { key: v.name }, v.name + ' = ' + (v.secret ? '••••••' : v.value)))),
              ),
            ),
          )
      : null,

    tab === 'snippets'
      ? filteredSn.length === 0
        ? h(Empty, { text: '还没有脚本片段。片段可复用到任意 shell/node/python 节点的参数里。' })
        : filteredSn.map((snippet) =>
            h(Card, {
              key: snippet.id,
              title: snippet.name,
              headExtra: h('span', { style: { display: 'flex', gap: '4px' } },
                h(Chip, null, snippet.language),
                h(Button, { size: 'sm', label: '编辑', onClick: () => setSnTarget(snippet) }),
                h(Button, { size: 'sm', variant: 'danger', icon: 'trash', onClick: () => removeSn(snippet) })),
            },
              snippet.description ? h('div', { className: 'dsh-devops-hint', style: { marginBottom: '6px' } }, snippet.description) : null,
              h('div', { className: 'dsh-devops-upload-preview' }, snippet.body || '（空）'),
            ),
          )
      : null,

    tab === 'recent'
      ? recentKeys.length === 0
        ? h(Empty, { text: '还没有历史输入记录。填写路径、glob、服务器等字段后会自动记录，方便下次直选。' })
        : h(
            'table',
            { className: 'dsh-devops-table' },
            h('thead', null, h('tr', null, h('th', null, '字段语义键'), h('th', null, '历史值'), h('th', null, '更新时间'))),
            h('tbody', null,
              recentKeys.map((entry) =>
                h('tr', { key: entry.key || JSON.stringify(entry) },
                  h('td', { className: 'dsh-devops-monospace' }, entry.key || '—'),
                  h('td', null, (entry.values || []).slice(0, 8).map((v) =>
                    h('span', { key: v, className: 'dsh-devops-tag', style: { marginRight: '3px' } }, v))),
                  h('td', null, entry.updatedAt ? fmtAgo(entry.updatedAt) : '—'),
                ),
              )),
          )
      : null,

    envCreating ? h(EnvSetModal, { toast: props.toast, onClose: () => setEnvCreating(false), onSaved: props.onReload }) : null,
    envTarget ? h(EnvSetModal, { envset: envTarget, toast: props.toast, onClose: () => setEnvTarget(null), onSaved: props.onReload }) : null,
    snCreating ? h(SnippetModal, { toast: props.toast, onClose: () => setSnCreating(false), onSaved: props.onReload }) : null,
    snTarget ? h(SnippetModal, { snippet: snTarget, toast: props.toast, onClose: () => setSnTarget(null), onSaved: props.onReload }) : null,
  );
}

exports.Resources = Resources;
});

__def("./page-nodes.js", function (module, exports, require) {
/**
 * 节点库页：内置节点目录（分类浏览 + 字段说明）+ 自定义节点管理（含风险提示）。
 */
const { h, useState, useEffect, useMemo } = require('./h.js');
const { Button, TextInput, Select, Card, Empty, Chip, Field, Modal, Banner, TextArea, KV } = require('./ui.js');
const { api } = require('./api.js');

const CATEGORY_TEXT = {
  execute: '执行',
  file: '文件',
  artifact: '产物',
  control: '流程控制',
  wait: '等待',
  pipeline: '子流水线',
  server: '服务器',
  network: '网络',
  notify: '通知',
  util: '工具',
};

const TYPE_TEXT = {
  string: '单行文本',
  text: '多行文本',
  code: '代码',
  'path.dir': '目录',
  'path.file': '文件',
  glob: 'glob 表达式',
  enum: '枚举',
  boolean: '开关',
  number: '数字',
  server: '服务器',
  runtime: '运行时',
  keyvalue: '键值表',
  multiselect: '多选',
  'ref:envset': '环境变量组引用',
  'ref:snippet': '脚本片段引用',
};

/** 自定义节点示例，降低上手成本。 */
const CUSTOM_SAMPLE = `{
  "type": "custom.hello",
  "title": "自定义：打招呼",
  "category": "util",
  "icon": "sparkle",
  "description": "示例自定义节点",
  "fields": [
    { "name": "who", "label": "对象", "type": "string", "required": true, "default": "world" }
  ],
  "outputs": [{ "name": "exitCode", "type": "number" }],
  "run": "async (rt, inputs) => { rt.log('hello ' + inputs.who); return { exitCode: 0 }; }"
}`;

function NodeDetail(props) {
  const node = props.node;
  return h(Card, {
    title: node.title || node.type,
    headExtra: h(Chip, null, CATEGORY_TEXT[node.category] || node.category || '未分类'),
  },
    h('div', { className: 'dsh-devops-hint', style: { marginBottom: '6px' } }, node.type),
    node.description ? h('div', { style: { marginBottom: '8px' } }, node.description) : null,
    node.runtime ? h('div', { className: 'dsh-devops-hint' }, '需要运行时：' + (node.runtime.python ? 'python ' + node.runtime.python : '') + (node.runtime.node ? ' node ' + node.runtime.node : '')) : null,
    (node.fields || []).length
      ? h(
          'table',
          { className: 'dsh-devops-table', style: { marginTop: '8px' } },
          h('thead', null, h('tr', null, h('th', null, '参数'), h('th', null, '类型'), h('th', null, '必填'), h('th', null, '说明'), h('th', null, '默认'))),
          h('tbody', null,
            (node.fields || []).map((field) =>
              h('tr', { key: field.name },
                h('td', null, h('span', { className: 'dsh-devops-monospace' }, field.name), h('div', { className: 'dsh-devops-hint' }, field.label || '')),
                h('td', null, h(Chip, null, TYPE_TEXT[field.type] || field.type || 'string')),
                h('td', null, field.required ? '是' : '—'),
                h('td', { style: { maxWidth: '320px' } }, field.description || '—'),
                h('td', { className: 'dsh-devops-monospace' }, field.default !== undefined && field.default !== '' ? JSON.stringify(field.default) : '—'),
              ),
            )),
        )
      : h('div', { className: 'dsh-devops-hint', style: { marginTop: '6px' } }, '该节点没有参数'),
    (node.outputs || []).length
      ? h('div', { style: { marginTop: '8px' } },
          h('div', { className: 'dsh-devops-hint', style: { marginBottom: '3px' } }, '输出'),
          h(KV, { entries: (node.outputs || []).map((o) => [o.name, o.type || '—']) }))
      : null,
    (node.env || []).length
      ? h('div', { style: { marginTop: '8px' } },
          h('div', { className: 'dsh-devops-hint', style: { marginBottom: '3px' } }, '节点默认环境变量'),
          h(KV, { entries: (node.env || []).map((e) => [e.name, e.value]) }))
      : null,
  );
}

function CustomNodeModal(props) {
  const [text, setText] = useState(CUSTOM_SAMPLE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [parsed, setParsed] = useState(null);

  function parse(value) {
    setText(value);
    if (!value.trim()) {
      setParsed(null);
      setError('');
      return;
    }
    try {
      const obj = JSON.parse(value);
      setParsed(obj);
      setError('');
    } catch (err) {
      setParsed(null);
      setError('JSON 解析失败：' + err.message);
    }
  }

  async function submit() {
    if (!parsed) {
      setError('请先修正 JSON');
      return;
    }
    setBusy(true);
    try {
      await api.registerCustomNode(parsed);
      props.toast.ok('已注册自定义节点 ' + parsed.type);
      props.onClose();
      props.onSaved();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  return h(
    Modal,
    {
      title: '创建自定义节点',
      wide: true,
      onClose: props.onClose,
      footer: [
        h(Button, { key: 'c', label: '取消', onClick: props.onClose }),
        h(Button, { key: 's', label: '注册', variant: 'primary', busy, disabled: !parsed || !props.allowCustom, onClick: submit }),
      ],
    },
    !props.allowCustom
      ? h(Banner, { tone: 'warn' }, '当前设置未开启「允许自定义节点代码」。自定义节点会执行任意代码，请在「设置」页显式开启后再注册。')
      : h(Banner, { tone: 'warn' }, '自定义节点会在服务器上执行任意代码，只注册你完全信任的实现；文件必须位于 dataDir/nodes 内。'),
    h(Field, { label: '节点描述符（JSON）', description: '需要包含 type/title/fields，run 为代码字符串' },
      h(TextArea, { value: text, rows: 14, onChange: parse })),
    error ? h(Banner, { tone: 'error' }, error) : null,
    parsed
      ? h('div', { style: { marginTop: '8px' } },
          h(KV, { entries: [['type', parsed.type || '（缺失）'], ['标题', parsed.title || '（缺失）'], ['参数数', String((parsed.fields || []).length)]] }))
      : null,
  );
}

function Nodes(props) {
  const [keyword, setKeyword] = useState('');
  const [category, setCategory] = useState('');
  const [selected, setSelected] = useState('');
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    props.onReload();
  }, []);

  const nodes = props.state.nodes || [];
  const customNodes = useMemo(() => nodes.filter((n) => n.custom), [nodes]);

  const categories = useMemo(() => {
    const set = new Set();
    for (const n of nodes) if (n.category) set.add(n.category);
    return Array.from(set);
  }, [nodes]);

  const filtered = nodes.filter((n) => {
    if (category && n.category !== category) return false;
    if (!keyword) return true;
    return ((n.title || '') + ' ' + n.type + ' ' + (n.description || '')).toLowerCase().includes(keyword.toLowerCase());
  });

  const selectedNode = nodes.find((n) => n.type === selected);

  async function removeCustom(node) {
    if (!confirm('确定删除自定义节点「' + node.type + '」？已经引用它的流水线会校验失败。')) return;
    try {
      await api.deleteCustomNode(node.type);
      props.toast.ok('已删除');
      props.onReload();
    } catch (error) {
      props.toast.error(error.message || String(error));
    }
  }

  return h(
    'div',
    null,
    h(
      'div',
      { style: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap' } },
      h('h2', { className: 'dsh-devops-title' }, '节点库'),
      h('div', { style: { width: '200px' } }, h(TextInput, { value: keyword, placeholder: '搜索节点', onChange: setKeyword })),
      h('div', { style: { width: '140px' } },
        h(Select, { value: category, placeholder: '全部分类', options: categories.map((c) => ({ value: c, label: CATEGORY_TEXT[c] || c })), onChange: setCategory })),
      h('div', { className: 'dsh-devops-spacer' }),
      h(Button, { size: 'sm', icon: 'refresh', label: '刷新', onClick: props.onReload }),
      h(Button, { size: 'sm', icon: 'plus', label: '创建自定义节点', onClick: () => setCreating(true) }),
    ),

    h(
      'div',
      { style: { display: 'flex', gap: '12px', alignItems: 'flex-start' } },
      h(
        'div',
        { style: { flex: '0 0 260px', maxHeight: '70vh', overflow: 'auto' } },
        h(Card, { title: '内置与自定义节点' },
          filtered.length === 0
            ? h(Empty, { text: '没有匹配的节点' })
            : h(
                'div',
                { className: 'dsh-devops-list' },
                filtered.map((n) =>
                  h(
                    'div',
                    { key: n.type, className: 'dsh-devops-list-row', 'data-active': selected === n.type ? 'true' : undefined, onClick: () => setSelected(n.type) },
                    h('span', { className: 'dsh-devops-truncate' }, n.title || n.type),
                    n.custom ? h(Chip, { tone: 'warn' }, '自定义') : null,
                  ),
                ),
              ),
        ),
        customNodes.length
          ? h(Card, { title: '自定义节点管理' },
              customNodes.map((n) =>
                h('div', { key: n.type, style: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' } },
                  h('span', { className: 'dsh-devops-truncate', style: { flex: 1 } }, n.type),
                  h(Button, { size: 'sm', variant: 'ghost', label: '查看', onClick: () => setSelected(n.type) }),
                  h(Button, { size: 'sm', variant: 'danger', icon: 'trash', onClick: () => removeCustom(n) }),
                ),
              ))
          : null,
      ),
      h('div', { style: { flex: 1, minWidth: 0 } },
        selectedNode
          ? h(NodeDetail, { node: selectedNode })
          : h(Card, { title: '节点说明' },
              h('div', { className: 'dsh-devops-hint' }, '从左侧选择一个节点，查看它的全部参数与输出。共 ' + nodes.length + ' 个节点可用。'),
              h('div', { style: { marginTop: '8px' } },
                h(KV, { entries: [['内置节点', String(nodes.length - customNodes.length)], ['自定义节点', String(customNodes.length)], ['分类数', String(categories.length)]] })),
            ),
      ),
    ),
    creating ? h(CustomNodeModal, {
      toast: props.toast,
      allowCustom: !!(props.state.settings && props.state.settings.allowCustomNodeCode),
      onClose: () => setCreating(false),
      onSaved: props.onReload,
    }) : null,
    detail ? h(Modal, { title: detail.type, onClose: () => setDetail(null) }, h(NodeDetail, { node: detail })) : null,
  );
}

exports.Nodes = Nodes;
exports.CATEGORY_TEXT = CATEGORY_TEXT;
exports.TYPE_TEXT = TYPE_TEXT;
});

__def("./page-settings.js", function (module, exports, require) {
/**
 * 设置页：默认服务器、并发、日志保留、状态栏开关、卡住阈值等。
 * 对应契约 §2.4 settings 单例。
 */
const { h, useState, useEffect } = require('./h.js');
const { Button, TextInput, Select, Switch, Card, Field, Banner, KV } = require('./ui.js');
const { api } = require('./api.js');

function Settings(props) {
  const [settings, setSettings] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.getSettings()
      .then((value) => setSettings(value || {}))
      .catch((err) => setError(err.message || String(err)));
  }, []);

  if (error && !settings) return h(Banner, { tone: 'error' }, error);
  if (!settings) return h('div', { className: 'dsh-devops-empty' }, '加载设置中…');

  function patch(next) {
    setSettings(Object.assign({}, settings, next));
    setSaved(false);
  }

  async function save() {
    setBusy(true);
    setError('');
    try {
      await api.putSettings(settings);
      setSaved(true);
      props.toast.ok('设置已保存');
      props.onReload();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  function exportKind(kind) {
    const url = api.apiUrl('export', { kind });
    window.open(url.toString(), '_blank');
  }

  const servers = props.state.servers || [];

  return h(
    'div',
    { style: { maxWidth: '720px' } },
    h('h2', { className: 'dsh-devops-title', style: { marginBottom: '12px' } }, '设置'),

    error ? h(Banner, { tone: 'error' }, error) : null,
    saved ? h(Banner, { tone: 'ok' }, '已保存') : null,

    h(Card, { title: '执行' },
      h(Field, { label: '默认服务器', description: '新建流水线与节点未指定服务器时使用' },
        h(Select, {
          value: settings.defaultServer || 'local',
          options: servers.map((s) => ({ value: s.id, label: s.name + (s.kind === 'local' ? '（本机）' : '') })),
          onChange: (v) => patch({ defaultServer: v }),
        })),
      h(Field, { label: '默认 Shell' },
        h(Select, {
          value: settings.defaultShell || 'auto',
          options: ['auto', 'bash', 'sh', 'zsh', 'pwsh', 'powershell', 'cmd'],
          onChange: (v) => patch({ defaultShell: v }),
        })),
      h(Field, { label: '最大并发运行数', description: '同时进行的流水线数量' },
        h(TextInput, { type: 'number', min: 1, value: settings.maxConcurrentRuns || 2, onChange: (v) => patch({ maxConcurrentRuns: Number(v) }) })),
      h(Field, { label: '单运行最大并行步骤', description: '同一运行内允许并行执行的步骤上限' },
        h(TextInput, { type: 'number', min: 1, value: settings.maxParallelSteps || 4, onChange: (v) => patch({ maxParallelSteps: Number(v) }) })),
    ),

    h(Card, { title: '日志' },
      h(Field, { label: '日志内存环大小（字节）', description: '超出后前端读到的日志会标记 lossy' },
        h(TextInput, { type: 'number', value: settings.logRingBytes || 524288, onChange: (v) => patch({ logRingBytes: Number(v) }) })),
      h(Field, { label: '日志保留天数' },
        h(TextInput, { type: 'number', min: 1, value: settings.logRetentionDays || 30, onChange: (v) => patch({ logRetentionDays: Number(v) }) })),
    ),

    h(Card, { title: '界面与诊断' },
      h(Field, { label: '显示全局状态栏', description: '在界面右下角显示运行状态' },
        h(Switch, { value: settings.statusBar !== false, onChange: (v) => patch({ statusBar: v }) })),
      h(Field, { label: '卡住判定阈值（秒）', description: '步骤多久没有输出就提示「疑似卡住」' },
        h(TextInput, { type: 'number', min: 5, value: settings.stuckSilenceSec || 60, onChange: (v) => patch({ stuckSilenceSec: Number(v) }) })),
    ),

    h(Card, { title: '安全' },
      h(Field, { label: '允许自定义节点代码', description: '开启后才会加载 dataDir/nodes 下的 .mjs，执行任意代码' },
        h(Switch, { value: !!settings.allowCustomNodeCode, onChange: (v) => patch({ allowCustomNodeCode: v }) })),
      settings.allowCustomNodeCode ? h(Banner, { tone: 'warn' }, '自定义节点代码已启用：只注册你完全信任的实现。') : null,
    ),

    h(Card, { title: '导入导出' },
      h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
        h(Button, { size: 'sm', icon: 'download', label: '导出全部（bundle）', onClick: () => exportKind('bundle') }),
        h(Button, { size: 'sm', icon: 'download', label: '导出流水线', onClick: () => exportKind('pipeline') }),
        h(Button, { size: 'sm', icon: 'download', label: '导出模板', onClick: () => exportKind('template') }),
      ),
      h('div', { className: 'dsh-devops-hint', style: { marginTop: '6px' } }, '导出物中的密钥只保留引用名，不含明文。'),
    ),

    h('div', { style: { display: 'flex', gap: '8px', marginTop: '4px' } },
      h(Button, { label: '保存设置', variant: 'primary', busy, onClick: save }),
      h(Button, { label: '重新载入', onClick: () => { setSettings(null); setError(''); api.getSettings().then(setSettings).catch((e) => setError(e.message)); } }),
    ),

    h(Card, { title: '关于', className: 'dsh-devops-card' , style: { marginTop: '12px' } },
      h(KV, { entries: [['插件', 'dsh-devops'], ['接口契约', 'v1（docs/CONTRACT.md）'], ['前端形态', 'main(key) + sidebar.panellist(id) + shell.overlay']] }),
    ),
  );
}

exports.Settings = Settings;
});

__def("./statusbar.js", function (module, exports, require) {
/**
 * 全局状态栏（shell.overlay）：所有活跃运行的实时列表、当前步骤、实时耗时、
 * 服务器健康灯、失败计数徽标；每条运行可单独点击进入。
 *
 * shell.overlay 是 list 槽且默认可点击穿透，因此外层 pointer-events:none，
 * 只有状态栏本体 auto——不会挡住应用的其它交互。
 *
 * 两个已修复的可用性缺陷（用户报告：状态栏「点不动、还硬显示失败的流水线」）：
 *
 * 1. 焦点语义：过去 pickFocus 在没有活跃运行时会退回「最近一次失败」的运行，
 *    用户看到的就是一条与当下无关的失败记录，像是被硬编码。现在焦点**只**来自
 *    活跃运行（running/queued）；完全空闲时给一句中性空闲态，失败只作为计数徽标。
 * 2. 导航降级：onOpenRun / onNavigate 来自 src/client/index.js 的 navigationRegistry，
 *    而它只有主面板挂载过才会被填充；面板没打开过时 nav 为 null，点击静默失效。
 *    这里用共享 store 的 panelMounted 作为「导航是否可用」的信号，
 *    不可用时渲染可见提示并在点击时给出说明，而不是留一个点不动的死按钮。
 */
const { h, useEffect, useState, useTick, fmtDuration } = require('./h.js');
const { StatusDot, Button } = require('./ui.js');
const { diagnoseStep } = require('./diagnostics.js');
const { runTone, RUN_STATUS_TEXT } = require('./state.js');

/** 一条运行是否「活跃」（正在跑或排队）。 */
function isActiveRun(run) {
  return !!run && (run.status === 'running' || run.status === 'queued');
}

/** 状态栏一次最多平铺几条活跃运行，其余折叠成「+N」。 */
const MAX_VISIBLE_RUNS = 3;

/**
 * 状态栏要展示的全部信息（纯函数，便于直接单测）。
 *
 * 焦点**只**来自活跃运行，且取开始最早的那条（展示最久运行的进度）；
 * 没有活跃运行就是空闲，绝不拿最近一次失败冒充当前状态。
 */
function statusBarModel(state) {
  const runs = (state && state.runs) || [];
  const active = runs.filter(isActiveRun).sort((a, b) => (a.startedAt || Infinity) - (b.startedAt || Infinity));
  const failedCount = runs.filter((r) => r && r.status === 'failed').length;
  const focus = active.length ? active[0] : null;
  // 导航可用性：主面板挂载过，App 的 effect 才会 publishNavigation 填充注册表。
  // panelMounted 是它在共享 store 上的等价信号。
  const navReady = !!(state && (state.panelMounted || state.navRegistered));
  return {
    runs,
    active,
    failedCount,
    focus,
    navReady,
    visible: active.slice(0, MAX_VISIBLE_RUNS),
    overflow: Math.max(0, active.length - MAX_VISIBLE_RUNS),
  };
}

/**
 * 解析一次点击该做什么。
 *
 * nav 不可用时返回 blocked 与一句**可展示**的解释，而不是静默吞掉点击
 * （这正是用户报告的「点了没反应」）。调用方负责把 message 渲染出来。
 */
function resolveNavTarget(nav, target) {
  if (!nav || !nav.ready) {
    return {
      kind: 'blocked',
      message: 'DevOps 面板还没打开过，导航暂时不可用：请先点侧边栏的「DevOps」图标打开面板，再从面板里进入。',
    };
  }
  if (target && target.kind === 'run') {
    if (typeof nav.onOpenRun !== 'function') {
      return { kind: 'blocked', message: '打不开这次运行：宿主没有提供导航入口。' };
    }
    return { kind: 'run', runId: target.runId };
  }
  if (typeof nav.onNavigate !== 'function') {
    return { kind: 'blocked', message: '切换页面失败：宿主没有提供导航入口。' };
  }
  return { kind: 'page', page: target && target.page };
}

/** 运行里当前活跃的步骤（running 优先，否则取第一个 pending）。 */
function activeStep(run) {
  if (!run || !run.steps) return null;
  const steps = Object.keys(run.steps).map((id) => run.steps[id]);
  const running = steps.filter((s) => s.status === 'running');
  if (running.length) return running[0];
  const pending = steps.filter((s) => s.status === 'pending');
  if (pending.length) return pending[0];
  return null;
}

/** 事件冒泡到外层状态栏时不该再触发外层点击。 */
function stopEvent(event) {
  if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
}

/**
 * 渲染一条活跃运行。返回的是普通元素（不是组件），因此可以直接被遍历/断言。
 * showStep 为真时附带「当前步骤 → 名称」与卡住提示（只给焦点那条，避免整条太宽）。
 */
function runSegment(run, options) {
  const opts = options || {};
  const now = opts.now || Date.now();
  const showStep = !!opts.showStep;
  const step = showStep ? activeStep(run) : null;
  const diag = step
    ? diagnoseStep(step, { now, stuckSilenceSec: opts.stuckSilenceSec || 60 })
    : null;
  const elapsed = run.startedAt ? (run.finishedAt || now) - run.startedAt : 0;
  const title = '点击查看这次运行：' + (run.pipelineName || run.pipelineId || run.id);

  return h(
    'span',
    {
      key: run.id,
      className: 'dsh-devops-overlay-seg',
      role: 'button',
      tabIndex: 0,
      title,
      style: { cursor: 'pointer' },
      onClick: (event) => {
        stopEvent(event);
        opts.onActivate && opts.onActivate({ kind: 'run', runId: run.id });
      },
      onKeyDown: (event) => {
        if (event && (event.key === 'Enter' || event.key === ' ')) {
          stopEvent(event);
          if (event.preventDefault) event.preventDefault();
          opts.onActivate && opts.onActivate({ kind: 'run', runId: run.id });
        }
      },
    },
    h('span', { className: 'dsh-devops-overlay-mono' }, run.pipelineName || run.pipelineId || run.id),
    step ? h('span', { style: { color: 'var(--dsw-alias-label-tertiary)' } }, '→ ' + (step.name || step.id)) : null,
    h('span', { className: 'dsh-devops-chip', 'data-tone': runTone(run.status) }, RUN_STATUS_TEXT[run.status] || run.status),
    elapsed ? h('span', { className: 'dsh-devops-overlay-mono' }, fmtDuration(elapsed)) : null,
    diag && diag.live && diag.silentText
      ? h(
          'span',
          { style: { color: diag.stuck ? 'var(--dsw-alias-state-warn-primary)' : 'inherit' } },
          h('span', { className: 'dsh-devops-overlay-mono' }, diag.silentText),
        )
      : null,
  );
}

function StatusBar(props) {
  const state = props.state || {};
  const [hidden, setHidden] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [notice, setNotice] = useState('');
  useTick(true);

  const enabled = !(state.settings && state.settings.statusBar === false);
  const model = statusBarModel(state);
  const nav = {
    ready: model.navReady && typeof props.onOpenRun === 'function',
    onOpenRun: props.onOpenRun,
    onNavigate: props.onNavigate,
  };

  // 提示用完自动消失，免得一直占着状态栏
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  /** 统一的点击入口：能导航就导航，不能导航就把原因显示出来。 */
  function dispatch(target) {
    const action = resolveNavTarget(nav, target);
    if (action.kind === 'blocked') {
      setNotice(action.message);
      return;
    }
    if (action.kind === 'run') nav.onOpenRun(action.runId);
    else nav.onNavigate(action.page);
  }

  // —— 以下为提前 return，所有 hook 必须已经执行完毕 ——
  if (!enabled) return null;

  // 收起态：保留一个最小的「重新打开」入口。
  // （旧版只能右键收起、收起后无法恢复，这是用户说「移不动」的来源。）
  if (hidden) {
    return h(
      'div',
      { className: 'dsh-devops-root dsh-devops-root--bare dsh-devops-overlay' },
      h(
        'div',
        { className: 'dsh-devops-overlay-bar', title: 'DevOps 状态栏已收起' },
        h(StatusDot, { tone: model.active.length ? 'busy' : 'idle' }),
        h('span', null, 'DevOps'),
        h(Button, {
          size: 'sm',
          variant: 'ghost',
          label: '显示状态栏',
          title: '重新展开右下角的 DevOps 状态栏',
          onClick: () => setHidden(false),
        }),
      ),
    );
  }

  const servers = state.servers || [];
  const now = Date.now();

  // 服务器健康：有任何探测失败就是 error；否则有服务器就是 ok
  const healthTone = servers.some((s) => s.probe && s.probe.error)
    ? 'error'
    : servers.length
      ? 'ok'
      : 'idle';
  const healthTitle = servers.some((s) => s.probe && s.probe.error)
    ? '有服务器连接异常'
    : servers.length + ' 台服务器';

  const segments = [];

  // 1) 活跃计数
  segments.push(
    h(
      'span',
      { className: 'dsh-devops-overlay-seg', key: 'active' },
      h(StatusDot, { tone: model.active.length ? 'busy' : 'idle' }),
      h('span', null, model.active.length ? model.active.length + ' 个运行中' : '空闲'),
    ),
  );

  // 2) 空闲态：一句中性描述。失败运行绝不顶上来充当「当前」。
  if (model.active.length === 0) {
    segments.push(
      h(
        'span',
        { className: 'dsh-devops-overlay-seg', key: 'idle' },
        h('span', { style: { color: 'var(--dsw-alias-label-tertiary)' } }, '当前没有运行中的流水线'),
      ),
    );
  }

  // 3) 所有活跃运行，逐条可点
  const listed = showAll ? model.active : model.visible;
  for (const run of listed) {
    segments.push(runSegment(run, {
      now,
      showStep: !showAll && run === model.focus,
      stuckSilenceSec: (state.settings && state.settings.stuckSilenceSec) || 60,
      onActivate: dispatch,
    }));
  }
  if (model.overflow > 0) {
    segments.push(
      h(
        'span',
        { className: 'dsh-devops-overlay-seg', key: 'more' },
        h(Button, {
          size: 'sm',
          variant: 'ghost',
          label: showAll ? '收起' : '+' + model.overflow,
          title: showAll ? '只显示最近 ' + MAX_VISIBLE_RUNS + ' 条' : '还有 ' + model.overflow + ' 个活跃运行',
          onClick: (event) => {
            stopEvent(event);
            setShowAll(!showAll);
          },
        }),
      ),
    );
  }

  // 4) 服务器健康
  segments.push(
    h('span', { className: 'dsh-devops-overlay-seg', key: 'health' },
      h(StatusDot, { tone: healthTone, title: healthTitle })),
  );

  // 5) 失败只作为计数徽标，并且可点（跳运行列表）
  if (model.failedCount > 0) {
    segments.push(
      h(
        'span',
        {
          key: 'failed',
          className: 'dsh-devops-overlay-seg',
          role: 'button',
          tabIndex: 0,
          style: { cursor: 'pointer' },
          title: '有 ' + model.failedCount + ' 次运行失败，点击查看运行列表',
          onClick: (event) => {
            stopEvent(event);
            dispatch({ kind: 'page', page: 'runs' });
          },
        },
        h('span', { className: 'dsh-devops-chip', 'data-tone': 'error' }, model.failedCount + ' 失败'),
      ),
    );
  }

  // 6) 导航不可用时始终给出可见提示（点击时还会追加具体原因）
  if (!nav.ready) {
    segments.push(
      h(
        'span',
        { className: 'dsh-devops-overlay-seg', key: 'navhint', title: 'DevOps 面板还没打开过，状态栏的跳转暂时不可用' },
        h('span', { className: 'dsh-devops-chip', 'data-tone': 'warn' }, '面板未打开'),
      ),
    );
  }

  // 7) 点击降级说明
  if (notice) {
    segments.push(
      h(
        'span',
        { className: 'dsh-devops-overlay-seg', key: 'notice', role: 'status' },
        h('span', { className: 'dsh-devops-chip', 'data-tone': 'warn' }, notice),
      ),
    );
  }

  // 8) 显式收起控件（右键仍然可用，但不再是唯一入口）
  segments.push(
    h(
      'span',
      { className: 'dsh-devops-overlay-seg', key: 'collapse' },
      h(Button, {
        size: 'sm',
        variant: 'ghost',
        label: '收起',
        title: '收起状态栏（收起后可点「显示状态栏」恢复）',
        onClick: (event) => {
          stopEvent(event);
          setHidden(true);
        },
      }),
    ),
  );

  return h(
    'div',
    { className: 'dsh-devops-root dsh-devops-root--bare dsh-devops-overlay' },
    h(
      'div',
      {
        className: 'dsh-devops-overlay-bar',
        'data-clickable': model.focus ? 'true' : undefined,
        title: model.focus ? '点击查看最久运行的那次运行' : 'DevOps 状态',
        onClick: () => {
          if (model.focus) dispatch({ kind: 'run', runId: model.focus.id });
          else dispatch({ kind: 'page', page: 'overview' });
        },
        onContextMenu: (event) => {
          if (event && event.preventDefault) event.preventDefault();
          setHidden(true);
        },
      },
      segments,
    ),
  );
}

exports.StatusBar = StatusBar;
exports.statusBarModel = statusBarModel;
exports.resolveNavTarget = resolveNavTarget;
exports.runSegment = runSegment;
exports.isActiveRun = isActiveRun;
exports.activeStep = activeStep;
exports.MAX_VISIBLE_RUNS = MAX_VISIBLE_RUNS;
});

__def("./app.js", function (module, exports, require) {
/**
 * 应用外壳：数据装载 + 页内二级导航 + 页内状态条 + 八个页面装配。
 *
 * 数据策略：页面切换只读缓存，进入或手动刷新时才请求后端；实时性交给
 * SSE 与本地每秒走秒，避免不必要的轮询。
 */
const { h, useState, useEffect, useMemo, useCallback, useRef, cx, fmtAgo } = require('./h.js');
const { Icon, Button, Chip, StatusDot, useToast } = require('./ui.js');
const { api } = require('./api.js');
const { ensureStyles } = require('./styles.js');
const { createStore, useStore, runTone, RUN_STATUS_TEXT } = require('./state.js');
const { Overview } = require('./page-overview.js');
const { Pipelines } = require('./page-pipelines.js');
const { Templates } = require('./page-templates.js');
const { Runs } = require('./page-runs.js');
const { Servers } = require('./page-servers.js');
const { Resources } = require('./page-resources.js');
const { Nodes } = require('./page-nodes.js');
const { Settings } = require('./page-settings.js');

/**
 * 共享数据源：主面板与全局状态栏（shell.overlay，独立于主面板存在）都订阅它，
 * 保证两处显示一致，且只需一份请求。
 */
const sharedStore = createStore({
  pipelines: [],
  templates: [],
  runs: [],
  servers: [],
  envsets: [],
  snippets: [],
  nodes: [],
  settings: {},
  loading: false,
  error: '',
  sseStatus: 'idle',
  lastEvent: null,
});

const PAGES = [
  { id: 'overview', label: '概览', icon: 'grid' },
  { id: 'pipelines', label: '流水线', icon: 'layers' },
  { id: 'templates', label: '模板', icon: 'box' },
  { id: 'runs', label: '运行', icon: 'play', badge: 'runs' },
  { id: 'servers', label: '服务器', icon: 'server' },
  { id: 'resources', label: '资源库', icon: 'database' },
  { id: 'nodes', label: '节点库', icon: 'terminal' },
  { id: 'settings', label: '设置', icon: 'settings' },
];

/** 页内状态条：SSE 连接状态、活跃运行、队列长度、最近事件。 */
function InlineStatus(props) {
  const state = props.state;
  const runs = state.runs || [];
  const active = runs.filter((r) => r.status === 'running');
  const queued = runs.filter((r) => r.status === 'queued');
  const failed = runs.filter((r) => r.status === 'failed');
  const sse = state.sseStatus || 'idle';
  const sseTone = sse === 'open' ? 'ok' : sse === 'error' ? 'error' : sse === 'connecting' ? 'busy' : 'idle';

  return h(
    'div',
    { className: 'dsh-devops-statusbar-inline' },
    h('span', { className: 'dsh-devops-chip', 'data-tone': sseTone, title: '实时事件流连接状态' },
      h(StatusDot, { tone: sseTone }),
      sse === 'open' ? '实时' : sse === 'connecting' ? '连接中' : sse === 'error' ? '断开' : '未连接'),
    h('span', null, '运行中 ' + active.length),
    h('span', null, '排队 ' + queued.length),
    failed.length ? h('span', { style: { color: 'var(--dsw-alias-state-error-primary)' } }, '失败 ' + failed.length) : null,
    h('div', { className: 'dsh-devops-spacer' }),
    state.lastEvent ? h('span', { title: state.lastEvent.at ? new Date(state.lastEvent.at).toLocaleString() : '' }, '最近事件：' + state.lastEvent.text) : null,
    state.loading ? h('span', null, '同步中…') : null,
  );
}

/**
 * 视图状态的持久化键（sessionStorage）。
 *
 * 用户抱怨「每次离开 devops 界面再回来，之前的状态全部消失了，从概况重新开始」——
 * 根因是面板随侧边栏 slot 卸载，组件内 useState 全部清零。这里把**视图位置**
 * （当前页签、正在编辑/查看的流水线 id）存下来，重进时恢复；
 * 只存轻量标记，不存数据本身，恢复后仍按 id 重新拉取最新数据。
 */
const VIEW_KEY = 'dsh-devops.view';

/** 安全读取视图记忆（隐私模式 / 无 storage 时降级为 null）。 */
function readViewState() {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    const raw = sessionStorage.getItem(VIEW_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** 安全写入视图记忆。 */
function writeViewState(patch) {
  try {
    if (typeof sessionStorage === 'undefined') return;
    const current = readViewState() || {};
    sessionStorage.setItem(VIEW_KEY, JSON.stringify(Object.assign({}, current, patch)));
  } catch {
    /* 存不了就算了，不影响功能 */
  }
}

/** 读取「上次正在编辑的流水线与选中节点」，供页面恢复视图位置。 */
function readEditMemory() {
  const view = readViewState();
  if (!view || typeof view !== 'object') return null;
  return {
    pipelineId: typeof view.editPipelineId === 'string' ? view.editPipelineId : '',
    jobId: typeof view.editJobId === 'string' ? view.editJobId : '',
  };
}

/** 记住「正在编辑的流水线与选中节点」（只存 id，数据仍按 id 现取）。 */
function rememberEdit(pipelineId, jobId) {
  writeViewState({
    editPipelineId: pipelineId || '',
    editJobId: jobId || '',
  });
}

function App(props) {
  const ctx = props.ctx;
  const remembered = readViewState();
  const [page, setPage] = useState(props.initialPage || (remembered && remembered.page) || 'overview');
  /**
   * 页面自己声明「本页内容自行滚动，外层不要滚」。
   * styles.js 里 .dsh-devops-body[data-flush="true"] 早就定义了，但此前**无人设置**，
   * 导致编辑页整页滚动、画布与节点面板无法各自滚动（用户抱怨的滚轮串区）。
   */
  const [bodyFlush, setBodyFlush] = useState(false);
  const [toastNode, toast] = useToast();
  const [initialAction, setInitialAction] = useState(props.initialAction || null);
  const [initialRunId, setInitialRunId] = useState(props.initialRunId || '');
  const [query, setQuery] = useState('');

  const store = sharedStore;
  const state = useStore(store);

  /**
   * 字段控件的数据上下文：只放「服务器 / 环境变量组 / 脚本片段 / 默认服务器」。
   *
   * 不能把宿主 ctx 原样传下去 —— 宿主 ctx 是 Cordis context，读取未 inject
   * 的服务属性会抛 `cannot get property "snippets" without inject`，
   * 点开含引用字段的节点（如 shell.exec 的「引用脚本片段」）就会整块报错。
   */
  const fieldCtx = useMemo(
    () => ({
      servers: state.servers || [],
      envsets: state.envsets || [],
      snippets: state.snippets || [],
      // 流水线候选：pipeline.call 节点的「子流水线」字段要能下拉选择 + 模糊匹配，
      // 因此把列表一并下发（列表接口不含 stages，载荷很轻）。
      pipelines: state.pipelines || [],
      defaultServer: (state.settings && state.settings.defaultServer) || 'local',
    }),
    [state.servers, state.envsets, state.snippets, state.pipelines, state.settings],
  );

  /** 全局刷新：并行拉取所有列表，任一失败不影响其它。 */
  const reload = useCallback(async () => {
    store.setState({ loading: true });
    const results = await Promise.allSettled([
      api.listPipelines(),
      api.listTemplates(),
      api.listRuns({ limit: 50 }),
      api.listServers(),
      api.listEnvSets(),
      api.listSnippets(),
      api.listNodes(),
      api.getSettings(),
    ]);
    const names = ['pipelines', 'templates', 'runs', 'servers', 'envsets', 'snippets', 'nodes', 'settings'];
    const patch = {};
    let firstError = '';
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        const value = result.value;
        // 列表接口可能直接返回数组，也可能包一层 {items}
        const item = names[i] === 'settings' ? value || {} : Array.isArray(value) ? value : (value && (value.items || value.list)) || [];
        patch[names[i]] = item;
      } else {
        const message = result.reason && result.reason.message ? result.reason.message : String(result.reason);
        // 首次加载失败要显式提示；后续刷新只在控制台留痕
        if (!firstError) firstError = names[i] + '：' + message;
      }
    });
    patch.loading = false;
    patch.error = firstError;
    store.setState(patch);
  }, [store]);

  useEffect(() => {
    ensureStyles();
    reload();
  }, [reload]);

  /** 历史输入（recent）：按字段语义键缓存，供类型化控件直接选用。 */
  const recentCache = useRef(new Map());
  const remember = useCallback((key, value) => {
    const list = recentCache.current.get(key) || [];
    const next = [value].concat(list.filter((v) => v !== value)).slice(0, 8);
    recentCache.current.set(key, next);
    api.putRecent(key, next).catch(() => {});
  }, []);
  const recent = useCallback((key) => recentCache.current.get(key) || [], []);

  // 预热最近使用过的路径/glob，让控件首次展开就有候选
  useEffect(() => {
    api.listRecent()
      .then((value) => {
        const entries = Array.isArray(value) ? value : value && value.entries ? value.entries : [];
        for (const entry of entries) {
          if (entry && entry.key) recentCache.current.set(entry.key, entry.values || []);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (state.error) toast.error(state.error);
  }, [state.error]);

  const navigate = useCallback(
    (next, action) => {
      setPage(next);
      writeViewState({ page: next });
      setInitialAction(action || null);
      setQuery('');
      if (action && action.runId) setInitialRunId(action.runId);
    },
    [],
  );

  const openRun = useCallback(
    (runId) => {
      setInitialRunId(runId);
      setPage('runs');
      setQuery('');
    },
    [],
  );

  // 应用外壳把「跳转」能力交给状态栏（它在 shell.overlay 里，独立于本面板）。
  // 同时把「导航已注册」写进共享 store：状态栏据此判断点击能否生效，
  // 不能生效时给可见提示，而不是留一个点不动的死按钮。
  useEffect(() => {
    if (!props.registerNavigation) return;
    props.registerNavigation({ navigate, openRun });
    store.setState({ navRegistered: true });
  }, [navigate, openRun, store]);

  // 页面通过该回调声明是否需要「外层不滚动」（编辑器/运行详情这类内部有滚动区的页面）。
  useEffect(() => {
    writeViewState({ page });
  }, [page]);

  const pageProps = {
    state,
    toast,
    ctx,
    fieldCtx,
    onBodyFlush: setBodyFlush,
    remembered,
    editMemory: readEditMemory(),
    rememberEdit,
    onReload: reload,
    recent,
    remember,
    onNavigate: navigate,
    onOpenRun: openRun,
    initialAction,
    initialRunId,
    onTemplatesChanged: reload,
    // 打开某条流水线：进详情（看定义/阶段/最近运行，并从详情进编辑）。
    onOpenPipeline: (id) => navigate('pipelines', { detail: id }),
    // 直接进某条流水线的编辑器（运行详情里的「编辑流水线」用）。
    onEditPipeline: (id) => navigate('pipelines', { edit: id }),
    initialServerId: initialAction && initialAction.serverId,
  };

  let content = null;
  switch (page) {
    case 'pipelines':
      content = h(Pipelines, pageProps);
      break;
    case 'templates':
      content = h(Templates, pageProps);
      break;
    case 'runs':
      content = h(Runs, pageProps);
      break;
    case 'servers':
      content = h(Servers, pageProps);
      break;
    case 'resources':
      content = h(Resources, pageProps);
      break;
    case 'nodes':
      content = h(Nodes, pageProps);
      break;
    case 'settings':
      content = h(Settings, pageProps);
      break;
    case 'overview':
    default:
      content = h(Overview, pageProps);
      break;
  }

  const runBadge = state.runs.filter((r) => r.status === 'running').length;

  return h(
    'div',
    { className: 'dsh-devops-root' },
    h(
      'nav',
      { className: 'dsh-devops-nav', 'aria-label': 'DevOps 导航' },
      PAGES.map((item) =>
        h(
          'button',
          {
            key: item.id,
            type: 'button',
            className: 'dsh-devops-nav-item',
            'data-active': page === item.id ? 'true' : undefined,
            onClick: () => navigate(item.id),
          },
          h('span', { className: 'dsh-devops-nav-dot' }, h(Icon, { name: item.icon, size: 14 })),
          h('span', { className: 'dsh-devops-truncate' }, item.label),
          item.badge === 'runs' && runBadge > 0
            ? h('span', { className: 'dsh-devops-chip', 'data-tone': 'busy', style: { marginLeft: 'auto' } }, String(runBadge))
            : null,
        ),
      ),
    ),
    h(
      'div',
      { className: 'dsh-devops-main' },
      h(InlineStatus, { state }),
      h('div', { className: 'dsh-devops-body', 'data-flush': bodyFlush ? 'true' : undefined }, content),
    ),
    toastNode,
  );
}

exports.App = App;
exports.PAGES = PAGES;
exports.InlineStatus = InlineStatus;
exports.sharedStore = sharedStore;
});

__def("./index.js", function (module, exports, require) {
/**
 * 插件前端入口。契约 §3.13：
 *
 *   ctx.slots.inject('main',              () => ctx.slots.register({ name:'main', key:'devops' }, Panel))
 *   ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name:'sidebar.panellist', id:'devops', order:40, label:'DevOps' }, Icon))
 *   ctx.slots.inject('shell.overlay',     () => ctx.slots.register({ name:'shell.overlay', id:'devops-statusbar' }, StatusBar))
 *
 * 纪律：
 *  - main 是 keyed 槽，只认 key；key 必须与 sidebar.panellist 的 id 同值（'devops'），
 *    否则要么看不到入口，要么点了没反应。
 *  - 绝不注册 root / sidebar / rightbar / shell.bottom / shell.leading 等 single 槽
 *    （single 槽是替换语义，会挤掉整个应用）。
 *  - 状态栏走 shell.overlay（list 槽，可叠加、默认可点击穿透）。
 *  - 槽组件不会自动收到 ctx，一律用 apply 的闭包把它传下去。
 */
const React = require('react');
const { h, useEffect, useState } = require('./h.js');
const { Icon, Button } = require('./ui.js');
const { ensureStyles } = require('./styles.js');
const { useStore, runTone } = require('./state.js');
const { App, sharedStore } = require('./app.js');
const { StatusBar } = require('./statusbar.js');
const { api } = require('./api.js');

/** 唯一的面板 id：sidebar.panellist 的 id 与 main 的 key 必须同值。 */
const PANEL_ID = 'devops';

/** 面板 ↔ 状态栏之间的导航注册表（两者生命周期独立，无法直接互相引用）。 */
const navigationRegistry = { listeners: new Set(), current: null };

function publishNavigation(nav) {
  navigationRegistry.current = nav;
  for (const listener of Array.from(navigationRegistry.listeners)) {
    try {
      listener(nav);
    } catch {
      /* 单个订阅者出错不影响其它 */
    }
  }
}

/** 侧边栏图标：sidebar.panellist 的注册项渲染的就是这个组件。 */
function DevopsPanelIcon(props) {
  return h(Icon, { name: 'layers', size: (props && props.size) || 16 });
}

/** 面板错误边界：渲染崩溃时给出可重试界面，而不是白屏。 */
class PanelBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error('[dsh-devops] 面板渲染出错', error);
  }

  render() {
    if (this.state.error) {
      return h(
        'div',
        { className: 'dsh-devops-root', style: { display: 'block', padding: '24px' } },
        h('h2', { className: 'dsh-devops-title' }, 'DevOps 面板出错了'),
        h('div', { className: 'dsh-devops-hint', style: { margin: '8px 0 12px' } }, String((this.state.error && this.state.error.message) || this.state.error)),
        h(Button, { label: '重试', icon: 'refresh', onClick: () => this.setState({ error: null }) }),
      );
    }
    return this.props.children;
  }
}

/** 状态栏自举：面板从未打开过时也要有内容可显示。 */
async function bootstrapStatusBar() {
  try {
    const [runs, settings, servers] = await Promise.all([
      api.listRuns({ limit: 20 }).catch(() => []),
      api.getSettings().catch(() => ({})),
      api.listServers().catch(() => []),
    ]);
    sharedStore.setState({
      runs: Array.isArray(runs) ? runs : (runs && runs.items) || [],
      settings: settings || {},
      servers: Array.isArray(servers) ? servers : (servers && servers.items) || [],
    });
  } catch {
    /* 自举失败不应影响宿主 */
  }
  startStatusBarPoll();
}

let pollTimer = null;
/** 状态栏的降级刷新：主面板不在时不订阅 SSE，改用低频轮询。 */
function startStatusBarPoll() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    if (typeof document !== 'undefined' && document.hidden) return;
    // 主面板已挂载时由它统一刷新，这里不重复请求
    if (sharedStore.getState().panelMounted) return;
    try {
      const runs = await api.listRuns({ limit: 20 });
      sharedStore.setState({ runs: Array.isArray(runs) ? runs : (runs && runs.items) || [] });
    } catch {
      /* 忽略瞬时失败 */
    }
  }, 15000);
}

/**
 * 创建三个槽组件。ctx 通过闭包传入——槽组件不会自动收到它。
 */
function createComponents(ctx) {
  function DevopsPanel() {
    useEffect(() => {
      sharedStore.setState({ panelMounted: true });
      return () => sharedStore.setState({ panelMounted: false });
    }, []);
    return h(PanelBoundary, null, h(App, { ctx, registerNavigation: publishNavigation }));
  }

  function DevopsStatusBar() {
    const state = useStore(sharedStore);
    const [nav, setNav] = useState(navigationRegistry.current);

    useEffect(() => {
      navigationRegistry.listeners.add(setNav);
      return () => navigationRegistry.listeners.delete(setNav);
    }, []);

    // 面板没打开过时自举一次，保证状态栏有数据
    useEffect(() => {
      const current = sharedStore.getState();
      if (!current.bootstrapped) {
        sharedStore.setState({ bootstrapped: true });
        bootstrapStatusBar();
      }
    }, []);

    return h(StatusBar, {
      state,
      onOpenRun: (runId) => {
        if (nav && nav.openRun) nav.openRun(runId);
      },
      onNavigate: (page) => {
        if (nav && nav.navigate) nav.navigate(page);
      },
    });
  }

  return { DevopsPanel, DevopsStatusBar };
}

/**
 * 尽力绑定可选服务：宿主缺少它们时不应导致插件挂载失败。
 * 真正的调用发生在用户点击时，由 ai.js 的降级链兜底。
 */
function bindOptionalServices(ctx) {
  if (typeof ctx.inject !== 'function') return;
  for (const name of ['uiWorkspace', 'conversation']) {
    try {
      ctx.inject([name], () => {});
    } catch {
      /* 可选能力 */
    }
  }
}

function apply(ctx) {
  ensureStyles();

  const { DevopsPanel, DevopsStatusBar } = createComponents(ctx);
  bindOptionalServices(ctx);

  // main 是 keyed 槽：只认 key，且必须与 sidebar.panellist 的 id 同值。
  ctx.slots.inject('main', () =>
    ctx.slots.register({ name: 'main', key: PANEL_ID }, DevopsPanel),
  );

  // 侧边栏入口：id 即面板寻址键，order 决定在列表中的位置。
  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      { name: 'sidebar.panellist', id: PANEL_ID, order: 40, label: 'DevOps' },
      DevopsPanelIcon,
    ),
  );

  // 全局状态栏：list 槽，可叠加、可点击穿透（样式里外层 pointer-events:none）。
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register({ name: 'shell.overlay', id: 'devops-statusbar' }, DevopsStatusBar),
  );
}

module.exports = { inject: ['slots'], apply, PANEL_ID };
});

    return __req('./index.js');
  }
});
