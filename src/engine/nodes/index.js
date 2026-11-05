/**
 * src/engine/nodes/index.js —— 节点注册表（契约 §3.9）
 *
 * - 18 个内置节点在 builtin/ 下，每个文件导出一个 NodeDescriptor。
 * - register() 会校验描述符：字段类型必须落在契约 §4 的白名单内，
 *   这是前端渲染表单的唯一依据，非法类型必须在注册期就报错。
 * - loadCustom(dir)：加载 <dataDir>/nodes/*.mjs，受 allowCustomNodeCode 开关约束，
 *   并做 realpath containment 校验（文件必须位于该目录内）。
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/* ------------------------------------------------------------ 内置节点导入 */

import shellExec from './builtin/shell.exec.js';
import nodeExec from './builtin/node.exec.js';
import pythonExec from './builtin/python.exec.js';
import filePick from './builtin/file.pick.js';
import fileWrite from './builtin/file.write.js';
import fileCopy from './builtin/file.copy.js';
import artifactCollect from './builtin/artifact.collect.js';
import cacheSave from './builtin/cache.save.js';
import cacheRestore from './builtin/cache.restore.js';
import conditionIf from './builtin/condition.if.js';
import waitDelay from './builtin/wait.delay.js';
import waitApproval from './builtin/wait.approval.js';
import pipelineCall from './builtin/pipeline.call.js';
import serverEnsureRuntime from './builtin/server.ensureRuntime.js';
import httpRequest from './builtin/http.request.js';
import notifyWebhook from './builtin/notify.webhook.js';
import logMessage from './builtin/log.message.js';
import envSet from './builtin/env.set.js';

/** 18 个内置节点（顺序即前端节点面板的顺序分组依据） */
export const BUILTIN_NODES = [
  shellExec,
  nodeExec,
  pythonExec,
  filePick,
  fileWrite,
  fileCopy,
  artifactCollect,
  cacheSave,
  cacheRestore,
  conditionIf,
  waitDelay,
  waitApproval,
  pipelineCall,
  serverEnsureRuntime,
  httpRequest,
  notifyWebhook,
  logMessage,
  envSet,
];

/** 契约 §4 的字段类型白名单 —— 前端控件映射的唯一依据 */
export const FIELD_TYPES = Object.freeze([
  'string',
  'text',
  'code',
  'path.dir',
  'path.file',
  'glob',
  'enum',
  'boolean',
  'number',
  'server',
  'runtime',
  'keyvalue',
  'multiselect',
  'ref:envset',
  'ref:snippet',
  'ref:pipeline',
]);

/** code 类型允许的语言 */
export const CODE_LANGUAGES = Object.freeze(['shell', 'python', 'javascript', 'json']);
/** runtime 类型允许的运行时 */
export const RUNTIME_KINDS = Object.freeze(['python', 'node']);

const TYPE_SET = new Set(FIELD_TYPES);

/**
 * 校验一个节点描述符是否合法（保存/注册自定义节点时都用它）。
 * @returns {{ok:boolean, errors:Array<{path:string,code:string,message:string}>}}
 */
export function validateDescriptor(descriptor) {
  const errors = [];
  const push = (p, code, message) => errors.push({ path: p, code, message });

  if (!descriptor || typeof descriptor !== 'object') {
    return { ok: false, errors: [{ path: '', code: 'bad-type', message: '描述符必须是对象' }] };
  }
  const { type } = descriptor;
  // 允许驼峰段（如 server.ensureRuntime）；首段必须以小写字母开头
  if (typeof type !== 'string' || !/^[a-z][A-Za-z0-9]*(?:[.-][A-Za-z0-9]+)*$/.test(type)) {
    push('type', 'bad-id', `节点类型非法：${String(type)}（应形如 shell.exec 或 server.ensureRuntime）`);
  }
  for (const key of ['title', 'category', 'description']) {
    if (typeof descriptor[key] !== 'string' || !descriptor[key]) {
      push(key, 'missing-field', `缺少 ${key}`);
    }
  }
  if (descriptor.icon !== undefined && typeof descriptor.icon !== 'string') {
    push('icon', 'bad-type', 'icon 必须是字符串');
  }
  if (typeof descriptor.run !== 'function') {
    push('run', 'missing-field', '缺少 run(rt, inputs) 函数');
  }

  if (!Array.isArray(descriptor.fields)) {
    push('fields', 'bad-type', 'fields 必须是数组');
  } else {
    descriptor.fields.forEach((field, index) => {
      const base = `fields[${index}]`;
      if (!field || typeof field !== 'object') {
        push(base, 'bad-type', '字段必须是对象');
        return;
      }
      if (typeof field.name !== 'string' || !field.name) push(`${base}.name`, 'missing-field', '缺少字段 name');
      if (typeof field.label !== 'string' || !field.label) push(`${base}.label`, 'missing-field', '缺少字段 label');
      if (!TYPE_SET.has(field.type)) {
        push(`${base}.type`, 'bad-type', `字段类型 ${String(field.type)} 不在契约 §4 白名单内`);
      }
      if (field.type === 'code' && field.language !== undefined && !CODE_LANGUAGES.includes(field.language)) {
        push(`${base}.language`, 'bad-type', `code 字段语言必须是 ${CODE_LANGUAGES.join('|')}`);
      }
      if (field.type === 'enum' && field.options !== undefined && !Array.isArray(field.options)) {
        push(`${base}.options`, 'bad-type', 'enum 字段的 options 必须是数组');
      }
      if (field.type === 'enum' && Array.isArray(field.options) && field.options.length === 0
        && !field.optionsFrom) {
        push(`${base}.options`, 'missing-field', 'enum 字段必须有 options 或 optionsFrom');
      }
      // 契约 §4：multiselect 用 options 渲染标签多选。
      // 允许 optionsFrom（动态来源）或 freeform:true（允许用户自填，例如系统包名）。
      if (field.type === 'multiselect'
        && !(Array.isArray(field.options) && field.options.length > 0)
        && typeof field.optionsFrom !== 'string'
        && field.freeform !== true) {
        push(`${base}.options`, 'missing-field', 'multiselect 字段必须有非空 options、optionsFrom 或 freeform:true');
      }
      if (field.type === 'runtime' && !RUNTIME_KINDS.includes(field.runtime)) {
        push(`${base}.runtime`, 'bad-type', `runtime 字段的 runtime 必须是 ${RUNTIME_KINDS.join('|')}`);
      }
      // multiple：多值输入标记（glob/path/string 等可用），必须是布尔
      if (field.multiple !== undefined && typeof field.multiple !== 'boolean') {
        push(`${base}.multiple`, 'bad-type', 'multiple 必须是布尔值');
      }
      if (field.type === 'number') {
        if (field.unit !== undefined && !['ms', ''].includes(field.unit) && typeof field.unit !== 'string') {
          push(`${base}.unit`, 'bad-type', 'number 字段的 unit 必须是字符串（ms 会显示为秒）');
        }
      }
    });
    // 字段名唯一性（独立检查）
    const seen = new Set();
    for (const field of descriptor.fields) {
      if (!field?.name) continue;
      if (seen.has(field.name)) push('fields', 'bad-id', `字段名重复：${field.name}`);
      seen.add(field.name);
    }
  }

  if (descriptor.outputs !== undefined) {
    if (!Array.isArray(descriptor.outputs)) {
      push('outputs', 'bad-type', 'outputs 必须是数组');
    } else {
      descriptor.outputs.forEach((output, index) => {
        if (!output || typeof output.name !== 'string' || !output.name) {
          push(`outputs[${index}].name`, 'missing-field', '输出缺少 name');
        }
      });
    }
  }
  if (descriptor.env !== undefined && !Array.isArray(descriptor.env)) {
    push('env', 'bad-type', 'env 必须是数组');
  }
  if (descriptor.runtime !== undefined && descriptor.runtime !== null) {
    if (typeof descriptor.runtime !== 'object') push('runtime', 'bad-type', 'runtime 必须是对象或 null');
  }

  return { ok: errors.length === 0, errors };
}

/**
 * 创建节点注册表。
 * @param {{executors?:object, provisioner?:object, log?:object, store?:object, config?:object}} deps
 */
export function createNodeRegistry(deps = {}) {
  const config = deps.config ?? {};
  /** @type {Map<string, object>} type → descriptor */
  const registry = new Map();
  /** 自定义节点的 disposer（重载时统一摘除） */
  const disposers = new Map();

  /**
   * 注册一个节点。
   * @returns {Function} disposer
   */
  function register(descriptor, options = {}) {
    const check = validateDescriptor(descriptor);
    if (!check.ok) {
      const detail = check.errors.map((e) => `${e.path}: ${e.message}`).join('；');
      throw new Error(`节点描述符非法（${descriptor?.type ?? '未知'}）：${detail}`);
    }
    if (registry.has(descriptor.type) && !options.override) {
      throw new Error(`节点类型已存在：${descriptor.type}`);
    }
    const entry = { ...descriptor, source: options.source ?? (options.custom ? 'custom' : 'builtin') };
    registry.set(descriptor.type, entry);

    let disposed = false;
    const disposer = () => {
      if (disposed) return;
      disposed = true;
      if (registry.get(descriptor.type) === entry) registry.delete(descriptor.type);
      disposers.delete(descriptor.type);
    };
    disposers.set(descriptor.type, disposer);
    return disposer;
  }

  /** 取节点描述符 */
  function get(type) {
    return registry.get(String(type));
  }

  /** 列出全部节点描述符（前端节点面板用） */
  function list() {
    return [...registry.values()].map((entry) => ({
      type: entry.type,
      title: entry.title,
      category: entry.category,
      icon: entry.icon ?? '',
      description: entry.description,
      fields: entry.fields ?? [],
      outputs: entry.outputs ?? [],
      env: entry.env ?? [],
      runtime: entry.runtime ?? null,
      source: entry.source ?? 'builtin',
    }));
  }

  /** 按分类聚合（前端按分类展示） */
  function categories() {
    const map = new Map();
    for (const entry of registry.values()) {
      if (!map.has(entry.category)) map.set(entry.category, []);
      map.get(entry.category).push(entry.type);
    }
    return [...map.entries()].map(([category, types]) => ({ category, types }));
  }

  /** 判断类型是否存在 */
  function has(type) {
    return registry.has(String(type));
  }

  /**
   * 加载自定义节点：<dataDir>/nodes/*.mjs
   * 需要 config.allowCustomNodeCode === true，否则直接拒绝。
   * @param {string} dir
   * @returns {Promise<{loaded:string[], failed:Array<{file:string,error:string}>, skipped:boolean, reason:string}>}
   */
  async function loadCustom(dir) {
    const target = dir ? path.resolve(String(dir)) : '';
    if (!target) return { loaded: [], failed: [], skipped: true, reason: '未提供自定义节点目录' };
    if (config.allowCustomNodeCode !== true) {
      return {
        loaded: [],
        failed: [],
        skipped: true,
        reason: '自定义节点已禁用（设置项 allowCustomNodeCode 为 false）',
      };
    }

    const loaded = [];
    const failed = [];
    let entries = [];
    try {
      entries = await fsp.readdir(target, { withFileTypes: true });
    } catch {
      return { loaded, failed, skipped: false, reason: '' }; // 目录不存在 = 没有自定义节点
    }

    const realDir = await fsp.realpath(target).catch(() => target);

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith('.mjs')) continue;
      const file = path.join(target, entry.name);
      try {
        // containment：必须在自定义节点目录内
        const realFile = await fsp.realpath(file).catch(() => file);
        const rel = path.relative(realDir, realFile);
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
          failed.push({ file, error: '文件位于自定义节点目录之外，已拒绝加载' });
          continue;
        }
        const mod = await import(pathToFileURL(realFile).href);
        const descriptor = mod.descriptor ?? mod.default ?? mod.node;
        if (!descriptor) {
          failed.push({ file, error: '未找到导出：需要 default 或 named export `descriptor`' });
          continue;
        }
        const check = validateDescriptor(descriptor);
        if (!check.ok) {
          failed.push({
            file,
            error: check.errors.map((e) => `${e.path}: ${e.message}`).join('；'),
          });
          continue;
        }
        register(descriptor, { custom: true, override: true });
        loaded.push(descriptor.type);
      } catch (error) {
        failed.push({ file, error: String(error?.message ?? error) });
      }
    }
    return { loaded, failed, skipped: false, reason: '' };
  }

  /** 卸载全部自定义节点（宿主热重载时用） */
  function clearCustom() {
    const removed = [];
    for (const [type, disposer] of [...disposers]) {
      const entry = registry.get(type);
      if (entry?.source === 'custom') {
        disposer();
        removed.push(type);
      }
    }
    return removed;
  }

  // 注册 18 个内置节点（任何一个非法都说明实现有问题，直接抛错暴露）
  for (const descriptor of BUILTIN_NODES) {
    register(descriptor, { source: 'builtin' });
  }

  return {
    list,
    get,
    has,
    register,
    loadCustom,
    clearCustom,
    categories,
    validate: validateDescriptor,
    get size() { return registry.size; },
    FIELD_TYPES,
  };
}

export default createNodeRegistry;
