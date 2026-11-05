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
