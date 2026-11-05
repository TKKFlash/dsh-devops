/**
 * dsh-devops · 设置 handler
 *
 * settings 是 global 单例（契约 §2.4）。这里做三层收敛：
 *   1. 只接受契约列出的设置键，未知键忽略并如实回报；
 *   2. 类型与范围按 SETTINGS_LIMITS + 本文件的类型表校验；
 *   3. `defaultServer` 必须指向已登记的服务器（否则运行期才炸）。
 */

import { mergeSettings, SETTINGS_LIMITS } from '../../store/domains.js'
import { SHELL_CHOICES } from '../../config.js'
import { badRequest } from '../http.js'

/**
 * 设置键 → 类型。
 * 数字项的范围由 SETTINGS_LIMITS 提供（store 层收敛），这里补齐类型与字符串项。
 */
const SETTINGS_TYPES = Object.freeze({
  defaultServer: 'server',
  maxConcurrentRuns: 'integer',
  maxParallelSteps: 'integer',
  logRingBytes: 'integer',
  logRetentionDays: 'integer',
  defaultShell: 'shell',
  statusBar: 'boolean',
  stuckSilenceSec: 'integer',
  allowCustomNodeCode: 'boolean',
})

/** GET /api/settings */
export async function getSettings({ store }) {
  return store.settings.get()
}

/** PUT /api/settings */
export async function putSettings({ store }, { body }) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('设置必须是对象')
  }
  const patch = {}
  const warnings = []

  for (const [key, value] of Object.entries(body)) {
    if (value === undefined) continue
    const type = SETTINGS_TYPES[key]
    if (type === undefined) {
      // 未知键不写入（拼错一个键名就静默改配置是最难查的问题），但如实回报
      warnings.push({ path: key, code: 'unknown-field', message: `未知设置项：${key}` })
      continue
    }

    if (type === 'boolean') {
      if (typeof value !== 'boolean') {
        throw badRequest(`设置项 ${key} 必须是布尔值`, { errors: [{ path: key, code: 'bad-type', message: '必须是布尔值' }] })
      }
    } else if (type === 'shell') {
      if (typeof value !== 'string' || !SHELL_CHOICES.includes(value)) {
        throw badRequest(`设置项 ${key} 只能是 ${SHELL_CHOICES.join('|')}`, {
          errors: [{ path: key, code: 'bad-type', message: `只能是 ${SHELL_CHOICES.join('|')}` }],
        })
      }
    } else if (type === 'server') {
      if (typeof value !== 'string' || value.trim() === '') {
        throw badRequest(`设置项 ${key} 必须是非空字符串`, { errors: [{ path: key, code: 'bad-type', message: '必须是非空字符串' }] })
      }
      if (value !== 'local' && !store.servers.get(value)) {
        throw badRequest(`默认服务器不存在：${value}`, {
          errors: [{ path: key, code: 'not-found', message: '服务器未登记' }],
        })
      }
    } else {
      // integer：类型 + 范围都按 SETTINGS_LIMITS 校验
      if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
        throw badRequest(`设置项 ${key} 必须是整数`, { errors: [{ path: key, code: 'bad-type', message: '必须是整数' }] })
      }
      const limit = SETTINGS_LIMITS[key]
      if (limit) {
        if (limit.min !== undefined && value < limit.min) {
          throw badRequest(`设置项 ${key} 不能小于 ${limit.min}`, {
            errors: [{ path: key, code: 'bad-range', message: `不能小于 ${limit.min}` }],
          })
        }
        if (limit.max !== undefined && value > limit.max) {
          throw badRequest(`设置项 ${key} 不能大于 ${limit.max}`, {
            errors: [{ path: key, code: 'bad-range', message: `不能大于 ${limit.max}` }],
          })
        }
      }
    }
    patch[key] = value
  }

  // mergeSettings 会补默认值并再次收敛数值范围，保证落盘的一定是合法值
  const merged = mergeSettings({ ...store.settings.get(), ...patch })
  await store.settings.set(merged)
  return { settings: store.settings.get(), warnings }
}
