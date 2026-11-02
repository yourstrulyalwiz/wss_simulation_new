import type { BauServiceLevel } from './bauServiceView';
import { interventionComparisonRows } from './interventionReporting';
import { signedAccessBalance, signedFinancingBalance } from './forecastTablePresentation';
import { sectorAvailableFundsRows } from './sectorAvailableFunds';

export const loanNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
export const loanSum = (values: (number | null)[]): number | null =>
  values.length && values.every(value => value !== null) ? values.reduce<number>((sum, value) => sum + value!, 0) : null;
export const loanDifference = (after: number | null, before: number | null) =>
  after === null || before === null ? null : after - before;

/** Exact frozen engine reference. Never substitute BAU, even when borrowing is off. */
export function withoutLoanSector(sector: any) {
  return Object.fromEntries(Object.entries(sector || {})
    .filter(([key]) => key.startsWith('scenario_without_utility_debt_'))
    .map(([key, value]) => [key.replace('scenario_without_utility_debt_', 'scenario_'), value]));
}

export function loanCoverage(sector: any, field: string, index: number, level: BauServiceLevel): number | null {
  const rungs = level === 'at_least_basic' ? [0, 1] : [level === 'basic' ? 1 : 0];
  return loanSum(rungs.map(rung => loanNumber(sector?.[field]?.[rung]?.[index])));
}

export type LoanCoverageRow = { year: number; total: number | null; before: number | null; after: number | null; marginal: number | null; bau: number | null; target: number | null };
export function loanCoverageRows(result: any, key: string, baseline: number, level: BauServiceLevel): LoanCoverageRow[] {
  const sector = result?.[key], reference = withoutLoanSector(sector);
  const years: number[] = Array.isArray(result?.years) ? result.years : [];
  return years.flatMap((year: number, index: number) => {
    if (year <= baseline) return [];
    const total = loanNumber(result.total_hh?.[index]);
    const capped = (value: number | null) => value === null || total === null ? null : Math.min(total, value);
    const before = capped(loanCoverage(reference, 'scenario_hh', index, level));
    const after = capped(loanCoverage(sector, 'scenario_hh', index, level));
    return [{ year, total, before, after, marginal: loanDifference(after, before),
      bau: capped(loanCoverage(sector, 'bau_hh', index, level)),
      target: capped(loanCoverage(sector, 'scenario_target_hh', index, level)) }];
  });
}

/** Identical order for rendered comparison and CSV/Excel; HH in M, money in model M. */
export function loanComparisonRows(result: any, key: string, baseline: number, level: BauServiceLevel) {
  if (!Array.isArray(result?.years)) return [];
  const base = interventionComparisonRows(result, key, baseline, level);
  const coverage = loanCoverageRows(result, key, baseline, level);
  const sector = result[key];
  const accessKey = level === 'at_least_basic' ? 'at_least_basic_access_gap'
    : level === 'basic' ? 'adjusted_basic_only_gap' : 'sm_access_gap';
  return base.map((row, index) => {
    const c = coverage[index];
    const i = result.years.indexOf(row[0]);
    const debt = sector?.scenario_utility_debt?.annual_injection?.find((item: any) => item.year === row[0]);
    return [row[0], row[1], row[2], c.before, row[12], row[3], c.marginal,
      signedAccessBalance(loanNumber(sector?.[`scenario_${accessKey}`]?.[i]), row[12], row[3]),
      ...row.slice(5, 9), signedFinancingBalance(row[9]), signedFinancingBalance(row[10]), row[11],
      loanNumber(debt?.disbursement), loanNumber(debt?.debt_service_paid),
      loanNumber(sector?.scenario_without_utility_debt_available_total?.[i])];
  });
}

/** Gross ordinary signed sources + NEW injection - actual funded service.
 * Carry is a balance, not a source. Losses already signed; replacement is not deducted twice.
 * Ordinary-before is signed gross cash. After is nonnegative capital after loss
 * absorption and funded service: max(0, before) - paid (not the signed net line).
 */
export function loanFundsRows(result: any, key: 'water_supply' | 'sanitation', baseline: number) {
  const sector = result?.[key];
  const ordinary = sectorAvailableFundsRows([result], key, baseline);
  return ordinary.map(row => {
    const ledger = sector?.scenario_utility_debt?.annual_injection?.find((item: any) => item.year === row.year);
    const injection = loanNumber(ledger?.disbursement);
    const paid = loanNumber(ledger?.debt_service_paid);
    const gross = row.total;
    const newFunds = loanSum([gross, injection]);
    const net = loanDifference(newFunds, paid);
    const ordinaryBefore = loanNumber(ledger?.ordinary_before_debt_service);
    const ordinaryAfter = loanNumber(ledger?.ordinary_after_debt_service);
    const check = loanDifference(loanDifference(ordinaryBefore === null ? null : Math.max(0, ordinaryBefore), paid), ordinaryAfter);
    const paymentReconciled = check !== null && Math.abs(check) < 1e-7;
    return { ...row, gross, injection, paid, payment: paid === null ? null : -paid, newFunds, net,
      ordinaryBefore, ordinaryAfter, paymentReconciled,
      openingCarry: loanNumber(ledger?.opening_unspent_proceeds), closingCarry: loanNumber(ledger?.closing_unspent_proceeds) };
  });
}

export function loanForecastLedger(rows: any, baseline: number) {
  return Array.isArray(rows) ? rows.filter(row => loanNumber(row?.year) !== null && row.year > baseline) : [];
}

export const LOAN_CASH_FLOW_FIELDS = [
  ['ordinary_before_debt_service', 'Ordinary funds before debt service'],
  ['opening_principal', 'Opening contractual principal'],
  ['principal_payment', 'Principal due'],
  ['interest_payment', 'Interest due'],
  ['debt_service', 'Total debt service due'],
  ['debt_service_paid', 'Debt service funded from revenues'],
  ['ordinary_after_debt_service', 'Ordinary funds after funded debt service'],
  ['closing_principal', 'Closing contractual principal'],
  ['opening_unspent_proceeds', 'Opening restricted proceeds'],
  ['closing_unspent_proceeds', 'Closing restricted proceeds'],
] as const;

/** Join cash and contractual schedules by year, not position; never extend modeled revenues. */
export function loanCashFlowRows(detail: any, baseline: number) {
  const cash = new Map<number, any>(loanForecastLedger(detail?.annual_injection, baseline).map(row => [row.year, row]));
  const schedule = new Map<number, any>(loanForecastLedger(detail?.repayment_schedule, baseline).map(row => [row.year, row]));
  const maturity = loanNumber(detail?.maturity_year);
  const end = maturity ?? Math.max(baseline, ...cash.keys(), ...schedule.keys());
  const start = loanNumber(detail?.reference_year);
  if (!Number.isInteger(baseline) || !Number.isInteger(end) || end <= baseline) return [];
  return Array.from({ length: end - baseline }, (_, index) => {
    const year = baseline + 1 + index;
    const annual = cash.get(year), contract = schedule.get(year);
    const row: Record<string, number | null> = { year };
    for (const [key] of LOAN_CASH_FLOW_FIELDS) {
      const contractual = ['opening_principal', 'closing_principal', 'principal_payment', 'interest_payment', 'debt_service'].includes(key);
      row[key] = contractual
        ? loanNumber(contract?.[key] ?? annual?.[key])
        : loanNumber(annual?.[key] ?? contract?.[key]);
      // Before origination (or with borrowing disabled), no contractual loan exists.
      if (row[key] === null && contractual && (detail?.status === 'disabled' || (start !== null && year < start))) row[key] = 0;
    }
    return row;
  });
}
