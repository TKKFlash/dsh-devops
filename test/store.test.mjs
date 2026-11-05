// 契约 §3.5：src/store/store.js
// 覆盖：文件后端 put/get/update/delete/entries、原子写、settings 单例、
//       并发 put 不互相破坏、重启（新建实例重读盘）后数据仍在、lock 目录清理
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { suiteFor, requiredFn } from './helpers/modules.mjs';
import { makeTmpDir, cleanupTmp, fakeLog } from './helpers/tmp.mjs';

const rel = 'src/store/store.js';
const { mod, skip } = await suiteFor(rel);

describe('store/store', { skip }, () => {
  const createStore = requiredFn(mod, 'createStore', rel);

  let dir;
  let store;

  before(async () => {
    dir = makeTmpDir('dsh-devops-store-');
    store = await createStore({ dataDir: dir, log: fakeLog() });
  });

  after(async () => {
    await store?.close?.();
    cleanupTmp();
  });

  test('createStore 是异步工厂，返回带 table 字段的对象', () => {
    assert.equal(typeof store.pipelines?.get, 'function', 'store.pipelines.get 必须是函数');
    for (const name of ['pipelines', 'templates', 'servers', 'envsets', 'snippets', 'recent', 'runs']) {
      assert.ok(store[name], `store.${name} 必须存在`);
      for (const m of ['get', 'list', 'entries', 'put', 'update', 'delete']) {
        assert.equal(typeof store[name][m], 'function', `store.${name}.${m} 必须是函数`);
      }
    }
    assert.equal(typeof store.settings?.get, 'function', 'settings.get 必须是同步函数');
    assert.equal(typeof store.settings?.set, 'function', 'settings.set 必须是异步函数');
    assert.equal(typeof store.close, 'function');
  });

  test('内置 local 服务器必须存在且不可删除', async () => {
    const local = store.servers.get('local');
    assert.ok(local, '必须预置 id=local 的服务器');
    assert.equal(local.kind, 'local', 'local 服务器 kind 必须是 local');
    const removed = await store.servers.delete('local');
    assert.equal(removed, false, '删除内置 local 必须返回 false');
    assert.ok(store.servers.get('local'), 'local 必须仍在');
  });

  test('put/get/list/entries 基本读写', async () => {
    const rec = { id: 'p-a', name: 'A', stages: [] };
    await store.pipelines.put('p-a', rec);
    assert.deepEqual(store.pipelines.get('p-a'), rec, 'get 应返回写入值');
    const list = store.pipelines.list();
    assert.ok(Array.isArray(list));
    assert.ok(list.some((x) => x.id === 'p-a'));
    const entries = store.pipelines.entries();
    assert.ok(Array.isArray(entries));
    assert.ok(entries.every((e) => Array.isArray(e) && e.length === 2), 'entries 应为 [id, value] 对');
  });

  test('get 不存在的 id 返回 undefined', () => {
    assert.equal(store.pipelines.get('nope-nope'), undefined);
  });

  test('写入后落盘为 <dataDir>/store/<table>.json 且内容完整（原子写）', async () => {
    const rec = { id: 'p-atomic', name: '原子', steps: Array.from({ length: 50 }, (_, i) => i) };
    await store.pipelines.put('p-atomic', rec);
    const file = join(dir, 'store', 'pipelines.json');
    assert.ok(existsSync(file), `应生成 ${file}`);
    const raw = readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    assert.ok(parsed, '文件必须是完整可解析的 JSON，不得是半截内容');
    const found = Array.isArray(parsed) ? parsed.find((x) => x.id === 'p-atomic') : parsed['p-atomic'];
    assert.ok(found, '文件里必须包含刚写入的记录');
    assert.equal(found.name, '原子');
  });

  test('原子写：目录内不得残留临时文件', async () => {
    await store.pipelines.put('p-tmp-check', { id: 'p-tmp-check', name: 'T' });
    const files = readdirSync(join(dir, 'store'));
    const leftovers = files.filter((f) => /\.(tmp|temp|swp|partial)$/i.test(f) || f.startsWith('.tmp'));
    assert.deepEqual(leftovers, [], `不应残留临时文件，实际 ${JSON.stringify(files)}`);
  });

  test('update(id, fn) 应用变更并持久化', async () => {
    await store.pipelines.put('p-upd', { id: 'p-upd', name: 'U', count: 1 });
    const out = await store.pipelines.update('p-upd', (cur) => ({ ...cur, count: cur.count + 1 }));
    assert.equal(out.count, 2, 'update 应返回更新后的值');
    assert.equal(store.pipelines.get('p-upd').count, 2, '内存快照应同步');
    const file = JSON.parse(readFileSync(join(dir, 'store', 'pipelines.json'), 'utf8'));
    const found = Array.isArray(file) ? file.find((x) => x.id === 'p-upd') : file['p-upd'];
    assert.equal(found.count, 2, 'update 必须落盘');
  });

  test('delete 删除并返回 true；重复删除返回 false', async () => {
    await store.pipelines.put('p-del', { id: 'p-del', name: 'D' });
    assert.equal(await store.pipelines.delete('p-del'), true);
    assert.equal(store.pipelines.get('p-del'), undefined, 'get 应返回 undefined');
    assert.equal(await store.pipelines.delete('p-del'), false, '重复删除应返回 false');
  });

  test('并发 put 不互相破坏（全部可读回）', async () => {
    const ids = Array.from({ length: 40 }, (_, i) => `p-conc-${i}`);
    await Promise.all(ids.map((id, i) => store.pipelines.put(id, { id, name: `并发${i}`, idx: i })));
    for (const id of ids) {
      const got = store.pipelines.get(id);
      assert.ok(got, `并发写入后 ${id} 必须存在`);
      assert.equal(got.id, id);
    }
    // 落盘文件同样完整
    const file = JSON.parse(readFileSync(join(dir, 'store', 'pipelines.json'), 'utf8'));
    const arr = Array.isArray(file) ? file : Object.values(file);
    for (const id of ids) {
      assert.ok(arr.some((x) => x.id === id), `落盘文件应包含 ${id}`);
    }
  });

  test('并发 update 同一 id 不丢失语义（最终值自增正确）', async () => {
    await store.pipelines.put('p-race', { id: 'p-race', n: 0 });
    await Promise.all(Array.from({ length: 20 }, () => store.pipelines.update('p-race', (cur) => ({ ...cur, n: (cur?.n ?? 0) + 1 }))));
    assert.equal(store.pipelines.get('p-race').n, 20, '20 次并发自增后应为 20');
  });

  test('settings 是 global 单例：get 同步、set 返回更新后的设置', async () => {
    const s0 = store.settings.get();
    assert.equal(typeof s0, 'object');
    const s1 = await store.settings.set({ maxConcurrentRuns: 7 });
    assert.equal(s1.maxConcurrentRuns, 7, 'set 应返回新设置');
    assert.equal(store.settings.get().maxConcurrentRuns, 7, 'get 应读到最新值');
    assert.equal(store.settings.get().defaultServer, s0.defaultServer ?? 'local', '未变更字段应保留');
  });

  test('settings 默认值符合契约 §2.4（用全新实例，避免被前序用例污染）', async () => {
    const fresh = await createStore({ dataDir: makeTmpDir('dsh-devops-settings-'), log: fakeLog() });
    try {
      const s = fresh.settings.get();
      assert.equal(s.defaultServer, 'local');
      assert.equal(s.maxConcurrentRuns, 2);
      assert.equal(s.maxParallelSteps, 4);
      assert.equal(s.logRingBytes, 524288);
      assert.equal(s.logRetentionDays, 30);
      assert.equal(s.defaultShell, 'auto');
      assert.equal(s.statusBar, true);
      assert.equal(s.stuckSilenceSec, 60);
      assert.equal(s.allowCustomNodeCode, false);
    } finally {
      await fresh.close();
    }
  });

  test('重启（新建实例重新读盘）后数据仍在', async () => {
    await store.pipelines.put('p-persist', { id: 'p-persist', name: '持久化' });
    await store.close();
    const store2 = await createStore({ dataDir: dir, log: fakeLog() });
    try {
      assert.deepEqual(store2.pipelines.get('p-persist'), { id: 'p-persist', name: '持久化' }, '重启后记录必须还在');
      assert.equal(store2.settings.get().maxConcurrentRuns, 7, '重启后设置必须还在');
    } finally {
      await store2.close();
    }
    // 后续用例继续用原实例：重建
    store = await createStore({ dataDir: dir, log: fakeLog() });
  });

  test('close() 之后不残留 .lock 目录', async () => {
    const dir2 = makeTmpDir('dsh-devops-lock-');
    const s = await createStore({ dataDir: dir2, log: fakeLog() });
    await s.pipelines.put('x', { id: 'x' });
    await s.close();
    const storeDir = join(dir2, 'store');
    if (existsSync(storeDir)) {
      const locks = readdirSync(storeDir).filter((f) => f.endsWith('.lock'));
      assert.deepEqual(locks, [], `close 后不应残留 .lock：${JSON.stringify(locks)}`);
    }
  });

  test('损坏的 JSON 文件不应让 createStore 崩溃（降级为空表）', async () => {
    const dir3 = makeTmpDir('dsh-devops-corrupt-');
    mkdirSync(join(dir3, 'store'), { recursive: true });
    writeFileSync(join(dir3, 'store', 'pipelines.json'), '{ this is not json', 'utf8');
    let s;
    try {
      s = await createStore({ dataDir: dir3, log: fakeLog() });
      assert.ok(s, '损坏文件时必须仍能启动（降级处理）');
      assert.ok(Array.isArray(s.pipelines.list()), 'list 必须仍可调用');
    } finally {
      await s?.close?.();
      cleanupTmp();
    }
  });
});
