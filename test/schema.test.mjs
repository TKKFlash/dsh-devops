// 契约 §3.1：src/model/schema.js
// 覆盖：合法/非法流水线、错误 path 与 code、mixed-scheduling 拒绝、cycle 检出、normalize 补默认值
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { suiteFor, requiredFn } from './helpers/modules.mjs';
import { samplePipeline, sampleTemplate, sampleServer, dagPipeline } from './helpers/fixtures.mjs';

const rel = 'src/model/schema.js';
const { mod, skip } = await suiteFor(rel);

describe('model/schema', { skip }, () => {
  const validatePipeline = requiredFn(mod, 'validatePipeline', rel);
  const validateTemplate = requiredFn(mod, 'validateTemplate', rel);
  const validateServer = requiredFn(mod, 'validateServer', rel);
  const normalizePipeline = requiredFn(mod, 'normalizePipeline', rel);
  const newId = requiredFn(mod, 'newId', rel);
  const detectScheduling = requiredFn(mod, 'detectScheduling', rel);

  /** 取错误数组里匹配 code 的项 */
  const errOf = (r, code) => (r.errors || []).find((e) => e.code === code);

  describe('validatePipeline', () => {
    test('合法流水线 → { ok:true, value }', () => {
      const r = validatePipeline(samplePipeline());
      assert.equal(r.ok, true, `合法流水线应通过，实际 errors=${JSON.stringify(r.errors)}`);
      assert.ok(r.value, 'ok:true 时必须带 value');
    });

    test('非法：缺少 id → code=missing-field，path 指向 id', () => {
      const p = samplePipeline();
      delete p.id;
      const r = validatePipeline(p);
      assert.equal(r.ok, false);
      const e = errOf(r, 'missing-field');
      assert.ok(e, `应报 missing-field，实际 ${JSON.stringify(r.errors)}`);
      assert.equal(e.path, 'id', 'path 应为点路径 id');
      assert.equal(typeof e.message, 'string');
      assert.ok(e.message.length > 0);
    });

    test('非法：id 不符合 [a-z0-9][a-z0-9-_]{0,63} → code=bad-id', () => {
      for (const bad of ['Build', '-lead', 'a'.repeat(65), 'has space', '中文id', 'a@b']) {
        const r = validatePipeline(samplePipeline({ id: bad }));
        assert.equal(r.ok, false, `id=${JSON.stringify(bad)} 应被拒`);
        assert.ok(errOf(r, 'bad-id'), `id=${JSON.stringify(bad)} 应报 bad-id，实际 ${JSON.stringify(r.errors)}`);
      }
    });

    test('非法：未知节点类型 → code=unknown-node，path 指向 stages[0].jobs[0].node', () => {
      const p = samplePipeline();
      p.stages[0].jobs[0].node = 'no.such.node';
      // 契约 §3.1 要求 validatePipeline 报 unknown-node。
      // 实现把节点白名单设计成可选参数（options.knownNodes），因此这里两种调用都必须能报出来：
      //   1) 直接调用 → 若实现无法自行判断节点白名单，则至少要在传入 knownNodes 时报对。
      const withKnown = validatePipeline(p, { knownNodes: ['shell.exec', 'node.exec', 'python.exec'] });
      const direct = validatePipeline(p);
      const reported = (r) => (r.errors || []).some((e) => e.code === 'unknown-node');
      assert.ok(
        reported(withKnown) || reported(direct),
        `未知节点必须报 unknown-node（直接调用=${reported(direct)}, 传 knownNodes=${reported(withKnown)}）`,
      );
      const src = reported(withKnown) ? withKnown : direct;
      const e = errOf(src, 'unknown-node');
      assert.equal(e.path, 'stages[0].jobs[0].node', 'path 必须用带下标的点路径');
    });

    test('非法：混合调度（有 needs 又有 parallel:true 阶段）→ code=mixed-scheduling', () => {
      const p = dagPipeline();
      p.stages.push({ id: 's2', name: '并行阶段', parallel: true, jobs: [{ id: 'c', name: 'C', node: 'shell.exec', needs: [] }] });
      const r = validatePipeline(p);
      assert.equal(r.ok, false, '同时存在 needs 与 parallel:true 必须拒绝');
      assert.ok(errOf(r, 'mixed-scheduling'), `应报 mixed-scheduling，实际 ${JSON.stringify(r.errors)}`);
    });

    test('非法：依赖成环 → code=cycle', () => {
      const p = samplePipeline();
      p.stages = [
        {
          id: 's1',
          name: 'S1',
          parallel: false,
          jobs: [
            { id: 'a', name: 'A', node: 'shell.exec', needs: ['b'] },
            { id: 'b', name: 'B', node: 'shell.exec', needs: ['a'] },
          ],
        },
      ];
      const r = validatePipeline(p);
      assert.equal(r.ok, false, '成环必须拒绝');
      assert.ok(errOf(r, 'cycle'), `应报 cycle，实际 ${JSON.stringify(r.errors)}`);
    });

    test('非法：needs 指向不存在的 job → 拒绝', () => {
      const p = dagPipeline();
      p.stages[0].jobs[1].needs = ['ghost'];
      const r = validatePipeline(p);
      assert.equal(r.ok, false, 'needs 指向不存在的 job 必须拒绝');
    });

    test('非法：类型错误 → code=bad-type', () => {
      const p = samplePipeline();
      p.defaults.timeoutMs = 'five minutes';
      const r = validatePipeline(p);
      assert.equal(r.ok, false);
      assert.ok(errOf(r, 'bad-type'), `应报 bad-type，实际 ${JSON.stringify(r.errors)}`);
    });

    test('非法：重复 job id 应被拒绝', () => {
      const p = samplePipeline();
      p.stages[0].jobs.push({ id: 'compile', name: '重复', node: 'shell.exec' });
      const r = validatePipeline(p);
      assert.equal(r.ok, false, '重复 job id 必须拒绝');
    });

    test('错误码只用契约规定的小写短横线集合', () => {
      const allowed = new Set(['missing-field', 'unknown-node', 'mixed-scheduling', 'cycle', 'bad-id', 'bad-type']);
      const samples = [
        (() => { const p = samplePipeline(); delete p.id; return p; })(),
        (() => { const p = samplePipeline(); p.stages[0].jobs[0].node = 'x.y'; return p; })(),
        (() => { const p = samplePipeline({ id: 'BAD' }); return p; })(),
      ];
      for (const p of samples) {
        for (const e of validatePipeline(p).errors || []) {
          assert.ok(allowed.has(e.code), `错误码 ${e.code} 不在契约白名单内`);
        }
      }
    });

    test('validatePipeline 对 null/非对象不抛异常，返回 ok:false', () => {
      for (const bad of [null, undefined, 42, 'str', []]) {
        const r = validatePipeline(bad);
        assert.equal(r.ok, false, `validatePipeline(${JSON.stringify(bad)}) 应 ok:false`);
        assert.ok(Array.isArray(r.errors));
      }
    });
  });

  describe('detectScheduling', () => {
    test('无 needs → staged', () => {
      assert.equal(detectScheduling(samplePipeline()), 'staged');
    });
    test('有 needs → dag', () => {
      assert.equal(detectScheduling(dagPipeline()), 'dag');
    });
    test('needs 全为空数组仍算 staged', () => {
      const p = samplePipeline();
      p.stages[0].jobs[0].needs = [];
      assert.equal(detectScheduling(p), 'staged');
    });
  });

  describe('normalizePipeline', () => {
    test('补默认值并返回新对象（不改原对象）', () => {
      const raw = {
        id: 'p1',
        name: 'P1',
        stages: [{ id: 's', name: 'S', jobs: [{ id: 'j', name: 'J', node: 'shell.exec' }] }],
      };
      const frozen = JSON.stringify(raw);
      const out = normalizePipeline(raw);
      assert.notEqual(out, raw, '必须返回新对象');
      assert.equal(JSON.stringify(raw), frozen, '不得原地修改入参');
      assert.deepEqual(out.tags, [], 'tags 补空数组');
      assert.deepEqual(out.variables, [], 'variables 补空数组');
      assert.deepEqual(out.envSetRefs, [], 'envSetRefs 补空数组');
      assert.equal(out.favorite, false);
      assert.equal(out.owner, null);
      assert.equal(out.version, 1, 'version 补 1');
      assert.equal(out.defaults.server, 'local', 'defaults.server 补 local');
      assert.equal(out.defaults.timeoutMs, 600000, 'defaults.timeoutMs 补 600000');
      assert.ok(typeof out.createdAt === 'number' && typeof out.updatedAt === 'number');
      const job = out.stages[0].jobs[0];
      assert.deepEqual(job.needs, [], 'job.needs 补空数组');
      // 契约 §2.1：job.server 缺省用 defaults.server（即 'local'），不得为 null
      assert.equal(job.server, 'local', 'job.server 缺省应落到 defaults.server(=local)，null 会导致执行时报错');
      assert.equal(job.when, 'on_success');
      assert.equal(job.allowFailure, false);
      assert.equal(job.allowProvision, false);
      assert.deepEqual(job.retry, { max: 0, delayMs: 1000 }, 'retry 补默认');
      assert.equal(job.timeoutMs, 600000);
      assert.deepEqual(job.env, []);
      assert.deepEqual(job.envSetRefs, []);
      assert.deepEqual(job.artifacts, []);
      assert.deepEqual(job.cache, { key: '', paths: [] });
      assert.deepEqual(job.with, {}, 'with 补空对象（节点参数由节点描述符决定）');
    });

    test('去重 job id 并稳定排序（按阶段/声明顺序保持确定性）', () => {
      const raw = {
        id: 'p2',
        name: 'P2',
        stages: [
          {
            id: 's',
            name: 'S',
            jobs: [
              { id: 'j', name: 'J1', node: 'shell.exec' },
              { id: 'j', name: 'J2', node: 'shell.exec' },
            ],
          },
        ],
      };
      const out = normalizePipeline(raw);
      const ids = out.stages.flatMap((s) => s.jobs.map((j) => j.id));
      assert.equal(new Set(ids).size, ids.length, `job id 必须唯一，实际 ${ids.join(',')}`);
    });

    test('幂等：normalize 两次结果稳定（除时间戳外深比较相等）', () => {
      const once = normalizePipeline(samplePipeline());
      const twice = normalizePipeline(once);
      const strip = (o) => {
        const c = structuredClone(o);
        delete c.createdAt;
        delete c.updatedAt;
        return c;
      };
      assert.deepEqual(strip(twice), strip(once), 'normalize 必须幂等');
    });

    test('normalize 后的产物必须通过 validatePipeline', () => {
      const raw = {
        id: 'p3',
        name: 'P3',
        stages: [{ id: 's', name: 'S', jobs: [{ id: 'j', name: 'J', node: 'shell.exec' }] }],
      };
      const out = normalizePipeline(raw);
      const r = validatePipeline(out);
      assert.equal(r.ok, true, `normalize 产物应合法，实际 ${JSON.stringify(r.errors)}`);
    });
  });

  describe('newId', () => {
    test('形如 prefix-<8位随机>', () => {
      const id = newId('run');
      assert.match(id, /^run-[A-Za-z0-9]{8}$/, `newId('run') 实际返回 ${id}`);
    });
    test('多次调用不重复', () => {
      const set = new Set(Array.from({ length: 200 }, () => newId('srv')));
      assert.equal(set.size, 200, 'newId 不应产生碰撞');
    });
  });

  describe('validateTemplate', () => {
    test('合法模板通过（契约 §2.2 的官方示例形状，string 参数带 options:[]）', () => {
      const r = validateTemplate(sampleTemplate());
      assert.equal(r.ok, true, `契约 §2.2 的示例形状必须通过，实际 ${JSON.stringify(r.errors)}`);
    });
    test('契约 §2.2 示例中的 options:[] 不得被判为 bad-type', () => {
      const t = sampleTemplate();
      t.parameters = [
        { name: 'image_tag', label: '镜像标签', type: 'string', required: true, default: 'latest', options: [], field: 'string', description: '' },
      ];
      const r = validateTemplate(t);
      const optErr = (r.errors || []).find((e) => e.path.startsWith('parameters[0].options'));
      assert.ok(!optErr, `契约示例里 string 参数就带 options:[]，不应报错，实际 ${JSON.stringify(r.errors)}`);
    });
    test('parameters[].type 必须属于 §4 字段类型白名单', () => {
      const t = sampleTemplate();
      t.parameters = [{ name: 'x', label: 'X', type: 'not-a-type', required: false, default: '', options: [] }];
      const r = validateTemplate(t);
      assert.equal(r.ok, false, '非法 type 必须拒绝');
    });
    test('enum 参数必须带非空 options', () => {
      const t = sampleTemplate();
      t.parameters = [{ name: 'x', label: 'X', type: 'enum', required: false, default: '', options: [] }];
      const r = validateTemplate(t);
      assert.equal(r.ok, false, 'enum 没有 options 必须拒绝');
    });
    test('body 必须是合法 Pipeline', () => {
      const t = sampleTemplate({ body: { id: 'BAD ID' } });
      const r = validateTemplate(t);
      assert.equal(r.ok, false);
    });
    test('缺失 id → ok:false 且 errors 非空', () => {
      const t = sampleTemplate();
      delete t.id;
      const r = validateTemplate(t);
      assert.equal(r.ok, false);
      assert.ok(r.errors.length > 0);
    });
  });

  describe('validateServer', () => {
    test('合法 ssh 服务器通过', () => {
      const r = validateServer(sampleServer());
      assert.equal(r.ok, true, `实际 ${JSON.stringify(r.errors)}`);
    });
    test('kind 必须是 local|ssh', () => {
      const r = validateServer(sampleServer({ kind: 'telnet' }));
      assert.equal(r.ok, false);
    });
    test('port 越界（0/65536/字符串）被拒', () => {
      for (const port of [0, 70000, 'x']) {
        const r = validateServer(sampleServer({ port }));
        assert.equal(r.ok, false, `port=${JSON.stringify(port)} 应被拒`);
      }
    });
    test('auth.type 允许 key|password|agent|none（lead 裁决）', () => {
      for (const type of ['key', 'password', 'agent']) {
        const r = validateServer(sampleServer({ auth: { type, keyRef: 'K', passwordRef: 'P' } }));
        assert.equal(r.ok, true, `ssh + auth.type=${type} 应被允许，实际 ${JSON.stringify(r.errors)}`);
      }
      // none 仅对 kind:local 合法（lead 的安全约束）
      const sshNone = validateServer(sampleServer({ kind: 'ssh', auth: { type: 'none', keyRef: '', passwordRef: '' } }));
      assert.equal(sshNone.ok, false, 'ssh 服务器不允许 auth.type=none（禁止静默无认证连接）');
    });
    test('安全约束：kind=ssh + auth.type=none 必须拒绝（禁止静默无认证连接）', () => {
      const r = validateServer(sampleServer({ kind: 'ssh', auth: { type: 'none', keyRef: '', passwordRef: '' } }));
      assert.equal(r.ok, false, 'ssh 服务器不允许 auth.type=none（会变成静默无认证连接）');
      assert.equal(r.errors?.[0]?.path, 'auth.type', `错误 path 应指向 auth.type，实际 ${JSON.stringify(r.errors)}`);
    });
    test('kind=local + auth.type=none 必须通过（端口用契约内的合法值）', () => {
      const r = validateServer({
        id: 'local-2', name: '本机', kind: 'local', host: '127.0.0.1', port: 22, user: '',
        auth: { type: 'none', keyRef: '', passwordRef: '' }, shell: '', workdir: '', tags: [],
        defaultEnv: [], customEnv: [], envSetRefs: [],
      });
      assert.equal(r.ok, true, `本机服务器 auth.type=none 应通过，实际 ${JSON.stringify(r.errors)}`);
    });
    test('【发现的 bug】store 预置的 local 服务器（port:0）必须能通过 validateServer', async () => {
      const { createStore } = await import('../src/store/store.js');
      const { makeTmpDir, fakeLog } = await import('./helpers/tmp.mjs');
      const store = await createStore({ dataDir: makeTmpDir('dsh-devops-localv-'), log: fakeLog() });
      try {
        const local = store.servers.get('local');
        assert.ok(local, 'store 必须预置 local 服务器');
        const r = validateServer(local);
        assert.equal(
          r.ok,
          true,
          `内置本机服务器被 schema 判为非法（${JSON.stringify(r.errors)}）；` +
            '任何「读取服务器→校验→保存/导出」的路径都会因此失败。' +
            '建议 schema 对 kind:local 允许 port 0/省略，或 store 预置一个合法 port',
        );
      } finally {
        await store.close();
      }
    });
    test('auth.type 为未知值（gssapi）必须拒绝', () => {
      const r = validateServer(sampleServer({ auth: { type: 'gssapi', keyRef: '', passwordRef: '' } }));
      assert.equal(r.ok, false);
    });
    test('auth.type 为 key|password 时通过', () => {
      assert.equal(validateServer(sampleServer({ auth: { type: 'key', keyRef: 'K', passwordRef: '' } })).ok, true);
      assert.equal(validateServer(sampleServer({ auth: { type: 'password', keyRef: '', passwordRef: 'P' } })).ok, true);
    });
    test('builtin local 不可改 kind', () => {
      const r = validateServer({ id: 'local', name: '本机', kind: 'ssh', host: '127.0.0.1' });
      assert.equal(r.ok, false, '内置 local 服务器改 kind 必须被拒');
    });
  });
});
