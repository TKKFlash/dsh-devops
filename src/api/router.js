/**
 * dsh-devops · HTTP 路由分发（契约 §3.10）
 *
 * 唯一注册点由 index.js 负责：
 *   ctx.effect(() => webServer.register({ kind:'prefix', path:'/dsh-devops', handler }))
 * 本文件只提供 handler —— 它本身不碰 ctx，便于用假 req/res 直接冒烟。
 *
 * 统一响应：成功 {ok:true,value}；失败 {ok:false,message,code}（400/403/404/409/413/500/503）。
 * 请求体上限 1 MiB；默认仅 loopback（allowLanAccess 才放行局域网）。
 */

import {
  HttpError,
  badRequest,
  notFound,
  sendValue,
  sendError,
  denyNonLoopback,
  parseRequestUrl,
  readJsonObject,
  matchPath,
  BODY_LIMIT_BYTES,
} from './http.js'

import * as pipelines from './handlers/pipelines.js'
import * as templates from './handlers/templates.js'
import * as runs from './handlers/runs.js'
import * as servers from './handlers/servers.js'
import * as resources from './handlers/resources.js'
import * as nodesHandler from './handlers/nodes.js'
import * as fsx from './handlers/fsx.js'
import * as transfer from './handlers/transfer.js'
import * as settings from './handlers/settings.js'

/** 路由前缀（index.js 注册时也用这个常量，避免两处写死不一致）。 */
export const ROUTE_PREFIX = '/dsh-devops'

/**
 * 路由表：[method, path(相对 /api), handler, options]
 *
 * handler 签名 `(context, {id, body, query, req, res}) => Promise<value>|value`。
 * options.stream = true 表示该端点自行接管响应（SSE），router 不写 JSON。
 */
function buildRoutes() {
  return [
    // meta
    ['GET', '/api/meta', meta, {}],

    // 流水线
    ['GET', '/api/pipelines', pipelines.listPipelines, {}],
    ['POST', '/api/pipelines', pipelines.createPipeline, { body: true }],
    // validate 必须排在 /:id 之前，否则会被当成 id 为 "validate" 的流水线
    ['POST', '/api/pipelines/validate', pipelines.validatePipelineDoc, { body: true }],
    ['GET', '/api/pipelines/:id', pipelines.getPipeline, {}],
    ['PUT', '/api/pipelines/:id', pipelines.updatePipeline, { body: true }],
    ['DELETE', '/api/pipelines/:id', pipelines.deletePipeline, {}],
    ['POST', '/api/pipelines/:id/runs', pipelines.runPipeline, { body: true }],

    // 模板
    ['GET', '/api/templates', templates.listTemplates, {}],
    ['POST', '/api/templates', templates.createTemplate, { body: true }],
    ['POST', '/api/templates/from-pipeline', templates.templateFromPipeline, { body: true }],
    ['GET', '/api/templates/:id', templates.getTemplate, {}],
    ['PUT', '/api/templates/:id', templates.updateTemplate, { body: true }],
    ['DELETE', '/api/templates/:id', templates.deleteTemplate, {}],
    ['POST', '/api/templates/:id/instantiate', templates.instantiateTemplate, { body: true }],

    // 运行
    ['GET', '/api/runs', runs.listRuns, {}],
    ['GET', '/api/runs/:id', runs.getRun, {}],
    ['POST', '/api/runs/:id/cancel', runs.cancelRun, { body: true }],
    ['POST', '/api/runs/:id/retry', runs.retryRun, { body: true }],
    ['POST', '/api/runs/:id/retry-step', runs.retryStep, { body: true }],
    ['GET', '/api/runs/:id/logs', runs.readRunLogs, {}],
    ['GET', '/api/runs/:id/events', runs.subscribeRunEvents, { stream: true }],

    // 服务器
    ['GET', '/api/servers', servers.listServers, {}],
    ['POST', '/api/servers', servers.createServer, { body: true }],
    ['POST', '/api/servers/:id/test', servers.testServer, { body: true }],
    ['POST', '/api/servers/:id/provision', servers.provisionServer, { body: true }],
    ['GET', '/api/servers/:id/env', servers.serverEnv, {}],
    ['GET', '/api/servers/:id', servers.getServer, {}],
    ['PUT', '/api/servers/:id', servers.updateServer, { body: true }],
    ['DELETE', '/api/servers/:id', servers.deleteServer, {}],

    // 资源库
    ['GET', '/api/envsets', resources.listEnvSets, {}],
    ['POST', '/api/envsets', resources.createEnvSet, { body: true }],
    ['PUT', '/api/envsets/:id', resources.updateEnvSet, { body: true }],
    ['DELETE', '/api/envsets/:id', resources.deleteEnvSet, {}],
    ['GET', '/api/snippets', resources.listSnippets, {}],
    ['POST', '/api/snippets', resources.createSnippet, { body: true }],
    ['PUT', '/api/snippets/:id', resources.updateSnippet, { body: true }],
    ['DELETE', '/api/snippets/:id', resources.deleteSnippet, {}],
    ['GET', '/api/recent', resources.listRecent, {}],
    ['POST', '/api/recent', resources.putRecent, { body: true }],
    ['DELETE', '/api/recent', resources.clearRecent, {}],

    // 节点库
    ['GET', '/api/nodes', nodesHandler.listNodes, {}],
    ['POST', '/api/nodes/custom', nodesHandler.registerCustomNode, { body: true }],
    ['DELETE', '/api/nodes/custom/:type', nodesHandler.deleteCustomNode, {}],
    ['GET', '/api/nodes/:type', nodesHandler.getNode, {}],

    // 文件系统代理
    ['GET', '/api/fs/list', fsx.fsList, {}],
    ['GET', '/api/fs/stat', fsx.fsStat, {}],
    ['POST', '/api/fs/match', fsx.fsMatch, { body: true }],

    // 导出 / 导入
    ['GET', '/api/export', transfer.exportDocument, {}],
    ['POST', '/api/import', transfer.importDocument, { body: true }],

    // 设置
    ['GET', '/api/settings', settings.getSettings, {}],
    ['PUT', '/api/settings', settings.putSettings, { body: true }],
  ]
}

/** GET /api/meta —— 前端启动时的能力自描述。 */
function meta(context) {
  const { nodes, executors, provisioner, engine, config, store, skills } = context
  let executorList = []
  try {
    executorList = typeof executors?.list === 'function' ? executors.list() : []
  } catch {
    executorList = []
  }
  return {
    name: 'dsh-devops',
    version: context.version ?? '',
    dataDir: store?.dataDir ?? config?.dataDir ?? '',
    scheduling: ['dag', 'staged'],
    settings: store?.settings?.get?.() ?? {},
    counts: {
      pipelines: store?.pipelines?.list?.().length ?? 0,
      templates: store?.templates?.list?.().length ?? 0,
      servers: store?.servers?.list?.().length ?? 0,
      envsets: store?.envsets?.list?.().length ?? 0,
      snippets: store?.snippets?.list?.().length ?? 0,
      runs: store?.runs?.list?.().length ?? 0,
      nodes: nodes?.list?.().length ?? 0,
    },
    activeRuns: typeof engine?.active === 'function' ? engine.active() : [],
    executors: executorList,
    provisioner: Boolean(provisioner),
    skills: skills ?? [],
    fieldTypes: nodes?.FIELD_TYPES ?? [],
    bodyLimitBytes: BODY_LIMIT_BYTES,
    allowLanAccess: context.allowLanAccess === true,
  }
}

/**
 * 创建 router。
 * @param {{store:object, engine?:object, logs?:object, nodes?:object, executors?:object,
 *          provisioner?:object, config?:object, sse?:object, log?:object,
 *          credentials?:(ref:string)=>Promise<string|undefined>, version?:string,
 *          allowLanAccess?:boolean|Function, skills?:string[]}} deps
 */
export function createRouter(deps = {}) {
  const warn = (message) => {
    if (deps.log && typeof deps.log.warn === 'function') deps.log.warn(message)
    else if (typeof deps.log === 'function') deps.log(message)
  }
  const routes = buildRoutes()

  /** allowLanAccess 支持布尔或函数（设置项可能在运行期被改）。 */
  function lanAllowed() {
    const value = deps.allowLanAccess
    if (typeof value === 'function') {
      try {
        return value() === true
      } catch {
        return false
      }
    }
    return value === true
  }

  function contextFor() {
    return {
      store: deps.store,
      engine: deps.engine,
      logs: deps.logs,
      nodes: deps.nodes,
      executors: deps.executors,
      provisioner: deps.provisioner,
      config: deps.config,
      sse: deps.sse,
      credentials: deps.credentials,
      skills: deps.skills,
      version: deps.version,
      allowLanAccess: lanAllowed(),
    }
  }

  /** 匹配路由：返回 {route, params} 或 null。 */
  function findRoute(method, pathname) {
    let methodMismatch = false
    for (const route of routes) {
      const [routeMethod, pattern, handler, options] = route
      const params = matchPath(pattern, pathname)
      if (params === null) continue
      if (routeMethod !== method) {
        methodMismatch = true
        continue
      }
      return { handler, options, params }
    }
    return methodMismatch ? 'method-not-allowed' : null
  }

  /** 处理一个请求。 */
  async function handle(req, res) {
    // 1) 来源校验：默认只允许本机；显式开启 allowLanAccess 才放行局域网
    if (denyNonLoopback(req, res, lanAllowed())) return

    let parsed
    try {
      parsed = parseRequestUrl(req)
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 400
      sendError(res, status, 'bad-request', error?.message ?? '请求路径非法')
      return
    }

    const pathname = parsed.pathname
    if (!pathname.startsWith(`${ROUTE_PREFIX}/api/`) && pathname !== `${ROUTE_PREFIX}/api`) {
      sendError(res, 404, 'not-found', `未知路径：${pathname}`)
      return
    }
    const relative = pathname.slice(ROUTE_PREFIX.length)

    const method = String(req.method || 'GET').toUpperCase()
    const found = findRoute(method, relative)
    if (found === null) {
      sendError(res, 404, 'not-found', `未知接口：${method} ${relative}`)
      return
    }
    if (found === 'method-not-allowed') {
      sendError(res, 405, 'method-not-allowed', `方法不允许：${method} ${relative}`)
      return
    }

    const { handler, options, params } = found

    try {
      let body
      if (options.body) {
        // 读体：空体按 {} 处理（DELETE/POST 无体时前端会发 {} 或空）
        try {
          body = await readJsonObject(req, BODY_LIMIT_BYTES)
        } catch (error) {
          if (error instanceof HttpError && error.status === 400 && /缺少请求体/.test(error.message)) {
            body = {}
          } else {
            throw error
          }
        }
      }

      const payload = { ...params, body, query: parsed.query, req, res }
      const value = await handler(contextFor(), payload)

      // 流式端点（SSE）自己写了响应，这里不能再写
      if (options.stream) return
      if (res.writableEnded || res.headersSent) return

      sendValue(res, value === undefined ? null : value)
    } catch (error) {
      if (res.writableEnded || res.headersSent) {
        // 响应已开始（例如 SSE 中途出错）：只能记录，不能再改状态码
        warn(`dsh-devops: 响应已开始后出错：${error?.message ?? error}`)
        try {
          res.end()
        } catch {
          /* 连接可能已断 */
        }
        return
      }
      if (error instanceof HttpError) {
        sendError(res, error.status, error.code, error.message, error.details)
        return
      }
      const message = error?.message ?? String(error)
      warn(`dsh-devops: ${method} ${relative} 处理失败：${message}`)
      sendError(res, 500, 'internal-error', message)
    }
  }

  return {
    handle,
    routes,
    /** 供测试/文档使用：列出已实现端点。 */
    describe() {
      return routes.map(([method, pattern]) => `${method} ${ROUTE_PREFIX}${pattern}`)
    },
  }
}

export default createRouter
