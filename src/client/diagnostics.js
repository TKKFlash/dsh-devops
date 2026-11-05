/**
 * 卡住诊断：phase 流转 + 「已多久无输出」+ 临近超时倒计时 + 归因线索。
 * 全部基于步骤对象本地计算，前端每秒刷新，不轮询后端。
 */
const { h } = require('./h.js');
const { Icon } = require('./ui.js');
const { PHASES, PHASE_TEXT } = require('./state.js');

/** 步骤是否处于「进行中」——只有进行中的步骤才需要诊断。 */
function isLive(step) {
  return !!step && (step.status === 'running' || step.status === 'pending');
}

/**
 * 计算卡住诊断。
 * 返回 { live, silentMs, silentText, stuck, phaseIndex, timeoutLeftMs, nearTimeout,
 *        clues:[{tone,text}], elapsedMs }
 */
function diagnoseStep(step, options) {
  const opts = options || {};
  const now = opts.now || Date.now();
  const stuckSilenceSec = opts.stuckSilenceSec || 60;
  const out = {
    live: isLive(step),
    elapsedMs: 0,
    silentMs: 0,
    silentText: '',
    stuck: false,
    phaseIndex: -1,
    timeoutLeftMs: null,
    nearTimeout: false,
    clues: [],
  };
  if (!step) return out;

  const startedAt = step.startedAt || 0;
  if (startedAt) out.elapsedMs = Math.max(0, (step.finishedAt || now) - startedAt);

  const lastOutputAt = step.lastOutputAt || startedAt || 0;
  if (lastOutputAt) out.silentMs = Math.max(0, now - lastOutputAt);

  const phase = step.phase || 'queued';
  out.phaseIndex = PHASES.indexOf(phase);

  if (out.live) {
    // 「已 Xm Ys 无输出」——只有运行中且确实静默时才有意义
    if (out.silentMs > 0) {
      out.silentText = '已 ' + humanMs(out.silentMs) + ' 无输出';
      out.stuck = out.silentMs >= stuckSilenceSec * 1000;
    }
    if (step.timeoutMs && startedAt) {
      out.timeoutLeftMs = startedAt + step.timeoutMs - now;
      out.nearTimeout = out.timeoutLeftMs > 0 && out.timeoutLeftMs <= 60000;
    }
  }

  out.clues = buildClues(step, out, opts);
  return out;
}

function humanMs(ms) {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m === 0) return s + 's';
  return m + 'm ' + String(s).padStart(2, '0') + 's';
}

/** 归因线索：把「卡在哪一步」翻译成可执行的动作建议。 */
function buildClues(step, diag, opts) {
  const clues = [];
  const phase = step.phase || 'queued';
  const server = opts.server || null;
  const isRemote = server && server.kind === 'ssh';

  if (step.status === 'failed') {
    if (step.exitCode !== null && step.exitCode !== undefined && step.exitCode !== 0) {
      clues.push({ tone: 'error', text: '退出码 ' + step.exitCode + '，命令本身失败；先看日志末尾的非零退出原因。' });
    }
    if (step.error) clues.push({ tone: 'error', text: step.error });
    if (isRemote) clues.push({ tone: 'warn', text: '远端执行失败常见原因：SSH 认证/网络中断、目标路径不存在、运行时缺失（可用服务器页「一键安装」补齐）。' });
    return clues;
  }

  if (!diag.live) return clues;

  if (phase === 'connecting') {
    clues.push({ tone: 'warn', text: '长时间停留在「建立连接」：多为主机不可达或认证失败。到服务器页点「测试连接」核实。' });
  } else if (phase === 'provisioning') {
    clues.push({ tone: 'warn', text: '正在准备运行时（下载/编译解释器可能较慢）。若无输出超过阈值，检查服务器出网能力或改用已装版本。' });
  } else if (phase === 'transferring') {
    clues.push({ tone: 'warn', text: '文件传输中：大文件或慢链路会长时间无输出，属正常；若卡满超时考虑缩小 artifacts 范围。' });
  } else if (phase === 'draining') {
    clues.push({ tone: 'warn', text: '正在收尾：进程可能已退出但输出流尚未关闭。' });
  }

  if (phase === 'queued') {
    clues.push({ tone: 'warn', text: '排队中：并发已达到上限，等前面步骤结束后会自动开始。' });
  }

  if (diag.stuck) {
    clues.push({
      tone: 'warn',
      text: '疑似卡住：' + diag.silentText + '（阈值 ' + (opts.stuckSilenceSec || 60) + 's）。可查看日志确认是否有交互式提示在等待输入，必要时取消并重试。',
    });
  }
  if (diag.nearTimeout && diag.timeoutLeftMs !== null) {
    clues.push({ tone: 'error', text: '接近超时：剩余 ' + humanMs(diag.timeoutLeftMs) + '，超时后该步骤会被判失败。' });
  }
  if (step.attempt && step.attempt > 1) {
    clues.push({ tone: 'warn', text: '这是第 ' + step.attempt + ' 次尝试，前一次失败可能是瞬时故障。' });
  }
  return clues;
}

/** phase 流转小方块：走到的显示 done，当前显示 active。 */
function PhaseFlow(props) {
  const current = props.phase || 'queued';
  const index = PHASES.indexOf(current);
  const failed = props.status === 'failed';
  const settled = props.status === 'success';
  return h(
    'div',
    { className: 'dsh-devops-phases', title: '阶段：' + (PHASE_TEXT[current] || current) },
    PHASES.map((phase, i) => {
      let state = 'idle';
      if (i < index) state = 'done';
      else if (i === index) state = failed ? 'failed' : settled && phase === 'settled' ? 'done' : 'active';
      return h('span', { key: phase, className: 'dsh-devops-phase', 'data-state': state, title: PHASE_TEXT[phase] + '（' + phase + '）' });
    }),
    h('span', { style: { marginLeft: '4px', color: 'var(--dsw-alias-label-tertiary)' } }, PHASE_TEXT[current] || current),
  );
}

/** 卡住诊断行：静默时长 + 倒计时 + 线索。 */
function StuckPanel(props) {
  const diag = props.diag;
  if (!diag || !diag.live) return null;
  const parts = [];
  if (diag.silentText) parts.push(diag.silentText);
  if (diag.timeoutLeftMs !== null && diag.timeoutLeftMs !== undefined) parts.push('超时倒计时 ' + humanMs(Math.max(0, diag.timeoutLeftMs)));
  if (diag.elapsedMs) parts.push('已运行 ' + humanMs(diag.elapsedMs));

  return h(
    'div',
    { style: { padding: '6px 8px', borderTop: '0.5px solid var(--dsw-alias-border-l2)' } },
    h(
      'div',
      { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)' } },
      h(PhaseFlow, { phase: props.step && props.step.phase, status: props.step && props.step.status }),
      parts.length ? h('span', null, parts.join('  ·  ')) : null,
      diag.stuck ? h(Icon, { name: 'warn', size: 11 }) : null,
    ),
    diag.clues.length
      ? h(
          'div',
          { style: { marginTop: '5px', display: 'flex', flexDirection: 'column', gap: '3px' } },
          diag.clues.map((clue, i) =>
            h(
              'div',
              {
                key: i,
                style: {
                  fontSize: '11px',
                  color:
                    clue.tone === 'error'
                      ? 'var(--dsw-alias-state-error-primary)'
                      : clue.tone === 'warn'
                        ? 'var(--dsw-alias-state-warn-primary)'
                        : 'var(--dsw-alias-label-tertiary)',
                },
              },
              '· ' + clue.text,
            ),
          ),
        )
      : null,
  );
}

/**
 * 失败归因建议：根据 run 的步骤集合给出可操作建议。
 */
function attributionFor(run) {
  if (!run) return [];
  const steps = Object.keys(run.steps || {}).map((id) => run.steps[id]);
  const failed = steps.filter((s) => s.status === 'failed');
  if (!failed.length) return [];
  const tips = [];
  const first = failed[0];
  tips.push('首个失败的步骤是「' + (first.name || first.id) + '」，修它通常能连带解决后续失败。');
  if (failed.some((s) => s.exitCode === 127)) tips.push('出现退出码 127：命令或解释器不存在，检查运行时是否装好、PATH 是否包含。');
  if (failed.some((s) => s.exitCode === 126)) tips.push('出现退出码 126：文件不可执行，检查权限位。');
  if (failed.some((s) => s.error && /超时|timeout/i.test(s.error))) tips.push('存在超时失败：调大该步骤的 timeoutMs，或把长任务拆小。');
  if (failed.length > 1) tips.push('想只重跑失败的一步，用步骤卡片上的「重试此步」。');
  return tips;
}

exports.diagnoseStep = diagnoseStep;
exports.isLive = isLive;
exports.humanMs = humanMs;
exports.PhaseFlow = PhaseFlow;
exports.StuckPanel = StuckPanel;
exports.attributionFor = attributionFor;
