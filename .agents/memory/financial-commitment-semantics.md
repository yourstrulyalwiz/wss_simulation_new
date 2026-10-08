---
name: Financial commitment semantics
description: Product rules for financial commitments, recurring funding and one-time injections.
---

## One-time injection exception

The full one-time ordinary injection enters available funds in its selected
year, without spending-share/execution adjustments. Recurring injections and
financial commitments retain the rules below. Do not compensate saved amounts.

**Why:** The user's 2026-10-08 funding/repayment follow-on explicitly narrows this
exception to one-time injections, not financial commitments in general.

**How to apply:** Separate mode-specific calculations and UI helper descriptions;
the downstream ordinary priorities still include debt service and replacement.
The GDP target and annual growth are additive commitment options; exogenous injection is a separate intervention, independently switched and separately attributed. The GDP entry is a target total sector-spending share, not an uplift; add only the positive difference above BAU. Annual growth compounds over its inclusive range, and absolute injections may be one-time or recurring.

All added commitments are full-spending amounts and become capital available for service through the sector's existing capex-share and budget-execution treatment. In cost-derived budget mode, compare GDP targets and growth with the preserved total-spending BAU series, not the derived capital budget.

**Why:** This prevents double-counting BAU, keeps the intervention economically consistent across budget modes, preserves the agreed distinction between pledged spending and effective capital, and lets users identify injections separately from spending commitments.

**How to apply:** Use these rules for calculations, attribution, and exports in both water supply and sanitation. Keep sector and geographic-area settings independent. When reading old saved inputs, migrate an enabled injection before constructing cumulative attribution passes; otherwise the injection can be counted under commitments instead.

When total spending is genuinely missing in cost-derived mode, use the derived
BAU investment's equivalent total spending (investment divided by capital share
and execution rate) as an explicitly estimated commitment reference. Do not
replace any supplied spending, including explicit zero.

**Why:** The DRC mock scenario has cost-derived investment but no supplied total
spending. Treating that missing input as an observed zero hid the baseline GDP
share and made annual growth ineffective. This inference is a modelling
equivalent, not measured public expenditure.

**How to apply:** Retain missing-versus-zero provenance through normalization,
use the same inferred reference for the baseline display and GDP/growth cash
calculation, and label the estimate. A zero capital/execution factor cannot
support inversion; show the reference as unavailable. Blank financial schedules
use the first forecast year through forecast end; invalid enabled schedules
must fail explicitly rather than compound from year zero.