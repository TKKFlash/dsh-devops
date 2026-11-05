/**
 * 节点：wait.delay —— 等待一段时间
 *
 * 用可中断的 sleep：rt.signal 触发时立刻结束并返回 canceled，
 * 保证「取消运行」不会被长等待拖住。
 */
import { F } from '../helpers.js';

export const descriptor = {
  type: 'wait.delay',
  title: '等待',
  category: 'flow',
  icon: 'clock',
  description: '等待指定时间后继续，可被取消中断',
  fields: [
    F.number('ms', '等待时长', { min: 0, unit: 'ms', default: 5000, description: '毫秒；1000 = 1 秒' }),
    F.text('reason', '等待原因', { rows: 2, placeholder: '等待服务预热完成' }),
  ],
  outputs: [
    { name: 'waitedMs', type: 'number' },
    { name: 'canceled', type: 'boolean' },
  ],
  env: [],
  runtime: null,

  async run(rt, inputs = {}) {
    const total = Math.max(0, Number(inputs.ms) || 0);
    if (inputs.reason && typeof rt.log === 'function') rt.log(`${inputs.reason}\n`, 'stdout');

    const startedAt = Date.now();
    // 可中断等待：每 200ms 检查一次取消信号
    const tick = 200;
    let waited = 0;
    while (waited < total) {
      if (rt.signal?.aborted) {
        return { exitCode: 130, outputs: { waitedMs: Date.now() - startedAt, canceled: true }, error: '等待被取消' };
      }
      const slice = Math.min(tick, total - waited);
      await new Promise((resolve) => {
        // 等待是活跃工作，不可 unref（否则宿主进程可能提前退出）
        setTimeout(resolve, slice);
      });
      waited += slice;
    }
    return { exitCode: 0, outputs: { waitedMs: Date.now() - startedAt, canceled: false } };
  },
};

export default descriptor;
