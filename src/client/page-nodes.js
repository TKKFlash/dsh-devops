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
