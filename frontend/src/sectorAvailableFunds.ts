import { REVENUE_SOURCES } from './revenueSources';
import { C, INTV_PALETTE } from './chartColors';

export const MOBILIZED_SOURCES = [
  { key: 'public', label: 'Public Spending', color: C.bau },
  { key: 'external', label: 'External Funding', color: INTV_PALETTE.injection },
] as const;
export const AVAILABLE_FUND_COLUMNS = [
  ...MOBILIZED_SOURCES,
  { key: 'mobilized', label: 'Mobilized Funds subtotal' },
  ...REVENUE_SOURCES,
  { key: 'additional', label: 'Additional Revenues Generated subtotal' },
  { key: 'total', label: 'Sector Available Funds total' },
] as const;
type AmountKey = typeof AVAILABLE_FUND_COLUMNS[number]['key'];
export type SectorAvailableFundsRow = Record<AmountKey, number | null> & {
  year: number;
  classifiedTotal: number | null;
  difference: number | null;
  reconciled: boolean;
  issues: string[];
};
const ordinaryKeys = ['baseline', 'budget_execution', 'financial', 'injection',
  'connections', 'collection', 'tariff', 'nrw', 'nrw_link', 'custom'];
// These have explicit, non-ordinary origins. They never enter available_total.
const nonOrdinaryKeys = ['loan', 'microfinance', 'grant', 'zero_cost'];
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const sum = (values: (number | null)[]): number | null =>
  values.length > 0 && values.every(finite) ? values.reduce<number>((a, b) => a + b!, 0) : null;
const close = (a: number, b: number) => Math.abs(a - b) <= 1e-8 + Math.abs(b) * 1e-10;

/**
 * Reporting only, in model millions. Read the pre-charge signed ledger, not
 * expansion_available (which has already paid losses, debt and replacement).
 * Public = baseline capital + budget execution (including the execution/public
 * commitment interaction) + financial commitment. NRW = own + linked cash.
 * Never infer public spending by subtracting revenues from available_total.
 */
export function sectorAvailableFundsRows(
  results: any[], sector: 'water_supply' | 'sanitation', baselineYears: number | number[],
): SectorAvailableFundsRow[] {
  if (!results.length) return [];
  const baselines = Array.isArray(baselineYears) ? baselineYears : results.map(() => baselineYears);
  if (baselines.length !== results.length || !baselines.every(finite)) return [];
  const years: number[] = [...new Set<number>(results.flatMap(result =>
    Array.isArray(result?.years) ? result.years.filter(finite) : []))].sort((a, b) => a - b);
  return years.filter(year => baselines.every(baseline => year > baseline)).map(year => {
    const areaRows = results.map((result, area) => {
      const sec = result?.[sector] ?? result;
      const index = Array.isArray(result?.years) ? result.years.indexOf(year) : -1;
      const ledger = sec?.scenario_source_funding;
      const contributions = ledger?.signed_contribution;
      const issues: string[] = [];
      const read = (key: string): number | null => {
        const value = index >= 0 ? contributions?.[key]?.[index] : null;
        return finite(value) ? value : null;
      };
      const publicCash = sum(['baseline', 'budget_execution', 'financial'].map(read));
      const values: Record<AmountKey, number | null> = {
        public: publicCash, external: read('injection'),
        mobilized: sum([publicCash, read('injection')]),
        connections: read('connections'), nrw: sum([read('nrw'), read('nrw_link')]),
        collection: read('collection'), tariff: read('tariff'),
        additional: null, total: null,
      };
      values.additional = sum(REVENUE_SOURCES.map(source => values[source.key]));
      const engineTotal = index >= 0 ? sec?.scenario_available_total?.[index] : null;
      values.total = finite(engineTotal) ? engineTotal : null;
      const missing = ordinaryKeys.filter(key => read(key) == null);
      if (missing.length) issues.push(`Missing signed source values: ${missing.join(', ')}.`);
      if (values.total == null) issues.push('Engine sector available total is unavailable.');
      if (read('custom') != null && read('custom') !== 0) {
        issues.push('Custom cash is outside the requested six sources; it has not been classified.');
      }
      const declaredKeys: string[] = Array.isArray(ledger?.source_keys) ? ledger.source_keys : [];
      const unknown = [...new Set([...Object.keys(contributions || {}), ...declaredKeys])]
        .filter(key => !ordinaryKeys.includes(key) && !nonOrdinaryKeys.includes(key))
        .filter(key => read(key) == null || read(key) !== 0);
      if (unknown.length) issues.push(`Unclassified signed sources: ${unknown.join(', ')}.`);
      const classifiedTotal = sum([values.mobilized, values.additional]);
      const difference = classifiedTotal != null && values.total != null ? values.total - classifiedTotal : null;
      if (classifiedTotal != null && values.total != null && !close(classifiedTotal, values.total)) {
        issues.push('Source subtotals do not reconcile to the engine sector available total.');
      }
      return { values, classifiedTotal, difference, issues: issues.map(issue => `Area ${area + 1}: ${issue}`) };
    });
    const values = Object.fromEntries(AVAILABLE_FUND_COLUMNS.map(column =>
      [column.key, sum(areaRows.map(row => row.values[column.key]))])) as Record<AmountKey, number | null>;
    const issues = areaRows.flatMap(row => row.issues);
    return {
      year, ...values, classifiedTotal: sum(areaRows.map(row => row.classifiedTotal)),
      difference: sum(areaRows.map(row => row.difference)),
      reconciled: issues.length === 0, issues,
    };
  });
}
