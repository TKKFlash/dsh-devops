/**
 * 节点：condition.if —— 条件分支
 *
 * 表达式由 src/engine/nodes/expr.js 的安全迷你求值器解析：只支持比较与 && || !，
 * **不使用 eval / new Function**，因此不存在代码注入面。
 *
 * 语义：条件为假时返回 exitCode=0 且 outputs.condition=false，
 * 下游如需据此跳过，可把依赖它的 job 的 when 设为 on_success 并在表达式里引用该输出。
 */
import { F } from '../helpers.js';
import { evaluateExpression, validateExpression } from '../expr.js';

export const descriptor = {
  type: 'condition.if',
  title: '条件判断',
  category: 'flow',
  icon: 'git-branch',
  description: '按表达式判断是否继续；表达式只允许比较与 && || !，禁止执行代码',
  fields: [
    F.code('condition', '条件表达式', 'javascript', {
      required: true,
      placeholder: "steps.build.exitCode == 0 && env.ENV != 'dev'",
      description: '可用引用：env.*、steps.<jobId>.<字段>、run.*、job.*；运算符 == != === !== > >= < <= =~ !~ && || !',
    }),
    F.boolean('failWhenFalse', '条件不成立则失败', { default: false, description: '关闭时条件不成立仅记录并继续' }),
    F.text('message', '提示信息', { rows: 2, placeholder: '条件不成立，跳过部署' }),
  ],
  outputs: [
    { name: 'condition', type: 'boolean' },
    { name: 'value', type: 'string', description: '表达式求值结果的字符串形式' },
  ],
  env: [],
  runtime: null,

  async run(rt, inputs = {}) {
    const expression = String(inputs.condition ?? '').trim();
    if (!expression) return { exitCode: 1, error: '条件表达式不能为空' };

    // 先做语法校验：保存流水线时 API 也会调用 validateExpression
    const syntax = validateExpression(expression);
    if (!syntax.ok) {
      return { exitCode: 1, error: `条件表达式语法错误：${syntax.message}` };
    }

    const context = {
      env: rt.env ?? {},
      steps: rt.run?.steps ?? {},
      run: rt.run ?? {},
      job: rt.step ?? {},
      variables: rt.run?.variables ?? {},
      server: rt.server ?? {},
    };

    let evaluated;
    try {
      evaluated = evaluateExpression(expression, context);
    } catch (error) {
      return { exitCode: 1, error: `条件求值失败：${error?.message ?? error}` };
    }

    const value = evaluated.value;
    const outputs = {
      condition: evaluated.truthy,
      value: value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value),
    };

    if (typeof rt.log === 'function') {
      rt.log(`条件 ${expression} → ${outputs.value}（${evaluated.truthy ? '成立' : '不成立'}）\n`, 'stdout');
      if (!evaluated.truthy && inputs.message) rt.log(`${inputs.message}\n`, 'stdout');
    }

    if (!evaluated.truthy && inputs.failWhenFalse === true) {
      return { exitCode: 1, outputs, error: `条件不成立：${expression}` };
    }
    return { exitCode: 0, outputs };
  },
};

export default descriptor;
