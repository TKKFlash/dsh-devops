/**
 * 流水线页：列表 + 详情 + 编辑器。
 *
 * 本次修复的可用性缺陷：
 *  - 列表里的流水线名过去是纯文本 span，看着像入口却点不动。现在名称是
 *    .dsh-devops-link 可点元素（role=button + 键盘可达），点击进入**详情**。
 *  - 新增详情视图：定义概览、阶段与节点、最近运行，以及「编辑」「运行」入口。
 *    详情里的「编辑」复用 app.js 的 navigate('pipelines', { edit: id }) 机制。
 */
const { h, useState, useEffect, useMemo, clone, fmtAgo, fmtTime, fmtDuration } = require('./h.js');
const { Button, TextInput, Select, Card, Empty, Chip, Banner, Modal, Field, KV } = require('./ui.js');
const { api } = require('./api.js');
const { PipelineEditor, detectScheduling, countJobs } = require('./editor.js');
const { LogPanel } = require('./logs.js');
/**
 * 只读编排视图复用画布的纯展示构件（NodeCard）。
 * canvas.js 归画布任务维护，这里只读引用；require 失败时降级为内置只读卡片，
 * 保证详情页在缺该模块（或测试用桩表未覆盖它）时仍然可用。
 */
let canvasModule = {};
try {
  canvasModule = require('./canvas.js') || {};
} catch (error) {
  canvasModule = {};
}
const { RUN_STATUS_TEXT, runTone } = require('./state.js');

/* ------------------------------------------------------------------ *
 * 视图记忆：离开 DevOps 界面再回来时恢复「视图位置」
 *
 * 背景：面板随侧边栏 slot 卸载，组件内 useState 全部清零，用户重进时
 * 会从列表/概览重新开始。这里把「视图位置」存进 sessionStorage，重进时
 * 按 id **重新取数据**恢复——绝不存整份流水线定义，避免显示过期内容。
 *
 * 键名与 app.js 的 VIEW_KEY 一致：app.js 未导出这套 helper（改它归属 Lead），
 * 且 app.js 已 require 本文件，反向 require 会成环；故此处按同一约定实现，
 * 读写同一份记忆、同一套合并语义。
 * ------------------------------------------------------------------ */
const VIEW_KEY = 'dsh-devops.view';

/** 安全读取视图记忆（隐私模式 / 无 storage / JSON 损坏时一律降级为 null）。 */
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
    /* 隐私模式等场景存不了，忽略即可 */
  }
}

/** 重置流水线页的视图记忆（回到列表；用户「退出某个状态」的出口）。 */
function resetPipelineView() {
  writeViewState({ pipelinesMode: 'list', pipelinesId: '', editPipelineId: '' });
}

/**
 * 解析流水线页要恢复的视图位置（纯函数，便于断言）。
 * 只认轻量标记：mode 仅 list|edit|detail，id 必须是非空字符串；
 * 任何非法/缺失组合一律降级为列表，绝不抛出。
 */
function resolvePipelineView(remembered) {
  const view = remembered && typeof remembered === 'object' ? remembered : null;
  if (!view) return { mode: 'list', id: '' };
  const mode = view.pipelinesMode === 'edit' || view.pipelinesMode === 'detail' ? view.pipelinesMode : 'list';
  const primary = typeof view.pipelinesId === 'string' && view.pipelinesId ? view.pipelinesId : '';
  const fallback = mode === 'edit' && typeof view.editPipelineId === 'string' ? view.editPipelineId : '';
  const id = primary || fallback || '';
  // mode 与 id 必须成对有效：mode 已降级为 list 时 id 一并清空，
  // 否则调用方可能拿一个陈旧 id 去做别的事。
  if (mode === 'list' || !id) return { mode: 'list', id: '' };
  return { mode, id };
}

/**
 * 按视图位置重新取数据（只按 id 现取，不读记忆里可能过期的数据）。
 * 返回 { ok:true, pipeline } 或 { ok:false, missing:true, message }，**绝不抛错**——
 * 目标已被删除时必须能优雅降级回列表，而不是白屏。
 */
async function loadPipelineForView(view, getPipeline) {
  const id = view && view.id;
  if (!id || typeof getPipeline !== 'function') return { ok: false, missing: true, message: '' };
  try {
    const pipeline = await getPipeline(id);
    if (!pipeline || !pipeline.id) return { ok: false, missing: true, message: '流水线不存在：' + id };
    return { ok: true, pipeline };
  } catch (error) {
    return { ok: false, missing: true, message: (error && error.message) || String(error) };
  }
}

/** 解析流水线列表的筛选状态（只认标量，非法值降级为空）。 */
function resolveListFilters(remembered) {
  const view = remembered && typeof remembered === 'object' ? remembered : null;
  return {
    keyword: view && typeof view.listKeyword === 'string' ? view.listKeyword : '',
    category: view && typeof view.listCategory === 'string' ? view.listCategory : '',
  };
}

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

/** 该流水线是否有活跃运行（列表里给「运行中」提示用）。 */
function activeRunOf(runs, pipelineId) {
  return (runs || []).find(
    (r) => r && r.pipelineId === pipelineId && (r.status === 'running' || r.status === 'queued'),
  );
}

/**
 * 名称单元格：可点进详情，并在有活跃运行时补一个「运行中」徽标。
 *
 * 状态表达（task-8）：左侧状态点与失败计数都用 data-tone 驱动，
 * 组件里不写死任何色值 —— 颜色由 styles.js 的 .dsh-devops-dot[data-tone] 决定。
 */
function PipelineNameCell(props) {
  const pipeline = props.pipeline;
  const name = pipeline.name || '（未命名）';
  const active = props.activeRun;
  const recent = props.recentRun || null;
  const failedCount = props.failedCount || 0;
  const tone = active ? 'busy' : recent ? runTone(recent.status) : 'idle';
  const toneText = active
    ? RUN_STATUS_TEXT.running
    : recent
      ? RUN_STATUS_TEXT[recent.status] || recent.status
      : '还没有运行';
  return h(
    'span',
    { style: { display: 'inline-flex', alignItems: 'center', gap: '6px' } },
    h('span', {
      className: 'dsh-devops-dot',
      'data-tone': tone,
      'data-role': 'pipeline-status-dot',
      title: '最近状态：' + toneText,
    }),
    h(
      'span',
      {
        className: 'dsh-devops-link',
        style: { fontWeight: 500 },
        role: 'button',
        tabIndex: 0,
        title: '查看「' + name + '」的详情与运行情况',
        onClick: () => props.onOpen(pipeline.id),
        onKeyDown: (event) => {
          if (event && (event.key === 'Enter' || event.key === ' ')) {
            if (event.preventDefault) event.preventDefault();
            props.onOpen(pipeline.id);
          }
        },
      },
      name,
    ),
    active
      ? h(Chip, { tone: 'busy', dot: true, title: '该流水线正在运行：' + active.id }, '运行中')
      : null,
    failedCount > 0
      ? h(
          Chip,
          { tone: 'error', dot: true, title: '最近运行中有 ' + failedCount + ' 次失败' },
          failedCount + ' 次失败',
        )
      : null,
  );
}

/**
 * 按流水线汇总「最近一次运行」与「失败计数」，供列表用状态色表达。
 * 纯函数，缺 runs 时返回空表 —— 列表在没有运行数据时仍然是中性的。
 */
function runSummaryByPipeline(runs) {
  const out = {};
  for (const r of runs || []) {
    if (!r || !r.pipelineId) continue;
    const entry = out[r.pipelineId] || (out[r.pipelineId] = { latest: null, failed: 0 });
    if (!entry.latest || (r.startedAt || 0) > (entry.latest.startedAt || 0)) entry.latest = r;
    if (r.status === 'failed') entry.failed += 1;
  }
  return out;
}

function PipelineList(props) {
  const pipelines = props.pipelines || [];
  // 筛选条件也属于「视图位置」：离开再回来时保留搜索词与分类。
  const filters = resolveListFilters(props.remembered !== undefined ? props.remembered : readViewState());
  const [keyword, setKeyword] = useState(filters.keyword);
  const [category, setCategory] = useState(filters.category);
  const summaries = useMemo(() => runSummaryByPipeline(props.runs), [props.runs]);

  /**
   * 筛选条件变化即写入记忆（只存标量，不存列表数据）。
   *
   * 只写「本次变化的那一项」，由 writeViewState 与已存值合并；
   * 不可用 filters（派生自 props.remembered 的挂载快照）当基线，
   * 否则改分类会把刚输入的关键字覆盖回空值。
   */
  function patchFilter(patch) {
    const next = {};
    if (patch.keyword !== undefined) next.listKeyword = patch.keyword || '';
    if (patch.category !== undefined) next.listCategory = patch.category || '';
    writeViewState(next);
    if (patch.keyword !== undefined) setKeyword(patch.keyword);
    if (patch.category !== undefined) setCategory(patch.category);
  }

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
      h('div', { style: { width: '220px' } }, h(TextInput, { value: keyword, placeholder: '搜索名称/描述/标签', onChange: (v) => patchFilter({ keyword: v }) })),
      h('div', { style: { width: '150px' } },
        h(Select, {
          value: category,
          placeholder: '全部分类',
          options: categories,
          onChange: (v) => patchFilter({ category: v }),
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
                h('td', null, h(PipelineNameCell, {
                  pipeline: p,
                  activeRun: (props.activeRunsByPipeline || {})[p.id],
                  recentRun: (summaries[p.id] || {}).latest || null,
                  failedCount: (summaries[p.id] || {}).failed || 0,
                  onOpen: props.onOpen,
                })),
                h('td', { className: 'dsh-devops-monospace' }, p.id),
                h('td', null, (p.stages || []).length + ' / ' + countJobs(p)),
                h('td', null, h(Chip, { tone: detectScheduling(p) === 'dag' ? 'busy' : 'idle' }, detectScheduling(p) === 'dag' ? 'DAG' : '阶段')),
                h('td', null, p.category || '—'),
                h('td', null, (p.tags || []).map((t) => h('span', { key: t, className: 'dsh-devops-tag', style: { marginRight: '3px' } }, t))),
                h('td', null, fmtAgo(p.updatedAt)),
                h('td', null,
                  h('span', { style: { display: 'flex', gap: '4px' } },
                    h(Button, { size: 'sm', label: '详情', onClick: () => props.onOpen(p.id) }),
                    h(Button, { size: 'sm', label: '编辑', onClick: () => props.onEdit(p.id) }),
                    h(Button, { size: 'sm', icon: 'play', label: '运行', onClick: () => props.onRun(p) }),
                    h(Button, { size: 'sm', variant: 'danger', icon: 'trash', label: '删除', onClick: () => props.onDelete(p) }))),
              ),
            )),
        ),
  );
}

/* ------------------------------------------------------------------ *
 * 只读编排视图：与编辑器同构（阶段成列、节点为块状卡片），但不可编辑。
 * 节点卡片复用 src/client/canvas.js 导出的纯展示构件 NodeCard（画布任务维护），
 * require 不可用时降级为内置只读卡片，保证详情页在缺模块时仍可用。
 * ------------------------------------------------------------------ */

/** 兜底只读卡片：字段与 canvas.js 的 NodeCard 视觉契约一致（类名 + data-role）。 */
function DisplayNodeCard(props) {
  const job = props.job || {};
  const seconds = job.timeoutMs ? Math.round(job.timeoutMs / 1000) : 0;
  return h(
    'div',
    {
      className: 'dsh-devops-nodecard',
      'data-role': 'node-card',
      'data-readonly': 'true',
      'data-selected': props.selected ? 'true' : undefined,
      // 状态色：由父层给定，颜色交给 CSS 的 [data-status]/[data-tone]
      'data-status': props.status || 'pending',
      'data-tone': toneOfStatus(props.status || 'pending'),
      onClick: (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        if (props.onSelect) props.onSelect(job.id);
      },
    },
    h(
      'div',
      { className: 'dsh-devops-nodecard-head' },
      props.index ? h('span', { className: 'dsh-devops-nodecard-index' }, String(props.index)) : null,
      h('span', { className: 'dsh-devops-nodecard-title dsh-devops-truncate' }, job.name || job.id),
      job.allowFailure ? h('span', { className: 'dsh-devops-nodecard-flag', title: '允许失败，失败不阻断后续' }, '容错') : null,
    ),
    h('div', { className: 'dsh-devops-nodecard-type dsh-devops-monospace dsh-devops-truncate', title: job.node }, job.node),
    h(
      'div',
      { className: 'dsh-devops-nodecard-meta' },
      h('span', { className: 'dsh-devops-nodecard-key' }, '执行条件'),
      h('span', { className: 'dsh-devops-truncate' }, whenLabel(job.when)),
      h('span', { className: 'dsh-devops-nodecard-key' }, '服务器'),
      h('span', { className: 'dsh-devops-truncate' }, job.server || '（默认）'),
      seconds ? h('span', { className: 'dsh-devops-nodecard-key' }, '超时') : null,
      seconds ? h('span', null, seconds + 's') : null,
    ),
    (job.needs || []).length
      ? h(
          'div',
          { className: 'dsh-devops-nodecard-needs' },
          h('span', { className: 'dsh-devops-nodecard-key' }, 'needs'),
          (job.needs || []).map((need) => h('span', { key: need, className: 'dsh-devops-nodecard-need' }, need)),
        )
      : null,
    (job.artifacts || []).length ? h('div', { className: 'dsh-devops-nodecard-foot' }, (job.artifacts || []).length + ' 项产物') : null,
  );
}

/**
 * NodeCard 的取用策略：
 * canvas.js 目前的 NodeCard 带编辑期拖拽行为（draggable + onDragStart），不是纯展示构件。
 * 因此只在它显式声明了只读支持（NodeCard.supportsReadonly === true）时复用它；
 * 否则用字段/类名完全一致的 DisplayNodeCard，保证详情页**当下就是只读**。
 * canvas 负责人加上该标志后，这里会自动切换为复用，无需再改本文件。
 */
const NodeCard =
  typeof canvasModule.NodeCard === 'function' && canvasModule.NodeCard.supportsReadonly === true
    ? canvasModule.NodeCard
    : DisplayNodeCard;

/** 执行条件的中文文案（与画布一致）。 */
function whenLabel(when) {
  if (when === 'manual') return '手动触发';
  if (when === 'always') return '总是执行';
  return '上游成功后';
}

/** 原始字段值的展示文本（对象/数组走 JSON，长脚本保留换行）。 */
function rawValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch (error) {
    return String(value);
  }
}

/**
 * 找「该节点最近一次运行」：按开始时间倒序，取第一个确实包含该 step 的运行。
 * 运行摘要里没有 steps 明细时（列表接口不带）降级为最近一次运行，避免永远显示「没有运行记录」。
 */
function latestRunForStep(runs, pipelineId, stepId) {
  const mine = (runs || [])
    .filter((run) => run && run.pipelineId === pipelineId)
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  let fallback = null;
  for (const run of mine) {
    const steps = run.steps;
    if (steps && typeof steps === 'object') {
      if (Object.prototype.hasOwnProperty.call(steps, stepId)) return run;
      continue;
    }
    if (!fallback) fallback = run;
  }
  return fallback;
}

/** 状态 → 语义色调（与 state.js 的 run/step tone 口径一致，供 data-tone 使用）。 */
function toneOfStatus(status) {
  if (status === 'success') return 'ok';
  if (status === 'failed') return 'error';
  if (status === 'running') return 'busy';
  if (status === 'canceled') return 'warn';
  return 'idle';
}

/**
 * 一组运行里，某节点的**最近一次执行状态**（jobId → status）。
 * 运行没有 step 明细时返回 null，卡片保持中性 —— 不猜状态。
 */
function stepStatusMap(runs, pipelineId) {
  const mine = (runs || [])
    .filter((run) => run && run.pipelineId === pipelineId)
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  const out = {};
  for (const run of mine) {
    const steps = run.steps;
    if (!steps || typeof steps !== 'object') continue;
    for (const stepId of Object.keys(steps)) {
      if (!Object.prototype.hasOwnProperty.call(out, stepId)) {
        out[stepId] = (steps[stepId] && steps[stepId].status) || null;
      }
    }
  }
  return out;
}

/**
 * 只读编排画布：阶段成列、节点为块状卡片，与编辑器同构。
 * 与编辑器的差别全部集中在「没有任何结构变更入口」：无增删阶段、无拖拽投放、无列头工具。
 */
function ReadonlyBoard(props) {
  const pipeline = props.pipeline || {};
  const stages = pipeline.stages || [];
  /**
   * 节点/阶段状态由父层以纯函数给出（jobId → run status），
   * 这里只负责把状态挂成 data-status / data-tone，颜色一律交给 CSS。
   */
  const statusOf = props.stepStatusOf || (() => null);
  /** 阶段状态：任一节点失败 → failed；有运行中 → running；全部成功 → success；否则 pending。 */
  function stageStatus(stage) {
    const list = (stage.jobs || []).map((job) => statusOf(job.id)).filter(Boolean);
    if (list.length === 0) return 'pending';
    if (list.indexOf('failed') >= 0) return 'failed';
    if (list.indexOf('running') >= 0) return 'running';
    if (list.indexOf('queued') >= 0) return 'queued';
    if (list.every((s) => s === 'success' || s === 'skipped')) return 'success';
    return 'pending';
  }
  if (stages.length === 0) {
    return h(
      'div',
      { className: 'dsh-devops-board dsh-devops-readonly', 'data-role': 'readonly-board', 'data-readonly': 'true' },
      h('div', { className: 'dsh-devops-empty dsh-devops-board-empty' }, '这条流水线还没有阶段'),
    );
  }
  return h(
    'div',
    { className: 'dsh-devops-board dsh-devops-readonly', 'data-role': 'readonly-board', 'data-readonly': 'true' },
    stages.map((stage, stageIndex) =>
      h(
        'div',
        {
          key: stage.id || stageIndex,
          className: 'dsh-devops-column',
          'data-role': 'readonly-column',
          'data-stage-id': stage.id,
          'data-parallel': stage.parallel ? 'true' : undefined,
          // 阶段整体状态：列头据此着色
          'data-status': stageStatus(stage),
          'data-tone': toneOfStatus(stageStatus(stage)),
        },
        h(
          'div',
          { className: 'dsh-devops-column-head' },
          h('span', { className: 'dsh-devops-column-index' }, String(stageIndex + 1)),
          h('span', { className: 'dsh-devops-column-title dsh-devops-truncate' }, stage.name || stage.id),
          stage.parallel ? h(Chip, { tone: 'busy', title: '阶段内节点并行执行' }, '并行') : null,
          h('span', { className: 'dsh-devops-hint' }, (stage.jobs || []).length + ' 节点'),
        ),
        h(
          'div',
          { className: 'dsh-devops-column-cards', 'data-role': 'readonly-cards' },
          (stage.jobs || []).map((job, jobIndexInStage) =>
            h(
              'div',
              {
                key: job.id,
                className: 'dsh-devops-slot',
                'data-role': 'readonly-slot',
                'data-job': job.id,
                'data-readonly': 'true',
                'data-status': statusOf(job.id) || 'pending',
                'data-tone': toneOfStatus(statusOf(job.id) || 'pending'),
                role: 'button',
                tabIndex: 0,
                title: '查看节点「' + (job.name || job.id) + '」的信息与日志',
                onClick: () => props.onSelectJob && props.onSelectJob(job.id),
                onKeyDown: (event) => {
                  if (event && (event.key === 'Enter' || event.key === ' ')) {
                    if (event.preventDefault) event.preventDefault();
                    if (props.onSelectJob) props.onSelectJob(job.id);
                  }
                },
                // 只读：卡片自带 draggable，这里在容器上取消拖拽默认行为（画布任务可选加 readonly 支持）
                onDragStart: (event) => {
                  if (event && event.preventDefault) event.preventDefault();
                },
                onDragOver: (event) => {
                  if (event && event.preventDefault) event.preventDefault();
                },
                onDrop: (event) => {
                  if (event && event.preventDefault) event.preventDefault();
                },
              },
              h(NodeCard, {
                job,
                stageId: stage.id,
                index: jobIndexInStage + 1,
                readonly: true,
                status: statusOf(job.id) || 'pending',
                selected: props.selectedJob === job.id,
                onSelect: props.onSelectJob,
              }),
            ),
          ),
          (stage.jobs || []).length === 0 ? h('div', { className: 'dsh-devops-column-empty' }, '该阶段还没有节点') : null,
        ),
      ),
    ),
  );
}

/** 抽屉页签定义（内部切换界面）。 */
const DETAIL_TABS = [
  { id: 'info', label: '节点信息' },
  { id: 'log', label: '日志' },
];

/** 节点信息页：节点类型 / 字段原始值 / 服务器 / 执行条件 / 超时 / needs / 产物 等。 */
function NodeInfoPanel(props) {
  const job = props.job || {};
  const descriptor = props.descriptor || null;
  const withValues = job.with || {};
  const fieldLabel = (name) => {
    const fields = (descriptor && descriptor.fields) || [];
    const found = fields.find((f) => f && f.name === name);
    return found && found.label ? found.label : name;
  };
  const retry = job.retry || {};

  /**
   * 信息分「执行 / 依赖与产物 / 环境」三组，每组是一张卡片，
   * 而不是过去那样一整片扁平 KV —— 用户要的「分层」在这里落地。
   */
  const groups = [
    {
      id: 'exec',
      title: '执行',
      entries: [
        ['节点 id', h('span', { className: 'dsh-devops-monospace' }, job.id || '—')],
        ['名称', job.name || '—'],
        ['节点类型', h('span', { className: 'dsh-devops-monospace' }, job.node || '—')],
        ['所属阶段', props.stageName || '—'],
        ['执行条件', whenLabel(job.when)],
        ['服务器', job.server || props.defaultServer || '（默认）'],
        ['超时', job.timeoutMs ? Math.round(job.timeoutMs / 1000) + ' 秒（' + job.timeoutMs + ' ms）' : '—'],
        ['允许失败', job.allowFailure ? '是' : '否'],
        ['重试', retry.max ? '最多 ' + retry.max + ' 次，间隔 ' + (retry.delayMs || 0) + ' ms' : '不重试'],
      ],
    },
    {
      id: 'deps',
      title: '依赖与产物',
      entries: [
        ['needs', (job.needs || []).length ? (job.needs || []).join('、') : '无'],
        ['产物', (job.artifacts || []).length ? (job.artifacts || []).join('、') : '无'],
        ['缓存', job.cache && job.cache.key ? job.cache.key : '未配置'],
      ],
    },
    {
      id: 'env',
      title: '环境与准备',
      entries: [
        ['环境变量', (job.env || []).length ? (job.env || []).map((e) => e.name).join('、') : '无'],
        ['变量组引用', (job.envSetRefs || []).length ? (job.envSetRefs || []).join('、') : '无'],
        ['允许自动准备', job.allowProvision ? '是' : '否'],
      ],
    },
  ];

  const paramKeys = Object.keys(withValues);
  return h(
    'div',
    { className: 'dsh-devops-drawer-panel', 'data-role': 'drawer-panel-info' },
    descriptor && descriptor.description ? h('div', { className: 'dsh-devops-hint' }, descriptor.description) : null,
    groups.map((group) =>
      h(
        'div',
        { key: group.id, className: 'dsh-devops-card', 'data-role': 'drawer-info-group', 'data-group': group.id },
        h('div', { className: 'dsh-devops-card-head' },
          h('span', { className: 'dsh-devops-card-title' }, group.title)),
        h(KV, { entries: group.entries }),
      ),
    ),
    h('h3', { className: 'dsh-devops-card-title', style: { marginTop: '12px' } }, '节点参数（原始值）'),
    paramKeys.length === 0
      ? h('div', { className: 'dsh-devops-hint' }, '该节点没有参数')
      : paramKeys.map((key) =>
          h(
            'div',
            { key, className: 'dsh-devops-field-row' },
            h(
              'div',
              { className: 'dsh-devops-field-head' },
              h('span', { className: 'dsh-devops-field-label' }, fieldLabel(key)),
              h('span', { className: 'dsh-devops-hint' }, key),
            ),
            // 原始值：等宽深色小面板（与终端观感呼应），颜色/底色由 CSS 决定
            h('div', {
              className: 'dsh-devops-drawer-raw dsh-devops-monospace',
              'data-tone': 'code',
            }, rawValue(withValues[key])),
          ),
        ),
  );
}

/**
 * 日志页：复用既有的 LogPanel（实时流 / 过滤 / 下载 / 内存环提示），
 * 只负责「取该节点最近一次运行」这一件事；没有运行记录时给明确文案而不是空白。
 */
function NodeLogPanel(props) {
  const job = props.job || null;
  const run = props.run || null;
  const runId = run ? run.id : '';
  const stepId = job ? job.id : '';
  const live = !!(run && (run.status === 'running' || run.status === 'queued'));

  return h(
    'div',
    { className: 'dsh-devops-drawer-panel', 'data-role': 'drawer-panel-log' },
    h(
      'div',
      { className: 'dsh-devops-hint', style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' } },
      h('span', null, '来自最近一次运行 '),
      h('span', { className: 'dsh-devops-monospace' }, runId),
      run && run.status
        ? h(Chip, { tone: runTone(run.status) }, RUN_STATUS_TEXT[run.status] || run.status)
        : null,
    ),
    runId
      ? h(LogPanel, { runId, stepId, live })
      : h('div', { className: 'dsh-devops-hint', 'data-role': 'drawer-log-empty' }, '该节点还没有运行记录'),
  );
}

/**
 * 节点详情抽屉：**圆角悬浮卡片**，从右侧滑入并浮在内容上方。
 *
 * 形态契约（task-8，视觉由 styles.js 按属性落地，组件里不写死颜色/圆角）：
 *  - .dsh-devops-drawer-layer[data-shape="floating"]：四周留白的浮层容器（不再贴右边缘）；
 *  - .dsh-devops-drawer[data-variant="floating"]：圆角 + 阴影 + 细边框 + max-height 受视口约束；
 *  - .dsh-devops-drawer-mask[data-blur="true"]：半透明 + 轻微模糊遮罩。
 * 既有的 data-role / data-open / data-tab 契约与三种关闭方式（遮罩 / 关闭按钮 / Esc）保持不变。
 */
function DetailDrawer(props) {
  const job = props.job || null;
  const open = !!job;
  const [tab, setTab] = useState('info');
  const jobId = job ? job.id : '';

  // 抽屉打开时支持 Esc 关闭（Node 环境下没有 document，跳过）
  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    const onKey = (event) => {
      if (event && event.key === 'Escape' && props.onClose) props.onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      if (document && document.removeEventListener) document.removeEventListener('keydown', onKey);
    };
  }, [open, props.onClose]);

  // 换节点时回到「节点信息」，避免看到上一个节点的日志
  useEffect(() => {
    if (open) setTab('info');
  }, [jobId, open]);

  const infoActive = tab === 'info';
  return h(
    'div',
    {
      className: 'dsh-devops-drawer-layer',
      'data-role': 'detail-drawer',
      // 悬浮形态：脱离右边缘的浮层，而不是贴合边缘的全高面板
      'data-shape': 'floating',
      'data-open': open ? 'true' : 'false',
      'data-tab': tab,
      // 状态语义：整层可被 CSS 按运行状态着色（无运行记录时为 idle）
      'data-status': props.run && props.run.status ? props.run.status : 'idle',
      'data-tone': props.run && props.run.status ? runTone(props.run.status) : 'idle',
      'aria-hidden': open ? 'false' : 'true',
    },
    h('div', {
      className: 'dsh-devops-drawer-mask',
      'data-role': 'drawer-mask',
      // 半透明 + 轻微模糊
      'data-blur': 'true',
      onClick: () => props.onClose && props.onClose(),
    }),
    h(
      'aside',
      {
        className: 'dsh-devops-drawer',
        'data-role': 'drawer-panel',
        // 圆角悬浮卡片：圆角/阴影/边框/视口内最大高度由 CSS 按该属性落地
        'data-variant': 'floating',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': '节点详情',
      },
      h(
        'div',
        { className: 'dsh-devops-drawer-head' },
        h('span', { className: 'dsh-devops-drawer-title dsh-devops-truncate' }, job ? job.name || job.id : ''),
        job ? h('span', { className: 'dsh-devops-tag dsh-devops-monospace' }, job.node) : null,
        // 这次运行的执行状态：颜色承担语义（成功/失败/运行中/取消），无记录时不显示
        props.run && props.run.status
          ? h(
              Chip,
              { tone: runTone(props.run.status), dot: true, title: '最近一次运行的状态' },
              RUN_STATUS_TEXT[props.run.status] || props.run.status,
            )
          : null,
        h('div', { className: 'dsh-devops-spacer' }),
        h(Button, { variant: 'ghost', size: 'sm', icon: 'close', label: '关闭', title: '关闭抽屉（Esc）', onClick: () => props.onClose && props.onClose() }),
      ),
      h(
        'div',
        { className: 'dsh-devops-tabs', role: 'tablist', 'data-role': 'drawer-tabs' },
        DETAIL_TABS.map((item) =>
          h(
            'button',
            {
              key: item.id,
              type: 'button',
              role: 'tab',
              className: 'dsh-devops-tab',
              'data-role': 'drawer-tab',
              'data-tab': item.id,
              'data-active': tab === item.id ? 'true' : undefined,
              'aria-selected': tab === item.id ? 'true' : 'false',
              onClick: () => setTab(item.id),
            },
            item.label,
          ),
        ),
      ),
      h(
        'div',
        { className: 'dsh-devops-drawer-body' },
        h('div', { 'data-role': 'drawer-view', 'data-view': 'info', hidden: !infoActive },
          infoActive
            ? h(NodeInfoPanel, { job, stageName: props.stageName, descriptor: props.descriptor, defaultServer: props.defaultServer })
            : null),
        h('div', { 'data-role': 'drawer-view', 'data-view': 'log', hidden: infoActive },
          infoActive ? null : h(NodeLogPanel, { job, run: props.run })),
      ),
    ),
  );
}

/**
 * 流水线详情：与编辑器同构的**只读**编排视图 + 右侧伸缩抽屉 + 最近运行。
 *
 * 只读边界：不能拖拽、不能改名、不能增删阶段/节点、不能改字段；
 * 点击节点只在右侧弹出抽屉（不跳页），抽屉内可切换「节点信息 / 日志」。
 */
function PipelineDetail(props) {
  const pipeline = props.pipeline || {};
  const runs = props.runs || [];
  const nodes = props.nodes || [];
  const mine = runs
    .filter((run) => run && run.pipelineId === pipeline.id)
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  const active = mine.filter((run) => run.status === 'running' || run.status === 'queued');
  const stages = pipeline.stages || [];
  const scheduling = detectScheduling(pipeline);
  const now = Date.now();

  const [selectedJob, setSelectedJob] = useState(null);
  /**
   * 本页自管滚动（task-11）：详情页内部有画布/检查器滚动区，外层不该跟着滚。
   * 必须放在**提前 return 之前**，否则首次渲染少执行一个 hook → React #310。
   */
  useEffect(() => {
    if (typeof props.onBodyFlush !== 'function') return undefined;
    props.onBodyFlush(true);
    return () => props.onBodyFlush(false);
  }, [props.onBodyFlush]);
  const allJobs = useMemo(() => {
    const out = [];
    for (const stage of stages) {
      for (const job of stage.jobs || []) out.push({ job, stage });
    }
    return out;
  }, [pipeline]);
  // 节点/阶段状态：来自该流水线最近各次运行里该步骤的状态，用于 data-status 着色
  const stepStatus = useMemo(() => stepStatusMap(runs, pipeline.id), [runs, pipeline.id]);
  const statusOfStep = (jobId) => stepStatus[jobId] || null;
  const current = allJobs.find((entry) => entry.job.id === selectedJob) || null;
  const currentRun = current ? latestRunForStep(runs, pipeline.id, current.job.id) : null;
  const descriptor = current ? nodes.find((node) => node && node.type === current.job.node) || null : null;

  return h(
    'div',
    { className: 'dsh-devops-detail', 'data-role': 'pipeline-detail' },
    h(
      'div',
      { className: 'dsh-devops-head' },
      h(Button, { size: 'sm', icon: 'chevron', label: '← 流水线列表', onClick: props.onBack }),
      h('h2', { className: 'dsh-devops-title' }, pipeline.name || pipeline.id),
      h(Chip, { tone: scheduling === 'dag' ? 'busy' : 'idle' }, scheduling === 'dag' ? 'DAG 调度' : '阶段调度'),
      active.length ? h(Chip, { tone: 'busy', dot: true }, active.length + ' 个运行中') : null,
      h('div', { className: 'dsh-devops-spacer' }),
      h(Button, { size: 'sm', icon: 'refresh', label: '刷新', onClick: props.onReload }),
      h(Button, { size: 'sm', icon: 'play', label: '运行', variant: 'primary', onClick: () => props.onRun(pipeline) }),
      h(Button, { size: 'sm', label: '编辑', onClick: () => props.onEdit(pipeline.id) }),
    ),

    h(
      'div',
      { className: 'dsh-devops-editor dsh-devops-detail-editor' },
      h(
        'div',
        { className: 'dsh-devops-palette', 'data-role': 'detail-overview' },
        h(
          'div',
          { className: 'dsh-devops-palette-scroll' },
          h('h3', { className: 'dsh-devops-card-title' }, '定义概览'),
          h(KV, {
            entries: [
              ['标识', h('span', { className: 'dsh-devops-monospace' }, pipeline.id || '—')],
              ['描述', pipeline.description || '—'],
              ['分类', pipeline.category || '—'],
              ['标签', (pipeline.tags || []).length ? (pipeline.tags || []).join('、') : '—'],
              ['阶段 / 节点', stages.length + ' 阶段 / ' + countJobs(pipeline) + ' 节点'],
              ['调度模式', scheduling === 'dag' ? 'DAG（按 needs 依赖）' : '阶段串行（阶段内可并行）'],
              ['变量', (pipeline.variables || []).length ? (pipeline.variables || []).map((v) => v.name).join('、') : '无'],
              ['默认服务器', (pipeline.defaults && pipeline.defaults.server) || 'local'],
              ['更新时间', fmtTime(pipeline.updatedAt)],
            ],
          }),
        ),
      ),

      h(
        'div',
        // minHeight:0 必须保留：flex 子项默认 min-height:auto 会拒绝收缩，
        // 画布被内容撑高后自身滚动失效（用户报「滚哪都是整页动」）。
        { style: { flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 } },
        h(
          'div',
          { className: 'dsh-devops-statusbar-inline', 'data-role': 'detail-board-bar' },
          h('span', null, '阶段与节点：与编辑器同构的只读编排视图；点节点在右侧查看信息与日志'),
          h('div', { className: 'dsh-devops-spacer' }),
          h(Chip, null, stages.length + ' 阶段'),
          h(Chip, null, countJobs(pipeline) + ' 节点'),
        ),
        h(ReadonlyBoard, {
          pipeline,
          selectedJob,
          stepStatusOf: statusOfStep,
          onSelectJob: setSelectedJob,
        }),
      ),

      h(
        'div',
        { className: 'dsh-devops-inspector', 'data-role': 'detail-runs' },
        h(
          'div',
          { className: 'dsh-devops-inspector-scroll' },
          h('h3', { className: 'dsh-devops-card-title', style: { marginBottom: '8px' } }, '最近运行'),
          mine.length === 0
            ? h(Empty, { text: '这条流水线还没有运行记录，点右上角「运行」试试' })
            : h(
                'table',
                { className: 'dsh-devops-table' },
                h('thead', null,
                  h('tr', null,
                    h('th', null, '运行 id'),
                    h('th', null, '状态'),
                    h('th', null, '开始'),
                    h('th', null, '耗时'),
                    h('th', null, ''),
                  )),
                h('tbody', null,
                  mine.slice(0, 10).map((run) =>
                    h('tr', { key: run.id },
                      h('td', { className: 'dsh-devops-monospace' }, run.id),
                      h('td', null, h(Chip, { tone: runTone(run.status), dot: true }, RUN_STATUS_TEXT[run.status] || run.status)),
                      h('td', null, fmtAgo(run.startedAt, now)),
                      h('td', null, run.startedAt ? fmtDuration((run.finishedAt || now) - run.startedAt) : '—'),
                      h('td', null, h(Button, { size: 'sm', label: '查看运行', onClick: () => props.onOpenRun(run.id) })),
                    ),
                  )),
              ),
        ),
      ),
    ),

    h(DetailDrawer, {
      job: current ? current.job : null,
      stageName: current ? current.stage.name || current.stage.id : '',
      descriptor,
      run: currentRun,
      defaultServer: (pipeline.defaults && pipeline.defaults.server) || 'local',
      onClose: () => setSelectedJob(null),
    }),
  );
}

function Pipelines(props) {
  const [mode, setMode] = useState('list');
  const [draft, setDraft] = useState(null);
  const [detailId, setDetailId] = useState('');
  const [detailData, setDetailData] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  // 只有明确要求「新建」时才自动弹创建框。
  // （旧版写成 !!initialAction：从模板页创建完跳过来会无故弹出「新建流水线」模态框。）
  const [createOpen, setCreateOpen] = useState(!!(props.initialAction && props.initialAction.create));
  const [runTarget, setRunTarget] = useState(null);
  /**
   * 视图恢复是否已完成。
   * 用 state 而不是 ref：桩 hooks 下 useRef 每次返回新对象，无法用来防重入；
   * state 在真实 React 与桩环境下都能稳定表达「恢复只做一次」。
   */
  const [restored, setRestored] = useState(false);

  // 列表侧数据缺失时拉一次，保证直接进入编辑器也有内容
  useEffect(() => {
    if (props.state.pipelines.length === 0) props.onReload();
  }, []);

  /**
   * 编辑器路径自管滚动（task-11 协同）。
   * 只在 `Pipelines` 这一处声明（详情页在 PipelineDetail 内声明），
   * 避免两处同时 true/false 互相覆盖；editor.js 内部不再重复声明。
   */
  useEffect(() => {
    if (typeof props.onBodyFlush !== 'function') return undefined;
    if (mode !== 'edit') return undefined;
    props.onBodyFlush(true);
    return () => props.onBodyFlush(false);
  }, [props.onBodyFlush, mode]);

  /**
   * 恢复上次离开时的视图位置（mode + id）。
   *
   * 只读记忆里的**轻量标记**，再按 id 现取一份最新数据 —— 恢复的是「位置」，
   * 不是「陈旧内容」。以下情况一律降级回列表：没有记忆、记忆非法、目标已被删除、
   * 取数报错。显式跳转（initialAction）优先于记忆。
   */
  useEffect(() => {
    if (restored) return undefined;
    if (props.initialAction) {
      setRestored(true);
      return undefined;
    }
    const view = resolvePipelineView(props.remembered !== undefined ? props.remembered : readViewState());
    if (view.mode === 'list') {
      setRestored(true);
      return undefined;
    }
    let alive = true;
    setLoadingDetail(true);
    loadPipelineForView(view, (id) => api.getPipeline(id)).then((result) => {
      if (!alive) return;
      setLoadingDetail(false);
      if (!result.ok) {
        // 目标已被删除 / 取数失败：清掉记忆并回列表，绝不白屏
        resetPipelineView();
        setDetailId('');
        setMode('list');
        if (props.toast) props.toast.warn('上次打开的流水线已不存在，已回到列表');
        setRestored(true);
        return;
      }
      const pipeline = result.pipeline;
      setDetailId(pipeline.id);
      setDetailData(pipeline);
      if (view.mode === 'edit') {
        setDraft(pipeline);
        setMode('edit');
      } else {
        setMode('detail');
      }
      setRestored(true);
    });
    return () => {
      alive = false;
    };
  }, [restored]);

  /**
   * 外部跳转。app.js 的约定：
   *   { detail: id } → 进详情（概览/运行页的「查看流水线」）
   *   { edit: id }   → 直接进编辑器（运行详情的「编辑流水线」）
   *   { create: true } → 弹新建框
   *   { run: id }    → 弹运行框
   */
  useEffect(() => {
    const action = props.initialAction;
    if (!action) return;
    if (action.edit) openEditor(action.edit);
    else if (action.detail) openDetail(action.detail);
    else if (action.create) setCreateOpen(true);
    else if (action.run) {
      const target = (props.state.pipelines || []).find((p) => p.id === action.run);
      if (target) setRunTarget(target);
    }
  }, [props.initialAction]);

  function startCreate(id, name) {
    const base = blankPipeline();
    if (id) base.id = id;
    if (name) base.name = name;
    setDraft(base);
    setMode('edit');
    setCreateOpen(false);
    // 未保存的新草稿不写「编辑中」记忆：它在服务端并不存在，
    // 否则离开再回来会被恢复逻辑判为「已删除」并弹出误导性提示。
    resetPipelineView();
  }

  /** 打开编辑器（列表的「编辑」按钮、详情页的「编辑」都走这里）。 */
  async function openEditor(id) {
    try {
      const pipeline = await api.getPipeline(id);
      setDraft(pipeline);
      setDetailId(id);
      setDetailData(pipeline);
      setMode('edit');
      // 只记 id 与模式，不记定义本身
      writeViewState({ pipelinesMode: 'edit', pipelinesId: id, editPipelineId: id });
    } catch (error) {
      props.toast.error(error.message || String(error));
    }
  }

  /** 打开详情；列表里可能还没有完整定义，缺了就从后端取一份并缓存下来。 */
  async function openDetail(id) {
    setDetailId(id);
    setMode('detail');
    writeViewState({ pipelinesMode: 'detail', pipelinesId: id });
    const cached = (props.state.pipelines || []).find((p) => p.id === id);
    if (cached) {
      setDetailData(cached);
      return;
    }
    setDetailData(null);
    setLoadingDetail(true);
    try {
      const pipeline = await api.getPipeline(id);
      setDetailData(pipeline);
    } catch (error) {
      props.toast.error(error.message || String(error));
      setMode('list');
    } finally {
      setLoadingDetail(false);
    }
  }

  /** 详情页要展示的数据：优先用列表缓存（刷新后自动同步），否则用单独取到的那一份。 */
  const detailPipeline =
    (props.state.pipelines || []).find((p) => p.id === detailId) ||
    (detailData && detailData.id === detailId ? detailData : null);

  const activeRunsByPipeline = useMemo(() => {
    const map = {};
    for (const run of props.state.runs || []) {
      if (run && (run.status === 'running' || run.status === 'queued') && run.pipelineId && !map[run.pipelineId]) {
        map[run.pipelineId] = run;
      }
    }
    return map;
  }, [props.state.runs]);

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
      if (detailId === pipeline.id) {
        setDetailId('');
        backToList();
      }
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
      fieldCtx: props.fieldCtx,
      toast: props.toast,
      recent: props.recent,
      remember: props.remember,
      // 选中节点的记忆由 app.js 下发、editor.js 消费（editor.js 归浮层任务）。
      // 这里只负责透传，不实现其内部选中逻辑。
      editMemory: props.editMemory,
      rememberEdit: props.rememberEdit,
      onSave: save,
      onReload: props.onReload,
      onTemplatesChanged: props.onTemplatesChanged,
      onStarted: (runId) => {
        props.onReload();
        if (runId) props.onOpenRun(runId);
      },
      // 回详情则记忆切到 detail；回列表则清记忆（用户明确退出编辑状态）
      onBack: () => (detailId ? openDetail(detailId) : backToList()),
    });
  }

  /** 回列表：同时把视图记忆重置为 list，用户不会被卡在详情/编辑器里出不来。 */
  function backToList() {
    resetPipelineView();
    setMode('list');
  }

  if (mode === 'detail') {
    if (!detailPipeline) {
      return h(
        'div',
        null,
        h(Button, { size: 'sm', icon: 'chevron', label: '← 流水线列表', onClick: backToList }),
        loadingDetail ? h(Empty, { text: '加载中…' }) : h(Empty, { text: '找不到这条流水线（可能已被删除）' }),
      );
    }
    return h(
      'div',
      null,
      h(PipelineDetail, {
        pipeline: detailPipeline,
        runs: props.state.runs,
        nodes: props.state.nodes,
        onBack: backToList,
        onEdit: openEditor,
        onRun: (p) => setRunTarget(p),
        onReload: props.onReload,
        onOpenRun: props.onOpenRun,
      }),
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

  return h(
    'div',
    null,
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' } },
      h('h2', { className: 'dsh-devops-title' }, '流水线'),
      h('span', { className: 'dsh-devops-hint' }, '点名称看详情，详情里可以编辑或运行'),
      h('div', { className: 'dsh-devops-spacer' }),
    ),
    h(PipelineList, {
      pipelines: props.state.pipelines,
      runs: props.state.runs,
      activeRunsByPipeline,
      onCreate: () => setCreateOpen(true),
      onOpen: openDetail,
      onEdit: openEditor,
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
exports.PipelineList = PipelineList;
exports.PipelineDetail = PipelineDetail;
exports.ReadonlyBoard = ReadonlyBoard;
exports.DetailDrawer = DetailDrawer;
exports.NodeInfoPanel = NodeInfoPanel;
exports.NodeLogPanel = NodeLogPanel;
exports.NodeCard = NodeCard;
exports.DETAIL_TABS = DETAIL_TABS;
exports.latestRunForStep = latestRunForStep;
exports.whenLabel = whenLabel;
exports.rawValue = rawValue;
exports.PipelineNameCell = PipelineNameCell;
exports.activeRunOf = activeRunOf;
exports.blankPipeline = blankPipeline;
exports.runSummaryByPipeline = runSummaryByPipeline;
exports.stepStatusMap = stepStatusMap;
exports.toneOfStatus = toneOfStatus;
exports.readViewState = readViewState;
exports.writeViewState = writeViewState;
exports.resetPipelineView = resetPipelineView;
exports.resolvePipelineView = resolvePipelineView;
exports.loadPipelineForView = loadPipelineForView;
exports.resolveListFilters = resolveListFilters;
