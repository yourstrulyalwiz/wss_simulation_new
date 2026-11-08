import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const ts = require('typescript');
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText, filename);
const { calculationPayload, runCalculation } = require('../src/api.ts');
const { NRW_ALLOCATION_ARRAYS } = require('../src/nrwRevenue.ts');
const inputs = { calculation_scope: ['water', 'sanitation'],
  toggles: { ws_nrw_enabled: true, san_nrw_link_enabled: true },
  water_interventions: { nrw_existing_customer_sales_capacity_mld: null, nrw_unsold_production_reduction_share: null },
};
let calls = 0;
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async () => { calls++; throw new Error('must not be called'); };
  await assert.rejects(runCalculation(inputs), error =>
    error.intervention_issues.length === 2 && error.intervention_issues.every(issue => issue.sector === 'water'));
  assert.equal(calls, 0, 'active blanks block calculations locally, before network');
  const valid = { ...inputs, water_interventions: {
    nrw_existing_customer_sales_capacity_mld: 0, nrw_unsold_production_reduction_share: 0, nrw_production_cost: null,
    nrw_value_basis: 'production', nrw_sales_assumption: 'household_only', nrw_water_per_upgrade: 78, nrw_tariff: 4.8,
  } };
  const payload = calculationPayload(valid);
  assert.equal(payload.water_interventions.nrw_allocation_version, 1);
  assert.equal(payload.water_interventions.nrw_existing_customer_sales_capacity_mld, 0);
  assert.equal(payload.water_interventions.nrw_production_cost, null);
  assert.equal(payload.water_interventions.legacy_metadata.nrw_sales_assumption, 'household_only');
  const result = { years: [2028], water_supply: { nrw_allocation_version: 1 }, sanitation: { nrw_allocation_version: 1 } };
  for (const prefix of ['', 'scenario_', 'scenario_without_utility_debt_']) {
    for (const sector of ['water_supply', 'sanitation']) {
      result[sector][`${prefix}nrw_allocation_version`] = 1;
      result[sector][`${prefix}revenue_reconciliation`] = {
        version: 4, nrw_allocation_version: 1, legacy_direct_delivery_active: false,
      };
    }
    for (const key of NRW_ALLOCATION_ARRAYS) result.water_supply[`${prefix}${key}`] = [0];
  }
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, '/api/calculate');
    assert.equal(options.credentials, 'include');
    assert.equal(options.cache, 'no-store');
    assert.equal(JSON.parse(options.body).water_interventions.nrw_unsold_production_reduction_share, 0);
    return { ok: true, json: async () => structuredClone(result) };
  };
  assert.deepEqual(await runCalculation(valid), result, 'explicit zero defaults calculate without production cost');
  for (const prefix of ['', 'scenario_', 'scenario_without_utility_debt_']) {
    const old = result.water_supply[`${prefix}nrw_physical_delivered_volume`];
    delete result.water_supply[`${prefix}nrw_physical_delivered_volume`];
    await assert.rejects(runCalculation(valid), /Previous NRW method or incomplete allocation/);
    result.water_supply[`${prefix}nrw_physical_delivered_volume`] = old;
  }
  delete result.water_supply.scenario_nrw_allocation_version;
  await assert.rejects(runCalculation(valid), /Previous NRW method or incomplete allocation/, 'reconciliation v4 alone is insufficient');
} finally { globalThis.fetch = originalFetch; }
console.log('NRW allocation API guards passed: local blanks, zeros, versioned matched passes, no stale comparisons');
