---
name: Financial commitment semantics
description: Product rules for financial commitments, recurring funding and one-time injections.
---

## Approved public-spending execution policy

The 2026-10-09 user brief supersedes the earlier configured-execution treatment
for additional public spending only. Use the execution intervention's existing
year-specific baseline rate for added public capital. Attribute the signed
execution improvement on both existing and added public allocations entirely
to Budget Execution, exactly once. Preserve the configured-factor cost-derived
spending reference and the existing external-funding treatment independently.

**Why:** Configured execution and the intervention's baseline execution can
differ; the earlier model omitted the interaction on newly committed spending.
Public-spending-only results may intentionally change under the approved rule.

**How to apply:** Follow the attached Public Spending, Budget Execution and
External Funding instructions dated 2026-10-09. Preserve actual funded coverage,
original-budget response meanings, debt eligibility and selected-only display.
Display Financial Commitments as Increase in Public Spending, and the separate
injection as External Funding (Private Sector, Donor, Foreign Direct Investment);
keep internal identifiers and saved inputs unchanged.

## External funding and spending reference

The full one-time ordinary injection enters available funds in its selected
year, without spending-share/execution adjustments. Recurring injections retain
the configured capital/execution conversion. Public spending follows the approved
baseline execution policy above. Do not compensate saved amounts.

**Why:** The user's 2026-10-08 funding/repayment follow-on explicitly narrows this
exception to one-time injections, not financial commitments in general.

**How to apply:** Separate mode-specific calculations and UI helper descriptions;
the downstream ordinary priorities still include debt service and replacement.
The GDP target and annual growth are additive commitment options; exogenous injection is a separate intervention, independently switched and separately attributed. The GDP entry is a target total sector-spending share, not an uplift; add only the positive difference above BAU. Annual growth compounds over its inclusive range, and absolute injections may be one-time or recurring.

All added public commitments are full-spending amounts: apply the sector capital share once, then baseline_eff for Public Spending and the signed execution improvement separately for Budget Execution. In cost-derived budget mode, compare GDP targets and growth with the preserved total-spending BAU series, not the derived capital budget.

**Why:** This prevents double-counting BAU, keeps the intervention economically consistent across budget modes, preserves the agreed distinction between pledged spending and effective capital, and lets users identify injections separately from spending commitments.

**How to apply:** Use these rules for calculations, attribution, and exports in both water supply and sanitation. Keep sector and geographic-area settings independent. When reading old saved inputs, migrate an enabled injection before constructing cumulative attribution passes; otherwise the injection can be counted under commitments instead.

When total spending is genuinely missing in cost-derived mode, use the derived
BAU investment's equivalent total spending (investment divided by capital share
and the configured execution rate, not baseline_eff or improved execution) as an explicitly estimated commitment reference. Do not
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