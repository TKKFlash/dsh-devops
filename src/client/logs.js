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
