import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const colors = read('../src/chartColors.ts');
const categories = read('../src/contributionView.tsx').split('export function ContributionViewToggle')[0]
  .replace("import React from 'react';", '');
const attributionSource = read('../src/sourceAttribution.ts').replace("import { C, INTV_PALETTE as P } from './chartColors';", '');
const ledgerSource = read('../src/resultsLedger.ts').replace("import { CONTRIBUTION_CATEGORIES } from './contributionView';", '')
  .replace("import { sourceDefinition } from './sourceAttribution';", '');
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
const actualFunding = fundingRows.find(r => r.key === 'operations');
const nrwParent = actualFunding.children.find(r => r.key === 'funding-source-nrw');
const nrwCash = nrwParent.children.find(r => r.component === 'signed_contribution');
close(nrwCash.values[1], -.06); // Money in millions -> billions once; preserve signed loss.
assert.equal(nrwCash.values[0], null);
assert.deepEqual(nrwParent.values, nrwCash.values);
close(fundingRows.find(r => r.key === 'repaymentsPaid').values[1], .012);
close(fundingRows.find(r => r.key === 'repaymentsUnfunded').values[1], .018);
assert.ok(!fundingRows.some(r => r.label.includes('[Step')));
// The old sourceBands list is nonzero-chart-only; zero enabled sources must still have
// stable human-readable labels and canonical category membership in the ledger.
const enabledZero = structuredClone(data);
enabledZero.scenario = fundingSnapshots;
enabledZero.base = fundingSnapshots;
for (const key of ['budget_execution', 'financial', 'injection', 'collection', 'nrw_link', 'custom']) {
  enabledZero.coverageAttribution.source_keys.push(key);
  enabledZero.sourceFunding.source_keys.push(key);
  for (const name of ['sm_stock', 'basic_stock', 'annual_sm_upgrades', 'annual_basic_entries'])
    enabledZero.coverageAttribution[name][key] = years.map(() => 0);
  for (const name of ['signed_contribution', 'loss_charge', 'debt_charge', 'replacement_charge',
    'expansion_available', 'sm_capital_spent', 'basic_capital_spent', 'ancillary_spent', 'unused'])
    enabledZero.sourceFunding[name][key] = years.map(() => 0);
}
enabledZero.sourceBands = []; // Simulate zero bands being omitted upstream.
const flat = rows => rows.flatMap(row => [row, ...flat(row.children ?? [])]);
for (const sector of ['water', 'sanitation']) {
  for (const metric of ['coverage', 'funding']) for (const service of ['sm', 'basic', 'total']) {
    const list = ledgerRows({ ...enabledZero, sector }, { ...opts, metric, service });
    const combinedIndex = list.findIndex(row => row.key === 'scenario');
    assert.ok(list.slice(0, combinedIndex).some(row => row.kind === 'category'));
    assert.ok(list.slice(combinedIndex + 1).every(row => row.kind !== 'intervention' && row.kind !== 'category'));
    const prefix = metric === 'funding' ? 'funding-source-' : '';
    const children = flat(list);
    for (const [key, category] of [['financial', 'funding'], ['budget_execution', 'investment'], ['collection', 'operations']]) {
      const source = children.find(row => row.key === `${prefix}${key}`);
      assert.equal(source.label, sourceDefinition(key, sector).label);
      assert.ok(list.find(row => row.key === category).children.includes(source));
      assert.equal(source.values[1], 0);
    }
    for (const row of list.filter(row => row.kind === 'category'))
      row.values.forEach((value, i) => value == null
        ? assert.ok(row.children.some(child => child.values[i] == null))
        : close(value, row.children.reduce((sum, child) => sum + child.values[i], 0)));
  }
}
// Paid service capital is not signed source receipts, nor a fabricated fraction of them.
const paid = structuredClone(enabledZero);
paid.sourceFunding.sm_capital_spent.baseline = [0, 31, 42];
paid.sourceFunding.sm_capital_spent.tariff = [0, 7, 13];
paid.sourceFunding.basic_capital_spent.baseline = [0, 19, 23];
paid.sourceFunding.basic_capital_spent.tariff = [0, 11, 17];
paid.sourceFunding.signed_contribution.baseline = [0, 251, 293];
paid.sourceFunding.signed_contribution.tariff = [0, 61, 67];
paid.sourceFunding.signed_contribution.loan = [0, 500, 700]; // Restricted, never ordinary.
for (const service of ['sm', 'basic', 'total']) {
  const list = ledgerRows(paid, { ...opts, metric: 'funding', service, moneyFactor: .002, years: [2027] });
  const categoryRows = list.filter(row => row.kind === 'category');
  const subtotal = categoryRows.reduce((sum, row) => sum + row.values[0], 0);
  close(list.find(row => row.key === 'scenario').values[0], list[0].values[0] + subtotal);
  const field = service === 'total' ? 'signed_contribution' : `${service}_capital_spent`;
  close(flat(list).find(row => row.key === 'funding-source-tariff').values[0], paid.sourceFunding[field].tariff[2] * .002 / 1000);
  if (service === 'total') assert.ok(!flat(list).some(row => row.key === 'funding-source-loan'));
}
assert.throws(() => ledgerRows({ ...data, coverageAttribution: undefined }, opts), /unavailable/);
assert.throws(() => ledgerRows({ ...data, sourceFunding: undefined }, { ...opts, metric: 'funding' }), /unavailable/);
const missingReceipt = structuredClone(data);
missingReceipt.sourceFunding.signed_contribution.nrw[2] = null;
assert.throws(() => ledgerRows(missingReceipt, { ...opts, metric: 'funding', service: 'total' }), /signed_contribution.nrw/);
const missingServiceCapital = structuredClone(data);
missingServiceCapital.sourceFunding.basic_capital_spent.tariff[2] = null;
assert.throws(() => ledgerRows(missingServiceCapital, { ...opts, metric: 'funding', service: 'basic' }), /basic_capital_spent.tariff/);
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
assert.ok(dashboard.includes('<ResultsLedgerPanel data={ledgerData}'), 'Ledger panel must receive the complete actual-source data used by the chart.');
assert.ok(read('../src/components/ResultsLedgerPanel.tsx').includes('key={`${row.kind}:${row.key}`}'),
  'Flattened category/source rows may share semantic keys (tariff/custom); React identity must include row kind.');
for (const component of [dashboard, read('../src/components/UtilityDebtPreview.tsx')]) {
  for (const field of ['debt_service_paid', 'debt_service_unfunded', 'funded_interest', 'unfunded_principal']) assert.ok(component.includes(field));
}
console.log('Source attribution: count aggregation, stock/annual reconciliation, category identity, signed funding, strict availability and shared frontend payloads passed.');
