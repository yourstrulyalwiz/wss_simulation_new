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
  ['safely_managed', 6, 40, 30], ['basic', 9, 20, 40], ['at_least_basic', 15, 60, 70],
]) {
  const values = coverageIndicators([fixture], 'water_supply', 2025, 2035, level);
  assert.equal(values.baseline.people, baseline);
  assert.equal(values.forecast.people, forecast);
  assert.equal(values.target.people, target);
  assert.equal(values.forecast.percent, forecast);
}
const bau = coverageIndicators([fixture], 'water_supply', 2025, 2035, 'at_least_basic', 'bau_hh', 'target_hh');
assert.equal(bau.forecast.people, 50);
assert.equal(bau.target.people, 80);
const sanitation = { ...fixture, sanitation: fixture.water_supply };
assert.equal(coverageIndicators([sanitation], 'sanitation', 2025, 2035, 'basic').forecast.people, 20);
// Area-specific conversion, not an assumed household size or aggregate household ratio.
const rural = { ...fixture, total_hh: [20, 24, 40], population: [40, 60, 120] };
const aggregate = coverageIndicators([fixture, rural], 'water_supply', 2025, 2035, 'at_least_basic');
assert.equal(aggregate.forecast.people, 96);
assert.equal(aggregate.forecast.percent, 40);
assert.equal(coverageIndicators([fixture], 'water_supply', 2025, 2030, 'basic').endYear, 2030);
assert.equal(coverageIndicators([fixture], 'water_supply', 2025, 2040, 'basic').forecast.people, null);
assert.equal(coverageIndicators([], 'water_supply', 2025, 2035, 'basic').baseline.percent, null);
const noPopulation = { ...fixture, population: undefined };
assert.equal(coverageIndicators([noPopulation], 'water_supply', 2025, 2035, 'basic').forecast.percent, 20);
assert.equal(coverageIndicators([fixture, noPopulation], 'water_supply', 2025, 2035, 'basic').forecast.people, null);
const noSector = { ...fixture, water_supply: undefined };
assert.equal(coverageIndicators([fixture, noSector], 'water_supply', 2025, 2035, 'basic').forecast.percent, null);
const excessive = { ...fixture, water_supply: { ...fixture.water_supply, scenario_hh: [[30, 30, 30], [30, 30, 30]] } };
assert.equal(coverageIndicators([excessive], 'water_supply', 2025, 2035, 'at_least_basic').forecast.people, 100);
for (const [forecast, target, difference] of [[70, 60, 10], [60, 70, -10], [70, 70, 0], [null, 70, null], [70, null, null]]) {
  assert.equal(coverageTargetDifference(forecast, target), difference);
}
assert.equal(coverageNumber(null, 'people'), '—');
assert.equal(coverageNumber(0, 'people'), '0 M');
assert.equal(coverageNumber(12.3456, 'people'), '12.346 M');
assert.equal(coverageNumber(.00001, 'people'), '0.00001 M');
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
}
console.log('Coverage indicators: sectors, service levels, years, people, aggregation, missing data and targets passed.');
