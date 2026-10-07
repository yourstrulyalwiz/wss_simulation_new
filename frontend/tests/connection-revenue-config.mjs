// Focused schema migration checks; no server or profile storage is touched.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => {
  const fs = require('node:fs');
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  module._compile(output, filename);
};
const {
  annualCostPerHousehold,
  equivalentMarginalCost,
  migrateConnectionRevenueConfig,
  operatingExpenditureSource,
  snapshotOperatingExpenditureProxy,
  validateConnectionRevenueConfig,
} = require('../src/connectionRevenueConfig.ts');

const observed = { source_type: 'observed', reference_year: 2022, note: 'Utility register' };
const v1 = migrateConnectionRevenueConfig({
  version: 1, enabled: true, billed_share_basic: 0, billed_share_sm: 0.63,
  household_volume_share: null, marginal_cost: 0, zero_cost_confirmed: true,
  provenance: { billed_share_basic: observed, billed_share_sm: observed },
});
assert.equal(v1.version, 3);
assert.equal(v1.new_billed_share_basic, 0, 'Explicit zero must not be replaced by an empty/default value');
assert.equal(v1.new_billed_share_sm, 0.63);
assert.equal(v1.household_volume_share, null, 'Incomplete calibration drafts remain blank');
assert.equal(v1.marginal_cost, 0, 'Legacy marginal cost remains numerically authoritative');
assert.equal(v1.cost_basis, 'per_m3');
assert.deepEqual(v1.provenance.new_billed_share_basic, observed, 'Observed source is inherited without relabeling');

const v2 = migrateConnectionRevenueConfig({
  version: 2, billed_share_basic: null, billed_share_sm: 0,
  marginal_cost: 0.17, provenance: {},
});
assert.equal(v2.new_billed_share_basic, null, 'A blank legacy share remains blank');
assert.equal(v2.new_billed_share_sm, 0, 'A zero legacy share remains zero');
assert.equal(v2.marginal_cost, 0.17);
assert.equal(v2.cost_basis, 'per_m3');

const v3 = migrateConnectionRevenueConfig({
  version: 3, billed_share_basic: 0.7, new_billed_share_basic: null,
  new_billed_share_sm: 0, annual_cost_per_household: null,
});
assert.equal(v3.new_billed_share_basic, null, 'A blank v3 input is not silently inherited');
assert.equal(v3.new_billed_share_sm, 0);
assert.equal(v3.annual_cost_per_household, null);
assert.equal(migrateConnectionRevenueConfig(v3).new_billed_share_basic, null, 'Migration is idempotent');

assert.equal(annualCostPerHousehold(120, 1 / 3), 40, 'Legacy marginal cost converts to annual household cost');
assert.ok(Math.abs(equivalentMarginalCost(40, 120) - 1 / 3) < 1e-12, 'Annual cost converts back to equivalent marginal cost');
assert.equal(annualCostPerHousehold(0, 5), 0, 'Legacy q=0 non-household-only settings retain k=0');
assert.equal(equivalentMarginalCost(40, 0), null, 'Do not divide annual costs by zero consumption');

const sourceInputs = {
  period: { baseline_year: 2025, forecast_end_year: 2027 },
  country_config: { area: '  River District ', currency: ' lcu ' },
  water_interventions: {
    tariff_op_expenditure: 84_000,
    tariff_op_expenditure_reference_year: 2025,
    tariff_op_expenditure_currency_basis: ' REAL_RAW ',
  },
  revenue_bases: { water: { reference_year: 2025 } },
};
const source = operatingExpenditureSource(sourceInputs, 'water');
assert.deepEqual(source, {
  expenditure: 84_000, baseline_year: 2025, currency: 'LCU', currency_basis: 'real_raw',
  sector: 'water', area: 'river district',
});
const proxy = snapshotOperatingExpenditureProxy(sourceInputs, 'water', 0.4, 'Accepted household allocation');
assert.deepEqual(proxy, {
  ...source, household_allocation: 0.4, allocation_confirmed: true, note: 'Accepted household allocation',
}, 'Proxy snapshot must match the adapter source scope, year, currency and basis');
const apiInputs = {
  ...sourceInputs,
  connection_revenue: { water: {
    version: 3, enabled: true, cost_basis: 'expenditure_proxy', cost_proxy: proxy,
    billed_share_sm: 0.7, billed_share_basic: 0.5, new_billed_share_sm: 0.7, new_billed_share_basic: 0.5,
    household_volume_share: 0.6, marginal_cost: null, annual_cost_per_household: null,
    observed_billed_households: 12,
    shared_assumption_note: 'Documented assumptions', alignment: 'estimate', funding_reference: 'fixed',
    reference_confirmed: true, funding_includes_reforms: false,
  } },
};
assert.deepEqual(validateConnectionRevenueConfig(apiInputs.connection_revenue.water, apiInputs, 'water'), [],
  'The snapshotted source is accepted when its API input scope agrees');
const nonhouseholdOnly = {
  ...apiInputs.connection_revenue.water,
  cost_basis: 'per_m3', cost_proxy: null, marginal_cost: 5, consumption_m3: 0, zero_cost_confirmed: false,
};
assert.ok(!validateConnectionRevenueConfig(nonhouseholdOnly, apiInputs, 'water')
  .some(message => /zero-cost assumption/.test(message)),
'Legacy per-m³ non-household-only q=0 remains valid without a false zero-cost confirmation');
assert.ok(validateConnectionRevenueConfig({ ...nonhouseholdOnly, marginal_cost: 0 }, apiInputs, 'water')
  .some(message => /zero-cost assumption/.test(message)),
'For per-m³ basis, explicit zero confirmation follows marginal_cost === 0');
const observedDraft = {
  ...apiInputs.connection_revenue.water,
  provenance: { billed_share_basic: { source_type: 'observed', reference_year: 2025, note: '' } },
};
assert.ok(validateConnectionRevenueConfig(observedDraft, apiInputs, 'water')
  .some(message => /billed share basic/.test(message)),
'A field-specific observed draft cannot be silently replaced by the shared assumed note');
const postedApiInputs = JSON.parse(JSON.stringify(apiInputs));
assert.deepEqual(postedApiInputs.connection_revenue.water.cost_proxy, proxy,
  'The POSTed full-input payload retains the exact proxy snapshot contract');
const mismatchedArea = {
  ...apiInputs,
  country_config: { ...apiInputs.country_config, area: 'Different district' },
};
assert.ok(validateConnectionRevenueConfig(apiInputs.connection_revenue.water, mismatchedArea, 'water')
  .some(message => /scope, baseline year, currency/.test(message)), 'Changed API source scope invalidates a stale snapshot');
console.log('Connection revenue config migration: zeroes, blanks, source provenance, legacy costs and idempotence passed.');
