/**
 * dsh-devops · 文件系统代理 handler（fs/list、fs/stat、fs/match）
 *
 * 这些接口按 server 把请求转发到对应执行器（local 或 ssh），本身不做路径判断：
 * 越界校验由执行器（契约 §3.7 的 realpath containment）负责，避免两套规则打架。
 */

import { badRequest, notFound } from '../http.js'

/** 解析服务器；缺省用 local。 */
function resolveServer(store, serverId) {
  const id = typeof serverId === 'string' && serverId.trim() !== '' ? serverId.trim() : 'local'
  if (id === 'local') return { id: 'local', name: '本机', kind: 'local', host: '127.0.0.1' }
  const server = store.servers.get(id)
  if (!server) throw notFound(`服务器不存在：${id}`)
  return server
}

async function executorFor(executors, server) {
  if (!executors) throw badRequest('执行器注册表不可用（executors 未装配）')
  try {
    if (typeof executors.resolveAsync === 'function') return await executors.resolveAsync(server)
    return executors.resolve(server)
  } catch (error) {
    throw badRequest(`无法解析执行器：${error?.message ?? error}`)
  }
}

/** GET /api/fs/list?server=&path= */
export async function fsList({ store, executors }, { query }) {
  const server = resolveServer(store, query?.get('server'))
  const target = query?.get('path') ?? (server.workdir || '.')
  const executor = await executorFor(executors, server)
  if (typeof executor.readDir !== 'function') throw badRequest('执行器不支持列目录')
  let entries
  try {
    entries = await executor.readDir(server, target)
  } catch (error) {
    throw badRequest(`无法读取目录 ${target}：${error?.message ?? error}`)
  }
  // 目录在前、同类按名称排序，界面上更好找
  const list = [...(entries ?? [])].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return String(a.name).localeCompare(String(b.name))
  })
  return { server: server.id, path: target, entries: list }
}

/** GET /api/fs/stat?server=&path= */
export async function fsStat({ store, executors }, { query }) {
  const server = resolveServer(store, query?.get('server'))
  const target = query?.get('path')
  if (!target) throw badRequest('缺少 path')
  const executor = await executorFor(executors, server)
  if (typeof executor.stat !== 'function') throw badRequest('执行器不支持 stat')
  try {
    const result = await executor.stat(server, target)
    return { server: server.id, path: target, ...result }
  } catch (error) {
    throw badRequest(`无法读取 ${target}：${error?.message ?? error}`)
  }
}

/** POST /api/fs/match {server, base, glob} —— glob 命中预览（用于 glob 控件）。 */
export async function fsMatch({ store, executors }, { body }) {
  const server = resolveServer(store, body?.server)
  const base = typeof body?.base === 'string' && body.base !== '' ? body.base : (server.workdir || '.')
  const pattern = body?.glob ?? body?.pattern
  if (typeof pattern !== 'string' || pattern.trim() === '') throw badRequest('缺少 glob')
  const executor = await executorFor(executors, server)
  if (typeof executor.match !== 'function') throw badRequest('执行器不支持 glob 匹配')
  const limit = Number.isFinite(body?.limit) && body.limit > 0 ? Math.trunc(body.limit) : 200
  try {
    const result = await executor.match(server, base, pattern, { limit })
    return {
      server: server.id,
      base,
      glob: pattern,
      matched: result?.matched ?? [],
      truncated: result?.truncated === true,
      total: result?.total ?? (result?.matched?.length ?? 0),
    }
  } catch (error) {
    throw badRequest(`glob 匹配失败：${error?.message ?? error}`)
  }
}
