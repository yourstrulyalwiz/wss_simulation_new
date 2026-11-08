import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
Module._extensions['.ts'] = (loaded, filename) => loaded._compile(ts.transpileModule(readFileSync(filename, 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename);
const { coverageIndicators, coverageNumber, coverageTargetDifference } = require('./coverageIndicators.ts');
Module._extensions['.tsx'] = (loaded, filename) => loaded._compile(ts.transpileModule(readFileSync(filename, 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText, filename);
Module._extensions['.css'] = () => {};
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const CoverageKpis = require('./components/CoverageKpis.tsx').default;
const fixture = {
  years: [2025, 2030, 2035], total_hh: [10, 12, 20], population: [30, 48, 100],
  water_supply: {
    bau_hh: [[2, 3, 4], [3, 4, 6]],
    scenario_hh: [[2, 4, 8], [3, 4, 4]],
    scenario_target_hh: [[2, 3, 6], [3, 4, 8]],
    target_hh: [[2, 3, 4], [3, 4, 12]],
  },
};
for (const [level, baseline, forecast, target] of [
  ['safely_managed', 2, 8, 6], ['basic', 3, 4, 8], ['at_least_basic', 5, 12, 14],
]) {
  const values = coverageIndicators([fixture], 'water_supply', 2025, 2035, level);
  assert.equal(values.baseline.households, baseline);
  assert.equal(values.forecast.households, forecast);
  assert.equal(values.target.households, target);
  assert.equal(values.forecast.percent, forecast / 20 * 100);
}
const bau = coverageIndicators([fixture], 'water_supply', 2025, 2035, 'at_least_basic', 'bau_hh', 'target_hh');
assert.equal(bau.forecast.households, 10);
assert.equal(bau.target.households, 16);
const sanitation = { ...fixture, sanitation: { ...fixture.water_supply, scenario_hh: [[2, 4, 1], [3, 4, 2]] } };
assert.equal(coverageIndicators([sanitation], 'sanitation', 2025, 2035, 'basic').forecast.households, 2);
assert.equal(coverageIndicators([sanitation], 'water_supply', 2025, 2035, 'basic').forecast.households, 4);
// Sum actual service households, regardless of differing area populations/household sizes.
const rural = { ...fixture, total_hh: [20, 24, 40], population: [40, 60, 120] };
const aggregate = coverageIndicators([fixture, rural], 'water_supply', 2025, 2035, 'at_least_basic');
assert.equal(aggregate.forecast.households, 24);
assert.equal(aggregate.forecast.percent, 40);
assert.equal(coverageIndicators([fixture], 'water_supply', 2025, 2030, 'basic').endYear, 2030);
assert.equal(coverageIndicators([fixture], 'water_supply', 2025, 2040, 'basic').forecast.households, null);
assert.equal(coverageIndicators([], 'water_supply', 2025, 2035, 'basic').baseline.percent, null);
const noPopulation = { ...fixture, population: undefined };
assert.equal(coverageIndicators([noPopulation], 'water_supply', 2025, 2035, 'basic').forecast.percent, 20);
assert.equal(coverageIndicators([fixture, noPopulation], 'water_supply', 2025, 2035, 'basic').forecast.households, 8);
const noSector = { ...fixture, water_supply: undefined };
assert.equal(coverageIndicators([fixture, noSector], 'water_supply', 2025, 2035, 'basic').forecast.percent, null);
const excessive = { ...fixture, water_supply: { ...fixture.water_supply, scenario_hh: [[30, 30, 30], [30, 30, 30]] } };
assert.equal(coverageIndicators([excessive], 'water_supply', 2025, 2035, 'at_least_basic').forecast.households, 20);
for (const [forecast, target, difference] of [[70, 60, -10], [60, 70, 10], [70, 70, 0], [null, 70, null], [70, null, null]]) {
  assert.equal(coverageTargetDifference(forecast, target), difference);
}
const shortfall = coverageIndicators([{ ...fixture, water_supply: { ...fixture.water_supply,
  scenario_hh: [[2, 4, 5], [3, 4, 4]], scenario_target_hh: [[2, 3, 7.5], [3, 4, 8]] } }],
  'water_supply', 2025, 2035, 'safely_managed');
assert.equal(coverageTargetDifference(shortfall.forecast.households, shortfall.target.households), 2.5);
assert.equal(coverageNumber(null, 'households'), '—');
assert.equal(coverageNumber(0, 'households'), '0 M');
assert.equal(coverageNumber(12.3456, 'households'), '12.346 M');
assert.equal(coverageNumber(.00001, 'households'), '0.00001 M');
assert.equal(coverageNumber(70.12, 'percent'), '70.1%');
for (const [forecast, target, expected] of [[80, 70, 'Above target'], [60, 70, 'Below target'],
  [70, 70, 'On target'], [null, 70, 'Comparison unavailable'], [70, null, 'Comparison unavailable'],
  [70.00000001, 70, 'Above target']]) {
  const metrics = coverageIndicators([fixture], 'water_supply', 2025, 2035, 'basic');
  metrics.forecast.percent = forecast;
  metrics.target.percent = target;
  const html = renderToStaticMarkup(React.createElement(CoverageKpis, {
    values: metrics, scenarioLabel: 'Scenario', contextLabel: 'Coverage test', variant: 'bau',
  }));
  assert.ok(html.includes(expected), `${forecast} vs ${target} must show ${expected}`);
  assert.ok(html.includes('data-bau-kpi="bau"'));
  assert.ok(html.includes('Households (millions)'));
  assert.ok(!html.includes('million people'));
  if (forecast !== null && target !== null) assert.ok(html.includes('Target − achieved:'));
}
console.log('Coverage indicators: selected sectors/services/years, household counts, aggregation, missing data and target-minus-achieved differences passed.');
