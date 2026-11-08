import type { PostBucket, PostComposition, PostCoverage, PostInterventionSettings, PostTargets } from './postIntervention';

export const emptyPostSettings = (): PostInterventionSettings => ({
  version: 1, targetYear: null, targetOverrides: {}, toggleOverrides: {}, fundingMethod: 'constant_gdp_share',
});
export const postFinite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
export const verifiedPostBucket = (bucket: PostBucket | undefined): boolean =>
  !!bucket && ['solved', 'already_funded'].includes(bucket.solver_status) && postFinite(bucket.funding_fraction)
  && bucket.verified_funded_coverage != null;
export const usablePostBucket = (bucket: PostBucket | undefined): bucket is PostBucket =>
  !!bucket && bucket.solver_status !== 'invalid_inputs';

export function postTargetError(target: PostTargets): string {
  if (!postFinite(target.atLeastBasicShare) || !postFinite(target.safelyManagedShare)) return 'Enter both target percentages; blank is missing, not zero.';
  if (target.safelyManagedShare < 0 || target.atLeastBasicShare > 1 || target.safelyManagedShare > target.atLeastBasicShare)
    return 'Require 0% ≤ safely managed ≤ at least basic ≤ 100%.';
  return '';
}

/** Display aggregation only: never omit a missing/invalid constituent or price a gap in the browser. */
export function postSum(values: (number | null | undefined)[]): number | null {
  return values.length > 0 && values.every(postFinite) ? values.reduce<number>((sum, value) => sum + (value as number), 0) : null;
}
export function postCoverage(buckets: (PostBucket | undefined)[], field: 'reference_coverage' | 'original_target_coverage' | 'adjusted_existing_funding_coverage' | 'target_coverage' | 'verified_funded_coverage', index: number, level: keyof PostCoverage): number | null {
  if (!buckets.every(usablePostBucket)) return null;
  if (field === 'verified_funded_coverage' && !buckets.every(verifiedPostBucket)) return null;
  return postSum(buckets.map(bucket => bucket?.[field]?.[level]?.[index]));
}
export const POST_COMPONENTS: { key: keyof PostComposition; label: string }[] = [
  { key: 'household_expansion', label: 'Household expansion & upgrades' },
  { key: 'ancillary', label: 'Ancillary infrastructure' },
  { key: 'replacement_backlog', label: 'Closing replacement backlog' },
  { key: 'cash_shortfall', label: 'Accumulated modeled cash shortfalls' },
];
export const postStatus = (status: string): string => ({
  solved: 'Verified funding schedule',
  already_funded: 'Already fully funded',
  invalid_inputs: 'Invalid inputs',
  coverage_met_finance_unresolved: 'Coverage achieved; financial obligations remain',
  not_resolved_within_bounds: 'Not resolved within search bounds',
  delivery_constraint: 'Delivery constraint',
  nonconvergent: 'Funding search did not converge',
}[status] || status.replace(/_/g, ' '));

export function postCsv(headers: string[], rows: unknown[][]): string {
  const cell = (value: unknown) => {
    let text = value == null ? '' : String(value);
    // Avoid spreadsheet formula execution in labels supplied through an API.
    if (typeof value === 'string' && /^[=+@\t\r-]/.test(text)) text = "'" + text;
    return `"${text.replace(/"/g, '""')}"`;
  };
  return [headers, ...rows].map(row => row.map(cell).join(',')).join('\r\n');
}
