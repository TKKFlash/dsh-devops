/**
 * 认证解析：把契约 §2.3 的 `server.auth` 变成 ssh2 的连接参数。
 *
 * 安全铁律（契约 §5.2）：
 * - 私钥/口令**只来自** credentials 解析器或插件 config，绝不从日志、run 记录里读；
 * - 本模块返回的 `secrets` 交给上层做日志打码；
 * - 任何返回值都不含明文口令的日志输出路径。
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { SshError } from './errors.js';
import { collectSecrets, emitLog } from './util.js';

/**
 * 私钥文件大小上限（1MB）。
 * 私钥文本通常只有几 KB；超过这个量级基本可以断定是「选错文件了」（比如选到磁盘镜像），
 * 与其读进内存再让 ssh2 报一句难懂的错，不如在读取前就拒绝并说清楚。
 */
export const MAX_PRIVATE_KEY_BYTES = 1024 * 1024;

/** 判断一个字符串是否「像」本机路径（用于 keyRef 兼作路径的情形的候选筛选）。 */
function looksLikePath(value) {
  if (typeof value !== 'string') return false;
  const s = value.trim();
  if (s === '') return false;
  // 绝对路径（POSIX 或 Windows 盘符）、UNC、家目录展开、显式相对路径
  if (/^[/\\]/.test(s)) return true;
  if (/^[A-Za-z]:[/\\]/.test(s)) return true;
  if (s.startsWith('~')) return true;
  if (s.startsWith('./') || s.startsWith('.\\')) return true;
  // 含路径分隔符且带常见私钥后缀：兼容用户写相对路径
  return /[/\\]/.test(s) && /\.(pem|key|ppk|pub|txt)$/i.test(s);
}

/** 把家目录前缀展开成绝对路径（ssh 用户习惯写 ~/.ssh/id_rsa）。 */
function expandHome(value) {
  const s = String(value ?? '').trim();
  if (!s.startsWith('~')) return s;
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (!home) return s;
  if (s === '~') return home;
  if (s.startsWith('~/') || s.startsWith('~\\')) return home.replace(/[/\\]+$/, '') + s.slice(1);
  return s;
}

/**
 * 读取本机私钥文件内容。
 *
 * 安全与可用性约束（契约 §2.3「私钥来源优先级」）：
 * - 只接受**常规文件**：目录、socket、设备等一律拒绝（点名真实类型，便于排查）；
 * - 大小受限：> {@link MAX_PRIVATE_KEY_BYTES} 直接拒绝，绝不整份读进内存；
 * - 失败信息**只含路径与原因**，绝不含文件内容；
 * - 成功返回的私钥内容由调用方放入 secrets 供打码，本函数自己不写任何日志。
 *
 * @param {string} target 本机路径（支持 ~ 前缀）
 * @returns {Promise<string>} 私钥文本
 * @throws {SshError} code: 'private-key-file-not-found' | 'private-key-file-not-regular'
 *                    | 'private-key-file-too-large' | 'private-key-file-unreadable' | 'private-key-file-empty'
 */
export async function readPrivateKeyFile(target) {
  const raw = String(target ?? '').trim();
  if (raw === '') {
    throw new SshError('私钥文件路径为空，无法读取。', 'private-key-file-not-found', { path: '' });
  }
  const file = expandHome(raw);

  let info;
  try {
    info = await stat(file);
  } catch (error) {
    const notFound = error?.code === 'ENOENT' || error?.code === 'ENOTDIR';
    throw new SshError(
      notFound
        ? `私钥文件不存在：${file}。请确认路径正确（Windows 路径形如 C:\\Users\\you\\.ssh\\id_rsa）。`
        : `无法访问私钥文件 ${file}：${error?.code || error?.message || error}。`,
      notFound ? 'private-key-file-not-found' : 'private-key-file-unreadable',
      { path: file },
    );
  }

  if (typeof info.isFile === 'function' && !info.isFile()) {
    // 目录是最常见的手滑；把真实类型说出来，用户一眼就知道该往下点一层
    const kind = typeof info.isDirectory === 'function' && info.isDirectory()
      ? '目录'
      : (typeof info.isSymbolicLink === 'function' && info.isSymbolicLink() ? '符号链接' : '非普通文件');
    throw new SshError(
      `私钥路径指向的是${kind}而不是文件：${file}。请选择具体的私钥文件（例如 id_rsa / id_ed25519）。`,
      'private-key-file-not-regular',
      { path: file, kind },
    );
  }

  if (Number.isFinite(info.size) && info.size > MAX_PRIVATE_KEY_BYTES) {
    throw new SshError(
      `私钥文件过大（${info.size} 字节，上限 ${MAX_PRIVATE_KEY_BYTES} 字节）：${file}。` +
        '私钥通常只有几 KB，请确认没有选错文件。',
      'private-key-file-too-large',
      { path: file, size: info.size, limit: MAX_PRIVATE_KEY_BYTES },
    );
  }

  let content;
  try {
    content = await readFile(file, 'utf8');
  } catch (error) {
    // 只回错误原因，绝不回文件内容
    throw new SshError(
      `读取私钥文件失败 ${file}：${error?.code || error?.message || error}。请检查文件权限。`,
      'private-key-file-unreadable',
      { path: file },
    );
  }

  if (content.trim() === '') {
    throw new SshError(`私钥文件内容为空：${file}。`, 'private-key-file-empty', { path: file });
  }
  return content;
}

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
    const label = server?.name || server?.id || '?';
    const keyRef = auth.keyRef || auth.privateKeyRef || config?.privateKeyRef || '';
    const keyPath = typeof auth.keyPath === 'string' ? auth.keyPath.trim() : '';

    /**
     * 私钥来源优先级（契约 §2.3「私钥来源优先级」，逐条落地）：
     *   1. 测试注入点 getPrivateKey（正式入口，便于 verifier 不造宿主 ctx）
     *   2. 显式 auth.keyPath（本机文件路径）—— 用户明确指定，最可信
     *   3. auth.keyRef 凭据引用
     *   4. auth.keyRef 本身是一个存在的本机文件路径 → 读该文件
     *   5. 插件 config.privateKey
     */
    let privateKey = typeof getPrivateKey === 'function' ? await getPrivateKey(server) : undefined;
    let source = privateKey ? 'injected' : '';

    if (!privateKey && keyPath) {
      privateKey = await readPrivateKeyFile(keyPath);
      source = 'auth.keyPath';
    }

    if (!privateKey && keyRef) {
      // keyRef 优先按「凭据引用」解释；解析不到内容再按「路径」兜底解释。
      // 这样两种用户写法都能用，且不会因为一个名字恰好像路径就丢掉凭据能力。
      const fromCredential = await read(keyRef);
      if (fromCredential) {
        privateKey = fromCredential;
        source = 'auth.keyRef(credential)';
      } else if (looksLikePath(keyRef)) {
        try {
          privateKey = await readPrivateKeyFile(keyRef);
          source = 'auth.keyRef(path)';
        } catch (error) {
          // keyRef 被当作路径解释时失败：不要把它变成「缺私钥」这种模糊错误，
          // 直接把真实原因（不存在/是目录/太大）抛出去，用户才知道该改哪里。
          if (keyPath === '') throw error;
        }
      }
    }

    if (!privateKey) privateKey = config?.privateKey;
    if (privateKey && !source) source = 'config.privateKey';

    const passphrase = (await read(auth.passphraseRef)) || config?.passphrase;
    if (!privateKey) {
      throw new SshError(
        `服务器「${label}」使用密钥认证，但没有解析到私钥。` +
          '请在「私钥文件」中选择本机私钥文件（auth.keyPath），' +
          '或填写凭据服务里的私钥凭据名（auth.keyRef）。' +
          (keyRef ? `（已尝试的引用：${keyRef}）` : ''),
        'missing-private-key',
      );
    }
    // 私钥内容必须进 secrets 供写盘前打码；此处**不写任何日志**，避免私钥落盘。
    secrets.push(privateKey, passphrase);
    emitLog(log, 'debug', `SSH 私钥来源：${source || 'unknown'}（内容已加入打码词表，不落日志）。`);
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
