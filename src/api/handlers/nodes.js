/**
 * dsh-devops · 节点库 handler
 *
 * 自定义节点 = 用户提供的可执行代码，风险高于其它资源，因此：
 *   * 只有 `allowCustomNodeCode === true` 时才允许注册（契约 §5.4）；
 *   * 代码只落到 `<dataDir>/nodes/<type>.mjs`，再由 nodeRegistry.loadCustom 走
 *     契约里的 containment 校验后加载 —— 绝不 eval 上传内容；
 *   * 描述符里的 `run` 允许是「代码字符串」（前端 JSON 传不了函数），服务端把它
 *     原样写进 .mjs 的模块体，因此该字段本身就是用户脚本内容，不是拼进 shell 的输入。
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { badRequest, notFound, conflict } from '../http.js'

/** 节点类型白名单：只允许 [a-z][A-Za-z0-9]* 起头，形如 shell.exec / server.ensureRuntime。 */
const NODE_TYPE_PATTERN = /^[a-z][A-Za-z0-9]*(?:[.-][A-Za-z0-9]+)*$/

/**
 * GET /api/nodes —— 节点目录。
 *
 * 返回**数组**（与前端 state.nodes 及契约测试一致）。分类聚合与开关状态不塞进
 * 同一响应：分类由前端从节点的 category 自行聚合，开关走 /api/settings。
 * 需要聚合形态时用 `?withCategories=1`。
 */
export async function listNodes({ nodes, config }, { query } = {}) {
  const list = !nodes || typeof nodes.list !== 'function'
    ? []
    : nodes.list().map((entry) => ({
        ...entry,
        // 前端按 `custom` 布尔筛选，这里补齐；同时保留 source 原始值
        custom: entry.source === 'custom',
      }))

  if (query?.get?.('withCategories') === '1') {
    const categories = typeof nodes?.categories === 'function'
      ? nodes.categories()
      : [...new Set(list.map((entry) => entry.category))].map((category) => ({
          category,
          types: list.filter((entry) => entry.category === category).map((entry) => entry.type),
        }))
    return { nodes: list, categories, allowCustomNodeCode: config?.allowCustomNodeCode === true }
  }
  return list
}

/** GET /api/nodes/:type */
export async function getNode({ nodes }, { type }) {
  if (!nodes || typeof nodes.get !== 'function') throw badRequest('节点注册表不可用')
  const descriptor = nodes.get(type)
  if (!descriptor) throw notFound(`节点类型不存在：${type}`)
  return { ...descriptor, custom: descriptor.source === 'custom' }
}

/** 自定义节点目录。 */
function customDir(config) {
  const dataDir = config?.dataDir
  if (typeof dataDir !== 'string' || dataDir.trim() === '') throw badRequest('缺少 dataDir 配置')
  return path.join(path.resolve(dataDir), 'nodes')
}

/**
 * 把描述符渲染成 .mjs 模块源码。
 * `run` 为字符串时原样写入（用户代码）；为函数时无法序列化，明确报错。
 */
function renderNodeModule(descriptor, runCode) {
  const { run, ...rest } = descriptor
  const json = JSON.stringify(rest, null, 2)
  return [
    '/**',
    ' * dsh-devops 自定义节点（由界面/API 生成）。',
    ' * 该文件会在服务器上执行任意代码，只应写入你完全信任的实现。',
    ' */',
    '',
    `export const descriptor = {`,
    `  ...${json},`,
    `  run: ${runCode},`,
    `}`,
    '',
    'export default descriptor',
    '',
  ].join('\n')
}

/**
 * POST /api/nodes/custom {descriptor}
 * descriptor.run 支持：
 *   * 代码字符串（推荐，形如 `async (rt, inputs) => {...}`）→ 落盘为 .mjs 后加载；
 *   * 函数对象（仅进程内调用方，如工具）→ 直接注册，不落盘。
 */
export async function registerCustomNode({ nodes, config }, { body }) {
  if (config?.allowCustomNodeCode !== true) {
    throw badRequest('自定义节点已禁用：请先在「设置」里打开 allowCustomNodeCode 再注册（自定义节点会执行任意代码）')
  }
  if (!nodes || typeof nodes.register !== 'function') throw badRequest('节点注册表不可用')

  const descriptor = body?.descriptor ?? body
  if (descriptor === null || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
    throw badRequest('descriptor 必须是对象')
  }
  const type = typeof descriptor.type === 'string' ? descriptor.type.trim() : ''
  if (type === '') throw badRequest('descriptor 缺少 type')
  if (!NODE_TYPE_PATTERN.test(type)) {
    throw badRequest(`节点类型非法：${type}（应形如 shell.exec 或 server.ensureRuntime）`)
  }
  const existing = nodes.get(type)
  if (existing && existing.source === 'builtin') {
    throw conflict(`内置节点类型不可覆盖：${type}`, { type })
  }

  const runValue = descriptor.run

  // 形态一：进程内直接给函数（工具/测试）
  if (typeof runValue === 'function') {
    const check = typeof nodes.validate === 'function' ? nodes.validate(descriptor) : { ok: true }
    if (check.ok === false) throw badRequest('节点描述符非法', { errors: check.errors })
    if (existing) nodes.register({ ...descriptor, type }, { custom: true, override: true })
    else nodes.register(descriptor, { custom: true })
    return { type, registered: true, persisted: false, source: 'inline' }
  }

  // 形态二：代码字符串 → 落盘 + 加载（前端走这条）
  if (typeof runValue !== 'string' || runValue.trim() === '') {
    throw badRequest('descriptor.run 必须是函数或代码字符串')
  }
  const dir = customDir(config)
  const file = path.join(dir, `${type}.mjs`)
  const source = renderNodeModule({ ...descriptor, type }, runValue)

  // 语法自检：写坏文件会让后续每次启动都加载失败，宁可在写入前拦住
  try {
    // 用 Function 构造只做语法检查，不执行用户代码
    // eslint-disable-next-line no-new-func
    new Function(`return (${runValue})`)
  } catch (error) {
    throw badRequest(`run 代码语法非法：${error?.message ?? error}`)
  }

  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(file, source, 'utf8')

  let loaded = { loaded: [], failed: [], skipped: false, reason: '' }
  if (typeof nodes.loadCustom === 'function') {
    loaded = await nodes.loadCustom(dir)
  }
  if (loaded.failed?.length) {
    const detail = loaded.failed.map((item) => `${item.file}: ${item.error}`).join('；')
    throw badRequest(`自定义节点加载失败：${detail}`)
  }
  if (!nodes.get(type)) {
    throw badRequest(`自定义节点未能注册：${type}（请检查描述符字段是否合法）`)
  }
  return { type, registered: true, persisted: true, file, source: 'file', loaded: loaded.loaded }
}

/** DELETE /api/nodes/custom/:type —— 只能删自定义节点，并清理磁盘文件。 */
export async function deleteCustomNode({ nodes, config }, { type }) {
  if (!nodes || typeof nodes.get !== 'function') throw badRequest('节点注册表不可用')
  const descriptor = nodes.get(type)
  if (!descriptor) throw notFound(`节点类型不存在：${type}`)
  if (descriptor.source !== 'custom') throw conflict(`内置节点不可删除：${type}`)

  // 先取下待保留的自定义节点描述符（clearCustom 会连它们一起摘掉）
  const others = nodes.list().filter((entry) => entry.custom && entry.type !== type)
  const full = new Map()
  for (const entry of others) {
    const detail = nodes.get(entry.type)
    if (detail && typeof detail.run === 'function') full.set(entry.type, detail)
  }

  const removed = typeof nodes.clearCustom === 'function' ? nodes.clearCustom() : []
  let restored = 0
  for (const [keepType, detail] of full) {
    try {
      nodes.register(detail, { custom: true, override: true })
      restored += 1
    } catch {
      /* 单个恢复失败不影响整体结果 */
    }
  }

  // 同步删掉落盘文件，否则下次启动又会被 loadCustom 装回来
  let fileRemoved = false
  try {
    const file = path.join(customDir(config), `${type}.mjs`)
    await fs.rm(file, { force: true })
    fileRemoved = true
  } catch {
    /* 文件不存在或不可删都不影响内存卸载结果 */
  }
  return { type, deleted: true, removed, restored, fileRemoved }
}
