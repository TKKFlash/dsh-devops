/**
 * 节点：http.request —— 发起 HTTP 请求
 *
 * 零依赖实现（node:http / node:https），支持超时、重试、期望状态码。
 * 请求体与响应体都会经过日志打码（由 logstore 在写盘前处理）。
 */
import { F, toRecord, httpRequest } from '../helpers.js';

const MAX_BODY = 100000;

export const descriptor = {
  type: 'http.request',
  title: 'HTTP 请求',
  category: 'network',
  icon: 'globe',
  description: '调用一个 HTTP 接口，可用于健康检查、触发部署钩子等',
  fields: [
    F.string('url', '请求地址', { required: true, placeholder: 'https://api.example.com/deploy', maxLength: 2000 }),
    F.enum('method', '方法', ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'], { default: 'GET' }),
    F.keyvalue('headers', '请求头', { description: '如 Authorization；值可引用资源库密钥' }),
    F.code('body', '请求体', 'json', { rows: 6, placeholder: '{"env":"prod"}' }),
    F.string('expectStatus', '期望状态码', { default: '200-299', placeholder: '200 或 200-299 或 200,201' }),
    F.number('timeoutMs', '超时', { min: 0, unit: 'ms', default: 30000 }),
    F.number('retries', '重试次数', { min: 0, default: 0 }),
    F.number('retryDelayMs', '重试间隔', { min: 0, unit: 'ms', default: 1000 }),
  ],
  outputs: [
    { name: 'status', type: 'number' },
    { name: 'body', type: 'string' },
    { name: 'durationMs', type: 'number' },
    { name: 'attempts', type: 'number' },
  ],
  env: [],
  runtime: null,

  async run(rt, inputs = {}) {
    const url = String(inputs.url ?? '').trim();
    if (!url) return { exitCode: 1, error: '请求地址不能为空' };
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { exitCode: 1, error: `仅支持 http/https，收到 ${parsed.protocol}` };
      }
    } catch {
      return { exitCode: 1, error: `URL 非法：${url}` };
    }

    const method = String(inputs.method ?? 'GET').toUpperCase();
    const headers = toRecord(inputs.headers);
    if (typeof headers === 'object') {
      for (const [key, value] of Object.entries(headers)) headers[key] = String(value);
    }

    let body = inputs.body === undefined || inputs.body === null || inputs.body === '' ? null : String(inputs.body);
    if (body && !Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = 'application/json';
    }

    const retries = Number(inputs.retries) > 0 ? Number(inputs.retries) : 0;
    const retryDelayMs = Number(inputs.retryDelayMs) > 0 ? Number(inputs.retryDelayMs) : 1000;
    const timeoutMs = Number(inputs.timeoutMs) > 0 ? Number(inputs.timeoutMs) : 30000;

    const expected = parseExpectation(inputs.expectStatus);
    const attemptsLimit = retries + 1;
    let lastError = '';
    let attempts = 0;

    for (let attempt = 1; attempt <= attemptsLimit; attempt += 1) {
      attempts = attempt;
      if (rt.signal?.aborted) {
        return { exitCode: 130, outputs: { status: 0, attempts }, error: '请求被取消' };
      }
      const startedAt = Date.now();
      try {
        if (typeof rt.log === 'function') rt.log(`→ ${method} ${url}（第 ${attempt} 次）\n`, 'stdout');
        const res = await httpRequest({ url, method, headers, body, timeoutMs, signal: rt.signal });
        const durationMs = Date.now() - startedAt;
        const text = res.body ?? '';
        if (typeof rt.log === 'function') {
          rt.log(`← ${res.status}（${durationMs}ms，${text.length} 字节）\n`, 'stdout');
          if (text) rt.log(text.slice(0, 4000), 'stdout');
          if (text) rt.log('\n', 'stdout');
        }
        const ok = expected.test(res.status);
        const outputs = { status: res.status, body: text.slice(0, MAX_BODY), durationMs, attempts, headers: res.headers };
        if (ok) return { exitCode: 0, outputs };
        lastError = `状态码 ${res.status} 不在期望范围（${inputs.expectStatus || '200-299'}）`;
      } catch (error) {
        lastError = String(error?.message ?? error);
        if (typeof rt.log === 'function') rt.log(`请求失败：${lastError}\n`, 'stderr');
      }

      if (attempt < attemptsLimit && !rt.signal?.aborted) {
        const delay = retryDelayMs * attempt; // 线性退避，避免雪崩
        if (typeof rt.log === 'function') rt.log(`等待 ${delay}ms 后重试\n`, 'stdout');
        await new Promise((resolve) => {
          // 重试等待是活跃工作，不可 unref
          setTimeout(resolve, delay);
        });
      }
    }

    return { exitCode: 1, outputs: { status: 0, attempts }, error: `HTTP 请求失败：${lastError}` };
  },
};

/** 解析期望状态码：'200'、'200,201'、'200-299' */
function parseExpectation(spec) {
  const text = String(spec ?? '').trim() || '200-299';
  const codes = new Set();
  const ranges = [];
  for (const part of text.split(/[,;\s]+/)) {
    if (!part) continue;
    const range = part.match(/^(\d{3})\s*[-~]\s*(\d{3})$/);
    if (range) {
      ranges.push([Number(range[1]), Number(range[2])]);
      continue;
    }
    const num = Number(part);
    if (Number.isFinite(num)) codes.add(num);
  }
  return {
    test(status) {
      if (codes.has(status)) return true;
      return ranges.some(([from, to]) => status >= Math.min(from, to) && status <= Math.max(from, to));
    },
  };
}

export default descriptor;
