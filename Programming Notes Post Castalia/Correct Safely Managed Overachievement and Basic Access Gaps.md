# Correct Safely Managed Overachievement and Basic Access Gaps

## Assessment and proposed programming instructions

**Date:** 5 October 2026  
**Status:** Implemented and verified in development on 5 October 2026; the original assessment and proposal are retained below.  
**Scope:** Current development version. Do not publish automatically.

## 1. Concern

In the DRC mock simulation, improvements in safely managed (SM) water access can reduce the number of households in the basic-only category because those households upgrade to SM service.

This reduction is not necessarily a loss of access. Safely managed service satisfies the basic minimum. Treating every decline in basic-only coverage as a new basic-access obligation can therefore misrepresent the remaining service gap.

The assessment must distinguish:

- **Basic-only coverage:** the mutually exclusive category below SM.
- **At-least-basic coverage:** SM plus basic-only households.
- **SM upgrade requirements:** households still needing an upgrade to meet the SM objective.
- **Basic-entry requirements:** households still needing entry from lower service levels to meet the combined SM-plus-basic objective.

## 2. Findings from the current implementation

### Already correct

The existing expansion ledger measures basic-entry commitments against the combined SM-plus-basic target. It records lower-to-basic entries separately from basic-to-SM upgrades.

Consequently, an SM upgrade does not itself create a new basic-entry obligation in that ledger. The inspected financing calculation prices the ledger's outstanding transitions rather than the raw exclusive basic-only shortfall.

The existing single-credit financing and funded-assets corrections must be preserved. Subtracting SM surplus again from combined commitments or outstanding basic entries would understate genuine financing requirements.

### Remaining misleading calculations

The legacy `household_gap_basic` diagnostic still compares the original basic-only target with basic-only coverage:

```text
max(0, basic-only target − basic-only coverage)
```

The Basic BAU chart summary independently makes the same comparison. These calculations can describe upgrades to SM as an unmet basic-access requirement, even when the expansion ledger is correct.

### Limits of this assessment

The saved DRC mock profile was recalculated during the assessment. That profile does not necessarily contain the user's latest browser edits.

The saved-profile results do not support the conclusion that SM upgrades are currently widening the financing ledger through artificial basic-entry obligations. The particular widening figure observed in the user's working scenario still needs to be traced to its actual inputs and displayed measure.

## 3. Saved DRC mock illustration

For primary-area water in 2035, the saved profile has the capital-efficiency intervention enabled.

| Measure | BAU | With enabled intervention |
|---|---:|---:|
| SM households | 2.687 million | 3.783 million |
| Basic-only households | 2.785 million | 1.689 million |
| At-least-basic households | 5.472 million | 5.472 million |
| Outstanding basic-entry households | 3.351 million | 3.351 million |
| Endline financing requirement | CDF 7.068 trillion | CDF 4.022 trillion |

Original endline targets are approximately **3.676 million SM households** and **5.146 million basic-only households**.

The intervention increases SM coverage and reduces basic-only coverage by the same amount. Combined access is unchanged. The raw basic-only shortfall increases, but the outstanding basic-entry requirement does not. The endline financing requirement falls.

This illustrates why the coverage diagnostic and financing ledger must be assessed separately.

## 4. Intended service-gap interpretation

For each modeled geography, sector and year, use household counts:

- `H`: total projected households.
- `S`: achieved SM households.
- `B`: achieved basic-only households.
- `Ts`: original SM target households.
- `Tb`: original basic-only target households.

```python
sm_surplus = max(0.0, S - Ts)
effective_basic_target = max(0.0, Tb - sm_surplus)
adjusted_basic_only_gap = max(0.0, effective_basic_target - B)
sm_gap = max(0.0, Ts - S)

at_least_basic_target = Ts + Tb
at_least_basic_coverage = S + B
at_least_basic_gap = max(0.0, at_least_basic_target - at_least_basic_coverage)
```

The effective basic-only target is a diagnostic, not a replacement for the original target pathway. Basic-entry costing follows the combined objective; SM-upgrade costing follows the SM objective.

SM overachievement can satisfy the basic minimum. Basic overachievement cannot satisfy an SM shortfall.

### Numerical examples

With 100 total households and original targets of 70 SM / 30 basic:

| Achieved SM / basic | Effective basic-only target | Adjusted basic-only gap | SM gap | At-least-basic gap |
|---|---:|---:|---:|---:|
| 80 / 20 | 20 | 0 | 0 | 0 |
| 80 / 15 | 20 | 5 | 0 | 5 |
| 60 / 40 | 30 | 0 | 10 | 0 |
| 60 / 30 | 30 | 0 | 10 | 10 |
| 100 / 0 | 0 | 0 | 0 | 0 |

The **80/20** example has no remaining connection-expansion need. Legitimate replacement, ancillary or other financial obligations can still remain.

The **60/30** example requires ten lower-to-basic entries and ten basic-to-SM upgrades under the existing staged pathway. An exclusive basic-only gap of zero must not erase those basic-entry costs.

## 5. Proposed programming changes

### Step 1 — Trace and preserve the baseline

Capture before-change results from the saved DRC mock and, if available through existing non-destructive session/profile flows, the user's current working scenario.

Identify the widening measure and separate:

- Closing outstanding expansion.
- Replacement requirements and unpaid replacement.
- Ancillary obligations.
- Cash deficits.
- Endline accumulated shortfalls.

Confirm that the existing single-credit financing and funded-assets prerequisites remain present.

### Step 2 — Introduce shared hierarchy-aware diagnostics

Add or reuse one shared service-gap assessment for water and sanitation, using the same year's household totals for targets and achieved coverage.

Expose SM surplus, effective basic-only target, adjusted basic-only gap, SM gap and at-least-basic access gap.

Validate finite nonnegative values, target and coverage household limits, and reconciliation of all five exclusive coverage categories. Document a floating-point tolerance in the engine's units of millions of households. Do not conceal materially invalid totals by clipping or scaling them.

### Step 3 — Reconcile with the existing expansion ledger

Verify that closing outstanding SM upgrades reconcile to the SM gap and closing outstanding basic entries reconcile to the at-least-basic access gap under the existing no-deterioration assumptions.

Preserve the ledger wherever it already reconciles. Change financing logic only where a demonstrated discrepancy exists.

Preserve:

- Original annual target commitments.
- Carry-forward and current-cost repricing of outstanding households.
- Early delivery and explicit target reductions.
- Separate sector-funded, externally funded and physical delivery credits.
- Funded asset stock and its legitimate replacement requirements.
- Existing ancillary and non-household costs.

Do not subtract SM surplus a second time, credit upgrades as basic entries, or convert physical service delivery into an extra cash injection.

### Step 4 — Make output meanings explicit

Expose corresponding BAU and scenario diagnostics. Add explicit fields or migrate legacy meanings with all consumers updated; do not silently redefine an API field.

Assess gaps locally before aggregation. National results must sum local deficits rather than let one geography's surplus erase another geography's unmet requirement.

Refresh affected derived results without overwriting original inputs or saved scenarios.

### Step 5 — Align charts, tables and exports

Update affected live-chart summaries, Results Dashboard explanations, reconciliation tables and CSV/Excel/PowerPoint outputs.

Use clear labels:

- **Basic-only coverage**
- **Basic-only target shortfall after SM credit** — diagnostic
- **At-least-basic access gap** — basic-entry costing measure

Keep original target markers and mutually exclusive coverage categories. Preserve signed basic-only decreases in contribution views.

Explain that safely managed coverage above its target counts toward the basic minimum. Distinguish expansion costs from replacement and other accumulated financial shortfalls.

### Step 6 — Add focused regression coverage

Test the numerical examples above and their financing implications, including:

- Zero connection-expansion cost at 80/20 against a 70/30 target.
- Five basic entries priced once at 80/15.
- Ten SM upgrades and ten basic entries at 60/30.
- Constant-target upgrades from 70/30 to 80/20, with no artificial basic backlog that year or the next.
- Later funding that closes genuine basic-entry deficits once.
- Replacement obligations remaining after household targets are achieved.
- Partial targets, growing household totals, zero basic targets and exact achievement.
- Floating-point boundaries and rejection of materially invalid totals.
- Geography-specific deficits assessed before National aggregation.
- Water and sanitation, BAU and scenario paths, including an existing path that permits SM overachievement.

Rerun relevant single-credit financing, expansion carry-forward, funded-stock replacement, debt, frontend and export regressions.

### Step 7 — Verify and report

Verify rendered views and downloaded results. Report:

- What was already correct.
- What changed.
- Any changed output fields and meanings.
- Before/after results for the illustrative cases.
- Tests and verification results.
- Remaining intervention-ceiling or source-pool findings requiring separate review.

Leave the development version ready for review. Do not publish automatically.

## 6. Explicit boundaries

This proposal does not authorize:

- Replacing the existing expansion ledger or applying older patch versions.
- Changing original target interpolation or configured investment splits.
- Changing unit costs, ordinary previous-year purchase rules or source-pool eligibility.
- Introducing direct lower-service-to-SM connections or same-year double upgrades.
- Removing NRW or affordability SM target ceilings.
- Changing debt or revenue methodology.
- Broad dashboard redesign or profile-storage migration.

Existing NRW and affordability ceiling behavior should be documented as a separate finding, not changed as part of this correction.

## 7. Implementation starting points

- `model/water_supply.py`
- `model/sanitation.py`
- `model/expansion_ledger.py`
- `model/engine.py`
- `model/gap_attribution.py`
- `frontend/src/components/LiveBAUChart.tsx`
- `frontend/src/components/LiveInterventionChart.tsx`
- `frontend/src/components/ResultsDashboard.tsx`
- `frontend/src/components/ScenarioGapTables.tsx`
- `export_data.py`
- `deck_data.py`
- `deck_aggregate.py`
- `test_expansion_ledger.py`
- `test_residual_financing_gap.py`
- `test_service_gap_attribution.py`
- `test_scenario_gap_composition.py`
- `test_mock_drc.py`

## 8. Source documents

- User instruction: `attached_assets/Replit_SM_Overachievement_and_Basic_Gap_Fix_1791210754753.md`
- Detailed programming plan: `.local/tasks/correct-hierarchical-service-gaps.md`
- Saved profile assessed: `profiles/DRC_Mock_Simulation.json`

## 9. Implementation and verification report

### What changed

- Added shared minimum-service diagnostics for both sectors and independent BAU/scenario passes.
- Added explicit SM surplus, effective basic-only target, adjusted basic-only shortfall and at-least-basic access fields.
- Added validation of household totals and reconciliation of forecast closing transitions with access gaps.
- Updated Basic BAU summaries and forecast-table gap labels to use the adjusted diagnostic instead of the raw exclusive-category difference.
- Added expandable **Service access gaps and outstanding transitions** tables to BAU charts, Intervention Design and the Results Dashboard, with CSV/Excel downloads.
- Extended scenario CSV/Excel forecast exports and both PowerPoint export paths with service-access reconciliation.

The existing expansion ledger was already correct for this issue and was preserved. All pre-existing model output fields in the saved DRC primary and rural calculations remain unchanged. The legacy raw `household_gap_basic` field retains its meaning for compatibility; consumers now use explicit fields where hierarchy-aware reporting is required.

Detailed field definitions and changed files are documented in `docs/service-access-gaps.md`. Original target pathways, exclusive coverage, financing allocation, funded assets and saved profile inputs remain unchanged.

### Before/after interpretation

For 70 SM / 30 basic targets and 80 SM / 20 basic coverage:

- Legacy raw basic-only shortfall: **10 households**, still retained as a compatibility diagnostic.
- New adjusted basic-only shortfall: **0 households**.
- At-least-basic access gap: **0 households**.
- Outstanding connection-expansion requirement: **0**, as already correctly calculated by the existing ledger.

For 80/15, five genuine basic entries remain. For 60/30, ten basic entries and ten SM upgrades remain. Replacement, ancillary and accumulated financial shortfalls are not erased by SM surplus.

### Verification

- All **68 Python tests passed**, including hierarchy examples, financing integration, multi-year upgrades, later closure of real deficits, funded stock and replacement, growing household totals, validation, geography-specific gaps and export checks.
- Frontend production build passed.
- Frontend tests passed for local-gap aggregation, both BAU/scenario passes and unchanged input data.
- Chromium checks passed for both sectors in BAU, Intervention Design and the Results Dashboard, including rendered diagnostic tables and reconciliation with outstanding transitions.
- Existing contribution-category regression passed for both service levels, count/share views, Excel chart exports and geographic scopes.
- Existing saved DRC model outputs were compared before and after; all pre-existing fields were unchanged.
- The running development application and interactive dashboard were visually checked.

### Separate findings

Existing NRW and affordability SM target ceilings remain unchanged.

A separate zero-start interpolation issue was reproduced: with initial coverage of 80 SM / 0 basic and requested future targets of 70 SM / 15 basic, the current pathway can report 70 SM / 0 basic. This is outside the approved gap correction, which preserves target interpolation. It requires a separate review of how positive future targets are reached from zero starting counts.

No automatic publishing was performed.
