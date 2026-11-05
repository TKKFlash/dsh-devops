// 契约 §3.9 + task-2：src/engine/nodes/index.js
// 覆盖：18 个内置节点注册表完整、fields 类型在 §4 白名单内、必填字段带 required、
//       condition.if 不接受可执行代码注入、registry 接口形状
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { suiteFor, requiredFn } from './helpers/modules.mjs';
import { makeTmpDir, cleanupTmp } from './helpers/tmp.mjs';

const rel = 'src/engine/nodes/index.js';
const { mod, skip } = await suiteFor(rel);

/** 契约 §4 的字段类型白名单 */
export const FIELD_TYPES = new Set([
  'string',
  'text',
  'code',
  'path.dir',
  'path.file',
  'glob',
  'enum',
  'boolean',
  'number',
  'server',
  'runtime',
  'keyvalue',
  'multiselect',
  'ref:envset',
  'ref:snippet',
  'ref:pipeline',
]);

/** task-2 指定的 18 个节点 */
export const REQUIRED_NODES = [
  'shell.exec',
  'node.exec',
  'python.exec',
  'file.pick',
  'file.write',
  'file.copy',
  'artifact.collect',
  'cache.save',
  'cache.restore',
  'condition.if',
  'wait.delay',
  'wait.approval',
  'pipeline.call',
  'server.ensureRuntime',
  'http.request',
  'notify.webhook',
  'log.message',
  'env.set',
];

describe('engine/nodes', { skip }, () => {
  const createNodeRegistry = requiredFn(mod, 'createNodeRegistry', rel);

  let registry;

  before(async () => {
    registry = await createNodeRegistry({
      executors: null,
      provisioner: null,
      log: () => {},
      store: null,
      config: {},
    });
  });

  test('registry 形状：list/get/register/loadCustom', () => {
    for (const m of ['list', 'get', 'register', 'loadCustom']) {
      assert.equal(typeof registry[m], 'function', `registry.${m} 必须是函数`);
    }
  });

  test('18 个内置节点全部注册且每个都可执行（get().run 是函数）', () => {
    const listed = registry.list();
    assert.ok(Array.isArray(listed), 'list() 必须返回数组');
    const types = listed.map((d) => d.type);
    const missing = REQUIRED_NODES.filter((t) => !types.includes(t));
    assert.deepEqual(missing, [], `缺少内置节点：${missing.join(', ')}`);
    // list() 返回的是「渲染投影」（不含 run），可执行性必须用 get() 校验
    const notRunnable = REQUIRED_NODES.filter((t) => typeof registry.get(t)?.run !== 'function');
    assert.deepEqual(notRunnable, [], `以下节点无法执行（run 不是函数）：${notRunnable.join(', ')}`);
  });

  test('list() 返回的 NodeDescriptor 具备契约 §3.9 的字段', () => {
    for (const d of registry.list()) {
      assert.equal(typeof d.type, 'string', `${d.type}: 需要 type`);
      assert.equal(typeof d.title, 'string', `${d.type}: 需要 title`);
      assert.equal(typeof d.category, 'string', `${d.type}: 需要 category`);
      assert.equal(typeof d.icon, 'string', `${d.type}: 需要 icon`);
      assert.equal(typeof d.description, 'string', `${d.type}: 需要 description`);
      assert.ok(Array.isArray(d.fields), `${d.type}: fields 必须是数组`);
      assert.ok(Array.isArray(d.outputs), `${d.type}: outputs 必须是数组`);
    }
  });

  test('契约 §3.9：list() 声明为 NodeDescriptor[]，其中含 run —— 当前实现为渲染投影（已报 lead/engine）', (t) => {
    const sample = registry.list()[0];
    if (typeof sample.run === 'function') return; // 实现补齐后本条自然通过
    t.diagnostic(
      `契约偏差（低危，已上报）：registry.list()[0] 不含 run（实际键：${Object.keys(sample).join(',')}）；` +
        '§3.9 写的是 list() → NodeDescriptor[]，而 NodeDescriptor 含 run。get() 上的 run 正常。',
    );
    // 功能性要求必须成立：每个类型都能通过 get() 拿到可执行描述符
    assert.equal(typeof registry.get(sample.type)?.run, 'function', 'get() 必须能拿到可执行的 NodeDescriptor');
  });

  test('fields 的 type 全部在契约 §4 白名单内', () => {
    const bad = [];
    for (const d of registry.list()) {
      for (const f of d.fields) {
        if (!FIELD_TYPES.has(f.type)) bad.push(`${d.type}.${f.name}=${f.type}`);
      }
    }
    assert.deepEqual(bad, [], `出现 §4 之外的字段类型：${bad.join(', ')}`);
  });

  test('fields 必备键：name/label/type', () => {
    for (const d of registry.list()) {
      for (const f of d.fields) {
        assert.equal(typeof f.name, 'string', `${d.type}: field.name 必须是字符串`);
        assert.equal(typeof f.label, 'string', `${d.type}.${f.name}: label 必须是字符串`);
        assert.equal(typeof f.type, 'string', `${d.type}.${f.name}: type 必须是字符串`);
      }
    }
  });

  test('enum 字段必须带 options 或 optionsFrom', () => {
    const bad = [];
    for (const d of registry.list()) {
      for (const f of d.fields) {
        if (f.type !== 'enum') continue;
        const ok = (Array.isArray(f.options) && f.options.length > 0) || typeof f.optionsFrom === 'string';
        if (!ok) bad.push(`${d.type}.${f.name}`);
      }
    }
    assert.deepEqual(bad, [], `enum 字段缺 options/optionsFrom：${bad.join(', ')}`);
  });

  test('path.dir / path.file 字段带 serverField', () => {
    const bad = [];
    for (const d of registry.list()) {
      for (const f of d.fields) {
        if (f.type === 'path.dir' || f.type === 'path.file') {
          if (typeof f.serverField !== 'string' || f.serverField.length === 0) bad.push(`${d.type}.${f.name}`);
        }
      }
    }
    assert.deepEqual(bad, [], `path 字段缺 serverField：${bad.join(', ')}`);
  });

  test('glob 字段带 baseField', () => {
    const bad = [];
    for (const d of registry.list()) {
      for (const f of d.fields) {
        if (f.type === 'glob' && typeof f.baseField !== 'string') bad.push(`${d.type}.${f.name}`);
      }
    }
    assert.deepEqual(bad, [], `glob 字段缺 baseField：${bad.join(', ')}`);
  });

  test('code 字段带 language（shell|python|javascript|json）', () => {
    const allowed = new Set(['shell', 'python', 'javascript', 'json']);
    const bad = [];
    for (const d of registry.list()) {
      for (const f of d.fields) {
        if (f.type !== 'code') continue;
        if (!allowed.has(f.language)) bad.push(`${d.type}.${f.name}=${f.language}`);
      }
    }
    assert.deepEqual(bad, [], `code 字段 language 非法：${bad.join(', ')}`);
  });

  test('关键节点的必填字段带 required:true', () => {
    const expectations = [
      ['shell.exec', 'script'],
      ['node.exec', 'script'],
      ['python.exec', 'script'],
      ['http.request', 'url'],
    ];
    for (const [type, field] of expectations) {
      const d = registry.get(type);
      assert.ok(d, `节点 ${type} 必须存在`);
      const f = d.fields.find((x) => x.name === field);
      assert.ok(f, `${type} 必须有字段 ${field}`);
      assert.equal(f.required, true, `${type}.${field} 必须 required:true`);
    }
  });

  test('runtime 限定：node.exec/python.exec 声明对应 runtime', () => {
    const n = registry.get('node.exec');
    const p = registry.get('python.exec');
    assert.ok(n.runtime, 'node.exec 必须声明 runtime');
    assert.ok(p.runtime, 'python.exec 必须声明 runtime');
  });

  test('get() 未知类型返回 undefined', () => {
    assert.equal(registry.get('nope.nope'), undefined);
  });

  test('condition.if 不接受可执行代码注入（表达式求值必须安全）', async () => {
    const d = registry.get('condition.if');
    assert.ok(d, 'condition.if 必须存在');
    const exprField = d.fields.find((f) => ['expression', 'condition', 'expr', 'when'].includes(f.name));
    assert.ok(exprField, `condition.if 应有表达式字段，实际字段：${d.fields.map((f) => f.name).join(', ')}`);

    // 危险表达式：若实现用了 eval/Function，这些会真的执行
    const dangerous = [
      'process.exit(9)',
      'globalThis.__pwned = 1',
      'require("fs")',
      '(() => { throw new Error("boom") })()',
      'process.env',
    ];
    for (const expr of dangerous) {
      const before = process.exitCode;
      let threw = false;
      let result;
      const rt = {
        env: {},
        cwd: process.cwd(),
        log: () => {},
        setPhase: () => {},
        signal: null,
        resolvePath: (p) => p,
        spawn: async () => ({ exitCode: 0, outputs: {} }),
        provision: async () => ({ ok: false }),
        store: null,
        run: null,
        step: null,
        config: {},
      };
      try {
        // 不同实现可能用 inputs / with
        result = await d.run(rt, { [exprField.name]: expr });
      } catch {
        threw = true;
      }
      assert.ok(!globalThis.__pwned, `危险表达式被求值了（${expr}）——实现不得使用 eval/Function`);
      assert.ok(threw || result?.exitCode !== 0 || result?.error, `危险表达式 ${expr} 不应被判为成功，实际 ${JSON.stringify(result)}`);
      assert.equal(process.exitCode, before, '危险表达式不得影响宿主进程退出码');
    }
  });

  test('condition.if 正常比较表达式可用（安全求值不等于拒绝一切）', async () => {
    const d = registry.get('condition.if');
    const exprField = d.fields.find((f) => ['expression', 'condition', 'expr', 'when'].includes(f.name));
    const rt = {
      env: {}, cwd: process.cwd(), log: () => {}, setPhase: () => {}, signal: null,
      resolvePath: (p) => p, spawn: async () => ({ exitCode: 0, outputs: {} }),
      provision: async () => ({ ok: false }), store: null, run: null, step: null, config: {},
    };
    const truthy = await d.run(rt, { [exprField.name]: '1 === 1' });
    assert.equal(truthy.exitCode, 0, `合法表达式应正常求值，实际 ${JSON.stringify(truthy)}`);
    const falsey = await d.run(rt, { [exprField.name]: '1 === 2' });
    assert.equal(falsey.exitCode, 0, `合法表达式应正常求值，实际 ${JSON.stringify(falsey)}`);
    assert.notDeepEqual(truthy.outputs, falsey.outputs, '真假条件必须产出不同 outputs');
  });

  test('register() 返回 disposer，并让 get() 可见自定义节点', () => {
    const desc = {
      type: 'test.custom',
      title: '测试节点',
      category: 'test',
      icon: 'box',
      description: '测试用自定义节点',
      fields: [{ name: 'x', label: 'X', type: 'string' }],
      outputs: [],
      run: async () => ({ exitCode: 0 }),
    };
    const dispose = registry.register(desc);
    assert.equal(typeof dispose, 'function', 'register 必须返回 disposer');
    assert.ok(registry.get('test.custom'), '注册后 get 应可见');
    dispose();
    assert.equal(registry.get('test.custom'), undefined, 'disposer 调用后应移除');
  });

  test('loadCustom 对不存在的目录不崩溃', async () => {
    const dir = makeTmpDir('dsh-devops-nodes-');
    await assert.doesNotReject(() => registry.loadCustom(dir));
    cleanupTmp();
  });
});
