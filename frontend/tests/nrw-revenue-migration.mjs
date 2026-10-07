import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/nrwRevenue.ts', import.meta.url), 'utf8');
const js = ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 });
const { migrateNrwRevenueInputs, setNrwLinkOverlapYear, nrwLinkBillableVolume } =
  await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

const old = {
  water_interventions: { nrw_value_basis: 'tariff', nrw_tariff: 17.25, nrw_capex_unit_cost_local: 420 },
  revenue_bases: { water: { version: 1, tariff: 12.5, collection_ratio: 0.8 } },
};
const migrated = migrateNrwRevenueInputs(old);
assert.equal(migrated.water_interventions.revenue_integration_version, 2);
assert.equal(migrated.water_interventions.nrw_sales_assumption, 'all_recovered_sold');
assert.equal(migrated.water_interventions.nrw_tariff, 17.25, 'legacy NRW tariff is never overwritten');
assert.equal(migrated.water_interventions.nrw_capex_unit_cost_local, 420);
assert.equal(migrated.revenue_bases.water.version, 1, 'shared revenue base stays v1');
assert.equal(migrateNrwRevenueInputs({ water_interventions: { nrw_value_basis: 'production' } })
  .water_interventions.nrw_sales_assumption, 'household_only');
assert.equal(migrateNrwRevenueInputs({ water_interventions: {
  revenue_integration_version: 2, nrw_sales_assumption: 'household_only', nrw_tariff: 9,
} }).water_interventions.nrw_sales_assumption, 'household_only', 'current assumption is unchanged');
const sanitationLegacy = {
  sanitation_interventions: {
    nrw_link_sewer_charge: 4.75,
    nrw_link_collection_rate: 0.68,
    nrw_link_return_ratio: 0.72,
    nrw_link_overlap_m3_series: { 2028: 125000 },
  },
};
const sanitationMigrated = migrateNrwRevenueInputs(sanitationLegacy);
assert.equal(sanitationMigrated.sanitation_interventions.revenue_integration_version, 2);
assert.equal(sanitationMigrated.sanitation_interventions.nrw_link_eligible_share, 1, 'missing eligibility uses explicit 100% legacy default');
assert.deepEqual(sanitationMigrated.sanitation_interventions.nrw_link_overlap_m3_series, { 2028: 125000 }, 'identified overlap is preserved');
assert.equal(sanitationMigrated.sanitation_interventions.nrw_link_sewer_charge, 4.75, 'legacy sewer charge is retained');
assert.equal(sanitationMigrated.sanitation_interventions.nrw_link_collection_rate, 0.68, 'legacy collection assumption is retained');
assert.deepEqual(migrateNrwRevenueInputs({}).sanitation_interventions.nrw_link_overlap_m3_series, {});
const edited = setNrwLinkOverlapYear({ 2027: 1000, 2028: 2000 }, 2027, 1250);
assert.deepEqual(edited, { 2027: 1250, 2028: 2000 }, 'editing one year preserves other identified overlap');
assert.deepEqual(setNrwLinkOverlapYear(edited, 2027, undefined), { 2028: 2000 }, 'blank removes only that year');
assert.deepEqual(setNrwLinkOverlapYear(edited, 2027, -1), edited, 'negative overlap is not saved');
const noOverlap = nrwLinkBillableVolume(1.5, 0.7, 0.6, null);
assert.ok(Math.abs(noOverlap.grossMillionM3 - 0.63) < 1e-12);
assert.equal(noOverlap.overlapMillionM3, null, 'blank is unknown/not identified, not inferred');
assert.ok(Math.abs(noOverlap.netMillionM3 - 0.63) < 1e-12, 'only explicitly supplied overlap is subtracted');
const explicitOverlap = nrwLinkBillableVolume(1.5, 0.7, 0.6, 130000);
assert.ok(Math.abs(explicitOverlap.netMillionM3 - 0.5) < 1e-12);
const panelSource = readFileSync(new URL('../src/components/InterventionPanel.tsx', import.meta.url), 'utf8');
assert.match(panelSource, /Explicit sewer-billable share/);
assert.match(panelSource, /Explicit overlap with sanitation connection billing/);
assert.match(panelSource, /Legacy sewer charge \(review against shared rate\)/);
assert.match(panelSource, /Shared sanitation scenario rate/);
assert.match(panelSource, /target coverage is not an annual enrollment cap/);
const inputPanelSource = readFileSync(new URL('../src/components/InputPanel.tsx', import.meta.url), 'utf8');
assert.match(inputPanelSource, /service target is not an enrollment cap/);
const helpSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
assert.match(helpSource, /not an annual target-gap enrollment calculation/);
assert.match(helpSource, /target coverage is not an enrollment cap/);
console.log('NRW revenue migration checks passed');
