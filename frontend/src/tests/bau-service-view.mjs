import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
for (const ext of ['.ts', '.tsx']) {
  Module._extensions[ext] = (loaded, filename) => loaded._compile(
    ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
    }).outputText, filename);
}
const { BAU_SERVICE_LEVELS, bauServiceValue, bauAccessGap, bauSpendingRows } = require('../bauServiceView.ts');
const { convertMoney, displayCurrency, validRate } = require('../currencyDisplay.tsx');
const sector = {
  bau_hh: [[80, 85], [20, 15]], target_hh: [[70, 75], [30, 25]],
  sm_access_gap: [0, 0], adjusted_basic_only_gap: [0, 0], at_least_basic_access_gap: [0, 0],
  financing_gap_by_service: [[12, 14], [8, 6]], new_capex_by_service: [[7, 9], [3, 2]],
  replacement_by_service: [[5, 6], [4, 3]], funded_by_service: [[2, 3], [1, 2]],
  cash_deficit_by_service: [[2, 2], [2, 3]],
  annual_planned_expansion_cost: [0, 40], replacement_capex: [0, 12], available_total: [0, 30],
  scenario_available_total: [0, 999], financing_gap: [20, 20], total_investment_need: [9999, 9999],
};
const before = JSON.stringify(sector);
assert.deepEqual(BAU_SERVICE_LEVELS.map(level => level.label), ['Safely managed', 'Basic only', 'At least basic']);
for (let i = 0; i < 2; i++) {
  for (const key of ['bau_hh', 'target_hh', 'financing_gap_by_service', 'new_capex_by_service',
    'replacement_by_service', 'funded_by_service', 'cash_deficit_by_service']) {
    assert.equal(bauServiceValue(sector, key, i, 'at_least_basic'), sector[key][0][i] + sector[key][1][i]);
    assert.equal(bauServiceValue(sector, key, i, 'basic'), sector[key][1][i]);
    assert.equal(bauServiceValue(sector, key, i, 'safely_managed'), sector[key][0][i]);
  }
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
assert.equal(bauSpendingRows([{ years: [2026], water_supply: { ...sector, available_total: [0] } }], 'water_supply', 2025)[0].available, 0);
for (const missing of [undefined, null, NaN, Infinity, '0']) {
  assert.throws(() => bauServiceValue({ bau_hh: [[1], [missing]] }, 'bau_hh', 0, 'at_least_basic'), /missing/);
  assert.throws(() => bauAccessGap({ at_least_basic_access_gap: [missing] }, 0, 'at_least_basic'), /missing/);
  assert.throws(() => bauSpendingRows([{ years: [2026], water_supply: { ...sector, available_total: [missing] } }], 'water_supply', 2025), /missing/);
}
assert.throws(() => bauServiceValue(undefined, 'bau_hh', 0, 'basic'), /missing/);
assert.throws(() => bauAccessGap(undefined, 0, 'basic'), /missing/);
assert.throws(() => bauSpendingRows([
  { years: [2025, 2026], water_supply: sector },
  { years: [2025, 2027], water_supply: sector },
], 'water_supply', 2025), /inconsistent/);
assert.deepEqual(bauSpendingRows([], 'sanitation', 2025), []);
const usd = { mode: 'usd', sourceCurrency: 'CDF', localPerUsd: 2309.58, rateReferenceYear: 2025 };
assert.equal(displayCurrency(usd), 'USD');
assert.equal(convertMoney(2309.58, usd), 1);
assert.equal(convertMoney(null, usd), null);
assert.equal(convertMoney(0, usd), 0);
assert.equal(convertMoney(2309.58, { ...usd, mode: 'local' }), 2309.58);
assert.equal(convertMoney(2309.58, usd, 'NPR'), 2309.58, 'An unrelated rate cannot convert a new area');
assert.equal(convertMoney(2309.58, usd, 'USD'), 2309.58, 'Already-USD inputs must not convert twice');
for (const rate of [null, 0, -4, NaN, Infinity]) {
  assert.equal(validRate({ ...usd, localPerUsd: rate }), false);
  assert.equal(displayCurrency({ ...usd, localPerUsd: rate }), 'CDF');
  assert.equal(convertMoney(2309.58, { ...usd, localPerUsd: rate }), 2309.58);
}
assert.equal(JSON.stringify(sector), before, 'Reporting must not mutate model results');
const workspace = readFileSync(new URL('../components/BAUWorkspace.tsx', import.meta.url), 'utf8');
assert.ok(workspace.indexOf('aria-label="BAU graph area"') < workspace.indexOf('aria-label="BAU sector"'));
assert.equal((workspace.match(/data-section-key=/g) || []).length, 2);
assert.ok(workspace.includes("serviceSelector('graph')") && workspace.includes("serviceSelector('table')"));
const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
assert.ok(app.includes("const tabs = ['Setup', 'Data Inputs', 'BAU Scenario'"));
assert.ok(!app.includes('<BAUWorkspace inputs='));
console.log('PASS: all three BAU views, seven exclusive/combined series, engine access gaps, annual BAU funds, missing/non-finite data, currency/rate fallback, immutable results and main navigation invariants.');
