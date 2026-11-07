/**
 * dsh-devops · 运行域 handler
 *
 * 覆盖 run 的列表/详情/取消/重试/单步重试/日志，以及 SSE 事件订阅。
 * SSE 不走「返回 value」的常规路径，由 router 直接调用 `subscribeRunEvents`。
 */

import { badRequest, notFound } from '../http.js'
import { readLastEventId } from '../sse.js'

const RUN_STATUSES = new Set(['queued', 'running', 'success', 'failed', 'canceled'])

/**
 * 步骤摘要：只保留前端渲染节点所需的白名单字段。
 * 刻意丢掉 logPath / with / env / artifacts 等重字段——列表载荷要轻。
 * 形状：{ [stepId]: { id, name, status, startedAt, finishedAt, exitCode, error } }
 */
function summarizeSteps(run) {
  const out = {}
  const source = run?.steps ?? {}
  for (const [stepId, step] of Object.entries(source)) {
    if (!step || typeof step !== 'object') continue
    out[stepId] = {
      id: step.id ?? stepId,
      name: step.name ?? stepId,
      status: step.status ?? 'pending',
      startedAt: step.startedAt ?? 0,
      finishedAt: step.finishedAt ?? 0,
      exitCode: step.exitCode ?? null,
      error: step.error ?? '',
    }
  }
  return out
}

/** 运行摘要（列表用：带轻量 steps 供前端上色/计时，但不带完整步骤重字段）。 */
function summarize(run) {
  const steps = Object.values(run.steps ?? {})
  const counts = { pending: 0, running: 0, success: 0, failed: 0, skipped: 0, canceled: 0 }
  for (const step of steps) {
    if (counts[step.status] !== undefined) counts[step.status] += 1
  }
  const durationMs = run.startedAt
    ? (run.finishedAt || Date.now()) - run.startedAt
    : 0
  return {
    id: run.id,
    pipelineId: run.pipelineId,
    pipelineName: run.pipelineName,
    status: run.status,
    trigger: run.trigger,
    startedAt: run.startedAt ?? 0,
    finishedAt: run.finishedAt ?? 0,
    durationMs,
    variables: run.variables ?? {},
    stepCounts: counts,
    stepTotal: steps.length,
    // 步骤状态/计时的数据源；无步骤时必须是 {}，不能是 undefined
    steps: summarizeSteps(run),
    parentRunId: run.parentRunId ?? null,
    parentStepId: run.parentStepId ?? null,
  }
}

/** GET /api/runs?pipelineId=&status=&limit= */
export async function listRuns({ store, engine }, { query }) {
  const pipelineId = query?.get('pipelineId') ?? undefined
  const status = query?.get('status') ?? undefined
  const limitRaw = Number(query?.get('limit'))
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.trunc(limitRaw), 500) : 100

  if (status !== undefined && status !== '' && !RUN_STATUSES.has(status)) {
    throw badRequest(`status 只能是 ${[...RUN_STATUSES].join('|')}`)
  }

  const activeIds = new Set(typeof engine?.active === 'function' ? engine.active() : [])
  let runs = store.runs.list()
  if (pipelineId) runs = runs.filter((run) => run.pipelineId === pipelineId)
  if (status) runs = runs.filter((run) => run.status === status)

  return runs
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0) || String(b.id).localeCompare(String(a.id)))
    .slice(0, limit)
    .map((run) => {
      const summary = summarize(run)
      // 活跃运行以引擎内存里的实时状态为准（磁盘可能落后一拍）
      const live = activeIds.has(run.id) && typeof engine?.status === 'function' ? engine.status(run.id) : null
      if (live?.run) Object.assign(summary, summarize(live.run))
      summary.active = activeIds.has(run.id)
      return summary
    })
}

/** GET /api/runs/:id —— 详情（带完整 steps，SSE 断线后重连用它兜底）。 */
export async function getRun({ store, engine }, { id }) {
  const active = typeof engine?.status === 'function' ? engine.status(id) : null
  const run = active?.run ?? store.runs.get(id)
  if (!run) throw notFound(`运行不存在：${id}`)
  return { ...run, active: active?.active === true }
}

/** POST /api/runs/:id/cancel */
export async function cancelRun({ store, engine }, { id }) {
  if (!engine || typeof engine.cancel !== 'function') throw badRequest('执行引擎不可用（engine 未装配）')
  const run = store.runs.get(id)
  if (!run) throw notFound(`运行不存在：${id}`)
  const result = await engine.cancel(id)
  if (result && result.ok === false) {
    // 已结束的运行不算错误：如实返回，前端据此提示
    return { runId: id, canceled: false, reason: result.error ?? '运行未在本引擎中活动' }
  }
  return { runId: id, canceled: true }
}

/** POST /api/runs/:id/retry —— 重跑整条运行。 */
export async function retryRun({ store, engine }, { id }) {
  if (!engine || typeof engine.retry !== 'function') throw badRequest('执行引擎不可用（engine 未装配）')
  const run = store.runs.get(id)
  if (!run) throw notFound(`运行不存在：${id}`)
  let handle
  try {
    handle = engine.retry(id)
  } catch (error) {
    throw badRequest(`无法重跑：${error?.message ?? error}`)
  }
  // retry 可能返回 handle 或 { runId, wait }
  const runId = handle?.runId ?? id
  return { runId, status: handle?.run?.status ?? 'queued', sourceRunId: id }
}

/** POST /api/runs/:id/retry-step {stepId} */
export async function retryStep({ store, engine }, { id, body }) {
  if (!engine || typeof engine.retryStep !== 'function') throw badRequest('执行引擎不可用（engine 未装配）')
  const stepId = body?.stepId
  if (typeof stepId !== 'string' || stepId.trim() === '') throw badRequest('缺少 stepId')
  const run = store.runs.get(id)
  if (!run) throw notFound(`运行不存在：${id}`)
  if (!run.steps?.[stepId]) throw notFound(`步骤不存在：${stepId}`)
  let handle
  try {
    handle = engine.retryStep(id, stepId)
  } catch (error) {
    throw badRequest(`无法重跑步骤：${error?.message ?? error}`)
  }
  return { runId: handle?.runId ?? id, stepId, status: handle?.run?.status ?? 'queued' }
}

/** GET /api/runs/:id/logs?stepId=&from= */
export async function readRunLogs({ store, logs }, { id, query }) {
  const run = store.runs.get(id)
  if (!run) throw notFound(`运行不存在：${id}`)
  if (!logs || typeof logs.read !== 'function') throw badRequest('日志存储不可用')

  const stepId = query?.get('stepId') ?? undefined
  const fromRaw = Number(query?.get('from'))
  const from = Number.isFinite(fromRaw) && fromRaw > 0 ? Math.trunc(fromRaw) : 0

  if (stepId) {
    if (!run.steps?.[stepId]) throw notFound(`步骤不存在：${stepId}`)
    const result = logs.read({ runId: id, stepId, from })
    return { runId: id, stepId, ...result }
  }
  // 不带 stepId：合并该运行全部步骤（按 seq 全局有序）
  if (typeof logs.readRun !== 'function') throw badRequest('日志存储不支持合并读取')
  const result = logs.readRun(id, from)
  return { runId: id, ...result }
}

/**
 * GET /api/runs/:id/events —— SSE。
 * 直接写响应，不返回 value（router 识别它为流式端点）。
 * @returns {boolean} true 表示已接管响应
 */
export function subscribeRunEvents(context, { id, req, res, query }) {
  const { store, engine, sse } = context
  const run = store.runs.get(id)
  if (!run) throw notFound(`运行不存在：${id}`)
  if (!sse || typeof sse.subscribe !== 'function') throw badRequest('SSE 未装配')
  const lastId = readLastEventId(req, query)
  // 首帧推一次当前快照：客户端不必先 GET 详情就能渲染。
  // 走 initial（单播、不带 seq）而不是 publish：publish 是广播，
  // 新客户端连进来不该让既有订阅者重复收到一遍快照。
  const live = typeof engine?.status === 'function' ? engine.status(id) : null
  const current = live?.run ?? run
  sse.subscribe(req, res, id, {
    lastId,
    initial: [{ type: 'run', data: { runId: id, run: { ...current, active: live?.active === true } } }],
  })
  return true
}
