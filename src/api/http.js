/**
 * dsh-devops · HTTP 传输层工具（零运行时依赖）
 *
 * 这里只放与业务无关的传输原语：统一响应形状、请求体读取与限额、
 * 回环地址判定、路径匹配、查询参数取值。路由分发在 router.js，
 * 业务在 handlers/*.js —— 三者互不依赖，便于单独冒烟。
 */

/** JSON 请求体上限 1 MiB（契约 §3.10）。 */
export const BODY_LIMIT_BYTES = 1024 * 1024

/** 统一错误：被 router 捕获后转成 {ok:false,message,code} 响应。 */
export class HttpError extends Error {
  /**
   * @param {number} status HTTP 状态码
   * @param {string} code 机器可读短码（小写短横线）
   * @param {string} message 人类可读说明（中文）
   * @param {unknown} [details] 附加结构（冲突项、缺失项等）
   */
  constructor(status, code, message, details) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
    if (details !== undefined) this.details = details
  }
}

/** 400 参数不合法。 */
export function badRequest(message, details) {
  return new HttpError(400, 'bad-request', message, details)
}

/** 404 路由或资源不存在。 */
export function notFound(message, details) {
  return new HttpError(404, 'not-found', message, details)
}

/** 409 冲突（id 重复、状态不允许等）。 */
export function conflict(message, details) {
  return new HttpError(409, 'conflict', message, details)
}

/** 503 依赖模块/服务缺席（队友模块尚未装载时用它，避免误报 500）。 */
export function unavailable(message, details) {
  return new HttpError(503, 'unavailable', message, details)
}

/** 写出 JSON 响应。 */
export function sendJson(res, status, payload) {
  const text = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  })
  res.end(text)
}

/** 成功响应：{"ok":true,"value":...}（契约 §3.10）。 */
export function sendValue(res, value, status = 200) {
  sendJson(res, status, { ok: true, value })
}

/** 失败响应：{"ok":false,"message":"...","code":"..."}。 */
export function sendError(res, status, code, message, details) {
  const body = { ok: false, message, code }
  if (details !== undefined) body.details = details
  sendJson(res, status, body)
}

const LOOPBACK_V4 = /^127(?:\.\d{1,3}){3}$/

/**
 * 是否回环地址。
 * remoteAddress 缺失（unix socket、测试桩）按本机处理——与 dsh-meme 的
 * denyNonLoopback 思路一致：拿不到来源时不额外放行，但也不无谓地拒绝本地调用。
 * @param {string|undefined|null} address
 */
export function isLoopbackAddress(address) {
  const value = String(address || '').trim().toLowerCase()
  if (!value) return true
  if (value === '::1' || value === '0:0:0:0:0:0:0:1') return true
  if (LOOPBACK_V4.test(value)) return true
  // IPv4-mapped IPv6：::ffff:127.0.0.1（Node 在双栈监听下的常见形态）
  const mapped = value.startsWith('::ffff:') ? value.slice('::ffff:'.length) : ''
  if (mapped && (LOOPBACK_V4.test(mapped) || mapped === '::1')) return true
  if (value.includes('ffff') && LOOPBACK_V4.test(value.slice(value.lastIndexOf(':') + 1)) && value.startsWith('0:0:0:0:0:ffff:')) return true
  return false
}

/** 私有网段/链路本地（仅 allowLanAccess 显式开启时放行）。 */
export function isLanAddress(address) {
  const value = String(address || '').trim().toLowerCase()
  if (!value) return false
  const v4 = value.startsWith('::ffff:') ? value.slice('::ffff:'.length) : value
  if (/^10\./.test(v4)) return true
  if (/^192\.168\./.test(v4)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(v4)) return true
  if (/^169\.254\./.test(v4)) return true
  if (/^fe[89ab]/i.test(value)) return true
  if (/^f[cd]/i.test(value)) return true
  return false
}

/**
 * 仅 loopback 允许（allowLanAccess 显式开启才放行局域网）。
 * 拒绝时自己写 403 并返回 true，调用方直接 return。
 * @returns {boolean} 是否已拒绝（true = 请求已被结束）
 */
export function denyNonLoopback(req, res, allowLan = false) {
  const address = req && req.socket ? req.socket.remoteAddress : undefined
  if (isLoopbackAddress(address)) return false
  if (allowLan && isLanAddress(address)) return false
  sendError(
    res,
    403,
    'forbidden',
    '拒绝：只接受本机（回环地址）请求。若确需局域网访问，请在插件配置里显式打开 allowLanAccess。',
  )
  return true
}

/**
 * 解析请求 URL。畸形百分号转义按 400 处理，不抛 500。
 * @returns {{pathname:string, query:URLSearchParams}}
 */
export function parseRequestUrl(req) {
  const raw = String((req && req.url) || '')
  const splitAt = raw.indexOf('?')
  const rawPath = splitAt === -1 ? raw : raw.slice(0, splitAt)
  const rawQuery = splitAt === -1 ? '' : raw.slice(splitAt + 1)
  let pathname
  try {
    pathname = decodeURIComponent(rawPath)
  } catch {
    throw badRequest('请求路径包含非法的百分号转义')
  }
  return { pathname, query: new URLSearchParams(rawQuery) }
}

/**
 * 读取并解析 JSON 请求体。
 * 超过 limit 抛 413（契约 §3.10）；空体返回 undefined；非法 JSON 抛 400。
 * @returns {Promise<unknown>}
 */
export function readJsonBody(req, limit = BODY_LIMIT_BYTES) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers?.['content-length'])
    if (Number.isFinite(declared) && declared > limit) {
      reject(new HttpError(413, 'payload-too-large', `请求体超过上限 ${limit} 字节`))
      return
    }
    const chunks = []
    let size = 0
    let settled = false
    const finish = (fn, arg) => {
      if (settled) return
      settled = true
      fn(arg)
    }
    req.on('data', (chunk) => {
      if (settled) return
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
      size += buf.length
      if (size > limit) {
        finish(reject, new HttpError(413, 'payload-too-large', `请求体超过上限 ${limit} 字节`))
        // 主动丢弃后续数据，避免连接被写端压住
        try {
          req.destroy?.()
        } catch {
          /* 桩对象可能没有 destroy */
        }
        return
      }
      chunks.push(buf)
    })
    req.on('error', (error) => finish(reject, error))
    req.on('end', () => {
      if (settled) return
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (!text) {
        finish(resolve, undefined)
        return
      }
      try {
        finish(resolve, JSON.parse(text))
      } catch {
        finish(reject, badRequest('请求体不是合法 JSON'))
      }
    })
  })
}

/**
 * 读取对象型 JSON 请求体；缺失或不是对象时抛 400。
 * @returns {Promise<Record<string, unknown>>}
 */
export async function readJsonObject(req, limit = BODY_LIMIT_BYTES) {
  const body = await readJsonBody(req, limit)
  if (body === undefined) throw badRequest('缺少请求体')
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('请求体必须是 JSON 对象')
  }
  return body
}

/**
 * 极简路径匹配：'/api/pipelines/:id/runs' 对 '/api/pipelines/build/runs'。
 * 段内解码交给 parseRequestUrl（已整体解码一次）。
 * @returns {Record<string,string>|null} null = 不匹配
 */
export function matchPath(pattern, pathname) {
  if (pattern === pathname) return {}
  const patternParts = pattern.split('/')
  const pathParts = pathname.split('/')
  if (patternParts.length !== pathParts.length) return null
  const params = {}
  for (let index = 0; index < patternParts.length; index += 1) {
    const expected = patternParts[index]
    const actual = pathParts[index]
    if (expected.startsWith(':')) {
      if (actual === '') return null
      params[expected.slice(1)] = actual
      continue
    }
    if (expected !== actual) return null
  }
  return params
}

/** 查询参数取字符串；空串按缺省处理。 */
export function queryParam(query, name, fallback = undefined) {
  const raw = query?.get(name)
  if (raw === null || raw === undefined) return fallback
  const value = String(raw).trim()
  return value === '' ? fallback : value
}

/** 查询参数取整数。 */
export function queryInt(query, name, fallback) {
  const raw = queryParam(query, name)
  if (raw === undefined) return fallback
  const value = Number(raw)
  return Number.isFinite(value) ? Math.trunc(value) : fallback
}

/** 宽松布尔解析（true/1/yes/on）。 */
export function toBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value
  if (value === undefined || value === null || value === '') return fallback
  const text = String(value).trim().toLowerCase()
  if (['true', '1', 'yes', 'on'].includes(text)) return true
  if (['false', '0', 'no', 'off'].includes(text)) return false
  return fallback
}

/** 取必填字符串字段，缺失/空白抛 400。 */
export function requireString(source, key, label = key) {
  const value = source?.[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw badRequest(`缺少必填字段 ${label}`)
  }
  return value.trim()
}
