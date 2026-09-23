// ── Tool-wide chart colour convention — ONE meaning per colour ──────────────────────────────────
// Every graph in the tool (BAU chart, intervention-impact chart, results fan charts) must use these
// for the corresponding data series, so a colour always carries the same meaning to the reader.
export const C = {
  bau: '#2563eb',        // business-as-usual (BLUE)
  bauFill: '#bfdbfe',    // light-blue area fill for a BAU band
  target: '#16a34a',     // target — the level we're closing toward (GREEN)
  scenario: '#ea580c',   // with interventions / reforms (ORANGE)
  scenarioFill: '#fdba74', // light-orange fill for the intervention band/range
  total: '#6b7280',      // total households / coverage ceiling (GREY, dashed)
  gap: '#b91c1c',        // financing gap / shortfall (RED — a money dimension, not BAU/target/scenario)
  range: '#cbd5e1',      // NEUTRAL fill for a BAU→scenario range band, so the coloured lines stay readable on top
};

// Per-intervention categorical palette for the intervention-impact chart's stacked bands.
// Deliberately EXCLUDES blue (BAU) and green (target) so those meanings stay reserved.
// Order matches the intervention lists in LiveInterventionChart.
//
// These eight hues were chosen by a colour-distance search (not by eye) that maximises the
// MINIMUM separation between EVERY pair of bands — since any two can be compared side by side
// in the legend, not only stack neighbours — while staying clear of the reserved blue/green.
// Validated (dataviz validate_palette, white surface, --pairs all): worst-pair CVD ΔE ≈ 14.5
// (target ≥ 12), min normal-vision ΔE ≈ 25, all ≥ 3:1 contrast. The previous set had two
// near-identical clashes: budget-exec gold ≈ tariff amber (ΔE 1.5) and collection cyan ≈
// tech teal, which is what made bands hard to tell apart.
export const INTV_PALETTE = {
  collection: '#1a9ed6', // cyan       (the one cool anchor)
  budgetExec: '#c58216', // gold       (pushed far from tariff)
  capex: '#7238f8',      // violet
  techmix: '#b814a0',    // magenta    (was teal — clashed with collection cyan)
  nrw: '#fb464b',        // red
  tariff: '#c355fb',     // orchid     (was amber — clashed with budget-exec gold)
  microfinance: '#c5146a', // rose
  financial: '#0f766e',    // deep teal
  injection: '#b45309',    // dark amber — separate injection band
  custom: '#ae4f0e',     // burnt-orange (default for custom interventions; user-overridable)
};
