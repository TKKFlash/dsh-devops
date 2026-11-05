/**
 * 模板插值与实例化（契约 §3.3）。
 *
 * - `interpolate(str, ctx)`：替换 `${{ x.y }}`。**未定义的路径直接抛错**（不静默留空），
 *   保证「模板缺参数」在生成流水线时就暴露，而不是在运行期。
 * - `buildContext({...})`：把变量/参数/步骤输出/环境/服务器/运行组装成插值上下文。
 * - `instantiate(template, params)`：校验必填参数 → 递归插值 body → 返回新流水线。
 * - `extractParameter(pipeline, path)`：编辑器「提升为参数」用，返回参数描述符 + 替换后的流水线。
 */

import { newId, validateTemplate, normalizePipeline } from './schema.js';

/** 匹配 `${{ path }}`，允许 `${{x}}` 这种无空格写法。 */
const PLACEHOLDER = /\$\{\{\s*([^}]*?)\s*\}\}/g;

/**
 * 按点路径取值，支持数组下标（`steps[0].outputs.exitCode` 与 `steps.0.outputs.exitCode`）。
 * 键**存在但值为 `undefined`** 也算未定义：模板里写了占位符却拿到空值，
 * 比直接报错更难排查（下游会收到空字符串）。
 * @returns {{found:boolean, value:any}}
 */
function getByPath(source, path) {
  if (!path) return { found: false, value: undefined };
  const tokens = String(path)
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .map((t) => t.trim())
    .filter((t) => t !== '');
  let current = source;
  for (const token of tokens) {
    if (current === null || current === undefined) return { found: false, value: undefined };
    if (typeof current !== 'object') return { found: false, value: undefined };
    if (!Object.prototype.hasOwnProperty.call(current, token)) return { found: false, value: undefined };
    current = current[token];
  }
  // 显式 undefined 视同未定义
  if (current === undefined) return { found: false, value: undefined };
  return { found: true, value: current };
}

/** 把任意值转成插值文本。 */
function stringify(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  return JSON.stringify(value);
}

/** 构造可读的路径候选列表，用于「未定义」报错提示。 */
function suggestKeys(source, path) {
  const head = String(path ?? '').split(/[.[]/)[0];
  const scope = head && source && typeof source === 'object' ? source[head] : source;
  if (!scope || typeof scope !== 'object') return [];
  return Object.keys(scope).slice(0, 8);
}

/**
 * 插值替换。
 * @param {string} str
 * @param {object} ctx 插值上下文（通常来自 buildContext）
 * @returns {string}
 * @throws {Error} 当 `str` 不是字符串、占位符路径在 ctx 中不存在或为 undefined 时
 */
export function interpolate(str, ctx = {}) {
  if (typeof str !== 'string') {
    // 明确抛错而不是原样返回：否则「插值没生效」会被埋到很深的地方
    throw new TypeError(`interpolate 的第一个参数必须是字符串，收到 ${str === null ? 'null' : typeof str}`);
  }
  const scope = ctx && typeof ctx === 'object' ? ctx : {};
  return str.replace(PLACEHOLDER, (_match, rawPath) => {
    const path = String(rawPath).trim();
    if (path === '') {
      throw new Error('插值占位符为空：$' + '{{ }}');
    }
    const { found, value } = getByPath(scope, path);
    if (!found) {
      const hints = suggestKeys(scope, path);
      const hintText = hints.length > 0 ? `；可用键：${hints.join(', ')}` : '';
      // 注意：模板字符串里不能直接写 `${{`（会被解析成 `${` 后跟对象字面量），故用拼接
      const marker = '$' + '{{ ' + path + ' }}';
      throw new Error('未定义的插值变量：' + marker + hintText);
    }
    return stringify(value);
  });
}

/** 深层插值：递归处理对象/数组/字符串，非字符串叶子原样保留。 */
function deepInterpolate(value, ctx, path) {
  if (typeof value === 'string') {
    return interpolate(value, ctx);
  }
  if (Array.isArray(value)) {
    return value.map((item, i) => deepInterpolate(item, ctx, `${path}[${i}]`));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = deepInterpolate(item, ctx, path ? `${path}.${key}` : key);
    }
    return out;
  }
  return value;
}

/**
 * 组装插值上下文。
 * @param {{variables?:object, params?:object, steps?:object, env?:object,
 *          server?:object, run?:object, [key:string]:any}} input
 * @returns {object} 至少包含 variables/params/steps/env/server/run 六个命名空间
 */
export function buildContext(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  // 允许调用方直接传入额外命名空间（如 pipeline/stage/job），与约定命名空间合并
  return {
    variables: source.variables ?? {},
    params: source.params ?? {},
    steps: source.steps ?? {},
    env: source.env ?? {},
    server: source.server ?? {},
    run: source.run ?? {},
    ...source,
  };
}

/** 参数默认值：优先 default，其次按类型给零值。 */
function defaultValueOf(param) {
  if (param.default !== undefined && param.default !== null) return param.default;
  switch (param.type) {
    case 'boolean':
      return false;
    case 'number':
      return 0;
    case 'multiselect':
      return [];
    case 'keyvalue':
      return {};
    default:
      return undefined;
  }
}

/** 按类型校验单个参数值。 */
function validateParamValue(param, value, path) {
  const errors = [];
  const type = param.type;
  const isBlank = value === undefined || value === null || value === '';
  if (isBlank) {
    if (param.required === true) {
      errors.push({ path, code: 'missing-field', message: `缺少必填参数：${param.name}` });
    }
    return errors;
  }
  switch (type) {
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        errors.push({ path, code: 'bad-type', message: `参数 ${param.name} 必须是数字` });
      } else {
        if (typeof param.min === 'number' && value < param.min) {
          errors.push({ path, code: 'bad-type', message: `参数 ${param.name} 不能小于 ${param.min}` });
        }
        if (typeof param.max === 'number' && value > param.max) {
          errors.push({ path, code: 'bad-type', message: `参数 ${param.name} 不能大于 ${param.max}` });
        }
      }
      break;
    case 'boolean':
      if (typeof value !== 'boolean') {
        errors.push({ path, code: 'bad-type', message: `参数 ${param.name} 必须是布尔值` });
      }
      break;
    case 'enum':
      if (Array.isArray(param.options) && param.options.length > 0 && !param.options.includes(value)) {
        errors.push({ path, code: 'bad-type', message: `参数 ${param.name} 必须是 ${param.options.join('|')} 之一` });
      }
      break;
    case 'multiselect':
      if (!Array.isArray(value)) {
        errors.push({ path, code: 'bad-type', message: `参数 ${param.name} 必须是数组` });
      }
      break;
    case 'keyvalue':
      if (typeof value !== 'object' || Array.isArray(value)) {
        errors.push({ path, code: 'bad-type', message: `参数 ${param.name} 必须是键值表` });
      }
      break;
    default:
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
        errors.push({ path, code: 'bad-type', message: `参数 ${param.name} 类型不合法` });
      }
      break;
  }
  return errors;
}

/**
 * 实例化模板（契约 §3.3）。
 * @param {object} template
 * @param {object} params 参数值表
 * @returns {{ok:true, value:object}|{ok:false, errors:Array}}
 */
export function instantiate(template, params = {}) {
  const templateCheck = validateTemplate(template);
  if (!templateCheck.ok) return { ok: false, errors: templateCheck.errors };
  if (params !== null && params !== undefined && typeof params !== 'object') {
    return { ok: false, errors: [{ path: 'params', code: 'bad-type', message: '参数必须是对象' }] };
  }
  const provided = params && typeof params === 'object' ? params : {};
  const errors = [];
  const resolvedParams = {};

  for (const param of template.parameters) {
    // 显式传 undefined 视同「未提供」：应回落到默认值，否则报必填缺失
    const hasValue =
      Object.prototype.hasOwnProperty.call(provided, param.name) && provided[param.name] !== undefined;
    const rawValue = hasValue ? provided[param.name] : defaultValueOf(param);
    if (rawValue === undefined) {
      if (param.required === true) {
        errors.push({
          path: `params.${param.name}`,
          code: 'missing-field',
          message: `缺少必填参数：${param.label || param.name}`,
        });
      }
      // 可选且无默认值 → 不进入上下文；若 body 引用它，interpolate 会明确报错
      continue;
    }
    errors.push(...validateParamValue(param, rawValue, `params.${param.name}`));
    resolvedParams[param.name] = rawValue;
  }

  // 拒绝模板未声明的参数（拼写错误应当立刻暴露，而不是被静默忽略）
  const declared = new Set(template.parameters.map((p) => p.name));
  for (const key of Object.keys(provided)) {
    if (!declared.has(key)) {
      errors.push({ path: `params.${key}`, code: 'unknown-field', message: `模板没有声明参数：${key}` });
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  const ctx = buildContext({
    params: resolvedParams,
    variables: {},
    steps: {},
    env: {},
    server: {},
    run: {},
  });

  let body;
  try {
    body = deepInterpolate(template.body, ctx, 'body');
  } catch (error) {
    return {
      ok: false,
      errors: [{ path: 'body', code: 'missing-field', message: `模板插值失败：${error.message}` }],
    };
  }

  // 实例化产物必须是一条合法流水线：补 id/name 后规范化
  const pipeline = normalizePipeline({
    ...body,
    id: body?.id ?? newId('pipeline'),
    name: body?.name ?? template.name,
    description: body?.description ?? template.description ?? '',
    category: body?.category ?? template.category ?? '',
    tags: Array.isArray(body?.tags) ? body.tags : Array.isArray(template.tags) ? template.tags : [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  return { ok: true, value: pipeline };
}

/**
 * 「提升为参数」：把 pipeline 中指定路径的值抽成模板参数占位符。
 * @param {object} pipeline
 * @param {string} path 点路径，如 `stages[0].jobs[1].with.script`
 * @param {{name?:string,type?:string,label?:string,description?:string}} [options]
 * @returns {{ok:true, parameter:object, value:object}|{ok:false, errors:Array}}
 */
export function extractParameter(pipeline, path, options = {}) {
  const errors = [];
  if (!pipeline || typeof pipeline !== 'object') {
    return { ok: false, errors: [{ path: '', code: 'bad-type', message: '流水线必须是对象' }] };
  }
  if (typeof path !== 'string' || path.trim() === '') {
    return { ok: false, errors: [{ path: 'path', code: 'missing-field', message: '缺少提取路径' }] };
  }
  const target = getByPath(pipeline, path);
  if (!target.found) {
    return { ok: false, errors: [{ path, code: 'missing-field', message: `路径不存在：${path}` }] };
  }
  const value = target.value;
  if (typeof value === 'object' && value !== null) {
    return { ok: false, errors: [{ path, code: 'bad-type', message: '只能把标量值提升为参数' }] };
  }

  const leaf = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean).pop() ?? 'param';
  const name = typeof options.name === 'string' && options.name !== '' ? options.name : `${leaf}_${Math.abs(hash(path)) % 1000}`;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    errors.push({ path: 'name', code: 'bad-id', message: '参数名需符合标识符规则' });
  }
  if (errors.length > 0) return { ok: false, errors };

  let type = options.type;
  if (!type) {
    if (typeof value === 'boolean') type = 'boolean';
    else if (typeof value === 'number') type = 'number';
    else if (String(value).includes('\n')) type = 'text';
    else type = 'string';
  }

  // 深拷贝后替换目标值为占位符
  const clone = JSON.parse(JSON.stringify(pipeline));
  const tokens = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let cursor = clone;
  for (let i = 0; i < tokens.length - 1; i += 1) {
    cursor = cursor?.[tokens[i]];
    if (cursor === undefined || cursor === null) {
      return { ok: false, errors: [{ path, code: 'missing-field', message: `路径不存在：${path}` }] };
    }
  }
  const last = tokens[tokens.length - 1];
  if (cursor === undefined || cursor === null || !(last in cursor)) {
    return { ok: false, errors: [{ path, code: 'missing-field', message: `路径不存在：${path}` }] };
  }
  cursor[last] = `\${{ params.${name} }}`;

  return {
    ok: true,
    parameter: {
      name,
      label: typeof options.label === 'string' ? options.label : leaf,
      type,
      required: true,
      default: value,
      options: type === 'enum' ? [String(value)] : [],
      field: type === 'text' ? 'text' : 'string',
      description: typeof options.description === 'string' ? options.description : '',
    },
    value: clone,
  };
}

/** 稳定的 32 位字符串哈希（提取参数命名用，避免依赖 crypto）。 */
function hash(text) {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) {
    h = (h << 5) - h + text.charCodeAt(i);
    h |= 0;
  }
  return h;
}
