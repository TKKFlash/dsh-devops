/**
 * dsh-devops · 资源库 handler（环境变量组 / 脚本片段 / 历史输入）
 *
 * 三段形状相近，共用一套 CRUD 生成器，避免三份复制粘贴。
 */

import { newId } from '../../model/schema.js'
import { badRequest, notFound, conflict } from '../http.js'

/** 校验 `[{name,value,secret}]`。 */
function normalizeVars(list, path) {
  if (list === undefined || list === null) return []
  if (!Array.isArray(list)) throw badRequest(`${path} 必须是数组`)
  return list
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      name: String(item.name ?? '').trim(),
      value: item.value === undefined || item.value === null ? '' : item.value,
      secret: item.secret === true,
    }))
    .filter((item) => item.name !== '')
}

function normalizeStringList(list, path) {
  if (list === undefined || list === null) return []
  if (!Array.isArray(list)) throw badRequest(`${path} 必须是数组`)
  return list.filter((item) => typeof item === 'string' && item.trim() !== '').map((item) => item.trim())
}

/* ------------------------------------------------------- 环境变量组 */

function normalizeEnvSet(raw, id, existing) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw badRequest('envset 必须是对象')
  const now = Date.now()
  const value = {
    id: id ?? raw.id ?? newId('env'),
    name: typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name.trim() : '',
    description: typeof raw.description === 'string' ? raw.description : '',
    tags: normalizeStringList(raw.tags, 'tags'),
    vars: normalizeVars(raw.vars, 'vars'),
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : (existing?.createdAt ?? now),
    updatedAt: now,
  }
  if (value.name === '') throw badRequest('环境变量组缺少 name')
  return value
}

export async function listEnvSets({ store }) {
  return store.envsets.list().sort((a, b) => a.name.localeCompare(b.name))
}

export async function createEnvSet({ store }, { body }) {
  const value = normalizeEnvSet(body?.envset ?? body)
  if (store.envsets.get(value.id)) throw conflict(`环境变量组 id 已存在：${value.id}`, { id: value.id })
  await store.envsets.put(value.id, value)
  return value
}

export async function updateEnvSet({ store }, { id, body }) {
  const existing = store.envsets.get(id)
  if (!existing) throw notFound(`环境变量组不存在：${id}`)
  const value = normalizeEnvSet({ ...(body?.envset ?? body), id }, id, existing)
  await store.envsets.put(id, value)
  return value
}

export async function deleteEnvSet({ store }, { id }) {
  if (!store.envsets.get(id)) throw notFound(`环境变量组不存在：${id}`)
  await store.envsets.delete(id)
  // 引用清理：删掉的组不该继续挂在流水线/服务器上，否则运行期会静默少注入变量
  const touched = []
  for (const table of ['pipelines', 'servers']) {
    for (const item of store[table].list()) {
      const refs = Array.isArray(item.envSetRefs) ? item.envSetRefs : []
      if (!refs.includes(id)) continue
      await store[table].update(item.id, (current) => ({
        ...current,
        envSetRefs: (current.envSetRefs ?? []).filter((ref) => ref !== id),
        updatedAt: Date.now(),
      }))
      touched.push({ table, id: item.id })
    }
  }
  return { id, deleted: true, referencesRemoved: touched }
}

/* --------------------------------------------------------- 脚本片段 */

const SNIPPET_LANGUAGES = new Set(['shell', 'python', 'javascript', 'json', 'text'])

function normalizeSnippet(raw, id, existing) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw badRequest('snippet 必须是对象')
  const now = Date.now()
  const language = typeof raw.language === 'string' && SNIPPET_LANGUAGES.has(raw.language) ? raw.language : 'shell'
  const value = {
    id: id ?? raw.id ?? newId('sn'),
    name: typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name.trim() : '',
    language,
    description: typeof raw.description === 'string' ? raw.description : '',
    tags: normalizeStringList(raw.tags, 'tags'),
    body: typeof raw.body === 'string' ? raw.body : '',
    usageCount: Number.isFinite(raw.usageCount) ? raw.usageCount : (existing?.usageCount ?? 0),
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : (existing?.createdAt ?? now),
    updatedAt: now,
  }
  if (value.name === '') throw badRequest('片段缺少 name')
  return value
}

export async function listSnippets({ store, query }) {
  const language = query?.get('language') ?? undefined
  let items = store.snippets.list()
  if (language) items = items.filter((item) => item.language === language)
  return items.sort((a, b) => (b.usageCount ?? 0) - (a.usageCount ?? 0) || a.name.localeCompare(b.name))
}

export async function createSnippet({ store }, { body }) {
  const value = normalizeSnippet(body?.snippet ?? body)
  if (store.snippets.get(value.id)) throw conflict(`片段 id 已存在：${value.id}`, { id: value.id })
  await store.snippets.put(value.id, value)
  return value
}

export async function updateSnippet({ store }, { id, body }) {
  const existing = store.snippets.get(id)
  if (!existing) throw notFound(`片段不存在：${id}`)
  const value = normalizeSnippet({ ...(body?.snippet ?? body), id }, id, existing)
  await store.snippets.put(id, value)
  return value
}

export async function deleteSnippet({ store }, { id }) {
  if (!store.snippets.get(id)) throw notFound(`片段不存在：${id}`)
  await store.snippets.delete(id)
  return { id, deleted: true }
}

/* --------------------------------------------------------- 历史输入 */

/**
 * GET /api/recent?key=
 * recent 表按 key 存取：契约 §2.4 `{key, values, updatedAt}`。
 */
export async function listRecent({ store, query }) {
  const key = query?.get('key') ?? undefined
  if (key) {
    const entry = store.recent.get(key)
    return entry ?? { key, values: [], updatedAt: 0 }
  }
  return store.recent.list().sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
}

/**
 * POST /api/recent —— 记录一次输入。
 * 语义：去重后新值置顶，最多保留 20 条（与前端下拉直选的体量匹配）。
 */
export async function putRecent({ store }, { body }) {
  const key = typeof body?.key === 'string' ? body.key.trim() : ''
  if (key === '') throw badRequest('缺少 key')
  const incoming = Array.isArray(body?.values)
    ? body.values
    : body?.value !== undefined ? [body.value] : []
  const cleaned = incoming
    .map((value) => (typeof value === 'string' ? value.trim() : String(value ?? '').trim()))
    .filter((value) => value !== '')
  if (cleaned.length === 0) throw badRequest('values 不能为空')

  const existing = store.recent.get(key)
  const merged = []
  for (const value of [...cleaned.reverse(), ...(existing?.values ?? [])]) {
    if (!merged.includes(value)) merged.push(value)
    if (merged.length >= 20) break
  }
  const value = { key, values: merged, updatedAt: Date.now() }
  await store.recent.put(key, value)
  return value
}

/** DELETE /api/recent?key= —— 清空某个 key 或全部历史。 */
export async function clearRecent({ store, query }) {
  const key = query?.get('key') ?? undefined
  if (key) {
    await store.recent.delete(key)
    return { key, cleared: true }
  }
  const keys = store.recent.entries().map(([id]) => id)
  for (const id of keys) await store.recent.delete(id)
  return { cleared: true, count: keys.length }
}
