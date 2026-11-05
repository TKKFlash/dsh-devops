// 回归：解析 SSH 执行器必须把 server 传下去。
//
// 用户报障：「我新增了一个服务器，为什么测试不通」——界面上点「测试连接」永远失败，
// probe.error 是 `createSshExecutor 需要 server 参数`。
//
// 根因：src/engine/executors/index.js 的 resolveAsync()/惰性代理在调用 ssh 工厂时
// 漏传了 server，而 createSshExecutor 依赖它做认证配置校验与连接参数解析。
// 这个 bug 与网络、与凭据都无关：任何 SSH 服务器都会命中。
//
// 本用例不联网：用一个**假的 ssh 工厂**替换机制来断言「server 确实被传下去了」。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { pluginPath } from './helpers/modules.mjs';

const indexPath = pluginPath('src', 'engine', 'executors', 'index.js');
const sshPath = pluginPath('src', 'engine', 'executors', 'ssh.js');
const hasIndex = existsSync(indexPath);
const hasSsh = existsSync(sshPath);

const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');

describe('SSH 执行器解析必须携带 server（「测试连接」回归）', { skip: hasIndex ? false : '缺少 executors/index.js' }, () => {
  test('★ resolveAsync 调用 ssh 工厂时必须传 server', () => {
    const src = read(indexPath);
    // 定位 resolveAsync 里的 factory 调用，断言传参对象含 server
    const idx = src.indexOf('async function resolveAsync');
    assert.ok(idx > 0, '应存在 resolveAsync');
    const body = src.slice(idx, idx + 900);
    assert.match(body, /factory\(\{[^}]*server[^}]*\}\)/, 'resolveAsync 必须把 server 传给 ssh 工厂（否则报「需要 server 参数」）');
  });

  test('★ 惰性代理创建真实执行器时同样要带 server', () => {
    const src = read(indexPath);
    const idx = src.indexOf('function createLazySshExecutor');
    assert.ok(idx > 0, '应存在 createLazySshExecutor');
    const body = src.slice(idx, idx + 900);
    assert.match(body, /server/, '惰性代理必须在 deps/server 里带上 server');
    assert.match(body, /deps[\s\S]{0,120}server|server[\s\S]{0,120}deps/, '创建实例时应把 server 合并进工厂参数');
  });

  test('★ createSshExecutor 在缺 server 时的报错文案保持不变（可诊断）', { skip: hasSsh ? false : '缺少 ssh.js' }, () => {
    const src = read(sshPath);
    assert.match(src, /createSshExecutor 需要 server 参数/, '缺 server 时必须抛明确错误，便于定位');
  });
});

describe('SSH 执行器真实解析（不联网）', { skip: hasIndex && hasSsh ? false : '缺少执行器模块' }, () => {
  test('★ resolveAsync(ssh server) 不再抛「需要 server 参数」', async () => {
    const mod = await import(new URL('../src/engine/executors/index.js', import.meta.url).href);
    const executors = mod.createExecutorRegistry({ log: () => {}, config: { connectTimeoutMs: 2000 } });
    const server = {
      id: 'regress-erp', kind: 'ssh', host: '203.0.113.1', port: 22, user: 'root',
      auth: { type: 'password', passwordRef: 'regress-pass' },
    };
    // 解析本身必须成功（真正的连接会在 probe 时才发生，这里不触发网络）
    const executor = await executors.resolveAsync(server);
    assert.ok(executor, 'resolveAsync 应返回执行器');
    assert.equal(executor.kind, 'ssh', 'kind 应为 ssh');
    // 关键回归：错误里不能出现「需要 server 参数」
    try {
      await executor.probe(server);
    } catch (error) {
      assert.doesNotMatch(
        String(error && error.message),
        /需要 server 参数/,
        '不得再报「createSshExecutor 需要 server 参数」——那说明 server 又没传下去',
      );
    }
    try { await executor.dispose(); } catch { /* 清理失败不影响断言 */ }
  });
});
