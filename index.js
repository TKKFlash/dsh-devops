/**
 * dsh-devops · 插件装配入口（契约 §3.12）
 *
 * 职责：
 *   1. 解析配置（dataDir 默认 <DSH_HOME>/data/dsh-devops）；
 *   2. 按序装配 store → logstore → nodeRegistry → provisioner → executors → engine；
 *   3. 注册 HTTP 前缀路由、Agent 工具、技能、斜杠命令。
 *
 * 纪律：
 *   * **不 import 任何 @deepseek-ai 包**（含 schemastery）：宿主服务一律经 ctx.get 惰性获取，
 *     缺失即降级并 warn，绝不让插件起不来。
 *   * **所有宿主注册都包在 ctx.effect() 内**，热重载/卸载时由宿主跑 disposer 摘除，
 *     否则同一进程再次 apply 会撞 duplicate route / duplicate tool。
 *   * ctx.inject 用于「服务就绪后再注册」的场景（宿主冷启动时服务可能尚未 ACTIVE）。
 */

import path from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { PLUGIN_NAME, CONFIG_FIELDS, resolveConfig, configToSettings, resolveDshHome } from './src/config.js'
import { createStore } from './src/store/store.js'
import { createLogStore } from './src/logs/logstore.js'
import { createNodeRegistry } from './src/engine/nodes/index.js'
import { createProvisioner } from './src/engine/provision/ensure.js'
import { createExecutorRegistry } from './src/engine/executors/index.js'
import { createEngine } from './src/engine/run.js'
import { setKnownNodes } from './src/model/schema.js'
import { createRouter, ROUTE_PREFIX } from './src/api/router.js'
import { createSseHub } from './src/api/sse.js'
import { registerTools, TOOL_NAMES } from './src/tools.js'
import { registerSkills } from './src/skills.js'
import { registerDevopsCommand } from './src/api/command.js'

export const name = PLUGIN_NAME

/**
 * webServer 是硬依赖（HTTP API 与 SSE 都要它）。
 * 其余服务（tools/skills/storageDomain/credentials/settings/commands）一律惰性获取 + 降级。
 */
export const inject = ['webServer']

/**
 * 插件版本：**从 package.json 读取**，不再手工维护常量。
 *
 * 此前这里硬编码 '0.1.0'，与 package.json 的 0.2.0 不同步，
 * 导致 /api/meta 对外自报旧版本——用户下载后看到「版本错乱」。
 * 单一事实源 = package.json；此处只做读取，不做第二份定义。
 */
function readPluginVersion() {
  // 首选 package.json：它是版本的单一事实源
  try {
    const pkgPath = fileURLToPath(new URL('./package.json', import.meta.url))
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    if (typeof pkg.version === 'string' && pkg.version.trim() !== '') return pkg.version.trim()
  } catch {
    /* 落到下面的回退 */
  }
  // 回退：某些打包/注入场景下 package.json 可能不在包内，
  // npm 会注入 npm_package_version，用它仍能得到正确版本
  const fromEnv = process.env.npm_package_version
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim()
  // 最后兜底：占位版本（宁可显示 0.0.0，也不要让插件起不来）
  return '0.0.0'
}

const VERSION = readPluginVersion()

/** 插件根目录（skills/ 与 client.js 所在处）。 */
export function pluginDir() {
  return fileURLToPath(new URL('.', import.meta.url))
}

/**
 * 配置 Schema。
 *
 * 宿主 cordis 用 Standard Schema（`["~standard"].validate`）校验插件配置；
 * 这里手写一个零依赖实现，避免引入 schemastery。它同时带上 `jsonSchema`，
 * 便于插件市场/设置页渲染表单。
 */
export const Config = {
  '~standard': {
    version: 1,
    vendor: 'dsh-devops',
    validate(value) {
      const input = value === null || value === undefined ? {} : value
      if (typeof input !== 'object' || Array.isArray(input)) {
        return { issues: [{ message: 'dsh-devops 配置必须是对象', path: [] }] }
      }
      const issues = []
      for (const [key, raw] of Object.entries(input)) {
        if (raw === undefined) continue
        const field = CONFIG_FIELDS.find((item) => item.name === key)
        if (!field) continue // 未知键放行（前向兼容），resolveConfig 也会原样保留
        if (field.type === 'number' && (typeof raw !== 'number' || !Number.isFinite(raw))) {
          issues.push({ message: `${key} 必须是数字`, path: [key] })
          continue
        }
        if (field.type === 'boolean' && typeof raw !== 'boolean') {
          issues.push({ message: `${key} 必须是布尔值`, path: [key] })
          continue
        }
        if (field.type === 'enum' && Array.isArray(field.options) && !field.options.includes(raw)) {
          issues.push({ message: `${key} 只能是 ${field.options.join('|')}`, path: [key] })
          continue
        }
        if ((field.type === 'path.dir' || field.type === 'server') && typeof raw !== 'string') {
          issues.push({ message: `${key} 必须是字符串`, path: [key] })
        }
      }
      if (issues.length > 0) return { issues }
      // 交给 resolveConfig 补默认值 + 数值收敛，插件内部只面对完整配置
      return { value: resolveConfig(input) }
    },
  },
  /** 供插件市场/设置页渲染的 JSON Schema（非宿主校验路径）。 */
  jsonSchema: {
    type: 'object',
    properties: Object.fromEntries(
      CONFIG_FIELDS.map((field) => [
        field.name,
        {
          type: field.type === 'number' ? 'number' : field.type === 'boolean' ? 'boolean' : 'string',
          default: field.default,
          description: field.description,
          ...(field.options ? { enum: field.options } : {}),
        },
      ]),
    ),
    additionalProperties: true,
  },
}

/** 统一日志：优先 ctx.logger，退回 console。 */
function makeLog(ctx) {
  const logger = ctx?.logger
  return {
    info(message) {
      try {
        if (typeof logger?.info === 'function') logger.info(message)
        else console.log(`[dsh-devops] ${message}`)
      } catch {
        /* 日志失败不影响主流程 */
      }
    },
    warn(message) {
      try {
        if (typeof logger?.warn === 'function') logger.warn(message)
        else console.warn(`[dsh-devops] ${message}`)
      } catch {
        /* 同上 */
      }
    },
    error(message) {
      try {
        if (typeof logger?.error === 'function') logger.error(message)
        else console.error(`[dsh-devops] ${message}`)
      } catch {
        /* 同上 */
      }
    },
  }
}

/** 惰性取宿主服务（缺失/抛错都返回 null）。 */
function safeGet(ctx, key) {
  try {
    if (typeof ctx.get === 'function') return ctx.get(key) ?? null
  } catch {
    return null
  }
  return null
}

/**
 * 装配插件。
 * @param {object} ctx cordis 插件上下文
 * @param {object} rawConfig 宿主传入的配置
 */
export function apply(ctx, rawConfig = {}) {
  const log = makeLog(ctx)
  const config = resolveConfig(rawConfig)
  const root = pluginDir()

  log.info(`dsh-devops 正在装配（dataDir=${config.dataDir}）`)

  // 装配是异步的（store 是异步工厂），但 apply 本身保持同步返回：
  // 通过 ctx.effect 串住生命周期，装配失败时由内部捕获并如实上报。
  const ready = bootstrap()
  return ready

  async function bootstrap() {
    /** 已建立的资源，供 effect disposer 统一释放。 */
    const disposers = []
    const store = await createStore({
      dataDir: config.dataDir,
      log: (message) => log.warn(message),
      ctx,
      storageDomain: safeGet(ctx, 'storageDomain'),
    })
    disposers.push(() => store.close?.())

    const settings = store.settings.get()
    const logs = createLogStore({
      dataDir: config.dataDir,
      ringBytes: settings.logRingBytes ?? config.logRingBytes,
      mask: [],
    })
    disposers.push(() => logs.close?.())

    const nodes = createNodeRegistry({ ctx, log, store, config: { ...config, ...settings } })
    const provisioner = createProvisioner({
      ctx,
      log,
      store,
      config,
      getServer: async (id) => (id === 'local' ? { id: 'local', name: '本机', kind: 'local', host: '127.0.0.1' } : store.servers.get(id)),
    })
    const executors = createExecutorRegistry({ ctx, log, provisioner, config })

    // SSE 集线器：engine 的事件经它广播给所有订阅者
    const sse = createSseHub({ log })

    const engine = createEngine({
      store,
      logs,
      nodes,
      executors,
      provisioner,
      config: { ...config, ...settings },
      onEvent: (event) => {
        try {
          sse.publish(event)
        } catch (error) {
          log.warn(`dsh-devops: SSE 广播失败：${error?.message ?? error}`)
        }
      },
    })
    disposers.push(() => engine.dispose?.())

    // 自定义节点：只有 allowCustomNodeCode 打开时才真正加载
    let customNodes = { loaded: [], failed: [], skipped: true, reason: '' }
    try {
      customNodes = await nodes.loadCustom(path.join(config.dataDir, 'nodes'))
      if (customNodes.failed?.length) {
        for (const item of customNodes.failed) log.warn(`dsh-devops: 自定义节点加载失败 ${item.file}：${item.error}`)
      }
    } catch (error) {
      log.warn(`dsh-devops: 加载自定义节点失败：${error?.message ?? error}`)
    }

    // 让 schema 校验认识当前全部节点（含自定义），否则自定义节点会被判 unknown-node
    try {
      setKnownNodes(nodes.list().map((descriptor) => descriptor.type))
    } catch (error) {
      log.warn(`dsh-devops: 注入已知节点失败：${error?.message ?? error}`)
    }

    // 首次启动时把插件配置投影进 settings（仅补缺，不覆盖用户已改的值）
    try {
      const projected = configToSettings(config)
      const current = store.settings.get()
      const patch = {}
      for (const [key, value] of Object.entries(projected)) {
        // allowLanAccess 是插件配置项、不是 settings 项，这里只投影 settings 已有的键
        if (key in current && current[key] === undefined) patch[key] = value
      }
      if (Object.keys(patch).length > 0) await store.settings.set({ ...current, ...patch })
    } catch (error) {
      log.warn(`dsh-devops: 投影默认设置失败：${error?.message ?? error}`)
    }

    // 周期性清理过期日志（保留天数来自设置）
    const retentionDays = store.settings.get().logRetentionDays ?? config.logRetentionDays
    if (retentionDays > 0) {
      logs.cleanup(retentionDays).catch((error) => {
        log.warn(`dsh-devops: 清理历史日志失败：${error?.message ?? error}`)
      })
    }

    /** 仅 loopback 的判定：allowLanAccess 可在设置里热改，故每次读实时值。 */
    const lanAllowed = () => config.allowLanAccess === true

    const credentialsResolve = async (ref) => {
      const credentials = safeGet(ctx, 'credentials')
      if (!credentials || typeof credentials.resolve !== 'function') return undefined
      const resolved = await credentials.resolve(ref)
      if (typeof resolved === 'string') return resolved
      if (resolved && typeof resolved.value === 'string') return resolved.value
      return undefined
    }

    const router = createRouter({
      store,
      engine,
      logs,
      nodes,
      executors,
      provisioner,
      config: { ...config, ...store.settings.get() },
      sse,
      log,
      credentials: credentialsResolve,
      version: VERSION,
      allowLanAccess: lanAllowed,
    })

    // ---- 唯一的 webServer 注册点（契约 §3.10）----
    registerRoute(ctx, router, log, disposers)

    // ---- Agent 工具（宿主强制 output.schema + output.render）----
    const toolsHandle = registerTools({
      ctx,
      store,
      engine,
      logs,
      nodes,
      executors,
      provisioner,
      config: { ...config, ...store.settings.get() },
      credentials: credentialsResolve,
      log,
    })
    disposers.push(() => toolsHandle.dispose?.())

    // ---- 技能：skills/<name>/SKILL.md ----
    let skillResult = { registered: [], skipped: [] }
    try {
      skillResult = await registerSkills({ ctx, pluginDir: root, log })
    } catch (error) {
      log.warn(`dsh-devops: 技能注册失败：${error?.message ?? error}`)
    }

    // ---- 斜杠命令 /devops ----
    const commandHandle = registerDevopsCommand({
      ctx,
      store,
      engine,
      logs,
      config: { ...config, ...store.settings.get() },
      log,
    })
    disposers.push(() => commandHandle.dispose?.())

    log.info(
      `dsh-devops 就绪：节点 ${nodes.size} 个，工具 ${toolsHandle.names.length}/${TOOL_NAMES.length} 个，`
      + `技能 ${skillResult.registered.length} 个，dataDir=${config.dataDir}`,
    )

    // 整个插件的生命周期兜在 effect 里：卸载/热重载时按序释放
    ctx.effect?.(() => () => {
      for (const dispose of disposers.reverse()) {
        try {
          Promise.resolve(dispose()).catch((error) => log.warn(`dsh-devops: 释放资源失败：${error?.message ?? error}`))
        } catch (error) {
          log.warn(`dsh-devops: 释放资源失败：${error?.message ?? error}`)
        }
      }
      sse.closeAll()
    }, 'dsh-devops lifecycle')

    return {
      store,
      logs,
      nodes,
      provisioner,
      executors,
      engine,
      sse,
      router,
      tools: toolsHandle.names,
      skills: skillResult.registered,
      config,
    }
  }
}

/**
 * 注册 HTTP 前缀路由。
 * 必须包在 ctx.effect 内：热重载时由宿主跑 disposer 摘掉路由，
 * 否则同一进程再次 apply 会撞 duplicate route。
 */
function registerRoute(ctx, router, log, disposers) {
  const webServer = safeGet(ctx, 'webServer') ?? ctx?.webServer
  if (!webServer || typeof webServer.register !== 'function') {
    log.warn('dsh-devops: webServer 服务不可用，HTTP API 未注册（工具与引擎仍可用）')
    return
  }
  const register = () =>
    webServer.register({
      kind: 'prefix',
      path: ROUTE_PREFIX,
      handler: (req, res) => {
        // router.handle 内部已 try/catch 并保证一定结束响应；
        // 这里再兜一层，避免未捕获的 rejection 冒到宿主
        Promise.resolve(router.handle(req, res)).catch((error) => {
          log.error(`dsh-devops: 请求处理异常：${error?.stack ?? error}`)
          try {
            if (!res.headersSent) {
              res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
            }
            if (!res.writableEnded) {
              res.end(JSON.stringify({ ok: false, message: '内部错误', code: 'internal-error' }))
            }
          } catch {
            /* 响应已经不可写 */
          }
        })
      },
    })

  try {
    ctx.effect(() => register(), 'dsh-devops http route')
  } catch (error) {
    // effect 缺席（老宿主）：直接注册，至少 API 可用
    log.warn(`dsh-devops: ctx.effect 不可用，直接注册路由：${error?.message ?? error}`)
    const disposer = register()
    if (typeof disposer === 'function') disposers.push(disposer)
  }
}

/** 便于测试/自检：默认数据目录。 */
export function defaultDataDir(env = process.env) {
  return path.join(resolveDshHome(env), 'data', PLUGIN_NAME)
}

export default { name, inject, Config, apply, pluginDir, defaultDataDir }
