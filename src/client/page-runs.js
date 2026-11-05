/**
 * 运行页：运行列表 + 运行详情。
 * 详情包含进度环、阶段泳道、步骤卡片（点开看实时日志）、卡住诊断、失败归因。
 */
const { h, useState, useEffect, useMemo, useRef, useCallback, fmtDuration, fmtTime, fmtAgo, useTick, ellipsis } = require('./h.js');
const { Button, Card, Chip, Empty, ProgressRing, KV, Select, TextInput, Banner, StatusDot } = require('./ui.js');
const { api } = require('./api.js');
const { createRunStream } = require('./sse.js');
const { LogPanel } = require('./logs.js');
const { diagnoseStep, StuckPanel, PhaseFlow, humanMs, attributionFor } = require('./diagnostics.js');
const { AiButton, buildFailurePrompt } = require('./ai.js');
const { RUN_STATUS_TEXT, STEP_STATUS_TEXT, runTone, stepTone } = require('./state.js');
const { tokenizeLine, detectLanguage } = require('./syntax.js');

/**
 * 已结束步骤的静态日志：按**与实时日志同一套语法着色**渲染，
 * 避免同一份日志在「运行中」和「已结束」两种状态下观感不一致。
 * 语言按内容自动判断（日志通常是构建输出，猜错只是配色不同，不影响可读）。
 */
function StaticLogView(props) {
  const text = String(props.text || '');
  const maxLines = props.maxLines || 400;
  const all = text.split('\n');
  const shown = all.length > maxLines ? all.slice(all.length - maxLines) : all;
  const language = detectLanguage(text);
  return h(
    'div',
    { className: 'dsh-devops-loglines', 'data-language': language },
    shown.map((line, i) =>
      h(
        'div',
        { key: i, className: 'dsh-devops-logline' },
        tokenizeLine(line, language).map((token, j) =>
          h('span', { key: j, className: 'dsh-devops-tok dsh-devops-tok-' + token.kind }, token.text),
        ),
      ),
    ),
  );
}

/** 步骤耗时：进行中按当前时间算，结束后用 finishedAt。 */
function stepElapsed(step, now) {
  if (!step || !step.startedAt) return 0;
  return Math.max(0, (step.finishedAt || now) - step.startedAt);
}

/**
 * 步骤详情悬浮卡片：与流水线详情页**同一套形态契约**（圆角悬浮卡片 + 三个关闭方式）。
 *
 * 用户要求「不要一处侧栏一处卡片」：运行页这里同样把形态挂在既有类名 +
 * data-shape / data-variant / data-blur 属性上，视觉完全由 styles.js 决定。
 */
function StepDetailDrawer(props) {
  const step = props.step || null;
  const open = !!step;
  const [tab, setTab] = useState('info');

  // 打开时支持 Esc 关闭（Node 环境没有 document，跳过）
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

  const infoActive = tab === 'info';
  const status = step ? step.status : '';
  const elapsed = step ? stepElapsed(step, props.now || Date.now()) : 0;
  const infoEntries = step
    ? [
        ['步骤 id', h('span', { className: 'dsh-devops-monospace' }, step.id || '—')],
        ['名称', step.name || '—'],
        ['节点类型', h('span', { className: 'dsh-devops-monospace' }, step.node || '—')],
        ['阶段', step.stage || '未分组'],
        ['状态', STEP_STATUS_TEXT[step.status] || step.status || '—'],
        ['服务器', step.server || '（默认）'],
        ['退出码', step.exitCode === null || step.exitCode === undefined ? '—' : String(step.exitCode)],
        ['耗时', elapsed ? fmtDuration(elapsed) : '—'],
        ['尝试次数', step.attempt ? String(step.attempt) : '1'],
        ['输出字节', step.bytes ? step.bytes + ' B' : '—'],
        ['phase', step.phase || '—'],
      ]
    : [];

  return h(
    'div',
    {
      className: 'dsh-devops-drawer-layer',
      'data-role': 'step-detail-drawer',
      'data-shape': 'floating',
      'data-open': open ? 'true' : 'false',
      'data-tab': tab,
      'data-status': status || 'idle',
      'data-tone': status ? stepTone(status) : 'idle',
      'aria-hidden': open ? 'false' : 'true',
    },
    h('div', {
      className: 'dsh-devops-drawer-mask',
      'data-role': 'step-drawer-mask',
      'data-blur': 'true',
      onClick: () => props.onClose && props.onClose(),
    }),
    h(
      'aside',
      {
        className: 'dsh-devops-drawer',
        'data-role': 'step-drawer-panel',
        'data-variant': 'floating',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': '步骤详情',
      },
      h(
        'div',
        { className: 'dsh-devops-drawer-head' },
        h('span', { className: 'dsh-devops-drawer-title dsh-devops-truncate' }, step ? step.name || step.id : ''),
        step ? h('span', { className: 'dsh-devops-tag dsh-devops-monospace' }, step.node) : null,
        step ? h(Chip, { tone: stepTone(step.status), dot: true }, STEP_STATUS_TEXT[step.status] || step.status) : null,
        h('div', { className: 'dsh-devops-spacer' }),
        h(Button, { variant: 'ghost', size: 'sm', icon: 'close', label: '关闭', title: '关闭（Esc）', onClick: () => props.onClose && props.onClose() }),
      ),
      h(
        'div',
        { className: 'dsh-devops-tabs', role: 'tablist', 'data-role': 'step-drawer-tabs' },
        [{ id: 'info', label: '步骤信息' }, { id: 'log', label: '日志' }].map((item) =>
          h(
            'button',
            {
              key: item.id,
              type: 'button',
              role: 'tab',
              className: 'dsh-devops-tab',
              'data-role': 'step-drawer-tab',
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
        h('div', { 'data-role': 'step-drawer-view', 'data-view': 'info', hidden: !infoActive },
          infoActive
            ? h(
                'div',
                { className: 'dsh-devops-drawer-panel' },
                h(
                  'div',
                  { className: 'dsh-devops-card', 'data-role': 'step-info-group' },
                  h('div', { className: 'dsh-devops-card-head' }, h('span', { className: 'dsh-devops-card-title' }, '执行信息')),
                  h(KV, { entries: infoEntries }),
                ),
                step && step.error
                  ? h('div', { className: 'dsh-devops-card', 'data-role': 'step-error' },
                      h('div', { className: 'dsh-devops-card-head' }, h('span', { className: 'dsh-devops-card-title' }, '错误')),
                      h('div', { className: 'dsh-devops-drawer-raw dsh-devops-monospace', 'data-tone': 'error' }, String(step.error)))
                  : null,
              )
            : null),
        h('div', { 'data-role': 'step-drawer-view', 'data-view': 'log', hidden: infoActive },
          infoActive
            ? null
            : h(LogPanel, { runId: props.runId, stepId: step ? step.id : '', live: !!props.live, meta: { stuckSilenceSec: props.stuckSilenceSec } })),
      ),
    ),
  );
}

/** 一组步骤的整体状态：失败优先，其次运行中，再次排队，最后才是全部成功。 */
function laneStatus(list) {
  const items = list || [];
  if (items.length === 0) return 'pending';
  if (items.some((s) => s.status === 'failed')) return 'failed';
  if (items.some((s) => s.status === 'running')) return 'running';
  if (items.some((s) => s.status === 'queued' || s.status === 'pending')) return 'pending';
  if (items.every((s) => s.status === 'success' || s.status === 'skipped')) return 'success';
  return 'pending';
}

/** 单个步骤卡片：可展开实时日志。 */
function StepCard(props) {
  const { step, expanded, onToggle, runId, now, stuckSilenceSec, server, toast } = props;
  const [logs, setLogs] = useState('');
  const [loadingLogs, setLoadingLogs] = useState(false);
  const diag = diagnoseStep(step, { now, stuckSilenceSec, server });
  const isLive = step.status === 'running' || step.status === 'pending';

  // 展开且步骤已结束时，拉一次日志尾部，用于归因与 AI 解释
  useEffect(() => {
    if (!expanded || isLive) return undefined;
    let cancelled = false;
    setLoadingLogs(true);
    api.runLogs(runId, { stepId: step.id, from: 0 })
      .then((result) => {
        if (cancelled || !result) return;
        setLogs((result.lines || []).map((l) => l.text).join('\n'));
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoadingLogs(false));
    return () => {
      cancelled = true;
    };
  }, [expanded, isLive, runId, step.id]);

  async function retryStep(event) {
    event.stopPropagation();
    try {
      await api.retryStep(runId, step.id);
      toast.ok('已提交重试');
      props.onRetried && props.onRetried();
    } catch (error) {
      toast.error(error.message || String(error));
    }
  }

  return h(
    'div',
    // 状态色：data-status 为原始状态、data-tone 为语义色调，颜色一律交给 CSS
    { className: 'dsh-devops-stepcard', 'data-status': step.status, 'data-tone': stepTone(step.status) },
    h(
      'div',
      { className: 'dsh-devops-stepcard-head', onClick: onToggle },
      h('span', { style: { color: 'var(--dsw-alias-label-tertiary)' } }, expanded ? '▾' : '▸'),
      h(StatusDot, { tone: stepTone(step.status), title: STEP_STATUS_TEXT[step.status] || step.status }),
      h('span', { className: 'dsh-devops-stepcard-title' }, step.name || step.id),
      h('span', { className: 'dsh-devops-tag' }, step.node),
      isLive ? h(PhaseFlow, { phase: step.phase, status: step.status }) : null,
      h('div', { className: 'dsh-devops-spacer' }),
      h(
        'span',
        { className: 'dsh-devops-stepcard-meta' },
        h('span', null, STEP_STATUS_TEXT[step.status] || step.status),
        stepElapsed(step, now) ? h('span', null, fmtDuration(stepElapsed(step, now))) : null,
        step.exitCode !== null && step.exitCode !== undefined ? h('span', null, '退出码 ' + step.exitCode) : null,
        step.server ? h('span', null, step.server) : null,
        step.attempt > 1 ? h('span', null, '第 ' + step.attempt + ' 次') : null,
        step.bytes ? h('span', null, step.bytes + ' B') : null,
        isLive ? h('span', { style: { color: diag.stuck ? 'var(--dsw-alias-state-warn-primary)' : 'inherit' } }, diag.silentText) : null,
      ),
      // 统一的「查看详情」入口：悬浮卡片展示步骤原信息与日志
      props.onOpenDetail
        ? h(Button, {
            size: 'sm',
            variant: 'ghost',
            label: '详情',
            title: '在悬浮卡片中查看该步骤的信息与日志',
            onClick: (event) => {
              if (event && event.stopPropagation) event.stopPropagation();
              props.onOpenDetail(step);
            },
            style: { flex: 'none' },
          })
        : null,
      step.status === 'failed' && !isLive
        ? h(Button, {
            size: 'sm',
            icon: 'refresh',
            label: '重试此步',
            title: '只重试这一步',
            onClick: retryStep,
            style: { flex: 'none' },
          })
        : null,
    ),
    expanded
      ? h(
          'div',
          null,
          h(StuckPanel, { step, diag }),
          step.error ? h('div', { className: 'dsh-devops-banner', 'data-tone': 'error', style: { margin: '0 8px 6px' } }, step.error) : null,
          isLive
            ? h(LogPanel, { runId, stepId: step.id, live: true, meta: { stuckSilenceSec } })
            : h(
                'div',
                { className: 'dsh-devops-logpanel' },
                h(
                  'div',
                  { className: 'dsh-devops-logbar' },
                  h('span', { className: 'dsh-devops-chip' }, '已结束 · 静态日志'),
                  h('div', { className: 'dsh-devops-spacer' }),
                  h(AiButton, {
                    ctx: props.ctx,
                    toast,
                    label: '用 AI 解释失败',
                    prompt: () =>
                      buildFailurePrompt(
                        { id: runId, pipelineId: '', pipelineName: '', status: step.status, steps: { [step.id]: step } },
                        logs || '(无日志)',
                      ),
                  }),
                ),
                h(
                  'div',
                  { className: 'dsh-devops-logview', 'data-language': 'plain' },
                  loadingLogs
                    ? '加载日志中…'
                    : logs
                      ? h(StaticLogView, { text: logs, maxLines: 400 })
                      : '该步骤没有日志输出',
                ),
              ),
        )
      : null,
  );
}

/** 运行详情。 */
function RunDetail(props) {
  const runId = props.runId;
  const [run, setRun] = useState(null);
  const [error, setError] = useState('');
  // 展开的步骤 id 列表。过去是「单个 id 字符串」，但阶段头按钮写的是「全部展开」，
  // 实际只会展开第一条 —— 标签与行为不符，点了像没反应。
  const [expanded, setExpanded] = useState([]);
  // 悬浮详情卡片当前展示的步骤（null = 收起）
  const [detailStep, setDetailStep] = useState(null);
  const [sseStatus, setSseStatus] = useState('idle');
  const [now, setNow] = useState(Date.now());
  const streamRef = useRef(null);
  useTick(true);

  const load = useCallback(async () => {
    try {
      const value = await api.getRun(runId);
      setRun(value);
      setError('');
    } catch (err) {
      setError(err.message || String(err));
    }
  }, [runId]);

  useEffect(() => {
    load();
  }, [load]);

  // 每秒本地刷新耗时显示（不做后端轮询）
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // 运行未结束时挂 SSE，实时更新 run/step
  const live = run && (run.status === 'running' || run.status === 'queued');
  useEffect(() => {
    if (!runId || !live) {
      setSseStatus(run && !live ? 'idle' : 'connecting');
      return undefined;
    }
    const stream = createRunStream(runId, {
      onStatus: setSseStatus,
      onEvent: (name, data) => {
        if (name === 'run' && data.run) {
          setRun((prev) => Object.assign({}, prev || {}, data.run));
        } else if (name === 'step' && data.step) {
          setRun((prev) => {
            if (!prev) return prev;
            const steps = Object.assign({}, prev.steps);
            steps[data.stepId || data.step.id] = Object.assign({}, steps[data.stepId] || {}, data.step);
            return Object.assign({}, prev, { steps });
          });
          // 步骤结束时刷新一次完整运行，拿到最终状态与耗时
          if (data.step.status && data.step.status !== 'running') load();
        }
      },
    });
    streamRef.current = stream;
    return () => {
      streamRef.current = null;
      stream.close();
    };
  }, [runId, live, load]);

  /**
   * 声明「本页自管滚动」：运行详情内部有自己的滚动区（阶段泳道 + 步骤日志），
   * 外层 .dsh-devops-body 必须停止滚动，否则滚轮会带动整页、内部区域拿不到有界高度。
   * 进入时 true、卸载时 false；app.js 依此设置 body 的 data-flush。
   *
   * 必须在下面的提前 return **之前**（hooks 不能条件执行，否则触发 React #310）。
   */
  useEffect(() => {
    if (typeof props.onBodyFlush !== 'function') return undefined;
    props.onBodyFlush(true);
    return () => props.onBodyFlush(false);
  }, [props.onBodyFlush]);

  // ⚠️ hooks 必须无条件执行：不能放在下面的提前 return 之后，
  // 否则「首次无数据 → 数据到达」两次渲染的 hook 数量不同，React 会抛
  // "Rendered more hooks than during the previous render"（#310）。
  const steps = (run && run.steps) || {};
  const stepList = Object.keys(steps).map((id) => Object.assign({ id }, steps[id]));

  /** 按阶段分组：步骤带 stage 字段，没有则归到「未分组」。 */
  const lanes = useMemo(() => {
    const map = new Map();
    for (const step of stepList) {
      const key = step.stage || '';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(step);
    }
    return Array.from(map.entries());
  }, [stepList]);

  const counts = useMemo(() => {
    const out = { success: 0, failed: 0, running: 0, pending: 0, skipped: 0, canceled: 0 };
    for (const step of stepList) out[step.status] = (out[step.status] || 0) + 1;
    return out;
  }, [stepList]);

  /** 展开/收起单个步骤。 */
  function toggleStep(id) {
    setExpanded((prev) => (prev.indexOf(id) >= 0 ? prev.filter((x) => x !== id) : prev.concat([id])));
  }

  /** 展开/收起某个阶段下的全部步骤。 */
  function toggleLane(list) {
    const ids = list.map((s) => s.id);
    setExpanded((prev) => {
      const allOpen = ids.length > 0 && ids.every((id) => prev.indexOf(id) >= 0);
      if (allOpen) return prev.filter((id) => ids.indexOf(id) < 0);
      return prev.concat(ids.filter((id) => prev.indexOf(id) < 0));
    });
  }

  // hooks 全部执行完，现在才允许提前 return
  if (error) return h(Banner, { tone: 'error' }, error);
  if (!run) return h(Empty, { text: '加载中…' });

  const done = counts.success + counts.failed + counts.skipped + counts.canceled;
  const failed = counts.failed;
  const tips = attributionFor(run);
  const failedSteps = stepList.filter((s) => s.status === 'failed');

  async function cancel() {
    try {
      await api.cancelRun(runId);
      props.toast.ok('已请求取消');
      load();
    } catch (err) {
      props.toast.error(err.message || String(err));
    }
  }

  async function retry() {
    try {
      await api.retryRun(runId);
      props.toast.ok('已提交重跑');
      props.onReload && props.onReload();
    } catch (err) {
      props.toast.error(err.message || String(err));
    }
  }

  return h(
    'div',
    // 定位上下文：悬浮抽屉层是 absolute/inset:0，必须锚定在运行详情区域内
    { className: 'dsh-devops-detail', 'data-role': 'run-detail' },
    // 内部滚动区：外层 body 已 data-flush（不滚），运行详情的滚动由这里承担。
    // 悬浮抽屉层必须留在滚动区**之外**，否则遮罩会随内容滚走、盖不住视口。
    h(
      'div',
      { className: 'dsh-devops-detail-scroll', 'data-role': 'run-detail-scroll' },
      h(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' } },
      h(Button, { size: 'sm', icon: 'chevron', label: '← 运行列表', onClick: props.onBack }),
      h('h2', { className: 'dsh-devops-title', style: { margin: 0 } }, run.id),
      h(Chip, { tone: runTone(run.status), dot: true }, RUN_STATUS_TEXT[run.status] || run.status),
      run.pipelineId
        ? h(
            'span',
            {
              className: 'dsh-devops-link',
              role: 'button',
              tabIndex: 0,
              title: '查看「' + (run.pipelineName || run.pipelineId) + '」的详情',
              onClick: () => props.onOpenPipeline && props.onOpenPipeline(run.pipelineId),
              onKeyDown: (event) => {
                if (event && (event.key === 'Enter' || event.key === ' ')) {
                  event.preventDefault();
                  props.onOpenPipeline && props.onOpenPipeline(run.pipelineId);
                }
              },
            },
            run.pipelineName || run.pipelineId,
          )
        : h('span', { className: 'dsh-devops-hint' }, run.pipelineName || run.pipelineId),
      run.pipelineId
        ? h(Button, {
            size: 'sm',
            label: '编辑流水线',
            title: '打开这条运行所用流水线的编辑器',
            onClick: () => props.onEditPipeline && props.onEditPipeline(run.pipelineId),
          })
        : null,
      h('div', { className: 'dsh-devops-spacer' }),
      live ? h(Button, { size: 'sm', variant: 'danger', icon: 'close', label: '取消运行', onClick: cancel }) : null,
      failed > 0 ? h(Button, { size: 'sm', icon: 'refresh', label: '重跑全部', onClick: retry }) : null,
      h(Button, { size: 'sm', icon: 'refresh', label: '刷新', onClick: load }),
    ),

    h(
      'div',
      { className: 'dsh-devops-grid', 'data-cols': '2', style: { marginBottom: '12px' } },
      h(Card, { title: '进度' },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '14px' } },
          h(ProgressRing, {
            value: done,
            total: stepList.length || 1,
            tone: failed > 0 ? 'error' : live ? 'busy' : 'ok',
            size: 62,
          }),
          h(KV, {
            entries: [
              ['步骤', counts.success + ' 成功 / ' + failed + ' 失败 / ' + stepList.length + ' 总计'],
              ['耗时', run.startedAt ? fmtDuration((run.finishedAt || now) - run.startedAt) : '—'],
              ['开始', fmtTime(run.startedAt)],
              ['结束', run.finishedAt ? fmtTime(run.finishedAt) : '进行中'],
              ['触发', run.trigger || 'manual'],
            ],
          }),
        ),
      ),
      h(Card, { title: '诊断' },
        h(KV, {
          entries: [
            ['SSE', h(Chip, { tone: sseStatus === 'open' ? 'ok' : sseStatus === 'error' ? 'error' : 'idle' }, sseStatus === 'open' ? '实时连接' : sseStatus)],
            ['进行中步骤', String(counts.running)],
            ['队列中', String(counts.pending)],
            ['父运行', run.parentRunId || '—'],
          ],
        }),
        run.variables && Object.keys(run.variables).length
          ? h('div', { style: { marginTop: '8px' } },
              h('div', { className: 'dsh-devops-hint', style: { marginBottom: '3px' } }, '本次变量'),
              h('div', { className: 'dsh-devops-monospace', style: { fontSize: '11px' } },
                Object.keys(run.variables).map((k) => k + '=' + ellipsis(run.variables[k], 40)).join('  ')))
          : null,
      ),
    ),

    failed > 0
      ? h(Banner, { tone: 'error' },
          h('div', { style: { fontWeight: 500, marginBottom: '4px' } }, '失败归因'),
          tips.map((tip, i) => h('div', { key: i }, '· ' + tip)),
          h('div', { style: { marginTop: '8px' } },
            h(AiButton, {
              ctx: props.ctx,
              toast: props.toast,
              label: '用 AI 解释失败',
              prompt: () =>
                buildFailurePrompt(
                  run,
                  failedSteps
                    .map((s) => '### ' + (s.name || s.id) + '\n' + (s.error || '') )
                    .join('\n'),
                ),
            })),
        )
      : null,

    h(Card, { title: '阶段与步骤' },
      lanes.length === 0
        ? h(Empty, { text: '这次运行还没有步骤' })
        : lanes.map(([stage, list]) =>
            h(
              'div',
              {
                key: stage || 'ungrouped',
                style: { marginBottom: '10px' },
                // 注意：这里**不能**复用 .dsh-devops-column —— 那是横向编排的列，
                // 带 width:236px / flex:0 0 auto，会把运行页泳道挤成窄列。
                // 状态色改用头部状态点（data-tone）表达，布局保持原来的整宽泳道。
                'data-role': 'run-lane',
                'data-status': laneStatus(list),
                'data-tone': stepTone(laneStatus(list)),
              },
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' } },
                h(StatusDot, { tone: stepTone(laneStatus(list)), title: '该阶段整体状态：' + (STEP_STATUS_TEXT[laneStatus(list)] || laneStatus(list)) }),
                h('span', { style: { fontSize: '12px', fontWeight: 500 } }, stage || '未分组'),
                h('span', { className: 'dsh-devops-hint' }, list.length + ' 个步骤'),
                h('div', { className: 'dsh-devops-spacer' }),
                h(Button, {
                  size: 'sm',
                  variant: 'ghost',
                  label: list.length > 0 && list.every((s) => expanded.indexOf(s.id) >= 0) ? '全部收起' : '全部展开',
                  title: '展开或收起该阶段的全部步骤',
                  onClick: () => toggleLane(list),
                }),
              ),
              list.map((step) =>
                h(StepCard, {
                  key: step.id,
                  step,
                  runId,
                  now,
                  expanded: expanded.indexOf(step.id) >= 0,
                  onToggle: () => toggleStep(step.id),
                  stuckSilenceSec: (props.settings && props.settings.stuckSilenceSec) || 60,
                  server: (props.servers || []).find((s) => s.id === step.server),
                  toast: props.toast,
                  ctx: props.ctx,
                  onRetried: props.onReload,
                  onOpenDetail: setDetailStep,
                }),
              ),
            ),
          ),
    ),

    ),

    // 统一的悬浮详情卡片（与流水线详情页同一形态契约）——留在滚动区外
    h(StepDetailDrawer, {
      step: detailStep,
      runId,
      live: detailStep ? !!live : false,
      stuckSilenceSec: (props.settings && props.settings.stuckSilenceSec) || 60,
      now,
      onClose: () => setDetailStep(null),
    }),
  );
}

/** 运行列表页。 */
function Runs(props) {
  const runs = props.state.runs || [];
  const [filter, setFilter] = useState('');
  const [status, setStatus] = useState('');
  const [openId, setOpenId] = useState(props.initialRunId || '');
  const [now, setNow] = useState(Date.now());
  useTick(true);

  useEffect(() => {
    props.onReload();
  }, []);

  // 外部（状态栏/概览/编辑器）要求打开某次运行时同步
  useEffect(() => {
    if (props.initialRunId) setOpenId(props.initialRunId);
  }, [props.initialRunId]);

  if (openId) {
    return h(RunDetail, {
      runId: openId,
      toast: props.toast,
      ctx: props.ctx,
      servers: props.state.servers,
      settings: props.state.settings,
      onBack: () => setOpenId(''),
      onReload: props.onReload,
      onEditPipeline: props.onEditPipeline,
      onOpenPipeline: props.onOpenPipeline,
      // 「本页自管滚动」的声明通道（app.js 由 Lead 提供，这里逐层透传）。
      onBodyFlush: props.onBodyFlush,
    });
  }

  const filtered = runs.filter((r) => {
    if (status && r.status !== status) return false;
    if (!filter) return true;
    return (r.id + ' ' + (r.pipelineName || '') + ' ' + (r.pipelineId || '')).toLowerCase().includes(filter.toLowerCase());
  });

  const nowTs = Date.now();

  return h(
    'div',
    null,
    h(
      'div',
      { style: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px' } },
      h('div', { style: { width: '220px' } }, h(TextInput, { value: filter, placeholder: '搜索运行 id / 流水线', onChange: setFilter })),
      h('div', { style: { width: '140px' } },
        h(Select, {
          value: status,
          placeholder: '全部状态',
          options: Object.keys(RUN_STATUS_TEXT).map((k) => ({ value: k, label: RUN_STATUS_TEXT[k] })),
          onChange: setStatus,
        })),
      h('div', { className: 'dsh-devops-spacer' }),
      h(Button, { size: 'sm', icon: 'refresh', label: '刷新', onClick: props.onReload }),
    ),
    filtered.length === 0
      ? h(Empty, { text: runs.length === 0 ? '还没有运行记录' : '没有匹配的运行' })
      : h(
          'table',
          { className: 'dsh-devops-table' },
          h('thead', null,
            h('tr', null,
              h('th', null, '运行 id'),
              h('th', null, '流水线'),
              h('th', null, '状态'),
              h('th', null, '进度'),
              h('th', null, '耗时'),
              h('th', null, '开始'),
              h('th', null, ''),
            )),
          h('tbody', null,
            filtered.map((run) => {
              const steps = Object.values(run.steps || {});
              const doneCount = steps.filter((s) => s.status && s.status !== 'running' && s.status !== 'pending').length;
              return h('tr', { key: run.id },
                h('td', { className: 'dsh-devops-monospace' }, run.id),
                h('td', null,
                  run.pipelineId && props.onOpenPipeline
                    ? h(
                        'span',
                        {
                          className: 'dsh-devops-link',
                          role: 'button',
                          tabIndex: 0,
                          title: '查看「' + (run.pipelineName || run.pipelineId) + '」的详情',
                          onClick: () => props.onOpenPipeline(run.pipelineId),
                          onKeyDown: (event) => {
                            if (event && (event.key === 'Enter' || event.key === ' ')) {
                              event.preventDefault();
                              props.onOpenPipeline(run.pipelineId);
                            }
                          },
                        },
                        run.pipelineName || run.pipelineId,
                      )
                    : run.pipelineName || run.pipelineId),
                h('td', null, h(Chip, { tone: runTone(run.status), dot: true }, RUN_STATUS_TEXT[run.status] || run.status)),
                h('td', null, doneCount + ' / ' + steps.length),
                h('td', null, run.startedAt ? fmtDuration((run.finishedAt || nowTs) - run.startedAt) : '—'),
                h('td', null, fmtAgo(run.startedAt, nowTs)),
                h('td', null, h(Button, { size: 'sm', label: '详情', onClick: () => setOpenId(run.id) })),
              );
            }),
          ),
        ),
  );
}

exports.Runs = Runs;
exports.RunDetail = RunDetail;
exports.StaticLogView = StaticLogView;
exports.StepCard = StepCard;
exports.StepDetailDrawer = StepDetailDrawer;
exports.laneStatus = laneStatus;