/**
 * dsh-devops · 流水线域 handler
 *
 * 所有 handler 统一签名 `(context, params) => Promise<value>`，抛 HttpError
 * 表达失败（router 负责转响应）。context 由 router 注入（见 router.js 顶部注释）。
 */

import { validatePipeline, normalizePipeline, newId, detectScheduling } from '../../model/schema.js'
import { badRequest, notFound, conflict } from '../http.js'

/** 保存前统一规范化 + 校验；失败抛 400 并带上 errors。 */
function normalizeAndValidate(pipeline, { requireId = false } = {}) {
  if (pipeline === null || typeof pipeline !== 'object' || Array.isArray(pipeline)) {
    throw badRequest('pipeline 必须是对象')
  }
  const normalized = normalizePipeline(pipeline)
  if (requireId && !normalized.id) throw badRequest('缺少流水线 id')
  const check = validatePipeline(normalized)
  if (!check.ok) {
    throw badRequest('流水线校验未通过', { errors: check.errors })
  }
  return normalized
}

/** GET /api/pipelines —— 列表（不含 stages，减轻载荷）。 */
export async function listPipelines({ store }) {
  const items = store.pipelines.list()
  return items
    .map((pipeline) => ({
      id: pipeline.id,
      name: pipeline.name,
      description: pipeline.description ?? '',
      category: pipeline.category ?? '',
      tags: pipeline.tags ?? [],
      favorite: pipeline.favorite === true,
      owner: pipeline.owner ?? null,
      version: pipeline.version ?? 1,
      createdAt: pipeline.createdAt ?? 0,
      updatedAt: pipeline.updatedAt ?? 0,
      stageCount: Array.isArray(pipeline.stages) ? pipeline.stages.length : 0,
      jobCount: countJobs(pipeline),
      scheduling: detectScheduling(pipeline),
    }))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || a.id.localeCompare(b.id))
}

function countJobs(pipeline) {
  let total = 0
  for (const stage of pipeline.stages ?? []) total += (stage.jobs ?? []).length
  return total
}

/** GET /api/pipelines/:id */
export async function getPipeline({ store }, { id }) {
  const pipeline = store.pipelines.get(id)
  if (!pipeline) throw notFound(`流水线不存在：${id}`)
  return pipeline
}

/** POST /api/pipelines */
export async function createPipeline({ store }, { body }) {
  const raw = body?.pipeline ?? body
  const normalized = normalizeAndValidate(raw)
  if (store.pipelines.get(normalized.id)) {
    throw conflict(`流水线 id 已存在：${normalized.id}`, { id: normalized.id })
  }
  const now = Date.now()
  const value = { ...normalized, createdAt: now, updatedAt: now }
  await store.pipelines.put(value.id, value)
  return value
}

/** PUT /api/pipelines/:id */
export async function updatePipeline({ store }, { id, body }) {
  const existing = store.pipelines.get(id)
  if (!existing) throw notFound(`流水线不存在：${id}`)
  const raw = body?.pipeline ?? body
  const normalized = normalizeAndValidate({ ...raw, id })
  const value = {
    ...normalized,
    id,
    createdAt: existing.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  }
  await store.pipelines.put(id, value)
  return value
}

/** DELETE /api/pipelines/:id */
export async function deletePipeline({ store }, { id }) {
  const existing = store.pipelines.get(id)
  if (!existing) throw notFound(`流水线不存在：${id}`)
  await store.pipelines.delete(id)
  return { id, deleted: true }
}

/** POST /api/pipelines/validate —— 返回 {ok, errors}，不抛错（编辑期实时校验用）。 */
export async function validatePipelineDoc({ store, nodes }, { body }) {
  const raw = body?.pipeline ?? body
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: [{ path: '', code: 'bad-type', message: 'pipeline 必须是对象' }] }
  }
  // 缺 id 时补一个占位，便于编辑器中途校验
  const candidate = normalizePipeline({ id: raw.id || newId('draft'), ...raw })
  const knownNodes = knownNodesOf(nodes)
  const check = validatePipeline(candidate, knownNodes ? { knownNodes } : {})
  return check.ok
    ? { ok: true, errors: [], scheduling: detectScheduling(candidate), pipeline: candidate }
    : { ok: false, errors: check.errors }
}

/** 从节点注册表取已知节点类型；nodes 缺席时返回 null（走 schema 默认清单）。 */
export function knownNodesOf(nodes) {
  if (!nodes || typeof nodes.list !== 'function') return null
  try {
    const types = nodes.list().map((entry) => entry?.type).filter((type) => typeof type === 'string' && type !== '')
    return types.length > 0 ? types : null
  } catch {
    return null
  }
}

/** POST /api/pipelines/:id/runs —— 触发一次运行。 */
export async function runPipeline({ store, engine }, { id, body }) {
  const pipeline = store.pipelines.get(id)
  if (!pipeline) throw notFound(`流水线不存在：${id}`)
  if (!engine || typeof engine.start !== 'function') {
    throw badRequest('执行引擎不可用（engine 未装配）')
  }
  const variables = body?.variables && typeof body.variables === 'object' && !Array.isArray(body.variables)
    ? body.variables
    : {}
  const trigger = typeof body?.trigger === 'string' && body.trigger ? body.trigger : 'api'

  let handle
  try {
    handle = engine.start({ pipeline, variables, trigger })
  } catch (error) {
    throw badRequest(`无法启动运行：${error?.message ?? error}`)
  }
  // 契约：不等待结果，立刻返回 runId（工具侧同样默认不等）
  return { runId: handle.runId, status: handle.run?.status ?? 'queued' }
}
