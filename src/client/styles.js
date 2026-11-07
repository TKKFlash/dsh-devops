/**
 * 样式：一次性注入 <style>，类名前缀 .dsh-devops-，颜色只用 --dsw-alias-* token。
 * 深色模式无需额外处理——token 自身随主题切换。
 *
 * 设计语言抽取自参考实现（src/client/theme.ts + DevopsUI.module.css）：
 * 令牌层全部 var(<宿主 token>, <回退>)；胶囊按钮；color-mix 淡色徽标；
 * tab 下划线指示条；虚线空态卡；elevation 阴影。**只读消费 --dsw-alias-*，不重定义。**
 */

/** 只在首次调用时插入样式标签，重复调用无副作用。 */
function ensureStyles() {
  const ID = 'dsh-devops-style';
  if (document.getElementById(ID)) return;
  const style = document.createElement('style');
  style.id = ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

// 注意：r-lg / r-xl 用 fallback 串起来，兼容不同版本的 token 集合。
// 令牌层挂在 .dsh-devops-root 上而非 body/:root：主面板与状态栏根元素都带该类，
// 且宿主令牌是 body 级声明，作用域在这里才能稳定继承。
const CSS = `
.dsh-devops-root{
  /* ── 令牌层：每一项都是 var(<宿主 token>, <回退>)，宿主换肤/换主题整体跟随 ── */
  --dv-r-sm: var(--dsw-radius-sm, 6px);
  --dv-r-md: var(--dsw-radius-md, 8px);
  --dv-r-lg: var(--dsw-radius-lg, 12px);
  --dv-r-xl: var(--dsw-radius-panel, 16px);
  --dv-r-pill: 999px;
  --dv-border: var(--dsw-alias-border-l1, rgba(0,0,0,.06));
  --dv-border-2: var(--dsw-alias-border-l2, rgba(0,0,0,.1));
  --dv-border-3: var(--dsw-alias-border-l3, rgba(0,0,0,.14));
  --dv-border-4: var(--dsw-alias-border-l4, rgba(0,0,0,.18));
  --dv-fg: var(--dsw-alias-label-primary, #0f1115);
  --dv-fg-2: var(--dsw-alias-label-secondary, #61666b);
  --dv-fg-3: var(--dsw-alias-label-tertiary, #81858c);
  --dv-fg-4: var(--dsw-alias-label-dimmed, #b9bec6);
  --dv-caption: var(--dsw-alias-label-caption, #9aa0a6);
  --dv-surface: var(--dsw-alias-bg-layer-1, transparent);
  --dv-surface-2: var(--dsw-alias-bg-layer-2, transparent);
  --dv-surface-3: var(--dsw-alias-bg-layer-3, transparent);
  --dv-inset: var(--dsw-alias-bg-module-platform, var(--dsw-alias-bg-layer-2, transparent));
  --dv-input-bg: var(--dsw-alias-bg-layer-1, transparent);
  --dv-code-bg: var(--dsw-alias-markdown-code-block, transparent);
  --dv-primary: var(--dsw-alias-brand-primary, var(--dsw-alias-button-primary-fill, #4176e6));
  --dv-accent: var(--dsw-alias-state-business-primary, #4176e6);
  --dv-btn: var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary, #0f1115));
  --dv-btn-hover: var(--dsw-alias-button-primary-hover, var(--dsw-alias-brand-primary, #43454a));
  --dv-btn-fg: var(--dsw-alias-label-primary-foreground, #ffffff);
  --dv-hover: var(--dsw-alias-interactive-bg-hover, rgba(38,49,72,.06));
  --dv-active: var(--dsw-alias-interactive-bg-active, var(--dsw-alias-interactive-bg-hover, rgba(38,49,72,.1)));
  --dv-mask: var(--dsw-alias-bg-mask-1, rgba(0,0,0,.28));
  --dv-blur: var(--dsw-mask-blur, blur(2px));
  --dv-ok: var(--dsw-alias-state-success-primary, #22c55e);
  --dv-warn: var(--dsw-alias-state-warn-primary, #f59e0b);
  --dv-err: var(--dsw-alias-state-error-primary, #ec1313);
  --dv-err-soft: var(--dsw-alias-state-error-secondary, #f25a5a);
  --dv-busy: var(--dsw-alias-state-business-primary, #4176e6);
  --dv-idle: var(--dsw-alias-state-idle-primary, #9aa0a6);
  --dv-toast-bg: var(--dsw-alias-toast-bg, var(--dsw-alias-bg-layer-3, #353638));
  --dv-toast-fg: var(--dsw-alias-toast-label, var(--dsw-alias-label-primary, #f9fafb));
  --dv-elev-1: var(--dsw-elevation-panel, 0 4px 16px rgba(0,0,0,.16));
  --dv-elev-2: var(--dsw-elevation-prominent, 0 12px 40px rgba(0,0,0,.28));
  --dv-code-font: var(--dsw-font-family-code, monospace);
  --dv-font-xs: calc(10px + var(--dsh-content-font-delta, 0px));
  --dv-font-sm: var(--dsh-content-font-size-secondary, 12px);
  --dv-font: var(--dsh-content-font-size, 13px);
  --dv-font-lg: calc(15px + var(--dsh-content-font-delta, 0px));
  --dv-font-xl: calc(18px + var(--dsh-content-font-delta, 0px));
  --dv-t-fast: .12s;
  --dv-t: .16s;
  --dv-t-slow: .24s;
  --dv-ease: cubic-bezier(.2,.7,.3,1);

  /* ─────────────────────────────────────────────────────────────────────
     终端调色板：**自带深色，不跟随宿主主题变白**（用户明确要"黑色的 Linux 终端"）。
     固定色值集中在此定义，规则里只 var()/color-mix 复用——这样硬编码色值总量可控，
     且深浅主题下终端始终是深底浅字。
     ───────────────────────────────────────────────────────────────────── */
  --dv-term-bg: #0d1117;                                             /* 终端主底 */
  --dv-term-bg-2: color-mix(in srgb,var(--dv-term-bg) 88%,white);     /* 工具栏/行号槽 */
  --dv-term-bg-3: color-mix(in srgb,var(--dv-term-bg) 78%,white);     /* gap 提示条 */
  --dv-term-line: color-mix(in srgb,var(--dv-term-bg) 70%,white);     /* 终端内分隔线 */
  --dv-term-fg: #d6deeb;                                             /* 终端主文字 */
  --dv-term-dim: color-mix(in srgb,var(--dv-term-fg) 58%,var(--dv-term-bg));  /* 行号/次要 */
  --dv-term-stderr: #ff7b72;                                         /* stderr 偏红 */
  --dv-term-sel: color-mix(in srgb,var(--dv-term-fg) 24%,transparent);/* 选区 */
  --dv-term-mark: color-mix(in srgb,var(--dv-warn) 38%,transparent);  /* 过滤命中底 */
  --dv-term-font: var(--dsw-font-family-code,ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",Menlo,monospace);
  --dv-term-fs: 12.5px;
  --dv-term-lh: 1.6;
  --dv-term-pad-y: 8px;
  --dv-term-pad-x: 10px;

  /* ── 语法 token 调色板（syntax.js 的 kind → 类名）。深底上的可读色相，参考 One Dark。── */
  --dv-tok-keyword: #c792ea;   /* 关键字：紫 */
  --dv-tok-string: #c3e88d;    /* 字符串：绿 */
  --dv-tok-number: #f78c6c;    /* 数字：橙 */
  --dv-tok-function: #82aaff;  /* 函数：蓝 */
  --dv-tok-operator: #89ddff;  /* 运算符：青 */
  --dv-tok-builtin: #ffcb6b;   /* 内置：琥珀 */
  --dv-tok-variable: #7fdbca;  /* 变量：青绿 */
  --dv-tok-type: color-mix(in srgb,var(--dv-tok-builtin) 62%,white); /* 类型：浅黄（与内置拉开） */
  --dv-tok-comment: var(--dv-term-dim);                              /* 注释：灰（斜体） */
  --dv-tok-plain: var(--dv-term-fg);
  box-sizing:border-box;
  display:flex;
  min-height:0;
  height:100%;
  width:100%;
  color:var(--dv-fg);
  background:var(--dsw-alias-bg-base);
  font-size:var(--dv-font);
  line-height:20px;
}
.dsh-devops-root *,.dsh-devops-root *::before,.dsh-devops-root *::after{box-sizing:border-box}
.dsh-devops-root button{font-family:inherit}

/* ---------- 页内二级导航 ---------- */
.dsh-devops-nav{
  flex:none;width:132px;display:flex;flex-direction:column;gap:2px;
  padding:calc(var(--dsh-frame-top-clearance,0px) + 8px) 8px 12px 12px;
  border-right:0.5px solid var(--dv-border-3);
  overflow-y:auto;
}
.dsh-devops-nav-item{
  display:flex;align-items:center;gap:8px;width:100%;min-height:30px;padding:4px 8px;
  border:none;background:transparent;color:var(--dv-fg-2);border-radius:var(--dv-r-md);
  cursor:pointer;font-size:var(--dv-font);text-align:left;
  transition:background-color var(--dv-t) var(--dv-ease),color var(--dv-t) var(--dv-ease);
}
.dsh-devops-nav-item:hover{background:var(--dv-hover);color:var(--dv-fg)}
.dsh-devops-nav-item[data-active="true"]{background:var(--dv-active);color:var(--dv-fg);font-weight:500}
.dsh-devops-nav-dot{
  flex:none;display:inline-flex;align-items:center;justify-content:center;
  width:18px;height:18px;font-size:var(--dv-font);
}

/* ---------- 主区 ---------- */
.dsh-devops-main{flex:1;min-width:0;display:flex;flex-direction:column;min-height:0}
.dsh-devops-head{
  flex:none;display:flex;align-items:center;gap:10px;flex-wrap:wrap;
  padding:calc(var(--dsh-frame-top-clearance,0px) + 10px) 16px 10px 16px;
  border-bottom:0.5px solid var(--dv-border-3);
}
.dsh-devops-title{font-size:var(--dv-font-lg);font-weight:600;color:var(--dv-fg);margin:0}
.dsh-devops-sub{color:var(--dv-fg-3);font-size:var(--dv-font-sm)}
.dsh-devops-spacer{flex:1}
.dsh-devops-body{flex:1;min-height:0;overflow:auto;padding:14px 16px 24px 16px}
.dsh-devops-body[data-flush="true"]{padding:0;overflow:hidden;display:flex;flex-direction:column}

/* ---------- 状态条（页内） ---------- */
.dsh-devops-statusbar-inline{
  flex:none;display:flex;align-items:center;gap:12px;flex-wrap:wrap;
  padding:5px 16px;font-size:var(--dv-font-sm);color:var(--dv-fg-3);
  border-bottom:0.5px solid var(--dv-border-3);
  background:var(--dv-surface);
}
/* 徽标：淡色底 + 同色文字（color-mix），替代原先「描边 + 文字色」的单调写法 */
.dsh-devops-chip{
  display:inline-flex;align-items:center;gap:5px;padding:1px 8px;border-radius:var(--dv-r-pill);
  border:0.5px solid transparent;font-size:var(--dv-font-xs);font-weight:500;
  color:var(--dv-fg-2);background:color-mix(in srgb,var(--dv-fg-3) 14%,transparent);
  transition:background-color var(--dv-t) var(--dv-ease),color var(--dv-t) var(--dv-ease);
}
.dsh-devops-chip[data-tone="ok"]{color:var(--dv-ok);background:color-mix(in srgb,var(--dv-ok) 14%,transparent)}
.dsh-devops-chip[data-tone="warn"]{color:var(--dv-warn);background:color-mix(in srgb,var(--dv-warn) 16%,transparent)}
.dsh-devops-chip[data-tone="error"]{color:var(--dv-err-soft);background:color-mix(in srgb,var(--dv-err-soft) 14%,transparent)}
.dsh-devops-chip[data-tone="busy"]{color:var(--dv-busy);background:color-mix(in srgb,var(--dv-busy) 14%,transparent)}
.dsh-devops-dot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--dv-idle)}
.dsh-devops-dot[data-tone="ok"]{background:var(--dv-ok)}
.dsh-devops-dot[data-tone="warn"]{background:var(--dv-warn)}
.dsh-devops-dot[data-tone="error"]{background:var(--dv-err)}
.dsh-devops-dot[data-tone="busy"]{background:var(--dv-busy);animation:dsh-devops-pulse 1.2s ease-in-out infinite}
@keyframes dsh-devops-pulse{0%,100%{opacity:.35}50%{opacity:1}}

/* ---------- 通用控件：胶囊按钮 ---------- */
.dsh-devops-btn{
  display:inline-flex;align-items:center;justify-content:center;gap:6px;
  min-height:28px;padding:4px 12px;border-radius:var(--dv-r-pill);cursor:pointer;
  border:0.5px solid var(--dv-border);background:transparent;color:var(--dv-fg);
  font-size:var(--dv-font-sm);font-weight:500;white-space:nowrap;
  transition:background-color var(--dv-t) var(--dv-ease),border-color var(--dv-t) var(--dv-ease),
    color var(--dv-t) var(--dv-ease),box-shadow var(--dv-t) var(--dv-ease),transform var(--dv-t-fast) var(--dv-ease);
}
.dsh-devops-btn:hover:not(:disabled){background:var(--dv-hover);border-color:var(--dv-border-3)}
.dsh-devops-btn:active:not(:disabled){background:var(--dv-active);transform:translateY(0.5px)}
.dsh-devops-btn:focus-visible{outline:2px solid color-mix(in srgb,var(--dv-accent) 55%,transparent);outline-offset:1px}
.dsh-devops-btn:disabled{opacity:.45;cursor:default}
.dsh-devops-btn[data-variant="primary"]{
  background:var(--dv-btn);border-color:transparent;color:var(--dv-btn-fg);
  box-shadow:0 1px 2px rgba(0,0,0,.12);
}
.dsh-devops-btn[data-variant="primary"]:hover:not(:disabled){background:var(--dv-btn-hover);border-color:transparent}
.dsh-devops-btn[data-variant="primary"]:active:not(:disabled){background:var(--dv-btn-hover)}
.dsh-devops-btn[data-variant="danger"]{
  color:var(--dv-err-soft);border-color:transparent;
  background:color-mix(in srgb,var(--dv-err-soft) 12%,transparent);
}
.dsh-devops-btn[data-variant="danger"]:hover:not(:disabled){background:color-mix(in srgb,var(--dv-err-soft) 20%,transparent);border-color:transparent}
.dsh-devops-btn[data-variant="ghost"]{border-color:transparent;color:var(--dv-fg-2)}
.dsh-devops-btn[data-variant="ghost"]:hover:not(:disabled){background:var(--dv-hover);color:var(--dv-fg);border-color:transparent}
.dsh-devops-btn[data-size="sm"]{min-height:22px;padding:2px 9px;font-size:var(--dv-font-xs)}
.dsh-devops-btn[data-active="true"]{background:var(--dv-active);border-color:var(--dv-border-3);color:var(--dv-fg)}
.dsh-devops-input,.dsh-devops-select,.dsh-devops-textarea{
  /* min-width:0/max-width:100%：检查器很窄时控件必须能被压缩，
     否则会撑出横向滚动条（截图里"执行条件/服务器"被挤到看不见就是这个原因）。 */
  width:100%;min-width:0;max-width:100%;min-height:28px;padding:3px 9px;border-radius:var(--dv-r-md);
  border:0.5px solid var(--dv-border-2);background:var(--dv-input-bg);
  color:var(--dv-fg);font-size:var(--dv-font-sm);font-family:inherit;outline:none;
  transition:border-color var(--dv-t) var(--dv-ease),box-shadow var(--dv-t) var(--dv-ease),background-color var(--dv-t) var(--dv-ease);
}
.dsh-devops-input:hover:not(:disabled),.dsh-devops-select:hover:not(:disabled),.dsh-devops-textarea:hover:not(:disabled){border-color:var(--dv-border-3)}
.dsh-devops-input:focus,.dsh-devops-select:focus,.dsh-devops-textarea:focus{
  border-color:var(--dv-accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--dv-accent) 22%,transparent);
}
.dsh-devops-textarea{min-height:64px;resize:vertical;line-height:18px}
.dsh-devops-input::placeholder,.dsh-devops-textarea::placeholder{color:var(--dv-caption)}
.dsh-devops-select{cursor:pointer}
.dsh-devops-switch{
  position:relative;width:34px;height:18px;border-radius:var(--dv-r-pill);flex:none;cursor:pointer;
  border:0.5px solid var(--dv-border);background:var(--dv-surface-2);padding:0;
  transition:background-color var(--dv-t) var(--dv-ease),border-color var(--dv-t) var(--dv-ease);
}
.dsh-devops-switch[data-on="true"]{background:var(--dv-primary);border-color:transparent}
.dsh-devops-switch span{
  position:absolute;top:1px;left:1px;width:14px;height:14px;border-radius:50%;
  background:var(--dsw-alias-switch-thumb,#fff);
  transition:left var(--dv-t) var(--dv-ease);
}
.dsh-devops-switch[data-on="true"] span{left:17px}

/* ---------- 字段 / 检查器 ---------- */
.dsh-devops-field{display:flex;flex-direction:column;gap:4px;margin-bottom:10px}
.dsh-devops-field-head{display:flex;align-items:center;gap:6px;font-size:var(--dv-font-sm);color:var(--dv-fg-2)}
.dsh-devops-field-label{font-weight:500;color:var(--dv-fg)}
.dsh-devops-required{color:var(--dv-err)}
.dsh-devops-field-desc{font-size:var(--dv-font-xs);color:var(--dv-fg-3);line-height:16px}
.dsh-devops-field-row{display:flex;gap:6px;align-items:center;min-width:0;flex-wrap:wrap}
.dsh-devops-field-row>*{min-width:0}
.dsh-devops-field-error{font-size:var(--dv-font-xs);color:var(--dv-err-soft)}
.dsh-devops-hint{font-size:var(--dv-font-xs);color:var(--dv-fg-3)}
/* 代码编辑器 = 深色终端：着色层（pre）+ 透明 textarea 叠加。
   两层必须**严格同字体/行高/内边距**，textarea 文字透明、caret 可见，否则光标与着色错位。 */
.dsh-devops-code{
  display:flex;border:0.5px solid var(--dv-term-line);border-radius:var(--dv-r-md);
  overflow:hidden;background:var(--dv-term-bg);color:var(--dv-term-fg);
  font-family:var(--dv-term-font);font-size:var(--dv-term-fs);line-height:var(--dv-term-lh);
}
.dsh-devops-code-gutter{
  flex:none;display:flex;flex-direction:column;align-items:flex-end;
  padding:var(--dv-term-pad-y) 8px var(--dv-term-pad-y) 10px;
  background:var(--dv-term-bg-2);color:var(--dv-term-dim);
  border-right:0.5px solid var(--dv-term-line);
  user-select:none;font-family:inherit;font-size:inherit;line-height:inherit;
  white-space:pre;font-variant-numeric:tabular-nums;
}
.dsh-devops-code-lineno{display:block;line-height:inherit}
.dsh-devops-code-shell{position:relative;flex:1;min-width:0;display:flex;align-items:stretch}
.dsh-devops-code-hl{
  position:absolute;inset:0;margin:0;overflow:hidden;pointer-events:none;
  padding:var(--dv-term-pad-y) var(--dv-term-pad-x);
  font-family:inherit;font-size:inherit;line-height:inherit;
  white-space:pre;background:transparent;color:var(--dv-term-fg);
}
.dsh-devops-code-hline{white-space:pre}
.dsh-devops-code-area{
  position:relative;z-index:1;flex:1;min-width:0;min-height:110px;resize:vertical;
  padding:var(--dv-term-pad-y) var(--dv-term-pad-x);
  border:none;outline:none;background:transparent;
  color:transparent;caret-color:var(--dv-term-fg);
  font-family:inherit;font-size:inherit;line-height:inherit;
  white-space:pre;overflow-wrap:normal;overflow:auto;tab-size:2;
  /* 固定滚动条槽：否则出现滚动条时 textarea 变窄，长行会与高亮层横向错位。 */
  scrollbar-gutter:stable;
}
.dsh-devops-code-area::placeholder{color:var(--dv-term-dim)}
.dsh-devops-code-area::selection{background:var(--dv-term-sel);color:transparent}
.dsh-devops-monospace{font-family:var(--dv-code-font)}

/* ---------- 面板 / 卡片 ---------- */
.dsh-devops-card{
  border:0.5px solid var(--dv-border);border-radius:var(--dv-r-lg);
  background:var(--dv-surface);padding:12px;margin-bottom:12px;
  transition:border-color var(--dv-t) var(--dv-ease),background-color var(--dv-t) var(--dv-ease),
    box-shadow var(--dv-t) var(--dv-ease);
}
.dsh-devops-card:hover{border-color:var(--dv-border-2)}
.dsh-devops-card-head{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.dsh-devops-card-title{font-size:var(--dv-font);font-weight:600;color:var(--dv-fg);margin:0}
.dsh-devops-grid{display:grid;gap:12px}
.dsh-devops-grid[data-cols="2"]{grid-template-columns:repeat(auto-fill,minmax(240px,1fr))}
.dsh-devops-grid[data-cols="3"]{grid-template-columns:repeat(auto-fill,minmax(190px,1fr))}
.dsh-devops-kv{display:grid;grid-template-columns:auto 1fr;gap:3px 10px;font-size:var(--dv-font-sm)}
.dsh-devops-kv dt{color:var(--dv-fg-3)}
.dsh-devops-kv dd{margin:0;color:var(--dv-fg);word-break:break-all}
/* 空态：虚线边框卡片，hover 变色 */
.dsh-devops-empty{
  padding:22px;text-align:center;color:var(--dv-fg-3);font-size:var(--dv-font-sm);
  border:0.5px dashed var(--dv-border-3);border-radius:var(--dv-r-lg);background:transparent;
  transition:border-color var(--dv-t) var(--dv-ease),color var(--dv-t) var(--dv-ease),background-color var(--dv-t) var(--dv-ease);
}
.dsh-devops-empty:hover{border-color:var(--dv-primary);color:var(--dv-fg)}
.dsh-devops-list{display:flex;flex-direction:column;gap:4px}
.dsh-devops-list-row{
  display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:var(--dv-r-md);
  border:0.5px solid transparent;cursor:pointer;font-size:var(--dv-font-sm);
  transition:background-color var(--dv-t) var(--dv-ease),border-color var(--dv-t) var(--dv-ease);
}
.dsh-devops-list-row:hover{background:var(--dv-hover)}
.dsh-devops-list-row[data-active="true"]{background:var(--dv-active);border-color:var(--dv-border-2)}
.dsh-devops-truncate{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.dsh-devops-tag{
  display:inline-flex;align-items:center;padding:0 6px;border-radius:var(--dv-r-pill);
  border:0.5px solid transparent;font-size:var(--dv-font-xs);color:var(--dv-fg-3);
  background:color-mix(in srgb,var(--dv-fg-3) 12%,transparent);
}
.dsh-devops-link{color:var(--dsw-alias-link);cursor:pointer;background:none;border:none;padding:0;font-size:var(--dv-font-sm)}
.dsh-devops-link:hover{text-decoration:underline}

/* ---------- 页签（页内二级导航）：下划线指示条 + hover 底色 ---------- */
.dsh-devops-tabs{
  display:flex;align-items:center;gap:4px;margin-bottom:12px;
  border-bottom:0.5px solid var(--dv-border-2);overflow-x:auto;
}
.dsh-devops-tab{
  position:relative;display:inline-flex;align-items:center;gap:6px;
  padding:6px 12px;margin-bottom:-0.5px;border:none;background:transparent;
  color:var(--dv-fg-3);font-size:var(--dv-font-sm);font-weight:500;cursor:pointer;white-space:nowrap;
  border-radius:var(--dv-r-sm) var(--dv-r-sm) 0 0;
  transition:color var(--dv-t) var(--dv-ease),background-color var(--dv-t) var(--dv-ease);
}
.dsh-devops-tab::after{
  content:"";position:absolute;left:8px;right:8px;bottom:0;height:2px;border-radius:2px 2px 0 0;
  background:var(--dv-accent);opacity:0;
  transition:opacity var(--dv-t) var(--dv-ease);
}
.dsh-devops-tab:hover{color:var(--dv-fg);background:var(--dv-hover)}
.dsh-devops-tab[data-active="true"]{color:var(--dv-accent)}
.dsh-devops-tab[data-active="true"]::after{opacity:1}
.dsh-devops-tab-count{font-size:var(--dv-font-xs);font-weight:600;opacity:.75}

/* ---------- 表格 ---------- */
.dsh-devops-table{width:100%;border-collapse:collapse;font-size:var(--dv-font-sm)}
.dsh-devops-table th{
  text-align:left;font-weight:500;color:var(--dv-fg-3);padding:6px 8px;
  border-bottom:0.5px solid var(--dv-border-3);white-space:nowrap;
}
.dsh-devops-table td{padding:6px 8px;border-bottom:0.5px solid var(--dv-border-2);vertical-align:middle}
.dsh-devops-table tr:hover td{background:var(--dv-hover)}

/* ---------- 编辑器三栏 ---------- */
.dsh-devops-editor{flex:1;display:flex;min-height:0;position:relative}
.dsh-devops-palette{
  flex:none;width:190px;display:flex;flex-direction:column;min-height:0;
  border-right:0.5px solid var(--dv-border-3);overflow:hidden;
}
.dsh-devops-palette-scroll{flex:1;overflow:auto;padding:8px}
.dsh-devops-inspector{
  flex:none;width:288px;display:flex;flex-direction:column;min-height:0;
  border-left:0.5px solid var(--dv-border-3);overflow:hidden;
}
.dsh-devops-inspector-scroll{flex:1;overflow-y:auto;overflow-x:hidden;padding:10px;min-width:0}
/* ============ 编排画布：横向列布局（阶段 = 列，列内节点自上而下） ============ */
/* 外层两轴可滚；.dsh-devops-board 以 flex 行承载所有列，阶段多时横向滚动而不挤压。 */
.dsh-devops-canvas{flex:1;min-width:0;overflow:auto;position:relative;padding:10px 12px 14px}
.dsh-devops-canvas-notice{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.dsh-devops-board{
  position:relative;display:flex;flex-direction:row;align-items:flex-start;
  gap:14px;min-height:100%;padding-bottom:6px;
  /* 按内容撑开：列溢出后不被裁、依赖边层覆盖全部列、横向滚动能滚到末尾的新列。 */
  width:max-content;min-width:100%;
}
.dsh-devops-board-empty{width:100%}
.dsh-devops-edges{position:absolute;inset:0;pointer-events:none;overflow:visible;z-index:0}

.dsh-devops-column{
  position:relative;z-index:1;flex:0 0 auto;width:236px;display:flex;flex-direction:column;
  border:0.5px solid var(--dv-border);border-radius:var(--dv-r-lg);
  background:var(--dv-surface);
  transition:border-color .16s ease,box-shadow .16s ease,background-color .16s ease;
  animation:dsh-devops-rise .18s ease-out both;
}
.dsh-devops-column:hover{border-color:var(--dv-border-2)}
.dsh-devops-column[data-active="true"]{border-color:var(--dv-border-2);box-shadow:0 1px 8px var(--dsw-alias-bg-mask-1,rgba(0,0,0,.08))}
.dsh-devops-column[data-drop="true"]{
  border-color:var(--dsw-alias-state-business-primary);
  box-shadow:0 0 0 1px var(--dsw-alias-state-business-primary);
}
.dsh-devops-column-head{
  display:flex;align-items:center;gap:6px;padding:7px 9px 5px;
  border-bottom:0.5px solid var(--dv-border-2);
}
.dsh-devops-column-index{
  flex:none;display:inline-flex;align-items:center;justify-content:center;
  width:18px;height:18px;border-radius:50%;font-size:11px;
  background:var(--dv-surface-2);color:var(--dv-fg-2);
  border:0.5px solid var(--dv-border);
}
.dsh-devops-column-title{font-size:12px;font-weight:500;color:var(--dv-fg);cursor:text}
.dsh-devops-column-title:hover{color:var(--dsw-alias-link)}
.dsh-devops-column-tools{
  display:flex;align-items:center;gap:2px;flex-wrap:wrap;
  padding:5px 7px;border-bottom:0.5px solid var(--dv-border-2);
}
.dsh-devops-headbtn{
  display:inline-flex;align-items:center;gap:4px;min-height:20px;padding:1px 6px;
  border-radius:var(--dv-r-sm);border:0.5px solid transparent;background:transparent;
  color:var(--dv-fg-2);font-size:11px;cursor:pointer;
  transition:background-color .14s ease,color .14s ease,border-color .14s ease,transform .12s ease;
}
.dsh-devops-headbtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dv-fg)}
.dsh-devops-headbtn:active:not(:disabled){transform:scale(.94)}
.dsh-devops-headbtn[data-active="true"]{color:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary)}
.dsh-devops-headbtn:disabled{opacity:.4;cursor:default}
.dsh-devops-column-cards{
  display:flex;flex-direction:column;gap:8px;padding:9px;min-height:140px;
  transition:background-color .16s ease;
}
.dsh-devops-column[data-drop="true"] .dsh-devops-column-cards{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-devops-column-empty{
  flex:1;display:flex;align-items:center;justify-content:center;
  border:1px dashed var(--dv-border-2);border-radius:var(--dv-r-md);
  padding:14px 8px;color:var(--dv-fg-3);font-size:11px;text-align:center;
}
.dsh-devops-slot{position:relative}
.dsh-devops-slot[data-drop-before="true"]::before{
  content:"";position:absolute;left:0;right:0;top:-5px;height:2px;border-radius:2px;
  background:var(--dsw-alias-state-business-primary);
  animation:dsh-devops-drop-pulse .9s ease-in-out infinite;
}

/* ---------- 块状节点卡片 ---------- */
.dsh-devops-nodecard{
  display:flex;flex-direction:column;gap:5px;width:100%;padding:9px 10px;
  border:0.5px solid var(--dv-border);border-radius:var(--dv-r-md);
  background:var(--dv-surface-2);cursor:grab;user-select:none;
  box-shadow:0 1px 2px var(--dsw-alias-bg-mask-1,rgba(0,0,0,.06));
  transition:border-color .15s ease,box-shadow .15s ease,transform .15s ease,background-color .15s ease;
  animation:dsh-devops-card-in .18s ease-out both;
}
.dsh-devops-nodecard:hover{
  border-color:var(--dv-border-2);transform:translateY(-1px);
  box-shadow:0 4px 12px var(--dsw-alias-bg-mask-1,rgba(0,0,0,.14));
}
.dsh-devops-nodecard[data-selected="true"]{
  border-color:var(--dsw-alias-brand-primary);
  box-shadow:0 0 0 1px var(--dsw-alias-brand-primary),0 4px 12px var(--dsw-alias-bg-mask-1,rgba(0,0,0,.14));
}
.dsh-devops-nodecard[data-dragging="true"]{opacity:.45;transform:scale(.98)}
/* 节点卡状态色：左侧 3px 色条 + 极淡色底；running 呼吸。 */
.dsh-devops-nodecard[data-status="running"],.dsh-devops-nodecard[data-tone="busy"]{
  border-left:3px solid var(--dv-busy);
  background:color-mix(in srgb,var(--dv-busy) 8%,var(--dv-surface-2));
  animation:dsh-devops-breathe 2s ease-in-out infinite;
}
.dsh-devops-nodecard[data-status="success"],.dsh-devops-nodecard[data-tone="ok"]{
  border-left:3px solid var(--dv-ok);
  background:color-mix(in srgb,var(--dv-ok) 7%,var(--dv-surface-2));
}
.dsh-devops-nodecard[data-status="failed"],.dsh-devops-nodecard[data-tone="error"]{
  border-left:3px solid var(--dv-err);
  background:color-mix(in srgb,var(--dv-err) 8%,var(--dv-surface-2));
}
.dsh-devops-nodecard[data-status="canceled"],.dsh-devops-nodecard[data-tone="warn"]{
  border-left:3px solid var(--dv-warn);
  background:color-mix(in srgb,var(--dv-warn) 7%,var(--dv-surface-2));
}
.dsh-devops-nodecard[data-status="pending"],.dsh-devops-nodecard[data-status="skipped"],
.dsh-devops-nodecard[data-tone="idle"]{border-left:3px solid var(--dv-idle)}

/* 节点卡运行态徽标 + 耗时刻：与卡片色条同一套 tone 语义，颜色只在这里落地。 */
.dsh-devops-nodecard-status{
  display:flex;align-items:center;gap:6px;
  margin-top:8px;padding-top:6px;
  border-top:1px dashed var(--dv-border,color-mix(in srgb,var(--dv-idle) 30%,transparent));
  font-size:11px;line-height:1.4;
}
.dsh-devops-nodecard-status[data-tone="ok"]{color:var(--dv-ok)}
.dsh-devops-nodecard-status[data-tone="error"]{color:var(--dv-err);font-weight:600}
.dsh-devops-nodecard-status[data-tone="busy"]{color:var(--dv-busy)}
.dsh-devops-nodecard-status[data-tone="warn"]{color:var(--dv-warn)}
.dsh-devops-nodecard-status[data-tone="idle"]{color:var(--dv-idle)}
.dsh-devops-nodecard-elapsed{
  font-variant-numeric:tabular-nums;font-feature-settings:"tnum";
}
.dsh-devops-slot[data-running="true"] [data-role="nodecard-elapsed"]{font-weight:600}

/* 列表行 / 状态点也吃同一套状态色，保证「颜色即状态」在列表里一致。 */
.dsh-devops-list-row[data-status="failed"],.dsh-devops-list-row[data-tone="error"]{border-left:3px solid var(--dv-err)}
.dsh-devops-list-row[data-status="running"],.dsh-devops-list-row[data-tone="busy"]{border-left:3px solid var(--dv-busy)}
.dsh-devops-list-row[data-status="success"],.dsh-devops-list-row[data-tone="ok"]{border-left:3px solid var(--dv-ok)}
.dsh-devops-list-row[data-status="canceled"],.dsh-devops-list-row[data-tone="warn"]{border-left:3px solid var(--dv-warn)}
.dsh-devops-dot[data-tone="idle"],.dsh-devops-dot[data-tone="queued"]{background:var(--dv-idle)}
/* 失败计数徽标：明显可辨 */
.dsh-devops-chip[data-tone="error"]{font-weight:600}
/* info 语义色（中性提示） */
.dsh-devops-chip[data-tone="info"]{color:var(--dv-accent);background:color-mix(in srgb,var(--dv-accent) 14%,transparent)}
.dsh-devops-banner[data-tone="info"]{
  border-color:color-mix(in srgb,var(--dv-accent) 45%,transparent);
  background:color-mix(in srgb,var(--dv-accent) 10%,transparent);color:var(--dv-accent);
}
@keyframes dsh-devops-breathe{
  0%,100%{box-shadow:inset 3px 0 0 color-mix(in srgb,var(--dv-busy) 55%,transparent)}
  50%{box-shadow:inset 3px 0 0 color-mix(in srgb,var(--dv-busy) 100%,transparent)}
}
.dsh-devops-nodecard:active{cursor:grabbing}
.dsh-devops-nodecard-head{display:flex;align-items:center;gap:6px}
.dsh-devops-nodecard-index{
  flex:none;display:inline-flex;align-items:center;justify-content:center;
  min-width:16px;height:16px;padding:0 3px;border-radius:var(--dv-r-sm);
  background:var(--dv-surface-3);color:var(--dv-fg-3);font-size:10px;
}
.dsh-devops-nodecard-title{font-size:12px;font-weight:500;color:var(--dv-fg);flex:1}
.dsh-devops-nodecard-flag{
  flex:none;padding:0 5px;border-radius:999px;font-size:10px;
  color:var(--dv-warn);background:color-mix(in srgb,var(--dv-warn) 16%,transparent);
}
.dsh-devops-nodecard-type{font-size:10px;color:var(--dv-fg-3)}
.dsh-devops-nodecard-meta{
  display:grid;grid-template-columns:auto 1fr;gap:1px 8px;
  font-size:10px;color:var(--dv-fg-2);
}
.dsh-devops-nodecard-key{color:var(--dv-fg-3)}
.dsh-devops-nodecard-needs{display:flex;align-items:center;gap:4px;flex-wrap:wrap;font-size:10px}
.dsh-devops-nodecard-need{
  padding:0 5px;border-radius:999px;font-size:10px;
  background:color-mix(in srgb,var(--dv-accent) 14%,transparent);color:var(--dv-accent);
}
.dsh-devops-nodecard-foot{font-size:10px;color:var(--dv-fg-3)}

/* ---------- 就地新增阶段 ---------- */
.dsh-devops-addstage{
  display:inline-flex;align-items:center;justify-content:center;gap:5px;
  border:1px dashed var(--dv-border-2);border-radius:var(--dv-r-md);
  background:transparent;color:var(--dv-fg-3);cursor:pointer;
  font-size:11px;padding:4px 10px;white-space:nowrap;
  transition:border-color .15s ease,color .15s ease,background-color .15s ease,transform .15s ease;
}
.dsh-devops-addstage:hover{
  border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary);
  background:var(--dsw-alias-interactive-bg-hover);transform:translateX(2px);
}
.dsh-devops-addstage:active{transform:scale(.96)}
.dsh-devops-addstage[data-kind="head"]{padding:1px 6px;border-style:solid;border-color:transparent;min-height:20px;border-radius:var(--dv-r-sm)}
.dsh-devops-addstage[data-kind="head"]:hover{transform:none}
.dsh-devops-addstage[data-kind="gap"]{
  align-self:stretch;flex-direction:column;width:28px;min-height:140px;padding:8px 0;
  position:relative;z-index:1;
}
.dsh-devops-addstage[data-kind="gap"] .dsh-devops-addstage-label{writing-mode:vertical-rl;font-size:10px;letter-spacing:1px}
.dsh-devops-addstage[data-kind="end"]{
  align-self:flex-start;flex-direction:column;width:104px;min-height:140px;padding:10px 6px;
  position:relative;z-index:1;
}

/* ---------- 画布动效：仅 CSS transition/animation，无第三方动画库 ---------- */
@keyframes dsh-devops-rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@keyframes dsh-devops-card-in{from{opacity:0;transform:translateY(-4px) scale(.985)}to{opacity:1;transform:none}}
@keyframes dsh-devops-drop-pulse{0%,100%{opacity:1}50%{opacity:.45}}

/* 尊重系统「减少动态效果」：关掉画布上的动画与过渡，只保留状态差异。 */
@media (prefers-reduced-motion:reduce){
  .dsh-devops-column,.dsh-devops-nodecard,.dsh-devops-slot[data-drop-before="true"]::before,
  .dsh-devops-dot[data-tone="busy"]{animation:none}
  .dsh-devops-column,.dsh-devops-nodecard,.dsh-devops-addstage,.dsh-devops-headbtn,
  .dsh-devops-switch span,.dsh-devops-column-cards{transition:none}
  .dsh-devops-nodecard:hover,.dsh-devops-addstage:hover,.dsh-devops-nodecard[data-dragging="true"]{transform:none}
}
.dsh-devops-palette-item{
  display:flex;flex-direction:column;gap:1px;padding:5px 7px;border-radius:var(--dv-r-sm);
  cursor:pointer;border:0.5px solid transparent;margin-bottom:2px;
}
.dsh-devops-palette-item:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dv-border)}
.dsh-devops-edges{position:absolute;inset:0;pointer-events:none;overflow:visible}

/* ---------- 运行详情 ---------- */
.dsh-devops-progress{display:flex;align-items:center;gap:10px}
.dsh-devops-stepcard{
  border:0.5px solid var(--dv-border);border-radius:var(--dv-r-md);margin-bottom:6px;
  background:var(--dv-surface);overflow:hidden;
  transition:border-color var(--dv-t) var(--dv-ease),box-shadow var(--dv-t) var(--dv-ease);
}
.dsh-devops-stepcard:hover{box-shadow:var(--dv-elev-1)}
/* ---------- 状态色体系：颜色即状态（卡片/列头/列表点/徽标共用一套语义色） ----------
   data-status 用运行/步骤的真实状态名；data-tone 复用既有语义色调（ok/error/busy/warn/idle）。
   视觉语法：左侧 3px 色条 + 极淡色底，running 额外带呼吸动画。 */
.dsh-devops-stepcard[data-status="failed"],.dsh-devops-stepcard[data-tone="error"]{
  border-color:color-mix(in srgb,var(--dv-err) 45%,transparent);
  border-left:3px solid var(--dv-err);
  background:color-mix(in srgb,var(--dv-err) 7%,var(--dv-surface));
}
.dsh-devops-stepcard[data-status="running"],.dsh-devops-stepcard[data-tone="busy"]{
  border-color:color-mix(in srgb,var(--dv-busy) 45%,transparent);
  border-left:3px solid var(--dv-busy);
  background:color-mix(in srgb,var(--dv-busy) 7%,var(--dv-surface));
  animation:dsh-devops-breathe 2s ease-in-out infinite;
}
.dsh-devops-stepcard[data-status="success"],.dsh-devops-stepcard[data-tone="ok"]{
  border-left:3px solid var(--dv-ok);
  background:color-mix(in srgb,var(--dv-ok) 6%,var(--dv-surface));
}
.dsh-devops-stepcard[data-status="canceled"],.dsh-devops-stepcard[data-tone="warn"]{
  border-left:3px solid var(--dv-warn);
  background:color-mix(in srgb,var(--dv-warn) 6%,var(--dv-surface));
}
.dsh-devops-stepcard[data-status="pending"],.dsh-devops-stepcard[data-status="skipped"],
.dsh-devops-stepcard[data-tone="idle"]{
  border-left:3px solid var(--dv-idle);
  background:var(--dv-surface);
}

/* 列头着色：一列的整体状态一眼可辨（顶部 2px 色条 + 淡色底）。 */
.dsh-devops-column[data-status="running"] .dsh-devops-column-head,
.dsh-devops-column[data-tone="busy"] .dsh-devops-column-head{
  border-top:2px solid var(--dv-busy);
  background:color-mix(in srgb,var(--dv-busy) 9%,transparent);
}
.dsh-devops-column[data-status="success"] .dsh-devops-column-head,
.dsh-devops-column[data-tone="ok"] .dsh-devops-column-head{
  border-top:2px solid var(--dv-ok);
  background:color-mix(in srgb,var(--dv-ok) 9%,transparent);
}
.dsh-devops-column[data-status="failed"] .dsh-devops-column-head,
.dsh-devops-column[data-tone="error"] .dsh-devops-column-head{
  border-top:2px solid var(--dv-err);
  background:color-mix(in srgb,var(--dv-err) 9%,transparent);
}
.dsh-devops-column[data-status="canceled"] .dsh-devops-column-head,
.dsh-devops-column[data-tone="warn"] .dsh-devops-column-head{
  border-top:2px solid var(--dv-warn);
  background:color-mix(in srgb,var(--dv-warn) 9%,transparent);
}
/* 列本身也跟着状态走：边框染上状态色。 */
.dsh-devops-column[data-status="failed"],.dsh-devops-column[data-tone="error"]{border-color:color-mix(in srgb,var(--dv-err) 40%,transparent)}
.dsh-devops-column[data-status="running"],.dsh-devops-column[data-tone="busy"]{border-color:color-mix(in srgb,var(--dv-busy) 40%,transparent)}
.dsh-devops-column[data-status="success"],.dsh-devops-column[data-tone="ok"]{border-color:color-mix(in srgb,var(--dv-ok) 40%,transparent)}
.dsh-devops-column[data-status="canceled"],.dsh-devops-column[data-tone="warn"]{border-color:color-mix(in srgb,var(--dv-warn) 40%,transparent)}
.dsh-devops-stepcard-head{
  display:flex;align-items:center;gap:8px;padding:6px 9px;cursor:pointer;
}
.dsh-devops-stepcard-head:hover{background:var(--dv-hover)}
.dsh-devops-stepcard-title{font-size:var(--dv-font-sm);font-weight:500;color:var(--dv-fg)}
.dsh-devops-stepcard-meta{font-size:var(--dv-font-xs);color:var(--dv-fg-3);display:flex;gap:8px;flex-wrap:wrap}
.dsh-devops-phases{display:flex;gap:3px;align-items:center}
.dsh-devops-phase{
  width:14px;height:4px;border-radius:2px;background:var(--dv-surface-3);
}
.dsh-devops-phase[data-state="done"]{background:var(--dv-ok)}
.dsh-devops-phase[data-state="active"]{background:var(--dv-busy)}
.dsh-devops-phase[data-state="failed"]{background:var(--dv-err)}

/* ============ 日志 / 代码：深色终端（不随宿主浅色主题变白） ============ */
/* 终端三层：panel（容器）> logbar（工具栏，略浅一档）> logview（滚动区，主底）。 */
.dsh-devops-logpanel{
  display:flex;flex-direction:column;min-height:0;
  border:0.5px solid var(--dv-term-line);border-radius:var(--dv-r-md);
  background:var(--dv-term-bg);color:var(--dv-term-fg);overflow:hidden;
}
.dsh-devops-logbar{
  flex:none;display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:5px 8px;
  background:var(--dv-term-bg-2);color:var(--dv-term-fg);
  border-bottom:0.5px solid var(--dv-term-line);
}
/* 深色工具栏里的控件与徽标：提高对比度，避免"浅色控件配黑底"的割裂。 */
.dsh-devops-logbar .dsh-devops-hint{color:var(--dv-term-dim)}
.dsh-devops-logbar .dsh-devops-chip{background:color-mix(in srgb,var(--dv-term-fg) 12%,transparent);color:var(--dv-term-fg)}
.dsh-devops-logbar .dsh-devops-chip[data-tone="ok"]{color:var(--dv-ok);background:color-mix(in srgb,var(--dv-ok) 20%,transparent)}
.dsh-devops-logbar .dsh-devops-chip[data-tone="warn"]{color:var(--dv-warn);background:color-mix(in srgb,var(--dv-warn) 22%,transparent)}
.dsh-devops-logbar .dsh-devops-chip[data-tone="error"]{color:var(--dv-term-stderr);background:color-mix(in srgb,var(--dv-term-stderr) 20%,transparent)}
.dsh-devops-logbar .dsh-devops-btn{
  color:var(--dv-term-fg);border-color:color-mix(in srgb,var(--dv-term-fg) 22%,transparent);
}
.dsh-devops-logbar .dsh-devops-btn:hover:not(:disabled){background:color-mix(in srgb,var(--dv-term-fg) 14%,transparent)}
.dsh-devops-logbar .dsh-devops-btn[data-active="true"]{background:color-mix(in srgb,var(--dv-term-fg) 18%,transparent)}
.dsh-devops-logbar .dsh-devops-input{
  background:color-mix(in srgb,var(--dv-term-bg) 70%,white);color:var(--dv-term-fg);
  border-color:var(--dv-term-line);
}
.dsh-devops-logbar .dsh-devops-input::placeholder{color:var(--dv-term-dim)}

/* 语言选择器（终端工具栏）：复用深色终端配色。 */
.dsh-devops-langselect{
  min-height:24px;padding:2px 6px;border-radius:var(--dv-r-sm);
  background:color-mix(in srgb,var(--dv-term-bg) 70%,white);color:var(--dv-term-fg);
  border:0.5px solid var(--dv-term-line);font-family:var(--dv-term-font);font-size:var(--dv-font-xs);
  outline:none;cursor:pointer;
}
.dsh-devops-langselect:focus{border-color:var(--dv-tok-function)}
.dsh-devops-langselect option{background:var(--dv-term-bg);color:var(--dv-term-fg)}

.dsh-devops-logview{
  height:230px;overflow:auto;
  padding:var(--dv-term-pad-y) var(--dv-term-pad-x);
  background:var(--dv-term-bg);color:var(--dv-term-fg);
  font-family:var(--dv-term-font);font-size:var(--dv-term-fs);line-height:var(--dv-term-lh);
  white-space:pre-wrap;word-break:break-word;tab-size:2;
  caret-color:var(--dv-term-fg);
}
.dsh-devops-logview::selection,.dsh-devops-logline::selection,.dsh-devops-tok::selection{
  background:var(--dv-term-sel);color:inherit;
}
/* 静态日志行容器（与 logview 配套；深色底由 logview 提供）。 */
.dsh-devops-loglines{display:flex;flex-direction:column;min-width:0}
.dsh-devops-logline{
  /* 行号与行内容以内联方式并排：无 :has()/flex 依赖，旧 WebView 也稳。
     文本换行时悬挂缩进由 padding-left + text-indent 负值维持。 */
  display:block;padding-left:0;
  white-space:pre-wrap;word-break:break-word;tab-size:2;
  font-family:inherit;font-size:inherit;line-height:inherit;color:inherit;
}
/* 行内容（与行号并排；保留缩进与换行）。 */
.dsh-devops-logline-text{
  white-space:pre-wrap;word-break:break-word;
  font-family:inherit;font-size:inherit;line-height:inherit;color:inherit;
}
/* stderr 行：靠左侧红条 + 淡红底区分，**不覆盖 token 颜色**
   （用后代选择器改 color 会以更高特异性吃掉语法着色，反而违背"按编码类型上色"）。 */
.dsh-devops-logline[data-stream="stderr"]{
  color:var(--dv-term-stderr);
  border-left:2px solid var(--dv-term-stderr);
  background:color-mix(in srgb,var(--dv-term-stderr) 8%,transparent);
  padding-left:6px;
}
/* 行号槽。 */
.dsh-devops-logline-no{
  display:inline-block;min-width:2.6em;margin-right:10px;padding-right:8px;
  text-align:right;color:var(--dv-term-dim);user-select:none;
  border-right:0.5px solid var(--dv-term-line);
  font-variant-numeric:tabular-nums;
}
/* 过滤命中：深底上可读的半透明黄，且不得覆盖 token 颜色。 */
.dsh-devops-logview mark,.dsh-devops-logline mark{
  background:var(--dv-term-mark);color:inherit;border-radius:2px;padding:0 1px;
}
.dsh-devops-log-gap{
  margin:4px 0;padding:2px 8px;border-radius:var(--dv-r-sm);
  background:var(--dv-term-bg-3);color:var(--dv-term-dim);
  font-style:italic;font-size:var(--dv-font-xs);
}

/* ---------- 语法 token 调色板（syntax.js 的 kind；终端与代码框共用） ---------- */
.dsh-devops-tok{color:inherit}
.dsh-devops-tok-plain{color:var(--dv-tok-plain)}
.dsh-devops-tok-keyword{color:var(--dv-tok-keyword);font-weight:600}
.dsh-devops-tok-string{color:var(--dv-tok-string)}
.dsh-devops-tok-comment{color:var(--dv-tok-comment);font-style:italic}
.dsh-devops-tok-number{color:var(--dv-tok-number)}
.dsh-devops-tok-function{color:var(--dv-tok-function);font-weight:500}
.dsh-devops-tok-builtin{color:var(--dv-tok-builtin);font-weight:600}
.dsh-devops-tok-operator{color:var(--dv-tok-operator)}
.dsh-devops-tok-variable{color:var(--dv-tok-variable)}
.dsh-devops-tok-type{color:var(--dv-tok-type);font-weight:500}
/* 代码编辑器（浅色主题下也是深色终端）内同样是这套调色板。 */
.dsh-devops-code-hl .dsh-devops-tok-plain{color:var(--dv-tok-plain)}

/* ---------- 流水线详情：只读编排视图 + 右侧伸缩抽屉 ---------- */
/* 只读边界：不拖拽、不改名、不增删；卡片用默认光标且不做位移反馈。 */
.dsh-devops-detail{position:relative;display:flex;flex-direction:column;min-width:0;min-height:0;flex:1}
/* 详情页复用编辑器三栏骨架（.dsh-devops-editor），此处只做只读修饰。 */
.dsh-devops-detail-editor{flex:1}
.dsh-devops-readonly .dsh-devops-nodecard{cursor:default}
.dsh-devops-readonly .dsh-devops-nodecard:hover{transform:none;box-shadow:0 1px 2px var(--dsw-alias-bg-mask-1,rgba(0,0,0,.06))}
.dsh-devops-readonly .dsh-devops-nodecard:active{cursor:default}
.dsh-devops-readonly .dsh-devops-slot{cursor:default}
.dsh-devops-readonly .dsh-devops-column{animation:none}

.dsh-devops-drawer-layer{
  position:absolute;inset:0;z-index:800;display:flex;justify-content:flex-end;
}
.dsh-devops-drawer-layer[data-open="false"]{
  pointer-events:none;visibility:hidden;
  transition:visibility 0s linear var(--dv-t-slow);
}
.dsh-devops-drawer-mask{
  position:absolute;inset:0;background:var(--dv-mask);
  backdrop-filter:var(--dv-blur);
  opacity:0;transition:opacity var(--dv-t-slow) var(--dv-ease);
}
.dsh-devops-drawer-layer[data-open="true"] .dsh-devops-drawer-mask{opacity:1}
/* 低一档的模糊变体（默认已带轻微模糊，这里允许显式指定）。 */
.dsh-devops-drawer-mask[data-blur="true"]{backdrop-filter:var(--dv-blur)}

.dsh-devops-drawer{
  position:relative;z-index:1;display:flex;flex-direction:column;min-height:0;
  width:min(420px,100%);height:100%;
  border-left:0.5px solid var(--dv-border-2);
  background:var(--dv-surface);color:var(--dv-fg);
  box-shadow:var(--dv-elev-2);
  transform:translateX(100%);
  transition:transform var(--dv-t-slow) var(--dv-ease);
}
.dsh-devops-drawer-layer[data-open="true"] .dsh-devops-drawer{transform:none}

/* ── 圆角悬浮卡片形态：脱离右边缘、四周留白、高度自适应且受视口约束 ── */
.dsh-devops-drawer-layer[data-shape="floating"]{
  padding:16px;align-items:flex-start;
}
.dsh-devops-drawer-layer[data-shape="floating"][data-open="false"]{
  padding:16px;
}
.dsh-devops-drawer[data-variant="floating"]{
  height:auto;max-height:calc(100vh - 32px);max-height:calc(100dvh - 32px);
  margin-left:auto;
  border:0.5px solid var(--dv-border-2);border-left-width:0.5px;
  border-radius:var(--dv-r-xl);
  box-shadow:var(--dv-elev-2),0 2px 6px rgba(0,0,0,.16);
  transform:translateX(calc(100% + 24px));
}
.dsh-devops-drawer-layer[data-open="true"] .dsh-devops-drawer[data-variant="floating"]{transform:none}
/* 悬浮卡片的头部圆角跟随卡片，避免直角戳出圆角。 */
.dsh-devops-drawer[data-variant="floating"] .dsh-devops-drawer-head{
  border-radius:var(--dv-r-xl) var(--dv-r-xl) 0 0;
}
.dsh-devops-drawer[data-variant="floating"] .dsh-devops-drawer-body{
  flex:1;min-height:0;overflow:auto;
}

.dsh-devops-drawer-head{
  flex:none;display:flex;align-items:center;gap:8px;
  padding:10px 12px;border-bottom:0.5px solid var(--dv-border-2);
}
.dsh-devops-drawer-title{font-size:var(--dv-font);font-weight:600;color:var(--dv-fg);min-width:0}
.dsh-devops-drawer-body{
  flex:1;min-height:0;overflow:auto;padding:12px;
}
.dsh-devops-drawer-body [hidden]{display:none}
.dsh-devops-drawer-panel{display:flex;flex-direction:column;gap:8px;min-width:0}
/* 原始值小面板：与终端/语法调色板呼应（等宽、深底、浅字）。 */
.dsh-devops-drawer-raw{
  flex:1;min-width:0;padding:6px 9px;border-radius:var(--dv-r-sm);
  background:var(--dv-term-bg);border:0.5px solid var(--dv-term-line);
  color:var(--dv-term-fg);font-size:var(--dv-font-xs);
  font-family:var(--dv-term-font);
  word-break:break-all;white-space:pre-wrap;
}
@media (max-width:900px){
  .dsh-devops-drawer,.dsh-devops-drawer[data-variant="floating"]{width:100%}
  .dsh-devops-drawer-layer[data-shape="floating"]{padding:8px}
}

/* ---------- 全局状态栏（shell.overlay） ---------- */
/* 非整页场景（状态栏等）复用时，去掉整页工作台专属的尺寸/背景。 */
.dsh-devops-root--bare{
  width:auto;
  height:auto;
  min-height:0;
  display:block;
  background:transparent;
}

.dsh-devops-overlay{
  /* 状态栏：外壳固定右下角，外层可点击穿透，只有本体接收事件。 */
  position:fixed;z-index:900;right:12px;bottom:10px;
  pointer-events:none;display:flex;justify-content:flex-end;
  max-width:min(460px,calc(100vw - 24px));
}
.dsh-devops-overlay-bar{
  pointer-events:auto;display:flex;align-items:center;gap:10px;flex-wrap:wrap;
  padding:5px 11px;border-radius:var(--dv-r-pill);
  border:0.5px solid var(--dv-border-2);
  background:var(--dv-toast-bg);
  color:var(--dv-toast-fg);
  box-shadow:var(--dv-elev-1);
  font-size:var(--dv-font-sm);
  transition:background-color var(--dv-t) var(--dv-ease),box-shadow var(--dv-t) var(--dv-ease);
}
.dsh-devops-overlay-bar[data-clickable="true"]{cursor:pointer}
.dsh-devops-overlay-bar[data-clickable="true"]:hover{background:var(--dv-hover)}
.dsh-devops-overlay-seg{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
.dsh-devops-overlay-seg+.dsh-devops-overlay-seg{padding-left:10px;border-left:0.5px solid var(--dv-border-2)}
.dsh-devops-overlay-mono{font-variant-numeric:tabular-nums;font-family:var(--dv-code-font)}

/* ---------- 弹层 ---------- */
.dsh-devops-modal-backdrop{
  position:fixed;inset:0;z-index:1000;background:var(--dv-mask);
  backdrop-filter:var(--dv-blur);
  display:flex;align-items:center;justify-content:center;padding:24px;
  animation:dsh-devops-fade var(--dv-t-slow) var(--dv-ease) both;
}
.dsh-devops-modal{
  width:min(560px,100%);max-height:86vh;display:flex;flex-direction:column;
  border-radius:var(--dv-r-xl);border:0.5px solid var(--dv-border-2);
  background:var(--dv-surface);color:var(--dv-fg);
  box-shadow:var(--dv-elev-2);
  animation:dsh-devops-pop var(--dv-t-slow) var(--dv-ease) both;
}
.dsh-devops-modal[data-wide="true"]{width:min(880px,100%)}
.dsh-devops-modal-head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:0.5px solid var(--dv-border-2)}
.dsh-devops-modal-body{padding:14px;overflow:auto}
.dsh-devops-modal-foot{display:flex;justify-content:flex-end;gap:8px;padding:10px 14px;border-top:0.5px solid var(--dv-border-2)}
@keyframes dsh-devops-fade{from{opacity:0}to{opacity:1}}
@keyframes dsh-devops-pop{from{opacity:0;transform:translateY(6px) scale(.985)}to{opacity:1;transform:none}}

/* ---------- 浏览器 / 下拉候选 ---------- */
.dsh-devops-dropdown{
  position:absolute;z-index:1200;margin-top:2px;max-height:216px;overflow:auto;width:100%;
  border:0.5px solid var(--dv-border-2);border-radius:var(--dv-r-md);
  background:var(--dv-surface);
  box-shadow:var(--dv-elev-1);
}
.dsh-devops-dropdown-row{display:flex;align-items:center;gap:6px;padding:4px 8px;cursor:pointer;font-size:var(--dv-font-sm)}
.dsh-devops-dropdown-row:hover{background:var(--dv-hover)}
.dsh-devops-dropdown-note{padding:4px 8px;font-size:var(--dv-font-xs);color:var(--dv-fg-3)}
.dsh-devops-upload-preview{
  max-height:190px;overflow:auto;border:0.5px solid var(--dv-border-2);border-radius:var(--dv-r-md);
  padding:6px 8px;font-size:11.5px;font-family:var(--dv-code-font);
  background:var(--dv-surface-2);color:var(--dv-fg-2);
}
.dsh-devops-banner{
  border-radius:var(--dv-r-md);padding:8px 10px;margin-bottom:10px;font-size:var(--dv-font-sm);
  border:0.5px solid var(--dv-border-2);background:var(--dv-surface-2);color:var(--dv-fg-2);
}
.dsh-devops-banner[data-tone="error"]{border-color:color-mix(in srgb,var(--dv-err-soft) 45%,transparent);background:color-mix(in srgb,var(--dv-err-soft) 10%,transparent);color:var(--dv-err-soft)}
.dsh-devops-banner[data-tone="warn"]{border-color:color-mix(in srgb,var(--dv-warn) 45%,transparent);background:color-mix(in srgb,var(--dv-warn) 10%,transparent);color:var(--dv-warn)}
.dsh-devops-banner[data-tone="ok"]{border-color:color-mix(in srgb,var(--dv-ok) 45%,transparent);background:color-mix(in srgb,var(--dv-ok) 10%,transparent);color:var(--dv-ok)}


/* ---------- 检查器：可拖拽调宽 + 可收起（用户抱怨「拉也不能拉宽」） ---------- */
/* 宽度由外层 host 用内联 style 控制，这里只保证它能伸缩、且内部可滚。 */
.dsh-devops-inspector-host{
  flex:none;display:flex;min-height:0;min-width:0;
}
.dsh-devops-inspector-host>.dsh-devops-inspector{width:100%;border-left:none}
/* 拖拽手柄：窄条 + 中间可见的抓握提示；双击可在默认/最大化间切换。 */
.dsh-devops-inspector-resizer{
  flex:none;width:6px;cursor:col-resize;position:relative;
  background:transparent;transition:background var(--dv-t) var(--dv-ease);
}
.dsh-devops-inspector-resizer::after{
  content:'';position:absolute;top:0;bottom:0;left:2px;width:2px;border-radius:2px;
  background:var(--dv-border-2);transition:background var(--dv-t) var(--dv-ease);
}
.dsh-devops-inspector-resizer:hover::after,
.dsh-devops-inspector-resizer:active::after{background:var(--dv-accent)}
.dsh-devops-inspector-resizer[data-open="false"]{display:none}
/* 收起后的窄轨：只留一个展开按钮，把画布空间还给用户。 */
.dsh-devops-inspector-rail{
  flex:none;display:flex;align-items:flex-start;justify-content:center;
  width:28px;padding-top:8px;border-left:0.5px solid var(--dv-border-3);
}
.dsh-devops-inspector-head{
  flex:none;display:flex;align-items:center;gap:6px;
  padding:8px 10px;border-bottom:0.5px solid var(--dv-border-3);min-width:0;
}
.dsh-devops-inspector-head-title{font-size:var(--dv-font);font-weight:600;color:var(--dv-fg);min-width:0}

/* ---------- 代码编辑器：工具条 + 自动增高 + 放大编辑浮层 ---------- */
.dsh-devops-code-block{display:flex;flex-direction:column;gap:6px;min-width:0}
.dsh-devops-code-toolbar{display:flex;align-items:center;gap:8px;min-width:0}
.dsh-devops-code-lang{
  font-size:var(--dv-font-xs);font-weight:600;letter-spacing:.02em;
  color:var(--dv-tok-function);text-transform:none;
}
/* 面板窄时工具条仍要放得下：允许换行而不是把按钮挤没。 */
.dsh-devops-code-toolbar{flex-wrap:wrap}
.dsh-devops-code-expand{flex:none}
/* 自动增高：高度由 rows 属性驱动（CodeSurface 按内容算），这里只给出滚动边界。 */
.dsh-devops-code[data-fill="true"]{flex:1;min-height:0}
.dsh-devops-code[data-fill="true"] .dsh-devops-code-area{min-height:0;height:100%;resize:none}
.dsh-devops-code[data-fill="true"] .dsh-devops-code-hl{overflow:auto}

.dsh-devops-code-full-backdrop{
  position:fixed;inset:0;z-index:1400;display:flex;
  padding:calc(var(--dsh-frame-top-clearance,0px) + 24px) 24px 24px;
  background:var(--dv-mask);backdrop-filter:var(--dv-blur);
  animation:dsh-devops-fade var(--dv-t) var(--dv-ease);
}
.dsh-devops-code-full{
  flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;
  border:0.5px solid var(--dv-border-2);border-radius:var(--dv-r-xl);
  background:var(--dv-surface);box-shadow:var(--dv-elev-2);
  overflow:hidden;animation:dsh-devops-pop var(--dv-t) var(--dv-ease);
}
.dsh-devops-code-full-head{
  flex:none;display:flex;align-items:center;gap:8px;min-width:0;
  padding:10px 12px;border-bottom:0.5px solid var(--dv-border-3);
}
.dsh-devops-code-full-title{font-size:var(--dv-font);font-weight:600;color:var(--dv-fg);min-width:0}
/* 浮层里的编辑器撑满剩余空间，长脚本可以一次看很多行。 */
.dsh-devops-code-full .dsh-devops-code{
  flex:1;min-height:0;margin:12px;border-radius:var(--dv-r-md);
}
@keyframes dsh-devops-fade{from{opacity:0}to{opacity:1}}
@keyframes dsh-devops-pop{from{opacity:0;transform:translateY(6px) scale(.995)}to{opacity:1;transform:none}}

/* ---------- 节点编辑浮层：覆盖画布，而不是占一栏 ----------
   用户要求：「点击节点之后虚化背景……去点击编辑层之外的地方，编辑窗口会自动保存收起来」。
   与详情页的只读抽屉同一套视觉语言（圆角 + elevation + 遮罩虚化），但这里**可编辑**。 */
.dsh-devops-editor-sheet-layer{
  position:absolute;inset:0;z-index:900;display:flex;justify-content:flex-end;
  padding:16px;pointer-events:auto;
}
.dsh-devops-editor-sheet-layer[data-open="false"]{pointer-events:none;visibility:hidden}
/* 遮罩：半透明 + 轻微模糊（虚化背景）；点它就是「点编辑层之外」 */
.dsh-devops-editor-sheet-mask{
  position:absolute;inset:0;background:var(--dv-mask);
  backdrop-filter:var(--dv-blur);
  animation:dsh-devops-fade var(--dv-t) var(--dv-ease) both;
}
/* 浮层卡片：贴右侧但四周留白、脱离边缘，圆角 + 阴影 + 细边框，高度受视口约束。 */
.dsh-devops-editor-sheet{
  position:relative;z-index:1;display:flex;flex-direction:column;min-height:0;
  margin-left:auto;height:auto;max-height:calc(100vh - 32px);
  max-width:calc(100vw - 32px);
  border:0.5px solid var(--dv-border-2);border-radius:var(--dv-r-xl);
  background:var(--dv-surface);color:var(--dv-fg);
  box-shadow:var(--dv-elev-2),0 2px 8px var(--dsw-alias-bg-mask-1,rgba(0,0,0,.18));
  overflow:hidden;
  animation:dsh-devops-pop var(--dv-t-slow) var(--dv-ease) both;
}
.dsh-devops-editor-sheet-head{
  flex:none;display:flex;align-items:center;gap:8px;min-width:0;
  padding:10px 12px;border-bottom:0.5px solid var(--dv-border-2);
}
.dsh-devops-editor-sheet-title{font-size:var(--dv-font);font-weight:600;color:var(--dv-fg);min-width:0}
.dsh-devops-editor-sheet-body{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}
/* 浮层内嵌 Inspector：去掉侧栏的固定宽度与左边框，撑满卡片。 */
.dsh-devops-editor-sheet-body>.dsh-devops-inspector{width:100%;border-left:none;min-height:0}
.dsh-devops-editor-sheet-foot{
  flex:none;display:flex;align-items:center;gap:8px;
  padding:8px 12px;border-top:0.5px solid var(--dv-border-2);
  background:var(--dv-surface-2);
}
/* 左边缘拖拽手柄（附加能力：不拖也能用，默认宽度已舒适）。 */
.dsh-devops-editor-sheet-resizer{
  position:absolute;left:0;top:10px;bottom:10px;width:8px;
  cursor:col-resize;border-radius:var(--dv-r-sm);
  transition:background var(--dv-t) var(--dv-ease);
}
.dsh-devops-editor-sheet-resizer:hover{background:color-mix(in srgb,var(--dv-accent) 35%,transparent)}

/* 窄屏：浮层铺满可用宽度，仍保留四周留白与圆角。 */
@media (max-width:900px){
  .dsh-devops-editor-sheet-layer{padding:8px}
  .dsh-devops-editor-sheet{width:100% !important;max-height:calc(100vh - 16px)}
}

/* ---------- 滚动分区（task-11）：区域自身滚到底，不把滚动传给外层 ----------
   用户原话：「在节点窗口滑动应该只翻动节点那一个窗口」。
   overscroll-behavior:contain 就是这条诉求的正解。 */
.dsh-devops-canvas,
.dsh-devops-palette-scroll,
.dsh-devops-inspector-scroll,
.dsh-devops-logview,
.dsh-devops-detail-scroll,
.dsh-devops-drawer-body,
.dsh-devops-editor-sheet-body{overscroll-behavior:contain}
/* 详情页/运行详情的内部滚动区（页面自己管滚动，而不是整页动）。 */
.dsh-devops-detail-scroll{flex:1;min-height:0;min-width:0;overflow-y:auto;overflow-x:hidden}

/* 全局动效收敛：统一时长/缓动，并尊重系统「减少动态效果」。 */
@media (prefers-reduced-motion:reduce){
  .dsh-devops-btn,.dsh-devops-input,.dsh-devops-select,.dsh-devops-textarea,.dsh-devops-switch,
  .dsh-devops-switch span,.dsh-devops-card,.dsh-devops-empty,.dsh-devops-list-row,.dsh-devops-nav-item,
  .dsh-devops-tab,.dsh-devops-tab::after,.dsh-devops-chip,.dsh-devops-overlay-bar,.dsh-devops-stepcard,
  .dsh-devops-modal,.dsh-devops-modal-backdrop,.dsh-devops-drawer,.dsh-devops-drawer-mask,
  .dsh-devops-code-full,.dsh-devops-code-full-backdrop,.dsh-devops-inspector-resizer,
  .dsh-devops-drawer-layer[data-open="false"]{transition:none;animation:none}
  /* 状态卡的呼吸动画同样关闭，仅保留左侧色条与淡色底（静态可辨）。 */
  .dsh-devops-nodecard,.dsh-devops-column,.dsh-devops-column-cards,.dsh-devops-stepcard,
  .dsh-devops-nodecard[data-status],.dsh-devops-stepcard[data-status],
  .dsh-devops-nodecard[data-tone],.dsh-devops-stepcard[data-tone]{transition:none;animation:none}
}

@media (max-width:900px){
  .dsh-devops-palette{display:none}
  .dsh-devops-inspector{width:250px}
  .dsh-devops-nav{width:104px}
}
`;

exports.ensureStyles = ensureStyles;
exports.CSS = CSS;
