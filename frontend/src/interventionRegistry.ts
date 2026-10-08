import { INTV_PALETTE as P } from './chartColors';

export type InterventionDefinition = { key: string; label: string; color: string; resourceKey?: string };
export const WATER_INTERVENTIONS: InterventionDefinition[] = [
  { key: 'ws_connections_enabled', label: 'Revenue from new connections', color: P.connections, resourceKey: 'scenario_connection_net_cash' },
  { key: 'ws_financial_commitment_enabled', label: 'Financial commitments', color: P.financial, resourceKey: 'scenario_financial_commitment_cash' },
  { key: 'ws_exogenous_injection_enabled', label: 'Exogenous injection of funds', color: P.injection, resourceKey: 'scenario_exogenous_injection_cash' },
  { key: 'ws_collection_efficiency_enabled', label: 'Collection efficiency', color: P.collection, resourceKey: 'scenario_collection_cash' },
  { key: 'ws_capital_efficiency_enabled', label: 'Budget execution', color: P.budgetExec },
  { key: 'ws_costeff_enabled', label: 'Capex efficiency', color: P.capex },
  { key: 'ws_techmix_enabled', label: 'Optimised technology', color: P.techmix },
  { key: 'ws_nrw_enabled', label: 'NRW reduction', color: P.nrw, resourceKey: 'scenario_nrw_net' },
  { key: 'ws_tariff_enabled', label: 'Tariff reform', color: P.tariff, resourceKey: 'scenario_tariff_cash' },
  { key: 'ws_microfinance_enabled', label: 'Microfinance', color: P.microfinance, resourceKey: 'scenario_mf_loan_volume' },
];
export const SANITATION_INTERVENTIONS: InterventionDefinition[] = [
  { key: 'san_connections_enabled', label: 'Revenue from new connections', color: P.connections, resourceKey: 'scenario_connection_net_cash' },
  { key: 'san_financial_commitment_enabled', label: 'Financial commitments', color: P.financial, resourceKey: 'scenario_financial_commitment_cash' },
  { key: 'san_exogenous_injection_enabled', label: 'Exogenous injection of funds', color: P.injection, resourceKey: 'scenario_exogenous_injection_cash' },
  { key: 'san_collection_efficiency_enabled', label: 'Collection efficiency', color: P.collection, resourceKey: 'scenario_collection_cash' },
  { key: 'san_capital_efficiency_enabled', label: 'Budget execution', color: P.budgetExec },
  { key: 'san_costeff_enabled', label: 'Capex efficiency', color: P.capex },
  { key: 'san_techmix_enabled', label: 'Optimised technology', color: P.techmix },
  { key: 'san_nrw_link_enabled', label: 'NRW-linked sanitation revenue', color: P.nrw, resourceKey: 'scenario_eligible_nrw_link_cash' },
  { key: 'san_tariff_enabled', label: 'Tariff reform', color: P.tariff, resourceKey: 'scenario_tariff_cash' },
  { key: 'san_microfinance_enabled', label: 'Microfinance', color: P.microfinance, resourceKey: 'scenario_mf_loan_volume' },
];

// Shared with the export convention: BOTH connection stages first, then ordinary water,
// ordinary sanitation, custom interventions, and finally indicative loan funding.
export const GLOBAL_INTERVENTION_ORDER = [
  WATER_INTERVENTIONS[0], SANITATION_INTERVENTIONS[0],
  ...WATER_INTERVENTIONS.slice(1), ...SANITATION_INTERVENTIONS.slice(1),
];
export const COMPARISON_ORDER_TEXT = 'Household comparison order: water connections → sanitation connections → water interventions → sanitation interventions → custom interventions → loan funding. Bands show delivered household effects, not cash-source receipts.';

export function interventionEnabled(inputs: any, key: string): boolean {
  if (key === 'ws_connections_enabled' || key === 'san_connections_enabled') {
    if (inputs?.toggles?.[key] === false) return false;
    return !!inputs?.connection_revenue?.[key.startsWith('ws_') ? 'water' : 'sanitation']?.enabled;
  }
  return !!inputs?.toggles?.[key];
}

/** Isolated pass; never mutate a saved configuration or enable an area that is off. */
export function comparisonInputs(inputs: any, stages: Record<string, boolean>) {
  const toggles = Object.fromEntries([...new Set([...Object.keys(inputs?.toggles || {}),
    ...GLOBAL_INTERVENTION_ORDER.map(d => d.key)])].map(key => [key, !!stages[key] && interventionEnabled(inputs, key)]));
  return { ...inputs, toggles, connection_revenue: {
    ...inputs.connection_revenue,
    water: { ...inputs.connection_revenue?.water, enabled: toggles.ws_connections_enabled },
    sanitation: { ...inputs.connection_revenue?.sanitation, enabled: toggles.san_connections_enabled },
  } };
}

export function setInterventionEnabled(inputs: any, key: string, enabled: boolean) {
  const next = { ...inputs, toggles: { ...inputs?.toggles, [key]: enabled } };
  if (key === 'ws_connections_enabled' || key === 'san_connections_enabled') {
    const sector = key.startsWith('ws_') ? 'water' : 'sanitation';
    next.connection_revenue = { ...inputs?.connection_revenue, [sector]: { ...inputs?.connection_revenue?.[sector], enabled } };
  }
  return next;
}
