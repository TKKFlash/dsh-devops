/**
 * 节点：notify.webhook —— 发送通知
 *
 * 支持通用 webhook（JSON）与常见 IM 的简化载荷（企业微信/钉钉/Slack）。
 * 通知失败默认不让流水线失败（可用 failOnError 打开）。
 */
import { F, httpRequest, toRecord, expandTemplate } from '../helpers.js';

export const descriptor = {
  type: 'notify.webhook',
  title: '发送通知',
  category: 'network',
  icon: 'bell',
  description: '向 webhook 地址推送运行结果通知',
  fields: [
    F.string('url', 'Webhook 地址', { required: true, placeholder: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...' }),
    F.enum('kind', '通知类型', ['generic', 'wecom', 'dingtalk', 'slack'], { default: 'generic', description: '决定载荷格式' }),
    F.text('message', '通知内容', {
      rows: 4,
      required: true,
      placeholder: '流水线 ${run.pipelineId} 结果：${run.status}',
      description: '支持 ${run.pipelineId}、${run.status}、${run.id}、${env.X} 占位',
    }),
    F.enum('onStatus', '触发时机', ['always', 'success', 'failure'], { default: 'always' }),
    F.number('timeoutMs', '超时', { min: 0, unit: 'ms', default: 15000 }),
    F.boolean('failOnError', '通知失败则步骤失败', { default: false }),
  ],
  outputs: [
    { name: 'status', type: 'number' },
    { name: 'sent', type: 'boolean' },
    { name: 'body', type: 'string' },
  ],
  env: [],
  runtime: null,

  async run(rt, inputs = {}) {
    const url = String(inputs.url ?? '').trim();
    if (!url) return { exitCode: 1, error: 'Webhook 地址不能为空' };

    const runStatus = String(rt.run?.status ?? '');
    const onStatus = String(inputs.onStatus ?? 'always');
    const shouldNotify = onStatus === 'always'
      || (onStatus === 'success' && runStatus === 'success')
      || (onStatus === 'failure' && runStatus === 'failed');
    if (!shouldNotify) {
      if (typeof rt.log === 'function') rt.log(`当前运行状态为 ${runStatus}，按配置跳过通知\n`, 'stdout');
      return { exitCode: 0, outputs: { status: 0, sent: false, body: '', skipped: true } };
    }

    const message = expandTemplate(String(inputs.message ?? ''), rt);
    const kind = String(inputs.kind ?? 'generic');
    let body;
    if (kind === 'wecom') {
      body = JSON.stringify({ msgtype: 'text', text: { content: message } });
    } else if (kind === 'dingtalk') {
      body = JSON.stringify({ msgtype: 'text', text: { content: message } });
    } else if (kind === 'slack') {
      body = JSON.stringify({ text: message });
    } else {
      body = JSON.stringify({
        runId: rt.run?.id ?? '',
        pipelineId: rt.run?.pipelineId ?? '',
        pipelineName: rt.run?.pipelineName ?? '',
        status: runStatus,
        stepId: rt.step?.id ?? '',
        stepName: rt.step?.name ?? '',
        message,
      });
    }

    const headers = { 'Content-Type': 'application/json', ...toRecord(inputs.headers) };
    const timeoutMs = Number(inputs.timeoutMs) > 0 ? Number(inputs.timeoutMs) : 15000;

    try {
      if (typeof rt.log === 'function') rt.log(`发送通知到 ${url}（${kind}）\n`, 'stdout');
      const res = await httpRequest({ url, method: 'POST', headers, body, timeoutMs, signal: rt.signal });
      const ok = res.status >= 200 && res.status < 300;
      if (typeof rt.log === 'function') {
        rt.log(`通知响应：${res.status} ${(res.body ?? '').slice(0, 500)}\n`, ok ? 'stdout' : 'stderr');
      }
      const outputs = { status: res.status, sent: ok, body: (res.body ?? '').slice(0, 4000) };
      if (!ok && inputs.failOnError === true) {
        return { exitCode: 1, outputs, error: `通知发送失败：HTTP ${res.status}` };
      }
      return { exitCode: 0, outputs };
    } catch (error) {
      const message2 = `通知发送异常：${error?.message ?? error}`;
      if (typeof rt.log === 'function') rt.log(`${message2}\n`, 'stderr');
      if (inputs.failOnError === true) return { exitCode: 1, outputs: { status: 0, sent: false }, error: message2 };
      return { exitCode: 0, outputs: { status: 0, sent: false, body: message2, warning: message2 } };
    }
  },
};

export default descriptor;
