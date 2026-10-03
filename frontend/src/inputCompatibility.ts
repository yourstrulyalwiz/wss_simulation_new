// New financing options must not change the behavior of pre-existing saved scenarios.
export const BORROWING_DEFAULTS = {
  cash_allocation_alpha: 0,
  borrow_drawdown_year: 2028,
  borrow_interest_rate: 0.08,
  borrow_term_years: 10,
  borrow_min_dscr: 1.2,
  borrow_ceiling: 0,
  existing_debt_service: 0,
  borrow_entity_name: '',
  borrow_cash_streams: ['collection', 'nrw', 'tariff', 'custom', 'nrw_link'],
  // Existing scenarios treated this rate as real. New backend defaults are nominal.
  borrow_rate_basis: 'real',
  baseline_obligations_known: false,
  borrow_contract_principal: 0,
};

export function migrateInputCompatibility(area: any) {
  if (!area) return area;
  const version = Number.isFinite(Number(area.reporting_schema_version)) ? Number(area.reporting_schema_version) : 0;
  const notes: string[] = [...(area.migration_notes || [])];
  const methodNote = 'Saved targets do not identify asset ages, retirements or paying customers. Current calculations use gross connection/upgrade transitions and an approximate prior-year asset-value replacement allowance.';
  if (version < 2 && !notes.includes(methodNote)) notes.push(methodNote);
  const toggles = { ...(area.toggles || {}) };
  const migrated = { ...area, toggles, reporting_schema_version: Math.max(2, version),
    legacy_financing_settings: { ...(area.legacy_financing_settings || {}) } };
  for (const [prefix, section] of [['ws', 'water_interventions'], ['san', 'sanitation_interventions']]) {
    const label = prefix === 'ws' ? 'Water Supply' : 'Sanitation';
    const settings = { ...(area[section] || {}) };
    const borrowing = `${prefix}_borrowing_enabled`;
    const legacyFinance = version < 2 && !('borrow_rate_basis' in settings && 'borrow_contract_principal' in settings);
    if (legacyFinance) {
      migrated.legacy_financing_settings[section] = {
        cash_allocation_alpha: settings.cash_allocation_alpha ?? null,
        borrowing_enabled: toggles[borrowing] ?? null,
      };
      settings.cash_allocation_alpha = 0;
      toggles[borrowing] = false;
      notes.push(`${label}: legacy financing defaults to reinvest-all/no-new-borrowing. Previous allocation/enable settings are retained for review, not activated.`);
      if (!('borrow_rate_basis' in settings)) notes.push(`${label}: interest basis was not recorded; the saved rate retains its legacy real-rate interpretation. Verify whether nominal was intended.`);
      if (!('baseline_obligations_known' in settings)) notes.push(`${label}: baseline financial coverage is unknown; any borrowing capacity is a conditional incremental estimate, not a creditworthiness assessment.`);
    }
    const injection = `${prefix}_exogenous_injection_enabled`;
    if (!(injection in toggles)) {
      toggles[injection] = !!(toggles[`${prefix}_financial_commitment_enabled`] && area[section]?.fin_injection_enabled);
      if (version < 2 && settings.fin_injection_enabled) notes.push(`${label}: the legacy nested injection follows its former commitment switch. Review the now-independent public capital injection control.`);
    }
    if (!(borrowing in toggles)) toggles[borrowing] = false;
    for (const [key, value] of Object.entries(BORROWING_DEFAULTS)) {
      // Fill only absent fields: keep existing settings, including deliberately cleared cells.
      if (!(key in settings)) settings[key] = value;
    }
    migrated[section] = settings;
  }
  migrated.migration_notes = [...new Set(notes)];
  return migrated;
}