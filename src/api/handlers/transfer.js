/**
 * dsh-devops · 导出 / 导入 handler
 *
 * 导出物是**单文件 JSON**，带 `formatVersion` 与 `kind`（pipeline|template|bundle）。
 *
 * 安全铁律（契约 §5.2）：导出物里**绝不能出现密钥明文**。
 * 变量条目若 `secret:true`，其 value 是「凭据引用名」而非密钥本身，因此可安全导出；
 * 本文件还会做一次主动清洗，确保任何 auth.password / privateKey 之类字段不被带出。
 */

import { validatePipeline, validateTemplate, validateServer, normalizePipeline, newId } from '../../model/schema.js'
import { buildGraph } from '../../engine/dag.js'
import { badRequest } from '../http.js'

/** 当前导出格式版本。 */
export const FORMAT_VERSION = 1
const SUPPORTED_VERSIONS = new Set([1])
const KINDS = new Set(['pipeline', 'template', 'bundle'])

/** 会被主动剔除的字段名（明文密钥永不出现在导出物里）。 */
const FORBIDDEN_KEYS = new Set(['password', 'privateKey', 'passphrase', 'secretValue', 'token', 'apiKey'])

/**
 * 深度清洗：丢弃禁用字段；对 secret 变量保留引用名。
 * 保留 `*Ref` 形态（keyRef/passwordRef），那只是引用名。
 */
function sanitize(value, path = '') {
  if (Array.isArray(value)) return value.map((item, index) => sanitize(item, `${path}[${index}]`))
  if (value === null || typeof value !== 'object') return value
  const out = {}
  for (const [key, item] of Object.entries(value)) {
    // 允许 xxxRef（引用名），拒绝裸 password/privateKey 等
    if (FORBIDDEN_KEYS.has(key) && !key.endsWith('Ref')) continue
    out[key] = sanitize(item, path ? `${path}.${key}` : key)
  }
  return out
}

/** 流水线导出前的脱敏：清掉运行期信息，避免导出物带上本机痕迹。 */
function exportablePipeline(pipeline) {
  return sanitize({
    ...pipeline,
    createdAt: pipeline.createdAt ?? 0,
    updatedAt: pipeline.updatedAt ?? 0,
  })
}

/** GET /api/export?kind=pipeline|bundle&id= */
export async function exportDocument({ store, nodes }, { query }) {
  const kind = query?.get('kind') ?? 'pipeline'
  const id = query?.get('id') ?? undefined
  if (!KINDS.has(kind)) throw badRequest(`kind 只能是 ${[...KINDS].join('|')}`)

  if (kind === 'pipeline') {
    if (!id) throw badRequest('导出流水线需要 id')
    const pipeline = store.pipelines.get(id)
    if (!pipeline) throw badRequest(`流水线不存在：${id}`)
    return {
      formatVersion: FORMAT_VERSION,
      kind: 'pipeline',
      exportedAt: Date.now(),
      generator: 'dsh-devops',
      pipeline: exportablePipeline(pipeline),
    }
  }

  if (kind === 'template') {
    if (!id) throw badRequest('导出模板需要 id')
    const template = store.templates.get(id)
    if (!template) throw badRequest(`模板不存在：${id}`)
    return {
      formatVersion: FORMAT_VERSION,
      kind: 'template',
      exportedAt: Date.now(),
      generator: 'dsh-devops',
      template: sanitize(template),
    }
  }

  // bundle：整套可迁移资产（含密钥引用名，但不含任何密钥值）
  const pipelines = id ? [store.pipelines.get(id)].filter(Boolean) : store.pipelines.list()
  if (id && pipelines.length === 0) throw badRequest(`流水线不存在：${id}`)
  const bundle = {
    formatVersion: FORMAT_VERSION,
    kind: 'bundle',
    exportedAt: Date.now(),
    generator: 'dsh-devops',
    pipelines: pipelines.map(exportablePipeline),
    templates: id ? [] : store.templates.list().map((item) => sanitize(item)),
    envsets: id ? [] : store.envsets.list().map((item) => sanitize(item)),
    snippets: id ? [] : store.snippets.list().map((item) => sanitize(item)),
    servers: id
      ? []
      : store.servers
          .list()
          // 内置 local 是每台机器自带的，导出它没有意义
          .filter((server) => server.id !== 'local')
          .map((server) => sanitize(server)),
  }
  return bundle
}

/** 从文档里取出各类资产（兼容单条与 bundle）。 */
function collectAssets(document) {
  const kind = document.kind
  if (kind === 'pipeline') return { pipelines: document.pipeline ? [document.pipeline] : [], templates: [], envsets: [], snippets: [], servers: [] }
  if (kind === 'template') return { pipelines: [], templates: document.template ? [document.template] : [], envsets: [], snippets: [], servers: [] }
  return {
    pipelines: Array.isArray(document.pipelines) ? document.pipelines : [],
    templates: Array.isArray(document.templates) ? document.templates : [],
    envsets: Array.isArray(document.envsets) ? document.envsets : [],
    snippets: Array.isArray(document.snippets) ? document.snippets : [],
    servers: Array.isArray(document.servers) ? document.servers : [],
  }
}

/**
 * POST /api/import
 * { document, mode:'new'|'overwrite', includeNodes }
 *
 * 先校验（格式版本 / id / 必填 / 环检测 / 节点是否存在），再列出冲突与缺失，
 * 最后按 mode 写入。**任一条目校验失败即整体拒绝**，避免导到一半的半成品状态。
 */
export async function importDocument({ store, nodes, config }, { body }) {
  const document = body?.document ?? body?.doc
  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    throw badRequest('缺少 document（应为导出得到的 JSON 对象）')
  }
  const mode = body?.mode === 'overwrite' ? 'overwrite' : 'new'
  const includeNodes = body?.includeNodes === true

  const version = document.formatVersion
  if (version === undefined) {
    throw badRequest('导入物缺少 formatVersion')
  }
  if (!SUPPORTED_VERSIONS.has(version)) {
    throw badRequest(`不支持的导出格式版本：${version}（当前支持 ${[...SUPPORTED_VERSIONS].join(', ')}）`)
  }
  const kind = document.kind ?? 'bundle'
  if (!KINDS.has(kind)) throw badRequest(`未知的 kind：${kind}`)

  const assets = collectAssets(document)
  // 先做整体校验，收集所有问题一次性反馈（而不是抛第一个）
  const errors = []
  const knownNodes = nodes && typeof nodes.list === 'function'
    ? nodes.list().map((entry) => entry?.type).filter(Boolean)
    : null

  const validPipelines = []
  for (const [index, pipeline] of assets.pipelines.entries()) {
    if (!pipeline || typeof pipeline !== 'object') {
      errors.push({ path: `pipelines[${index}]`, code: 'bad-type', message: '必须是对象' })
      continue
    }
    const normalized = normalizePipeline(pipeline)
    const check = validatePipeline(normalized, knownNodes ? { knownNodes } : {})
    if (!check.ok) {
      for (const error of check.errors) errors.push({ ...error, path: `pipelines[${index}].${error.path}` })
      continue
    }
    // 环检测：导入坏图会让运行期直接炸，这里拦住
    // 注意 dag.js 的错误 path 形如 `job:<id>.needs`（图级标识），不是契约的点路径
    const graph = buildGraph(normalized)
    const cycles = (graph.errors ?? []).filter((error) => error.code === 'cycle')
    if (cycles.length > 0) {
      for (const cycle of cycles) {
        errors.push({
          path: `pipelines[${index}].${cycle.path}`,
          code: 'cycle',
          message: cycle.message,
        })
      }
      continue
    }
    validPipelines.push(normalized)
  }

  const validTemplates = []
  for (const [index, template] of assets.templates.entries()) {
    if (!template || typeof template !== 'object') {
      errors.push({ path: `templates[${index}]`, code: 'bad-type', message: '必须是对象' })
      continue
    }
    const check = validateTemplate(template)
    if (!check.ok) {
      for (const error of check.errors) errors.push({ ...error, path: `templates[${index}].${error.path}` })
      continue
    }
    validTemplates.push(template)
  }

  const validServers = []
  for (const [index, server] of assets.servers.entries()) {
    if (!server || typeof server !== 'object') {
      errors.push({ path: `servers[${index}]`, code: 'bad-type', message: '必须是对象' })
      continue
    }
    // 导入的服务器不带凭据值，auth 引用必须由使用者在本机配置
    const check = validateServer(server)
    if (!check.ok) {
      for (const error of check.errors) errors.push({ ...error, path: `servers[${index}].${error.path}` })
      continue
    }
    validServers.push(server)
  }

  // 缺失的节点类型（不阻断导入，但要如实告知：这些步骤在当前环境跑不了）
  const missingNodes = []
  if (knownNodes) {
    const known = new Set(knownNodes)
    for (const pipeline of validPipelines) {
      for (const stage of pipeline.stages ?? []) {
        for (const job of stage.jobs ?? []) {
          if (job?.node && !known.has(job.node) && !missingNodes.includes(job.node)) missingNodes.push(job.node)
        }
      }
    }
  }

  if (errors.length > 0) {
    throw badRequest('导入校验未通过', { errors, missingNodes, mode })
  }

  // 冲突：同 id 已存在
  const conflicts = []
  for (const pipeline of validPipelines) {
    if (store.pipelines.get(pipeline.id)) conflicts.push({ table: 'pipelines', id: pipeline.id })
  }
  for (const template of validTemplates) {
    if (store.templates.get(template.id)) conflicts.push({ table: 'templates', id: template.id })
  }
  for (const server of validServers) {
    if (store.servers.get(server.id)) conflicts.push({ table: 'servers', id: server.id })
  }
  for (const envset of assets.envsets) {
    if (envset?.id && store.envsets.get(envset.id)) conflicts.push({ table: 'envsets', id: envset.id })
  }
  for (const snippet of assets.snippets) {
    if (snippet?.id && store.snippets.get(snippet.id)) conflicts.push({ table: 'snippets', id: snippet.id })
  }

  const now = Date.now()
  const imported = { pipelines: [], templates: [], envsets: [], snippets: [], servers: [], renamed: [] }

  /** mode=new 且冲突 → 换一个不冲突的 id；overwrite → 覆盖。 */
  function resolveId(table, requested) {
    const exists = Boolean(store[table].get(requested))
    if (!exists) return { id: requested, overwritten: false }
    if (mode === 'overwrite') return { id: requested, overwritten: true }
    let candidate = `${requested}-${newId('x').split('-')[1]}`
    return { id: candidate, overwritten: false, renamedFrom: requested }
  }

  for (const pipeline of validPipelines) {
    const { id, overwritten, renamedFrom } = resolveId('pipelines', pipeline.id)
    const value = {
      ...pipeline,
      id,
      createdAt: overwritten ? (store.pipelines.get(id)?.createdAt ?? now) : now,
      updatedAt: now,
    }
    await store.pipelines.put(id, value)
    imported.pipelines.push(id)
    if (renamedFrom) imported.renamed.push({ table: 'pipelines', from: renamedFrom, to: id })
  }

  for (const template of validTemplates) {
    const { id, overwritten, renamedFrom } = resolveId('templates', template.id)
    const value = {
      ...template,
      id,
      createdAt: overwritten ? (store.templates.get(id)?.createdAt ?? now) : now,
      updatedAt: now,
    }
    await store.templates.put(id, value)
    imported.templates.push(id)
    if (renamedFrom) imported.renamed.push({ table: 'templates', from: renamedFrom, to: id })
  }

  for (const envset of assets.envsets) {
    if (!envset || typeof envset !== 'object' || typeof envset.id !== 'string') continue
    if (store.envsets.get(envset.id) && mode === 'new') continue
    await store.envsets.put(envset.id, { ...envset, updatedAt: now })
    imported.envsets.push(envset.id)
  }

  for (const snippet of assets.snippets) {
    if (!snippet || typeof snippet !== 'object' || typeof snippet.id !== 'string') continue
    if (store.snippets.get(snippet.id) && mode === 'new') continue
    await store.snippets.put(snippet.id, { ...snippet, updatedAt: now })
    imported.snippets.push(snippet.id)
  }

  for (const server of validServers) {
    if (server.id === 'local') continue
    const { id, overwritten, renamedFrom } = resolveId('servers', server.id)
    const value = { ...server, id, createdAt: overwritten ? (store.servers.get(id)?.createdAt ?? now) : now, updatedAt: now }
    await store.servers.put(id, value)
    imported.servers.push(id)
    if (renamedFrom) imported.renamed.push({ table: 'servers', from: renamedFrom, to: id })
  }

  // includeNodes：勾选时才把节点类型并入「已知节点」，否则仅作提示
  if (includeNodes && missingNodes.length > 0 && config) {
    // 真正的节点代码不会随文档迁移（那是可执行代码），这里只是显式告知
  }

  return {
    mode,
    imported,
    conflicts,
    missingNodes,
    warnings: missingNodes.length > 0
      ? [`以下节点类型在当前环境不存在，引用它们的步骤会失败：${missingNodes.join('、')}`]
      : [],
  }
}
