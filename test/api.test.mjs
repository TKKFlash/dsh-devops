// 契约 §3.10（路由与统一响应）+ §3.11（SSE 协议）
// 用**假 req/res** 跑真实的 createRouter，覆盖：
//   语义化状态码、{ok,value}/{ok,message} 形状、body 超限 413、非 loopback 拒绝、
//   SSE 帧格式与 Last-Event-ID 续传、gap 事件、路径越界拒绝
// 全程零网络：req/res 都是本地桩对象。
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { suiteFor, requiredFn } from './helpers/modules.mjs';
import { makeTmpDir, cleanupTmp, fakeLog } from './helpers/tmp.mjs';
import { samplePipeline, sampleServer } from './helpers/fixtures.mjs';

const relRouter = 'src/api/router.js';
const relSse = 'src/api/sse.js';
const routerSuite = await suiteFor(relRouter);
const sseSuite = await suiteFor(relSse);

/** 假 IncomingMessage */
function makeReq({ method = 'GET', url = '/dsh-devops/api/meta', body, remoteAddress = '127.0.0.1', headers = {} } = {}) {
  const chunks = [];
  if (body !== undefined) {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    chunks.push(Buffer.from(text, 'utf8'));
  }
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = { host: '127.0.0.1:3080', ...headers };
  req.socket = { remoteAddress, remotePort: 12345, encrypted: false };
  req.connection = req.socket;
  // 支持异步迭代（http.js 的读体可能用 for await）
  req[Symbol.asyncIterator] = async function* iterate() {
    for (const c of chunks) yield c;
  };
  req.on = EventEmitter.prototype.on.bind(req);
  // 立即推送数据（微任务后触发 end，给 router 绑定监听的机会）
  setTimeout(() => {
    for (const c of chunks) req.emit('data', c);
    req.emit('end');
    req.emit('close');
  }, 0);
  return req;
}

/** 假 ServerResponse：记录 status/headers/body */
function makeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    chunks: [],
    ended: false,
    headersSent: false,
    on() {
      return this;
    },
    once() {
      return this;
    },
    removeListener() {
      return this;
    },
    writeHead(status, headers) {
      this.statusCode = status;
      this.headersSent = true;
      Object.assign(this.headers, headers ?? {});
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    write(chunk) {
      this.chunks.push(String(chunk));
      return true;
    },
    end(chunk) {
      if (chunk !== undefined) this.chunks.push(String(chunk));
      this.ended = true;
      return this;
    },
    /** body 文本 */
    get text() {
      return this.chunks.join('');
    },
    /** 解析 JSON body */
    json() {
      try {
        return JSON.parse(this.text);
      } catch {
        return null;
      }
    },
    flushHeaders() {
      this.headersSent = true;
    },
    destroy() {
      this.ended = true;
    },
  };
  return res;
}

/** 发起一次请求，返回 { status, json, res } */
async function request(router, options = {}) {
  const req = makeReq(options);
  const res = makeRes();
  await router.handle(req, res);
  return { status: res.statusCode, res, json: res.json(), text: res.text };
}

describe('api/router', { skip: routerSuite.skip }, () => {
  const createRouter = requiredFn(routerSuite.mod, 'createRouter', relRouter);

  let router;
  let store;
  let deps;

  before(async () => {
    const { createStore } = await import('../src/store/store.js');
    store = await createStore({ dataDir: makeTmpDir('dsh-devops-api-'), log: fakeLog() });
    const nodes = (() => {
      const known = new Set(['shell.exec', 'node.exec', 'python.exec']);
      return {
        list: () => [...known].map((type) => ({ type, title: type, category: 'x', icon: 'box', description: '', fields: [], outputs: [] })),
        get: (type) => (known.has(type) ? { type, run: async () => ({ exitCode: 0 }), fields: [], outputs: [] } : undefined),
        register: () => () => {},
        loadCustom: async () => {},
      };
    })();
    deps = {
      store,
      nodes,
      log: fakeLog(),
      config: {},
      version: '0.1.0',
      engine: {
        start: async () => ({ runId: 'run-1', run: {}, wait: async () => ({}), cancel: async () => {}, promise: Promise.resolve({}) }),
        cancel: async () => {},
        retry: async () => ({}),
        retryStep: async () => ({}),
        listRuns: () => [],
        getRun: () => undefined,
      },
      logs: {
        read: () => ({ lines: [], next: 0, lossy: false, bytes: 0 }),
        readRun: () => ({ lines: [], next: 0, lossy: false, bytes: 0 }),
        listRuns: () => [],
        pathFor: () => '/tmp/x.log',
      },
      executors: { resolve: () => ({ probe: async () => ({ os: 'Linux', arch: 'x86_64', shell: '/bin/sh', workdir: '/', runtime: {}, managers: [], sudo: 'none', error: '' }) }), list: () => [] },
      provisioner: { ensure: async () => ({ ok: false, error: 'x', suggestion: 'y', actions: [] }), probe: async () => ({ os: '', arch: '', shell: '', workdir: '', runtime: {}, managers: [], sudo: 'none', error: '' }) },
    };
    router = createRouter(deps);
  });

  after(async () => {
    await store?.close?.();
    cleanupTmp();
  });

  const API = '/dsh-devops/api';

  test('createRouter 返回 { handle }', () => {
    assert.equal(typeof router.handle, 'function', 'router.handle 必须是函数');
  });

  test('GET /api/meta → {ok:true,value}', async () => {
    const r = await request(router, { url: `${API}/meta` });
    assert.equal(r.status, 200, `实际 ${r.status}`);
    assert.equal(r.json?.ok, true, `响应必须是 {ok:true,...}，实际 ${r.text.slice(0, 200)}`);
    assert.ok('value' in r.json, '成功响应必须带 value');
  });

  test('未知路由 → 404 且 {ok:false,message,code}', async () => {
    const r = await request(router, { url: `${API}/definitely-not-here` });
    assert.equal(r.status, 404, `实际 ${r.status}`);
    assert.equal(r.json?.ok, false);
    assert.equal(typeof r.json?.message, 'string', '失败响应必须有 message');
    assert.equal(typeof r.json?.code, 'string', '失败响应必须有 code');
  });

  test('方法不匹配 → 405（不是 404）', async () => {
    const r = await request(router, { method: 'DELETE', url: `${API}/meta` });
    assert.equal(r.status, 405, `方法不匹配应回 405，实际 ${r.status}`);
    assert.equal(r.json?.ok, false);
  });

  test('★ 非 loopback 来源必须被拒绝（403/404，且不泄露数据）', async () => {
    const r = await request(router, { url: `${API}/meta`, remoteAddress: '203.0.113.7' });
    assert.ok([403, 404].includes(r.status), `非本机来源必须被拒绝，实际 ${r.status}`);
    assert.equal(r.json?.ok, false, '被拒绝的响应必须是失败形状');
  });

  test('allowLanAccess:true 时放行局域网来源', async () => {
    const lanRouter = createRouter({ ...deps, allowLanAccess: true });
    const r = await request(lanRouter, { url: `${API}/meta`, remoteAddress: '192.168.1.20' });
    assert.equal(r.status, 200, `显式放行时局域网来源应可用，实际 ${r.status}`);
  });

  test('★ body 超过 1 MiB → 413', async () => {
    const huge = JSON.stringify({ name: 'x'.repeat(1024 * 1024 + 1024) });
    const r = await request(router, { method: 'POST', url: `${API}/pipelines`, body: huge });
    assert.equal(r.status, 413, `超限 body 必须回 413，实际 ${r.status}（body 响应 ${r.text.slice(0, 200)}）`);
    assert.equal(r.json?.ok, false);
  });

  test('非法 JSON body → 400（不是 500）', async () => {
    const r = await request(router, { method: 'POST', url: `${API}/pipelines`, body: '{ this is not json' });
    assert.equal(r.status, 400, `非法 JSON 应回 400，实际 ${r.status}`);
    assert.equal(r.json?.ok, false);
  });

  test('CRUD：创建 → 读取 → 列表 → 删除 全链路', async () => {
    const p = samplePipeline({ id: 'api-crud', name: 'API 流水线' });

    const created = await request(router, { method: 'POST', url: `${API}/pipelines`, body: { pipeline: p } });
    assert.equal(created.status, 200, `创建应成功，实际 ${created.status} ${created.text.slice(0, 200)}`);
    assert.equal(created.json?.ok, true);

    const got = await request(router, { url: `${API}/pipelines/api-crud` });
    assert.equal(got.status, 200, `读取应成功，实际 ${got.status}`);
    assert.equal(got.json?.value?.id, 'api-crud', `读取内容应正确，实际 ${got.text.slice(0, 200)}`);

    const list = await request(router, { url: `${API}/pipelines` });
    assert.equal(list.status, 200);
    const ids = (list.json?.value ?? []).map((x) => x.id ?? x);
    assert.ok(ids.includes('api-crud'), `列表应包含新建项，实际 ${JSON.stringify(ids)}`);

    const del = await request(router, { method: 'DELETE', url: `${API}/pipelines/api-crud` });
    assert.equal(del.status, 200, `删除应成功，实际 ${del.status}`);
    const gone = await request(router, { url: `${API}/pipelines/api-crud` });
    assert.equal(gone.status, 404, `删除后读取应 404，实际 ${gone.status}`);
  });

  test('POST /api/pipelines/validate 返回 {ok,errors} 语义', async () => {
    const bad = samplePipeline({ id: 'BAD ID' });
    const r = await request(router, { method: 'POST', url: `${API}/pipelines/validate`, body: { pipeline: bad } });
    assert.equal(r.status, 200, `validate 是业务校验，应回 200，实际 ${r.status}`);
    const value = r.json?.value;
    assert.ok(value, 'validate 必须返回 value');
    assert.equal(value.ok, false, `非法流水线应 ok:false，实际 ${JSON.stringify(value)}`);
    assert.ok(Array.isArray(value.errors) && value.errors.length > 0, '必须带 errors');
  });

  test('validate 路由不被 /:id 抢占（路径优先级）', async () => {
    const r = await request(router, { method: 'POST', url: `${API}/pipelines/validate`, body: { pipeline: samplePipeline() } });
    assert.equal(r.json?.value?.ok, true, `validate 应正常返回校验结果而非 404，实际 ${r.text.slice(0, 200)}`);
  });

  test('GET 不存在的资源 → 404 且带 code', async () => {
    const r = await request(router, { url: `${API}/pipelines/no-such-pipeline` });
    assert.equal(r.status, 404, `实际 ${r.status}`);
    assert.equal(r.json?.ok, false);
    assert.equal(typeof r.json?.code, 'string');
  });

  test('服务器：内置 local 可读且删除被拒', async () => {
    const list = await request(router, { url: `${API}/servers` });
    assert.equal(list.status, 200);
    const ids = (list.json?.value ?? []).map((s) => s.id);
    assert.ok(ids.includes('local'), `服务器列表必须含内置 local，实际 ${JSON.stringify(ids)}`);

    const del = await request(router, { method: 'DELETE', url: `${API}/servers/local` });
    assert.ok(del.status >= 400, `删除内置 local 必须失败，实际 ${del.status}`);
    const still = await request(router, { url: `${API}/servers` });
    assert.ok((still.json?.value ?? []).some((s) => s.id === 'local'), 'local 必须仍在');
  });

  test('GET /api/nodes 返回节点目录（含自定义节点信息与字段描述符）', async () => {
    const r = await request(router, { url: `${API}/nodes` });
    assert.equal(r.status, 200, `实际 ${r.status}`);
    const value = r.json?.value;
    assert.ok(value && typeof value === 'object', `应返回对象，实际 ${r.text.slice(0, 200)}`);
    // 实现返回 { nodes: [...], ... }；兼容裸数组形态
    const nodes = Array.isArray(value) ? value : value.nodes;
    assert.ok(Array.isArray(nodes), `必须能取到节点数组，实际键 ${Object.keys(value).join(',')}`);
    assert.ok(nodes.length > 0, '节点目录不应为空');
    const sample = nodes[0];
    assert.equal(typeof sample.type, 'string', '节点必须有 type');
    assert.ok(!('run' in sample), '目录投影不应包含可执行函数（run 属服务端内部）');
  });

  test('GET /api/settings 返回契约 §2.4 的字段', async () => {
    const r = await request(router, { url: `${API}/settings` });
    assert.equal(r.status, 200);
    const s = r.json?.value;
    assert.ok(s && typeof s === 'object', '设置必须是对象');
    for (const k of ['defaultServer', 'maxConcurrentRuns', 'maxParallelSteps', 'logRingBytes', 'logRetentionDays']) {
      assert.ok(k in s, `设置必须含 ${k}`);
    }
  });

  test('★ 路径越界：fs/list 越出允许根目录必须被拒绝', async () => {
    const r = await request(router, { url: `${API}/fs/list?server=local&path=${encodeURIComponent('/../../../../etc')}` });
    assert.ok([400, 403, 404].includes(r.status), `越界路径必须被拒绝，实际 ${r.status} ${r.text.slice(0, 200)}`);
    assert.equal(r.json?.ok, false);
  });

  test('查询参数过滤：runs 列表接受 pipelineId/status/limit', async () => {
    const r = await request(router, { url: `${API}/runs?pipelineId=x&status=success&limit=5` });
    assert.equal(r.status, 200, `带过滤参数应正常，实际 ${r.status} ${r.text.slice(0, 200)}`);
    assert.equal(r.json?.ok, true);
  });

  test('导出接口：缺 id 时明确报错', async () => {
    const r = await request(router, { url: `${API}/export?kind=pipeline` });
    assert.ok(r.status >= 400, `缺 id 必须报错，实际 ${r.status}`);
    assert.equal(r.json?.ok, false);
  });

  test('CSS/JSON 之外：响应 Content-Type 是 JSON', async () => {
    const r = await request(router, { url: `${API}/meta` });
    const ct = r.res.headers['Content-Type'] ?? r.res.headers['content-type'] ?? '';
    assert.match(String(ct), /application\/json/, `应回 JSON，实际 ${ct}`);
  });

  test('error 响应不得泄露堆栈（只给 message/code）', async () => {
    const r = await request(router, { url: `${API}/pipelines/no-such` });
    const text = r.text;
    assert.ok(!/\bat .+:\d+:\d+/.test(text), `响应不得包含堆栈，实际 ${text.slice(0, 300)}`);
    assert.deepEqual(Object.keys(r.json ?? {}).sort(), ['code', 'message', 'ok'].sort(), `失败响应字段应为 ok/message/code，实际 ${Object.keys(r.json ?? {}).join(',')}`);
  });
});

// ───────────────────────── SSE ─────────────────────────
describe('api/sse', { skip: sseSuite.skip }, () => {
  const formatFrame = requiredFn(sseSuite.mod, 'formatFrame', relSse);
  const createSseHub = requiredFn(sseSuite.mod, 'createSseHub', relSse);
  const readLastEventId = sseSuite.mod.readLastEventId;

  test('formatFrame 产出契约 §3.11 的 SSE 帧（event/data + 全局 seq 的 id）', () => {
    const frame = formatFrame({ seq: 42, type: 'log', data: { stepId: 'compile', text: 'hi' } });
    assert.equal(typeof frame, 'string', '帧必须是字符串');
    assert.match(frame, /^id: 42$/m, `必须含 id: 42（全局 seq 供续传），实际 ${JSON.stringify(frame)}`);
    assert.match(frame, /^event: log$/m, `必须含 event: log，实际 ${JSON.stringify(frame)}`);
    assert.match(frame, /^data: /m, `必须含 data: 行，实际 ${JSON.stringify(frame)}`);
    assert.ok(frame.endsWith('\n\n'), `SSE 帧必须以空行结束，实际 ${JSON.stringify(frame)}`);
    // data 必须是单行 JSON（SSE 不允许裸换行）
    const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
    assert.doesNotThrow(() => JSON.parse(dataLine.slice(6)), 'data 必须是合法 JSON');
  });

  test('formatFrame 覆盖契约的全部事件类型', () => {
    for (const type of ['run', 'step', 'log', 'gap', 'ping']) {
      const frame = formatFrame({ seq: 1, type, data: {} });
      assert.match(frame, new RegExp(`^event: ${type}$`, 'm'), `应支持事件类型 ${type}`);
    }
  });

  test('readLastEventId 优先读 Last-Event-ID 头，其次 query ?from=', () => {
    if (typeof readLastEventId !== 'function') return;
    const fromHeader = readLastEventId({ headers: { 'last-event-id': '17' } }, new URLSearchParams(''));
    assert.equal(Number(fromHeader), 17, '应读取 Last-Event-ID 头');
    // query 兜底键与契约 §3.10 的 logs?from= 保持一致
    const fromQuery = readLastEventId({ headers: {} }, new URLSearchParams('from=9'));
    assert.equal(Number(fromQuery), 9, '应支持 query ?from= 兜底');
    // 头优先于 query
    const both = readLastEventId({ headers: { 'last-event-id': '17' } }, new URLSearchParams('from=9'));
    assert.equal(Number(both), 17, '头必须优先于 query');
    const none = readLastEventId({ headers: {} }, new URLSearchParams(''));
    assert.equal(Number(none), 0, '无续传信息时应视为从头开始');
    for (const bad of ['abc', '-5', '0']) {
      assert.equal(Number(readLastEventId({ headers: { 'last-event-id': bad } }, new URLSearchParams(''))), 0, `非法 id ${bad} 应归零`);
    }
  });

  test('createSseHub 返回 subscribe/publish/closeAll', () => {
    const hub = createSseHub({ log: fakeLog(), pingMs: 100000 });
    for (const m of ['subscribe', 'publish', 'closeAll']) {
      assert.equal(typeof hub[m], 'function', `hub.${m} 必须是函数`);
    }
    hub.closeAll();
  });

  test('★ subscribe 后发布事件，客户端收到正确帧；ping 保持连接', async () => {
    const hub = createSseHub({ log: fakeLog(), pingMs: 100000 });
    const req = makeReq({ url: '/dsh-devops/api/runs/run-1/events' });
    req.headers = { host: '127.0.0.1', accept: 'text/event-stream' };
    const res = makeRes();
    hub.subscribe(req, res, 'run-1', { lastId: 0, initial: [] });

    hub.publish({ type: 'run', runId: 'run-1', seq: 1, data: { run: { id: 'run-1', status: 'running' } } });
    hub.publish({ type: 'log', runId: 'run-1', seq: 2, data: { stepId: 'compile', seq: 2, text: 'hello' } });
    await new Promise((r) => setTimeout(r, 30));

    const text = res.text;
    assert.match(text, /event: run/, `应收到 run 事件，实际 ${text.slice(0, 300)}`);
    assert.match(text, /event: log/, '应收到 log 事件');
    assert.match(text, /id: 2/m, '应带全局 seq');
    assert.ok(!res.ended, 'SSE 连接不应被主动结束');
    hub.closeAll();
  });

  test('★ Last-Event-ID 续传：只补发 seq 之后的事件', async () => {
    const hub = createSseHub({ log: fakeLog(), pingMs: 100000 });
    // 先发布历史事件（进入 ring）
    for (const seq of [1, 2, 3, 4]) {
      hub.publish({ type: 'log', runId: 'run-c', seq, data: { stepId: 's', seq, text: `line-${seq}` } });
    }
    const req = makeReq({ url: '/dsh-devops/api/runs/run-c/events' });
    req.headers = { host: '127.0.0.1', 'last-event-id': '2' };
    const res = makeRes();
    hub.subscribe(req, res, 'run-c', { lastId: 2, initial: [] });
    await new Promise((r) => setTimeout(r, 30));

    const text = res.text;
    assert.ok(!/line-1/.test(text) && !/line-2/.test(text), `不得重发已确认的事件，实际 ${text.slice(0, 300)}`);
    assert.ok(/line-3/.test(text) && /line-4/.test(text), `应补发 seq>2 的事件，实际 ${text.slice(0, 300)}`);
    hub.closeAll();
  });

  test('★ gap 事件：断线造成的事件跳跃必须显式告知', async () => {
    const hub = createSseHub({ log: fakeLog(), pingMs: 100000, ringSize: 3 });
    // 发布超过 ring 容量的事件，使最早的事件被挤出
    for (const seq of [1, 2, 3, 4, 5, 6, 7, 8]) {
      hub.publish({ type: 'log', runId: 'run-gap', seq, data: { stepId: 's', seq, text: `l-${seq}` } });
    }
    const req = makeReq({ url: '/dsh-devops/api/runs/run-gap/events' });
    // 客户端声明的 lastId 早于 ring 里最小 seq → 中间事件已丢失
    req.headers = { host: '127.0.0.1', 'last-event-id': '1' };
    const res = makeRes();
    hub.subscribe(req, res, 'run-gap', { lastId: 1, initial: [] });
    await new Promise((r) => setTimeout(r, 30));

    const text = res.text;
    assert.match(text, /event: gap/, `ring 溢出后必须发 gap 事件，实际 ${text.slice(0, 400)}`);
    const gapLine = text.split('\n\n').find((f) => f.includes('event: gap'));
    assert.ok(gapLine, '应能找到 gap 帧');
    const dataLine = gapLine.split('\n').find((l) => l.startsWith('data: '));
    const payload = JSON.parse(dataLine.slice(6));
    assert.ok('from' in payload && 'to' in payload, `gap 帧应含 from/to，实际 ${JSON.stringify(payload)}`);
    hub.closeAll();
  });

  test('多订阅者互不干扰', async () => {
    const hub = createSseHub({ log: fakeLog(), pingMs: 100000 });
    const mk = () => {
      const req = makeReq({ url: '/x' });
      req.headers = { host: '127.0.0.1' };
      const res = makeRes();
      hub.subscribe(req, res, 'run-m', { lastId: 0, initial: [] });
      return res;
    };
    const resA = mk();
    const resB = mk();
    hub.publish({ type: 'run', runId: 'run-m', seq: 1, data: { run: { id: 'run-m' } } });
    await new Promise((r) => setTimeout(r, 30));
    assert.match(resA.text, /event: run/, 'A 应收到事件');
    assert.match(resB.text, /event: run/, 'B 应收到事件');
    hub.closeAll();
  });

  test('其他 run 的事件不得串到本订阅者', async () => {
    const hub = createSseHub({ log: fakeLog(), pingMs: 100000 });
    const req = makeReq({ url: '/x' });
    req.headers = { host: '127.0.0.1' };
    const res = makeRes();
    hub.subscribe(req, res, 'run-A', { lastId: 0, initial: [] });
    hub.publish({ type: 'log', runId: 'run-B', seq: 1, data: { stepId: 's', seq: 1, text: 'secret-of-B' } });
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(!/secret-of-B/.test(res.text), `不得收到其他 run 的事件，实际 ${res.text.slice(0, 300)}`);
    hub.closeAll();
  });

  test('closeAll 后不再写出（连接可优雅关闭）', async () => {
    const hub = createSseHub({ log: fakeLog(), pingMs: 100000 });
    const req = makeReq({ url: '/x' });
    req.headers = { host: '127.0.0.1' };
    const res = makeRes();
    hub.subscribe(req, res, 'run-z', { lastId: 0, initial: [] });
    hub.closeAll();
    const before = res.text;
    hub.publish({ type: 'log', runId: 'run-z', seq: 99, data: { stepId: 's', seq: 99, text: 'after-close' } });
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(!/after-close/.test(res.text), 'closeAll 之后不得再写出数据');
    assert.equal(res.text, before, 'closeAll 之后输出不应变化');
  });

  test('SSE 帧的 data 内换行被转义（不破坏帧结构）', () => {
    const frame = formatFrame({ seq: 1, type: 'log', data: { text: 'line1\nline2\nid: 999\nevent: fake' } });
    // 每个非空行都必须以合法字段名开头
    for (const line of frame.split('\n')) {
      if (line === '') continue;
      assert.match(line, /^(id|event|data|retry|:)/, `帧内不得出现裸换行注入，实际行 ${JSON.stringify(line)}`);
    }
    // 只应有一个 event 行（被转义后不会多出）
    assert.equal(frame.split('\n').filter((l) => l.startsWith('event: ')).length, 1, `不得被注入出多余 event 行，实际 ${JSON.stringify(frame)}`);
  });
});
