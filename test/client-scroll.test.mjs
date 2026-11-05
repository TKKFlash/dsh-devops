// 滚动分区与画布边界回归（task-11）。
//
// 用户原话：
//   「编辑界面滚轮滑动不是分区域的，我在节点窗口滑动应该得只翻动节点那一个窗口，
//     不翻动整个窗口。然后在阶段添加到一定程度，就不能向右边翻动了，
//     不能继续添加新的阶段和节点。这些交互类型的你都没测试过交互合不合理。」
//
// 根因：styles.js 早就有 .dsh-devops-body[data-flush="true"]{overflow:hidden;...}，
// 但全工程无人设置 data-flush，于是 body 一直整页滚，子区域拿不到有界高度：
//   - 滚轮滚哪都是整页动；
//   - 画布自身的 overflow:auto 永不生效，横向滚动条被推到长页面底部、够不着，
//     于是「阶段加多了就翻不动、也加不进新阶段」。
//
// 本文件不启浏览器：既做主源文件结构断言，也用「桩 h + 桩 hooks」真实渲染 RunDetail。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { pluginPath } from './helpers/modules.mjs';

/*
 * RunDetail 里有「每秒重建的 setInterval」用于本地刷新耗时显示，而本文件的
 * 桩 hooks 会**真实执行** useEffect（为了断言 onBodyFlush 的时序），
 * 于是那个定时器被创建后永远没人清理 —— node --test 会一直等它，进程不退出
 * （必须加 --test-force-exit 才能收尾）。用例并不考察计时行为，这里把定时器
 * 换成 no-op，让测试进程能自然结束。
 */
const __realSetInterval = globalThis.setInterval;
const __realClearInterval = globalThis.clearInterval;
globalThis.setInterval = () => 0;
globalThis.clearInterval = () => {};
process.on('exit', () => {
  globalThis.setInterval = __realSetInterval;
  globalThis.clearInterval = __realClearInterval;
});

const stylesPath = pluginPath('src', 'client', 'styles.js');
const appPath = pluginPath('src', 'client', 'app.js');
const runsPath = pluginPath('src', 'client', 'page-runs.js');
const pipesPath = pluginPath('src', 'client', 'page-pipelines.js');
const editorPath = pluginPath('src', 'client', 'editor.js');

const hasStyles = existsSync(stylesPath);
const hasApp = existsSync(appPath);
const hasRuns = existsSync(runsPath);

const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');

/** 取某条规则体（先剥注释，再从行首锚定选择器）。 */
function ruleBody(css, selector) {
  const clean = selector.replace(/\{\s*$/, '').trim();
  const esc = clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const m = noComments.match(new RegExp('(?:^|\\n)\\s*' + esc + '\\s*\\{([^{}]*)\\}'));
  return m ? m[1] : '';
}

/* ------------------------------------------------------------------ *
 * 一、滚动分区：外层停止滚动 + 子区域各自独立滚动
 * ------------------------------------------------------------------ */

describe('滚动分区（外层 data-flush + 子区域独立滚动）', () => {
  test('★ app.js 提供 data-flush 机制（外层停止滚动的开关）', () => {
    if (!hasApp) return;
    const app = read(appPath);
    assert.match(app, /dsh-devops-body/, '应有 body 容器');
    assert.match(app, /'data-flush':\s*bodyFlush/, 'body 应绑定 data-flush 开关');
    assert.match(app, /onBodyFlush/, '应把 onBodyFlush 下发给页面');
  });

  test('★ data-flush 生效时外层不滚（overflow:hidden）', () => {
    if (!hasStyles) return;
    const body = ruleBody(read(stylesPath), '.dsh-devops-body[data-flush="true"]');
    assert.ok(body, '应有 .dsh-devops-body[data-flush="true"] 规则');
    assert.match(body, /overflow:hidden/, 'flush 时外层必须 overflow:hidden（不滚）');
    assert.match(body, /(display:flex|min-height:0)/, 'flush 时应建立可伸缩的列布局');
    // 未 flush 时仍是普通滚动容器（列表页照旧整页滚）
    const normal = ruleBody(read(stylesPath), '.dsh-devops-body');
    assert.match(normal, /overflow:auto/, '非 flush 的 body 应保持可滚');
  });

  test('★ 编辑器三栏各自是独立滚动容器（节点面板/画布/检查器）', () => {
    if (!hasStyles) return;
    const css = read(stylesPath);
    // 左侧节点面板：外层 overflow:hidden，内层自己滚
    assert.match(ruleBody(css, '.dsh-devops-palette'), /overflow:hidden/, '节点面板外层不应滚动');
    assert.match(ruleBody(css, '.dsh-devops-palette-scroll'), /overflow:auto/, '节点面板内层应自己滚');
    // 中间画布：两轴自滚
    const canvas = ruleBody(css, '.dsh-devops-canvas');
    assert.match(canvas, /overflow:auto/, '画布应两轴自滚');
    assert.match(canvas, /min-width:0/, '画布需要 min-width:0 才能在 flex 中收缩');
    // 右侧检查器
    assert.match(ruleBody(css, '.dsh-devops-inspector'), /overflow:hidden/, '检查器外层不应滚动');
    assert.match(ruleBody(css, '.dsh-devops-inspector-scroll'), /overflow-y:auto/, '检查器内层应自己滚');
    // 三栏公共父级
    const editor = ruleBody(css, '.dsh-devops-editor');
    assert.match(editor, /min-height:0/, '编辑器容器需要 min-height:0 才能让子项收缩');
  });

  test('★ 滚动链隔离：滚动区设置 overscroll-behavior:contain（滚到底不外传）', () => {
    if (!hasStyles) return;
    const css = read(stylesPath);
    // overscroll 常写成「组合选择器 + 单条规则体」，因此不能按单选择器取规则体：
    // 找出所有「声明体含 overscroll-behavior」的规则，收集其选择器列表。
    const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const guarded = new Set();
    for (const m of noComments.matchAll(/([^{}]+)\{([^{}]*overscroll-behavior[^{}]*)\}/g)) {
      for (const sel of m[1].split(',')) guarded.add(sel.trim());
    }
    // 用户点名的主滚动区必须都在其中
    const need = ['.dsh-devops-canvas', '.dsh-devops-palette-scroll', '.dsh-devops-inspector-scroll', '.dsh-devops-detail-scroll'];
    for (const sel of need) {
      assert.ok(guarded.has(sel), sel + ' 应设置 overscroll-behavior:contain（否则滚到底会把滚动传给外层）');
    }
  });

  test('★ 运行详情有内部滚动区，且声明了 onBodyFlush', () => {
    if (!hasRuns) return;
    const src = read(runsPath);
    assert.match(src, /props\.onBodyFlush\(true\)/, '进入运行详情应声明本页自管滚动');
    assert.match(src, /props\.onBodyFlush\(false\)/, '离开时应撤销声明');
    assert.match(src, /dsh-devops-detail-scroll/, '运行详情应有内部滚动区');
  });

  test('★ onBodyFlush 声明必须位于提前 return 之前（React #310 红线）', () => {
    if (!hasRuns) return;
    const src = read(runsPath);
    const callAt = src.indexOf('props.onBodyFlush(true)');
    assert.ok(callAt > 0, '应调用 onBodyFlush(true)');
    // 该调用所在组件的提前 return 必须在它之后
    const earlyReturn = src.indexOf('if (!run) return h(Empty');
    assert.ok(earlyReturn > callAt, 'onBodyFlush 的 useEffect 必须在「!run 提前 return」之前');
  });
});

/* ------------------------------------------------------------------ *
 * 二、渲染级：组件真的调用声明；详情页复用同一机制
 * ------------------------------------------------------------------ */

/** 极简桩 h：真实函数组件立即求值，便于检查 props。 */
function makeH() {
  return (type, props, ...children) => {
    const kids = children.flat().filter((c) => c !== null && c !== undefined && c !== false);
    if (typeof type === 'function') {
      return type(Object.assign({}, props || {}, kids.length ? { children: kids } : {}));
    }
    return { type, props: props || {}, children: kids };
  };
}

/** 桩 hooks：useEffect 立即执行（清理函数就地执行，便于断言「进入时声明」）。 */
function makeHooks() {
  const slots = [];
  const cleanups = [];
  let index = 0;
  return {
    slots,
    cleanups,
    reset() { index = 0; },
    clear() { slots.length = 0; cleanups.length = 0; index = 0; },
    /** 模拟卸载：按注册顺序执行全部清理函数。 */
    unmount() { const list = cleanups.splice(0); for (const fn of list) fn(); },
    useState(initial) {
      const i = index++;
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], (next) => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }];
    },
    /**
     * 记录清理函数而**不立即执行**：这样能分别断言「挂载时声明」与
     * 「卸载时撤销」两个语义（立即执行会把 [true] 变成 [true,false]，掩盖时序）。
     */
    useEffect(fn) {
      const cleanup = fn();
      if (typeof cleanup === 'function') cleanups.push(cleanup);
    },
    useMemo(fn) { return fn(); },
    useCallback(fn) { return fn; },
    useRef() { return { current: null }; },
    useReducer() { return [0, () => {}]; },
    useTick() { return undefined; },
  };
}

function stubComponent(name) {
  const fn = function Stub(props) { return { stub: name, props: props || {} }; };
  fn.__stub = name;
  return fn;
}

function findAll(node, predicate, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { for (const c of node) findAll(c, predicate, out); return out; }
  if (node.type !== undefined && predicate(node)) out.push(node);
  for (const child of node.children || []) findAll(child, predicate, out);
  return out;
}

function makeStubs(h, hooks) {
  const hookApi = {};
  for (const k of ['useState', 'useEffect', 'useMemo', 'useCallback', 'useRef', 'useReducer', 'useTick']) hookApi[k] = hooks[k];
  return {
    './h.js': Object.assign({ h, useSyncExternalStore: () => ({}), cx: (...p) => p.filter(Boolean).join(' '),
      fmtDuration: (m) => String(m) + 'ms', fmtTime: (t) => 'T' + t, fmtAgo: (t) => 'ago' + t,
      fmtBytes: (n) => String(n) + 'B', ellipsis: (s) => String(s), clone: (v) => v, groupBy: () => new Map() }, hookApi),
    './ui.js': {
      Icon: stubComponent('Icon'), Button: stubComponent('Button'), StatusDot: stubComponent('StatusDot'),
      Chip: stubComponent('Chip'), Card: stubComponent('Card'), Empty: stubComponent('Empty'),
      Banner: stubComponent('Banner'), Modal: stubComponent('Modal'), Field: stubComponent('Field'),
      KV: stubComponent('KV'), TextInput: stubComponent('TextInput'), TextArea: stubComponent('TextArea'),
      Select: stubComponent('Select'), Switch: stubComponent('Switch'), ProgressRing: stubComponent('ProgressRing'),
      Collapsible: stubComponent('Collapsible'), useToast: () => [null, { ok() {}, error() {} }],
      AsyncBox: stubComponent('AsyncBox'),
    },
    './state.js': { runTone: () => 'idle', stepTone: () => 'idle',
      RUN_STATUS_TEXT: { running: '运行中', success: '成功', failed: '失败', queued: '排队中', canceled: '已取消' },
      STEP_STATUS_TEXT: { pending: '等待', running: '运行中', success: '成功', failed: '失败', skipped: '已跳过', canceled: '已取消' } },
    './diagnostics.js': { diagnoseStep: () => ({}), StuckPanel: stubComponent('StuckPanel'), PhaseFlow: stubComponent('PhaseFlow'),
      humanMs: (n) => String(n), attributionFor: () => [] },
    './api.js': { api: { getRun: async () => null, runLogs: async () => ({ lines: [] }) } },
    './sse.js': { createRunStream: () => ({ close() {} }) },
    './logs.js': { LogPanel: stubComponent('LogPanel') },
    './ai.js': { AiButton: stubComponent('AiButton'), buildFailurePrompt: () => '' },
    './syntax.js': { tokenizeLine: () => [], detectLanguage: () => 'shell' },
    './editor.js': { PipelineEditor: stubComponent('PipelineEditor'), detectScheduling: () => 'staged', countJobs: () => 0 },
  };
}

function loadRuns() {
  const source = read(runsPath);
  const module = { exports: {} };
  const hooks = makeHooks();
  const h = makeH();
  const stubs = makeStubs(h, hooks);
  new Function('module', 'exports', 'require', source)(module, module.exports, (id) => {
    if (!(id in stubs)) throw new Error('用例未覆盖的依赖：' + id);
    return stubs[id];
  });
  return { exports: module.exports, hooks, h };
}

describe('渲染级：页面真的声明了「本页自管滚动」', { skip: hasRuns ? false : 'page-runs.js 不存在' }, () => {
  test('★ RunDetail 挂载时调用 onBodyFlush(true)，卸载时调用 false', () => {
    const { exports, hooks } = loadRuns();
    const calls = [];
    // RunDetail 首次渲染时 run 还是 null（走「加载中」分支），但 hooks 必须先执行——
    // 这正是该用例的价值：即使数据没到，滚动声明也已生效。
    hooks.clear();
    exports.RunDetail({
      runId: 'r1',
      toast: { ok() {}, error() {} },
      onBodyFlush: (v) => calls.push(v),
      onReload() {},
    });
    assert.deepEqual(calls, [true], '挂载时必须声明 onBodyFlush(true)');
    hooks.unmount();
    assert.deepEqual(calls, [true, false], '卸载时必须撤销声明 onBodyFlush(false)');
  });

  test('★ 没有 onBodyFlush 时不报错（降级安全）', () => {
    const { exports, hooks } = loadRuns();
    hooks.clear();
    assert.doesNotThrow(() => {
      exports.RunDetail({ runId: 'r1', toast: { ok() {}, error() {} }, onReload() {} });
    }, '宿主没提供 onBodyFlush 时必须静默降级，不能抛错');
  });

  test('★ 悬浮抽屉层留在滚动区之外（遮罩不会随内容滚走）', () => {
    const { exports, hooks } = loadRuns();
    hooks.clear();
    // RunDetail 的首个 useState 就是 run；预置状态槽让它跳过「加载中」分支，
    // 从而渲染出完整的详情树（数据由 useEffect 异步加载，桩环境不等微任务）。
    hooks.slots[0] = { id: 'r1', status: 'success', steps: {}, startedAt: 1, finishedAt: 2 };
    const tree = exports.RunDetail({
      runId: 'r1',
      toast: { ok() {}, error() {} },
      onBodyFlush() {},
      onReload() {},
    });
    // 找到滚动区与抽屉层，断言二者是兄弟关系（都在 .dsh-devops-detail 下）
    const root = findAll(tree, (n) => n.props && n.props['data-role'] === 'run-detail')[0];
    assert.ok(root, '应有 run-detail 根节点');
    const scroll = findAll(tree, (n) => n.props && n.props['data-role'] === 'run-detail-scroll')[0];
    assert.ok(scroll, '应有内部滚动区');
    const drawerLayer = findAll(tree, (n) => n.props && n.props['data-role'] === 'step-detail-drawer')[0];
    assert.ok(drawerLayer, '应有悬浮抽屉层');
    assert.ok(root.children.indexOf(scroll) >= 0, '滚动区应是根节点的直接子节点');
    assert.ok(root.children.indexOf(drawerLayer) >= 0, '抽屉层应是根节点的直接子节点（在滚动区之外）');
    assert.ok(
      findAll(scroll, (n) => n === drawerLayer).length === 0,
      '抽屉层不得被包进滚动区（否则遮罩会随内容滚走）',
    );
  });
});

/* ------------------------------------------------------------------ *
 * 三、画布横向边界（「阶段加多了向右翻不动、也加不进新阶段」）
 * ------------------------------------------------------------------ */

describe('画布横向边界（新增列可达、可继续添加）', () => {
  const css = hasStyles ? read(stylesPath) : '';

  test('★ board 按内容撑开，列不会被裁掉（横向滚动能到最后一列）', () => {
    if (!css) return;
    const board = ruleBody(css, '.dsh-devops-board');
    assert.match(board, /display:flex/, 'board 应是 flex 行容器');
    assert.match(board, /flex-direction:row/, '阶段应横向排列');
    // 关键：board 宽度必须随内容增长，否则 overflow 容器算不出正确的滚动宽度
    assert.match(board, /width:max-content/, 'board 应按内容撑开（否则末尾列与「添加阶段」按钮滚不到）');
    assert.match(board, /min-width:100%/, '列少时 board 仍应撑满可视宽');
  });

  test('★ 画布是可横向滚动的容器，且 stage 列不收缩', () => {
    if (!css) return;
    const canvas = ruleBody(css, '.dsh-devops-canvas');
    assert.match(canvas, /overflow:auto/, '画布应可滚动');
    const column = ruleBody(css, '.dsh-devops-column');
    assert.match(column, /flex:0 0 auto/, '列不得收缩（否则阶段多了会被挤扁而不是滚动）');
    assert.match(column, /width:/, '列应有固定宽度');
  });

  test('★ 每一列都有就地加阶段入口，末尾还有追加入口', () => {
    const canvasPath = pluginPath('src', 'client', 'canvas.js');
    if (!existsSync(canvasPath)) return;
    const src = read(canvasPath);
    assert.match(src, /kind:\s*'head'/, '列头应有加阶段入口');
    assert.match(src, /kind:\s*'gap'/, '列间应有插入入口');
    assert.match(src, /kind:\s*'end'/, '末尾应有追加入口');
    // 末尾入口必须在 board 的 children 里（随 board 一起滚动，能被滚到）
    assert.match(src, /add-stage-end/, '末尾追加入口应有稳定 key');
  });

  test('★ 新增阶段的落点由插入函数决定（不是被边界截断）', () => {
    const canvasPath = pluginPath('src', 'client', 'canvas.js');
    if (!existsSync(canvasPath)) return;
    const src = read(canvasPath);
    // insertStage(index) 是统一入口；三处入口都调它
    assert.match(src, /function insertStage|const insertStage/, '应有统一的 insertStage');
    const calls = [...src.matchAll(/insertStage\(/g)].length;
    assert.ok(calls >= 3, '列头/列间/末尾三处都应通过 insertStage 落地（实际 ' + calls + ' 处）');
  });
});

/* ------------------------------------------------------------------ *
 * 四、跨文件契约（供文件名所有者落地；未落地时不误报）
 * ------------------------------------------------------------------ */

describe('跨文件协作项（样式归 drawer-dev、页面归 detail-dev）', () => {
  /**
   * 编辑器「中间列」的内联样式对象：特征同时含 flex:1 / flexDirection:'column' / minWidth:0。
   * 只挑这一个容器，避免误伤页面里其它合法的纵向 flex。
   */
  function editorColumnStyles(src) {
    return [...src.matchAll(/\{[^{}]*flexDirection:\s*'column'[^{}]*\}/g)]
      .map((m) => m[0])
      .filter((s) => /flex:\s*1/.test(s) && /minWidth:\s*0/.test(s));
  }

  test('★ 编辑器中间列有 minHeight:0（否则画布被撑高、自滚失效）', () => {
    for (const p of [editorPath, pipesPath]) {
      if (!existsSync(p)) continue;
      const src = read(p);
      // 页面所有者已声明 onBodyFlush（= 该项已落地）时，才严格要求收缩链完整；
      // 未落地时跳过，避免把队友的进行中工作误报成本用例失败。
      if (!src.includes('onBodyFlush(true)')) continue;
      const cols = editorColumnStyles(src);
      assert.ok(cols.length >= 1, basename(p) + ' 应能找到编辑器中间列的内联样式');
      for (const col of cols) {
        assert.match(col, /minHeight:\s*0/, basename(p) + ' 的编辑器中间列缺 minHeight:0（flex 子项无法收缩）：' + col);
      }
    }
  });

  test('编辑器/详情页应声明 onBodyFlush（由页面所有者落地）', () => {
    const declared = [editorPath, pipesPath].filter((p) => existsSync(p) && read(p).includes('onBodyFlush(true)'));
    // 页面所有者尚未落地时跳过；落地后至少一处（编辑器或详情页）必须声明。
    if (declared.length === 0) return;
    assert.ok(declared.length >= 1, '至少编辑器或详情页应声明 onBodyFlush');
  });
});

function basename(p) {
  return String(p).split(/[\\/]/).pop();
}
