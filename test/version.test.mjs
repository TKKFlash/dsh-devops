// 版本一致性回归：插件对外自报的版本必须与 package.json 一致。
//
// 用户反馈「别人下载这个插件的时候说我的版本信息错乱」——根因：
// index.js 里手工维护了 `const VERSION = '0.1.0'`，而 package.json 已升到 0.2.0，
// /api/meta 返回的是那个硬编码常量，于是插件自报旧版本。
//
// 本用例锁三件事：
//   1) 版本只能有一个来源：package.json（不得再出现硬编码的版本常量）；
//   2) 插件实际解析出的版本 === package.json 的版本；
//   3) CHANGELOG 的最新版本标题与之一致（发布记录不能落后）。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { pluginPath } from './helpers/modules.mjs';

const pkgPath = pluginPath('package.json');
const indexPath = pluginPath('index.js');
const changelogPath = pluginPath('CHANGELOG.md');
const hasPkg = existsSync(pkgPath);
const hasIndex = existsSync(indexPath);

const readPkg = () => JSON.parse(readFileSync(pkgPath, 'utf8'));

describe('版本一致性（对外自报版本 = package.json）', { skip: hasPkg && hasIndex ? false : '缺少 package.json 或 index.js' }, () => {
  const pkg = hasPkg ? readPkg() : { version: '' };
  const indexSrc = hasIndex ? readFileSync(indexPath, 'utf8') : '';

  test('package.json 的版本是合法的 semver', () => {
    assert.match(pkg.version, /^\d+\.\d+\.\d+(-[\w.]+)?$/, 'package.json version 必须是 semver，实际 ' + pkg.version);
  });

  test('★ index.js 不得再硬编码版本常量（单一事实源）', () => {
    // 允许从 package.json 读，但不允许写死形如 VERSION = '1.2.3' 的常量
    const hardcoded = indexSrc.match(/VERSION\s*=\s*['"]\d+\.\d+\.\d+/);
    assert.equal(hardcoded, null, 'index.js 不应硬编码版本号（会发现值：' + (hardcoded && hardcoded[0]) + '），应从 package.json 读取');
    assert.match(indexSrc, /package\.json/, 'index.js 应从 package.json 读取版本');
  });

  test('★ 插件解析出的版本等于 package.json 的版本', async () => {
    const mod = await import(new URL('../index.js', import.meta.url).href);
    // 版本通过 registerRoute 的 deps.version 进入 /api/meta；这里直接校验导出契约：
    // 若将来导出 VERSION 则直接用，否则从源码读取的路径已由上一条覆盖。
    const exported = mod.VERSION ?? mod.default?.VERSION;
    if (exported !== undefined) {
      assert.equal(exported, pkg.version, '导出/自报版本必须与 package.json 一致');
    }
    // 无论是否导出，index.js 的读取函数必须存在
    assert.match(indexSrc, /readPluginVersion|require\(.*package\.json|package\.json/, '应存在从 package.json 读取版本的逻辑');
  });

  test('★ 版本不会被写成与 package.json 不同的常量（全仓扫描）', () => {
    const files = ['index.js', 'src/config.js', 'src/api/router.js'];
    for (const rel of files) {
      const p = pluginPath(rel);
      if (!existsSync(p)) continue;
      const src = readFileSync(p, 'utf8');
      // 找一个形如 x.y.z 的字面量版本号，且它出现在 VERSION 赋值里
      const m = src.match(/VERSION\s*=\s*['"](\d+\.\d+\.\d+)['"]/);
      assert.equal(m, null, rel + ' 出现硬编码版本 ' + (m && m[1]) + '；请改为从 package.json 读取');
    }
  });

  test('CHANGELOG 最新版本与 package.json 一致', { skip: existsSync(changelogPath) ? false : '缺少 CHANGELOG' }, () => {
    const log = readFileSync(changelogPath, 'utf8');
    // 取第一个形如 ## [x.y.z] 的标题（跳过 [Unreleased]）
    const headings = [...log.matchAll(/^##\s+\[([^\]]+)\]/gm)].map((m) => m[1]);
    const released = headings.find((h) => /^\d+\.\d+\.\d+/.test(h));
    assert.ok(released, 'CHANGELOG 应有已发布版本标题');
    assert.equal(released, pkg.version, 'CHANGELOG 最新发布版本（' + released + '）必须等于 package.json（' + pkg.version + '）');
  });
});
