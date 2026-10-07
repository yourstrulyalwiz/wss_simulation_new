export const CONNECTION_REVENUE_VERSION = 3;

export type CostBasis = 'per_m3' | 'annual_household' | 'expenditure_proxy';
export type ConnectionRevenueConfig = {
  version: number;
  enabled: boolean;
  billed_share_sm: number | null;
  billed_share_basic: number | null;
  new_billed_share_sm: number | null;
  new_billed_share_basic: number | null;
  household_volume_share: number | null;
  marginal_cost: number | null;
  cost_basis: CostBasis;
  annual_cost_per_household: number | null;
  cost_proxy: null | {
    expenditure: number;
    baseline_year: number;
    currency: string;
    currency_basis: 'real_raw';
    sector: 'water' | 'sanitation';
    area: string;
    household_allocation: number | null;
    allocation_confirmed: boolean;
    note: string;
  };
  shared_assumption_note: string;
  zero_cost_confirmed: boolean;
  alignment: 'estimate' | 'observation' | null;
  baseline_volume_mld: number | null;
  funding_reference: 'exogenous' | 'fixed' | 'series' | null;
  reference_confirmed: boolean;
  funding_includes_reforms: boolean;
  reference_series: Record<string, number | null>;
  nonhousehold_growth_rate: number | null;
  consumption_m3?: number | null;
  observed_billed_households?: number | null;
  lower_service_billing_acknowledged: boolean;
  provenance: Record<string, { source_type: 'observed' | 'assumed' | null; reference_year: number | null; note: string }>;
  [key: string]: any;
};

const emptyConfig: ConnectionRevenueConfig = {
  version: CONNECTION_REVENUE_VERSION,
  enabled: false,
  billed_share_sm: null,
  billed_share_basic: null,
  new_billed_share_sm: null,
  new_billed_share_basic: null,
  household_volume_share: null,
  marginal_cost: null,
  cost_basis: 'per_m3',
  annual_cost_per_household: null,
  cost_proxy: null,
  shared_assumption_note: '',
  zero_cost_confirmed: false,
  alignment: null,
  baseline_volume_mld: null,
  funding_reference: null,
  reference_confirmed: false,
  funding_includes_reforms: false,
  reference_series: {},
  nonhousehold_growth_rate: null,
  lower_service_billing_acknowledged: false,
  provenance: {},
};

const finiteOrNull = (value: unknown) => {
  if (value === '' || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export function operatingExpenditureSource(inputs: any, sector: 'water' | 'sanitation') {
  const intervention = inputs?.[sector === 'water' ? 'water_interventions' : 'sanitation_interventions'] || {};
  return {
    expenditure: finiteOrNull(intervention.tariff_op_expenditure),
    baseline_year: finiteOrNull(intervention.tariff_op_expenditure_reference_year) ??
      finiteOrNull(inputs?.period?.baseline_year),
    currency: String(inputs?.country_config?.currency || '').trim().toUpperCase(),
    currency_basis: String(intervention.tariff_op_expenditure_currency_basis || 'real_raw').trim().toLowerCase(),
    sector,
    // Match the adapter's source scope, not the display/human area prop.
    area: String(inputs?.country_config?.area || '').trim().toLowerCase(),
  };
}

export function snapshotOperatingExpenditureProxy(inputs: any, sector: 'water' | 'sanitation',
  householdAllocation: number | null, note = 'Explicit household-cost allocation required.') {
  const source = operatingExpenditureSource(inputs, sector);
  if (source.expenditure == null || source.expenditure <= 0 || !source.baseline_year ||
      source.baseline_year !== finiteOrNull(inputs?.period?.baseline_year) ||
      !source.currency || !source.area || source.currency_basis !== 'real_raw' ||
      (householdAllocation != null && (!Number.isFinite(householdAllocation) || householdAllocation < 0 || householdAllocation > 1))) return null;
  return {
    expenditure: source.expenditure as number,
    baseline_year: source.baseline_year as number,
    currency: source.currency as string,
    currency_basis: 'real_raw' as const,
    sector: source.sector,
    area: source.area as string,
    household_allocation: householdAllocation,
    allocation_confirmed: householdAllocation != null,
    note,
  };
}

/** Cost conversion preserves the legacy non-household-only q=0 path as k=0. */
export function annualCostPerHousehold(consumptionM3: number | null, marginalCost: number | null) {
  if (consumptionM3 == null || marginalCost == null || !Number.isFinite(consumptionM3) ||
      !Number.isFinite(marginalCost) || consumptionM3 < 0 || marginalCost < 0) return null;
  return consumptionM3 * marginalCost;
}

export function equivalentMarginalCost(annualCost: number | null, consumptionM3: number | null) {
  if (annualCost == null || consumptionM3 == null || !Number.isFinite(annualCost) ||
      !Number.isFinite(consumptionM3) || annualCost < 0 || consumptionM3 <= 0) return null;
  return annualCost / consumptionM3;
}

/** Migrate without truthiness fallbacks: explicit zeroes and unfinished drafts are data. */
export function migrateConnectionRevenueConfig(value: any): ConnectionRevenueConfig {
  const old = value && typeof value === 'object' ? value : {};
  const version = Number(old.version) || 1;
  const migrated = { ...emptyConfig, ...old } as ConnectionRevenueConfig;
  migrated.version = CONNECTION_REVENUE_VERSION;
  migrated.reference_series = { ...(old.reference_series || {}) };
  migrated.provenance = { ...(old.provenance || {}) };
  migrated.shared_assumption_note = typeof old.shared_assumption_note === 'string' ? old.shared_assumption_note : '';
  if (version < CONNECTION_REVENUE_VERSION) {
    migrated.new_billed_share_basic = finiteOrNull(old.billed_share_basic);
    migrated.new_billed_share_sm = finiteOrNull(old.billed_share_sm);
    if (!migrated.provenance.new_billed_share_basic && migrated.provenance.billed_share_basic) {
      migrated.provenance.new_billed_share_basic = { ...migrated.provenance.billed_share_basic };
    }
    if (!migrated.provenance.new_billed_share_sm && migrated.provenance.billed_share_sm) {
      migrated.provenance.new_billed_share_sm = { ...migrated.provenance.billed_share_sm };
    }
    // Legacy marginal_cost remains authoritative until the user explicitly changes basis.
    migrated.cost_basis = 'per_m3';
    migrated.annual_cost_per_household = null;
    migrated.cost_proxy = null;
    const baseline = finiteOrNull(old.baseline_volume_mld);
    if (migrated.alignment == null && baseline != null) migrated.alignment = 'observation';
  } else {
    migrated.new_billed_share_basic = finiteOrNull(old.new_billed_share_basic);
    migrated.new_billed_share_sm = finiteOrNull(old.new_billed_share_sm);
    migrated.cost_basis = ['per_m3', 'annual_household', 'expenditure_proxy'].includes(old.cost_basis)
      ? old.cost_basis : 'per_m3';
    migrated.annual_cost_per_household = finiteOrNull(old.annual_cost_per_household);
    migrated.cost_proxy = old.cost_proxy && typeof old.cost_proxy === 'object' ? { ...old.cost_proxy } : null;
  }
  return migrated;
}

export function validateConnectionRevenueConfig(config: ConnectionRevenueConfig, inputs: any, sector: 'water' | 'sanitation') {
  const issues: string[] = [];
  const checkShare = (value: number | null, label: string) => {
    if (value == null) issues.push(`${label} is required.`);
    else if (!Number.isFinite(value) || value < 0 || value > 1) issues.push(`${label} must be between 0 and 100%.`);
  };
  checkShare(config.new_billed_share_basic, 'New Basic connections billed');
  checkShare(config.new_billed_share_sm, 'New Safely Managed connections billed');
  checkShare(config.billed_share_basic, 'Baseline Basic billed share');
  checkShare(config.billed_share_sm, 'Baseline Safely Managed billed share');
  checkShare(config.household_volume_share, 'Household share of billed volume');
  const q = Number(config.consumption_m3);
  const effectiveCost = config.cost_basis === 'annual_household'
    ? config.annual_cost_per_household
    : config.cost_basis === 'expenditure_proxy'
      ? (config.cost_proxy && Number(config.cost_proxy.expenditure) / Number(config.observed_billed_households))
      : config.marginal_cost == null || !Number.isFinite(q) || q <= 0 ? null : Number(config.marginal_cost) * q;
  if (config.cost_basis === 'per_m3' && (config.marginal_cost == null || !Number.isFinite(config.marginal_cost) || config.marginal_cost < 0)) {
    issues.push('Enter a finite, nonnegative marginal cost per m³.');
  }
  if (config.cost_basis === 'annual_household' &&
      (config.annual_cost_per_household == null || !Number.isFinite(config.annual_cost_per_household) || config.annual_cost_per_household < 0)) {
    issues.push('Enter a finite, nonnegative annual cost per billed household.');
  }
  if (config.cost_basis === 'expenditure_proxy') {
    const proxy = config.cost_proxy;
    const source = operatingExpenditureSource(inputs, sector);
    if (!proxy || !Number.isFinite(Number(proxy.expenditure)) || Number(proxy.expenditure) <= 0) issues.push('The operating-expenditure proxy requires positive annual expenditure.');
    if (!proxy?.allocation_confirmed || !Number.isFinite(Number(proxy.household_allocation)) || Number(proxy.household_allocation) <= 0 || Number(proxy.household_allocation) > 1) {
      issues.push('Confirm an explicit household-cost allocation between 0 and 100%.');
    }
    if (proxy && (proxy.sector !== source.sector || proxy.area !== source.area ||
        Number(proxy.baseline_year) !== Number(inputs.period?.baseline_year) ||
        Number(proxy.baseline_year) !== Number(source.baseline_year) ||
        proxy.currency !== source.currency || proxy.currency_basis !== source.currency_basis ||
        proxy.currency_basis !== 'real_raw' || Number(proxy.expenditure) !== source.expenditure)) {
      issues.push('The saved expenditure proxy scope, baseline year, currency, or real/raw basis no longer matches these inputs.');
    }
  }
  const selectedCostIsZero = config.cost_basis === 'per_m3'
    ? config.marginal_cost === 0
    : effectiveCost === 0;
  if (selectedCostIsZero && !config.zero_cost_confirmed) issues.push('Explicitly confirm the selected zero-cost assumption.');
  const baseline = Number(inputs?.period?.baseline_year);
  const anchorYear = inputs?.revenue_bases?.[sector]?.reference_year;
  if (config.alignment === 'observation' && (config.baseline_volume_mld == null || !Number.isFinite(config.baseline_volume_mld) || config.baseline_volume_mld < 0)) {
    issues.push('A baseline-year observed billed volume is required.');
  }
  if (anchorYear != null && Number(anchorYear) !== baseline && !config.alignment) issues.push('The shared volume anchor differs from baseline; authorize an estimate or supply an observation.');
  if (!config.alignment && anchorYear != null && Number(anchorYear) === baseline) issues.push('Choose baseline-volume alignment.');
  if (config.baseline_volume_mld != null && (!Number.isFinite(config.baseline_volume_mld) || config.baseline_volume_mld < 0)) {
    issues.push('Observed baseline billed volume must be finite and nonnegative.');
  }
  if (config.consumption_m3 != null && (!Number.isFinite(config.consumption_m3) || config.consumption_m3 < 0)) {
    issues.push('Consumption check must be finite and nonnegative.');
  }
  if (config.observed_billed_households != null && (!Number.isFinite(config.observed_billed_households) || config.observed_billed_households < 0)) {
    issues.push('Observed billed households must be finite and nonnegative.');
  }
  if (!config.funding_reference) issues.push('Choose what household revenue is already included in funding.');
  if (!config.reference_confirmed) issues.push('Confirm the funding-reference assumption.');
  if (config.funding_includes_reforms) issues.push('Baseline funding already includes future tariff or collection reforms; reconcile this before enabling dynamic comparison.');
  if (config.funding_reference === 'series') {
    const years = Object.keys(config.reference_series || {});
    if (!years.length || years.some(year => !Number.isInteger(Number(year)) || config.reference_series[year] == null ||
      !Number.isFinite(Number(config.reference_series[year])) || Number(config.reference_series[year]) < 0)) {
      issues.push('Provide a complete, nonnegative year:value household funding-reference series.');
    }
    const start = baseline + 1;
    const end = Number(inputs.period?.forecast_end_year);
    if (Number.isInteger(start) && Number.isInteger(end) && end >= start) {
      const missing = Array.from({ length: end - start + 1 }, (_, index) => String(start + index))
        .filter(year => !Object.prototype.hasOwnProperty.call(config.reference_series || {}, year));
      if (missing.length) issues.push(`Funding reference series is missing model years: ${missing.join(', ')}.`);
    }
  }
  const provenanceKeys = ['billed_share_sm', 'billed_share_basic', 'household_volume_share',
    'new_billed_share_basic', 'new_billed_share_sm',
    ...(config.cost_basis === 'per_m3' ? ['marginal_cost'] : config.cost_basis === 'annual_household' ? ['annual_cost_per_household'] : ['cost_proxy']),
    ...(config.alignment === 'observation' ? ['baseline_volume_mld'] : []),
    ...(config.consumption_m3 != null ? ['consumption_m3'] : []),
    ...(config.observed_billed_households != null ? ['observed_billed_households'] : []),
    ...(config.nonhousehold_growth_rate != null ? ['nonhousehold_growth_rate'] : []),
    ...(config.funding_reference === 'series' ? ['reference_series'] : []),
  ];
  provenanceKeys.forEach(key => {
    const p = config.provenance?.[key];
    const hasFieldDraft = !!p && (!!p.source_type || !!p.note?.trim() || p.reference_year != null);
    // The common note is valid only when no field-specific source/draft exists.
    if (hasFieldDraft ? !p?.source_type || !p.note?.trim() : !(config.shared_assumption_note || '').trim()) {
      issues.push(`Add observed/assumed provenance and a source note for ${key.replace(/_/g, ' ')}.`);
    }
    if (p?.reference_year != null && (!Number.isInteger(Number(p.reference_year)) || Number(p.reference_year) < 1)) {
      issues.push(`Reference year for ${key.replace(/_/g, ' ')} must be a positive integer.`);
    }
  });
  if (config.nonhousehold_growth_rate != null && (!Number.isFinite(config.nonhousehold_growth_rate) || config.nonhousehold_growth_rate <= -1)) {
    issues.push('Non-household growth must be finite and greater than −100%.');
  }
  return issues;
}
