/**
 * 环境供给器（契约 §3.8）。
 *
 * ```js
 * export function createProvisioner({ ctx, getServer })
 * await provisioner.ensure(server, requirement, { allowInstall, onLog, signal })
 * await provisioner.probe(server)
 * ```
 *
 * 安全底线（**不得为了「好用」而放宽**）：
 * - `allowInstall` **默认 false**：缺失时只返回 { ok:false, error, suggestion }，绝不擅自改远端系统；
 * - 所有命令以 argv 数组执行（契约 §5.1）；版本号/包名先过白名单校验；
 * - 会执行远程脚本的方案（curl|sh）默认关闭，需 config.allowRemoteInstallerScripts 显式开启；
 * - 免密 sudo 不可用时不尝试交互式提权（远端无 TTY），直接如实失败并给建议。
 *
 * 可测试性：执行通道通过 `resolveExecutor` 注入。verifier 传入假 executor 即可
 * 完整驱动「方案优先级 / 不安装 / 全失败」等分支，无需 SSH。
 */
import { emitLog, normalizeError, nonEmptyLines, truncate } from '../executors/ssh/util.js';
import { SshError } from '../executors/ssh/errors.js';
import { composeProbe, buildProbeScript, emptyProbe, inferFamilyFromProbe } from './probe.js';
import {
  assertPackageName,
  assertVersionSpec,
  buildSuggestion,
  describeMissing,
  nodeInstallPlans,
  packageInstallPlans,
  pickPackageManager,
  pythonCandidates,
  pythonInstallPlans,
  whichArgv,
  displayCommand,
} from './plans.js';

/** 默认单条命令超时。 */
const TIMEOUTS = {
  probe: 20_000,
  which: 15_000,
  version: 15_000,
  install: 600_000,
};

/**
 * 版本匹配：请求 `3.11` 应匹配 `3.11.9`，但不匹配 `3.1` 或 `3.111`。
 * @param {string} actual 实际版本（如 3.11.9）
 * @param {string} requested 请求版本（如 3.11；空串/any 表示任意）
 */
export function versionMatches(actual, requested) {
  if (!requested || requested === 'any') return Boolean(actual);
  const a = String(actual).split(/[.\-+_]/);
  const r = String(requested).split('.');
  for (let i = 0; i < r.length; i += 1) {
    if ((a[i] || '') !== r[i]) return false;
  }
  return true;
}

/** 从版本输出中抽版本号（Python 2 把 --version 写到 stderr，所以要合并两路）。 */
function pickVersion(stdout, stderr) {
  const text = `${stdout}\n${stderr}`;
  const m = text.match(/(\d+\.\d+(?:\.\d+)?(?:[-+._][0-9A-Za-z.]+)?)/);
  return m ? m[1] : '';
}

/**
 * 创建供给器。
 *
 * @param {object} options
 * @param {unknown} [options.ctx] 宿主上下文
 * @param {(idOrServer:any) => any} [options.getServer] 由 id 取 server（store 提供）
 * @param {unknown} [options.log]
 * @param {object} [options.config] 插件配置
 * @param {(server:object) => Promise<any>} [options.resolveExecutor] 注入执行器解析（测试用）
 * @param {object} [options.store] 可选 store（用于回写 runtimes/probe）
 * @param {(server:object, patch:object) => Promise<void>} [options.updateServer] 可选显式回写
 * @param {number} [options.probeTtlMs] probe 缓存时长，默认 5 分钟
 */
export function createProvisioner(options = {}) {
  const {
    ctx,
    getServer,
    log,
    config = {},
    resolveExecutor,
    store,
    updateServer,
    probeTtlMs = Number(config.probeTtlMs ?? 300_000),
  } = options;

  /** serverId → { probe, paths, home, family, at } */
  const probeCache = new Map();

  /** 解析 server 参数：允许传对象或 id。 */
  async function toServer(input) {
    if (input && typeof input === 'object') return input;
    const resolved = typeof getServer === 'function' ? await getServer(input) : undefined;
    if (!resolved) throw new SshError(`找不到服务器「${input}」`, 'server-not-found');
    return resolved;
  }

  /** 取执行器：优先注入，其次宿主服务，最后惰性 import 默认注册表。 */
  async function executorFor(server) {
    if (typeof resolveExecutor === 'function') {
      const exec = await resolveExecutor(server);
      if (exec) return exec;
    }
    const fromCtx = ctx && typeof ctx.get === 'function' ? safeGet(ctx, 'devopsExecutors') : null;
    if (fromCtx && typeof fromCtx.resolve === 'function') return fromCtx.resolve(server);
    if (ctx && typeof ctx.get === 'function') {
      const engines = safeGet(ctx, 'devopsEngine');
      if (engines?.executors?.resolve) return engines.executors.resolve(server);
    }
    try {
      const mod = await import('../executors/index.js');
      if (typeof mod?.createExecutorRegistry === 'function') {
        const registry = mod.createExecutorRegistry({ ctx, log, config, provisioner: api });
        return registry.resolve(server);
      }
    } catch (error) {
      throw new SshError(
        `无法解析服务器「${server?.id}」的执行器，且默认执行器注册表不可用（${normalizeError(error).message}）。` +
          '请先完成 engine 模块，或为供给器注入 resolveExecutor。',
        'executor-unavailable',
      );
    }
    throw new SshError('无法解析执行器：缺少 executors 注册表', 'executor-unavailable');
  }

  /**
   * 在目标服务器上执行一条命令（argv 数组），收集输出。
   *
   * @param {object} server
   * @param {object} spec
   * @param {string[]} spec.argv
   * @param {boolean} [spec.sudo]
   * @param {string} [spec.cwd]
   * @param {number} [spec.timeoutMs]
   * @param {string} [spec.label]
   * @param {AbortSignal} [spec.signal]
   * @param {(text:string, stream:string)=>void} [spec.onLog]
   * @returns {Promise<{ exitCode:number|null, stdout:string, stderr:string, command:string, timedOut:boolean, error:string }>}
   */
  async function execOn(server, spec) {
    const executor = await executorFor(server);
    const argv = spec.argv;
    // note: 不加 sudo 前缀。提权交给执行器（spec.sudo），否则 SSH 执行器会再包一层 sudo，
    // 变成 `sudo -n 'sudo' '-n' ...` 这种错误且不可用的命令。
    const command = displayCommand(argv);
    const stdoutChunks = [];
    const stderrChunks = [];
    const onLog = spec.onLog;

    if (onLog) onLog(`$ ${spec.sudo ? 'sudo -n ' : ''}${command}`, 'command');
    emitLog(log, 'debug', `[provision] ${server?.id || '?'} $ ${spec.sudo ? 'sudo -n ' : ''}${command}`);

    const handle = await executor.run({
      argv,
      sudo: spec.sudo === true,
      cwd: spec.cwd || server?.workdir || '',
      env: spec.env,
      timeoutMs: spec.timeoutMs ?? TIMEOUTS.install,
      signal: spec.signal,
      label: spec.label || 'provision',
      onData: (chunk) => {
        const text = typeof chunk === 'string' ? chunk : chunk?.text ?? '';
        const stream = typeof chunk === 'string' ? 'stdout' : chunk?.stream || 'stdout';
        if (!text) return;
        if (stream === 'stderr') stderrChunks.push(text);
        else stdoutChunks.push(text);
        if (onLog) onLog(text, stream);
      },
    });

    let result;
    try {
      result = await handle.done;
    } catch (error) {
      return {
        exitCode: null,
        stdout: stdoutChunks.join(''),
        stderr: stderrChunks.join(''),
        command,
        timedOut: false,
        error: normalizeError(error).message,
      };
    }
    return {
      exitCode: typeof result?.exitCode === 'number' ? result.exitCode : result?.exitCode ?? null,
      stdout: stdoutChunks.join(''),
      stderr: stderrChunks.join(''),
      command,
      timedOut: Boolean(result?.timedOut),
      error: '',
    };
  }

  /** 定位可执行文件：优先绝对路径，其次 PATH（command -v）。 */
  async function locate(server, candidate, context) {
    const name = String(candidate ?? '');
    if (!name) return '';
    const expanded = expandHome(name, context?.home);
    if (expanded.includes('/')) {
      const probe = await execOn(server, {
        argv: ['/bin/sh', '-c', 'test -x "$1" && printf %s "$1"', 'dsh-test', expanded],
        timeoutMs: TIMEOUTS.which,
        signal: context?.signal,
      });
      return probe.exitCode === 0 && probe.stdout.trim() ? probe.stdout.trim() : '';
    }
    const probe = await execOn(server, {
      argv: whichArgv(name),
      timeoutMs: TIMEOUTS.which,
      signal: context?.signal,
    });
    const found = probe.stdout.trim().split(/\r?\n/)[0] || '';
    return found.startsWith('/') ? found : '';
  }

  /** 校验候选解释器版本。 */
  async function checkVersion(server, path, context) {
    const res = await execOn(server, {
      argv: [path, '--version'],
      timeoutMs: TIMEOUTS.version,
      signal: context?.signal,
    });
    const version = pickVersion(res.stdout, res.stderr);
    return { version, exitCode: res.exitCode };
  }

  /**
   * 解析一个运行时：返回绝对路径或 ''。
   * 全程只读，不安装任何东西。
   */
  async function resolveRuntime(server, kind, requestedVersion, context) {
    const info = context.info;
    const requested = requestedVersion || '';
    if (kind === 'python') {
      // uv 优先：它能给出自己管理的解释器路径
      if (info.paths.uv || info.probe.managers.includes('uv')) {
        const uv = info.paths.uv || 'uv';
        const r = await execOn(server, {
          argv: [uv, 'python', 'find', requested || '3'],
          timeoutMs: TIMEOUTS.version,
          signal: context.signal,
        });
        const found = r.stdout.trim().split(/\r?\n/).pop() || '';
        if (r.exitCode === 0 && found.startsWith('/')) {
          const check = await checkVersion(server, found, context);
          if (versionMatches(check.version, requested)) {
            return { path: found, version: check.version, source: 'uv' };
          }
        }
      }
      for (const cand of pythonCandidates(requested, info.probe, info.paths)) {
        if (context.signal?.aborted) break;
        const path = await locate(server, cand.candidate, context);
        if (!path) continue;
        // 同名但版本不符（如 python3 实际是 3.9）时继续找下一个候选
        const check = await checkVersion(server, path, context);
        if (versionMatches(check.version, requested)) {
          return { path, version: check.version, source: cand.source };
        }
      }
      return null;
    }

    if (kind === 'node') {
      const candidates = [];
      if (info.paths.node) candidates.push(info.paths.node);
      candidates.push('node', 'nodejs');
      for (const cand of candidates) {
        const path = await locate(server, cand, context);
        if (!path) continue;
        const check = await checkVersion(server, path, context);
        if (versionMatches(check.version, requested)) return { path, version: check.version, source: 'path' };
      }
      // 版本管理器：即使 PATH 里没有目标版本，也可能已装有 nvm/fnm/mise
      if (info.probe.managers.includes('nvm')) {
        const r = await execOn(server, {
          argv: [
            '/bin/bash',
            '-lc',
            'export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"; nvm which "$1" 2>/dev/null',
            'dsh-nvm-which',
            requested || 'node',
          ],
          timeoutMs: TIMEOUTS.version,
          signal: context.signal,
        });
        const found = r.stdout.trim().split(/\r?\n/).pop() || '';
        if (found.startsWith('/')) {
          const check = await checkVersion(server, found, context);
          if (versionMatches(check.version, requested)) return { path: found, version: check.version, source: 'nvm' };
        }
      }
      for (const [manager, argvBuilder] of [
        ['fnm', () => [info.paths.fnm || 'fnm', 'exec', '--using', requested || 'default', '--', 'node', '-e', 'process.stdout.write(process.execPath)']],
        ['mise', () => [info.paths.mise || 'mise', 'which', 'node']],
      ]) {
        if (!info.probe.managers.includes(manager)) continue;
        const r = await execOn(server, { argv: argvBuilder(), timeoutMs: TIMEOUTS.version, signal: context.signal });
        const found = r.stdout.trim().split(/\r?\n/).pop() || '';
        if (r.exitCode === 0 && found.startsWith('/')) {
          const check = await checkVersion(server, found, context);
          if (versionMatches(check.version, requested)) return { path: found, version: check.version, source: manager };
        }
      }
      return null;
    }

    // 普通可执行文件/包
    const path = await locate(server, kind, context);
    if (path) {
      const check = await checkVersion(server, path, context);
      return { path, version: check.version, source: 'path' };
    }
    return null;
  }

  /** 生成某个缺失项的安装方案（按契约优先级）。 */
  function plansFor(server, item, context) {
    const { info } = context;
    if (item.kind === 'python') {
      return pythonInstallPlans({ version: item.version, probe: info.probe, paths: info.paths, config });
    }
    if (item.kind === 'node') {
      return nodeInstallPlans({ version: item.version, probe: info.probe, paths: info.paths, config });
    }
    return packageInstallPlans({ packages: [item.name], probe: info.probe });
  }

  /**
   * 执行一个安装方案。返回是否成功 + 解析出的路径。
   *
   * @returns {Promise<{ ok:boolean, path?:string, version?:string, reason?:string }>}
   */
  async function runPlan(server, item, plan, context) {
    const onLog = context.onLog;
    // 配置闸门优先于权限判断：需要显式开启的高危方案，即使有免密 sudo 也不应执行。
    if (plan.requiresConfig && config[plan.requiresConfig] !== true) {
      return { ok: false, reason: `方案 ${plan.id} 需要配置 ${plan.requiresConfig}=true（默认关闭：会执行远程脚本）` };
    }
    if (plan.needsSudo && context.info.probe.sudo !== 'passwordless') {
      return {
        ok: false,
        reason:
          context.info.probe.sudo === 'password'
            ? '需要 sudo 但远端 sudo 需要密码（非交互无法提权）'
            : '需要 sudo 但远端不可用免密 sudo',
      };
    }

    emitLog(log, 'info', `[provision] 尝试方案 ${plan.id}：${plan.label}`);
    if (onLog) onLog(`▸ 尝试方案：${plan.label}`, 'phase');

    for (const step of plan.steps) {
      if (context.signal?.aborted) return { ok: false, reason: '已取消' };
      // 纵深防御：即使包名来自内部生成，也再校验一次，确保它绝不可能是注入串
      if (plan.kind === 'package' && plan.package) assertPackageName(plan.package);
      const needsSudo = step.needsSudo ?? plan.needsSudo;
      const res = await execOn(server, {
        argv: step.argv,
        sudo: needsSudo,
        timeoutMs: TIMEOUTS.install,
        signal: context.signal,
        label: plan.id,
        onLog,
      });
      context.actions.push({
        kind: plan.kind,
        command: `${needsSudo ? 'sudo -n ' : ''}${res.command}`,
        exitCode: res.exitCode,
        plan: plan.id,
      });
      if (res.exitCode !== 0) {
        if (step.optional) {
          if (onLog) onLog(`（可选步骤失败，继续）${step.label || ''}`, 'warn');
          continue;
        }
        const detail = truncate(`${res.stdout}\n${res.stderr}`.trim(), 800);
        return { ok: false, reason: `步骤失败（退出码 ${res.exitCode}）：${step.label || displayCommand(step.argv)}${detail ? `\n${detail}` : ''}` };
      }
    }

    // 安装后重新解析
    const resolved = await resolveRuntime(server, item.kind, item.version, context);
    if (resolved?.path) return { ok: true, path: resolved.path, version: resolved.version };
    if (plan.resolveArgv) {
      const r = await execOn(server, {
        argv: plan.resolveArgv,
        timeoutMs: TIMEOUTS.version,
        signal: context.signal,
        onLog,
      });
      const found = r.stdout.trim().split(/\r?\n/).pop() || '';
      if (r.exitCode === 0 && found.startsWith('/')) {
        return { ok: true, path: found, version: '' };
      }
    }
    return { ok: false, reason: '安装命令已执行，但之后仍无法定位到该运行时（可能未加入 PATH）' };
  }

  /** 探测（带缓存）。 */
  async function probeInternal(server, opts = {}) {
    const id = String(server?.id ?? server?.host ?? '');
    const cached = probeCache.get(id);
    if (!opts.force && cached && Date.now() - cached.at < probeTtlMs) return cached;

    const res = await execOn(server, {
      argv: ['/bin/sh', '-c', buildProbeScript()],
      timeoutMs: TIMEOUTS.probe,
      signal: opts.signal,
      label: 'probe',
    });

    if (res.exitCode === null || res.error) {
      const probe = emptyProbe(res.error || '探测失败：命令未能执行（连接或执行器错误）');
      return { probe, paths: {}, home: '', family: 'unknown', at: Date.now() };
    }

    const composed = composeProbe(res.stdout, { exitCode: res.exitCode, stderr: res.stderr });
    const info = {
      probe: composed.probe,
      paths: composed.paths,
      home: composed.home || server?.home || '',
      family: composed.family !== 'unknown' ? composed.family : inferFamilyFromProbe(composed.probe),
      at: Date.now(),
    };
    if (composed.probe.error) {
      emitLog(log, 'warn', `[provision] ${id} 探测有告警：${composed.probe.error}`);
    }
    probeCache.set(id, info);
    return info;
  }

  /**
   * 公开的 probe(server)：探测并把结果写回 server.probe（契约 §3.8）。
   * @param {object|string} serverInput
   * @param {object} [opts]
   */
  async function probe(serverInput, opts = {}) {
    const server = await toServer(serverInput);
    const info = await probeInternal(server, { force: opts.force !== false, signal: opts.signal });
    await persist(server, { probe: info.probe });
    return info.probe;
  }

  /**
   * 回写 server 字段（probe / runtimes）。
   * 依次尝试显式 updateServer → store.servers.update → ctx 里的 store → 直接改对象。
   * 回写失败不应让供给失败，如实记录即可。
   */
  async function persist(server, patch) {
    if (!server) return false;
    // 直接写对象（内存中的对象引用，最可靠）
    try {
      Object.assign(server, patch);
      if (patch.runtimes) server.runtimes = { ...(server.runtimes || {}), ...patch.runtimes };
    } catch {
      /* 冻结对象等场景忽略 */
    }
    const id = server.id;
    const applyPatch = (prev) => {
      const next = { ...(prev || server), ...patch, updatedAt: Date.now() };
      if (patch.runtimes) next.runtimes = { ...(prev?.runtimes || server.runtimes || {}), ...patch.runtimes };
      return next;
    };
    try {
      if (typeof updateServer === 'function') {
        await updateServer(server, patch);
        return true;
      }
      const stores = [store, ctx && typeof ctx.get === 'function' ? safeGet(ctx, 'devopsStore') : null];
      for (const s of stores) {
        if (s?.servers?.update && id) {
          await s.servers.update(id, applyPatch);
          return true;
        }
      }
    } catch (error) {
      emitLog(log, 'warn', `[provision] 回写服务器 ${id} 失败：${normalizeError(error).message}`);
    }
    return false;
  }

  /** 记录已解析的运行时到 server.runtimes（契约 §2.3 的 `python:3.11` 形式）。 */
  async function rememberRuntime(server, key, path, version) {
    const entry = { path, at: Date.now() };
    if (version) entry.version = version;
    await persist(server, { runtimes: { [key]: entry } });
  }

  /**
   * 环境供给主入口（契约 §3.8）。
   *
   * @param {object|string} serverInput
   * @param {{ python?: string, node?: string, packages?: string[] }} requirement
   * @param {object} [opts]
   * @param {boolean} [opts.allowInstall=false] **默认 false：不安装**
   * @param {(text:string, stream:string)=>void} [opts.onLog]
   * @param {AbortSignal} [opts.signal]
   * @param {boolean} [opts.forceProbe]
   * @returns {Promise<{ok:true, resolved:Record<string,string>, actions:Array<object>}
   *   | {ok:false, error:string, suggestion:string, actions:Array<object>, missing?:Array<object>, attempts?:Array<object>}>}
   */
  async function ensure(serverInput, requirement = {}, opts = {}) {
    const server = await toServer(serverInput);
    // 安全底线：默认不安装。只有显式 true 才允许。
    const allowInstall = opts.allowInstall === true;
    const onLog = typeof opts.onLog === 'function' ? opts.onLog : undefined;
    const signal = opts.signal;

    /** @type {Array<{kind:string,command:string,exitCode:number|null,plan?:string}>} */
    const actions = [];
    const resolved = {};

    // 需求预校验（非法输入在动手前就拒绝）
    const requirementSpecs = [];
    if (requirement.python) {
      const version = requirement.python === 'any' ? 'any' : assertVersionSpec(requirement.python, 'Python');
      requirementSpecs.push({ kind: 'python', version, key: `python:${version}`, label: `Python ${version}` });
    }
    if (requirement.node) {
      const version = requirement.node === 'any' ? 'any' : assertVersionSpec(requirement.node, 'Node');
      requirementSpecs.push({ kind: 'node', version, key: `node:${version}`, label: `Node ${version}` });
    }
    for (const pkg of requirement.packages || []) {
      const name = assertPackageName(pkg);
      requirementSpecs.push({ kind: 'package', name, version: '', key: `pkg:${name}`, label: `依赖包 ${name}` });
    }

    if (requirementSpecs.length === 0) {
      return { ok: true, resolved: {}, actions };
    }

    const info = await probeInternal(server, { force: opts.forceProbe, signal });
    const context = { info, onLog, signal, actions };

    // —— 第一轮：只读解析，不安装任何东西 ——
    /** @type {Array<object>} */
    const missing = [];
    for (const spec of requirementSpecs) {
      if (signal?.aborted) {
        return { ok: false, error: '已取消', suggestion: '操作被取消。', actions };
      }
      const found = await resolveRuntime(server, spec.kind === 'package' ? spec.name : spec.kind, spec.version, context);
      if (found?.path) {
        resolved[spec.kind === 'package' ? spec.name : spec.kind] = found.path;
        await rememberRuntime(server, spec.key, found.path, found.version);
        if (onLog) onLog(`✓ 已找到 ${spec.label}：${found.path}${found.version ? `（${found.version}）` : ''}`, 'ok');
      } else {
        missing.push({ ...spec, plans: plansFor(server, spec, context) });
      }
    }

    if (missing.length === 0) {
      if (onLog) onLog('✓ 所有运行时/依赖均已就绪，无需安装。', 'ok');
      return { ok: true, resolved, actions };
    }

    // —— allowInstall=false（默认）：如实失败 + 可直接照做的建议 ——
    if (!allowInstall) {
      const suggestion = buildSuggestion({ missing, probe: info.probe, server, config });
      const error = `缺少：${missing.map((m) => m.label).join('、')}（当前未开启自动安装）`;
      if (onLog) onLog(`✗ ${error}`, 'error');
      if (onLog) onLog(suggestion, 'suggestion');
      return {
        ok: false,
        error,
        suggestion,
        actions,
        // 已解析到的部分仍然返回，便于上层知道「哪些已就绪、只差哪些」
        resolved,
        missing: describeMissing(missing),
        probe: info.probe,
      };
    }

    // —— allowInstall=true：按优先级尝试方案 ——
    const attempts = [];
    const stillMissing = [];
    for (const item of missing) {
      if (signal?.aborted) return { ok: false, error: '已取消', suggestion: '操作被取消。', actions, attempts };
      let done = false;
      for (const plan of item.plans) {
        const outcome = await runPlan(server, item, plan, context);
        attempts.push({ item: item.key, plan: plan.id, ok: outcome.ok, reason: outcome.reason || '' });
        if (outcome.ok) {
          resolved[item.kind === 'package' ? item.name : item.kind] = outcome.path;
          await rememberRuntime(server, item.key, outcome.path, outcome.version);
          if (onLog) onLog(`✓ ${item.label} 已就绪：${outcome.path}`, 'ok');
          done = true;
          break;
        }
        if (onLog) onLog(`✗ 方案 ${plan.id} 失败：${outcome.reason}`, 'warn');
      }
      if (!done) stillMissing.push(item);
    }

    if (stillMissing.length === 0) {
      return { ok: true, resolved, actions, attempts };
    }

    const suggestion = buildSuggestion({ missing: stillMissing, probe: info.probe, server, config });
    return {
      ok: false,
      error: `自动安装未能满足：${stillMissing.map((m) => m.label).join('、')}`,
      suggestion,
      actions,
      attempts,
      missing: describeMissing(stillMissing),
      probe: info.probe,
    };
  }

  const api = {
    ensure,
    probe,
    /** 只读解析：不安装、不写回，供「这一步会用哪个解释器」预览。 */
    async resolve(serverInput, requirement = {}, opts = {}) {
      const server = await toServer(serverInput);
      const info = await probeInternal(server, { force: opts.forceProbe, signal: opts.signal });
      const context = { info, onLog: opts.onLog, signal: opts.signal, actions: [] };
      const resolved = {};
      for (const [key, value] of Object.entries(requirement)) {
        if (key === 'packages') {
          for (const pkg of value || []) {
            const found = await resolveRuntime(server, assertPackageName(pkg), '', context);
            if (found?.path) resolved[pkg] = found.path;
          }
        } else if (value) {
          const found = await resolveRuntime(server, key, value, context);
          if (found?.path) resolved[key] = found.path;
        }
      }
      return { resolved, probe: info.probe, family: info.family };
    },
    /** 预览某需求会走哪些安装方案（不执行）。 */
    async plan(serverInput, requirement = {}) {
      const server = await toServer(serverInput);
      const info = await probeInternal(server, { force: true });
      const context = { info, actions: [] };
      const out = [];
      if (requirement.python) {
        out.push({ key: `python:${requirement.python}`, plans: plansFor(server, { kind: 'python', version: requirement.python }, context).map((p) => ({ id: p.id, label: p.label, highRisk: Boolean(p.highRisk) })) });
      }
      if (requirement.node) {
        out.push({ key: `node:${requirement.node}`, plans: plansFor(server, { kind: 'node', version: requirement.node }, context).map((p) => ({ id: p.id, label: p.label, highRisk: Boolean(p.highRisk) })) });
      }
      for (const pkg of requirement.packages || []) {
        out.push({ key: `pkg:${pkg}`, plans: plansFor(server, { kind: 'package', name: pkg }, context).map((p) => ({ id: p.id, label: p.label })) });
      }
      return out;
    },
    /** 清空 probe 缓存（服务器配置变更后调用）。 */
    invalidate(serverId) {
      if (serverId) probeCache.delete(String(serverId));
      else probeCache.clear();
    },
    /** 当前缓存内容（测试/诊断）。 */
    snapshot() {
      return new Map(probeCache);
    },
  };

  return api;
}

/** `$HOME` / `~` 展开（SFTP 与 argv 都不会做 shell 展开，必须自己做）。 */
export function expandHome(p, home) {
  const s = String(p ?? '');
  if (!home) return s;
  const cleanHome = String(home).replace(/\/+$/, '');
  if (s.startsWith('$HOME/')) return `${cleanHome}/${s.slice(6)}`;
  if (s === '$HOME') return cleanHome;
  if (s.startsWith('~/')) return `${cleanHome}/${s.slice(2)}`;
  return s;
}

function safeGet(ctx, name) {
  try {
    return ctx.get(name);
  } catch {
    return null;
  }
}

/** 便于测试与前端展示：某个 probe 下的候选方案摘要。 */
export function summarizePlan(probe, requirement = {}) {
  const { family, manager } = pickPackageManager(probe || {});
  const lines = [];
  lines.push(`包管理器家族：${family}${manager ? `（${manager.cmd}）` : '（未识别）'}`);
  if (requirement.python) lines.push(`Python ${requirement.python}：uv → pyenv → ${manager ? manager.cmd : '发行版包'}`);
  if (requirement.node) lines.push(`Node ${requirement.node}：nvm/fnm/mise → ${manager ? manager.cmd : '系统 node'}`);
  for (const p of requirement.packages || []) lines.push(`${p}：${manager ? manager.cmd : '无可用包管理器'}`);
  return nonEmptyLines(lines.join('\n'));
}
