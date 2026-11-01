/** Reporting contract only. Allocations come from the engine; missing values stay unavailable. */
export const REPLACEMENT_WATERFALL_FIELDS = [
  ['eligible_capital_after_losses_debt', 'Eligible pooled capital after current losses / debt service', 'Annual availability'],
  ['replacement_backlog_opening', 'Opening replacement backlog', 'Opening snapshot'],
  ['replacement_capex', 'Current replacement requirement', 'Annual flow'],
  ['replacement_current_paid', 'Current replacement paid', 'Annual flow'],
  ['replacement_backlog_paid', 'Opening replacement backlog paid', 'Annual flow'],
  ['replacement_paid_total', 'Total replacement paid (current + backlog)', 'Annual flow — subtotal'],
  ['replacement_backlog_closing', 'Closing replacement backlog', 'Closing snapshot'],
  ['ordinary_expansion_available', 'Ordinary capital remaining for expansion', 'Annual availability'],
  ['utility_debt_cash_available', 'Restricted expansion loan cash including carry', 'Annual availability'],
  ['sector_funded_expansion', 'Sector-funded expansion / ancillary spending', 'Annual flow'],
  ['connection_purchase_capital', 'Funded connection purchases — diagnostic, not additional to expansion', 'Annual flow'],
  ['ancillary_paid', 'Ancillary spending — diagnostic, included in expansion', 'Annual flow'],
  ['externally_funded_expansion', 'External household expansion spending', 'Annual flow'],
  ['unallocated_positive_capital', 'Unused positive expansion capital', 'Year-end balance'],
  ['loan_investment', 'Investment from restricted loan proceeds — included in sector expansion', 'Annual flow'],
  ['loan_closing_unspent', 'Closing unspent restricted loan proceeds', 'Closing snapshot'],
  ['financing_gap', 'Closing expansion + replacement backlog + current cash deficit', 'Closing balance plus current cash deficit'],
  ['endline_financing_requirement', 'Closing expansion + replacement backlog + accumulated cash shortfalls', 'Closing balance'],
] as const;

export function replacementWaterfallRows(results: any[], sector: 'water_supply' | 'sanitation',
  baselineYear: number, prefix = '') {
  if (!results.length) return [];
  return (results[0].years as number[]).flatMap((year, i) => year <= baselineYear ? [] : [{
    year,
    values: REPLACEMENT_WATERFALL_FIELDS.map(([field]) => {
      const amounts = results.map(r => {
        if (field === 'loan_investment' || field === 'loan_closing_unspent') {
          if (prefix !== 'scenario_') return 0;
          const debt = r[sector]?.scenario_utility_debt;
          if (debt?.enabled === false) return 0;
          const row = debt?.annual_injection?.find((entry: any) => Number(entry.year) === year);
          return row?.[field === 'loan_investment' ? 'investment_from_loan_proceeds' : 'closing_unspent_proceeds'];
        }
        return r[sector]?.[prefix + field]?.[i];
      });
      // Restricted utility borrowing does not exist in BAU, not an unknown receipt.
      if (!prefix && field === 'utility_debt_cash_available') return 0;
      return amounts.every(v => typeof v === 'number' && Number.isFinite(v))
        ? amounts.reduce((sum, v) => sum + v, 0) as number : null;
    }),
  }]);
}

/** Report each area's own settlement; never clear one area's backlog with another's cash. */
export function replacementWaterfallReports(results: any[], sector: 'water_supply' | 'sanitation',
  baselineYear: number, labels: string[], includeScenarios = false) {
  const scopes = results.map((result, i) => ({ label: labels[i] || `Area ${i + 1}`, results: [result] }));
  if (results.length > 1) scopes.unshift({ label: 'Selected scope total', results });
  const variants = includeScenarios
    ? [['', 'BAU'], ['scenario_', 'Scenario'], ['scenario_without_utility_debt_', 'Scenario without utility debt']]
    : [['', 'BAU']];
  return scopes.flatMap(scope => variants.map(([prefix, variant]) => ({
    label: `${scope.label} / ${variant}`,
    rows: replacementWaterfallRows(scope.results, sector, baselineYear, prefix),
  })));
}
