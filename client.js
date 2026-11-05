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
const CSS = `
.dsh-devops-root{
  --dv-r-sm: var(--dsw-radius-sm, 6px);
  --dv-r-md: var(--dsw-radius-md, 8px);
  --dv-r-lg: var(--dsw-radius-lg, 12px);
  --dv-r-xl: var(--dsw-radius-panel, 16px);
  --dv-border: var(--dsw-alias-border-l1);
  --dv-border-2: var(--dsw-alias-border-l2);
  --dv-border-3: var(--dsw-alias-border-l3);
  --dv-fg: var(--dsw-alias-label-primary);
  --dv-fg-2: var(--dsw-alias-label-secondary);
  --dv-fg-3: var(--dsw-alias-label-tertiary);
  box-sizing:border-box;
  display:flex;
  min-height:0;
  height:100%;
  width:100%;
  color:var(--dv-fg);
  background:var(--dsw-alias-bg-base);
  font-size:13px;
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
  cursor:pointer;font-size:13px;text-align:left;
}
.dsh-devops-nav-item:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dv-fg)}
.dsh-devops-nav-item[data-active="true"]{background:var(--dsw-alias-interactive-bg-active,hover);color:var(--dv-fg);font-weight:500}
.dsh-devops-nav-dot{
  flex:none;display:inline-flex;align-items:center;justify-content:center;
  width:18px;height:18px;font-size:13px;
}

/* ---------- 主区 ---------- */
.dsh-devops-main{flex:1;min-width:0;display:flex;flex-direction:column;min-height:0}
.dsh-devops-head{
  flex:none;display:flex;align-items:center;gap:10px;flex-wrap:wrap;
  padding:calc(var(--dsh-frame-top-clearance,0px) + 10px) 16px 10px 16px;
  border-bottom:0.5px solid var(--dv-border-3);
}
.dsh-devops-title{font-size:15px;font-weight:500;color:var(--dv-fg);margin:0}
.dsh-devops-sub{color:var(--dv-fg-3);font-size:12px}
.dsh-devops-spacer{flex:1}
.dsh-devops-body{flex:1;min-height:0;overflow:auto;padding:14px 16px 24px 16px}
.dsh-devops-body[data-flush="true"]{padding:0;overflow:hidden;display:flex;flex-direction:column}

/* ---------- 状态条（页内） ---------- */
.dsh-devops-statusbar-inline{
  flex:none;display:flex;align-items:center;gap:12px;flex-wrap:wrap;
  padding:5px 16px;font-size:12px;color:var(--dv-fg-3);
  border-bottom:0.5px solid var(--dv-border-3);
  background:var(--dsw-alias-bg-layer-1);
}
.dsh-devops-chip{
  display:inline-flex;align-items:center;gap:5px;padding:1px 7px;border-radius:999px;
  border:0.5px solid var(--dv-border);font-size:11px;color:var(--dv-fg-2);
  background:var(--dsw-alias-bg-layer-2,#0000);
}
.dsh-devops-chip[data-tone="ok"]{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}
.dsh-devops-chip[data-tone="warn"]{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}
.dsh-devops-chip[data-tone="error"]{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.dsh-devops-chip[data-tone="busy"]{color:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary)}
.dsh-devops-dot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--dsw-alias-state-idle-primary)}
.dsh-devops-dot[data-tone="ok"]{background:var(--dsw-alias-state-success-primary)}
.dsh-devops-dot[data-tone="warn"]{background:var(--dsw-alias-state-warn-primary)}
.dsh-devops-dot[data-tone="error"]{background:var(--dsw-alias-state-error-primary)}
.dsh-devops-dot[data-tone="busy"]{background:var(--dsw-alias-state-business-primary);animation:dsh-devops-pulse 1.2s ease-in-out infinite}
@keyframes dsh-devops-pulse{0%,100%{opacity:.35}50%{opacity:1}}

/* ---------- 通用控件 ---------- */
.dsh-devops-btn{
  display:inline-flex;align-items:center;justify-content:center;gap:6px;
  min-height:28px;padding:3px 10px;border-radius:var(--dv-r-md);cursor:pointer;
  border:0.5px solid var(--dv-border);background:transparent;color:var(--dv-fg);
  font-size:12px;white-space:nowrap;
}
.dsh-devops-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dsh-devops-btn:disabled{opacity:.45;cursor:default}
.dsh-devops-btn[data-variant="primary"]{
  background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));
  border-color:transparent;color:var(--dsw-alias-label-primary-foreground,#fff);
}
.dsh-devops-btn[data-variant="primary"]:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-brand-primary))}
.dsh-devops-btn[data-variant="danger"]{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.dsh-devops-btn[data-variant="ghost"]{border-color:transparent;color:var(--dv-fg-2)}
.dsh-devops-btn[data-size="sm"]{min-height:22px;padding:1px 7px;font-size:11px}
.dsh-devops-btn[data-active="true"]{background:var(--dsw-alias-interactive-bg-active,hover)}
.dsh-devops-input,.dsh-devops-select,.dsh-devops-textarea{
  width:100%;min-height:28px;padding:3px 8px;border-radius:var(--dv-r-md);
  border:0.5px solid var(--dv-border);background:var(--dsw-alias-bg-layer-1,#0000);
  color:var(--dv-fg);font-size:12px;font-family:inherit;outline:none;
}
.dsh-devops-input:focus,.dsh-devops-select:focus,.dsh-devops-textarea:focus{border-color:var(--dsw-alias-state-business-primary)}
.dsh-devops-textarea{min-height:64px;resize:vertical;line-height:18px}
.dsh-devops-input::placeholder,.dsh-devops-textarea::placeholder{color:var(--dsw-alias-label-caption)}
.dsh-devops-select{cursor:pointer}
.dsh-devops-switch{
  position:relative;width:34px;height:18px;border-radius:999px;flex:none;cursor:pointer;
  border:0.5px solid var(--dv-border);background:var(--dsw-alias-bg-layer-2,#0000);padding:0;
}
.dsh-devops-switch[data-on="true"]{background:var(--dsw-alias-brand-primary);border-color:transparent}
.dsh-devops-switch span{
  position:absolute;top:1px;left:1px;width:14px;height:14px;border-radius:50%;
  background:var(--dsw-alias-switch-thumb,#fff);transition:left .12s ease;
}
.dsh-devops-switch[data-on="true"] span{left:17px}

/* ---------- 字段 / 检查器 ---------- */
.dsh-devops-field{display:flex;flex-direction:column;gap:4px;margin-bottom:10px}
.dsh-devops-field-head{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dv-fg-2)}
.dsh-devops-field-label{font-weight:500;color:var(--dv-fg)}
.dsh-devops-required{color:var(--dsw-alias-state-error-primary)}
.dsh-devops-field-desc{font-size:11px;color:var(--dv-fg-3);line-height:16px}
.dsh-devops-field-row{display:flex;gap:6px;align-items:center}
.dsh-devops-field-error{font-size:11px;color:var(--dsw-alias-state-error-primary)}
.dsh-devops-hint{font-size:11px;color:var(--dv-fg-3)}
.dsh-devops-code{
  display:flex;border:0.5px solid var(--dv-border);border-radius:var(--dv-r-md);
  overflow:hidden;background:var(--dsw-alias-markdown-code-block,#0000);font-size:12px;
}
.dsh-devops-code-gutter{
  flex:none;padding:6px 6px 6px 8px;text-align:right;color:var(--dsw-alias-label-caption);
  background:var(--dsw-alias-bg-layer-2,#0000);user-select:none;font-family:var(--dsw-font-family-code,monospace);
  line-height:18px;white-space:pre;
}
.dsh-devops-code-area{
  flex:1;min-height:110px;padding:6px 8px;border:none;outline:none;resize:vertical;
  background:transparent;color:var(--dv-fg);line-height:18px;font-size:12px;
  font-family:var(--dsw-font-family-code,monospace);white-space:pre;overflow-wrap:normal;overflow-x:auto;
}
.dsh-devops-monospace{font-family:var(--dsw-font-family-code,monospace)}

/* ---------- 面板 / 卡片 ---------- */
.dsh-devops-card{
  border:0.5px solid var(--dv-border);border-radius:var(--dv-r-lg);
  background:var(--dsw-alias-bg-layer-1,#0000);padding:12px;margin-bottom:12px;
}
.dsh-devops-card-head{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.dsh-devops-card-title{font-size:13px;font-weight:500;color:var(--dv-fg);margin:0}
.dsh-devops-grid{display:grid;gap:12px}
.dsh-devops-grid[data-cols="2"]{grid-template-columns:repeat(auto-fill,minmax(240px,1fr))}
.dsh-devops-grid[data-cols="3"]{grid-template-columns:repeat(auto-fill,minmax(190px,1fr))}
.dsh-devops-kv{display:grid;grid-template-columns:auto 1fr;gap:3px 10px;font-size:12px}
.dsh-devops-kv dt{color:var(--dv-fg-3)}
.dsh-devops-kv dd{margin:0;color:var(--dv-fg);word-break:break-all}
.dsh-devops-empty{padding:22px;text-align:center;color:var(--dv-fg-3);font-size:12px}
.dsh-devops-list{display:flex;flex-direction:column;gap:4px}
.dsh-devops-list-row{
  display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:var(--dv-r-md);
  border:0.5px solid transparent;cursor:pointer;font-size:12px;
}
.dsh-devops-list-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-devops-list-row[data-active="true"]{background:var(--dsw-alias-interactive-bg-active,hover);border-color:var(--dv-border-2)}
.dsh-devops-truncate{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.dsh-devops-tag{
  display:inline-flex;align-items:center;padding:0 6px;border-radius:999px;
  border:0.5px solid var(--dv-border);font-size:10px;color:var(--dv-fg-3);
}
.dsh-devops-link{color:var(--dsw-alias-link);cursor:pointer;background:none;border:none;padding:0;font-size:12px}

/* ---------- 表格 ---------- */
.dsh-devops-table{width:100%;border-collapse:collapse;font-size:12px}
.dsh-devops-table th{
  text-align:left;font-weight:500;color:var(--dv-fg-3);padding:6px 8px;
  border-bottom:0.5px solid var(--dv-border-3);white-space:nowrap;
}
.dsh-devops-table td{padding:6px 8px;border-bottom:0.5px solid var(--dv-border-2);vertical-align:middle}
.dsh-devops-table tr:hover td{background:var(--dsw-alias-interactive-bg-hover)}

/* ---------- 编辑器三栏 ---------- */
.dsh-devops-editor{flex:1;display:flex;min-height:0}
.dsh-devops-palette{
  flex:none;width:190px;display:flex;flex-direction:column;min-height:0;
  border-right:0.5px solid var(--dv-border-3);overflow:hidden;
}
.dsh-devops-palette-scroll{flex:1;overflow:auto;padding:8px}
.dsh-devops-inspector{
  flex:none;width:288px;display:flex;flex-direction:column;min-height:0;
  border-left:0.5px solid var(--dv-border-3);overflow:hidden;
}
.dsh-devops-inspector-scroll{flex:1;overflow:auto;padding:10px}
.dsh-devops-canvas{flex:1;min-width:0;overflow:auto;position:relative;padding:12px}
.dsh-devops-lane{
  border:0.5px solid var(--dv-border);border-radius:var(--dv-r-lg);margin-bottom:12px;
  background:var(--dsw-alias-bg-layer-1,#0000);
}
.dsh-devops-lane[data-drop="true"]{border-color:var(--dsw-alias-state-business-primary)}
.dsh-devops-lane-head{
  display:flex;align-items:center;gap:8px;padding:6px 10px;
  border-bottom:0.5px solid var(--dv-border-2);
}
.dsh-devops-lane-title{font-size:12px;font-weight:500;color:var(--dv-fg)}
.dsh-devops-lane-cards{display:flex;flex-wrap:wrap;gap:8px;padding:10px;min-height:52px;align-items:flex-start}
.dsh-devops-nodecard{
  position:relative;width:172px;border:0.5px solid var(--dv-border);border-radius:var(--dv-r-md);
  background:var(--dsw-alias-bg-layer-2,#0000);padding:7px 9px;cursor:grab;user-select:none;
}
.dsh-devops-nodecard[data-selected="true"]{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary)}
.dsh-devops-nodecard[data-dragging="true"]{opacity:.5}
.dsh-devops-nodecard-title{font-size:12px;font-weight:500;color:var(--dv-fg);margin-bottom:2px}
.dsh-devops-nodecard-meta{font-size:10px;color:var(--dv-fg-3);display:flex;gap:6px;flex-wrap:wrap}
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
  background:var(--dsw-alias-bg-layer-1,#0000);overflow:hidden;
}
.dsh-devops-stepcard[data-status="failed"]{border-color:var(--dsw-alias-state-error-primary)}
.dsh-devops-stepcard[data-status="running"]{border-color:var(--dsw-alias-state-business-primary)}
.dsh-devops-stepcard-head{
  display:flex;align-items:center;gap:8px;padding:6px 9px;cursor:pointer;
}
.dsh-devops-stepcard-head:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-devops-stepcard-title{font-size:12px;font-weight:500;color:var(--dv-fg)}
.dsh-devops-stepcard-meta{font-size:11px;color:var(--dv-fg-3);display:flex;gap:8px;flex-wrap:wrap}
.dsh-devops-phases{display:flex;gap:3px;align-items:center}
.dsh-devops-phase{
  width:14px;height:4px;border-radius:2px;background:var(--dsw-alias-bg-layer-3,var(--dv-border));
}
.dsh-devops-phase[data-state="done"]{background:var(--dsw-alias-state-success-primary)}
.dsh-devops-phase[data-state="active"]{background:var(--dsw-alias-state-business-primary)}
.dsh-devops-phase[data-state="failed"]{background:var(--dsw-alias-state-error-primary)}

/* ---------- 日志面板 ---------- */
.dsh-devops-logpanel{border-top:0.5px solid var(--dv-border-3);background:var(--dsw-alias-markdown-code-block,#0000)}
.dsh-devops-logbar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:4px 8px;border-bottom:0.5px solid var(--dv-border-2)}
.dsh-devops-logview{
  height:230px;overflow:auto;padding:6px 8px;font-size:11.5px;line-height:17px;
  font-family:var(--dsw-font-family-code,monospace);white-space:pre-wrap;word-break:break-all;
  color:var(--dv-fg-2);
}
.dsh-devops-logline[data-stream="stderr"]{color:var(--dsw-alias-state-error-primary)}
.dsh-devops-logline mark{background:var(--dsw-alias-state-warn-tertiary,#ff0);color:inherit}
.dsh-devops-log-gap{color:var(--dsw-alias-state-warn-primary);font-style:italic}

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
  padding:5px 11px;border-radius:999px;
  border:0.5px solid var(--dv-border-2);
  background:var(--dsw-alias-toast-bg,var(--dsw-alias-bg-layer-3,#1c1c1e));
  color:var(--dsw-alias-toast-label,var(--dv-fg));
  box-shadow:0 4px 16px rgba(0,0,0,.18);
  font-size:12px;
}
.dsh-devops-overlay-bar[data-clickable="true"]{cursor:pointer}
.dsh-devops-overlay-bar[data-clickable="true"]:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-devops-overlay-seg{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
.dsh-devops-overlay-seg+.dsh-devops-overlay-seg{padding-left:10px;border-left:0.5px solid var(--dv-border-2)}
.dsh-devops-overlay-mono{font-variant-numeric:tabular-nums;font-family:var(--dsw-font-family-code,monospace)}

/* ---------- 弹层 ---------- */
.dsh-devops-modal-backdrop{
  position:fixed;inset:0;z-index:1000;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.35));
  display:flex;align-items:center;justify-content:center;padding:24px;
}
.dsh-devops-modal{
  width:min(560px,100%);max-height:86vh;display:flex;flex-direction:column;
  border-radius:var(--dv-r-xl);border:0.5px solid var(--dv-border-2);
  background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base));color:var(--dv-fg);
  box-shadow:0 12px 40px rgba(0,0,0,.28);
}
.dsh-devops-modal[data-wide="true"]{width:min(880px,100%)}
.dsh-devops-modal-head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:0.5px solid var(--dv-border-2)}
.dsh-devops-modal-body{padding:14px;overflow:auto}
.dsh-devops-modal-foot{display:flex;justify-content:flex-end;gap:8px;padding:10px 14px;border-top:0.5px solid var(--dv-border-2)}

/* ---------- 浏览器 / 下拉候选 ---------- */
.dsh-devops-dropdown{
  position:absolute;z-index:1200;margin-top:2px;max-height:216px;overflow:auto;width:100%;
  border:0.5px solid var(--dv-border-2);border-radius:var(--dv-r-md);
  background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base));
  box-shadow:0 8px 24px rgba(0,0,0,.2);
}
.dsh-devops-dropdown-row{display:flex;align-items:center;gap:6px;padding:4px 8px;cursor:pointer;font-size:12px}
.dsh-devops-dropdown-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-devops-dropdown-note{padding:4px 8px;font-size:11px;color:var(--dv-fg-3)}
.dsh-devops-upload-preview{
  max-height:190px;overflow:auto;border:0.5px solid var(--dv-border-2);border-radius:var(--dv-r-md);
  padding:6px 8px;font-size:11.5px;font-family:var(--dsw-font-family-code,monospace);
  background:var(--dsw-alias-bg-layer-2,#0000);color:var(--dv-fg-2);
}
.dsh-devops-banner{
  border-radius:var(--dv-r-md);padding:8px 10px;margin-bottom:10px;font-size:12px;
  border:0.5px solid var(--dv-border-2);background:var(--dsw-alias-bg-layer-2,#0000);color:var(--dv-fg-2);
}
.dsh-devops-banner[data-tone="error"]{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.dsh-devops-banner[data-tone="warn"]{border-color:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-primary)}
.dsh-devops-banner[data-tone="ok"]{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}

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

__def("./fields.js", function (module, exports, require) {
/**
 * 类型化控件库：严格按契约 §4「字段类型 → 控件映射」实现。
 * 控件完全由节点字段描述符驱动，新增节点无需改前端。
 *
 * 表格回顾：
 *  string 单行 | text 多行 | code 代码 | path.dir 目录 | path.file 文件
 *  glob glob+命中预览 | enum 下拉 | boolean 开关 | number 数字
 *  server 服务器 | runtime 运行时 | keyvalue 键值表 | multiselect 标签多选
 *  ref:envset 环境变量组引用 | ref:snippet 脚本片段引用
 */
const { h, useState, useEffect, useRef, useMemo, ellipsis, fmtBytes } = require('./h.js');
const { Icon, Button, Switch, TextInput, TextArea, Select, Field, Chip, Empty } = require('./ui.js');
const { api } = require('./api.js');

/** 一个可被鼠标点击的锚点容器，用于放浏览/预览下拉。 */
function Anchor(props) {
  const ref = useRef(null);
  useEffect(() => {
    props.anchorRef && (props.anchorRef.current = ref.current);
  }, []);
  return h('div', { ref, style: { position: 'relative', flex: 1, minWidth: 0 } }, props.children);
}

/* ------------------------------------------------------------------ *
 * code：行号 + 极简着色
 * ------------------------------------------------------------------ */

const KEYWORDS = {
  shell: /\b(if|then|else|elif|fi|for|while|do|done|case|esac|function|export|local|return|set|cd|echo|exit)\b/g,
  javascript: /\b(const|let|var|function|return|if|else|for|while|await|async|import|export|class|new|try|catch|throw)\b/g,
  python: /\b(def|class|import|from|return|if|elif|else|for|while|try|except|with|as|lambda|None|True|False|await|async)\b/g,
};

/** 极简语法着色：只处理注释、字符串、关键字三类，绝不注入 HTML。 */
function highlight(line, language) {
  const parts = [];
  let rest = line;
  const comment = language === 'shell' || language === 'python' ? /(^|\s)(#.*)$/ : /(\/\/.*)$/;
  const cm = rest.match(comment);
  if (cm) {
    const idx = rest.length - cm[2].length;
    rest = rest.slice(0, idx);
    parts.push([cm[2], 'comment']);
  }
  const tokens = [];
  const re = /("[^"]*"|'[^']*')/;
  let m = rest.match(re);
  while (m) {
    const before = rest.slice(0, m.index);
    tokens.push([before, null]);
    tokens.push([m[1], 'string']);
    rest = rest.slice(m.index + m[1].length);
    m = rest.match(re);
  }
  tokens.push([rest, null]);
  if (parts.length) tokens.push(parts[0]);

  return tokens.map(([text, kind], i) => {
    if (!text) return null;
    if (kind) {
      return h('span', { key: i, style: { color: kind === 'string' ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-label-caption)' } }, text);
    }
    const kw = KEYWORDS[language];
    if (!kw) return h('span', { key: i }, text);
    const pieces = text.split(kw);
    return h(
      'span',
      { key: i },
      pieces.map((piece, j) =>
        j % 2 === 1
          ? h('span', { key: j, style: { color: 'var(--dsw-alias-state-business-primary)' } }, piece)
          : h('span', { key: j }, piece),
      ),
    );
  });
}

function CodeControl(props) {
  const field = props.field;
  const value = props.value === undefined || props.value === null ? '' : String(props.value);
  const language = field.language || 'shell';
  const lines = value.split('\n');
  return h(
    'div',
    { className: 'dsh-devops-code' },
    h(
      'div',
      { className: 'dsh-devops-code-gutter', 'aria-hidden': 'true' },
      lines.map((_, i) => String(i + 1)).join('\n'),
    ),
    h('textarea', {
      className: 'dsh-devops-code-area',
      value,
      spellCheck: false,
      placeholder: field.placeholder || '',
      rows: field.rows || 6,
      onChange: (e) => props.onChange(e.target.value),
      onKeyDown: (e) => {
        // Tab 插入两个空格，避免焦点跑掉
        if (e.key === 'Tab') {
          e.preventDefault();
          const el = e.target;
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
 * 分发器
 * ------------------------------------------------------------------ */

/** 枚举字段的候选值：静态 options、或 optionsFrom 语义来源。 */
function enumOptions(field, ctx) {
  if (Array.isArray(field.options) && field.options.length) return field.options;
  const from = field.optionsFrom;
  if (!from) return [];
  if (from === 'server') return (ctx.servers || []).map((s) => s.id);
  if (from === 'shell') return ['auto', 'bash', 'sh', 'zsh', 'pwsh', 'powershell', 'cmd'];
  if (from.indexOf('runtime:') === 0) {
    const kind = from.slice('runtime:'.length);
    const set = new Set(RUNTIME_VERSIONS[kind] || []);
    for (const server of ctx.servers || []) {
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
        options: enumOptions(field, props.ctx || {}),
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
        options: (props.ctx && props.ctx.servers ? props.ctx.servers : []).map((s) => ({
          value: s.id,
          label: s.name + (s.kind === 'local' ? '（本机）' : ' · ' + (s.host || '')),
        })),
        onChange,
      });
      break;
    case 'runtime':
      control = h(RuntimeControl, Object.assign({}, common, {
        serverId: resolved,
        defaultServer: props.ctx && props.ctx.defaultServer,
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
      control = h(RefControl, Object.assign({}, common, { envsets: props.ctx && props.ctx.envsets }));
      break;
    case 'ref:snippet':
      control = h(RefControl, Object.assign({}, common, { snippets: props.ctx && props.ctx.snippets }));
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
 */
const { h, useState, useEffect, useRef, useMemo, useCallback, fmtBytes } = require('./h.js');
const { Icon, Button, TextInput } = require('./ui.js');
const { api } = require('./api.js');
const { createRunStream } = require('./sse.js');

const MAX_LINES = 5000;

/** 单条日志行；命中过滤词时高亮。 */
function LogLine(props) {
  const line = props.line;
  if (line.gap) {
    return h('div', { className: 'dsh-devops-log-gap' }, '—— 断线期间跳过了 seq ' + line.from + ' ~ ' + line.to + ' ——');
  }
  return h(
    'div',
    { className: 'dsh-devops-logline', 'data-stream': line.stream || 'stdout' },
    props.filter ? highlight(line.text, props.filter) : line.text,
  );
}

function highlight(text, keyword) {
  const idx = text.toLowerCase().indexOf(keyword.toLowerCase());
  if (idx < 0) return text;
  return [
    text.slice(0, idx),
    h('mark', { key: 'k' }, text.slice(idx, idx + keyword.length)),
    text.slice(idx + keyword.length),
  ];
}

/**
 * 日志面板。
 * props: { runId, stepId, live, onClose, meta }
 */
function LogPanel(props) {
  const [lines, setLines] = useState([]);
  const [follow, setFollow] = useState(true);
  const [filter, setFilter] = useState('');
  const [status, setStatus] = useState(props.live ? 'connecting' : 'idle');
  const [bytes, setBytes] = useState(0);
  const [lossy, setLossy] = useState(false);
  const viewRef = useRef(null);
  const fromRef = useRef(0);
  const streamRef = useRef(null);

  /** 历史日志补齐（打开面板或重连后）。 */
  const loadHistory = useCallback(
    async (from) => {
      if (!props.runId) return;
      try {
        const result = await api.runLogs(props.runId, { stepId: props.stepId, from: from || 0 });
        if (!result) return;
        const next = result.lines || [];
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
    [props.runId, props.stepId],
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

  return h(
    'div',
    { className: 'dsh-devops-logpanel' },
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
        // 用户手动往上滚时自动取消跟随，滚回底部再恢复
        onScroll: (e) => {
          const el = e.target;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          if (!atBottom && follow) setFollow(false);
          if (atBottom && !follow) setFollow(true);
        },
      },
      visible.length
        ? visible.map((line, i) => h(LogLine, { key: (line.seq || 'g') + '-' + i, line, filter }))
        : h('div', { className: 'dsh-devops-hint' }, status === 'connecting' ? '正在连接日志流…' : '暂无日志输出'),
    ),
  );
}

exports.LogPanel = LogPanel;
exports.LogLine = LogLine;
});

__def("./canvas.js", function (module, exports, require) {
/**
 * 流水线画布：阶段泳道 + 卡片拖拽（自研，HTML5 DnD）
 * + 「并行」开关 + needs 依赖边（SVG 贝塞尔）。
 * 不引任何拖拽/图表库。
 *
 * 所有结构变更都通过 props.onChange(nextPipeline) 一次性提交完整新对象，
 * 保证不出现「基于过期 props 二次修改」的覆盖问题。
 */
const { h, useState, useEffect, useRef, useMemo } = require('./h.js');
const { Button, Chip } = require('./ui.js');

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

function NodeCard(props) {
  const job = props.job;
  return h(
    'div',
    {
      className: 'dsh-devops-nodecard',
      'data-selected': props.selected ? 'true' : undefined,
      'data-dragging': props.dragging ? 'true' : undefined,
      draggable: true,
      title: '拖拽可调整顺序或移动到其它阶段',
      onClick: (e) => {
        e.stopPropagation();
        props.onSelect(job.id);
      },
      onDragStart: (e) => {
        dragState.current = { jobId: job.id, stageId: props.stageId };
        props.onDragStart && props.onDragStart(job.id);
        try {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', job.id);
        } catch {
          /* 某些环境不允许写 dataTransfer，忽略 */
        }
      },
      onDragEnd: () => {
        dragState.current = null;
        props.onDragEnd && props.onDragEnd();
      },
    },
    h('div', { className: 'dsh-devops-nodecard-title dsh-devops-truncate' }, job.name || job.id),
    h(
      'div',
      { className: 'dsh-devops-nodecard-meta' },
      h('span', null, job.node),
      h('span', null, job.when === 'manual' ? '手动' : job.when === 'always' ? '总是' : '成功时'),
      job.server ? h('span', null, job.server) : null,
    ),
    job.needs && job.needs.length ? h('div', { className: 'dsh-devops-nodecard-meta', style: { marginTop: '3px' } }, 'needs：' + job.needs.join('、')) : null,
  );
}

/**
 * 画布。
 * props: { pipeline, onChange, selectedJob, onSelectJob, registerAddNode }
 */
function Canvas(props) {
  const pipeline = props.pipeline;
  const [dragOverStage, setDragOverStage] = useState('');
  const [draggingJob, setDraggingJob] = useState('');
  const containerRef = useRef(null);
  const [edgePaths, setEdgePaths] = useState([]);

  const stages = (pipeline && pipeline.stages) || [];

  const jobIndex = useMemo(() => {
    const map = new Map();
    for (const stage of stages) {
      for (const job of stage.jobs || []) map.set(job.id, { job, stageId: stage.id });
    }
    return map;
  }, [stages]);

  /** 计算依赖边的贝塞尔路径：从上游卡片右侧到下游卡片左侧。 */
  useEffect(() => {
    function recompute() {
      const root = containerRef.current;
      if (!root) return;
      const rootRect = root.getBoundingClientRect();
      const paths = [];
      for (const stage of stages) {
        for (const job of stage.jobs || []) {
          for (const need of job.needs || []) {
            if (!jobIndex.has(need)) continue;
            const fromEl = root.querySelector('[data-job="' + cssEscape(need) + '"]');
            const toEl = root.querySelector('[data-job="' + cssEscape(job.id) + '"]');
            if (!fromEl || !toEl) continue;
            const a = fromEl.getBoundingClientRect();
            const b = toEl.getBoundingClientRect();
            const x1 = a.right - rootRect.left + root.scrollLeft;
            const y1 = a.top + a.height / 2 - rootRect.top + root.scrollTop;
            const x2 = b.left - rootRect.left + root.scrollLeft;
            const y2 = b.top + b.height / 2 - rootRect.top + root.scrollTop;
            const dx = Math.max(30, Math.abs(x2 - x1) * 0.5);
            paths.push({
              key: need + '->' + job.id,
              d: 'M' + x1 + ',' + y1 + ' C' + (x1 + dx) + ',' + y1 + ' ' + (x2 - dx) + ',' + y2 + ' ' + x2 + ',' + y2,
            });
          }
        }
      }
      setEdgePaths(paths);
    }
    recompute();
    const root = containerRef.current;
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(recompute) : null;
    if (observer && root) observer.observe(root);
    window.addEventListener('resize', recompute);
    const timer = setTimeout(recompute, 60);
    return () => {
      if (observer) observer.disconnect();
      window.removeEventListener('resize', recompute);
      clearTimeout(timer);
    };
  }, [stages, jobIndex, props.selectedJob]);

  /** 把节点加到指定阶段（若没有阶段则先建一个）。 */
  function addNodeToStage(descriptor, stageId) {
    const next = JSON.parse(JSON.stringify(pipeline));
    next.stages = next.stages || [];
    if (next.stages.length === 0) {
      next.stages.push({ id: makeId('stage', []), name: '构建', parallel: false, jobs: [] });
    }
    const stage = stageId ? next.stages.find((s) => s.id === stageId) : next.stages[next.stages.length - 1];
    if (!stage) return;
    const id = makeId((descriptor.type || 'step').split('.').pop(), collectJobIds(next));
    stage.jobs = (stage.jobs || []).concat([newJob(id, descriptor)]);
    props.onChange(next);
    props.onSelectJob && props.onSelectJob(id);
  }

  // 把「加节点」能力交给左侧面板；放到 effect 里避免每次渲染都重设。
  const addNodeRef = useRef(addNodeToStage);
  addNodeRef.current = addNodeToStage;
  useEffect(() => {
    if (props.registerAddNode) {
      props.registerAddNode((descriptor, stageId) => addNodeRef.current(descriptor, stageId));
    }
  });

  function moveJob(jobId, fromStageId, toStageId, beforeJobId) {
    if (fromStageId === toStageId && !beforeJobId) return;
    const next = JSON.parse(JSON.stringify(pipeline));
    let moved = null;
    for (const stage of next.stages) {
      if (stage.id !== fromStageId) continue;
      const idx = (stage.jobs || []).findIndex((j) => j.id === jobId);
      if (idx >= 0) moved = stage.jobs.splice(idx, 1)[0];
    }
    if (!moved) return;
    const target = next.stages.find((s) => s.id === toStageId);
    if (!target) return;
    target.jobs = target.jobs || [];
    if (beforeJobId) {
      const at = target.jobs.findIndex((j) => j.id === beforeJobId);
      if (at >= 0) target.jobs.splice(at, 0, moved);
      else target.jobs.push(moved);
    } else {
      target.jobs.push(moved);
    }
    props.onChange(next);
  }

  function addStage() {
    const next = JSON.parse(JSON.stringify(pipeline));
    next.stages = (next.stages || []).concat([
      { id: makeId('stage', (next.stages || []).map((s) => s.id)), name: '新阶段 ' + ((next.stages || []).length + 1), parallel: false, jobs: [] },
    ]);
    props.onChange(next);
  }

  function updateStage(stageId, patch) {
    const next = JSON.parse(JSON.stringify(pipeline));
    const stage = next.stages.find((s) => s.id === stageId);
    if (!stage) return;
    Object.assign(stage, patch);
    props.onChange(next);
  }

  function removeStage(stageId) {
    const next = JSON.parse(JSON.stringify(pipeline));
    next.stages = next.stages.filter((s) => s.id !== stageId);
    props.onChange(next);
  }

  function moveStage(stageId, delta) {
    const next = JSON.parse(JSON.stringify(pipeline));
    const idx = next.stages.findIndex((s) => s.id === stageId);
    const to = idx + delta;
    if (idx < 0 || to < 0 || to >= next.stages.length) return;
    const item = next.stages.splice(idx, 1)[0];
    next.stages.splice(to, 0, item);
    props.onChange(next);
  }

  const fallbackDescriptor = { type: 'shell.exec', title: '执行 Shell', fields: [{ name: 'script', default: '' }] };

  return h(
    'div',
    { className: 'dsh-devops-canvas', ref: containerRef, onClick: () => props.onSelectJob && props.onSelectJob(null) },
    h(
      'svg',
      { className: 'dsh-devops-edges', width: '100%', height: '100%' },
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
          d: edge.d,
          fill: 'none',
          stroke: 'var(--dsw-alias-border-l4)',
          strokeWidth: 1.2,
          strokeDasharray: '4 3',
          markerEnd: 'url(#dsh-devops-arrow)',
        }),
      ),
    ),
    stages.length === 0 ? h('div', { className: 'dsh-devops-empty' }, '还没有阶段：点左侧节点面板里的任意节点即可开始编排') : null,
    stages.map((stage, stageIndex) =>
      h(
        'div',
        {
          key: stage.id,
          className: 'dsh-devops-lane',
          'data-drop': dragOverStage === stage.id ? 'true' : undefined,
          onDragOver: (e) => {
            e.preventDefault();
            setDragOverStage(stage.id);
          },
          onDragLeave: () => setDragOverStage((cur) => (cur === stage.id ? '' : cur)),
          onDrop: (e) => {
            e.preventDefault();
            setDragOverStage('');
            const data = dragState.current;
            if (data) moveJob(data.jobId, data.stageId, stage.id, null);
          },
          onDoubleClick: () => {
            const name = prompt('阶段名称', stage.name);
            if (name) updateStage(stage.id, { name });
          },
        },
        h(
          'div',
          { className: 'dsh-devops-lane-head' },
          h('span', { className: 'dsh-devops-lane-title' }, stage.name || stage.id),
          h('span', { className: 'dsh-devops-hint' }, (stage.jobs || []).length + ' 个节点'),
          stage.parallel ? h(Chip, { tone: 'busy' }, '并行') : null,
          h('div', { className: 'dsh-devops-spacer' }),
          h(Button, {
            size: 'sm',
            variant: 'ghost',
            label: '并行',
            active: !!stage.parallel,
            title: '阶段内节点是否并行执行（与 needs 不能混用）',
            onClick: () => updateStage(stage.id, { parallel: !stage.parallel }),
          }),
          h(Button, {
            size: 'sm',
            variant: 'ghost',
            icon: 'plus',
            title: '在此阶段添加一个 Shell 节点',
            onClick: () => addNodeToStage(fallbackDescriptor, stage.id),
          }),
          h(Button, { size: 'sm', variant: 'ghost', icon: 'chevron', title: '上移阶段', onClick: () => moveStage(stage.id, -1), disabled: stageIndex === 0 }),
          h(Button, {
            size: 'sm',
            variant: 'ghost',
            icon: 'chevronDown',
            title: '下移阶段',
            onClick: () => moveStage(stage.id, 1),
            disabled: stageIndex === stages.length - 1,
          }),
          h(Button, { size: 'sm', variant: 'ghost', icon: 'trash', title: '删除阶段', onClick: () => removeStage(stage.id) }),
        ),
        h(
          'div',
          {
            className: 'dsh-devops-lane-cards',
            onDragOver: (e) => e.preventDefault(),
            onDrop: (e) => {
              e.preventDefault();
              e.stopPropagation();
              const data = dragState.current;
              if (data) moveJob(data.jobId, data.stageId, stage.id, null);
            },
          },
          (stage.jobs || []).map((job) =>
            h(
              'div',
              { key: job.id, 'data-job': job.id },
              h(NodeCard, {
                job,
                stageId: stage.id,
                selected: props.selectedJob === job.id,
                dragging: draggingJob === job.id,
                onSelect: props.onSelectJob,
                onDragStart: setDraggingJob,
                onDragEnd: () => setDraggingJob(''),
              }),
            ),
          ),
          (stage.jobs || []).length === 0 ? h('span', { className: 'dsh-devops-hint' }, '拖节点到这里') : null,
        ),
      ),
    ),
    h('div', { style: { display: 'flex', gap: '8px', marginTop: '4px' } }, h(Button, { size: 'sm', icon: 'plus', label: '添加阶段', onClick: addStage })),
  );
}

function cssEscape(value) {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(String(value));
  return String(value).replace(/["\\]/g, '\\$&');
}

exports.Canvas = Canvas;
exports.NodeCard = NodeCard;
exports.makeId = makeId;
exports.newJob = newJob;
exports.collectJobIds = collectJobIds;
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
      h('div', { className: 'dsh-devops-hint', style: { margin: '4px 2px 6px' } }, '点击节点加入画布（加入最后/选中阶段）'),
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
                  ctx: props.ctx,
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
function PipelineEditor(props) {
  const pipeline = props.pipeline;
  const [selectedJob, setSelectedJob] = useState(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const [validation, setValidation] = useState(null);
  const [busy, setBusy] = useState(false);
  const addNodeRef = useRef(null);

  const jobIndex = useMemo(() => {
    const map = new Map();
    for (const stage of (pipeline.stages || [])) for (const job of stage.jobs || []) map.set(job.id, job);
    return map;
  }, [pipeline]);

  const selected = selectedJob ? jobIndex.get(selectedJob) : null;
  const selectedNode = selected ? (props.nodes || []).find((n) => n.type === selected.node) : null;

  function patchPipeline(patch) {
    props.onChange(Object.assign(clone(pipeline), patch));
  }

  function patchJob(patch) {
    const next = clone(pipeline);
    for (const stage of next.stages || []) {
      const idx = (stage.jobs || []).findIndex((j) => j.id === selectedJob);
      if (idx >= 0) stage.jobs[idx] = Object.assign(stage.jobs[idx], patch);
    }
    props.onChange(next);
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
        { style: { flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 } },
        h(
          'div',
          { className: 'dsh-devops-statusbar-inline' },
          h('span', null, '拖拽节点调整顺序或换阶段；双击泳道标题可改名'),
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
        h(Canvas, {
          pipeline,
          onChange: props.onChange,
          selectedJob,
          onSelectJob: setSelectedJob,
          registerAddNode: (fn) => {
            addNodeRef.current = fn;
          },
        }),
      ),
      h(Inspector, {
        job: selected,
        node: selectedNode,
        pipeline,
        servers: props.servers,
        ctx: props.ctx,
        toast: props.toast,
        onPatchJob: patchJob,
        onPatchPipeline: patchPipeline,
        onReload: props.onReload,
        recent: props.recent,
        remember: props.remember,
      }),
    ),
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
 * 流水线页：列表 + 编辑器。
 */
const { h, useState, useEffect, useMemo, clone, fmtAgo } = require('./h.js');
const { Button, TextInput, Select, Card, Empty, Chip, Banner, Modal, Field, KV } = require('./ui.js');
const { api } = require('./api.js');
const { PipelineEditor, detectScheduling, countJobs } = require('./editor.js');

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

function PipelineList(props) {
  const pipelines = props.pipelines || [];
  const [keyword, setKeyword] = useState('');
  const [category, setCategory] = useState('');

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
      h('div', { style: { width: '220px' } }, h(TextInput, { value: keyword, placeholder: '搜索名称/描述/标签', onChange: setKeyword })),
      h('div', { style: { width: '150px' } },
        h(Select, {
          value: category,
          placeholder: '全部分类',
          options: categories,
          onChange: setCategory,
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
                h('td', null, h('span', { style: { fontWeight: 500 } }, p.name || '（未命名）')),
                h('td', { className: 'dsh-devops-monospace' }, p.id),
                h('td', null, (p.stages || []).length + ' / ' + countJobs(p)),
                h('td', null, h(Chip, { tone: detectScheduling(p) === 'dag' ? 'busy' : 'idle' }, detectScheduling(p) === 'dag' ? 'DAG' : '阶段')),
                h('td', null, p.category || '—'),
                h('td', null, (p.tags || []).map((t) => h('span', { key: t, className: 'dsh-devops-tag', style: { marginRight: '3px' } }, t))),
                h('td', null, fmtAgo(p.updatedAt)),
                h('td', null,
                  h('span', { style: { display: 'flex', gap: '4px' } },
                    h(Button, { size: 'sm', label: '编辑', onClick: () => props.onEdit(p.id) }),
                    h(Button, { size: 'sm', icon: 'play', label: '运行', onClick: () => props.onRun(p) }),
                    h(Button, { size: 'sm', variant: 'danger', icon: 'trash', onClick: () => props.onDelete(p) }))),
              ),
            )),
        ),
  );
}

function Pipelines(props) {
  const [mode, setMode] = useState('list');
  const [draft, setDraft] = useState(null);
  const [createOpen, setCreateOpen] = useState(!!props.initialAction);
  const [busy, setBusy] = useState(false);
  const [runTarget, setRunTarget] = useState(null);

  // 列表侧数据缺失时拉一次，保证直接进入编辑器也有内容
  useEffect(() => {
    if (props.state.pipelines.length === 0) props.onReload();
  }, []);

  function startCreate(id, name) {
    const base = blankPipeline();
    if (id) base.id = id;
    if (name) base.name = name;
    setDraft(base);
    setMode('edit');
    setCreateOpen(false);
  }

  async function open(id) {
    try {
      const pipeline = await api.getPipeline(id);
      setDraft(pipeline);
      setMode('edit');
    } catch (error) {
      props.toast.error(error.message || String(error));
    }
  }

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
      toast: props.toast,
      recent: props.recent,
      remember: props.remember,
      onSave: save,
      onReload: props.onReload,
      onTemplatesChanged: props.onTemplatesChanged,
      onStarted: (runId) => {
        props.onReload();
        if (runId) props.onOpenRun(runId);
      },
      onBack: () => setMode('list'),
    });
  }

  return h(
    'div',
    null,
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' } },
      h('h2', { className: 'dsh-devops-title' }, '流水线'),
      mode === 'edit' ? h(Button, { size: 'sm', label: '← 返回列表', onClick: () => setMode('list') }) : null,
      h('div', { className: 'dsh-devops-spacer' }),
    ),
    h(PipelineList, {
      pipelines: props.state.pipelines,
      onCreate: () => setCreateOpen(true),
      onEdit: open,
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
exports.blankPipeline = blankPipeline;
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
            ctx: props.ctx,
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
  const [keyword, setKeyword] = useState('');
  const [category, setCategory] = useState('');
  const [favOnly, setFavOnly] = useState(false);
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
      h('div', { style: { width: '220px' } }, h(TextInput, { value: keyword, placeholder: '搜索模板', onChange: setKeyword })),
      h('div', { style: { width: '150px' } }, h(Select, { value: category, placeholder: '全部分类', options: categories, onChange: setCategory })),
      h(Button, { size: 'sm', icon: 'sparkle', label: '只看收藏', active: favOnly, onClick: () => setFavOnly(!favOnly) }),
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

/** 步骤耗时：进行中按当前时间算，结束后用 finishedAt。 */
function stepElapsed(step, now) {
  if (!step || !step.startedAt) return 0;
  return Math.max(0, (step.finishedAt || now) - step.startedAt);
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
    { className: 'dsh-devops-stepcard', 'data-status': step.status },
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
      step.status === 'failed' && !isLive
        ? h('span', { onClick: retryStep, style: { flex: 'none' } }, h(Button, { size: 'sm', icon: 'refresh', label: '重试此步' }))
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
                  { className: 'dsh-devops-logview' },
                  loadingLogs
                    ? '加载日志中…'
                    : logs
                      ? logs.split('\n').slice(-400).map((line, i) => h('div', { key: i, className: 'dsh-devops-logline' }, line))
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
  const [expanded, setExpanded] = useState('');
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
    null,
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' } },
      h(Button, { size: 'sm', icon: 'chevron', label: '← 运行列表', onClick: props.onBack }),
      h('h2', { className: 'dsh-devops-title', style: { margin: 0 } }, run.id),
      h(Chip, { tone: runTone(run.status), dot: true }, RUN_STATUS_TEXT[run.status] || run.status),
      h('span', { className: 'dsh-devops-hint' }, run.pipelineName || run.pipelineId),
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
              { key: stage || 'ungrouped', style: { marginBottom: '10px' } },
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' } },
                h('span', { style: { fontSize: '12px', fontWeight: 500 } }, stage || '未分组'),
                h('span', { className: 'dsh-devops-hint' }, list.length + ' 个步骤'),
                h('div', { className: 'dsh-devops-spacer' }),
                h(Button, {
                  size: 'sm',
                  variant: 'ghost',
                  label: expanded ? '收起' : '全部展开',
                  onClick: () => setExpanded(expanded ? '' : list[0] && list[0].id),
                }),
              ),
              list.map((step) =>
                h(StepCard, {
                  key: step.id,
                  step,
                  runId,
                  now,
                  expanded: expanded === step.id,
                  onToggle: () => setExpanded(expanded === step.id ? '' : step.id),
                  stuckSilenceSec: (props.settings && props.settings.stuckSilenceSec) || 60,
                  server: (props.servers || []).find((s) => s.id === step.server),
                  toast: props.toast,
                  ctx: props.ctx,
                  onRetried: props.onReload,
                }),
              ),
            ),
          ),
    ),
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
                h('td', null, run.pipelineName || run.pipelineId),
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
exports.StepCard = StepCard;
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
    auth: { type: 'key', keyRef: '', passwordRef: '' },
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
            : h(Field, { label: '私钥凭据名', description: '来自 ctx.credentials，不写明文' },
                h(TextInput, { value: (server.auth && server.auth.keyRef) || '', onChange: (v) => patch({ auth: Object.assign({}, server.auth, { keyRef: v }) }) })),
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
    h('div', { className: 'dsh-devops-hint' }, '密钥值只从凭据服务解析，日志与导出均不会出现明文。'),
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
 * 全局状态栏（shell.overlay）：活跃运行数、当前运行→当前步骤、实时耗时、
 * 服务器健康灯、失败徽标；单击跳转到对应运行。
 *
 * shell.overlay 是 list 槽且默认可点击穿透，因此外层 pointer-events:none，
 * 只有状态栏本体 auto——不会挡住应用的其它交互。
 */
const { h, useEffect, useState, useMemo, useTick, fmtDuration } = require('./h.js');
const { StatusDot } = require('./ui.js');
const { diagnoseStep } = require('./diagnostics.js');
const { runTone, RUN_STATUS_TEXT } = require('./state.js');

/** 找出当前该展示的运行：优先运行中，其次最近一次失败的。 */
function pickFocus(runs) {
  const running = runs.filter((r) => r.status === 'running' || r.status === 'queued');
  if (running.length > 0) {
    // 多个活跃运行时取开始最早的那个，展示最久运行
    return running.reduce((a, b) => ((a.startedAt || Infinity) <= (b.startedAt || Infinity) ? a : b));
  }
  const failed = runs.filter((r) => r.status === 'failed');
  if (failed.length > 0) {
    return failed.reduce((a, b) => ((a.finishedAt || 0) >= (b.finishedAt || 0) ? a : b));
  }
  return runs[0] || null;
}

/** 运行里当前活跃的步骤（running 优先，否则取最后开始的）。 */
function activeStep(run) {
  if (!run || !run.steps) return null;
  const steps = Object.keys(run.steps).map((id) => run.steps[id]);
  const running = steps.filter((s) => s.status === 'running');
  if (running.length) return running[0];
  const pending = steps.filter((s) => s.status === 'pending');
  if (pending.length) return pending[0];
  return null;
}

function StatusBar(props) {
  const state = props.state;
  const runs = state.runs || [];
  const [hidden, setHidden] = useState(false);
  useTick(true);

  const enabled = !(state.settings && state.settings.statusBar === false);
  if (!enabled || hidden) return null;

  const active = runs.filter((r) => r.status === 'running' || r.status === 'queued');
  const failedCount = runs.filter((r) => r.status === 'failed').length;
  const servers = state.servers || [];
  const focus = pickFocus(runs);
  const step = activeStep(focus);
  const now = Date.now();

  const diag = step ? diagnoseStep(step, { now, stuckSilenceSec: (state.settings && state.settings.stuckSilenceSec) || 60 }) : null;
  const elapsed = focus && focus.startedAt ? (focus.finishedAt || now) - focus.startedAt : 0;

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

  segments.push(
    h(
      'span',
      { className: 'dsh-devops-overlay-seg', key: 'active' },
      h(StatusDot, { tone: active.length ? 'busy' : 'idle' }),
      h('span', null, active.length ? active.length + ' 个运行中' : '空闲'),
    ),
  );

  if (focus) {
    const tone = runTone(focus.status);
    segments.push(
      h(
        'span',
        { className: 'dsh-devops-overlay-seg', key: 'focus' },
        h('span', { className: 'dsh-devops-overlay-mono' }, focus.pipelineName || focus.pipelineId || focus.id),
        step ? h('span', { style: { color: 'var(--dsw-alias-label-tertiary)' } }, '→ ' + (step.name || step.id)) : null,
        h('span', { className: 'dsh-devops-chip', 'data-tone': tone }, RUN_STATUS_TEXT[focus.status] || focus.status),
      ),
    );
    if (elapsed) {
      segments.push(
        h('span', { className: 'dsh-devops-overlay-seg', key: 'elapsed' },
          h('span', { className: 'dsh-devops-overlay-mono' }, fmtDuration(elapsed))),
      );
    }
    if (diag && diag.live && diag.silentText) {
      segments.push(
        h(
          'span',
          { className: 'dsh-devops-overlay-seg', key: 'silent', style: { color: diag.stuck ? 'var(--dsw-alias-state-warn-primary)' : 'inherit' } },
          h('span', { className: 'dsh-devops-overlay-mono' }, diag.silentText),
        ),
      );
    }
  }

  segments.push(
    h('span', { className: 'dsh-devops-overlay-seg', key: 'health' },
      h(StatusDot, { tone: healthTone, title: healthTitle })),
  );

  if (failedCount > 0) {
    segments.push(
      h('span', { className: 'dsh-devops-overlay-seg', key: 'failed' },
        h('span', { className: 'dsh-devops-chip', 'data-tone': 'error' }, failedCount + ' 失败')),
    );
  }

  return h(
    'div',
    { className: 'dsh-devops-root dsh-devops-root--bare dsh-devops-overlay' },
    h(
      'div',
      {
        className: 'dsh-devops-overlay-bar',
        'data-clickable': focus ? 'true' : undefined,
        title: focus ? '点击查看这次运行' : 'DevOps 状态',
        onClick: () => {
          if (focus) props.onOpenRun(focus.id);
          else props.onNavigate('overview');
        },
        onContextMenu: (e) => {
          e.preventDefault();
          setHidden(true);
        },
      },
      segments,
    ),
  );
}

exports.StatusBar = StatusBar;
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

function App(props) {
  const ctx = props.ctx;
  const [page, setPage] = useState(props.initialPage || 'overview');
  const [toastNode, toast] = useToast();
  const [initialAction, setInitialAction] = useState(props.initialAction || null);
  const [initialRunId, setInitialRunId] = useState(props.initialRunId || '');
  const [query, setQuery] = useState('');

  const store = sharedStore;
  const state = useStore(store);

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

  // 应用外壳把「跳转」能力交给状态栏（它在 shell.overlay 里，独立于本面板）
  useEffect(() => {
    if (props.registerNavigation) props.registerNavigation({ navigate, openRun });
  }, [navigate, openRun]);

  const pageProps = {
    state,
    toast,
    ctx,
    onReload: reload,
    recent,
    remember,
    onNavigate: navigate,
    onOpenRun: openRun,
    initialAction,
    initialRunId,
    onTemplatesChanged: reload,
    onOpenPipeline: (id) => navigate('pipelines', { edit: id }),
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
      h('div', { className: 'dsh-devops-body' }, content),
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
