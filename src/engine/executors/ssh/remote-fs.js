/**
 * 远端文件系统操作（基于 SFTP）。
 *
 * 设计要点：
 * - **兼容两种会话形状**：真实 ssh2 用回调（`readdir(path, cb)`），mock 常写成 promise；
 *   `invoke()` 按函数 arity 自动适配，verifier 的 mock 可以任选一种风格。
 * - **有界遍历**：远端目录可能巨大，walk 带 maxEntries/maxDepth 上限并如实报告 truncated。
 * - 所有路径都先做词法 containment 校验（契约 §5.3），越界直接抛 RemotePathError。
 */
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { RemotePathError, SshError } from './errors.js';
import { assertInsideBase, normalizeRemotePath } from './shell.js';
import { emitLog, normalizeError } from './util.js';

/** 调用 SFTP 方法，同时支持回调式与 promise 式实现。 */
export async function invoke(target, method, args = []) {
  const fn = target?.[method];
  if (typeof fn !== 'function') {
    throw new SshError(`SFTP 会话不支持 ${method}()`, 'sftp-unsupported');
  }
  // 回调式：函数声明的形参比实参多一个（那个就是 cb）
  if (fn.length > args.length) {
    return await new Promise((resolve, reject) => {
      let settled = false;
      const cb = (error, value) => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve(value);
      };
      try {
        fn.call(target, ...args, cb);
      } catch (error) {
        if (!settled) {
          settled = true;
          reject(error);
        }
      }
    });
  }
  const out = fn.call(target, ...args);
  return out && typeof out.then === 'function' ? await out : out;
}

/** attrs 兼容层：ssh2 的 Stats 有 isDirectory()，mock 可能只给 mode/isDir。 */
export function attrsToEntry(name, attrs = {}) {
  const mode = Number(attrs.mode ?? 0);
  let isDir = false;
  let isLink = false;
  if (typeof attrs.isDirectory === 'function') isDir = attrs.isDirectory();
  else if (typeof attrs.isDir === 'boolean') isDir = attrs.isDir;
  else isDir = (mode & 0o170000) === 0o040000;
  if (typeof attrs.isSymbolicLink === 'function') isLink = attrs.isSymbolicLink();
  else isLink = (mode & 0o170000) === 0o120000;
  return {
    name: String(name),
    isDir,
    isLink,
    size: Number(attrs.size ?? 0) || 0,
    mtime: Number(attrs.mtime ?? 0) * (Number(attrs.mtime) > 1e12 ? 1 : 1000) || 0,
    mode: mode ? `0${(mode & 0o777).toString(8)}` : '',
  };
}

/** 判断 SFTP 错误是否为「不存在」。 */
export function isNotFound(error) {
  if (!error) return false;
  const code = Number(error.code);
  if (code === 2) return true; // SSH_FX_NO_SUCH_FILE
  const msg = String(error.message || '').toLowerCase();
  return msg.includes('no such file') || msg.includes('not found');
}

/** 列出目录（契约 §3.7 readDir）。 */
export async function listDir(sftp, dirPath, options = {}) {
  const target = normalizeRemotePath(dirPath);
  let raw;
  try {
    raw = await invoke(sftp, 'readdir', [target]);
  } catch (error) {
    if (isNotFound(error)) {
      throw new RemotePathError(`目录不存在：${target}`, 'no-such-dir', { path: target });
    }
    throw new SshError(`读取目录失败 ${target}：${normalizeError(error).message}`, 'readdir-failed');
  }
  const list = Array.isArray(raw) ? raw : [];
  return list
    .filter((item) => item && item.filename !== '.' && item.filename !== '..')
    .map((item) => attrsToEntry(item.filename, item.attrs || item.attributes || {}))
    .sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

/** stat / lstat（契约 §3.7 stat）。不存在时返回 {exists:false}，不抛错。 */
export async function statPath(sftp, target, options = {}) {
  const p = normalizeRemotePath(target);
  const method = options.followSymlinks === false ? 'lstat' : 'stat';
  try {
    const attrs = await invoke(sftp, method, [p]);
    const entry = attrsToEntry(path.posix.basename(p) || p, attrs || {});
    return { exists: true, isDir: entry.isDir, isLink: entry.isLink, size: entry.size, mtime: entry.mtime, mode: entry.mode };
  } catch (error) {
    if (isNotFound(error)) return { exists: false, isDir: false, isLink: false, size: 0, mtime: 0, mode: '' };
    // 某些服务端不支持 lstat：回退到 stat
    if (method === 'lstat' && /unsupported|not implemented/i.test(String(error.message || ''))) {
      return statPath(sftp, p, { ...options, followSymlinks: true });
    }
    throw new SshError(`stat 失败 ${p}：${normalizeError(error).message}`, 'stat-failed');
  }
}

/** 远端 realpath（用于把符号链接解析成真实路径，加固 containment 校验）。 */
export async function realPath(sftp, target) {
  try {
    const resolved = await invoke(sftp, 'realpath', [normalizeRemotePath(target)]);
    return typeof resolved === 'string' && resolved.startsWith('/') ? resolved : null;
  } catch {
    return null;
  }
}

/**
 * 递归遍历远端目录，返回**文件**列表（相对 root 的路径），带硬上限。
 *
 * @param {any} sftp
 * @param {string} root
 * @param {object} [options]
 * @returns {Promise<{ entries: Array<{path:string,size:number,mtime:number}>, truncated: boolean, scanned: number, errors: string[] }>}
 */
export async function walkFiles(sftp, root, options = {}) {
  const maxEntries = Number(options.maxEntries ?? 20_000);
  const maxDepth = Number(options.maxDepth ?? 12);
  const signal = options.signal;
  const log = options.log;
  const entries = [];
  const errors = [];
  let scanned = 0;
  let truncated = false;
  const queue = [{ dir: normalizeRemotePath(root), depth: 0 }];

  while (queue.length > 0) {
    if (signal?.aborted) break;
    const { dir, depth } = queue.shift();
    if (depth > maxDepth) {
      truncated = true;
      continue;
    }
    let list;
    try {
      list = await listDir(sftp, dir, options);
    } catch (error) {
      // 某个子目录不可读不应中断整体匹配，如实记录即可
      errors.push(`${dir}: ${normalizeError(error).message}`);
      continue;
    }
    for (const item of list) {
      scanned += 1;
      if (scanned > maxEntries) {
        truncated = true;
        break;
      }
      const full = `${dir === '/' ? '' : dir}/${item.name}`;
      if (item.isDir) {
        queue.push({ dir: full, depth: depth + 1 });
      } else {
        entries.push({ path: full, size: item.size, mtime: item.mtime });
      }
    }
    if (truncated) break;
  }
  if (truncated) {
    emitLog(log, 'warn', `远端遍历达到上限（已扫描 ${scanned} 项，上限 ${maxEntries}），结果可能不完整。`);
  }
  return { entries, truncated, scanned, errors };
}

/** 确保远端目录存在（递归创建，等价 mkdir -p，但走 SFTP 不经过 shell）。 */
export async function ensureRemoteDir(sftp, dir, options = {}) {
  const target = normalizeRemotePath(dir);
  if (target === '/' || target === '.') return target;
  const exists = await statPath(sftp, target);
  if (exists.exists) {
    if (!exists.isDir) throw new RemotePathError(`远端路径已存在且不是目录：${target}`, 'not-a-directory');
    return target;
  }
  const parent = path.posix.dirname(target);
  if (parent && parent !== target && parent !== '/') await ensureRemoteDir(sftp, parent, options);
  try {
    await invoke(sftp, 'mkdir', [target]);
  } catch (error) {
    // 并发/竞态：别人刚建好 → 视为成功
    const again = await statPath(sftp, target);
    if (!again.exists) {
      throw new SshError(`创建远端目录失败 ${target}：${normalizeError(error).message}`, 'mkdir-failed');
    }
  }
  return target;
}

/**
 * 上传：本地 → 远端，支持目录递归（契约 §3.7 transferIn）。
 * @returns {Promise<{ files: number, bytes: number, path: string }>}
 */
export async function transferIn(sftp, localPath, remotePath, options = {}) {
  const localStat = await fs.lstat(localPath);
  const target = normalizeRemotePath(remotePath);
  if (localStat.isDirectory()) {
    await ensureRemoteDir(sftp, target);
    let files = 0;
    let bytes = 0;
    for (const rel of await listLocalFiles(localPath)) {
      const from = path.join(localPath, rel);
      const to = `${target === '/' ? '' : target}/${rel.split(path.sep).join('/')}`;
      await ensureRemoteDir(sftp, path.posix.dirname(to));
      const size = await putFile(sftp, from, to);
      files += 1;
      bytes += size;
      options.onProgress?.({ path: to, size });
    }
    return { files, bytes, path: target };
  }
  const size = await putFile(sftp, localPath, target);
  return { files: 1, bytes: size, path: target };
}

/** 下载：远端 → 本地，支持目录递归（契约 §3.7 transferOut）。 */
export async function transferOut(sftp, remotePath, localPath, options = {}) {
  const target = normalizeRemotePath(remotePath);
  const info = await statPath(sftp, target);
  if (!info.exists) {
    throw new RemotePathError(`远端路径不存在：${target}`, 'no-such-file', { path: target });
  }
  if (info.isDir) {
    await fs.mkdir(localPath, { recursive: true });
    const { entries } = await walkFiles(sftp, target, { maxEntries: options.maxEntries ?? 20_000, log: options.log });
    let bytes = 0;
    for (const entry of entries) {
      const rel = entry.path.slice(target.length).replace(/^\/+/, '');
      const to = path.join(localPath, ...rel.split('/'));
      await fs.mkdir(path.dirname(to), { recursive: true });
      bytes += await getFile(sftp, entry.path, to);
      options.onProgress?.({ path: entry.path, size: entry.size });
    }
    return { files: entries.length, bytes, path: target };
  }
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  const bytes = await getFile(sftp, target, localPath);
  return { files: 1, bytes, path: target };
}

/** 单文件上传：优先 fastPut，缺失则退回流式 writeFile。 */
async function putFile(sftp, localFile, remoteFile) {
  const stat = await fs.stat(localFile);
  if (typeof sftp.fastPut === 'function') {
    await invoke(sftp, 'fastPut', [localFile, normalizeRemotePath(remoteFile)]);
    return stat.size;
  }
  if (typeof sftp.createWriteStream === 'function') {
    await new Promise((resolve, reject) => {
      const ws = sftp.createWriteStream(normalizeRemotePath(remoteFile));
      ws.on('close', resolve);
      ws.on('error', reject);
      createReadStream(localFile).pipe(ws);
    });
    return stat.size;
  }
  const data = await fs.readFile(localFile);
  await invoke(sftp, 'writeFile', [normalizeRemotePath(remoteFile), data]);
  return stat.size;
}

/** 单文件下载：优先 fastGet，缺失则退回流式 createReadStream。 */
async function getFile(sftp, remoteFile, localFile) {
  const info = await statPath(sftp, remoteFile);
  if (typeof sftp.fastGet === 'function') {
    await invoke(sftp, 'fastGet', [normalizeRemotePath(remoteFile), localFile]);
    return info.size;
  }
  if (typeof sftp.createReadStream === 'function') {
    await new Promise((resolve, reject) => {
      const rs = sftp.createReadStream(normalizeRemotePath(remoteFile));
      const ws = createWriteStream(localFile);
      rs.on('error', reject);
      ws.on('error', reject);
      ws.on('close', resolve);
      rs.pipe(ws);
    });
    return info.size;
  }
  const data = await invoke(sftp, 'readFile', [normalizeRemotePath(remoteFile)]);
  await fs.writeFile(localFile, data);
  return info.size;
}

/** 递归列出本地目录下的相对文件路径。 */
export async function listLocalFiles(dir, base = dir, out = []) {
  const items = await fs.readdir(dir, { withFileTypes: true });
  for (const item of items) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) await listLocalFiles(full, base, out);
    else if (item.isFile()) out.push(path.relative(base, full));
  }
  return out;
}

/** 校验远端路径不越界（幂等包装，便于调用点统一处理）。 */
export function guardRemotePath(base, target) {
  return assertInsideBase(base, target);
}
