export const FUNDING_BALANCE_ZERO_USD = 10_000;

/** Values are already in display-currency billions; pass only a validated exchange rate. */
export function fundingBalanceForDisplay(value: number | null, currency: string, localPerUsd: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return value;
  const rate = currency.toUpperCase() === 'USD' ? 1 : localPerUsd;
  if (rate == null || !Number.isFinite(rate) || rate <= 0) return value;
  return Math.abs(value) < FUNDING_BALANCE_ZERO_USD * rate / 1_000_000_000 ? 0 : value;
}
