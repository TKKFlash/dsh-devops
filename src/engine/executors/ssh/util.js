/**
 * SSH 执行器内部小工具：日志、编码、超时、打码、错误归一化。
 *
 * 纯 ESM、零第三方依赖。所有函数都是纯函数或轻量闭包，便于单元测试。
 */
import { Buffer } from 'node:buffer';

/**
 * 以最宽松的方式调用宿主传入的 logger。
 * 支持函数式 `log(line)`，也支持 `{debug,info,warn,error}` 对象式；任何异常都被吞掉，
 * 因为「日志失败」绝不能影响主流程。
 *
 * @param {unknown} log
 * @param {'debug'|'info'|'warn'|'error'} level
 * @param {string} message
 * @param {unknown} [extra]
 */
export function emitLog(log, level, message, extra) {
  if (!log) return;
  let fn = null;
  if (typeof log === 'function') fn = log;
  else if (typeof log === 'object') {
    fn = log[level] || log.log || log.info || log.debug || log.warn || log.error;
  }
  if (typeof fn !== 'function') return;
  try {
    if (extra === undefined) fn.call(log, message);
    else fn.call(log, message, extra);
  } catch {
    /* 忽略日志异常 */
  }
}

/** 把任意 chunk 规整成 Buffer。 */
export function toBuffer(chunk) {
  if (chunk == null) return Buffer.alloc(0);
  if (Buffer.isBuffer(chunk)) return chunk;
  if (typeof chunk === 'string') return Buffer.from(chunk, 'utf8');
  if (chunk instanceof Uint8Array) return Buffer.from(chunk);
  return Buffer.from(String(chunk), 'utf8');
}

/** 把任意 chunk 规整成字符串。 */
export function toText(chunk) {
  if (chunk == null) return '';
  if (typeof chunk === 'string') return chunk;
  return toBuffer(chunk).toString('utf8');
}

/**
 * 生成增量 UTF-8 解码器。
 * 网络分帧会把多字节字符切断，必须用 stream:true 逐帧解码，否则中文日志会出乱码。
 */
export function createUtf8Decoder() {
  const decoder = new TextDecoder('utf-8');
  return (chunk) => (chunk == null ? '' : decoder.decode(toBuffer(chunk), { stream: true }));
}

/**
 * 打码：把已知密钥/口令从文本中抹掉（安全约定 §5.2 的最后一道兜底）。
 * 长度小于 4 的密钥不参与替换，避免把正常文本打成一堆星号。
 *
 * @param {string} text
 * @param {string[]} secrets
 */
export function maskSecret(text, secrets = []) {
  let out = String(text ?? '');
  for (const secret of secrets) {
    if (typeof secret !== 'string' || secret.length < 4) continue;
    out = out.split(secret).join('***');
  }
  return out;
}

/** 收集非空密钥串，供 maskSecret 使用。 */
export function collectSecrets(...values) {
  const out = [];
  const push = (v) => {
    if (typeof v === 'string' && v.length >= 4) out.push(v);
  };
  for (const value of values) {
    if (Array.isArray(value)) value.forEach(push);
    else push(value);
  }
  return out;
}

/** 延时。 */
export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

/** 截断长文本，用于日志与错误信息。 */
export function truncate(text, max = 4000) {
  const s = String(text ?? '');
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…（共 ${s.length} 字符，已截断）`;
}

/** 去除首尾空白并按行返回非空行。 */
export function nonEmptyLines(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** 把未知异常归一化为 { message, code }。 */
export function normalizeError(error) {
  if (!error) return { message: '未知错误', code: 'unknown' };
  if (typeof error === 'string') return { message: error, code: 'unknown' };
  const message = error.message || String(error);
  const code = error.code || error.errno || 'unknown';
  return { message, code: String(code) };
}

/** 输出人类可读的耗时。 */
export function humanMs(ms) {
  const n = Number(ms) || 0;
  if (n < 1000) return `${n}ms`;
  if (n < 60_000) return `${(n / 1000).toFixed(1)}s`;
  return `${Math.floor(n / 60_000)}m${Math.round((n % 60_000) / 1000)}s`;
}

/**
 * 首行/末行摘要，用于把远端命令输出塞进错误信息里而不至于爆炸。
 */
export function summarizeOutput(stdout, stderr, maxLines = 8) {
  const text = nonEmptyLines(`${toText(stdout)}\n${toText(stderr)}`);
  if (text.length === 0) return '';
  const picked = text.length <= maxLines ? text : [...text.slice(0, maxLines - 1), `…（另有 ${text.length - maxLines + 1} 行）`];
  return truncate(picked.join('\n'), 2000);
}
