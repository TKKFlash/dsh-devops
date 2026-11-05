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
