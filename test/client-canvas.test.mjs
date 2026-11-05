// 画布重做回归：横向编排（阶段 = 列）+ 块状卡片 + 就地加阶段 + CSS 动效。
//
// 用户原话：「编排流水线不能是横向的嘛？节点不能是块状卡片类型的嘛？阶段是按列的，
// 并且一个列也是可以加新阶段的（并行）。没有动效啥也没有。」
//
// 本用例不启浏览器：把 src/client/canvas.js 放进带桩的迷你模块表里执行，
// 用「桩 h」收集元素树，用「迷你 hooks 运行时」驱动 useState，
// 从而能在 Node 里点按钮、断言 onChange 收到的完整新对象。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { pluginPath } from './helpers/modules.mjs';

const canvasPath = pluginPath('src', 'client', 'canvas.js');
const stylesPath = pluginPath('src', 'client', 'styles.js');
const hasCanvas = existsSync(canvasPath);

/* ------------------------------------------------------------------ *
 * 桩 h + 迷你 hooks 运行时
 * ------------------------------------------------------------------ */

/**
 * 迷你 hooks 运行时：按调用顺序分配槽位，setState 标记待重渲染，
 * 由 render() 循环重渲染直到稳定。effect 一律不执行（用例里没有 DOM）。
 */
function createRuntime() {
  const slots = [];
  let cursor = 0;
  let pending = false;

  const api = {
    useState(init) {
      const i = cursor;
      cursor += 1;
      if (!(i in slots)) slots[i] = typeof init === 'function' ? init() : init;
      const set = (next) => {
        slots[i] = typeof next === 'function' ? next(slots[i]) : next;
        pending = true;
      };
      return [slots[i], set];
    },
    useRef(init) {
      const i = cursor;
      cursor += 1;
      if (!(i in slots)) slots[i] = { current: init === undefined ? null : init };
      return slots[i];
    },
    useMemo(fn) {
      cursor += 1;
      return fn();
    },
    useEffect() {
      cursor += 1;
    },
    useCallback(fn) {
      cursor += 1;
      return fn;
    },
  };

  function render(Comp, props) {
    let tree;
    for (let i = 0; i < 30; i += 1) {
      pending = false;
      cursor = 0;
      tree = Comp(props);
      if (!pending) break;
    }
    return tree;
  }

  return { api, render };
}

function makeH() {
  return (type, props, ...children) => ({ type, props: props || {}, children });
}

/** 载入 canvas.js；每次调用返回独立的模块实例与 hooks 运行时。 */
function loadCanvas() {
  const source = readFileSync(canvasPath, 'utf8');
  const runtime = createRuntime();
  const h = makeH();
  const module = { exports: {} };
  const stubs = {
    './h.js': Object.assign({ h }, runtime.api),
    './ui.js': {
      Icon: (p) => h('span', { className: 'dsh-devops-stub-icon', 'data-icon': p.name }, p.name),
      Chip: (p) => h('span', { className: 'dsh-devops-chip' }, p.children),
    },
  };
  const requireStub = (id) => {
    if (!(id in stubs)) throw new Error('用例未覆盖的 canvas.js 依赖：' + id);
    return stubs[id];
  };
  new Function('module', 'exports', 'require', source)(module, module.exports, requireStub);
  return { mod: module.exports, h, runtime };
}

/* ------------------------------------------------------------------ *
 * 元素树工具
 * ------------------------------------------------------------------ */

/** 把元素树展开：函数组件就地调用（各自独立 hooks 运行时），数组拍平。 */
function expand(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return null;
  if (typeof node === 'string' || typeof node === 'number') return node;
  if (Array.isArray(node)) {
    const out = [];
    for (const child of node) {
      const e = expand(child);
      if (e === null) continue;
      if (Array.isArray(e)) out.push(...e);
      else out.push(e);
    }
    return out;
  }
  if (typeof node.type === 'function') {
    const rt = createRuntime();
    return expand(rt.render(node.type, Object.assign({}, node.props, { children: node.children })));
  }
  const kids = [];
  for (const child of node.children || []) {
    const e = expand(child);
    if (e === null) continue;
    if (Array.isArray(e)) kids.push(...e);
    else kids.push(e);
  }
  return { type: node.type, props: node.props || {}, children: kids };
}

function walk(node, visit) {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) {
    for (const n of node) walk(n, visit);
    return;
  }
  if (typeof node !== 'object') return;
  visit(node);
  for (const child of node.children || []) walk(child, visit);
}

function findAll(tree, pred) {
  const out = [];
  walk(tree, (n) => {
    if (n.type && pred(n)) out.push(n);
  });
  return out;
}

const classesOf = (node) => String((node.props && node.props.className) || '');
const hasClass = (node, cls) => classesOf(node).split(/\s+/).includes(cls);
const byRole = (tree, role) => findAll(tree, (n) => n.props && n.props['data-role'] === role);
const textOf = (node) => {
  let out = '';
  walk(node, (n) => {
    for (const child of n.children || []) if (typeof child === 'string') out += child;
  });
  return out;
};

/* ------------------------------------------------------------------ *
 * 测试数据
 * ------------------------------------------------------------------ */

function job(id, patch) {
  return Object.assign(
    {
      id,
      name: id,
      node: 'shell.exec',
      server: '',
      needs: [],
      retry: { max: 0, delayMs: 1000 },
      timeoutMs: 600000,
      allowFailure: false,
      when: 'on_success',
      allowProvision: false,
      env: [],
      envSetRefs: [],
      with: {},
      artifacts: [],
      cache: { key: '', paths: [] },
    },
    patch || {},
  );
}

/** 无 needs 的普通流水线：两个阶段，第二个阶段并行。 */
function plainPipeline() {
  return {
    id: 'build-deploy',
    name: '构建并部署',
    description: '',
    category: 'build',
    tags: [],
    favorite: false,
    owner: null,
    version: 1,
    variables: [],
    envSetRefs: [],
    defaults: { server: 'local', timeoutMs: 600000 },
    stages: [
      { id: 'build', name: '构建', parallel: false, jobs: [job('compile', { name: '编译' }), job('test', { name: '测试', when: 'always' })] },
      { id: 'deploy', name: '部署', parallel: true, jobs: [job('ship', { name: '发布', node: 'artifact.upload', when: 'manual' })] },
    ],
    createdAt: 0,
    updatedAt: 0,
  };
}

/** 声明了 needs 的流水线：此时不得再开启阶段并行（契约 §2.1 禁止混用）。 */
function needsPipeline() {
  const p = plainPipeline();
  p.stages[1].parallel = false;
  p.stages[0].jobs[1].needs = ['compile'];
  return p;
}

const click = (node) => node.props.onClick({ stopPropagation() {} });

/* ------------------------------------------------------------------ *
 * 用例
 * ------------------------------------------------------------------ */

const suiteOpts = hasCanvas ? {} : { skip: '缺少 src/client/canvas.js' };

describe('画布横向编排（阶段 = 列，列内节点成块状卡片）', suiteOpts, () => {
  const { mod } = hasCanvas ? loadCanvas() : { mod: null };
  const renderCanvas = (pipeline, extra) => {
    const { mod: m, runtime } = loadCanvas();
    const props = Object.assign(
      { pipeline, onChange() {}, selectedJob: null, onSelectJob() {} },
      extra || {},
    );
    return { tree: expand(runtime.render(m.Canvas, props)), runtime, mod: m, props };
  };

  test('画布根节点是横向 board 容器，阶段渲染为列', () => {
    const { tree } = renderCanvas(plainPipeline());
    const board = byRole(tree, 'board');
    assert.equal(board.length, 1, '应有一个 data-role="board" 的横向容器');
    assert.ok(hasClass(board[0], 'dsh-devops-board'), 'board 应带 .dsh-devops-board');

    const columns = byRole(tree, 'stage-column');
    assert.equal(columns.length, 2, '两个阶段应渲染成两列');
    assert.deepEqual(
      columns.map((c) => c.props['data-stage-id']),
      ['build', 'deploy'],
      '列顺序应与 stages 顺序一致（自左向右）',
    );
    for (const c of columns) assert.ok(hasClass(c, 'dsh-devops-column'), '每列应带 .dsh-devops-column');
  });

  test('每列内部是自上而下的卡片容器，且卡片都在对应列里', () => {
    const { tree } = renderCanvas(plainPipeline());
    const columns = byRole(tree, 'stage-column');
    const cardsIn = (col) => findAll(col, (n) => n.props && n.props['data-role'] === 'node-card');

    assert.equal(cardsIn(columns[0]).length, 2, '第一列应有两张卡片');
    assert.equal(cardsIn(columns[1]).length, 1, '第二列应有一张卡片');

    for (const col of columns) {
      const cardHolders = findAll(col, (n) => n.props && n.props['data-role'] === 'stage-cards');
      assert.equal(cardHolders.length, 1, '每列应有一个节点容器');
      assert.ok(hasClass(cardHolders[0], 'dsh-devops-column-cards'));
      // 卡片必须真的落在该列的节点容器内（同一元素引用）
      const inside = new Set(findAll(cardHolders[0], (n) => n.props && n.props['data-role'] === 'node-card'));
      for (const card of cardsIn(col)) {
        assert.ok(inside.has(card), '卡片 ' + card.props['data-role'] + ' 不在所属列的节点容器内');
      }
      assert.equal(inside.size, cardsIn(col).length, '节点容器内的卡片数量应与该列节点数一致');
    }
  });

  test('节点是块状卡片：卡片容器 + 标题/类型/元信息结构', () => {
    const { tree } = renderCanvas(plainPipeline());
    const cards = byRole(tree, 'node-card');
    assert.equal(cards.length, 3, '三张卡片');
    for (const card of cards) {
      assert.ok(hasClass(card, 'dsh-devops-nodecard'), '卡片应带 .dsh-devops-nodecard');
      const inner = findAll(card, (n) => n.type);
      const hasCls = (cls) => inner.some((n) => hasClass(n, cls));
      assert.ok(hasCls('dsh-devops-nodecard-head'), '卡片应有 head 区块');
      assert.ok(hasCls('dsh-devops-nodecard-title'), '卡片应有标题');
      assert.ok(hasCls('dsh-devops-nodecard-type'), '卡片应有节点类型');
      assert.ok(hasCls('dsh-devops-nodecard-meta'), '卡片应有元信息网格');
      assert.ok(card.props.draggable === true, '卡片应可拖拽');
    }
    // 关键元信息：执行条件 / 服务器
    const first = cards[0];
    const text = textOf(first);
    assert.match(text, /执行条件/, '卡片应显示执行条件');
    assert.match(text, /服务器/, '卡片应显示服务器');
    assert.match(text, /shell\.exec/, '卡片应显示节点类型');
  });

  test('★ 每个阶段列都有就地加阶段入口，列间还有 gap 入口', () => {
    const { tree } = renderCanvas(plainPipeline());
    const adders = byRole(tree, 'add-stage');
    assert.ok(adders.length >= 1, '应存在「加阶段」入口');

    const columns = byRole(tree, 'stage-column');
    for (const col of columns) {
      const own = byRole(col, 'add-stage').filter((a) => a.props['data-kind'] === 'head');
      assert.ok(own.length >= 1, '每一列都应能在自己的列头插入新阶段');
    }

    const gap = adders.filter((a) => a.props['data-kind'] === 'gap');
    assert.equal(gap.length, 1, '两列之间应有一个列间插入入口');
    assert.equal(gap[0].props['data-index'], '1', '列间入口应插到下标 1');

    const end = adders.filter((a) => a.props['data-kind'] === 'end');
    assert.equal(end.length, 1, '画布末尾应有一个追加阶段入口');
    assert.equal(end[0].props['data-index'], '2', '末尾入口应插到下标 2（= stages.length）');
  });

  test('★ 点「加阶段」通过 onChange 提交完整新对象（不原地改 props）', () => {
    const pipeline = plainPipeline();
    const seen = [];
    const { mod: m, runtime } = loadCanvas();
    const props = { pipeline, onChange: (next) => seen.push(next), selectedJob: null, onSelectJob() {} };
    let tree = expand(runtime.render(m.Canvas, props));

    const endBtn = byRole(tree, 'add-stage').find((a) => a.props['data-kind'] === 'end');
    click(endBtn);

    assert.equal(seen.length, 1, 'onChange 应被调用一次');
    const next = seen[0];
    assert.equal(next.stages.length, 3, '应新增一个阶段');
    assert.notEqual(next, pipeline, '必须提交新对象，不能原地改 props');
    assert.notEqual(next.stages, pipeline.stages, 'stages 也应是新数组');
    assert.equal(pipeline.stages.length, 2, '原 pipeline 不得被修改');
    assert.equal(next.id, 'build-deploy', '完整对象应保留其它顶层字段');
    assert.equal(next.name, '构建并部署');
    assert.equal(next.defaults.server, 'local');

    const added = next.stages[2];
    assert.equal(added.parallel, false, '新阶段默认 parallel:false');
    assert.deepEqual(added.jobs, [], '新阶段没有节点');
  });

  test('★ 列间插入：新阶段落在指定下标（就地插入而非追加）', () => {
    const pipeline = plainPipeline();
    let captured = null;
    const { mod: m, runtime } = loadCanvas();
    const props = { pipeline, onChange: (n) => (captured = n), selectedJob: null, onSelectJob() {} };
    const tree = expand(runtime.render(m.Canvas, props));
    const gap = byRole(tree, 'add-stage').find((a) => a.props['data-kind'] === 'gap');
    click(gap);

    assert.ok(captured, 'onChange 应被调用');
    assert.equal(captured.stages.length, 3);
    assert.deepEqual(captured.stages.map((s) => s.id), ['build', captured.stages[1].id, 'deploy'], '新阶段应插在 build 与 deploy 之间');
    assert.equal(captured.stages[1].parallel, false);
    assert.equal(captured.stages[0].id, 'build', '原阶段顺序保持');
  });

  test('阶段头「并行」开关：无 needs 时切换并提交 parallel:true', () => {
    const pipeline = plainPipeline();
    let captured = null;
    const { mod: m, runtime } = loadCanvas();
    const props = { pipeline, onChange: (n) => (captured = n), selectedJob: null, onSelectJob() {} };
    const tree = expand(runtime.render(m.Canvas, props));
    const toggle = byRole(tree, 'parallel-toggle')[0];
    click(toggle);

    assert.ok(captured, '无 needs 时应允许开启并行');
    assert.equal(captured.stages[0].parallel, true, '第一列 parallel 应变为 true');
    assert.equal(pipeline.stages[0].parallel, false, '原对象保持 false');
  });

  test('★ needs 与阶段并行不得混用：冲突时阻止提交并给出可见提示', () => {
    const pipeline = needsPipeline();
    const seen = [];
    const { mod: m, runtime } = loadCanvas();
    const props = { pipeline, onChange: (n) => seen.push(n), selectedJob: null, onSelectJob() {} };
    let tree = expand(runtime.render(m.Canvas, props));

    const toggle = byRole(tree, 'parallel-toggle')[0];
    click(toggle);

    assert.equal(seen.length, 0, '已有 needs（DAG）时不得提交 parallel 变更（契约 §2.1 禁止混用）');

    tree = expand(runtime.render(m.Canvas, props));
    const notice = byRole(tree, 'canvas-notice');
    assert.equal(notice.length, 1, '应出现可见提示（不能静默失败）');
    assert.match(textOf(notice[0]), /needs/, '提示应说明原因与 needs 有关');
    assert.equal(notice[0].props['data-tone'], 'warn');
  });

  test('阶段操作保留：删除阶段、左右移动阶段都通过 onChange 提交', () => {
    const pipeline = plainPipeline();
    const seen = [];
    const { mod: m, runtime } = loadCanvas();
    const props = { pipeline, onChange: (n) => seen.push(n), selectedJob: null, onSelectJob() {} };
    let tree = expand(runtime.render(m.Canvas, props));

    click(byRole(tree, 'stage-remove')[0]);
    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0].stages.map((s) => s.id), ['deploy'], '应删除第一列');

    seen.length = 0;
    tree = expand(runtime.render(m.Canvas, props));
    const right = byRole(tree, 'stage-move-next')[0];
    click(right);
    assert.equal(seen.length, 1, '右移阶段应提交');
    assert.deepEqual(seen[0].stages.map((s) => s.id), ['deploy', 'build'], '第一列应右移一位');

    // 边界列的左移按钮应禁用
    tree = expand(runtime.render(m.Canvas, props));
    const prev = byRole(tree, 'stage-move-prev')[0];
    assert.equal(prev.props.disabled, true, '第一列的左移按钮应禁用');
  });

  test('空流水线不报错，并给出空态与加阶段入口', () => {
    const empty = { id: 'p', name: '空', stages: [] };
    const { mod: m, runtime } = loadCanvas();
    const tree = expand(runtime.render(m.Canvas, { pipeline: empty, onChange() {}, onSelectJob() {} }));
    assert.equal(byRole(tree, 'stage-column').length, 0);
    assert.equal(byRole(tree, 'canvas-empty').length, 1, '应有空态提示');
    assert.ok(byRole(tree, 'add-stage').length >= 1, '空态下也要能加阶段');
    assert.equal(byRole(tree, 'board').length, 1, '空态下 board 仍存在');
  });

  test('画布已不再使用纵向泳道类名（防止旧布局回归）', () => {
    const styles = readFileSync(stylesPath, 'utf8');
    assert.doesNotMatch(styles, /\.dsh-devops-lane/, 'styles.js 不应再有 .dsh-devops-lane');
    const { tree } = renderCanvas(plainPipeline());
    walk(tree, (n) => {
      assert.ok(!classesOf(n).includes('dsh-devops-lane'), '元素不应再用 dsh-devops-lane 类');
    });
  });

  test('★ NodeCard 支持只读复用：声明式标志 + 只读时不可拖拽', () => {
    // 详情页等消费方靠这个标志决定「复用 NodeCard」还是「退回本地同构卡片」
    assert.equal(mod.NodeCard.supportsReadonly, true, 'NodeCard.supportsReadonly 必须为 true');

    const { mod: m, runtime } = loadCanvas();
    const readOnlyTree = expand(
      runtime.render(m.NodeCard, {
        job: job('compile', { name: '编译' }),
        stageId: 'build',
        index: 1,
        readonly: true,
        selected: true,
        onSelect() {},
      }),
    );

    assert.ok(hasClass(readOnlyTree, 'dsh-devops-nodecard'), '只读卡片类名必须与编辑器一致');
    assert.equal(readOnlyTree.props['data-role'], 'node-card', 'data-role 必须一致');
    assert.equal(readOnlyTree.props.draggable, false, '只读卡片不得可拖拽');
    assert.equal(readOnlyTree.props.onDragStart, undefined, '只读卡片不得挂 onDragStart');
    assert.equal(readOnlyTree.props.onDragEnd, undefined, '只读卡片不得挂 onDragEnd');
    assert.equal(readOnlyTree.props['data-readonly'], 'true');
    assert.doesNotMatch(String(readOnlyTree.props.title), /拖拽/, '只读卡片 title 不得提示拖拽');

    // 只读仍可点选（详情页要能点节点看信息）
    let picked = null;
    const { mod: m2, runtime: rt2 } = loadCanvas();
    const t2 = expand(
      rt2.render(m2.NodeCard, { job: job('compile'), stageId: 'build', readonly: true, onSelect: (id) => (picked = id) }),
    );
    t2.props.onClick({ stopPropagation() {} });
    assert.equal(picked, 'compile', '只读卡片点击应回调 onSelect');

    // 只读卡片结构/字段与编辑器完全同构
    const inner = findAll(readOnlyTree, (n) => n.type);
    const hasCls = (cls) => inner.some((n) => hasClass(n, cls));
    for (const cls of [
      'dsh-devops-nodecard-head',
      'dsh-devops-nodecard-index',
      'dsh-devops-nodecard-title',
      'dsh-devops-nodecard-type',
      'dsh-devops-nodecard-meta',
    ]) {
      assert.ok(hasCls(cls), '只读卡片缺少 ' + cls);
    }
    assert.match(textOf(readOnlyTree), /执行条件/, '只读卡片应保留关键元信息');
    assert.match(textOf(readOnlyTree), /服务器/);
    assert.match(textOf(readOnlyTree), /shell\.exec/);
  });

  test('★ 编辑器渲染不受只读分支影响（不传 readonly 时行为与之前一致）', () => {
    const { mod: m, runtime } = loadCanvas();
    const editorTree = expand(
      runtime.render(m.NodeCard, { job: job('compile', { name: '编译' }), stageId: 'build', index: 1, selected: false }),
    );
    assert.equal(editorTree.props.draggable, true, '编辑器卡片仍应可拖拽');
    assert.equal(typeof editorTree.props.onDragStart, 'function');
    assert.equal(typeof editorTree.props.onDragEnd, 'function');
    assert.equal(editorTree.props['data-readonly'], undefined, '编辑器卡片不该带 data-readonly');
    assert.match(String(editorTree.props.title), /拖拽/, '编辑器卡片仍保留拖拽提示');

    // 画布里渲染出来的卡片同样必须是可拖拽的，且没有一张是只读态
    const { tree } = renderCanvas(plainPipeline());
    const cards = byRole(tree, 'node-card');
    assert.equal(cards.length, 3);
    for (const card of cards) {
      assert.equal(card.props.draggable, true, '画布内卡片应可拖拽');
      assert.equal(typeof card.props.onDragStart, 'function');
      assert.equal(card.props['data-readonly'], undefined, '编辑器画布不应产生只读卡片');
    }
  });

  test('编辑器侧也拦住非法组合：已有并行阶段时不再允许新增 needs', () => {
    const editor = readFileSync(pluginPath('src', 'client', 'editor.js'), 'utf8');
    assert.match(editor, /parallelStage/, 'editor.js 应检查是否已有并行阶段');
    assert.match(editor, /patch\.needs\s*&&\s*patch\.needs\.length/, '应按 needs 变更做拦截');
    assert.match(editor, /toast\.warn/, '拦截时应给出可见提示而不是静默失败');
    // 画布的提示入口要真的接上（否则 warn 只会进本地 state，用户看不到 toast）
    assert.match(editor, /h\(Canvas, \{[\s\S]{0,220}?toast: props\.toast/, 'Canvas 应收到 toast');
  });

  test('needs 依赖边仍以 SVG 渲染，并使用画布内层 board 作为定位基准', () => {
    const { tree } = renderCanvas(needsPipeline());
    const edges = findAll(tree, (n) => hasClass(n, 'dsh-devops-edges'));
    assert.equal(edges.length, 1, '应渲染依赖边 SVG 层');
    assert.ok(findAll(edges[0], (n) => n.type === 'marker').length === 1, '应定义箭头 marker');
  });
});

describe('依赖边几何：按列布局计算起止点（纯函数）', suiteOpts, () => {
  const { mod } = hasCanvas ? loadCanvas() : { mod: null };

  test('下游在右侧 → forward：出右边缘、入左边缘', () => {
    const a = { left: 0, top: 0, width: 200, height: 60 };
    const b = { left: 300, top: 120, width: 200, height: 60 };
    const out = mod.buildEdgePath(a, b);
    assert.equal(out.kind, 'forward');
    assert.ok(out.d.startsWith('M200,30'), '起点应是上游卡片右边缘中点，实际 ' + out.d);
    assert.ok(out.d.endsWith('300,150'), '终点应是下游卡片左边缘中点，实际 ' + out.d);
  });

  test('上下游同列 → vertical：出下边缘、入上边缘（不再假设左右相邻）', () => {
    const a = { left: 20, top: 0, width: 200, height: 60 };
    const b = { left: 20, top: 120, width: 200, height: 60 };
    const out = mod.buildEdgePath(a, b);
    assert.equal(out.kind, 'vertical');
    assert.ok(out.d.startsWith('M120,60'), '起点应是上游卡片下边缘，实际 ' + out.d);
    assert.ok(out.d.endsWith('120,120'), '终点应是下游卡片上边缘，实际 ' + out.d);
  });

  test('下游在左侧（跨列回指）→ backward：从卡片下方绕行', () => {
    const a = { left: 300, top: 0, width: 200, height: 60 };
    const b = { left: 0, top: 0, width: 200, height: 60 };
    const out = mod.buildEdgePath(a, b);
    assert.equal(out.kind, 'backward');
    assert.ok(out.d.startsWith('M400,60'), '起点应是上游卡片下边缘，实际 ' + out.d);
    assert.ok(out.d.includes('82'), '控制点应低于卡片（绕行），实际 ' + out.d);
  });

  test('pipelineHasNeeds 判定与契约一致', () => {
    assert.equal(mod.pipelineHasNeeds(plainPipeline()), false);
    assert.equal(mod.pipelineHasNeeds(needsPipeline()), true);
    assert.equal(mod.pipelineHasNeeds({ stages: [] }), false);
    assert.equal(mod.pipelineHasNeeds(null), false);
  });
});

describe('画布样式：列布局 + 动效 keyframes + reduced-motion', suiteOpts, () => {
  const css = hasCanvas ? readFileSync(stylesPath, 'utf8') : '';

  /** 取某条规则体（第一个匹配的选择器）。 */
  function ruleBody(selector) {
    const idx = css.indexOf(selector);
    if (idx < 0) return '';
    const open = css.indexOf('{', idx);
    const close = css.indexOf('}', open);
    return css.slice(open + 1, close);
  }

  test('★ board 是横向 flex 容器，列是纵向 flex 堆叠', () => {
    const board = ruleBody('.dsh-devops-board{');
    assert.match(board, /display:flex/, '.dsh-devops-board 应是 flex');
    assert.match(board, /flex-direction:row/, '阶段应横向排列（一列一个阶段）');

    const column = ruleBody('.dsh-devops-column{');
    assert.match(column, /flex-direction:column/, '列内节点应纵向堆叠');
    assert.match(column, /width:/, '列应有固定宽度，避免互相挤压');

    const cards = ruleBody('.dsh-devops-column-cards{');
    assert.match(cards, /flex-direction:column/, '.dsh-devops-column-cards 应纵向排列卡片');

    const canvas = ruleBody('.dsh-devops-canvas{');
    assert.match(canvas, /overflow:auto/, '画布应可滚动（阶段多时横向滚动）');

    // board 高度是 auto，边层必须用 inset:0 撑满（百分比高度此时不可靠）
    const edges = ruleBody('.dsh-devops-edges{');
    assert.match(edges, /inset:0/, '.dsh-devops-edges 应用 inset:0 撑满 board');
    assert.match(edges, /position:absolute/, '边层应相对 board 绝对定位');
  });

  test('★ 动效只用 CSS transition/animation，且定义了 keyframes', () => {
    assert.match(css, /transition:/, '应有 CSS transition');
    assert.match(css, /@keyframes dsh-devops-rise/, '应有列出现动画 keyframes');
    assert.match(css, /@keyframes dsh-devops-card-in/, '应有卡片出现动画 keyframes');
    assert.match(css, /@keyframes dsh-devops-drop-pulse/, '应有投放高亮 keyframes');
    assert.match(ruleBody('.dsh-devops-nodecard{'), /animation:/, '卡片应带出现动画');
    assert.match(css, /\.dsh-devops-nodecard:hover/, '应有卡片 hover 过渡');
    assert.match(css, /\.dsh-devops-slot\[data-drop-before="true"\]::before/, '应有拖拽投放位置高亮');
    assert.match(css, /dsh-devops-column\[data-drop="true"\]/, '应有拖拽到列上的高亮');
    // 零依赖：不得出现任何第三方动画库痕迹
    assert.doesNotMatch(css, /animate\.css|framer-motion|gsap|@?tailwind/i, '不得引入第三方动画/样式库');
  });

  test('★ 尊重 prefers-reduced-motion', () => {
    assert.match(css, /@media\s*\(prefers-reduced-motion:reduce\)/, '必须有 prefers-reduced-motion 媒体查询');
    const start = css.indexOf('@media (prefers-reduced-motion:reduce)');
    const block = css.slice(start, css.indexOf('\n}', start) + 2);
    assert.match(block, /animation:none/, 'reduce 下应关闭 animation');
    assert.match(block, /transition:none/, 'reduce 下应关闭 transition');
  });

  test('新增样式仍遵守 .dsh-devops- 前缀与 token 取色（不硬编码颜色）', () => {
    const start = css.indexOf('编排画布：横向列布局');
    assert.ok(start > 0, '应能找到新增的横向画布样式段');
    // 先剥掉注释，否则注释会跟着 at-rule 前奏一起进入选择器判定
    const segment = css.slice(start).replace(/\/\*[\s\S]*?\*\//g, '');
    // 该段内所有选择器都必须带 .dsh-devops- 前缀
    const preludes = [...segment.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim()).filter((p) => p && !p.startsWith('@'));
    for (const prelude of preludes) {
      for (const sel of prelude.split(',')) {
        const s = sel.trim();
        if (!s) continue;
        // keyframes 内部的关键帧选择器（from/to/百分比）不是元素选择器
        if (/^(from|to|\d+%)$/.test(s)) continue;
        assert.match(s, /dsh-devops-/, '新增选择器必须带 .dsh-devops- 前缀：' + s);
      }
    }
    // 颜色只能用 token；token 回退值不算
    const withoutFallback = segment.replace(/var\([^()]*\)/g, '');
    const hex = withoutFallback.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
    assert.deepEqual(hex, [], '新增样式不得硬编码颜色：' + JSON.stringify(hex.slice(0, 5)));
  });
});


/* ------------------------------------------------------------------ *
 * task-4：删除阶段必须二次确认 + 清理悬空 needs（修「删了就炸」）
 *
 * 用户原话：「编辑流水线时删除整个阶段没有确认，删除之后就炸了。」
 * 缺陷：1) removeStage 没有 confirm（全工程唯一）；
 *       2) 只 filter 阶段、不清理 needs，留下悬空依赖 → validatePipeline 报
 *          missing-field、运行时抛「job j2 依赖了不存在的 job：j1」。
 * ------------------------------------------------------------------ */

import { pathToFileURL } from 'node:url';

const schemaUrl = pathToFileURL(pluginPath('src', 'model', 'schema.js')).href;

/** 载入真实校验函数（不是桩）：用来证明删除后确实通过校验。 */
async function loadValidator() {
  const mod = await import(schemaUrl);
  return mod.validatePipeline;
}

/**
 * 删除阶段用例专用流水线：跨阶段依赖在「配置层」是合法的（validatePipeline 通过），
 * 于是可以证明「删除前合法 → 删除后仍合法（悬空 needs 被清掉）」。
 * 两阶段都必须 parallel:false —— needs 与 parallel 混用会被契约拒绝。
 */
function crossStagePipeline() {
  return {
    id: 'build-deploy',
    name: '构建并部署',
    description: '',
    category: 'build',
    tags: [],
    favorite: false,
    owner: null,
    version: 1,
    variables: [],
    envSetRefs: [],
    defaults: { server: 'local', timeoutMs: 600000 },
    stages: [
      { id: 'build', name: '构建', parallel: false, jobs: [job('j1', { name: '编译' })] },
      { id: 'deploy', name: '部署', parallel: false, jobs: [job('j2', { name: '发布', needs: ['j1'] })] },
    ],
    createdAt: 0,
    updatedAt: 0,
  };
}

/** 收集所有 job 的 needs，用于断言「已无任何节点引用被删 id」。 */
function allNeeds(pipeline) {
  const out = [];
  for (const stage of (pipeline && pipeline.stages) || []) {
    for (const j of stage.jobs || []) for (const n of j.needs || []) out.push(n);
  }
  return out;
}

/** 渲染画布并收集 onChange 提交。 */
function renderDeletable(pipeline, extra) {
  const { mod: m, runtime } = loadCanvas();
  const seen = [];
  const props = Object.assign(
    { pipeline, onChange: (n) => seen.push(n), selectedJob: null, onSelectJob() {} },
    extra || {},
  );
  const tree = expand(runtime.render(m.Canvas, props));
  return { tree, seen, props, mod: m, runtime };
}

describe('task-4 删除阶段：二次确认 + 清理悬空 needs', suiteOpts, () => {
  /** 临时替换 globalThis.confirm，用例结束后还原。 */
  function withConfirm(impl, fn) {
    const original = globalThis.confirm;
    globalThis.confirm = impl;
    try {
      return fn();
    } finally {
      if (original === undefined) delete globalThis.confirm;
      else globalThis.confirm = original;
    }
  }

  test('★ 删除阶段必须二次确认：取消时不提交任何变更', () => {
    const messages = [];
    withConfirm(
      (msg) => {
        messages.push(msg);
        return false;
      },
      () => {
        // 用带跨阶段依赖的夹具：这样确认文案里的「清理 needs」分支真的有内容可说
        const pipeline = crossStagePipeline();
        const expectedNodes = pipeline.stages[0].jobs.length;
        const { tree, seen } = renderDeletable(pipeline);
        click(byRole(tree, 'stage-remove')[0]);

        assert.equal(messages.length, 1, '删除阶段必须先弹确认框（全工程其它删除都有）');
        assert.equal(seen.length, 0, '用户取消后不得提交任何变更');
        assert.equal(pipeline.stages.length, 2, '原 pipeline 不得被改动');

        const msg = messages[0];
        assert.match(msg, /构建/, '确认文案应点名被删阶段');
        assert.match(msg, new RegExp(expectedNodes + ' 个节点'), '确认文案应说明该阶段内有多少节点会被一并删除');
        assert.match(msg, /needs/, '确认文案应说明会自动清理相关 needs');
      },
    );
  });

  test('★ 确认后才提交，且是完整新对象（不原地改 props）', () => {
    withConfirm(() => true, () => {
      const pipeline = plainPipeline();
      const { tree, seen } = renderDeletable(pipeline);
      click(byRole(tree, 'stage-remove')[0]);

      assert.equal(seen.length, 1, '确认后应提交一次');
      assert.notEqual(seen[0], pipeline, '必须是新对象');
      assert.deepEqual(seen[0].stages.map((s) => s.id), ['deploy'], '应删除第一列');
      assert.equal(seen[0].id, 'build-deploy', '完整对象应保留其它顶层字段');
      assert.equal(pipeline.stages.length, 2, '原对象不得被改动');
    });
  });

  test('只有确认框明确返回 false 才算取消（无 confirm 环境仍可提交）', () => {
    // 守住一个真实的坑：写成 if (!confirm(...)) return 会把「本环境没有确认框」
    // 误判成「用户取消了」，画布就再也删不掉阶段。
    assert.equal(typeof globalThis.confirm, 'undefined', 'Node 环境默认没有 confirm');
    const { tree, seen } = renderDeletable(plainPipeline());
    click(byRole(tree, 'stage-remove')[0]);
    assert.equal(seen.length, 1, '无确认框环境应视为已确认并提交');
  });

  test('★★ 确认后悬空 needs 被清干净，且删除后的流水线通过真实 validatePipeline', async () => {
    const validatePipeline = await loadValidator();
    const pipeline = crossStagePipeline();

    // 前置条件：删除前这条流水线在配置层合法（needs 与 parallel 未混用）
    const before = validatePipeline(pipeline);
    assert.equal(before.ok, true, '前置条件不成立，夹具本身应可通过校验：' + JSON.stringify(before.errors));
    assert.deepEqual(pipeline.stages[1].jobs[0].needs, ['j1'], '夹具应有跨阶段依赖 j2 -> j1');

    let next = null;
    withConfirm(() => true, () => {
      const { tree } = renderDeletable(pipeline, {
        onChange: (n) => {
          next = n;
        },
      });
      click(byRole(tree, 'stage-remove')[0]);
    });

    assert.ok(next, '应提交删除后的新对象');
    assert.deepEqual(next.stages.map((s) => s.id), ['deploy'], '只应剩 deploy 阶段');
    assert.deepEqual(next.stages[0].jobs[0].needs, [], 'j2 指向被删节点 j1 的 needs 必须被清掉');
    assert.deepEqual(allNeeds(next), [], '不得有任何节点再引用已删除的 job');

    const after = validatePipeline(next);
    assert.equal(after.ok, true, '删除阶段后必须仍能通过校验，实际错误：' + JSON.stringify(after.errors));
  });

  test('★ 对照组：只 filter 阶段（旧实现）确实会留下悬空 needs —— 用例不是空壳', async () => {
    const validatePipeline = await loadValidator();
    const pipeline = crossStagePipeline();
    // 旧 removeStage 的行为：只把阶段 filter 掉，完全不动 needs
    const naive = Object.assign({}, pipeline, {
      stages: pipeline.stages.filter((s) => s.id !== 'build'),
    });

    const result = validatePipeline(naive);
    assert.equal(result.ok, false, '旧实现必须被判为非法，否则这组用例证明不了缺陷');
    const err = (result.errors || []).find((e) => e.code === 'missing-field');
    assert.ok(err, '应报 missing-field（悬空依赖）');
    assert.match(err.path, /needs\[0\]$/, '错误应指向 needs 下标，实际：' + err.path);
  });

  test('★ 删除阶段后，检查器不残留在已不存在的节点上', () => {
    withConfirm(() => true, () => {
      // 选中的节点在被删阶段里 → 必须清空选择
      const selectCalls = [];
      const { tree } = renderDeletable(plainPipeline(), {
        selectedJob: 'compile',
        onSelectJob: (id) => selectCalls.push(id),
      });
      click(byRole(tree, 'stage-remove')[0]);
      assert.deepEqual(selectCalls, [null], '选中的节点已被删除，应把选择清空（避免右栏显示幽灵节点）');

      // 选中的节点在幸存阶段里 → 不得清空选择
      const selectCalls2 = [];
      const r2 = renderDeletable(plainPipeline(), {
        selectedJob: 'ship',
        onSelectJob: (id) => selectCalls2.push(id),
      });
      click(byRole(r2.tree, 'stage-remove')[0]);
      assert.deepEqual(selectCalls2, [], '幸存的节点不得被顺手取消选中');
    });
  });

  test('★ 0 节点/0 阶段：给出「运行会被拒绝」的可见提示（不再等到运行时才发现）', () => {
    // 画布空态要说清后果
    const { tree } = renderDeletable({ id: 'p', name: '空', stages: [] });
    const empty = byRole(tree, 'canvas-empty');
    assert.equal(empty.length, 1, '空流水线应有空态');
    const text = textOf(empty[0]);
    assert.match(text, /没有任何 job/, '空态应说明运行会被引擎拒绝');
    assert.match(text, /运行/, '空态应把后果与「运行」挂钩');

    // 有阶段但 0 节点时，列内要有可见提示
    const zeroJobs = { id: 'p', name: '空', stages: [{ id: 's1', name: '构建', parallel: false, jobs: [] }] };
    const r2 = renderDeletable(zeroJobs);
    assert.equal(
      findAll(r2.tree, (n) => hasClass(n, 'dsh-devops-column-empty')).length,
      1,
      '0 节点的列应有可见提示',
    );

    // 编辑器顶部要有一条 warn Banner：保存/校验会过，但运行会被拒
    const editor = readFileSync(pluginPath('src', 'client', 'editor.js'), 'utf8');
    assert.match(editor, /countJobs\(pipeline\)\s*===\s*0/, '编辑器应按节点数量判断空态');
    assert.match(editor, /没有任何 job/, '编辑器必须提前说明「运行会被拒绝」');
  });

  test('清理逻辑只清指向被删 id 的 needs，不误伤其它依赖（纯函数）', () => {
    const { mod: m } = loadCanvas();
    const p = crossStagePipeline();
    p.stages[0].jobs[0].needs = ['j2']; // 反向依赖，模拟两个节点互相引用
    const cleaned = m.cleanRemovedNeeds(p, ['j1']);

    assert.equal(cleaned, 1, '应恰好清掉 1 条指向 j1 的 needs');
    assert.deepEqual(p.stages[1].jobs[0].needs, [], 'j2 对 j1 的依赖应被清掉');
    assert.deepEqual(p.stages[0].jobs[0].needs, ['j2'], 'j2 仍存在，这条 needs 不得被误清');
    assert.equal(m.cleanRemovedNeeds(p, []), 0, '没有删除项时不得改动');
  });
});

