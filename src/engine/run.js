/**
 * src/engine/run.js —— 流水线执行引擎（契约 §2.5 / §3.9 / §3.11）
 *
 * 职责：
 * - 状态机：run.status ∈ queued|running|success|failed|canceled
 *           step.status ∈ pending|running|success|failed|skipped|canceled
 *           step.phase  ∈ queued|connecting|provisioning|transferring|running|draining|settled
 * - 调度：dag 模式（needs + readySet）与 staged 模式（阶段串行 + 阶段内 parallel）
 * - 并发限额：maxConcurrentRuns（跨运行）、maxParallelSteps（运行内）
 * - 重试：指数退避（retry.delayMs * 2^(attempt-1)）
 * - 超时：job.timeoutMs → 中止步骤并强杀子进程
 * - 取消传播：AbortController → executor.run 的 signal → 子进程
 * - 事件：onEvent({type:'run'|'step'|'log'|'warning', ...}) 供 SSE 转发
 * - 定义快照：运行创建时把流水线定义冻结进 run.pipelineSnapshot（可选字段，契约 §2.5）；
 *   重试 / 从既有 run 复跑 / 继续调度一律以该快照为准，快照缺失的旧数据降级回当前定义。
 *   因此**用户编辑流水线不会影响已运行或运行中的运行**。
 *
 * 生命周期约定：**承载活跃工作的定时器一律不得 unref**（审批等待、调度轮询、
 * 步骤超时、重试退避、wait 超时、wait.delay 等），否则宿主进程可能在运行结束前退出。
 *
 * 对尚未落盘的模块（model/variables.js、store）一律惰性/容错调用，
 * 缺失时降级为内置实现，保证引擎可独立跑通。
 */
import { buildGraph, readySet, isSettled, isSatisfied, detectCycle } from './dag.js';

const DEFAULT_SETTINGS = {
  maxConcurrentRuns: 2,
  maxParallelSteps: 4,
  defaultServer: 'local',
  timeoutMs: 600000,
};

/* ---------------------------------------------------------------- 惰性依赖 */

/** model/variables.js 由 host-core 提供；缺失时降级 */
let variablesModulePromise = null;
function loadVariablesModule() {
  if (!variablesModulePromise) {
    variablesModulePromise = import('../model/variables.js').catch(() => null);
  }
  return variablesModulePromise;
}

/** 内置的五层合并（契约 §3.2 顺序），作为 resolveEnv 缺失时的降级实现 */
function fallbackMergeEnv({ processEnv, server, envSets, pipeline, stage, job, node, runtime }) {
  const env = {};
  const report = [];
  const put = (list, source) => {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      if (!item || !item.name) continue;
      // null / 空串 = 删除该键（契约 §3.2）
      const value = item.value === null || item.value === '' ? undefined : String(item.value);
      const overridden = env[item.name] !== undefined && env[item.name] !== value;
      env[item.name] = value;
      report.push({ name: item.name, source, overridden });
    }
  };
  if (processEnv && typeof processEnv === 'object') {
    for (const [name, value] of Object.entries(processEnv)) {
      if (value === undefined) continue;
      env[name] = String(value);
    }
  }
  put(server?.defaultEnv, 'server.defaultEnv');
  put(server?.customEnv, 'server.customEnv');
  const sets = Array.isArray(envSets) ? envSets : [];
  for (const set of sets) put(set?.vars, `envset:${set?.id ?? ''}`);
  put(pipeline?.variables, 'pipeline.variables');
  put(stage?.variables, 'stage.variables');
  put(job?.env, 'job.env');
  for (const ref of job?.envSetRefs ?? []) {
    const set = sets.find((s) => s?.id === ref);
    if (set) put(set.vars, `job.envSetRefs:${ref}`);
  }
  put(node?.env, 'node.env');
  if (runtime && typeof runtime === 'object') {
    for (const [name, value] of Object.entries(runtime)) {
      if (value === undefined || value === null) continue;
      env[name] = String(value);
    }
  }
  // 删除语义落地：值为 undefined 的键从最终结果移除
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) delete env[name];
  }
  return { env, masked: [], report, unresolved: [] };
}

/* --------------------------------------------------------------- 小工具 */

function emit(onEvent, event) {
  if (typeof onEvent !== 'function') return;
  try {
    onEvent(event);
  } catch { /* 事件回调异常不得影响执行 */ }
}

function now() {
  return Date.now();
}

/** 把 [{name,value}] 或对象统一成条目数组（用于 env 层合并） */
function toEnvList(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .filter((item) => item && item.name)
      .map((item) => ({ name: String(item.name), value: item.value, secret: Boolean(item.secret) }));
  }
  if (typeof value === 'object') {
    return Object.entries(value).map(([name, v]) => ({ name, value: v, secret: false }));
  }
  return [];
}

/** 新建 step 对象（契约 §2.5 形状） */
function newStep(job, stage) {
  return {
    id: String(job.id),
    name: String(job.name ?? job.id),
    stage: String(stage?.id ?? ''),
    node: String(job.node ?? ''),
    server: String(job.server ?? ''),
    status: 'pending',
    phase: 'queued',
    startedAt: 0,
    finishedAt: 0,
    exitCode: null,
    attempt: 0,
    lastOutputAt: 0,
    bytes: 0,
    logPath: '',
    spillPath: '',
    outputs: {},
    error: '',
    detail: '',
    when: job.when ?? 'on_success',
    allowFailure: Boolean(job.allowFailure),
  };
}

/* ================================================================ 引擎 */

/**
 * 创建执行引擎。
 * @param {{store?:object, logs:object, nodes:object, executors:object,
 *          provisioner?:object, config?:object, onEvent?:Function}} deps
 */
export function createEngine(deps = {}) {
  const { store, logs, nodes, executors, provisioner, config = {}, onEvent } = deps;

  if (!logs) throw new Error('createEngine 需要 logs（logstore）');
  if (!nodes) throw new Error('createEngine 需要 nodes（节点注册表）');
  if (!executors) throw new Error('createEngine 需要 executors（执行器注册表）');

  /** @type {Map<string, object>} runId → 运行上下文 */
  const contexts = new Map();
  /** 运行级并发闸门 */
  let activeRuns = 0;
  const runQueue = [];
  const settings = config.settings ?? {};
  const maxConcurrentRuns = Number(config.maxConcurrentRuns) > 0
    ? Number(config.maxConcurrentRuns)
    : Number(settings.maxConcurrentRuns) > 0 ? Number(settings.maxConcurrentRuns) : DEFAULT_SETTINGS.maxConcurrentRuns;
  const maxParallelSteps = Number(config.maxParallelSteps) > 0
    ? Number(config.maxParallelSteps)
    : Number(settings.maxParallelSteps) > 0 ? Number(settings.maxParallelSteps) : DEFAULT_SETTINGS.maxParallelSteps;
  const defaultTimeoutMs = Number(config.timeoutMs) > 0 ? Number(config.timeoutMs) : DEFAULT_SETTINGS.timeoutMs;

  function acquireRunSlot() {
    if (activeRuns < maxConcurrentRuns) {
      activeRuns += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => runQueue.push(resolve));
  }

  function releaseRunSlot() {
    activeRuns = Math.max(0, activeRuns - 1);
    const next = runQueue.shift();
    if (next) {
      activeRuns += 1;
      next();
    }
  }

  /* ------------------------------------------------------------ 持久化 */

  async function persistRun(ctx) {
    try {
      if (store?.runs?.put) await store.runs.put(ctx.run.id, ctx.run);
    } catch (error) {
      emit(onEvent, {
        type: 'warning',
        runId: ctx.run.id,
        message: `运行状态持久化失败：${error?.message ?? error}`,
      });
    }
  }

  /** run 摘要（SSE / 列表用，避免推送完整 steps 体积） */
  function summarizeRun(run) {
    const steps = Object.values(run.steps ?? {});
    const counts = { success: 0, failed: 0, running: 0, pending: 0, skipped: 0, canceled: 0 };
    for (const step of steps) {
      if (counts[step.status] !== undefined) counts[step.status] += 1;
    }
    return {
      id: run.id,
      pipelineId: run.pipelineId,
      pipelineName: run.pipelineName,
      status: run.status,
      trigger: run.trigger,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      variables: run.variables,
      stepCounts: counts,
      stepTotal: steps.length,
      parentRunId: run.parentRunId ?? null,
      parentStepId: run.parentStepId ?? null,
    };
  }

  function emitRun(ctx) {
    // 带 runId：所有事件类型（run/step/log/warning）统一携带，消费方可无差别区分来源
    emit(onEvent, { type: 'run', runId: ctx.run.id, run: summarizeRun(ctx.run) });
  }

  function emitStep(ctx, step) {
    // 带 runId：SSE 虽然按 run 订阅，但多运行订阅者/工具消费者需要能区分来源
    emit(onEvent, { type: 'step', runId: ctx.run.id, stepId: step.id, step: { ...step } });
  }

  function describePhase(step) {
    const map = {
      queued: '排队中',
      connecting: '连接服务器中',
      provisioning: '准备运行时中',
      transferring: '传输文件中',
      running: '执行中',
      draining: '正在终止',
      settled: '已结束',
    };
    return map[step.phase] ?? step.phase;
  }

  /** 更新 step 并广播 */
  function patchStep(ctx, step, patch) {
    Object.assign(step, patch);
    // 未显式给出 detail 时，按 phase 生成可读文案（不覆盖审批等自定义文案）
    if (patch.detail === undefined && step.startedAt && !step.finishedAt) {
      step.detail = describePhase(step);
    }
    emitStep(ctx, step);
    return step;
  }

  function setPhase(ctx, step, phase) {
    step.phase = phase;
    patchStep(ctx, step, {});
    return phase;
  }

  /* -------------------------------------------------------- 环境与服务 */

  function resolveServer(serverId) {
    const id = String(serverId || settings.defaultServer || DEFAULT_SETTINGS.defaultServer);
    if (id === 'local') {
      return { id: 'local', name: '本机', kind: 'local', host: '127.0.0.1' };
    }
    const fromStore = store?.servers?.get?.(id);
    if (fromStore) return fromStore;
    // 未登记的服务器：不能按 id 当 host 猜，否则会静默改动行为
    return null;
  }

  function collectEnvSets(refs) {
    const ids = [...new Set(refs ?? [])];
    const out = [];
    for (const id of ids) {
      const set = store?.envsets?.get?.(id);
      if (set) out.push(set);
    }
    return out;
  }

  async function resolveEnvFor(ctx, { server, stage, job, node, step }) {
    const pipeline = ctx.pipeline;
    const envSetRefs = [...(pipeline?.envSetRefs ?? []), ...(job?.envSetRefs ?? [])];
    const envSets = collectEnvSets(envSetRefs);

    // 运行级变量（env.set 写进来的）作为独立一层参与合并。
    // 位置：job.env 之后、node.env 之前（契约 §3.2 的「运行级覆盖 job、被 node 覆盖」语义）。
    // 这样下游 ${env.X} 能读到 env.set 的值——否则用户最直觉的写法会静默拿到空串。
    const runVarEntries = Object.entries(ctx.run.variables ?? {})
      .filter(([, value]) => value !== undefined)
      .map(([name, value]) => ({ name, value, secret: false }));
    const nodeWithRunVars = {
      ...(node ?? {}),
      env: [...runVarEntries, ...toEnvList(node?.env)],
    };

    const mod = await loadVariablesModule();
    const input = {
      processEnv: config.processEnv ?? process.env,
      server,
      envSets,
      pipeline,
      stage,
      job,
      node: nodeWithRunVars,
      credentials: config.credentials ?? null,
      runtime: ctx.runtimeInject ?? {},
    };

    let resolved;
    // 优先用异步版：真实 ctx.credentials.resolve 返回 Promise，同步的 resolveEnv 会
    // **跳过**它（这是同步版的设计），导致所有 secret:true 的变量静默拿不到值。
    // resolveEnvAsync 是 resolveEnv 的超集（额外返回 unresolved 列表）。
    const resolver = typeof mod?.resolveEnvAsync === 'function'
      ? mod.resolveEnvAsync
      : (typeof mod?.resolveEnv === 'function' ? mod.resolveEnv : null);
    if (resolver) {
      try {
        resolved = await resolver(input);
      } catch (error) {
        emit(onEvent, {
          type: 'warning',
          runId: ctx.run.id,
          message: `环境变量解析失败，降级为内置合并：${error?.message ?? error}`,
        });
        resolved = null;
      }
    }
    if (!resolved) resolved = fallbackMergeEnv(input);

    // 未解析成功的密钥：必须让用户看得见，不能静默为空。
    // unresolved 只含引用名（绝不含明文），可安全上报；同一运行内按引用名去重，避免刷屏。
    if (Array.isArray(resolved.unresolved) && resolved.unresolved.length) {
      const names = resolved.unresolved
        .map((item) => (item?.ref ? `${item.name}(${item.ref})` : item?.name))
        .filter(Boolean);
      const fresh = names.filter((name) => !ctx.warnedSecrets.has(name));
      for (const name of fresh) ctx.warnedSecrets.add(name);
      if (fresh.length) {
        emit(onEvent, {
          type: 'warning',
          runId: ctx.run.id,
          stepId: step?.id ?? undefined,
          message: `以下密钥未能解析，相关变量将为空：${fresh.join('、')}。请检查资源库/凭证配置（credentials.resolve）。`,
          unresolved: fresh,
        });
      }
    }

    // 密钥值并入打码词表（写盘前打码）
    if (Array.isArray(resolved.masked) && resolved.masked.length && typeof logs.addMask === 'function') {
      logs.addMask(resolved.masked);
    }
    return resolved;
  }

  /* ------------------------------------------------------------ rt 构造 */

  /** 追加日志：先经 logstore 打码，再用打码后的文本广播 */
  function appendLog(ctx, step, text, stream = 'stdout') {
    if (text === undefined || text === null || text === '') return;
    let record;
    try {
      record = logs.append(ctx.run.id, step.id, { text: String(text), stream });
    } catch {
      record = { seq: 0, ts: now(), stream, text: String(text) };
    }
    if (record.text === '') return; // 整条都是密钥，不推送
    step.lastOutputAt = record.ts;
    step.bytes = (step.bytes ?? 0) + Buffer.byteLength(record.text, 'utf8');
    emit(onEvent, {
      type: 'log',
      runId: ctx.run.id,
      stepId: step.id,
      seq: record.seq,
      ts: record.ts,
      stream: record.stream,
      text: record.text,
    });
  }

  function buildRuntime(ctx, { step, job, server, executor, env, resolveEnvResult }) {
    // 工作目录优先级：job.workdir → server.workdir → 引擎进程 cwd。
    // 同时记录来源，节点报错时才能告诉用户「这个基准是哪儿来的」。
    let cwd;
    let cwdSource;
    if (job?.workdir) {
      cwd = String(job.workdir);
      cwdSource = 'job.workdir';
    } else if (server?.workdir) {
      cwd = String(server.workdir);
      cwdSource = 'server.workdir';
    } else if (server?.probe?.workdir) {
      // 探测已经拿到了目标机真实目录（如 /root）：比回落控制端 process.cwd() 正确得多。
      // 跨机时控制端 cwd 是 Windows 盘符路径，远端根本不存在。
      cwd = String(server.probe.workdir);
      cwdSource = 'server.probe.workdir';
    } else {
      cwd = process.cwd();
      cwdSource = '引擎进程工作目录';
    }
    const stepTimeout = Number(job?.timeoutMs) > 0 ? Number(job.timeoutMs) : defaultTimeoutMs;

    const rt = {
      executor,
      server,
      env,
      cwd,
      cwdSource,
      signal: step.controller.signal,
      step,
      run: ctx.run,
      // pipeline 供 ${variables.*} 读取静态变量（模板插值上下文需要）
      pipeline: ctx.pipeline,
      config: { ...config, settings },
      store,

      engine: {
        startSubRun: (pipelineId, options) => startSubRun(ctx, pipelineId, options),
      },

      // 人工审批通道
      approvals: {
        wait: (stepId, meta) => waitApproval(ctx, stepId, meta),
      },

      log(text, stream = 'stdout') {
        appendLog(ctx, step, text, stream);
      },

      setPhase(phase) {
        step.phase = phase;
        patchStep(ctx, step, {});
      },

      async resolvePath(target) {
        if (typeof executor?.resolvePath === 'function') return executor.resolvePath(target);
        return target;
      },

      async spawn(argv, options = {}) {
        // 优先用调用方显式传入的 timeoutMs（含 0 = 不超时）；否则回退到 job 超时。
        // 步骤级超时已由 engine 的计时器统一管理。
        const requested = options.timeoutMs === undefined ? stepTimeout : options.timeoutMs;
        // 脚本通道只给「声明支持 script」的执行器（ssh）：脚本文本由执行器直接交给目标端解释，
        // 而不是在控制端落临时文件再把路径当 argv。local 继续走 helpers.buildScriptInvocation。
        const carriesScript = executor.supportsScript === true;
        // 必须 await：ssh 执行器的 run() 是 async，漏掉会拿到 pending Promise，
        // handle.done 为 undefined，下一步的 finally 直接抛「引擎异常」。
        const handle = await executor.run({
          argv,
          script: carriesScript ? options.script : undefined,
          shell: carriesScript ? options.shell : undefined,
          scriptArgv: carriesScript ? options.scriptArgv : undefined,
          cwd: options.cwd ?? cwd,
          env: options.env ?? env,
          timeoutMs: requested,
          signal: options.signal ?? step.controller.signal,
          label: options.label ?? step.name,
          onData: (chunk) => {
            appendLog(ctx, step, chunk.text, chunk.stream);
            options.onData?.(chunk);
          },
        });
        ctx.handles.add(handle);
        handle.done.finally(() => ctx.handles.delete(handle)).catch(() => {});
        return handle;
      },

      async provision(requirement, options = {}) {
        if (!provisioner) {
          return {
            ok: false,
            error: '未提供 provisioner',
            suggestion: '请在本机安装所需运行时后重试',
            actions: [],
          };
        }
        step.phase = 'provisioning';
        patchStep(ctx, step, {});
        try {
          const result = await provisioner.ensure(server, requirement, {
            allowInstall: options.allowInstall === true,
            onLog: (text) => (options.onLog ? options.onLog(text) : appendLog(ctx, step, text, 'stdout')),
            signal: step.controller.signal,
          });
          // 供给结果写回 server.runtimes
          if (result?.ok && result.resolved && server && typeof server === 'object') {
            server.runtimes = { ...(server.runtimes ?? {}) };
            for (const [key, value] of Object.entries(result.resolved)) {
              server.runtimes[key] = { path: value, at: now() };
            }
            try {
              if (store?.servers?.put && server.id) await store.servers.put(server.id, server);
            } catch { /* 忽略写回失败 */ }
          }
          return result;
        } finally {
          if (step.phase === 'provisioning') {
            step.phase = 'running';
            patchStep(ctx, step, {});
          }
        }
      },

      async setVariables(patch) {
        const next = { ...(ctx.run.variables ?? {}) };
        for (const [key, value] of Object.entries(patch ?? {})) {
          if (value === undefined) delete next[key];
          else next[key] = value;
        }
        ctx.run.variables = next;
        for (const [key, value] of Object.entries(patch ?? {})) {
          if (value === undefined) delete env[key];
          else env[key] = value;
        }
        await persistRun(ctx);
        emitRun(ctx);
      },
    };

    // 记录本次的实际合并报告，便于前端展示变量来源
    if (resolveEnvResult?.report) rt.envReport = resolveEnvResult.report;
    return rt;
  }

  /* -------------------------------------------------------------- 审批 */

  function waitApproval(ctx, stepId, meta = {}) {
    return new Promise((resolve, reject) => {
      const key = String(stepId);
      // step 必须先声明：下面的 finish/onAbort 闭包都会用到它
      const step = ctx.steps[key];
      const timeoutMs = Number(meta.timeoutMs) > 0 ? Number(meta.timeoutMs) : 0;
      const entry = { resolve, reject };
      ctx.approvals.set(key, entry);

      const finish = () => {
        ctx.approvals.delete(key);
        if (timer) clearTimeout(timer);
        step?.controller?.signal.removeEventListener('abort', onAbort);
      };
      const onAbort = () => {
        finish();
        reject(new Error('审批等待被取消'));
      };
      // 审批等待属于活跃工作：**不可 unref**，否则宿主可能在等待人工确认时退出
      const timer = timeoutMs > 0
        ? setTimeout(() => {
          finish();
          reject(new Error(`审批超时（${timeoutMs}ms）`));
        }, timeoutMs)
        : null;

      if (!step) {
        finish();
        reject(new Error(`步骤不存在：${stepId}`));
        return;
      }
      if (step.controller.signal.aborted) {
        onAbort();
        return;
      }
      step.controller.signal.addEventListener('abort', onAbort, { once: true });

      step.phase = 'running';
      patchStep(ctx, step, { detail: '等待人工审批' });

      // 覆写 resolve：审批通过时先清理监听
      entry.resolve = (decision) => {
        finish();
        resolve(decision);
      };
    });
  }

  /**
   * 人工审批/放行一个步骤。
   * @param {string} runId
   * @param {string} stepId
   * @param {{approved?:boolean, by?:string, comment?:string}} decision
   * @returns {{ok:boolean, mode?:'approval'|'decision', error?:string}}
   */
  function approve(runId, stepId, decision = {}) {
    const ctx = contexts.get(String(runId));
    if (!ctx) return { ok: false, error: `运行不存在或已结束：${runId}` };
    const key = String(stepId);
    const entry = ctx.approvals.get(key);
    if (entry) {
      entry.resolve({
        approved: decision.approved !== false,
        by: decision.by ?? '',
        comment: decision.comment ?? '',
      });
      return { ok: true, mode: 'approval' };
    }
    // 未在审批等待中：作为 manual 放行决策
    ctx.decision[key] = decision.approved === false ? 'skip' : 'run';
    wake(ctx);
    return { ok: true, mode: 'decision' };
  }

  /* --------------------------------------------------------- 步骤执行 */

  function wake(ctx) {
    for (const resolve of ctx.wakers) resolve();
    ctx.wakers.clear();
  }

  function waitWake(ctx, timeoutMs) {
    return new Promise((resolve) => {
      let done = false;
      const fire = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        ctx.wakers.delete(fire);
        resolve();
      };
      // 调度轮询属于活跃工作，必须保持事件循环存活（不可 unref）
      const timer = setTimeout(fire, timeoutMs);
      ctx.wakers.add(fire);
    });
  }

  /** 启动一个步骤（不 await），把 promise 记入 ctx.running */
  function startStep(ctx, stepId) {
    if (ctx.running.has(stepId)) return ctx.running.get(stepId);
    const promise = executeStep(ctx, stepId)
      .catch((error) => {
        const step = ctx.steps[stepId];
        if (step && step.status === 'running') {
          patchStep(ctx, step, {
            status: 'failed',
            phase: 'settled',
            finishedAt: now(),
            error: `内部错误：${error?.message ?? error}`,
          });
        }
      })
      .finally(() => {
        ctx.running.delete(stepId);
        wake(ctx);
      });
    ctx.running.set(stepId, promise);
    return promise;
  }

  async function executeStep(ctx, stepId) {
    const step = ctx.steps[stepId];
    const meta = ctx.graph.jobs[stepId];
    if (!step || !meta) return;
    const job = meta.job ?? {};
    const stage = (ctx.pipeline.stages ?? []).find((s) => String(s.id) === meta.stageId) ?? null;

    const maxAttempts = Math.max(1, Number(job.retry?.max ?? 0) + 1);
    const baseDelay = Number(job.retry?.delayMs ?? 1000);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (ctx.cancelled) {
        patchStep(ctx, step, { status: 'canceled', phase: 'settled', finishedAt: now(), detail: '已取消' });
        return;
      }
      step.attempt = attempt;
      step.controller = new AbortController();
      patchStep(ctx, step, {
        status: 'running',
        phase: 'connecting',
        startedAt: step.startedAt || now(),
        finishedAt: 0,
        exitCode: null,
        error: '',
      });

      let outcome;
      try {
        outcome = await executeOnce(ctx, { step, job, stage, meta });
      } catch (error) {
        outcome = { status: 'failed', exitCode: null, error: `执行异常：${error?.message ?? error}` };
      }

      if (outcome.status === 'success') {
        patchStep(ctx, step, {
          status: 'success',
          phase: 'settled',
          finishedAt: now(),
          exitCode: outcome.exitCode ?? 0,
          outputs: outcome.outputs ?? {},
          error: '',
          detail: '已完成',
        });
        return;
      }

      if (outcome.status === 'canceled') {
        patchStep(ctx, step, {
          status: 'canceled',
          phase: 'settled',
          finishedAt: now(),
          exitCode: outcome.exitCode ?? null,
          outputs: outcome.outputs ?? {},
          error: outcome.error ?? '已取消',
          detail: '已取消',
        });
        return;
      }

      // failed
      const canRetry = attempt < maxAttempts && !ctx.cancelled;
      if (canRetry) {
        const delay = baseDelay * Math.pow(2, attempt - 1);
        patchStep(ctx, step, {
          phase: 'queued',
          error: `${outcome.error ?? '执行失败'}（第 ${attempt} 次尝试，${delay}ms 后重试）`,
          detail: `重试等待中（第 ${attempt + 1}/${maxAttempts} 次）`,
        });
        appendLog(ctx, step, `[engine] 第 ${attempt} 次尝试失败，${delay}ms 后重试：${outcome.error ?? ''}\n`, 'stderr');
        await sleepInterruptible(delay, step.controller.signal);
        continue;
      }

      patchStep(ctx, step, {
        status: 'failed',
        phase: 'settled',
        finishedAt: now(),
        exitCode: outcome.exitCode ?? null,
        outputs: outcome.outputs ?? {},
        error: outcome.error ?? '执行失败',
        detail: step.allowFailure ? '已失败（allowFailure，不阻塞下游）' : '已失败',
      });
      return;
    }
  }

  /** 单次尝试 */
  async function executeOnce(ctx, { step, job, stage, meta }) {
    const timeoutMs = Number(job.timeoutMs) > 0 ? Number(job.timeoutMs) : defaultTimeoutMs;

    // 1) 服务器
    const serverId = String(
      job.server || ctx.pipeline.defaults?.server || settings.defaultServer || DEFAULT_SETTINGS.defaultServer,
    );
    const server = resolveServer(serverId);
    if (!server) {
      return {
        status: 'failed',
        exitCode: null,
        error: `找不到服务器：${serverId}（请在「服务器」页面登记或使用 local）`,
      };
    }
    step.server = server.id;

    // 2) 执行器
    let executor;
    try {
      executor = executors.resolve(server);
    } catch (error) {
      return { status: 'failed', exitCode: null, error: `无法解析执行器：${error?.message ?? error}` };
    }

    // 3) 节点
    const descriptor = nodes.get(job.node);
    if (!descriptor) {
      return { status: 'failed', exitCode: null, error: `未知节点类型：${job.node}` };
    }

    // 4) 环境
    let envResult;
    try {
      envResult = await resolveEnvFor(ctx, { server, stage, job, node: descriptor, step });
    } catch (error) {
      return { status: 'failed', exitCode: null, error: `环境变量解析失败：${error?.message ?? error}` };
    }
    const childEnv = { ...envResult.env };
    // PATH 兜底只对**本机**执行器生效：跨机（ssh）时控制端 PATH 在目标机上无意义，
    // 注入过去会让 git/systemctl/curl 等找不到（实测 bash 报 exit 127）。远端用登录 shell 自己的 PATH。
    if (executor?.kind === 'local' && childEnv.PATH === undefined && process.env.PATH !== undefined) {
      childEnv.PATH = process.env.PATH;
    }

    // 5) logPath
    try {
      step.logPath = logs.pathFor(ctx.run.id, step.id);
    } catch { step.logPath = ''; }

    const rt = buildRuntime(ctx, { step, job, server, executor, env: childEnv, resolveEnvResult: envResult });

    // 6) 执行（带超时与取消）
    const startedAt = now();
    // 超时标记用局部变量：不能在 finally 里清掉，否则下面无法区分「超时」与「取消」
    let timedOut = false;
    // 步骤超时计时器是活跃工作，不可 unref
    const timer = timeoutMs > 0
      ? setTimeout(() => {
        timedOut = true;
        step.phase = 'draining';
        patchStep(ctx, step, { detail: `已超时（${timeoutMs}ms），正在终止` });
        appendLog(ctx, step, `[engine] 步骤超时（${timeoutMs}ms），正在终止\n`, 'stderr');
        step.controller.abort(new Error('步骤超时'));
        for (const handle of ctx.handles) {
          try { handle.cancel?.(); } catch { /* 忽略 */ }
        }
      }, timeoutMs)
      : null;

    setPhase(ctx, step, 'running');
    let result;
    try {
      result = await descriptor.run(rt, job.with ?? {});
    } catch (error) {
      result = { exitCode: 1, error: `${descriptor.type} 执行异常：${error?.message ?? error}` };
    } finally {
      if (timer) clearTimeout(timer);
      // 清理该步骤启动的已结束句柄
      for (const handle of [...ctx.handles]) {
        if (!handle.alive) ctx.handles.delete(handle);
      }
    }

    if (ctx.cancelled || step.controller.signal.aborted) {
      if (timedOut) {
        return {
          status: 'failed',
          exitCode: result?.exitCode ?? 124,
          outputs: result?.outputs,
          error: `步骤超时（${timeoutMs}ms）`,
        };
      }
      return { status: 'canceled', exitCode: result?.exitCode ?? 130, outputs: result?.outputs, error: '运行已取消' };
    }

    // 7) 结果判定：节点返回 { exitCode, outputs?, error? }
    const exitCode = result?.exitCode === undefined ? 0 : result.exitCode;
    const outputs = result?.outputs ?? {};
    if (outputs.durationMs === undefined) outputs.durationMs = now() - startedAt;

    if (exitCode === 0 && !result?.error) {
      return { status: 'success', exitCode: 0, outputs };
    }
    return {
      status: 'failed',
      exitCode,
      outputs,
      error: result?.error || `退出码 ${exitCode}`,
    };
  }

  function sleepInterruptible(ms, signal) {
    return new Promise((resolve) => {
      if (signal?.aborted) {
        resolve();
        return;
      }
      // 重试退避属于活跃工作，不可 unref
      const timer = setTimeout(() => {
        signal?.removeEventListener?.('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      signal?.addEventListener?.('abort', onAbort, { once: true });
    });
  }

  /* ------------------------------------------------------------ 调度器 */

  /** 把无法再运行的 pending 步骤标记为 skipped，避免调度器空转 */
  function resolveBlocked(ctx) {
    let changed = false;
    for (const id of ctx.graph.order) {
      const step = ctx.steps[id];
      if (!step || step.status !== 'pending') continue;
      const meta = ctx.graph.jobs[id];
      const mode = step.when || meta.job?.when || 'on_success';

      if (mode === 'manual' && ctx.decision[id] !== 'run' && ctx.decision[id] !== 'skip') continue;

      const depsSettled = meta.needs.every((dep) => isSettled(ctx.steps[dep], ctx.skipped));
      if (!depsSettled) continue;
      if (mode === 'always') continue; // readySet 决定

      const satisfied = meta.needs.every((dep) => isSatisfied(
        ctx.steps[dep], ctx.skipped, ctx.decision, ctx.graph.jobs[dep],
      ));
      if (!satisfied) {
        patchStep(ctx, step, {
          status: 'skipped',
          phase: 'settled',
          finishedAt: now(),
          detail: '前置步骤未成功，按 when=on_success 跳过',
        });
        ctx.skipped.add(id);
        changed = true;
      }
    }
    return changed;
  }

  /** 是否存在等待人工决策的 pending 步骤 */
  function hasManualHold(ctx) {
    for (const id of ctx.graph.order) {
      const step = ctx.steps[id];
      if (!step || step.status !== 'pending') continue;
      const meta = ctx.graph.jobs[id];
      const mode = step.when || meta.job?.when || 'on_success';
      if (mode === 'manual' && ctx.decision[id] !== 'run' && ctx.decision[id] !== 'skip') return true;
    }
    return false;
  }

  async function runDag(ctx) {
    for (;;) {
      if (ctx.cancelled) return;
      resolveBlocked(ctx);

      const runningPromises = [...ctx.running.values()];
      const pending = Object.values(ctx.steps).filter((s) => s.status === 'pending');

      if (!pending.length && !runningPromises.length) return;

      const ready = readySet({
        graph: ctx.graph,
        steps: ctx.steps,
        skipped: ctx.skipped,
        running: ctx.running,
        decision: ctx.decision,
      });

      const slots = Math.max(0, maxParallelSteps - runningPromises.length);
      const batch = ready.slice(0, slots);
      for (const id of batch) startStep(ctx, id);

      const nowRunning = [...ctx.running.values()];
      if (nowRunning.length) {
        await Promise.race(nowRunning.map((p) => p.catch(() => {})));
        continue;
      }

      if (!batch.length) {
        // 没有任何可运行项：等待人工决策，或判定为死锁
        if (hasManualHold(ctx)) {
          await waitWake(ctx, 1000);
          continue;
        }
        return;
      }
    }
  }

  /** staged 模式：阶段串行，阶段内 parallel 决定并/串行 */
  async function runStaged(ctx) {
    for (const stage of ctx.graph.stagePlan) {
      if (ctx.cancelled) return;
      const stageObj = (ctx.pipeline.stages ?? []).find((s) => String(s.id) === stage.id) ?? null;
      const jobs = stage.jobs.filter((id) => ctx.steps[id]?.status === 'pending');
      if (!jobs.length) continue;

      // 阶段级 when 判定：前置阶段失败时的传播
      const anyPredecessorFailed = Object.values(ctx.steps).some((s) => (
        (s.status === 'failed' && !s.allowFailure) || s.status === 'canceled'
      ));

      const jobOf = (id) => (stageObj?.jobs ?? []).find((j) => String(j.id) === String(id)) ?? {};

      const decisionFor = (id) => {
        const job = jobOf(id);
        const mode = job.when ?? 'on_success';
        if (mode === 'manual' && ctx.decision[id] !== 'run') return 'hold';
        if (mode === 'always') return 'run';
        if (anyPredecessorFailed) return 'skip';
        return 'run';
      };

      // 先处理跳过
      const runnable = [];
      for (const id of jobs) {
        const decision = decisionFor(id);
        if (decision === 'skip') {
          patchStep(ctx, ctx.steps[id], {
            status: 'skipped',
            phase: 'settled',
            finishedAt: now(),
            detail: '前置阶段未成功，跳过',
          });
          ctx.skipped.add(id);
        } else if (decision === 'run') {
          runnable.push(id);
        }
      }

      if (stage.parallel) {
        // 阶段内并行（按 maxParallelSteps 分批）
        const waves = [];
        for (let i = 0; i < runnable.length; i += maxParallelSteps) {
          waves.push(runnable.slice(i, i + maxParallelSteps));
        }
        for (const wave of waves) {
          if (ctx.cancelled) return;
          await Promise.all(wave.map((id) => startStep(ctx, id)));
        }
      } else {
        for (const id of runnable) {
          if (ctx.cancelled) return;
          await startStep(ctx, id);
        }
      }

      // 阶段结束后：若存在等待人工决策的步骤，等待放行后继续本阶段
      for (;;) {
        if (ctx.cancelled) return;
        const held = stage.jobs.filter((id) => {
          const step = ctx.steps[id];
          if (!step || step.status !== 'pending') return false;
          return (jobOf(id).when ?? 'on_success') === 'manual' && ctx.decision[id] !== 'run';
        });
        if (!held.length) break;
        await waitWake(ctx, 1000);
        const toRun = held.filter((id) => ctx.decision[id] === 'run');
        if (toRun.length) {
          if (stage.parallel) await Promise.all(toRun.map((id) => startStep(ctx, id)));
          else for (const id of toRun) await startStep(ctx, id);
        }
      }

      // 阶段内仍有 pending（例如依赖未满足）→ 标记跳过，避免整条流水线卡住
      for (const id of stage.jobs) {
        const step = ctx.steps[id];
        if (step?.status === 'pending') {
          patchStep(ctx, step, {
            status: 'skipped',
            phase: 'settled',
            finishedAt: now(),
            detail: '同阶段前置未成功，跳过',
          });
          ctx.skipped.add(id);
        }
      }
    }
  }

  /** 子流水线启动（pipeline.call 节点用） */
  async function startSubRun(parentCtx, pipelineId, options = {}) {
    const pipeline = store?.pipelines?.get?.(String(pipelineId));
    if (!pipeline) throw new Error(`子流水线不存在：${pipelineId}`);
    return start({
      pipeline,
      variables: options.variables ?? {},
      trigger: options.trigger ?? 'pipeline.call',
      parentRunId: options.parentRunId ?? parentCtx?.run?.id ?? null,
      parentStepId: options.parentStepId ?? null,
      callChain: [...(parentCtx?.run?.callChain ?? []), String(parentCtx?.pipeline?.id ?? '')].filter(Boolean),
    });
  }

  /* ------------------------------------------------------------ 运行创建 */

  function buildRun({ pipeline, variables, trigger, parentRunId, parentStepId, callChain, runId, pipelineSnapshot }) {
    const steps = {};
    for (const stage of pipeline.stages ?? []) {
      for (const job of stage.jobs ?? []) {
        const step = newStep(job, stage);
        step.server = String(
          job.server || pipeline.defaults?.server || settings.defaultServer || DEFAULT_SETTINGS.defaultServer,
        );
        steps[step.id] = step;
      }
    }
    return {
      id: runId,
      pipelineId: String(pipeline.id),
      pipelineName: String(pipeline.name ?? pipeline.id),
      // 契约 §2.5 的 run 形状扩展（**可选字段**）：冻结本次运行使用的定义。
      // 运行创建后用户再编辑 store 里的流水线，不会影响这次运行及其重试/复跑。
      pipelineSnapshot: pipelineSnapshot ?? snapshotPipeline(pipeline),
      status: 'queued',
      trigger: trigger ?? 'manual',
      startedAt: 0,
      finishedAt: 0,
      variables: { ...(variables ?? {}) },
      steps,
      parentRunId: parentRunId ?? null,
      parentStepId: parentStepId ?? null,
      callChain: callChain ?? [String(pipeline.id)],
    };
  }

  function generateRunId() {
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const rand = Math.random().toString(36).slice(2, 8);
    return `run-${stamp}-${rand}`;
  }

  /* ------------------------------------------------------------ 定义快照 */

  /**
   * 冻结一份流水线定义作为运行快照（**只存定义，不存运行时状态**）。
   * 结构化深拷贝后 Object.freeze，防止运行期被别处（store 热更新、编辑器）改写。
   * 纯数据深拷贝；对循环引用用 seen 去重，不会无限递归。
   */
  function snapshotPipeline(pipeline) {
    if (!pipeline || typeof pipeline !== 'object') return null;
    try {
      return deepFreeze(structuredClone(pipeline));
    } catch {
      // structuredClone 不可用或含不可克隆值（如函数）：退化为浅拷贝，仍保证不共享引用
      try {
        return deepFreeze(JSON.parse(JSON.stringify(pipeline)));
      } catch {
        return null;
      }
    }
  }

  function deepFreeze(value, seen = new Set()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    for (const key of Object.keys(value)) deepFreeze(value[key], seen);
    return Object.freeze(value);
  }

  /** 广播一次「快照缺失，降级用当前定义」的警告（每个 run 只报一次） */
  const degradedRuns = new Set();
  function warnSnapshotMissing(runId, reason) {
    if (degradedRuns.has(runId)) return;
    degradedRuns.add(runId);
    emit(onEvent, {
      type: 'warning',
      runId,
      message: `运行 ${runId} 没有定义快照（${reason}），已降级使用当前流水线定义`,
    });
  }

  /**
   * 解析一次运行应当使用的流水线定义：**快照优先，旧数据降级回当前定义**。
   * 这是「编辑流水线不影响已运行/运行中的运行」的唯一入口——
   * 任何需要按定义调度的路径都必须经过它，不得直接 store.pipelines.get()。
   *
   * @param {object} run 运行记录（可能来自磁盘的旧数据）
   * @returns {object} 流水线定义
   */
  function resolveRunPipeline(run) {
    const runId = String(run?.id ?? '');
    const snapshot = run?.pipelineSnapshot;
    if (snapshot && typeof snapshot === 'object' && (snapshot.stages || snapshot.id)) {
      return snapshot;
    }
    // 降级（向后兼容）：旧 run 记录没有快照，回退到当前定义。
    // 这是「老数据也能重试」的唯一保障，绝不能因为缺快照而抛错。
    const current = store?.pipelines?.get?.(String(run.pipelineId));
    warnSnapshotMissing(runId || '(未知)', current ? '历史运行未保存快照' : '历史运行未保存快照且流水线已不存在');
    if (!current) {
      // 与改造前完全一致的行为：流水线被删且无快照时给出可读错误
      throw new Error(`流水线不存在：${run.pipelineId}`);
    }
    return current;
  }

  /** 调度前的统一校验（非法流水线必须给出可读、可修的错误） */
  function prepareGraph(pipeline) {
    if (!pipeline || typeof pipeline !== 'object') {
      throw new Error('流水线不可执行：pipeline 缺失或不是对象');
    }
    // 契约 §2.1：id 必须匹配 [a-z0-9][a-z0-9-_]{0,63}
    const id = String(pipeline.id ?? '');
    if (!/^[a-z0-9][a-z0-9-_]{0,63}$/.test(id)) {
      throw new Error(
        `流水线不可执行：id "${id}" 非法，必须匹配 [a-z0-9][a-z0-9-_]{0,63}（小写字母/数字开头，可含 - 与 _，不超过 64 字符）`,
      );
    }
    // 契约 §2.1：name 必填
    if (typeof pipeline.name !== 'string' || !pipeline.name.trim()) {
      throw new Error('流水线不可执行：name 缺失或为空');
    }
    const graph = buildGraph(pipeline);
    if (graph.errors.length) {
      const fatal = graph.errors.filter((e) => e.code !== 'unknown-dependency');
      const detail = (fatal.length ? fatal : graph.errors)
        .map((e) => `${e.path}: ${e.message}`)
        .join('；');
      throw new Error(`流水线不可执行：${detail}`);
    }
    if (graph.mode === 'invalid') {
      throw new Error('流水线调度模式非法：needs 与 parallel 阶段不得混用');
    }
    // 空流水线：用 jobs 数量判断（不能用 graph.order —— 有环时 order 也是空的）
    if (Object.keys(graph.jobs).length === 0) {
      throw new Error('流水线不可执行：没有任何 job');
    }
    // 环检测必须在「空流水线」判断之后但早于依赖顺序使用；
    // 注意顺序：有环时 topoOrder 为空，若先判空会把环误报成「没有任何 job」。
    const cycle = detectCycle(graph);
    if (cycle.cyclic) {
      throw new Error(`流水线存在依赖环：${cycle.cycle.join(' → ')}`);
    }
    return graph;
  }

  /** 创建运行上下文 */
  function createContext({ run, pipeline, graph }) {
    const ctx = {
      run,
      pipeline,
      graph,
      steps: run.steps,
      running: new Map(),
      skipped: new Set(),
      decision: {},
      cancelled: false,
      approvals: new Map(),
      wakers: new Set(),
      handles: new Set(),
      warnedSecrets: new Set(),
      controller: new AbortController(),
      runtimeInject: {},
    };
    contexts.set(run.id, ctx);
    return ctx;
  }

  /** 收尾：结算状态、持久化、释放并发槽 */
  async function finalizeRun(ctx, { pendingCountsAsFailure = false } = {}) {
    const { run } = ctx;
    if (ctx.cancelled) {
      run.status = 'canceled';
    } else {
      const list = Object.values(run.steps ?? {});
      const failed = list.filter((s) => s.status === 'failed' && !s.allowFailure);
      const canceled = list.filter((s) => s.status === 'canceled');
      const pending = list.filter((s) => s.status === 'pending');
      run.status = canceled.length
        ? 'canceled'
        : (failed.length || (pendingCountsAsFailure && pending.length)) ? 'failed' : 'success';
    }
    run.finishedAt = now();
    emitRun(ctx);
    await persistRun(ctx);
    contexts.delete(run.id);
    wake(ctx);
    releaseRunSlot();
    return run.status;
  }

  /**
   * 启动一次运行。
   * @param {string|{runId?:string, pipeline?:object, variables?:object, trigger?:string}} input
   * @returns {{runId:string, run:object, wait:Function, cancel:Function, promise:Promise}}
   */
  function start(input) {
    let run;
    let pipeline;

    if (typeof input === 'string') {
      const existing = store?.runs?.get?.(input);
      if (!existing) throw new Error(`运行不存在：${input}`);
      run = existing;
      // 复用既有运行：以该运行的定义快照为准，编辑流水线不得改变它的行为
      pipeline = resolveRunPipeline(run);
    } else if (input && typeof input === 'object') {
      pipeline = input.pipeline;
      if (!pipeline && input.runId) {
        run = store?.runs?.get?.(input.runId);
        if (run) pipeline = resolveRunPipeline(run);
      }
      if (!pipeline) throw new Error('start 需要 pipeline 或可用的 runId');
    } else {
      throw new Error('start 需要 runId 或 { pipeline, variables }');
    }

    if (run && contexts.has(run.id)) {
      throw new Error(`运行已在进行中：${run.id}`);
    }

    // 新运行：先把提交时的定义冻结成快照，**并用这份冻结副本去建图与执行**。
    // 这样调用方在 start 之后改写自己手里的对象、或去编辑 store，都影响不到本次运行。
    let freshSnapshot = null;
    if (!run) {
      freshSnapshot = snapshotPipeline(pipeline);
      if (freshSnapshot) pipeline = freshSnapshot;
    }

    const graph = prepareGraph(pipeline);

    if (!run) {
      run = buildRun({
        pipeline,
        pipelineSnapshot: freshSnapshot,
        variables: input?.variables,
        trigger: input?.trigger,
        parentRunId: input?.parentRunId,
        parentStepId: input?.parentStepId,
        callChain: input?.callChain,
        runId: input?.runId ?? generateRunId(),
      });
    } else {
      // 复用已有 run 记录：重置步骤状态（重跑场景）
      for (const step of Object.values(run.steps ?? {})) {
        Object.assign(step, {
          status: 'pending',
          phase: 'queued',
          startedAt: 0,
          finishedAt: 0,
          exitCode: null,
          attempt: 0,
          error: '',
          detail: '',
          outputs: {},
          bytes: 0,
          lastOutputAt: 0,
        });
      }
      run.status = 'queued';
      run.finishedAt = 0;
    }

    // 每次运行开始时重建打码词表基线（运行期由 resolveEnv 继续并入 secret）
    if (typeof logs.setMask === 'function') logs.setMask(config.mask ?? []);

    const ctx = createContext({ run, pipeline, graph });

    let resolveDone;
    const done = new Promise((resolve) => { resolveDone = resolve; });

    const promise = (async () => {
      await acquireRunSlot();
      try {
        if (ctx.cancelled) {
          run.status = 'canceled';
        } else {
          run.status = 'running';
          run.startedAt = run.startedAt || now();
          await logs.ensureRun(run.id).catch(() => {});
          emitRun(ctx);
          await persistRun(ctx);

          if (graph.mode === 'staged') await runStaged(ctx);
          else await runDag(ctx);
        }
      } catch (error) {
        run.status = 'failed';
        emit(onEvent, { type: 'warning', runId: run.id, message: `引擎异常：${error?.message ?? error}` });
      } finally {
        const status = await finalizeRun(ctx);
        resolveDone({ runId: run.id, status, run });
      }
    })();

    return {
      runId: run.id,
      run,
      promise,
      async wait(options = {}) {
        const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 0;
        if (!timeoutMs) {
          await promise;
          return { runId: run.id, status: run.status, run };
        }
        let timer = null;
        const timeout = new Promise((resolve) => {
          // 等待超时计时器同样属于活跃工作，不可 unref
          timer = setTimeout(() => resolve('timeout'), timeoutMs);
        });
        const result = await Promise.race([promise, timeout]);
        if (timer) clearTimeout(timer);
        if (result === 'timeout') {
          const error = new Error(`等待运行超时（${timeoutMs}ms）：${run.id}`);
          error.code = 'WAIT_TIMEOUT';
          throw error;
        }
        return { runId: run.id, status: run.status, run };
      },
      cancel: () => cancel(run.id),
    };
  }

  /* ------------------------------------------------------------ 运行控制 */

  /**
   * 取消一个运行：中止信号 + 逐个取消子进程 + 待运行步骤置 canceled。
   * 幂等：运行不存在或已终态时返回 {ok:false, error}，不抛异常。
   * @returns {Promise<{ok:boolean, run?:object, error?:string}>}
   */
  async function cancel(runId) {
    const ctx = contexts.get(String(runId));
    if (!ctx) {
      const run = store?.runs?.get?.(String(runId));
      if (!run) return { ok: false, error: `运行不存在：${runId}` };
      if (['success', 'failed', 'canceled'].includes(run.status)) {
        return { ok: false, error: `运行已结束（${run.status}），无需取消` };
      }
      return { ok: false, error: '运行未在本引擎中活动' };
    }

    ctx.cancelled = true;
    ctx.controller.abort(new Error('运行已取消'));

    for (const handle of ctx.handles) {
      try { handle.cancel?.(); } catch { /* 忽略 */ }
    }
    for (const stepId of ctx.running.keys()) {
      try { ctx.steps[stepId]?.controller?.abort(new Error('运行已取消')); } catch { /* 忽略 */ }
    }
    for (const step of Object.values(ctx.steps)) {
      if (step.status === 'pending') {
        patchStep(ctx, step, {
          status: 'canceled',
          phase: 'settled',
          finishedAt: now(),
          detail: '运行已取消',
          error: '运行已取消',
        });
      }
    }
    // 释放等待中的审批
    for (const entry of ctx.approvals.values()) {
      try { entry.reject(new Error('运行已取消')); } catch { /* 忽略 */ }
    }
    ctx.approvals.clear();
    wake(ctx);

    emitRun(ctx);
    await persistRun(ctx);
    return { ok: true, run: ctx.run };
  }

  /**
   * 重试整个运行：默认**新建一次运行**（沿用同一流水线与变量）。
   * 需要「原地重跑」请用 { inPlace: true }；重跑单个步骤用 retryStep。
   */
  function retry(runId, options = {}) {
    const previous = store?.runs?.get?.(String(runId));
    if (!previous) throw new Error(`运行不存在：${runId}`);
    // 从既有运行复跑：沿用它的定义快照（旧数据降级回当前定义）
    const pipeline = resolveRunPipeline(previous);

    if (options.inPlace === true) return retryInPlace(previous, pipeline, options);

    return start({
      pipeline,
      variables: { ...(previous.variables ?? {}), ...(options.variables ?? {}) },
      trigger: options.trigger ?? 'retry',
    });
  }

  /**
   * 原地重跑：重置失败/取消/跳过的步骤后继续调度。
   * @param {object} run
   * @param {object} pipeline
   * @param {{stepIds?:string[], force?:boolean}} [options]
   */
  function retryInPlace(run, pipeline, options = {}) {
    const graph = prepareGraph(pipeline);
    const steps = run.steps ?? {};
    const reset = [];

    // scope：只重置指定步骤（含下游，由 retryStep 计算好）
    const scope = Array.isArray(options.stepIds) && options.stepIds.length
      ? new Set(options.stepIds.map(String))
      : null;
    // force：范围由调用方明确指定（retryStep），范围内无论当前状态都重置
    const force = options.force === true;

    for (const step of Object.values(steps)) {
      if (scope && !scope.has(step.id)) continue;
      if (!force && step.status === 'running') continue;
      const shouldReset = force || ['failed', 'canceled', 'skipped'].includes(step.status);
      if (!shouldReset) continue;
      Object.assign(step, {
        status: 'pending',
        phase: 'queued',
        startedAt: 0,
        finishedAt: 0,
        exitCode: null,
        error: '',
        detail: '',
        outputs: {},
        attempt: 0,
      });
      reset.push(step.id);
    }

    if (!reset.length) {
      // 没有任何步骤需要重跑：返回与正常路径**完全同形**的句柄（含 promise）
      const settled = { runId: run.id, status: run.status, run };
      return {
        runId: run.id,
        run,
        reset: [],
        wait: async () => settled,
        promise: Promise.resolve(settled),
      };
    }

    run.status = 'queued';
    run.finishedAt = 0;

    if (typeof logs.setMask === 'function') logs.setMask(config.mask ?? []);
    const ctx = createContext({ run, pipeline, graph });

    const promise = (async () => {
      await acquireRunSlot();
      try {
        if (ctx.cancelled) {
          run.status = 'canceled';
        } else {
          run.status = 'running';
          run.startedAt = run.startedAt || now();
          await logs.ensureRun(run.id).catch(() => {});
          emitRun(ctx);
          if (graph.mode === 'staged') await runStaged(ctx);
          else await runDag(ctx);
        }
      } catch (error) {
        run.status = 'failed';
        emit(onEvent, { type: 'warning', runId: run.id, message: `引擎异常：${error?.message ?? error}` });
      } finally {
        await finalizeRun(ctx, { pendingCountsAsFailure: true });
      }
    })();

    return {
      runId: run.id,
      run,
      reset,
      wait: async () => {
        await promise;
        return { runId: run.id, status: run.status, run };
      },
      promise,
    };
  }

  /**
   * 重跑单个步骤：重置该步骤及其全部下游，然后继续调度。
   *
   * 契约形状：{runId, stepId, wait, promise}；额外附带 run 与 reset 作为可选信息。
   * @returns {{runId:string, stepId:string, run:object, reset:string[], wait:Function, promise:Promise}}
   */
  function retryStep(runId, stepId) {
    const run = store?.runs?.get?.(String(runId));
    if (!run) throw new Error(`运行不存在：${runId}`);
    // 重试步骤：以该运行的定义快照为准（旧数据降级回当前定义）
    const pipeline = resolveRunPipeline(run);
    const target = String(stepId);
    if (!run.steps?.[target]) throw new Error(`步骤不存在：${stepId}`);
    if (contexts.has(run.id)) throw new Error(`运行正在进行中，无法单独重跑步骤：${runId}`);

    // 收集下游（含自身）
    const graph = prepareGraph(pipeline);
    const affected = new Set([target]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const [id, meta] of Object.entries(graph.jobs)) {
        if (affected.has(id)) continue;
        if (meta.needs.some((dep) => affected.has(dep))) {
          affected.add(id);
          grew = true;
        }
      }
    }

    // 只计算范围，**实际重置交给 retryInPlace**（避免「先重置、后判定」丢范围）
    const handle = retryInPlace(run, pipeline, { stepIds: [...affected], force: true });
    return {
      runId: handle.runId,
      stepId: target,
      run: handle.run,
      reset: handle.reset,
      wait: handle.wait,
      promise: handle.promise,
    };
  }

  /** 查询运行状态 */
  function status(runId) {
    const ctx = contexts.get(String(runId));
    if (ctx) return { run: ctx.run, active: true, summary: summarizeRun(ctx.run) };
    const run = store?.runs?.get?.(String(runId));
    if (!run) return null;
    return { run, active: false, summary: summarizeRun(run) };
  }

  /** 当前活跃运行 id 列表 */
  function active() {
    return [...contexts.keys()];
  }

  /** 释放：取消全部活跃运行 */
  async function dispose() {
    for (const runId of [...contexts.keys()]) {
      await cancel(runId).catch(() => {});
    }
  }

  return {
    start,
    cancel,
    retry,
    retryStep,
    approve,
    status,
    active,
    dispose,
    summarizeRun,
    // 便于测试
    get activeCount() { return activeRuns; },
    contexts,
    maxConcurrentRuns,
    maxParallelSteps,
  };
}

export default createEngine;
