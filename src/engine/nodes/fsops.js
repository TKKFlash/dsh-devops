/**
 * src/engine/nodes/fsops.js —— 本地/远端统一文件读写
 *
 * 安全要点：**绝不把文件内容拼进命令行**。
 * - 本地执行器：直接 fs 读写。
 * - 远端执行器：内容先落到本地临时文件，再用 executor.transferIn / transferOut 搬运。
 */
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function isLocal(rt) {
  return rt?.executor?.kind === 'local' || rt?.executor?.isLocal === true;
}

/** 是否 Windows 目标（决定远端路径分隔符推断） */
function remoteIsWindows(rt) {
  const probeOs = String(rt?.server?.probe?.os ?? '');
  if (probeOs) return /windows/i.test(probeOs);
  return process.platform === 'win32';
}

/**
 * 写文件（内容不经过命令行）。
 * @param {object} rt
 * @param {string} target 目标绝对路径
 * @param {string|Buffer} data
 * @param {{createDirs?:boolean, append?:boolean, encoding?:string}} opts
 */
export async function writeRemote(rt, target, data, opts = {}) {
  const { createDirs = true, append = false } = opts;

  if (isLocal(rt)) {
    if (createDirs) await fsp.mkdir(path.dirname(target), { recursive: true });
    let existed = false;
    try {
      await fsp.access(target);
      existed = true;
    } catch { /* 不存在 */ }
    if (append) await fsp.appendFile(target, data);
    else await fsp.writeFile(target, data);
    const info = await fsp.stat(target);
    return { path: target, bytes: info.size, existed, created: !existed };
  }

  // 远端：内容 → 本地临时文件 → transferIn
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-devops-fs-'));
  const staging = path.join(dir, 'payload');
  try {
    await fsp.writeFile(staging, data);
    const stat = await rt.executor.stat(rt.server, target).catch(() => ({ exists: false }));
    if (createDirs) {
      const parent = remoteIsWindows(rt)
        ? target.replace(/[\\/][^\\/]*$/, '')
        : path.posix.dirname(target.split(path.sep).join('/'));
      if (parent && parent !== target) {
        // 用 argv 方式建立目录（mkdir -p / New-Item），不涉及用户内容
        const cmd = remoteIsWindows(rt)
          ? ['cmd.exe', '/d', '/s', '/c', 'if not exist', parent, 'mkdir', parent]
          : ['mkdir', '-p', parent];
        await rt.spawn(cmd, { timeoutMs: 15000 }).then((h) => h.done).catch(() => {});
      }
    }
    if (append && stat.exists) {
      // 追加语义：先取回原文件拼接后再整体写回
      const current = await readRemote(rt, target).catch(() => '');
      await fsp.writeFile(staging, `${current}${data}`);
    }
    await rt.executor.transferIn(rt.server, staging, target);
    const after = await rt.executor.stat(rt.server, target).catch(() => ({ exists: false, size: 0 }));
    return { path: target, bytes: after.size ?? 0, existed: Boolean(stat.exists), created: !stat.exists };
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * 读文件（内容不经过命令行）。
 * @returns {Promise<string>}
 */
export async function readRemote(rt, target) {
  if (isLocal(rt)) {
    return fsp.readFile(target, 'utf8');
  }
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-devops-fs-'));
  const staging = path.join(dir, 'payload');
  try {
    await rt.executor.transferOut(rt.server, target, staging);
    return await fsp.readFile(staging, 'utf8');
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** 复制文件/目录（本地直接 fs，远端走 transfer 双向） */
export async function copyRemote(rt, from, to, opts = {}) {
  const { overwrite = true, recursive = true } = opts;
  if (isLocal(rt)) {
    const info = await fsp.lstat(from).catch(() => null);
    if (!info) throw new Error(`源路径不存在：${from}`);
    if (info.isDirectory()) {
      if (!recursive) throw new Error(`源是目录且未开启递归复制：${from}`);
      const existing = await fsp.stat(to).catch(() => null);
      if (existing && !overwrite) throw new Error(`目标已存在且未允许覆盖：${to}`);
      await fsp.cp(from, to, { recursive: true, force: overwrite });
      return { from, to, isDir: true, bytes: 0 };
    }
    const existing = await fsp.stat(to).catch(() => null);
    if (existing && !overwrite) throw new Error(`目标已存在且未允许覆盖：${to}`);
    await fsp.mkdir(path.dirname(to), { recursive: true });
    await fsp.copyFile(from, to);
    const after = await fsp.stat(to);
    return { from, to, isDir: false, bytes: after.size };
  }

  // 远端：先取回到临时目录，再推送到目标
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-devops-cp-'));
  const staging = path.join(dir, 'payload');
  try {
    await rt.executor.transferOut(rt.server, from, staging);
    await rt.executor.transferIn(rt.server, staging, to);
    const after = await rt.executor.stat(rt.server, to).catch(() => ({ size: 0, isDir: false }));
    return { from, to, isDir: Boolean(after.isDir), bytes: after.size ?? 0 };
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** 路径拼接：按目标系统选择分隔符 */
export function joinRemote(rt, ...parts) {
  if (remoteIsWindows(rt)) {
    return parts.filter(Boolean).join('\\').replace(/\\+/g, '\\');
  }
  return parts.filter(Boolean).join('/').replace(/\/+/g, '/');
}

/** 取相对路径（用于保持缓存目录结构） */
export function relativeRemote(rt, base, target) {
  const norm = (value) => String(value).split('\\').join('/');
  const b = norm(base).replace(/\/+$/, '');
  const t = norm(target);
  return t.startsWith(`${b}/`) ? t.slice(b.length + 1) : path.posix.basename(t);
}

export { isLocal, remoteIsWindows };
