// 语法着色引擎（src/client/syntax.js）回归：
// 用户诉求「编码编写框需要格式化，比如是黑色的符合Linux终端，可以识别 python 代码，js，shell 等等，
// 按不同编码颜色显示」——颜色由 CSS 决定，本用例只锁「语义分类是否正确」。
// 纯函数、零依赖：把源文件放进迷你模块表里执行，不需要 DOM / 浏览器。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { pluginPath } from './helpers/modules.mjs';

const syntaxPath = pluginPath('src', 'client', 'syntax.js');
const hasSyntax = existsSync(syntaxPath);

function loadSyntax() {
  const source = readFileSync(syntaxPath, 'utf8');
  const module = { exports: {} };
  const requireStub = (id) => { throw new Error('syntax.js 应当零依赖，但 require 了 ' + id); };
  new Function('module', 'exports', 'require', source)(module, module.exports, requireStub);
  return module.exports;
}

/** kind -> 该行里属于这个 kind 的文本数组。 */
const kindsOf = (s, line, lang) => {
  const out = {};
  for (const token of s.tokenizeLine(line, lang)) {
    if (!out[token.kind]) out[token.kind] = [];
    out[token.kind].push(token.text);
  }
  return out;
};

describe('syntax 语法着色引擎', { skip: hasSyntax ? false : '缺少 src/client/syntax.js' }, () => {
  const s = hasSyntax ? loadSyntax() : null;

  test('导出契约：tokenize / tokenizeLine / tokenizeLines / detectLanguage / normalizeLanguage / KINDS', () => {
    for (const name of ['tokenize', 'tokenizeLine', 'tokenizeLines', 'detectLanguage', 'normalizeLanguage']) {
      assert.equal(typeof s[name], 'function', name + ' 必须是函数');
    }
    assert.ok(Array.isArray(s.KINDS) && s.KINDS.length >= 8, 'KINDS 应列出全部语义类别');
    for (const kind of ['plain', 'keyword', 'string', 'comment', 'number', 'function', 'operator', 'builtin', 'variable', 'type']) {
      assert.ok(s.KINDS.includes(kind), 'KINDS 缺少 ' + kind);
    }
  });

  test('★ Python：关键字/注释/字符串/数字/内置函数分别归类', () => {
    const k = kindsOf(s, 'def f(x):  # 注释', 'python');
    assert.deepEqual(k.keyword, ['def'], 'def 应是关键字');
    assert.ok(k.comment && k.comment.join('').includes('注释'), '注释应单独归类');
    const nums = kindsOf(s, 'x = 42', 'python');
    assert.deepEqual(nums.number, ['42'], '数字应归类');
    const builtin = kindsOf(s, 'print(1)', 'python');
    assert.deepEqual(builtin.builtin, ['print'], 'print 应是内置');
    const str = kindsOf(s, 'a = "hi"', 'python');
    assert.deepEqual(str.string, ['"hi"'], '字符串应归类');
  });

  test('★ JavaScript：const/await 是关键字，// 是注释，fetch 是内置', () => {
    const k = kindsOf(s, 'const x = await fetch(url); // go', 'javascript');
    assert.ok(k.keyword.includes('const') && k.keyword.includes('await'));
    assert.ok(k.comment && k.comment.join('').includes('// go'));
    assert.deepEqual(k.builtin, ['fetch']);
    assert.ok(k.operator.includes('=') && k.operator.includes(';'));
  });

  test('★ Shell：内置命令、$VAR 变量、# 注释、管道操作符', () => {
    const k = kindsOf(s, 'echo "hi $NAME" | grep -v x # note', 'shell');
    assert.ok(k.builtin.includes('echo') && k.builtin.includes('grep'), 'shell 内置命令');
    assert.ok(k.variable && k.variable.join('').includes('$NAME'), '$NAME 应是变量');
    assert.ok(k.operator.includes('|'), '管道应是操作符');
    assert.ok(k.comment && k.comment.join('').includes('# note'));
  });

  test('字符串里的 # 与 // 不得被当成注释（优先级正确）', () => {
    const py = kindsOf(s, 'url = "http://x/#frag"', 'python');
    assert.ok(!py.comment, 'Python 字符串内的 # 不应是注释');
    const js = kindsOf(s, 'const u = "http://x";', 'javascript');
    assert.ok(!js.comment, 'JS 字符串内的 // 不应是注释');
  });

  test('detectLanguage：shebang、python 特征、js 特征、json 形状、默认 shell', () => {
    assert.equal(s.detectLanguage('#!/usr/bin/env python3\nprint(1)'), 'python');
    assert.equal(s.detectLanguage('def f():\n    return 1'), 'python');
    assert.equal(s.detectLanguage('const a = 1; // x'), 'javascript');
    assert.equal(s.detectLanguage('{"a": 1}'), 'json');
    assert.equal(s.detectLanguage('#!/bin/bash\necho hi'), 'shell');
    assert.equal(s.detectLanguage('npm ci && npm run build'), 'shell');
  });

  test('normalizeLanguage：别名归一（ts/bash/py/node/yml 等）', () => {
    assert.equal(s.normalizeLanguage('ts'), 'javascript');
    assert.equal(s.normalizeLanguage('jsx'), 'javascript');
    assert.equal(s.normalizeLanguage('bash'), 'shell');
    assert.equal(s.normalizeLanguage('sh'), 'shell');
    assert.equal(s.normalizeLanguage('py'), 'python');
    assert.equal(s.normalizeLanguage('node'), 'javascript');
    assert.equal(s.normalizeLanguage('yml'), 'yaml');
    assert.equal(s.normalizeLanguage(''), 'shell', '空值默认 shell');
    assert.equal(s.normalizeLanguage('unknown-lang'), 'shell', '未知语言回退 shell');
  });

  test('token 无损：拼回原文必须与输入完全一致（换行与空格都不能丢）', () => {
    const samples = [
      ['def f(x):\n    return x + 1\n', 'python'],
      ['const a = 1;\n// c\n', 'javascript'],
      ['echo "a  b" | wc -l\n', 'shell'],
      ['{\n  "a": [1, 2]\n}\n', 'json'],
    ];
    for (const [code, lang] of samples) {
      const joined = s.tokenize(code, lang).map((t) => t.text).join('');
      assert.equal(joined, code, lang + '：token 拼回必须与原文一致');
    }
  });

  test('tokenizeLines：行数正确，且每行不含换行符', () => {
    const lines = s.tokenizeLines('a=1\nb=2\nc=3', 'python');
    assert.equal(lines.length, 3);
    for (const line of lines) {
      for (const token of line) assert.ok(!token.text.includes('\n'), '行内 token 不得含换行');
    }
    assert.equal(lines[0].map((t) => t.text).join(''), 'a=1');
  });

  test('空输入与未知语言不抛错（健壮性）', () => {
    assert.deepEqual(s.tokenizeLine('', 'python'), []);
    assert.deepEqual(s.tokenizeLine(null, 'python'), []);
    assert.doesNotThrow(() => s.tokenizeLines('abc', 'no-such-lang'));
    assert.doesNotThrow(() => s.tokenize(undefined, undefined));
  });

  test('零依赖：源文件不 require 任何模块（可安全用于最小环境）', () => {
    const source = readFileSync(syntaxPath, 'utf8');
    assert.ok(!/require\s*\(/.test(source), 'syntax.js 不应 require 任何模块');
  });
});
