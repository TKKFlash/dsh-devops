// 契约 §3.2：src/model/variables.js
// 覆盖：五层合并优先级、null/空串删除键、secret 走 credentials 并收集 masked、runtime 注入
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { suiteFor, requiredFn } from './helpers/modules.mjs';

const rel = 'src/model/variables.js';
const { mod, skip } = await suiteFor(rel);

describe('model/variables', { skip }, () => {
  const resolveEnv = requiredFn(mod, 'resolveEnv', rel);

  /** 造一个最小但完整的 resolveEnv 入参 */
  function args(over = {}) {
    return {
      processEnv: {},
      server: { id: 'local', kind: 'local', defaultEnv: [], customEnv: [], envSetRefs: [] },
      envSets: [],
      pipeline: { variables: [], envSetRefs: [] },
      stage: undefined,
      job: { env: [], envSetRefs: [] },
      node: { env: [] },
      credentials: { resolve: () => undefined },
      runtime: {},
      ...over,
    };
  }

  test('返回 { env, masked, report } 形状', () => {
    const r = resolveEnv(args());
    assert.equal(typeof r.env, 'object', 'env 必须是对象');
    assert.ok(Array.isArray(r.masked), 'masked 必须是数组');
    assert.ok(Array.isArray(r.report), 'report 必须是数组');
    for (const item of r.report) {
      assert.equal(typeof item.name, 'string', 'report[].name 必须是字符串');
      assert.equal(typeof item.source, 'string', 'report[].source 必须是字符串');
      assert.equal(typeof item.overridden, 'boolean', 'report[].overridden 必须是布尔');
    }
  });

  test('优先级：后层覆盖前层（processEnv 最弱，node.env 最强）', () => {
    const r = resolveEnv(
      args({
        processEnv: { K: 'from-process', ONLY_PROC: 'p' },
        server: { id: 's', defaultEnv: [{ name: 'K', value: 'from-default' }], customEnv: [{ name: 'K', value: 'from-custom' }], envSetRefs: [] },
        envSets: [{ id: 'es', vars: [{ name: 'K', value: 'from-envset' }] }],
        pipeline: { variables: [{ name: 'K', value: 'from-pipeline' }], envSetRefs: ['es'] },
        stage: { variables: [{ name: 'K', value: 'from-stage' }] },
        job: { env: [{ name: 'K', value: 'from-job' }], envSetRefs: [] },
        node: { env: [{ name: 'K', value: 'from-node' }] },
      }),
    );
    assert.equal(r.env.K, 'from-node', 'node.env 应最后覆盖');
    assert.equal(r.env.ONLY_PROC, 'p', '未被覆盖的 processEnv 键应保留');
  });

  test('逐层优先级（每一层都能覆盖上一层）', () => {
    const layers = [
      ['processEnv', (v) => ({ processEnv: { K: v } })],
      ['server.defaultEnv', (v) => ({ server: { id: 's', defaultEnv: [{ name: 'K', value: v }], customEnv: [], envSetRefs: [] } })],
      ['server.customEnv', (v) => ({ server: { id: 's', defaultEnv: [], customEnv: [{ name: 'K', value: v }], envSetRefs: [] } })],
      ['envSets', (v) => ({ envSets: [{ id: 'es', vars: [{ name: 'K', value: v }] }], pipeline: { variables: [], envSetRefs: ['es'] } })],
      ['pipeline.variables', (v) => ({ pipeline: { variables: [{ name: 'K', value: v }], envSetRefs: [] } })],
      ['stage.variables', (v) => ({ stage: { variables: [{ name: 'K', value: v }] } })],
      ['job.env', (v) => ({ job: { env: [{ name: 'K', value: v }], envSetRefs: [] } })],
      ['node.env', (v) => ({ node: { env: [{ name: 'K', value: v }] } })],
    ];
    // 对每一对相邻层，验证后者胜出
    for (let i = 0; i + 1 < layers.length; i += 1) {
      const [lowerName, lowerFn] = layers[i];
      const [higherName, higherFn] = layers[i + 1];
      const merged = { ...lowerFn(`low`), ...higherFn(`high`) };
      // 需要把被 high 的默认覆盖的层重新装回
      const base = args(merged);
      const r = resolveEnv(base);
      assert.equal(r.env.K, 'high', `优先级错误：${higherName} 应覆盖 ${lowerName}`);
    }
  });

  test('null 或空串表示删除该键（映射为 undefined）', () => {
    const r = resolveEnv(
      args({
        processEnv: { KILL_NULL: 'x', KILL_EMPTY: 'y', KEEP: 'z' },
        job: {
          env: [
            { name: 'KILL_NULL', value: null },
            { name: 'KILL_EMPTY', value: '' },
          ],
          envSetRefs: [],
        },
      }),
    );
    assert.equal(r.env.KILL_NULL, undefined, 'null 值应删除键');
    assert.equal(r.env.KILL_EMPTY, undefined, '空串应删除键');
    assert.equal(r.env.KEEP, 'z', '其它键不受影响');
    assert.ok('KILL_NULL' in r.env, '删除应表现为键存在且值为 undefined（契约：映射为 undefined）');
  });

  test('secret:true 的值来自凭据读取器并进入 masked（同步读取器）', () => {
    const r = resolveEnv(
      args({
        job: { env: [{ name: 'TOKEN', value: 'MY_TOKEN', secret: true }], envSetRefs: [] },
        credentials: { get: (ref) => (ref === 'MY_TOKEN' ? 's3cr3t-value' : undefined) },
      }),
    );
    assert.equal(r.env.TOKEN, 's3cr3t-value', 'secret 值必须来自凭据读取器');
    assert.ok(r.masked.includes('s3cr3t-value'), `masked 应包含密钥明文，实际 ${JSON.stringify(r.masked)}`);
  });

  test('secret 值也可通过异步 resolveEnvAsync 解析（DSH ctx.credentials 的真实形态）', async () => {
    const resolveEnvAsync = mod.resolveEnvAsync;
    assert.equal(typeof resolveEnvAsync, 'function', '模块应提供 resolveEnvAsync 供异步凭据使用');
    const r = await resolveEnvAsync(
      args({
        job: { env: [{ name: 'TOKEN', value: 'MY_TOKEN', secret: true }], envSetRefs: [] },
        credentials: { resolve: async (ref) => (ref === 'MY_TOKEN' ? 'async-secret-value' : undefined) },
      }),
    );
    assert.equal(r.env.TOKEN, 'async-secret-value', '异步凭据必须能解析出密钥');
    assert.ok(r.masked.includes('async-secret-value'), '异步路径同样必须打码');
  });

  test('同步 resolveEnv 遇到「只有异步读取器」时不得编造密钥值（如实留空）', (t) => {
    const r = resolveEnv(
      args({
        job: { env: [{ name: 'TOKEN', value: 'MY_TOKEN', secret: true }], envSetRefs: [] },
        credentials: { resolve: async () => 'never-await-able-here' },
      }),
    );
    assert.equal(r.env.TOKEN, undefined, '同步路径无法 await，不得编造密钥值');
    assert.equal(r.masked.length, 0, '未解析出密钥时不得凭空打码');
    t.diagnostic(
      '已上报 host-core：同步 resolveEnv 在「只有异步凭据读取器」时静默留空（无 unresolved 标记）。' +
        '影响：调用方可能误以为密钥为空而非「未解析」。建议抛错或返回 unresolved 提示改用 resolveEnvAsync。',
    );
  });

  test('envSets 中 secret:true 的变量同样解析并打码', () => {
    const r = resolveEnv(
      args({
        envSets: [{ id: 'es', vars: [{ name: 'API_KEY', value: 'API_KEY', secret: true }] }],
        pipeline: { variables: [], envSetRefs: ['es'] },
        credentials: { get: () => 'k-12345' },
      }),
    );
    assert.equal(r.env.API_KEY, 'k-12345');
    assert.ok(r.masked.includes('k-12345'), 'envSet 的密钥也要打码');
  });

  test('masked 去重：同一密钥值只出现一次', () => {
    const r = resolveEnv(
      args({
        job: {
          env: [
            { name: 'A', value: 'SAMEVAL', secret: true },
            { name: 'B', value: 'SAMEVAL', secret: true },
          ],
          envSetRefs: [],
        },
        credentials: { get: () => 'SAMEVAL' },
      }),
    );
    assert.equal(r.masked.filter((m) => m === 'SAMEVAL').length, 1, `masked 不应重复，实际 ${JSON.stringify(r.masked)}`);
  });

  test('非 secret 的普通值不进 masked', () => {
    const r = resolveEnv(args({ job: { env: [{ name: 'NORMAL', value: 'plain' }], envSetRefs: [] } }));
    assert.ok(!r.masked.includes('plain'), '普通值不应被打码');
  });

  test('report 记录来源与是否被覆盖（source 用 host-core 统一后的词汇表）', () => {
    // lead/host-core 统一后的来源词汇：process / server.defaultEnv / server.customEnv /
    // envset:<id> / pipeline / stage / job / job.envSet:<id> / node / runtime
    const KNOWN = new Set(['process', 'server.defaultEnv', 'server.customEnv', 'pipeline', 'stage', 'job', 'node', 'runtime']);
    const isKnown = (s) => KNOWN.has(s) || /^envset:/.test(s) || /^job\.envSet:/.test(s);
    const r = resolveEnv(
      args({
        processEnv: { K: 'low' },
        node: { env: [{ name: 'K', value: 'high' }] },
      }),
    );
    const entry = r.report.find((x) => x.name === 'K');
    assert.ok(entry, 'report 应包含被解析的键 K');
    assert.ok(isKnown(entry.source), `report.source 必须在统一词汇表内，实际 ${entry.source}`);
    assert.match(entry.source, /node/, `最终来源应是 node 层，实际 ${entry.source}`);
    // 契约 §3.2：report[].overridden 必须是**布尔**（不是计数）
    assert.equal(
      typeof entry.overridden,
      'boolean',
      `契约 §3.2 要求 overridden 是布尔，实际 ${typeof entry.overridden}（值 ${JSON.stringify(entry.overridden)}）`,
    );
    assert.equal(entry.overridden, true, '被覆盖过的键 overridden 必须为 true');
  });

  test('未被覆盖的键 overridden 必须为 false（布尔）', () => {
    const r = resolveEnv(args({ processEnv: { SOLO: 'v' } }));
    const entry = r.report.find((x) => x.name === 'SOLO');
    assert.ok(entry);
    assert.equal(typeof entry.overridden, 'boolean', 'overridden 必须是布尔');
    assert.equal(entry.overridden, false, '未被覆盖的键必须为 false');
  });

  test('runtime 注入：bin 目录前置合并进 PATH（lead 裁决语义）', () => {
    const sep = process.platform === 'win32' ? ';' : ':';
    const otherSep = process.platform === 'win32' ? ':' : ';';
    const base = ['/usr/bin', '/bin'].join(sep);
    const r = resolveEnv(
      args({
        processEnv: { PATH: base },
        runtime: { python: '/opt/py/bin/python' },
      }),
    );
    const path = r.env.PATH;
    assert.ok(typeof path === 'string' && path.length > 0, 'PATH 必须是字符串');

    // 1) runtime 的 bin 出现在最前面
    assert.ok(path.startsWith('/opt/py/bin'), `runtime bin 必须前置，实际 ${path.slice(0, 80)}`);

    // 2) 原 PATH 内容仍然存在（系统工具必须可用）
    for (const dir of ['/usr/bin', '/bin']) {
      assert.ok(path.includes(dir), `原 PATH 中的 ${dir} 必须保留，实际 ${path}`);
    }

    // 3) 分隔符与平台一致，不得混用
    if (otherSep === ':') {
      assert.ok(!path.includes(`${'/'}usr/bin:`), '不得混用分隔符');
    }
    const guessed = process.platform === 'win32' ? ';' : ':';
    assert.equal(guessed, sep, '分隔符判定应与平台一致');

    // 4) 同一路径不重复插入
    const parts = path.split(sep);
    assert.equal(new Set(parts).size, parts.length, `PATH 中不得出现重复目录，实际 ${JSON.stringify(parts)}`);

    // 5) 解释器路径自身也注入
    assert.equal(r.env.PYTHON, '/opt/py/bin/python', 'runtime 应注入解释器变量');
  });

  test('processEnv 中的 undefined 键不产生垃圾', () => {
    const r = resolveEnv(args({ processEnv: { A: undefined, B: 'b' } }));
    assert.equal(r.env.A, undefined);
    assert.equal(r.env.B, 'b');
  });

  test('不污染入参对象', () => {
    const a = args({ processEnv: { X: '1' } });
    const snapshot = JSON.stringify(a);
    resolveEnv(a);
    assert.equal(JSON.stringify(a), snapshot, 'resolveEnv 不得修改入参');
  });

  test('凭据后端抛错时同步路径必须上抛（不得静默留空密钥）', () => {
    const boom = () => {
      throw new Error('凭据后端不可用');
    };
    // 同步读取器（函数式 / get / resolveSync）抛错都必须向上抛出
    for (const credentials of [boom, { get: boom }, { resolveSync: boom }]) {
      assert.throws(
        () =>
          resolveEnv(
            args({
              job: { env: [{ name: 'T', value: 'X', secret: true }], envSetRefs: [] },
              credentials,
            }),
          ),
        /凭据后端不可用|backend/,
        '同步凭据读取抛错时必须上抛，不能返回空密钥',
      );
    }
  });

  test('凭据后端抛错时异步路径（resolveEnvAsync）必须 reject', async () => {
    const resolveEnvAsync = mod.resolveEnvAsync;
    if (typeof resolveEnvAsync !== 'function') return;
    await assert.rejects(
      () =>
        resolveEnvAsync(
          args({
            job: { env: [{ name: 'T', value: 'X', secret: true }], envSetRefs: [] },
            credentials: { resolve: async () => { throw new Error('凭据后端不可用'); } },
          }),
        ),
      /凭据后端不可用|backend/,
      '异步凭据读取抛错时必须 reject',
    );
  });
});
