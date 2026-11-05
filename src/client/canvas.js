/**
 * 流水线画布：横向编排（阶段 = 列，列内节点自上而下堆叠为块状卡片）。
 *
 * 设计要点：
 * - 阶段自左向右成列，画布横向可滚动；列头、列与列之间、画布末尾都能就地插入新阶段。
 * - 节点是块状卡片：序号 / 标题 / 节点类型 / 执行条件 / 服务器 / 超时 / needs / 产物。
 * - 动效只用 CSS transition/animation（见 styles.js），并尊重 prefers-reduced-motion。
 * - 所有结构变更都通过 props.onChange(完整新对象) 一次性提交完整新对象，
 *   保证不出现「基于过期 props 二次修改」的覆盖问题。
 *
 * 契约约束（docs/CONTRACT.md §2.1）：needs（DAG 调度）与阶段 parallel 不得混用。
 * 因此开启阶段并行前先检查，冲突时阻止提交并给出可见提示。
 */
const { h, useState, useEffect, useRef, useMemo } = require('./h.js');
const { Chip, Icon } = require('./ui.js');

/** 生成稳定 id：优先用安全字符集，冲突时加短随机后缀。 */
function makeId(prefix, existing) {
  const taken = new Set(existing || []);
  for (let i = 0; i < 40; i += 1) {
    const id = prefix + '-' + Math.random().toString(36).slice(2, 6);
    if (!taken.has(id)) return id;
  }
  return prefix + '-' + Date.now().toString(36);
}

/** 拖拽上下文：用模块级变量而非 dataTransfer，兼容性更好。 */
const dragState = { current: null };

/**
 * 二次确认。浏览器里有 window.confirm；Node 测试环境里没有 → 返回 undefined（视为已确认）。
 * 这样「有没有确认框」不会与「点了按钮是否提交」绑死：用例显式把 globalThis.confirm
 * 打成 () => false 就能验证取消分支。
 */
function browserConfirm(message) {
  if (typeof globalThis === 'undefined' || typeof globalThis.confirm !== 'function') return undefined;
  return globalThis.confirm(message);
}

/** 深拷贝：画布上所有结构变更都在副本上做，再整体提交。 */
function clonePipeline(pipeline) {
  return JSON.parse(JSON.stringify(pipeline || {}));
}

/** 新建 job 的默认形状，严格对齐契约 §2.1。 */
function newJob(id, descriptor) {
  const withDefaults = {};
  for (const field of descriptor.fields || []) {
    if (field.default !== undefined && field.default !== '') withDefaults[field.name] = field.default;
  }
  return {
    id,
    name: descriptor.title || descriptor.type,
    node: descriptor.type,
    server: '',
    needs: [],
    retry: { max: 0, delayMs: 1000 },
    timeoutMs: 600000,
    allowFailure: false,
    when: 'on_success',
    allowProvision: false,
    env: [],
    envSetRefs: [],
    with: withDefaults,
    artifacts: [],
    cache: { key: '', paths: [] },
  };
}

function collectJobIds(pipeline) {
  const ids = [];
  for (const stage of (pipeline && pipeline.stages) || []) {
    for (const job of stage.jobs || []) ids.push(job.id);
  }
  return ids;
}

/**
 * 流水线是否已声明 needs。
 * 契约 §2.1：任一 job 有非空 needs → 整条流水线走 DAG；此时不得再开启阶段并行。
 */
function pipelineHasNeeds(pipeline) {
  for (const stage of (pipeline && pipeline.stages) || []) {
    for (const job of stage.jobs || []) {
      if (job.needs && job.needs.length) return true;
    }
  }
  return false;
}

/**
 * 清掉所有 job 中指向「已被删除的 job」的 needs。
 *
 * 与 editor.js 的 deleteJob() 同一语义：删节点必须顺带清依赖，否则会留下悬空 needs。
 * 悬空 needs 的后果已实测（真实校验函数）：
 * - validatePipeline 报 stages[x].jobs[y].needs[z] / missing-field「依赖的作业不存在」
 * - buildGraph 报 job:x.needs / unknown-dependency，运行时抛「job j2 依赖了不存在的 job：j1」
 * 因此删除阶段时必须在**同一份新对象**里清理，保证删除后仍可通过校验、可运行。
 *
 * @param {{stages?: Array}} next 已改过的流水线副本（原地清理）
 * @param {string[]} removedIds 被删除的 job id
 * @returns {number} 被清掉的 needs 条数
 */
function cleanRemovedNeeds(next, removedIds) {
  const removed = new Set(removedIds || []);
  if (removed.size === 0) return 0;
  let cleaned = 0;
  for (const stage of (next && next.stages) || []) {
    for (const job of stage.jobs || []) {
      if (!Array.isArray(job.needs) || job.needs.length === 0) continue;
      const kept = job.needs.filter((n) => !removed.has(n));
      if (kept.length !== job.needs.length) {
        cleaned += job.needs.length - kept.length;
        job.needs = kept;
      }
    }
  }
  return cleaned;
}

/** 数值取一位小数，避免路径字符串里出现长浮点。 */
function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * 依赖边的几何计算（列布局专用，纯函数便于测试）。
 *
 * rect 形如 { left, top, width, height }，坐标同为「画布内容坐标系」。
 * 列布局下不能假设起止点左右相邻，故分三种走线：
 * - forward ：下游在右侧 → 出右边缘、入左边缘，横向控制点。
 * - vertical：上下游同列（上下相邻）→ 出下边缘、入上边缘，纵向控制点。
 * - backward：下游在左侧（跨列回指）→ 从卡片下方绕行，避免压住卡片。
 */
function buildEdgePath(a, b) {
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  const bx = b.left + b.width / 2;
  const by = b.top + b.height / 2;

  // 同列：水平中心几乎重合
  if (Math.abs(bx - ax) < 16) {
    const down = by >= ay;
    const x1 = ax;
    const y1 = down ? a.top + a.height : a.top;
    const x2 = bx;
    const y2 = down ? b.top : b.top + b.height;
    const my = (y1 + y2) / 2;
    return {
      kind: 'vertical',
      d:
        'M' + round1(x1) + ',' + round1(y1) +
        ' C' + round1(x1) + ',' + round1(my) +
        ' ' + round1(x2) + ',' + round1(my) +
        ' ' + round1(x2) + ',' + round1(y2),
    };
  }

  // 下游在右侧：右边缘 → 左边缘
  if (bx > ax) {
    const x1 = a.left + a.width;
    const y1 = ay;
    const x2 = b.left;
    const y2 = by;
    const dx = Math.max(28, (x2 - x1) / 2);
    return {
      kind: 'forward',
      d:
        'M' + round1(x1) + ',' + round1(y1) +
        ' C' + round1(x1 + dx) + ',' + round1(y1) +
        ' ' + round1(x2 - dx) + ',' + round1(y2) +
        ' ' + round1(x2) + ',' + round1(y2),
    };
  }

  // 反向（下游列在左侧）：从两张卡片下方绕行
  const x1 = ax;
  const y1 = a.top + a.height;
  const x2 = bx;
  const y2 = b.top + b.height;
  const cy = Math.max(y1, y2) + 22;
  return {
    kind: 'backward',
    d:
      'M' + round1(x1) + ',' + round1(y1) +
      ' C' + round1(x1) + ',' + round1(cy) +
      ' ' + round1(x2) + ',' + round1(cy) +
      ' ' + round1(x2) + ',' + round1(y2),
  };
}

/** 元素相对画布内容原点的矩形。 */
function rectOf(el, base) {
  const r = el.getBoundingClientRect();
  return { left: r.left - base.left, top: r.top - base.top, width: r.width, height: r.height };
}

/**
 * 块状节点卡片。
 * props: { job, stageId, index, selected, dragging, onSelect, onDragStart, onDragEnd, readonly }
 *
 * readonly=true 时同构复用为只读卡片（详情页等）：不设 draggable、不挂拖拽回调、
 * 文案也不再提示拖拽。只读分支不影响编辑器——编辑器不传 readonly，走的仍是原路径。
 */
function NodeCard(props) {
  const job = props.job;
  const readonly = props.readonly === true;
  const whenText = job.when === 'manual' ? '手动触发' : job.when === 'always' ? '总是执行' : '上游成功后';
  const seconds = job.timeoutMs ? Math.round(job.timeoutMs / 1000) : 0;
  const needs = job.needs || [];
  const artifacts = job.artifacts || [];

  /**
   * 状态色：把运行状态挂成 data-status / data-tone，颜色由 styles.js 决定。
   * 编辑器里通常没有运行数据（status 为 pending，保持中性）；
   * 详情页/运行页会把该节点最近一次执行状态传进来。
   */
  const status = props.status || 'pending';
  const statusTone =
    status === 'success' ? 'ok'
      : status === 'failed' ? 'error'
        : status === 'running' ? 'busy'
          : status === 'canceled' ? 'warn'
            : 'idle';

  const cardProps = {
    className: 'dsh-devops-nodecard',
    'data-role': 'node-card',
    'data-readonly': readonly ? 'true' : undefined,
    'data-selected': props.selected ? 'true' : undefined,
    'data-dragging': props.dragging ? 'true' : undefined,
    'data-status': status,
    'data-tone': statusTone,
    draggable: readonly ? false : true,
    title: readonly ? '点击查看节点信息' : '拖拽可调整顺序或移动到其它阶段',
    onClick: (e) => {
      if (e && e.stopPropagation) e.stopPropagation();
      if (props.onSelect) props.onSelect(job.id);
    },
  };
  if (!readonly) {
    cardProps.onDragStart = (e) => {
      dragState.current = { jobId: job.id, stageId: props.stageId };
      if (props.onDragStart) props.onDragStart(job.id);
      try {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', job.id);
      } catch {
        /* 某些环境不允许写 dataTransfer，忽略 */
      }
    };
    cardProps.onDragEnd = () => {
      dragState.current = null;
      if (props.onDragEnd) props.onDragEnd();
    };
  }

  return h(
    'div',
    cardProps,
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
      h('span', { className: 'dsh-devops-truncate' }, whenText),
      h('span', { className: 'dsh-devops-nodecard-key' }, '服务器'),
      h('span', { className: 'dsh-devops-truncate' }, job.server || '（默认）'),
      seconds ? h('span', { className: 'dsh-devops-nodecard-key' }, '超时') : null,
      seconds ? h('span', null, seconds + 's') : null,
    ),
    needs.length
      ? h(
          'div',
          { className: 'dsh-devops-nodecard-needs' },
          h('span', { className: 'dsh-devops-nodecard-key' }, 'needs'),
          needs.map((need) => h('span', { key: need, className: 'dsh-devops-nodecard-need' }, need)),
        )
      : null,
    artifacts.length ? h('div', { className: 'dsh-devops-nodecard-foot' }, artifacts.length + ' 项产物') : null,
  );
}

/** 列头小按钮：统一 data-role 便于定位与测试。 */
function HeadButton(props) {
  return h(
    'button',
    {
      type: 'button',
      className: 'dsh-devops-headbtn',
      'data-role': props.role,
      'data-active': props.active ? 'true' : undefined,
      'data-disabled': props.disabled ? 'true' : undefined,
      title: props.title,
      'aria-label': props.title,
      disabled: props.disabled || undefined,
      onClick: (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        if (!props.disabled && props.onClick) props.onClick();
      },
    },
    props.icon ? h(Icon, { name: props.icon, size: 12 }) : null,
    props.label ? h('span', null, props.label) : null,
  );
}

/**
 * 「就地新增阶段」入口。
 * kind: 'gap'（列与列之间）| 'head'（列头）| 'end'（画布末尾追加）。
 * data-index 表示插入位置（新阶段将落在该下标）。
 */
function AddStageButton(props) {
  const label = props.label === undefined ? '阶段' : props.label;
  return h(
    'button',
    {
      type: 'button',
      className: 'dsh-devops-addstage',
      'data-role': 'add-stage',
      'data-kind': props.kind,
      'data-index': String(props.index),
      'data-after-stage': props.afterStage || undefined,
      title: props.title || '在此处插入新阶段',
      'aria-label': props.title || '在此处插入新阶段',
      onClick: (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        props.onClick();
      },
    },
    h(Icon, { name: 'plus', size: 12 }),
    label ? h('span', { className: 'dsh-devops-addstage-label' }, label) : null,
  );
}

/**
 * 画布。
 * props: { pipeline, onChange, selectedJob, onSelectJob, registerAddNode, toast }
 */
function Canvas(props) {
  const pipeline = props.pipeline;
  const stages = (pipeline && pipeline.stages) || [];

  const [dragOver, setDragOver] = useState(null);
  const [draggingJob, setDraggingJob] = useState('');
  const [activeStage, setActiveStage] = useState('');
  const [notice, setNotice] = useState('');
  const [edgePaths, setEdgePaths] = useState([]);
  const boardRef = useRef(null);
  const dropRef = useRef(null);

  /** 拖放目标同步写 ref：事件回调里不依赖可能过期的 state 闭包。 */
  function setDrop(next) {
    dropRef.current = next;
    setDragOver(next);
  }

  function warn(text) {
    setNotice(text);
    if (props.toast && props.toast.warn) props.toast.warn(text);
  }

  const jobIndex = useMemo(() => {
    const map = new Map();
    for (const stage of stages) {
      for (const job of stage.jobs || []) map.set(job.id, { job, stageId: stage.id });
    }
    return map;
  }, [stages]);

  /** 计算依赖边：按列布局的卡片位置走线（不再假设左右相邻）。 */
  useEffect(() => {
    function recompute() {
      const board = boardRef.current;
      if (!board || typeof board.getBoundingClientRect !== 'function') return;
      const base = board.getBoundingClientRect();
      const paths = [];
      for (const stage of stages) {
        for (const job of stage.jobs || []) {
          for (const need of job.needs || []) {
            if (!jobIndex.has(need)) continue;
            const fromEl = board.querySelector('[data-job="' + cssEscape(need) + '"]');
            const toEl = board.querySelector('[data-job="' + cssEscape(job.id) + '"]');
            if (!fromEl || !toEl) continue;
            const built = buildEdgePath(rectOf(fromEl, base), rectOf(toEl, base));
            paths.push({ key: need + '->' + job.id, d: built.d, kind: built.kind });
          }
        }
      }
      setEdgePaths(paths);
    }
    recompute();
    const board = boardRef.current;
    const observer = typeof ResizeObserver !== 'undefined' && board ? new ResizeObserver(recompute) : null;
    if (observer) observer.observe(board);
    if (typeof window !== 'undefined') window.addEventListener('resize', recompute);
    const timer = setTimeout(recompute, 60);
    return () => {
      if (observer) observer.disconnect();
      if (typeof window !== 'undefined') window.removeEventListener('resize', recompute);
      clearTimeout(timer);
    };
  }, [stages, jobIndex, props.selectedJob, activeStage]);

  /** 把节点加到指定阶段（若没有阶段则先建一个）。 */
  function addNodeToStage(descriptor, stageId) {
    const next = clonePipeline(pipeline);
    next.stages = next.stages || [];
    if (next.stages.length === 0) {
      next.stages.push({ id: makeId('stage', []), name: '构建', parallel: false, jobs: [] });
    }
    const target = stageId
      ? next.stages.find((s) => s.id === stageId)
      : next.stages.find((s) => s.id === activeStage) || next.stages[next.stages.length - 1];
    if (!target) return;
    const id = makeId((descriptor.type || 'step').split('.').pop(), collectJobIds(next));
    target.jobs = (target.jobs || []).concat([newJob(id, descriptor)]);
    props.onChange(next);
    if (props.onSelectJob) props.onSelectJob(id);
  }

  const addNodeRef = useRef(addNodeToStage);
  addNodeRef.current = addNodeToStage;
  useEffect(() => {
    if (props.registerAddNode) {
      props.registerAddNode((descriptor, stageId) => addNodeRef.current(descriptor, stageId));
    }
  });

  /** 移动节点（含跨阶段与列内插入到指定卡片之前）。 */
  function moveJob(jobId, fromStageId, toStageId, beforeJobId) {
    const next = clonePipeline(pipeline);
    next.stages = next.stages || [];
    const from = next.stages.find((s) => s.id === fromStageId);
    if (!from) return;
    const fromIdx = (from.jobs || []).findIndex((j) => j.id === jobId);
    if (fromIdx < 0) return;
    const moved = from.jobs.splice(fromIdx, 1)[0];
    const target = next.stages.find((s) => s.id === toStageId);
    if (!target) {
      from.jobs.splice(fromIdx, 0, moved);
      return;
    }
    target.jobs = target.jobs || [];
    if (beforeJobId && beforeJobId !== jobId) {
      const at = target.jobs.findIndex((j) => j.id === beforeJobId);
      if (at >= 0) target.jobs.splice(at, 0, moved);
      else target.jobs.push(moved);
    } else {
      target.jobs.push(moved);
    }
    // 同阶段且顺序未变则不提交（避免产生无意义的 onChange）
    if (fromStageId === toStageId) {
      const original = ((pipeline.stages || []).find((s) => s.id === fromStageId) || {}).jobs || [];
      if (original.map((j) => j.id).join('|') === target.jobs.map((j) => j.id).join('|')) return;
    }
    props.onChange(next);
  }

  /** 在指定下标插入阶段：默认 parallel:false（契约 §2.1 默认走阶段串行）。 */
  function insertStage(index) {
    const next = clonePipeline(pipeline);
    next.stages = next.stages || [];
    const at = Math.max(0, Math.min(typeof index === 'number' ? index : next.stages.length, next.stages.length));
    const stage = {
      id: makeId('stage', next.stages.map((s) => s.id)),
      name: '新阶段 ' + (at + 1),
      parallel: false,
      jobs: [],
    };
    next.stages.splice(at, 0, stage);
    props.onChange(next);
    setActiveStage(stage.id);
  }

  function updateStage(stageId, patch) {
    const next = clonePipeline(pipeline);
    const stage = (next.stages || []).find((s) => s.id === stageId);
    if (!stage) return;
    Object.assign(stage, patch);
    props.onChange(next);
  }

  /** 阶段「并行」开关：与 needs 冲突时阻止提交并提示（契约禁止混用）。 */
  function toggleParallel(stage) {
    if (!stage.parallel && pipelineHasNeeds(pipeline)) {
      warn('这条流水线已有节点声明了 needs（DAG 调度），契约不允许再开启阶段并行。请先清除相关 needs。');
      return;
    }
    updateStage(stage.id, { parallel: !stage.parallel });
  }

  /**
   * 删除整个阶段：先二次确认，再在**同一份新对象**里清掉所有指向被删节点的 needs。
   *
   * 现状缺陷（用户原话「删除整个阶段没有确认，删除之后就炸了」）：
   * 1. 全工程只有它没有确认框（删流水线/模板/服务器/环境变量组/自定义节点都有）。
   * 2. 只 filter 阶段、不清理 needs，留下悬空依赖 → 校验报 missing-field、运行抛
   *    「job j2 依赖了不存在的 job：j1」。
   *
   * browserConfirm 是模块级函数：浏览器里就是 window.confirm()；Node 测试环境里没有它
   * （返回 undefined）即视为「已确认」，从而让既有用例仍能走到提交分支。
   * 需要验证「取消不提交」时，用例把 globalThis.confirm 打成返回 false 即可。
   */
  function removeStage(stageId) {
    const stage = stages.find((s) => s.id === stageId);
    if (!stage) return;

    const removedIds = (stage.jobs || []).map((j) => j.id);
    const dependents = [];
    for (const s of stages) {
      for (const job of s.jobs || []) {
        if (removedIds.some((id) => (job.needs || []).includes(id))) dependents.push(job.id);
      }
    }

    const parts = ['确定删除阶段「' + (stage.name || stage.id) + '」？'];
    parts.push(removedIds.length ? '该阶段内 ' + removedIds.length + ' 个节点会被一并删除' : '该阶段内没有节点');
    if (dependents.length) {
      parts.push('；依赖这些节点的 ' + dependents.length + ' 个节点（' + dependents.join('、') + '）会自动移除相关 needs');
    }
    parts.push('。');

    // 只有在确认框**明确返回 false** 时才取消；返回 undefined（无确认框的环境）视为已确认。
    if (browserConfirm(parts.join('')) === false) return;

    const next = clonePipeline(pipeline);
    next.stages = (next.stages || []).filter((s) => s.id !== stageId);
    const cleaned = cleanRemovedNeeds(next, removedIds);

    // 同一次提交里提示清理结果；否则用户会以为依赖凭空消失。
    if (cleaned > 0) warn('已删除阶段「' + (stage.name || stage.id) + '」，并清理了 ' + cleaned + ' 条指向被删节点的 needs。');

    props.onChange(next);

    // 检查器不得停留在已不存在的节点上（否则右栏会显示一个幽灵节点）。
    const selectedStillExists = removedIds.some((id) => props.selectedJob === id);
    if (selectedStillExists && props.onSelectJob) props.onSelectJob(null);
  }

  function moveStage(stageId, delta) {
    const next = clonePipeline(pipeline);
    next.stages = next.stages || [];
    const idx = next.stages.findIndex((s) => s.id === stageId);
    const to = idx + delta;
    if (idx < 0 || to < 0 || to >= next.stages.length) return;
    const item = next.stages.splice(idx, 1)[0];
    next.stages.splice(to, 0, item);
    props.onChange(next);
  }

  function renameStage(stage) {
    if (typeof prompt !== 'function') return;
    const name = prompt('阶段名称', stage.name);
    if (name) updateStage(stage.id, { name });
  }

  const fallbackDescriptor = { type: 'shell.exec', title: '执行 Shell', fields: [{ name: 'script', default: '' }] };

  /** 渲染一列（阶段）。 */
  function columnNode(stage, stageIndex) {
    return h(
      'div',
      {
        key: stage.id,
        className: 'dsh-devops-column',
        'data-role': 'stage-column',
        'data-stage-id': stage.id,
        'data-parallel': stage.parallel ? 'true' : undefined,
        'data-active': activeStage === stage.id ? 'true' : undefined,
        'data-drop': dragOver && dragOver.stageId === stage.id ? 'true' : undefined,
        onClick: (e) => {
          if (e && e.stopPropagation) e.stopPropagation();
          setActiveStage(stage.id);
        },
      },
      h(
        'div',
        { className: 'dsh-devops-column-head' },
        h('span', { className: 'dsh-devops-column-index' }, String(stageIndex + 1)),
        h(
          'span',
          {
            className: 'dsh-devops-column-title dsh-devops-truncate',
            title: '双击可改名',
            onDoubleClick: (e) => {
              if (e && e.stopPropagation) e.stopPropagation();
              renameStage(stage);
            },
          },
          stage.name || stage.id,
        ),
        stage.parallel ? h(Chip, { tone: 'busy', title: '阶段内节点并行执行' }, '并行') : null,
        h('span', { className: 'dsh-devops-hint' }, (stage.jobs || []).length + ' 节点'),
      ),
      h(
        'div',
        { className: 'dsh-devops-column-tools' },
        h(HeadButton, {
          role: 'parallel-toggle',
          icon: stage.parallel ? 'pause' : 'grid',
          active: !!stage.parallel,
          title: stage.parallel ? '关闭阶段并行' : '开启阶段并行（与 needs 不能混用）',
          onClick: () => toggleParallel(stage),
        }),
        h(HeadButton, {
          role: 'stage-add-node',
          icon: 'plus',
          label: '节点',
          title: '在此阶段添加一个 Shell 节点',
          onClick: () => addNodeToStage(fallbackDescriptor, stage.id),
        }),
        h(AddStageButton, {
          kind: 'head',
          index: stageIndex + 1,
          afterStage: stage.id,
          title: '在此列右侧插入新阶段',
          label: '阶段',
          onClick: () => insertStage(stageIndex + 1),
        }),
        h('div', { className: 'dsh-devops-spacer' }),
        h(HeadButton, { role: 'stage-move-prev', icon: 'chevron', title: '左移阶段', disabled: stageIndex === 0, onClick: () => moveStage(stage.id, -1) }),
        h(HeadButton, {
          role: 'stage-move-next',
          icon: 'chevronDown',
          title: '右移阶段',
          disabled: stageIndex === stages.length - 1,
          onClick: () => moveStage(stage.id, 1),
        }),
        h(HeadButton, { role: 'stage-remove', icon: 'trash', title: '删除阶段', onClick: () => removeStage(stage.id) }),
      ),
      h(
        'div',
        {
          className: 'dsh-devops-column-cards',
          'data-role': 'stage-cards',
          onDragOver: (e) => {
            e.preventDefault();
            if (e.stopPropagation) e.stopPropagation();
            setDrop({ stageId: stage.id, before: null });
          },
          onDragLeave: () => {
            const cur = dropRef.current;
            if (cur && cur.stageId === stage.id && !cur.before) setDrop(null);
          },
          onDrop: (e) => {
            e.preventDefault();
            if (e.stopPropagation) e.stopPropagation();
            const data = dragState.current;
            const target = dropRef.current;
            setDrop(null);
            if (!data) return;
            const before = target && target.stageId === stage.id ? target.before : null;
            moveJob(data.jobId, data.stageId, stage.id, before);
          },
        },
        (stage.jobs || []).map((job, jobIndexInStage) =>
          h(
            'div',
            {
              key: job.id,
              className: 'dsh-devops-slot',
              'data-job': job.id,
              'data-drop-before':
                dragOver && dragOver.stageId === stage.id && dragOver.before === job.id ? 'true' : undefined,
              onDragOver: (e) => {
                e.preventDefault();
                if (e.stopPropagation) e.stopPropagation();
                setDrop({ stageId: stage.id, before: job.id });
              },
              onDrop: (e) => {
                e.preventDefault();
                if (e.stopPropagation) e.stopPropagation();
                const data = dragState.current;
                const target = dropRef.current;
                setDrop(null);
                if (!data) return;
                const before = target && target.stageId === stage.id ? target.before : job.id;
                moveJob(data.jobId, data.stageId, stage.id, before);
              },
            },
            h(NodeCard, {
              job,
              stageId: stage.id,
              index: jobIndexInStage + 1,
              selected: props.selectedJob === job.id,
              dragging: draggingJob === job.id,
              onSelect: props.onSelectJob,
              onDragStart: setDraggingJob,
              onDragEnd: () => setDraggingJob(''),
            }),
          ),
        ),
        (stage.jobs || []).length === 0 ? h('div', { className: 'dsh-devops-column-empty' }, '把节点拖到这里') : null,
      ),
    );
  }

  const boardChildren = [];
  stages.forEach((stage, stageIndex) => {
    boardChildren.push(columnNode(stage, stageIndex));
    if (stageIndex < stages.length - 1) {
      boardChildren.push(
        h(AddStageButton, {
          key: 'gap-' + stage.id,
          kind: 'gap',
          index: stageIndex + 1,
          afterStage: stage.id,
          title: '在这两列之间插入新阶段',
          label: '插入阶段',
          onClick: () => insertStage(stageIndex + 1),
        }),
      );
    }
  });
  boardChildren.push(
    h(AddStageButton, {
      key: 'add-stage-end',
      kind: 'end',
      index: stages.length,
      title: '在画布末尾追加一个阶段',
      label: '添加阶段',
      onClick: () => insertStage(stages.length),
    }),
  );

  return h(
    'div',
    {
      className: 'dsh-devops-canvas',
      'data-role': 'canvas',
      onClick: () => props.onSelectJob && props.onSelectJob(null),
    },
    notice
      ? h(
          'div',
          {
            className: 'dsh-devops-banner dsh-devops-canvas-notice',
            'data-role': 'canvas-notice',
            'data-tone': 'warn',
            role: 'alert',
          },
          h('span', null, notice),
          h('button', { type: 'button', className: 'dsh-devops-link', onClick: () => setNotice('') }, '知道了'),
        )
      : null,
    h(
      'div',
      { className: 'dsh-devops-board', 'data-role': 'board', ref: boardRef },
      h(
        'svg',
        { className: 'dsh-devops-edges', width: '100%', height: '100%', 'aria-hidden': 'true' },
        h(
          'defs',
          null,
          h(
            'marker',
            { id: 'dsh-devops-arrow', viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 6, markerHeight: 6, orient: 'auto' },
            h('path', { d: 'M0,0 L8,4 L0,8 z', fill: 'var(--dsw-alias-border-l4)' }),
          ),
        ),
        edgePaths.map((edge) =>
          h('path', {
            key: edge.key,
            'data-edge-kind': edge.kind,
            d: edge.d,
            fill: 'none',
            stroke: 'var(--dsw-alias-border-l4)',
            strokeWidth: 1.2,
            strokeDasharray: '4 3',
            markerEnd: 'url(#dsh-devops-arrow)',
          }),
        ),
      ),
      stages.length === 0
        ? h(
            'div',
            { className: 'dsh-devops-empty dsh-devops-board-empty', 'data-role': 'canvas-empty' },
            '还没有阶段：点右侧「添加阶段」，或直接点左侧节点面板里的任意节点开始编排。',
            h(
              'div',
              { style: { marginTop: '6px' } },
              '注意：当前没有可运行的节点，直接点「运行」会被拒绝（引擎会报「流水线不可执行：没有任何 job」）。',
            ),
          )
        : null,
      boardChildren,
    ),
  );
}

function cssEscape(value) {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(String(value));
  return String(value).replace(/["\\]/g, '\\$&');
}

/** 声明式能力标志：消费方（如详情页）据此决定是否复用本组件做只读卡片。 */
NodeCard.supportsReadonly = true;

exports.Canvas = Canvas;
exports.NodeCard = NodeCard;
exports.AddStageButton = AddStageButton;
exports.HeadButton = HeadButton;
exports.makeId = makeId;
exports.newJob = newJob;
exports.collectJobIds = collectJobIds;
exports.pipelineHasNeeds = pipelineHasNeeds;
exports.cleanRemovedNeeds = cleanRemovedNeeds;
exports.buildEdgePath = buildEdgePath;
exports.clonePipeline = clonePipeline;
exports.rectOf = rectOf;
