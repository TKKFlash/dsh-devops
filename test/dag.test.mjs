// 契约 §2.1 调度语义 + task-2：src/engine/dag.js
// 实际 API 形状（读实现后对齐，非猜测）：
//   buildGraph(pipeline) → { mode, jobs, order, levels, stagePlan, errors }
//   topoOrder(input) → string[]
//   detectCycle(input) → { cyclic:boolean, cycle:string[] }
//   readySet({ graph, steps, skipped?, decision?, running? }) → string[]
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { suiteFor, requiredFn } from './helpers/modules.mjs';

const rel = 'src/engine/dag.js';
const { mod, skip } = await suiteFor(rel);

describe('engine/dag', { skip }, () => {
  const buildGraph = requiredFn(mod, 'buildGraph', rel);
  const topoOrder = requiredFn(mod, 'topoOrder', rel);
  const detectCycle = requiredFn(mod, 'detectCycle', rel);
  const readySet = requiredFn(mod, 'readySet', rel);

  const mk = (jobs, over = {}) => ({
    id: 'p',
    name: 'P',
    stages: [{ id: 's', name: 'S', parallel: false, jobs }],
    ...over,
  });
  const dagPipe = mk([
    { id: 'a', node: 'shell.exec' },
    { id: 'b', node: 'shell.exec', needs: ['a'] },
    { id: 'c', node: 'shell.exec', needs: ['a'] },
    { id: 'd', node: 'shell.exec', needs: ['b', 'c'] },
  ]);
  /** 便捷构造 steps */
  const steps = (map) => Object.fromEntries(Object.entries(map).map(([id, status]) => [id, { id, status }]));

  test('buildGraph 返回图对象：jobs/order/levels/stagePlan/mode', () => {
    const g = buildGraph(dagPipe);
    assert.ok(g && typeof g === 'object', 'buildGraph 必须返回对象');
    assert.ok(g.jobs && typeof g.jobs === 'object', 'graph.jobs 必须存在');
    assert.ok(Array.isArray(g.order), 'graph.order 必须是数组');
    assert.ok(Array.isArray(g.levels), 'graph.levels 必须是数组');
    assert.ok(Array.isArray(g.stagePlan), 'graph.stagePlan 必须是数组');
    assert.equal(g.mode, 'dag', '存在 needs 时 mode 必须是 dag');
    for (const id of ['a', 'b', 'c', 'd']) {
      assert.ok(g.jobs[id], `graph.jobs 必须含 ${id}`);
      assert.ok(Array.isArray(g.jobs[id].needs), `jobs.${id}.needs 必须是数组`);
      assert.ok(Array.isArray(g.jobs[id].dependents), `jobs.${id}.dependents 必须是数组`);
    }
    assert.deepEqual(g.jobs.b.needs, ['a'], 'b 依赖 a');
    assert.ok(g.jobs.a.dependents.includes('b') && g.jobs.a.dependents.includes('c'), 'a 的下游应含 b/c');
  });

  test('无 needs → mode=staged（不建 DAG）', () => {
    const g = buildGraph(mk([{ id: 'a', node: 'shell.exec' }, { id: 'b', node: 'shell.exec' }]));
    assert.equal(g.mode, 'staged');
    assert.deepEqual(g.errors, [], 'staged 模式不应有错误');
  });

  test('needs + parallel:true → mode=invalid 且报 mixed-scheduling', () => {
    const p = mk([{ id: 'a', node: 'shell.exec' }, { id: 'b', node: 'shell.exec', needs: ['a'] }]);
    p.stages.push({ id: 's2', name: 'S2', parallel: true, jobs: [{ id: 'c', node: 'shell.exec' }] });
    const g = buildGraph(p);
    assert.equal(g.mode, 'invalid', '混合调度必须判为 invalid');
    assert.ok(g.errors.some((e) => e.code === 'mixed-scheduling'), `应报 mixed-scheduling，实际 ${JSON.stringify(g.errors)}`);
  });

  test('needs 指向不存在的 job → 报 unknown-dependency', () => {
    const g = buildGraph(mk([{ id: 'a', node: 'shell.exec', needs: ['ghost'] }]));
    assert.ok(g.errors.some((e) => e.code === 'unknown-dependency'), `实际 ${JSON.stringify(g.errors)}`);
  });

  test('topoOrder 满足依赖在前', () => {
    const order = topoOrder(dagPipe);
    assert.deepEqual(order, ['a', 'b', 'c', 'd'], `实际 ${JSON.stringify(order)}`);
    const idx = (id) => order.indexOf(id);
    assert.ok(idx('a') < idx('b') && idx('a') < idx('c'), 'a 必须先于 b/c');
    assert.ok(idx('b') < idx('d') && idx('c') < idx('d'), 'b/c 必须先于 d');
  });

  test('topoLevels 分层正确（可并行的在同一层）', () => {
    const g = buildGraph(dagPipe);
    assert.deepEqual(g.levels, [['a'], ['b', 'c'], ['d']], `实际 ${JSON.stringify(g.levels)}`);
  });

  test('detectCycle 对无环图 → cyclic:false', () => {
    const r = detectCycle(dagPipe);
    assert.equal(r.cyclic, false, '无环图 cyclic 必须为 false');
    assert.deepEqual(r.cycle, [], 'cycle 必须为空数组');
  });

  test('detectCycle 对成环图 → cyclic:true 且给出完整环路径', () => {
    const cyclic = mk([
      { id: 'x', node: 'shell.exec', needs: ['z'] },
      { id: 'y', node: 'shell.exec', needs: ['x'] },
      { id: 'z', node: 'shell.exec', needs: ['y'] },
    ]);
    const r = detectCycle(cyclic);
    assert.equal(r.cyclic, true, '成环图 cyclic 必须为 true');
    assert.ok(Array.isArray(r.cycle) && r.cycle.length > 0, `cycle 必须是非空数组，实际 ${JSON.stringify(r.cycle)}`);
    for (const id of ['x', 'y', 'z']) {
      assert.ok(r.cycle.includes(id), `环路径应包含 ${id}，实际 ${JSON.stringify(r.cycle)}`);
    }
    // 首尾相接表示闭环
    assert.equal(r.cycle[0], r.cycle[r.cycle.length - 1], `环路径应首尾相接，实际 ${JSON.stringify(r.cycle)}`);
  });

  test('readySet：初始只放行入度为 0 的 a', () => {
    const g = buildGraph(dagPipe);
    const ready = readySet({ graph: g, steps: steps({ a: 'pending', b: 'pending', c: 'pending', d: 'pending' }) });
    assert.deepEqual(ready, ['a'], `实际 ${JSON.stringify(ready)}`);
  });

  test('readySet：上游成功后放行下游；上游未完成不放行', () => {
    const g = buildGraph(dagPipe);
    const r1 = readySet({ graph: g, steps: steps({ a: 'success', b: 'pending', c: 'pending', d: 'pending' }) });
    assert.deepEqual(r1, ['b', 'c'], `a 成功后应放行 b/c，实际 ${JSON.stringify(r1)}`);

    const r2 = readySet({ graph: g, steps: steps({ a: 'success', b: 'success', c: 'running', d: 'pending' }) });
    assert.deepEqual(r2, [], `依赖未全部成功时不得放行 d，实际 ${JSON.stringify(r2)}`);
  });

  test('readySet：上游失败时下游不再就绪（on_success 语义）', () => {
    const g = buildGraph(dagPipe);
    const ready = readySet({ graph: g, steps: steps({ a: 'failed', b: 'pending', c: 'pending', d: 'pending' }) });
    assert.deepEqual(ready, [], `上游失败后不得放行下游，实际 ${JSON.stringify(ready)}`);
  });

  test('readySet：running 中的 job 不重复放行', () => {
    const g = buildGraph(dagPipe);
    const ready = readySet({ graph: g, steps: steps({ a: 'running', b: 'pending' }), running: ['a'] });
    assert.ok(!ready.includes('a'), `已运行的 a 不得重复放行，实际 ${JSON.stringify(ready)}`);
  });

  test('readySet：allowFailure 的上游失败不阻塞下游', () => {
    const g = buildGraph(mk([
      { id: 'a', node: 'shell.exec', allowFailure: true },
      { id: 'b', node: 'shell.exec', needs: ['a'] },
    ]));
    const ready = readySet({ graph: g, steps: steps({ a: 'failed', b: 'pending' }) });
    assert.deepEqual(ready, ['b'], `allowFailure 失败应放行下游，实际 ${JSON.stringify(ready)}`);
  });

  // ── 契约 §2.1 的 when 语义（以下两条是硬要求） ────────────────────────────
  test('契约 when=always：上游失败也必须放行', () => {
    const g = buildGraph(mk([
      { id: 'a', node: 'shell.exec' },
      { id: 'b', node: 'shell.exec', needs: ['a'], when: 'always' },
    ]));
    const ready = readySet({ graph: g, steps: steps({ a: 'failed', b: 'pending' }) });
    assert.deepEqual(ready, ['b'], `when=always 时上游失败也应放行 b，实际 ${JSON.stringify(ready)}`);
  });

  test('契约 when=manual：不得自动放行（即使上游成功）', () => {
    const g = buildGraph(mk([
      { id: 'a', node: 'shell.exec' },
      { id: 'b', node: 'shell.exec', needs: ['a'], when: 'manual' },
    ]));
    const ready = readySet({ graph: g, steps: steps({ a: 'success', b: 'pending' }) });
    assert.deepEqual(ready, [], `when=manual 不应自动放行，实际 ${JSON.stringify(ready)}`);
  });

  test('whenDecision 与 readySet 的结论一致（避免两处语义漂移）', () => {
    const whenDecision = mod.whenDecision;
    if (typeof whenDecision !== 'function') return;
    // when=always + 上游失败 → run；对应 readySet 应放行
    const dAlways = whenDecision({ when: 'always' }, { failed: true });
    assert.equal(dAlways, 'run', 'whenDecision(always, 上游失败) 应为 run');
    const dManual = whenDecision({ when: 'manual' }, { failed: false });
    assert.equal(dManual, 'hold', 'whenDecision(manual) 应为 hold');
  });

  test('readySet 确定性：同输入同输出', () => {
    const g = buildGraph(dagPipe);
    const s = steps({ a: 'success', b: 'pending', c: 'pending', d: 'pending' });
    assert.deepEqual(readySet({ graph: g, steps: s }), readySet({ graph: g, steps: s }));
  });

  test('buildGraph 对空流水线不抛异常', () => {
    assert.doesNotThrow(() => buildGraph({ id: 'e', name: 'E', stages: [] }));
    assert.doesNotThrow(() => buildGraph(null));
  });
});
