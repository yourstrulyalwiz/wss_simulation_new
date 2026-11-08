import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
require.extensions['.tsx'] = (mod, filename) => mod._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
}).outputText, filename);
require.extensions['.ts'] = require.extensions['.tsx'];
const { aggregateNrwDiagnosticField, NRW_DIAGNOSTIC_FIELDS, NRW_ALLOCATION_ARRAYS } = require('../src/nrwRevenue.ts');
const filename = fileURLToPath(new URL('../src/components/NRWDiagnostics.tsx', import.meta.url));
const mod = new Module(filename);
mod.filename = filename;
mod.paths = Module._nodeModulePaths(path.dirname(filename));
mod._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
}).outputText, filename);
const NRWDiagnostics = mod.exports.default;
const results = [
  { years: [2026], water_supply: {
    scenario_nrw_sales_volume: [1.1], scenario_nrw_net: [-3], scenario_nrw_implementation_cost: [4],
    scenario_applicable_tariff: [2], scenario_applicable_collection_ratio: [0.8],
    scenario_billed_volume_million_m3: [5],
    scenario_revenue_reconciliation: { version: 2, attribution: 'Test attribution', legacy_rate_conflict: true, legacy_nrw_tariff: 3, shared_tariff: 2 },
  } },
  { years: [2026], water_supply: {
    scenario_nrw_sales_volume: [0.9], scenario_nrw_net: [1], scenario_nrw_implementation_cost: [2],
    scenario_applicable_tariff: [4], scenario_applicable_collection_ratio: [0.5],
    scenario_billed_volume_million_m3: [3],
    scenario_revenue_reconciliation: { version: 2 },
  } },
];
const html = renderToStaticMarkup(React.createElement(NRWDiagnostics, { results, currency: 'LCU' }));
assert.match(html, /Previous NRW method/);
assert.doesNotMatch(html, /NRW incremental billed sales|Potential upgrades|NRW-delivered upgrades/);
assert.match(html, /2/);
assert.match(html, /legacy NRW-only tariff differs/);
assert.match(html, /Test attribution/);
assert.match(html, /Water NRW net is signed after implementation cost/);
const noFake = renderToStaticMarkup(React.createElement(NRWDiagnostics, { results: {
  years: [2026], water_supply: { scenario_nrw_sales_volume: [null] },
} }));
assert.match(noFake, /—/);
const sanitationResults = [
  { years: [2026], sanitation: {
    scenario_eligible_nrw_link_cash: [-1.5],
    scenario_billed_volume_million_m3: [1],
    scenario_applicable_tariff: [2],
    scenario_applicable_collection_ratio: [0.5],
    scenario_raw_billed_volume_million_m3: [1.3],
    scenario_mf_cohort_offers_hh: [0.25],
    scenario_mf_cohort_unserved_hh: [0.1],
    scenario_mf_cohort_self_excluded_hh: [0.05],
    scenario_revenue_reconciliation: { version: 2, attribution_description: 'Sanitation v2 metadata.' },
  } },
  { years: [2026], sanitation: {
    scenario_eligible_nrw_link_cash: [4],
    scenario_billed_volume_million_m3: [3],
    scenario_applicable_tariff: [4],
    scenario_applicable_collection_ratio: [0.75],
    scenario_raw_billed_volume_million_m3: [2.8],
    scenario_mf_cohort_offers_hh: [0.5],
    scenario_mf_cohort_unserved_hh: [0.2],
    scenario_mf_cohort_self_excluded_hh: [0.08],
    scenario_revenue_reconciliation: { version: 2 },
  } },
];
const sanitationHtml = renderToStaticMarkup(React.createElement(NRWDiagnostics, {
  results: sanitationResults, sector: 'sanitation', title: 'Sanitation link audit',
}));
assert.match(sanitationHtml, /Sanitation link audit/);
assert.match(sanitationHtml, /Eligible NRW-linked sanitation net cash/);
assert.match(sanitationHtml, /2\.5/);
assert.match(sanitationHtml, /Microfinance Cohort Offers Households/);
assert.match(sanitationHtml, /Sanitation v2 metadata/);
const linkedCash = NRW_DIAGNOSTIC_FIELDS.find(field => field.key === 'eligible_nrw_link_cash');
assert.equal(aggregateNrwDiagnosticField(sanitationResults, linkedCash, 0, 'sanitation'), 2.5);
const tariff = NRW_DIAGNOSTIC_FIELDS.find(field => field.key === 'applicable_tariff');
const collection = NRW_DIAGNOSTIC_FIELDS.find(field => field.key === 'applicable_collection_ratio');
assert.equal(aggregateNrwDiagnosticField(sanitationResults, tariff, 0, 'sanitation'), 3.5, 'multi-area tariff is billed-volume weighted');
assert.ok(Math.abs(aggregateNrwDiagnosticField(sanitationResults, collection, 0, 'sanitation') - (10 / 14)) < 1e-12,
  'multi-area collection ratio is tariff-volume weighted');
const missingArea = [{ sanitation: { scenario_eligible_nrw_link_cash: [2] } }, { sanitation: {} }];
assert.equal(aggregateNrwDiagnosticField(missingArea, linkedCash, 0, 'sanitation'), null,
  'missing area cash stays unavailable instead of being summed as zero');
assert.equal(aggregateNrwDiagnosticField([
  { sanitation: { scenario_applicable_tariff: [2], scenario_billed_volume_million_m3: [1] } },
  { sanitation: { scenario_applicable_tariff: [4] } },
], tariff, 0, 'sanitation'), null, 'missing rate weights do not count as zero-volume areas');
console.log('NRW diagnostics rendering checks passed');
const v3Results = { years: [2026], water_supply: {
  scenario_revenue_reconciliation: { version: 3 }, scenario_connection_net_cash: [0],
  scenario_connection_raw_volume_million_m3: [.074], scenario_connection_scale: [.0616666667],
  scenario_nrw_net: [-30], scenario_nrw_operating_cost: [0], scenario_incremental_variable_operating_cost: [0],
  scenario_connection_annual_cost_per_household: [0], scenario_connection_billed_basic_households: [5000],
} };
const v3Html = renderToStaticMarkup(React.createElement(NRWDiagnostics, { results: v3Results }));
assert.match(v3Html, /Version 3 reconciliation/);
assert.doesNotMatch(v3Html, /joint tariff\/collection effect|Version 2 reconciliation/);
assert.match(v3Html, /Coverage-expansion volume before overlap/);
assert.doesNotMatch(v3Html, /operating cost|Annual connection cost|Billed Basic household stock/);
assert.match(v3Html, /Previous NRW method/);
assert.doesNotMatch(v3Html, /-30/, 'old NRW net cannot masquerade as a new allocation quantity');
const legacyHtml = renderToStaticMarkup(React.createElement(NRWDiagnostics, { results }));
assert.match(legacyHtml, /Version 2 reconciliation/);
assert.doesNotMatch(legacyHtml, /Version 3 reconciliation/);
const current = { years: [2028], water_supply: {
  nrw_allocation_version: 1, scenario_nrw_allocation_version: 1,
  scenario_revenue_reconciliation: { version: 4, nrw_allocation_version: 1, legacy_direct_delivery_active: false },
  ...Object.fromEntries(NRW_ALLOCATION_ARRAYS.map(key => [`scenario_${key}`, [key === 'nrw_net' ? -2.75 : 0]])),
  scenario_nrw_delivered_upgrade_hh: [0], scenario_nrw_potential_upgrade_hh: [0], scenario_nrw_origin_households: [0],
  scenario_nrw_upgrade_hh: [0], scenario_nrw_upg: [0],
  scenario_without_utility_debt_nrw_physical_delivered_volume: [0],
} };
const currentHtml = renderToStaticMarkup(React.createElement(NRWDiagnostics, { results: current }));
assert.match(currentHtml, /NRW allocation version 1 is independent of revenue integration version 3 and reconciliation version 4/);
assert.match(currentHtml, /NRW net cash benefit/);
assert.match(currentHtml, /-2\.75/);
assert.match(currentHtml, /Physical water supplied to funded connections/);
assert.match(currentHtml, /already included in connection billing/);
assert.match(currentHtml, /Download this table as CSV/);
assert.doesNotMatch(currentHtml, /Potential upgrades|NRW-delivered upgrades|Physical NRW-origin households|NRW Upg|Without Utility Debt|Allocation Version/);
const mixedHtml = renderToStaticMarkup(React.createElement(NRWDiagnostics, { results: [current, results[0]] }));
assert.match(mixedHtml, /Previous NRW method/);
assert.doesNotMatch(mixedHtml, /Download this table as CSV/);
console.log('Current allocation diagnostics, signed cash and historical export isolation passed');
