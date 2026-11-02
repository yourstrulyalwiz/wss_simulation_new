import type { BauServiceLevel } from './bauServiceView';

export function forecastTableHeaders(level: BauServiceLevel, currency: string): string[] {
  const gap = level === 'at_least_basic' ? 'At-least-basic access gap'
    : level === 'safely_managed' ? 'SM access gap' : 'Basic-only target shortfall after SM credit (diagnostic)';
  return ['Year', 'Total households (M)', 'BAU households (M)', 'Target households (M)',
    `${gap} (M)`, `Residual new-service cost (B ${currency})`,
    `Replacement need (B ${currency}/yr)`, `Replacement credit (B ${currency}/yr)`,
    `Residual replacement cost (Cumulative) (B ${currency})`,
    `Service financing gaps (B ${currency})`, `Sector financing gaps (B ${currency})`,
    `Sector available funding (B ${currency}/yr)`];
}
