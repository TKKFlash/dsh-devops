/**
 * 节点：env.set —— 设置后续步骤可见的环境变量
 *
 * 写入 rt.run.variables（运行级变量），后续步骤解析 env 时按契约 §3.2 的
 * 合并顺序生效。值为空的键表示删除。
 */
import { F, toRecord, expandTemplate } from '../helpers.js';

export const descriptor = {
  type: 'env.set',
  title: '设置变量',
  category: 'utility',
  icon: 'variable',
  description: '为后续步骤设置运行级环境变量',
  fields: [
    F.keyvalue('variables', '变量', {
      required: true,
      secret: true,
      description: '键值对；支持标记密钥。值支持 ${env.X}、${run.*} 占位',
    }),
    F.boolean('export', '同时导出到后续步骤的 env', { default: true }),
  ],
  outputs: [
    { name: 'set', type: 'object' },
    { name: 'count', type: 'number' },
  ],
  env: [],
  runtime: null,

  async run(rt, inputs = {}) {
    const record = toRecord(inputs.variables);
    const entries = Object.entries(record);
    if (!entries.length) return { exitCode: 1, error: '至少需要设置一个变量' };

    const applied = {};
    for (const [key, rawValue] of entries) {
      const name = String(key).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        return { exitCode: 1, error: `非法变量名：${key}（需匹配 [A-Za-z_][A-Za-z0-9_]*）` };
      }
      const value = expandTemplate(rawValue === undefined || rawValue === null ? '' : String(rawValue), rt);
      // 空串表示删除该键（契约 §3.2）
      applied[name] = value === '' ? undefined : value;
      if (typeof rt.log === 'function') {
        rt.log(`设置变量 ${name}${value === '' ? '（删除）' : '='} ${value === '' ? '' : value}\n`, 'stdout');
      }
    }

    if (inputs.export !== false) {
      if (rt.run && typeof rt.run === 'object') {
        rt.run.variables = { ...(rt.run.variables ?? {}), ...applied };
      }
      if (rt.env && typeof rt.env === 'object') {
        for (const [key, value] of Object.entries(applied)) {
          if (value === undefined) delete rt.env[key];
          else rt.env[key] = value;
        }
      }
    }

    // 通过 rt.setVariables 通知 engine 持久化（存在时）
    if (typeof rt.setVariables === 'function') {
      try {
        await rt.setVariables(applied);
      } catch (error) {
        if (typeof rt.log === 'function') rt.log(`变量持久化失败：${error?.message ?? error}\n`, 'stderr');
      }
    }

    return { exitCode: 0, outputs: { set: applied, count: entries.length } };
  },
};

export default descriptor;
