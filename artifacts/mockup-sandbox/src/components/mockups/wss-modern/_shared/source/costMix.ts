export interface CostMixRow {
  name: string;
  share?: number | null;
  cost?: number | null;
}

export type CostMixTemplates = Record<string, Record<string, CostMixRow[]>>;

export function formatRealUnitCost(nominal: unknown, multiplier: number): string {
  if (nominal === null || nominal === undefined || nominal === '' ||
      !Number.isFinite(Number(nominal) * multiplier)) return '—';
  return Math.round(Number(nominal) * multiplier).toLocaleString();
}

export function displayedCostMix(stored: unknown, template: CostMixRow[] = []): CostMixRow[] {
  const rows = Array.isArray(stored) ? stored.filter(row => row && typeof row === 'object') : [];
  // Never overwrite populated or partly edited mixes, including custom technology names.
  return rows.length ? rows : template.map(row => ({ ...row }));
}

export function summarizeCostMix(rows: CostMixRow[]) {
  const entered = (value: unknown) => value !== null && value !== undefined && value !== '';
  const hasValues = rows.some(row => entered(row.share) || entered(row.cost));
  const validShares = rows.every(row => !entered(row.share) ||
    (Number.isFinite(Number(row.share)) && Number(row.share) >= 0 && Number(row.share) <= 1));
  const shareSum = rows.reduce((sum, row) =>
    sum + (entered(row.share) && Number.isFinite(Number(row.share)) ? Number(row.share) : 0), 0);
  const sharesComplete = validShares && Math.abs(shareSum - 1) < .001;
  const costsComplete = rows.every(row => !(Number(row.share) > 0) ||
    (entered(row.cost) && Number.isFinite(Number(row.cost)) && Number(row.cost) >= 0));
  const weighted = sharesComplete && costsComplete
    ? rows.reduce((sum, row) => sum + (Number(row.share) || 0) * (Number(row.cost) || 0), 0)
    : null;
  return { shareSum, hasValues, sharesComplete, weighted };
}