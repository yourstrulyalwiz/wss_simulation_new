import { C, INTV_PALETTE as P } from './chartColors';
import type { ViewBand } from './contributionView';

export const BASELINE_COVERAGE_LABEL = 'Opening and baseline-funded coverage';
export const SOURCE_COVERAGE_TEXT = 'Coverage is attributed to actual source-funded purchases and direct physical delivery in the combined scenario, not ordered marginal effects. Cost efficiency and technology benefits are included in funded additions. Pure BAU is an independent comparison.';
export const SOURCE_KEYS = ['baseline', 'budget_execution', 'financial', 'injection', 'connections', 'collection', 'tariff', 'nrw', 'nrw_link', 'custom', 'loan', 'microfinance', 'grant', 'zero_cost'] as const;
export type SourceKey = typeof SOURCE_KEYS[number];
export type CoverageAttribution = {
  version: number; method: string; source_keys: string[];
  sm_stock: Record<string, number[]>; basic_stock: Record<string, number[]>;
  annual_sm_upgrades: Record<string, number[]>; annual_basic_entries: Record<string, number[]>;
  opening_baseline_stock: { sm: number[]; basic: number[] };
  pure_bau_stock: { sm: number[]; basic: number[] };
  combined_stock: { sm: number[]; basic: number[] };
  baseline_difference_from_bau: { sm: number[]; basic: number[] };
  reconciliation_error: { sm: number[]; basic: number[] };
};
export const SOURCE_FUNDING_FIELDS = ['signed_contribution', 'loss_charge', 'debt_charge', 'replacement_charge',
  'expansion_available', 'basic_capital_spent', 'sm_capital_spent', 'ancillary_spent', 'unused'] as const;
export const SOURCE_FUNDING_TOTALS = ['loss_unfunded', 'debt_service_due', 'debt_service_paid', 'debt_service_unfunded',
  'replacement_due', 'replacement_paid', 'replacement_unfunded'] as const;
export type SourceFunding = { version: number; method: string; source_keys: string[]; [field: string]: any };
export function sourceDefinition(key: string, sector: 'water' | 'sanitation'): ViewBand {
  const prefix = sector === 'water' ? 'ws' : 'san';
  const definitions: Record<string, [string, string, string?]> = {
    baseline: [BASELINE_COVERAGE_LABEL, C.bau],
    budget_execution: ['Budget execution', P.budgetExec, `${prefix}_capital_efficiency_enabled`],
    financial: ['Financial commitments', P.financial, `${prefix}_financial_commitment_enabled`],
    injection: ['Exogenous injection of funds', P.injection, `${prefix}_exogenous_injection_enabled`],
    connections: ['Revenue from new connections', P.connections, `${prefix}_connections_enabled`],
    collection: ['Collection efficiency', P.collection, `${prefix}_collection_efficiency_enabled`],
    tariff: ['Tariff reform', P.tariff, `${prefix}_tariff_enabled`],
    nrw: ['NRW reduction', P.nrw, 'ws_nrw_enabled'],
    nrw_link: ['NRW-linked sanitation revenue', P.nrw, 'san_nrw_link_enabled'],
    custom: ['Custom interventions', P.custom],
    loan: ['Indicative loan funding', P.utilityDebt, 'utility_debt_financing'],
    microfinance: ['Microfinance', P.microfinance, `${prefix}_microfinance_enabled`],
    grant: ['Household grants', P.microfinance, 'household_grant'],
    zero_cost: ['Zero-cost delivery', P.capex, 'zero_cost_delivery'],
  };
  const [label, color, interventionKey] = definitions[key] || [key, P.custom, key];
  return { key, label, color, interventionKey, custom: key === 'custom' };
}
function checked(value: any, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Source attribution unavailable: ${path}`);
  return value;
}
/** Sum engine counts (million households) before any percentage conversion; never rescale stocks. */
export function aggregateCoverage(results: any[], sector: 'water_supply' | 'sanitation', withoutDebt = false): CoverageAttribution {
  const field = withoutDebt ? 'scenario_without_utility_debt_coverage_attribution' : 'scenario_coverage_attribution';
  const sources = results.map(r => r[sector]?.[field]);
  if (!sources.length || sources.some(s => s?.version !== 1 || s?.method !== 'actual_source_funding'))
    throw new Error('Actual source-funded coverage is unavailable in this result set.');
  const source_keys = [...new Set<string>(sources.flatMap(s => s.source_keys))];
  const out: any = { version: 1, method: 'actual_source_funding', source_keys };
  for (const fieldName of ['sm_stock', 'basic_stock', 'annual_sm_upgrades', 'annual_basic_entries']) {
    out[fieldName] = Object.fromEntries(source_keys.map(key => [key, results[0].years.map((_: number, i: number) =>
      sources.reduce((sum, s) => sum + (s.source_keys.includes(key) ? checked(s[fieldName]?.[key]?.[i], `${fieldName}.${key}`) : 0), 0))]));
  }
  for (const fieldName of ['opening_baseline_stock', 'pure_bau_stock', 'combined_stock', 'baseline_difference_from_bau', 'reconciliation_error']) {
    out[fieldName] = Object.fromEntries(['sm', 'basic'].map(rung => [rung, results[0].years.map((_: number, i: number) =>
      sources.reduce((sum, s) => sum + checked(s[fieldName]?.[rung]?.[i], `${fieldName}.${rung}`), 0))]));
  }
  return out;
}
/** Missing financial fields remain unavailable, including future contractual funded-payment cells. */
export function aggregateSourceFunding(results: any[], sector: 'water_supply' | 'sanitation', withoutDebt = false): SourceFunding | undefined {
  const field = withoutDebt ? 'scenario_without_utility_debt_source_funding' : 'scenario_source_funding';
  const sources = results.map(r => r[sector]?.[field]);
  if (!sources.length || sources.some(s => s?.version !== 1 || s?.method !== 'actual_source_funding')) return undefined;
  const source_keys = [...new Set<string>(sources.flatMap(s => s.source_keys))];
  const add = (values: any[]) => values.every(v => typeof v === 'number' && Number.isFinite(v)) ? values.reduce((a, v) => a + v, 0) : null;
  const out: SourceFunding = { version: 1, method: 'actual_source_funding', source_keys };
  for (const name of SOURCE_FUNDING_FIELDS) out[name] = Object.fromEntries(source_keys.map(key =>
    [key, results[0].years.map((_: number, i: number) => add(sources.map(s => s.source_keys.includes(key) ? s[name]?.[key]?.[i] : 0)))]));
  for (const name of SOURCE_FUNDING_TOTALS) out[name] = results[0].years.map((_: number, i: number) => add(sources.map(s => s[name]?.[i])));
  return out;
}
export function sourceCoverageRows(years: number[], totals: number[], attribution: CoverageAttribution, sector: 'water' | 'sanitation', rung: 'sm' | 'basic' = 'sm') {
  const stocks = rung === 'sm' ? attribution.sm_stock : attribution.basic_stock;
  const rows = years.map((year, i) => ({
    year, __total: totals[i], __baseline: attribution.opening_baseline_stock[rung][i],
    __bau: attribution.pure_bau_stock[rung][i], __scenario: attribution.combined_stock[rung][i],
    ...Object.fromEntries(attribution.source_keys.filter(key => key !== 'baseline').map(key => [key, stocks[key][i]])),
  }));
  const bands = attribution.source_keys.filter(key => key !== 'baseline' && rows.some(row => Math.abs(Number((row as any)[key])) > 1e-12))
    .map(key => sourceDefinition(key, sector));
  return { rows, bands };
}
