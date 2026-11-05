// 契约 §3.7：src/engine/executors/local.js（本地执行器）
// 覆盖：跑命令/退出码/超时/取消（断言进程真的结束）、env 透传与 undefined 删除、
//       readDir/stat/match/transferIn/transferOut、绝不拼 shell 字符串
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { suiteFor, requiredFn } from './helpers/modules.mjs';
import { makeTmpDir, cleanupTmp, waitFor, sleep } from './helpers/tmp.mjs';

const rel = 'src/engine/executors/local.js';
const { mod, skip } = await suiteFor(rel);

describe('engine/executors/local', { skip }, () => {
  // 契约未固定工厂名，探测常见候选
  const factory =
    ['createLocalExecutor', 'createExecutor', 'default', 'createLocal']
      .map((n) => ({ n, fn: mod?.[n] }))
      .find((x) => typeof x.fn === 'function') ?? null;

  let ex;
  let dir;

  before(async () => {
    dir = makeTmpDir('dsh-devops-local-');
    assert.ok(factory, `local.js 必须导出创建函数（试过 createLocalExecutor/createExecutor/default/createLocal），实际导出：${Object.keys(mod ?? {}).join(', ')}`);
    ex = await factory.fn({ config: { defaultShell: 'auto' }, log: () => {} });
  });

  after(async () => {
    await ex?.dispose?.();
    cleanupTmp();
  });

  test('Executor 形状：id/kind/probe/run/readDir/stat/match/transferIn/transferOut/dispose', () => {
    assert.equal(typeof ex.id, 'string', 'id 必须是字符串');
    assert.equal(ex.kind, 'local', 'kind 必须是 local');
    for (const m of ['probe', 'run', 'readDir', 'stat', 'match', 'transferIn', 'transferOut', 'dispose']) {
      assert.equal(typeof ex[m], 'function', `${m} 必须是函数`);
    }
  });

  test('run 执行命令并返回 { done, cancel, phase }', async () => {
    const chunks = [];
    const h = await ex.run({
      argv: [process.execPath, '-e', 'process.stdout.write("hello")'],
      onData: (c) => chunks.push(c),
    });
    assert.equal(typeof h.done?.then, 'function', 'handle.done 必须是 Promise');
    assert.equal(typeof h.cancel, 'function', 'handle.cancel 必须是函数');
    assert.ok('phase' in h, 'handle 必须有 phase 字段（可读写）');
    const res = await h.done;
    assert.equal(res.exitCode, 0, '正常退出码应为 0');
    assert.ok(chunks.map((c) => c.text).join('').includes('hello'), `onData 应收到 stdout，实际 ${JSON.stringify(chunks)}`);
  });

  test('run 非零退出码如实上报（不抛异常）', async () => {
    const h = await ex.run({ argv: [process.execPath, '-e', 'process.exit(3)'] });
    const res = await h.done;
    assert.equal(res.exitCode, 3, '退出码必须原样返回');
  });

  test('onData 区分 stdout / stderr', async () => {
    const got = [];
    const h = await ex.run({
      argv: [process.execPath, '-e', 'process.stdout.write("OUT");process.stderr.write("ERR")'],
      onData: (c) => got.push(c),
    });
    await h.done;
    const text = got.map((c) => c.text).join('');
    assert.ok(text.includes('OUT') && text.includes('ERR'), `应同时收到两路输出，实际 ${text}`);
    assert.ok(got.some((c) => c.stream === 'stdout'), '应有 stream=stdout 的分片');
    assert.ok(got.some((c) => c.stream === 'stderr'), '应有 stream=stderr 的分片');
  });

  test('env 透传；值为 undefined 表示删除该键', async () => {
    const script = 'process.stdout.write(JSON.stringify({A:process.env.PASS_A,B:process.env.DEL_B}))';
    const h = await ex.run({
      argv: [process.execPath, '-e', script],
      env: { PASS_A: 'yes', DEL_B: undefined },
    });
    let out = '';
    const h2 = await ex.run({
      argv: [process.execPath, '-e', script],
      env: { PASS_A: 'yes', DEL_B: undefined },
      onData: (c) => {
        out += c.text;
      },
    });
    await h.done;
    await h2.done;
    const parsed = JSON.parse(out);
    assert.equal(parsed.A, 'yes', 'env 应透传到子进程');
    assert.equal(parsed.B, undefined, 'undefined 值应删除该环境变量（子进程读不到）');
  });

  test('timeoutMs 到点必须结束进程（不悬挂）', async () => {
    const start = Date.now();
    const h = await ex.run({
      argv: [process.execPath, '-e', 'setTimeout(()=>{}, 60000)'],
      timeoutMs: 400,
    });
    // 哨兵键名必须与执行器返回值不冲突（执行器自己会返回 timedOut 字段）
    const res = await Promise.race([
      h.done,
      sleep(15000).then(() => ({ __raceTimedOut: true })),
    ]);
    assert.ok(!res.__raceTimedOut, '超时后 done 必须 resolve，不得悬挂 15s 以上');
    assert.ok(Date.now() - start < 12000, '超时后应尽快返回');
    assert.equal(res.timedOut, true, '超时结果应标记 timedOut:true');
  });

  test('cancel() 真的终止进程（轮询确认 PID 消失）', async () => {
    const pidFile = join(dir, 'pid.txt');
    const h = await ex.run({
      argv: [
        process.execPath,
        '-e',
        `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(()=>{}, 1000);`,
      ],
    });
    const ok = await waitFor(() => existsSync(pidFile), { timeoutMs: 8000 });
    assert.ok(ok, '子进程应写出 pid 文件');
    const pid = Number(readFileSync(pidFile, 'utf8'));
    assert.ok(Number.isInteger(pid) && pid > 0);

    h.cancel();
    const res = await Promise.race([h.done, sleep(15000).then(() => ({ __raceTimedOut: true }))]);
    assert.ok(!res.__raceTimedOut, 'cancel 后 done 必须 resolve');

    // 确认进程真的没了（Windows 上 kill(pid,0) 也能检活）
    const gone = await waitFor(() => {
      try {
        process.kill(pid, 0);
        return false; // 还活着
      } catch {
        return true; // 已退出
      }
    }, { timeoutMs: 8000 });
    assert.ok(gone, `cancel 后 pid=${pid} 必须真的结束`);
  });

  test('cancel 的信号语义：返回 { exitCode, signal } 之一', async () => {
    const h = await ex.run({ argv: [process.execPath, '-e', 'setInterval(()=>{},1000)'] });
    await sleep(150);
    h.cancel();
    const res = await h.done;
    assert.ok(
      res.signal || res.exitCode !== 0,
      `被取消的进程应报告 signal 或非零 exitCode，实际 ${JSON.stringify(res)}`,
    );
  });

  test('cwd 生效', async () => {
    let out = '';
    const h = await ex.run({
      argv: [process.execPath, '-e', 'process.stdout.write(process.cwd())'],
      cwd: dir,
      onData: (c) => {
        out += c.text;
      },
    });
    await h.done;
    assert.ok(out.toLowerCase().includes(dir.split(/[\\/]/).pop().toLowerCase()), `cwd 应为 ${dir}，实际 ${out}`);
  });

  test('readDir 列出目录项，越界（不存在）抛错', async () => {
    writeFileSync(join(dir, 'f1.txt'), 'a');
    mkdirSync(join(dir, 'sub'), { recursive: true });
    const entries = await ex.readDir(null, dir);
    assert.ok(Array.isArray(entries), 'readDir 必须返回数组');
    const byName = Object.fromEntries(entries.map((e) => [e.name, e]));
    assert.ok(byName['f1.txt'], '应列出 f1.txt');
    assert.equal(byName['f1.txt'].isDir, false, 'f1.txt 不是目录');
    assert.equal(byName['sub'].isDir, true, 'sub 是目录');
    assert.equal(typeof byName['f1.txt'].size, 'number', 'size 必须是数字');

    await assert.rejects(() => ex.readDir(null, join(dir, 'no-such-dir')), /.*/, '不存在的目录必须报错');
  });

  test('stat 返回 { exists, isDir, size, mtime }', async () => {
    const s = await ex.stat(null, join(dir, 'f1.txt'));
    assert.equal(s.exists, true);
    assert.equal(s.isDir, false);
    assert.equal(typeof s.size, 'number');
    assert.ok('mtime' in s);
    const miss = await ex.stat(null, join(dir, 'nope.txt'));
    assert.equal(miss.exists, false, '不存在的路径 exists=false');
  });

  test('match 按 glob 匹配并返回 { matched, truncated, total }', async () => {
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'a.js'), 'x');
    writeFileSync(join(dir, 'src', 'b.js'), 'y');
    writeFileSync(join(dir, 'src', 'c.txt'), 'z');
    const r = await ex.match(null, dir, 'src/*.js');
    assert.ok(Array.isArray(r.matched), 'matched 必须是数组');
    assert.equal(typeof r.total, 'number', 'total 必须是数字');
    assert.equal(typeof r.truncated, 'boolean', 'truncated 必须是布尔');
    const names = r.matched.map((m) => m.path.replace(/\\/g, '/'));
    assert.ok(names.some((p) => p.endsWith('src/a.js')), `应匹配 a.js，实际 ${JSON.stringify(names)}`);
    assert.ok(!names.some((p) => p.endsWith('.txt')), '不应匹配 txt');
  });

  test('transferIn / transferOut 往返一致', async () => {
    const src = join(dir, 'transfer-src.txt');
    writeFileSync(src, 'round-trip-content');
    const remote = join(dir, 'transfer-dst.txt');
    await ex.transferIn(null, src, remote);
    assert.equal(readFileSync(remote, 'utf8'), 'round-trip-content', 'transferIn 内容必须一致');

    const back = join(dir, 'transfer-back.txt');
    await ex.transferOut(null, remote, back);
    assert.equal(readFileSync(back, 'utf8'), 'round-trip-content', 'transferOut 内容必须一致');
  });

  test('用户输入不得被 shell 解释（argv 直传）', async () => {
    let out = '';
    const evil = '; echo INJECTED ;';
    const h = await ex.run({
      argv: [process.execPath, '-e', 'process.stdout.write(process.argv[1])', evil],
      onData: (c) => {
        out += c.text;
      },
    });
    await h.done;
    assert.equal(out.trim(), evil.trim(), `参数必须原样传递，实际 ${JSON.stringify(out)}`);
    assert.ok(!out.includes('INJECTED\nINJECTED'), '不得发生 shell 注入');
  });

  test('probe 返回契约字段', async () => {
    const p = await ex.probe({ id: 'local', kind: 'local', host: '127.0.0.1' });
    for (const k of ['os', 'arch', 'shell', 'workdir']) {
      assert.ok(k in p, `probe 结果必须含 ${k}`);
    }
    assert.ok(p.runtime && typeof p.runtime === 'object', 'runtime 必须是对象');
    assert.ok(Array.isArray(p.managers), 'managers 必须是数组');
  });

  test('phase 可读写（引擎写 phase 后读回同值）', async () => {
    const h = await ex.run({ argv: [process.execPath, '-e', 'setTimeout(()=>{},300)'] });
    h.phase = 'running';
    assert.equal(h.phase, 'running', 'phase 必须可写可读');
    await h.done;
  });

  test('dispose 幂等，且不影响已完成的运行', async () => {
    const h = await ex.run({ argv: [process.execPath, '-e', 'process.exit(0)'] });
    await h.done;
    await assert.doesNotReject(() => ex.dispose());
  });
});
