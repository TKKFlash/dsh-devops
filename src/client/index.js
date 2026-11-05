/**
 * 插件前端入口。契约 §3.13：
 *
 *   ctx.slots.inject('main',              () => ctx.slots.register({ name:'main', key:'devops' }, Panel))
 *   ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name:'sidebar.panellist', id:'devops', order:40, label:'DevOps' }, Icon))
 *   ctx.slots.inject('shell.overlay',     () => ctx.slots.register({ name:'shell.overlay', id:'devops-statusbar' }, StatusBar))
 *
 * 纪律：
 *  - main 是 keyed 槽，只认 key；key 必须与 sidebar.panellist 的 id 同值（'devops'），
 *    否则要么看不到入口，要么点了没反应。
 *  - 绝不注册 root / sidebar / rightbar / shell.bottom / shell.leading 等 single 槽
 *    （single 槽是替换语义，会挤掉整个应用）。
 *  - 状态栏走 shell.overlay（list 槽，可叠加、默认可点击穿透）。
 *  - 槽组件不会自动收到 ctx，一律用 apply 的闭包把它传下去。
 */
const React = require('react');
const { h, useEffect, useState } = require('./h.js');
const { Icon, Button } = require('./ui.js');
const { ensureStyles } = require('./styles.js');
const { useStore, runTone } = require('./state.js');
const { App, sharedStore } = require('./app.js');
const { StatusBar } = require('./statusbar.js');
const { api } = require('./api.js');

/** 唯一的面板 id：sidebar.panellist 的 id 与 main 的 key 必须同值。 */
const PANEL_ID = 'devops';

/** 面板 ↔ 状态栏之间的导航注册表（两者生命周期独立，无法直接互相引用）。 */
const navigationRegistry = { listeners: new Set(), current: null };

function publishNavigation(nav) {
  navigationRegistry.current = nav;
  for (const listener of Array.from(navigationRegistry.listeners)) {
    try {
      listener(nav);
    } catch {
      /* 单个订阅者出错不影响其它 */
    }
  }
}

/** 侧边栏图标：sidebar.panellist 的注册项渲染的就是这个组件。 */
function DevopsPanelIcon(props) {
  return h(Icon, { name: 'layers', size: (props && props.size) || 16 });
}

/** 面板错误边界：渲染崩溃时给出可重试界面，而不是白屏。 */
class PanelBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error('[dsh-devops] 面板渲染出错', error);
  }

  render() {
    if (this.state.error) {
      return h(
        'div',
        { className: 'dsh-devops-root', style: { display: 'block', padding: '24px' } },
        h('h2', { className: 'dsh-devops-title' }, 'DevOps 面板出错了'),
        h('div', { className: 'dsh-devops-hint', style: { margin: '8px 0 12px' } }, String((this.state.error && this.state.error.message) || this.state.error)),
        h(Button, { label: '重试', icon: 'refresh', onClick: () => this.setState({ error: null }) }),
      );
    }
    return this.props.children;
  }
}

/** 状态栏自举：面板从未打开过时也要有内容可显示。 */
async function bootstrapStatusBar() {
  try {
    const [runs, settings, servers] = await Promise.all([
      api.listRuns({ limit: 20 }).catch(() => []),
      api.getSettings().catch(() => ({})),
      api.listServers().catch(() => []),
    ]);
    sharedStore.setState({
      runs: Array.isArray(runs) ? runs : (runs && runs.items) || [],
      settings: settings || {},
      servers: Array.isArray(servers) ? servers : (servers && servers.items) || [],
    });
  } catch {
    /* 自举失败不应影响宿主 */
  }
  startStatusBarPoll();
}

let pollTimer = null;
/** 状态栏的降级刷新：主面板不在时不订阅 SSE，改用低频轮询。 */
function startStatusBarPoll() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    if (typeof document !== 'undefined' && document.hidden) return;
    // 主面板已挂载时由它统一刷新，这里不重复请求
    if (sharedStore.getState().panelMounted) return;
    try {
      const runs = await api.listRuns({ limit: 20 });
      sharedStore.setState({ runs: Array.isArray(runs) ? runs : (runs && runs.items) || [] });
    } catch {
      /* 忽略瞬时失败 */
    }
  }, 15000);
}

/**
 * 创建三个槽组件。ctx 通过闭包传入——槽组件不会自动收到它。
 */
function createComponents(ctx) {
  function DevopsPanel() {
    useEffect(() => {
      sharedStore.setState({ panelMounted: true });
      return () => sharedStore.setState({ panelMounted: false });
    }, []);
    return h(PanelBoundary, null, h(App, { ctx, registerNavigation: publishNavigation }));
  }

  function DevopsStatusBar() {
    const state = useStore(sharedStore);
    const [nav, setNav] = useState(navigationRegistry.current);

    useEffect(() => {
      navigationRegistry.listeners.add(setNav);
      return () => navigationRegistry.listeners.delete(setNav);
    }, []);

    // 面板没打开过时自举一次，保证状态栏有数据
    useEffect(() => {
      const current = sharedStore.getState();
      if (!current.bootstrapped) {
        sharedStore.setState({ bootstrapped: true });
        bootstrapStatusBar();
      }
    }, []);

    return h(StatusBar, {
      state,
      onOpenRun: (runId) => {
        if (nav && nav.openRun) nav.openRun(runId);
      },
      onNavigate: (page) => {
        if (nav && nav.navigate) nav.navigate(page);
      },
    });
  }

  return { DevopsPanel, DevopsStatusBar };
}

/**
 * 尽力绑定可选服务：宿主缺少它们时不应导致插件挂载失败。
 * 真正的调用发生在用户点击时，由 ai.js 的降级链兜底。
 */
function bindOptionalServices(ctx) {
  if (typeof ctx.inject !== 'function') return;
  for (const name of ['uiWorkspace', 'conversation']) {
    try {
      ctx.inject([name], () => {});
    } catch {
      /* 可选能力 */
    }
  }
}

function apply(ctx) {
  ensureStyles();

  const { DevopsPanel, DevopsStatusBar } = createComponents(ctx);
  bindOptionalServices(ctx);

  // main 是 keyed 槽：只认 key，且必须与 sidebar.panellist 的 id 同值。
  ctx.slots.inject('main', () =>
    ctx.slots.register({ name: 'main', key: PANEL_ID }, DevopsPanel),
  );

  // 侧边栏入口：id 即面板寻址键，order 决定在列表中的位置。
  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      { name: 'sidebar.panellist', id: PANEL_ID, order: 40, label: 'DevOps' },
      DevopsPanelIcon,
    ),
  );

  // 全局状态栏：list 槽，可叠加、可点击穿透（样式里外层 pointer-events:none）。
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register({ name: 'shell.overlay', id: 'devops-statusbar' }, DevopsStatusBar),
  );
}

module.exports = { inject: ['slots'], apply, PANEL_ID };
