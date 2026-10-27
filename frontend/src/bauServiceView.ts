export type BauServiceLevel = 'safely_managed' | 'basic' | 'at_least_basic';

export const BAU_SERVICE_LEVELS: { value: BauServiceLevel; label: string }[] = [
  { value: 'safely_managed', label: 'Safely managed' },
  { value: 'basic', label: 'Basic only' },
  { value: 'at_least_basic', label: 'At least basic' },
];

function required(value: unknown, key: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`BAU result is missing a valid ${key} value.`);
  }
  return value;
}

/** The first two service categories are exclusive; add them once for combined reporting. */
export function bauServiceValue(sector: any, key: string, index: number, level: BauServiceLevel): number {
  const rungs = level === 'at_least_basic' ? [0, 1] : [level === 'basic' ? 1 : 0];
  return rungs.reduce((sum, rung) => sum + required(sector[key]?.[rung]?.[index], key), 0);
}

/** Read gaps assessed by the engine before adding areas; never offset one area's deficit with another's surplus. */
export function bauAccessGap(sector: any, index: number, level: BauServiceLevel): number {
  const key = level === 'at_least_basic' ? 'at_least_basic_access_gap'
    : level === 'basic' ? 'adjusted_basic_only_gap' : 'sm_access_gap';
  return required(sector[key]?.[index], key);
}

export type BauSpendingRow = { year: number; expansion: number; replacement: number; available: number };

/** Annual flows only. Do not substitute residual need or subtract balances a second time. */
export function bauSpendingRows(results: any[], sectorKey: string, baseline: number): BauSpendingRow[] {
  if (!results.length) return [];
  return results[0].years.flatMap((year: number, i: number) => {
    if (year <= baseline) return [];
    const sum = (key: string) => results.reduce((total, result) => {
      if (result.years[i] !== year) throw new Error('BAU areas have inconsistent reporting years.');
      return total + required(result[sectorKey]?.[key]?.[i], key);
    }, 0);
    return [{
      year, expansion: sum('annual_planned_expansion_cost'),
      replacement: sum('replacement_capex'), available: sum('available_total'),
    }];
  });
}
