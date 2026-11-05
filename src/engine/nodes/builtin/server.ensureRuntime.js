/**
 * 节点：server.ensureRuntime —— 确保目标服务器具备所需运行时
 *
 * 直接消费 provisioner（契约 §3.8）：
 * - allowInstall 默认 false，缺失时返回 ok:false 与 suggestion（不擅自动系统）。
 * - 成功后把解析出的解释器绝对路径传给后续节点（outputs.runtime）。
 */
import { F } from '../helpers.js';

export const descriptor = {
  type: 'server.ensureRuntime',
  title: '准备运行时',
  category: 'provision',
  icon: 'cpu',
  description: '在目标服务器上探测/准备指定版本的运行时与系统依赖',
  fields: [
    F.server('server', '服务器', { required: true }),
    F.runtime('pythonVersion', 'Python 版本', 'python', { placeholder: '3.11', description: '留空表示不需要 Python' }),
    F.runtime('nodeVersion', 'Node 版本', 'node', { placeholder: '20', description: '留空表示不需要 Node' }),
    F.multiselect('packages', '系统依赖包', [
      'git', 'curl', 'wget', 'unzip', 'jq', 'build-essential', 'ca-certificates', 'openssl',
    ], {
      freeform: true,
      description: '可多选，也可自填包名（不同发行版的包名可能不同）',
    }),
    F.boolean('allowInstall', '允许自动安装', { default: false, description: '默认关闭：缺失时只给建议，不修改系统' }),
    F.boolean('failIfMissing', '缺失则失败', { default: true, description: '关闭时缺失只记录告警并继续' }),
  ],
  outputs: [
    { name: 'resolved', type: 'object', description: '{ python:/abs/path, node:/abs/path }' },
    { name: 'actions', type: 'array', description: '实际执行过的准备动作 [{kind,command,exitCode}]' },
    { name: 'suggestion', type: 'string' },
  ],
  env: [],
  runtime: { python: '', node: '' },

  async run(rt, inputs = {}) {
    if (typeof rt.provision !== 'function') {
      return { exitCode: 1, error: '当前环境未提供环境供给能力（rt.provision）' };
    }

    const requirement = {};
    if (inputs.pythonVersion) requirement.python = String(inputs.pythonVersion);
    if (inputs.nodeVersion) requirement.node = String(inputs.nodeVersion);
    if (Array.isArray(inputs.packages) && inputs.packages.length) requirement.packages = inputs.packages;

    if (!Object.keys(requirement).length) {
      if (typeof rt.log === 'function') rt.log('未指定任何运行时要求，跳过\n', 'stdout');
      return { exitCode: 0, outputs: { resolved: {}, actions: [], skipped: true } };
    }

    const allowInstall = inputs.allowInstall === true;
    if (typeof rt.log === 'function') {
      rt.log(`准备运行时：${JSON.stringify(requirement)}（allowInstall=${allowInstall}）\n`, 'stdout');
    }
    if (typeof rt.setPhase === 'function') rt.setPhase('provisioning');

    let result;
    try {
      result = await rt.provision(requirement, {
        allowInstall,
        onLog: (text) => { if (typeof rt.log === 'function') rt.log(text, 'stdout'); },
        signal: rt.signal,
      });
    } catch (error) {
      return { exitCode: 1, error: `环境准备失败：${error?.message ?? error}` };
    } finally {
      if (typeof rt.setPhase === 'function') rt.setPhase('running');
    }

    const actions = result?.actions ?? [];
    for (const action of actions) {
      if (typeof rt.log === 'function') {
        rt.log(`[${action.kind}] ${action.command ?? ''} → 退出码 ${action.exitCode ?? '?'}\n`, 'stdout');
      }
    }

    if (result?.ok) {
      const resolved = result.resolved ?? {};
      if (typeof rt.log === 'function') {
        rt.log(`运行时已就绪：${JSON.stringify(resolved)}\n`, 'stdout');
      }
      return { exitCode: 0, outputs: { resolved, actions, suggestion: '' } };
    }

    const outputs = { resolved: {}, actions, suggestion: result?.suggestion ?? '' };
    const message = `运行时不可用：${result?.error ?? '未知原因'}${result?.suggestion ? `\n建议：${result.suggestion}` : ''}`;
    if (inputs.failIfMissing === false) {
      if (typeof rt.log === 'function') rt.log(`${message}\n`, 'stderr');
      return { exitCode: 0, outputs, warning: message };
    }
    return { exitCode: 1, outputs, error: message };
  },
};

export default descriptor;
