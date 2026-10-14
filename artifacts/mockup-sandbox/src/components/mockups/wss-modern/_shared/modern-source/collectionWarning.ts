function isRate(value: unknown): value is number {
  return value !== null && value !== undefined && value !== '' &&
    Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 1;
}

/** Rates are stored as fractions; presentation alone converts them to percentage points. */
export function collectionBelowBaselineWarning(scope: string, sector: 'water' | 'sanitation',
  baseline: unknown, target: unknown): string | null {
  if (!isRate(baseline) || !isRate(target) || Number(target) >= Number(baseline)) return null;
  const percent = (value: unknown) => (Number(value) * 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
  return `${scope} ${sector}: the target collection rate is ${percent(target)}%, below the baseline of ${percent(baseline)}%. This will reduce collected revenue. If you intend 90%, enter 90 in the target percentage field.`;
}
