/**
 * 节点：file.copy —— 复制文件或目录
 */
import path from 'node:path';
import { F, resolveInputPath } from '../helpers.js';
import { copyRemote, joinRemote } from '../fsops.js';

export const descriptor = {
  type: 'file.copy',
  title: '复制文件',
  category: 'files',
  icon: 'copy',
  description: '在目标服务器上复制文件或整个目录',
  fields: [
    F.server('server', '服务器'),
    F.string('from', '源路径', { required: true, placeholder: 'dist' }),
    F.string('to', '目标路径', { required: true, placeholder: '/srv/app/public' }),
    F.boolean('overwrite', '允许覆盖', { default: true, description: '关闭时目标已存在会失败' }),
    F.boolean('recursive', '递归复制目录', { default: true }),
    F.boolean('failIfMissing', '源不存在则失败', { default: true }),
  ],
  outputs: [
    { name: 'from', type: 'string' },
    { name: 'to', type: 'string' },
    { name: 'isDir', type: 'boolean' },
    { name: 'bytes', type: 'number' },
  ],
  env: [],
  runtime: null,

  async run(rt, inputs = {}) {
    const rawFrom = String(inputs.from ?? '').trim();
    const rawTo = String(inputs.to ?? '').trim();
    if (!rawFrom || !rawTo) return { exitCode: 1, error: '源路径与目标路径都不能为空' };

    const fromResolved = resolveInputPath(rt, rawFrom, rt.cwd);
    const toResolved = resolveInputPath(rt, rawTo, rt.cwd);
    const from = fromResolved.abs;
    const to = toResolved.abs;

    const info = await rt.executor.stat(rt.server, from).catch(() => ({ exists: false }));
    if (!info.exists) {
      if (inputs.failIfMissing === false) {
        if (typeof rt.log === 'function') rt.log(`源不存在，按配置跳过：${fromResolved.describe}\n`, 'stdout');
        return { exitCode: 0, outputs: { from, to, isDir: false, bytes: 0, skipped: true } };
      }
      // 带上解析后的绝对路径 + 原始输入 + 基准来源，便于判断是「相对路径基准错了」
      return {
        exitCode: 1,
        error: `源路径不存在：${fromResolved.describe}。请检查 from 是否写对，或设置正确的工作目录。`,
        outputs: { from, fromInput: rawFrom, cwd: rt.cwd, cwdSource: rt.cwdSource ?? '' },
      };
    }

    try {
      const result = await copyRemote(rt, from, to, {
        overwrite: inputs.overwrite !== false,
        recursive: inputs.recursive !== false,
      });
      if (typeof rt.log === 'function') {
        rt.log(`已复制 ${from} → ${to}${result.isDir ? '（目录）' : `（${result.bytes} 字节）`}\n`, 'stdout');
      }
      return { exitCode: 0, outputs: { ...result, fromInput: rawFrom, toInput: rawTo, cwd: rt.cwd } };
    } catch (error) {
      return { exitCode: 1, error: `复制失败：${fromResolved.describe} → ${toResolved.describe}：${error?.message ?? error}` };
    }
  },
};

export default descriptor;
