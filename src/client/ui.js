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
