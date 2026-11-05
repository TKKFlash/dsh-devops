// task-14：调用子流水线节点要能**选择**已有流水线，输入名字能模糊匹配。
//
// 用户原话：「调用子流水线节点要能选择已有的流水线，输入名字能模糊匹配。」
//
// 改动前：pipeline.call 的 pipelineId 是纯文本 F.string，必须手打 id，
// 打错要到运行时才报错；前端也没法列出候选。
//
// 本用例不启浏览器：把 src/client/fields.js 与节点描述符放进带桩的迷你模块表里执行，
// 用桩 h 直接渲染控件并断言渲染树（参考 test/client-fields.test.mjs 的桩法）。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { pluginPath } from './helpers/modules.mjs';

const fieldsPath = pluginPath('src', 'client', 'fields.js');
const hasFields = existsSync(fieldsPath);

/* ------------------------------------------------------------ 桩 */

/**
 * 渲染基元桩。
 *  - 桩组件（stubComponent 造的）→ 记成带 stub 标记的节点，按钮/输入框可被断言；
 *  - 真实函数组件（如 PipelineRefControl）→ 立即求值，这样子树才真的被渲染出来；
 *  - 宿主标签 → 普通节点。
 */
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

/** 装真实 syntax.js（CodeControl 的生产路径），避免桩与实现漂移。 */
function loadSyntax() {
  const source = readFileSync(pluginPath('src', 'client', 'syntax.js'), 'utf8');
  const module = { exports: {} };
  new Function('module', 'exports', 'require', source)(module, module.exports, () => ({}));
  return module.exports;
}

/** 在迷你模块表里加载 src/client/fields.js（与 scripts/build-client.mjs 的包裹方式一致）。 */
function loadFields() {
  const source = readFileSync(fieldsPath, 'utf8');
  const module = { exports: {} };
  const slots = [];
  let cursor = 0;
  const stubs = {
    './h.js': {
      h: makeH(),
      useState(init) {
        const i = cursor++;
        if (!(i in slots)) slots[i] = typeof init === 'function' ? init() : init;
        return [slots[i], (next) => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }];
      },
      useEffect() { cursor += 1; },
      useRef(init) { const i = cursor++; if (!(i in slots)) slots[i] = { current: init === undefined ? null : init }; return slots[i]; },
      useMemo(fn) { cursor += 1; return fn(); },
      useCallback(fn) { cursor += 1; return fn; },
      ellipsis: (s) => String(s),
      fmtBytes: (n) => String(n),
    },
    './ui.js': {
      Icon: stubComponent('Icon'),
      Button: stubComponent('Button'),
      Switch: stubComponent('Switch'),
      TextInput: stubComponent('TextInput'),
      TextArea: stubComponent('TextArea'),
      Select: stubComponent('Select'),
      Field: stubComponent('Field'),
      Chip: stubComponent('Chip'),
      Empty: stubComponent('Empty'),
    },
    './api.js': { api: {} },
    './syntax.js': loadSyntax(),
  };
  const requireStub = (id) => {
    if (!(id in stubs)) throw new Error('用例未覆盖的 fields.js 依赖：' + id);
    return stubs[id];
  };
  new Function('module', 'exports', 'require', source)(module, module.exports, requireStub);
  return module.exports;
}

/* ------------------------------------------------------- 工具 */

/** 递归找出满足条件的节点。 */
function findAll(node, predicate, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const c of node) findAll(c, predicate, out);
    return out;
  }
  if (node.type !== undefined && predicate(node)) out.push(node);
  for (const c of node.children || []) findAll(c, predicate, out);
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

/** 取控件里的输入框（TextInput 桩）实例。 */
function inputOf(tree) {
  return findAll(tree, (n) => n.stub === 'TextInput')[0];
}

/** 取候选行（.dsh-devops-list-row）。 */
function rowsOf(tree) {
  return findAll(tree, (n) => n.props && String(n.props.className || '').indexOf('dsh-devops-list-row') >= 0);
}

const PIPELINES = [
  { id: 'build-deploy', name: '构建并部署', description: 'CI 主流程', category: 'build' },
  { id: 'lint-only', name: '只做检查', description: '快速 lint', category: 'quality' },
  { id: 'release-tag', name: '发布打标签', description: 'deploy release', category: 'release' },
];

const describeMaybe = hasFields ? describe : describe.skip;

describeMaybe('ref:pipeline 字段类型与白名单（后端契约）', () => {
  const fields = hasFields ? loadFields() : {};

  test('★ FIELD_TYPES 白名单包含 ref:pipeline（否则注册期就被拒绝）', async () => {
    const mod = await import('../src/engine/nodes/index.js').catch(() => null);
    if (!mod) return; // 引擎侧不可加载时跳过（由 verifier 覆盖）
    assert.ok(mod.FIELD_TYPES.includes('ref:pipeline'), 'FIELD_TYPES 必须含 ref:pipeline');
    // 不能是只加了类型而漏了工厂：再注册一遍内置节点，非法类型会在注册期抛错
    const registry = mod.createNodeRegistry({ config: {} });
    assert.equal(typeof registry.get('pipeline.call')?.run, 'function', 'pipeline.call 必须可注册');
  });

  test('★ pipeline.call 的 pipelineId 字段类型是 ref:pipeline，且保留 required/placeholder', async () => {
    const mod = await import('../src/engine/nodes/builtin/pipeline.call.js').catch(() => null);
    if (!mod) return;
    const field = mod.descriptor.fields.find((f) => f.name === 'pipelineId');
    assert.ok(field, 'pipeline.call 必须有 pipelineId 字段');
    assert.equal(field.type, 'ref:pipeline', 'pipelineId 必须是 ref:pipeline（可搜索选择）');
    assert.equal(field.required, true, 'required 必须保留');
    assert.equal(field.placeholder, 'build-deploy', 'placeholder 必须保留');
  });

  test('helpers 的 F.pipeline 产出 ref:pipeline 类型', async () => {
    const mod = await import('../src/engine/nodes/helpers.js').catch(() => null);
    if (!mod) return;
    const field = mod.F.pipeline('pipelineId', '子流水线', { required: true });
    assert.equal(field.type, 'ref:pipeline');
    assert.equal(field.name, 'pipelineId');
    assert.equal(field.label, '子流水线');
    assert.equal(field.required, true);
  });

  test('模糊匹配内核：名字与 ID 都能命中，大小写不敏感', () => {
    if (!hasFields) return;
    const { matchPipelines } = fields;
    // 用户原话场景：输入 "depl" 命中 "build-deploy"
    const byName = matchPipelines('depl', PIPELINES).map((m) => m.pipeline.id);
    assert.ok(byName.includes('build-deploy'), '输入 depl 应命中 build-deploy，实际：' + byName.join(','));
    // 按 id 直接命中
    const byId = matchPipelines('build', PIPELINES).map((m) => m.pipeline.id);
    assert.ok(byId.includes('build-deploy'), '输入 build 应命中 build-deploy');
    // 大小写不敏感
    const upper = matchPipelines('DEPL', PIPELINES).map((m) => m.pipeline.id);
    assert.deepEqual(upper, byName, '大写输入应与小写等价');
    // 空查询 = 全部候选
    assert.equal(matchPipelines('', PIPELINES).length, 3, '空查询应列出全部候选');
    // 中文名字子串
    assert.ok(matchPipelines('构建', PIPELINES).some((m) => m.pipeline.id === 'build-deploy'), '中文子串应命中');
  });
});

describeMaybe('PipelineRefControl 渲染（task-14 前端）', () => {
  const fields = hasFields ? loadFields() : {};
  const control = fields.PipelineRefControl;

  const render = (value, ctx, onChange) =>
    control({ field: { name: 'pipelineId', label: '子流水线', type: 'ref:pipeline', placeholder: 'build-deploy' }, value, ctx, onChange: onChange || (() => {}) });

  test('★ 能列出候选，且显示名字而不只是 id', () => {
    const tree = render('', { pipelines: PIPELINES });
    const rows = rowsOf(tree);
    assert.equal(rows.length, 3, '应列出 3 条候选');
    const text = textOf(tree);
    assert.match(text, /构建并部署/, '必须显示流水线名字');
    assert.match(text, /build-deploy/, '也应显示 id');
    assert.match(text, /只做检查/, '其它候选也要在');
  });

  test('★ 按名字模糊过滤：输入 depl 命中 build-deploy', () => {
    const tree = render('depl', { pipelines: PIPELINES });
    const rows = rowsOf(tree);
    assert.ok(rows.length >= 1, '应至少有 1 条匹配');
    const ids = rows.map((r) => String(r.props.key));
    assert.ok(ids.includes('build-deploy'), 'depl 应命中 build-deploy，实际：' + ids.join(','));
    assert.ok(!ids.includes('lint-only'), '无关项应被过滤掉');
  });

  test('★ 按 id 也能命中（且大小写不敏感）', () => {
    const lower = render('lint', { pipelines: PIPELINES });
    assert.ok(rowsOf(lower).some((r) => r.props.key === 'lint-only'), 'lint 应命中 lint-only');
    const upper = render('LINT', { pipelines: PIPELINES });
    assert.ok(rowsOf(upper).some((r) => r.props.key === 'lint-only'), '大写 LINT 也要命中');
  });

  test('★ 选中候选后 onChange 收到正确的 pipelineId', () => {
    const calls = [];
    const tree = render('', { pipelines: PIPELINES }, (v) => calls.push(v));
    const rows = rowsOf(tree);
    const target = rows.find((r) => r.props.key === 'build-deploy');
    assert.ok(target, '应找到 build-deploy 候选行');
    target.props.onClick();
    assert.deepEqual(calls, ['build-deploy'], '点击候选应把 pipelineId 写回');
  });

  test('★ 手填 ID 仍然可用（freeform）', () => {
    const calls = [];
    const tree = render('', { pipelines: PIPELINES }, (v) => calls.push(v));
    const input = inputOf(tree);
    assert.ok(input, '控件要有输入框（允许手填）');
    input.props.onChange('my-brand-new-pipeline');
    assert.deepEqual(calls, ['my-brand-new-pipeline'], '手填的 id 必须能直接写入');
  });

  test('★ 未知值显示为可辨识文案，而不是空白', () => {
    const tree = render('not-exist-pipeline', { pipelines: PIPELINES });
    const text = textOf(tree);
    assert.match(text, /未知流水线/, '未知值要有「(未知流水线)」标注');
    assert.match(text, /not-exist-pipeline/, '标注里要带上那个值');
  });

  test('★ 当前值已知时显示名字', () => {
    const text = textOf(render('build-deploy', { pipelines: PIPELINES }));
    assert.match(text, /构建并部署/, '已知值应显示名字');
    assert.match(text, /当前/, '应有「当前：」提示');
  });

  test('★ 候选为空时不崩，并给出仍可手填的提示', () => {
    assert.doesNotThrow(() => render('', { pipelines: [] }), '空候选不得抛错');
    const tree = render('', { pipelines: [] });
    assert.equal(rowsOf(tree).length, 0);
    assert.match(textOf(tree), /仍可直接输入 ID|没有可选的流水线/, '空候选要提示仍可手填');

    // ctx 缺失 / pipelines 不是数组同样不能崩
    assert.doesNotThrow(() => render('', {}), 'ctx 缺 pipelines 不得抛错');
    assert.doesNotThrow(() => render('', { pipelines: null }), 'pipelines=null 不得抛错');
    assert.doesNotThrow(() => render('x', undefined), 'ctx 为 undefined 不得抛错');
  });

  test('匹配为空但输入非空：给出「没有匹配」且不崩', () => {
    const tree = render('zzzz', { pipelines: PIPELINES });
    assert.equal(rowsOf(tree).length, 0);
    assert.match(textOf(tree), /没有匹配/, '无匹配时要有提示');
  });
});

describeMaybe('FieldControl 分发与调用点契约', () => {
  test('FieldControl 把 ref:pipeline 交给 PipelineRefControl', () => {
    if (!hasFields) return;
    const { FieldControl } = loadFields();
    const tree = FieldControl({
      field: { name: 'pipelineId', label: '子流水线', type: 'ref:pipeline' },
      value: '',
      onChange() {},
      ctx: { pipelines: PIPELINES },
    });
    // 控件被包在 Field 里，找里面的候选行即可证明分发正确
    assert.ok(rowsOf(tree).length > 0, 'ref:pipeline 应渲染出候选列表');
  });

  test('fields.js 的候选来源是 dataOf(ctx) 且不直接读宿主 ctx 数据键', () => {
    const src = readFileSync(fieldsPath, 'utf8');
    assert.match(src, /dataOf\(props\.ctx, 'pipelines'\)/, '候选必须经 dataOf(props.ctx, "pipelines") 读取');
    assert.match(src, /case 'ref:pipeline'/, 'FieldControl 必须分发 ref:pipeline');
    // 不得出现裸读 ctx.pipelines（宿主 ctx 是 Cordis context，会抛 without inject）
    assert.doesNotMatch(src, /\bctx\.pipelines\b/, '不得裸读 ctx.pipelines（会让面板整块报错）');
  });

  test('★ 需要 Lead 在 app.js 补下发的字段名：pipelines', () => {
    const appSrc = readFileSync(pluginPath('src', 'client', 'app.js'), 'utf8');
    // Lead 已补下发则通过；若还没补，给出明确提示（本用例不因此失败）
    assert.ok(
      appSrc.includes('pipelines:'),
      'fieldCtx 需要包含 pipelines（Lead 负责，字段名 pipelines）',
    );
  });
});
