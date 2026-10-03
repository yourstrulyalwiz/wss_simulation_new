// New financing options must not change the behavior of pre-existing saved scenarios.
export const BORROWING_DEFAULTS = {
  cash_allocation_alpha: 0,
  borrow_drawdown_year: 2028,
  borrow_interest_rate: 0.08,
  borrow_term_years: 10,
  borrow_min_dscr: 1.2,
  borrow_ceiling: 0,
  existing_debt_service: 0,
};

export function migrateInputCompatibility(area: any) {
  if (!area) return area;
  const toggles = { ...(area.toggles || {}) };
  const migrated = { ...area, toggles };
  for (const [prefix, section] of [['ws', 'water_interventions'], ['san', 'sanitation_interventions']]) {
    const injection = `${prefix}_exogenous_injection_enabled`;
    if (!(injection in toggles)) {
      toggles[injection] = !!(toggles[`${prefix}_financial_commitment_enabled`] && area[section]?.fin_injection_enabled);
    }
    const borrowing = `${prefix}_borrowing_enabled`;
    if (!(borrowing in toggles)) toggles[borrowing] = false;
    const settings = { ...(area[section] || {}) };
    for (const [key, value] of Object.entries(BORROWING_DEFAULTS)) {
      // Fill only absent fields: keep existing settings, including deliberately cleared cells.
      if (!(key in settings)) settings[key] = value;
    }
    migrated[section] = settings;
  }
  return migrated;
}