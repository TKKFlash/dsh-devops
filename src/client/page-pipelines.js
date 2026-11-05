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
