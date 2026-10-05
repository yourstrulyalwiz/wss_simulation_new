/** Presentation-only bounds. Historical rows remain available to selectors/exports. */
export function resolveChartWindow(
  available: number[],
  period: { baseline_year?: number; forecast_end_year?: number } | null | undefined,
  startOverride: number | null = null,
  endOverride: number | null = null,
) {
  const years = [...new Set(available.filter(Number.isFinite))].sort((a, b) => a - b);
  if (!years.length) return { years, start: null, end: null };
  const first = years[0], last = years[years.length - 1];
  // Simulation starts after the baseline: (baseline + 1) - 3, NOT model_start_year.
  const defaultStart = Number.isFinite(period?.baseline_year)
    ? Number(period!.baseline_year) - 2 : first;
  const defaultEnd = Number.isFinite(period?.forecast_end_year)
    ? Number(period!.forecast_end_year) : last;
  const desiredStart = startOverride ?? defaultStart;
  const desiredEnd = endOverride ?? defaultEnd;
  const start = years.find(y => y >= desiredStart) ?? last;
  const end = [...years].reverse().find(y => y <= desiredEnd) ?? first;
  return { years, start, end: Math.max(start, end) };
}
