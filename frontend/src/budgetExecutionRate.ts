/** Undefined ratios stay unavailable; overspending is not capped at 100%. */
export function budgetExecutionRate(executed: number | null | undefined, allocated: number | null | undefined): number | null {
  if (executed == null || allocated == null || !Number.isFinite(executed) ||
      !Number.isFinite(allocated) || executed < 0 || allocated <= 0) return null;
  const rate = executed / allocated;
  return Number.isFinite(rate) ? rate : null;
}
