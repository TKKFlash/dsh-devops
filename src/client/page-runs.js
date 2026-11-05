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

/** 步骤耗时：进行中按当前时间算，结束后用 finishedAt。 */
function stepElapsed(step, now) {
  if (!step || !step.startedAt) return 0;
  return Math.max(0, (step.finishedAt || now) - step.startedAt);
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
    { className: 'dsh-devops-stepcard', 'data-status': step.status },
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
      step.status === 'failed' && !isLive
        ? h('span', { onClick: retryStep, style: { flex: 'none' } }, h(Button, { size: 'sm', icon: 'refresh', label: '重试此步' }))
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
                  { className: 'dsh-devops-logview' },
                  loadingLogs
                    ? '加载日志中…'
                    : logs
                      ? logs.split('\n').slice(-400).map((line, i) => h('div', { key: i, className: 'dsh-devops-logline' }, line))
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
  const [expanded, setExpanded] = useState('');
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
    null,
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' } },
      h(Button, { size: 'sm', icon: 'chevron', label: '← 运行列表', onClick: props.onBack }),
      h('h2', { className: 'dsh-devops-title', style: { margin: 0 } }, run.id),
      h(Chip, { tone: runTone(run.status), dot: true }, RUN_STATUS_TEXT[run.status] || run.status),
      h('span', { className: 'dsh-devops-hint' }, run.pipelineName || run.pipelineId),
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
              { key: stage || 'ungrouped', style: { marginBottom: '10px' } },
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' } },
                h('span', { style: { fontSize: '12px', fontWeight: 500 } }, stage || '未分组'),
                h('span', { className: 'dsh-devops-hint' }, list.length + ' 个步骤'),
                h('div', { className: 'dsh-devops-spacer' }),
                h(Button, {
                  size: 'sm',
                  variant: 'ghost',
                  label: expanded ? '收起' : '全部展开',
                  onClick: () => setExpanded(expanded ? '' : list[0] && list[0].id),
                }),
              ),
              list.map((step) =>
                h(StepCard, {
                  key: step.id,
                  step,
                  runId,
                  now,
                  expanded: expanded === step.id,
                  onToggle: () => setExpanded(expanded === step.id ? '' : step.id),
                  stuckSilenceSec: (props.settings && props.settings.stuckSilenceSec) || 60,
                  server: (props.servers || []).find((s) => s.id === step.server),
                  toast: props.toast,
                  ctx: props.ctx,
                  onRetried: props.onReload,
                }),
              ),
            ),
          ),
    ),
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
                h('td', null, run.pipelineName || run.pipelineId),
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
exports.StepCard = StepCard;
