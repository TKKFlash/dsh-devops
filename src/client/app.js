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

function App(props) {
  const ctx = props.ctx;
  const [page, setPage] = useState(props.initialPage || 'overview');
  const [toastNode, toast] = useToast();
  const [initialAction, setInitialAction] = useState(props.initialAction || null);
  const [initialRunId, setInitialRunId] = useState(props.initialRunId || '');
  const [query, setQuery] = useState('');

  const store = sharedStore;
  const state = useStore(store);

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

  // 应用外壳把「跳转」能力交给状态栏（它在 shell.overlay 里，独立于本面板）
  useEffect(() => {
    if (props.registerNavigation) props.registerNavigation({ navigate, openRun });
  }, [navigate, openRun]);

  const pageProps = {
    state,
    toast,
    ctx,
    onReload: reload,
    recent,
    remember,
    onNavigate: navigate,
    onOpenRun: openRun,
    initialAction,
    initialRunId,
    onTemplatesChanged: reload,
    onOpenPipeline: (id) => navigate('pipelines', { edit: id }),
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
      h('div', { className: 'dsh-devops-body' }, content),
    ),
    toastNode,
  );
}

exports.App = App;
exports.PAGES = PAGES;
exports.InlineStatus = InlineStatus;
exports.sharedStore = sharedStore;
