/**
 * 节点：pipeline.call —— 调用子流水线
 *
 * - 通过 rt.engine.startSubRun(pipelineId, options) 触发（由 engine 提供）。
 * - 调用前用 dag.js 的 detectPipelineCallCycle 做环检测，避免 A→B→A 递归失控。
 * - 默认等待子流水线结束并继承其状态（可配置 wait=false 只触发不等结果）。
 */
import { F } from '../helpers.js';
import { detectPipelineCallCycle } from '../../dag.js';

export const descriptor = {
  type: 'pipeline.call',
  title: '调用子流水线',
  category: 'flow',
  icon: 'git-merge',
  description: '触发另一条流水线，可等待其完成并继承结果',
  fields: [
    F.pipeline('pipelineId', '子流水线', { required: true, placeholder: 'build-deploy' }),
    F.boolean('wait', '等待完成', { default: true, description: '关闭时只触发，不阻塞当前流水线' }),
    F.number('timeoutMs', '等待超时', { min: 0, unit: 'ms', default: 0, description: '0 表示沿用子流水线自身超时' }),
    F.keyvalue('variables', '传入变量', { description: '覆盖子流水线的变量；同名优先于子流水线自身变量' }),
    F.boolean('inheritEnv', '继承当前环境变量', { default: false }),
    F.boolean('failOnChildFailure', '子流水线失败则本步骤失败', { default: true }),
  ],
  outputs: [
    { name: 'childRunId', type: 'string' },
    { name: 'status', type: 'string' },
    { name: 'waited', type: 'boolean' },
    { name: 'durationMs', type: 'number' },
  ],
  env: [],
  runtime: null,

  async run(rt, inputs = {}) {
    const pipelineId = String(inputs.pipelineId ?? '').trim();
    if (!pipelineId) return { exitCode: 1, error: '子流水线 ID 不能为空' };

    if (typeof rt.engine?.startSubRun !== 'function') {
      return { exitCode: 1, error: '当前环境未提供子流水线调用能力（rt.engine.startSubRun）' };
    }

    // 环检测：把当前调用链与本次调用一起判断
    const chain = Array.isArray(rt.run?.callChain) ? rt.run.callChain : [];
    const rootId = String(rt.run?.pipelineId ?? '');
    const edges = [];
    for (let i = 0; i < chain.length; i += 1) {
      if (i + 1 < chain.length) edges.push({ from: chain[i], to: chain[i + 1] });
    }
    if (chain.length) edges.push({ from: chain[chain.length - 1], to: pipelineId });
    else if (rootId) edges.push({ from: rootId, to: pipelineId });

    const cycle = detectPipelineCallCycle(rootId, edges, pipelineId);
    if (cycle.cyclic) {
      return {
        exitCode: 1,
        error: `子流水线调用成环，已拒绝：${cycle.cycle.join(' → ')}`,
        outputs: { childRunId: '', status: 'rejected', waited: false, durationMs: 0 },
      };
    }

    const variables = {};
    if (inputs.inheritEnv === true) {
      for (const [key, value] of Object.entries(rt.env ?? {})) {
        if (value !== undefined) variables[key] = String(value);
      }
    }
    for (const [key, value] of Object.entries(inputs.variables ?? {})) {
      variables[key] = value === undefined ? undefined : String(value);
    }
    variables.DSH_PARENT_RUN = String(rt.run?.id ?? '');
    variables.DSH_PARENT_STEP = String(rt.step?.id ?? '');

    const startedAt = Date.now();
    let child;
    try {
      child = await rt.engine.startSubRun(pipelineId, {
        variables,
        parentRunId: rt.run?.id ?? null,
        parentStepId: rt.step?.id ?? null,
        trigger: 'pipeline.call',
        signal: rt.signal,
      });
    } catch (error) {
      return { exitCode: 1, error: `子流水线启动失败：${error?.message ?? error}` };
    }

    const childRunId = String(child?.runId ?? child?.id ?? '');
    if (typeof rt.log === 'function') rt.log(`已触发子流水线 ${pipelineId}（run ${childRunId}）\n`, 'stdout');

    if (inputs.wait === false) {
      return { exitCode: 0, outputs: { childRunId, status: 'running', waited: false, durationMs: Date.now() - startedAt } };
    }

    if (typeof child?.wait !== 'function') {
      return { exitCode: 0, outputs: { childRunId, status: 'running', waited: true, durationMs: Date.now() - startedAt } };
    }

    let result;
    try {
      result = await child.wait({
        timeoutMs: Number(inputs.timeoutMs) > 0 ? Number(inputs.timeoutMs) : 0,
        signal: rt.signal,
      });
    } catch (error) {
      return { exitCode: 1, outputs: { childRunId, status: 'failed', waited: true, durationMs: Date.now() - startedAt }, error: `等待子流水线失败：${error?.message ?? error}` };
    }

    const status = String(result?.status ?? 'unknown');
    const durationMs = Date.now() - startedAt;
    if (typeof rt.log === 'function') rt.log(`子流水线 ${childRunId} 结束：${status}\n`, 'stdout');

    const failed = status !== 'success';
    if (failed && inputs.failOnChildFailure !== false) {
      return { exitCode: 1, outputs: { childRunId, status, waited: true, durationMs }, error: `子流水线 ${pipelineId} 结果为 ${status}` };
    }
    return { exitCode: 0, outputs: { childRunId, status, waited: true, durationMs } };
  },
};

export default descriptor;
