/**
 * 节点：file.pick —— 在目标路径下按 glob 挑选文件
 *
 * 用途：构建产物/配置文件选择，结果通过 outputs.matched 传给后续节点。
 * 使用 executor.match（契约 §3.7），glob 复用 model/glob.js 的语义。
 */
import path from 'node:path';
import { F, resolveInputPath, checkDirectory, describeCwd } from '../helpers.js';

export const descriptor = {
  type: 'file.pick',
  title: '选择文件',
  category: 'files',
  icon: 'search',
  description: '按 glob 在指定目录下挑选文件，可要求至少命中 N 个',
  fields: [
    F.server('server', '服务器', { description: '留空使用 job 的 server' }),
    F.dir('base', '起始目录', { serverField: 'server', required: true, placeholder: '/srv/app' }),
    F.glob('pattern', '匹配模式', {
      required: true,
      baseField: 'base',
      multiple: true,
      placeholder: 'dist/**/*.js',
      description: '可填多个；按顺序求值，最后一个命中的决定去留。支持 ** * ? {a,b} 与 ! 前缀取反（仅填取反时会隐式补 **）',
    }),
    F.boolean('failIfEmpty', '无命中则失败', { default: true, description: '关闭时允许 0 命中并继续' }),
    F.number('minCount', '最少命中数', { min: 0, default: 1, description: '命中数少于此值则失败' }),
    F.boolean('includeDirs', '包含目录', { default: false }),
    F.number('maxEntries', '最大扫描条数', { min: 1, default: 5000, description: '防止超大目录拖垮运行' }),
  ],
  outputs: [
    { name: 'matched', type: 'array', description: '命中的绝对路径列表' },
    { name: 'files', type: 'array', description: '命中项的 {path,size}' },
    { name: 'count', type: 'number' },
    { name: 'total', type: 'number' },
    { name: 'truncated', type: 'boolean' },
  ],
  env: [],
  runtime: null,

  async run(rt, inputs = {}) {
    // base 为空时回退到 rt.cwd（现在是可信的绝对路径），只有 cwd 也拿不到才报错。
    const resolved = resolveInputPath(rt, inputs.base, rt.cwd);
    const base = resolved.abs;
    // 契约 §3.7.1：pattern 支持单值或多值；数组直接透传给 executor.match，
    // 取反（!）语义由 match 内部按「最后命中决定归属」处理，节点不再自行过滤。
    const patterns = (Array.isArray(inputs.pattern) ? inputs.pattern : [inputs.pattern])
      .map((p) => String(p ?? '').trim())
      .filter(Boolean);
    if (!base) return { exitCode: 1, error: '起始目录不能为空，且工作目录不可用（请检查 server.workdir）' };
    if (!patterns.length) return { exitCode: 1, error: '匹配模式不能为空' };

    // 先校验目录存在，避免「base 写错」被误报成「glob 没匹配到」
    const dirError = await checkDirectory(rt, base, resolved.describe, 'base');
    if (dirError) return { exitCode: 1, error: dirError, outputs: { base, baseInput: resolved.raw, cwd: rt.cwd } };

    const result = await rt.executor.match(rt.server, base, patterns, {
      includeDirs: inputs.includeDirs === true,
      maxEntries: Number(inputs.maxEntries) > 0 ? Number(inputs.maxEntries) : 5000,
      signal: rt.signal,
    });

    const files = result.matched ?? [];
    const ignored = result.ignored ?? [];
    const matched = files.map((item) => item.path);
    const minCount = Number.isFinite(Number(inputs.minCount)) ? Number(inputs.minCount) : 1;
    const failIfEmpty = inputs.failIfEmpty !== false;

    if (typeof rt.log === 'function') {
      rt.log(`搜索目录：${resolved.describe}\n`, 'stdout');
      rt.log(`匹配到 ${matched.length} 个文件（共扫描 ${result.total ?? 0} 项，被排除 ${ignored.length} 项）\n`, 'stdout');
      for (const item of files.slice(0, 50)) rt.log(`  ${item.path}\n`, 'stdout');
      if (files.length > 50) rt.log(`  …… 其余 ${files.length - 50} 条省略\n`, 'stdout');
      for (const item of ignored.slice(0, 20)) rt.log(`  [排除] ${item.path}\n`, 'stdout');
    }

    const outputs = {
      matched,
      files,
      ignored,
      ignoredCount: ignored.length,
      count: matched.length,
      total: result.total ?? 0,
      truncated: Boolean(result.truncated),
      patterns: result.patterns ?? patterns,
      base,
      baseInput: resolved.raw,
      cwd: rt.cwd,
      cwdSource: rt.cwdSource ?? '',
    };

    // 命中 0 时把「搜索目录（解析后的绝对路径）」打出来——用户看到 ~/.dsh/src
    // 立刻能判断是基准目录错了，而不是去改 glob。
    const searchDesc = `搜索目录=${base}（base="${resolved.raw}"${resolved.relative ? `，相对基准=cwd ${describeCwd(rt)}` : '，绝对路径'}）模式=[${patterns.join(', ')}]`;
    if (matched.length < minCount) {
      return {
        exitCode: 1,
        outputs,
        error: failIfEmpty
          ? `匹配结果不足：命中 ${matched.length} 个，要求至少 ${minCount} 个。${searchDesc}`
          : '',
      };
    }
    if (failIfEmpty && matched.length === 0) {
      return { exitCode: 1, outputs, error: `没有文件匹配。${searchDesc}` };
    }
    return { exitCode: 0, outputs };
  },
};

export default descriptor;
