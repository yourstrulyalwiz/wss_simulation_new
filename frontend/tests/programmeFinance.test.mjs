import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const { outputText } = ts.transpileModule(
  readFileSync(new URL('../src/programmeFinance.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
);
const exports = {};
new Function('exports', outputText)(exports);
const { cumulativeAnnualFlow, closingCashAtPeriodEnd } = exports;

test('programme totals sum forecast flows, excluding historical costs', () => {
  assert.equal(cumulativeAnnualFlow([1000, 100, 100, 100], [2025, 2026, 2027, 2028], 2025), 300);
  assert.equal(cumulativeAnnualFlow([0, 0, 40, 0], [2025, 2026, 2027, 2028], 2025), 40);
});

test('period cash is its final balance, not a sum of repeated carried cash', () => {
  const years = [2025, 2026, 2027, 2028, 2029];
  const balances = [0, 100, 100, 100, 40];
  assert.equal(closingCashAtPeriodEnd(balances, years, 2026, 2029), 40);
  assert.equal(closingCashAtPeriodEnd(balances, years, 2026, 2028), 100);
});