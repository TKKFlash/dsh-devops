/**
 * AI 联动入口：把流水线/失败运行编译成提示词，送进一个新会话。
 *
 * 降级链（任一层可用即停，全部不可用则复制到剪贴板）：
 *   1) ctx.get('uiWorkspace').startSession(undefined, { prompt, whenDraftExists })
 *      —— 新建会话并把提示词预填进 composer（正解）。
 *   2) ctx.get('conversation') 的入参面：requestDraftInitialization / send(text)。
 *   3) navigator.clipboard.writeText(prompt) + toast 提示去对话里粘贴。
 *
 * 任何一步抛错都继续往下降，绝不因为宿主能力缺失而中断用户操作。
 */
const { h, copyText } = require('./h.js');
const { Button } = require('./ui.js');

/** 从宿主 ctx 上安全取一个服务，取不到返回 null。 */
function safeGet(ctx, name) {
  if (!ctx) return null;
  try {
    if (typeof ctx.get === 'function') return ctx.get(name) || null;
  } catch {
    return null;
  }
  try {
    return ctx[name] || null;
  } catch {
    return null;
  }
}

/** 组装提示词尾部：要求按技能规范产出并先自校验。 */
function authoringTail() {
  return [
    '',
    '要求：',
    '1. 遵循 devops-pipeline-authoring 技能的规范来编排阶段、节点与依赖；',
    '2. 产出流水线后，先调用 devops_validate_pipeline 校验，确认无错误再交付；',
    '3. 明确说明每个节点的 server、needs、超时与重试取舍。',
  ].join('\n');
}

/** 把当前流水线编译成给模型的提示词。 */
function buildPipelinePrompt(pipeline, extra) {
  const lines = [];
  lines.push('我在用 dsh-devops 插件编排 CI/CD 流水线，请帮我完善它。');
  lines.push('');
  if (pipeline && (pipeline.name || pipeline.id)) {
    lines.push('流水线：' + (pipeline.name || pipeline.id));
    if (pipeline.description) lines.push('描述：' + pipeline.description);
    lines.push('调度模式：' + (hasNeeds(pipeline) ? 'DAG（按 needs 依赖）' : '阶段串行 + 阶段内并行开关'));
    lines.push('');
    lines.push('当前结构：');
    for (const stage of pipeline.stages || []) {
      lines.push('- 阶段「' + (stage.name || stage.id) + '」' + (stage.parallel ? '（并行）' : '（串行）'));
      for (const job of stage.jobs || []) {
        const bits = ['node=' + job.node];
        if (job.server) bits.push('server=' + job.server);
        if (job.needs && job.needs.length) bits.push('needs=' + job.needs.join(','));
        if (job.timeoutMs) bits.push('timeoutMs=' + job.timeoutMs);
        if (job.when && job.when !== 'on_success') bits.push('when=' + job.when);
        lines.push('  · ' + (job.name || job.id) + ' [' + bits.join(' ') + ']');
        if (job.with && Object.keys(job.with).length) lines.push('    参数：' + JSON.stringify(job.with).slice(0, 600));
      }
    }
    lines.push('');
    lines.push('完整 JSON：');
    lines.push('```json');
    lines.push(safeStringify(pipeline, 6000));
    lines.push('```');
  } else {
    lines.push('我还没有流水线定义，请从零帮我设计一条。');
  }
  if (extra) {
    lines.push('');
    lines.push(extra);
  }
  lines.push(authoringTail());
  return lines.join('\n');
}

/** 把失败的运行编译成诊断提示词：失败步骤 + stderr 尾部 + phase 历史。 */
function buildFailurePrompt(run, logs) {
  const lines = [];
  lines.push('我在用 dsh-devops 插件跑流水线，运行失败了，请帮我定位根因并给出修复步骤。');
  lines.push('');
  if (run) {
    lines.push('运行：' + run.id + '（流水线 ' + (run.pipelineName || run.pipelineId) + '）');
    lines.push('状态：' + run.status + '，触发方式：' + (run.trigger || 'manual'));
    lines.push('');
    lines.push('各步骤实况：');
    for (const id of Object.keys(run.steps || {})) {
      const step = run.steps[id];
      const bits = ['status=' + step.status, 'phase=' + (step.phase || '-')];
      if (step.exitCode !== null && step.exitCode !== undefined) bits.push('exitCode=' + step.exitCode);
      if (step.server) bits.push('server=' + step.server);
      if (step.attempt) bits.push('attempt=' + step.attempt);
      if (step.startedAt && step.finishedAt) bits.push('耗时=' + Math.round((step.finishedAt - step.startedAt) / 1000) + 's');
      lines.push('- ' + (step.name || id) + ' [' + bits.join(' ') + ']');
      if (step.error) lines.push('  错误：' + step.error);
      if (step.detail) lines.push('  细节：' + String(step.detail).slice(0, 400));
    }
    const failed = Object.keys(run.steps || {})
      .map((id) => run.steps[id])
      .filter((s) => s.status === 'failed');
    if (failed.length) {
      lines.push('');
      lines.push('失败集中在：' + failed.map((s) => s.name || s.id).join('、'));
    }
  }
  if (logs) {
    lines.push('');
    lines.push('失败步骤日志尾部（stderr 优先）：');
    lines.push('```');
    lines.push(String(logs).slice(-4000));
    lines.push('```');
  }
  lines.push('');
  lines.push('请指出最可能的根因，并给出具体到命令或配置项的修复建议；如果需要改流水线，给出可直接采用的 JSON 片段。');
  return lines.join('\n');
}

function hasNeeds(pipeline) {
  for (const stage of (pipeline && pipeline.stages) || []) {
    for (const job of stage.jobs || []) {
      if (job.needs && job.needs.length) return true;
    }
  }
  return false;
}

function safeStringify(value, limit) {
  try {
    const text = JSON.stringify(value, null, 2);
    return text.length > limit ? text.slice(0, limit) + '\n…（已截断）' : text;
  } catch {
    return '（无法序列化）';
  }
}

/**
 * 尝试用宿主能力把提示词送进会话。
 * @returns {ok:boolean, reason:string, how?:string}
 */
function sendViaHost(ctx, prompt) {
  // 1) uiWorkspace.startSession —— 新建会话并预填 composer
  const uiWorkspace = safeGet(ctx, 'uiWorkspace');
  if (uiWorkspace && typeof uiWorkspace.startSession === 'function') {
    try {
      uiWorkspace.startSession(undefined, { prompt, whenDraftExists: 'append' });
      return { ok: true, how: 'session', reason: '已新建会话并预填提示词' };
    } catch (error) {
      // 继续往下降
    }
  }

  // 2) 会话入参面：requestDraftInitialization / send(text)
  const conversation = safeGet(ctx, 'conversation') || safeGet(ctx, 'uiConversation');
  if (conversation) {
    const input = conversation.input;
    if (input && typeof input.requestDraftInitialization === 'function') {
      try {
        const result = input.requestDraftInitialization({ prompt, whenDraftExists: 'append' });
        if (result !== 'blocked') return { ok: true, how: 'draft', reason: '已预填会话草稿（' + result + '）' };
      } catch (error) {
        /* 继续 */
      }
    }
    if (input && typeof input.setDraft === 'function') {
      try {
        input.setDraft(prompt);
        return { ok: true, how: 'draft', reason: '已预填会话草稿' };
      } catch (error) {
        /* 继续 */
      }
    }
    if (typeof conversation.send === 'function') {
      try {
        conversation.send(prompt);
        return { ok: true, how: 'send', reason: '已发送到当前会话' };
      } catch (error) {
        /* 继续 */
      }
    }
  }
  return { ok: false, reason: '宿主未提供可用的会话服务' };
}

/**
 * AI 按钮：点击后走降级链。
 * props: { ctx, prompt: () => string, label, toast, title, size }
 */
function AiButton(props) {
  async function run(event) {
    if (event && event.stopPropagation) event.stopPropagation();
    const prompt = typeof props.prompt === 'function' ? props.prompt() : String(props.prompt || '');
    if (!prompt.trim()) {
      props.toast && props.toast.warn('没有可发送的内容');
      return;
    }

    const result = sendViaHost(props.ctx, prompt);
    if (result.ok) {
      props.toast && props.toast.ok(result.reason);
      if (props.onSent) props.onSent(result);
      return;
    }

    // 3) 兜底：复制到剪贴板
    const copied = await copyText(prompt);
    if (copied) {
      props.toast && props.toast.ok('提示词已复制，去对话里粘贴即可');
      if (props.onSent) props.onSent({ ok: true, how: 'clipboard' });
    } else {
      props.toast && props.toast.error('无法复制提示词：' + result.reason);
    }
  }

  return h(Button, {
    size: props.size || 'sm',
    icon: 'sparkle',
    label: props.label || '让 AI 帮我写',
    title: props.title || '新建会话并预填提示词；宿主不支持时复制到剪贴板',
    onClick: run,
  });
}

exports.AiButton = AiButton;
exports.buildPipelinePrompt = buildPipelinePrompt;
exports.buildFailurePrompt = buildFailurePrompt;
exports.sendViaHost = sendViaHost;
exports.authoringTail = authoringTail;
