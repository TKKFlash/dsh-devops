/**
 * dsh-devops · 服务器域 handler
 *
 * 安全要点（契约 §5 + lead 裁决）：
 *   * 内置 `local` 不可删除、不可改 kind —— 这里独立挡一道，不依赖界面；
 *   * `auth.type:'none'` 仅允许 kind:'local'（validateServer 已拦，这里给出可读文案）；
 *   * 任何错误信息都不得带出私钥/密码明文：只回引用名（keyRef/passwordRef）。
 */

import { validateServer, newId } from '../../model/schema.js'
import { resolveEnvAsync } from '../../model/variables.js'
import { badRequest, notFound, conflict } from '../http.js'

/** 只保留可安全回传的 auth 字段（引用名，不含任何密钥值）。 */
function safeAuth(auth) {
  if (!auth || typeof auth !== 'object') return { type: 'key', keyRef: '', passwordRef: '' }
  return {
    type: ['key', 'password', 'agent', 'none'].includes(auth.type) ? auth.type : 'key',
    keyRef: typeof auth.keyRef === 'string' ? auth.keyRef : '',
    passwordRef: typeof auth.passwordRef === 'string' ? auth.passwordRef : '',
  }
}

/** 对外投影：永不包含明文密钥字段。 */
function publicServer(server) {
  return {
    id: server.id,
    name: server.name,
    kind: server.kind,
    host: server.host ?? '',
    port: server.port ?? 22,
    user: server.user ?? '',
    auth: safeAuth(server.auth),
    shell: server.shell ?? '',
    workdir: server.workdir ?? '',
    tags: server.tags ?? [],
    defaultEnv: server.defaultEnv ?? [],
    customEnv: server.customEnv ?? [],
    envSetRefs: server.envSetRefs ?? [],
    probe: server.probe ?? null,
    runtimes: server.runtimes ?? {},
    allowProvision: server.allowProvision === true,
    createdAt: server.createdAt ?? 0,
    updatedAt: server.updatedAt ?? 0,
    builtin: server.id === 'local',
  }
}

/**
 * 归一化服务器输入。
 * `password`/`privateKey` 这类明文字段一律丢弃：契约要求密钥只来自 credentials 引用。
 */
function normalizeServer(raw, id) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw badRequest('server 必须是对象')
  }
  const now = Date.now()
  const auth = safeAuth(raw.auth)
  const server = {
    id: id ?? raw.id ?? newId('srv'),
    name: typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name.trim() : '',
    kind: raw.kind === 'local' ? 'local' : 'ssh',
    host: typeof raw.host === 'string' ? raw.host.trim() : '',
    port: Number.isInteger(raw.port) ? raw.port : 22,
    user: typeof raw.user === 'string' ? raw.user.trim() : '',
    auth,
    shell: typeof raw.shell === 'string' ? raw.shell : '',
    workdir: typeof raw.workdir === 'string' ? raw.workdir : '',
    tags: Array.isArray(raw.tags) ? raw.tags.filter((tag) => typeof tag === 'string') : [],
    defaultEnv: Array.isArray(raw.defaultEnv) ? raw.defaultEnv : [],
    customEnv: Array.isArray(raw.customEnv) ? raw.customEnv : [],
    envSetRefs: Array.isArray(raw.envSetRefs) ? raw.envSetRefs.filter((ref) => typeof ref === 'string') : [],
    probe: raw.probe && typeof raw.probe === 'object' ? raw.probe : undefined,
    runtimes: raw.runtimes && typeof raw.runtimes === 'object' ? raw.runtimes : {},
    allowProvision: raw.allowProvision === true,
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : now,
    updatedAt: now,
  }
  const check = validateServer(server)
  if (!check.ok) {
    throw badRequest('服务器校验未通过', {
      errors: check.errors.map((error) => ({
        ...error,
        // 提示里只出现引用名，不出现任何值
        message: error.code === 'bad-type' && error.path === 'auth.type'
          ? 'auth.type 只能是 key|password|agent|none，且 none 仅适用于内置本机服务器'
          : error.message,
      })),
    })
  }
  return server
}

/** GET /api/servers */
export async function listServers({ store }) {
  // local 排在最前，便于作为默认选中项
  return store.servers
    .list()
    .map(publicServer)
    .sort((a, b) => (a.id === 'local' ? -1 : b.id === 'local' ? 1 : a.name.localeCompare(b.name)))
}

/** GET /api/servers/:id */
export async function getServer({ store }, { id }) {
  const server = store.servers.get(id)
  if (!server) throw notFound(`服务器不存在：${id}`)
  return publicServer(server)
}

/** POST /api/servers */
export async function createServer({ store }, { body }) {
  const raw = body?.server ?? body
  const server = normalizeServer(raw)
  if (server.id === 'local') throw conflict('local 是内置服务器，不可新建')
  if (store.servers.get(server.id)) {
    throw conflict(`服务器 id 已存在：${server.id}`, { id: server.id })
  }
  await store.servers.put(server.id, server)
  return publicServer(server)
}

/** PUT /api/servers/:id */
export async function updateServer({ store, provisioner }, { id, body }) {
  const existing = store.servers.get(id)
  if (!existing) throw notFound(`服务器不存在：${id}`)
  const raw = body?.server ?? body

  // 内置 local：只允许改显示名/标签等展示字段，kind 一律锁定
  if (id === 'local') {
    const next = {
      ...existing,
      name: typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name.trim() : existing.name,
      kind: 'local',
      updatedAt: Date.now(),
    }
    const check = validateServer(next)
    if (!check.ok) throw badRequest('服务器校验未通过', { errors: check.errors })
    await store.servers.put(id, next)
    return publicServer(next)
  }

  const server = normalizeServer({ ...raw, createdAt: existing.createdAt }, id)
  await store.servers.put(id, server)
  // 配置变了，探测缓存随之失效，否则「测试连接」会回放旧结果
  if (provisioner && typeof provisioner.invalidate === 'function') provisioner.invalidate(id)
  return publicServer(server)
}

/** DELETE /api/servers/:id */
export async function deleteServer({ store }, { id }) {
  if (id === 'local') throw conflict('内置 local 服务器不可删除')
  const existing = store.servers.get(id)
  if (!existing) throw notFound(`服务器不存在：${id}`)
  await store.servers.delete(id)
  // 注意：executors.dispose() 是「释放全部执行器」，删单台服务器时绝不能调它，
  // 否则会连带关掉其它服务器的长连接。该连接留给宿主 reload/退出时统一释放。
  return { id, deleted: true }
}

/** 解析服务器（id 或对象）；找不到抛 404。 */
function requireServer(store, id) {
  const server = store.servers.get(id)
  if (!server) throw notFound(`服务器不存在：${id}`)
  return server
}

/** 把内部错误压成不含密钥的可读文案。 */
function safeMessage(error, auth) {
  const text = String(error?.message ?? error ?? '')
  // 兜底：万一底层把口令拼进了消息，这里再做一次关键字截断
  const refs = [auth?.keyRef, auth?.passwordRef].filter((ref) => typeof ref === 'string' && ref !== '')
  if (/passphrase|password|private key|PRIVATE KEY/i.test(text)) {
    return '连接失败：认证信息无效或不可用（请检查引用的凭据名是否已在宿主凭据里配置）'
  }
  if (refs.some((ref) => text.includes(ref)) && /invalid|incorrect|denied/i.test(text)) {
    return '连接失败：认证被拒绝（请检查凭据引用是否指向正确的密钥/口令）'
  }
  return text
}

/** POST /api/servers/:id/test —— 探测（probe）。 */
export async function testServer({ store, executors, provisioner }, { id }) {
  const server = requireServer(store, id)
  if (!executors || typeof executors.resolveAsync !== 'function') {
    throw badRequest('执行器注册表不可用')
  }
  let executor
  try {
    executor = await executors.resolveAsync(server)
  } catch (error) {
    throw badRequest(`无法解析执行器：${safeMessage(error, server.auth)}`)
  }
  let probe
  try {
    probe = await executor.probe(server)
  } catch (error) {
    throw badRequest(safeMessage(error, server.auth))
  }
  // 探测结果写回服务器，供前端展示与后续复用
  try {
    await store.servers.update(id, (current) => ({ ...current, probe: { ...probe, at: Date.now() }, updatedAt: Date.now() }))
  } catch {
    /* 写回失败不影响本次探测结果返回 */
  }
  if (provisioner && typeof provisioner.invalidate === 'function') provisioner.invalidate(id)
  return { serverId: id, probe }
}

/** POST /api/servers/:id/provision {runtime:'python:3.11'} */
export async function provisionServer({ store, provisioner }, { id, body }) {
  const server = requireServer(store, id)
  if (!provisioner || typeof provisioner.ensure !== 'function') {
    throw badRequest('环境供给器不可用（provisioner 未装配）')
  }
  const runtime = body?.runtime
  const requirement = requirementOf(body, runtime)
  if (!requirement) throw badRequest("缺少 runtime（如 'python:3.11'）或 requirement")

  // allowProvision 缺省跟随服务器设置；显式 allowInstall 优先
  const allowInstall = typeof body?.allowInstall === 'boolean'
    ? body.allowInstall
    : server.allowProvision === true

  const actions = []
  let result
  try {
    result = await provisioner.ensure(server, requirement, {
      allowInstall,
      onLog: (text, stream) => {
        // 只回传命令摘要与输出，不回传环境变量值（供给流程可能带上凭据）
        actions.push({ at: Date.now(), stream: stream ?? 'stdout', text: String(text ?? '').slice(0, 2000) })
      },
    })
  } catch (error) {
    throw badRequest(`环境供给失败：${safeMessage(error, server.auth)}`)
  }

  // 成功时把运行时写回服务器（契约 §2.3 runtimes）
  if (result?.ok === true && result.resolved && typeof result.resolved === 'object') {
    try {
      await store.servers.update(id, (current) => {
        const runtimes = { ...(current.runtimes ?? {}) }
        const at = Date.now()
        for (const [name, value] of Object.entries(result.resolved)) {
          runtimes[name] = { path: String(value ?? ''), at }
        }
        return { ...current, runtimes, updatedAt: at }
      })
    } catch {
      /* 写回失败不影响供给结果 */
    }
  }

  return {
    serverId: id,
    ok: result?.ok === true,
    resolved: result?.resolved ?? {},
    error: result?.ok === true ? '' : safeMessage(result?.error ?? '供给未完成', server.auth),
    suggestion: result?.suggestion ?? '',
    actions: result?.actions ?? [],
    log: actions,
    allowInstall,
  }
}

/** 把 `python:3.11` 或 `{python:'3.11'}` 统一成 requirement 对象。 */
function requirementOf(body, runtime) {
  if (body?.requirement && typeof body.requirement === 'object') return body.requirement
  if (typeof runtime !== 'string' || runtime.trim() === '') return null
  const text = runtime.trim()
  const colon = text.indexOf(':')
  if (colon === -1) return { [text]: '' }
  const name = text.slice(0, colon).trim()
  const version = text.slice(colon + 1).trim()
  if (!name) return null
  return { [name]: version }
}

/** GET /api/servers/:id/env —— 环境变量合并预览（secret 值打码）。 */
export async function serverEnv({ store, credentials }, { id, query }) {
  const server = requireServer(store, id)
  const pipelineId = query?.get('pipelineId') ?? undefined
  const pipeline = pipelineId ? store.pipelines.get(pipelineId) : undefined
  if (pipelineId && !pipeline) throw notFound(`流水线不存在：${pipelineId}`)

  const envSets = (server.envSetRefs ?? [])
    .map((ref) => store.envsets.get(ref))
    .filter(Boolean)

  // 预览只判断「是否已配置」，绝不把真实值交出去：命中即回常量掩码。
  // 这样即使调用方误用，也不可能从预览接口读到密钥明文。
  const PREVIEW_MASK = '***'
  const credentialsPort = {
    async resolve(ref) {
      try {
        const found = await credentials?.(ref)
        return found ? PREVIEW_MASK : undefined
      } catch {
        // 凭据后端报错时如实抛出，避免「读失败」被误当成「未配置」
        throw new Error(`读取凭据引用失败：${ref}`)
      }
    },
  }

  const result = await resolveEnvAsync({
    processEnv: {},
    server,
    envSets,
    pipeline: pipeline ?? {},
    credentials: credentials ? credentialsPort : undefined,
  })

  const masked = new Set(result.masked ?? [])
  const env = {}
  for (const [key, value] of Object.entries(result.env ?? {})) {
    if (value === undefined) continue
    env[key] = masked.has(value) ? PREVIEW_MASK : value
  }
  return {
    serverId: id,
    env,
    masked: [...masked],
    report: result.report ?? [],
    unresolved: result.unresolved ?? [],
  }
}
