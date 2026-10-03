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