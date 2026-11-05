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
