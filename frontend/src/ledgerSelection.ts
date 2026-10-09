import { interventionEnabled } from './interventionRegistry';

/** Selection is independent of contribution size and the backend source registry. */
export function selectedLedgerSources(datasets: any[], sector: 'water' | 'sanitation'): string[] {
  const prefix = sector === 'water' ? 'ws' : 'san';
  const toggles: Record<string, string> = {
    budget_execution: `${prefix}_capital_efficiency_enabled`,
    financial: `${prefix}_financial_commitment_enabled`,
    injection: `${prefix}_exogenous_injection_enabled`,
    connections: `${prefix}_connections_enabled`,
    collection: `${prefix}_collection_efficiency_enabled`,
    tariff: `${prefix}_tariff_enabled`,
    nrw: 'ws_nrw_enabled',
    nrw_link: 'san_nrw_link_enabled',
    microfinance: `${prefix}_microfinance_enabled`,
    grant: `${prefix}_microfinance_enabled`,
  };
  return [
    ...Object.entries(toggles).filter(([source, key]) =>
      !(source === 'nrw' && sector !== 'water') &&
      !(source === 'nrw_link' && sector !== 'sanitation') &&
      datasets.some(input => interventionEnabled(input, key))).map(([source]) => source),
    ...(datasets.some(input => (input.custom_interventions ?? []).some((item: any) =>
      item && item.enabled !== false && (!item.sector || item.sector === 'both' || item.sector === sector)))
      ? ['custom'] : []),
    ...(datasets.some(input => input.utility_debt?.[sector]?.enabled &&
      Number(input.utility_debt[sector].allocation_share) > 0) ? ['loan'] : []),
  ];
}
