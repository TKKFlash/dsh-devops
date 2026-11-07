/**
 * 节点：python.exec —— 执行一段 Python 脚本
 */
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { F, toRecord, resolveWorkPath } from '../helpers.js';
import { spawnCollect, toNodeResult, parseSuccessCodes, resolveInterpreter } from '../exec.js';

const MAX_CAPTURE = 100000;

export const descriptor = {
  type: 'python.exec',
  title: '执行 Python 脚本',
  category: 'execute',
  icon: 'python',
  description: '用指定版本的 Python 运行一段脚本',
  fields: [
    F.code('script', '脚本', 'python', {
      required: true,
      placeholder: 'import sys\nprint(sys.version)',
      description: '脚本写入临时 .py 文件后由解释器执行',
    }),
    F.runtime('pythonVersion', 'Python 版本', 'python', {
      placeholder: '3.11',
      description: '留空使用 PATH 上的 python；指定版本时走环境供给（uv/pyenv/发行版包）',
    }),
    F.boolean('allowInstall', '允许自动安装运行时', { default: false, description: '默认关闭：缺失时返回建议而不改动系统' }),
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
    { name: 'pythonPath', type: 'string' },
  ],
  env: [{ name: 'PYTHONUNBUFFERED', value: '1', description: '禁用输出缓冲，保证日志实时' }],
  runtime: { python: '' },

  async run(rt, inputs = {}) {
    const script = String(inputs.script ?? '');
    if (!script.trim()) return { exitCode: 1, error: '脚本为空' };

    let interpreter;
    try {
      interpreter = await resolveInterpreter(rt, {
        kind: 'python',
        version: inputs.pythonVersion,
        allowInstall: inputs.allowInstall === true,
      });
    } catch (error) {
      return { exitCode: 1, error: String(error?.message ?? error), outputs: { suggestion: error?.suggestion ?? '' } };
    }

    // 目标执行器是否支持脚本文本通道。
    // ssh（supportsScript:true）直接把脚本文本整体交给远端解释器，绝不在控制端落临时文件
    // —— 那个文件在目标机上并不存在（交接文档根因 1）。
    // local（无该标志）保持既有路径：控制端临时文件 + argv，行为字节级不变。
    const usesScript = rt.executor?.supportsScript === true;

    // 仅本机路径需要落地临时文件；script 通道下 dir 为空，finally 不做任何清理。
    let dir = '';
    let file = '';
    if (!usesScript) {
      dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-devops-python-'));
      file = path.join(dir, 'script.py');
      await fsp.writeFile(file, script, 'utf8');
    }

    try {
      const env = { ...(rt.env ?? {}), ...toRecord(inputs.env) };
      const result = await spawnCollect(rt, {
        // script 通道：脚本作为**独立参数**追加在解释器 argv 之后（FROZEN 接口 §2）。
        // 无版本时 interpreter.path 是裸 'python3'，交由远端 PATH 解析。
        ...(usesScript
          ? { script, scriptArgv: [interpreter.path, '-c'] }
          : { argv: [interpreter.path, file] }),
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
          pythonPath: interpreter.path,
        },
      });
    } finally {
      if (dir) await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  },
};

export default descriptor;
