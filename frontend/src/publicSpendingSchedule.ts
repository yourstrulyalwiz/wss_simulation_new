export type SpendingDraft = { year: string; share: string };
export type SpendingPoint = { year: number; target_share: number };

export function spendingRows(iv: any, firstYear: number): SpendingDraft[] {
  if (Array.isArray(iv.fin_gdp_target_draft)) return iv.fin_gdp_target_draft;
  if (Array.isArray(iv.fin_gdp_targets)) return iv.fin_gdp_targets.map((p: SpendingPoint) => ({
    year: String(p.year ?? ''), share: p.target_share == null ? '' : String(Number((p.target_share * 100).toPrecision(12))),
  }));
  return [{ year: String(iv.fin_gdp_start_year || firstYear),
    share: String(Number(((iv.fin_gdp_target_share ?? 0) * 100).toPrecision(12))) }];
}

export function validateSpendingRows(rows: SpendingDraft[], first: number, last: number): string {
  if (!rows.length) return 'Enter at least one complete target.';
  const seen = new Set<number>();
  for (const [index, row] of rows.entries()) {
    const year = Number(row.year), share = Number(row.share);
    const prefix = `Target ${index + 1}: `;
    if (!row.year.trim() || !Number.isInteger(year) || year < first || year > last)
      return `${prefix}effective year must be an integer from ${first} to ${last}.`;
    if (seen.has(year)) return `${prefix}year ${year} is duplicated.`;
    seen.add(year);
    if (!row.share.trim() || !Number.isFinite(share) || share < 0)
      return `${prefix}enter a finite, nonnegative GDP percentage (zero is valid).`;
  }
  return '';
}

export function draftPoints(rows: SpendingDraft[]) {
  return rows.map(row => ({
    year: row.year.trim() ? Number(row.year) : null,
    target_share: row.share.trim() ? Number(row.share) / 100 : null,
  }));
}

// Drafts are persisted separately from the last valid schedule. Calculations must
// validate the active draft, never quietly display results for its old schedule.
export function withSpendingDrafts(inputs: any) {
  const next = { ...inputs };
  for (const section of ['water_interventions', 'sanitation_interventions']) {
    const iv = inputs[section];
    if (Array.isArray(iv?.fin_gdp_target_draft))
      next[section] = { ...iv, fin_gdp_targets: draftPoints(iv.fin_gdp_target_draft) };
  }
  return next;
}
