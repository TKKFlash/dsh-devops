// 视觉设计升级回归（task-6）：令牌层 + 参考实现的设计语言。
//
// 参考实现（Jackson-chen97/dsh-devops 的 src/client/theme.ts 与 DevopsUI.module.css）
// 的设计语言抽取要点，逐条固化为可复跑的断言：
//   1) 令牌层：每一项都是 var(<宿主 token>, <回退>)，只读消费 --dsw-alias-*；
//   2) 徽标：color-mix 淡色底 + 同色文字（而非描边 + 文字色）；
//   3) 页签：下划线指示条（::after + data-active）；
//   4) 空态：虚线边框卡片，hover 变色；
//   5) 按钮：胶囊圆角 + hover/active/disabled 过渡；
//   6) 动效统一时长/缓动，且 prefers-reduced-motion 关闭动效。
//
// 本文件只读 styles.js 文本，不启动浏览器、不依赖网络。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { pluginPath } from './helpers/modules.mjs';

const stylesPath = pluginPath('src', 'client', 'styles.js');
const hasStyles = existsSync(stylesPath);

describe('视觉令牌层（参考 theme.ts 的桥接设计）', { skip: hasStyles ? false : 'styles.js 不存在' }, () => {
  const css = readFileSync(stylesPath, 'utf8');

  /** 取出根作用域的令牌层声明块。 */
  function rootBlock() {
    const i = css.indexOf('.dsh-devops-root{');
    assert.ok(i >= 0, '应有 .dsh-devops-root{ 令牌层声明块');
    const open = css.indexOf('{', i);
    const close = css.indexOf('}', open);
    return css.slice(open + 1, close);
  }

  /** 解析根块里的自定义属性声明：name -> value */
  function tokenDecls(block) {
    const out = new Map();
    for (const m of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out.set(m[1], m[2].trim());
    return out;
  }

  test('★ 令牌层挂在 .dsh-devops-root 作用域内（而非裸 body/:root）', () => {
    const i = css.indexOf('.dsh-devops-root{');
    assert.ok(i >= 0, '令牌必须声明在 .dsh-devops-root 上');
    // 不得出现裸 body / :root 选择器（会长到宿主上）
    assert.doesNotMatch(css, /(^|[},])\s*:root\s*\{/m, '不得用 :root 声明令牌');
    assert.doesNotMatch(css, /(^|[},])\s*body\s*\{/m, '不得用裸 body 声明令牌');
  });

  /**
   * 纯本地尺度常量：宿主没有对应 token（胶囊圆角、过渡时长、缓动曲线），
   * 参考实现同样写死字面量。**语义位（颜色/背景/边框/阴影/字号）不得进此清单**，
   * 否则深色模式会失效——这正是本用例要防的。
   */
  const LOCAL_ONLY_TOKENS = new Set(['--dv-r-pill', '--dv-t-fast', '--dv-t', '--dv-t-slow', '--dv-ease']);

  /**
   * 刻意固定的调色板：--dv-term-*（终端）与 --dv-tok-*（语法 token）。
   * 用户明确要求「黑色的 Linux 终端」「按不同编码颜色显示」——它们**必须自带颜色、
   * 不跟随宿主浅色主题**，所以写固定色值是正确的设计而不是疏漏。
   * 这里也是全表硬编码色值的集中收敛点：规则里只 var() 复用，hex 总量受红线约束。
   */
  const FIXED_PALETTE_PREFIXES = ['--dv-term-', '--dv-tok-'];

  test('★ 全部 --dv-* 令牌都走 var(...) 形式，宿主 token 缺失时用回退色', () => {
    const decls = tokenDecls(rootBlock());
    const dv = [...decls.keys()].filter((k) => k.startsWith('--dv-'));
    assert.ok(dv.length >= 20, '令牌层应覆盖足够多的语义位（实际 ' + dv.length + ' 项）');
    const notVar = dv.filter((k) => {
      if (LOCAL_ONLY_TOKENS.has(k)) return false;
      if (FIXED_PALETTE_PREFIXES.some((p) => k.startsWith(p))) return false;
      const v = decls.get(k);
      // 允许 calc(...) 包裹 var()（字号尺度 delta），其余必须走 var(...)
      return !(v.startsWith('var(') || (v.includes('var(') && v.trim().endsWith(')')));
    });
    assert.deepEqual(notVar, [], '这些令牌未走 var() 形式：' + notVar.join(', '));
    // 反向保护：语义位不许被塞进豁免清单
    const exempt = [...LOCAL_ONLY_TOKENS, ...dv.filter((k) => FIXED_PALETTE_PREFIXES.some((p) => k.startsWith(p)))];
    for (const k of exempt) {
      assert.ok(!/^--dv-(border|fg|caption|surface|inset|input-bg|code-bg|primary|accent|btn|hover|active|mask|blur|ok|warn|err|busy|idle|toast|elev|font)\b/.test(k), k + ' 属语义位，不得豁免 var() 形式');
    }
  });

  test('★ 终端调色板自带深色（不得引用会随浅色主题变白的宿主 token）', () => {
    const decls = tokenDecls(rootBlock());
    const termBg = decls.get('--dv-term-bg');
    assert.ok(termBg, '必须有 --dv-term-bg（终端主底）');
    assert.match(termBg, /^#[0-9a-f]{3,8}$/i, '终端主底必须是固定深色值，不能跟随主题：' + termBg);
    const termFg = decls.get('--dv-term-fg');
    assert.match(termFg, /^#[0-9a-f]{3,8}$/i, '终端主文字必须是固定浅色值：' + termFg);
    // 亮度比较：底必须明显暗于字（粗糙但有效的「深底浅字」校验）
    const lum = (hex) => {
      const s = String(hex).replace('#', '');
      const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    assert.ok(lum(termBg) < 0.2, '终端底应足够暗（实测亮度 ' + lum(termBg).toFixed(3) + '）');
    assert.ok(lum(termFg) > 0.6, '终端字应足够浅（实测亮度 ' + lum(termFg).toFixed(3) + '）');
    // 日志/代码区不得再用跟随主题的 code-bg 作为底色
    assert.doesNotMatch(css, /\.dsh-devops-logview\{[^}]*var\(--dv-code-bg\)/, '日志区不得用跟随主题的 --dv-code-bg');
    assert.match(css, /\.dsh-devops-logview\{[^}]*background:var\(--dv-term-bg\)/, '日志区必须用终端深色底');
    assert.match(css, /\.dsh-devops-code\{[^}]*background:var\(--dv-term-bg\)/, '代码框必须用终端深色底');
  });

  test('★ 令牌覆盖 border/fg/surface/accent/ok/warn/err/elevation/font 等语义位', () => {
    const keys = [...tokenDecls(rootBlock()).keys()];
    const groups = {
      border: ['--dv-border', '--dv-border-2', '--dv-border-3', '--dv-border-4'],
      fg: ['--dv-fg', '--dv-fg-2', '--dv-fg-3', '--dv-fg-4'],
      surface: ['--dv-surface', '--dv-surface-2', '--dv-surface-3', '--dv-input-bg'],
      accent: ['--dv-primary', '--dv-accent'],
      state: ['--dv-ok', '--dv-warn', '--dv-err', '--dv-busy'],
      elevation: ['--dv-elev-1', '--dv-elev-2'],
      font: ['--dv-font', '--dv-font-sm', '--dv-font-xs', '--dv-font-lg'],
      motion: ['--dv-t', '--dv-t-fast', '--dv-ease'],
      radius: ['--dv-r-sm', '--dv-r-md', '--dv-r-lg', '--dv-r-xl', '--dv-r-pill'],
    };
    for (const [group, list] of Object.entries(groups)) {
      const missing = list.filter((k) => !keys.includes(k));
      assert.deepEqual(missing, [], group + ' 语义位缺少令牌：' + missing.join(', '));
    }
  });

  test('★ 不得重定义宿主 --dsw-alias-* token（只读消费）', () => {
    assert.doesNotMatch(css, /--dsw-alias-[a-z0-9-]+\s*:/, '不得定义 --dsw-alias-* 变量');
  });

  test('★ 令牌值引用的宿主 token 必须真实属于 --dsw-* 命名空间', () => {
    const decls = tokenDecls(rootBlock());
    const bad = [];
    for (const [name, value] of decls) {
      for (const m of value.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) {
        const ref = m[1];
        if (!ref.startsWith('--dv-') && !ref.startsWith('--dsw-') && !ref.startsWith('--dsh-')) bad.push(name + ' → ' + ref);
      }
    }
    assert.deepEqual(bad, [], '令牌引用了非宿主编排变量的来源：' + bad.join(', '));
  });
});

describe('组件观感（参考 DevopsUI.module.css 的设计语言）', { skip: hasStyles ? false : 'styles.js 不存在' }, () => {
  const css = readFileSync(stylesPath, 'utf8');

  /** 取某条规则体（首个匹配选择器）。 */
  function ruleBody(selector) {
    const idx = css.indexOf(selector);
    if (idx < 0) return '';
    const open = css.indexOf('{', idx);
    const close = css.indexOf('}', open);
    return css.slice(open + 1, close);
  }

  test('★ 按钮是胶囊圆角，且 hover/active/disabled 有过渡', () => {
    const btn = ruleBody('.dsh-devops-btn{');
    assert.match(btn, /border-radius:var\(--dv-r-pill\)/, '主按钮应为胶囊圆角');
    assert.match(btn, /transition:/, '按钮应有过渡');
    assert.match(css, /\.dsh-devops-btn:hover:not\(:disabled\)/, '按钮应有 hover 态');
    assert.match(css, /\.dsh-devops-btn:active:not\(:disabled\)/, '按钮应有 active 态');
    assert.match(css, /\.dsh-devops-btn:disabled/, '按钮应有 disabled 态');
    // ghost 变体用交互底色而非边框
    assert.match(css, /\.dsh-devops-btn\[data-variant="ghost"\]\{border-color:transparent/, 'ghost 变体应无边框');
  });

  test('★ 徽标用 color-mix 淡色底 + 同色文字（ok/warn/error/busy）', () => {
    const chip = ruleBody('.dsh-devops-chip{');
    assert.match(chip, /color-mix\(in srgb/, '徽标底色应使用 color-mix');
    for (const tone of ['ok', 'warn', 'error', 'busy']) {
      const sel = '.dsh-devops-chip[data-tone="' + tone + '"]{';
      const body = ruleBody(sel);
      assert.ok(body, '应有 ' + tone + ' 色调徽标规则');
      assert.match(body, /color-mix\(in srgb/, tone + ' 徽标应用 color-mix 淡色底');
      assert.match(body, /color:var\(--dv-/, tone + ' 徽标应用同色 token 文字');
      // 不应再靠描边表达状态
      assert.doesNotMatch(body, /border-color:/, tone + ' 徽标不应靠描边表达状态');
    }
  });

  test('★ 页签有下划线指示条与 hover 底色', () => {
    assert.match(css, /\.dsh-devops-tab\{/, '应有页签类 .dsh-devops-tab');
    assert.match(css, /\.dsh-devops-tab::after\{/, '页签应有 ::after 指示条');
    const after = ruleBody('.dsh-devops-tab::after{');
    assert.match(after, /height:2px/, '指示条应有厚度');
    assert.match(after, /background:var\(--dv-accent\)/, '指示条应用 accent token');
    assert.match(after, /opacity:0/, '默认应隐藏指示条');
    assert.match(css, /\.dsh-devops-tab\[data-active="true"\]::after\{opacity:1\}/, '选中页签应显示指示条');
    assert.match(css, /\.dsh-devops-tab:hover\{/, '页签应有 hover 底色');
  });

  test('★ 空态是虚线边框卡片，且 hover 变色', () => {
    const empty = ruleBody('.dsh-devops-empty{');
    assert.match(empty, /dashed/, '空态应为虚线边框');
    assert.match(empty, /border-radius:var\(--dv-r-lg\)/, '空态应为卡片圆角');
    assert.match(css, /\.dsh-devops-empty:hover\{/, '空态应有 hover');
  });

  test('★ 卡片/面板有统一圆角与 0.5px 边框、层级背景', () => {
    for (const sel of ['.dsh-devops-card{', '.dsh-devops-column{', '.dsh-devops-stepcard{']) {
      const body = ruleBody(sel);
      assert.ok(body, sel + ' 规则应存在');
      assert.match(body, /0\.5px solid/, sel + ' 应用 0.5px 边框');
      assert.match(body, /border-radius:var\(--dv-r-/, sel + ' 应用统一圆角令牌');
    }
  });

  test('★ 弹层使用 elevation 阴影与遮罩 token（不再是硬编码阴影）', () => {
    const modal = ruleBody('.dsh-devops-modal{');
    assert.match(modal, /box-shadow:var\(--dv-elev-2\)/, '弹层应用 elevation 令牌');
    const backdrop = ruleBody('.dsh-devops-modal-backdrop{');
    assert.match(backdrop, /background:var\(--dv-mask\)/, '遮罩应用 mask 令牌');
    assert.match(backdrop, /backdrop-filter:var\(--dv-blur\)/, '遮罩应带模糊 token');
  });

  test('★ 全局动效统一时长与缓动，并尊重 prefers-reduced-motion', () => {
    assert.match(css, /--dv-t:\s*\.?\d/, '应定义统一过渡时长令牌');
    assert.match(css, /--dv-ease:/, '应定义统一缓动令牌');
    assert.match(css, /@media \(prefers-reduced-motion:reduce\)/, '应有 reduced-motion 媒体查询');
    // 该媒体查询必须同时关闭 animation 与 transition
    const start = css.lastIndexOf('@media (prefers-reduced-motion:reduce)');
    const block = css.slice(start, css.indexOf('}', css.indexOf('{', start)) + 1);
    assert.match(block, /animation:none/, 'reduce 下应关闭 animation');
    assert.match(block, /transition:none/, 'reduce 下应关闭 transition');
  });

  test('★ 零第三方：不得出现动画/样式库痕迹', () => {
    assert.doesNotMatch(css, /animate\.css|framer-motion|gsap|@?tailwind/i, '不得引入第三方动画/样式库');
  });

  test('★ 保留让位变量与既有类名兼容（不破坏画布成果）', () => {
    assert.match(css, /--dsh-frame-top-clearance|--dsh-frame-leading-clearance/, '必须保留 --dsh-frame-* 让位变量');
    for (const legacy of ['.dsh-devops-root--bare', '.dsh-devops-column{', '.dsh-devops-nodecard{', '.dsh-devops-board{']) {
      assert.ok(css.indexOf(legacy) >= 0, '应保留既有类：' + legacy);
    }
  });
});

/**
 * task-9 的四块可见设计：深色终端、语法调色板、状态色体系、悬浮抽屉卡片。
 * 这些是用户这轮的核心诉求（上一轮"只换了变量、看不出效果"），必须可断言。
 */
describe('可见视觉体系（深色终端 / 语法调色板 / 状态色 / 悬浮抽屉）', { skip: hasStyles ? false : 'styles.js 不存在' }, () => {
  const css = readFileSync(stylesPath, 'utf8');

  /**
   * 取某条规则体。先剥掉注释，再从**行首**锚定选择器：
   * 否则 '.dsh-devops-tok{' 会命中组合/后代选择器的尾部，取到别的规则体。
   * 本项目的 CSS 每条规则都独占行首，这个锚定是准确的。
   */
  const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  function ruleBody(selector) {
    // 允许调用方带或不带结尾的 '{'，这里统一剥掉，避免拼出「两个大括号」的正则。
    const clean = selector.replace(/\{\s*$/, '').trim();
    const esc = clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = cssNoComments.match(new RegExp('(?:^|\\n)\\s*' + esc + '\\s*\\{([^{}]*)\\}'));
    return m ? m[1] : '';
  }

  test('★ 代码框是深色终端双层结构，且 textarea 透明可见光标', () => {
    assert.match(ruleBody('.dsh-devops-code{'), /background:var\(--dv-term-bg\)/, '代码框必须深色底');
    const shell = ruleBody('.dsh-devops-code-shell{');
    assert.match(shell, /position:relative/, '叠加容器须 relative（高亮层绝对定位的锚点）');
    const hl = ruleBody('.dsh-devops-code-hl{');
    assert.match(hl, /position:absolute/, '高亮层须绝对定位');
    assert.match(hl, /pointer-events:none/, '高亮层不得拦截鼠标');
    assert.match(hl, /margin:0/, 'pre 默认 margin 必须清掉，否则两层错位');
    // 两层必须同字号/行高/内边距：都引用同一组终端令牌
    assert.match(hl, /font-size:inherit/, '高亮层字号应继承容器');
    assert.match(hl, /line-height:inherit/, '高亮层行高应继承容器');
    const area = ruleBody('.dsh-devops-code-area{');
    assert.match(area, /color:transparent/, 'textarea 文字必须透明，否则会盖住着色层');
    assert.match(area, /caret-color:var\(--dv-term-fg\)/, '光标必须可见（否则"打字看不见字"）');
    assert.match(area, /background:transparent/, 'textarea 背景必须透明');
    assert.match(area, /padding:var\(--dv-term-pad-y\) var\(--dv-term-pad-x\)/, 'textarea 内边距须与高亮层一致');
    assert.match(css, /\.dsh-devops-code-area::selection\{/, '应有选区样式');
  });

  test('★ 日志视图深色终端：深底、浅字、等宽、pre-wrap、tab-size', () => {
    const view = ruleBody('.dsh-devops-logview{');
    assert.match(view, /background:var\(--dv-term-bg\)/, '日志区必须深色底');
    assert.match(view, /color:var\(--dv-term-fg\)/, '日志区必须浅色字');
    assert.match(view, /font-family:var\(--dv-term-font\)/, '日志区必须等宽终端字体');
    assert.match(view, /white-space:pre-wrap/, '必须保留缩进与换行');
    assert.match(view, /tab-size:2/, 'tab 按 2 空格显示（只能靠 CSS）');
    assert.doesNotMatch(view, /--dv-code-bg/, '日志区不得回退到跟随主题的 code-bg');
    // 工具栏与面板同样深色，避免"浅色工具栏配黑底"割裂
    assert.match(ruleBody('.dsh-devops-logbar{'), /background:var\(--dv-term-bg-2\)/, '工具栏应深色');
    assert.match(ruleBody('.dsh-devops-logpanel{'), /background:var\(--dv-term-bg\)/, '面板应深色');
  });

  test('★ 语法 token 调色板：9 个 kind 齐全，注释斜体，色相可区分', () => {
    const kinds = ['plain', 'keyword', 'string', 'comment', 'number', 'function', 'operator', 'builtin', 'variable', 'type'];
    for (const k of kinds) {
      const body = ruleBody('.dsh-devops-tok-' + k + '{');
      assert.ok(body, '缺少 token 类 .dsh-devops-tok-' + k);
      assert.match(body, /color:var\(--dv-tok-/, k + ' 应用 token 调色板变量');
    }
    assert.match(ruleBody('.dsh-devops-tok{'), /color:inherit/, '.dsh-devops-tok 基类应继承行色');
    assert.match(ruleBody('.dsh-devops-tok-comment{'), /font-style:italic/, '注释必须斜体');
    // keyword / builtin / type 三者色相必须不同（用户要求按编码类型区分颜色）
    const colorOf = (k) => (ruleBody('.dsh-devops-tok-' + k + '{').match(/color:var\((--dv-tok-[a-z]+)\)/) || [])[1];
    const trio = [colorOf('keyword'), colorOf('builtin'), colorOf('type')];
    assert.ok(trio.every(Boolean), 'keyword/builtin/type 都必须取到颜色变量：' + JSON.stringify(trio));
    assert.equal(new Set(trio).size, 3, 'keyword/builtin/type 不得共用同一个颜色：' + JSON.stringify(trio));
    // 调色板定义集中在令牌层
    const i = css.indexOf('.dsh-devops-root{');
    const rootDecls = css.slice(i, css.indexOf('}', i));
    for (const name of ['--dv-tok-keyword', '--dv-tok-string', '--dv-tok-comment', '--dv-tok-number', '--dv-tok-function', '--dv-tok-builtin', '--dv-tok-operator', '--dv-tok-variable', '--dv-tok-type']) {
      assert.ok(rootDecls.includes(name), '调色板应定义在令牌层：' + name);
    }
  });

  test('★ stderr 与过滤高亮在深底上可读，且不覆盖 token 色', () => {
    assert.match(css, /\.dsh-devops-logline\[data-stream="stderr"\]/, 'stderr 行应有独立配色');
    const mark = ruleBody('.dsh-devops-logview mark,.dsh-devops-logline mark{');
    assert.match(mark, /background:var\(--dv-term-mark\)/, '命中高亮应用深底可读的半透明底色');
    assert.match(mark, /color:inherit/, 'mark 不得覆盖 token 字色');
    assert.match(css, /\.dsh-devops-log-gap\{/, '断线提示行应存在');
    assert.match(ruleBody('.dsh-devops-log-gap{'), /background:var\(--dv-term-bg-3\)/, 'gap 行应深底而不是白底');
  });

  test('★ 状态色体系：卡片左侧色条 + 极淡底，running 呼吸，五态可辨', () => {
    const statuses = {
      running: '--dv-busy',
      success: '--dv-ok',
      failed: '--dv-err',
      canceled: '--dv-warn',
      pending: '--dv-idle',
    };
    /** 取「包含该选择器的那条规则体」——选择器可能是多行组合列表。 */
    function ruleContaining(fragment) {
      const at = cssNoComments.indexOf(fragment);
      if (at < 0) return '';
      const open = cssNoComments.indexOf('{', at);
      const close = cssNoComments.indexOf('}', open);
      if (open < 0 || close < 0) return '';
      return cssNoComments.slice(open + 1, close);
    }
    for (const [status, token] of Object.entries(statuses)) {
      const rule = ruleContaining('.dsh-devops-nodecard[data-status="' + status + '"]');
      assert.ok(rule, '节点卡应有 [data-status="' + status + '"] 规则');
      assert.ok(rule.includes('border-left:3px solid var(' + token + ')'), status + ' 应有左侧状态色条 ' + token);
    }
    // data-tone 同义可用
    assert.match(css, /\.dsh-devops-nodecard\[data-tone="busy"\]/, '应支持 data-tone 写法');
    // 极淡色底
    const run = ruleContaining('.dsh-devops-nodecard[data-status="running"]');
    assert.match(run, /color-mix\(in srgb,var\(--dv-busy\) \d+%/, 'running 卡应带极淡色底');
    assert.match(run, /animation:dsh-devops-breathe/, 'running 卡应带呼吸动画');
    assert.match(css, /@keyframes dsh-devops-breathe/, '应有呼吸动画 keyframes');
    // 阶段列头 + 步骤卡也吃状态色
    assert.match(css, /\.dsh-devops-column\[data-status="running"\] \.dsh-devops-column-head/, '阶段列头应可着色');
    assert.match(css, /\.dsh-devops-stepcard\[data-status="failed"\]/, '步骤卡应有状态色');
    // 列表状态点 / 徽标
    assert.match(css, /\.dsh-devops-dot\[data-tone="idle"\]/, '状态点应覆盖 idle');
    assert.match(css, /\.dsh-devops-chip\[data-tone="info"\]/, '徽标应有 info 语义色');
  });

  test('★ 抽屉改为圆角悬浮卡片，而非贴右边缘的全高面板', () => {
    assert.match(css, /\.dsh-devops-drawer-layer\[data-shape="floating"\]/, '应有 floating 抽屉层');
    const floating = ruleBody('.dsh-devops-drawer[data-variant="floating"]{');
    assert.ok(floating, '应有 floating 抽屉卡片规则');
    assert.match(floating, /border-radius:var\(--dv-r-xl\)/, '悬浮卡片应大圆角');
    assert.match(floating, /border:0.5px solid var\(--dv-border-2\)/, '悬浮卡片应有细边框');
    assert.match(floating, /box-shadow:var\(--dv-elev-2\)/, '悬浮卡片应有 elevation 阴影');
    assert.match(floating, /height:auto/, '悬浮卡片高度应自适应（不再 100%）');
    assert.match(floating, /max-height:calc\(100d?vh - \d+px\)/, '高度应受视口约束');
    assert.match(floating, /transform:translateX\(calc\(100% \+ \d+px\)\)/, '起步位移应脱离右边缘');
    // 打开时归位
    assert.match(css, /\.dsh-devops-drawer-layer\[data-open="true"\] \.dsh-devops-drawer\[data-variant="floating"\]\{transform:none\}/, '打开时应归位');
    // 遮罩半透明 + 模糊
    assert.match(ruleBody('.dsh-devops-drawer-mask{'), /backdrop-filter:var\(--dv-blur\)/, '遮罩应带轻微模糊');
    // 原始值面板与终端呼应
    const raw = ruleBody('.dsh-devops-drawer-raw{');
    assert.match(raw, /background:var\(--dv-term-bg\)/, '原始值面板应为深色终端底');
    assert.match(raw, /font-family:var\(--dv-term-font\)/, '原始值面板应等宽');
    // reduced-motion 覆盖呼吸与抽屉
    const start = css.lastIndexOf('@media (prefers-reduced-motion:reduce)');
    const block = css.slice(start);
    assert.match(block, /dsh-devops-drawer/, 'reduce 下应覆盖抽屉过渡');
    assert.match(block, /dsh-devops-nodecard/, 'reduce 下应关闭状态卡动画');
  });

  test('★ 新增的终端配套类都有定义（队友声明过但不写样式）', () => {
    for (const cls of ['.dsh-devops-langselect', '.dsh-devops-loglines', '.dsh-devops-logline-text',
      '.dsh-devops-logline-no', '.dsh-devops-code-lineno', '.dsh-devops-code-hline']) {
      assert.ok(css.indexOf(cls) >= 0, '缺少终端配套类定义：' + cls);
    }
  });
});
