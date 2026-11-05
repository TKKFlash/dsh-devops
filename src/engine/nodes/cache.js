/**
 * src/engine/nodes/cache.js —— 缓存存取共用实现
 *
 * 缓存布局：<cacheRoot>/<key>/<relative-path>
 * - 本地执行器：直接 fs 操作。
 * - 远端执行器：通过 transferIn/transferOut 逐个搬运（保持相对目录结构）。
 *
 * key 会做安全化处理（去掉路径分隔符与 ..），避免越界写到缓存根之外。
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { relativeRemote, copyRemote, joinRemote } from './fsops.js';
import { expandTemplate, resolveInputPath, checkDirectory } from './helpers.js';

/** 缓存 key 安全化：只保留字母数字与 . _ - ，其余转 - */
export function safeCacheKey(key) {
  const raw = String(key ?? '').trim();
  if (!raw) return '';
  return raw
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[.-]+/, '')
    .slice(0, 180);
}

/** 缓存根目录 */
export function cacheRoot(rt, configured) {
  if (configured) return String(configured);
  return joinRemote(rt, String(rt.config?.dataDir ?? '.'), 'cache');
}

/**
 * 展开缓存 key 模板。
 * 统一走 helpers.js 的 expandTemplate（唯一实现）：支持 ${env.X}、${variables.X}、
 * ${run.id}、${steps.*.outputs.*}、${inputs.X}，以及裸名简写 ${NAME} ≡ ${env.NAME}。
 * 注意：缓存 key 里的未定义占位符**抛错**，避免不同 key 悄悄落到同一个缓存目录。
 */
export function expandCacheKey(template, rt, inputs = {}) {
  const text = String(template ?? '').trim();
  if (!text) return '';
  return expandTemplate(text, rt, { inputs });
}

/** 将路径列表展开为「存在的文件」列表（目录则递归展开） */
async function expandPaths(rt, base, paths) {
  const out = [];
  for (const raw of paths ?? []) {
    const item = String(raw ?? '').trim();
    if (!item) continue;
    // 支持 glob 形态的条目（含多值/取反，语义统一由 executor.match 决定）
    const isGlob = /[*?{}]/.test(item) || item.startsWith('!');
    if (isGlob) {
      const res = await rt.executor
        .match(rt.server, base, [item], { includeDirs: false, maxEntries: 20000 })
        .catch(() => ({ matched: [] }));
      for (const hit of res.matched ?? []) out.push({ path: hit.path, size: hit.size ?? 0 });
      continue;
    }
    const abs = path.isAbsolute(item) ? item : joinRemote(rt, base, item);
    const info = await rt.executor.stat(rt.server, abs).catch(() => ({ exists: false }));
    if (!info.exists) continue;
    if (!info.isDir) {
      out.push({ path: abs, size: info.size ?? 0 });
      continue;
    }
    // 目录：递归展开
    const res = await rt.executor.match(rt.server, abs, ['**'], { includeDirs: false, maxEntries: 20000 }).catch(() => ({ matched: [] }));
    for (const hit of res.matched ?? []) out.push({ path: hit.path, size: hit.size ?? 0 });
  }
  return out;
}

/**
 * 保存缓存。
 * @returns {Promise<{key:string,dir:string,files:number,bytes:number,skipped:boolean}>}
 */
export async function saveCache(rt, inputs = {}) {
  const key = safeCacheKey(expandCacheKey(inputs.key, rt, inputs));
  if (!key) throw new Error('缓存 key 不能为空（建议使用 ${env.X} 或 ${run.pipelineId} 形式）');
  const root = cacheRoot(rt, inputs.cacheDir);
  const dir = joinRemote(rt, root, key);

  // base 为空回退到 rt.cwd；并记录解析结果用于报错溯源
  const resolved = resolveInputPath(rt, inputs.base, rt.cwd);
  const base = resolved.abs;
  const paths = Array.isArray(inputs.paths) ? inputs.paths : [];

  // 只有「用户显式给了 base 但目录不存在」才是配置错误；
  // 未给 base 时回退 cwd，cwd 不存在同样报错（便于发现工作目录没设对）。
  if (base && paths.length) {
    const dirError = await checkDirectory(rt, base, resolved.describe, 'base');
    if (dirError) {
      const error = new Error(dirError);
      error.code = 'CACHE_BASE_INVALID';
      throw error;
    }
  }
  if (!base) {
    throw new Error('基准目录不可用：base 为空且工作目录未设置（请检查 server.workdir）');
  }

  const files = await expandPaths(rt, base, paths);

  if (!files.length) {
    // 没有可缓存内容不算失败（首次构建常见）
    return { key, dir, files: 0, bytes: 0, skipped: true };
  }

  // 清空旧缓存后重建，避免残留已删除的文件
  if (rt.executor.kind === 'local') {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  await fsp.mkdir(rt.executor.kind === 'local' ? dir : path.dirname(dir), { recursive: true }).catch(() => {});

  let bytes = 0;
  let count = 0;
  for (const file of files) {
    if (rt.signal?.aborted) break;
    const rel = file.path.startsWith(base) ? relativeRemote(rt, base, file.path) : path.posix.basename(file.path);
    const target = joinRemote(rt, dir, rel);
    try {
      await copyRemote(rt, file.path, target, { overwrite: true, recursive: true });
      bytes += file.size || 0;
      count += 1;
    } catch (error) {
      if (typeof rt.log === 'function') rt.log(`缓存写入失败 ${rel}：${error?.message ?? error}\n`, 'stderr');
    }
  }
  return { key, dir, files: count, bytes, skipped: false };
}

/**
 * 恢复缓存。
 * @returns {Promise<{key:string,dir:string,files:number,hit:boolean}>}
 */
export async function restoreCache(rt, inputs = {}) {
  const key = safeCacheKey(expandCacheKey(inputs.key, rt, inputs));
  if (!key) throw new Error('缓存 key 不能为空');
  const root = cacheRoot(rt, inputs.cacheDir);
  const dir = joinRemote(rt, root, key);

  const info = await rt.executor.stat(rt.server, dir).catch(() => ({ exists: false }));
  if (!info.exists) {
    return { key, dir, files: 0, hit: false };
  }

  // 还原目录：base 为空回退 rt.cwd；用户显式指定但不存在时给出可读错误
  const resolved = resolveInputPath(rt, inputs.base, rt.cwd);
  const base = resolved.abs;
  if (!base) {
    throw new Error('还原目录不可用：base 为空且工作目录未设置（请检查 server.workdir）');
  }
  if (String(inputs.base ?? '').trim()) {
    const dirError = await checkDirectory(rt, base, resolved.describe, 'base');
    if (dirError) {
      const error = new Error(dirError);
      error.code = 'CACHE_BASE_INVALID';
      throw error;
    }
  }
  const res = await rt.executor.match(rt.server, dir, ['**'], { includeDirs: false, maxEntries: 20000 }).catch(() => ({ matched: [] }));

  // 只恢复指定子路径：paths 为 glob 多值（支持 ! 取反），按契约 §3.7.1 的
  // 「最后命中决定归属」语义筛选，避免自己写取反过滤导致语义反转。
  let filter = null;
  if (Array.isArray(inputs.paths) && inputs.paths.length) {
    const wanted = inputs.paths.map((p) => String(p ?? '').trim()).filter(Boolean);
    if (wanted.length) {
      const globModule = await loadGlobForFilter();
      filter = (rel) => {
        if (globModule?.filterPaths) {
          const out = globModule.filterPaths(wanted, [rel], { caseSensitive: true });
          return out.matched.length > 0;
        }
        return wanted.some((w) => rel === w || rel.startsWith(`${w}/`));
      };
    }
  }

  let count = 0;
  for (const hit of res.matched ?? []) {
    if (rt.signal?.aborted) break;
    const rel = relativeRemote(rt, dir, hit.path);
    if (filter && !filter(rel)) continue;
    const target = joinRemote(rt, base, rel);
    try {
      await copyRemote(rt, hit.path, target, { overwrite: true, recursive: true });
      count += 1;
    } catch (error) {
      if (typeof rt.log === 'function') rt.log(`缓存恢复失败 ${rel}：${error?.message ?? error}\n`, 'stderr');
    }
  }
  return { key, dir, files: count, hit: true };
}

/** 惰性加载 model/glob.js（缺失时上层走字符串前缀兜底） */
let globModuleCache = null;
async function loadGlobForFilter() {
  if (globModuleCache === null) {
    globModuleCache = await import('../model/glob.js').catch(() => false);
  }
  return globModuleCache || null;
}
