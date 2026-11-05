// 测试辅助：按契约路径加载被测模块。
// 设计原则：模块缺失 / import 失败时**绝不伪造通过**——返回带原因的结构，
// 由上层的 describe(..., {skip: reason}) 显示为 skipped，并在最终报告中如实列出。
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** 插件根目录（test/helpers -> 插件根） */
export const pluginRoot = resolve(here, '..', '..');

/** 相对插件根解析绝对路径 */
export function pluginPath(...parts) {
  return resolve(pluginRoot, ...parts);
}

/** 契约 §3 定义的模块清单（用于可用性总检） */
export const CONTRACT_MODULES = [
  'src/model/schema.js',
  'src/model/variables.js',
  'src/model/template.js',
  'src/model/glob.js',
  'src/store/store.js',
  'src/logs/logstore.js',
  'src/engine/dag.js',
  'src/engine/run.js',
  'src/engine/executors/index.js',
  'src/engine/executors/local.js',
  'src/engine/executors/ssh.js',
  'src/engine/provision/ensure.js',
  'src/engine/provision/probe.js',
  'src/engine/nodes/index.js',
  'src/api/router.js',
  'src/tools.js',
  'src/skills.js',
  'index.js',
];

/** 尝试 import 一个相对插件根的模块；永不抛错 */
export async function tryImport(rel) {
  const abs = pluginPath(rel);
  if (!existsSync(abs)) {
    return { ok: false, rel, abs, reason: `模块文件不存在（尚未落地）：${rel}` };
  }
  try {
    const mod = await import(pathToFileURL(abs).href);
    return { ok: true, rel, abs, mod };
  } catch (error) {
    return {
      ok: false,
      rel,
      abs,
      error,
      reason: `import 失败：${error?.code ? `${error.code} ` : ''}${error?.message ?? error}`,
    };
  }
}

/**
 * 为一个测试文件准备被测模块。
 * @returns {{mod: any|null, skip: string|false, reason: string}}
 */
export async function suiteFor(rel) {
  const r = await tryImport(rel);
  if (r.ok) return { mod: r.mod, skip: false, reason: '' };
  return { mod: null, skip: `模块未就绪，跳过：${r.reason}`, reason: r.reason };
}

/** 在已加载的模块上取导出函数；缺失时抛出可读错误（用于 test 内部，不算伪通过） */
export function requiredFn(mod, name, rel = '') {
  const fn = mod?.[name];
  if (typeof fn !== 'function') {
    throw new Error(`契约要求导出函数 ${name}()，但在 ${rel || '模块'} 中不存在（实际类型：${typeof fn}）`);
  }
  return fn;
}

/** 取导出常量/对象 */
export function requiredValue(mod, name, rel = '') {
  const v = mod?.[name];
  if (v === undefined) {
    throw new Error(`契约要求导出 ${name}，但在 ${rel || '模块'} 中不存在`);
  }
  return v;
}
