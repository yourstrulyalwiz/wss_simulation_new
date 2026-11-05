import type { BauServiceLevel } from './bauServiceView';

export type CoverageUnit = 'percent' | 'households';
export type CoverageValue = { percent: number | null; households: number | null };
export type CoverageIndicators = {
  baselineYear: number; endYear: number | null;
  baseline: CoverageValue; forecast: CoverageValue; target: CoverageValue;
};

const unavailable = (): CoverageValue => ({ percent: null, households: null });
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Engine service counts are already in millions of households; never convert them to people. */
export function coverageIndicators(results: any[], sector: string, baselineYear: number,
  endYear: number | null, level: BauServiceLevel, forecastField = 'scenario_hh',
  targetField = 'scenario_target_hh'): CoverageIndicators {
  const value = (year: number | null, field: string): CoverageValue => {
    if (!results.length || year === null) return unavailable();
    const rungs = level === 'at_least_basic' ? [0, 1] : [level === 'basic' ? 1 : 0];
    let households = 0, total = 0;
    for (const result of results) {
      const index = result?.years?.indexOf(year) ?? -1;
      const denominator = result?.total_hh?.[index];
      const counts = rungs.map(rung => result?.[sector]?.[field]?.[rung]?.[index]);
      if (index < 0 || !finite(denominator) || denominator <= 0 || !counts.every(finite)) return unavailable();
      const served = Math.max(0, Math.min(denominator, counts.reduce((sum, count) => sum + count, 0)));
      households += served;
      total += denominator;
    }
    return { percent: households / total * 100, households };
  };
  return { baselineYear, endYear,
    baseline: value(baselineYear, 'bau_hh'),
    forecast: value(endYear, forecastField), target: value(endYear, targetField) };
}

export function coverageTargetDifference(forecast: number | null, target: number | null): number | null {
  return finite(forecast) && finite(target) ? target - forecast : null;
}

export function coverageNumber(value: number | null, unit: CoverageUnit): string {
  if (!finite(value)) return '—';
  if (unit === 'percent') return `${value.toFixed(1)}%`;
  // Keep very small household counts visible instead of rounding them to zero.
  return `${value.toLocaleString('en-US', { maximumFractionDigits: value !== 0 && Math.abs(value) < .001 ? 6 : 3 })} M`;
}
