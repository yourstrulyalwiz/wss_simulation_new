export const NRW_REVENUE_VERSION = 2;

/**
 * Version saved NRW revenue assumptions without replacing user-entered values.
 * Legacy tariff is deliberately retained; shared revenue-base rates are canonical
 * for v2 calculations and any disagreement must remain visible to the planner.
 */
export function migrateNrwRevenueInputs(inputs: any) {
  if (!inputs || typeof inputs !== 'object') return inputs;
  const water = { ...(inputs.water_interventions || {}) };
  const sanitation = { ...(inputs.sanitation_interventions || {}) };
  const waterCurrent = Number(water.revenue_integration_version) >= NRW_REVENUE_VERSION;
  const sanitationCurrent = Number(sanitation.revenue_integration_version) >= NRW_REVENUE_VERSION;
  if (waterCurrent && sanitationCurrent && water.nrw_sales_assumption != null && sanitation.nrw_link_eligible_share != null &&
      sanitation.nrw_link_overlap_m3_series != null) return inputs;
  const legacyValuation = water.nrw_value_basis || 'tariff';
  const assumption = water.nrw_sales_assumption ||
    (legacyValuation === 'tariff' ? 'all_recovered_sold' : 'household_only');
  return {
    ...inputs,
    water_interventions: {
      ...water,
      ...(!waterCurrent ? { revenue_integration_version: NRW_REVENUE_VERSION } : {}),
      nrw_sales_assumption: assumption,
    },
    sanitation_interventions: {
      ...sanitation,
      ...(!sanitationCurrent ? { revenue_integration_version: NRW_REVENUE_VERSION } : {}),
      nrw_link_eligible_share: sanitation.nrw_link_eligible_share ?? 1,
      nrw_link_overlap_m3_series: sanitation.nrw_link_overlap_m3_series ?? {},
    },
  };
}

export function setNrwLinkOverlapYear(series: any, year: number | string, value: number | undefined) {
  const next = { ...(series && typeof series === 'object' && !Array.isArray(series) ? series : {}) };
  const key = String(year);
  if (value == null) delete next[key];
  else if (Number.isFinite(value) && value >= 0) next[key] = value;
  return next;
}

export function nrwLinkBillableVolume(physicalRecoveryMillionM3: number | null, returnRatio: number,
  eligibleShare: number, explicitOverlapM3: number | null) {
  if (physicalRecoveryMillionM3 == null || !Number.isFinite(physicalRecoveryMillionM3)) {
    return { grossMillionM3: null, overlapMillionM3: explicitOverlapM3 == null ? null : explicitOverlapM3 / 1e6, netMillionM3: null };
  }
  const grossMillionM3 = physicalRecoveryMillionM3 * returnRatio * eligibleShare;
  const overlapMillionM3 = explicitOverlapM3 == null ? null : explicitOverlapM3 / 1e6;
  return { grossMillionM3, overlapMillionM3, netMillionM3: grossMillionM3 - (overlapMillionM3 ?? 0) };
}

export function nrwRevenueMetadata(result: any, sector: 'water_supply' | 'sanitation' = 'water_supply') {
  const sec = result?.[sector] ?? result;
  return sec?.scenario_revenue_reconciliation ?? sec?.revenue_reconciliation ?? null;
}

export function nrwRevenueVersion(result: any, sector: 'water_supply' | 'sanitation' = 'water_supply'): number | null {
  const metadata = nrwRevenueMetadata(result, sector);
  const version = Number(metadata?.version);
  return Number.isFinite(version) ? version : null;
}

export function hasNrwArray(result: any, field: string, sector: 'water_supply' | 'sanitation' = 'water_supply') {
  const sec = result?.[sector] ?? result;
  const values = sec?.[`scenario_${field}`];
  return Array.isArray(values) && values.some((value: any) => typeof value === 'number' && Number.isFinite(value));
}

export const NRW_DIAGNOSTIC_FIELDS = [
  { key: 'nrw_sales_volume', label: 'NRW incremental billed sales', unit: 'million m³/year', kind: 'volume' },
  { key: 'nrw_overlap_volume', label: 'Identified connection overlap', unit: 'million m³/year', kind: 'volume' },
  { key: 'nrw_physical_recovery', label: 'Physical-loss recovery', unit: 'million m³/year', kind: 'volume' },
  { key: 'nrw_commercial_recovery', label: 'Commercial-loss recovery', unit: 'million m³/year', kind: 'volume' },
  { key: 'nrw_residual_recovery', label: 'Residual recovered volume', unit: 'million m³/year', kind: 'volume' },
  { key: 'nrw_capacity_committed', label: 'Capacity committed to upgrades', unit: 'million m³/year', kind: 'volume' },
  { key: 'nrw_capacity_uncommitted', label: 'Uncommitted recovered capacity', unit: 'million m³/year', kind: 'volume' },
  { key: 'nrw_sales_cash', label: 'NRW collected sales cash', unit: 'currency millions', kind: 'money' },
  { key: 'nrw_operating_cost', label: 'NRW incremental operating cost', unit: 'currency millions', kind: 'money' },
  { key: 'nrw_implementation_cost', label: 'NRW implementation cost', unit: 'currency millions', kind: 'money' },
  { key: 'nrw_avoided_cost_cash', label: 'Avoided production-cost value', unit: 'currency millions', kind: 'money' },
  { key: 'nrw_net', label: 'NRW signed net cash (loan source)', unit: 'currency millions', kind: 'money' },
  { key: 'nrw_potential_upgrade_hh', label: 'Potential upgrades', unit: 'million households', kind: 'households' },
  { key: 'nrw_delivered_upgrade_hh', label: 'NRW-delivered upgrades', unit: 'million households', kind: 'households' },
  { key: 'funded_sm_upgrade_hh', label: 'Other funded SM upgrades', unit: 'million households', kind: 'households' },
  { key: 'funded_basic_entry_hh', label: 'Funded Basic entries', unit: 'million households', kind: 'households' },
  { key: 'eligible_basic_remaining_hh', label: 'Eligible Basic households remaining', unit: 'million households', kind: 'households' },
  { key: 'eligible_lower_remaining_hh', label: 'Eligible lower-service households remaining', unit: 'million households', kind: 'households' },
  { key: 'unallocated_positive_capital', label: 'Unallocated positive capital', unit: 'currency millions', kind: 'money' },
  { key: 'reference_billed_volume_million_m3', label: 'Reference billed volume', unit: 'million m³/year', kind: 'volume' },
  { key: 'raw_billed_volume_million_m3', label: 'Raw billed volume', unit: 'million m³/year', kind: 'volume' },
  { key: 'non_nrw_billed_volume_million_m3', label: 'Reconciled non-NRW billed volume', unit: 'million m³/year', kind: 'volume' },
  { key: 'billed_volume_million_m3', label: 'Reconciled scenario billed volume', unit: 'million m³/year', kind: 'volume' },
  { key: 'reference_collected_revenue', label: 'Reference collected revenue', unit: 'currency millions', kind: 'money' },
  { key: 'collected_revenue', label: 'Collected revenue', unit: 'currency millions', kind: 'money' },
  { key: 'connection_revenue_delta', label: 'Connection revenue contribution', unit: 'currency millions', kind: 'money' },
  { key: 'applicable_tariff', label: 'Applicable shared tariff', unit: 'currency/m³', kind: 'rate' },
  { key: 'applicable_collection_ratio', label: 'Applicable collection ratio', unit: 'fraction', kind: 'rate' },
  { key: 'incremental_variable_operating_cost', label: 'Incremental variable operating cost', unit: 'currency millions', kind: 'money' },
  { key: 'connection_net_cash', label: 'Connection net cash', unit: 'currency millions', kind: 'money' },
  { key: 'additional_net_cash', label: 'Additional net cash', unit: 'currency millions', kind: 'money' },
  { key: 'collection_cash', label: 'Collection attribution', unit: 'currency millions', kind: 'money' },
  { key: 'tariff_cash', label: 'Tariff attribution', unit: 'currency millions', kind: 'money' },
  { key: 'eligible_nrw_link_cash', label: 'Eligible NRW-linked sanitation net cash', unit: 'currency millions', kind: 'money' },
  { key: 'microfinance_cohort_offers', label: 'Microfinance cohort offers', unit: 'million households', kind: 'households' },
  { key: 'microfinance_cohort_unserved', label: 'Microfinance cohort still unserved', unit: 'million households', kind: 'households' },
  { key: 'microfinance_cohort_self_excluded', label: 'Self-finance-excluded cohort', unit: 'million households', kind: 'households' },
  { key: 'mf_flow_hh', label: 'Microfinance-delivered households', unit: 'million households', kind: 'households' },
  { key: 'grant_flow_hh', label: 'Grant-assisted households', unit: 'million households', kind: 'households' },
  { key: 'target_sm_overachievement_hh', label: 'SM target overachievement', unit: 'million households', kind: 'households' },
  { key: 'target_basic_or_better_overachievement_hh', label: 'Basic-or-better target overachievement', unit: 'million households', kind: 'households' },
] as const;

export type NRWDiagnosticField = { key: string; label: string; unit: string; kind: 'volume' | 'money' | 'households' | 'rate' };

export function aggregateNrwDiagnosticField(results: any[], field: NRWDiagnosticField, index: number,
  sector: 'water_supply' | 'sanitation' = 'water_supply'): number | null {
  const valueAt = (result: any, key: string) => {
    const sec = result?.[sector] ?? result;
    const value = sec?.[`scenario_${key}`];
    if (Array.isArray(value)) return typeof value[index] === 'number' && Number.isFinite(value[index]) ? value[index] : null;
    return index === 0 && typeof value === 'number' && Number.isFinite(value) ? value : null;
  };
  const values = results.map(result => valueAt(result, field.key));
  if (!values.length || values.some(value => value == null)) return null;
  if (field.kind !== 'rate') return values.reduce<number>((sum, value) => sum + (value as number), 0);
  // Weight tariff by billed volume and collection ratio by tariff-weighted billed volume; never add rates.
  const weights = results.map(result => {
    const volume = valueAt(result, 'billed_volume_million_m3');
    const tariff = valueAt(result, 'applicable_tariff');
    if (volume == null || (field.key === 'applicable_collection_ratio' && tariff == null)) return null;
    return Math.max(0, (volume || 0) * (field.key === 'applicable_collection_ratio' ? (tariff || 0) : 1));
  });
  if (weights.some(weight => weight == null)) return null;
  const denominator = weights.reduce<number>((sum, weight) => sum + (weight as number), 0);
  return denominator > 0
    ? values.reduce<number>((sum, value, i) => sum + (value as number) * (weights[i] as number), 0) / denominator
    : null;
}
