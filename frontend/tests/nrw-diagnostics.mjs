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
const { aggregateNrwDiagnosticField, NRW_DIAGNOSTIC_FIELDS } = require('../src/nrwRevenue.ts');
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
assert.match(html, /NRW incremental billed sales/);
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
