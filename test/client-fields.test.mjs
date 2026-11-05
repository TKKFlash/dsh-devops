// 回归：字段控件不能把宿主 Cordis context 当数据包读。
//
// 用户报告的症状：点击按钮后报错
//   cannot get property "snippets" without inject
//
// 根因：FieldControl 期望 props.ctx 是 { servers, envsets, snippets, defaultServer }
// 这样的纯数据包，但流水线编辑器 / 模板向导曾把宿主 ctx 原样传下去。
// Cordis context 对未 inject 的属性访问会直接抛错，于是渲染 shell.exec 的
// 「引用脚本片段」字段（ref:snippet）时整个面板被打进错误边界。
//
// 本用例不启浏览器：把 src/client/fields.js 放进带桩的迷你模块表里执行，
// 再用「访问未知属性即抛错」的 Proxy 精确模拟 Cordis context。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { pluginPath } from './helpers/modules.mjs';

const fieldsPath = pluginPath('src', 'client', 'fields.js');
const hasFields = existsSync(fieldsPath);

/** 渲染基元桩：h(Comp, props, ...children) 记成一棵可检查的树。 */
function makeH() {
  return (type, props, ...children) => ({ type, props: props || {}, children });
}

function stubComponent(name) {
  return function Stub() {
    return { stub: name };
  };
}

/** 在迷你模块表里加载 src/client/fields.js（与 scripts/build-client.mjs 的包裹方式一致）。 */
function loadFields() {
  const source = readFileSync(fieldsPath, 'utf8');
  const module = { exports: {} };
  // hooks 槽位：每次 loadFields 独立一份，避免用例之间互相污染。
  const slots = [];
  let cursor = 0;
  const stubs = {
    // 迷你 hooks 运行时：CodeControl 现在用 useState 控制「放大编辑」浮层，
    // 因此桩必须真的返回 [值, setter]（早先返回 undefined 会导致渲染直接抛错）。
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
    // 代码编辑器（code 字段）现在依赖共享语法着色引擎：装**真实实现**，
    // 这样被测的着色路径就是生产路径，而不是一个假桩。
    './syntax.js': loadSyntax(),
  };
  const requireStub = (id) => {
    if (!(id in stubs)) throw new Error('用例未覆盖的 fields.js 依赖：' + id);
    return stubs[id];
  };
  // 以「每个组件独立 hooks 运行时」的方式渲染，等价于 React 的一次挂载。
  cursor = 0;
  new Function('module', 'exports', 'require', source)(module, module.exports, requireStub);
  module.exports.__resetHooks = () => { cursor = 0; };
  module.exports.__slots = slots;
  return module.exports;
}

/** 载入真实的 src/client/syntax.js（零依赖，直接求值即可）。 */
function loadSyntax() {
  const syntaxSource = readFileSync(pluginPath('src', 'client', 'syntax.js'), 'utf8');
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', syntaxSource)(mod, mod.exports, () => {
    throw new Error('syntax.js 应当零依赖');
  });
  return mod.exports;
}

/** 精确模拟 Cordis context：读未知属性抛与宿主一致的错误。 */
function cordisCtx() {
  return new Proxy({}, {
    get(target, prop) {
      if (prop === 'then') return undefined;
      if (prop in target) return target[prop];
      throw new Error('cannot get property "' + String(prop) + '" without inject');
    },
  });
}

const FIELD_CASES = [
  { name: 'ref:snippet（shell.exec 引用脚本片段）', field: { name: 'snippetRef', label: '引用脚本片段', type: 'ref:snippet' } },
  { name: 'ref:envset（环境变量组引用）', field: { name: 'envSet', label: '环境变量组', type: 'ref:envset' } },
  { name: 'server（服务器选择）', field: { name: 'server', label: '服务器', type: 'server' } },
  { name: 'runtime（运行时版本）', field: { name: 'pythonVersion', label: 'Python 版本', type: 'runtime', runtime: 'python' } },
  { name: 'enum + optionsFrom=server', field: { name: 'server', type: 'enum', optionsFrom: 'server' } },
];

describe('字段控件数据上下文（"without inject" 回归）', { skip: hasFields ? false : '缺少 src/client/fields.js' }, () => {
  const { FieldControl } = hasFields ? loadFields() : { FieldControl: null };
  const render = (field, ctx, value = '') => FieldControl({ field, value, onChange() {}, ctx });

  test('★ 宿主 ctx 误传时不得抛错', () => {
    for (const c of FIELD_CASES) {
      assert.doesNotThrow(
        () => render(c.field, cordisCtx()),
        '字段 ' + c.name + ' 在宿主 ctx 下抛错（回归：cannot get property ... without inject）',
      );
    }
  });

  test('数据 ctx 正常生效：ref:snippet 把片段交给 RefControl', () => {
    const snippets = [{ id: 'snip-1', name: '构建脚本', body: 'npm ci' }];
    const tree = render({ name: 'snippetRef', type: 'ref:snippet' }, { snippets });
    const control = tree.children[0];
    assert.deepEqual(control.props.snippets, snippets);
  });

  test('数据 ctx 正常生效：server 字段来自 ctx.servers', () => {
    const servers = [{ id: 'local', name: '本机', kind: 'local' }, { id: 'prod', name: '生产' }];
    const tree = render({ name: 'server', type: 'server' }, { servers });
    const control = tree.children[0];
    assert.deepEqual(control.props.options.map((o) => o.value), ['local', 'prod']);
  });

  test('数据 ctx 正常生效：enum optionsFrom=server 取服务器 id', () => {
    const tree = render({ name: 'server', type: 'enum', optionsFrom: 'server' }, { servers: [{ id: 'prod' }] });
    const control = tree.children[0];
    assert.deepEqual(control.props.options, ['prod']);
  });
});

/** 调用点契约：App 构造 fieldCtx 并下发，FieldControl 只收数据包。 */
const clientSrc = (file) => readFileSync(pluginPath('src', 'client', file), 'utf8');

describe('字段控件 ctx 数据化（调用点契约）', { skip: hasFields ? false : '缺少客户端源码' }, () => {
  test('app.js 由 state 构造 fieldCtx 并进入 pageProps', () => {
    const app = clientSrc('app.js');
    assert.match(app, /const fieldCtx = useMemo\(/);
    assert.match(app, /defaultServer:/);
    assert.match(app, /fieldCtx,/);
  });

  test('editor.js / page-templates.js 把 fieldCtx 传给 FieldControl', () => {
    const editor = clientSrc('editor.js');
    assert.match(editor, /ctx:\s*props\.fieldCtx/);
    assert.match(editor, /fieldCtx:\s*props\.fieldCtx/);
    const tpl = clientSrc('page-templates.js');
    assert.match(tpl, /ctx:\s*props\.fieldCtx\s*\|\|\s*props\.ctx/);
    assert.match(tpl, /fieldCtx:\s*props\.fieldCtx/);
  });

  test('fields.js 不再直接读 props.ctx 上的数据键', () => {
    const fields = clientSrc('fields.js');
    assert.doesNotMatch(fields, /props\.ctx\s*&&\s*props\.ctx\./);
    assert.doesNotMatch(fields, /\bctx\.(servers|envsets|snippets|defaultServer)\b/);
  });
});

/**
 * 代码编辑器（code 字段）回归。
 *
 * 用户诉求：「编码编写框需要格式化，比如是黑色的符合Linux终端，可以识别 python 代码，
 * js，shell 等等，按不同编码颜色显示，和缩进加粗等等。」
 *
 * 实现是「着色高亮层 + 透明 textarea 叠加」，因此这里锁三件事：
 *  1) 真的产出了语法 token（走共享引擎，而非原来的极简着色）；
 *  2) 仍然保留可编辑的 textarea 且内容一致（不能为了着色牺牲编辑）；
 *  3) 两层结构齐备（高亮层 + 行号 + 容器），否则 CSS 无法对齐光标。
 */
describe('代码编辑器（code 字段）语法着色', { skip: hasFields ? false : '缺少 src/client/fields.js' }, () => {
  const mod = hasFields ? loadFields() : { CodeControl: null };
  const { CodeControl } = mod;
  // 每次渲染前重置 hooks 游标：等价于 React 的一次独立挂载。
  const render = (field, value) => {
    if (mod.__resetHooks) mod.__resetHooks();
    return CodeControl({ field, value, onChange() {} });
  };

  // 展开函数组件（等价于 React 渲染），否则 CodeSurface 这类子组件不会被遍历到。
  const walk = (node, acc = []) => {
    if (!node || typeof node !== 'object') return acc;
    if (Array.isArray(node)) {
      for (const child of node) walk(child, acc);
      return acc;
    }
    if (typeof node.type === 'function') {
      if (mod.__resetHooks) mod.__resetHooks();
      const rendered = node.type(Object.assign({}, node.props, { children: node.children }));
      return walk(rendered, acc);
    }
    acc.push(node);
    for (const child of node.children || []) walk(child, acc);
    return acc;
  };
  const tokensOf = (tree) =>
    walk(tree).filter((n) => String((n.props && n.props.className) || '').includes('dsh-devops-tok-'));
  const kindsOf = (tree) =>
    Array.from(
      new Set(tokensOf(tree).map((n) => String(n.props.className).replace('dsh-devops-tok dsh-devops-tok-', ''))),
    ).sort();

  test('★ Python 代码产出语法 token（关键字/注释/数字/内置等分类）', () => {
    const tree = render({ language: 'python', rows: 4 }, 'def f(x):\n    # 注释\n    return x + 1\nprint(f(2))');
    const kinds = kindsOf(tree);
    assert.ok(kinds.includes('keyword'), 'Python 代码应有 keyword token');
    assert.ok(kinds.includes('comment'), 'Python 代码应有 comment token');
    assert.ok(kinds.includes('number'), 'Python 代码应有 number token');
    assert.ok(kinds.includes('builtin'), 'print 应被识别为内置');
    assert.ok(tokensOf(tree).length >= 8, '应产出足量 token，实际 ' + tokensOf(tree).length);
  });

  test('★ Shell 代码产出内置命令与变量 token', () => {
    const tree = render({ language: 'shell', rows: 3 }, 'echo "hi $NAME" | grep -v x');
    const kinds = kindsOf(tree);
    assert.ok(kinds.includes('builtin'), 'echo/grep 应是内置');
    assert.ok(kinds.includes('variable'), '$NAME 应是变量');
    assert.ok(kinds.includes('operator'), '管道应是操作符');
  });

  test('★ JavaScript 代码产出关键字与注释 token', () => {
    const tree = render({ language: 'javascript', rows: 3 }, 'const x = await fetch(url); // go');
    const kinds = kindsOf(tree);
    assert.ok(kinds.includes('keyword') && kinds.includes('comment'));
  });

  test('★ 着色不牺牲可编辑性：保留 textarea 且 value 原样', () => {
    const code = 'a=1\nb=2';
    const tree = render({ language: 'python', rows: 4 }, code);
    const areas = walk(tree).filter((n) => n.type === 'textarea');
    assert.equal(areas.length, 1, '必须有且只有一个可编辑 textarea');
    assert.equal(areas[0].props.value, code, 'textarea 的值必须与传入一致');
    assert.equal(areas[0].props.spellCheck, false, '代码不应开拼写检查');
  });

  test('★ 叠加结构齐备：高亮层 + 行号 + 容器（CSS 靠它对齐光标）', () => {
    const tree = render({ language: 'shell', rows: 6 }, 'echo hi');
    const classes = walk(tree).map((n) => String((n.props && n.props.className) || ''));
    assert.ok(classes.some((c) => c.includes('dsh-devops-code-hl')), '缺少高亮层 .dsh-devops-code-hl');
    assert.ok(classes.some((c) => c.includes('dsh-devops-code-shell')), '缺少叠加容器 .dsh-devops-code-shell');
    assert.ok(classes.some((c) => c.includes('dsh-devops-code-gutter')), '缺少行号栏');
    assert.ok(classes.some((c) => c.includes('dsh-devops-code-area')), '缺少输入层');
  });

  test('行号数量跟随 rows 与内容行数的较大者', () => {
    const tree = render({ language: 'shell', rows: 6 }, 'one\ntwo');
    const linenos = walk(tree).filter((n) => String((n.props && n.props.className) || '').includes('dsh-devops-code-lineno'));
    assert.equal(linenos.length, 6, 'rows=6 且内容 2 行时，行号应补齐到 6');
  });

  test('语言标注落到容器上（供 CSS 按语言微调）', () => {
    const tree = render({ language: 'py', rows: 2 }, 'x=1');
    assert.equal(tree.props['data-language'], 'python', 'py 应归一为 python');
  });

  test('空值与未知语言不抛错', () => {
    assert.doesNotThrow(() => render({ language: 'python' }, ''));
    assert.doesNotThrow(() => render({ language: 'no-such' }, 'abc'));
  });
});


/**
 * 用户抱怨：「不是一个悬浮的抽屉拉出来，然后这么窄一个，拉也不能拉宽，
 * 如果在代码那里我写了很多，就这么小一个框你让我怎么看？」
 *
 * 因此锁死两件事：编辑器检查器**可拖拽调宽 / 可收起**，
 * 以及代码框**可自动增高 + 一键放大到全屏编辑器**。
 */
describe('可调整尺寸（用户抱怨「拉也不能拉宽」）', { skip: hasFields ? false : '缺少 src/client/fields.js' }, () => {
  const mod = hasFields ? loadFields() : null;
  const editorSrc = readFileSync(pluginPath('src', 'client', 'editor.js'), 'utf8');
  const stylesSrc = readFileSync(pluginPath('src', 'client', 'styles.js'), 'utf8');

  test('★ 检查器提供可拖拽分隔条（resizer）与收起/展开入口', () => {
    assert.match(editorSrc, /dsh-devops-inspector-resizer/, '必须有可拖拽的分隔条');
    assert.match(editorSrc, /onMouseDown:\s*startResize/, '分隔条必须绑定拖拽开始');
    assert.match(editorSrc, /onDoubleClick:\s*toggleWide/, '分隔条应支持双击切换宽窄');
    assert.match(editorSrc, /dsh-devops-inspector-rail/, '收起后必须有展开入口');
    assert.match(editorSrc, /inspector-collapse/, '检查器头部必须有收起按钮');
  });

  test('★ 宽度可调且被持久化（localStorage），并有上下限', () => {
    assert.match(editorSrc, /INSPECTOR_MIN\s*=\s*\d+/, '必须有最小宽度常量');
    assert.match(editorSrc, /INSPECTOR_MAX\s*=\s*\d+/, '必须有最大宽度常量');
    assert.match(editorSrc, /localStorage\.setItem/, '宽度应被记住');
    assert.match(editorSrc, /localStorage\.getItem/, '宽度应被读取');
    // 拖拽计算方向：面板在右侧，向左拖应变宽
    assert.match(editorSrc, /startWidth\s*-\s*\(x\s*-\s*startX\)/, '拖拽方向计算必须正确（向左拖变宽）');
  });

  test('★ 拖拽宽度用内联 style 生效，而不是被固定 CSS 覆盖', () => {
    assert.match(editorSrc, /dsh-devops-inspector-host/, '检查器需要被 host 包裹以承载宽度');
    assert.match(editorSrc, /width:\s*inspectorWidth\s*\+/, 'host 宽度必须绑定 inspectorWidth');
    // 旧的固定宽度规则必须让位于 host（否则拖拽无效）
    assert.match(stylesSrc, /\.dsh-devops-inspector-host\{/, 'CSS 必须定义 host');
  });

  test('★ 代码框有自动增高与放大编辑浮层', () => {
    assert.match(stylesSrc, /dsh-devops-code-full/, 'CSS 必须有放大编辑浮层');
    assert.match(stylesSrc, /dsh-devops-code-full-backdrop/, '浮层必须有遮罩');
    assert.match(stylesSrc, /dsh-devops-code\[data-fill="true"\]/, '浮层内代码区应撑满');
  });

  test('★ 放大编辑：打开浮层后可关闭，且 Esc 能关闭', () => {
    const { CodeControl } = mod;
    const render = (field, value) => {
      if (mod.__resetHooks) mod.__resetHooks();
      return CodeControl({ field, value, onChange() {} });
    };
    const tree = render({ language: 'shell', rows: 4 }, 'echo hi');
    const all = [];
    const collect = (n) => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) { n.forEach(collect); return; }
      if (typeof n.type === 'function') { if (mod.__resetHooks) mod.__resetHooks(); collect(n.type(Object.assign({}, n.props, { children: n.children }))); return; }
      all.push(n);
      (n.children || []).forEach(collect);
    };
    collect(tree);
    const classes = all.map((n) => String((n.props && n.props.className) || ''));
    assert.ok(classes.some((c) => c.includes('dsh-devops-code-toolbar')), '代码框应有工具条（含放大入口）');
    assert.ok(classes.some((c) => c.includes('dsh-devops-code-lang')), '工具条应显示语言');
    // 默认未展开时，浮层不应被挂载
    assert.ok(!classes.some((c) => c.includes('dsh-devops-code-full-backdrop')), '默认不应挂载全屏浮层');
    // 源码层面：Esc 关闭 + 遮罩点击关闭
    const fieldsSrc = readFileSync(pluginPath('src', 'client', 'fields.js'), 'utf8');
    assert.match(fieldsSrc, /Escape[\s\S]{0,80}setExpanded\(false\)/, 'Esc 应能关闭放大编辑');
    assert.match(fieldsSrc, /dsh-devops-code-full-backdrop/, '遮罩点击应能关闭');
  });
});
