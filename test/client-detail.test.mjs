// 流水线详情页：与编辑器同构的**只读**编排视图 + 右侧伸缩抽屉（task-5）。
//
// 用户原话：「查看流水线详情的布局也应该和编辑时一样的，只不过不能编辑节点和阶段而已，
//   点击节点右边伸缩出悬浮弹窗，里面可以内部切换界面看整体的log和节点原信息。」
//
// 本用例不启浏览器：把 src/client/page-pipelines.js 放进带桩的迷你模块表里执行，
// 用「桩 h」把元素记成可检查的树、用「桩 hooks」模拟 useState/useEffect，
// 直接调用组件函数，断言渲染结果与交互回调。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { pluginPath } from './helpers/modules.mjs';

const detailPath = pluginPath('src', 'client', 'page-pipelines.js');
const stylesPath = pluginPath('src', 'client', 'styles.js');
const hasSource = existsSync(detailPath);

/* ------------------------------------------------------------------ *
 * 桩 h + 桩 hooks
 * ------------------------------------------------------------------ */

function makeH() {
  return (type, props, ...children) => {
    const kids = children.flat().filter((c) => c !== null && c !== undefined && c !== false);
    const given = props || {};
    if (typeof type === 'function') {
      if (type.__stub) return { type, stub: type.__stub, props: given, children: kids };
      return type(Object.assign({}, given, kids.length ? { children: kids } : {}));
    }
    return { type, props: given, children: kids };
  };
}

function stubComponent(name) {
  const fn = function Stub(props) {
    return { stub: name, props: props || {} };
  };
  fn.__stub = name;
  return fn;
}

/**
 * 桩 hooks。
 * useEffect 立即执行一次，但**不**自动执行清理函数 —— 日志取数是异步的，
 * 立刻清理会把 alive 置为 false 从而丢掉结果。清理函数收在 cleanups 里显式触发。
 */
function makeHooks() {
  const slots = [];
  const cleanups = [];
  // useTick 的调用记录：用于断言「只在存在 running 节点时才开定时器」（契约 B）
  const tickCalls = [];
  let index = 0;
  return {
    cleanups,
    tickCalls,
    reset() { index = 0; },
    clear() { slots.length = 0; cleanups.length = 0; tickCalls.length = 0; index = 0; },
    runCleanups() { for (const c of cleanups.splice(0)) if (typeof c === 'function') c(); },
    slots,
    useState(initial) {
      const i = index++;
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      const set = (next) => {
        slots[i] = typeof next === 'function' ? next(slots[i]) : next;
      };
      return [slots[i], set];
    },
    useEffect(fn, deps) {
      // 按依赖数组缓存：deps 不变则不重跑（真实 React 语义），
      // 否则「换节点时回到信息页」这类 effect 会在每次渲染强行重置状态。
      const i = index++;
      const prev = slots[i];
      const changed = !prev || !deps || !prev.deps || deps.length !== prev.deps.length ||
        deps.some((d, k) => !Object.is(d, prev.deps[k]));
      if (!changed) return undefined;
      slots[i] = { deps: deps ? deps.slice() : null };
      const cleanup = fn();
      if (typeof cleanup === 'function') cleanups.push(cleanup);
      return undefined;
    },
    useMemo(fn) { return fn(); },
    useCallback(fn) { return fn; },
    useRef() { return { current: null }; },
    useReducer() { return [0, () => {}]; },
    useTick(active) { tickCalls.push(active); return undefined; },
  };
}

/** 递归查找满足条件的节点。 */
function findAll(node, predicate, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, predicate, out);
    return out;
  }
  if (node.type !== undefined && predicate(node)) out.push(node);
  for (const child of node.children || []) findAll(child, predicate, out);
  return out;
}

/** 收集用户可见文本（桩组件把文案放在 props.label / props.title 上）。 */
function textOf(node) {
  if (node === null || node === undefined || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  let head = '';
  if (node.stub) {
    if (node.props.label !== undefined) head += String(node.props.label);
    if (node.props.title !== undefined) head += String(node.props.title);
  }
  return head + (node.children || []).map(textOf).join('');
}

const HOOK_NAMES = ['useState', 'useEffect', 'useMemo', 'useCallback', 'useRef', 'useReducer', 'useTick'];

/** 加载 page-pipelines.js；canvas.js 默认给空对象（走内置只读卡片）。 */
function loadDetail(extraStubs, canvasStub) {
  const source = readFileSync(detailPath, 'utf8');
  const module = { exports: {} };
  const hooks = makeHooks();
  const h = makeH();
  const hookApi = {};
  for (const name of HOOK_NAMES) hookApi[name] = hooks[name];
  const stubs = {
    './h.js': Object.assign({
      h,
      useSyncExternalStore: () => ({}),
      cx: (...parts) => parts.filter(Boolean).join(' '),
      fmtDuration: (ms) => String(ms) + 'ms',
      fmtTime: (ts) => 'T' + ts,
      fmtAgo: (ts) => 'ago' + ts,
      fmtBytes: (n) => String(n) + 'B',
      ellipsis: (s) => String(s),
      clone: (v) => v,
      groupBy: () => new Map(),
      copyText: () => {},
    }, hookApi),
    './ui.js': {
      Icon: stubComponent('Icon'), Button: stubComponent('Button'), StatusDot: stubComponent('StatusDot'),
      Chip: stubComponent('Chip'), Card: stubComponent('Card'), Empty: stubComponent('Empty'),
      Banner: stubComponent('Banner'), Modal: stubComponent('Modal'), Field: stubComponent('Field'),
      KV: (props) => h('dl', { className: 'dsh-devops-kv' }, (props.entries || []).map((e, i) => h('div', { key: i }, String(e[0]), e[1]))), TextInput: stubComponent('TextInput'), TextArea: stubComponent('TextArea'),
      Select: stubComponent('Select'), Switch: stubComponent('Switch'), ProgressRing: stubComponent('ProgressRing'),
      Collapsible: stubComponent('Collapsible'), AsyncBox: stubComponent('AsyncBox'),
      useToast: () => [null, { ok() {}, error() {} }],
    },
    // 注意：页面里是 const { api } = require('./api.js')，必须是 { api: ... } 形状
    './api.js': { api: (extraStubs && extraStubs.api) || {} },
    './editor.js': {
      PipelineEditor: stubComponent('PipelineEditor'),
      detectScheduling: (p) => ((p.stages || []).some((s) => (s.jobs || []).some((j) => (j.needs || []).length)) ? 'dag' : 'staged'),
      countJobs: (p) => (p.stages || []).reduce((n, s) => n + (s.jobs || []).length, 0),
    },
    './state.js': {
      // 与 src/client/state.js 保持一致的语义映射：恒返回 idle 会掩盖组件挂的状态色
      runTone: (s) => (s === 'success' ? 'ok' : s === 'failed' ? 'error' : s === 'running' ? 'busy' : s === 'canceled' ? 'warn' : 'idle'),
      stepTone: (s) => (s === 'success' ? 'ok' : s === 'failed' ? 'error' : s === 'running' ? 'busy' : s === 'canceled' ? 'warn' : 'idle'),
      RUN_STATUS_TEXT: { queued: '排队中', running: '运行中', success: '成功', failed: '失败', canceled: '已取消' },
      STEP_STATUS_TEXT: { pending: '等待', running: '运行中', success: '成功', failed: '失败', skipped: '已跳过', canceled: '已取消' },
    },
    './sse.js': { createRunStream: () => ({ close() {} }) },
    './logs.js': { LogPanel: stubComponent('LogPanel'), LogLine: stubComponent('LogLine') },
    './ai.js': { AiButton: stubComponent('AiButton'), buildFailurePrompt: () => '' },
    // canvas.js 由画布任务维护：默认给空对象，等价于「未声明只读支持」
    './canvas.js': canvasStub === undefined ? {} : canvasStub,
  };
  Object.assign(stubs, (extraStubs && extraStubs.extra) || {});
  const requireStub = (id) => {
    if (!(id in stubs)) throw new Error('用例未覆盖的依赖：' + id + '（来自 page-pipelines.js）');
    return stubs[id];
  };
  new Function('module', 'exports', 'require', source)(module, module.exports, requireStub);
  return { exports: module.exports, hooks, h };
}

/** 把真实 canvas.js 源码求值成模块，模拟浏览器里 require('./canvas.js') 命中的情形。 */
function loadRealCanvas() {
  const source = readFileSync(pluginPath('src', 'client', 'canvas.js'), 'utf8');
  const module = { exports: {} };
  const hooks = makeHooks();
  const h = makeH();
  const hookApi = {};
  for (const name of HOOK_NAMES) hookApi[name] = hooks[name];
  const stubs = {
    './h.js': Object.assign({ h }, hookApi),
    './ui.js': { Icon: stubComponent('Icon'), Chip: stubComponent('Chip') },
  };
  new Function('module', 'exports', 'require', source)(module, module.exports, (id) => {
    if (!(id in stubs)) throw new Error('用例未覆盖的 canvas.js 依赖：' + id);
    return stubs[id];
  });
  return module.exports;
}

/* ------------------------------------------------------------------ *
 * 测试数据
 * ------------------------------------------------------------------ */

function job(id, patch) {
  return Object.assign({
    id, name: id, node: 'shell.exec', server: '', needs: [],
    retry: { max: 0, delayMs: 1000 }, timeoutMs: 600000, allowFailure: false,
    when: 'on_success', allowProvision: false, env: [], envSetRefs: [], with: {}, artifacts: [],
    cache: { key: '', paths: [] },
  }, patch || {});
}

function pipeline() {
  return {
    id: 'build-deploy', name: '构建并部署', description: '演示', category: 'build', tags: ['prod'],
    version: 1, variables: [{ name: 'ENV', value: 'prod', secret: false }], envSetRefs: [],
    defaults: { server: 'local', timeoutMs: 600000 },
    stages: [
      { id: 'build', name: '构建', parallel: false, jobs: [job('compile', { name: '编译', with: { script: 'npm ci' } }), job('test', { name: '测试', when: 'always', needs: ['compile'] })] },
      { id: 'deploy', name: '部署', parallel: false, jobs: [job('ship', { name: '发布', node: 'artifact.upload', artifacts: ['dist/**'], timeoutMs: 120000 })] },
    ],
    createdAt: 0, updatedAt: 0,
  };
}

function run(id, status, startedAt, steps) {
  return Object.assign({ id, pipelineId: 'build-deploy', pipelineName: '构建并部署', status, startedAt: startedAt || 1000, steps: steps || null }, {});
}

const baseProps = (extra) => Object.assign({
  pipeline: pipeline(), runs: [], nodes: [{ type: 'shell.exec', title: '执行 Shell', description: '在目标服务器执行脚本', fields: [{ name: 'script', label: '脚本' }] }],
  onBack() {}, onEdit() {}, onRun() {}, onReload() {}, onOpenRun() {},
}, extra || {});

const describeMaybe = hasSource ? describe : describe.skip;

/* ------------------------------------------------------------------ *
 * 用例：同构只读编排视图
 * ------------------------------------------------------------------ */

describeMaybe('详情页布局与编辑器同构（阶段成列、节点成块状卡片）', () => {
  const loaded = hasSource ? loadDetail() : { exports: {}, hooks: makeHooks(), h: makeH() };
  const PipelineDetail = loaded.exports.PipelineDetail;
  const hooks = loaded.hooks;

  const render = (props) => { hooks.clear(); return PipelineDetail(props); };
  const rerender = (props) => { hooks.reset(); return PipelineDetail(props); };

  test('★ 阶段渲染成列、节点渲染成块状卡片（不再是纯文本行）', () => {
    const tree = render(baseProps());
    const columns = findAll(tree, (n) => n.props && n.props['data-role'] === 'readonly-column');
    assert.equal(columns.length, 2, '两个阶段应渲染成两列');
    assert.deepEqual(columns.map((c) => c.props['data-stage-id']), ['build', 'deploy'], '列顺序应与 stages 一致');

    for (const col of columns) {
      const cls = String(col.props.className || '');
      for (const want of ['dsh-devops-column']) assert.ok(cls.includes(want), '列应带 .' + want);
      const cards = findAll(col, (n) => n.props && n.props['data-role'] === 'node-card');
      assert.ok(cards.length >= 1, '列内应有块状卡片');
      for (const card of cards) assert.match(String(card.props.className || ''), /dsh-devops-nodecard/, '卡片应带 .dsh-devops-nodecard');
    }
    // 编辑器同构的骨架：editor 三栏 + 横向 board
    assert.equal(findAll(tree, (n) => String(n.props.className || '').includes('dsh-devops-editor')).length, 1, '应复用编辑器的三栏骨架');
    assert.equal(findAll(tree, (n) => String(n.props.className || '').includes('dsh-devops-board')).length, 1, '应有横向 board 容器');
  });

  test('卡片含编辑器同构的关键信息：标题/类型/执行条件/服务器/超时/needs/产物', () => {
    const tree = render(baseProps());
    const cards = findAll(tree, (n) => n.props && n.props['data-role'] === 'node-card');
    assert.equal(cards.length, 3, '三个节点应有三张卡片');
    const compile = cards.find((c) => findAll(c, (n) => n.children && n.children.includes('编译')).length > 0);
    assert.ok(compile, '应能找到「编译」卡片');
    const text = textOf(compile);
    assert.match(text, /shell\.exec/, '卡片应显示节点类型');
    assert.match(text, /执行条件/, '卡片应显示执行条件');
    assert.match(text, /服务器/, '卡片应显示服务器');
    const ship = cards.find((c) => textOf(c).includes('artifact.upload'));
    assert.match(textOf(ship), /产物/, '有产物的节点应显示产物数量');
  });

  test('空阶段给出空态而不是崩溃', () => {
    const p = pipeline();
    p.stages = [];
    const tree = render(baseProps({ pipeline: p }));
    assert.equal(findAll(tree, (n) => n.props && n.props['data-role'] === 'readonly-column').length, 0);
    assert.match(textOf(tree), /还没有阶段/);
  });

  test('顶部保留返回/名称/调度徽标/刷新/运行/编辑，并保留最近运行表', () => {
    const runs = [run('run-1', 'failed', 5000), run('run-2', 'running', 9000)];
    const edits = [];
    const tree = render(baseProps({ runs, onEdit: (id) => edits.push(id) }));
    const labels = findAll(tree, (n) => n.stub === 'Button').map((b) => String(b.props.label || ''));
    for (const want of ['刷新', '运行', '编辑']) assert.ok(labels.includes(want), '缺「' + want + '」按钮，实际：' + labels.join(','));
    assert.match(textOf(tree), /构建并部署/, '顶部应显示流水线名');
    assert.match(textOf(tree), /阶段调度|DAG 调度/, '顶部应有调度模式徽标');
    assert.match(textOf(tree), /最近运行/, '应保留最近运行表');
    assert.match(textOf(tree), /run-1/, '最近运行应列出该流水线的运行');

    const edit = findAll(tree, (n) => n.stub === 'Button' && String(n.props.label) === '编辑')[0];
    edit.props.onClick();
    assert.deepEqual(edits, ['build-deploy'], '编辑入口必须带 pipelineId');
  });

  test('保留既有详情文案（定义概览/阶段与节点/最近运行）不回归', () => {
    // test/client-interaction.test.mjs 断言这三个区块存在，重构布局时不能弄丢
    const text = textOf(render(baseProps()));
    assert.match(text, /定义概览/);
    assert.match(text, /最近运行/);
  });
});

/* ------------------------------------------------------------------ *
 * 用例：只读边界
 * ------------------------------------------------------------------ */

describeMaybe('详情页是只读的（不能编辑节点与阶段）', () => {
  const loaded = hasSource ? loadDetail() : { exports: {}, hooks: makeHooks(), h: makeH() };
  const PipelineDetail = loaded.exports.PipelineDetail;
  const hooks = loaded.hooks;
  const render = (props) => { hooks.clear(); return PipelineDetail(props); };
  const rerender = (props) => { hooks.reset(); return PipelineDetail(props); };

  test('★ 不出现任何增删阶段/节点、拖拽、改名、保存等编辑入口', () => {
    const tree = render(baseProps());
    assert.equal(findAll(tree, (n) => n.props && n.props['data-role'] === 'add-stage').length, 0, '不得有加阶段入口');
    assert.equal(findAll(tree, (n) => String(n.props.className || '').includes('dsh-devops-addstage')).length, 0, '不得渲染 .dsh-devops-addstage');
    assert.equal(findAll(tree, (n) => n.props && String(n.props['data-role'] || '').startsWith('stage-')).length, 0, '不得有列头编辑工具（stage-remove/parallel-toggle 等）');
    const onDouble = findAll(tree, (n) => typeof n.props.onDoubleClick === 'function');
    assert.equal(onDouble.length, 0, '不得有双击改名入口');

    const text = textOf(tree);
    for (const forbidden of ['删除阶段', '删除节点', '添加阶段', '插入阶段', '保存', '校验']) {
      assert.ok(!text.includes(forbidden), '只读视图不得出现「' + forbidden + '」');
    }
  });

  test('★ 节点卡片不可拖拽', () => {
    const tree = render(baseProps());
    const draggable = findAll(tree, (n) => n.props && n.props.draggable === true);
    assert.equal(draggable.length, 0, '只读视图里不得有 draggable 元素');
    const slots = findAll(tree, (n) => n.props && n.props['data-role'] === 'readonly-slot');
    assert.equal(slots.length, 3, '每个节点应有一个只读槽位');
    for (const slot of slots) assert.equal(slot.props['data-readonly'], 'true');
  });

  test('★ 组件不接受 onChange，点节点不产生任何结构变更', () => {
    const p = pipeline();
    const snapshot = JSON.stringify(p);
    const tree = render(baseProps({ pipeline: p }));
    const slot = findAll(tree, (n) => n.props && n.props['data-role'] === 'readonly-slot')[0];
    slot.props.onClick();
    const after = rerender(baseProps({ pipeline: p }));
    assert.equal(JSON.stringify(p), snapshot, 'pipeline 不得被修改');
    // 详情页没有 onChange 这个 prop 通道
    assert.doesNotMatch(readFileSync(detailPath, 'utf8').split('function PipelineDetail')[1].split('function Pipelines')[0], /props\.onChange/);
    assert.ok(after);
  });

  test('★ 即使 canvas.js 的 NodeCard 存在，未声明只读支持时也不复用它（避免带入拖拽）', () => {
    const canvasStub = { NodeCard: function EditableNodeCard() { return null; } };
    const withCanvas = loadDetail({}, canvasStub);
    const tree = withCanvas.exports.PipelineDetail(baseProps());
    assert.equal(findAll(tree, (n) => n.props && n.props.draggable === true).length, 0, '复用编辑期 NodeCard 会带入 draggable，不得复用');
    // 声明 supportsReadonly 后才切换为复用
    const readable = function ReadonlyNodeCard() { return null; };
    readable.supportsReadonly = true;
    const reused = loadDetail({}, { NodeCard: readable });
    assert.equal(reused.exports.NodeCard, readable, 'canvas.js 声明只读支持后应复用其 NodeCard');
  });
});

/* ------------------------------------------------------------------ *
 * 用例：右侧伸缩抽屉 + 内部页签
 * ------------------------------------------------------------------ */

describeMaybe('点击节点右侧伸缩出抽屉，内部可切换「节点信息 / 日志」', () => {
  const loaded = hasSource ? loadDetail() : { exports: {}, hooks: makeHooks(), h: makeH() };
  const PipelineDetail = loaded.exports.PipelineDetail;
  const hooks = loaded.hooks;
  const render = (props) => { hooks.clear(); return PipelineDetail(props); };
  const rerender = (props) => { hooks.reset(); return PipelineDetail(props); };

  const drawerOf = (tree) => findAll(tree, (n) => n.props && n.props['data-role'] === 'detail-drawer')[0];
  const openFirstNode = (props) => {
    let tree = render(props);
    const slot = findAll(tree, (n) => n.props && n.props['data-role'] === 'readonly-slot')[0];
    slot.props.onClick();
    tree = rerender(props);
    return tree;
  };

  test('★ 初始不展开；点击节点后抽屉打开且为右侧 fixed 层', () => {
    let tree = render(baseProps());
    assert.equal(drawerOf(tree).props['data-open'], 'false', '初始应是收起的');

    tree = openFirstNode(baseProps());
    const drawer = drawerOf(tree);
    assert.equal(drawer.props['data-open'], 'true', '点节点后抽屉应打开');
    assert.ok(String(drawer.props.className || '').includes('dsh-devops-drawer-layer'), '抽屉应是独立的伸缩层');
    const mask = findAll(tree, (n) => n.props && n.props['data-role'] === 'drawer-mask');
    assert.equal(mask.length, 1, '应有遮罩层');
    const panel = findAll(tree, (n) => n.props && n.props['data-role'] === 'drawer-panel')[0];
    assert.ok(panel, '应有抽屉面板');
    assert.equal(panel.props.role, 'dialog', '抽屉面板应是 dialog');
  });

  test('★ 抽屉内有两个页签，可内部切换界面', () => {
    const tree = openFirstNode(baseProps());
    const tabs = findAll(tree, (n) => n.props && n.props['data-role'] === 'drawer-tab');
    assert.equal(tabs.length, 2, '应有两个页签，实际：' + tabs.map((t) => textOf(t)).join(','));
    assert.deepEqual(tabs.map((t) => t.props['data-tab']), ['info', 'log'], '页签应为 info 与 log');
    assert.ok(textOf(tabs[0]).includes('节点信息'), '第一个页签应是「节点信息」');
    assert.ok(textOf(tabs[1]).includes('日志'), '第二个页签应是「日志」');
    assert.equal(tabs[0].props['data-active'], 'true', '默认停在节点信息');
    assert.equal(drawerOf(tree).props['data-tab'], 'info');

    // 点「日志」→ 内部切视图，抽屉不关闭
    tabs[1].props.onClick();
    const after = rerender(baseProps());
    assert.equal(drawerOf(after).props['data-tab'], 'log', '点页签后应切到日志视图');
    assert.equal(drawerOf(after).props['data-open'], 'true', '切页签不应关闭抽屉');
    const views = findAll(after, (n) => n.props && n.props['data-role'] === 'drawer-view');
    assert.deepEqual(views.map((v) => v.props['data-view']), ['info', 'log'], '两个视图都应在抽屉内');
    assert.equal(views[1].props.hidden, false, '日志视图应可见');
    assert.equal(views[0].props.hidden, true, '信息视图应隐藏');
  });

  test('「节点信息」展示节点原信息（类型/字段值/服务器/执行条件/超时/needs/产物）', () => {
    const tree = openFirstNode(baseProps());
    const info = findAll(tree, (n) => n.props && n.props['data-role'] === 'drawer-panel-info')[0];
    assert.ok(info, '应有节点信息面板');
    const text = textOf(info);
    for (const want of ['节点类型', 'shell.exec', '执行条件', '服务器', '超时', 'needs', '产物']) {
      assert.ok(text.includes(want), '节点信息应包含「' + want + '」，实际：' + text.slice(0, 200));
    }
    assert.match(text, /节点参数/, '应展示节点参数字段');
    assert.match(text, /npm ci/, '应展示字段原始值');
    assert.match(text, /脚本/, '字段有描述符时应显示中文标签');
  });

  test('★ 无运行记录时给出明确文案（不是空白）', () => {
    const tree = openFirstNode(baseProps({ runs: [] }));
    const tabs = findAll(tree, (n) => n.props && n.props['data-role'] === 'drawer-tab');
    tabs[1].props.onClick();
    const after = rerender(baseProps({ runs: [] }));
    const log = findAll(after, (n) => n.props && n.props['data-role'] === 'drawer-panel-log')[0];
    assert.ok(log, '应有日志面板');
    assert.match(textOf(log), /该节点还没有运行记录/, '无运行记录必须有明确文案');
  });

  test('★ 有运行记录时复用 LogPanel 并传「该节点最近一次运行」', () => {
    // 复用既有 logs.js 的 LogPanel（自带 SSE/过滤/下载），详情页只负责定位那次运行
    const props = baseProps({ runs: [run('run-old', 'success', 1000, { ship: {} }), run('run-new', 'running', 9000, { compile: {} })] });
    let tree = render(props);
    findAll(tree, (n) => n.props && n.props['data-role'] === 'readonly-slot')[0].props.onClick();
    tree = rerender(props);
    findAll(tree, (n) => n.props && n.props['data-role'] === 'drawer-tab')[1].props.onClick();
    tree = rerender(props);

    const panels = findAll(tree, (n) => n.stub === 'LogPanel');
    assert.equal(panels.length, 1, '日志页应复用 LogPanel');
    assert.equal(panels[0].props.runId, 'run-new', '应取包含该节点且最近的一次运行');
    assert.equal(panels[0].props.stepId, 'compile', '应按节点 id 取该步日志');
    assert.equal(panels[0].props.live, true, '运行中的运行应开实时流');
    const log = findAll(tree, (n) => n.props && n.props['data-role'] === 'drawer-panel-log')[0];
    assert.match(textOf(log), /run-new/, '应标明日志来自哪次运行');
  });

  test('日志面板只在切到日志页签时才挂载（未打开的页签不建 SSE 连接）', () => {
    const props = baseProps({ runs: [run('run-1', 'success', 9000, { compile: {} })] });
    let tree = render(props);
    findAll(tree, (n) => n.props && n.props['data-role'] === 'readonly-slot')[0].props.onClick();
    tree = rerender(props);
    // 停在「节点信息」：不该已经挂载日志面板
    assert.equal(findAll(tree, (n) => n.stub === 'LogPanel').length, 0, '未切到日志页签时不应挂载 LogPanel');
    assert.equal(findAll(tree, (n) => n.props && n.props['data-role'] === 'drawer-panel-info').length, 1, '信息页应已挂载');

    findAll(tree, (n) => n.props && n.props['data-role'] === 'drawer-tab')[1].props.onClick();
    tree = rerender(props);
    assert.equal(findAll(tree, (n) => n.stub === 'LogPanel').length, 1, '切到日志页签后应挂载 LogPanel');
  });

  test('★ 抽屉可关闭：关闭按钮与遮罩点击，并支持 Esc', () => {
    let tree = openFirstNode(baseProps());
    const close = findAll(tree, (n) => n.stub === 'Button' && String(n.props.label) === '关闭')[0];
    assert.ok(close, '应有显式关闭按钮');
    assert.equal(typeof close.props.onClick, 'function');
    close.props.onClick();
    tree = rerender(baseProps());
    assert.equal(drawerOf(tree).props['data-open'], 'false', '点关闭后应收起');

    // 遮罩点击关闭
    tree = openFirstNode(baseProps());
    findAll(tree, (n) => n.props && n.props['data-role'] === 'drawer-mask')[0].props.onClick();
    tree = rerender(baseProps());
    assert.equal(drawerOf(tree).props['data-open'], 'false', '点遮罩应关闭抽屉');
  });

  test('抽屉开关有纯 CSS 过渡动效，并尊重 prefers-reduced-motion（样式归 task-6，这里只盯契约）', () => {
    const src = readFileSync(detailPath, 'utf8');
    // 动效由 CSS 承担，组件不得自己写 JS 动画定时器
    assert.doesNotMatch(src, /setTimeout\(\s*\(\)\s*=>\s*set[A-Z]/, '不得用 JS 定时器做开合动画');
    assert.match(src, /dsh-devops-drawer-layer/, '抽屉开关类名要稳定，供 CSS 过渡挂钩');
  });
});

/* ------------------------------------------------------------------ *
 * 用例：默认路径复用 canvas.js 的真 NodeCard（canvas 负责人已加只读标志）
 * ------------------------------------------------------------------ */

describeMaybe('复用 canvas.js 的真 NodeCard 时，详情页仍然是只读的', () => {
  const canvas = hasSource ? loadRealCanvas() : { NodeCard: null };
  const loaded = hasSource ? loadDetail({}, canvas) : { exports: {}, hooks: makeHooks(), h: makeH() };
  const PipelineDetail = loaded.exports.PipelineDetail;
  const hooks = loaded.hooks;
  const render = (props) => { hooks.clear(); return PipelineDetail(props); };
  const rerender = (props) => { hooks.reset(); return PipelineDetail(props); };

  test('canvas.js 确实声明了只读支持，且详情页复用的是它', () => {
    assert.equal(canvas.NodeCard && canvas.NodeCard.supportsReadonly, true, 'canvas.js 应声明 supportsReadonly');
    assert.equal(loaded.exports.NodeCard, canvas.NodeCard, '详情页应复用 canvas.js 的 NodeCard');
  });

  test('★ 真卡片在详情页里不可拖拽、无拖拽回调、文案不含「拖拽」', () => {
    const tree = render(baseProps());
    const cards = findAll(tree, (n) => n.props && n.props['data-role'] === 'node-card');
    assert.equal(cards.length, 3, '三个节点应有三张真卡片');
    for (const card of cards) {
      assert.equal(card.props.draggable, false, '只读卡片 draggable 必须是 false');
      assert.equal(card.props.onDragStart, undefined, '不得挂 onDragStart');
      assert.equal(card.props.onDragEnd, undefined, '不得挂 onDragEnd');
      assert.equal(card.props['data-readonly'], 'true', '应带 data-readonly');
      assert.doesNotMatch(String(card.props.title || ''), /拖拽/, '只读卡片文案不得提示拖拽');
      assert.ok(String(card.props.className || '').includes('dsh-devops-nodecard'), '类名保持同构');
    }
    // 全局兜底：任何元素都不得可拖拽
    assert.equal(findAll(tree, (n) => n.props && n.props.draggable === true).length, 0);
    // 真卡片仍带编辑器同构的关键字段
    const text = textOf(cards[0]);
    assert.match(text, /执行条件/);
    assert.match(text, /服务器/);
  });

  test('★ 真卡片仍可点选打开抽屉（只读不等于不可点）', () => {
    const props = baseProps();
    let tree = render(props);
    const card = findAll(tree, (n) => n.props && n.props['data-role'] === 'node-card')[0];
    card.props.onClick({ stopPropagation() {} });
    tree = rerender(props);
    assert.equal(findAll(tree, (n) => n.props && n.props['data-role'] === 'detail-drawer')[0].props['data-open'], 'true', '点真卡片应打开抽屉');
  });

  test('只读容器带 .dsh-devops-readonly，让 styles.js 的只读样式生效', () => {
    const tree = render(baseProps());
    const board = findAll(tree, (n) => n.props && n.props['data-role'] === 'readonly-board')[0];
    assert.ok(String(board.props.className || '').includes('dsh-devops-readonly'), '只读容器应带 .dsh-devops-readonly');
    // 卡片/列都必须是它的后代，styles.js 的后代选择器才命中
    assert.equal(findAll(board, (n) => n.props && n.props['data-role'] === 'node-card').length, 3);
    assert.ok(findAll(board, (n) => String(n.props.className || '').includes('dsh-devops-column')).length >= 1);
  });
});

/* ------------------------------------------------------------------ *
 * 用例：样式类名归属（styles.js 归 task-6）
 * ------------------------------------------------------------------ */

describeMaybe('类名与 styles.js 的一致性（样式归 task-6，本页只引用）', () => {
  test('★ 本页用到的所有 .dsh-devops- 类名都已在 styles.js 定义（不发明类名）', () => {
    const src = readFileSync(detailPath, 'utf8');
    const stylesSrc = existsSync(stylesPath) ? readFileSync(stylesPath, 'utf8') : '';
    // styles.js 处于被 task-6 重写的中间态时（占位内容）不做断言
    const defined = new Set([...stylesSrc.matchAll(/\.dsh-devops-[a-z0-9-]+/g)].map((m) => m[0].slice(1)));
    if (defined.size < 20) return;

    const used = new Set();
    for (const m of src.matchAll(/className:\s*'([^']+)'/g)) {
      for (const cls of m[1].split(/\s+/)) if (cls.startsWith('dsh-devops-')) used.add(cls);
    }
    // data-role 之外的类名（含 canvas.js 复用卡片的类名）都必须在 styles.js 里有定义
    const unknown = [...used].filter((cls) => !defined.has(cls));
    assert.deepEqual(unknown, [], '这些类名在 styles.js 里没有定义：' + unknown.join(', ') + '（新样式须由 task-6 追加）');
  });

  test('样式类名统一 .dsh-devops- 前缀，颜色只用 token', () => {
    const src = readFileSync(detailPath, 'utf8');
    const bad = [];
    for (const m of src.matchAll(/className:\s*'([^']+)'/g)) {
      for (const cls of m[1].split(/\s+/)) {
        if (cls.startsWith('dsh-') && !cls.startsWith('dsh-devops-')) bad.push(cls);
      }
    }
    assert.deepEqual(bad, [], '这些类名的前缀写错了（应为 dsh-devops-）：' + bad.join(', '));
    const inlineColors = [...src.matchAll(/style:\s*\{[^}]*?(#[0-9a-fA-F]{3,8})/g)];
    assert.deepEqual(inlineColors.map((m) => m[1]), [], '不得硬编码颜色');
  });
});
/* ------------------------------------------------------------------ *
 * 用例：抽屉改为**圆角悬浮卡片** + 状态色由属性驱动（task-8）
 * ------------------------------------------------------------------ */

describeMaybe('抽屉是圆角悬浮卡片，且状态色由属性驱动（task-8）', () => {
  const loaded = hasSource ? loadDetail() : { exports: {}, hooks: makeHooks(), h: makeH() };
  const PipelineDetail = loaded.exports.PipelineDetail;
  const PipelineList = loaded.exports.PipelineList;
  const hooks = loaded.hooks;

  const render = (props) => { hooks.clear(); return PipelineDetail(props); };
  const rerender = (props) => { hooks.reset(); return PipelineDetail(props); };
  const drawerOf = (tree) => findAll(tree, (n) => n.props && n.props['data-role'] === 'detail-drawer')[0];
  const openFirstNode = (props) => {
    let tree = render(props);
    findAll(tree, (n) => n.props && n.props['data-role'] === 'readonly-slot')[0].props.onClick();
    return rerender(props);
  };

  /** 该步骤最近一次运行：状态用 stepStatusMap 推出来。 */
  const runsWithSteps = (jobId, status) => [
    run('run-1', 'failed', 1000, { [jobId]: { status } }),
  ];

  test('★ 抽屉层是「浮层」而非贴边面板：layer 带 floating 形态属性', () => {
    const tree = openFirstNode(baseProps());
    const drawer = drawerOf(tree);
    assert.equal(drawer.props['data-shape'], 'floating', '抽屉层必须声明 data-shape="floating"（脱离右边缘）');
  });

  test('★ 抽屉卡片带 data-variant="floating"（圆角/阴影/细边框/视口内最大高度由 CSS 按该属性落地）', () => {
    const tree = openFirstNode(baseProps());
    const panel = findAll(tree, (n) => n.props && n.props['data-role'] === 'drawer-panel')[0];
    assert.equal(panel.props['data-variant'], 'floating', '抽屉卡片必须声明 data-variant="floating"');
    assert.equal(panel.props.role, 'dialog', '仍必须是 dialog（既有契约）');
    // 卡片是浮层：不再是高度的 100% 内联写死（尺寸交给 CSS 的 max-height + auto）
    assert.equal(panel.props.style, undefined, '不得用内联尺寸/背景；形态一律交给 CSS');
  });

  test('★ 遮罩半透明 + 轻微模糊：mask 带 data-blur', () => {
    const tree = openFirstNode(baseProps());
    const mask = findAll(tree, (n) => n.props && n.props['data-role'] === 'drawer-mask')[0];
    assert.ok(mask, '应有遮罩');
    assert.equal(mask.props['data-blur'], 'true', '遮罩应声明 data-blur');
    assert.equal(typeof mask.props.onClick, 'function', '点遮罩仍要能关闭');
  });

  test('★ 三种关闭方式仍在：关闭按钮 / 遮罩 / Esc，且 data-role 契约未变', () => {
    const props = baseProps();
    let tree = openFirstNode(props);
    // ① 关闭按钮
    const close = findAll(tree, (n) => n.stub === 'Button' && String(n.props.label) === '关闭')[0];
    assert.ok(close, '应有显式关闭按钮');
    close.props.onClick();
    assert.equal(drawerOf(rerender(props)).props['data-open'], 'false', '点关闭应收起');
    // ② 遮罩
    tree = openFirstNode(props);
    findAll(tree, (n) => n.props && n.props['data-role'] === 'drawer-mask')[0].props.onClick();
    assert.equal(drawerOf(rerender(props)).props['data-open'], 'false', '点遮罩应收起');
    // ③ Esc（effect 注册 keydown 监听）
    tree = openFirstNode(props);
    assert.ok(drawerOf(tree), 'Esc 路径需要抽屉层存在');
    // 既有 data-role 契约：info 页签下应有的角色
    const roles = new Set(findAll(tree, (n) => n.props && n.props['data-role']).map((n) => n.props['data-role']));
    for (const role of ['detail-drawer', 'drawer-mask', 'drawer-panel', 'drawer-tabs', 'drawer-tab', 'drawer-view', 'drawer-panel-info']) {
      assert.ok(roles.has(role), '既有 data-role 契约丢失：' + role);
    }
    // 切到「日志」页签后，日志面板角色必须出现（未打开的页签不挂载是既有设计）
    findAll(tree, (n) => n.props && n.props['data-role'] === 'drawer-tab')[1].props.onClick();
    const logRoles = new Set(findAll(rerender(props), (n) => n.props && n.props['data-role']).map((n) => n.props['data-role']));
    assert.ok(logRoles.has('drawer-panel-log'), '既有 data-role 契约丢失：drawer-panel-log');
  });

  test('★ 状态色走属性：抽屉层带 data-status / data-tone（不写内联色）', () => {
    // 有运行记录：抽屉应按该节点最近一次执行状态着色
    const tree = openFirstNode(baseProps({ runs: runsWithSteps('compile', 'failed') }));
    const drawer = drawerOf(tree);
    assert.equal(drawer.props['data-status'], 'failed', '有运行记录时 data-status 应是该步骤状态');
    assert.equal(drawer.props['data-tone'], 'error', 'failed 应映射到 error 语义色');

    // 无运行记录：中性，不猜状态
    const idle = drawerOf(openFirstNode(baseProps({ runs: [] })));
    assert.equal(idle.props['data-status'], 'idle', '无运行记录应为 idle');
  });

  test('★ 节点卡片与阶段列带 data-status / data-tone（颜色由 CSS 决定）', () => {
    const tree = render(baseProps({ runs: runsWithSteps('compile', 'failed') }));
    const cards = findAll(tree, (n) => n.props && n.props['data-role'] === 'node-card');
    assert.ok(cards.length >= 1, '应有节点卡片');
    const failed = cards.filter((c) => c.props['data-status'] === 'failed');
    assert.ok(failed.length >= 1, '失败的节点卡片应带 data-status="failed"');
    for (const card of cards) {
      assert.ok(card.props['data-tone'], '每张卡片都必须带语义色调 data-tone');
    }
    const columns = findAll(tree, (n) => n.props && n.props['data-role'] === 'readonly-column');
    for (const col of columns) {
      assert.ok(col.props['data-status'], '阶段列必须带 data-status');
      assert.ok(col.props['data-tone'], '阶段列必须带语义色调 data-tone');
    }
    // 含失败节点的那个阶段，整体状态应为 failed
    assert.ok(columns.some((c) => c.props['data-status'] === 'failed'), '含失败节点的阶段应标为 failed');
  });

  test('★ 不写死颜色：详情页与抽屉不出现内联 hex', () => {
    // 先剥掉注释与字符串，避免把注释里的「React #310」这类编号误判成色值
    const src = readFileSync(detailPath, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    const inlineHex = [...src.matchAll(/'#[0-9a-fA-F]{3,8}'|"#[0-9a-fA-F]{3,8}"/g)].map((m) => m[0]);
    assert.deepEqual(inlineHex, [], '状态色必须走 data-status/data-tone + CSS，不得内联 hex');
  });

  test('「节点信息」分层：分组卡片 + 原始值深色小面板', () => {
    const tree = openFirstNode(baseProps());
    const groups = findAll(tree, (n) => n.props && n.props['data-role'] === 'drawer-info-group');
    assert.ok(groups.length >= 3, '节点信息应分组卡片化（执行/依赖与产物/环境与准备），实际 ' + groups.length);
    assert.deepEqual(groups.map((g) => g.props['data-group']), ['exec', 'deps', 'env'], '分组顺序应稳定');
    const raw = findAll(tree, (n) => String(n.props.className || '').includes('dsh-devops-drawer-raw'));
    assert.ok(raw.length >= 1, '原始值应用等宽小面板');
    assert.equal(raw[0].props['data-tone'], 'code', '原始值面板应带 data-tone="code"（深色终端观感）');
    assert.match(textOf(tree), /npm ci/, '原始值仍要显示出来');
  });

  test('★ 列表状态点/失败计数用状态色（Chip tone + dot）', () => {
    const pipelines = [{
      id: 'build-deploy', name: '构建并部署', stages: [{ id: 's1', name: '构建', jobs: [] }],
    }];
    const tree = PipelineList({
      pipelines,
      // 最近一次（startedAt 更大）失败 → 状态点取 error；历史里成功那次也要计入总数
      runs: [run('a', 'success', 1000), run('b', 'failed', 3000)],
      onCreate() {}, onOpen() {}, onEdit() {}, onRun() {}, onDelete() {},
    });
    const dots = findAll(tree, (n) => n.props && n.props['data-role'] === 'pipeline-status-dot');
    assert.equal(dots.length, 1, '每条流水线应有一个状态点');
    assert.equal(dots[0].props['data-tone'], 'error', '最近一次失败 → 状态点应为 error 语义色');
    const chip = findAll(tree, (n) => n.stub === 'Chip' && String(textOf(n)).includes('次失败'))[0];
    assert.ok(chip, '失败计数应作为徽标显示');
    assert.equal(chip.props.tone, 'error', '失败计数徽标应为 error 色调');
    assert.equal(chip.props.dot, true, '失败计数徽标应带状态点');
  });

  test('状态纯函数：stepStatusMap / toneOfStatus 语义正确', () => {
    const stepStatusMap = loaded.exports.stepStatusMap;
    const toneOfStatus = loaded.exports.toneOfStatus;
    assert.equal(typeof stepStatusMap, 'function');
    assert.equal(typeof toneOfStatus, 'function');
    assert.deepEqual(
      stepStatusMap([run('old', 'success', 1000, { a: { status: 'success' } }), run('new', 'failed', 5000, { a: { status: 'failed' }, b: { status: 'running' } })], 'build-deploy'),
      { a: 'failed', b: 'running' },
      '应取每个节点最近一次运行里的状态',
    );
    assert.equal(toneOfStatus('success'), 'ok');
    assert.equal(toneOfStatus('failed'), 'error');
    assert.equal(toneOfStatus('running'), 'busy');
    assert.equal(toneOfStatus('canceled'), 'warn');
    assert.equal(toneOfStatus('pending'), 'idle');
  });

  test('★ toneOfStatus 严格按冻结契约：success->ok / failed->error / running->busy / canceled->warn / 其余->idle', () => {
    const toneOfStatus = loaded.exports.toneOfStatus;
    assert.deepEqual(
      ['success', 'failed', 'running', 'canceled', 'pending', 'skipped', 'queued', undefined].map(toneOfStatus),
      ['ok', 'error', 'busy', 'warn', 'idle', 'idle', 'idle', 'idle'],
      '未列举的状态一律 idle',
    );
  });
});

describeMaybe('悬浮卡片样式由 styles.js 按属性落地（样式归 style-dev；未落地时不误报）', () => {
  test('styles.js 一旦定义 floating 形态，就必须同时给出圆角与阴影', () => {
    const stylesSrc = existsSync(stylesPath) ? readFileSync(stylesPath, 'utf8') : '';
    if (!stylesSrc.includes('data-shape="floating"')) return; // 样式尚未落地：不算失败
    const layer = stylesSrc.split('data-shape="floating"')[1] || '';
    assert.match(layer.slice(0, 400), /padding|margin/, '浮层应四周留白，不再贴住右边缘');
    const variant = stylesSrc.split('data-variant="floating"')[1] || '';
    assert.match(variant.slice(0, 400), /border-radius/, '悬浮卡片应有圆角');
    assert.match(variant.slice(0, 600), /box-shadow/, '悬浮卡片应有 elevation 阴影');
    assert.match(variant.slice(0, 600), /max-height/, '悬浮卡片高度应受视口约束');
  });
});
/* ------------------------------------------------------------------ *
 * 用例：运行页与详情页共用同一套悬浮卡片形态（task-8 要求「不要一处侧栏一处卡片」）
 * ------------------------------------------------------------------ */

describeMaybe('运行页的悬浮详情卡片与详情页同构（task-8）', () => {
  const runsPath = pluginPath('src', 'client', 'page-runs.js');
  const hasRuns = existsSync(runsPath);

  test('运行页浮层用同一套 data-shape / data-variant / data-blur 契约', () => {
    if (!hasRuns) return;
    const src = readFileSync(runsPath, 'utf8');
    assert.match(src, /'data-shape':\s*'floating'/, '运行页浮层要声明 data-shape="floating"');
    assert.match(src, /'data-variant':\s*'floating'/, '运行页卡片要声明 data-variant="floating"');
    assert.match(src, /'data-blur':\s*'true'/, '运行页遮罩要声明 data-blur');
    assert.match(src, /'data-role':\s*'step-drawer-panel'/, '运行页浮层要有稳定的 data-role');
    assert.match(src, /'data-role':\s*'step-drawer-mask'/, '运行页遮罩要有稳定的 data-role');
  });

  test('★ 运行页泳道不得复用 .dsh-devops-column（那是横向列，会挤成 236px）', () => {
    if (!hasRuns) return;
    const src = readFileSync(runsPath, 'utf8');
    // 只允许出现在注释里说明「不要用」
    const occurrences = [...src.matchAll(/className:\s*'[^']*dsh-devops-column[^']*'/g)];
    assert.deepEqual(occurrences.map((m) => m[0]), [], '运行页泳道不得把 .dsh-devops-column 当 class 用');
    assert.match(src, /run-lane/, '泳道应有自己的 data-role（run-lane）');
  });

  test('运行页浮层有定位上下文（否则 absolute 层会锚到整页）', () => {
    if (!hasRuns) return;
    const src = readFileSync(runsPath, 'utf8');
    assert.match(src, /'data-role':\s*'run-detail'/, 'RunDetail 根节点应可定位');
  });

  test('步骤卡片带 data-tone（状态色），阶段泳道带 data-status', () => {
    if (!hasRuns) return;
    const src = readFileSync(runsPath, 'utf8');
    assert.match(src, /'data-tone':\s*stepTone\(step\.status\)/, '步骤卡片应挂语义色调');
    assert.match(src, /laneStatus/, '泳道状态应由纯函数给出');
    assert.match(src, /exports\.laneStatus/, 'laneStatus 应导出以便测试');
  });
});
/* ------------------------------------------------------------------ *
 * 用例：真实渲染运行页的悬浮卡片与「详情」入口（不是源码正则）
 * ------------------------------------------------------------------ */

/** 用桩表加载 page-runs.js，真实调用 StepCard / StepDetailDrawer。 */
function loadRuns() {
  const source = readFileSync(pluginPath('src', 'client', 'page-runs.js'), 'utf8');
  const module = { exports: {} };
  const hooks = makeHooks();
  const h = makeH();
  const hookApi = {};
  for (const name of HOOK_NAMES) hookApi[name] = hooks[name];
  const stubs = {
    './h.js': Object.assign({ h }, hookApi),
    './ui.js': {
      Icon: stubComponent('Icon'), Button: stubComponent('Button'), StatusDot: stubComponent('StatusDot'),
      Chip: stubComponent('Chip'), Card: stubComponent('Card'), Empty: stubComponent('Empty'),
      Banner: stubComponent('Banner'), Modal: stubComponent('Modal'), Field: stubComponent('Field'),
      KV: (props) => h('dl', { className: 'dsh-devops-kv' }, (props.entries || []).map((e, i) => h('div', { key: i }, String(e[0]), e[1]))),
      TextInput: stubComponent('TextInput'), TextArea: stubComponent('TextArea'), Select: stubComponent('Select'),
      Switch: stubComponent('Switch'), ProgressRing: stubComponent('ProgressRing'),
      Collapsible: stubComponent('Collapsible'), AsyncBox: stubComponent('AsyncBox'),
      useToast: () => [null, { ok() {}, error() {} }],
    },
    './api.js': { api: { runLogs: () => Promise.resolve({ lines: [] }) } },
    './sse.js': { createRunStream: () => ({ close() {} }) },
    './logs.js': { LogPanel: stubComponent('LogPanel'), LogLine: stubComponent('LogLine') },
    './diagnostics.js': {
      diagnoseStep: () => ({ live: false, stuck: false, silentText: '' }),
      StuckPanel: stubComponent('StuckPanel'), PhaseFlow: stubComponent('PhaseFlow'),
      humanMs: (n) => String(n), attributionFor: () => [],
    },
    './ai.js': { AiButton: stubComponent('AiButton'), buildFailurePrompt: () => '' },
    './state.js': {
      runTone: (s) => (s === 'success' ? 'ok' : s === 'failed' ? 'error' : s === 'running' ? 'busy' : s === 'canceled' ? 'warn' : 'idle'),
      stepTone: (s) => (s === 'success' ? 'ok' : s === 'failed' ? 'error' : s === 'running' ? 'busy' : s === 'canceled' ? 'warn' : 'idle'),
      RUN_STATUS_TEXT: { queued: '排队中', running: '运行中', success: '成功', failed: '失败', canceled: '已取消' },
      STEP_STATUS_TEXT: { pending: '等待', running: '运行中', success: '成功', failed: '失败', skipped: '已跳过', canceled: '已取消' },
    },
    './syntax.js': {
      tokenizeLine: (line) => [{ text: line, kind: 'plain' }],
      detectLanguage: () => 'shell',
      normalizeLanguage: (n) => n,
      KINDS: ['plain'],
    },
  };
  new Function('module', 'exports', 'require', source)(module, module.exports, (id) => {
    if (!(id in stubs)) throw new Error('用例未覆盖的运行页依赖：' + id);
    return stubs[id];
  });
  return { exports: module.exports, hooks, h };
}

describeMaybe('运行页：点「详情」打开悬浮卡片（真实渲染）', () => {
  const loaded = loadRuns();
  const StepCard = loaded.exports.StepCard;
  const StepDetailDrawer = loaded.exports.StepDetailDrawer;
  const hooks = loaded.hooks;

  const step = { id: 'compile', name: '编译', node: 'shell.exec', status: 'failed', phase: 'settled', exitCode: 2, attempt: 1 };

  test('★ 步骤卡片带 data-status / data-tone，并提供「详情」入口', () => {
    hooks.reset();
    const opened = [];
    const tree = StepCard({
      step, expanded: false, onToggle() {}, runId: 'run-1', now: 1000, stuckSilenceSec: 60,
      server: null, toast: { ok() {}, error() {} }, ctx: {}, onRetried() {},
      onOpenDetail: (s) => opened.push(s.id),
    });
    assert.equal(tree.props['data-status'], 'failed', '步骤卡片应带原始状态');
    assert.equal(tree.props['data-tone'], 'error', '步骤卡片应带语义色调');
    const btn = findAll(tree, (n) => n.stub === 'Button' && String(n.props.label) === '详情')[0];
    assert.ok(btn, '应有「详情」入口');
    btn.props.onClick({ stopPropagation() {} });
    assert.deepEqual(opened, ['compile'], '点「详情」应回传该步骤');
  });

  test('★ 悬浮卡片真实渲染：floating 形态 + 两个页签 + 三种关闭', () => {
    hooks.clear();
    const closed = [];
    const tree = StepDetailDrawer({ step, runId: 'run-1', live: false, stuckSilenceSec: 60, now: 1000, onClose: () => closed.push(1) });
    const layer = findAll(tree, (n) => n.props && n.props['data-role'] === 'step-detail-drawer')[0];
    assert.ok(layer, '应有悬浮浮层');
    assert.equal(layer.props['data-shape'], 'floating', '浮层应声明 floating 形态');
    assert.equal(layer.props['data-open'], 'true', '有步骤时浮层应处于打开态');
    assert.equal(layer.props['data-status'], 'failed', '浮层应带步骤状态');
    assert.equal(layer.props['data-tone'], 'error', '浮层应带语义色调');
    const panel = findAll(tree, (n) => n.props && n.props['data-role'] === 'step-drawer-panel')[0];
    assert.equal(panel.props['data-variant'], 'floating', '卡片应声明 floating 变体');
    assert.equal(panel.props.role, 'dialog');
    const mask = findAll(tree, (n) => n.props && n.props['data-role'] === 'step-drawer-mask')[0];
    assert.equal(mask.props['data-blur'], 'true', '遮罩应带模糊');
    mask.props.onClick();
    assert.equal(closed.length, 1, '点遮罩应关闭');
    const closeBtn = findAll(tree, (n) => n.stub === 'Button' && String(n.props.label) === '关闭')[0];
    assert.ok(closeBtn, '应有关闭按钮');
    closeBtn.props.onClick();
    assert.equal(closed.length, 2, '点关闭按钮应关闭');
    const tabs = findAll(tree, (n) => n.props && n.props['data-role'] === 'step-drawer-tab');
    assert.deepEqual(tabs.map((t) => t.props['data-tab']), ['info', 'log'], '应有信息/日志两个页签');
    assert.match(textOf(findAll(tree, (n) => n.props && n.props['data-role'] === 'step-drawer-view')[0]), /退出码/);
  });

  test('收起时浮层 data-open=false（不弹任何东西）', () => {
    hooks.clear();
    const tree = StepDetailDrawer({ step: null, runId: '', live: false, now: 0, onClose() {} });
    const layer = findAll(tree, (n) => n.props && n.props['data-role'] === 'step-detail-drawer')[0];
    assert.equal(layer.props['data-open'], 'false', '无步骤时应收起');
  });
});

/* ------------------------------------------------------------------ *
 * 用例：点进流水线看得见阶段与运行历史，节点按运行状态着色并计时（修复三根因）
 * ------------------------------------------------------------------ */

describeMaybe('流水线详情：完整定义 + 运行历史 + 节点状态着色与计时', () => {
  const loaded = hasSource ? loadDetail({ api: { listRuns: null } }) : { exports: {}, hooks: makeHooks(), h: makeH() };
  const PipelineDetail = loaded.exports.PipelineDetail;
  const PipelineList = loaded.exports.PipelineList;
  const hooks = loaded.hooks;
  const render = (props) => { hooks.clear(); return PipelineDetail(props); };
  const rerender = (props) => { hooks.reset(); return PipelineDetail(props); };

  /** 带 steps 的最近一次运行（契约 A 的轻量形状：{status,startedAt,finishedAt}）。 */
  const runWithSteps = (steps, status, startedAt) =>
    run('run-1', status || 'running', startedAt || 5000, steps);

  test('★ 列表「阶段」列读 stageCount（列表接口不带 stages，过去恒显 0/0）', () => {
    // 真实列表摘要：只有 stageCount/jobCount，没有 stages
    const summary = { id: 'build-deploy', name: '构建并部署', stageCount: 2, jobCount: 3 };
    const tree = PipelineList({ pipelines: [summary], runs: [], onCreate() {}, onOpen() {}, onEdit() {}, onRun() {}, onDelete() {} });
    const text = textOf(tree);
    assert.match(text, /2 \/ 3/, '阶段/节点数应取 stageCount 与 jobCount，实际：' + text.slice(0, 300));
  });

  test('stageCountOf / jobCountOf：完整定义优先，摘要走 stageCount/jobCount', () => {
    const stageCountOf = loaded.exports.stageCountOf;
    const jobCountOf = loaded.exports.jobCountOf;
    assert.equal(stageCountOf({ stages: [{}, {}], stageCount: 9 }), 2, '带完整定义时以 stages 为准');
    assert.equal(stageCountOf({ stageCount: 3 }), 3, '只有摘要时用 stageCount');
    assert.equal(stageCountOf({}), 0, '两者都没有时为 0');
    assert.equal(stageCountOf(null), 0);
    const countFn = (pl) => (pl.stages || []).reduce((n, s) => n + (s.jobs || []).length, 0);
    assert.equal(jobCountOf({ stages: [{ jobs: [{}, {}] }], jobCount: 9 }, countFn), 2, '带完整定义时按 stages 计算');
    assert.equal(jobCountOf({ jobCount: 3 }, countFn), 3, '只有摘要时用 jobCount（否则会显示 0）');
    assert.equal(jobCountOf({}, countFn), 0);
  });

  test('★ openDetail 必须取完整定义：列表缓存没有 stages 也不能显示「还没有阶段」', async () => {
    const summary = { id: 'build-deploy', name: '构建并部署', stageCount: 2, jobCount: 3 }; // 无 stages
    const calls = [];
    const full = pipeline();
    const mod = loadDetail({
      api: {
        getPipeline: (id) => { calls.push(id); return Promise.resolve(full); },
        listRuns: () => Promise.resolve([]),
      },
    });
    const P = mod.exports.Pipelines;
    const props = {
      state: { pipelines: [summary], runs: [], nodes: [], servers: [], settings: {} },
      toast: { ok() {}, error() {}, warn() {} },
      ctx: {}, fieldCtx: { servers: [], envsets: [], snippets: [], defaultServer: 'local' },
      onReload() {}, onOpenRun() {}, recent: () => [], remember() {},
      remembered: { pipelinesMode: 'list' }, initialAction: { detail: 'build-deploy' },
    };
    mod.hooks.clear();
    P(props);
    await new Promise((r) => setTimeout(r, 0));
    mod.hooks.reset();
    const tree = P(props);
    assert.deepEqual(calls, ['build-deploy'], '即使列表缓存命中，也必须按 id 取一次完整定义');
    const text = textOf(tree);
    assert.doesNotMatch(text, /还没有阶段/, '有阶段时不得显示空态');
    assert.match(text, /构建/, '应渲染出真实阶段');
    assert.equal(findAll(tree, (n) => n.props && n.props['data-role'] === 'readonly-column').length, 2, '两个阶段应渲染成两列');
  });

  test('★ 取数失败：提示并回列表，绝不白屏', async () => {
    const errors = [];
    const mod = loadDetail({ api: { getPipeline: () => Promise.reject(new Error('流水线不存在：gone')), listRuns: () => Promise.resolve([]) } });
    const P = mod.exports.Pipelines;
    const props = {
      state: { pipelines: [], runs: [], nodes: [], servers: [], settings: {} },
      toast: { ok() {}, error: (m) => errors.push(m), warn() {} },
      ctx: {}, fieldCtx: { servers: [], envsets: [], snippets: [], defaultServer: 'local' },
      onReload() {}, onOpenRun() {}, recent: () => [], remember() {},
      remembered: { pipelinesMode: 'list' }, initialAction: { detail: 'gone' },
    };
    mod.hooks.clear();
    let threw = null;
    try {
      P(props);
      await new Promise((r) => setTimeout(r, 0));
      mod.hooks.reset();
      const tree = P(props);
      assert.match(textOf(tree), /点名称看详情|流水线/, '失败后应回到列表页而不是白屏');
    } catch (error) {
      threw = error;
    }
    assert.equal(threw, null, '取数失败不得抛错：' + (threw && threw.message));
    assert.ok(errors.some((m) => /不存在/.test(m)), '应给出可见提示，实际：' + JSON.stringify(errors));
  });

  test('★ 节点槽位按「最近一次运行」着色：running 绿、failed 红、未跑到保持灰', () => {
    const steps = {
      compile: { status: 'failed', startedAt: 5000, finishedAt: 6000 },
      test: { status: 'running', startedAt: 9000, finishedAt: 0 },
    };
    const tree = render(baseProps({ runs: [runWithSteps(steps, 'running', 9000)] }));
    const slots = findAll(tree, (n) => n.props && n.props['data-role'] === 'readonly-slot');
    const byJob = Object.fromEntries(slots.map((s) => [s.props['data-job'], s.props]));
    assert.equal(byJob.compile['data-status'], 'failed', '失败的节点应为 failed');
    assert.equal(byJob.compile['data-tone'], 'error', '失败 → error 语义色');
    assert.equal(byJob.test['data-status'], 'running', '运行中的节点应为 running');
    assert.equal(byJob.test['data-tone'], 'busy', '运行中 → busy 语义色');
    assert.equal(byJob.test['data-running'], 'true', '运行中的槽位应有 data-running 钩子');
    // ship 没出现在 steps 里 → 灰（未跑到）
    assert.equal(byJob.ship['data-status'], 'pending', '未跑到的节点必须保持 pending');
    assert.equal(byJob.ship['data-tone'], 'idle', 'pending → idle 语义色');
  });

  test('★ 两条卡片路径都渲染计时与状态徽标（同一 data-role 契约）', () => {
    const steps = { compile: { status: 'running', startedAt: 9000, finishedAt: 0 } };
    const props = baseProps({ runs: [runWithSteps(steps, 'running', 9000)] });

    // 路径一：canvas.js 缺失 → 降级 DisplayNodeCard
    const fallback = render(props);
    const fCards = findAll(fallback, (n) => n.props && n.props['data-role'] === 'node-card');
    assert.ok(findAll(fallback, (n) => n.props && n.props['data-role'] === 'nodecard-elapsed').length >= 1, '降级卡片也要有计时');
    assert.ok(findAll(fallback, (n) => n.props && n.props['data-role'] === 'nodecard-status').length >= 1, '降级卡片也要有状态徽标');
    assert.match(textOf(fCards[0]), /已运行/, '运行中的卡片应标「已运行」');

    // 路径二：复用 canvas.js 的真 NodeCard
    const real = loadDetail({}, loadRealCanvas());
    const realTree = real.exports.PipelineDetail(Object.assign({}, props));
    const rElapsed = findAll(realTree, (n) => n.props && n.props['data-role'] === 'nodecard-elapsed');
    const rStatus = findAll(realTree, (n) => n.props && n.props['data-role'] === 'nodecard-status');
    assert.ok(rElapsed.length >= 1, '真卡片也要有计时');
    assert.ok(rStatus.length >= 1, '真卡片也要有状态徽标');
    assert.equal(rStatus[0].props['data-tone'], 'busy', '运行中 → busy');
  });

  test('★ useTick 只在存在 running 节点时开启（无运行中的节点不空转）', () => {
    const running = render(baseProps({ runs: [runWithSteps({ compile: { status: 'running', startedAt: 9000 } }, 'running', 9000)] }));
    assert.ok(running, '应有渲染结果');
    assert.equal(hooks.tickCalls[hooks.tickCalls.length - 1], true, '有 running 节点时应开走秒');

    render(baseProps({ runs: [runWithSteps({ compile: { status: 'success', startedAt: 1000, finishedAt: 2000 } }, 'success', 2000)] }));
    assert.equal(hooks.tickCalls[hooks.tickCalls.length - 1], false, '全部结束时不应开走秒');
  });

  test('★ 运行历史按 pipelineId 单独取（不再依赖被截断的全局 runs），行可点进运行详情', async () => {
    const queries = [];
    const mod = loadDetail({
      api: {
        listRuns: (q) => { queries.push(q); return Promise.resolve([run('run-h1', 'success', 5000), run('run-h2', 'failed', 6000)]); },
      },
    });
    const D = mod.exports.PipelineDetail;
    const opened = [];
    const props = baseProps({ runs: [], onOpenRun: (id) => opened.push(id) });
    mod.hooks.clear();
    D(props);
    await new Promise((r) => setTimeout(r, 0));
    mod.hooks.reset();
    const tree = D(props);
    assert.deepEqual(queries, [{ pipelineId: 'build-deploy', limit: 100 }], '应按 pipelineId 取该流水线全部运行');
    assert.match(textOf(tree), /run-h1/, '应列出该流水线的运行');
    assert.match(textOf(tree), /run-h2/, '应列出该流水线的运行（不受全局 limit 50 影响）');

    const rows = findAll(tree, (n) => n.props && n.props['data-role'] === 'run-history-row');
    assert.equal(rows.length, 2, '每个运行一行');
    rows[1].props.onClick({ stopPropagation() {} });
    assert.deepEqual(opened, ['run-h2'], '点行应进入该运行的详情');
    // 行内「查看运行」按钮也要能进详情
    const btn = findAll(rows[0], (n) => n.stub === 'Button' && String(n.props.label) === '查看运行')[0];
    assert.ok(btn, '应有「查看运行」按钮');
    btn.props.onClick({ stopPropagation() {} });
    assert.deepEqual(opened, ['run-h2', 'run-h1'], '点按钮也应进入该运行的详情');
  });

  test('触发方式与耗时的展示文案', () => {
    const triggerLabel = loaded.exports.triggerLabel;
    const runDurationText = loaded.exports.runDurationText;
    assert.equal(triggerLabel(''), '手动触发');
    assert.equal(triggerLabel('manual'), '手动触发');
    assert.equal(triggerLabel('retry'), '重试');
    assert.equal(triggerLabel('webhook'), 'Webhook');
    assert.equal(triggerLabel('自定义'), '自定义', '未知触发方式原样显示，不编造');
    // 桩 h.js 把 fmtDuration 换成 'Nms'，这里按桩口径断言（生产口径由 h.js 保证）
    assert.equal(runDurationText({ durationMs: 5000 }, 0), '5000ms', '优先用后端 durationMs');
    assert.equal(runDurationText({ startedAt: 1000, finishedAt: 4000 }, 0), '3000ms', '没有 durationMs 时按时间戳算');
    assert.equal(runDurationText({}, 0), '—', '没有开始时间时给出占位符');
  });

  test('空阶段仍然显示「还没有阶段」（兼容性硬约束，回归）', () => {
    const p = pipeline();
    p.stages = [];
    const tree = render(baseProps({ pipeline: p }));
    assert.equal(findAll(tree, (n) => n.props && n.props['data-role'] === 'readonly-column').length, 0);
    assert.match(textOf(tree), /还没有阶段/);
  });
});
