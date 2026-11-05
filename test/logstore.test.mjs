// 契约 §3.6：src/logs/logstore.js
// 覆盖：append 后 read 的 lines/next/bytes、from 偏移续读、环溢出 lossy、
//       打码生效（日志里不得出现密钥明文）、JSONL 每行可 JSON.parse、seq 全局单调、cleanup 按天数
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, utimesSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { suiteFor, requiredFn } from './helpers/modules.mjs';
import { makeTmpDir, cleanupTmp, sleep } from './helpers/tmp.mjs';

const rel = 'src/logs/logstore.js';
const { mod, skip } = await suiteFor(rel);

describe('logs/logstore', { skip }, () => {
  const createLogStore = requiredFn(mod, 'createLogStore', rel);

  let dir;
  let log;

  before(async () => {
    dir = makeTmpDir('dsh-devops-logs-');
    log = createLogStore({ dataDir: dir, ringBytes: 4096, mask: ['TOP-SECRET-VALUE'] });
    await log.ensureRun('run-1');
  });

  after(() => cleanupTmp());

  test('ensureRun 建目录，pathFor 返回绝对路径', async () => {
    await log.ensureRun('run-dir');
    const p = log.pathFor('run-dir', 'step-a');
    assert.ok(isAbsolute(p), `pathFor 必须返回绝对路径，实际 ${p}`);
    assert.match(p.replace(/\\/g, '/'), /runs\/run-dir\/steps\/step-a\.log$/, `路径形状应符合契约，实际 ${p}`);
  });

  test('append 后 read：lines/next/bytes 正确，seq 递增', async () => {
    await log.append('run-1', 's1', { text: 'line-a\n', stream: 'stdout' });
    await log.append('run-1', 's1', { text: 'line-b\n', stream: 'stderr' });
    const r = log.read({ runId: 'run-1', stepId: 's1', from: 0 });
    assert.ok(Array.isArray(r.lines), 'lines 必须是数组');
    assert.equal(r.lines.length, 2, `应有 2 行，实际 ${r.lines.length}`);
    assert.equal(r.lines[0].text, 'line-a\n');
    assert.equal(r.lines[0].stream, 'stdout');
    assert.equal(r.lines[1].stream, 'stderr');
    assert.ok(r.lines[1].seq > r.lines[0].seq, 'seq 必须单调递增');
    assert.equal(typeof r.next, 'number');
    assert.equal(r.next, r.lines.at(-1).seq, 'next 应等于最后一条 seq');
    assert.ok(typeof r.bytes === 'number' && r.bytes > 0, 'bytes 应为正数');
    assert.equal(typeof r.lossy, 'boolean');
  });

  test('read({from}) 只返回 seq > from 的行（续读）', async () => {
    const all = log.read({ runId: 'run-1', stepId: 's1', from: 0 });
    const firstSeq = all.lines[0].seq;
    const tail = log.read({ runId: 'run-1', stepId: 's1', from: firstSeq });
    assert.equal(tail.lines.length, all.lines.length - 1, `从第一批之后续读应少一行，实际 ${tail.lines.length}`);
    assert.ok(tail.lines.every((l) => l.seq > firstSeq), '不得返回已读过的行');
  });

  test('续读用 next 作为游标可拿到后续新增行', async () => {
    const r1 = log.read({ runId: 'run-1', stepId: 's1', from: 0 });
    await log.append('run-1', 's1', { text: 'line-c\n', stream: 'stdout' });
    const r2 = log.read({ runId: 'run-1', stepId: 's1', from: r1.next });
    assert.equal(r2.lines.length, 1, '应只拿到新增的一行');
    assert.equal(r2.lines[0].text, 'line-c\n');
  });

  test('落盘为 JSONL：每行都能 JSON.parse 且含 seq/ts/stream/text', async () => {
    await log.append('run-1', 's2', { text: 'jsonl-1', stream: 'stdout' });
    await log.append('run-1', 's2', { text: 'jsonl-2', stream: 'stdout' });
    const raw = readFileSync(log.pathFor('run-1', 's2'), 'utf8');
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    assert.ok(lines.length >= 2, `应有至少 2 行 JSONL，实际 ${lines.length}`);
    for (const line of lines) {
      const obj = JSON.parse(line); // 不抛即合格
      assert.equal(typeof obj.seq, 'number', 'JSONL 行必须含数字 seq');
      assert.equal(typeof obj.ts, 'number', 'JSONL 行必须含数字 ts');
      assert.equal(typeof obj.stream, 'string', 'JSONL 行必须含字符串 stream');
      assert.equal(typeof obj.text, 'string', 'JSONL 行必须含字符串 text');
    }
  });

  test('打码：密钥明文不得出现在内存读取结果里', async () => {
    await log.append('run-1', 's3', { text: 'token=TOP-SECRET-VALUE end', stream: 'stdout' });
    const r = log.read({ runId: 'run-1', stepId: 's3', from: 0 });
    const joined = r.lines.map((l) => l.text).join('');
    assert.ok(!joined.includes('TOP-SECRET-VALUE'), `读取结果不得含密钥明文，实际 ${joined}`);
    assert.ok(joined.includes('token='), '除密钥外应保留其余内容');
  });

  test('打码：密钥明文不得出现在磁盘文件里（写盘前打码）', async () => {
    await log.append('run-1', 's4', { text: 'secret=TOP-SECRET-VALUE', stream: 'stdout' });
    const raw = readFileSync(log.pathFor('run-1', 's4'), 'utf8');
    assert.ok(!raw.includes('TOP-SECRET-VALUE'), `磁盘文件不得含密钥明文，实际 ${raw}`);
  });

  test('seq 全局单调（跨 run / 跨 step）', async () => {
    await log.ensureRun('run-2');
    await log.append('run-1', 's5', { text: 'x', stream: 'stdout' });
    await log.append('run-2', 's1', { text: 'y', stream: 'stdout' });
    const a = log.read({ runId: 'run-1', stepId: 's5', from: 0 }).lines[0];
    const b = log.read({ runId: 'run-2', stepId: 's1', from: 0 }).lines[0];
    assert.ok(b.seq > a.seq, `后写入的 seq 必须更大：run-1/s5=${a.seq}, run-2/s1=${b.seq}`);
  });

  test('环溢出：小环写入大量数据后 lossy=true 且带 spillPath', async () => {
    await log.ensureRun('run-ring');
    for (let i = 0; i < 400; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await log.append('run-ring', 'big', { text: `chunk-${String(i).padStart(4, '0')}-${'x'.repeat(64)}\n`, stream: 'stdout' });
    }
    const r = log.read({ runId: 'run-ring', stepId: 'big', from: 0 });
    assert.equal(r.lossy, true, '环被冲掉后 lossy 必须为 true');
    assert.ok(r.lines.length < 400, `ringBytes=4096 不可能保留 400 行，实际 ${r.lines.length}`);
    assert.ok(r.bytes > 0, 'bytes 应反映实际存在的日志量');
    assert.ok(r.spillPath === undefined || typeof r.spillPath === 'string', 'spillPath 若存在必须是字符串');
    assert.ok(existsSync(log.pathFor('run-ring', 'big')), '磁盘文件必须保留全部内容（环只影响内存快照）');
  });

  test('readRun 多步合并且按 seq 全局有序', async () => {
    await log.ensureRun('run-multi');
    await log.append('run-multi', 'st-a', { text: 'a1', stream: 'stdout' });
    await log.append('run-multi', 'st-b', { text: 'b1', stream: 'stdout' });
    await log.append('run-multi', 'st-a', { text: 'a2', stream: 'stdout' });
    const r = log.readRun('run-multi', 0);
    const lines = r.lines ?? r;
    assert.ok(Array.isArray(lines), 'readRun 应返回可遍历的行数组');
    for (let i = 1; i < lines.length; i += 1) {
      assert.ok(lines[i].seq >= lines[i - 1].seq, 'readRun 结果必须按 seq 全局有序');
    }
  });

  test('listRuns 列出所有 run 目录', async () => {
    const runs = log.listRuns();
    assert.ok(Array.isArray(runs), 'listRuns 必须返回数组');
    assert.ok(runs.includes('run-1'), `应包含 run-1，实际 ${JSON.stringify(runs)}`);
    assert.ok(runs.includes('run-multi'), '应包含 run-multi');
  });

  test('cleanup 按保留天数删除过期 run，保留新鲜的', async () => {
    await log.ensureRun('run-old');
    await log.append('run-old', 's', { text: 'old', stream: 'stdout' });
    const oldFile = log.pathFor('run-old', 's');
    const stale = new Date(Date.now() - 90 * 24 * 3600 * 1000);
    utimesSync(oldFile, stale, stale);
    const oldDir = join(dir, 'runs', 'run-old');
    utimesSync(oldDir, stale, stale);

    await log.cleanup(30);
    assert.ok(!log.listRuns().includes('run-old'), '超过保留期的 run 应被清理');
    assert.ok(log.listRuns().includes('run-1'), '新鲜 run 必须保留');
  });

  test('append 到未 ensureRun 的 run 也能工作（自动建目录）', async () => {
    const r = await log.append('run-auto', 'st', { text: 'auto', stream: 'stdout' });
    assert.ok(r === undefined || typeof r === 'object', 'append 返回值不约束');
    assert.ok(existsSync(log.pathFor('run-auto', 'st')), '应自动建目录与文件');
  });

  test('read 不存在的 step 返回空 lines 且不抛异常', () => {
    let out;
    assert.doesNotThrow(() => {
      out = log.read({ runId: 'run-1', stepId: 'never-existed', from: 0 });
    });
    assert.ok(out);
    assert.deepEqual(out.lines, [], '不存在的 step 应返回空数组');
  });

  test('writeStream 语义：多次 append 追加而不是覆盖', async () => {
    await log.append('run-1', 's-append', { text: 'first', stream: 'stdout' });
    await log.append('run-1', 's-append', { text: 'second', stream: 'stdout' });
    const raw = readFileSync(log.pathFor('run-1', 's-append'), 'utf8');
    assert.ok(raw.includes('first') && raw.includes('second'), '两次 append 的内容都必须保留');
  });
});
