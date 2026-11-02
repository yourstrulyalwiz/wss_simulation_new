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

const { scenarioSpendingRows, interventionTableRows, interventionCoverageKpis, interventionComparisonRows } =
  require('./interventionReporting.ts');
const { forecastTableHeaders } = require('./forecastTableColumns.ts');
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

const comparisonSector = {
  ...sector, financing_gap: [0, 77],
  at_least_basic_access_gap: [0, 19], sm_access_gap: [0, 9], adjusted_basic_only_gap: [0, 10],
  new_capex_by_service: [[0, 7], [0, 3]], replacement_by_service: [[0, 6], [0, 4]],
  funded_by_service: [[0, 2], [0, 1]], replacement_backlog_closing_by_service: [[0, 8], [0, 2]],
  financing_gap_by_service: [[0, 12], [0, 5]],
};
const comparisonResult = { ...result, water_supply: comparisonSector };
assert.deepEqual(interventionComparisonRows(comparisonResult, 'water_supply', 2025, 'at_least_basic'), [
  [2026, 100, 54, 2, 19, 10, 10, 3, 10, 17, 77, 14, 75, 94],
], 'BAU statistics stay unchanged; only the final two columns use the scenario');
for (const [level, rung, gap] of [['safely_managed', 0, 9], ['basic', 1, 10]]) {
  const row = interventionComparisonRows(comparisonResult, 'water_supply', 2025, level)[0];
  assert.equal(row[4], gap, 'access gap is the engine-assessed gap, not target minus coverage');
  assert.equal(row[5], comparisonSector.new_capex_by_service[rung][1]);
  assert.equal(row[8], comparisonSector.replacement_backlog_closing_by_service[rung][1]);
  assert.equal(row[12], comparisonSector.scenario_hh[rung][1]);
  assert.equal(row[11], 14, 'sector available funding is not split by service level');
  assert.equal(row[13], 94);
  assert.equal(forecastTableHeaders(level, 'USD').length, 12);
}
const missingComparison = interventionComparisonRows({ ...result, water_supply: {
  ...comparisonSector, scenario_available_total: [0, null], funded_by_service: [[0, 0], [0, null]],
} }, 'water_supply', 2025, 'at_least_basic')[0];
assert.equal(missingComparison[7], null, 'incomplete service metrics remain unavailable');
assert.equal(missingComparison[13], null, 'missing intervention funding does not fall back to BAU');
assert.deepEqual(interventionComparisonRows({ ...comparisonResult, sanitation: comparisonSector }, 'sanitation', 2025, 'at_least_basic'),
  interventionComparisonRows(comparisonResult, 'water_supply', 2025, 'at_least_basic'), 'both sectors use identical reporting semantics');

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
