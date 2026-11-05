#!/usr/bin/env node
/**
 * dsh-devops 前端拼接脚本（零依赖、可重复执行、幂等）。
 *
 * 把 src/client/*.js 按固定依赖顺序拼接成根目录单文件 client.js，
 * 输出形状严格遵循契约 §3.13：
 *
 *   window.__ModuleLoader__.load({ id:'dsh-devops', factory:(require)=>{ ... } })
 *
 * factory 内部带一个迷你模块表：每个源文件被包成
 *   __def('<name>', function (module, exports, require) { ...源码... })
 * 模块之间用 require('./api.js') 互相引用；未命中的 id 透传给宿主 require
 * （因此 require('react') 走宿主 module table 白名单）。
 *
 * 用法：node scripts/build-client.mjs [--check]
 *   --check  只校验是否已是最新（CI 用），不写盘；有差异则退出码 1。
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SRC_DIR = join(ROOT, 'src', 'client');
const OUT_FILE = join(ROOT, 'client.js');

/** 唯一的插件 id；client.js 顶层 id 与 factory 返回的 exports 都以此为准。 */
const PLUGIN_ID = 'dsh-devops';

/**
 * 显式依赖顺序（谨慎修改）。
 * 拼接只是文本合并，真正的模块解析发生在运行时，但保持此顺序让产物可读、可 diff。
 * 任何新增的 src/client/*.js 都必须登记在这里，否则构建报错——防止漏文件。
 */
const ORDER = [
  'h.js',
  'styles.js',
  'api.js',
  'sse.js',
  'state.js',
  'ui.js',
  'fields.js',
  'diagnostics.js',
  'logs.js',
  'canvas.js',
  'ai.js',
  'editor.js',
  'page-overview.js',
  'page-pipelines.js',
  'page-templates.js',
  'page-runs.js',
  'page-servers.js',
  'page-resources.js',
  'page-nodes.js',
  'page-settings.js',
  'statusbar.js',
  'app.js',
  'index.js',
];

const checkOnly = process.argv.includes('--check');

/** 把一份源码包进迷你模块表条目。使用函数包裹，保证模块作用域彼此隔离。 */
function wrapModule(name, code) {
  const body = code.replace(/\s+$/, '');
  return `__def(${JSON.stringify('./' + name)}, function (module, exports, require) {\n${body}\n});\n`;
}

/** 生成整个 client.js 的文本。纯函数，同样的输入必然得到同样的字节。 */
function emit(modules) {
  const header = `/**
 * dsh-devops 前端产物 —— 由 scripts/build-client.mjs 自动生成，请勿手工编辑。
 * 修改界面请改 src/client/*.js，然后运行：node scripts/build-client.mjs
 */
window.__ModuleLoader__.load({
  id: ${JSON.stringify(PLUGIN_ID)},
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    // ---- 迷你模块表 ----------------------------------------------------
    var __defs = Object.create(null);
    var __cache = Object.create(null);
    function __def(id, fn) { __defs[id] = fn; }
    function __req(id) {
      var def = __defs[id];
      if (def === undefined) return require(id); // 宿主 module table（白名单）
      var hit = __cache[id];
      if (hit !== undefined) return hit.exports;
      var m = { exports: {} };
      __cache[id] = m;
      def(m, m.exports, __req);
      return m.exports;
    }
    function __has(id) { return __defs[id] !== undefined; }
    // -------------------------------------------------------------------

`;
  const footer = `
    return __req('./index.js');
  }
});
`;
  const body = modules.map((m) => wrapModule(m.name, m.code)).join('\n');
  return header + body + footer;
}

async function main() {
  if (!existsSync(SRC_DIR)) {
    console.error(`[build-client] 缺少目录：${SRC_DIR}`);
    process.exit(1);
  }

  const onDisk = (await readdir(SRC_DIR)).filter((f) => f.endsWith('.js')).sort();
  const missing = onDisk.filter((f) => !ORDER.includes(f));
  const absent = ORDER.filter((f) => !onDisk.includes(f));
  if (missing.length > 0) {
    console.error('[build-client] 以下源文件未登记进 ORDER：' + missing.join(', '));
    process.exit(1);
  }
  if (absent.length > 0) {
    console.error('[build-client] ORDER 中登记了不存在的文件：' + absent.join(', '));
    process.exit(1);
  }

  const modules = [];
  for (const name of ORDER) {
    const code = await readFile(join(SRC_DIR, name), 'utf8');
    if (/^\s*(import|export)\s/m.test(code)) {
      console.error(`[build-client] ${name} 含 ESM import/export，拼接产物不支持；请改用 require('./x.js')`);
      process.exit(1);
    }
    modules.push({ name, code });
  }

  const output = emit(modules);
  let previous = '';
  try {
    previous = await readFile(OUT_FILE, 'utf8');
  } catch {
    previous = '';
  }

  if (previous === output) {
    console.log(`[build-client] client.js 已是最新（${ORDER.length} 个模块，${output.length} 字节）`);
    return;
  }

  if (checkOnly) {
    console.error('[build-client] client.js 与源码不一致，请重新运行 node scripts/build-client.mjs');
    process.exit(1);
  }

  await writeFile(OUT_FILE, output, 'utf8');
  console.log(`[build-client] 已写出 client.js（${ORDER.length} 个模块，${output.length} 字节）`);
}

main().catch((error) => {
  console.error('[build-client] 失败：' + (error && error.stack ? error.stack : String(error)));
  process.exit(1);
});
