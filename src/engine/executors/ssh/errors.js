/**
 * SSH 执行器的错误类型与「连接失败归因」。
 *
 * 契约要求：连接失败要给出明确原因（DNS/超时/认证/指纹），不要静默重试。
 * 这里把 ssh2 / Node 的原始错误映射成人话，并给出稳定的 code，供上层 API 直接回显。
 */
import { normalizeError } from './util.js';

/** SSH 基础错误。 */
export class SshError extends Error {
  /**
   * @param {string} message
   * @param {string} [code]
   * @param {unknown} [details]
   */
  constructor(message, code = 'ssh-error', details = undefined) {
    super(message);
    this.name = 'SshError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

/** 可选依赖 ssh2 缺失：必须给出「怎么修」的提示。 */
export class SshDependencyError extends SshError {
  constructor(message) {
    super(message, 'ssh2-missing');
    this.name = 'SshDependencyError';
  }
}

/** 连接类错误（DNS/超时/认证/指纹/拒绝）。 */
export class SshConnectionError extends SshError {
  constructor(message, code = 'connect-failed', details = undefined) {
    super(message, code, details);
    this.name = 'SshConnectionError';
  }
}

/** 远端命令执行错误。 */
export class RemoteCommandError extends SshError {
  constructor(message, code = 'remote-command-failed', details = undefined) {
    super(message, code, details);
    this.name = 'RemoteCommandError';
  }
}

/** 远端路径越界/不合法（契约 §5.3）。 */
export class RemotePathError extends SshError {
  constructor(message, code = 'remote-path-denied', details = undefined) {
    super(message, code, details);
    this.name = 'RemotePathError';
  }
}

/** ssh2 缺失时的统一文案（用户看到的那一句）。 */
export const SSH2_MISSING_HINT =
  '未安装可选依赖 ssh2，无法使用 SSH 服务器。请执行 `npm i ssh2` 安装该可选依赖，' +
  '或把该步骤的服务器改为「本机（local）」。';

/**
 * 判断某个异常是不是「模块找不到」。
 * 只有确认是 ssh2 缺失时才转成 SshDependencyError，其它错误原样抛出（不掩盖真实问题）。
 */
export function isModuleNotFound(error, specifier) {
  const { message, code } = normalizeError(error);
  if (code !== 'ERR_MODULE_NOT_FOUND' && code !== 'MODULE_NOT_FOUND') return false;
  if (!specifier) return true;
  return message.includes(specifier);
}

/**
 * 把连接阶段的原始错误分类成人话。
 *
 * @param {unknown} error ssh2 / Node 抛出的原始错误
 * @param {string} label 脱敏后的 `user@host:port`
 * @returns {{ code: string, message: string, detail: string }}
 */
export function classifyConnectError(error, label = '远端主机') {
  const { message } = normalizeError(error);
  const lower = message.toLowerCase();

  /** @type {[string, RegExp, string][]} */
  const rules = [
    ['dns', /enotfound|getaddrinfo|name or service not known|nodename nor servname|no such host/, 'DNS 解析失败：主机名无法解析'],
    ['refused', /econnrefused|connection refused/, '主机可达但端口拒绝连接（确认 sshd 已启动、端口正确）'],
    ['unreachable', /ehostunreach|enetunreach|no route to host/, '网络不可达（确认 VPN/防火墙/网段）'],
    ['timeout', /etimedout|timed? ?out|timeout while waiting/, '连接超时（确认主机可达、端口未被安全组拦截）'],
    ['auth', /all configured authentication methods failed|authentication failure|permission denied|invalid key|no supported authentication/, '认证失败（检查用户名、私钥内容/权限、密码或 ssh-agent）'],
    ['fingerprint', /host key verification failed|host key mismatch|host denied|hostfingerprint/, '主机密钥校验失败（指纹与预期不一致，可能被中间人劫持或主机重装）'],
    ['reset', /econnreset|socket hang up|connection lost before handshake/, '连接被重置（握手阶段断开）'],
    ['crypto', /unsupported|kex|no matching|algorithm/, '算法协商失败（客户端与服务端无共同算法，可能是老版本 sshd）'],
  ];
  for (const [code, re, friendly] of rules) {
    if (re.test(lower)) {
      return { code, message: `连接 ${label} 失败：${friendly}`, detail: message };
    }
  }
  return { code: 'connect-failed', message: `连接 ${label} 失败：${message}`, detail: message };
}

/** 依据分类结果构造 SshConnectionError。 */
export function toConnectionError(error, label) {
  const classified = classifyConnectError(error, label);
  return new SshConnectionError(classified.message, classified.code, { detail: classified.detail, label });
}
