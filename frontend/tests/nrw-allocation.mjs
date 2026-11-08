import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const load = async file => {
  const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
  const js = ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 });
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
};
const { migrateNrwRevenueInputs, hasCurrentNrwAllocation, NRW_ALLOCATION_ARRAYS, NRW_DIAGNOSTIC_FIELDS,
  aggregateNrwDiagnosticField, nrwLinkBillableVolume } = await load('nrwRevenue.ts');
const { nrwAllocationIssues } = await load('nrwAllocationValidation.ts');
const old = { toggles: { ws_nrw_enabled: true, san_nrw_link_enabled: true }, water_interventions: {
  nrw_value_basis: 'production', nrw_sales_assumption: 'all_recovered_sold', nrw_tariff: 17.25,
  nrw_water_per_upgrade: 92, revenue_integration_version: 4,
}, sanitation_interventions: { nrw_link_overlap_m3_series: { 2028: 0, 2029: 172000 } } };
const before = JSON.stringify(old);
const migrated = migrateNrwRevenueInputs(old);
assert.equal(JSON.stringify(old), before, 'migration never mutates saved payloads');
assert.equal(migrated.water_interventions.revenue_integration_version, 4, 'never downgrade a higher integration version');
assert.equal(migrated.water_interventions.nrw_allocation_version, 1);
for (const key of ['nrw_value_basis', 'nrw_sales_assumption', 'nrw_tariff', 'nrw_water_per_upgrade']) {
  assert.equal(migrated.water_interventions[key], old.water_interventions[key]);
  assert.equal(migrated.water_interventions.legacy_metadata[key], old.water_interventions[key]);
}
assert.deepEqual(migrateNrwRevenueInputs(migrated), migrated, 'migration is idempotent');
assert.equal(migrated.water_interventions.nrw_existing_customer_sales_capacity_mld, null);
assert.equal(migrated.water_interventions.nrw_unsold_production_reduction_share, null);
assert.equal(migrated.sanitation_interventions.nrw_allocation_review_required, true);
assert.deepEqual(migrated.sanitation_interventions.nrw_link_overlap_m3_series, old.sanitation_interventions.nrw_link_overlap_m3_series);
assert.equal(nrwAllocationIssues(migrated).filter(i => i.severity === 'error').length, 2);
const draft = structuredClone(migrated);
draft.toggles.ws_nrw_enabled = false;
assert.deepEqual(nrwAllocationIssues(draft), [], 'disabled missing fields do not block drafts');
draft.toggles.ws_nrw_enabled = true;
draft.calculation_scope = ['sanitation'];
assert.deepEqual(nrwAllocationIssues(draft), [], 'outside-scope water does not block sanitation');
delete draft.calculation_scope;
const water = draft.water_interventions;
water.nrw_existing_customer_sales_capacity_mld = 0;
water.nrw_unsold_production_reduction_share = 0;
water.nrw_production_cost = null;
assert.equal(nrwAllocationIssues(draft).filter(i => i.severity === 'error').length, 0);
assert.equal(nrwAllocationIssues(draft).filter(i => i.severity === 'warning').length, 2);
assert.equal(migrateNrwRevenueInputs(draft).water_interventions.nrw_existing_customer_sales_capacity_mld, 0);
for (const invalid of [null, undefined, '', '2', -0.1, NaN, Infinity]) {
  water.nrw_existing_customer_sales_capacity_mld = invalid;
  assert.ok(nrwAllocationIssues(draft).some(i => i.field.endsWith('nrw_existing_customer_sales_capacity_mld') && i.severity === 'error'));
}
water.nrw_existing_customer_sales_capacity_mld = 5;
water.nrw_unsold_production_reduction_share = 1.01;
assert.ok(nrwAllocationIssues(draft).some(i => i.field.endsWith('nrw_unsold_production_reduction_share') && i.severity === 'error'));
water.nrw_unsold_production_reduction_share = 0.5;
assert.ok(nrwAllocationIssues(draft).some(i => i.field.endsWith('nrw_production_cost') && i.severity === 'error'));
water.nrw_production_cost = 0;
assert.ok(nrwAllocationIssues(draft).some(i => i.field.endsWith('nrw_production_cost') && i.severity === 'warning'));
water.nrw_production_cost = .25;
assert.deepEqual(nrwAllocationIssues(draft), []);
const current = { years: [2028], water_supply: {
  nrw_allocation_version: 1, scenario_nrw_allocation_version: 1,
  scenario_revenue_reconciliation: { version: 4, nrw_allocation_version: 1, legacy_direct_delivery_active: false },
  ...Object.fromEntries(NRW_ALLOCATION_ARRAYS.map(key => [`scenario_${key}`, [key === 'nrw_net' ? -2.75 : 1.3]])),
} };
assert.ok(hasCurrentNrwAllocation(current));
const stale = structuredClone(current);
delete stale.water_supply.scenario_nrw_physical_delivered_volume;
assert.equal(hasCurrentNrwAllocation(stale), false);
const net = NRW_DIAGNOSTIC_FIELDS.find(f => f.key === 'nrw_net');
assert.equal(aggregateNrwDiagnosticField([current, current], net, 0), -5.5, 'signed benefits sum across areas');
assert.equal(aggregateNrwDiagnosticField([current, stale], net, 0), null, 'old and new results never mix');
for (const key of NRW_ALLOCATION_ARRAYS) assert.ok(NRW_DIAGNOSTIC_FIELDS.some(f => f.key === key));
assert.equal(nrwLinkBillableVolume(null, .7, .6, 0).netMillionM3, null, 'missing delivered volume never falls back to physical recovery');
assert.equal(nrwLinkBillableVolume(0, .7, .6, 0).netMillionM3, 0);
assert.equal(nrwLinkBillableVolume(8, .75, .5, 250000).netMillionM3, 2.75);
console.log('NRW allocation migration, validation, aggregation and stale-result checks passed');
