/**
 * 插件配置（契约 §2.4 settings、§3.10 allowLanAccess、§3.12 Config）。
 *
 * 这一层只做「解析 + 收敛 + 默认值」，不依赖 schemastery：
 * 若宿主提供 schemastery，`index.js` 可把这个描述对象转成它的 Schema；
 * 都不需要时它就是一份普通对象，零依赖。
 *
 * dataDir 默认 `<DSH_HOME>/data/dsh-devops`；DSH_HOME 缺失时回退到 `~/.dsh`。
 */

import os from 'node:os';
import path from 'node:path';

/** 插件名（用于目录名与日志前缀）。 */
export const PLUGIN_NAME = 'dsh-devops';

/** 数值型配置的合法范围。 */
export const CONFIG_LIMITS = Object.freeze({
  maxConcurrentRuns: { min: 1, max: 64, integer: true },
  maxParallelSteps: { min: 1, max: 128, integer: true },
  logRingBytes: { min: 65536, max: 64 * 1024 * 1024, integer: true },
  logRetentionDays: { min: 0, max: 3650, integer: true },
  stuckSilenceSec: { min: 5, max: 86400, integer: true },
  port: { min: 0, max: 65535, integer: true },
});

/** `defaultShell` 的可选值（auto = 按目标系统探测）。 */
export const SHELL_CHOICES = Object.freeze(['auto', 'bash', 'sh', 'zsh', 'fish', 'pwsh', 'powershell', 'cmd']);

/**
 * 解析 DSH 数据根目录。
 * 优先 `DSH_HOME`，其次 `~/.dsh`。
 * @param {Record<string,string|undefined>} [env]
 * @returns {string}
 */
export function resolveDshHome(env = process.env) {
  const fromEnv = env?.DSH_HOME;
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return path.resolve(fromEnv);
  return path.join(os.homedir(), '.dsh');
}

/**
 * 计算默认 dataDir。
 * @param {Record<string,string|undefined>} [env]
 * @returns {string}
 */
export function defaultDataDir(env = process.env) {
  return path.join(resolveDshHome(env), 'data', PLUGIN_NAME);
}

/**
 * 配置默认值。
 * @param {Record<string,string|undefined>} [env]
 * @returns {object}
 */
export function defaultConfig(env = process.env) {
  return {
    // 路径
    dataDir: defaultDataDir(env),
    // 调度
    maxConcurrentRuns: 2,
    maxParallelSteps: 4,
    defaultServer: 'local',
    defaultShell: 'auto',
    // 日志
    logRingBytes: 524288,
    logRetentionDays: 30,
    stuckSilenceSec: 60,
    // 界面
    statusBar: true,
    // 安全
    allowLanAccess: false,
    allowCustomNodeCode: false,
  };
}

/** 把值收敛到合法范围；非法值回落到默认值。 */
function coerceNumber(key, value, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const limit = CONFIG_LIMITS[key];
  if (!limit) return value;
  let next = limit.integer ? Math.round(value) : value;
  if (next < limit.min) next = limit.min;
  if (next > limit.max) next = limit.max;
  return next;
}

/**
 * 解析并收敛配置。
 * 未知键会被保留（前向兼容），但不会覆盖已知键的类型约束。
 * @param {object} [input] 宿主传入的插件配置
 * @param {Record<string,string|undefined>} [env]
 * @returns {object} 完整配置
 */
export function resolveConfig(input = {}, env = process.env) {
  const base = defaultConfig(env);
  const source = input && typeof input === 'object' ? input : {};
  const out = { ...base };

  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    out[key] = value;
  }

  // 路径：相对路径按 cwd 解析成绝对路径，保证 store 与日志落在同一处
  const rawDir = typeof out.dataDir === 'string' && out.dataDir.trim() !== '' ? out.dataDir : base.dataDir;
  out.dataDir = path.resolve(rawDir);

  for (const key of Object.keys(CONFIG_LIMITS)) {
    out[key] = coerceNumber(key, out[key], base[key]);
  }

  // 布尔项严格转成布尔，避免字符串 "false" 被当成真
  for (const key of ['statusBar', 'allowLanAccess', 'allowCustomNodeCode']) {
    if (typeof out[key] !== 'boolean') out[key] = Boolean(out[key]);
  }

  if (typeof out.defaultServer !== 'string' || out.defaultServer.trim() === '') {
    out.defaultServer = base.defaultServer;
  }
  if (!SHELL_CHOICES.includes(out.defaultShell)) {
    out.defaultShell = base.defaultShell;
  }

  return out;
}

/**
 * 把配置投影成 settings 单例的默认值（契约 §2.4）。
 * 两者字段大部分同名，这里显式列出映射，避免隐式耦合。
 * @param {object} config
 * @returns {object}
 */
export function configToSettings(config) {
  const resolved = resolveConfig(config);
  return {
    defaultServer: resolved.defaultServer,
    maxConcurrentRuns: resolved.maxConcurrentRuns,
    maxParallelSteps: resolved.maxParallelSteps,
    logRingBytes: resolved.logRingBytes,
    logRetentionDays: resolved.logRetentionDays,
    defaultShell: resolved.defaultShell,
    statusBar: resolved.statusBar,
    stuckSilenceSec: resolved.stuckSilenceSec,
    allowCustomNodeCode: resolved.allowCustomNodeCode,
  };
}

/**
 * 配置项说明（供前端设置页与 README 生成，也是给 schemastery 的元数据）。
 * `type` 用契约 §4 的字段类型，便于前端直接复用类型化控件。
 */
export const CONFIG_FIELDS = Object.freeze([
  { name: 'dataDir', type: 'path.dir', label: '数据目录', default: '', description: '存储与运行日志的根目录，默认 <DSH_HOME>/data/dsh-devops' },
  { name: 'defaultServer', type: 'server', label: '默认服务器', default: 'local', description: '未显式指定时使用的服务器 id' },
  { name: 'maxConcurrentRuns', type: 'number', label: '最大并发运行数', default: 2, min: 1, max: 64, description: '同时运行的流水线数量上限' },
  { name: 'maxParallelSteps', type: 'number', label: '最大并行步骤数', default: 4, min: 1, max: 128, description: '单个运行内并行执行的步骤上限' },
  { name: 'defaultShell', type: 'enum', label: '默认 Shell', default: 'auto', options: [...SHELL_CHOICES], description: 'auto 表示按目标系统自动探测' },
  { name: 'logRingBytes', type: 'number', label: '日志内存环上限', default: 524288, min: 65536, max: 67108864, description: '超出后旧日志只留在磁盘' },
  { name: 'logRetentionDays', type: 'number', label: '日志保留天数', default: 30, min: 0, max: 3650, description: '0 表示不自动清理' },
  { name: 'stuckSilenceSec', type: 'number', label: '卡住判定阈值（秒）', default: 60, min: 5, max: 86400, description: '超过该时长无输出即提示「可能卡住」' },
  { name: 'statusBar', type: 'boolean', label: '显示状态栏', default: true, description: '在界面底部显示运行状态条' },
  { name: 'allowLanAccess', type: 'boolean', label: '允许非本机访问 API', default: false, description: '关闭时仅接受 loopback 请求' },
  { name: 'allowCustomNodeCode', type: 'boolean', label: '允许自定义节点代码', default: false, description: '开启后才会加载 <dataDir>/nodes/*.mjs' },
]);

/**
 * 普通对象形式的配置 Schema（零依赖）。
 * 宿主若可用 schemastery，可在 index.js 里据此构造；否则直接用本对象校验。
 */
export const Config = Object.freeze({
  type: 'object',
  properties: Object.fromEntries(
    CONFIG_FIELDS.map((field) => [
      field.name,
      {
        type: field.type === 'number' ? 'number' : field.type === 'boolean' ? 'boolean' : 'string',
        default: field.default,
        description: field.description,
        ...(field.min !== undefined ? { min: field.min } : {}),
        ...(field.max !== undefined ? { max: field.max } : {}),
        ...(field.options ? { enum: field.options } : {}),
      },
    ]),
  ),
  additionalProperties: true,
});
