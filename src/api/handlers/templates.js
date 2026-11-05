/**
 * dsh-devops · 模板域 handler
 */

import {
  validateTemplate,
  normalizePipeline,
  newId,
  detectScheduling,
} from '../../model/schema.js'
import { instantiate, extractParameter } from '../../model/template.js'
import { badRequest, notFound, conflict } from '../http.js'
import { knownNodesOf } from './pipelines.js'

/** GET /api/templates */
export async function listTemplates({ store }) {
  return store.templates
    .list()
    .map((template) => ({
      id: template.id,
      name: template.name,
      description: template.description ?? '',
      category: template.category ?? '',
      tags: template.tags ?? [],
      icon: template.icon ?? '',
      parameterCount: Array.isArray(template.parameters) ? template.parameters.length : 0,
      usageCount: template.usageCount ?? 0,
      createdAt: template.createdAt ?? 0,
      updatedAt: template.updatedAt ?? 0,
    }))
    .sort((a, b) => (b.usageCount ?? 0) - (a.usageCount ?? 0) || a.name.localeCompare(b.name))
}

/** GET /api/templates/:id */
export async function getTemplate({ store }, { id }) {
  const template = store.templates.get(id)
  if (!template) throw notFound(`模板不存在：${id}`)
  return template
}

function normalizeTemplate(raw, id) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw badRequest('template 必须是对象')
  }
  const now = Date.now()
  const template = {
    id: id ?? raw.id ?? newId('tpl'),
    name: raw.name ?? '',
    description: typeof raw.description === 'string' ? raw.description : '',
    category: typeof raw.category === 'string' ? raw.category : '',
    tags: Array.isArray(raw.tags) ? raw.tags.filter((tag) => typeof tag === 'string') : [],
    icon: typeof raw.icon === 'string' ? raw.icon : '',
    parameters: Array.isArray(raw.parameters) ? raw.parameters : [],
    body: raw.body && typeof raw.body === 'object' ? raw.body : {},
    usageCount: Number.isFinite(raw.usageCount) ? raw.usageCount : 0,
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : now,
    updatedAt: now,
  }
  const check = validateTemplate(template)
  if (!check.ok) throw badRequest('模板校验未通过', { errors: check.errors })

  // 模板体必须能实例化出一条合法流水线，否则存进去只会让使用者踩坑
  const probeParams = {}
  for (const param of template.parameters) {
    if (param?.default !== undefined) probeParams[param.name] = param.default
    else if (param?.required !== true) probeParams[param.name] = sampleValueFor(param?.type)
  }
  const built = instantiate(template, probeParams)
  if (!built.ok) {
    throw badRequest('模板体无法实例化出合法流水线', { errors: built.errors })
  }
  return template
}

/** 按字段类型给一个探测用的样例值。 */
function sampleValueFor(type) {
  switch (type) {
    case 'boolean': return true
    case 'number': return 1
    case 'multiselect': return []
    case 'keyvalue': return {}
    default: return 'sample'
  }
}

/** POST /api/templates */
export async function createTemplate({ store }, { body }) {
  const raw = body?.template ?? body
  const template = normalizeTemplate(raw)
  if (store.templates.get(template.id)) {
    throw conflict(`模板 id 已存在：${template.id}`, { id: template.id })
  }
  await store.templates.put(template.id, template)
  return template
}

/** PUT /api/templates/:id */
export async function updateTemplate({ store }, { id, body }) {
  const existing = store.templates.get(id)
  if (!existing) throw notFound(`模板不存在：${id}`)
  const raw = body?.template ?? body
  const template = normalizeTemplate({ ...raw, createdAt: existing.createdAt }, id)
  await store.templates.put(id, template)
  return template
}

/** DELETE /api/templates/:id */
export async function deleteTemplate({ store }, { id }) {
  const existing = store.templates.get(id)
  if (!existing) throw notFound(`模板不存在：${id}`)
  await store.templates.delete(id)
  return { id, deleted: true }
}

/** POST /api/templates/:id/instantiate —— 按参数生成流水线（不落库，交给用户确认）。 */
export async function instantiateTemplate({ store }, { id, body }) {
  const template = store.templates.get(id)
  if (!template) throw notFound(`模板不存在：${id}`)
  const params = body?.params && typeof body.params === 'object' ? body.params : {}
  const result = instantiate(template, params)
  if (!result.ok) throw badRequest('模板实例化失败', { errors: result.errors })
  const pipeline = normalizePipeline(result.value)
  // 命中冲突时给个可用 id，前端可直接改名
  if (store.pipelines.get(pipeline.id)) {
    pipeline.id = newId(String(pipeline.id).replace(/-[0-9a-f]{8}$/, '') || 'pipeline')
  }
  return { pipeline, warnings: [], usageCount: (template.usageCount ?? 0) + 1 }
}

/**
 * POST /api/templates/from-pipeline
 * 由现有流水线生成模板：可显式传 parameters，也可让服务端把指定路径提升为参数。
 */
export async function templateFromPipeline({ store, nodes }, { body }) {
  const pipelineId = body?.pipelineId
  if (typeof pipelineId !== 'string' || pipelineId.trim() === '') {
    throw badRequest('缺少 pipelineId')
  }
  const pipeline = store.pipelines.get(pipelineId)
  if (!pipeline) throw notFound(`流水线不存在：${pipelineId}`)

  const name = typeof body?.name === 'string' && body.name.trim() !== '' ? body.name.trim() : `${pipeline.name} 模板`
  const paths = Array.isArray(body?.parameters) ? body.parameters : []
  const parameters = []
  // extractParameter 已返回「替换好占位符」的新流水线，逐次串接即可（不必自己改路径）
  let bodyPipeline = pipeline

  for (const raw of paths) {
    const path = typeof raw === 'string' ? raw : raw?.path
    if (typeof path !== 'string' || path.trim() === '') continue
    const options = typeof raw === 'object' && raw !== null
      ? {
          ...(raw.name ? { name: raw.name } : {}),
          ...(raw.type ? { type: raw.type } : {}),
          ...(raw.label ? { label: raw.label } : {}),
          ...(raw.description ? { description: raw.description } : {}),
        }
      : {}
    const extracted = extractParameter(bodyPipeline, path, options)
    if (!extracted || extracted.ok === false) {
      const detail = (extracted?.errors ?? []).map((e) => e.message).join('；') || '路径无效或不可提升'
      throw badRequest(`提升参数失败（${path}）：${detail}`)
    }
    parameters.push({
      ...extracted.parameter,
      required: typeof raw === 'object' && raw?.required !== undefined ? raw.required === true : true,
    })
    bodyPipeline = extracted.value
  }

  const candidate = normalizeTemplate(
    {
      name,
      description: typeof body?.description === 'string' ? body.description : (pipeline.description ?? ''),
      category: typeof body?.category === 'string' ? body.category : (pipeline.category ?? ''),
      tags: Array.isArray(body?.tags) ? body.tags : (pipeline.tags ?? []),
      icon: typeof body?.icon === 'string' ? body.icon : 'box',
      parameters,
      body: bodyPipeline,
    },
    typeof body?.id === 'string' && body.id.trim() !== '' ? body.id.trim() : undefined,
  )
  if (store.templates.get(candidate.id)) {
    candidate.id = newId('tpl')
  }
  await store.templates.put(candidate.id, candidate)

  // 已知节点仅用于诊断（节点不存在时提示用户，但不阻断存模板）
  const known = knownNodesOf(nodes)
  const warnings = []
  if (known) {
    for (const stage of pipeline.stages ?? []) {
      for (const job of stage.jobs ?? []) {
        if (job?.node && !known.includes(job.node)) {
          warnings.push(`节点类型 ${job.node} 当前不在节点库中（${stage.id}/${job.id}）`)
        }
      }
    }
  }
  return { template: candidate, scheduling: detectScheduling(pipeline), warnings }
}
