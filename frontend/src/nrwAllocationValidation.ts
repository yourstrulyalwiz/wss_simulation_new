import type { InterventionIssue } from './interventionValidation';

export const NRW_ALLOCATION_LABELS = {
  nrw_existing_customer_sales_capacity_mld: 'Additional billable demand through existing connections',
  nrw_unsold_production_reduction_share: 'Share of remaining recovered capacity used to reduce production',
  nrw_production_cost: 'Avoidable variable production cost per m³',
};

/** Local draft checks never run on save; only active calculation dependencies matter. */
export function nrwAllocationIssues(inputs: any): InterventionIssue[] {
  if (Array.isArray(inputs?.calculation_scope) && !inputs.calculation_scope.includes('water')) return [];
  if (!inputs?.toggles?.ws_nrw_enabled) return [];
  const water = inputs.water_interventions || {};
  const issues: InterventionIssue[] = [];
  for (const [key, label] of Object.entries(NRW_ALLOCATION_LABELS)) {
    if (key === 'nrw_production_cost' && !(Number(water.nrw_unsold_production_reduction_share) > 0)) continue;
    const value = water[key];
    const valid = typeof value === 'number' && Number.isFinite(value) && value >= 0 &&
      (key !== 'nrw_unsold_production_reduction_share' || value <= 1);
    issues.push(...(!valid || value === 0 ? [{
      area: inputs?.geo_scope || '', sector: 'water', intervention: 'nrw',
      field: `water_interventions.${key}`, label,
      severity: valid ? 'warning' as const : 'error' as const,
      code: valid ? 'zero_review' : 'nrw_allocation_required',
      message: valid ? `${label} is explicitly zero. Review this planning assumption; zero is accepted.`
        : `${label}: enter a finite nonnegative ${key === 'nrw_unsold_production_reduction_share' ? 'share between 0% and 100%' : 'amount'}; 0 is valid.`,
    }] : []));
  }
  return issues;
}
