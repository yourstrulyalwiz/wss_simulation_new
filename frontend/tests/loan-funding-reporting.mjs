import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { engineLoanFixtures } from './loan-workspace-fixtures.mjs';

const require = createRequire(import.meta.url);
const compile = (module, filename) => module._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
}).outputText, filename);
require.extensions['.ts'] = compile;
require.extensions['.tsx'] = compile;
const { loanCoverageRows, loanComparisonRows, loanFundsRows, loanForecastLedger, withoutLoanSector } = require('../src/loanFundingReporting.ts');
const { validateLoanFundingConfig } = require('../src/loanFunding.ts');
const { defaultCurrencyDisplay, convertMoney } = require('../src/currencyDisplay.tsx');
const fixtures = engineLoanFixtures();
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
for (const area of Object.values(fixtures)) {
  const baseline = area.inputs.period.baseline_year;
  for (const sector of ['water_supply', 'sanitation']) for (const mode of ['enabled', 'disabled']) {
    const result = area[mode], sec = result[sector], detail = sec.scenario_utility_debt;
    for (const level of ['safely_managed', 'basic', 'at_least_basic']) {
      const coverage = loanCoverageRows(result, sector, baseline, level);
      const rows = loanComparisonRows(result, sector, baseline, level);
      assert.ok(rows.length > 0);
      assert.equal(rows[0][0], 2026);
      assert.ok(rows.every(row => row[0] > baseline && row.length === 18));
      const rungs = level === 'at_least_basic' ? [0, 1] : [level === 'basic' ? 1 : 0];
      rows.forEach((row, index) => {
        const i = result.years.indexOf(row[0]);
        close(row[3], Math.min(result.total_hh[i], rungs.reduce((n, rung) => n + sec.scenario_without_utility_debt_hh[rung][i], 0)));
        close(row[4], coverage[index].after);
        close(row[6], row[4] - row[3]);
        if (mode === 'disabled') close(row[6], 0);
        close(row[14], sec.scenario_available_total[i]);
        close(row[17], sec.scenario_without_utility_debt_available_total[i]);
        close(row[8], rungs.reduce((n, rung) => n + sec.scenario_new_capex_by_service[rung][i], 0));
        close(row[11], rungs.reduce((n, rung) => n + sec.scenario_replacement_backlog_closing_by_service[rung][i], 0));
        close(row[13], -sec.scenario_financing_gap[i]);
      });
      const absent = structuredClone(result);
      delete absent[sector].scenario_without_utility_debt_hh;
      assert.ok(loanCoverageRows(absent, sector, baseline, level).every(row => row.before === null && row.marginal === null));
      delete absent[sector].scenario_financing_gap;
      assert.ok(loanComparisonRows(absent, sector, baseline, level).every(row => row[13] === null));
      const accessField = level === 'at_least_basic' ? 'scenario_at_least_basic_access_gap' : level === 'basic' ? 'scenario_adjusted_basic_only_gap' : 'scenario_sm_access_gap';
      delete absent[sector][accessField];
      assert.ok(loanComparisonRows(absent, sector, baseline, level).every(row => row[7] === null), 'Missing engine gaps cannot be inferred');
    }
    const funds = loanFundsRows(result, sector, baseline);
    funds.forEach(row => {
      assert.equal(row.reconciled, true, row.issues.join(' '));
      assert.equal(row.paymentReconciled, true);
      close(row.net, row.total + row.injection - row.paid);
      close(row.newFunds, row.mobilized + row.additional + row.injection);
      close(row.ordinaryAfter, Math.max(0, row.ordinaryBefore) - row.paid);
      close(row.net, row.gross + row.injection + row.payment);
    });
    const carry = structuredClone(result);
    carry[sector].scenario_utility_debt.annual_injection.forEach(row => row.opening_unspent_proceeds += 9876);
    assert.deepEqual(loanFundsRows(carry, sector, baseline).map(row => row.net), funds.map(row => row.net), 'Carry is not new funding');
    const absent = structuredClone(result);
    delete absent[sector].scenario_utility_debt.annual_injection.find(row => row.year > baseline).debt_service_paid;
    assert.equal(loanFundsRows(absent, sector, baseline)[0].net, null, 'Missing paid service cannot be zero');
    const schedule = loanForecastLedger(detail.repayment_schedule, baseline);
    if (mode === 'enabled') assert.ok(schedule.at(-1).year > area.inputs.period.forecast_end_year, 'Keep full maturity');
    assert.ok(loanForecastLedger(detail.annual_injection, baseline).every(row => row.year > baseline));
    assert.equal(withoutLoanSector(sec).scenario_hh, sec.scenario_without_utility_debt_hh);
  }
}
// Signed marginal effects, independent of whether restricted loan purchases are positive.
const synthetic = { years: [2025, 2026, 2027], total_hh: [10, 10, 10], water_supply: {
  scenario_hh: [[1, 3, 2], [2, 2, 1]], scenario_without_utility_debt_hh: [[1, 2, 3], [2, 1, 2]],
  bau_hh: [[1, 1, 1], [2, 2, 2]], scenario_target_hh: [[2, 4, 4], [3, 3, 3]],
} };
assert.deepEqual(loanCoverageRows(synthetic, 'water_supply', 2025, 'safely_managed').map(row => row.marginal), [1, -1]);
assert.deepEqual(loanCoverageRows(synthetic, 'water_supply', 2025, 'basic').map(row => row.marginal), [1, -1]);
assert.deepEqual(loanCoverageRows(synthetic, 'water_supply', 2025, 'at_least_basic').map(row => row.marginal), [2, -2]);
assert.deepEqual(loanComparisonRows(null, 'water_supply', 2025, 'basic'), []);
assert.deepEqual(loanForecastLedger([{ year: 2025 }, { year: 2026 }, { year: 2058 }], 2025).map(row => row.year), [2026, 2058]);
const cfg = fixtures.urban.inputs.utility_debt.water, period = fixtures.urban.inputs.period;
assert.deepEqual(validateLoanFundingConfig({ ...cfg, enabled: false, annual_real_interest_rate: null, loan_term_years: null }, period), {});
assert.ok(Object.keys(validateLoanFundingConfig({ ...cfg, annual_real_interest_rate: null, loan_term_years: null }, period)).length >= 2);
assert.ok(validateLoanFundingConfig({ ...cfg, disbursement_year: 2025 }, period).disbursement_year);
assert.ok(validateLoanFundingConfig({ ...cfg, loan_term_years: -3 }, period).loan_term_years);
const local = defaultCurrencyDisplay('LCU'), usd = { ...local, mode: 'usd', localPerUsd: 132.7, rateReferenceYear: 2025 };
close(convertMoney(132700, usd, 'LCU') / 1000, 1);
close(convertMoney(132700, local, 'LCU') / 1000, 132.7);
assert.equal(convertMoney(null, usd, 'LCU'), null);
console.log('Loan reporting: fresh enabled/disabled engine runs, both sectors/areas, three service views, signed effects, exact frozen reference, missing data, carry, debt payment reconciliation, validation, units and full-maturity dates passed.');
