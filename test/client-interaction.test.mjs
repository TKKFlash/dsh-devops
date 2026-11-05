// 交互回归：状态栏「点不动 / 硬显示失败的那条」与页面可达性（task-3）。
//
// 用户报告：
//   「右下角的流水线按钮我不知道何意味，移不动，也点不动，还硬显示失败的流水线，
//     不是有好多个流水线吗？为什么只显示这一条，不应该显示正在跑的吗？」
//   「一堆按钮点不了……点流水线名理论上也要能进入到流水线里面看详情和运行情况，
//     在流水线里面也能点编辑按钮进入编辑。」
//
// 本用例不启浏览器：把 src/client/*.js 放进带桩的迷你模块表里执行，
// 用「桩 h」（把元素记成可检查的树）+「桩 hooks」（useState 用可写格子模拟）
// 直接调用组件函数，断言渲染结果。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { pluginPath } from './helpers/modules.mjs';

const sbPath = pluginPath('src', 'client', 'statusbar.js');
const hasSource = existsSync(sbPath);

/**
 * 桩 h：
 *  - 桩组件（stubComponent 造出来的）→ 记成一个带 stub 标记的可检查节点；
 *  - 真实函数组件 → 立即求值（等价 React 渲染一次函数组件），这样才能拿到子树；
 *  - 宿主标签（'div'/'span'…）→ 记成普通节点。
 */
function makeH() {
  return (type, props, ...children) => {
    const kids = children.flat().filter((c) => c !== null && c !== undefined && c !== false);
    const given = props || {};
    if (typeof type === 'function') {
      if (type.__stub) {
        return { type, stub: type.__stub, props: given, children: kids };
      }
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
 * 桩 hooks：
 *  - useState 返回 [当前值, setter]；setter 同步改格子，重新调用组件即可看到新值。
 *  - useEffect 立即执行一次（清理函数就地执行），这样「挂载时注册导航」这类逻辑可断言。
 */
function makeHooks() {
  const slots = [];
  let index = 0;
  return {
    reset() { index = 0; },
    /** 清空状态格子：模拟「全新挂载」，避免用例之间状态串味。 */
    clear() { slots.length = 0; index = 0; },
    slots,
    useState(initial) {
      const i = index++;
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      const set = (next) => {
        slots[i] = typeof next === 'function' ? next(slots[i]) : next;
      };
      return [slots[i], set];
    },
    useEffect(fn) {
      const cleanup = fn();
      if (typeof cleanup === 'function') cleanup();
      return undefined;
    },
    useMemo(fn) { return fn(); },
    useCallback(fn) { return fn; },
    useRef() { return { current: null }; },
    useReducer() { return [0, () => {}]; },
    useTick() { return undefined; },
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

/**
 * 收集树里所有「用户可见文本」。
 * 桩组件（Button/Card/Chip…）把文案放在 props.label / props.title 上，
 * 真实组件里这些就是渲染出来的文字，所以一并算进来。
 */
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

/** 载入真实的 src/client/syntax.js（零依赖纯函数，直接求值）。 */
function loadSyntax() {
  const source = readFileSync(pluginPath('src', 'client', 'syntax.js'), 'utf8');
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', source)(mod, mod.exports, () => {
    throw new Error('syntax.js 应当零依赖');
  });
  return mod.exports;
}

/** 加载一个客户端模块：把它的相对依赖换成桩。 */
function loadModule(relPath, extraStubs) {
  const source = readFileSync(pluginPath('src', 'client', relPath), 'utf8');
  const module = { exports: {} };
  const hooks = makeHooks();
  const h = makeH();
  const stubs = {
    './h.js': Object.assign({
      h,
      useState: hooks.useState,
      useEffect: hooks.useEffect,
      useMemo: hooks.useMemo,
      useCallback: hooks.useCallback,
      useRef: hooks.useRef,
      useReducer: hooks.useReducer,
      useTick: hooks.useTick,
      useSyncExternalStore: () => ({}),
      cx: (...parts) => parts.filter(Boolean).join(' '),
      fmtDuration: (ms) => String(ms) + 'ms',
      fmtTime: (ts) => 'T' + ts,
      fmtAgo: (ts) => 'ago' + ts,
      fmtBytes: (n) => String(n) + 'B',
      ellipsis: (s) => String(s),
      clone: (v) => v,
      groupBy: () => new Map(),
    }, (extraStubs && extraStubs['./h.js']) || {}),
    './ui.js': {
      Icon: stubComponent('Icon'),
      Button: stubComponent('Button'),
      StatusDot: stubComponent('StatusDot'),
      Chip: stubComponent('Chip'),
      Card: stubComponent('Card'),
      Empty: stubComponent('Empty'),
      Banner: stubComponent('Banner'),
      Modal: stubComponent('Modal'),
      Field: stubComponent('Field'),
      KV: stubComponent('KV'),
      TextInput: stubComponent('TextInput'),
      TextArea: stubComponent('TextArea'),
      Select: stubComponent('Select'),
      Switch: stubComponent('Switch'),
      ProgressRing: stubComponent('ProgressRing'),
      Collapsible: stubComponent('Collapsible'),
      useToast: () => [null, { ok() {}, error() {} }],
      AsyncBox: stubComponent('AsyncBox'),
    },
    './state.js': {
      runTone: () => 'idle',
      stepTone: () => 'idle',
      RUN_STATUS_TEXT: { queued: '排队中', running: '运行中', success: '成功', failed: '失败', canceled: '已取消' },
      STEP_STATUS_TEXT: { pending: '等待', running: '运行中', success: '成功', failed: '失败', skipped: '已跳过', canceled: '已取消' },
      createStore: () => ({ getState: () => ({}), setState: () => {}, subscribe: () => () => {} }),
      useStore: () => ({}),
    },
    './diagnostics.js': {
      diagnoseStep: () => ({ live: false, stuck: false, silentText: '' }),
      StuckPanel: stubComponent('StuckPanel'),
      PhaseFlow: stubComponent('PhaseFlow'),
      humanMs: (n) => String(n),
      attributionFor: () => [],
    },
    './api.js': { api: {} },
    './editor.js': {
      PipelineEditor: stubComponent('PipelineEditor'),
      detectScheduling: () => 'staged',
      countJobs: (p) => (p.stages || []).reduce((n, s) => n + (s.jobs || []).length, 0),
    },
    './sse.js': { createRunStream: () => ({ close() {} }) },
    './logs.js': { LogPanel: stubComponent('LogPanel') },
    './ai.js': { AiButton: stubComponent('AiButton'), buildFailurePrompt: () => '' },
    // page-runs.js 的静态日志现在走共享语法引擎：装**真实实现**
    // （零依赖纯函数），这样被测的着色路径就是生产路径。
    './syntax.js': loadSyntax(),
  };
  Object.assign(stubs, (extraStubs && extraStubs.extra) || {});
  const requireStub = (id) => {
    if (!(id in stubs)) throw new Error('用例未覆盖的依赖：' + id + '（来自 ' + relPath + '）');
    return stubs[id];
  };
  new Function('module', 'exports', 'require', source)(module, module.exports, requireStub);
  return { exports: module.exports, hooks, h };
}

function run(id, status, startedAt) {
  return { id: 'run-' + id, status: status, pipelineId: 'p-' + id, pipelineName: '流水线 ' + id, startedAt: startedAt || 1000 };
}

const describeMaybe = hasSource ? describe : describe.skip;

describeMaybe('StatusBar：焦点语义与可达性（task-3 缺陷 1/2/3/4）', () => {
  const loaded = hasSource ? loadModule('statusbar.js') : { exports: {}, hooks: makeHooks(), h: makeH() };
  const StatusBar = loaded.exports.StatusBar;
  const statusBarModel = loaded.exports.statusBarModel;
  const resolveNavTarget = loaded.exports.resolveNavTarget;
  const hooks = loaded.hooks;
  const h = loaded.h;

  /** 全新挂载渲染。 */
  const render = (props) => {
    hooks.clear();
    return StatusBar(props);
  };
  /** 保留 state 的再次渲染：用于观察「点击后状态变化」。 */
  const rerender = (props) => {
    hooks.reset();
    return StatusBar(props);
  };
  const baseProps = (state, extra) => Object.assign({
    state: state,
    toast: { ok() {}, error() {} },
    onOpenRun() {},
    onNavigate() {},
  }, extra || {});

  test('★ 完全空闲时不得把失败运行当焦点（缺陷 1）', () => {
    const runs = [run('a', 'failed')];
    runs[0].finishedAt = 5000;
    const model = statusBarModel({ runs: runs });
    assert.equal(model.focus, null, '空闲态焦点必须是 null，不能是失败运行');
    assert.equal(model.active.length, 0);
    assert.equal(model.failedCount, 1, '失败仍要计入徽标');

    const text = textOf(render(baseProps({ runs: runs })));
    assert.match(text, /当前没有运行中的流水线/, '空闲态要有一句中性说明');
    assert.doesNotMatch(text, /流水线 a/, '不得把失败运行显示成当前运行');
    assert.match(text, /1 失败/, '失败只作为计数徽标');
  });

  test('★ 多个活跃运行要全部列出，而不是只显示一条（缺陷 2）', () => {
    const runs = [run('a', 'running', 1000), run('b', 'running', 2000), run('c', 'queued', 3000)];
    const model = statusBarModel({ runs: runs });
    assert.equal(model.active.length, 3);
    assert.deepEqual(model.visible.map((r) => r.id), ['run-a', 'run-b', 'run-c'], '全部活跃运行都要可见');
    assert.equal(model.overflow, 0);

    const text = textOf(render(baseProps({ runs: runs })));
    for (const id of ['a', 'b', 'c']) {
      assert.match(text, new RegExp('流水线 ' + id), '运行 ' + id + ' 应出现在状态栏');
    }

    const many = [1, 2, 3, 4, 5].map((i) => run(String(i), 'running', i));
    const manyModel = statusBarModel({ runs: many });
    assert.equal(manyModel.visible.length, 3);
    assert.equal(manyModel.overflow, 2, '超出部分要折叠成 +N');
    assert.match(textOf(render(baseProps({ runs: many }))), /\+2/, '要有 +2 展开入口');
  });

  test('★ 点击运行条目要调用 onOpenRun（缺陷 3：点了没反应）', () => {
    const calls = [];
    const runs = [run('a', 'running', 1000)];
    const tree = render(baseProps({ runs: runs, panelMounted: true }, { onOpenRun: (id) => calls.push(id) }));
    const segs = findAll(tree, (n) => n.props && typeof n.props.title === 'string' && n.props.title.indexOf('点击查看这次运行') === 0);
    assert.ok(segs.length >= 1, '每条活跃运行都要是可点元素');
    segs[0].props.onClick({ stopPropagation() {} });
    assert.deepEqual(calls, ['run-a'], '点击运行条目应调用 onOpenRun(runId)');
  });

  test('★ 导航未注册时必须给可见降级，而不是静默无效（缺陷 3）', () => {
    const runs = [run('a', 'running', 1000)];
    const tree = render(baseProps({ runs: runs, panelMounted: false }));
    assert.match(textOf(tree), /面板未打开/, '导航不可用时要有常驻可见提示');

    const blocked = resolveNavTarget({ ready: false, onOpenRun: null, onNavigate: null }, { kind: 'run', runId: 'run-a' });
    assert.equal(blocked.kind, 'blocked');
    assert.match(blocked.message, /面板/, '降级必须给出人能看懂的原因');

    const ok = resolveNavTarget({ ready: true, onOpenRun: () => {}, onNavigate: () => {} }, { kind: 'run', runId: 'run-a' });
    assert.deepEqual(ok, { kind: 'run', runId: 'run-a' });

    const segs = findAll(tree, (n) => n.props && typeof n.props.title === 'string' && n.props.title.indexOf('点击查看这次运行') === 0);
    assert.ok(segs.length >= 1, '导航不可用时条目仍要渲染成可点元素（点了给原因）');
    segs[0].props.onClick({ stopPropagation() {} });
    const after = rerender(baseProps({ runs: runs, panelMounted: false }));
    assert.match(textOf(after), /还没有打开过|面板/, '点击受阻后要显示原因');
  });

  test('★ 收起后必须能恢复，且收起不再是右键专属（缺陷 4）', () => {
    const runs = [run('a', 'running', 1000)];
    const tree = render(baseProps({ runs: runs, panelMounted: true }));
    const collapseBtn = findAll(tree, (n) => n.props && String(n.props.label || '') === '收起')[0];
    assert.ok(collapseBtn, '要有显式「收起」控件，不能只靠右键');
    collapseBtn.props.onClick({ stopPropagation() {} });

    const hiddenTree = rerender(baseProps({ runs: runs, panelMounted: true }));
    assert.match(textOf(hiddenTree), /显示状态栏/, '收起后必须有常驻的「显示状态栏」恢复入口');
  });

  test('失败徽标可点，跳到运行列表', () => {
    const runs = [run('a', 'failed')];
    const calls = [];
    const tree = render(baseProps({ runs: runs, panelMounted: true }, { onNavigate: (p) => calls.push(p) }));
    const badge = findAll(tree, (n) => n.props && typeof n.props.title === 'string' && n.props.title.indexOf('次运行失败') > 0)[0];
    assert.ok(badge, '失败徽标应可点');
    badge.props.onClick({ stopPropagation() {} });
    assert.deepEqual(calls, ['runs'], '点失败徽标应跳到运行列表');
  });
});

describeMaybe('PipelineList：流水线名可达（task-3 缺陷 5）', () => {
  const loaded = hasSource ? loadModule('page-pipelines.js') : { exports: {}, hooks: makeHooks(), h: makeH() };
  const PipelineList = loaded.exports.PipelineList;
  const PipelineNameCell = loaded.exports.PipelineNameCell;
  const PipelineDetail = loaded.exports.PipelineDetail;
  const hooks = loaded.hooks;
  const h = loaded.h;

  const pipeline = {
    id: 'build-deploy',
    name: '构建并部署',
    stages: [{ id: 's1', name: '构建', parallel: false, jobs: [{ id: 'j1', name: '编译', node: 'shell.exec' }] }],
  };

  test('★ 流水线名是可点元素，点击进入详情（不是纯文本 span）', () => {
    const opened = [];
    hooks.reset();
    const tree = PipelineList({
      pipelines: [pipeline],
      onCreate() {}, onOpen: (id) => opened.push(id), onEdit() {}, onRun() {}, onDelete() {},
    });
    const link = findAll(tree, (n) => n.props && String(n.props.className || '').indexOf('dsh-devops-link') >= 0)[0];
    assert.ok(link, '流水线名必须是 .dsh-devops-link（可点），不能是纯文本 span');
    assert.equal(link.props.role, 'button');
    link.props.onClick();
    assert.deepEqual(opened, ['build-deploy'], '点名称应进入详情');

    hooks.reset();
    const cell = PipelineNameCell({ pipeline: pipeline, activeRun: null, onOpen: (id) => opened.push('cell:' + id) });
    const cellLink = findAll(cell, (n) => n.props && String(n.props.className || '').indexOf('dsh-devops-link') >= 0)[0];
    assert.ok(cellLink, '名称单元格里的名称也必须是可点链接');
    cellLink.props.onClick();
    assert.deepEqual(opened, ['build-deploy', 'cell:build-deploy']);
  });

  test('列表要有「详情」「编辑」「运行」「删除」四个入口', () => {
    hooks.reset();
    const tree = PipelineList({ pipelines: [pipeline], onCreate() {}, onOpen() {}, onEdit() {}, onRun() {}, onDelete() {} });
    const labels = findAll(tree, (n) => n.stub === 'Button').map((b) => String(b.props.label || ''));
    for (const want of ['详情', '编辑', '运行', '删除']) {
      assert.ok(labels.includes(want), '缺少「' + want + '」按钮，实际：' + labels.join(','));
    }
  });

  test('★ 详情页必须有编辑与运行入口，并展示定义/阶段/最近运行（缺陷 5/6）', () => {
    hooks.reset();
    const tree = PipelineDetail({
      pipeline: pipeline, runs: [],
      onBack() {}, onEdit() {}, onRun() {}, onReload() {}, onOpenRun() {},
    });
    const buttons = findAll(tree, (n) => n.stub === 'Button').map((b) => String(b.props.label || ''));
    assert.ok(buttons.includes('编辑'), '详情页要有「编辑」入口');
    assert.ok(buttons.includes('运行'), '详情页要有「运行」入口');
    const text = textOf(tree);
    assert.match(text, /定义概览/, '详情要展示定义概览');
    assert.match(text, /阶段与节点/, '详情要展示阶段与节点');
    assert.match(text, /最近运行/, '详情要展示最近运行');
  });

  test('详情页的「编辑」回调带 pipelineId', () => {
    const edits = [];
    hooks.reset();
    const tree = PipelineDetail({ pipeline: pipeline, runs: [], onBack() {}, onEdit: (id) => edits.push(id), onRun() {}, onReload() {}, onOpenRun() {} });
    const edit = findAll(tree, (n) => n.stub === 'Button' && String(n.props.label) === '编辑')[0];
    edit.props.onClick();
    assert.deepEqual(edits, ['build-deploy'], '编辑入口必须带 pipelineId');
  });
});

describeMaybe('RunDetail：编辑入口与按钮审计（task-3 缺陷 6/7）', () => {
  const loaded = hasSource ? loadModule('page-runs.js') : { exports: {}, hooks: makeHooks(), h: makeH() };
  const StepCard = loaded.exports.StepCard;
  const hooks = loaded.hooks;
  const h = loaded.h;

  test('运行详情要有「编辑流水线」入口，且调用 onEditPipeline(pipelineId)', () => {
    const src = readFileSync(pluginPath('src', 'client', 'page-runs.js'), 'utf8');
    assert.match(src, /编辑流水线/, '运行详情要有「编辑流水线」按钮');
    assert.match(src, /props\.onEditPipeline/, '「编辑流水线」必须调用 onEditPipeline(pipelineId)');
    assert.match(src, /onOpenPipeline/, '流水线名应可点进详情');
  });

  test('★ 「重试此步」按钮自带 handler（不再只挂在外层 span 上）', () => {
    hooks.reset();
    const step = { id: 'compile', name: '编译', node: 'shell.exec', status: 'failed', phase: 'settled' };
    const tree = StepCard({
      step: step, expanded: false, onToggle() {}, runId: 'run-1', now: Date.now(),
      stuckSilenceSec: 60, server: null, toast: { ok() {}, error() {} }, ctx: {},
      onRetried() {},
    });
    const btn = findAll(tree, (n) => n.stub === 'Button' && String(n.props.label) === '重试此步')[0];
    assert.ok(btn, '失败的步骤要有「重试此步」按钮');
    assert.equal(typeof btn.props.onClick, 'function', '按钮自身必须带 onClick');
  });

  test('★ 「全部展开」要真的展开该阶段全部步骤（审计：过去只展开第一条）', () => {
    const src = readFileSync(pluginPath('src', 'client', 'page-runs.js'), 'utf8');
    assert.match(src, /useState\(\[\]\)/, 'expanded 应是 id 数组，才能同时展开多条');
    assert.match(src, /toggleLane/, '要有 toggleLane 实现全部展开与全部收起');
    assert.match(src, /全部收起/, '要能反映「全部已展开」的状态');
    assert.doesNotMatch(src, /setExpanded\(expanded \? '' : list\[0\]/, '不得再只展开第一条');
  });
});

describeMaybe('调用点契约（app.js）', () => {
  const appSrc = hasSource ? readFileSync(pluginPath('src', 'client', 'app.js'), 'utf8') : '';

  test('★ 导航注册后写入 navRegistered，供状态栏判断可用性', () => {
    assert.match(appSrc, /store\.setState\(\{ navRegistered: true \}\)/, '注册导航后要打标记');
  });

  test('★ 流水线入口路由到详情，并提供 onEditPipeline', () => {
    assert.match(appSrc, /onOpenPipeline:\s*\(id\)\s*=>\s*navigate\('pipelines',\s*\{\s*detail:\s*id\s*\}\)/, '打开流水线应进详情');
    assert.match(appSrc, /onEditPipeline:\s*\(id\)\s*=>\s*navigate\('pipelines',\s*\{\s*edit:\s*id\s*\}\)/, '编辑入口应带 edit:id 进编辑器');
  });

  test('状态栏不得读宿主 ctx 的数据键（保持纯数据）', () => {
    const sb = readFileSync(sbPath, 'utf8');
    assert.doesNotMatch(sb, /\bctx\.(servers|envsets|snippets|defaultServer)\b/, '状态栏不得读宿主 ctx 数据键');
  });
});

describe('状态栏样式类约束（styles.js 归画布任务，状态栏只复用既有类）', () => {
  test('状态栏根元素保持 --bare（整页尺寸回归）', () => {
    const sb = readFileSync(sbPath, 'utf8');
    assert.match(sb, /dsh-devops-root--bare/);
  });

  test('状态栏不引入 styles.js 里不存在的类名', () => {
    const sb = readFileSync(sbPath, 'utf8');
    const styles = readFileSync(pluginPath('src', 'client', 'styles.js'), 'utf8');
    const used = new Set();
    for (const m of sb.matchAll(/className:\s*'([^']+)'/g)) {
      for (const cls of m[1].split(/\s+/)) {
        if (cls && cls.indexOf('dsh-devops-') === 0) used.add(cls);
      }
    }
    const missing = [...used].filter((cls) => styles.indexOf('.' + cls) < 0);
    assert.deepEqual(missing, [], '状态栏用了 styles.js 里没有的类：' + missing.join(', ') + '（新样式须由画布任务追加）');
  });
});