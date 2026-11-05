/**
 * 模板页：列表（分类标签 + 搜索 + 收藏）+「从模板创建」按参数类型渲染表单
 * → 预览 → 创建；以及模板的新建/编辑/删除。
 *
 * 从流水线存模板在编辑器里完成（存为模板），这里负责消费。
 */
const { h, useState, useEffect, useMemo, clone } = require('./h.js');
const { Button, TextInput, Select, Card, Empty, Chip, Field, Modal, KV, Banner, Switch } = require('./ui.js');
const { FieldControl } = require('./fields.js');
const { api } = require('./api.js');

/* ------------------------------------------------------------------ *
 * 视图记忆（模板页筛选）：与 page-pipelines.js / app.js 同一套约定，
 * 读写 sessionStorage 的 'dsh-devops.view'，只存标量筛选条件。
 * ------------------------------------------------------------------ */
const VIEW_KEY = 'dsh-devops.view';

/** 安全读取视图记忆（无 storage / JSON 损坏时降级为 null）。 */
function readViewState() {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    const raw = sessionStorage.getItem(VIEW_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** 安全写入视图记忆（合并既有值；存不了不影响功能）。 */
function writeViewState(patch) {
  try {
    if (typeof sessionStorage === 'undefined') return;
    const current = readViewState() || {};
    sessionStorage.setItem(VIEW_KEY, JSON.stringify(Object.assign({}, current, patch)));
  } catch {
    /* 忽略：存不了不影响功能 */
  }
}

/** 解析模板页筛选状态（只认标量，非法值降级为空/关闭）。 */
function resolveTemplateFilters(remembered) {
  const view = remembered && typeof remembered === 'object' ? remembered : null;
  return {
    keyword: view && typeof view.templatesKeyword === 'string' ? view.templatesKeyword : '',
    category: view && typeof view.templatesCategory === 'string' ? view.templatesCategory : '',
    favOnly: !!(view && view.templatesFavOnly === true),
  };
}

/** 从模板参数生成一份表单初值。 */
function initialParams(template) {
  const out = {};
  for (const param of template.parameters || []) {
    out[param.name] = param.default !== undefined && param.default !== null ? param.default : param.type === 'boolean' ? false : '';
  }
  return out;
}

/** 校验必填参数。 */
function missingRequired(template, params) {
  const missing = [];
  for (const param of template.parameters || []) {
    if (!param.required) continue;
    const value = params[param.name];
    if (value === undefined || value === null || value === '') missing.push(param.label || param.name);
  }
  return missing;
}

/** 用模板参数即时预览插值结果（${{ params.x }}）。 */
function previewInterpolate(value, params) {
  if (typeof value === 'string') {
    return value.replace(/\$\{\{\s*params\.([A-Za-z0-9_]+)\s*\}\}/g, (all, name) => {
      const v = params[name];
      return v === undefined || v === '' ? all : String(v);
    });
  }
  if (Array.isArray(value)) return value.map((item) => previewInterpolate(item, params));
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) out[key] = previewInterpolate(value[key], params);
    return out;
  }
  return value;
}

/** 模板参数表单：完全按 parameter.type 分发到类型化控件。 */
function TemplateParamsForm(props) {
  return h(
    'div',
    null,
    (props.template.parameters || []).length === 0
      ? h('div', { className: 'dsh-devops-hint' }, '该模板没有参数，直接创建即可。')
      : (props.template.parameters || []).map((param) =>
          h(FieldControl, {
            key: param.name,
            // 模板参数与节点字段同构，直接复用同一套控件（契约 §4）
            field: Object.assign({}, param, {
              label: param.label || param.name,
              description: param.description || '',
              type: param.type || 'string',
              field: undefined,
            }),
            value: props.params[param.name],
            onChange: (v) => props.onChange(Object.assign({}, props.params, { [param.name]: v })),
            ctx: props.fieldCtx || props.ctx,
            serverId: props.state.settings && props.state.settings.defaultServer,
            serverFor: (id) => (props.state.servers || []).find((s) => s.id === id),
            recent: props.recent,
            remember: props.remember,
            ownerId: 'tpl-' + props.template.id + '-' + param.name,
          }),
        ),
  );
}

/** 「从模板创建」向导：填参数 → 预览 → 创建。 */
function InstantiateModal(props) {
  const template = props.template;
  const [params, setParams] = useState(() => initialParams(template));
  const [step, setStep] = useState('form');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState(template.name.replace(/模板$/, '').trim() || template.name);

  const missing = missingRequired(template, params);
  const localPreview = useMemo(() => previewInterpolate(template.body, params), [template, params]);

  async function doPreview() {
    setBusy(true);
    setError('');
    try {
      const result = await api.instantiateTemplate(template.id, params);
      setPreview(result && result.pipeline ? result.pipeline : result);
      setStep('preview');
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    setBusy(true);
    setError('');
    try {
      const pipeline = clone(preview || localPreview);
      pipeline.id = pipeline.id || template.id + '-' + Math.random().toString(36).slice(2, 6);
      if (name && name !== pipeline.name) pipeline.name = name;
      await api.createPipeline(pipeline);
      props.toast.ok('已从模板创建流水线');
      props.onClose();
      props.onCreated && props.onCreated(pipeline.id);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  return h(
    Modal,
    {
      title: '从模板创建：' + (template.name || template.id),
      wide: step === 'preview',
      onClose: props.onClose,
      footer:
        step === 'form'
          ? [
              h(Button, { key: 'c', label: '取消', onClick: props.onClose }),
              h(Button, { key: 'n', label: '预览', disabled: missing.length > 0, busy, onClick: doPreview }),
            ]
          : [
              h(Button, { key: 'b', label: '← 改参数', onClick: () => setStep('form') }),
              h(Button, { key: 'ok', label: '创建流水线', variant: 'primary', busy, onClick: create }),
            ],
    },
    error ? h(Banner, { tone: 'error' }, error) : null,
    step === 'form'
      ? h(
          'div',
          null,
          template.description ? h('div', { className: 'dsh-devops-hint', style: { marginBottom: '10px' } }, template.description) : null,
          h(Field, { label: '流水线名称' }, h(TextInput, { value: name, onChange: setName })),
          h(TemplateParamsForm, {
            template,
            params,
            onChange: setParams,
            ctx: props.ctx,
            fieldCtx: props.fieldCtx,
            state: props.state,
            recent: props.recent,
            remember: props.remember,
          }),
          missing.length ? h(Banner, { tone: 'warn' }, '还有必填参数未填：' + missing.join('、')) : null,
        )
      : h(
          'div',
          null,
          h('div', { className: 'dsh-devops-hint', style: { marginBottom: '8px' } }, '这是创建后将保存的流水线结构：'),
          h(
            'div',
            { style: { display: 'grid', gap: '10px' } },
            ((preview || localPreview).stages || []).map((stage) =>
              h(Card, { key: stage.id, title: (stage.name || stage.id) + (stage.parallel ? '（并行）' : '') },
                (stage.jobs || []).length === 0
                  ? h('div', { className: 'dsh-devops-hint' }, '（空阶段）')
                  : (stage.jobs || []).map((job) =>
                      h('div', { key: job.id, style: { marginBottom: '6px' } },
                        h('div', { style: { fontSize: '12px', fontWeight: 500 } }, (job.name || job.id) + '  ·  ' + job.node),
                        h('div', { className: 'dsh-devops-upload-preview', style: { marginTop: '3px' } }, JSON.stringify(job.with || {}, null, 2).slice(0, 400)),
                      ),
                    ),
              ),
            ),
          ),
        ),
  );
}

/** 模板列表。 */
function Templates(props) {
  const templates = props.state.templates || [];
  // 筛选条件属于「视图位置」：离开再回来时保留搜索词、分类与收藏过滤。
  const saved = resolveTemplateFilters(props.remembered !== undefined ? props.remembered : readViewState());
  const [keyword, setKeyword] = useState(saved.keyword);
  const [category, setCategory] = useState(saved.category);
  const [favOnly, setFavOnly] = useState(saved.favOnly);

  /**
   * 筛选变化即写入记忆（只存标量）。
   *
   * 只写「本次变化的那一项」：writeViewState 自己会与已存值合并。
   * 不能拿 saved 当基线合并 —— saved 派生自 props.remembered，
   * 那是 App 挂载时的快照、不会随我们的写入更新，
   * 否则「先输关键字、再切分类」会把关键字覆盖回空值。
   */
  function patchFilter(patch) {
    const next = {};
    if (patch.keyword !== undefined) next.templatesKeyword = patch.keyword || '';
    if (patch.category !== undefined) next.templatesCategory = patch.category || '';
    if (patch.favOnly !== undefined) next.templatesFavOnly = !!patch.favOnly;
    writeViewState(next);
    if (patch.keyword !== undefined) setKeyword(patch.keyword);
    if (patch.category !== undefined) setCategory(patch.category);
    if (patch.favOnly !== undefined) setFavOnly(patch.favOnly);
  }
  const [target, setTarget] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    props.onReload();
  }, []);

  const categories = useMemo(() => {
    const set = new Set();
    for (const t of templates) if (t.category) set.add(t.category);
    return Array.from(set);
  }, [templates]);

  const filtered = templates.filter((t) => {
    if (category && t.category !== category) return false;
    if (favOnly && !t.favorite) return false;
    if (!keyword) return true;
    const hay = (t.name || '') + ' ' + (t.id || '') + ' ' + (t.description || '') + ' ' + (t.tags || []).join(' ');
    return hay.toLowerCase().includes(keyword.toLowerCase());
  });

  async function toggleFavorite(template) {
    try {
      await api.updateTemplate(template.id, Object.assign({}, template, { favorite: !template.favorite }));
      props.onReload();
    } catch (error) {
      props.toast.error(error.message || String(error));
    }
  }

  async function remove(template) {
    if (!confirm('确定删除模板「' + (template.name || template.id) + '」？')) return;
    try {
      await api.deleteTemplate(template.id);
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
      { style: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px' } },
      h('div', { style: { width: '220px' } }, h(TextInput, { value: keyword, placeholder: '搜索模板', onChange: (v) => patchFilter({ keyword: v }) })),
      h('div', { style: { width: '150px' } }, h(Select, { value: category, placeholder: '全部分类', options: categories, onChange: (v) => patchFilter({ category: v }) })),
      h(Button, { size: 'sm', icon: 'sparkle', label: '只看收藏', active: favOnly, onClick: () => patchFilter({ favOnly: !favOnly }) }),
      h('div', { className: 'dsh-devops-spacer' }),
      h(Button, { size: 'sm', icon: 'refresh', label: '刷新', busy, onClick: props.onReload }),
    ),
    filtered.length === 0
      ? h(Empty, { text: templates.length === 0 ? '还没有模板。到流水线编辑器里点「存为模板」即可创建。' : '没有匹配的模板' })
      : h(
          'div',
          { className: 'dsh-devops-grid', 'data-cols': '2' },
          filtered.map((template) =>
            h(Card, {
              key: template.id,
              title: template.name || template.id,
              headExtra: h(
                'span',
                { style: { display: 'flex', gap: '4px' } },
                h(Button, { size: 'sm', variant: 'ghost', icon: 'sparkle', title: template.favorite ? '取消收藏' : '收藏', active: !!template.favorite, onClick: () => toggleFavorite(template) }),
                h(Button, { size: 'sm', variant: 'danger', icon: 'trash', title: '删除', onClick: () => remove(template) }),
              ),
            },
              template.description ? h('div', { className: 'dsh-devops-hint', style: { marginBottom: '6px' } }, template.description) : null,
              h(KV, {
                entries: [
                  ['标识', h('span', { className: 'dsh-devops-monospace' }, template.id)],
                  ['分类', template.category || '—'],
                  ['参数', String((template.parameters || []).length)],
                  ['使用次数', String(template.usageCount || 0)],
                ],
              }),
              (template.parameters || []).length
                ? h('div', { style: { marginTop: '6px', display: 'flex', gap: '4px', flexWrap: 'wrap' } },
                    (template.parameters || []).map((p) =>
                      h(Chip, { key: p.name }, (p.label || p.name) + (p.required ? ' *' : '')),
                    ))
                : null,
              h('div', { style: { marginTop: '10px' } },
                h(Button, { size: 'sm', variant: 'primary', icon: 'plus', label: '从模板创建', onClick: () => setTarget(template) })),
            ),
          ),
        ),
    target ? h(InstantiateModal, {
      template: target,
      ctx: props.ctx,
      fieldCtx: props.fieldCtx,
      state: props.state,
      toast: props.toast,
      recent: props.recent,
      remember: props.remember,
      onClose: () => setTarget(null),
      onCreated: (id) => {
        props.onReload();
        props.onOpenPipeline && props.onOpenPipeline(id);
      },
    }) : null,
  );
}

exports.resolveTemplateFilters = resolveTemplateFilters;
exports.readViewState = readViewState;
exports.writeViewState = writeViewState;
exports.Templates = Templates;
exports.InstantiateModal = InstantiateModal;
exports.previewInterpolate = previewInterpolate;