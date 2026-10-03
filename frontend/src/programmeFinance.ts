/** Sum annual programme flows, not repeated cash balances or coverage snapshots. */
export function cumulativeAnnualFlow(values: number[], years: number[], baselineYear: number): number {
  return years.reduce((total, year, i) => total + (year > baselineYear ? values[i] || 0 : 0), 0);
}

/** Cash is a stock: a period reports its final closing balance, never a sum of balances. */
export function closingCashAtPeriodEnd(values: number[], years: number[], lo: number, hi: number): number {
  let balance = 0;
  years.forEach((year, i) => { if (year >= lo && year <= hi) balance = values[i] || 0; });
  return balance;
}

/** Unmet gaps sum per-area canonical gaps; overcoverage elsewhere cannot cancel them. */
export function sumServiceGaps(results: any[], sector: 'water_supply' | 'sanitation', scenario: boolean, rung: number): number[] {
  if (!results.length) return [];
  if (rung !== 0 && rung !== 1) throw new Error('Only safely-managed/basic service gaps are supported.');
  const years: number[] = results[0].years;
  const key = scenario ? 'scenario_service_gap_display' : 'service_gap_display';
  const total = years.map(() => 0);
  for (const result of results) {
    if (JSON.stringify(result.years) !== JSON.stringify(years)) throw new Error('Area projection years must match.');
    const gap = result[sector]?.[key]?.[rung];
    if (!Array.isArray(gap) || gap.length !== years.length) throw new Error('Missing canonical service gap series.');
    gap.forEach((value: number, i: number) => {
      if (!Number.isFinite(value) || value < 0) throw new Error('Canonical unmet gaps must be finite and nonnegative.');
      total[i] += value;
    });
  }
  return total;
}