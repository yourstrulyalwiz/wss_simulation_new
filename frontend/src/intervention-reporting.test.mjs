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

const { scenarioSpendingRows, interventionTableRows, interventionCoverageKpis } =
  require('./interventionReporting.ts');
const { sourceCoverageRows } = require('./sourceAttribution.ts');
const sector = {
  // Deliberately distinct values expose accidental reads from the BAU path.
  annual_planned_expansion_cost: [0, 12], replacement_capex: [0, 13], available_total: [0, 14],
  scenario_annual_planned_expansion_cost: [0, 92], scenario_replacement_capex: [0, 93], scenario_available_total: [0, 94],
  endline_financing_requirement: [0, 15], scenario_endline_financing_requirement: [0, 95],
  bau_hh: [[40, 42], [10, 12]], scenario_hh: [[55, 58], [15, 17]],
  target_hh: [[1, 1], [1, 1]], scenario_target_hh: [[60, 65], [20, 25]],
};
const result = { years: [2025, 2026], total_hh: [100, 100], water_supply: sector };

assert.deepEqual(scenarioSpendingRows([result], 'water_supply', 2025), [
  { year: 2026, expansion: 92, replacement: 93, available: 94 },
]);
assert.deepEqual(interventionTableRows(result, 'water_supply', 2025, 'at_least_basic'), [{
  year: 2026, bau: 54, scenario: 75, target: 90, expansion: 92, replacement: 93, available: 94, gap: 95,
}]);
assert.deepEqual(interventionCoverageKpis(result, 'water_supply', 2025, 'at_least_basic'), {
  baselineYear: 2025, endYear: 2026, baseline: 50, scenario: 75, target: 90,
});
assert.throws(() => scenarioSpendingRows([{ ...result, water_supply: { ...sector, scenario_available_total: undefined } }],
  'water_supply', 2025), /scenario_available_total has missing values/);
assert.throws(() => scenarioSpendingRows([{ ...result, water_supply: { ...sector, scenario_replacement_capex: [0, null] } }],
  'water_supply', 2025), /scenario_replacement_capex has missing values/);
const incomplete = interventionTableRows({ ...result, water_supply: { ...sector, scenario_available_total: [0, null] } },
  'water_supply', 2025, 'basic')[0];
assert.equal(incomplete.available, null, 'missing scenario metric stays unavailable instead of becoming zero');
assert.equal(incomplete.target, 25, 'target reads scenario_target_hh, not target_hh');

const attribution = {
  source_keys: ['baseline', 'injection'],
  sm_stock: { baseline: [0], injection: [20] }, basic_stock: { baseline: [0], injection: [10] },
  opening_baseline_stock: { sm: [30], basic: [20] },
  pure_bau_stock: { sm: [40], basic: [20] }, combined_stock: { sm: [55], basic: [25] },
};
const combined = sourceCoverageRows([2026], [100], attribution, 'water', 'at_least_basic');
assert.equal(combined.rows[0].__baseline, 50);
assert.equal(combined.rows[0].__bau, 60);
assert.equal(combined.rows[0].__scenario, 80);
assert.equal(combined.rows[0].injection, 30, 'combined source stack adds exclusive rungs exactly once');
console.log('PASS: intervention reports use scenario financials and targets, preserve missing values, and combine service rungs once.');
