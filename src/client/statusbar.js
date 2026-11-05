/**
 * 全局状态栏（shell.overlay）：所有活跃运行的实时列表、当前步骤、实时耗时、
 * 服务器健康灯、失败计数徽标；每条运行可单独点击进入。
 *
 * shell.overlay 是 list 槽且默认可点击穿透，因此外层 pointer-events:none，
 * 只有状态栏本体 auto——不会挡住应用的其它交互。
 *
 * 两个已修复的可用性缺陷（用户报告：状态栏「点不动、还硬显示失败的流水线」）：
 *
 * 1. 焦点语义：过去 pickFocus 在没有活跃运行时会退回「最近一次失败」的运行，
 *    用户看到的就是一条与当下无关的失败记录，像是被硬编码。现在焦点**只**来自
 *    活跃运行（running/queued）；完全空闲时给一句中性空闲态，失败只作为计数徽标。
 * 2. 导航降级：onOpenRun / onNavigate 来自 src/client/index.js 的 navigationRegistry，
 *    而它只有主面板挂载过才会被填充；面板没打开过时 nav 为 null，点击静默失效。
 *    这里用共享 store 的 panelMounted 作为「导航是否可用」的信号，
 *    不可用时渲染可见提示并在点击时给出说明，而不是留一个点不动的死按钮。
 */
const { h, useEffect, useState, useTick, fmtDuration } = require('./h.js');
const { StatusDot, Button } = require('./ui.js');
const { diagnoseStep } = require('./diagnostics.js');
const { runTone, RUN_STATUS_TEXT } = require('./state.js');

/** 一条运行是否「活跃」（正在跑或排队）。 */
function isActiveRun(run) {
  return !!run && (run.status === 'running' || run.status === 'queued');
}

/** 状态栏一次最多平铺几条活跃运行，其余折叠成「+N」。 */
const MAX_VISIBLE_RUNS = 3;

/**
 * 状态栏要展示的全部信息（纯函数，便于直接单测）。
 *
 * 焦点**只**来自活跃运行，且取开始最早的那条（展示最久运行的进度）；
 * 没有活跃运行就是空闲，绝不拿最近一次失败冒充当前状态。
 */
function statusBarModel(state) {
  const runs = (state && state.runs) || [];
  const active = runs.filter(isActiveRun).sort((a, b) => (a.startedAt || Infinity) - (b.startedAt || Infinity));
  const failedCount = runs.filter((r) => r && r.status === 'failed').length;
  const focus = active.length ? active[0] : null;
  // 导航可用性：主面板挂载过，App 的 effect 才会 publishNavigation 填充注册表。
  // panelMounted 是它在共享 store 上的等价信号。
  const navReady = !!(state && (state.panelMounted || state.navRegistered));
  return {
    runs,
    active,
    failedCount,
    focus,
    navReady,
    visible: active.slice(0, MAX_VISIBLE_RUNS),
    overflow: Math.max(0, active.length - MAX_VISIBLE_RUNS),
  };
}

/**
 * 解析一次点击该做什么。
 *
 * nav 不可用时返回 blocked 与一句**可展示**的解释，而不是静默吞掉点击
 * （这正是用户报告的「点了没反应」）。调用方负责把 message 渲染出来。
 */
function resolveNavTarget(nav, target) {
  if (!nav || !nav.ready) {
    return {
      kind: 'blocked',
      message: 'DevOps 面板还没打开过，导航暂时不可用：请先点侧边栏的「DevOps」图标打开面板，再从面板里进入。',
    };
  }
  if (target && target.kind === 'run') {
    if (typeof nav.onOpenRun !== 'function') {
      return { kind: 'blocked', message: '打不开这次运行：宿主没有提供导航入口。' };
    }
    return { kind: 'run', runId: target.runId };
  }
  if (typeof nav.onNavigate !== 'function') {
    return { kind: 'blocked', message: '切换页面失败：宿主没有提供导航入口。' };
  }
  return { kind: 'page', page: target && target.page };
}

/** 运行里当前活跃的步骤（running 优先，否则取第一个 pending）。 */
function activeStep(run) {
  if (!run || !run.steps) return null;
  const steps = Object.keys(run.steps).map((id) => run.steps[id]);
  const running = steps.filter((s) => s.status === 'running');
  if (running.length) return running[0];
  const pending = steps.filter((s) => s.status === 'pending');
  if (pending.length) return pending[0];
  return null;
}

/** 事件冒泡到外层状态栏时不该再触发外层点击。 */
function stopEvent(event) {
  if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
}

/**
 * 渲染一条活跃运行。返回的是普通元素（不是组件），因此可以直接被遍历/断言。
 * showStep 为真时附带「当前步骤 → 名称」与卡住提示（只给焦点那条，避免整条太宽）。
 */
function runSegment(run, options) {
  const opts = options || {};
  const now = opts.now || Date.now();
  const showStep = !!opts.showStep;
  const step = showStep ? activeStep(run) : null;
  const diag = step
    ? diagnoseStep(step, { now, stuckSilenceSec: opts.stuckSilenceSec || 60 })
    : null;
  const elapsed = run.startedAt ? (run.finishedAt || now) - run.startedAt : 0;
  const title = '点击查看这次运行：' + (run.pipelineName || run.pipelineId || run.id);

  return h(
    'span',
    {
      key: run.id,
      className: 'dsh-devops-overlay-seg',
      role: 'button',
      tabIndex: 0,
      title,
      style: { cursor: 'pointer' },
      onClick: (event) => {
        stopEvent(event);
        opts.onActivate && opts.onActivate({ kind: 'run', runId: run.id });
      },
      onKeyDown: (event) => {
        if (event && (event.key === 'Enter' || event.key === ' ')) {
          stopEvent(event);
          if (event.preventDefault) event.preventDefault();
          opts.onActivate && opts.onActivate({ kind: 'run', runId: run.id });
        }
      },
    },
    h('span', { className: 'dsh-devops-overlay-mono' }, run.pipelineName || run.pipelineId || run.id),
    step ? h('span', { style: { color: 'var(--dsw-alias-label-tertiary)' } }, '→ ' + (step.name || step.id)) : null,
    h('span', { className: 'dsh-devops-chip', 'data-tone': runTone(run.status) }, RUN_STATUS_TEXT[run.status] || run.status),
    elapsed ? h('span', { className: 'dsh-devops-overlay-mono' }, fmtDuration(elapsed)) : null,
    diag && diag.live && diag.silentText
      ? h(
          'span',
          { style: { color: diag.stuck ? 'var(--dsw-alias-state-warn-primary)' : 'inherit' } },
          h('span', { className: 'dsh-devops-overlay-mono' }, diag.silentText),
        )
      : null,
  );
}

function StatusBar(props) {
  const state = props.state || {};
  const [hidden, setHidden] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [notice, setNotice] = useState('');
  useTick(true);

  const enabled = !(state.settings && state.settings.statusBar === false);
  const model = statusBarModel(state);
  const nav = {
    ready: model.navReady && typeof props.onOpenRun === 'function',
    onOpenRun: props.onOpenRun,
    onNavigate: props.onNavigate,
  };

  // 提示用完自动消失，免得一直占着状态栏
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  /** 统一的点击入口：能导航就导航，不能导航就把原因显示出来。 */
  function dispatch(target) {
    const action = resolveNavTarget(nav, target);
    if (action.kind === 'blocked') {
      setNotice(action.message);
      return;
    }
    if (action.kind === 'run') nav.onOpenRun(action.runId);
    else nav.onNavigate(action.page);
  }

  // —— 以下为提前 return，所有 hook 必须已经执行完毕 ——
  if (!enabled) return null;

  // 收起态：保留一个最小的「重新打开」入口。
  // （旧版只能右键收起、收起后无法恢复，这是用户说「移不动」的来源。）
  if (hidden) {
    return h(
      'div',
      { className: 'dsh-devops-root dsh-devops-root--bare dsh-devops-overlay' },
      h(
        'div',
        { className: 'dsh-devops-overlay-bar', title: 'DevOps 状态栏已收起' },
        h(StatusDot, { tone: model.active.length ? 'busy' : 'idle' }),
        h('span', null, 'DevOps'),
        h(Button, {
          size: 'sm',
          variant: 'ghost',
          label: '显示状态栏',
          title: '重新展开右下角的 DevOps 状态栏',
          onClick: () => setHidden(false),
        }),
      ),
    );
  }

  const servers = state.servers || [];
  const now = Date.now();

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

  // 1) 活跃计数
  segments.push(
    h(
      'span',
      { className: 'dsh-devops-overlay-seg', key: 'active' },
      h(StatusDot, { tone: model.active.length ? 'busy' : 'idle' }),
      h('span', null, model.active.length ? model.active.length + ' 个运行中' : '空闲'),
    ),
  );

  // 2) 空闲态：一句中性描述。失败运行绝不顶上来充当「当前」。
  if (model.active.length === 0) {
    segments.push(
      h(
        'span',
        { className: 'dsh-devops-overlay-seg', key: 'idle' },
        h('span', { style: { color: 'var(--dsw-alias-label-tertiary)' } }, '当前没有运行中的流水线'),
      ),
    );
  }

  // 3) 所有活跃运行，逐条可点
  const listed = showAll ? model.active : model.visible;
  for (const run of listed) {
    segments.push(runSegment(run, {
      now,
      showStep: !showAll && run === model.focus,
      stuckSilenceSec: (state.settings && state.settings.stuckSilenceSec) || 60,
      onActivate: dispatch,
    }));
  }
  if (model.overflow > 0) {
    segments.push(
      h(
        'span',
        { className: 'dsh-devops-overlay-seg', key: 'more' },
        h(Button, {
          size: 'sm',
          variant: 'ghost',
          label: showAll ? '收起' : '+' + model.overflow,
          title: showAll ? '只显示最近 ' + MAX_VISIBLE_RUNS + ' 条' : '还有 ' + model.overflow + ' 个活跃运行',
          onClick: (event) => {
            stopEvent(event);
            setShowAll(!showAll);
          },
        }),
      ),
    );
  }

  // 4) 服务器健康
  segments.push(
    h('span', { className: 'dsh-devops-overlay-seg', key: 'health' },
      h(StatusDot, { tone: healthTone, title: healthTitle })),
  );

  // 5) 失败只作为计数徽标，并且可点（跳运行列表）
  if (model.failedCount > 0) {
    segments.push(
      h(
        'span',
        {
          key: 'failed',
          className: 'dsh-devops-overlay-seg',
          role: 'button',
          tabIndex: 0,
          style: { cursor: 'pointer' },
          title: '有 ' + model.failedCount + ' 次运行失败，点击查看运行列表',
          onClick: (event) => {
            stopEvent(event);
            dispatch({ kind: 'page', page: 'runs' });
          },
        },
        h('span', { className: 'dsh-devops-chip', 'data-tone': 'error' }, model.failedCount + ' 失败'),
      ),
    );
  }

  // 6) 导航不可用时始终给出可见提示（点击时还会追加具体原因）
  if (!nav.ready) {
    segments.push(
      h(
        'span',
        { className: 'dsh-devops-overlay-seg', key: 'navhint', title: 'DevOps 面板还没打开过，状态栏的跳转暂时不可用' },
        h('span', { className: 'dsh-devops-chip', 'data-tone': 'warn' }, '面板未打开'),
      ),
    );
  }

  // 7) 点击降级说明
  if (notice) {
    segments.push(
      h(
        'span',
        { className: 'dsh-devops-overlay-seg', key: 'notice', role: 'status' },
        h('span', { className: 'dsh-devops-chip', 'data-tone': 'warn' }, notice),
      ),
    );
  }

  // 8) 显式收起控件（右键仍然可用，但不再是唯一入口）
  segments.push(
    h(
      'span',
      { className: 'dsh-devops-overlay-seg', key: 'collapse' },
      h(Button, {
        size: 'sm',
        variant: 'ghost',
        label: '收起',
        title: '收起状态栏（收起后可点「显示状态栏」恢复）',
        onClick: (event) => {
          stopEvent(event);
          setHidden(true);
        },
      }),
    ),
  );

  return h(
    'div',
    { className: 'dsh-devops-root dsh-devops-root--bare dsh-devops-overlay' },
    h(
      'div',
      {
        className: 'dsh-devops-overlay-bar',
        'data-clickable': model.focus ? 'true' : undefined,
        title: model.focus ? '点击查看最久运行的那次运行' : 'DevOps 状态',
        onClick: () => {
          if (model.focus) dispatch({ kind: 'run', runId: model.focus.id });
          else dispatch({ kind: 'page', page: 'overview' });
        },
        onContextMenu: (event) => {
          if (event && event.preventDefault) event.preventDefault();
          setHidden(true);
        },
      },
      segments,
    ),
  );
}

exports.StatusBar = StatusBar;
exports.statusBarModel = statusBarModel;
exports.resolveNavTarget = resolveNavTarget;
exports.runSegment = runSegment;
exports.isActiveRun = isActiveRun;
exports.activeStep = activeStep;
exports.MAX_VISIBLE_RUNS = MAX_VISIBLE_RUNS;
