import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/budgetExecutionRate.ts', import.meta.url), 'utf8');
const js = ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 });
const { budgetExecutionRate: rate } =
  await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
assert.equal(rate(70, 100), .7);
assert.equal(rate(0, 100), 0);
assert.equal(rate(120, 100), 1.2);
for (const [executed, allocated] of [[0, 0], [100, 0], [null, 100], [100, undefined], [NaN, 100], [100, Infinity], [-1, 100]])
  assert.equal(rate(executed, allocated), null);
const panel = readFileSync(new URL('../src/components/InputPanel.tsx', import.meta.url), 'utf8');
for (const [prefix, sector] of [['ws', 'water_supply'], ['san', 'sanitation']]) {
  const label = panel.indexOf(`label: '${prefix.toUpperCase()} executed budget'`);
  const row = panel.indexOf(`executionRateRow('${prefix}', '${sector}')`, label);
  assert.ok(label > 0 && row > label);
  assert.ok(!panel.slice(label, row).includes("label: '"+(prefix === 'ws' ? 'SAN' : 'WS')));
}
console.log('Budget execution rate checks passed.');
