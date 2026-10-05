import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync(new URL('../src/resultsDebtMode.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { resultsInputs } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const source = {
  toggles: { ws_tariff_enabled: true }, custom_interventions: [{ name: 'External funding' }],
  utility_debt: { schema_version: 1,
    water: { enabled: true, annual_real_interest_rate: .05, revenue_sources: ['tariff'] },
    sanitation: { enabled: false, annual_real_interest_rate: null, maturity_year: null } },
};
const before = structuredClone(source);
const ordinary = resultsInputs(source, false);
assert.equal(ordinary.utility_debt.water.enabled, false);
assert.equal(ordinary.utility_debt.sanitation.enabled, false);
assert.equal(ordinary.utility_debt.schema_version, 1);
assert.equal(ordinary.utility_debt.water.annual_real_interest_rate, .05);
assert.deepEqual(ordinary.utility_debt.water.revenue_sources, ['tariff']);
assert.equal(ordinary.toggles, source.toggles);
assert.equal(ordinary.custom_interventions, source.custom_interventions);
assert.deepEqual(source, before);
assert.equal(resultsInputs(source, true), source);
assert.deepEqual(resultsInputs(ordinary, false), ordinary);
assert.equal(resultsInputs(null, false), null);
assert.equal(resultsInputs({ period: {} }, false).utility_debt.water.enabled, false);
console.log('Optional Results debt: disabled view, preserved settings, unchanged interventions, legacy inputs and no mutation passed.');
