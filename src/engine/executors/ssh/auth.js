/**
 * 认证解析：把契约 §2.3 的 `server.auth` 变成 ssh2 的连接参数。
 *
 * 安全铁律（契约 §5.2）：
 * - 私钥/口令**只来自** credentials 解析器或插件 config，绝不从日志、run 记录里读；
 * - 本模块返回的 `secrets` 交给上层做日志打码；
 * - 任何返回值都不含明文口令的日志输出路径。
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { SshError } from './errors.js';
import { collectSecrets, emitLog } from './util.js';

/**
 * 兼容多种 credentials 服务形状：`resolve(ref)` / `get(ref)` / `read(ref)` /
 * `resolve(ref, {server})`；同步或异步都支持。
 *
 * @param {unknown} credentials
 * @param {string} ref
 * @param {object} [context]
 * @returns {Promise<string|undefined>}
 */
export async function resolveCredential(credentials, ref, context = {}) {
  if (!ref || !credentials) return undefined;
  const fn =
    (typeof credentials.resolve === 'function' && credentials.resolve.bind(credentials)) ||
    (typeof credentials.get === 'function' && credentials.get.bind(credentials)) ||
    (typeof credentials.read === 'function' && credentials.read.bind(credentials)) ||
    null;
  if (!fn) return undefined;

  // 不同版本的宿主服务签名不同：先试 (ref, context)，失败再试 (ref)。
  try {
    const value = await fn(ref, context);
    if (typeof value === 'string' && value.length > 0) return value;
    if (value && typeof value === 'object') {
      if (typeof value.value === 'string' && value.value.length > 0) return value.value;
      if (typeof value.secret === 'string' && value.secret.length > 0) return value.secret;
    }
  } catch (error) {
    try {
      const value = await fn(ref);
      if (typeof value === 'string' && value.length > 0) return value;
    } catch {
      throw new SshError(
        `无法解析凭据引用「${ref}」：${error?.message || error}。请在凭据服务中创建该引用，或改用其它认证方式。`,
        'credential-unresolved',
      );
    }
  }
  return undefined;
}

/** 从 config 里取凭据：支持 config.getCredential(ref) 或 config.credentials[name]。 */
async function resolveFromConfig(config, ref) {
  if (!config || !ref) return undefined;
  if (typeof config.getCredential === 'function') {
    try {
      const value = await config.getCredential(ref);
      if (typeof value === 'string' && value.length > 0) return value;
    } catch {
      /* 继续尝试其它来源 */
    }
  }
  const bag = config.credentials;
  if (bag && typeof bag === 'object' && typeof bag[ref] === 'string' && bag[ref].length > 0) {
    return bag[ref];
  }
  return undefined;
}

/**
 * 解析服务器认证配置。
 *
 * @param {object} server 契约 §2.3 的 Server
 * @param {object} [options]
 * @param {unknown} [options.ctx] 宿主上下文（惰性取 credentials 服务）
 * @param {object} [options.config] 插件配置
 * @param {unknown} [options.log]
 * @param {Function} [options.getPrivateKey] 测试注入点：直接返回私钥内容
 * @returns {Promise<{ auth: object, secrets: string[], method: string }>} auth 为 ssh2 connect 参数子集
 */
/**
 * 认证**配置**校验：只做「一眼可判」的合法性检查，不需要任何凭据或网络。
 *
 * 单独抽出来是为了让调用方能在**加载可选依赖之前**先拒绝非法配置：
 * 这样 `kind:'ssh' + auth.type:'none'` 永远得到 `insecure-auth-none`，
 * 而不会被「ssh2 未安装」的报错掩盖。
 *
 * @param {object} server 契约 §2.3 的 Server
 * @returns {{ type: string, kind: string }}
 * @throws {SshError}
 */
export function assertAuthConfig(server) {
  const auth = server?.auth || {};
  const type = String(auth.type || 'key');
  const kind = String(server?.kind || 'ssh');

  if (!['key', 'password', 'agent', 'none'].includes(type)) {
    throw new SshError(
      `不支持的认证方式「${type}」：仅支持 key、password、agent、none（none 仅限 local）。`,
      'bad-auth-type',
    );
  }

  if (type === 'none' && kind !== 'local') {
    throw new SshError(
      `服务器「${server?.name || server?.id || '?'}」的认证方式为 none，但它是 SSH 服务器（kind='${kind}'）。` +
        '拒绝建立无认证的 SSH 连接：请配置 auth.type 为 key/password/agent。' +
        '（auth.type=none 仅对 kind=local 的本机服务器合法。）',
      'insecure-auth-none',
    );
  }

  return { type, kind };
}

/**
 * 解析服务器认证配置。
 *
 * @param {object} server 契约 §2.3 的 Server
 * @param {object} [options]
 * @param {unknown} [options.ctx] 宿主上下文（惰性取 credentials 服务）
 * @param {object} [options.config] 插件配置
 * @param {unknown} [options.log]
 * @param {unknown} [options.credentials] 直接注入的凭据服务（测试用）
 * @param {Function} [options.getPrivateKey] 测试注入点：直接返回私钥内容
 * @returns {Promise<{ auth: object, secrets: string[], method: string }>} auth 为 ssh2 connect 参数子集
 */
export async function resolveAuth(server, options = {}) {
  const { ctx, config, log, getPrivateKey, credentials: injectedCredentials } = options;
  const auth = server?.auth || {};
  // 先过配置守卫（none/未知类型在解析凭据之前就被拒绝）
  const { type } = assertAuthConfig(server);
  const secrets = [];

  // 凭据来源优先级：显式注入 > ctx.credentials 服务 > config.credentialsService。
  // 显式注入是给 verifier/测试用的正式入口（不必伪造整个宿主 ctx）。
  const credentials =
    injectedCredentials ||
    (ctx && typeof ctx.get === 'function' && safeGet(ctx, 'credentials')) ||
    config?.credentialsService ||
    null;

  const read = async (ref) => {
    if (!ref) return undefined;
    const fromCtx = await resolveCredential(credentials, ref, { server, kind: 'ssh' });
    if (fromCtx) return fromCtx;
    return resolveFromConfig(config, ref);
  };

  if (type === 'key') {
    const keyRef = auth.keyRef || auth.privateKeyRef || config?.privateKeyRef || '';
    let privateKey = typeof getPrivateKey === 'function' ? await getPrivateKey(server) : undefined;
    if (!privateKey) privateKey = await read(keyRef);
    if (!privateKey) privateKey = config?.privateKey;

    const passphrase = (await read(auth.passphraseRef)) || config?.passphrase;
    // 私钥允许以文件路径形式给出（宿主机上的路径），此时交给 ssh2 自行读取。
    if (!privateKey) {
      throw new SshError(
        `服务器「${server?.name || server?.id || '?'}」使用密钥认证，但没有解析到私钥。` +
          '请检查 auth.keyRef 指向的凭据是否存在（或在凭据服务中创建它）。',
        'missing-private-key',
      );
    }
    secrets.push(privateKey, passphrase);
    return {
      method: 'key',
      secrets: collectSecrets(secrets),
      auth: { privateKey, passphrase: passphrase || undefined },
    };
  }

  if (type === 'password') {
    const passwordRef = auth.passwordRef || '';
    let password = await read(passwordRef);
    if (!password) password = config?.password;
    if (!password) {
      throw new SshError(
        `服务器「${server?.name || server?.id || '?'}」使用口令认证，但没有解析到口令。` +
          '请检查 auth.passwordRef 指向的凭据是否存在。',
        'missing-password',
      );
    }
    secrets.push(password);
    return { method: 'password', secrets: collectSecrets(secrets), auth: { password } };
  }

  if (type === 'agent') {
    // agent 认证：从 ssh-agent 取密钥，绝不静默回退到 none。
    const agent = auth.agent || defaultAgentSocket();
    if (!agent) {
      throw new SshError(
        '认证方式为 agent，但未找到 ssh-agent 的通信端点。' +
          '请设置环境变量 SSH_AUTH_SOCK 指向 agent socket' +
          '（Windows OpenSSH 上通常是 \\\\.\\pipe\\openssh-ssh-agent），' +
          '或改用 key/password 认证。',
        'missing-agent',
      );
    }
    return { method: 'agent', secrets: [], auth: { agent, privateKey: undefined, passphrase: undefined } };
  }

  if (type === 'none') {
    // 配置守卫已在 assertAuthConfig 里放行（仅 kind:local 能走到这里），
    // 这里只做记录，绝不静默建立无认证连接。
    emitLog(log, 'warn', `服务器 ${server?.id || '?'}（kind=local）使用 none 认证。`);
    return { method: 'none', secrets: [], auth: {} };
  }

  // 理论上不可达（assertAuthConfig 已排除），保留兜底避免未来新增类型时静默放行。
  throw new SshError(`不支持的认证方式「${type}」`, 'bad-auth-type');
}

/**
 * 解析 ssh-agent 的通信端点。
 * - 类 Unix：`SSH_AUTH_SOCK`（socket 路径）；
 * - Windows：OpenSSH for Windows 用命名管道，默认 `\\.\pipe\openssh-ssh-agent`；
 *   仅在未显式设置 SSH_AUTH_SOCK 时启用该默认值。
 *
 * @returns {string} 端点；找不到返回空串（调用方负责报错，绝不静默降级）
 */
export function defaultAgentSocket() {
  const fromEnv = process.env.SSH_AUTH_SOCK;
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv;
  if (process.platform === 'win32') return '\\\\.\\pipe\\openssh-ssh-agent';
  return '';
}

/** ctx.get 可能抛错（服务未注册），这里静默降级。 */
function safeGet(ctx, name) {
  try {
    return ctx.get(name);
  } catch {
    return null;
  }
}

/**
 * 主机指纹校验（契约要求「不要静默重试」，同时避免默认 MITM）。
 *
 * **必须同时支持两种用户输入形态**（这是真实使用中最容易踩的坑）：
 *   1. 标准指纹串：`SHA256:<base64>`（`ssh-keyscan` / `ssh-keygen -lf` 的输出）
 *      → 与 `sha256(主机公钥)` 的 base64 比较（**校验的是哈希，不是公钥本身**）；
 *   2. 公钥本体：直接给出 base64 公钥（或 hex）
 *      → 与收到的公钥字节做常量时间比较。
 *
 * 判定顺序：先按「标准指纹」解释（哈希比较），不匹配再按「公钥本体」解释（字节比较），
 * 两者都不匹配才拒绝。这样无论用户从 ssh-keygen 复制指纹，还是粘贴公钥，都能通过。
 *
 * 策略：
 * - config.hostFingerprint / server.hostFingerprint 给出期望值 → **严格校验**，不匹配立即拒绝；
 * - 未给出 → 记录一次 warn（首次信任 TOFU），由用户决定是否固定指纹。
 *
 * @returns {{ hostVerifier?: (key: Buffer|string) => boolean, strict: boolean, expected?: string, mode?: string }}
 */
export function createHostVerifier(server, config = {}, log) {
  const raw = server?.hostFingerprint || server?.fingerprint || config.hostFingerprint || '';
  if (!raw || (typeof raw === 'string' && raw.trim() === '')) {
    return { strict: false, hostVerifier: undefined, expected: '' };
  }

  const expected = normalizeFingerprint(raw);
  // `SHA256:` 前缀（显式）或看起来就是哈希（hex 64 位）→ 按指纹解释；
  // 否则按「公钥本体」解释。两者都保留为候选，实际校验时依次尝试。
  const looksLikeFingerprint = typeof raw === 'string' && /^SHA256:/i.test(raw.trim());
  const expectedKey =
    typeof raw === 'string' ? raw.trim().replace(/^SHA256:/i, '').replace(/=+$/, '') : '';
  const expectedBytes = decodeBase64Key(expectedKey);

  const hostVerifier = (key) => {
    const keyBuf = typeof key === 'string' ? Buffer.from(key, 'base64') : Buffer.from(key || '');
    if (keyBuf.length === 0) return false;

    // 1) 按标准指纹解释：比较 sha256(公钥) 的 base64
    const actual = fingerprintOf(keyBuf);
    if (actual === expected) return true;

    // 2) 按「公钥本体」解释：直接比较公钥字节（常量时间）
    if (expectedBytes && expectedBytes.length === keyBuf.length) {
      try {
        if (timingSafeEqual(expectedBytes, keyBuf)) return true;
      } catch {
        /* 长度不同等异常一律视为不匹配 */
      }
    }
    return false;
  };

  emitLog(
    log,
    'info',
    `已启用主机指纹严格校验（${looksLikeFingerprint ? 'sha256 指纹' : '公钥/指纹'}：${String(expected).slice(0, 20)}…）。`,
  );
  return { strict: true, hostVerifier, expected, mode: looksLikeFingerprint ? 'sha256-fingerprint' : 'public-key' };
}

/** 归一化指纹：支持 `SHA256:base64`、裸 base64、hex 三种输入。 */
export function normalizeFingerprint(value) {
  if (!value) return '';
  if (Buffer.isBuffer(value)) return value.toString('base64').replace(/=+$/, '');
  const s = String(value).trim();
  if (s === '') return '';
  const stripped = s.replace(/^SHA256:/i, '').replace(/=+$/, '');
  if (/^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2})+$/.test(stripped) || /^[0-9a-fA-F]{64}$/.test(stripped)) {
    const hex = stripped.replace(/:/g, '');
    return Buffer.from(hex, 'hex').toString('base64').replace(/=+$/, '');
  }
  return stripped;
}

/** 尝试把 base64 指纹解成 Buffer（供常量时间比较）。 */
function decodeBase64Key(value) {
  try {
    const buf = Buffer.from(value, 'base64');
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
}

/** 计算一个字符串公钥的 sha256 指纹（仅供测试与展示，不用于校验逻辑本身）。 */
export function fingerprintOf(key) {
  const buf = Buffer.isBuffer(key) ? key : Buffer.from(String(key), 'base64');
  return createHash('sha256').update(buf).digest('base64').replace(/=+$/, '');
}
