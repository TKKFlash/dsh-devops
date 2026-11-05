/**
 * src/engine/dag.js —— 依赖图与调度计划（契约 §2.1 调度模式）
 *
 * 两种调度模式（契约规定不得混用）：
 * - 'dag'    ：任一 job 有非空 needs → 整条流水线按 DAG 调度（跨阶段依赖生效）
 * - 'staged' ：无 needs → 阶段串行，阶段内由 parallel 决定并/串行
 * - 'invalid'：同时存在 needs 与 parallel:true 阶段（mixed-scheduling）
 *
 * 本模块只做纯计算，不碰文件系统与执行器，便于单测。
 */

/** 依赖满足时该 job 是否已经「结束」的状态集合 */
const SETTLED = new Set(['success', 'failed', 'skipped', 'canceled']);

/** 判断 step 是否已结束（含被计划性跳过） */
export function isSettled(step, skipped) {
  if (!step) return false;
  if (SETTLED.has(step.status)) return true;
  return Boolean(skipped && skipped.has(step.id));
}

/** 计算某 job 的 when 在前置失败与否时的决策 */
export function whenDecision(step, upstream) {
  const mode = step?.when || 'on_success';
  if (mode === 'always') return 'run';
  if (mode === 'manual') return 'hold';
  return upstream?.failed ? 'skip' : 'run';
}

/**
 * 判定 step 的前置依赖是否已「满足」（即可以算作成功通过）。
 * @param {object} step 上游 step
 * @param {Set<string>} skipped 计划性跳过的 job id 集合
 * @param {Record<string,'run'|'skip'|'hold'>} decision job id → 显式决策
 * @param {object} [meta] graph.jobs[dep]；allowFailure 的权威来源（运行时 steps 上不一定带）
 */
export function isSatisfied(step, skipped, decision = {}, meta = null) {
  if (!step) return false;
  // allowFailure 优先取图上的 optional，回退到 step 自身标记
  const optional = meta ? Boolean(meta.optional) : Boolean(step.allowFailure);
  switch (step.status) {
    case 'success':
      return true;
    case 'failed':
      // allowFailure 的失败视为通过（不阻塞下游），但失败本身仍记录在案
      return optional;
    case 'canceled':
      return false;
    case 'skipped':
      // 默认：被跳过的上游按「成功」处理（when 语义），除非显式要求补跑
      return decision?.[step.id] !== 'hold';
    default:
      // pending/running；但被计划跳过（未进入 steps 的）也算已决策
      if (skipped && skipped.has(step.id)) return decision?.[step.id] !== 'hold';
      return false;
  }
}

/**
 * 判断调度模式；与 model/schema.js 的 detectScheduling 同语义（此处自带实现，
 * 避免对尚未落盘的 model 模块产生硬依赖）。
 * @returns {{mode:'dag'|'staged'|'invalid', hasNeeds:boolean, hasParallelStages:boolean, errors:Array}}
 */
export function scheduleMode(pipeline) {
  const stages = Array.isArray(pipeline?.stages) ? pipeline.stages : [];
  let hasNeeds = false;
  let hasParallelStages = false;
  for (const stage of stages) {
    if (stage?.parallel === true) hasParallelStages = true;
    for (const job of Array.isArray(stage?.jobs) ? stage.jobs : []) {
      if (Array.isArray(job?.needs) && job.needs.length > 0) hasNeeds = true;
    }
  }
  const errors = [];
  if (hasNeeds && hasParallelStages) {
    errors.push({
      path: 'stages',
      code: 'mixed-scheduling',
      message: 'needs 依赖与 parallel 阶段不得混用：请统一使用 DAG 或阶段串行模式',
    });
  }
  const mode = errors.length ? 'invalid' : hasNeeds ? 'dag' : 'staged';
  return { mode, hasNeeds, hasParallelStages, errors };
}

/**
 * 构建依赖图。
 * @param {object} pipeline
 * @returns {{
 *   mode:'dag'|'staged'|'invalid',
 *   jobs: Record<string,{id:string,stageId:string,stageIndex:number,jobIndex:number,job:object,needs:string[],dependents:string[],optional:boolean}>,
 *   order: string[], levels: string[][], stagePlan: Array<{id:string,key:string,name:string,parallel:boolean,jobs:string[]}>,
 *   errors: Array<{path:string,code:string,message:string}>
 * }}
 */
export function buildGraph(pipeline) {
  const stages = Array.isArray(pipeline?.stages) ? pipeline.stages : [];
  const { mode, errors: modeErrors } = scheduleMode(pipeline);
  const errors = [...modeErrors];

  /** @type {Record<string, any>} */
  const jobs = {};
  /** @type {Array<{id:string,key:string,name:string,parallel:boolean,jobs:string[]}>} */
  const stagePlan = [];

  stages.forEach((stage, stageIndex) => {
    const stageKey = String(stage?.id ?? `stage-${stageIndex}`);
    const jobIds = [];
    const list = Array.isArray(stage?.jobs) ? stage.jobs : [];
    list.forEach((job, jobIndex) => {
      const id = String(job?.id ?? '');
      if (!id) {
        errors.push({
          path: `stages[${stageIndex}].jobs[${jobIndex}].id`,
          code: 'missing-field',
          message: 'job 缺少 id',
        });
        return;
      }
      if (jobs[id]) {
        errors.push({
          path: `stages[${stageIndex}].jobs[${jobIndex}].id`,
          code: 'bad-id',
          message: `job id 重复：${id}`,
        });
        return;
      }
      jobIds.push(id);
      jobs[id] = {
        id,
        stageId: stageKey,
        stageIndex,
        jobIndex,
        job,
        needs: [],
        dependents: [],
        // allowFailure 泄漏到图上，方便 readySet 判断
        optional: Boolean(job?.allowFailure),
      };
    });
    stagePlan.push({
      id: stageKey,
      key: stageKey,
      name: String(stage?.name ?? stageKey),
      parallel: stage?.parallel === true,
      jobs: jobIds,
    });
  });

  // 连边：needs d → 当前 job
  for (const meta of Object.values(jobs)) {
    const raw = Array.isArray(meta.job?.needs) ? meta.job.needs : [];
    const seen = new Set();
    for (const dep of raw) {
      const depId = String(dep);
      if (!jobs[depId]) {
        errors.push({
          path: `job:${meta.id}.needs`,
          code: 'unknown-dependency',
          message: `job ${meta.id} 依赖了不存在的 job：${depId}`,
        });
        continue;
      }
      if (depId === meta.id) {
        errors.push({
          path: `job:${meta.id}.needs`,
          code: 'cycle',
          message: `job ${meta.id} 依赖了自己`,
        });
      }
      if (seen.has(depId)) continue;
      seen.add(depId);
      meta.needs.push(depId);
      jobs[depId].dependents.push(meta.id);
    }
  }

  const { order, levels } = topoSort(jobs);
  return { mode, jobs, order, levels, stagePlan, errors };
}

/** Kahn 拓扑排序；有环时返回可排序部分（环内节点不出现） */
function topoSort(jobs) {
  const indegree = {};
  for (const [id, meta] of Object.entries(jobs)) indegree[id] = meta.needs.length;
  const queue = Object.keys(jobs).filter((id) => indegree[id] === 0).sort();
  const order = [];
  const levels = [];
  let frontier = [...queue];
  while (frontier.length) {
    levels.push([...frontier]);
    const next = [];
    for (const id of frontier) {
      order.push(id);
      for (const dependent of jobs[id].dependents) {
        indegree[dependent] -= 1;
        if (indegree[dependent] === 0) next.push(dependent);
      }
    }
    next.sort();
    frontier = next;
  }
  return { order, levels };
}

/**
 * 拓扑序（接受 pipeline 或 buildGraph 的结果）。
 * @returns {string[]} 无环时为完整顺序；有环时为可排序部分
 */
export function topoOrder(input) {
  const graph = isGraph(input) ? input : buildGraph(input);
  return graph.order;
}

/** 就绪波次（每层可并行启动的 job） */
export function topoLevels(input) {
  const graph = isGraph(input) ? input : buildGraph(input);
  return graph.levels;
}

function isGraph(value) {
  return Boolean(value && typeof value === 'object' && value.jobs && Array.isArray(value.order));
}

/**
 * 环检测（DFS 三色），返回一条环路径。
 * @returns {{cyclic:boolean, cycle:string[]}} cycle 形如 ['a','b','c','a']
 */
export function detectCycle(input) {
  const graph = isGraph(input) ? input : buildGraph(input);
  const jobs = graph.jobs ?? {};
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map();
  const stack = [];
  let found = null;

  const visit = (id) => {
    if (found) return;
    color.set(id, GRAY);
    stack.push(id);
    const meta = jobs[id];
    const nexts = meta ? [...meta.needs].sort() : [];
    for (const dep of nexts) {
      if (found) break;
      if (!jobs[dep]) continue;
      const c = color.get(dep) ?? WHITE;
      if (c === GRAY) {
        // 命中回边：截取栈中从 dep 开始的部分
        const start = stack.indexOf(dep);
        found = [...stack.slice(start), dep];
        break;
      }
      if (c === WHITE) visit(dep);
    }
    stack.pop();
    color.set(id, BLACK);
  };

  for (const id of Object.keys(jobs).sort()) {
    if ((color.get(id) ?? WHITE) === WHITE) visit(id);
    if (found) break;
  }

  return found ? { cyclic: true, cycle: found } : { cyclic: false, cycle: [] };
}

/**
 * 计算当前「可以启动」的 job 集合。
 *
 * @param {object} state
 * @param {object} state.graph  buildGraph 的结果
 * @param {Record<string,object>} state.steps 当前 steps（id → step）
 * @param {Set<string>|string[]} [state.skipped] 计划性跳过的 job id
 * @param {Record<string,'run'|'skip'|'hold'>} [state.decision] 显式决策（重跑被跳过的 job）
 * @param {Set<string>|string[]} [state.running] 正在运行的 job id（避免重复启动）
 * @returns {string[]} 就绪的 job id（已按拓扑层、再按 id 排序）
 */
export function readySet(state) {
  const graph = state?.graph;
  if (!graph) return [];
  const steps = state.steps ?? {};
  const skipped = state.skipped instanceof Set ? state.skipped : new Set(state.skipped ?? []);
  const running = state.running instanceof Set ? state.running : new Set(state.running ?? []);
  const decision = state.decision ?? {};
  const out = [];

  for (const id of graph.order) {
    if (running.has(id)) continue;
    const step = steps[id];
    if (!step || step.status !== 'pending') continue;
    const meta = graph.jobs[id];
    if (!meta) continue;

    const mode = step.when || meta.job?.when || 'on_success';

    // when=manual：必须有人工放行决策，否则保持等待
    if (mode === 'manual' && decision[id] !== 'run') continue;

    let ok = true;
    for (const dep of meta.needs) {
      const upstream = steps[dep];
      if (!isSettled(upstream, skipped) || running.has(dep)) { ok = false; break; }
      // when=always：上游只要结束即可，不看成败（清理/通知/归档靠它）
      if (mode === 'always') continue;
      // on_success / manual：上游必须视为通过
      const depMeta = graph.jobs[dep] ?? null;
      if (!isSatisfied(upstream, skipped, decision, depMeta)) { ok = false; break; }
    }
    if (ok) out.push(id);
  }
  return out;
}

/**
 * staged 模式的执行计划：阶段按序遍历，返回每个阶段的分组。
 * @param {object} pipeline
 * @returns {Array<{id:string,key:string,name:string,parallel:boolean,jobs:string[]}>}
 */
export function stagedPlan(pipeline) {
  return buildGraph(pipeline).stagePlan;
}

/**
 * 判断某个阶段是否已被所有前置阶段「解锁」（staged 模式用）。
 * 前置阶段里只要出现失败（非 allowFailure）就整体中止。
 * @returns {{ready:boolean, blockedBy:string[]}}
 */
export function stageReadiness(pipeline, stageKey, steps) {
  const plan = stagedPlan(pipeline);
  const index = plan.findIndex((s) => s.key === stageKey || s.id === stageKey);
  if (index <= 0) return { ready: true, blockedBy: [] };
  const blockedBy = [];
  for (let i = 0; i < index; i += 1) {
    for (const jobId of plan[i].jobs) {
      const step = steps?.[jobId];
      if (!step) continue;
      if (step.status === 'failed' && !step.allowFailure) blockedBy.push(jobId);
      if (step.status === 'canceled') blockedBy.push(jobId);
    }
  }
  return { ready: blockedBy.length === 0, blockedBy };
}

/**
 * 子流水线调用环检测（pipeline.call 节点用）。
 * @param {string} rootPipelineId
 * @param {Array<{from:string,to:string}>} calls 已发现的调用关系
 * @param {string} nextId 待调用的子流水线 id
 * @returns {{cyclic:boolean, cycle:string[]}}
 */
export function detectPipelineCallCycle(rootPipelineId, calls, nextId) {
  // 目标就是根，或从目标出发能走回根 → 成环
  const adjacency = new Map();
  for (const edge of calls ?? []) {
    if (!edge || !edge.from || !edge.to) continue;
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    adjacency.get(edge.from).push(edge.to);
  }
  const target = String(nextId);
  if (target === String(rootPipelineId)) return { cyclic: true, cycle: [String(rootPipelineId), target] };

  const seen = new Set();
  const path = [];
  const walk = (node) => {
    if (node === String(rootPipelineId)) {
      path.push(node);
      return true;
    }
    if (seen.has(node)) return false;
    seen.add(node);
    path.push(node);
    for (const next of adjacency.get(node) ?? []) {
      if (walk(next)) return true;
    }
    path.pop();
    return false;
  };
  const cyclic = walk(target);
  return { cyclic, cycle: cyclic ? [...path] : [] };
}

export default {
  buildGraph,
  detectCycle,
  topoOrder,
  topoLevels,
  readySet,
  stagedPlan,
  scheduleMode,
  stageReadiness,
  detectPipelineCallCycle,
  whenDecision,
  isSettled,
  isSatisfied,
};
