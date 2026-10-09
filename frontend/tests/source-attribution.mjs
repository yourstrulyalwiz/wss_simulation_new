import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const colors = read('../src/chartColors.ts');
const categories = read('../src/contributionView.tsx').split('export function ContributionViewToggle')[0]
  .replace("import React from 'react';", '');
const attributionSource = read('../src/sourceAttribution.ts').replace("import { C, INTV_PALETTE as P } from './chartColors';", '');
const ledgerSource = read('../src/resultsLedger.ts').replace("import { CONTRIBUTION_CATEGORIES } from './contributionView';", '');
const js = ts.transpile(`${colors}\nconst P = INTV_PALETTE;\n${categories}\n${attributionSource}\n${ledgerSource}`,
  { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 });
const { aggregateCoverage, aggregateSourceFunding, sourceCoverageRows, sourceDefinition, aggregateContributionRows, ledgerRows } =
  await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const years = [2025, 2026, 2027];
const keys = ['baseline', 'connections', 'tariff', 'nrw', 'loan', 'microfinance', 'grant', 'zero_cost'];
const fixture = (factor, total) => {
  const series = values => values.map(v => v * factor);
  const zeros = Object.fromEntries(keys.map(k => [k, series([0, 0, 0])]));
  const sm = { ...zeros, baseline: series([1, 1.08, 1.2]), connections: series([0, .06, .09]),
    tariff: series([0, .04, .08]), nrw: series([0, .02, .03]), loan: series([0, .03, .03]),
    microfinance: series([0, .01, .01]), grant: series([0, .01, .01]), zero_cost: series([0, .02, .02]) };
  const basic = { ...zeros, baseline: series([2, 1.9, 1.75]), connections: series([0, .2, .13]),
    tariff: series([0, .1, .09]) };
  const upgrades = { ...zeros, baseline: series([0, .08, .12]), connections: series([0, .06, .03]),
    tariff: series([0, .04, .04]), nrw: series([0, .02, .01]), loan: series([0, .03, 0]),
    microfinance: series([0, .01, 0]), grant: series([0, .01, 0]), zero_cost: series([0, .02, 0]) };
  const entries = { ...zeros, baseline: series([0, .04, .03]), connections: series([0, .2, .08]), tariff: series([0, .1, .05]) };
  const sum = map => years.map((_, i) => keys.reduce((n, k) => n + map[k][i], 0));
  const a = { version: 1, method: 'actual_source_funding', source_keys: keys, sm_stock: sm, basic_stock: basic,
    annual_sm_upgrades: upgrades, annual_basic_entries: entries,
    opening_baseline_stock: { sm: sm.baseline, basic: basic.baseline },
    pure_bau_stock: { sm: series([1, 1.07, 1.15]), basic: series([2, 1.95, 1.9]) },
    combined_stock: { sm: sum(sm), basic: sum(basic) },
    baseline_difference_from_bau: { sm: series([0, .01, .05]), basic: series([0, -.05, -.15]) },
    reconciliation_error: { sm: series([0, 0, 0]), basic: series([0, 0, 0]) } };
  const funding = { version: 1, method: 'actual_source_funding', source_keys: keys };
  for (const field of ['signed_contribution', 'loss_charge', 'debt_charge', 'replacement_charge', 'expansion_available',
    'sm_capital_spent', 'basic_capital_spent', 'ancillary_spent', 'unused']) funding[field] = structuredClone(zeros);
  funding.signed_contribution.nrw = series([0, -20, -25]); // Signed cash loss with positive physical delivery.
  funding.debt_charge.tariff = series([0, 10, 12]); // No charges to unselected baseline/connections.
  for (const field of ['loss_unfunded', 'debt_service_due', 'debt_service_paid', 'debt_service_unfunded',
    'replacement_due', 'replacement_paid', 'replacement_unfunded']) funding[field] = series([0, 10, 12]);
  return { years, total_hh: [total, total, total], water_supply: {
    scenario_coverage_attribution: a, scenario_without_utility_debt_coverage_attribution: structuredClone(a),
    scenario_source_funding: funding, scenario_without_utility_debt_source_funding: funding } };
};
const results = [fixture(1, 5), fixture(2, 19)];
const a = aggregateCoverage(results, 'water_supply');
const close = (x, y) => assert.ok(Math.abs(x - y) < 1e-8 + Math.abs(y) * 1e-10, `${x} != ${y}`);
const coverage = sourceCoverageRows(years, [24, 24, 24], a, 'water');
for (const [i, row] of coverage.rows.entries()) {
  close(row.__baseline + coverage.bands.reduce((sum, b) => sum + row[b.key], 0), a.combined_stock.sm[i]);
  close(a.baseline_difference_from_bau.sm[i] + coverage.bands.reduce((sum, b) => sum + row[b.key], 0),
    row.__scenario - row.__bau);
}
assert.ok(coverage.bands.some(b => b.key === 'nrw'));
assert.ok(!coverage.bands.some(b => /costeff|techmix/.test(b.key)));
const grouped = aggregateContributionRows(coverage.rows, coverage.bands);
close(grouped.bands.reduce((sum, b) => sum + grouped.rows[2][b.key], 0),
  coverage.bands.reduce((sum, b) => sum + coverage.rows[2][b.key], 0));
assert.ok(grouped.bands.some(b => b.key === 'category:household')); // Grants are household financing, not custom.
assert.ok(grouped.bands.some(b => b.key === 'zero_cost'));
const funding = aggregateSourceFunding(results, 'water_supply');
close(funding.signed_contribution.nrw[1], -60);
close(funding.debt_charge.baseline[1], 0);
assert.equal(aggregateSourceFunding([{ years, water_supply: {} }], 'water_supply'), undefined);
assert.throws(() => aggregateCoverage([{ years, water_supply: {} }], 'water_supply'), /unavailable/);
const broken = structuredClone(results);
broken[0].water_supply.scenario_coverage_attribution.sm_stock.tariff[1] = null;
assert.throws(() => aggregateCoverage(broken, 'water_supply'), /sm_stock.tariff/);
const noDebt = aggregateCoverage(results, 'water_supply', true);
assert.deepEqual(noDebt, a);
const debtViewFixture = structuredClone(results);
debtViewFixture[0].water_supply.scenario_coverage_attribution.sm_stock.loan[2] += .125;
assert.notDeepEqual(aggregateCoverage(debtViewFixture, 'water_supply'), aggregateCoverage(debtViewFixture, 'water_supply', true));
assert.deepEqual(aggregateCoverage(debtViewFixture, 'water_supply', true), a);
const unknownFunding = structuredClone(results);
unknownFunding[0].water_supply.scenario_source_funding.debt_service_paid[2] = null;
assert.equal(aggregateSourceFunding(unknownFunding, 'water_supply').debt_service_paid[2], null);
const snapshots = years.map((year, i) => ({ year, population: 24, values: {
  coverage: [a.combined_stock.sm[i], a.combined_stock.basic[i], a.combined_stock.sm[i] + a.combined_stock.basic[i]],
  target: [2, 6, 8],
} }));
const base = snapshots.map((s, i) => ({ ...s, values: { ...s.values,
  coverage: [a.pure_bau_stock.sm[i], a.pure_bau_stock.basic[i], a.pure_bau_stock.sm[i] + a.pure_bau_stock.basic[i]] } }));
const data = { years, baselineYear: 2025, base, scenario: snapshots, contributions: [], attributionComplete: false, includesDebt: true,
  coverageAttribution: a, sourceFunding: funding, sourceBands: keys.map(k => sourceDefinition(k, 'water')) };
const opts = { metric: 'coverage', service: 'sm', basis: 'closing', years, isShare: true, moneyFactor: 1, currency: 'CDF' };
const rows = ledgerRows(data, opts);
close(rows.find(r => r.key === 'scenario').values[2], a.combined_stock.sm[2] / 24 * 100);
const annual = ledgerRows(data, { ...opts, basis: 'annual', service: 'basic', isShare: false });
close(annual.find(r => r.key === 'scenario').values[2], keys.reduce((sum, k) => sum + a.annual_basic_entries[k][2], 0));
assert.notEqual(annual.find(r => r.key === 'scenario').values[2], a.combined_stock.basic[2] - a.combined_stock.basic[1]);
assert.equal(annual.some(r => r.key === 'bau'), false);
assert.ok(rows.some(r => r.key === 'baseline-reconciliation'));
const measureBlock = ledgerSource.match(/const measures: LedgerMeasure\[\] = \[([\s\S]*?)\];/)[1];
const measures = [...measureBlock.matchAll(/'([^']+)'/g)].map(m => m[1]);
const fundingSnapshots = snapshots.map((s, i) => ({
  ...s, values: { ...Object.fromEntries(measures.map(k => [k, [null, null, null]])), ...s.values,
    funding: [null, null, 48], repayments: [null, null, 30], repaymentsPaid: [null, null, 12], repaymentsUnfunded: [null, null, 18],
    ordinaryInjection: [null, null, 0] },
}));
const fundingRows = ledgerRows({ ...data, scenario: fundingSnapshots, base: fundingSnapshots }, { ...opts, metric: 'funding', service: 'total', isShare: false });
const actualFunding = fundingRows.find(r => r.key === 'actual-source-funding');
const nrwCash = actualFunding.children.find(r => r.key === 'funding-source-nrw').children.find(r => r.component === 'signed_contribution');
close(nrwCash.values[1], -.06); // Money in millions -> billions once; preserve signed loss.
assert.equal(nrwCash.values[0], null);
close(fundingRows.find(r => r.key === 'repaymentsPaid').values[1], .012);
close(fundingRows.find(r => r.key === 'repaymentsUnfunded').values[1], .018);
assert.ok(!fundingRows.some(r => r.label.includes('[Step')));
// Frontend export payloads share chart/table metrics; no legacy sequential household expressions remain.
const live = read('../src/components/LiveInterventionChart.tsx');
const dashboard = read('../src/components/ResultsDashboard.tsx');
assert.ok(live.includes('post(inputs)'));
assert.ok(live.includes('r[bauKey]'));
assert.ok(!live.includes('payloads.map(post)'));
assert.ok(!dashboard.includes('smY('));
assert.ok(dashboard.includes('Included in funded additions'));
assert.ok(dashboard.includes('sourceCoverage.rows'));
assert.ok(dashboard.includes('aggregateCoverage(resList, secKey, !includeDebt)'));
for (const component of [dashboard, read('../src/components/UtilityDebtPreview.tsx')]) {
  for (const field of ['debt_service_paid', 'debt_service_unfunded', 'funded_interest', 'unfunded_principal']) assert.ok(component.includes(field));
}
console.log('Source attribution: count aggregation, stock/annual reconciliation, category identity, signed funding, strict availability and shared frontend payloads passed.');
