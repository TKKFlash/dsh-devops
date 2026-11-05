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

/** 检查器宽度约束（px）：可拖拽区间与默认值（「流水线设置」侧栏用）。 */
const INSPECTOR_MIN = 260;
const INSPECTOR_MAX = 720;
const INSPECTOR_DEFAULT = 360;

/**
 * 节点编辑浮层宽度（px）：默认取用户要求的舒适区间（420~520），
 * 并可拖拽左边缘调宽（保留用户上轮要过的「可拉宽」能力，但不是主要交互）。
 */
const SHEET_MIN = 320;
const SHEET_MAX = 1100;
// 默认宽度调大：用户反馈「编辑框默认要更宽一点」——460px 下字段名与控件挤在一起，
// 长脚本也看不清。620px 能舒服放下标签+输入，同时不遮住画布内容。
const SHEET_DEFAULT = 620;

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
      h('div', { className: 'dsh-devops-hint', style: { margin: '4px 2px 6px' } }, '点击节点加入画布（加入选中的列，否则放入最后一列）'),
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
      props.hideHead ? null : h(
      'div',
      { className: 'dsh-devops-inspector-head' },
      h('span', { className: 'dsh-devops-inspector-head-title' }, '流水线设置'),
      h('div', { className: 'dsh-devops-spacer' }),
      props.onCollapse
        ? h(Button, {
            size: 'sm',
            variant: 'ghost',
            icon: 'chevron',
            'data-role': 'inspector-collapse',
            title: '收起检查器',
            onClick: props.onCollapse,
          })
        : null,
    ),
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
    props.hideHead ? null : h(
      'div',
      { className: 'dsh-devops-inspector-head' },
      h('span', { className: 'dsh-devops-inspector-head-title dsh-devops-truncate' }, node ? node.title || job.node : job.node),
      h('span', { className: 'dsh-devops-tag dsh-devops-monospace' }, job.id),
      h('div', { className: 'dsh-devops-spacer' }),
      props.onCollapse
        ? h(Button, {
            size: 'sm',
            variant: 'ghost',
            icon: 'chevron',
            'data-role': 'inspector-collapse',
            title: '收起检查器',
            onClick: props.onCollapse,
          })
        : null,
    ),
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
                  ctx: props.fieldCtx,
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

/**
 * 节点编辑浮层：**覆盖在编排画布之上**的圆角卡片，而不是占一栏的固定检查器。
 *
 * 用户要求（原话）：「点击节点之后虚化背景……去点击编辑层之外的地方，
 * 编辑窗口会自动保存内容收起来。」因此：
 *  - 有选中节点时浮出（遮罩虚化 + elevation 阴影），**覆盖而非挤压**画布；
 *  - 点浮层外部（遮罩）→ 先提交/保存再收起；Esc 同样关闭；
 *  - 浮层内沿用 Inspector 的全部字段控件，不丢任何编辑能力；
 *  - 左边缘可拖拽调宽（附加能力；默认 SHEET_DEFAULT，用户不需要拉也能用）。
 *
 * 与「查看节点信息」（详情页只读抽屉）区分：这里是**可编辑**的编排浮层。
 */
function NodeEditSheet(props) {
  const job = props.job || null;
  const open = !!job;
  const [width, setWidth] = useState(() => {
    try {
      const saved = typeof localStorage !== 'undefined' ? Number(localStorage.getItem('dsh-devops.sheetWidth')) : 0;
      return saved >= SHEET_MIN && saved <= SHEET_MAX ? saved : SHEET_DEFAULT;
    } catch {
      return SHEET_DEFAULT;
    }
  });
  const dragRef = useRef(null);

  function persistWidth(value) {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem('dsh-devops.sheetWidth', String(Math.round(value)));
    } catch {
      /* 隐私模式等场景存不了，忽略 */
    }
  }

  /** 左边缘拖拽：向左拖变宽（浮层贴右侧）。 */
  function startResize(event) {
    if (event && event.preventDefault) event.preventDefault();
    if (event && event.stopPropagation) event.stopPropagation();
    const startX = event && event.clientX !== undefined ? event.clientX : 0;
    const startWidth = width;
    let latest = startWidth;
    dragRef.current = { startX, startWidth };
    const onMove = (e) => {
      const x = e && e.clientX !== undefined ? e.clientX : startX;
      const next = Math.max(SHEET_MIN, Math.min(SHEET_MAX, startWidth - (x - startX)));
      latest = next;
      setWidth(next);
    };
    const onUp = () => {
      if (typeof window === 'undefined') return;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      // 抬手时才落盘，避免拖动过程中反复写 localStorage
      persistWidth(latest);
      dragRef.current = null;
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    }
  }

  // Esc 关闭（与点外部同一条路径：先保存再收起）
  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    const onKey = (event) => {
      if (event && event.key === 'Escape' && props.onClose) props.onClose('esc');
    };
    document.addEventListener('keydown', onKey);
    return () => {
      if (document && document.removeEventListener) document.removeEventListener('keydown', onKey);
    };
  }, [open, props.onClose]);

  return h(
    'div',
    {
      className: 'dsh-devops-editor-sheet-layer',
      'data-role': 'node-edit-layer',
      // 浮层形态：覆盖画布，不挤压布局
      'data-shape': 'floating',
      'data-open': open ? 'true' : 'false',
      'aria-hidden': open ? 'false' : 'true',
    },
    // 遮罩：背景虚化；点它就是「点编辑层之外」→ 自动保存并收起
    h('div', {
      className: 'dsh-devops-editor-sheet-mask',
      'data-role': 'node-edit-mask',
      'data-blur': 'true',
      onClick: () => props.onClose && props.onClose('mask'),
    }),
    h(
      'aside',
      {
        className: 'dsh-devops-editor-sheet',
        'data-role': 'node-edit-sheet',
        'data-variant': 'floating',
        style: { width: width + 'px' },
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': '编辑节点',
        onClick: (event) => {
          // 点浮层内部不应关闭
          if (event && event.stopPropagation) event.stopPropagation();
        },
      },
      // 左边缘拖拽手柄（附加能力）
      h('div', {
        className: 'dsh-devops-editor-sheet-resizer',
        'data-role': 'node-edit-resizer',
        title: '拖拽调整浮层宽度',
        onMouseDown: startResize,
      }),
      h(
        'div',
        { className: 'dsh-devops-editor-sheet-head' },
        h('span', { className: 'dsh-devops-editor-sheet-title dsh-devops-truncate' },
          job ? (job.name || job.id) : ''),
        job ? h('span', { className: 'dsh-devops-tag dsh-devops-monospace' }, job.node) : null,
        h('div', { className: 'dsh-devops-spacer' }),
        h(Button, {
          size: 'sm',
          variant: 'ghost',
          icon: 'close',
          label: '完成',
          'data-role': 'node-edit-close',
          title: '保存并收起（Esc）',
          onClick: () => props.onClose && props.onClose('button'),
        }),
      ),
      h(
        'div',
        { className: 'dsh-devops-editor-sheet-body' },
        open
          ? h(Inspector, {
              job: props.job,
              node: props.node,
              pipeline: props.pipeline,
              servers: props.servers,
              ctx: props.ctx,
              fieldCtx: props.fieldCtx,
              toast: props.toast,
              onPatchJob: props.onPatchJob,
              onPatchPipeline: props.onPatchPipeline,
              onReload: props.onReload,
              recent: props.recent,
              remember: props.remember,
              hideHead: true,
            })
          : null,
      ),
      h(
        'div',
        { className: 'dsh-devops-editor-sheet-foot' },
        h('span', { className: 'dsh-devops-hint' }, '改动已即时保存；点浮层外部或按 Esc 收起'),
      ),
    ),
  );
}

function PipelineEditor(props) {
  const pipeline = props.pipeline;
  const [selectedJob, setSelectedJob] = useState(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const [validation, setValidation] = useState(null);
  const [busy, setBusy] = useState(false);
  const addNodeRef = useRef(null);

  /**
   * 检查器宽度：可拖拽调整并持久化到 localStorage。
   * 用户抱怨「这么窄一个，拉也不能拉宽」——右侧面板固定 288px 且不可调，
   * 写长脚本时完全不够用，因此这里给出可拖拽的边缘 + 收起/展开。
   */
  const [inspectorWidth, setInspectorWidth] = useState(() => {
    try {
      const saved = typeof localStorage !== 'undefined' ? Number(localStorage.getItem('dsh-devops.inspectorWidth')) : 0;
      return saved >= INSPECTOR_MIN && saved <= INSPECTOR_MAX ? saved : INSPECTOR_DEFAULT;
    } catch {
      return INSPECTOR_DEFAULT;
    }
  });
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const dragRef = useRef(null);

  /**
   * 本页自管滚动：挂载时告诉宿主「body 不要再整页滚」（app.js 的 onBodyFlush），
   * 卸载时恢复。否则子区域拿不到有界高度，画布的横向滚动条会被推到页面底部。
   */
  useEffect(() => {
    if (typeof props.onBodyFlush !== 'function') return undefined;
    props.onBodyFlush(true);
    return () => props.onBodyFlush(false);
  }, [props.onBodyFlush]);
  /**
   * 本次浮层会话里是否发生过编辑。
   * 字段控件是「改一次提交一次」（props.onChange 直接写上层 draft），
   * 所以关闭时内容本来就不会丢；这里额外记一笔，用于关闭时做一次显式的
   * **最终提交（flush）**，把「点外部 = 自动保存并收起」落成可观察的行为。
   */
  const sheetDirtyRef = useRef(false);

  function persistWidth(width) {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem('dsh-devops.inspectorWidth', String(Math.round(width)));
    } catch {
      /* 隐私模式等场景下存不了，忽略即可 */
    }
  }

  /** 拖拽分隔条：向左拖变宽、向右拖变窄（面板在右侧）。 */
  function startResize(event) {
    if (event && event.preventDefault) event.preventDefault();
    const startX = event && event.clientX !== undefined ? event.clientX : 0;
    const startWidth = inspectorWidth;
    dragRef.current = { startX, startWidth };

    const onMove = (e) => {
      const x = e && e.clientX !== undefined ? e.clientX : startX;
      const next = Math.max(INSPECTOR_MIN, Math.min(INSPECTOR_MAX, startWidth - (x - startX)));
      setInspectorWidth(next);
    };
    const onUp = () => {
      if (typeof window === 'undefined') return;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      dragRef.current = null;
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    }
  }

  /** 双击分隔条：在默认宽度与最大化之间切换（快捷操作）。 */
  function toggleWide() {
    const next = inspectorWidth >= INSPECTOR_MAX - 20 ? INSPECTOR_DEFAULT : INSPECTOR_MAX;
    setInspectorWidth(next);
    persistWidth(next);
  }

  const jobIndex = useMemo(() => {
    const map = new Map();
    for (const stage of (pipeline.stages || [])) for (const job of stage.jobs || []) map.set(job.id, job);
    return map;
  }, [pipeline]);

  // 删除阶段（或节点）后，原来的 selectedJob 可能已不在 jobIndex 里。
  // 这里天然安全降级：selected 为 null → Inspector 回落到「流水线设置」，
  // 顶部也不会再对一个不存在的节点显示「复制/删除节点」。不要改成抛错或保留旧对象。
  const selected = selectedJob ? jobIndex.get(selectedJob) : null;
  const selectedNode = selected ? (props.nodes || []).find((n) => n.type === selected.node) : null;

  function patchPipeline(patch) {
    props.onChange(Object.assign(clone(pipeline), patch));
  }

  function patchJob(patch) {
    // 契约 §2.1：needs（DAG 调度）与阶段 parallel 不得混用。
    // 画布侧已拦住「先有 needs 再开并行」，这里补上反方向：已有并行阶段时不再允许新增 needs。
    if (patch.needs && patch.needs.length) {
      const parallelStage = (pipeline.stages || []).find((s) => s.parallel);
      if (parallelStage) {
        props.toast.warn(
          '阶段「' + (parallelStage.name || parallelStage.id) + '」已开启并行，契约不允许再声明 needs（DAG 调度）。请先关闭该阶段的并行。',
        );
        return;
      }
    }
    const next = clone(pipeline);
    for (const stage of next.stages || []) {
      const idx = (stage.jobs || []).findIndex((j) => j.id === selectedJob);
      if (idx >= 0) stage.jobs[idx] = Object.assign(stage.jobs[idx], patch);
    }
    sheetDirtyRef.current = true;
    props.onChange(next);
  }

  /**
   * 收起编辑浮层。用户要求「点编辑层之外 → 自动保存内容收起来」：
   * 字段改动本来就是逐次通过 props.onChange 提交的（上层会写进 draft），
   * 这里再做一次「落定」——把当前 pipeline 交给 onSave 的轻量提交路径前先保证
   * 没有未提交的本地草稿；同时把浮层状态清空，回到纯画布视图。
   */
  function closeSheet(reason) {
    // 点浮层外部 / Esc / 点「完成」都走这里：
    // 有过编辑就做一次最终提交（flush），保证「自动保存」而不是「丢弃」。
    if (sheetDirtyRef.current) {
      props.onChange(clone(pipeline));
      sheetDirtyRef.current = false;
    }
    setSelectedJob(null);
    if (props.onSheetClose) props.onSheetClose(reason || 'close');
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
        // minHeight:0 必须显式给：flex 子项默认 min-height:auto 会拒绝收缩，
        // 画布会被内容撑高、自身 overflow:auto 失效（横向滚动条被推到页面底部够不着）。
        { style: { flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 } },
        h(
          'div',
          { className: 'dsh-devops-statusbar-inline' },
          h('span', null, '横向编排：阶段是列，节点在列内自上而下；拖拽可换列换序，双击列标题改名，列头或列间可插入新阶段'),
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
        // 0 节点：保存能成功、validate 也返回 ok（校验口径不看 job 数量），
        // 但引擎在 prepareGraph 里会抛「流水线不可执行：没有任何 job」。
        // 前端必须先把这条预判说清楚，避免用户到点「运行」那一刻才发现。
        countJobs(pipeline) === 0
          ? h(
              Banner,
              { tone: 'warn' },
              '当前没有可运行的节点：保存与校验都会通过，但点「运行」会被拒绝（引擎报「流水线不可执行：没有任何 job」）。请先在左侧节点面板添加节点。',
            )
          : null,
        h(Canvas, {
          pipeline,
          onChange: props.onChange,
          selectedJob,
          onSelectJob: setSelectedJob,
          toast: props.toast,
          registerAddNode: (fn) => {
            addNodeRef.current = fn;
          },
        }),
      ),
      // 可拖拽的分隔条：向左拖宽检查器（右侧面板），双击在默认/最大化间切换。
      // 注意：选中节点时**不占用这一栏** —— 编辑走覆盖画布的浮层（见下方 NodeEditSheet），
      // 这一栏只在「没有选中节点」（流水线设置）时保留。
      h('div', {
        className: 'dsh-devops-inspector-resizer',
        'data-role': 'inspector-resizer',
        'data-open': !selected && inspectorOpen ? 'true' : 'false',
        title: '拖拽调整宽度，双击在默认/最大化之间切换',
        onMouseDown: startResize,
        onDoubleClick: toggleWide,
      }),
      !selected && inspectorOpen
        ? h('div', { className: 'dsh-devops-inspector-host', style: { width: inspectorWidth + 'px' } },
            h(Inspector, {
              job: null,
              node: null,
              pipeline,
              servers: props.servers,
              ctx: props.ctx,
              fieldCtx: props.fieldCtx,
              toast: props.toast,
              onPatchJob: patchJob,
              onPatchPipeline: patchPipeline,
              onReload: props.onReload,
              recent: props.recent,
              remember: props.remember,
              onCollapse: () => setInspectorOpen(false),
            }))
        : null,
      !selected && !inspectorOpen
        ? h('div', { className: 'dsh-devops-inspector-rail' },
            h(Button, {
              size: 'sm',
              variant: 'ghost',
              icon: 'chevron',
              className: 'dsh-devops-inspector-toggle',
              'data-role': 'inspector-toggle',
              title: '展开检查器',
              onClick: () => setInspectorOpen(true),
            }))
        : null,
    ),
    // 节点编辑浮层：覆盖在画布之上（不挤压布局），点外部/Esc 自动保存并收起。
    // 只在选中节点时挂载 —— 收起后浮层与遮罩都不留在 DOM 里，
    // 避免一个隐藏的遮罩常驻并拦截画布点击。
    selected
      ? h(NodeEditSheet, {
          job: selected,
          node: selectedNode,
          pipeline,
          servers: props.servers,
          ctx: props.ctx,
          fieldCtx: props.fieldCtx,
          toast: props.toast,
          onPatchJob: patchJob,
          onPatchPipeline: patchPipeline,
          onReload: props.onReload,
          recent: props.recent,
          remember: props.remember,
          onClose: closeSheet,
        })
      : null,
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
