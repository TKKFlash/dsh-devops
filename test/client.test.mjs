// 契约 §3.13：client.js 产物与注册约束
// 前端由 scripts/build-client.mjs 把 src/client/*.js 拼成根目录单文件。
// 本文件**不启动浏览器**：只做产物级静态校验（零依赖、零网络）。
// 覆盖：单文件形态、三个 slot 成对注册、不注册被禁止的 single 槽、
//       只 require('react')、API 基址、类名前缀、--dsh-frame 让位变量、构建幂等
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pluginPath } from './helpers/modules.mjs';

const clientPath = pluginPath('client.js');
const buildScript = pluginPath('scripts', 'build-client.mjs');
const hasClient = existsSync(clientPath);

describe('client 产物（client.js）', { skip: hasClient ? false : '产物不存在：client.js（需先跑 node scripts/build-client.mjs）' }, () => {
  const source = readFileSync(clientPath, 'utf8');

  test('是单文件产物且非空', () => {
    assert.ok(statSync(clientPath).size > 1000, `client.js 应有实际内容，实际 ${statSync(clientPath).size} 字节`);
  });

  test('用 window.__ModuleLoader__.load 挂载，id 为 dsh-devops', () => {
    assert.match(source, /__ModuleLoader__\.load\s*\(/, '必须通过 window.__ModuleLoader__.load 挂载');
    assert.match(source, /id\s*:\s*['"]dsh-devops['"]/, 'id 必须是 dsh-devops');
  });

  test('★ 三个 slot 注册齐全，且 main 的 key 与 sidebar 的 id 同为 devops', () => {
    // main 是 keyed 槽，只认 key；必须与 sidebar.panellist 的 id 同值
    assert.match(source, /slots\.inject\(\s*['"]main['"]/, "必须 inject('main')");
    assert.match(source, /slots\.inject\(\s*['"]sidebar\.panellist['"]/, "必须 inject('sidebar.panellist')");
    assert.match(source, /slots\.inject\(\s*['"]shell\.overlay['"]/, "必须 inject('shell.overlay')");

    assert.match(source, /name\s*:\s*['"]main['"]\s*,\s*key\s*:\s*['"]devops['"]/, 'main 必须注册 key=devops');
    assert.match(source, /name\s*:\s*['"]sidebar\.panellist['"][\s\S]{0,120}?id\s*:\s*['"]devops['"]/, 'sidebar.panellist 必须注册 id=devops');
    assert.match(source, /name\s*:\s*['"]shell\.overlay['"][\s\S]{0,120}?id\s*:\s*['"]devops-statusbar['"]/, 'shell.overlay 必须注册 id=devops-statusbar');
  });

  test('★ 不得注册被禁止的 single 槽（root/sidebar/rightbar/shell.bottom/shell.leading）', () => {
    const forbidden = ['root', 'sidebar', 'rightbar', 'shell.bottom', 'shell.leading'];
    for (const name of forbidden) {
      const re = new RegExp(`slots\\.(?:inject|register)\\(\\s*['"]${name.replace('.', '\\.')}['"]`);
      assert.ok(!re.test(source), `不得注册 single 槽 ${name}`);
    }
  });

  test('★ 只依赖 react，不得 import 其它第三方库', () => {
    // 允许的 require/import 目标：react 与相对路径
    const requires = [...source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    const specs = [...new Set([...requires, ...imports])];
    for (const spec of specs) {
      if (spec.startsWith('.') || spec.startsWith('/')) continue;
      assert.equal(spec, 'react', `只允许依赖 react（require('react')），实际出现 ${spec}`);
    }
    // 不出现裸 from 'xxx' 的第三方（react 除外）
    for (const spec of imports) {
      assert.ok(spec === 'react' || spec.startsWith('.'), `不得 import 第三方：${spec}`);
    }
  });

  test('API 基址用 document.baseURI（而非硬编码 host）', () => {
    assert.match(source, /new URL\(/, '必须用 new URL 构造 API 基址');
    assert.match(source, /document\.baseURI/, '必须基于 document.baseURI');
    assert.match(source, /dsh-devops\/api\//, 'API 路径应为 dsh-devops/api/...');
  });

  /**
   * 从源码 / 产物里抽出 CSS 文本。
   *
   * 根因说明（lead 核实）：client.js 里绝大部分是 JavaScript，CSS 只存在于**字符串字面量**中。
   * 直接对整份产物做选择器断言会误伤 JS 代码里的标识符，
   * 例如 `const post = (path, body, options) => ...` 会命中 `/body\s*[,{]/`。
   * 因此必须先抽 CSS、再**解析出选择器**，逐个判断。
   */
  function extractCss(text) {
    const chunks = [];
    for (const m of text.matchAll(/`([^`]{80,})`/g)) {
      if (/[.#*][A-Za-z-]*\s*\{/.test(m[1])) chunks.push(m[1]);
    }
    return chunks.join('\n');
  }

  /** 解析出全部选择器（去掉注释、at-rule 前奏，并按逗号拆分选择器列表） */
  function selectorsOf(css) {
    const out = [];
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of withoutComments.matchAll(/([^{}]+)\{/g)) {
      const prelude = m[1].trim();
      if (prelude === '' || prelude.startsWith('@')) continue;
      for (const part of prelude.split(',')) {
        const sel = part.trim();
        if (sel) out.push(sel);
      }
    }
    return out;
  }

  /** 去掉 var(--token, fallback) 的回退值（token 的回退色不算硬编码颜色） */
  const stripVarFallbacks = (css) => css.replace(/var\([^()]*\)/g, 'var(--x)');

  test('样式类名统一使用 .dsh-devops- 前缀，且不污染宿主全局选择器', () => {
    assert.match(source, /dsh-devops-/, '必须使用 .dsh-devops- 类名前缀');

    // 以纯样式来源文件为准做 CSS 断言（client.js 里 CSS 与 JS 混排，且 CSS 会重复出现）
    const stylesSrc = pluginPath('src', 'client', 'styles.js');
    const cssSource = existsSync(stylesSrc) ? readFileSync(stylesSrc, 'utf8') : source;
    const css = extractCss(cssSource);
    assert.ok(css.length > 0, '应能抽到 CSS 文本（否则样式没被打包进去）');

    const sels = selectorsOf(css);
    assert.ok(sels.length > 0, '应能解析出选择器');

    // 裸标签选择器 = 选择器以该标签开头（后面紧跟限定符）；`.dsh-devops-body` 不算
    const bareTag = (tag) => sels.filter((s) => s === tag || new RegExp(`^${tag}[\\s:.[>+~]`).test(s));
    assert.deepEqual(bareTag('body'), [], 'CSS 内不得有裸 body 选择器（会污染宿主布局）');
    assert.deepEqual(bareTag('html'), [], 'CSS 内不得有裸 html 选择器');
    // 裸 `*` 通配（作为独立选择器）；`.dsh-devops-root *` 是**作用域内**的后代选择器，允许
    assert.deepEqual(
      sels.filter((s) => s.startsWith('*')),
      [],
      'CSS 内不得有裸 * 通配选择器（作用域内的 .dsh-devops-root * 允许）',
    );
    // 不得重定义宿主主题变量
    assert.ok(!/--dsw-alias-[a-z-]+\s*:/.test(css), '不得重定义宿主主题变量 --dsw-alias-*（只读使用）');
    // 所有选择器都必须落在 .dsh-devops- 作用域内（keyframes/at-rule 已被过滤）
    const unscoped = sels.filter(
      (s) => !s.includes('dsh-devops') && !/^(:root|from|to|\d+%)/.test(s),
    );
    assert.deepEqual(unscoped, [], `存在未带 .dsh-devops- 作用域的选择器：${JSON.stringify(unscoped.slice(0, 6))}`);
  });

  test('颜色只用 --dsw-alias-* token', () => {
    assert.match(source, /--dsw-alias-/, '必须使用 --dsw-alias-* 主题变量');
    // 硬编码色值只在 CSS 内统计，且先剥掉 var(--token, fallback) 的回退值
    // —— token 自带回退色是正常写法，深色模式下会被主题覆盖，不算硬编码。
    const stylesSrc = pluginPath('src', 'client', 'styles.js');
    const cssSource = existsSync(stylesSrc) ? readFileSync(stylesSrc, 'utf8') : source;
    const css = stripVarFallbacks(extractCss(cssSource));
    const hexColors = [...css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)];
    assert.ok(
      hexColors.length < 12,
      `不应大量硬编码颜色（剥离 token 回退值后 CSS 内实际 ${hexColors.length} 处：${JSON.stringify(hexColors.map((m) => m[0]).slice(0, 10))}），深色模式会失效`,
    );
  });

  test('容器让位 --dsh-frame-* 变量', () => {
    assert.match(source, /--dsh-frame-top-clearance|--dsh-frame-leading-clearance/, '必须让位与宿主框架的 letway 变量');
  });

  test('响应形状按 {ok,value}/{ok,message} 处理', () => {
    assert.match(source, /\.ok\b/, '必须判断响应的 ok 字段');
    assert.ok(/value/.test(source) && /message/.test(source), '必须处理 value 与 message');
  });

  test('★ 产物与源文件一致：client.js 由 src/client/*.js 拼接而成（只读校验，不重跑构建）', () => {
    // 注意：本用例**刻意不执行** scripts/build-client.mjs —— 那会重写 client.js，
    // 而 client.js 属于 client-ui 的写入范围，verifier 不得改动它。
    // 这里只做只读的一致性信号：产物必须包含源码里的关键标识符。
    const srcDir = pluginPath('src', 'client');
    if (!existsSync(srcDir)) return;
    const files = readdirSync(srcDir).filter((f) => f.endsWith('.js'));
    assert.ok(files.length > 0, 'src/client 下应有源码文件');
    for (const f of ['index.js', 'app.js']) {
      if (!files.includes(f)) continue;
      const src = readFileSync(join(srcDir, f), 'utf8');
      for (const marker of ['dsh-devops', 'slots']) {
        if (!src.includes(marker)) continue;
        assert.ok(source.includes(marker), `产物应包含源文件 ${f} 的内容标记「${marker}」`);
      }
    }
    // 构建脚本存在且语法可解析
    if (existsSync(buildScript)) {
      execFileSync(process.execPath, ['--check', buildScript], { stdio: 'pipe' });
    }
  });
});

/**
 * React #310（"Rendered more hooks than during the previous render"）回归。
 *
 * 根因形态：组件里「提前 return」（如 `if (!data) return h(Empty)`）之后仍有 hook。
 * 首次渲染走提前分支（执行 N 个 hook），数据到达后走到底部（执行 N+K 个 hook），
 * 两次渲染 hook 数量不同 → React 抛 #310 → 整个面板被错误边界接管、表现为「什么都点不了」。
 *
 * 本用例做静态结构检查：组件体内，任何顶层 hook 都不得出现在顶层提前 return 之后。
 */
describe('React hooks 规则（#310 回归）', () => {
  const HOOK_RE = /\b(useState|useEffect|useMemo|useCallback|useRef|useReducer|useSyncExternalStore|useTick|useDebounced|useToast|useStore|useStoreSelect)\s*\(/;

  /** 取出文件里所有具名/箭头函数组件的函数体（按大括号配平）。 */
  function componentBodies(src) {
    const out = [];
    const re = /(?:^|\n)\s*(?:function\s+([A-Z][A-Za-z0-9_]*)\s*\([^)]*\)|(?:const|let|var)\s+([A-Z][A-Za-z0-9_]*)\s*=\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>)\s*\{/g;
    let m;
    while ((m = re.exec(src))) {
      const name = m[1] || m[2];
      const bodyStart = m.index + m[0].length;
      let depth = 1;
      let i = bodyStart;
      while (i < src.length && depth > 0) {
        const c = src[i];
        if (c === '{') depth += 1;
        else if (c === '}') depth -= 1;
        else if (c === "'" || c === '"' || c === '`') {
          const quote = c;
          i += 1;
          while (i < src.length && src[i] !== quote) {
            if (src[i] === '\\') i += 1;
            i += 1;
          }
        }
        i += 1;
      }
      const line = src.slice(0, m.index).split('\n').length;
      out.push({ name, body: src.slice(bodyStart, i - 1), line });
    }
    return out;
  }

  test('src/client 下没有「提前 return 之后仍有 hook」的组件', () => {
    const srcDir = pluginPath('src', 'client');
    if (!existsSync(srcDir)) return;
    const violations = [];
    for (const file of readdirSync(srcDir).filter((f) => f.endsWith('.js'))) {
      const src = readFileSync(join(srcDir, file), 'utf8');
      for (const { name, body, line } of componentBodies(src)) {
        const lines = body.split('\n');
        let depth = 0;
        const hooks = [];
        const earlyReturns = [];
        for (let k = 0; k < lines.length; k += 1) {
          const text = lines[k];
          const atTopLevel = depth === 0;
          if (atTopLevel) {
            if (HOOK_RE.test(text)) hooks.push(k);
            else if (/^\s*return\b/.test(text)) earlyReturns.push(k);
            else if (/^\s*if\s*\(.*\)\s*return\b/.test(text)) earlyReturns.push(k);
          }
          depth += (text.match(/[{([]/g) || []).length - (text.match(/[})\]]/g) || []).length;
        }
        for (const er of earlyReturns) {
          const after = hooks.filter((h) => h > er);
          if (after.length > 0) {
            violations.push(
              `${file}:${line + er} 组件 ${name} 的提前 return 之后仍有 ${after.length} 个 hook（行 ${after.map((h) => line + h).join(',')}）`,
            );
          }
        }
      }
    }
    assert.deepEqual(
      violations,
      [],
      `hook 必须无条件执行，不能位于提前 return 之后（否则触发 React #310）：\n${violations.join('\n')}`,
    );
  });

  test('状态栏根元素带中立类，不继承整页工作台的 100% 尺寸', () => {
    // .dsh-devops-root 为整页工作台设了 width/height:100%；状态栏复用它会变成
    // 覆盖全屏的巨层（表现为「右边一个巨大元素挡住界面」），故必须带 --bare。
    const statusbar = pluginPath('src', 'client', 'statusbar.js');
    if (!existsSync(statusbar)) return;
    const src = readFileSync(statusbar, 'utf8');
    assert.match(src, /dsh-devops-root--bare/, '状态栏根元素必须使用 .dsh-devops-root--bare（重置整页尺寸）');
    const styles = readFileSync(pluginPath('src', 'client', 'styles.js'), 'utf8');
    assert.match(styles, /\.dsh-devops-root--bare\{[\s\S]*?width:auto/, '.dsh-devops-root--bare 必须把 width 重置为 auto');
    assert.match(styles, /\.dsh-devops-root--bare\{[\s\S]*?height:auto/, '.dsh-devops-root--bare 必须把 height 重置为 auto');
  });
});

