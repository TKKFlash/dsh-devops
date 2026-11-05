/**
 * 节点：shell.exec —— 执行一段 Shell 脚本（契约 §3.9）
 */
import {
  F, buildScriptInvocation, checkDangerous, toRecord, resolveWorkPath,
} from '../helpers.js';
import { spawnCollect, toNodeResult, parseSuccessCodes } from '../exec.js';

/** 输出体积上限（避免把超大输出塞进 store 与 SSE） */
const MAX_CAPTURE = 100000;

export const descriptor = {
  type: 'shell.exec',
  title: '执行 Shell',
  category: 'execute',
  icon: 'terminal',
  description: '在目标服务器执行一段 Shell 脚本',
  fields: [
    F.code('script', '脚本', 'shell', {
      required: true,
      placeholder: 'npm ci && npm run build',
      description: '脚本文本会写入临时文件后交给解释器执行，不拼接进命令行',
    }),
    F.enum('shell', '解释器', ['auto', 'sh', 'bash', 'powershell', 'cmd'], {
      default: 'auto',
      optionsFrom: 'shell',
      description: 'auto 按目标系统选择：Windows→PowerShell/cmd，Linux/macOS→bash',
    }),
    F.snippet('snippetRef', '引用脚本片段', { description: '从资源库选择一段脚本并拼接到脚本开头' }),
    F.dir('workdir', '工作目录', { serverField: 'server', description: '留空则使用服务器默认 workdir' }),
    F.keyvalue('env', '附加环境变量', { description: '仅对本步骤生效；同名覆盖流水线变量' }),
    F.number('timeoutMs', '超时', { min: 0, unit: 'ms', default: 0, description: '0 表示沿用 job 的超时设置' }),
    F.string('successExitCodes', '可接受的退出码', { default: '0', placeholder: '0 或 0,2 或 0-3' }),
    F.boolean('allowDangerous', '允许危险命令', { default: false, description: '关闭时拒绝 rm -rf /、mkfs、dd 等破坏性命令' }),
  ],
  outputs: [
    { name: 'exitCode', type: 'number' },
    { name: 'stdout', type: 'string' },
    { name: 'stderr', type: 'string' },
    { name: 'durationMs', type: 'number' },
  ],
  env: [{ name: 'CI', value: '1', description: '标记为 CI 环境，便于构建工具切换行为' }],
  runtime: null,

  async run(rt, inputs = {}) {
    const script = String(inputs.script ?? '');
    if (!script.trim()) {
      return { exitCode: 1, error: '脚本为空' };
    }

    if (!inputs.allowDangerous) {
      const check = checkDangerous(script);
      if (check.dangerous) {
        return {
          exitCode: 1,
          error: `脚本包含被拒绝的危险命令（${check.reason}）。确认无误可在节点参数中开启「允许危险命令」。`,
        };
      }
    }

    const invocation = await buildScriptInvocation({
      script,
      shell: inputs.shell && inputs.shell !== 'auto' ? inputs.shell : '',
      workdir: rt.cwd,
    });

    try {
      const env = { ...(rt.env ?? {}), ...toRecord(inputs.env) };
      const result = await spawnCollect(rt, {
        argv: invocation.argv,
        cwd: inputs.workdir ? resolveWorkPath(rt.cwd, inputs.workdir) : rt.cwd,
        env,
        timeoutMs: Number(inputs.timeoutMs) > 0 ? Number(inputs.timeoutMs) : undefined,
        label: rt.step?.name,
      });
      return toNodeResult(result, {
        successCodes: parseSuccessCodes(inputs.successExitCodes),
        timeoutMs: inputs.timeoutMs,
        outputs: {
          stdout: (result.stdout ?? '').slice(0, MAX_CAPTURE),
          stderr: (result.stderr ?? '').slice(0, MAX_CAPTURE),
          command: invocation.argv.join(' '),
        },
      });
    } finally {
      await invocation.cleanup();
    }
  },
};

export default descriptor;
