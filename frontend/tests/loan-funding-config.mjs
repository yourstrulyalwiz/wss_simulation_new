import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/loanFunding.ts', import.meta.url), 'utf8');
const js = ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 });
const { migrateLoanFundingConfig, validateLoanFundingConfig } =
  await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const { isModeledLoanSummary, LOAN_REPAYMENT_ACCOUNTING, LOAN_SUMMARY_VERSION } =
  await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

const migrated = migrateLoanFundingConfig({
  enabled: true, disbursement_year: 2030, maturity_year: 2040,
  principal_grace_years: 2, repayment_structure: 'equal_principal', loan_ceiling: 12,
  annual_real_interest_rate: 0.05, allocation_share: 0.5, revenue_sources: ['collection'],
});
assert.equal(migrated.schema_version, 3);
assert.equal(migrated.mode, 'indicative_lump_sum');
assert.equal(migrated.repayment_accounting, 'fixed_annuity_modeled');
assert.equal(migrated.loan_term_years, 10);
assert.equal(migrated.legacy_parameters.principal_grace_years, 2);
assert.equal(migrated.legacy_parameters.repayment_structure, 'equal_principal');
assert.equal(migrated.legacy_parameters.loan_ceiling, 12);
assert.match(migrated.migration_notice, /inactive metadata/);
assert.equal(migrateLoanFundingConfig({ disbursement_year: 2035, maturity_year: 2035 }).loan_term_years, null);
assert.deepEqual(migrateLoanFundingConfig({ maturity_year: 2040, disbursement_year: 2030 }).revenue_sources,
  ['collection', 'tariff', 'nrw'], 'an omitted source selection on a legacy record retains its former all-source default');
const malformedSources = migrateLoanFundingConfig({ mode: 'indicative_lump_sum', schema_version: 2, revenue_sources: 'tariff' });
assert.equal(malformedSources.revenue_sources, 'tariff');
assert.ok(validateLoanFundingConfig(malformedSources).revenue_sources);
assert.equal(malformedSources.legacy_parameters.loan_ceiling, undefined);
const alreadyMigrated = migrateLoanFundingConfig({
  ...migrated, loan_term_years: null,
});
assert.equal(alreadyMigrated.loan_term_years, null, 'an explicitly-cleared v2 term must not be re-derived');
assert.deepEqual(alreadyMigrated.legacy_parameters, migrated.legacy_parameters);
assert.equal(alreadyMigrated.migration_notice, migrated.migration_notice);
const aliasMigration = migrateLoanFundingConfig({
  mode: 'indicative_lump_sum', schema_version: 2, loan_term_years: null,
  legacy_metadata: { grace: 3 }, migration_note: 'Keep this note.',
});
assert.equal(aliasMigration.legacy_parameters.grace, 3);
assert.equal(aliasMigration.migration_notice, 'Keep this note.');
assert.match(aliasMigration.current_behavior_notice, /Funding and coverage results may change/);
assert.equal(isModeledLoanSummary({ schema_version: 3, repayment_accounting: 'fixed_annuity_modeled' }), true);
assert.equal(isModeledLoanSummary({ schema_version: 2, repayment_accounting: 'fixed_annuity_modeled' }), false);
assert.equal(isModeledLoanSummary({ schema_version: 3, repayment_accounting: 'deferred' }), false);
assert.equal(LOAN_SUMMARY_VERSION, 3);
assert.equal(LOAN_REPAYMENT_ACCOUNTING, 'fixed_annuity_modeled');

const fresh = migrateLoanFundingConfig({ enabled: false, schema_version: 2, mode: 'indicative_lump_sum' });
assert.equal(fresh.annual_real_interest_rate, undefined);
assert.equal(fresh.loan_term_years, null);
assert.deepEqual(validateLoanFundingConfig(fresh), {});
const period = { baseline_year: 2025, forecast_end_year: 2040 };
assert.deepEqual(migrateLoanFundingConfig({ revenue_sources: 'all' }).revenue_sources, ['collection', 'tariff', 'nrw']);
assert.deepEqual(migrateLoanFundingConfig({ revenue_sources: ['collection', 'nrw'] }).revenue_sources, ['collection', 'nrw']);
assert.deepEqual(validateLoanFundingConfig({ enabled: true, disbursement_year: 2030, allocation_share: .35,
  revenue_sources: ['connections', 'nrw'], annual_real_interest_rate: 0, loan_term_years: 12 }, period), {});
assert.ok(validateLoanFundingConfig({ revenue_sources: ['connections', 'connections'] }).revenue_sources);
const positivePool = { enabled: true, disbursement_year: 2030, allocation_share: 0.5, revenue_sources: ['collection'] };
assert.ok(validateLoanFundingConfig(positivePool, period).annual_real_interest_rate);
assert.ok(validateLoanFundingConfig({ ...positivePool, annual_real_interest_rate: 0, loan_term_years: 2.5 }, period).loan_term_years);
assert.ok(validateLoanFundingConfig({ ...positivePool, annual_real_interest_rate: -0.01, loan_term_years: 10, revenue_sources: ['collection', 'collection'] }, period).revenue_sources);
for (const noSizingCash of [
  { ...positivePool, allocation_share: 0 },
  { ...positivePool, revenue_sources: [] },
]) {
  const noSizingErrors = validateLoanFundingConfig(noSizingCash, period);
  assert.equal(noSizingErrors.annual_real_interest_rate, undefined);
  assert.equal(noSizingErrors.loan_term_years, undefined);
}
assert.ok(validateLoanFundingConfig({ ...positivePool, allocation_share: 0, annual_real_interest_rate: -1 }, period).annual_real_interest_rate,
  'provided invalid rates remain invalid even when no principal is sized');
assert.ok(validateLoanFundingConfig({ ...positivePool, disbursement_year: 2025 }, period).disbursement_year);
assert.ok(validateLoanFundingConfig({ ...positivePool, disbursement_year: 2041 }, period).disbursement_year);
assert.ok(validateLoanFundingConfig({ ...positivePool, disbursement_year: -3 }, period).disbursement_year);

const controls = readFileSync(new URL('../src/components/DebtServicingControls.tsx', import.meta.url), 'utf8');
const preview = readFileSync(new URL('../src/components/UtilityDebtPreview.tsx', import.meta.url), 'utf8');
const results = readFileSync(new URL('../src/components/ResultsDashboard.tsx', import.meta.url), 'utf8');
const interventions = readFileSync(new URL('../src/components/InterventionPanel.tsx', import.meta.url), 'utf8');
for (const forbidden of ['Principal grace', 'Final payment year', 'Repayment structure', 'Optional principal ceiling'])
  assert.equal(controls.includes(forbidden), false);
for (const required of ['Reference / injection year', 'Pooled allocation', 'Annual real interest rate', 'Loan term'])
  assert.ok(controls.includes(required));
for (const required of ['repayment_schedule', 'ordinary_before_debt_service', 'ordinary_after_debt_service', 'horizon_closing_principal'])
  assert.ok(preview.includes(required), `Loan preview must report ${required}`);
assert.ok(results.includes('results-repayment-schedule'));
assert.ok(results.includes('Interest due'));
for (const required of ['debt_service_paid', 'debt_service_unfunded', 'funded_interest', 'funded_principal', 'unfunded_interest', 'unfunded_principal']) {
  assert.ok(results.includes(required), `Results loan tables must distinguish ${required}`);
  assert.ok(preview.includes(required), `Loan preview must distinguish ${required}`);
}
assert.ok(interventions.includes('The full amount enters available funds in the selected year'));
assert.ok(interventions.includes('capital spending share and execution rate are not applied'));
assert.ok(interventions.includes('Recurring funding is adjusted by the capital spending share and execution rate'));
console.log('Loan funding settings/UI: v3 fixed-annuity contract, legacy metadata, funding ledger, schedule and injection modes passed.');
