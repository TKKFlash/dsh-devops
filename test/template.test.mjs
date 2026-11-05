// 契约 §3.3：src/model/template.js
// 覆盖：interpolate（未定义必须抛错）、buildContext、instantiate（必填缺失报错）、extractParameter、往返一致
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { suiteFor, requiredFn } from './helpers/modules.mjs';
import { sampleTemplate, samplePipeline } from './helpers/fixtures.mjs';

const rel = 'src/model/template.js';
const { mod, skip } = await suiteFor(rel);

/** 造一个参数定义（不含 options，避免与 schema 的 options 校验纠缠） */
function param(over = {}) {
  return { name: 'image_tag', label: '镜像标签', type: 'string', required: true, default: 'latest', ...over };
}

describe('model/template', { skip }, () => {
  const interpolate = requiredFn(mod, 'interpolate', rel);
  const buildContext = requiredFn(mod, 'buildContext', rel);
  const instantiate = requiredFn(mod, 'instantiate', rel);
  const extractParameter = requiredFn(mod, 'extractParameter', rel);

  describe('interpolate', () => {
    test('替换 ${{ x.y }} 形式（允许花括号内空格）', () => {
      assert.equal(interpolate('tag=${{ params.image_tag }}', { params: { image_tag: 'v1' } }), 'tag=v1');
      assert.equal(interpolate('tag=${{params.image_tag}}', { params: { image_tag: 'v1' } }), 'tag=v1');
    });

    test('一个字符串里多处占位全部替换', () => {
      const out = interpolate('${{ a }}-${{ b }}-${{ a }}', { a: '1', b: '2' });
      assert.equal(out, '1-2-1');
    });

    test('未定义变量必须抛错，不得静默留空或原样保留', () => {
      assert.throws(
        () => interpolate('x=${{ nope.missing }}', { nope: {} }),
        (err) => err instanceof Error,
        '未定义路径必须抛出 Error',
      );
      assert.throws(() => interpolate('x=${{ a.b.c }}', {}), Error, '整条路径缺失必须抛错');
    });

    test('值为 0 / false / 空串时正常替换（不得误判为未定义）', () => {
      assert.equal(interpolate('${{ a }}', { a: 0 }), '0', '0 是有效值');
      assert.equal(interpolate('${{ a }}', { a: false }), 'false', 'false 是有效值');
      assert.equal(interpolate('${{ a }}', { a: '' }), '', '空串是有效值');
    });

    test('无占位符时原样返回', () => {
      assert.equal(interpolate('plain text', {}), 'plain text');
    });

    test('非字符串输入必须明确失败（抛错），不得静默返回错误结果', () => {
      assert.throws(() => interpolate(42, {}), Error, '非字符串输入应抛出明确的 Error');
      assert.throws(() => interpolate(null, {}), Error, 'null 输入应抛出明确的 Error');
    });
  });

  describe('buildContext', () => {
    test('返回对象', () => {
      const ctx = buildContext({
        variables: { ENV: 'prod' },
        params: { image_tag: 'v1' },
        steps: { compile: { exitCode: 0 } },
        env: { NODE_ENV: 'production' },
        server: { id: 'local' },
        run: { id: 'run-1' },
      });
      assert.ok(ctx && typeof ctx === 'object', 'buildContext 必须返回对象');
    });

    test('传入空的部件也能构造上下文（不抛）', () => {
      assert.doesNotThrow(() => buildContext({}));
    });
  });

  describe('instantiate', () => {
    test('参数齐全 → { ok:true, value: Pipeline }，且占位被替换', () => {
      const tpl = sampleTemplate();
      tpl.body = samplePipeline({ id: 'from-tpl', name: '来自模板' });
      tpl.body.stages[0].jobs[0].with = { script: 'docker build -t app:${{ params.image_tag }} .' };
      tpl.parameters = [param()];
      const r = instantiate(tpl, { image_tag: 'v9' });
      assert.equal(r.ok, true, `应成功，实际 ${JSON.stringify(r.errors)}`);
      assert.equal(r.value.stages[0].jobs[0].with.script, 'docker build -t app:v9 .');
    });

    test('必填参数缺失 → ok:false，且错误里指出参数名', () => {
      const tpl = sampleTemplate();
      tpl.body = samplePipeline({ id: 't2' });
      tpl.parameters = [param({ default: '' })];
      const r = instantiate(tpl, {});
      assert.equal(r.ok, false, '必填缺失必须失败');
      const blob = JSON.stringify(r.errors);
      assert.ok(blob.includes('image_tag'), `错误信息应包含参数名 image_tag，实际 ${blob}`);
    });

    test('未提供的可选参数使用 default', () => {
      const tpl = sampleTemplate();
      tpl.body = samplePipeline({ id: 't3', name: 'N-${{ params.tag }}' });
      tpl.parameters = [param({ name: 'tag', label: '标签', required: false, default: 'latest' })];
      const r = instantiate(tpl, {});
      assert.equal(r.ok, true, `实际 ${JSON.stringify(r.errors)}`);
      assert.equal(r.value.name, 'N-latest', '未传的可选参数应使用 default');
    });

    test('instantiate 不改动模板对象（无副作用）', () => {
      const tpl = sampleTemplate();
      tpl.body = samplePipeline({ id: 't4', name: '${{ params.tag }}' });
      tpl.parameters = [param({ name: 'tag', label: '标签', required: false, default: 'd' })];
      const snapshot = JSON.stringify(tpl);
      instantiate(tpl, { tag: 'zzz' });
      assert.equal(JSON.stringify(tpl), snapshot, 'instantiate 不得原地修改模板');
    });

    test('非法模板（body 不合法）→ ok:false 且带 errors', () => {
      const r = instantiate({ id: 'bad', name: 'x', body: { id: 'BAD ID' }, parameters: [] }, {});
      assert.equal(r.ok, false);
      assert.ok(Array.isArray(r.errors) && r.errors.length > 0);
    });
  });

  describe('extractParameter', () => {
    test('把流水线里某个点路径提升为模板参数', () => {
      const p = samplePipeline();
      p.stages[0].jobs[0].with.script = 'echo hello';
      const out = extractParameter(p, 'stages[0].jobs[0].with.script');
      assert.ok(out, 'extractParameter 应返回对象');
      const blob = JSON.stringify(out);
      assert.ok(
        blob.includes('${{') || blob.includes('param'),
        `提升结果应体现参数占位，实际 ${blob}`,
      );
    });

    test('指向不存在的路径时抛错或返回带 errors 的失败对象（不得静默成功）', () => {
      const p = samplePipeline();
      let threw = false;
      let result;
      try {
        result = extractParameter(p, 'stages[9].jobs[9].with.nope');
      } catch {
        threw = true;
      }
      assert.ok(threw || result?.ok === false, '不存在的路径不得静默成功');
    });
  });

  describe('往返一致', () => {
    test('模板 → 实例 → 稳定；同一输入必须得到同一结果', () => {
      const tpl = sampleTemplate();
      tpl.body = samplePipeline({ id: 'rt', name: 'RT-${{ params.env }}' });
      tpl.parameters = [param({ name: 'env', label: '环境', default: '' })];
      const r = instantiate(tpl, { env: 'staging' });
      assert.equal(r.ok, true, `实际 ${JSON.stringify(r.errors)}`);
      assert.equal(r.value.name, 'RT-staging');
      const again = instantiate(tpl, { env: 'staging' });
      // createdAt/updatedAt 取自真实时钟，两次调用天然可能差 1ms——它不属于
      // 「确定性」范畴。比对前剔除，否则本用例会跨毫秒边界随机变红（全量负载下必现）。
      const stripTime = (value) => {
        const copy = JSON.parse(JSON.stringify(value));
        delete copy.createdAt;
        delete copy.updatedAt;
        return copy;
      };
      assert.deepEqual(stripTime(again.value), stripTime(r.value), '同一输入必须得到同一结果（确定性）');
      // 同一次实例化内，createdAt 与 updatedAt 必须是同一时刻
      assert.equal(r.value.createdAt, r.value.updatedAt, '创建时 createdAt 与 updatedAt 必须相同');
    });
  });
});
