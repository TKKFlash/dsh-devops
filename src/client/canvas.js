/**
 * 流水线画布：阶段泳道 + 卡片拖拽（自研，HTML5 DnD）
 * + 「并行」开关 + needs 依赖边（SVG 贝塞尔）。
 * 不引任何拖拽/图表库。
 *
 * 所有结构变更都通过 props.onChange(nextPipeline) 一次性提交完整新对象，
 * 保证不出现「基于过期 props 二次修改」的覆盖问题。
 */
const { h, useState, useEffect, useRef, useMemo } = require('./h.js');
const { Button, Chip } = require('./ui.js');

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

function NodeCard(props) {
  const job = props.job;
  return h(
    'div',
    {
      className: 'dsh-devops-nodecard',
      'data-selected': props.selected ? 'true' : undefined,
      'data-dragging': props.dragging ? 'true' : undefined,
      draggable: true,
      title: '拖拽可调整顺序或移动到其它阶段',
      onClick: (e) => {
        e.stopPropagation();
        props.onSelect(job.id);
      },
      onDragStart: (e) => {
        dragState.current = { jobId: job.id, stageId: props.stageId };
        props.onDragStart && props.onDragStart(job.id);
        try {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', job.id);
        } catch {
          /* 某些环境不允许写 dataTransfer，忽略 */
        }
      },
      onDragEnd: () => {
        dragState.current = null;
        props.onDragEnd && props.onDragEnd();
      },
    },
    h('div', { className: 'dsh-devops-nodecard-title dsh-devops-truncate' }, job.name || job.id),
    h(
      'div',
      { className: 'dsh-devops-nodecard-meta' },
      h('span', null, job.node),
      h('span', null, job.when === 'manual' ? '手动' : job.when === 'always' ? '总是' : '成功时'),
      job.server ? h('span', null, job.server) : null,
    ),
    job.needs && job.needs.length ? h('div', { className: 'dsh-devops-nodecard-meta', style: { marginTop: '3px' } }, 'needs：' + job.needs.join('、')) : null,
  );
}

/**
 * 画布。
 * props: { pipeline, onChange, selectedJob, onSelectJob, registerAddNode }
 */
function Canvas(props) {
  const pipeline = props.pipeline;
  const [dragOverStage, setDragOverStage] = useState('');
  const [draggingJob, setDraggingJob] = useState('');
  const containerRef = useRef(null);
  const [edgePaths, setEdgePaths] = useState([]);

  const stages = (pipeline && pipeline.stages) || [];

  const jobIndex = useMemo(() => {
    const map = new Map();
    for (const stage of stages) {
      for (const job of stage.jobs || []) map.set(job.id, { job, stageId: stage.id });
    }
    return map;
  }, [stages]);

  /** 计算依赖边的贝塞尔路径：从上游卡片右侧到下游卡片左侧。 */
  useEffect(() => {
    function recompute() {
      const root = containerRef.current;
      if (!root) return;
      const rootRect = root.getBoundingClientRect();
      const paths = [];
      for (const stage of stages) {
        for (const job of stage.jobs || []) {
          for (const need of job.needs || []) {
            if (!jobIndex.has(need)) continue;
            const fromEl = root.querySelector('[data-job="' + cssEscape(need) + '"]');
            const toEl = root.querySelector('[data-job="' + cssEscape(job.id) + '"]');
            if (!fromEl || !toEl) continue;
            const a = fromEl.getBoundingClientRect();
            const b = toEl.getBoundingClientRect();
            const x1 = a.right - rootRect.left + root.scrollLeft;
            const y1 = a.top + a.height / 2 - rootRect.top + root.scrollTop;
            const x2 = b.left - rootRect.left + root.scrollLeft;
            const y2 = b.top + b.height / 2 - rootRect.top + root.scrollTop;
            const dx = Math.max(30, Math.abs(x2 - x1) * 0.5);
            paths.push({
              key: need + '->' + job.id,
              d: 'M' + x1 + ',' + y1 + ' C' + (x1 + dx) + ',' + y1 + ' ' + (x2 - dx) + ',' + y2 + ' ' + x2 + ',' + y2,
            });
          }
        }
      }
      setEdgePaths(paths);
    }
    recompute();
    const root = containerRef.current;
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(recompute) : null;
    if (observer && root) observer.observe(root);
    window.addEventListener('resize', recompute);
    const timer = setTimeout(recompute, 60);
    return () => {
      if (observer) observer.disconnect();
      window.removeEventListener('resize', recompute);
      clearTimeout(timer);
    };
  }, [stages, jobIndex, props.selectedJob]);

  /** 把节点加到指定阶段（若没有阶段则先建一个）。 */
  function addNodeToStage(descriptor, stageId) {
    const next = JSON.parse(JSON.stringify(pipeline));
    next.stages = next.stages || [];
    if (next.stages.length === 0) {
      next.stages.push({ id: makeId('stage', []), name: '构建', parallel: false, jobs: [] });
    }
    const stage = stageId ? next.stages.find((s) => s.id === stageId) : next.stages[next.stages.length - 1];
    if (!stage) return;
    const id = makeId((descriptor.type || 'step').split('.').pop(), collectJobIds(next));
    stage.jobs = (stage.jobs || []).concat([newJob(id, descriptor)]);
    props.onChange(next);
    props.onSelectJob && props.onSelectJob(id);
  }

  // 把「加节点」能力交给左侧面板；放到 effect 里避免每次渲染都重设。
  const addNodeRef = useRef(addNodeToStage);
  addNodeRef.current = addNodeToStage;
  useEffect(() => {
    if (props.registerAddNode) {
      props.registerAddNode((descriptor, stageId) => addNodeRef.current(descriptor, stageId));
    }
  });

  function moveJob(jobId, fromStageId, toStageId, beforeJobId) {
    if (fromStageId === toStageId && !beforeJobId) return;
    const next = JSON.parse(JSON.stringify(pipeline));
    let moved = null;
    for (const stage of next.stages) {
      if (stage.id !== fromStageId) continue;
      const idx = (stage.jobs || []).findIndex((j) => j.id === jobId);
      if (idx >= 0) moved = stage.jobs.splice(idx, 1)[0];
    }
    if (!moved) return;
    const target = next.stages.find((s) => s.id === toStageId);
    if (!target) return;
    target.jobs = target.jobs || [];
    if (beforeJobId) {
      const at = target.jobs.findIndex((j) => j.id === beforeJobId);
      if (at >= 0) target.jobs.splice(at, 0, moved);
      else target.jobs.push(moved);
    } else {
      target.jobs.push(moved);
    }
    props.onChange(next);
  }

  function addStage() {
    const next = JSON.parse(JSON.stringify(pipeline));
    next.stages = (next.stages || []).concat([
      { id: makeId('stage', (next.stages || []).map((s) => s.id)), name: '新阶段 ' + ((next.stages || []).length + 1), parallel: false, jobs: [] },
    ]);
    props.onChange(next);
  }

  function updateStage(stageId, patch) {
    const next = JSON.parse(JSON.stringify(pipeline));
    const stage = next.stages.find((s) => s.id === stageId);
    if (!stage) return;
    Object.assign(stage, patch);
    props.onChange(next);
  }

  function removeStage(stageId) {
    const next = JSON.parse(JSON.stringify(pipeline));
    next.stages = next.stages.filter((s) => s.id !== stageId);
    props.onChange(next);
  }

  function moveStage(stageId, delta) {
    const next = JSON.parse(JSON.stringify(pipeline));
    const idx = next.stages.findIndex((s) => s.id === stageId);
    const to = idx + delta;
    if (idx < 0 || to < 0 || to >= next.stages.length) return;
    const item = next.stages.splice(idx, 1)[0];
    next.stages.splice(to, 0, item);
    props.onChange(next);
  }

  const fallbackDescriptor = { type: 'shell.exec', title: '执行 Shell', fields: [{ name: 'script', default: '' }] };

  return h(
    'div',
    { className: 'dsh-devops-canvas', ref: containerRef, onClick: () => props.onSelectJob && props.onSelectJob(null) },
    h(
      'svg',
      { className: 'dsh-devops-edges', width: '100%', height: '100%' },
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
          d: edge.d,
          fill: 'none',
          stroke: 'var(--dsw-alias-border-l4)',
          strokeWidth: 1.2,
          strokeDasharray: '4 3',
          markerEnd: 'url(#dsh-devops-arrow)',
        }),
      ),
    ),
    stages.length === 0 ? h('div', { className: 'dsh-devops-empty' }, '还没有阶段：点左侧节点面板里的任意节点即可开始编排') : null,
    stages.map((stage, stageIndex) =>
      h(
        'div',
        {
          key: stage.id,
          className: 'dsh-devops-lane',
          'data-drop': dragOverStage === stage.id ? 'true' : undefined,
          onDragOver: (e) => {
            e.preventDefault();
            setDragOverStage(stage.id);
          },
          onDragLeave: () => setDragOverStage((cur) => (cur === stage.id ? '' : cur)),
          onDrop: (e) => {
            e.preventDefault();
            setDragOverStage('');
            const data = dragState.current;
            if (data) moveJob(data.jobId, data.stageId, stage.id, null);
          },
          onDoubleClick: () => {
            const name = prompt('阶段名称', stage.name);
            if (name) updateStage(stage.id, { name });
          },
        },
        h(
          'div',
          { className: 'dsh-devops-lane-head' },
          h('span', { className: 'dsh-devops-lane-title' }, stage.name || stage.id),
          h('span', { className: 'dsh-devops-hint' }, (stage.jobs || []).length + ' 个节点'),
          stage.parallel ? h(Chip, { tone: 'busy' }, '并行') : null,
          h('div', { className: 'dsh-devops-spacer' }),
          h(Button, {
            size: 'sm',
            variant: 'ghost',
            label: '并行',
            active: !!stage.parallel,
            title: '阶段内节点是否并行执行（与 needs 不能混用）',
            onClick: () => updateStage(stage.id, { parallel: !stage.parallel }),
          }),
          h(Button, {
            size: 'sm',
            variant: 'ghost',
            icon: 'plus',
            title: '在此阶段添加一个 Shell 节点',
            onClick: () => addNodeToStage(fallbackDescriptor, stage.id),
          }),
          h(Button, { size: 'sm', variant: 'ghost', icon: 'chevron', title: '上移阶段', onClick: () => moveStage(stage.id, -1), disabled: stageIndex === 0 }),
          h(Button, {
            size: 'sm',
            variant: 'ghost',
            icon: 'chevronDown',
            title: '下移阶段',
            onClick: () => moveStage(stage.id, 1),
            disabled: stageIndex === stages.length - 1,
          }),
          h(Button, { size: 'sm', variant: 'ghost', icon: 'trash', title: '删除阶段', onClick: () => removeStage(stage.id) }),
        ),
        h(
          'div',
          {
            className: 'dsh-devops-lane-cards',
            onDragOver: (e) => e.preventDefault(),
            onDrop: (e) => {
              e.preventDefault();
              e.stopPropagation();
              const data = dragState.current;
              if (data) moveJob(data.jobId, data.stageId, stage.id, null);
            },
          },
          (stage.jobs || []).map((job) =>
            h(
              'div',
              { key: job.id, 'data-job': job.id },
              h(NodeCard, {
                job,
                stageId: stage.id,
                selected: props.selectedJob === job.id,
                dragging: draggingJob === job.id,
                onSelect: props.onSelectJob,
                onDragStart: setDraggingJob,
                onDragEnd: () => setDraggingJob(''),
              }),
            ),
          ),
          (stage.jobs || []).length === 0 ? h('span', { className: 'dsh-devops-hint' }, '拖节点到这里') : null,
        ),
      ),
    ),
    h('div', { style: { display: 'flex', gap: '8px', marginTop: '4px' } }, h(Button, { size: 'sm', icon: 'plus', label: '添加阶段', onClick: addStage })),
  );
}

function cssEscape(value) {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(String(value));
  return String(value).replace(/["\\]/g, '\\$&');
}

exports.Canvas = Canvas;
exports.NodeCard = NodeCard;
exports.makeId = makeId;
exports.newJob = newJob;
exports.collectJobIds = collectJobIds;
