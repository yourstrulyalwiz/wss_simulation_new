import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const ts = createRequire(import.meta.url)(process.env.TYPESCRIPT_PATH || 'typescript');
const source = readFileSync(new URL('../src/bauServiceView.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const { bauServiceValue, bauAccessGap, bauSpendingRows } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

const sector = {
  bau_hh: [[80, 85], [20, 15]],
  target_hh: [[70, 75], [30, 25]],
  sm_access_gap: [0, 0], adjusted_basic_only_gap: [0, 0], at_least_basic_access_gap: [0, 0],
  financing_gap_by_service: [[12, 14], [8, 6]],
  annual_planned_expansion_cost: [0, 40], replacement_capex: [0, 12], available_total: [0, 30],
  scenario_available_total: [0, 999], financing_gap: [20, 20], total_investment_need: [9999, 9999],
};
const before = JSON.stringify(sector);
for (let i = 0; i < 2; i++) {
  assert.equal(bauServiceValue(sector, 'bau_hh', i, 'at_least_basic'), 100);
  assert.equal(bauServiceValue(sector, 'target_hh', i, 'at_least_basic'), 100);
  assert.equal(bauServiceValue(sector, 'financing_gap_by_service', i, 'at_least_basic'), 20);
  assert.equal(bauServiceValue(sector, 'bau_hh', i, 'basic'), sector.bau_hh[1][i]);
  assert.equal(bauServiceValue(sector, 'bau_hh', i, 'safely_managed'), sector.bau_hh[0][i]);
  assert.equal(bauAccessGap(sector, i, 'at_least_basic'), 0, 'SM upgrades must not create loss of basic access');
}
const rural = { ...sector, bau_hh: [[50, 55], [25, 25]], sm_access_gap: [20, 20],
  adjusted_basic_only_gap: [5, 0], at_least_basic_access_gap: [25, 20] };
assert.equal(bauAccessGap(rural, 0, 'basic'), 5);
assert.equal(bauAccessGap(rural, 0, 'safely_managed'), 20);
assert.equal([sector, rural].reduce((sum, area) => sum + bauAccessGap(area, 1, 'at_least_basic'), 0), 20);
for (const key of ['water_supply', 'sanitation']) {
  const results = [sector, rural].map(area => ({ years: [2025, 2026], [key]: area }));
  assert.deepEqual(bauSpendingRows(results, key, 2025), [{ year: 2026, expansion: 80, replacement: 24, available: 60 }]);
  assert.deepEqual(bauSpendingRows(results, key, 2026), []);
}
assert.throws(() => bauServiceValue({ bau_hh: [[1]] }, 'bau_hh', 0, 'at_least_basic'), /missing/);
assert.throws(() => bauAccessGap({}, 0, 'at_least_basic'), /missing/);
assert.throws(() => bauSpendingRows([{ years: [2026], water_supply: {} }], 'water_supply', 2025), /missing/);
assert.throws(() => bauSpendingRows([
  { years: [2025, 2026], water_supply: sector },
  { years: [2025, 2027], water_supply: sector },
], 'water_supply', 2025), /inconsistent/);
assert.equal(JSON.stringify(sector), before);
console.log('PASS: exclusive/combined BAU coverage, financial attribution, local access gaps, annual BAU spending, missing data and unchanged inputs.');
