/**
 * 应用外壳：数据装载 + 页内二级导航 + 页内状态条 + 八个页面装配。
 *
 * 数据策略：页面切换只读缓存，进入或手动刷新时才请求后端；实时性交给
 * SSE 与本地每秒走秒，避免不必要的轮询。
 */
const { h, useState, useEffect, useMemo, useCallback, useRef, cx, fmtAgo } = require('./h.js');
const { Icon, Button, Chip, StatusDot, useToast } = require('./ui.js');
const { api } = require('./api.js');
const { ensureStyles } = require('./styles.js');
const { createStore, useStore, runTone, RUN_STATUS_TEXT } = require('./state.js');
const { Overview } = require('./page-overview.js');
const { Pipelines } = require('./page-pipelines.js');
const { Templates } = require('./page-templates.js');
const { Runs } = require('./page-runs.js');
const { Servers } = require('./page-servers.js');
const { Resources } = require('./page-resources.js');
const { Nodes } = require('./page-nodes.js');
const { Settings } = require('./page-settings.js');

/**
 * 共享数据源：主面板与全局状态栏（shell.overlay，独立于主面板存在）都订阅它，
 * 保证两处显示一致，且只需一份请求。
 */
const sharedStore = createStore({
  pipelines: [],
  templates: [],
  runs: [],
  servers: [],
  envsets: [],
  snippets: [],
  nodes: [],
  settings: {},
  loading: false,
  error: '',
  sseStatus: 'idle',
  lastEvent: null,
});

const PAGES = [
  { id: 'overview', label: '概览', icon: 'grid' },
  { id: 'pipelines', label: '流水线', icon: 'layers' },
  { id: 'templates', label: '模板', icon: 'box' },
  { id: 'runs', label: '运行', icon: 'play', badge: 'runs' },
  { id: 'servers', label: '服务器', icon: 'server' },
  { id: 'resources', label: '资源库', icon: 'database' },
  { id: 'nodes', label: '节点库', icon: 'terminal' },
  { id: 'settings', label: '设置', icon: 'settings' },
];

/** 页内状态条：SSE 连接状态、活跃运行、队列长度、最近事件。 */
function InlineStatus(props) {
  const state = props.state;
  const runs = state.runs || [];
  const active = runs.filter((r) => r.status === 'running');
  const queued = runs.filter((r) => r.status === 'queued');
  const failed = runs.filter((r) => r.status === 'failed');
  const sse = state.sseStatus || 'idle';
  const sseTone = sse === 'open' ? 'ok' : sse === 'error' ? 'error' : sse === 'connecting' ? 'busy' : 'idle';

  return h(
    'div',
    { className: 'dsh-devops-statusbar-inline' },
    h('span', { className: 'dsh-devops-chip', 'data-tone': sseTone, title: '实时事件流连接状态' },
      h(StatusDot, { tone: sseTone }),
      sse === 'open' ? '实时' : sse === 'connecting' ? '连接中' : sse === 'error' ? '断开' : '未连接'),
    h('span', null, '运行中 ' + active.length),
    h('span', null, '排队 ' + queued.length),
    failed.length ? h('span', { style: { color: 'var(--dsw-alias-state-error-primary)' } }, '失败 ' + failed.length) : null,
    h('div', { className: 'dsh-devops-spacer' }),
    state.lastEvent ? h('span', { title: state.lastEvent.at ? new Date(state.lastEvent.at).toLocaleString() : '' }, '最近事件：' + state.lastEvent.text) : null,
    state.loading ? h('span', null, '同步中…') : null,
  );
}

/**
 * 视图状态的持久化键（sessionStorage）。
 *
 * 用户抱怨「每次离开 devops 界面再回来，之前的状态全部消失了，从概况重新开始」——
 * 根因是面板随侧边栏 slot 卸载，组件内 useState 全部清零。这里把**视图位置**
 * （当前页签、正在编辑/查看的流水线 id）存下来，重进时恢复；
 * 只存轻量标记，不存数据本身，恢复后仍按 id 重新拉取最新数据。
 */
const VIEW_KEY = 'dsh-devops.view';

/** 安全读取视图记忆（隐私模式 / 无 storage 时降级为 null）。 */
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

/** 安全写入视图记忆。 */
function writeViewState(patch) {
  try {
    if (typeof sessionStorage === 'undefined') return;
    const current = readViewState() || {};
    sessionStorage.setItem(VIEW_KEY, JSON.stringify(Object.assign({}, current, patch)));
  } catch {
    /* 存不了就算了，不影响功能 */
  }
}

/** 读取「上次正在编辑的流水线与选中节点」，供页面恢复视图位置。 */
function readEditMemory() {
  const view = readViewState();
  if (!view || typeof view !== 'object') return null;
  return {
    pipelineId: typeof view.editPipelineId === 'string' ? view.editPipelineId : '',
    jobId: typeof view.editJobId === 'string' ? view.editJobId : '',
  };
}

/** 记住「正在编辑的流水线与选中节点」（只存 id，数据仍按 id 现取）。 */
function rememberEdit(pipelineId, jobId) {
  writeViewState({
    editPipelineId: pipelineId || '',
    editJobId: jobId || '',
  });
}

function App(props) {
  const ctx = props.ctx;
  const remembered = readViewState();
  const [page, setPage] = useState(props.initialPage || (remembered && remembered.page) || 'overview');
  /**
   * 页面自己声明「本页内容自行滚动，外层不要滚」。
   * styles.js 里 .dsh-devops-body[data-flush="true"] 早就定义了，但此前**无人设置**，
   * 导致编辑页整页滚动、画布与节点面板无法各自滚动（用户抱怨的滚轮串区）。
   */
  const [bodyFlush, setBodyFlush] = useState(false);
  const [toastNode, toast] = useToast();
  const [initialAction, setInitialAction] = useState(props.initialAction || null);
  const [initialRunId, setInitialRunId] = useState(props.initialRunId || '');
  const [query, setQuery] = useState('');

  const store = sharedStore;
  const state = useStore(store);

  /**
   * 字段控件的数据上下文：只放「服务器 / 环境变量组 / 脚本片段 / 默认服务器」。
   *
   * 不能把宿主 ctx 原样传下去 —— 宿主 ctx 是 Cordis context，读取未 inject
   * 的服务属性会抛 `cannot get property "snippets" without inject`，
   * 点开含引用字段的节点（如 shell.exec 的「引用脚本片段」）就会整块报错。
   */
  const fieldCtx = useMemo(
    () => ({
      servers: state.servers || [],
      envsets: state.envsets || [],
      snippets: state.snippets || [],
      // 流水线候选：pipeline.call 节点的「子流水线」字段要能下拉选择 + 模糊匹配，
      // 因此把列表一并下发（列表接口不含 stages，载荷很轻）。
      pipelines: state.pipelines || [],
      defaultServer: (state.settings && state.settings.defaultServer) || 'local',
    }),
    [state.servers, state.envsets, state.snippets, state.pipelines, state.settings],
  );

  /** 全局刷新：并行拉取所有列表，任一失败不影响其它。 */
  const reload = useCallback(async () => {
    store.setState({ loading: true });
    const results = await Promise.allSettled([
      api.listPipelines(),
      api.listTemplates(),
      api.listRuns({ limit: 50 }),
      api.listServers(),
      api.listEnvSets(),
      api.listSnippets(),
      api.listNodes(),
      api.getSettings(),
    ]);
    const names = ['pipelines', 'templates', 'runs', 'servers', 'envsets', 'snippets', 'nodes', 'settings'];
    const patch = {};
    let firstError = '';
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        const value = result.value;
        // 列表接口可能直接返回数组，也可能包一层 {items}
        const item = names[i] === 'settings' ? value || {} : Array.isArray(value) ? value : (value && (value.items || value.list)) || [];
        patch[names[i]] = item;
      } else {
        const message = result.reason && result.reason.message ? result.reason.message : String(result.reason);
        // 首次加载失败要显式提示；后续刷新只在控制台留痕
        if (!firstError) firstError = names[i] + '：' + message;
      }
    });
    patch.loading = false;
    patch.error = firstError;
    store.setState(patch);
  }, [store]);

  useEffect(() => {
    ensureStyles();
    reload();
  }, [reload]);

  /** 历史输入（recent）：按字段语义键缓存，供类型化控件直接选用。 */
  const recentCache = useRef(new Map());
  const remember = useCallback((key, value) => {
    const list = recentCache.current.get(key) || [];
    const next = [value].concat(list.filter((v) => v !== value)).slice(0, 8);
    recentCache.current.set(key, next);
    api.putRecent(key, next).catch(() => {});
  }, []);
  const recent = useCallback((key) => recentCache.current.get(key) || [], []);

  // 预热最近使用过的路径/glob，让控件首次展开就有候选
  useEffect(() => {
    api.listRecent()
      .then((value) => {
        const entries = Array.isArray(value) ? value : value && value.entries ? value.entries : [];
        for (const entry of entries) {
          if (entry && entry.key) recentCache.current.set(entry.key, entry.values || []);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (state.error) toast.error(state.error);
  }, [state.error]);

  const navigate = useCallback(
    (next, action) => {
      setPage(next);
      writeViewState({ page: next });
      setInitialAction(action || null);
      setQuery('');
      if (action && action.runId) setInitialRunId(action.runId);
    },
    [],
  );

  const openRun = useCallback(
    (runId) => {
      setInitialRunId(runId);
      setPage('runs');
      setQuery('');
    },
    [],
  );

  // 应用外壳把「跳转」能力交给状态栏（它在 shell.overlay 里，独立于本面板）。
  // 同时把「导航已注册」写进共享 store：状态栏据此判断点击能否生效，
  // 不能生效时给可见提示，而不是留一个点不动的死按钮。
  useEffect(() => {
    if (!props.registerNavigation) return;
    props.registerNavigation({ navigate, openRun });
    store.setState({ navRegistered: true });
  }, [navigate, openRun, store]);

  // 页面通过该回调声明是否需要「外层不滚动」（编辑器/运行详情这类内部有滚动区的页面）。
  useEffect(() => {
    writeViewState({ page });
  }, [page]);

  const pageProps = {
    state,
    toast,
    ctx,
    fieldCtx,
    onBodyFlush: setBodyFlush,
    remembered,
    editMemory: readEditMemory(),
    rememberEdit,
    onReload: reload,
    recent,
    remember,
    onNavigate: navigate,
    onOpenRun: openRun,
    initialAction,
    initialRunId,
    onTemplatesChanged: reload,
    // 打开某条流水线：进详情（看定义/阶段/最近运行，并从详情进编辑）。
    onOpenPipeline: (id) => navigate('pipelines', { detail: id }),
    // 直接进某条流水线的编辑器（运行详情里的「编辑流水线」用）。
    onEditPipeline: (id) => navigate('pipelines', { edit: id }),
    initialServerId: initialAction && initialAction.serverId,
  };

  let content = null;
  switch (page) {
    case 'pipelines':
      content = h(Pipelines, pageProps);
      break;
    case 'templates':
      content = h(Templates, pageProps);
      break;
    case 'runs':
      content = h(Runs, pageProps);
      break;
    case 'servers':
      content = h(Servers, pageProps);
      break;
    case 'resources':
      content = h(Resources, pageProps);
      break;
    case 'nodes':
      content = h(Nodes, pageProps);
      break;
    case 'settings':
      content = h(Settings, pageProps);
      break;
    case 'overview':
    default:
      content = h(Overview, pageProps);
      break;
  }

  const runBadge = state.runs.filter((r) => r.status === 'running').length;

  return h(
    'div',
    { className: 'dsh-devops-root' },
    h(
      'nav',
      { className: 'dsh-devops-nav', 'aria-label': 'DevOps 导航' },
      PAGES.map((item) =>
        h(
          'button',
          {
            key: item.id,
            type: 'button',
            className: 'dsh-devops-nav-item',
            'data-active': page === item.id ? 'true' : undefined,
            onClick: () => navigate(item.id),
          },
          h('span', { className: 'dsh-devops-nav-dot' }, h(Icon, { name: item.icon, size: 14 })),
          h('span', { className: 'dsh-devops-truncate' }, item.label),
          item.badge === 'runs' && runBadge > 0
            ? h('span', { className: 'dsh-devops-chip', 'data-tone': 'busy', style: { marginLeft: 'auto' } }, String(runBadge))
            : null,
        ),
      ),
    ),
    h(
      'div',
      { className: 'dsh-devops-main' },
      h(InlineStatus, { state }),
      h('div', { className: 'dsh-devops-body', 'data-flush': bodyFlush ? 'true' : undefined }, content),
    ),
    toastNode,
  );
}

exports.App = App;
exports.PAGES = PAGES;
exports.InlineStatus = InlineStatus;
exports.sharedStore = sharedStore;
