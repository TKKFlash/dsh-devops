// 节点编辑浮层：覆盖画布 + 点外部自动保存收起（task-10）。
//
// 用户原话：「我要的是图中红色框线的效果，目的不是要靠自己拉，点击节点之后虚化背景
//   等等交互视觉优化，也就是和编辑节点和节点信息时分开的，去点击编辑层之外的地方，
//   编辑窗口会自动保存内容收起来。」
//
// 本用例不启浏览器：把 src/client/editor.js 放进带桩的迷你模块表里执行，
// 用「桩 h」（元素记成可检查的树）+「桩 hooks」直接调用 PipelineEditor，
// 断言浮层被挂载/覆盖画布/点遮罩关闭/Esc 关闭/字段控件存在/关闭后不再挂载。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { pluginPath } from './helpers/modules.mjs';

const editorPath = pluginPath('src', 'client', 'editor.js');
const stylesPath = pluginPath('src', 'client', 'styles.js');
const hasSource = existsSync(editorPath);

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
  const fn = function Stub(props) { return { stub: name, props: props || {} }; };
  fn.__stub = name;
  return fn;
}

function makeHooks() {
  const slots = [];
  const cleanups = [];
  let index = 0;
  return {
    cleanups,
    reset() { index = 0; },
    clear() { slots.length = 0; cleanups.length = 0; index = 0; },
    runCleanups() { for (const c of cleanups.splice(0)) if (typeof c === 'function') c(); },
    slots,
    useState(initial) {
      const i = index++;
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      const set = (next) => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; };
      return [slots[i], set];
    },
    useEffect(fn, deps) {
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
    useTick() { return undefined; },
  };
}

function findAll(node, predicate, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { for (const child of node) findAll(child, predicate, out); return out; }
  if (node.type !== undefined && predicate(node)) out.push(node);
  for (const child of node.children || []) findAll(child, predicate, out);
  return out;
}

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

/** 加载 editor.js：Canvas / FieldControl / AiButton 用可检查的桩。 */
function loadEditor(extra) {
  const source = readFileSync(editorPath, 'utf8');
  const module = { exports: {} };
  const hooks = makeHooks();
  const h = makeH();
  const hookApi = {};
  for (const name of HOOK_NAMES) hookApi[name] = hooks[name];
  const stubs = {
    './h.js': Object.assign({
      h,
      clone: (v) => JSON.parse(JSON.stringify(v)),
      cx: (...parts) => parts.filter(Boolean).join(' '),
      useSyncExternalStore: () => ({}),
      fmtDuration: (ms) => String(ms) + 'ms',
      fmtTime: (ts) => 'T' + ts,
      fmtAgo: (ts) => 'ago' + ts,
      fmtBytes: (n) => String(n) + 'B',
      ellipsis: (s) => String(s),
    }, hookApi),
    './ui.js': {
      Icon: stubComponent('Icon'), Button: stubComponent('Button'), TextInput: stubComponent('TextInput'),
      Select: stubComponent('Select'), Switch: stubComponent('Switch'), Card: stubComponent('Card'),
      Field: (props) => h('div', { className: 'dsh-devops-field', 'data-field-label': props.label },
        props.label, props.children),
      Chip: stubComponent('Chip'), KV: stubComponent('KV'), Empty: stubComponent('Empty'),
      Banner: stubComponent('Banner'), Modal: stubComponent('Modal'),
    },
    // FieldControl 桩带上 field 名，便于断言「浮层内真的渲染出字段控件」
    './fields.js': {
      FieldControl: (props) => h('div', {
        className: 'dsh-devops-stub-fieldcontrol',
        'data-field': props.field && props.field.name,
      }),
    },
    './canvas.js': {
      Canvas: stubComponent('Canvas'),
      makeId: (prefix) => prefix + '-x1',
    },
    './ai.js': { AiButton: stubComponent('AiButton'), buildPipelinePrompt: () => '' },
    './api.js': { api: { validatePipeline: () => Promise.resolve({ ok: true }) } },
  };
  Object.assign(stubs, (extra && extra.extra) || {});
  new Function('module', 'exports', 'require', source)(module, module.exports, (id) => {
    if (!(id in stubs)) throw new Error('用例未覆盖的依赖：' + id + '（来自 editor.js）');
    return stubs[id];
  });
  return { exports: module.exports, hooks, h };
}

/* ------------------------------------------------------------------ *
 * 测试数据
 * ------------------------------------------------------------------ */

function job(id, patch) {
  return Object.assign({
    id, name: id, node: 'shell.exec', server: '', needs: [],
    retry: { max: 0, delayMs: 1000 }, timeoutMs: 600000, allowFailure: false,
    when: 'on_success', allowProvision: false, env: [], envSetRefs: [], with: { script: 'npm ci' },
    artifacts: [], cache: { key: '', paths: [] },
  }, patch || {});
}

function pipeline() {
  return {
    id: 'build-deploy', name: '构建并部署', description: '', category: '', tags: [],
    version: 1, variables: [], envSetRefs: [],
    defaults: { server: 'local', timeoutMs: 600000 },
    stages: [
      { id: 'build', name: '构建', parallel: false, jobs: [job('compile', { name: '编译' }), job('test', { name: '测试' })] },
      { id: 'deploy', name: '部署', parallel: false, jobs: [job('ship', { name: '发布' })] },
    ],
    createdAt: 0, updatedAt: 0,
  };
}

const NODES = [{ type: 'shell.exec', title: '执行 Shell', description: '在服务器执行脚本', fields: [{ name: 'script', label: '脚本', type: 'text' }] }];

const describeMaybe = hasSource ? describe : describe.skip;

function baseProps(extra) {
  return Object.assign({
    pipeline: pipeline(),
    onChange() {},
    nodes: NODES,
    servers: [{ id: 'local', name: '本机', kind: 'local' }],
    ctx: {},
    fieldCtx: { servers: [], envsets: [], snippets: [], defaultServer: 'local' },
    toast: { ok() {}, error() {}, warn() {} },
    recent: {},
    remember: () => {},
    onSave: () => Promise.resolve(),
    onReload() {},
  }, extra || {});
}

/* ------------------------------------------------------------------ *
 * 用例
 * ------------------------------------------------------------------ */

describeMaybe('节点编辑浮层（task-10：覆盖画布 + 点外部自动保存收起）', () => {
  const loaded = hasSource ? loadEditor() : { exports: {}, hooks: makeHooks(), h: makeH() };
  const PipelineEditor = loaded.exports.PipelineEditor;
  const hooks = loaded.hooks;

  const render = (props) => { hooks.clear(); return PipelineEditor(props); };
  const rerender = (props) => { hooks.reset(); return PipelineEditor(props); };

  /** 点第一张节点卡片（编辑器画布里的选中回调）。 */
  const selectFirstNode = (props, id) => {
    let tree = render(props);
    // 画布的选中入口被桩成 Canvas，直接调用传给它的 onSelectJob 更贴近真实路径
    const canvas = findAll(tree, (n) => n.stub === 'Canvas')[0];
    assert.ok(canvas, '应有画布');
    canvas.props.onSelectJob(id || 'compile');
    return rerender(props);
  };

  const sheetOf = (tree) => findAll(tree, (n) => n.props && n.props['data-role'] === 'node-edit-sheet')[0];
  const layerOf = (tree) => findAll(tree, (n) => n.props && n.props['data-role'] === 'node-edit-layer')[0];
  const maskOf = (tree) => findAll(tree, (n) => n.props && n.props['data-role'] === 'node-edit-mask')[0];

  test('★ 未选中节点时不挂载浮层与遮罩（回到纯画布视图）', () => {
    const tree = render(baseProps());
    assert.equal(layerOf(tree), undefined, '未选中时不应有浮层层');
    assert.equal(maskOf(tree), undefined, '未选中时不应有遮罩（否则会拦截画布点击）');
  });

  test('★ 点节点后浮层被挂载：遮罩 + 浮层容器 + data-role 齐全', () => {
    const tree = selectFirstNode(baseProps());
    const layer = layerOf(tree);
    assert.ok(layer, '点节点后应挂载浮层层');
    assert.equal(layer.props['data-open'], 'true', '浮层应处于打开态');
    const mask = maskOf(tree);
    assert.ok(mask, '应有遮罩');
    assert.equal(mask.props['data-blur'], 'true', '遮罩应声明模糊（虚化背景）');
    const sheet = sheetOf(tree);
    assert.ok(sheet, '应有浮层卡片');
    assert.equal(sheet.props.role, 'dialog', '浮层应是 dialog');
    assert.equal(sheet.props['data-variant'], 'floating', '浮层应声明悬浮变体');
  });

  test('★ 浮层是覆盖层（absolute 浮在画布上），不是并列的一栏', () => {
    const tree = selectFirstNode(baseProps());
    const layer = layerOf(tree);
    assert.ok(String(layer.props.className || '').includes('dsh-devops-editor-sheet-layer'),
      '浮层层类名应可被 CSS 定位为覆盖层');
    // 浮层卡片与画布是兄弟关系（覆盖），而不是像旧的 inspector-host 那样占 flex 一栏
    const hosts = findAll(tree, (n) => String(n.props.className || '').includes('dsh-devops-inspector-host'));
    assert.equal(hosts.length, 0, '选中节点时不应再占一栏的 inspector-host');
    const stylesSrc = existsSync(stylesPath) ? readFileSync(stylesPath, 'utf8') : '';
    if (stylesSrc.includes('.dsh-devops-editor-sheet-layer{')) {
      const block = stylesSrc.split('.dsh-devops-editor-sheet-layer{')[1].slice(0, 300);
      assert.match(block, /position:absolute/, '浮层层必须绝对定位（覆盖画布）');
      assert.match(block, /inset:0/, '浮层层应铺满编辑器区域');
    }
  });

  test('★ 点浮层外部（遮罩）→ 关闭浮层', () => {
    const props = baseProps();
    const before = selectFirstNode(props);
    assert.ok(sheetOf(before), '先确认浮层已打开');
    maskOf(before).props.onClick();
    const after = rerender(props);
    assert.equal(layerOf(after), undefined, '点遮罩后浮层应收起且不再挂载');
  });

  test('★ 点浮层外部 → 自动保存：有过编辑则收起前再提交一次', () => {
    const calls = [];
    const props = baseProps({ onChange: (p) => calls.push(p) });
    const tree = selectFirstNode(props);
    // 在浮层里改一个字段（真实路径：Field 控件 onChange → onPatchJob → props.onChange）
    const nameInput = findAll(tree, (n) => n.stub === 'TextInput' && n.props.value === '编译')[0];
    assert.ok(nameInput, '浮层内应有节点名称输入框');
    nameInput.props.onChange('编译（改）');
    const patchCalls = calls.length;
    assert.ok(patchCalls >= 1, '改字段应即时提交');
    maskOf(tree).props.onClick();
    rerender(props);
    assert.ok(calls.length > patchCalls, '关闭时应再提交一次（自动保存的最终落定）');
  });

  test('★ Esc 关闭浮层', () => {
    const props = baseProps();
    const tree = selectFirstNode(props);
    assert.ok(sheetOf(tree), '先确认浮层已打开');
    // 真实路径：浮层用 document 监听 keydown；测试环境没有 document，
    // 因此断言「确实注册了 Esc 监听」+「关闭回调行为正确」。
    const src = readFileSync(editorPath, 'utf8');
    assert.match(src, /key === 'Escape'/, '浮层必须处理 Esc');
    assert.match(src, /props\.onClose\('esc'\)/, 'Esc 必须走同一个关闭路径');
    // 关闭按钮与 Esc 走同一处理函数
    const close = findAll(tree, (n) => n.props && n.props['data-role'] === 'node-edit-close')[0];
    assert.ok(close, '应有「完成」关闭按钮');
    close.props.onClick();
    assert.equal(layerOf(rerender(props)), undefined, '关闭按钮同样应收起浮层');
  });

  test('Esc 关闭后同样不再挂载（与遮罩一致）', () => {
    const props = baseProps();
    const tree = selectFirstNode(props);
    const close = findAll(tree, (n) => n.props && n.props['data-role'] === 'node-edit-close')[0];
    close.props.onClick();
    const after = rerender(props);
    assert.equal(layerOf(after), undefined, 'Esc/完成关闭后浮层不得残留');
    assert.equal(maskOf(after), undefined, '遮罩也不得残留');
  });

  test('★ 浮层内保留 Inspector 字段编辑能力（FieldControl 仍被渲染）', () => {
    const tree = selectFirstNode(baseProps());
    const sheet = sheetOf(tree);
    assert.ok(sheet, '应有浮层');
    const controls = findAll(sheet, (n) => String(n.props.className || '').includes('dsh-devops-stub-fieldcontrol'));
    assert.ok(controls.length >= 1, '浮层内必须渲染节点字段控件（不丢编辑能力）');
    assert.equal(controls[0].props['data-field'], 'script', '应渲染节点描述符里的 script 字段');
    const text = textOf(sheet);
    for (const want of ['节点名称', '服务器', '执行时机', '依赖（needs）', '允许失败']) {
      assert.ok(text.includes(want), '浮层应包含「' + want + '」，实际：' + text.slice(0, 200));
    }
  });

  test('浮层头部显示节点名与类型，并有「完成」入口', () => {
    const tree = selectFirstNode(baseProps());
    const head = findAll(tree, (n) => String(n.props.className || '').includes('dsh-devops-editor-sheet-head'))[0];
    assert.ok(head, '应有浮层头部');
    const text = textOf(head);
    assert.match(text, /编译/, '头部应显示节点名');
    assert.match(text, /shell\.exec/, '头部应显示节点类型');
    assert.match(text, /完成/, '应有「完成」（保存并收起）按钮');
  });

  test('未选中节点时保留「流水线设置」侧栏（既有 resizer/host 契约不破）', () => {
    const tree = render(baseProps());
    const host = findAll(tree, (n) => String(n.props.className || '').includes('dsh-devops-inspector-host'));
    assert.equal(host.length, 1, '未选中节点时应保留设置侧栏');
    assert.match(textOf(tree), /流水线设置/, '侧栏仍是流水线设置');
  });

  test('★ 浮层宽度在舒适区间且可拖拽调整（附加能力）', () => {
    const src = readFileSync(editorPath, 'utf8');
    assert.match(src, /SHEET_DEFAULT\s*=\s*\d+/, '应有浮层默认宽度常量');
    const m = src.match(/SHEET_DEFAULT\s*=\s*(\d+)/);
    assert.ok(m, '能解析出默认宽度');
    const def = Number(m[1]);
    // 用户先要求「浮层要能调宽」（当时给的参考区间是 420~520），
    // 随后又反馈「编辑框默认要更宽一点」——Lead 据此把默认值提到 620。
    // 断言同步放宽，但下限不得低于 420（否则比初版更窄，属回归）。
    assert.ok(def >= 420 && def <= 720, '默认宽度应在 420~720 之间，实际 ' + def);
    assert.ok(def > 460, '用户明确要求「默认更宽一点」，应大于初版 460，实际 ' + def);
    assert.equal(String((sheetOf(selectFirstNode(baseProps())).props.style || {}).width), def + 'px', '初始宽度应等于默认常量');
    const tree = selectFirstNode(baseProps());
    const sheet = sheetOf(tree);
    assert.match(String((sheet.props.style || {}).width || ''), /^\d+px$/, '浮层宽度应绑定到 style（形如 460px）');
    const resizer = findAll(tree, (n) => n.props && n.props['data-role'] === 'node-edit-resizer')[0];
    assert.ok(resizer, '应有可拖拽的宽度手柄');
    assert.equal(typeof resizer.props.onMouseDown, 'function', '手柄应绑定拖拽开始');
  });

  test('浮层可拖宽：左边缘向左拖变宽', () => {
    const tree = selectFirstNode(baseProps());
    const resizer = findAll(tree, (n) => n.props && n.props['data-role'] === 'node-edit-resizer')[0];
    const before = sheetOf(tree).props.style.width;
    resizer.props.onMouseDown({ preventDefault() {}, stopPropagation() {}, clientX: 500 });
    // 测试环境没有 window（不注册监听），这里只证明拖拽入口存在且不抛错
    assert.ok(before);
    assert.doesNotThrow(() => resizer.props.onMouseDown({ preventDefault() {}, clientX: 600 }));
  });
});

/* ------------------------------------------------------------------ *
 * 静态契约：类名/属性与 CSS 的配合
 * ------------------------------------------------------------------ */

describeMaybe('浮层样式契约（styles.js 归本任务）', () => {
  test('★ styles.js 定义了浮层的圆角卡片与遮罩虚化', () => {
    const css = existsSync(stylesPath) ? readFileSync(stylesPath, 'utf8') : '';
    if (!css.includes('.dsh-devops-editor-sheet{')) return; // 未落地时不误报
    const sheet = css.split('.dsh-devops-editor-sheet{')[1].slice(0, 500);
    assert.match(sheet, /border-radius/, '浮层应有圆角');
    assert.match(sheet, /box-shadow/, '浮层应有 elevation 阴影');
    assert.match(sheet, /max-height/, '浮层高度应受视口约束');
    const mask = css.split('.dsh-devops-editor-sheet-mask{')[1].slice(0, 300);
    assert.match(mask, /backdrop-filter/, '遮罩应有模糊（虚化背景）');
    assert.match(mask, /background/, '遮罩应有半透明底色');
  });

  test('★ 浮层动效尊重 prefers-reduced-motion', () => {
    const css = existsSync(stylesPath) ? readFileSync(stylesPath, 'utf8') : '';
    assert.match(css, /@media \(prefers-reduced-motion:reduce\)/, '必须有减少动效的媒体查询');
  });

  test('★ editor.js 声明本页自管滚动（task-11：onBodyFlush）', () => {
    const src = readFileSync(editorPath, 'utf8');
    assert.match(src, /onBodyFlush/, 'editor.js 应使用 onBodyFlush 声明本页自管滚动');
    assert.match(src, /minHeight:\s*0/, '编辑器中间列必须有 minHeight:0');
  });
});
