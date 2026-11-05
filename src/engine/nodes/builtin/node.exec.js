/**
 * 节点：node.exec —— 执行一段 Node.js 脚本
 *
 * runtime: { node:'' } 表示该节点需要 Node 运行时；指定版本时通过
 * rt.provision 解析解释器绝对路径（allowInstall 默认 false）。
 */
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { F, toRecord, resolveWorkPath } from '../helpers.js';
import { spawnCollect, toNodeResult, parseSuccessCodes, resolveInterpreter } from '../exec.js';

const MAX_CAPTURE = 100000;

export const descriptor = {
  type: 'node.exec',
  title: '执行 Node 脚本',
  category: 'execute',
  icon: 'node',
  description: '用指定版本的 Node.js 运行一段脚本',
  fields: [
    F.code('script', '脚本', 'javascript', {
      required: true,
      placeholder: 'console.log(process.version)',
      description: '脚本写入临时 .mjs 文件后由 node 执行；可用 ESM 语法',
    }),
    F.runtime('nodeVersion', 'Node 版本', 'node', {
      placeholder: '20',
      description: '留空使用 PATH 上的 node；指定版本时需环境供给能力',
    }),
    F.boolean('allowInstall', '允许自动安装运行时', { default: false, description: '关闭时缺少运行时会直接失败并给出建议' }),
    F.dir('workdir', '工作目录', { serverField: 'server' }),
    F.keyvalue('env', '附加环境变量'),
    F.number('timeoutMs', '超时', { min: 0, unit: 'ms', default: 0 }),
    F.string('successExitCodes', '可接受的退出码', { default: '0' }),
  ],
  outputs: [
    { name: 'exitCode', type: 'number' },
    { name: 'stdout', type: 'string' },
    { name: 'stderr', type: 'string' },
    { name: 'durationMs', type: 'number' },
    { name: 'nodePath', type: 'string' },
  ],
  env: [],
  runtime: { node: '' },

  async run(rt, inputs = {}) {
    const script = String(inputs.script ?? '');
    if (!script.trim()) return { exitCode: 1, error: '脚本为空' };

    let interpreter;
    try {
      interpreter = await resolveInterpreter(rt, {
        kind: 'node',
        version: inputs.nodeVersion,
        allowInstall: inputs.allowInstall === true,
      });
    } catch (error) {
      return { exitCode: 1, error: String(error?.message ?? error), outputs: { suggestion: error?.suggestion ?? '' } };
    }

    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-devops-node-'));
    const file = path.join(dir, 'script.mjs');
    await fsp.writeFile(file, script, 'utf8');

    try {
      const env = { ...(rt.env ?? {}), ...toRecord(inputs.env) };
      const result = await spawnCollect(rt, {
        argv: [interpreter.path, file],
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
          nodePath: interpreter.path,
        },
      });
    } finally {
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  },
};

export default descriptor;
