/**
 * 节点：file.write —— 写入文件
 *
 * 内容通过 transferIn 搬运（本地直接 fs 写入），**不拼进命令行**。
 */
import path from 'node:path';
import { F, toRecord, expandTemplate, resolveInputPath } from '../helpers.js';
import { writeRemote, joinRemote } from '../fsops.js';

export const descriptor = {
  type: 'file.write',
  title: '写入文件',
  category: 'files',
  icon: 'file-plus',
  description: '把文本内容写入目标服务器上的文件',
  fields: [
    F.server('server', '服务器'),
    F.string('path', '文件路径', { required: true, placeholder: '/srv/app/.env', description: '绝对路径，或以工作目录为基准的相对路径' }),
    F.text('content', '内容', { rows: 8, required: true, placeholder: 'KEY=value' }),
    F.enum('format', '内容格式', ['text', 'json', 'env'], { default: 'text', description: 'json 会对内容做解析校验后美化写入' }),
    F.enum('mode', '写入方式', ['overwrite', 'append', 'create'], { default: 'overwrite', description: 'create 在文件已存在时报错' }),
    F.boolean('createDirs', '自动创建目录', { default: true }),
    F.keyvalue('env', '变量替换', { description: '对内容做 ${name} 形式替换；值可以引用资源库密钥' }),
  ],
  outputs: [
    { name: 'path', type: 'string' },
    { name: 'bytes', type: 'number' },
    { name: 'created', type: 'boolean' },
  ],
  env: [],
  runtime: null,

  async run(rt, inputs = {}) {
    const target = String(inputs.path ?? '').trim();
    if (!target) return { exitCode: 1, error: '文件路径不能为空' };

    let content = String(inputs.content ?? '');
    const format = String(inputs.format ?? 'text');

    // 变量替换：统一走 helpers.js 的 expandTemplate，额外把节点 env 参数并入环境层。
    // **宽松模式**：写文件的正文常常本身就是含 ${VAR} 的产物（.env、shell 脚本、nginx 配置），
    // 这些 ${} 属于目标文件的语法，不是我们的占位符，因此未定义时原样保留。
    content = expandTemplate(content, rt, { env: toRecord(inputs.env), lenient: true });

    if (format === 'json') {
      try {
        content = `${JSON.stringify(JSON.parse(content), null, 2)}\n`;
      } catch (error) {
        return { exitCode: 1, error: `JSON 内容非法：${error?.message ?? error}` };
      }
    }

    const resolvedPath = resolveInputPath(rt, target, rt.cwd);
    const abs = resolvedPath.abs;
    if (!abs) {
      return { exitCode: 1, error: '文件路径不能为空，且工作目录不可用（请检查 server.workdir）' };
    }
    const mode = String(inputs.mode ?? 'overwrite');

    // 父目录不存在时给出可读错误（含解析后的绝对路径与来源），而不是让底层 fs 抛晦涩错误
    if (inputs.createDirs === false) {
      const parent = path.dirname(abs);
      const parentInfo = await rt.executor.stat(rt.server, parent).catch(() => ({ exists: false }));
      if (!parentInfo.exists) {
        return {
          exitCode: 1,
          error: `目标目录不存在：${parent}（文件=${resolvedPath.describe}）。请开启「自动创建目录」或先创建该目录。`,
          outputs: { path: abs, pathInput: resolvedPath.raw, cwd: rt.cwd },
        };
      }
    }

    const info = await rt.executor.stat(rt.server, abs).catch(() => ({ exists: false }));
    if (mode === 'create' && info.exists) {
      return { exitCode: 1, error: `文件已存在且写入方式为 create：${abs}` };
    }

    try {
      const result = await writeRemote(rt, abs, content, {
        createDirs: inputs.createDirs !== false,
        append: mode === 'append',
      });
      if (typeof rt.log === 'function') {
        rt.log(`已写入 ${abs}（${result.bytes} 字节，${result.existed ? '覆盖' : '新建'}）\n`, 'stdout');
      }
      return {
        exitCode: 0,
        outputs: {
          path: abs,
          pathInput: resolvedPath.raw,
          cwd: rt.cwd,
          bytes: result.bytes,
          created: result.created,
          existed: result.existed,
        },
      };
    } catch (error) {
      return { exitCode: 1, error: `写入失败：${resolvedPath.describe}：${error?.message ?? error}` };
    }
  },
};

export default descriptor;
