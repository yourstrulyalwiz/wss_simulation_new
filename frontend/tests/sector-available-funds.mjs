// Pure reporting and server-rendered UI contracts; no API or database access.
// Run: node frontend/tests/sector-available-funds.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const compile = (module, filename) => module._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
}).outputText, filename);
require.extensions['.ts'] = compile;
require.extensions['.tsx'] = compile;
require.extensions['.css'] = () => {};
const { sectorAvailableFundsRows, AVAILABLE_FUND_COLUMNS } = require('../src/sectorAvailableFunds.ts');
const { defaultCurrencyDisplay, convertMoney } = require('../src/currencyDisplay.tsx');
const { forecastCell } = require('../src/forecastTablePresentation.ts');
const { revenueSourceRows } = require('../src/revenueSources.ts');
const keys = ['baseline', 'budget_execution', 'financial', 'injection', 'connections',
  'collection', 'tariff', 'nrw', 'nrw_link', 'custom'];
const years = [2024, 2025, 2026, 2027];
function fixture(sector, factor = 1, timeline = years) {
  const amounts = { baseline: 1260, budget_execution: 174, financial: -82, injection: 230,
    connections: 92, collection: 41, tariff: 83, nrw: sector === 'water_supply' ? -57 : 0,
    nrw_link: sector === 'sanitation' ? -29 : 0, custom: 0 };
  const signed = Object.fromEntries(keys.map(key => [key, timeline.map(year => amounts[key] * factor * (year - 2024))]));
  // Non-ordinary sources are explicitly excluded even if a future ledger reports them.
  signed.loan = timeline.map(() => 8300);
  signed.microfinance = timeline.map(() => 17);
  signed.grant = timeline.map(() => 49);
  signed.zero_cost = timeline.map(() => 12);
  const total = timeline.map((_, index) => keys.reduce((sum, key) => sum + signed[key][index], 0));
  return { years: timeline, [sector]: {
    scenario_source_funding: { source_keys: Object.keys(signed), signed_contribution: signed,
      // These are downstream uses, not deductions from the reporting ledger.
      loss_charge: { baseline: [0, 0, 300, 400] }, debt_charge: { tariff: [0, 0, 12, 14] } },
    scenario_available_total: total,
    scenario_available_after_debt_service: total.map(value => value - 12),
    // Aliases deliberately duplicate the ledger: these must never be added again.
    scenario_connection_revenue_cash: signed.connections,
    scenario_connection_net_cash: signed.connections,
    scenario_connections_cash: signed.connections,
    scenario_nrw_net: signed.nrw,
    scenario_eligible_nrw_link_cash: signed.nrw_link,
    scenario_nrw_link_cash: signed.nrw_link,
    scenario_collection_cash: signed.collection, scenario_tariff_cash: signed.tariff,
  } };
}
for (const sector of ['water_supply', 'sanitation']) {
  const result = fixture(sector);
  const rows = sectorAvailableFundsRows([result], sector, 2025);
  assert.deepEqual(rows.map(row => row.year), [2026, 2027]);
  for (const row of rows) {
    const index = result.years.indexOf(row.year);
    const signed = result[sector].scenario_source_funding.signed_contribution;
    assert.equal(row.public, signed.baseline[index] + signed.budget_execution[index] + signed.financial[index]);
    assert.equal(row.mobilized, row.public + row.external);
    assert.equal(row.additional, row.connections + row.nrw + row.collection + row.tariff);
    assert.equal(row.total, result[sector].scenario_available_total[index]);
    assert.equal(row.mobilized + row.additional, row.total);
    assert.equal(row.difference, 0);
    assert.equal(row.reconciled, true);
    assert.equal(row.nrw, sector === 'water_supply' ? signed.nrw[index] : signed.nrw_link[index]);
  }
  // Existing revenue aliases select exactly one per source, as before.
  const originalSources = revenueSourceRows([result], sector);
  assert.equal(originalSources[2].connections, rows[0].connections);
  assert.equal(originalSources[2].nrw, rows[0].nrw);
  // Different ordering must align by actual year, never array index.
  const second = fixture(sector, 3, [2027, 2025, 2026, 2024]);
  const combined = sectorAvailableFundsRows([result, second], sector, [2025, 2025]);
  for (let index = 0; index < rows.length; index++) {
    for (const column of AVAILABLE_FUND_COLUMNS) assert.equal(combined[index][column.key], rows[index][column.key] * 4);
    assert.equal(combined[index].reconciled, true);
  }
  const missingArea = fixture(sector, 1, [2025, 2027]);
  const partial = sectorAvailableFundsRows([result, missingArea], sector, 2025);
  assert.equal(partial[0].total, null);
  assert.equal(partial[0].public, null);
  assert.equal(partial[0].reconciled, false);
  for (const missing of [null, undefined, NaN, Infinity, '41']) {
    const broken = structuredClone(result);
    broken[sector].scenario_source_funding.signed_contribution.collection[2] = missing;
    const row = sectorAvailableFundsRows([broken], sector, 2025)[0];
    assert.equal(row.collection, null);
    assert.equal(row.additional, null);
    assert.equal(row.total, result[sector].scenario_available_total[2]);
    assert.equal(row.reconciled, false);
  }
  const noSeries = structuredClone(result);
  delete noSeries[sector].scenario_source_funding.signed_contribution.budget_execution;
  assert.equal(sectorAvailableFundsRows([noSeries], sector, 2025)[0].public, null);
  const legacy = structuredClone(result);
  delete legacy[sector].scenario_source_funding;
  const legacyRow = sectorAvailableFundsRows([legacy], sector, 2025)[0];
  assert.equal(legacyRow.public, null, 'Do not infer missing public cash as the total minus revenues');
  assert.equal(legacyRow.connections, null);
  assert.equal(legacyRow.reconciled, false);
  const custom = structuredClone(result);
  custom[sector].scenario_source_funding.signed_contribution.custom[2] = 31;
  custom[sector].scenario_available_total[2] += 31;
  const customRow = sectorAvailableFundsRows([custom], sector, 2025)[0];
  assert.equal(customRow.difference, 31);
  assert.equal(customRow.reconciled, false);
  assert.match(customRow.issues.join(' '), /Custom cash.*not been classified/);
  const unknown = structuredClone(result);
  unknown[sector].scenario_source_funding.signed_contribution.unidentified = [0, 0, 21, 0];
  assert.match(sectorAvailableFundsRows([unknown], sector, 2025)[0].issues.join(' '), /Unclassified.*unidentified/);
  // Never let offsetting area discrepancies hide a failed reconciliation.
  const a = structuredClone(result), b = structuredClone(result);
  a[sector].scenario_available_total[2] += 19;
  b[sector].scenario_available_total[2] -= 19;
  const cancellation = sectorAvailableFundsRows([a, b], sector, 2025)[0];
  assert.equal(cancellation.difference, 0);
  assert.equal(cancellation.reconciled, false);
  assert.equal(sectorAvailableFundsRows([result], sector, 2026)[0].year, 2027);
  assert.deepEqual(sectorAvailableFundsRows([result], sector, NaN), []);
  assert.deepEqual(sectorAvailableFundsRows([result], sector, 2040), []);
}
assert.deepEqual(sectorAvailableFundsRows([], 'water_supply', 2025), []);
// Render both result prop shapes without calculations and check units, labels and signs.
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const Chart = require('../src/components/RevenueSourceChart.tsx').default;
const input = { period: { baseline_year: 2025 }, country_config: { currency: 'KES' } };
const local = defaultCurrencyDisplay('KES');
const usd = { ...local, mode: 'usd', localPerUsd: 128, rateReferenceYear: 2025 };
for (const sector of ['water', 'sanitation']) {
  const key = sector === 'water' ? 'water_supply' : 'sanitation';
  for (const display of [local, usd]) {
    const result = fixture(key);
    const html = renderToStaticMarkup(React.createElement(Chart, { inputs: input, results: result, sector, currencyDisplay: display }));
    assert.match(html, /Sector Available Funds/);
    assert.match(html, /Mobilized Funds/);
    assert.match(html, /Additional Revenues Generated/);
    assert.match(html, /billions\/year/);
    assert.doesNotMatch(html, /<th scope="row">2025/);
    assert.match(html, /data-label="Public Spending/);
    assert.match(html, /forecast-value--deficit/);
    assert.match(html, /sector-funds__total/);
    const expected = convertMoney(2704, display, 'KES') / 1000;
    assert.ok(html.includes(forecastCell(expected, true)));
    const multi = renderToStaticMarkup(React.createElement(Chart, {
      inputs: [input, input], results: [result, result], sector, currencyDisplay: display,
    }));
    assert.doesNotMatch(multi, /Funding reconciliation needs attention/);
  }
}
const broken = fixture('water_supply');
delete broken.water_supply.scenario_source_funding;
const html = renderToStaticMarkup(React.createElement(Chart, {
  inputs: input, results: broken, sector: 'water', currencyDisplay: local,
}));
assert.match(html, /Funding reconciliation needs attention/);
assert.match(html, /Missing values remain/);
assert.doesNotMatch(html, /class="recharts-responsive-container"/);
// Real-engine boundary: copied fixture only; no API, DB, saved-state changes or
// model modifications. Both ordinary and loan-enabled outputs retain the identity.
const real = JSON.parse(execFileSync('python', ['-c', `
import json
from model.engine import calculate
from demo_adapter import coerce_to_engine
from test_support import controlled_budgets
with open('profiles/DRC OCT 8.json') as handle:
    bundle = json.load(handle)
areas = [bundle['inputs'], bundle['altInputs']['rural']]
for area in areas:
    controlled_budgets(area)
print(json.dumps({
    'baselines': [area['period']['baseline_year'] for area in areas],
    'results': [calculate(coerce_to_engine(area)) for area in areas]
}, default=lambda value: value.tolist() if hasattr(value, 'tolist') else value.item()))
`], { cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8', maxBuffer: 24 * 1024 * 1024 }));
for (const sector of ['water_supply', 'sanitation']) {
  const scopes = [
    ...real.results.map((result, index) => ({ results: [result], baselines: [real.baselines[index]] })),
    real,
  ];
  for (const scope of scopes) {
    const rows = sectorAvailableFundsRows(scope.results, sector, scope.baselines);
    assert.ok(rows.length);
    for (const row of rows) {
      assert.ok(row.reconciled, `${sector}/${row.year}: ${row.issues.join(' ')}`);
      const total = scope.results.reduce((sum, result) =>
        sum + result[sector].scenario_available_total[result.years.indexOf(row.year)], 0);
      assert.equal(row.total, total);
      assert.ok(Math.abs(row.mobilized + row.additional - total) <= 1e-8 + Math.abs(total) * 1e-10);
    }
  }
}
console.log('Sector available funds: forecast filtering, exact signed reconciliation, aliases, missing/unknown values, both sectors, multi-area alignment, currency and UI contracts passed.');
