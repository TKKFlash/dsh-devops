// 视图状态持久化：离开 DevOps 界面再回来时保留状态（task-12）。
//
// 用户原话：「我每次从 devops 界面离开，然后重新回到 devops 界面时，之前的状态全部消失了，
//   然后从概况那里从新开始，很不合理。」
//
// 根因：面板随侧边栏 slot 卸载，组件内 useState 全部清零。
// 本用例覆盖：恢复「视图位置」、目标已删除时优雅降级、只存 id/标记不存大对象。
//
// 不启浏览器：把 src/client/page-pipelines.js 放进带桩模块表执行，
// 用「桩 h + 桩 hooks」直接调用组件函数，并用内存版 sessionStorage 驱动记忆读写。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { pluginPath } from './helpers/modules.mjs';

const srcPath = pluginPath('src', 'client', 'page-pipelines.js');
const tplPath = pluginPath('src', 'client', 'page-templates.js');
const hasSource = existsSync(srcPath);

/* ------------------------------------------------------------------ *
 * 内存版 sessionStorage（模拟浏览器，可断言「只存了什么」）
 * ------------------------------------------------------------------ */

function makeStorage() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    raw: (k) => (map.has(k) ? map.get(k) : ''),
    json(k) { const v = map.get(k); return v ? JSON.parse(v) : null; },
  };
}

/* ------------------------------------------------------------------ *
 * 桩 h + 桩 hooks（useRef 返回稳定对象；useEffect 支持依赖数组）
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
    useMemo(fn) { index++; return fn(); },
    useCallback(fn) { index++; return fn; },
    useRef() { const i = index++; if (!(i in slots)) slots[i] = { current: null }; return slots[i]; },
    useReducer() { index++; return [0, () => {}]; },
    useTick() { index++; return undefined; },
  };
}

const HOOK_NAMES = ['useState', 'useEffect', 'useMemo', 'useCallback', 'useRef', 'useReducer', 'useTick'];

function findAll(node, predicate, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { for (const c of node) findAll(c, predicate, out); return out; }
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

/** 在指定 storage 环境下加载模块（模块内直接引用全局 sessionStorage）。 */
function loadWithStorage(storage, extra) {
  const source = readFileSync(srcPath, 'utf8');
  const module = { exports: {} };
  const hooks = makeHooks();
  const h = makeH();
  const hookApi = {};
  for (const name of HOOK_NAMES) hookApi[name] = hooks[name];
  const stubs = {
    './h.js': Object.assign({
      h, useSyncExternalStore: () => ({}), cx: (...p) => p.filter(Boolean).join(' '),
      fmtDuration: (ms) => String(ms) + 'ms', fmtTime: (ts) => 'T' + ts, fmtAgo: (ts) => 'ago' + ts,
      fmtBytes: (n) => String(n) + 'B', ellipsis: (s) => String(s), clone: (v) => v, groupBy: () => new Map(),
    }, hookApi),
    './ui.js': {
      Icon: stubComponent('Icon'), Button: stubComponent('Button'), StatusDot: stubComponent('StatusDot'),
      Chip: stubComponent('Chip'), Card: stubComponent('Card'), Empty: stubComponent('Empty'),
      Banner: stubComponent('Banner'), Modal: stubComponent('Modal'), Field: stubComponent('Field'),
      KV: (props) => h('dl', { className: 'dsh-devops-kv' }, (props.entries || []).map((e, i) => h('div', { key: i }, String(e[0]), e[1]))),
      TextInput: stubComponent('TextInput'), TextArea: stubComponent('TextArea'), Select: stubComponent('Select'),
      Switch: stubComponent('Switch'), ProgressRing: stubComponent('ProgressRing'),
      Collapsible: stubComponent('Collapsible'), AsyncBox: stubComponent('AsyncBox'),
      useToast: () => [null, { ok() {}, error() {}, warn() {} }],
    },
    './api.js': { api: Object.assign({
      getPipeline: () => Promise.resolve(null),
      listPipelines: () => Promise.resolve([]),
      updatePipeline: () => Promise.resolve({}),
      createPipeline: () => Promise.resolve({}),
      deletePipeline: () => Promise.resolve(true),
      runPipeline: () => Promise.resolve({}),
    }, (extra && extra.api) || {}) },
    './editor.js': {
      PipelineEditor: stubComponent('PipelineEditor'),
      detectScheduling: (p) => ((p.stages || []).some((s) => (s.jobs || []).some((j) => (j.needs || []).length)) ? 'dag' : 'staged'),
      countJobs: (p) => (p.stages || []).reduce((n, s) => n + (s.jobs || []).length, 0),
    },
    './state.js': {
      runTone: () => 'idle', stepTone: () => 'idle',
      RUN_STATUS_TEXT: { queued: '排队中', running: '运行中', success: '成功', failed: '失败', canceled: '已取消' },
      STEP_STATUS_TEXT: { pending: '等待', running: '运行中', success: '成功', failed: '失败', skipped: '已跳过', canceled: '已取消' },
    },
    './sse.js': { createRunStream: () => ({ close() {} }) },
    './logs.js': { LogPanel: stubComponent('LogPanel'), LogLine: stubComponent('LogLine') },
    './ai.js': { AiButton: stubComponent('AiButton'), buildFailurePrompt: () => '' },
    './canvas.js': {},
  };
  const requireStub = (id) => {
    if (!(id in stubs)) throw new Error('用例未覆盖的依赖：' + id);
    return stubs[id];
  };
  // 把 storage 装进全局，模拟浏览器；模块内用 typeof sessionStorage 探测。
  // 注意：**不能在这里卸载** —— 模块导出的 read/writeViewState 是运行期才调用的，
  // 卸载后它们会探测到「无 storage」而静默降级，用例就测不到真实行为。
  if (storage === null) delete globalThis.sessionStorage;
  else globalThis.sessionStorage = storage;
  new Function('module', 'exports', 'require', source)(module, module.exports, requireStub);
  return { exports: module.exports, hooks, h, storage };
}

/** 从模块里取 helper（不依赖图片/浏览器）。 */
const mod = hasSource ? loadWithStorage(makeStorage()) : { exports: {} };
const E = mod.exports;

/** 从 page-templates.js 源码里求值出模板页的筛选恢复函数（真实实现，非桩）。 */
function loadTemplateFilters() {
  const source = readFileSync(tplPath, 'utf8');
  const module = { exports: {} };
  const stubs = {
    './h.js': { h: () => null, useState: () => [null, () => {}], useEffect: () => {}, useMemo: (f) => f(), clone: (v) => v },
    './ui.js': new Proxy({}, { get: () => () => null }),
    './fields.js': { FieldControl: () => null },
    './api.js': { api: {} },
  };
  new Function('module', 'exports', 'require', source)(module, module.exports, (id) => {
    if (!(id in stubs)) throw new Error('用例未覆盖的 page-templates.js 依赖：' + id);
    return stubs[id];
  });
  return module.exports.resolveTemplateFilters;
}

const templateFilters = existsSync(tplPath) ? loadTemplateFilters() : null;

/* ------------------------------------------------------------------ *
 * 测试数据
 * ------------------------------------------------------------------ */

function pipeline(id, name) {
  return {
    id: id || 'build-deploy', name: name || '构建并部署', description: '演示',
    stages: [{ id: 'build', name: '构建', parallel: false, jobs: [{ id: 'compile', name: '编译', node: 'shell.exec' }] }],
    variables: [], defaults: { server: 'local' }, tags: [],
  };
}

const describeMaybe = hasSource ? describe : describe.skip;

/* ------------------------------------------------------------------ *
 * 纯函数：视图位置解析
 * ------------------------------------------------------------------ */

describeMaybe('resolvePipelineView：只认轻量标记，非法输入一律降级为列表', () => {
  test('★ 恢复 detail / edit 模式与 id', () => {
    assert.deepEqual(E.resolvePipelineView({ pipelinesMode: 'detail', pipelinesId: 'p1' }), { mode: 'detail', id: 'p1' });
    assert.deepEqual(E.resolvePipelineView({ pipelinesMode: 'edit', pipelinesId: 'p2' }), { mode: 'edit', id: 'p2' });
  });

  test('★ 各种非法/缺失输入都降级为列表（不抛错）', () => {
    const cases = [null, undefined, 0, '', 'x', [], {}, { pipelinesMode: 'nope' }, { pipelinesMode: 'detail' }, { pipelinesId: 'p1' }, { pipelinesMode: 'detail', pipelinesId: 123 }, { pipelinesMode: 'edit', pipelinesId: '' }];
    for (const input of cases) {
      const out = E.resolvePipelineView(input);
      assert.equal(out.mode, 'list', '输入 ' + JSON.stringify(input) + ' 应降级为 list，实际 ' + JSON.stringify(out));
      assert.equal(out.id, '');
    }
  });

  test('edit 模式可从 editPipelineId 兜底（app.js 的 rememberEdit 字段）', () => {
    assert.deepEqual(E.resolvePipelineView({ pipelinesMode: 'edit', editPipelineId: 'p9' }), { mode: 'edit', id: 'p9' });
  });
});

describeMaybe('resolveListFilters / resolveTemplateFilters：只认标量', () => {
  test('★ 非法值降级，合法值原样恢复', () => {
    assert.deepEqual(E.resolveListFilters({ listKeyword: 'abc', listCategory: 'build' }), { keyword: 'abc', category: 'build' });
    assert.deepEqual(E.resolveListFilters(null), { keyword: '', category: '' });
    assert.deepEqual(E.resolveListFilters({ listKeyword: 5, listCategory: {} }), { keyword: '', category: '' });

    // 模板页的恢复函数由 page-templates.js 自己提供（本页不重复定义）
    assert.equal(E.resolveTemplateFilters, undefined, 'page-pipelines.js 不应重复定义模板页的恢复函数');
    assert.deepEqual(templateFilters({ templatesKeyword: 'k', templatesCategory: 'c', templatesFavOnly: true }), { keyword: 'k', category: 'c', favOnly: true });
    assert.deepEqual(templateFilters(null), { keyword: '', category: '', favOnly: false });
    assert.deepEqual(templateFilters({ templatesFavOnly: 'yes' }), { keyword: '', category: '', favOnly: false });
  });
});

/* ------------------------------------------------------------------ *
 * 只按 id 现取数据；目标不存在时降级
 * ------------------------------------------------------------------ */

describeMaybe('loadPipelineForView：按 id 现取，目标不存在优雅降级', () => {
  test('★ 成功时返回最新数据（而非记忆里的旧数据）', async () => {
    const calls = [];
    const fresh = pipeline('p1', '服务端最新名字');
    const out = await E.loadPipelineForView({ mode: 'detail', id: 'p1' }, (id) => { calls.push(id); return Promise.resolve(fresh); });
    assert.equal(out.ok, true);
    assert.equal(out.pipeline.name, '服务端最新名字');
    assert.deepEqual(calls, ['p1'], '必须按 id 向服务端取一次');
  });

  test('★ 目标已被删除 / 取数抛错 → 降级且不抛出', async () => {
    const missing = await E.loadPipelineForView({ mode: 'detail', id: 'gone' }, () => Promise.resolve(null));
    assert.equal(missing.ok, false);
    assert.equal(missing.missing, true);

    const thrown = await E.loadPipelineForView({ mode: 'detail', id: 'gone' }, () => Promise.reject(new Error('流水线不存在：gone')));
    assert.equal(thrown.ok, false);
    assert.match(thrown.message, /gone/);

    const noId = await E.loadPipelineForView({ mode: 'list', id: '' }, () => Promise.resolve({}));
    assert.equal(noId.ok, false);
  });
});

/* ------------------------------------------------------------------ *
 * 记忆读写：键名、合并语义、安全降级
 * ------------------------------------------------------------------ */

describeMaybe('视图记忆读写：键名与合并语义和 app.js 一致，且安全降级', () => {
  test('★ 写的是 app.js 的同一个键 dsh-devops.view，并合并既有字段', () => {
    const storage = makeStorage();
    const m = loadWithStorage(storage);
    m.exports.writeViewState({ pipelinesMode: 'detail', pipelinesId: 'p1' });
    assert.ok(storage.map.has('dsh-devops.view'), '键名必须是 dsh-devops.view（与 app.js 同键）');
    // 再写一个字段，已有的 page 不应被冲掉
    storage.setItem('dsh-devops.view', JSON.stringify({ page: 'pipelines' }));
    m.exports.writeViewState({ pipelinesMode: 'edit', pipelinesId: 'p2' });
    assert.deepEqual(storage.json('dsh-devops.view'), { page: 'pipelines', pipelinesMode: 'edit', pipelinesId: 'p2' });
  });

  test('★ 重置视图：把模式退回 list 并清空 id', () => {
    const storage = makeStorage();
    const m = loadWithStorage(storage);
    m.exports.writeViewState({ pipelinesMode: 'edit', pipelinesId: 'p1', editPipelineId: 'p1' });
    m.exports.resetPipelineView();
    const saved = storage.json('dsh-devops.view');
    assert.equal(saved.pipelinesMode, 'list');
    assert.equal(saved.pipelinesId, '');
    assert.equal(saved.editPipelineId, '');
  });

  test('★ 无 sessionStorage（隐私模式）时不抛错，读取降级为 null', () => {
    const m = loadWithStorage(null);
    assert.equal(m.exports.readViewState(), null);
    assert.doesNotThrow(() => m.exports.writeViewState({ pipelinesMode: 'edit' }));
  });

  test('★ JSON 损坏时读取降级为 null 而不是抛错', () => {
    const storage = makeStorage();
    storage.setItem('dsh-devops.view', '{坏掉的 json');
    const m = loadWithStorage(storage);
    assert.equal(m.exports.readViewState(), null);
  });
});

/* ------------------------------------------------------------------ *
 * 端到端：重挂载恢复 / 删除降级 / 只存 id
 * ------------------------------------------------------------------ */

describeMaybe('Pipelines 组件：重新挂载时恢复视图位置', () => {
  const baseState = (extra) => Object.assign({ pipelines: [], runs: [], nodes: [], servers: [], templates: [], settings: {} }, extra || {});

  const props = (extra) => Object.assign({
    state: baseState(), toast: { ok() {}, error() {}, warn() {} }, ctx: {},
    fieldCtx: { servers: [], envsets: [], snippets: [], defaultServer: 'local' },
    onReload() {}, onOpenRun() {}, recent: () => [], remember() {}, remembered: null,
  }, extra || {});

  test('★ 有 detail 记忆时，重进直接进详情并展示该流水线', async () => {
    const storage = makeStorage();
    storage.setItem('dsh-devops.view', JSON.stringify({ page: 'pipelines', pipelinesMode: 'detail', pipelinesId: 'p1' }));
    const m = loadWithStorage(storage, { api: { getPipeline: (id) => Promise.resolve(pipeline(id, '恢复出来的流水线')) } });
    const P = m.exports.Pipelines;
    m.hooks.clear();
    // 首次渲染：应进入「恢复中」，而不是列表
    let tree = P(props({ remembered: { pipelinesMode: 'detail', pipelinesId: 'p1' } }));
    await new Promise((r) => setTimeout(r, 0));
    m.hooks.reset();
    tree = P(props({ remembered: { pipelinesMode: 'detail', pipelinesId: 'p1' } }));
    const text = textOf(tree);
    assert.match(text, /恢复出来的流水线|构建并部署/, '应恢复到该流水线的详情，而不是列表页');
    assert.ok(!/点名称看详情/.test(text), '不应停在列表页');
  });

  test('★ 目标已被删除：降级回列表并提示，绝不白屏/抛错', async () => {
    const storage = makeStorage();
    storage.setItem('dsh-devops.view', JSON.stringify({ page: 'pipelines', pipelinesMode: 'edit', pipelinesId: 'gone' }));
    const warnings = [];
    const m = loadWithStorage(storage, { api: { getPipeline: () => Promise.reject(new Error('流水线不存在：gone')) } });
    const P = m.exports.Pipelines;
    m.hooks.clear();
    let threw = null;
    try {
      P(props({ remembered: { pipelinesMode: 'edit', pipelinesId: 'gone' }, toast: { ok() {}, error() {}, warn: (t) => warnings.push(t) } }));
      await new Promise((r) => setTimeout(r, 0));
      m.hooks.reset();
      const tree = P(props({ remembered: { pipelinesMode: 'edit', pipelinesId: 'gone' }, toast: { ok() {}, error() {}, warn: (t) => warnings.push(t) } }));
      assert.match(textOf(tree), /点名称看详情|流水线/, '应回到列表页');
    } catch (error) {
      threw = error;
    }
    assert.equal(threw, null, '目标不存在时不得抛错：' + (threw && threw.message));
    assert.ok(warnings.some((w) => /已不存在/.test(w)), '应给出可见提示，实际：' + JSON.stringify(warnings));
    // 记忆被清掉，下次进来不再尝试恢复
    const saved = storage.json('dsh-devops.view');
    assert.equal(saved.pipelinesMode, 'list');
  });

  test('★ 显式跳转（initialAction）优先于记忆', async () => {
    const storage = makeStorage();
    storage.setItem('dsh-devops.view', JSON.stringify({ pipelinesMode: 'detail', pipelinesId: 'p-memory' }));
    const m = loadWithStorage(storage, { api: { getPipeline: (id) => Promise.resolve(pipeline(id, '来自跳转')) } });
    const P = m.exports.Pipelines;
    m.hooks.clear();
    P(props({ remembered: { pipelinesMode: 'detail', pipelinesId: 'p-memory' }, initialAction: { edit: 'p-click' } }));
    await new Promise((r) => setTimeout(r, 0));
    m.hooks.reset();
    const tree = P(props({ remembered: { pipelinesMode: 'detail', pipelinesId: 'p-memory' }, initialAction: { edit: 'p-click' } }));
    // 编辑器是桩组件（不渲染文本），因此断言它收到的 pipeline，而不是文案
    const editor = findAll(tree, (n) => n.stub === 'PipelineEditor')[0];
    assert.ok(editor, '显式跳转应进入编辑器');
    assert.equal(editor.props.pipeline.id, 'p-click', '显式跳转应优于记忆里的 p-memory');
    assert.equal(editor.props.pipeline.name, '来自跳转');
  });

  test('★ 连续改两个筛选不会互相覆盖（只写变化项，避免用挂载快照当基线）', () => {
    // 回归：patchFilter 曾用 props.remembered 派生的快照做合并基线，
    // 那个快照不会随写入更新 →「先输关键字、再切分类」会把关键字抹掉。
    const storage = makeStorage();
    const m = loadWithStorage(storage);
    // 模拟组件：先写关键字，再写分类（两者各自只写自己那一项）
    m.exports.writeViewState({ listKeyword: '构建' });
    m.exports.writeViewState({ listCategory: 'build' });
    const saved = storage.json('dsh-devops.view');
    assert.equal(saved.listKeyword, '构建', '后写分类不得抹掉已存的关键字');
    assert.equal(saved.listCategory, 'build');
  });

  test('★ 记忆里只有 id/轻量标记，不含流水线定义等大对象', () => {
    const storage = makeStorage();
    const m = loadWithStorage(storage);
    m.exports.writeViewState({ pipelinesMode: 'edit', pipelinesId: 'p1', editPipelineId: 'p1' });
    const raw = storage.raw('dsh-devops.view');
    const saved = JSON.parse(raw);
    for (const key of Object.keys(saved)) {
      const value = saved[key];
      assert.ok(['string', 'boolean', 'number'].includes(typeof value) || value === null, '字段 ' + key + ' 是复杂对象，不应存进记忆');
    }
    assert.doesNotMatch(raw, /stages/, '记忆里不得出现流水线定义结构');
    assert.ok(raw.length < 400, '记忆应保持轻量，实际 ' + raw.length + ' 字节');
  });
});

/* ------------------------------------------------------------------ *
 * 模板页筛选持久化
 * ------------------------------------------------------------------ */

describeMaybe('page-templates.js：筛选状态同样持久化', () => {
  const hasTpl = existsSync(tplPath);
  const opts = hasTpl ? {} : { skip: '缺少 page-templates.js' };

  test('★ 使用同一个记忆键，且筛选值都是标量', opts, () => {
    const src = readFileSync(tplPath, 'utf8');
    assert.match(src, /'dsh-devops\.view'/, '模板页应读写与 app.js/page-pipelines.js 相同的记忆键');
    assert.match(src, /templatesKeyword/, '应持久化搜索词');
    assert.match(src, /templatesFavOnly/, '应持久化「只看收藏」');
    assert.match(src, /resolveTemplateFilters/, '应有恢复筛选的纯函数');
  });

  test('★ page-templates.js 里的筛选恢复只认标量（静态校验）', opts, () => {
    const src = readFileSync(tplPath, 'utf8');
    const body = src.slice(src.indexOf('function resolveTemplateFilters'));
    assert.match(body.slice(0, 600), /typeof view\.templatesKeyword === 'string'/, '搜索词必须是字符串才恢复');
    assert.match(body.slice(0, 600), /templatesFavOnly === true/, '只看收藏必须是严格 true');
  });
});

/* ------------------------------------------------------------------ *
 * 回归：不得破坏既有契约
 * ------------------------------------------------------------------ */

describeMaybe('回归约束', () => {
  test('★ 不得把整份流水线对象写进视图记忆（只存 id）', () => {
    const src = readFileSync(srcPath, 'utf8');
    const calls = [...src.matchAll(/writeViewState\(\{([\s\S]{0,200}?)\}\)/g)].map((m) => m[1]);
    for (const body of calls) {
      assert.doesNotMatch(body, /pipeline\s*:/, 'writeViewState 不得写入整份 pipeline 对象：' + body);
      assert.doesNotMatch(body, /stages/, 'writeViewState 不得写入 stages：' + body);
    }
  });

  test('★ 恢复逻辑不产生「提前 return 之后还有 hook」（React #310）', () => {
    const src = readFileSync(srcPath, 'utf8');
    // 恢复用的 useEffect 必须在任何顶层 return 之前
    const restoreIdx = src.indexOf('resolvePipelineView(props.remembered');
    const firstReturn = src.indexOf("if (mode === 'edit' && draft)");
    assert.ok(restoreIdx > 0 && firstReturn > 0, '应能找到恢复逻辑与首个提前 return');
    assert.ok(restoreIdx < firstReturn, '恢复 effect 必须在提前 return 之前');
  });

  test('★ 详情页声明了 onBodyFlush 且中间列带 minHeight:0（task-11 协同）', () => {
    const src = readFileSync(srcPath, 'utf8');
    assert.match(src, /props\.onBodyFlush\(true\)/, '应声明本页自管滚动');
    assert.match(src, /minWidth: 0, minHeight: 0/, '详情页中间列必须有 minHeight:0');
  });
});
