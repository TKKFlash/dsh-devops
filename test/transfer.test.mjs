// 契约 §3.10 /api/export 与 /api/import + task-4：src/api/handlers/transfer.js
// 覆盖：往返一致、formatVersion/kind 校验、**导出物中不得出现密钥明文**、
//       冲突与缺失检测、mode=new/overwrite、整体拒绝（不留半成品）
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { suiteFor, requiredFn } from './helpers/modules.mjs';
import { makeTmpDir, cleanupTmp, fakeLog } from './helpers/tmp.mjs';
import { samplePipeline, sampleTemplate, sampleServer, sampleEnvSet } from './helpers/fixtures.mjs';

const rel = 'src/api/handlers/transfer.js';
const { mod, skip } = await suiteFor(rel);

describe('api/transfer（导出导入）', { skip }, () => {
  const exportDocument = requiredFn(mod, 'exportDocument', rel);
  const importDocument = requiredFn(mod, 'importDocument', rel);
  const FORMAT_VERSION = mod.FORMAT_VERSION;

  /** 造一个隔离的内存 store（借用真实 createStore，确保形状与契约一致） */
  async function freshStore() {
    const { createStore } = await import('../src/store/store.js');
    return createStore({ dataDir: makeTmpDir('dsh-devops-transfer-'), log: fakeLog() });
  }

  /** 造一个最小可用的 nodes 服务（导入时的节点存在性校验用） */
  function fakeNodes(types = ['shell.exec', 'node.exec', 'python.exec']) {
    const known = new Set(types);
    return {
      list: () => [...known].map((type) => ({ type })),
      get: (type) => (known.has(type) ? { type, run: async () => ({ exitCode: 0 }), fields: [], outputs: [] } : undefined),
    };
  }

  /** query 参数用的假 URLSearchParams */
  const q = (obj) => new URLSearchParams(obj);

  let store;
  before(async () => {
    store = await freshStore();
  });
  after(async () => {
    await store?.close?.();
    cleanupTmp();
  });

  test('导出单条流水线：带 formatVersion 与 kind', async () => {
    const p = samplePipeline({ id: 'exp-1', name: '导出用' });
    await store.pipelines.put('exp-1', p);
    const doc = await exportDocument({ store, nodes: fakeNodes() }, { query: q({ kind: 'pipeline', id: 'exp-1' }) });
    assert.equal(doc.formatVersion, FORMAT_VERSION, 'formatVersion 必须存在且为当前版本');
    assert.equal(doc.kind, 'pipeline', 'kind 必须是 pipeline');
    assert.ok(doc.pipeline, '必须带 pipeline 主体');
    assert.equal(doc.pipeline.id, 'exp-1');
    assert.ok(doc.exportedAt > 0, '应带导出时间');
  });

  test('kind 非法必须报错（不得静默按 pipeline 处理）', async () => {
    await assert.rejects(
      () => exportDocument({ store, nodes: fakeNodes() }, { query: q({ kind: 'nonsense', id: 'exp-1' }) }),
      /.*/,
      '未知 kind 必须拒绝',
    );
  });

  test('导出不存在的 id 报错', async () => {
    await assert.rejects(
      () => exportDocument({ store, nodes: fakeNodes() }, { query: q({ kind: 'pipeline', id: 'no-such' }) }),
      /.*/,
      '不存在的 id 必须报错',
    );
  });

  test('★ 导出物中不得出现密钥明文（secret 只保留引用名）', async () => {
    const secretValue = 'SUPER-SECRET-PASSWORD-123';
    await store.servers.put('sec-srv', sampleServer({
      id: 'sec-srv',
      name: '含密钥的机器',
      auth: { type: 'password', keyRef: '', passwordRef: 'PROD_PW' },
      // 恶意/历史数据：明文密码混在对象里
      password: secretValue,
      privateKey: `-----BEGIN KEY-----\n${secretValue}\n-----END KEY-----`,
      passphrase: secretValue,
      customEnv: [{ name: 'API_TOKEN', value: 'PROD_TOKEN', secret: true }],
    }));
    await store.envsets.put('sec-env', sampleEnvSet({
      id: 'sec-env',
      vars: [{ name: 'DB_PASSWORD', value: `PROD_DB_PW`, secret: true }],
    }));
    // 流水线里也塞一个 secret 变量
    await store.pipelines.put('sec-pipe', samplePipeline({
      id: 'sec-pipe',
      variables: [{ name: 'DEPLOY_KEY', value: 'PROD_DEPLOY_KEY', secret: true }],
    }));

    const doc = await exportDocument({ store, nodes: fakeNodes() }, { query: q({ kind: 'bundle' }) });
    const text = JSON.stringify(doc);

    assert.ok(!text.includes(secretValue), `导出物不得含密钥明文，实际出现于：${text.slice(Math.max(0, text.indexOf(secretValue) - 120), text.indexOf(secretValue) + 60)}`);
    assert.ok(!/"password"\s*:/.test(text), '导出物不得含裸 password 字段');
    assert.ok(!/"privateKey"\s*:/.test(text), '导出物不得含裸 privateKey 字段');
    assert.ok(!/"passphrase"\s*:/.test(text), '导出物不得含裸 passphrase 字段');
    // 引用名必须保留（否则导入后无法找回凭据）
    assert.ok(text.includes('PROD_PW') || text.includes('PROD_DB_PW') || text.includes('PROD_TOKEN'), '必须保留凭据引用名');
  });

  test('bundle 导出包含各资源但不含内置 local 服务器', async () => {
    const doc = await exportDocument({ store, nodes: fakeNodes() }, { query: q({ kind: 'bundle' }) });
    assert.equal(doc.kind, 'bundle');
    for (const key of ['pipelines', 'templates', 'envsets', 'snippets', 'servers']) {
      assert.ok(Array.isArray(doc[key]), `bundle 必须含数组字段 ${key}`);
    }
    assert.ok(!doc.servers.some((s) => s.id === 'local'), '内置 local 不应出现在导出物里');
  });

  test('★ 往返一致：导出 → 导入到空 store → 关键字段一致', async () => {
    const src = await freshStore();
    const dst = await freshStore();
    try {
      const pipeline = samplePipeline({ id: 'rt-pipe', name: '往返流水线', stage: undefined });
      await src.pipelines.put('rt-pipe', pipeline);
      await src.templates.put('rt-tpl', sampleTemplate({ id: 'rt-tpl', name: '往返模板' }));
      await src.envsets.put('rt-env', sampleEnvSet({ id: 'rt-env' }));

      const doc = await exportDocument({ store: src, nodes: fakeNodes() }, { query: q({ kind: 'bundle' }) });
      const result = await importDocument({ store: dst, nodes: fakeNodes(), config: {} }, { body: { document: doc, mode: 'new' } });

      assert.ok(result && typeof result === 'object', 'importDocument 必须返回结果对象');
      const imported = dst.pipelines.get('rt-pipe');
      assert.ok(imported, `导入后应存在 rt-pipe，实际现有 ${JSON.stringify(dst.pipelines.list().map((p) => p.id))}`);
      assert.equal(imported.name, '往返流水线', '名称必须一致');
      assert.equal(imported.stages[0].jobs[0].node, 'shell.exec', '节点类型必须一致');
      assert.ok(dst.templates.get('rt-tpl'), '模板也应被导入');
      assert.ok(dst.envsets.get('rt-env'), '环境变量组也应被导入');
    } finally {
      await src.close();
      await dst.close();
    }
  });

  test('导入拒绝：缺少 formatVersion / 版本不支持 / kind 未知', async () => {
    await assert.rejects(
      () => importDocument({ store, nodes: fakeNodes(), config: {} }, { body: { document: { kind: 'pipeline', pipeline: samplePipeline() } } }),
      /formatVersion/,
      '缺 formatVersion 必须拒绝',
    );
    await assert.rejects(
      () => importDocument({ store, nodes: fakeNodes(), config: {} }, { body: { document: { formatVersion: 999, kind: 'pipeline', pipeline: samplePipeline() } } }),
      /.*/,
      '不支持的版本必须拒绝',
    );
    await assert.rejects(
      () => importDocument({ store, nodes: fakeNodes(), config: {} }, { body: { document: { formatVersion: FORMAT_VERSION, kind: 'nope' } } }),
      /.*/,
      '未知 kind 必须拒绝',
    );
  });

  test('导入拒绝：非对象 / 数组 document', async () => {
    for (const bad of [null, 'str', 42, []]) {
      await assert.rejects(
        () => importDocument({ store, nodes: fakeNodes(), config: {} }, { body: { document: bad } }),
        /.*/,
        `document=${JSON.stringify(bad)} 必须拒绝`,
      );
    }
  });

  test('导入校验：流水线内容非法（坏 id）必须整体拒绝', async () => {
    const doc = {
      formatVersion: FORMAT_VERSION,
      kind: 'pipeline',
      pipeline: samplePipeline({ id: 'BAD ID WITH SPACE' }),
    };
    await assert.rejects(
      () => importDocument({ store, nodes: fakeNodes(), config: {} }, { body: { document: doc, mode: 'new' } }),
      /.*/,
      '非法 id 必须导致整体拒绝',
    );
  });

  test('导入校验：环依赖必须被检出并拒绝', async () => {
    const cyclic = samplePipeline({ id: 'cyc', name: '环' });
    cyclic.stages[0].jobs = [
      { id: 'a', name: 'A', node: 'shell.exec', needs: ['b'] },
      { id: 'b', name: 'B', node: 'shell.exec', needs: ['a'] },
    ];
    await assert.rejects(
      () => importDocument(
        { store, nodes: fakeNodes(), config: {} },
        { body: { document: { formatVersion: FORMAT_VERSION, kind: 'pipeline', pipeline: cyclic }, mode: 'new' } },
      ),
      /.*/,
      '成环的流水线必须被拒绝',
    );
  });

  test('导入校验：未知节点类型被检出（missingNodes）', async () => {
    const p = samplePipeline({ id: 'unk-node' });
    p.stages[0].jobs[0].node = 'totally.unknown.node';
    let caught = null;
    try {
      await importDocument(
        { store, nodes: fakeNodes(['shell.exec']), config: {} },
        { body: { document: { formatVersion: FORMAT_VERSION, kind: 'pipeline', pipeline: p }, mode: 'new' } },
      );
    } catch (error) {
      caught = error;
    }
    assert.ok(caught, '未知节点必须导致失败');
    const blob = JSON.stringify(caught.details ?? caught.message ?? '');
    assert.ok(
      /totally\.unknown\.node|missingNodes/i.test(blob),
      `错误详情应指出缺失的节点类型，实际 ${blob}`,
    );
  });

  test('mode=new：id 冲突时不得覆盖既有数据', async () => {
    const s = await freshStore();
    try {
      await s.pipelines.put('conflict-1', samplePipeline({ id: 'conflict-1', name: '原有' }));
      const doc = {
        formatVersion: FORMAT_VERSION,
        kind: 'pipeline',
        pipeline: samplePipeline({ id: 'conflict-1', name: '导入的' }),
      };
      await importDocument({ store: s, nodes: fakeNodes(), config: {} }, { body: { document: doc, mode: 'new' } });
      const after = s.pipelines.get('conflict-1');
      assert.equal(after.name, '原有', `mode=new 不得覆盖既有条目，实际名称 ${after.name}`);
      // 应存在一个「被换 id 的新条目」，且导入确实发生了
      const list = s.pipelines.list();
      assert.ok(list.length >= 2, `mode=new 应新增条目而非覆盖，实际 ${JSON.stringify(list.map((p) => p.id))}`);
    } finally {
      await s.close();
    }
  });

  test('mode=overwrite：同 id 时覆盖既有数据', async () => {
    const s = await freshStore();
    try {
      await s.pipelines.put('conflict-2', samplePipeline({ id: 'conflict-2', name: '原有' }));
      const doc = {
        formatVersion: FORMAT_VERSION,
        kind: 'pipeline',
        pipeline: samplePipeline({ id: 'conflict-2', name: '导入替换' }),
      };
      const res = await importDocument({ store: s, nodes: fakeNodes(), config: {} }, { body: { document: doc, mode: 'overwrite' } });
      assert.ok(res, '必须返回结果');
      assert.equal(s.pipelines.get('conflict-2').name, '导入替换', 'mode=overwrite 必须覆盖');
    } finally {
      await s.close();
    }
  });

  test('★ 整体拒绝：一条非法不得留下半成品（原子性）', async () => {
    const s = await freshStore();
    try {
      const good = samplePipeline({ id: 'atomic-good', name: '合法' });
      const bad = samplePipeline({ id: 'atomic-bad', name: '非法' });
      bad.stages[0].jobs[0].node = 'nope.nope';
      await assert.rejects(
        () => importDocument(
          { store: s, nodes: fakeNodes(['shell.exec']), config: {} },
          {
            body: {
              document: { formatVersion: FORMAT_VERSION, kind: 'bundle', pipelines: [good, bad] },
              mode: 'new',
            },
          },
        ),
        /.*/,
        '含非法条目必须整体失败',
      );
      assert.equal(s.pipelines.get('atomic-good'), undefined, '整体失败时不得写入任何条目（半成品）');
    } finally {
      await s.close();
    }
  });

  test('导入结果报告 mode 与冲突/缺失信息', async () => {
    const s = await freshStore();
    try {
      const doc = {
        formatVersion: FORMAT_VERSION,
        kind: 'pipeline',
        pipeline: samplePipeline({ id: 'report-1', name: '报告' }),
      };
      const res = await importDocument({ store: s, nodes: fakeNodes(), config: {} }, { body: { document: doc, mode: 'new' } });
      assert.equal(res.mode, 'new', `结果应回带 mode，实际 ${JSON.stringify(res)}`);
    } finally {
      await s.close();
    }
  });

  test('导出的 bundle 可被自身导入（自洽性）', async () => {
    const s = await freshStore();
    const dst = await freshStore();
    try {
      await s.pipelines.put('self-1', samplePipeline({ id: 'self-1', name: '自洽' }));
      const doc = await exportDocument({ store: s, nodes: fakeNodes() }, { query: q({ kind: 'bundle' }) });
      // 导入到同一 store 的 overwrite 模式必须成功且不破坏数据
      await importDocument({ store: s, nodes: fakeNodes(), config: {} }, { body: { document: doc, mode: 'overwrite' } });
      assert.equal(s.pipelines.get('self-1').name, '自洽', '自身导入后数据必须仍然正确');
      // 导入到空 store 必须成功
      await importDocument({ store: dst, nodes: fakeNodes(), config: {} }, { body: { document: doc, mode: 'new' } });
      assert.ok(dst.pipelines.get('self-1'), '导出物应可导入到空 store');
    } finally {
      await s.close();
      await dst.close();
    }
  });
});
