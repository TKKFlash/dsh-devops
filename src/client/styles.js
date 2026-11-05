/**
 * 样式：一次性注入 <style>，类名前缀 .dsh-devops-，颜色只用 --dsw-alias-* token。
 * 深色模式无需额外处理——token 自身随主题切换。
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
const CSS = `
.dsh-devops-root{
  --dv-r-sm: var(--dsw-radius-sm, 6px);
  --dv-r-md: var(--dsw-radius-md, 8px);
  --dv-r-lg: var(--dsw-radius-lg, 12px);
  --dv-r-xl: var(--dsw-radius-panel, 16px);
  --dv-border: var(--dsw-alias-border-l1);
  --dv-border-2: var(--dsw-alias-border-l2);
  --dv-border-3: var(--dsw-alias-border-l3);
  --dv-fg: var(--dsw-alias-label-primary);
  --dv-fg-2: var(--dsw-alias-label-secondary);
  --dv-fg-3: var(--dsw-alias-label-tertiary);
  box-sizing:border-box;
  display:flex;
  min-height:0;
  height:100%;
  width:100%;
  color:var(--dv-fg);
  background:var(--dsw-alias-bg-base);
  font-size:13px;
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
  cursor:pointer;font-size:13px;text-align:left;
}
.dsh-devops-nav-item:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dv-fg)}
.dsh-devops-nav-item[data-active="true"]{background:var(--dsw-alias-interactive-bg-active,hover);color:var(--dv-fg);font-weight:500}
.dsh-devops-nav-dot{
  flex:none;display:inline-flex;align-items:center;justify-content:center;
  width:18px;height:18px;font-size:13px;
}

/* ---------- 主区 ---------- */
.dsh-devops-main{flex:1;min-width:0;display:flex;flex-direction:column;min-height:0}
.dsh-devops-head{
  flex:none;display:flex;align-items:center;gap:10px;flex-wrap:wrap;
  padding:calc(var(--dsh-frame-top-clearance,0px) + 10px) 16px 10px 16px;
  border-bottom:0.5px solid var(--dv-border-3);
}
.dsh-devops-title{font-size:15px;font-weight:500;color:var(--dv-fg);margin:0}
.dsh-devops-sub{color:var(--dv-fg-3);font-size:12px}
.dsh-devops-spacer{flex:1}
.dsh-devops-body{flex:1;min-height:0;overflow:auto;padding:14px 16px 24px 16px}
.dsh-devops-body[data-flush="true"]{padding:0;overflow:hidden;display:flex;flex-direction:column}

/* ---------- 状态条（页内） ---------- */
.dsh-devops-statusbar-inline{
  flex:none;display:flex;align-items:center;gap:12px;flex-wrap:wrap;
  padding:5px 16px;font-size:12px;color:var(--dv-fg-3);
  border-bottom:0.5px solid var(--dv-border-3);
  background:var(--dsw-alias-bg-layer-1);
}
.dsh-devops-chip{
  display:inline-flex;align-items:center;gap:5px;padding:1px 7px;border-radius:999px;
  border:0.5px solid var(--dv-border);font-size:11px;color:var(--dv-fg-2);
  background:var(--dsw-alias-bg-layer-2,#0000);
}
.dsh-devops-chip[data-tone="ok"]{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}
.dsh-devops-chip[data-tone="warn"]{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}
.dsh-devops-chip[data-tone="error"]{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.dsh-devops-chip[data-tone="busy"]{color:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary)}
.dsh-devops-dot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--dsw-alias-state-idle-primary)}
.dsh-devops-dot[data-tone="ok"]{background:var(--dsw-alias-state-success-primary)}
.dsh-devops-dot[data-tone="warn"]{background:var(--dsw-alias-state-warn-primary)}
.dsh-devops-dot[data-tone="error"]{background:var(--dsw-alias-state-error-primary)}
.dsh-devops-dot[data-tone="busy"]{background:var(--dsw-alias-state-business-primary);animation:dsh-devops-pulse 1.2s ease-in-out infinite}
@keyframes dsh-devops-pulse{0%,100%{opacity:.35}50%{opacity:1}}

/* ---------- 通用控件 ---------- */
.dsh-devops-btn{
  display:inline-flex;align-items:center;justify-content:center;gap:6px;
  min-height:28px;padding:3px 10px;border-radius:var(--dv-r-md);cursor:pointer;
  border:0.5px solid var(--dv-border);background:transparent;color:var(--dv-fg);
  font-size:12px;white-space:nowrap;
}
.dsh-devops-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dsh-devops-btn:disabled{opacity:.45;cursor:default}
.dsh-devops-btn[data-variant="primary"]{
  background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));
  border-color:transparent;color:var(--dsw-alias-label-primary-foreground,#fff);
}
.dsh-devops-btn[data-variant="primary"]:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-brand-primary))}
.dsh-devops-btn[data-variant="danger"]{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.dsh-devops-btn[data-variant="ghost"]{border-color:transparent;color:var(--dv-fg-2)}
.dsh-devops-btn[data-size="sm"]{min-height:22px;padding:1px 7px;font-size:11px}
.dsh-devops-btn[data-active="true"]{background:var(--dsw-alias-interactive-bg-active,hover)}
.dsh-devops-input,.dsh-devops-select,.dsh-devops-textarea{
  width:100%;min-height:28px;padding:3px 8px;border-radius:var(--dv-r-md);
  border:0.5px solid var(--dv-border);background:var(--dsw-alias-bg-layer-1,#0000);
  color:var(--dv-fg);font-size:12px;font-family:inherit;outline:none;
}
.dsh-devops-input:focus,.dsh-devops-select:focus,.dsh-devops-textarea:focus{border-color:var(--dsw-alias-state-business-primary)}
.dsh-devops-textarea{min-height:64px;resize:vertical;line-height:18px}
.dsh-devops-input::placeholder,.dsh-devops-textarea::placeholder{color:var(--dsw-alias-label-caption)}
.dsh-devops-select{cursor:pointer}
.dsh-devops-switch{
  position:relative;width:34px;height:18px;border-radius:999px;flex:none;cursor:pointer;
  border:0.5px solid var(--dv-border);background:var(--dsw-alias-bg-layer-2,#0000);padding:0;
}
.dsh-devops-switch[data-on="true"]{background:var(--dsw-alias-brand-primary);border-color:transparent}
.dsh-devops-switch span{
  position:absolute;top:1px;left:1px;width:14px;height:14px;border-radius:50%;
  background:var(--dsw-alias-switch-thumb,#fff);transition:left .12s ease;
}
.dsh-devops-switch[data-on="true"] span{left:17px}

/* ---------- 字段 / 检查器 ---------- */
.dsh-devops-field{display:flex;flex-direction:column;gap:4px;margin-bottom:10px}
.dsh-devops-field-head{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dv-fg-2)}
.dsh-devops-field-label{font-weight:500;color:var(--dv-fg)}
.dsh-devops-required{color:var(--dsw-alias-state-error-primary)}
.dsh-devops-field-desc{font-size:11px;color:var(--dv-fg-3);line-height:16px}
.dsh-devops-field-row{display:flex;gap:6px;align-items:center}
.dsh-devops-field-error{font-size:11px;color:var(--dsw-alias-state-error-primary)}
.dsh-devops-hint{font-size:11px;color:var(--dv-fg-3)}
.dsh-devops-code{
  display:flex;border:0.5px solid var(--dv-border);border-radius:var(--dv-r-md);
  overflow:hidden;background:var(--dsw-alias-markdown-code-block,#0000);font-size:12px;
}
.dsh-devops-code-gutter{
  flex:none;padding:6px 6px 6px 8px;text-align:right;color:var(--dsw-alias-label-caption);
  background:var(--dsw-alias-bg-layer-2,#0000);user-select:none;font-family:var(--dsw-font-family-code,monospace);
  line-height:18px;white-space:pre;
}
.dsh-devops-code-area{
  flex:1;min-height:110px;padding:6px 8px;border:none;outline:none;resize:vertical;
  background:transparent;color:var(--dv-fg);line-height:18px;font-size:12px;
  font-family:var(--dsw-font-family-code,monospace);white-space:pre;overflow-wrap:normal;overflow-x:auto;
}
.dsh-devops-monospace{font-family:var(--dsw-font-family-code,monospace)}

/* ---------- 面板 / 卡片 ---------- */
.dsh-devops-card{
  border:0.5px solid var(--dv-border);border-radius:var(--dv-r-lg);
  background:var(--dsw-alias-bg-layer-1,#0000);padding:12px;margin-bottom:12px;
}
.dsh-devops-card-head{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.dsh-devops-card-title{font-size:13px;font-weight:500;color:var(--dv-fg);margin:0}
.dsh-devops-grid{display:grid;gap:12px}
.dsh-devops-grid[data-cols="2"]{grid-template-columns:repeat(auto-fill,minmax(240px,1fr))}
.dsh-devops-grid[data-cols="3"]{grid-template-columns:repeat(auto-fill,minmax(190px,1fr))}
.dsh-devops-kv{display:grid;grid-template-columns:auto 1fr;gap:3px 10px;font-size:12px}
.dsh-devops-kv dt{color:var(--dv-fg-3)}
.dsh-devops-kv dd{margin:0;color:var(--dv-fg);word-break:break-all}
.dsh-devops-empty{padding:22px;text-align:center;color:var(--dv-fg-3);font-size:12px}
.dsh-devops-list{display:flex;flex-direction:column;gap:4px}
.dsh-devops-list-row{
  display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:var(--dv-r-md);
  border:0.5px solid transparent;cursor:pointer;font-size:12px;
}
.dsh-devops-list-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-devops-list-row[data-active="true"]{background:var(--dsw-alias-interactive-bg-active,hover);border-color:var(--dv-border-2)}
.dsh-devops-truncate{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.dsh-devops-tag{
  display:inline-flex;align-items:center;padding:0 6px;border-radius:999px;
  border:0.5px solid var(--dv-border);font-size:10px;color:var(--dv-fg-3);
}
.dsh-devops-link{color:var(--dsw-alias-link);cursor:pointer;background:none;border:none;padding:0;font-size:12px}

/* ---------- 表格 ---------- */
.dsh-devops-table{width:100%;border-collapse:collapse;font-size:12px}
.dsh-devops-table th{
  text-align:left;font-weight:500;color:var(--dv-fg-3);padding:6px 8px;
  border-bottom:0.5px solid var(--dv-border-3);white-space:nowrap;
}
.dsh-devops-table td{padding:6px 8px;border-bottom:0.5px solid var(--dv-border-2);vertical-align:middle}
.dsh-devops-table tr:hover td{background:var(--dsw-alias-interactive-bg-hover)}

/* ---------- 编辑器三栏 ---------- */
.dsh-devops-editor{flex:1;display:flex;min-height:0}
.dsh-devops-palette{
  flex:none;width:190px;display:flex;flex-direction:column;min-height:0;
  border-right:0.5px solid var(--dv-border-3);overflow:hidden;
}
.dsh-devops-palette-scroll{flex:1;overflow:auto;padding:8px}
.dsh-devops-inspector{
  flex:none;width:288px;display:flex;flex-direction:column;min-height:0;
  border-left:0.5px solid var(--dv-border-3);overflow:hidden;
}
.dsh-devops-inspector-scroll{flex:1;overflow:auto;padding:10px}
.dsh-devops-canvas{flex:1;min-width:0;overflow:auto;position:relative;padding:12px}
.dsh-devops-lane{
  border:0.5px solid var(--dv-border);border-radius:var(--dv-r-lg);margin-bottom:12px;
  background:var(--dsw-alias-bg-layer-1,#0000);
}
.dsh-devops-lane[data-drop="true"]{border-color:var(--dsw-alias-state-business-primary)}
.dsh-devops-lane-head{
  display:flex;align-items:center;gap:8px;padding:6px 10px;
  border-bottom:0.5px solid var(--dv-border-2);
}
.dsh-devops-lane-title{font-size:12px;font-weight:500;color:var(--dv-fg)}
.dsh-devops-lane-cards{display:flex;flex-wrap:wrap;gap:8px;padding:10px;min-height:52px;align-items:flex-start}
.dsh-devops-nodecard{
  position:relative;width:172px;border:0.5px solid var(--dv-border);border-radius:var(--dv-r-md);
  background:var(--dsw-alias-bg-layer-2,#0000);padding:7px 9px;cursor:grab;user-select:none;
}
.dsh-devops-nodecard[data-selected="true"]{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary)}
.dsh-devops-nodecard[data-dragging="true"]{opacity:.5}
.dsh-devops-nodecard-title{font-size:12px;font-weight:500;color:var(--dv-fg);margin-bottom:2px}
.dsh-devops-nodecard-meta{font-size:10px;color:var(--dv-fg-3);display:flex;gap:6px;flex-wrap:wrap}
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
  background:var(--dsw-alias-bg-layer-1,#0000);overflow:hidden;
}
.dsh-devops-stepcard[data-status="failed"]{border-color:var(--dsw-alias-state-error-primary)}
.dsh-devops-stepcard[data-status="running"]{border-color:var(--dsw-alias-state-business-primary)}
.dsh-devops-stepcard-head{
  display:flex;align-items:center;gap:8px;padding:6px 9px;cursor:pointer;
}
.dsh-devops-stepcard-head:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-devops-stepcard-title{font-size:12px;font-weight:500;color:var(--dv-fg)}
.dsh-devops-stepcard-meta{font-size:11px;color:var(--dv-fg-3);display:flex;gap:8px;flex-wrap:wrap}
.dsh-devops-phases{display:flex;gap:3px;align-items:center}
.dsh-devops-phase{
  width:14px;height:4px;border-radius:2px;background:var(--dsw-alias-bg-layer-3,var(--dv-border));
}
.dsh-devops-phase[data-state="done"]{background:var(--dsw-alias-state-success-primary)}
.dsh-devops-phase[data-state="active"]{background:var(--dsw-alias-state-business-primary)}
.dsh-devops-phase[data-state="failed"]{background:var(--dsw-alias-state-error-primary)}

/* ---------- 日志面板 ---------- */
.dsh-devops-logpanel{border-top:0.5px solid var(--dv-border-3);background:var(--dsw-alias-markdown-code-block,#0000)}
.dsh-devops-logbar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:4px 8px;border-bottom:0.5px solid var(--dv-border-2)}
.dsh-devops-logview{
  height:230px;overflow:auto;padding:6px 8px;font-size:11.5px;line-height:17px;
  font-family:var(--dsw-font-family-code,monospace);white-space:pre-wrap;word-break:break-all;
  color:var(--dv-fg-2);
}
.dsh-devops-logline[data-stream="stderr"]{color:var(--dsw-alias-state-error-primary)}
.dsh-devops-logline mark{background:var(--dsw-alias-state-warn-tertiary,#ff0);color:inherit}
.dsh-devops-log-gap{color:var(--dsw-alias-state-warn-primary);font-style:italic}

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
  padding:5px 11px;border-radius:999px;
  border:0.5px solid var(--dv-border-2);
  background:var(--dsw-alias-toast-bg,var(--dsw-alias-bg-layer-3,#1c1c1e));
  color:var(--dsw-alias-toast-label,var(--dv-fg));
  box-shadow:0 4px 16px rgba(0,0,0,.18);
  font-size:12px;
}
.dsh-devops-overlay-bar[data-clickable="true"]{cursor:pointer}
.dsh-devops-overlay-bar[data-clickable="true"]:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-devops-overlay-seg{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
.dsh-devops-overlay-seg+.dsh-devops-overlay-seg{padding-left:10px;border-left:0.5px solid var(--dv-border-2)}
.dsh-devops-overlay-mono{font-variant-numeric:tabular-nums;font-family:var(--dsw-font-family-code,monospace)}

/* ---------- 弹层 ---------- */
.dsh-devops-modal-backdrop{
  position:fixed;inset:0;z-index:1000;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.35));
  display:flex;align-items:center;justify-content:center;padding:24px;
}
.dsh-devops-modal{
  width:min(560px,100%);max-height:86vh;display:flex;flex-direction:column;
  border-radius:var(--dv-r-xl);border:0.5px solid var(--dv-border-2);
  background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base));color:var(--dv-fg);
  box-shadow:0 12px 40px rgba(0,0,0,.28);
}
.dsh-devops-modal[data-wide="true"]{width:min(880px,100%)}
.dsh-devops-modal-head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:0.5px solid var(--dv-border-2)}
.dsh-devops-modal-body{padding:14px;overflow:auto}
.dsh-devops-modal-foot{display:flex;justify-content:flex-end;gap:8px;padding:10px 14px;border-top:0.5px solid var(--dv-border-2)}

/* ---------- 浏览器 / 下拉候选 ---------- */
.dsh-devops-dropdown{
  position:absolute;z-index:1200;margin-top:2px;max-height:216px;overflow:auto;width:100%;
  border:0.5px solid var(--dv-border-2);border-radius:var(--dv-r-md);
  background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base));
  box-shadow:0 8px 24px rgba(0,0,0,.2);
}
.dsh-devops-dropdown-row{display:flex;align-items:center;gap:6px;padding:4px 8px;cursor:pointer;font-size:12px}
.dsh-devops-dropdown-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-devops-dropdown-note{padding:4px 8px;font-size:11px;color:var(--dv-fg-3)}
.dsh-devops-upload-preview{
  max-height:190px;overflow:auto;border:0.5px solid var(--dv-border-2);border-radius:var(--dv-r-md);
  padding:6px 8px;font-size:11.5px;font-family:var(--dsw-font-family-code,monospace);
  background:var(--dsw-alias-bg-layer-2,#0000);color:var(--dv-fg-2);
}
.dsh-devops-banner{
  border-radius:var(--dv-r-md);padding:8px 10px;margin-bottom:10px;font-size:12px;
  border:0.5px solid var(--dv-border-2);background:var(--dsw-alias-bg-layer-2,#0000);color:var(--dv-fg-2);
}
.dsh-devops-banner[data-tone="error"]{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.dsh-devops-banner[data-tone="warn"]{border-color:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-primary)}
.dsh-devops-banner[data-tone="ok"]{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}

@media (max-width:900px){
  .dsh-devops-palette{display:none}
  .dsh-devops-inspector{width:250px}
  .dsh-devops-nav{width:104px}
}
`;

exports.ensureStyles = ensureStyles;
exports.CSS = CSS;
