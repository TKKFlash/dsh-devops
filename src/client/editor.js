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
