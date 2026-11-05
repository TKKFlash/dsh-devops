// 契约 §3.4：src/model/glob.js —— 零依赖 glob
// 覆盖：** * ? {a,b} 与 ! 取反、大小写开关、filterPaths 的 matched/ignored 划分
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { suiteFor, requiredFn } from './helpers/modules.mjs';

const rel = 'src/model/glob.js';
const { mod, skip, reason } = await suiteFor(rel);

describe('model/glob', { skip }, () => {
  const compile = requiredFn(mod, 'compile', rel);
  const matchOne = requiredFn(mod, 'matchOne', rel);
  const filterPaths = requiredFn(mod, 'filterPaths', rel);

  test('compile() 返回 { test, negated, source }', () => {
    const g = compile('src/**/*.js');
    assert.equal(typeof g.test, 'function', 'compile().test 必须是函数');
    assert.equal(typeof g.negated, 'boolean', 'compile().negated 必须是布尔');
    assert.equal(typeof g.source, 'string', 'compile().source 必须是字符串');
    assert.equal(g.negated, false);
  });

  test('compile().test 与 matchOne 语义一致', () => {
    const g = compile('src/**/*.js');
    for (const p of ['src/a.js', 'src/deep/nested/b.js', 'other/a.js']) {
      assert.equal(g.test(p), matchOne('src/**/*.js', p), `compile/test 与 matchOne 对 ${p} 结论必须一致`);
    }
  });

  test('* 不跨越路径分隔符', () => {
    assert.equal(matchOne('*.js', 'a.js'), true);
    assert.equal(matchOne('*.js', 'dir/a.js'), false, '* 不应跨越 /');
    assert.equal(matchOne('src/*.js', 'src/a.js'), true);
    assert.equal(matchOne('src/*.js', 'src/deep/a.js'), false);
  });

  test('** 可跨越任意层级', () => {
    assert.equal(matchOne('**/*.js', 'a.js'), true);
    assert.equal(matchOne('**/*.js', 'x/y/z/a.js'), true);
    assert.equal(matchOne('dist/**', 'dist/a/b/c.js'), true);
    assert.equal(matchOne('dist/**', 'dist'), true, 'dist/** 应匹配 dist 自身');
  });

  test('? 匹配单个字符且不跨分隔符', () => {
    assert.equal(matchOne('a?c', 'abc'), true);
    assert.equal(matchOne('a?c', 'ac'), false);
    assert.equal(matchOne('a?c', 'a/c'), false, '? 不应匹配 /');
  });

  test('{a,b} 花括号展开（可含多层级）', () => {
    assert.equal(matchOne('*.{js,ts}', 'a.js'), true);
    assert.equal(matchOne('*.{js,ts}', 'a.ts'), true);
    assert.equal(matchOne('*.{js,ts}', 'a.mjs'), false);
    assert.equal(matchOne('src/{a,b}/*.js', 'src/a/x.js'), true);
    assert.equal(matchOne('src/{a,b}/*.js', 'src/c/x.js'), false);
    assert.equal(matchOne('{a,b{c,d}}', 'bd'), true, '嵌套花括号');
  });

  test('! 前缀取反：negated 标记；compile().test 与 matchOne 对同一输入结论必须一致', () => {
    const g = compile('!*.md');
    assert.equal(g.negated, true, 'compile("!*.md").negated 必须为 true');
    // 契约要求 matchOne 支持「! 前缀取反」。取反的判定结果必须自洽：
    const cases = ['a.md', 'a.js', 'dir/b.md'];
    for (const p of cases) {
      assert.equal(
        g.test(p),
        matchOne('!*.md', p),
        `取反模式对 ${p}：compile().test 与 matchOne 必须一致`,
      );
    }
    // 取反的含义：被 * 命中的应被排除（false），未命中的保留（true）
    assert.equal(matchOne('!*.md', 'a.md'), false, '!*.md 应排除 a.md（返回 false）');
    assert.equal(matchOne('!*.md', 'a.js'), true, '!*.md 应保留 a.js（返回 true）');
  });

  test('取反语义必须在 model/glob 与 ssh/glob 降级实现之间一致（跨模块防漂移）', async () => {
    const sshGlob = await import('../src/engine/executors/ssh/glob.js').catch(() => null);
    if (!sshGlob?.fallbackMatchOne) return; // SSH 模块未就绪则跳过该交叉校验
    for (const p of ['a.md', 'a.js', 'dist/x.md']) {
      assert.equal(
        matchOne('!*.md', p),
        sshGlob.fallbackMatchOne('!*.md', p),
        `取反语义在两个实现间不一致（路径 ${p}）：model/glob 与 ssh 降级实现可能反转了 ! 的含义`,
      );
    }
  });

  test('filterPaths 区分 matched / ignored 且保留 patterns', () => {
    const paths = ['dist/a.js', 'dist/b.js', 'dist/c.map', 'src/d.js'];
    const r = filterPaths(['dist/**', '!**/*.map'], paths);
    assert.deepEqual(r.patterns, ['dist/**', '!**/*.map'], 'patterns 应原样回带');
    assert.deepEqual(r.matched.sort(), ['dist/a.js', 'dist/b.js'], '被 ! 排除的不应进 matched');
    assert.ok(r.ignored.includes('dist/c.map'), `被 ! 显式排除的应进 ignored，实际 ${JSON.stringify(r.ignored)}`);
    // matched 必须是输入的子集且与 ignored 不重叠
    for (const p of r.matched) assert.ok(paths.includes(p), `matched 含非输入路径 ${p}`);
    for (const p of r.ignored) assert.ok(paths.includes(p), `ignored 含非输入路径 ${p}`);
    assert.equal(r.matched.filter((p) => r.ignored.includes(p)).length, 0, 'matched 与 ignored 不得重叠');
  });

  test('filterPaths 默认大小写敏感，caseSensitive:false 时忽略大小写', () => {
    assert.deepEqual(filterPaths(['*.JS'], ['a.js']).matched, [], '默认应大小写敏感');
    assert.deepEqual(filterPaths(['*.JS'], ['a.js'], { caseSensitive: false }).matched, ['a.js']);
  });

  test('filterPaths 无正向 pattern 时 matched 为空', () => {
    const r = filterPaths(['!**/*.md'], ['a.js', 'b.md']);
    assert.deepEqual(r.matched, [], '只有取反 pattern 时不应匹配任何文件');
    assert.ok(r.ignored.includes('b.md'), '被取反命中的 b.md 应进 ignored');
  });

  test('filterPaths 顺序语义：后出现的模式覆盖先前的判定（gitignore 风格）', () => {
    const r = filterPaths(['**/*.js', '!dist/**', 'dist/keep.js'], ['src/a.js', 'dist/b.js', 'dist/keep.js']);
    assert.ok(r.matched.includes('src/a.js'), 'src/a.js 应命中');
    assert.ok(!r.matched.includes('dist/b.js'), 'dist/b.js 被 !dist/** 排除');
    assert.ok(r.matched.includes('dist/keep.js'), '后置的正模式应重新纳入 dist/keep.js');
  });

  test('filterPaths 去重：重复输入路径只出现一次', () => {
    const r = filterPaths(['*.js'], ['a.js', 'a.js', 'b.js']);
    assert.equal(r.matched.length, 2, `重复输入应去重，实际 ${JSON.stringify(r.matched)}`);
  });

  test('特殊字符按字面处理，不当作正则元字符', () => {
    assert.equal(matchOne('a+b.js', 'a+b.js'), true, '+ 应作字面量');
    assert.equal(matchOne('a+b.js', 'aab.js'), false, '+ 不得被当作正则量词');
    assert.equal(matchOne('a.b', 'axb'), false, '. 应作字面量，不得匹配任意字符');
    assert.equal(matchOne('a(1).js', 'a(1).js'), true, '括号应作字面量');
  });

  test('空 pattern / 空路径的边界行为不抛异常', () => {
    assert.doesNotThrow(() => compile(''));
    assert.doesNotThrow(() => matchOne('', ''));
    assert.equal(matchOne('', ''), true, '空 pattern 匹配空路径');
  });
});
