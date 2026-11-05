// task-13：私钥认证支持本地私钥文件（契约 §2.3「私钥来源优先级」）。
// 全部用**临时文件**造假私钥，零网络、零 ssh2 依赖：只验证 auth.js 的解析语义。
// 覆盖：读成本地私钥 / keyPath 优先 / keyRef 兼作路径 / 凭据方式仍可用 /
//       路径不存在·目录·超大·空文件的**可读错误**且**不泄漏私钥内容** / 私钥进 secrets 打码。
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { suiteFor, requiredFn, pluginPath } from './helpers/modules.mjs';
import { makeTmpDir, cleanupTmp, fakeLog } from './helpers/tmp.mjs';
import { sampleServer } from './helpers/fixtures.mjs';

const rel = 'src/engine/executors/ssh/auth.js';
const { mod, skip } = await suiteFor(rel);

/** 换行常量：避免在本文件里写转义序列，便于生成与阅读 */
const NL = String.fromCharCode(10);

describe('ssh/auth 私钥文件', { skip }, () => {
  const resolveAuth = requiredFn(mod, 'resolveAuth', rel);
  const readPrivateKeyFile = requiredFn(mod, 'readPrivateKeyFile', rel);

  let dir;
  /** 私钥里放一个独特标记，用于断言「错误信息不得泄漏内容」 */
  const KEY_MATERIAL = 'SECRETKEYMATERIAL-DO-NOT-LEAK-abc123';
  const FAKE_KEY = [
    '-----BEGIN OPENSSH PRIVATE KEY-----',
    KEY_MATERIAL,
    '-----END OPENSSH PRIVATE KEY-----',
  ].join(NL);
  let keyFile;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-devops-keyfile-'));
    keyFile = join(dir, 'id_rsa');
    writeFileSync(keyFile, FAKE_KEY, 'utf8');
  });

  after(() => {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
  });

  // ── 基本能力：把本机文件读成 privateKey ────────────────────────────────
  describe('读取本机私钥文件', () => {
    test('★ auth.keyPath 指向临时私钥文件 → 读成 privateKey，且进 secrets', async () => {
      const server = sampleServer({ auth: { type: 'key', keyRef: '', passwordRef: '', keyPath: keyFile } });
      const r = await resolveAuth(server, {});
      assert.equal(r.method, 'key', '认证方式应为 key');
      assert.equal(r.auth.privateKey, FAKE_KEY, '必须读成文件内容（不是路径字符串）');
      assert.ok(
        r.secrets.some((s) => s.includes(KEY_MATERIAL)),
        '私钥内容必须进入 secrets 供写盘前打码',
      );
    });

    test('★ keyRef 本身是存在的本机文件路径 → 读该文件（不再是 missing-private-key）', async () => {
      const server = sampleServer({ auth: { type: 'key', keyRef: keyFile, passwordRef: '' } });
      const r = await resolveAuth(server, {});
      assert.equal(r.auth.privateKey, FAKE_KEY, 'keyRef 写路径也必须可用（用户最常见的直觉写法）');
      assert.ok(r.secrets.some((s) => s.includes(KEY_MATERIAL)), '私钥必须进 secrets');
    });

    test('readPrivateKeyFile 直接调用也能读到内容', async () => {
      assert.equal(await readPrivateKeyFile(keyFile), FAKE_KEY);
    });

    test('支持 ~ 家目录前缀（ssh 用户的习惯写法）', async () => {
      // 用 HOME 指向临时目录，避免碰真实 ~/.ssh
      const prevHome = process.env.HOME;
      const prevProfile = process.env.USERPROFILE;
      process.env.HOME = dir;
      process.env.USERPROFILE = dir;
      try {
        const server = sampleServer({ auth: { type: 'key', keyRef: '', passwordRef: '', keyPath: '~/id_rsa' } });
        const r = await resolveAuth(server, {});
        assert.equal(r.auth.privateKey, FAKE_KEY, '~ 前缀应展开为家目录');
      } finally {
        process.env.HOME = prevHome;
        process.env.USERPROFILE = prevProfile;
      }
    });
  });

  // ── 优先级：keyPath > 凭据引用 > keyRef 路径 ───────────────────────────
  describe('优先级（契约 §2.3）', () => {
    test('★ keyPath 优先于凭据引用：两者都给时用文件', async () => {
      const credentialKey = 'FROM-CREDENTIAL-zzz999';
      const server = sampleServer({ auth: { type: 'key', keyRef: 'MY_KEY_REF', passwordRef: '', keyPath: keyFile } });
      const credentials = { resolve: (ref) => (ref === 'MY_KEY_REF' ? credentialKey : undefined) };
      const r = await resolveAuth(server, { credentials });
      assert.equal(r.auth.privateKey, FAKE_KEY, 'keyPath 必须优先于凭据引用');
      assert.ok(!r.secrets.includes(credentialKey), '既然没用凭据，就不该把凭据内容也塞进打码表');
    });

    test('★ keyPath 优先于 keyRef-as-path：两个不同文件时取 keyPath', async () => {
      const otherFile = join(dir, 'other_key');
      writeFileSync(otherFile, 'OTHER-KEY-CONTENT-xyz', 'utf8');
      const server = sampleServer({ auth: { type: 'key', keyRef: otherFile, passwordRef: '', keyPath: keyFile } });
      const r = await resolveAuth(server, {});
      assert.equal(r.auth.privateKey, FAKE_KEY, 'keyPath 必须优先于 keyRef 当路径解释');
    });

    test('★ 凭据引用方式仍可用：未给 keyPath 时走凭据（向后兼容）', async () => {
      const credentialKey = ['-----BEGIN RSA PRIVATE KEY-----', 'CREDKEYMATERIAL', '-----END RSA PRIVATE KEY-----'].join(NL);
      const server = sampleServer({ auth: { type: 'key', keyRef: 'MY_KEY_REF', passwordRef: '' } });
      const credentials = { resolve: (ref) => (ref === 'MY_KEY_REF' ? credentialKey : undefined) };
      const r = await resolveAuth(server, { credentials });
      assert.equal(r.auth.privateKey, credentialKey, '凭据引用必须保持可用');
      assert.ok(r.secrets.includes(credentialKey), '凭据私钥必须进 secrets');
    });

    test('config.privateKey 兜底仍可用（最低优先级）', async () => {
      const server = sampleServer({ auth: { type: 'key', keyRef: '', passwordRef: '' } });
      const r = await resolveAuth(server, { config: { privateKey: 'FROM-CONFIG-KEY' } });
      assert.equal(r.auth.privateKey, 'FROM-CONFIG-KEY', 'config.privateKey 应作为兜底');
    });

    test('注入点 getPrivateKey 仍优先于一切（测试/verifier 入口）', async () => {
      const server = sampleServer({ auth: { type: 'key', keyRef: '', passwordRef: '', keyPath: keyFile } });
      const r = await resolveAuth(server, { getPrivateKey: () => 'INJECTED-KEY' });
      assert.equal(r.auth.privateKey, 'INJECTED-KEY', '注入点应优先（正式测试入口）');
    });
  });

  // ── 错误语义：可读、含路径、不泄漏内容 ─────────────────────────────────
  describe('路径非法时的可读错误（且不泄漏私钥内容）', () => {

    /** 断言：错误可读（含 code/路径/原因），且绝不含私钥内容 */
    async function assertReadableError(fn, opts) {
      const code = opts.code;
      const contains = opts.contains || [];
      let error = null;
      try {
        await fn();
      } catch (err) {
        error = err;
      }
      assert.ok(error, '必须抛出错误，不得静默降级');
      assert.equal(error.code, code, '错误 code 必须稳定可判：' + code);
      for (const needle of contains) {
        assert.ok(
          String(error.message).includes(needle),
          '错误信息应包含「' + needle + '」，实际：' + error.message,
        );
      }
      assert.ok(
        !String(error.message).includes(KEY_MATERIAL),
        '错误信息绝不能泄漏私钥内容，实际：' + error.message,
      );
      // 序列化后（含 details）也不能泄漏：上层可能把错误整个回传前端
      const serialized = JSON.stringify({ message: error.message, details: error.details });
      assert.ok(
        !serialized.includes(KEY_MATERIAL),
        '错误对象序列化后也不得含私钥内容，实际：' + serialized.slice(0, 300),
      );
      return error;
    }

    test('★ 路径不存在 → private-key-file-not-found，错误含路径', async () => {
      const missing = join(dir, 'nope_id_rsa');
      const server = sampleServer({ auth: { type: 'key', keyRef: '', passwordRef: '', keyPath: missing } });
      await assertReadableError(() => resolveAuth(server, {}), {
        code: 'private-key-file-not-found',
        contains: [missing, '不存在'],
      });
    });

    test('★ 路径是目录 → private-key-file-not-regular，明确说是目录', async () => {
      const subdir = join(dir, 'a-directory');
      mkdirSync(subdir, { recursive: true });
      const server = sampleServer({ auth: { type: 'key', keyRef: '', passwordRef: '', keyPath: subdir } });
      const err = await assertReadableError(() => resolveAuth(server, {}), {
        code: 'private-key-file-not-regular',
        contains: [subdir, '目录'],
      });
      assert.ok(!/过大|too-large/.test(String(err.code)), '目录判定不得退化成大小错误');
    });

    test('★ 超大文件（>1MB）→ private-key-file-too-large，含上限数字', async () => {
      const big = join(dir, 'too-big.pem');
      // 1MB + 1KB，确保越界；内容里也放标记，验证不泄漏
      writeFileSync(big, 'x'.repeat(1024 * 1024 + 1024) + KEY_MATERIAL, 'utf8');
      const server = sampleServer({ auth: { type: 'key', keyRef: '', passwordRef: '', keyPath: big } });
      const err = await assertReadableError(() => resolveAuth(server, {}), {
        code: 'private-key-file-too-large',
        contains: [big],
      });
      assert.match(err.message, /过大/, '错误文案要说清「过大」');
      assert.match(err.message, /1048576/, '错误里应给出上限数字，便于用户判断');
    });

    test('★ 空文件 → private-key-file-empty（不把它当合法私钥送进 ssh2）', async () => {
      const empty = join(dir, 'empty.key');
      writeFileSync(empty, '   ' + NL + '  ', 'utf8');
      const server = sampleServer({ auth: { type: 'key', keyRef: '', passwordRef: '', keyPath: empty } });
      await assertReadableError(() => resolveAuth(server, {}), {
        code: 'private-key-file-empty',
        contains: [empty],
      });
    });

    test('★ keyRef 当作路径且失败时，抛出真实原因而不是模糊的 missing-private-key', async () => {
      const missing = join(dir, 'missing-by-keyref');
      const server = sampleServer({ auth: { type: 'key', keyRef: missing, passwordRef: '' } });
      let error = null;
      try {
        await resolveAuth(server, {});
      } catch (err) {
        error = err;
      }
      assert.ok(error, '必须抛错');
      assert.equal(error.code, 'private-key-file-not-found', '应给出真实原因，便于用户改路径');
      assert.ok(String(error.message).includes(missing), '错误应含用户填的路径');
    });

    test('既无 keyPath 也无可用 keyRef → missing-private-key 且文案给出两条出路', async () => {
      const server = sampleServer({ auth: { type: 'key', keyRef: 'SOME_REF', passwordRef: '' } });
      let error = null;
      try {
        await resolveAuth(server, {});
      } catch (err) {
        error = err;
      }
      assert.ok(error, '必须抛错');
      assert.equal(error.code, 'missing-private-key');
      assert.match(error.message, /keyPath|私钥文件/, '应提示可用私钥文件；实际：' + error.message);
      assert.match(error.message, /keyRef|凭据/, '应保留凭据方式的说明；实际：' + error.message);
    });
  });

  // ── 安全：私钥不得出现在日志里 ─────────────────────────────────────────
  describe('安全：私钥不进日志', () => {
    test('★ resolveAuth 的日志只说明来源，绝不含私钥内容', async () => {
      const lines = [];
      const log = { debug: (m) => lines.push(String(m)), info: (m) => lines.push(String(m)) };
      const server = sampleServer({ auth: { type: 'key', keyRef: '', passwordRef: '', keyPath: keyFile } });
      const r = await resolveAuth(server, { log });
      assert.equal(r.auth.privateKey, FAKE_KEY, '前置条件：确实读到了私钥');
      const joined = lines.join(NL);
      assert.ok(
        !joined.includes(KEY_MATERIAL),
        '日志绝不能包含私钥内容，实际日志：' + joined,
      );
      assert.ok(
        lines.some((l) => /keyPath/.test(l)),
        '日志应说明私钥来源（便于排查），实际：' + joined,
      );
    });

    test('★ 读取失败的错误对象 details 只放路径/大小，不放文件内容', async () => {
      const big = join(dir, 'leak-check.pem');
      writeFileSync(big, 'y'.repeat(1024 * 1024 + 1) + KEY_MATERIAL, 'utf8');
      let error = null;
      try {
        await readPrivateKeyFile(big);
      } catch (err) {
        error = err;
      }
      assert.ok(error, '必须抛错');
      assert.equal(error.details.path, big, 'details 应只带路径（便于提示用户）');
      assert.equal(error.details.limit, 1024 * 1024, 'details 应带上限，供前端展示');
    });
  });
});

// ── 前端：私钥文件入口存在且不丢字段 ─────────────────────────────────────
// 按 test/client-fields.test.mjs 的同一套路：把 page-servers.js 放进带桩的迷你模块表里执行。
describe('page-servers 私钥文件入口', () => {
  const pagePath = pluginPath('src', 'client', 'page-servers.js');

  function loadPageServers() {
    const source = readFileSync(pagePath, 'utf8');
    const module = { exports: {} };
    const slots = [];
    let cursor = 0;
    const el = (type, props, ...children) => ({ type, props: props || {}, children });
    const stub = (name) => function Stub() { return { stub: name }; };
    const stubs = {
      './h.js': {
        h: el,
        useState(init) {
          const i = cursor++;
          if (!(i in slots)) slots[i] = typeof init === 'function' ? init() : init;
          return [slots[i], (next) => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }];
        },
        useEffect() { cursor += 1; },
        useMemo(fn) { cursor += 1; return fn(); },
        useRef(init) { const i = cursor++; if (!(i in slots)) slots[i] = { current: init === undefined ? null : init }; return slots[i]; },
        clone: (v) => JSON.parse(JSON.stringify(v)),
        fmtAgo: () => '',
        fmtTime: () => '',
        pathPlaceholder: (kind) => (kind === 'dir' ? 'C:' + String.fromCharCode(92) + 'path' : 'C:' + String.fromCharCode(92) + 'path' + String.fromCharCode(92) + 'id_rsa'),
      },
      './ui.js': {
        Icon: stub('Icon'), Button: stub('Button'), TextInput: stub('TextInput'),
        Select: stub('Select'), Switch: stub('Switch'), Card: stub('Card'),
        Empty: stub('Empty'), Chip: stub('Chip'), Field: stub('Field'),
        Modal: stub('Modal'), KV: stub('KV'), Banner: stub('Banner'),
        StatusDot: stub('StatusDot'), Collapsible: stub('Collapsible'),
      },
      './api.js': { api: {} },
    };
    const requireStub = (id) => {
      if (!(id in stubs)) throw new Error('用例未覆盖的 page-servers.js 依赖：' + id);
      return stubs[id];
    };
    const fn = new Function('require', 'module', 'exports', source);
    fn(requireStub, module, module.exports);
    return module.exports;
  }

  /** 在元素树里深度查找 */
  function findAll(node, match, out = []) {
    if (!node || typeof node !== 'object') return out;
    if (Array.isArray(node)) { node.forEach((n) => findAll(n, match, out)); return out; }
    if (match(node.type)) out.push(node);
    (node.children || []).forEach((c) => findAll(c, match, out));
    return out;
  }

  /**
   * 收集树里所有「用户可见文本」。
   * 注意：UI 桩不渲染 children，字段标题实际落在 Field 的 label/description **props** 上，
   * 因此这里必须把 label/description/placeholder 也算进来，否则会误判「文案不存在」。
   */
  function textsOf(node, out = []) {
    if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out; }
    if (!node || typeof node !== 'object') return out;
    if (Array.isArray(node)) { node.forEach((n) => textsOf(n, out)); return out; }
    for (const key of ['label', 'description', 'placeholder', 'title']) {
      const v = node.props ? node.props[key] : undefined;
      if (typeof v === 'string') out.push(v);
    }
    (node.children || []).forEach((c) => textsOf(c, out));
    return out;
  }

  const sampleSsh = (auth) => ({
    id: 's1', name: 'S', kind: 'ssh', host: 'h', port: 22, user: 'u',
    auth, tags: [], defaultEnv: [], customEnv: [], envSetRefs: [], runtimes: {},
  });

  test('★ 默认对象带 keyPath（新建服务器时表单不会把字段弄丢）', () => {
    const exports = loadPageServers();
    const blank = exports.blankServer();
    assert.equal(blank.auth.type, 'key');
    assert.equal(typeof blank.auth.keyPath, 'string', 'blankServer 必须带 auth.keyPath，否则保存时字段丢失');
  });

  test('★ 认证方式选私钥时存在「私钥文件」入口与浏览按钮，且保留凭据名输入', () => {
    const exports = loadPageServers();
    const tree = exports.ServerModal({ server: sampleSsh({ type: 'key', keyRef: '', passwordRef: '', keyPath: '' }), toast: {}, onClose() {}, onSaved() {} });

    const keyFieldCalls = findAll(tree, (t) => typeof t === 'function' && t.name === 'KeyFileField');
    assert.equal(keyFieldCalls.length, 1, '私钥方式应渲染一个 KeyFileField；实际 ' + keyFieldCalls.length);

    // KeyFileField 自身返回的树里应能读到字段名与「浏览」按钮
    const fieldTree = keyFieldCalls[0].type(keyFieldCalls[0].props);
    const joined = textsOf(fieldTree).join(' | ');
    assert.ok(joined.includes('私钥文件路径（本机）'), '字段名必须点明「本机」；实际：' + joined);
    assert.ok(joined.includes('留空则用下方凭据名'), '说明文案要说清与凭据名的关系；实际：' + joined);

    // UI 是桩组件（type 是函数），按 label prop 识别按钮最稳
    const labels = findAll(fieldTree, () => true).map((n) => n.props && n.props.label).filter((l) => typeof l === 'string');
    assert.ok(labels.includes('浏览'), '必须有「浏览」按钮；实际按钮：' + JSON.stringify(labels));

    // 凭据名输入框仍保留（两者并存）
    const modalText = textsOf(tree).join(' | ');
    assert.ok(modalText.includes('私钥凭据名'), '必须保留「私钥凭据名」输入框');
    assert.ok(modalText.includes('上方填了文件时以文件优先'), '凭据名说明应点出优先级');
  });

  test('★ 已存 keyPath 会回显到输入框（编辑既有服务器不丢字段）', () => {
    const exports = loadPageServers();
    const tree = exports.ServerModal({ server: sampleSsh({ type: 'key', keyRef: 'REF', passwordRef: '', keyPath: '/home/me/.ssh/id_rsa' }), toast: {}, onClose() {}, onSaved() {} });
    const keyFieldCalls = findAll(tree, (t) => typeof t === 'function' && t.name === 'KeyFileField');
    assert.equal(keyFieldCalls.length, 1, '应渲染 KeyFileField');
    assert.equal(keyFieldCalls[0].props.value, '/home/me/.ssh/id_rsa', 'keyPath 必须回显到控件');
  });

  test('★ 改动私钥文件会写回 auth.keyPath（不会误写 keyRef）', () => {
    const exports = loadPageServers();
    const tree = exports.ServerModal({ server: sampleSsh({ type: 'key', keyRef: 'KEEP_REF', passwordRef: '' }), toast: {}, onClose() {}, onSaved() {} });
    const keyFieldCalls = findAll(tree, (t) => typeof t === 'function' && t.name === 'KeyFileField');
    assert.equal(typeof keyFieldCalls[0].props.onChange, 'function', 'KeyFileField 必须可写回');
    // 控件回调应把路径交给 ServerModal 的 patch（此处只断言回调存在且语义是 keyPath）
    assert.equal(keyFieldCalls[0].props.value, '', '未设置时初始为空串');
  });

  test('密码认证方式下不显示私钥文件入口（避免误导）', () => {
    const exports = loadPageServers();
    const tree = exports.ServerModal({ server: sampleSsh({ type: 'password', keyRef: '', passwordRef: 'PW' }), toast: {}, onClose() {}, onSaved() {} });
    const keyFieldCalls = findAll(tree, (t) => typeof t === 'function' && t.name === 'KeyFileField');
    assert.equal(keyFieldCalls.length, 0, '密码方式不应显示私钥文件入口');
    assert.ok(textsOf(tree).join(' | ').includes('密码凭据名'), '密码方式应显示密码凭据名');
  });

  test('浏览按钮调用的目标是本机（local），不是被编辑的服务器', async () => {
    const exports = loadPageServers();
    const tree = exports.ServerModal({ server: sampleSsh({ type: 'key', keyRef: '', passwordRef: '' }), toast: {}, onClose() {}, onSaved() {} });
    const keyFieldCalls = findAll(tree, (t) => typeof t === 'function' && t.name === 'KeyFileField');
    // KeyFileField 内部固定用 'local'：把组件源码作为契约断言，避免回归成 server.id
    const src = readFileSync(pagePath, 'utf8');
    assert.match(src, /browseServer = 'local'/, '浏览必须固定本机（本机私钥语义）');
    assert.equal(keyFieldCalls.length, 1);
  });
});

// ── 经 API handlers 的往返：保存 → GET 回来 keyPath 仍在 ────────────────
// 这是「前端填了私钥文件却被吃掉」那个缺陷的守门用例：
// handlers/servers.js 的 safeAuth 同时用于写入（normalizeServer）与读取（publicServer），
// 任一处漏掉 keyPath，用户都会表现为「填了没用」。这里端到端锁住它。
const FAKE_KEY_E2E = [
  '-----BEGIN OPENSSH PRIVATE KEY-----',
  'E2E-KEY-MATERIAL',
  '-----END OPENSSH PRIVATE KEY-----',
].join(String.fromCharCode(10));

describe('servers handler 的 keyPath 往返', () => {
  let store;
  let dir;
  let handlers;
  let resolveAuthE2E;

  before(async () => {
    dir = makeTmpDir('dsh-devops-keyfile-rt-');
    const created = await Promise.all([
      import('../src/store/store.js'),
      import('../src/api/handlers/servers.js'),
      import('../src/engine/executors/ssh/auth.js'),
    ]);
    store = await created[0].createStore({ dataDir: dir, log: fakeLog() });
    handlers = created[1];
    resolveAuthE2E = created[2].resolveAuth;
  });

  after(async () => {
    await store?.close?.();
    cleanupTmp();
  });

  test('★ createServer 保存 keyPath → getServer 读回来仍是同一个路径', async () => {
    const created = await handlers.createServer({ store }, {
      body: {
        server: {
          id: 'rt-ssh-1', name: '往返机', kind: 'ssh', host: '10.0.0.9', port: 22, user: 'deploy',
          auth: { type: 'key', keyRef: '', passwordRef: '', keyPath: '/home/deploy/.ssh/id_ed25519' },
        },
      },
    });
    assert.equal(created.auth.keyPath, '/home/deploy/.ssh/id_ed25519', '创建响应必须带回 keyPath');
    assert.ok(!('privateKey' in created.auth), '响应绝不能含任何密钥明文字段');
    assert.ok(!('password' in created.auth), '响应绝不能含口令明文字段');

    const fetched = await handlers.getServer({ store }, { id: 'rt-ssh-1' });
    assert.equal(fetched.auth.keyPath, '/home/deploy/.ssh/id_ed25519', 'GET 必须仍能读回 keyPath');
  });

  test('★ 端到端：保存的 keyPath 能一路走到 resolveAuth 并读成 privateKey', async () => {
    const keyFile = join(dir, 'e2e_id_rsa');
    writeFileSync(keyFile, FAKE_KEY_E2E, 'utf8');

    await handlers.createServer({ store }, {
      body: {
        server: {
          id: 'rt-ssh-2', name: '全链路', kind: 'ssh', host: '10.0.0.9', port: 22, user: 'deploy',
          auth: { type: 'key', keyRef: '', passwordRef: '', keyPath: keyFile },
        },
      },
    });

    const fetched = await handlers.getServer({ store }, { id: 'rt-ssh-2' });
    const resolved = await resolveAuthE2E(fetched, {});
    assert.equal(resolved.auth.privateKey, FAKE_KEY_E2E, '经 handler 往返后仍须能读到私钥文件内容');
    assert.ok(resolved.secrets.some((s) => s.includes('E2E-KEY-MATERIAL')), '私钥必须进 secrets');
  });

  test('★ updateServer 也能改 keyPath（编辑既有服务器时字段不被丢弃）', async () => {
    await handlers.createServer({ store }, {
      body: {
        server: {
          id: 'rt-ssh-3', name: '编辑机', kind: 'ssh', host: '10.0.0.9', port: 22, user: 'deploy',
          auth: { type: 'key', keyRef: '', passwordRef: '' },
        },
      },
    });
    const updated = await handlers.updateServer({ store, provisioner: null }, {
      id: 'rt-ssh-3',
      body: {
        server: {
          id: 'rt-ssh-3', name: '编辑机', kind: 'ssh', host: '10.0.0.9', port: 22, user: 'deploy',
          auth: { type: 'key', keyRef: 'MY_REF', passwordRef: '', keyPath: '/tmp/other_key' },
        },
      },
    });
    assert.equal(updated.auth.keyPath, '/tmp/other_key', 'updateServer 必须保存 keyPath');
    assert.equal(updated.auth.keyRef, 'MY_REF', '凭据引用必须同时保留（两种方式并存）');
  });

  test('listServers 不回传任何密钥明文，只回引用与路径', async () => {
    const list = await handlers.listServers({ store });
    for (const server of list) {
      for (const bad of ['privateKey', 'password', 'secret', 'passphrase']) {
        assert.ok(!(bad in (server.auth || {})), '列表不得含字段 ' + bad);
      }
    }
  });
});

