// 日志面板显示层回归（task-7）：深色终端语义 + 语法着色 + 语言切换。
//
// 用户原话：
//   「不要只有透明白色，比如 log 界面……需要格式化，是黑色的符合 Linux 终端，
//     可以识别 python 代码、js、shell 等等，按不同编码颜色显示，和缩进加粗等等。」
//
// 本用例不启浏览器：把 src/client/logs.js 放进带桩的迷你模块表里执行，
// **语法引擎用真的 src/client/syntax.js**（不是桩），这样断言的是真实 token 分类，
// 而不是「有个 span 就算过」的空壳。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pluginPath } from './helpers/modules.mjs';

/* ---------------------------------------------------------------- 桩基建 */

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

function makeHooks() {
  const slots = [];
  let index = 0;
  return {
    slots,
    reset() { index = 0; },
    clear() { slots.length = 0; index = 0; },
    useState(initial) {
      const i = index++;
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      const set = (next) => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; };
      return [slots[i], set];
    },
    useEffect(fn) {
      const cleanup = fn();
      if (typeof cleanup === 'function') cleanup();
      return undefined;
    },
    useMemo(fn) { return fn(); },
    useCallback(fn) { return fn; },
    // 忠实还原 React：useRef(init) 的 current 初值是 init
    useRef(init) { return { current: init === undefined ? null : init }; },
    useReducer() { return [0, () => {}]; },
    useTick() { return undefined; },
  };
}

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

function classOf(node) {
  return (node && node.props && String(node.props.className || '')) || '';
}

/** 树里所有语法 token 的 kind 集合（如 {keyword, function}）。 */
function tokKinds(node) {
  const kinds = new Set();
  for (const n of findAll(node, (x) => classOf(x).includes('dsh-devops-tok-'))) {
    const m = classOf(n).match(/dsh-devops-tok-([a-z]+)/);
    if (m) kinds.add(m[1]);
  }
  return kinds;
}

function tokNodes(node) {
  return findAll(node, (n) => classOf(n).includes('dsh-devops-tok dsh-devops-tok-'));
}

/**
 * 加载 logs.js：'./syntax.js' 用**真实源码**求值（CommonJS 形态与 src/client 一致），
 * 其余相对依赖用桩；api / sse 可通过 extra 覆盖。
 */
function loadLogs(extra) {
  const syntaxSource = readFileSync(pluginPath('src', 'client', 'syntax.js'), 'utf8');
  const syntaxModule = { exports: {} };
  new Function('module', 'exports', 'require', syntaxSource)(syntaxModule, syntaxModule.exports, () => {
    throw new Error('syntax.js 不应再有依赖');
  });

  const source = readFileSync(pluginPath('src', 'client', 'logs.js'), 'utf8');
  const module = { exports: {} };
  const hooks = makeHooks();
  const h = makeH();
  const stubs = {
    './h.js': {
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
      fmtBytes: (n) => String(n) + 'B',
    },
    './ui.js': {
      Icon: stubComponent('Icon'),
      Button: stubComponent('Button'),
      TextInput: stubComponent('TextInput'),
      Select: stubComponent('Select'),
    },
    './api.js': { api: {} },
    './sse.js': { createRunStream: () => ({ close() {} }) },
    './syntax.js': syntaxModule.exports,
  };
  Object.assign(stubs, (extra && extra.extra) || {});
  const requireStub = (id) => {
    if (!(id in stubs)) throw new Error('用例未覆盖的依赖：' + id + '（来自 logs.js）');
    return stubs[id];
  };
  new Function('module', 'exports', 'require', source)(module, module.exports, requireStub);
  return { exports: module.exports, hooks, h };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

/* ------------------------------------------------------------ 语法着色本体 */

describe('LogLine：真实语法着色（task-7 核心）', () => {
  const loaded = loadLogs();
  const LogLine = loaded.exports.LogLine;
  const renderLineContent = loaded.exports.renderLineContent;
  const resolveLanguage = loaded.exports.resolveLanguage;

  const line = (text, stream) => ({ seq: 1, ts: 0, stream: stream || 'stdout', text });

  test('★ Python 行渲染出 dsh-devops-tok-<kind> span（真的走了语法引擎）', () => {
    const tree = LogLine({ line: line('def deploy(name):'), language: 'python' });
    const spans = tokNodes(tree);
    assert.ok(spans.length > 0, 'Python 行必须产生语法 token span，实际 0 个');
    const classes = spans.map(classOf);
    for (const cls of classes) {
      assert.match(cls, /^dsh-devops-tok dsh-devops-tok-[a-z]+$/, 'token 类名形态应为 .dsh-devops-tok .dsh-devops-tok-<kind>');
    }
    const kinds = tokKinds(tree);
    assert.ok(kinds.has('keyword'), 'def 应被识别为 keyword，实际 kinds：' + [...kinds].join(','));
    assert.ok(kinds.has('function'), 'deploy 应被识别为 function，实际 kinds：' + [...kinds].join(','));
    // 文本不得被改写（着色只加 span，不动原文）
    assert.equal(textOf(tree), 'def deploy(name):', '着色不得改变原文');
  });

  test('★ Shell 行按 shell 分类（$VAR 为 variable、# 注释为 comment）', () => {
    const tree = LogLine({ line: line('echo \$HOME # 注释'), language: 'shell' });
    const kinds = tokKinds(tree);
    assert.ok(kinds.has('builtin'), 'echo 应为 builtin（内置命令），实际：' + [...kinds].join(','));
    assert.ok(kinds.has('variable'), '\$HOME 应为 variable，实际：' + [...kinds].join(','));
    assert.ok(kinds.has('comment'), '# 注释应为 comment，实际：' + [...kinds].join(','));
  });

  test('★ JavaScript 行按 js 分类', () => {
    const tree = LogLine({ line: line('const total = sum(1, 2); // 求和'), language: 'javascript' });
    const kinds = tokKinds(tree);
    assert.ok(kinds.has('keyword'), 'const 应为 keyword，实际：' + [...kinds].join(','));
    assert.ok(kinds.has('number'), '1/2 应为 number，实际：' + [...kinds].join(','));
    assert.ok(kinds.has('comment'), '// 注释应为 comment，实际：' + [...kinds].join(','));
  });

  test('★ 切纯文本：不产生任何 tok span，且原文完整保留', () => {
    const text = 'def deploy(name):  # 部署';
    const tree = LogLine({ line: line(text), language: '' });
    assert.equal(tokNodes(tree).length, 0, '纯文本模式不得产生任何 dsh-devops-tok-* span');
    assert.equal(textOf(tree), text, '纯文本模式必须原文输出');
    assert.equal(classOf(tree).includes('dsh-devops-logline'), true, '仍是日志行容器');

    // 对照：同内容在 python 模式下必须有 span（证明上面的 0 不是「本来就不着色」）
    const colored = LogLine({ line: line(text), language: 'python' });
    assert.ok(tokNodes(colored).length > 0, 'python 模式下同一行必须有 token span');
  });

  test('★ 语言切换真的改变着色结果（python vs javascript 同文本不同分类）', () => {
    const text = 'def deploy(name):';
    const py = tokKinds(LogLine({ line: line(text), language: 'python' }));
    const js = tokKinds(LogLine({ line: line(text), language: 'javascript' }));
    assert.ok(py.has('keyword'), 'python 下 def 应为 keyword');
    assert.ok(!js.has('keyword'), 'javascript 下 def 不应是 keyword，实际：' + [...js].join(','));
    assert.notDeepEqual([...py].sort(), [...js].sort(), '切换语言后分类集合必须变化');

    // resolveLanguage：auto 用识别结果，显式值覆盖识别，text 关闭
    assert.equal(resolveLanguage('auto', 'python'), 'python');
    assert.equal(resolveLanguage('javascript', 'python'), 'javascript');
    assert.equal(resolveLanguage('text', 'python'), '');
    assert.equal(resolveLanguage('js', 'python'), 'javascript', '别名 js 应归一为 javascript');
  });

  test('缩进与空行保真：行首空格、tab 不被吞掉', () => {
    const text = '    if x:';
    const tree = LogLine({ line: line(text), language: 'python' });
    assert.equal(textOf(tree), text, '行首缩进必须保留（缩进由 CSS 的 tab-size 呈现，不能在 JS 里改写文本）');
  });

  test('stderr 行带 data-stream，供 CSS 区分', () => {
    const tree = LogLine({ line: line('boom', 'stderr'), language: 'shell' });
    assert.equal(tree.props['data-stream'], 'stderr');
  });

  test('gap 行仍单独渲染提示（不回归）', () => {
    const tree = LogLine({ line: { gap: true, from: 1, to: 9 } });
    assert.equal(classOf(tree), 'dsh-devops-log-gap');
    assert.match(textOf(tree), /跳过了 seq 1 ~ 9/);
  });

  test('★ 过滤高亮与语法着色共存：mark 嵌在所属 token span 内部', () => {
    const tree = LogLine({ line: line('print("hello")'), language: 'python', filter: 'hello' });
    const marks = findAll(tree, (n) => n.type === 'mark');
    assert.equal(marks.length, 1, '命中的片段要有 mark');
    assert.equal(textOf(marks[0]), 'hello');
    const spans = tokNodes(tree);
    assert.ok(spans.length > 0, '过滤模式下语法着色不得消失');
    const wrapping = spans.filter((s) => (s.children || []).some((c) => c && c.type === 'mark'));
    assert.ok(wrapping.length >= 1, 'mark 必须嵌在 token span 内（否则会盖掉 token 颜色）');
    assert.equal(textOf(tree), 'print("hello")', '加高亮不得改变原文');
  });

  test('未命中过滤词时不产生 mark', () => {
    const tree = LogLine({ line: line('print(1)'), language: 'python', filter: 'zzz' });
    assert.equal(findAll(tree, (n) => n.type === 'mark').length, 0);
  });

  test('renderLineContent 在 token 边界处正确切分命中片段', () => {
    const nodes = renderLineContent({ text: 'abcHELLOdef' }, 'hello', 'python');
    const flat = [];
    const walk = (n) => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (!n || typeof n !== 'object') return;
      if (n.type === 'mark') flat.push(textOf(n));
      (n.children || []).forEach(walk);
    };
    walk(nodes);
    assert.deepEqual(flat, ['HELLO'], '命中应被完整切出（大小写不敏感）');
  });
});

/* --------------------------------------------------------- 面板级：语言切换 */

describe('LogPanel：自动识别 + 手动语言切换 + 既有能力（task-7）', () => {
  const PY_SOURCE = 'import os\n\ndef deploy(name):\n    print("hi", name)\n';

  function loadPanel(history, opts) {
    const stream = { handlers: null, closed: false };
    const loaded = loadLogs({
      extra: {
        './api.js': {
          api: {
            runLogs: async () => ({
              lines: history,
              next: 100,
              bytes: PY_SOURCE.length,
              lossy: !!(opts && opts.lossy),
            }),
          },
        },
        './sse.js': {
          createRunStream: (runId, handlers) => {
            stream.handlers = handlers;
            return { close() { stream.closed = true; } };
          },
        },
      },
    });
    return { loaded, stream };
  }

  const pyLines = PY_SOURCE.split('\n').map((text, i) => ({ seq: i + 1, ts: 0, stream: 'stdout', text }));

  async function mount(history, props) {
    const ctx = loadPanel(history, props);
    const { exports, hooks } = ctx.loaded;
    const baseProps = Object.assign({ runId: 'run-1', stepId: 'compile', live: false }, props || {});
    hooks.clear();
    let tree = exports.LogPanel(baseProps);
    await settle();
    await settle();
    hooks.reset();
    tree = exports.LogPanel(baseProps);
    return Object.assign(ctx, {
      tree,
      hooks,
      LogPanel: exports.LogPanel,
      baseProps,
      /** 重渲染（保留 state 格子）。 */
      rerender() {
        hooks.reset();
        return exports.LogPanel(baseProps);
      },
    });
  }

  test('★ 打开时自动识别语言（内容为 Python），并按该语言着色', async () => {
    const m = await mount(pyLines);
    const kinds = tokKinds(m.tree);
    assert.ok(kinds.has('keyword'), '自动识别为 python 后 def 应为 keyword，实际：' + [...kinds].join(','));
    assert.ok(kinds.has('comment') || kinds.has('function') || kinds.has('builtin'), '应有 python 语义分类');

    const select = findAll(m.tree, (n) => n.stub === 'Select')[0];
    assert.ok(select, '工具栏要有语言选择器');
    const auto = (select.props.options || []).find((o) => o.value === 'auto');
    assert.ok(auto, '选择器要有「自动」项');
    assert.match(String(auto.label), /python/, '「自动」项应显示识别结果，实际：' + auto.label);
    assert.equal(select.props.value, 'auto', '默认是自动模式');
  });

  test('★ 手动切「纯文本」后不再产生 tok span（并保持可切回）', async () => {
    const m = await mount(pyLines);
    assert.ok(tokNodes(m.tree).length > 0, '前置条件：python 模式下有着色');

    const select = findAll(m.tree, (n) => n.stub === 'Select')[0];
    select.props.onChange('text');
    await settle();

    m.hooks.reset();
    const plain = m.LogPanel({ runId: 'run-1', stepId: 'compile', live: false });
    assert.equal(tokNodes(plain).length, 0, '切纯文本后不得再产生 dsh-devops-tok-* span');
    assert.match(textOf(plain), /def deploy\(name\):/, '纯文本仍要显示日志内容');
    assert.equal(findAll(plain, (n) => n.stub === 'Select')[0].props.value, 'text', '选择器要反映当前语言');

    // 切回来
    findAll(plain, (n) => n.stub === 'Select')[0].props.onChange('python');
    await settle();
    m.hooks.reset();
    const again = m.LogPanel({ runId: 'run-1', stepId: 'compile', live: false });
    assert.ok(tokNodes(again).length > 0, '切回 python 后应重新着色');
  });

  test('★ 手动切到 javascript 后着色随之变化', async () => {
    const jsLines = [{ seq: 1, ts: 0, stream: 'stdout', text: 'const x = 1;' }];
    const m = await mount(jsLines);
    const before = tokKinds(m.tree);
    assert.ok(before.has('keyword'), 'javascript 下 const 应为 keyword，实际：' + [...before].join(','));

    findAll(m.tree, (n) => n.stub === 'Select')[0].props.onChange('shell');
    await settle();
    m.hooks.reset();
    const after = m.LogPanel({ runId: 'run-1', stepId: 'compile', live: false });
    assert.notDeepEqual([...tokKinds(after)].sort(), [...before].sort(), '切换语言后 token 分类必须变化');
  });

  test('工具栏：状态徽标 / 跟随 / 下载 / 跳末尾 / 刷新 / 行号开关 齐全', async () => {
    const m = await mount(pyLines);
    const labels = findAll(m.tree, (n) => n.stub === 'Button').map((b) => String(b.props.label || ''));
    for (const want of ['暂停跟随']) assert.ok(labels.includes(want), '缺少「' + want + '」，实际：' + labels.join(','));
    for (const want of ['下载', '跳末尾', '刷新']) assert.ok(labels.includes(want), '缺少「' + want + '」，实际：' + labels.join(','));
    const chip = findAll(m.tree, (n) => n.stub === 'TextInput');
    assert.ok(chip.length >= 1, '过滤框仍在');

    const btn = findAll(m.tree, (n) => n.stub === 'Button').find((b) => String(b.props.label || '').includes('行号'));
    assert.ok(btn, '要有行号开关');
    assert.equal(typeof btn.props.onClick, 'function');
  });

  test('★ 暂停跟随按钮切换为「继续跟随」；下载按钮带 handler', async () => {
    const m = await mount(pyLines);
    const followBtn = findAll(m.tree, (n) => n.stub === 'Button' && String(n.props.label) === '暂停跟随')[0];
    followBtn.props.onClick();
    m.hooks.reset();
    const paused = m.LogPanel({ runId: 'run-1', stepId: 'compile', live: false });
    assert.ok(
      findAll(paused, (n) => n.stub === 'Button').some((b) => String(b.props.label) === '继续跟随'),
      '暂停后应显示「继续跟随」',
    );

    const dl = findAll(m.tree, (n) => n.stub === 'Button' && String(n.props.label) === '下载')[0];
    assert.equal(typeof dl.props.onClick, 'function');
  });

  test('★ 行号可开关（默认开，关掉不产生行号节点）', async () => {
    const m = await mount(pyLines);
    const withNo = findAll(m.tree, (n) => classOf(n).includes('dsh-devops-logline-no'));
    assert.ok(withNo.length > 0, '默认应显示行号');
    const viewOn = findAll(m.tree, (n) => classOf(n) === 'dsh-devops-logview')[0];
    assert.equal(viewOn.props['data-lineno'], 'on', '默认 data-lineno=on');

    const toggle = findAll(m.tree, (n) => n.stub === 'Button').find((b) => String(b.props.label || '').includes('行号'));
    toggle.props.onClick();
    await settle();
    m.hooks.reset();
    const off = m.LogPanel({ runId: 'run-1', stepId: 'compile', live: false });
    assert.equal(findAll(off, (n) => classOf(n).includes('dsh-devops-logline-no')).length, 0, '关闭后不应有行号节点');
    assert.equal(findAll(off, (n) => classOf(n) === 'dsh-devops-logview')[0].props['data-lineno'], 'off');
  });

  test('关键字过滤：命中的行保留、未命中的行不渲染，且着色不丢', async () => {
    const m = await mount(pyLines);
    const input = findAll(m.tree, (n) => n.stub === 'TextInput')[0];
    input.props.onChange('deploy');
    m.hooks.reset();
    const filtered = m.LogPanel({ runId: 'run-1', stepId: 'compile', live: false });
    const text = textOf(filtered);
    assert.match(text, /def deploy\(name\):/, '命中行要在');
    assert.ok(!text.includes('import os'), '未命中行不应渲染');
    assert.ok(tokNodes(filtered).length > 0, '过滤后语法着色不得消失');
    assert.ok(findAll(filtered, (n) => n.type === 'mark').length >= 1, '命中片段要有 mark');
  });

  test('空态：无历史且未连接时给出「暂无日志输出」', async () => {
    const m = await mount([]);
    assert.match(textOf(m.tree), /暂无日志输出/);
  });

  test('连接中空态文案', async () => {
    const m = await mount([], { live: true });
    assert.match(textOf(m.tree), /正在连接日志流/);
  });

  test('lossy 提示仍在（内存环滚出）', async () => {
    const m = await mount(pyLines, { lossy: true });
    assert.match(textOf(m.tree), /日志已滚出内存环/);
  });

  test('★ SSE 实时流（无历史）累积若干行后也自动识别语言并着色', async () => {
    const m = await mount([], { live: true });
    assert.ok(m.stream.handlers, 'live 模式应挂上 SSE 流');
    assert.equal(tokKinds(m.tree).size, 0, '还没有日志时不应有着色内容');

    // 前几行不足以判断，但要能正常累积
    const feed = ['echo booting', 'git pull', 'npm ci', 'npm run build', 'node dist/index.js', 'python3 -c "print(1)"'];
    feed.forEach((text, i) => {
      m.stream.handlers.onEvent('log', { stepId: 'compile', seq: i + 1, ts: 0, stream: 'stdout', text: text });
    });
    await settle();
    const tree = m.rerender();

    // 第 6 行含 python3 -c，detectLanguage 会判成 shell（本行是 shell 命令），
    // 因此这里断言「识别已发生且着色生效」，而不是断言具体语言。
    assert.ok(tokNodes(tree).length > 0, '实时流达到采样行数后必须有语法 token span');
    assert.match(textOf(tree), /python3 -c/, '实时到达的行要显示出来');

    // 显式验证：识别结果落到「自动」选项上
    const select = findAll(tree, (n) => n.stub === 'Select')[0];
    assert.equal(select.props.value, 'auto');
  });

  test('★ SSE 实时流：gap 事件仍渲染断线提示，log 与 gap 混流不乱', async () => {
    const m = await mount([], { live: true });
    m.stream.handlers.onEvent('log', { stepId: 'compile', seq: 1, ts: 0, stream: 'stdout', text: 'def a():' });
    m.stream.handlers.onEvent('gap', { stepId: 'compile', from: 2, to: 8 });
    m.stream.handlers.onEvent('log', { stepId: 'compile', seq: 9, ts: 0, stream: 'stdout', text: '    return 1' });
    await settle();
    const tree = m.rerender();
    assert.match(textOf(tree), /跳过了 seq 2 ~ 8/, 'gap 行必须保留');
    assert.match(textOf(tree), /def a\(\):/, 'log 行必须在');
    assert.ok(tokNodes(tree).length > 0, '混流后仍有着色');
  });

  test('SSE 只接收本步骤的日志（stepId 过滤不回归）', async () => {
    const m = await mount([], { live: true });
    m.stream.handlers.onEvent('log', { stepId: 'other', seq: 1, ts: 0, stream: 'stdout', text: '别人的输出' });
    await settle();
    const tree = m.rerender();
    assert.ok(!textOf(tree).includes('别人的输出'), '不属于本步骤的日志不得混入');
  });

  test('★ 面板根/视图带 data-lang，供 CSS 决定终端底色', async () => {
    const m = await mount(pyLines);
    assert.equal(m.tree.props['data-lang'], 'python', '面板根应标出当前语言');
    const view = findAll(m.tree, (n) => classOf(n) === 'dsh-devops-logview')[0];
    assert.ok(view, '要有 .dsh-devops-logview 容器');
    assert.equal(view.props['data-lang'], 'python');
  });
});

/* --------------------------------------------------------------- 静态约束 */

describe('logs.js 静态约束', () => {
  const source = readFileSync(pluginPath('src', 'client', 'logs.js'), 'utf8');

  test('★ 颜色不写进 JS（由 CSS 决定）', () => {
    assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b/, '日志面板不得硬编码十六进制颜色（应由 styles.js 提供终端配色）');
    assert.doesNotMatch(source, /\bcolor\s*:/, '不得内联 color 样式');
    assert.doesNotMatch(source, /\bbackground\s*:/, '不得内联 background 样式');
  });

  test('★ 使用共享语法引擎 syntax.js，不自带 tokenizer 副本', () => {
    assert.match(source, /require\('\.\/syntax\.js'\)/, '必须复用共享语法引擎');
    assert.match(source, /dsh-devops-tok-' \+ token\.kind|dsh-devops-tok-/, 'token 类名前缀应为 dsh-devops-tok-');
  });

  test('★ 类名保持 .dsh-devops- 前缀', () => {
    for (const m of source.matchAll(/className:\s*'([^']+)'/g)) {
      for (const cls of m[1].split(/\s+/)) {
        if (cls) assert.ok(cls.startsWith('dsh-devops-'), '类名必须以 dsh-devops- 前缀：' + cls);
      }
    }
  });

  test('只依赖白名单模块（react / 相对路径）', () => {
    const requires = [...source.matchAll(/require\(\s*'([^']+)'\s*\)/g)].map((m) => m[1]);
    for (const spec of requires) {
      assert.ok(spec.startsWith('.'), '不得 require 第三方：' + spec);
    }
  });

  test('★ LogLine 不引入 hook（避免提前 return 后 hooks 数量变化）', () => {
    const start = source.indexOf('function LogLine(');
    const end = source.indexOf('\nfunction LogPanel(');
    assert.ok(start > 0 && end > start, '应能定位 LogLine 函数体');
    const body = source.slice(start, end);
    assert.doesNotMatch(body, /\buse[A-Z]\w*\s*\(/, 'LogLine 必须是纯函数，不得用 hook');
  });
});
