import React from 'react';
export type ContributionView = 'individual' | 'category';
export const CONTRIBUTION_CATEGORIES = [
  { id: 'funding', label: 'Funding Mobilization', color: '#0f766e', keys: ['ws_connections_enabled', 'san_connections_enabled', 'ws_financial_commitment_enabled', 'ws_exogenous_injection_enabled', 'san_financial_commitment_enabled', 'san_exogenous_injection_enabled', 'utility_debt_financing'] },
  { id: 'operations', label: 'Operational Efficiency Improvements', color: '#c58216', keys: ['ws_collection_efficiency_enabled', 'ws_nrw_enabled', 'san_collection_efficiency_enabled', 'san_nrw_link_enabled'] },
  { id: 'investment', label: 'Investment Planning and Delivery Improvements', color: '#7238f8', keys: ['ws_capital_efficiency_enabled', 'ws_costeff_enabled', 'ws_techmix_enabled', 'san_capital_efficiency_enabled', 'san_costeff_enabled', 'san_techmix_enabled'] },
  { id: 'tariff', label: 'Tariff Reform', color: '#c355fb', keys: ['ws_tariff_enabled', 'san_tariff_enabled'] },
  { id: 'household', label: 'Household Financing and Affordability', color: '#c5146a', keys: ['ws_microfinance_enabled', 'san_microfinance_enabled', 'household_grant'] },
] as const;
export type ViewBand = { key: string; label: string; color: string; interventionKey?: string; custom?: boolean; members?: { key: string; label: string }[] };
export function aggregateContributionRows(rows: any[], bands: ViewBand[]) {
  const mappedKeys = new Set<string>(CONTRIBUTION_CATEGORIES.flatMap(c => [...c.keys]));
  const unmapped = bands.filter(b => !b.custom && b.interventionKey && !mappedKeys.has(b.interventionKey));
  if (unmapped.length && import.meta.env?.DEV) {
    console.warn('Unmapped contribution keys are retained individually:', unmapped.map(b => b.interventionKey));
  }
  const out: ViewBand[] = [];
  for (const c of CONTRIBUTION_CATEGORIES) {
    const members = bands.filter(b => !b.custom && b.interventionKey && (c.keys as readonly string[]).includes(b.interventionKey));
    if (members.length && rows.some(r => members.some(m => Math.abs(Number(r[m.key] || 0)) > 1e-12)))
      out.push({ key: `category:${c.id}`, label: c.label, color: c.color, members: members.map(m => ({ key: m.key, label: m.label })) });
  }
  const customs = bands.filter(b => b.custom || !b.interventionKey);
  out.push(...unmapped);
  if (customs.length && rows.some(r => customs.some(m => Math.abs(Number(r[m.key] || 0)) > 1e-12)))
    out.push({ key: 'category:custom', label: 'Custom interventions', color: '#ae4f0e',
      members: customs.length === 1 && customs[0].label === 'Custom interventions'
        ? undefined : customs.map(m => ({ key: m.key, label: m.label })) });
  const grouped = rows.map(r => {
    const n = { ...r };
    for (const c of CONTRIBUTION_CATEGORIES) {
      const members = bands.filter(b => !b.custom && b.interventionKey && (c.keys as readonly string[]).includes(b.interventionKey));
      if (members.length) n[`category:${c.id}`] = members.reduce((sum, b) => sum + Number(r[b.key] || 0), 0);
    }
    if (customs.length) n['category:custom'] = customs.reduce((sum, b) => sum + Number(r[b.key] || 0), 0);
    return n;
  });
  return { rows: grouped, bands: out };
}
export function ContributionViewToggle({ value, onChange }: { value: ContributionView; onChange: (v: ContributionView) => void }) {
  return <div role="group" aria-label="Contribution view" style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
    <span style={{ fontSize: 11, fontWeight: 600, color: '#475569' }}>Contribution view:</span>
    {([['individual', 'Individual interventions'], ['category', 'Categories']] as const).map(([key, label]) =>
      <button key={key} type="button" aria-pressed={value === key} onClick={() => onChange(key)}
        style={{ padding: '5px 9px', border: '1px solid #cbd5e1', borderRadius: 6, cursor: 'pointer',
          background: value === key ? '#2563eb' : '#fff', color: value === key ? '#fff' : '#475569',
          fontSize: 11, fontWeight: value === key ? 700 : 500 }}>{label}</button>)}
  </div>;
}