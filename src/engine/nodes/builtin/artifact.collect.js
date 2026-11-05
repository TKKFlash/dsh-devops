/**
 * 节点：artifact.collect —— 收集构建产物
 *
 * 把 glob 命中的文件登记为本次运行的产物，并（可选）复制到归档目录，
 * 便于在运行详情里查看与下载。
 */
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { F, resolveInputPath, checkDirectory, describeCwd } from '../helpers.js';
import { copyRemote, relativeRemote, joinRemote } from '../fsops.js';

export const descriptor = {
  type: 'artifact.collect',
  title: '收集产物',
  category: 'files',
  icon: 'package',
  description: '按 glob 收集构建产物，登记到本次运行并可选归档到本地目录',
  fields: [
    F.server('server', '服务器'),
    F.dir('base', '起始目录', { serverField: 'server', required: true, placeholder: '/srv/app' }),
    F.glob('pattern', '产物模式', {
      required: true,
      baseField: 'base',
      multiple: true,
      placeholder: 'dist/**',
      description: '可填多个；按顺序求值，最后一个命中的决定去留。仅填取反模式（如 !**/*.map）时会隐式补 ** 表示「除这些以外全部」',
    }),
    F.string('name', '产物名称', { placeholder: 'app-dist', description: '用于归档子目录命名' }),
    F.boolean('failIfEmpty', '无产物则失败', { default: true }),
    F.boolean('archive', '归档到本地', { default: false, description: '开启后把命中文件复制到本地归档目录' }),
    F.dir('archiveDir', '归档目录', { serverField: 'server', placeholder: '', description: '留空则用 <dataDir>/artifacts/<runId>' }),
    F.number('maxFiles', '最多收集文件数', { min: 1, default: 500 }),
  ],
  outputs: [
    { name: 'artifacts', type: 'array', description: '[{path,size,rel}]' },
    { name: 'count', type: 'number' },
    { name: 'totalBytes', type: 'number' },
    { name: 'archiveDir', type: 'string' },
  ],
  env: [],
  runtime: null,

  async run(rt, inputs = {}) {
    const resolved = resolveInputPath(rt, inputs.base, rt.cwd);
    const base = resolved.abs;
    // 契约 §3.7.1：pattern 支持多值，取反由 executor.match 统一处理
    const patterns = (Array.isArray(inputs.pattern) ? inputs.pattern : [inputs.pattern])
      .map((p) => String(p ?? '').trim())
      .filter(Boolean);
    if (!base || !patterns.length) {
      return { exitCode: 1, error: '起始目录与产物模式都不能为空（且工作目录必须可用）' };
    }

    // 先校验目录存在：否则「base 写错」会被误报成「没有匹配到产物」
    const dirError = await checkDirectory(rt, base, resolved.describe, 'base');
    if (dirError) {
      return { exitCode: 1, error: dirError, outputs: { base, baseInput: resolved.raw, cwd: rt.cwd } };
    }

    const maxFiles = Number(inputs.maxFiles) > 0 ? Number(inputs.maxFiles) : 500;
    const result = await rt.executor.match(rt.server, base, patterns, {
      maxEntries: maxFiles,
      signal: rt.signal,
    });

    const files = (result.matched ?? []).slice(0, maxFiles);
    const ignored = result.ignored ?? [];
    const artifacts = files.map((item) => ({
      path: item.path,
      size: item.size ?? 0,
      rel: relativeRemote(rt, base, item.path),
    }));
    const totalBytes = artifacts.reduce((sum, item) => sum + (item.size || 0), 0);

    if (typeof rt.log === 'function') {
      rt.log(`搜索目录：${resolved.describe}\n`, 'stdout');
      rt.log(`收集到 ${artifacts.length} 个产物，共 ${totalBytes} 字节\n`, 'stdout');
      for (const item of artifacts.slice(0, 40)) rt.log(`  ${item.rel} (${item.size} B)\n`, 'stdout');
      for (const item of ignored.slice(0, 20)) rt.log(`  [排除] ${item.path}\n`, 'stdout');
    }

    // 命中 0 时给出解析后的绝对路径，用户能立刻判断是不是基准目录错了
    const searchDesc = `搜索目录=${base}（base="${resolved.raw}"${resolved.relative ? `，相对基准=cwd ${describeCwd(rt)}` : '，绝对路径'}）模式=[${patterns.join(', ')}]`;
    if (!artifacts.length && inputs.failIfEmpty !== false) {
      return {
        exitCode: 1,
        outputs: { artifacts, count: 0, totalBytes: 0, ignored, base, baseInput: resolved.raw, cwd: rt.cwd },
        error: `没有匹配到任何产物。${searchDesc}`,
      };
    }

    let archiveDir = '';
    if (inputs.archive === true) {
      const root = inputs.archiveDir
        ? String(inputs.archiveDir)
        : path.join(rt.config?.dataDir ?? path.join(os.tmpdir(), 'dsh-devops'), 'artifacts', String(rt.run?.id ?? 'run'));
      const sub = String(inputs.name ?? '').trim() || 'artifacts';
      archiveDir = joinRemote(rt, root, sub);
      for (const item of artifacts) {
        if (rt.signal?.aborted) break;
        const target = path.join(archiveDir, item.rel);
        try {
          await copyRemote(rt, item.path, target, { overwrite: true, recursive: true });
        } catch (error) {
          if (typeof rt.log === 'function') rt.log(`归档失败 ${item.rel}：${error?.message ?? error}\n`, 'stderr');
        }
      }
      if (typeof rt.log === 'function') rt.log(`产物已归档到 ${archiveDir}\n`, 'stdout');
    }

    return {
      exitCode: 0,
      outputs: {
        artifacts,
        count: artifacts.length,
        totalBytes,
        ignored,
        ignoredCount: ignored.length,
        patterns: result.patterns ?? patterns,
        archiveDir,
        truncated: Boolean(result.truncated),
      },
    };
  },
};

export default descriptor;
