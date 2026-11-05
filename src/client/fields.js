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
