/**
 * 全局状态栏（shell.overlay）：活跃运行数、当前运行→当前步骤、实时耗时、
 * 服务器健康灯、失败徽标；单击跳转到对应运行。
 *
 * shell.overlay 是 list 槽且默认可点击穿透，因此外层 pointer-events:none，
 * 只有状态栏本体 auto——不会挡住应用的其它交互。
 */
const { h, useEffect, useState, useMemo, useTick, fmtDuration } = require('./h.js');
const { StatusDot } = require('./ui.js');
const { diagnoseStep } = require('./diagnostics.js');
const { runTone, RUN_STATUS_TEXT } = require('./state.js');

/** 找出当前该展示的运行：优先运行中，其次最近一次失败的。 */
function pickFocus(runs) {
  const running = runs.filter((r) => r.status === 'running' || r.status === 'queued');
  if (running.length > 0) {
    // 多个活跃运行时取开始最早的那个，展示最久运行
    return running.reduce((a, b) => ((a.startedAt || Infinity) <= (b.startedAt || Infinity) ? a : b));
  }
  const failed = runs.filter((r) => r.status === 'failed');
  if (failed.length > 0) {
    return failed.reduce((a, b) => ((a.finishedAt || 0) >= (b.finishedAt || 0) ? a : b));
  }
  return runs[0] || null;
}

/** 运行里当前活跃的步骤（running 优先，否则取最后开始的）。 */
function activeStep(run) {
  if (!run || !run.steps) return null;
  const steps = Object.keys(run.steps).map((id) => run.steps[id]);
  const running = steps.filter((s) => s.status === 'running');
  if (running.length) return running[0];
  const pending = steps.filter((s) => s.status === 'pending');
  if (pending.length) return pending[0];
  return null;
}

function StatusBar(props) {
  const state = props.state;
  const runs = state.runs || [];
  const [hidden, setHidden] = useState(false);
  useTick(true);

  const enabled = !(state.settings && state.settings.statusBar === false);
  if (!enabled || hidden) return null;

  const active = runs.filter((r) => r.status === 'running' || r.status === 'queued');
  const failedCount = runs.filter((r) => r.status === 'failed').length;
  const servers = state.servers || [];
  const focus = pickFocus(runs);
  const step = activeStep(focus);
  const now = Date.now();

  const diag = step ? diagnoseStep(step, { now, stuckSilenceSec: (state.settings && state.settings.stuckSilenceSec) || 60 }) : null;
  const elapsed = focus && focus.startedAt ? (focus.finishedAt || now) - focus.startedAt : 0;

  // 服务器健康：有任何探测失败就是 error；否则有服务器就是 ok
  const healthTone = servers.some((s) => s.probe && s.probe.error)
    ? 'error'
    : servers.length
      ? 'ok'
      : 'idle';
  const healthTitle = servers.some((s) => s.probe && s.probe.error)
    ? '有服务器连接异常'
    : servers.length + ' 台服务器';

  const segments = [];

  segments.push(
    h(
      'span',
      { className: 'dsh-devops-overlay-seg', key: 'active' },
      h(StatusDot, { tone: active.length ? 'busy' : 'idle' }),
      h('span', null, active.length ? active.length + ' 个运行中' : '空闲'),
    ),
  );

  if (focus) {
    const tone = runTone(focus.status);
    segments.push(
      h(
        'span',
        { className: 'dsh-devops-overlay-seg', key: 'focus' },
        h('span', { className: 'dsh-devops-overlay-mono' }, focus.pipelineName || focus.pipelineId || focus.id),
        step ? h('span', { style: { color: 'var(--dsw-alias-label-tertiary)' } }, '→ ' + (step.name || step.id)) : null,
        h('span', { className: 'dsh-devops-chip', 'data-tone': tone }, RUN_STATUS_TEXT[focus.status] || focus.status),
      ),
    );
    if (elapsed) {
      segments.push(
        h('span', { className: 'dsh-devops-overlay-seg', key: 'elapsed' },
          h('span', { className: 'dsh-devops-overlay-mono' }, fmtDuration(elapsed))),
      );
    }
    if (diag && diag.live && diag.silentText) {
      segments.push(
        h(
          'span',
          { className: 'dsh-devops-overlay-seg', key: 'silent', style: { color: diag.stuck ? 'var(--dsw-alias-state-warn-primary)' : 'inherit' } },
          h('span', { className: 'dsh-devops-overlay-mono' }, diag.silentText),
        ),
      );
    }
  }

  segments.push(
    h('span', { className: 'dsh-devops-overlay-seg', key: 'health' },
      h(StatusDot, { tone: healthTone, title: healthTitle })),
  );

  if (failedCount > 0) {
    segments.push(
      h('span', { className: 'dsh-devops-overlay-seg', key: 'failed' },
        h('span', { className: 'dsh-devops-chip', 'data-tone': 'error' }, failedCount + ' 失败')),
    );
  }

  return h(
    'div',
    { className: 'dsh-devops-root dsh-devops-root--bare dsh-devops-overlay' },
    h(
      'div',
      {
        className: 'dsh-devops-overlay-bar',
        'data-clickable': focus ? 'true' : undefined,
        title: focus ? '点击查看这次运行' : 'DevOps 状态',
        onClick: () => {
          if (focus) props.onOpenRun(focus.id);
          else props.onNavigate('overview');
        },
        onContextMenu: (e) => {
          e.preventDefault();
          setHidden(true);
        },
      },
      segments,
    ),
  );
}

exports.StatusBar = StatusBar;
