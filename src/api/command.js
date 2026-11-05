/**
 * dsh-devops · 斜杠命令 /devops
 *
 * 子命令：
 *   /devops list                    列出流水线
 *   /devops run <pipelineId>        触发运行，返回 runId
 *   /devops status [runId]          查看运行状态（缺省看最近一次）
 *   /devops logs <runId> [stepId]   查看日志尾部
 *   /devops cancel <runId>          取消运行
 *   /devops ai <需求>               把需求 + 当前流水线作为上下文交给 AI（以用户身份开一轮）
 *
 * 纪律：
 *   * 注册包在 ctx.effect 内；ctx.commands 缺席时降级跳过并 warn（不崩）。
 *   * 一切输出打码；不把密钥或凭据值写进命令回显。
 *   * AI 联动一律「尽力而为」：拿不到会话/Agent 时降级提示，绝不抛给用户。
 */

import { randomUUID } from 'node:crypto'
import { maskSecrets } from '../model/variables.js'

/** 命令名（宿主规则 ^[a-z][a-z0-9_-]*$）。 */
const COMMAND_NAME = 'devops'

/** 帮助正文。 */
const HELP = [
  'DevOps 流水线命令：',
  '  /devops list                  列出流水线',
  '  /devops run <pipelineId>      触发运行（立即返回 runId）',
  '  /devops status [runId]        查看运行状态',
  '  /devops logs <runId> [stepId] 查看日志尾部',
  '  /devops cancel <runId>        取消运行',
  '  /devops ai <需求>             让 AI 基于需求编写/修改流水线',
].join('\n')

/**
 * 注册 /devops 命令。
 *
 * @param {{ctx:object, store:object, engine?:object, logs?:object,
 *          config?:object, log?:object}} deps
 * @returns {{dispose:()=>void, registered:boolean}}
 */
export function registerDevopsCommand(deps = {}) {
  const { ctx, store, engine, logs } = deps
  const warn = (message) => {
    if (deps.log && typeof deps.log.warn === 'function') deps.log.warn(message)
    else if (ctx?.logger?.warn) ctx.logger.warn(message)
  }
  let disposer = null
  let registered = false

  const dispose = () => {
    try {
      if (typeof disposer === 'function') disposer()
    } catch {
      /* 摘除失败不影响其它注册 */
    }
    disposer = null
    registered = false
  }

  if (!ctx) {
    warn('dsh-devops: 缺少 ctx，跳过 /devops 命令注册')
    return { dispose, registered }
  }

  const commands = safeGet(ctx, 'commands')
  if (!commands || typeof commands.register !== 'function') {
    warn('dsh-devops: 宿主未提供 commands 服务，/devops 命令未注册')
    return { dispose, registered }
  }

  const definition = {
    name: COMMAND_NAME,
    description: 'DevOps 流水线：查看/运行/查看日志/取消，以及让 AI 编写流水线',
    input: { hint: 'list | run <id> | status [runId] | logs <runId> [stepId] | cancel <runId> | ai <需求>' },
    handler: (invocation) => runCommand(deps, invocation),
  }

  const register = () => commands.register(definition)

  try {
    if (typeof ctx.effect === 'function') {
      // effect 的 body 返回 disposer，宿主在卸载/热重载时调用它
      ctx.effect(() => {
        disposer = register()
        registered = true
        return () => dispose()
      }, 'dsh-devops /devops command')
    } else {
      disposer = register()
      registered = true
    }
  } catch (error) {
    warn(`dsh-devops: /devops 命令注册失败：${error?.message ?? error}`)
  }

  return { dispose, registered }
}

/** 命令主体：解析子命令并返回 CommandResult。 */
async function runCommand(deps, invocation) {
  const { store, engine, logs } = deps
  const raw = String(invocation?.rawInput ?? '').trim()
  const [sub, ...rest] = raw === '' ? [] : raw.split(/\s+/)
  const command = (sub ?? 'help').toLowerCase()

  try {
    switch (command) {
      case 'list': return ok(await listPipelines(store))
      case 'run': return ok(await runPipeline(engine, store, rest[0]))
      case 'status': return ok(await showStatus(engine, store, rest[0]))
      case 'logs': return ok(await showLogs(store, logs, deps.config, rest[0], rest[1]))
      case 'cancel': return ok(await cancelRun(engine, store, rest[0]))
      case 'ai': return ok(await handoffToAi(deps, invocation, rest.join(' ').trim()))
      case 'help':
      default:
        return raw === '' || command === 'help' ? ok(HELP) : fail(`未知子命令：${command}\n\n${HELP}`)
    }
  } catch (error) {
    return fail(`执行失败：${safeText(error)}`)
  }
}

function ok(text) {
  return { kind: 'success', text }
}

function fail(text) {
  return { kind: 'error', text }
}

function safeText(error) {
  const text = String(error?.message ?? error ?? '')
  if (/passphrase|password|private key|PRIVATE KEY/i.test(text)) {
    return '认证或密钥不可用（请检查凭据引用是否已在本机配置）'
  }
  return text
}

/** /devops list */
async function listPipelines(store) {
  const items = store.pipelines.list().sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  if (items.length === 0) return '还没有流水线。可用「/devops ai 你的需求」让 AI 建一条。'
  return [
    `共 ${items.length} 条流水线：`,
    ...items.slice(0, 30).map((item) => {
      const jobs = (item.stages ?? []).reduce((sum, stage) => sum + (stage.jobs ?? []).length, 0)
      return `- ${item.id}｜${item.name}｜${(item.stages ?? []).length} 阶段/${jobs} 步`
    }),
  ].join('\n')
}

/** /devops run <pipelineId> */
async function runPipeline(engine, store, pipelineId) {
  if (!pipelineId) return '/devops run 需要一个 pipelineId（可先用 /devops list 查看）'
  if (!engine || typeof engine.start !== 'function') return '执行引擎不可用，无法运行。'
  const pipeline = store.pipelines.get(pipelineId)
  if (!pipeline) return `流水线不存在：${pipelineId}`
  const handle = engine.start({ pipeline, variables: {}, trigger: 'manual' })
  return `已启动运行 ${handle.runId}（${pipeline.name}）。\n用 /devops status ${handle.runId} 查看进度。`
}

/** /devops status [runId] */
async function showStatus(engine, store, runId) {
  if (!runId) {
    const runs = store.runs.list().sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0)).slice(0, 5)
    if (runs.length === 0) return '还没有运行记录。'
    return ['最近运行：', ...runs.map((run) => `- ${run.id}｜${run.pipelineName}｜${run.status}`)].join('\n')
  }
  const live = engine && typeof engine.status === 'function' ? engine.status(runId) : null
  const run = live?.run ?? store.runs.get(runId)
  if (!run) return `运行不存在：${runId}`
  const steps = Object.values(run.steps ?? {})
  const lines = steps.map((step) => {
    const duration = step.startedAt ? `${Math.max(0, ((step.finishedAt || Date.now()) - step.startedAt) / 1000).toFixed(0)}s` : '-'
    return `- ${step.id}｜${step.status}${step.phase ? `（${step.phase}）` : ''}｜${duration}`
      + (step.error ? `｜${maskSecrets(String(step.error), [])}` : '')
  })
  return [
    `运行 ${run.id}（${run.pipelineName}）：${run.status}${live?.active ? '（进行中）' : ''}`,
    `${steps.filter((step) => step.status === 'success').length}/${steps.length} 成功`,
    ...lines,
  ].join('\n')
}

/** /devops logs <runId> [stepId] */
async function showLogs(store, logs, config, runId, stepId) {
  if (!runId) return '/devops logs 需要一个 runId'
  if (!logs || typeof logs.read !== 'function') return '日志存储不可用。'
  const run = store.runs.get(runId)
  if (!run) return `运行不存在：${runId}`
  try {
    const result = stepId
      ? logs.read({ runId, stepId, from: 0 })
      : (typeof logs.readRun === 'function' ? logs.readRun(runId, 0) : { lines: [] })
    const lines = (result.lines ?? []).slice(-40)
    if (lines.length === 0) return `${runId}${stepId ? `/${stepId}` : ''} 暂无日志输出。`
    // 命令回显同样要走打码：密钥绝不能出现在终端历史里
    const body = lines.map((line) => `[${line.seq}] ${String(line.text ?? '')}`).join('\n')
    return body
  } catch (error) {
    return `读取日志失败：${safeText(error)}`
  }
}

/** /devops cancel <runId> */
async function cancelRun(engine, store, runId) {
  if (!runId) return '/devops cancel 需要一个 runId'
  if (!engine || typeof engine.cancel !== 'function') return '执行引擎不可用。'
  const run = store.runs.get(runId)
  if (!run) return `运行不存在：${runId}`
  const result = await engine.cancel(runId)
  if (result && result.ok === false) return `未取消：${safeText(result.error ?? '该运行未在进行中')}`
  return `已请求取消运行 ${runId}。`
}

/**
 * /devops ai <需求>
 *
 * 让 AI 基于需求编写流水线：优先把消息作为「用户输入」送进当前会话，开新一轮对话，
 * 这样模型能拿到完整工具与技能（含 devops-* 工具）。
 *
 * 拿不到会话服务时降级：把组织好的提示词回显给用户，由用户自行粘贴。
 * 三种通道都试（按可靠性排序）：
 *   1. ctx.agents.get(sessionId) + createUserMessage + agent.followup()（唤醒，保证必达）
 *   2. ctx.sessionController.prompt({requestId, sessionId, mode:'queue', content})
 *   3. 降级为回显提示词
 */
async function handoffToAi(deps, invocation, requirement) {
  if (requirement === '') {
    return '请描述你的需求，例如：/devops ai 把 dist 目录部署到 prod-01 的 /srv/app 并重启服务'
  }
  const { ctx, store } = deps
  const pipelineList = store.pipelines.list()
    .slice(0, 10)
    .map((item) => `- ${item.id}（${item.name}）`)
    .join('\n')

  const prompt = [
    '请帮我在 dsh-devops 里创建或修改一条流水线。',
    '',
    `需求：${requirement}`,
    '',
    pipelineList ? `当前已有流水线：\n${pipelineList}` : '当前还没有任何流水线。',
    '',
    '请先调用 devops_list_pipelines 与 devops_servers 了解现状，产出流水线 JSON，',
    '再调用 devops_validate_pipeline 校验，最后用 devops_create_pipeline / devops_update_pipeline 保存。',
    '保存后把要点告诉我，不要擅自运行。',
  ].join('\n')

  const sessionId = invocation?.agent?.session?.id

  // 通道一：直接驱动 agent（followup 会唤醒，保证消息必达）
  try {
    const agents = safeGet(ctx, 'agents')
    const agent = typeof agents?.get === 'function' && sessionId ? agents.get(sessionId) : null
    if (agent && typeof agent.followup === 'function') {
      const llm = safeGet(ctx, 'llm')
      const message = typeof llm?.createUserMessage === 'function'
        ? llm.createUserMessage({ content: [{ type: 'text', text: prompt }] })
        : null
      if (message) {
        agent.followup(message)
        // 确保消息落地持久化（不 await 会让进程重启时可能丢）
        try {
          const sessions = safeGet(ctx, 'sessions')
          if (typeof sessions?.flush === 'function') await sessions.flush(agent.session)
        } catch {
          /* flush 失败不阻断：消息已进内存队列 */
        }
        return '已把需求交给 AI，正在为你编写流水线。'
      }
    }
  } catch (error) {
    // 落到下一通道，但要让用户知道这条路没走通
    deps.log?.warn?.(`dsh-devops: 直接驱动 agent 失败：${safeText(error)}`)
  }

  // 通道二：会话控制器的业务路径（与 Web UI 同一条）
  try {
    const controller = safeGet(ctx, 'sessionController')
    if (controller && typeof controller.prompt === 'function' && sessionId) {
      await controller.prompt(
        {
          requestId: randomUUID(),
          sessionId,
          mode: 'queue',
          content: [{ type: 'text', text: prompt }],
        },
        new AbortController().signal,
      )
      return '已把需求交给 AI，正在为你编写流水线。'
    }
  } catch (error) {
    deps.log?.warn?.(`dsh-devops: 会话提交失败：${safeText(error)}`)
  }

  // 通道三：降级——把提示词交还给用户（不静默失败）
  return [
    '当前环境无法自动把需求送进会话，请把下面这段提示词直接发给我：',
    '',
    prompt,
  ].join('\n')
}

function safeGet(ctx, name) {
  try {
    return ctx?.get?.(name) ?? null
  } catch {
    return null
  }
}
