/**
 * src/engine/nodes/exec.js —— 节点共享的「跑命令 + 收集输出」实现
 *
 * 所有脚本类节点（shell/node/python/ensureRuntime 等）都走这里，
 * 保证日志上报、超时、取消、退出码判定行为一致。
 */

/** 解析 successExitCodes：'0' / '0,1' / '0-3' / 空(=仅 0) */
export function parseSuccessCodes(spec) {
  const text = String(spec ?? '').trim();
  if (!text) return new Set([0]);
  const out = new Set();
  for (const part of text.split(/[,;\s]+/)) {
    if (!part) continue;
    const range = part.match(/^(-?\d+)\s*[-~]\s*(-?\d+)$/);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      for (let i = Math.min(from, to); i <= Math.max(from, to); i += 1) out.add(i);
      continue;
    }
    const num = Number(part);
    if (Number.isFinite(num)) out.add(num);
  }
  if (!out.size) out.add(0);
  return out;
}

/**
 * 执行一条命令并收集输出。
 *
 * 日志职责划分（重要，避免重复写）：
 * - `rt.spawn` 已经负责把子进程输出实时写进步骤日志（见 run.js 的 rt.spawn）。
 *   因此这里**绝不能再调用 rt.log**，否则同一个 chunk 会被写两遍，
 *   前端实时日志面板会每行显示两次。
 * - 本函数只负责**收集** stdout/stderr 文本，供节点构造 outputs 与判定退出码。
 *
 * @param {object} rt 节点运行时上下文
 * @param {{argv:string[], cwd?:string, env?:object, timeoutMs?:number, label?:string}} options
 * @returns {Promise<{exitCode:number|null, signal:string|null, timedOut:boolean, canceled:boolean,
 *                    stdout:string, stderr:string, durationMs:number}>}
 */
export async function spawnCollect(rt, options = {}) {
  const { argv, cwd, env, timeoutMs, label } = options;
  const stdoutChunks = [];
  const stderrChunks = [];

  // rt.spawn 统一入口（本地与 ssh 都由执行器实现）；日志透传由 rt.spawn 负责
  const handle = await rt.spawn(argv, {
    cwd: cwd ?? rt.cwd,
    env: env ?? rt.env,
    timeoutMs,
    label: label ?? rt.step?.name,
    signal: rt.signal,
    onData: (chunk) => {
      // 仅收集，不写日志（rt.spawn 已经写过一次）
      if (chunk.stream === 'stderr') stderrChunks.push(chunk.text);
      else stdoutChunks.push(chunk.text);
    },
  });

  // 让 engine 能通过 rt.setPhase 反映真实阶段
  if (typeof rt.setPhase === 'function') rt.setPhase('running');

  let result;
  try {
    result = await handle.done;
  } catch (error) {
    return {
      exitCode: null,
      signal: null,
      timedOut: false,
      canceled: false,
      stdout: stdoutChunks.join(''),
      stderr: `${stderrChunks.join('')}${error?.message ?? error}`,
      durationMs: 0,
      error: String(error?.message ?? error),
    };
  }

  return {
    exitCode: result?.exitCode ?? null,
    signal: result?.signal ?? null,
    timedOut: Boolean(result?.timedOut),
    canceled: Boolean(result?.canceled),
    stdout: stdoutChunks.join(''),
    stderr: stderrChunks.join(''),
    durationMs: result?.durationMs ?? 0,
  };
}

/**
 * 把一次执行结果转换成节点返回值（统一的失败文案）。
 * @returns {{exitCode:number, outputs?:object, error?:string}}
 */
export function toNodeResult(result, options = {}) {
  const successCodes = options.successCodes ?? new Set([0]);
  const baseOutputs = {
    durationMs: result.durationMs,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    ...(options.outputs ?? {}),
  };

  if (result.canceled) {
    return { exitCode: result.exitCode ?? 130, outputs: baseOutputs, error: '步骤已取消' };
  }
  if (result.timedOut) {
    return {
      exitCode: result.exitCode ?? 124,
      outputs: baseOutputs,
      error: `执行超时（${options.timeoutMs ?? 0}ms）`,
    };
  }
  if (result.error && result.exitCode === null) {
    return { exitCode: 127, outputs: baseOutputs, error: result.error };
  }
  const code = result.exitCode;
  baseOutputs.exitCode = code;
  if (code !== null && successCodes.has(code)) {
    return { exitCode: 0, outputs: baseOutputs };
  }
  const detail = (result.stderr || result.stdout || '').trim().split(/\r?\n/).slice(-3).join('\n');
  return {
    exitCode: code === null ? 1 : code,
    outputs: baseOutputs,
    error: `命令退出码 ${code}${result.signal ? `（信号 ${result.signal}）` : ''}${detail ? `：${detail}` : ''}`,
  };
}

/**
 * 解析解释器可执行文件。
 * @param {object} rt
 * @param {{kind:'node'|'python', version?:string, allowInstall?:boolean}} request
 * @returns {Promise<{path:string, version:string, installed:boolean, actions:any[]}>}
 */
export async function resolveInterpreter(rt, request) {
  const kind = request.kind;
  const version = String(request.version ?? '').trim();
  const fallbacks = kind === 'python'
    ? (process.platform === 'win32' ? ['python', 'python3', 'py'] : ['python3', 'python'])
    : ['node'];

  // 未指定版本：直接用 PATH 上的解释器
  if (!version) {
    return { path: fallbacks[0], version: '', installed: false, actions: [], fromPath: true };
  }

  if (typeof rt.provision !== 'function') {
    return { path: fallbacks[0], version: '', installed: false, actions: [], warning: '未提供 provisioner，忽略版本要求' };
  }

  const requirement = kind === 'python' ? { python: version } : { node: version };
  const result = await rt.provision(requirement, { allowInstall: request.allowInstall === true });
  if (result?.ok && result.resolved) {
    const resolved = result.resolved[kind] || result.resolved[`${kind}:${version}`];
    if (resolved) {
      return {
        path: resolved,
        version,
        installed: (result.actions ?? []).some((a) => a.kind === 'install'),
        actions: result.actions ?? [],
      };
    }
  }
  const error = new Error(
    `无法解析 ${kind} ${version}：${result?.error ?? '未知原因'}` +
    `${result?.suggestion ? `。建议：${result.suggestion}` : ''}`,
  );
  error.code = 'RUNTIME_UNRESOLVED';
  error.actions = result?.actions ?? [];
  error.suggestion = result?.suggestion ?? '';
  throw error;
}

export default { spawnCollect, toNodeResult, parseSuccessCodes, resolveInterpreter };
