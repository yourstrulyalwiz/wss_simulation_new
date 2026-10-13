---
name: Financial commitment semantics
description: Product rules for financial commitments, recurring funding and one-time injections.
---

## Approved public-spending execution policy

The 2026-10-13 instruction maintains the standalone growth option's achieved
executed-spending/GDP share after the increase window. It is a floor, not a
ceiling, and excludes the additive GDP-target option and execution gains.
Zero growth stays inert even if later BAU shares fall.
**Why:** Stopping the increases must not undo the commitment or freeze its
currency amount; other execution benefits remain independently attributable.
**How to apply:** Preserve the calendar exponent and total-versus-capital basis.

The user explicitly clarified on 2026-10-12 that executed budgets higher than
allocated budgets are normal and must not block forecasting or later steps.
Allow E/A above 100% without clipping or warnings. For positive E with zero A,
use E as the effective allocation and 100% execution internally, keeping the
entered allocation unchanged. Execution reform retains signed effects.

**Why:** This supersedes the brief's E>A rejection; rejecting overspending
prevented the user's legitimate country scenarios from running.

**How to apply:** Preserve raw inputs and independent forecasts. Use the same
effective allocation in source reconciliation and aggregate execution ratios.

The approved 2026-10-12 Budget Forecast, Capital Share and Public Spending brief
supersedes the October 9 rules below for the active Budget-input workflow.
Its executed target is not discounted by baseline execution: Public Spending
receives kD and Budget Execution receives k(A+D/r0)(r1-r0). Executed and allocated
budgets are independently forecast from entered GDP shares; the explicit
total-spending toggle alone enables capital conversion. Revenue changes remain
deferred, and saved country profiles must not be rewritten.

**Why:** The user supplied a new approved modeling contract distinguishing
executed targets from allocations and replacing cost-derived budget forecasts.

**How to apply:** Follow the attached Budget Forecast, Capital Share and Public
Spending instructions dated 2026-10-12; do not use the older policy below to
override that brief. Preserve external-funding formulas separately.

### Earlier policy, superseded for the active workflow

Country calibration must not be repaired by borrowing example budgets just to
make a calculation run. Use explicit synthetic budgets only in controlled
regression fixtures, without rewriting saved profiles. Overspending is valid,
not a country-data inconsistency; apply the clarification above.

**Why:** Missing observations and unverified demo entries remain distinct from
legitimate spending above allocations.

**How to apply:** Preserve original observations, display targeted validation,
and distinguish arithmetic verification from validation of country estimates.

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