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
