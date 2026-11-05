/**
 * 节点：log.message —— 输出一条日志
 *
 * 主要用于在运行详情里留下可读的里程碑（例如「开始部署到生产」）。
 * 插值统一走 helpers.js 的 expandTemplate（唯一实现，两种花括号都认）。
 */
import { F, expandTemplate } from '../helpers.js';

export const descriptor = {
  type: 'log.message',
  title: '输出日志',
  category: 'utility',
  icon: 'message-square',
  description: '向运行日志写入一条可读消息',
  fields: [
    F.text('message', '消息内容', {
      rows: 4,
      required: true,
      placeholder: '开始部署 ${env.ENV}',
      description: '可用占位符：${env.X} ${variables.X} ${steps.<jobId>.outputs.<key>} '
        + '${run.id|pipelineId|pipelineName|status} ${step.id|name} ${server.id|name|host}；'
        + '也接受双花括号写法 ${ {env.X} }；未定义会报错',
    }),
    F.enum('level', '级别', ['info', 'warn', 'error'], { default: 'info' }),
  ],
  outputs: [
    { name: 'message', type: 'string' },
  ],
  env: [],
  runtime: null,

  async run(rt, inputs = {}) {
    const message = expandTemplate(String(inputs.message ?? ''), rt);
    const stream = inputs.level === 'error' || inputs.level === 'warn' ? 'stderr' : 'stdout';
    if (typeof rt.log === 'function') {
      const prefix = inputs.level === 'error' ? '[ERROR] ' : inputs.level === 'warn' ? '[WARN] ' : '';
      rt.log(`${prefix}${message}\n`, stream);
    }
    return { exitCode: 0, outputs: { message } };
  },
};

export default descriptor;
