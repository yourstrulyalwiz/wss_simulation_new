/** Reporting signs only: engine obligations remain positive and are never netted against funding twice. */
export function signedAccessBalance(gap: number | null, actual: number | null, target: number | null): number | null {
  if (gap == null || !Number.isFinite(gap)) return null;
  if (gap > 0) return -gap;
  if (actual == null || target == null || !Number.isFinite(actual) || !Number.isFinite(target)) return null;
  return Math.max(0, actual - target);
}

export function signedFinancingBalance(gap: number | null): number | null {
  return gap == null || !Number.isFinite(gap) ? null : gap === 0 ? 0 : -gap;
}

export function forecastCell(value: number | null, signed = false): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const rounded = Number(value.toPrecision(3));
  // Preserve the direction of small nonzero balances instead of showing misleading +/-0.
  const text = Math.abs(rounded).toLocaleString('en-US', {
    maximumFractionDigits: rounded !== 0 && Math.abs(rounded) < 0.01 ? 6 : 2,
  });
  if (rounded !== 0 && Number(text.replace(/,/g, '')) === 0)
    return `${rounded < 0 ? '-' : signed ? '+' : ''}<0.000001`;
  return `${rounded < 0 ? '-' : signed && rounded > 0 ? '+' : ''}${text}`;
}

/** Column indices use the original BAU order (before adding intervention households). */
export function forecastValueClass(value: number | null, column: number): string {
  let tone = 'neutral';
  if (value != null && Number.isFinite(value) && value !== 0) {
    if ([4, 9, 10].includes(column)) tone = value < 0 ? 'deficit' : 'surplus';
    else if ([5, 6, 8].includes(column)) tone = 'deficit';
    else if ([7, 11].includes(column)) tone = value > 0 ? 'surplus' : 'deficit';
  }
  return `forecast-value--${tone}`;
}
