/**
 * 节点：cache.restore —— 恢复缓存
 */
import { F } from '../helpers.js';
import { restoreCache } from '../cache.js';

export const descriptor = {
  type: 'cache.restore',
  title: '恢复缓存',
  category: 'cache',
  icon: 'archive-restore',
  description: '从缓存根目录恢复先前保存的文件',
  fields: [
    F.server('server', '服务器'),
    F.string('key', '缓存键', {
      required: true,
      placeholder: '${env.OS}-node-${env.NODE_VERSION}',
      description: '必须与 cache.save 的键一致才能命中',
    }),
    F.dir('base', '还原目录', { serverField: 'server', description: '缓存内容按相对路径还原到此目录' }),
    F.glob('paths', '只恢复这些子路径', {
      baseField: 'base',
      multiple: true,
      description: '留空表示恢复全部；支持 ! 取反排除',
    }),
    F.dir('cacheDir', '缓存根目录', { serverField: 'server', description: '留空使用 <dataDir>/cache' }),
    F.boolean('failIfMiss', '未命中则失败', { default: false, description: '默认未命中不算失败，交给后续步骤重新构建' }),
  ],
  outputs: [
    { name: 'key', type: 'string' },
    { name: 'hit', type: 'boolean' },
    { name: 'files', type: 'number' },
    { name: 'dir', type: 'string' },
  ],
  env: [],
  runtime: null,

  async run(rt, inputs = {}) {
    try {
      const result = await restoreCache(rt, inputs);
      if (typeof rt.log === 'function') {
        rt.log(
          result.hit
            ? `缓存命中：恢复 ${result.files} 个文件（key=${result.key}）\n`
            : `缓存未命中（key=${result.key}）\n`,
          'stdout',
        );
      }
      if (!result.hit && inputs.failIfMiss === true) {
        return { exitCode: 1, outputs: result, error: `缓存未命中：${result.key}` };
      }
      return { exitCode: 0, outputs: result };
    } catch (error) {
      return { exitCode: 1, error: `恢复缓存失败：${error?.message ?? error}` };
    }
  },
};

export default descriptor;
