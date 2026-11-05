/**
 * dsh-devops · Agent 工具注册（契约 §3.12）
 *
 * 10 个工具：
 *   devops_list_pipelines  devops_create_pipeline  devops_update_pipeline
 *   devops_validate_pipeline  devops_run  devops_status  devops_logs
 *   devops_cancel  devops_servers  devops_provision
 *
 * 实现纪律：
 *   * **不 import 任何 @deepseek-ai 包**（含 defineTool）：工具就是普通对象，经
 *     `ctx.tools.register` 注册。宿主的 register 只强制两件事——`output.render` 是函数、
 *     `output.schema` 落在其受限 JSON Schema 子集内——所以这里的 schema 手写为该子集：
 *       - 允许的键：type / oneOf / properties / required / additionalProperties /
 *         items / enum / const + 注释键（description/title/default/examples）
 *       - 允许的 type：object/array/string/number/integer/boolean/null
 *       - **没有 `type:'json'`**（那只是 defineTool 的 author-facing 写法，raw 注册会被拒）；
 *         「任意 JSON」用「无 type、仅 description」的注解型 schema 表达。
 *     注意 object 类型若要写 additionalProperties，必须是显式布尔值。
 *   * raw 注册**不做参数校验**（defineTool 才在 execute 外包裹校验），因此每个 execute
 *     都自行做防御性取值，参数不合法时返回 `{ok:false,message}` 而不是抛异常。
 *   * execute 直接访问插件 store（官方形态），不经 HTTP 自调。
 *   * 只读类工具（list/status/logs/servers/validate）声明 `isConcurrencySafe` 精确返回 true
 *     以允许并行；写入类（create/update/run/cancel/provision）保持独占（默认）。
 *   * 日志与错误文案一律先打码再回给模型（密钥绝不外泄）。
 */

import { validatePipeline, normalizePipeline, newId, detectScheduling } from './model/schema.js'
import { resolveEnvAsync, maskSecrets } from './model/variables.js'

/* ------------------------------------------------------------ schema 助手 */

/** 注解型（无约束）schema：宿主子集下表示「任意 JSON」，也用于 output。 */
const anyJson = (description) => ({ description })
const str = (description) => ({ type: 'string', description })
const int = (description) => ({ type: 'integer', description })
const bool = (description) => ({ type: 'boolean', description })

/** 输出 schema：接受任意 JSON 结果（含 message 字段，便于直接展示）。 */
const OUTPUT_SCHEMA = anyJson('工具结果对象（含 message 字段，可直接展示给用户）')

/** 参数对象 schema（raw JSON Schema，object 根）。 */
function params(properties) {
  return { type: 'object', properties, additionalProperties: false }
}

/** 输出渲染：把结果里的 message 作为正文，缺失时退回 JSON 摘要。 */
const messageRender = (_args, value) => {
  const text = value && typeof value.message === 'string' && value.message !== ''
    ? value.message
    : jsonText(value)
  return [{ type: 'text', text }]
}

/** 安全 JSON 字符串化（截断超长内容，避免把大对象灌进上下文）。 */
function jsonText(value, limit = 12000) {
  let text
  try {
    text = JSON.stringify(value, null, 2)
  } catch {
    text = String(value)
  }
  if (typeof text !== 'string') text = String(text)
  if (text.length > limit) text = `${text.slice(0, limit)}\n…（已截断，共 ${text.length} 字符）`
  return text
}

/* --------------------------------------------------------------- 公共助手 */

/** 格式化验校错误列表。 */
function formatErrors(errors) {
  const list = Array.isArray(errors) ? errors : []
  if (list.length === 0) return '（无详情）'
  return list.map((error) => `- ${error.path || '(根)'} [${error.code}] ${error.message}`).join('\n')
}

/** 把可能的密钥泄露压掉。 */
function safeText(error) {
  const text = String(error?.message ?? error ?? '')
  if (/passphrase|password|private key|PRIVATE KEY/i.test(text)) {
    return '认证或密钥不可用（请检查凭据引用是否已在本机配置）'
  }
  return text
}

/** 由某步骤推断失败归因，给模型可操作的建议。 */
function hintFor(step) {
  const text = `${step.error ?? ''} ${step.detail ?? ''}`
  if (/command not found|not recognized|No such file/i.test(text)) {
    return `${step.id}：命令不存在——请确认目标服务器已安装该工具，或用 devops_provision 准备运行时。`
  }
  if (/permission denied|EACCES/i.test(text)) {
    return `${step.id}：权限不足——检查远端用户权限或工作目录属主。`
  }
  if (/timed out|timeout/i.test(text)) {
    return `${step.id}：超时——可提高该步骤的 timeoutMs，或检查网络与远端负载。`
  }
  if (/authentication|publickey|auth fail/i.test(text)) {
    return `${step.id}：认证失败——检查服务器凭据引用是否指向本机已配置的密钥。`
  }
  if (typeof step.exitCode === 'number' && step.exitCode !== 0) {
    return `${step.id}：退出码 ${step.exitCode}——查看该步骤日志定位具体命令。`
  }
  return `${step.id}：查看该步骤日志以定位原因。`
}

/**
 * 注册全部工具。
 *
 * @param {{ctx:object, store:object, engine?:object, logs?:object, nodes?:object,
 *          executors?:object, provisioner?:object, config?:object, credentials?:Function,
 *          log?:object}} deps
 * @returns {{names:string[], dispose:()=>void}}
 *   names 为已注册工具名（ctx.inject 异步路径下会随后补齐）；
 *   dispose 供 index.js 的 ctx.effect 做热重载摘除。
 */
export function registerTools(deps = {}) {
  const { ctx } = deps
  const names = []
  const disposers = []
  let disposed = false

  const warn = (message) => {
    if (deps.log && typeof deps.log.warn === 'function') deps.log.warn(message)
    else if (ctx?.logger?.warn) ctx.logger.warn(message)
  }

  const dispose = () => {
    disposed = true
    for (const disposer of disposers.splice(0)) {
      try {
        if (typeof disposer === 'function') disposer()
      } catch {
        /* 摘除失败不影响其它工具 */
      }
    }
  }

  if (!ctx || typeof ctx.get !== 'function') {
    warn('dsh-devops: 缺少 ctx，跳过工具注册')
    return { names, dispose }
  }

  /** 真正注册（tools 服务就绪后调用；可能被 inject 回调延后触发）。 */
  const install = (service) => {
    if (disposed) return
    if (!service || typeof service.register !== 'function') {
      warn('dsh-devops: tools 服务不可用，工具未注册')
      return
    }
    for (const definition of definitions(deps)) {
      try {
        const disposer = service.register(definition)
        disposers.push(disposer)
        if (!names.includes(definition.name)) names.push(definition.name)
      } catch (error) {
        const message = String(error?.message ?? error)
        // duplicate 说明同一工具已注册过（热重载重复 apply），不算失败
        if (/duplicate/i.test(message)) {
          if (!names.includes(definition.name)) names.push(definition.name)
        } else {
          warn(`dsh-devops: 工具 ${definition.name} 注册失败：${message}`)
        }
      }
    }
  }

  const tools = safeGet(ctx, 'tools')
  if (tools && typeof tools.register === 'function') {
    install(tools)
    return { names, dispose }
  }

  // 冷启动兜底：宿主 0.2.x 里 apply 同步阶段 ctx.tools 可能尚未对 agent 平面生效，
  // 同步 register 会静默无效（dsh-meme issue #51）。官方姿势是 inject 等依赖就绪。
  if (typeof ctx.inject === 'function') {
    try {
      ctx.inject(['tools'], (injected) => {
        install(injected?.tools ?? safeGet(ctx, 'tools'))
      })
      return { names, dispose }
    } catch (error) {
      warn(`dsh-devops: 等待 tools 服务失败：${safeText(error)}`)
    }
  }
  warn('dsh-devops: 宿主未提供 tools 服务，工具未注册')
  return { names, dispose }
}

function safeGet(ctx, name) {
  try {
    return ctx.get(name)
  } catch {
    return null
  }
}

/* ------------------------------------------------------------ 工具定义 */

/**
 * 组装 10 个工具定义。deps 通过闭包注入，避免任何模块级可变状态。
 */
function definitions(deps) {
  const { store, engine, logs, nodes, executors, provisioner, config, credentials } = deps

  /** 已知节点类型（让 schema 校验认识自定义节点）。 */
  const knownNodesOption = () => {
    if (!nodes || typeof nodes.list !== 'function') return {}
    const types = nodes.list().map((entry) => entry?.type).filter((type) => typeof type === 'string' && type !== '')
    return types.length > 0 ? { knownNodes: types } : {}
  }

  /** 取服务器：local 为内置，无需登记。 */
  const mustGetServer = (id) => {
    if (!id || id === 'local') return { id: 'local', name: '本机', kind: 'local', host: '127.0.0.1' }
    const server = store.servers.get(id)
    if (!server) throw new Error(`服务器不存在：${id}（可用 devops_servers 查看）`)
    return server
  }

  /** 收集本次运行涉及的 secret 值，用于日志打码。 */
  const collectMasked = async (run) => {
    try {
      const pipeline = store.pipelines.get(run.pipelineId)
      const serverIds = [...new Set(Object.values(run.steps ?? {}).map((step) => step.server).filter(Boolean))]
      const servers = serverIds.map((id) => mustGetServer(id))
      const envSets = []
      for (const server of servers) {
        for (const ref of server.envSetRefs ?? []) {
          const set = store.envsets.get(ref)
          if (set) envSets.push(set)
        }
      }
      const result = await resolveEnvAsync({
        processEnv: {},
        server: servers[0],
        servers,
        envSets,
        pipeline: pipeline ?? {},
        credentials,
      })
      return result.masked ?? []
    } catch {
      // 取不到就打不了码：绝不因此中断日志读取，但会少一层兜底
      return []
    }
  }

  return [
    /* ------------------------------------------------------------ 只读 */
    {
      name: 'devops_list_pipelines',
      description: '列出所有 DevOps 流水线（id、名称、分类、标签、阶段/步骤数与调度模式）。'
        + '运行或修改某条流水线前先用它拿到准确的 pipelineId。',
      parameters: params({
        keyword: str('可选。按名称/描述/标签模糊过滤'),
        category: str('可选。按分类精确过滤'),
        favoriteOnly: bool('可选。只看收藏的流水线'),
      }),
      output: { schema: OUTPUT_SCHEMA, render: messageRender },
      isConcurrencySafe: () => true,
      async execute(args = {}) {
        const keyword = typeof args.keyword === 'string' ? args.keyword.trim().toLowerCase() : ''
        const category = typeof args.category === 'string' ? args.category.trim() : ''
        let items = store.pipelines.list()
        if (category) items = items.filter((item) => item.category === category)
        if (args.favoriteOnly === true) items = items.filter((item) => item.favorite === true)
        if (keyword) {
          items = items.filter((item) => [item.id, item.name, item.description, ...(item.tags ?? [])]
            .filter((part) => typeof part === 'string')
            .join(' ')
            .toLowerCase()
            .includes(keyword))
        }
        const list = items
          .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || String(a.id).localeCompare(String(b.id)))
          .map((item) => ({
            id: String(item.id),
            name: String(item.name ?? ''),
            description: String(item.description ?? ''),
            category: String(item.category ?? ''),
            tags: (item.tags ?? []).filter((tag) => typeof tag === 'string'),
            favorite: item.favorite === true,
            stageCount: Array.isArray(item.stages) ? item.stages.length : 0,
            jobCount: (item.stages ?? []).reduce((sum, stage) => sum + ((stage.jobs ?? []).length), 0),
            scheduling: detectScheduling(item),
            updatedAt: Number(item.updatedAt ?? 0),
          }))
        const lines = list.length === 0
          ? ['（暂无流水线）']
          : list.map((item) => `- ${item.id}｜${item.name}${item.category ? `［${item.category}］` : ''}｜${item.jobCount} 步｜${item.scheduling === 'dag' ? 'DAG' : '分阶段'}`)
        return { count: list.length, pipelines: list, message: `共 ${list.length} 条流水线：\n${lines.join('\n')}` }
      },
    },

    /* ------------------------------------------------------------ 写入 */
    {
      name: 'devops_create_pipeline',
      description: '新建一条 DevOps 流水线。pipeline 需是契约形状的对象（id/name/stages，见 docs/CONTRACT.md §2.1）。'
        + '保存前会做完整校验（必填、id 规则、未知节点、环检测、needs 与 parallel 不得混用）。',
      parameters: params({
        pipeline: anyJson('流水线对象（必填）。id 需匹配 [a-z0-9][a-z0-9-_]{0,63}'),
      }),
      output: { schema: OUTPUT_SCHEMA, render: messageRender },
      async execute(args = {}) {
        const raw = args.pipeline
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          return { ok: false, message: 'pipeline 必须是一个对象' }
        }
        const normalized = normalizePipeline(raw)
        if (!normalized.id) normalized.id = newId('pipeline')
        const check = validatePipeline(normalized, knownNodesOption())
        if (!check.ok) {
          return { ok: false, message: `流水线校验未通过：\n${formatErrors(check.errors)}`, errors: check.errors }
        }
        if (store.pipelines.get(normalized.id)) {
          return { ok: false, message: `流水线 id 已存在：${normalized.id}（要修改请用 devops_update_pipeline）` }
        }
        const now = Date.now()
        const value = { ...normalized, createdAt: now, updatedAt: now }
        await store.pipelines.put(value.id, value)
        return {
          ok: true,
          id: value.id,
          scheduling: detectScheduling(value),
          message: `已创建流水线 ${value.id}（${value.name}），共 ${(value.stages ?? []).length} 个阶段。`,
        }
      },
    },

    {
      name: 'devops_update_pipeline',
      description: '更新已有流水线（整体替换其定义）。先用 devops_list_pipelines 拿到 id；'
        + '局部修改时请先按 id 读取原文再改，避免覆盖丢失字段（本工具是整体替换语义）。',
      parameters: params({
        id: str('流水线 id（必填）'),
        pipeline: anyJson('新的流水线对象（必填）。其 id 会被强制为参数 id'),
      }),
      output: { schema: OUTPUT_SCHEMA, render: messageRender },
      async execute(args = {}) {
        const id = typeof args.id === 'string' ? args.id.trim() : ''
        if (!id) return { ok: false, message: '缺少 id' }
        const existing = store.pipelines.get(id)
        if (!existing) return { ok: false, message: `流水线不存在：${id}` }
        const raw = args.pipeline
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          return { ok: false, message: 'pipeline 必须是一个对象' }
        }
        const normalized = normalizePipeline({ ...raw, id })
        const check = validatePipeline(normalized, knownNodesOption())
        if (!check.ok) {
          return { ok: false, message: `流水线校验未通过：\n${formatErrors(check.errors)}`, errors: check.errors }
        }
        const value = { ...normalized, id, createdAt: existing.createdAt ?? Date.now(), updatedAt: Date.now() }
        await store.pipelines.put(id, value)
        return { ok: true, id, message: `已更新流水线 ${id}（${value.name}）。` }
      },
    },

    /* ------------------------------------------------------------ 只读 */
    {
      name: 'devops_validate_pipeline',
      description: '校验一条流水线定义但**不保存**：返回逐条错误（点路径 + 错误码）与调度模式。'
        + '适合在创建/落盘前自查，避免保存后才发现问题。',
      parameters: params({
        pipeline: anyJson('待校验的流水线对象（与 pipelineId 二选一）'),
        pipelineId: str('可选。改为校验库中已有的流水线'),
      }),
      output: { schema: OUTPUT_SCHEMA, render: messageRender },
      isConcurrencySafe: () => true,
      async execute(args = {}) {
        let candidate = args.pipeline
        if (!candidate && typeof args.pipelineId === 'string' && args.pipelineId.trim() !== '') {
          const existing = store.pipelines.get(args.pipelineId.trim())
          if (!existing) return { ok: false, message: `流水线不存在：${args.pipelineId}` }
          candidate = existing
        }
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
          return { ok: false, message: '需要提供 pipeline 对象或 pipelineId' }
        }
        const normalized = normalizePipeline({ ...candidate, id: candidate.id || newId('draft') })
        const check = validatePipeline(normalized, knownNodesOption())
        const nodeTypes = typeof nodes?.list === 'function'
          ? nodes.list().map((entry) => String(entry?.type ?? '')).filter(Boolean)
          : []
        const scheduling = detectScheduling(normalized)
        return check.ok
          ? {
              ok: true,
              scheduling,
              availableNodes: nodeTypes,
              message: `校验通过。调度模式：${scheduling === 'dag' ? 'DAG（按 needs 依赖）' : '分阶段（阶段串行）'}；`
                + `当前可用节点 ${nodeTypes.length} 个。`,
            }
          : {
              ok: false,
              errors: check.errors,
              message: `校验未通过，共 ${(check.errors ?? []).length} 处问题：\n${formatErrors(check.errors)}`,
            }
      },
    },

    {
      name: 'devops_run',
      description: '触发一次流水线运行，**立即返回 runId**（默认不等待结果，避免长时间占用）。'
        + '拿到 runId 后用 devops_status 查进度、devops_logs 看输出。',
      parameters: params({
        pipelineId: str('要运行的流水线 id（必填）'),
        variables: anyJson('可选。运行期变量覆盖，如 {"ENV":"prod"}'),
      }),
      output: { schema: OUTPUT_SCHEMA, render: messageRender },
      async execute(args = {}) {
        const pipelineId = typeof args.pipelineId === 'string' ? args.pipelineId.trim() : ''
        if (!pipelineId) return { ok: false, message: '缺少 pipelineId' }
        if (!engine || typeof engine.start !== 'function') {
          return { ok: false, message: '执行引擎不可用，无法运行' }
        }
        const pipeline = store.pipelines.get(pipelineId)
        if (!pipeline) return { ok: false, message: `流水线不存在：${pipelineId}` }
        const variables = args.variables && typeof args.variables === 'object' && !Array.isArray(args.variables)
          ? args.variables
          : {}
        let handle
        try {
          handle = engine.start({ pipeline, variables, trigger: 'ai' })
        } catch (error) {
          return { ok: false, message: `启动失败：${safeText(error)}` }
        }
        const runId = String(handle.runId)
        const stepTotal = Object.keys(handle.run?.steps ?? {}).length
        return {
          ok: true,
          runId,
          pipelineId,
          status: String(handle.run?.status ?? 'queued'),
          stepTotal,
          message: `已启动运行 ${runId}（${pipeline.name}），共 ${stepTotal} 个步骤。`
            + '用 devops_status 查询进度，devops_logs 查看输出。',
        }
      },
    },

    /* ------------------------------------------------------------ 只读 */
    {
      name: 'devops_status',
      description: '查询运行状态：不传 runId 时列出最近的运行；传 runId 时返回该运行的状态与逐步明细'
        + '（可选附带各步骤日志尾部）。这是「现在跑到哪了」的首选工具。',
      parameters: params({
        runId: str('可选。运行 id；不传则返回最近运行列表'),
        limit: int('可选。列表模式下返回条数（默认 10，上限 100）'),
        includeLogs: bool('可选。为 true 时附带各步骤的日志尾部'),
        logLines: int('可选。每个步骤取多少行日志（默认 20，上限 200）'),
      }),
      output: { schema: OUTPUT_SCHEMA, render: messageRender },
      isConcurrencySafe: () => true,
      async execute(args = {}) {
        const runId = typeof args.runId === 'string' ? args.runId.trim() : ''

        if (!runId) {
          const limit = Number.isInteger(args.limit) && args.limit > 0 ? Math.min(args.limit, 100) : 10
          const activeIds = new Set(typeof engine?.active === 'function' ? engine.active() : [])
          const items = store.runs.list()
            .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
            .slice(0, limit)
            .map((run) => {
              const steps = Object.values(run.steps ?? {})
              return {
                id: String(run.id),
                pipelineId: String(run.pipelineId ?? ''),
                pipelineName: String(run.pipelineName ?? ''),
                status: String(run.status ?? ''),
                active: activeIds.has(run.id),
                startedAt: Number(run.startedAt ?? 0),
                finishedAt: Number(run.finishedAt ?? 0),
                successSteps: steps.filter((step) => step.status === 'success').length,
                failedSteps: steps.filter((step) => step.status === 'failed').map((step) => String(step.id)),
                stepTotal: steps.length,
              }
            })
          const lines = items.length === 0
            ? ['（暂无运行记录）']
            : items.map((item) => `- ${item.id}｜${item.pipelineName}｜${item.status}${item.active ? '（进行中）' : ''}`
              + `｜${item.successSteps}/${item.stepTotal} 成功${item.failedSteps.length ? `｜失败：${item.failedSteps.join(',')}` : ''}`)
          return { count: items.length, runs: items, message: `最近 ${items.length} 次运行：\n${lines.join('\n')}` }
        }

        const live = typeof engine?.status === 'function' ? engine.status(runId) : null
        const run = live?.run ?? store.runs.get(runId)
        if (!run) return { ok: false, message: `运行不存在：${runId}` }

        const steps = Object.values(run.steps ?? {}).map((step) => ({
          id: String(step.id),
          name: String(step.name ?? ''),
          stage: String(step.stage ?? ''),
          node: String(step.node ?? ''),
          server: String(step.server ?? ''),
          status: String(step.status ?? ''),
          phase: String(step.phase ?? ''),
          attempt: Number(step.attempt ?? 1),
          exitCode: typeof step.exitCode === 'number' ? step.exitCode : null,
          startedAt: Number(step.startedAt ?? 0),
          finishedAt: Number(step.finishedAt ?? 0),
          durationMs: step.startedAt ? (step.finishedAt || Date.now()) - step.startedAt : 0,
          error: String(step.error ?? ''),
          detail: String(step.detail ?? ''),
        }))

        let logsByStep = null
        if (args.includeLogs === true && logs && typeof logs.read === 'function') {
          const tailLines = Number.isInteger(args.logLines) && args.logLines > 0 ? Math.min(args.logLines, 200) : 20
          const masked = await collectMasked(run)
          logsByStep = {}
          for (const step of steps) {
            try {
              const result = logs.read({ runId, stepId: step.id, from: 0 })
              logsByStep[step.id] = (result.lines ?? [])
                .slice(-tailLines)
                .map((line) => maskSecrets(String(line.text ?? ''), masked))
            } catch {
              logsByStep[step.id] = []
            }
          }
        }

        const failed = steps.filter((step) => step.status === 'failed')
        const successCount = steps.filter((step) => step.status === 'success').length
        const progress = steps.length === 0 ? '无步骤' : `${successCount}/${steps.length} 成功`
        return {
          ok: true,
          runId: String(run.id),
          pipelineId: String(run.pipelineId ?? ''),
          status: String(run.status ?? ''),
          active: live?.active === true,
          startedAt: Number(run.startedAt ?? 0),
          finishedAt: Number(run.finishedAt ?? 0),
          durationMs: run.startedAt ? (run.finishedAt || Date.now()) - run.startedAt : 0,
          steps,
          logs: logsByStep,
          message: `运行 ${run.id}（${run.pipelineName}）：${run.status}，${progress}。`
            + (failed.length
              ? `失败步骤：${failed.map((step) => `${step.id}（${step.error || `退出码 ${step.exitCode}`}）`).join('；')}`
              : ''),
        }
      },
    },

    {
      name: 'devops_logs',
      description: '读取某次运行（可选只看某个步骤）的日志。返回已打码的文本；失败步骤会附带归因提示。',
      parameters: params({
        runId: str('运行 id（必填）'),
        stepId: str('可选。只看某个步骤；不传则合并全部步骤（按时间序）'),
        from: int('可选。从该序号之后开始读（用于续读）'),
        lines: int('可选。最多返回多少行（默认 200，上限 5000）'),
      }),
      output: { schema: OUTPUT_SCHEMA, render: messageRender },
      isConcurrencySafe: () => true,
      async execute(args = {}) {
        const runId = typeof args.runId === 'string' ? args.runId.trim() : ''
        if (!runId) return { ok: false, message: '缺少 runId' }
        const run = store.runs.get(runId)
        if (!run) return { ok: false, message: `运行不存在：${runId}` }
        if (!logs || typeof logs.read !== 'function') return { ok: false, message: '日志存储不可用' }

        const from = Number.isInteger(args.from) && args.from > 0 ? args.from : 0
        const maxLines = Number.isInteger(args.lines) && args.lines > 0 ? Math.min(args.lines, 5000) : 200
        const stepId = typeof args.stepId === 'string' ? args.stepId.trim() : ''
        const stepIds = Object.keys(run.steps ?? {})

        if (stepId && !run.steps?.[stepId]) {
          return { ok: false, message: `步骤不存在：${stepId}（可用步骤：${stepIds.join(', ') || '无'}）` }
        }

        const masked = await collectMasked(run)
        let raw = []
        let next = from
        let lossy = false
        try {
          const result = stepId
            ? logs.read({ runId, stepId, from })
            : (typeof logs.readRun === 'function'
                ? logs.readRun(runId, from)
                : logs.read({ runId, stepId: stepIds[0] ?? '', from }))
          raw = result.lines ?? []
          next = Number(result.next ?? from)
          lossy = result.lossy === true
        } catch (error) {
          return { ok: false, message: `读取日志失败：${safeText(error)}` }
        }

        const all = raw.map((line) => ({
          seq: Number(line.seq ?? 0),
          ts: Number(line.ts ?? 0),
          stream: String(line.stream ?? 'stdout'),
          text: maskSecrets(String(line.text ?? ''), masked),
        }))
        const truncated = all.length > maxLines
        const shown = truncated ? all.slice(-maxLines) : all
        const text = shown.map((line) => `[${line.seq}] ${line.text}`).join('\n') || '（无输出）'

        const failed = Object.values(run.steps ?? {}).filter((step) => step.status === 'failed')
        const hints = failed.map((step) => hintFor(step)).filter(Boolean)
        return {
          ok: true,
          runId,
          stepId: stepId || null,
          from,
          next,
          lossy,
          count: shown.length,
          truncated,
          lines: shown,
          hints,
          message: text,
        }
      },
    },

    {
      name: 'devops_cancel',
      description: '取消一次正在运行的流水线。已经结束的运行会如实返回「未取消」而不是报错。',
      parameters: params({
        runId: str('运行 id（必填）'),
      }),
      output: { schema: OUTPUT_SCHEMA, render: messageRender },
      async execute(args = {}) {
        const runId = typeof args.runId === 'string' ? args.runId.trim() : ''
        if (!runId) return { ok: false, message: '缺少 runId' }
        if (!engine || typeof engine.cancel !== 'function') return { ok: false, message: '执行引擎不可用' }
        const run = store.runs.get(runId)
        if (!run) return { ok: false, message: `运行不存在：${runId}` }
        const result = await engine.cancel(runId)
        if (result && result.ok === false) {
          return {
            ok: true,
            canceled: false,
            runId,
            message: `未取消：${safeText(result.error ?? '该运行未在本引擎中活动（可能已结束）')}`,
          }
        }
        return { ok: true, canceled: true, runId, message: `已请求取消运行 ${runId}。` }
      },
    },

    {
      name: 'devops_servers',
      description: '列出已登记的服务器（含内置 local），并可对某台做一次实时探测（probe）。'
        + '返回内容不含任何密钥值，只有凭据引用名。',
      parameters: params({
        serverId: str('可选。指定则该服务器会做一次实时探测'),
        test: bool('可选。为 true 时对所有服务器做探测（较慢）'),
      }),
      output: { schema: OUTPUT_SCHEMA, render: messageRender },
      isConcurrencySafe: () => true,
      async execute(args = {}) {
        const wanted = typeof args.serverId === 'string' ? args.serverId.trim() : ''
        const base = [{
          id: 'local',
          name: '本机',
          kind: 'local',
          host: '127.0.0.1',
          port: 0,
          user: '',
          authType: 'none',
          keyRef: '',
          passwordRef: '',
          workdir: '',
          tags: [],
          runtimes: {},
          probe: null,
          builtin: true,
        }]
        const others = store.servers.list()
          .filter((server) => server.id !== 'local')
          .map((server) => ({
            id: String(server.id),
            name: String(server.name ?? ''),
            kind: String(server.kind ?? 'ssh'),
            host: String(server.host ?? ''),
            port: Number(server.port ?? 22),
            user: String(server.user ?? ''),
            // 只回引用名，绝不回密钥值
            authType: String(server.auth?.type ?? 'key'),
            keyRef: String(server.auth?.keyRef ?? ''),
            passwordRef: String(server.auth?.passwordRef ?? ''),
            workdir: String(server.workdir ?? ''),
            tags: (server.tags ?? []).filter((tag) => typeof tag === 'string'),
            runtimes: server.runtimes ?? {},
            probe: server.probe ?? null,
            builtin: false,
          }))
        let servers = [...base, ...others]

        if (wanted && !servers.some((server) => server.id === wanted)) {
          return { ok: false, message: `服务器不存在：${wanted}` }
        }

        /** 探测一台；失败如实记在 probe.error，不中断整体列表。 */
        const probeOne = async (id) => {
          if (!executors) return null
          try {
            const server = mustGetServer(id)
            const executor = typeof executors.resolveAsync === 'function'
              ? await executors.resolveAsync(server)
              : executors.resolve(server)
            const probe = await executor.probe(server)
            return { ...probe, error: String(probe?.error ?? '') }
          } catch (error) {
            return { at: Date.now(), os: '', arch: '', shell: '', workdir: '', runtime: {}, managers: [], sudo: 'none', error: safeText(error) }
          }
        }

        if (wanted) {
          const detail = await probeOne(wanted)
          if (detail) servers = servers.map((server) => (server.id === wanted ? { ...server, probe: detail } : server))
        } else if (args.test === true) {
          for (const server of servers) {
            const detail = await probeOne(server.id)
            if (detail) server.probe = detail
          }
        }

        const lines = servers.map((server) => `- ${server.id}｜${server.name}｜${server.kind}`
          + (server.host ? ` ${server.host}${server.port ? `:${server.port}` : ''}` : '')
          + (server.probe?.error
            ? `｜探测失败：${server.probe.error}`
            : server.probe?.os
              ? `｜${server.probe.os}｜${server.probe.arch ?? ''}`
              : '｜未探测'))
        return { count: servers.length, servers, message: `共 ${servers.length} 台服务器：\n${lines.join('\n')}` }
      },
    },

    {
      name: 'devops_provision',
      description: '在目标服务器上准备运行时依赖（如 Python 3.11、Node 20）或系统包。'
        + '默认 allowInstall=false：只探测并给出可照做的建议，不会擅自改动远端系统；'
        + '确需安装时必须显式传 allowInstall=true。',
      parameters: params({
        serverId: str('服务器 id（必填；local 表示本机）'),
        runtime: str("可选。形如 'python:3.11' 或 'node:20'"),
        packages: anyJson('可选。需要安装的系统包名数组，如 ["git","curl"]'),
        allowInstall: bool('可选。为 true 才允许实际执行安装（默认 false）'),
      }),
      output: { schema: OUTPUT_SCHEMA, render: messageRender },
      async execute(args = {}) {
        const serverId = typeof args.serverId === 'string' ? args.serverId.trim() : ''
        if (!serverId) return { ok: false, message: '缺少 serverId' }
        if (!provisioner || typeof provisioner.ensure !== 'function') {
          return { ok: false, message: '环境供给器不可用' }
        }
        let server
        try {
          server = mustGetServer(serverId)
        } catch (error) {
          return { ok: false, message: safeText(error) }
        }

        const requirement = {}
        const runtime = typeof args.runtime === 'string' ? args.runtime.trim() : ''
        if (runtime) {
          const colon = runtime.indexOf(':')
          if (colon === -1) requirement[runtime] = ''
          else requirement[runtime.slice(0, colon).trim()] = runtime.slice(colon + 1).trim()
        }
        if (Array.isArray(args.packages) && args.packages.length > 0) {
          requirement.packages = args.packages.filter((item) => typeof item === 'string' && item.trim() !== '')
        }
        if (Object.keys(requirement).length === 0) {
          return { ok: false, message: "需要提供 runtime（如 'python:3.11'）或 packages" }
        }

        // 显式 allowInstall 优先；未显式指定时跟随服务器的 allowProvision 设置
        const allowInstall = typeof args.allowInstall === 'boolean'
          ? args.allowInstall
          : server.allowProvision === true

        let result
        try {
          result = await provisioner.ensure(server, requirement, { allowInstall })
        } catch (error) {
          return { ok: false, message: `环境准备失败：${safeText(error)}` }
        }

        if (result?.ok === true) {
          const resolvedPairs = Object.entries(result.resolved ?? {})
            .map(([name, value]) => `${name} → ${String(value ?? '')}`)
          const actions = (result.actions ?? []).map((action) => ({
            kind: String(action?.kind ?? ''),
            command: String(action?.command ?? ''),
            exitCode: typeof action?.exitCode === 'number' ? action.exitCode : null,
          }))
          return {
            ok: true,
            serverId,
            resolved: result.resolved ?? {},
            actions,
            message: `已在 ${serverId} 准备好运行时：${resolvedPairs.join('；') || '（无需变更）'}`,
          }
        }

        const reason = safeText(result?.error ?? '未完成')
        const suggestion = String(result?.suggestion ?? '')
        return {
          ok: false,
          serverId,
          error: reason,
          suggestion,
          allowInstall,
          message: `未完成：${reason}`
            + (suggestion ? `\n建议：${suggestion}` : '')
            + (allowInstall ? '' : '\n（当前 allowInstall=false，不会自动安装；确认后可显式传 allowInstall=true 重试）'),
        }
      },
    },
  ]
}

/** 供自检/文档使用：契约要求的 10 个工具名。 */
export const TOOL_NAMES = Object.freeze([
  'devops_list_pipelines',
  'devops_create_pipeline',
  'devops_update_pipeline',
  'devops_validate_pipeline',
  'devops_run',
  'devops_status',
  'devops_logs',
  'devops_cancel',
  'devops_servers',
  'devops_provision',
])

export default registerTools
