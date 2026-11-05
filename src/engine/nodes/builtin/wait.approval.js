/**
 * 节点：wait.approval —— 人工审批
 *
 * 语义：把步骤置为 running 并等待外部审批（通过 store 中的审批记录或
 * engine.resolveApproval 触发）。超时未审批按配置失败或继续。
 * 运行被取消时立刻结束。
 */
import { F } from '../helpers.js';

export const descriptor = {
  type: 'wait.approval',
  title: '人工审批',
  category: 'flow',
  icon: 'user-check',
  description: '暂停流水线等待人工确认，可设置超时策略',
  fields: [
    F.text('message', '审批说明', { rows: 3, required: true, placeholder: '确认是否发布到生产环境' }),
    F.string('approvers', '审批人', {
      placeholder: 'alice,bob',
      description: '逗号分隔的用户名；留空表示任何有权限的人都可以审批',
    }),
    F.number('timeoutMs', '超时时间', { min: 0, unit: 'ms', default: 3600000, description: '0 表示不超时' }),
    F.enum('onTimeout', '超时处理', ['fail', 'continue'], { default: 'fail', description: '超时后是失败还是继续执行' }),
  ],
  outputs: [
    { name: 'approved', type: 'boolean' },
    { name: 'approvedBy', type: 'string' },
    { name: 'comment', type: 'string' },
    { name: 'waitedMs', type: 'number' },
  ],
  env: [],
  runtime: null,

  async run(rt, inputs = {}) {
    const message = String(inputs.message ?? '请确认是否继续');
    const timeoutMs = Number(inputs.timeoutMs) > 0 ? Number(inputs.timeoutMs) : 0;
    const startedAt = Date.now();

    if (typeof rt.log === 'function') {
      rt.log(`等待人工审批：${message}\n`, 'stdout');
    }
    if (typeof rt.setPhase === 'function') rt.setPhase('running');

    // 审批通道：engine 通过 rt.approvals 暴露 { wait(stepId, meta) → Promise }
    if (rt.approvals && typeof rt.approvals.wait === 'function') {
      try {
        const decision = await rt.approvals.wait(rt.step?.id, {
          message,
          approvers: Array.isArray(inputs.approvers) ? inputs.approvers : [],
          timeoutMs,
          signal: rt.signal,
        });
        const waitedMs = Date.now() - startedAt;
        const approved = decision?.approved !== false;
        if (typeof rt.log === 'function') {
          rt.log(`${approved ? '已批准' : '已拒绝'}${decision?.by ? `（${decision.by}）` : ''}${decision?.comment ? `：${decision.comment}` : ''}\n`, 'stdout');
        }
        return {
          exitCode: approved ? 0 : 1,
          outputs: {
            approved,
            approvedBy: decision?.by ?? '',
            comment: decision?.comment ?? '',
            waitedMs,
          },
          ...(approved ? {} : { error: '审批被拒绝' }),
        };
      } catch (error) {
        if (rt.signal?.aborted) {
          return { exitCode: 130, outputs: { approved: false, waitedMs: Date.now() - startedAt }, error: '审批等待被取消' };
        }
        // 超时
        if (inputs.onTimeout === 'continue') {
          if (typeof rt.log === 'function') rt.log(`审批超时（${timeoutMs}ms），按配置继续执行\n`, 'stdout');
          return { exitCode: 0, outputs: { approved: false, approvedBy: '', comment: '超时自动继续', waitedMs: Date.now() - startedAt } };
        }
        return {
          exitCode: 1,
          outputs: { approved: false, waitedMs: Date.now() - startedAt },
          error: `审批超时：${error?.message ?? error}`,
        };
      }
    }

    // 没有审批通道：按超时策略降级，避免流水线永久卡住
    if (typeof rt.log === 'function') {
      rt.log('当前环境未提供审批通道（rt.approvals），按超时策略处理\n', 'stderr');
    }
    if (inputs.onTimeout === 'continue') {
      return { exitCode: 0, outputs: { approved: false, comment: '无审批通道，按配置继续', waitedMs: Date.now() - startedAt } };
    }
    return {
      exitCode: 1,
      outputs: { approved: false, waitedMs: Date.now() - startedAt },
      error: '当前环境未提供人工审批通道（rt.approvals.wait）',
    };
  },
};

export default descriptor;
