// 测试辅助：临时工作目录（零依赖、离线、用后清理）。
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const created = [];

/** 建一个临时目录 */
export function makeTmpDir(prefix = 'dsh-devops-test-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

/** 写文件（自动建父目录） */
export function writeTmp(dir, rel, content) {
  const abs = join(dir, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content, 'utf8');
  return abs;
}

export function readTmp(dir, rel) {
  return readFileSync(join(dir, rel), 'utf8');
}

export function existsTmp(dir, rel) {
  return existsSync(join(dir, rel));
}

/** 清理所有由本模块创建的临时目录（测试文件结尾调用） */
export function cleanupTmp() {
  for (const dir of created.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // 清理失败不影响判定
    }
  }
}

/** 轻量 sleep */
export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 等待条件成立（带超时），返回是否成立 */
export async function waitFor(fn, { timeoutMs = 5000, intervalMs = 25 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    if (await fn()) return true;
    if (Date.now() > deadline) return false;
    // eslint-disable-next-line no-await-in-loop
    await sleep(intervalMs);
  }
}

/** 收集日志的假 logger（契约里的 log 形如 function 或 {info,warn,error,debug}） */
export function fakeLog() {
  const lines = [];
  const push = (level) => (...args) => {
    lines.push({ level, text: args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') });
  };
  const fn = push('log');
  fn.lines = lines;
  fn.text = () => lines.map((l) => l.text).join('\n');
  fn.info = push('info');
  fn.warn = push('warn');
  fn.error = push('error');
  fn.debug = push('debug');
  return fn;
}
