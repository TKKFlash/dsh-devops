// 模块就绪状态总检：如实列出契约 §3 要求的每个模块是否已落地、能否 import。
// 本文件**不产生通过/失败**，只输出诊断信息（TAP diagnostic），
// 便于把"模块未就绪"与"真实 bug"在最终报告里区分开。
import { test } from 'node:test';
import { CONTRACT_MODULES, tryImport } from './helpers/modules.mjs';

test('契约模块就绪状态总检', async (t) => {
  const ready = [];
  const broken = [];
  const missing = [];

  for (const rel of CONTRACT_MODULES) {
    const r = await tryImport(rel);
    if (r.ok) ready.push(rel);
    else if (r.error) broken.push(`${rel} → ${r.reason}`);
    else missing.push(rel);
  }

  t.diagnostic(`已就绪 ${ready.length}/${CONTRACT_MODULES.length}`);
  for (const m of ready) t.diagnostic(`  [ready]   ${m}`);
  for (const m of missing) t.diagnostic(`  [missing] ${m}`);
  for (const m of broken) t.diagnostic(`  [broken]  ${m}`);
});
