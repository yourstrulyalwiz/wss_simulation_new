export const CONNECTION_REVENUE_VERSION = 4;
export const CONNECTION_REVENUE_MIGRATION_NOTICE = 'New-connection revenue now uses aggregate coverage expansion at baseline rates. Historical calibration and connection operating costs no longer apply; recalculated results may change.';

export type ConnectionRevenueConfig = {
  version: number;
  method: 'aggregate_coverage_expansion';
  enabled: boolean;
  new_billed_share_basic: number | null;
  new_billed_share_sm: number | null;
  shared_assumption_note: string;
  legacy_metadata?: Record<string, unknown>;
  migration_notice?: string;
};
const finiteOrNull = (value: unknown): number | null => {
  if (value === '' || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

/** Only pre-v3 records inherit historical shares. Explicit zeros and cleared v3 drafts survive. */
export function migrateConnectionRevenueConfig(value: any): ConnectionRevenueConfig {
  const old = value && typeof value === 'object' ? value : {};
  const version = Number(old.version) || 1;
  const active = ['version', 'method', 'enabled', 'new_billed_share_basic', 'new_billed_share_sm',
    'shared_assumption_note', 'legacy_metadata', 'migration_notice'];
  const removed = Object.fromEntries(Object.entries(old).filter(([key]) => !active.includes(key)));
  const legacy = { ...(old.legacy_metadata || {}), ...removed };
  const share = (key: 'basic' | 'sm') => finiteOrNull(
    Object.prototype.hasOwnProperty.call(old, `new_billed_share_${key}`) || version >= 3
      ? old[`new_billed_share_${key}`] : old[`billed_share_${key}`]);
  return {
    version: CONNECTION_REVENUE_VERSION,
    method: 'aggregate_coverage_expansion',
    enabled: old.enabled === true,
    new_billed_share_basic: share('basic'),
    new_billed_share_sm: share('sm'),
    shared_assumption_note: typeof old.shared_assumption_note === 'string' ? old.shared_assumption_note : '',
    ...(Object.keys(legacy).length ? { legacy_metadata: legacy } : {}),
    ...(old.migration_notice || (value && version < 4)
      ? { migration_notice: old.migration_notice || CONNECTION_REVENUE_MIGRATION_NOTICE } : {}),
  };
}

/** Current base/count validation is authoritative on /api/revenue-bases; no legacy gates. */
export function validateConnectionRevenueConfig(config: ConnectionRevenueConfig, _inputs?: any, _sector?: 'water' | 'sanitation') {
  if (!config.enabled) return [];
  const issues: string[] = [];
  for (const [value, label] of [
    [config.new_billed_share_basic, 'Basic expansion billed'],
    [config.new_billed_share_sm, 'Safely Managed expansion billed'],
  ] as const) {
    if (value == null) issues.push(`${label} is required.`);
    else if (!Number.isFinite(value) || value < 0 || value > 1) issues.push(`${label} must be between 0 and 100%.`);
  }
  return issues;
}

export function migrateConnectionRevenueInputs(inputs: any) {
  if (!inputs) return inputs;
  const water = migrateConnectionRevenueConfig(inputs.connection_revenue?.water);
  const sanitation = migrateConnectionRevenueConfig(inputs.connection_revenue?.sanitation);
  if (inputs.toggles?.ws_connections_enabled === false) water.enabled = false;
  if (inputs.toggles?.san_connections_enabled === false) sanitation.enabled = false;
  return { ...inputs, connection_revenue: {
    ...(inputs.connection_revenue || {}),
    water,
    sanitation,
  } };
}
