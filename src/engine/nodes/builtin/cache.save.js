/**
 * 节点：cache.save —— 保存缓存
 */
import { F } from '../helpers.js';
import { saveCache } from '../cache.js';

export const descriptor = {
  type: 'cache.save',
  title: '保存缓存',
  category: 'cache',
  icon: 'archive',
  description: '把指定路径缓存到缓存根目录，供后续运行复用',
  fields: [
    F.server('server', '服务器'),
    F.string('key', '缓存键', {
      required: true,
      placeholder: '${env.OS}-node-${env.NODE_VERSION}',
      description: '支持 ${env.X}、${run.id}、${run.pipelineId}、${step.id}、${server.id} 占位',
    }),
    F.dir('base', '基准目录', { serverField: 'server', description: 'paths 中的相对路径以此为基准' }),
    F.glob('paths', '缓存路径', {
      baseField: 'base',
      multiple: true,
      placeholder: 'node_modules\n.venv',
      description: '可填多个；相对基准目录或绝对路径。目录会递归缓存，支持 ! 取反排除',
    }),
    F.dir('cacheDir', '缓存根目录', { serverField: 'server', description: '留空使用 <dataDir>/cache' }),
    F.boolean('failIfEmpty', '无内容则失败', { default: false, description: '首次构建没有缓存内容时通常应继续' }),
  ],
  outputs: [
    { name: 'key', type: 'string' },
    { name: 'dir', type: 'string' },
    { name: 'files', type: 'number' },
    { name: 'bytes', type: 'number' },
    { name: 'skipped', type: 'boolean' },
  ],
  env: [],
  runtime: null,

  async run(rt, inputs = {}) {
    try {
      const result = await saveCache(rt, inputs);
      if (typeof rt.log === 'function') {
        rt.log(
          result.skipped
            ? `没有可缓存的内容（key=${result.key}），已跳过\n`
            : `已缓存 ${result.files} 个文件（${result.bytes} 字节）到 ${result.dir}\n`,
          'stdout',
        );
      }
      if (result.skipped && inputs.failIfEmpty === true) {
        return { exitCode: 1, outputs: result, error: `没有匹配到可缓存内容：${(inputs.paths ?? []).join(', ')}` };
      }
      return { exitCode: 0, outputs: result };
    } catch (error) {
      return { exitCode: 1, error: `保存缓存失败：${error?.message ?? error}` };
    }
  },
};

export default descriptor;
