# Replit instructions: Public Spending, Budget Execution and External Funding

**Repository:** `yourstrulyalwiz/wss_simulation_new`  
**Reviewed branch:** `main`  
**Reviewed commit:** `fab9ba99f14db01ff009fab94a0224433deeffc4` — “Update attribution logic and refresh ledger screenshots”  
**Review date:** 9 October 2026  
**Deliverable:** implementation instructions; application code has not been changed by this review.

## 1. Scope

Implement only the following changes, for both Water Supply and Sanitation:

1. Rename the two existing interventions and their displayed source labels as specified below.
2. Attribute additional public spending at the baseline budget execution rate.
3. Apply the Budget Execution intervention to the existing public capital allocation **plus the additional public capital allocation**. Attribute the interaction entirely to Budget Execution.
4. Feed the corrected contributions into the existing source-funding ledger, coverage charts, tables and exports.

Keep the existing chart types, stacking, colours, band order, table layouts, columns, filters, units and geographic aggregation. Numerical results should change where the corrected funding changes the simulation. “Keep the outputs the same” means preserve their presentation and existing accounting method, not freeze incorrect numbers.

The reviewed commit already implements actual source-funded coverage. Build on that implementation; do not reimplement the previous source-attribution instructions or restore sequential coverage comparisons. No new tabs, charts, reporting sections, controls, diagnostics panels or unrelated features are requested.

If the working branch has advanced, inspect the relevant diff and apply this narrow change to the current implementation without reverting later work.

## 2. Required labels

| Existing displayed label, including its shortened variants | New displayed label |
|---|---|
| Increase in Financial Commitments / Financial commitments | **Increase in Public Spending** |
| Exogenous Injection of Funds / Exogenous injection of funds | **External Funding (Private Sector, Donor, Foreign Direct Investment)** |

Apply the new terminology to both sectors: intervention headings, existing explanatory text, legends, tooltips, contribution rows, detailed funding rows and user-facing export/deck labels.

Use the full External Funding wording in intervention headings and report labels. Where an existing compact legend cannot reasonably accommodate it, use **External Funding** and expose the full wording through the existing tooltip/title mechanism. Allow ordinary text wrapping; do not add a new interface component.

Preserve internal identifiers and saved-profile compatibility, including:

- `ws_financial_commitment_enabled`, `san_financial_commitment_enabled`, and existing `fin_*` settings.
- `ws_exogenous_injection_enabled` and `san_exogenous_injection_enabled`.
- Source keys `financial`, `budget_execution`, `injection`.
- Existing response keys such as `financial_commitment_cash`, `scenario_financial_commitment_cash` and injection equivalents.

This is a display rename, not a data migration. Do not globally replace “financial”, “injection” or “exogenous”: these words also describe unrelated finance concepts and the exogenous **connection-revenue mode**, which must retain its meaning.

## 3. Findings from the current code

### Shared calculation

`model/water_supply.py::sector_bau` implements the calculation used by both sectors; `model/sanitation.py` supplies the sanitation inputs.

Currently:

- The public-spending intervention computes an extra total-spending amount from the GDP target and/or annual growth settings.
- `financial_cash` converts that amount using the sector capital share and configured `financial_execution_rate`.
- `bau_available = capex_budget * eff` applies Budget Execution only to the original capital allocation.
- The source ledger assigns `bau_available - baseline_capital` to `budget_execution`.

Consequently, Budget Execution does not yet receive the execution gain on the newly added public allocation.

### Execution-rate distinction

The code has two different execution-rate concepts:

- The configured rate, passed as `financial_execution_rate=b.execution_rate`, currently used for financial commitments and recurring external injections.
- The execution intervention’s baseline rate, calculated as the existing year-specific `baseline_eff`, using the current override or the budget-used/budget-allocated relationship.

They can differ. Applying the first to the added allocation while applying the second to its reform increment would not produce a consistent decomposition.

**Implementation decision for this change:** use the existing `baseline_eff[t]` as the baseline execution rate for the added public capital allocation and its Budget Execution interaction. Preserve the existing baseline/reference construction and external-funding treatment. Do not change the BAU budget calculation to force the two rate concepts to match.

This intentionally changes public-spending-only funding where the old configured rate differs from `baseline_eff[t]`. That is part of making additional public spending follow the same baseline execution used by the Budget Execution intervention. Do not conceal the difference with a compensating adjustment.

### Existing presentation

The main dashboard already reads source funding and actual source-funded coverage. However, some export/deck resource calculations still use ordered-pass differences; the execution path in `deck_data.py::_released` reads `scenario_available_capex`. Those resource cells need the corrected final-scenario source contribution to include the interaction. Existing financial-gap comparisons should retain their current method.

## 4. Required annual accounting

For each sector, area and forecast year `t`, define:

| Symbol | Meaning / existing basis |
|---|---|
| `S0[t]` | Existing `financial_commitment_base[t]`: the spending reference for GDP-target/growth calculations |
| `deltaS[t]` | Additional total public spending from the existing enabled GDP-target/growth logic |
| `c` | Existing sector capital share, including the current fallback to the common share |
| `deltaB[t]` | Additional public capital allocation: `c * deltaS[t]` |
| `B0[t]` | Existing forecast-gated `capex_budget[t]`, before execution |
| `e0[t]` | Existing `baseline_eff[t]` |
| `e[t]` | Existing scenario execution series `eff[t]`; equals `e0[t]` when execution reform is inactive |

For forecast years:

```text
baseline_public_funding[t] = B0[t] * e0[t]

public_spending_cash[t] = deltaB[t] * e0[t]

budget_execution_cash[t] =
    (B0[t] + deltaB[t]) * (e[t] - e0[t])

total_executed_public_funding[t] =
    baseline_public_funding[t]
    + public_spending_cash[t]
    + budget_execution_cash[t]
  = (B0[t] + deltaB[t]) * e[t]
```

The interaction is `deltaB[t] * (e[t] - e0[t])`. Include it **once**, in Budget Execution. Do not also put it in Public Spending.

These are annual flows. Retain the existing growth schedule; do not accumulate prior years’ cash into the current year’s available funds.

### Numerical acceptance example

All amounts below are capital amounts in the same monetary unit, before debt service and replacement. Let `B0=100`, added allocation `deltaB=50`, baseline execution `e0=60%`, and improved execution `e=90%`.

| Enabled interventions | Baseline funding | Public Spending | Budget Execution | Total public funding |
|---|---:|---:|---:|---:|
| Neither | 60 | 0 | 0 | 60 |
| Public Spending only | 60 | 30 | 0 | 90 |
| Budget Execution only | 60 | 0 | 30 | 90 |
| Both | 60 | 30 | 45 | 135 |

The extra 15 belongs to Budget Execution. Public Spending remains 30 when the execution reform is switched on.

If a total-spending increment is 100 and the capital share is 50%, then `deltaB=50`; do not treat the full 100 as capital.

## 5. Preserve the existing spending reference and timing

Continue to calculate `deltaS` from the existing inputs:

- GDP setting remains a **target total spending share**, with an increment of `max(targetShare * GDP[t] - S0[t], 0)`.
- Annual growth remains `max(S0[t] * ((1 + growthRate) ** elapsedYears - 1), 0)` during the currently supported inclusive start/end period.
- When both sub-options are enabled, retain the existing additive treatment.
- Preserve master toggles, validation, default dates, start years, end years, growth exponent and execution ramp. Do not introduce new timing rules or extend growth after its current end year.
- No intervention cash is introduced into historical/baseline years.

Keep `financial_commitment_base`, the baseline spending-share display, entered-zero versus missing-input handling, and cost-derived reference provenance unchanged. In particular, do not recalculate the GDP/growth reference using the **improved** execution rate.

The existing estimated total-spending reference in cost-derived mode uses the configured capital/execution conversion factor. Preserve that reference contract and its “estimated” explanation in this patch. It is an upstream spending anchor, distinct from the execution rate now used to attribute incremental public capital. Update the nearby comment that currently says the reference uses the “SAME treatment applied to new commitments”; that wording would become inaccurate.

Do not apply another execution haircut to `used_budget`, direct spending already treated as executed, or cost-derived BAU investment. Take `B0`, `e0` and the existing baseline funding from the current execution pipeline.

Calculate `deltaB` directly from the spending increment and capital share. Do not recover it by dividing executed cash by `e0`; that fails when baseline execution is zero. Preserve the current handling of unavailable cost-derived spending references rather than inventing a spending base.

## 6. Minimal calculation changes

In `sector_bau`:

1. Retain the current calculation and validation of `deltaS`, but store its annual values or `deltaB` until `baseline_eff` and `eff` are available.
2. Leave injection calculation on its existing path.
3. After calculating `baseline_eff`, set `financial_cash = deltaB * baseline_eff`.
4. Calculate the execution contribution as `(bau_available - baseline_capital) + deltaB * (eff - baseline_eff)`, with historical entries remaining zero.
5. Supply these amounts to the existing source map:

```python
sources["baseline"] = baseline_capital[t]
sources["financial"] = financial_cash[t]
sources["budget_execution"] = budget_execution_cash[t]
sources["injection"] = injection_cash[t]
# Keep all other source calculations unchanged.
```

6. Include the interaction in `available_total` exactly once. Preserve the existing reconciliation assertion that the ordinary source contributions sum to available funding. Derive the total from the source map or update the existing availability expression consistently.
7. Let the existing simulation consume this funding. Additional coverage and any subsequent connection-based revenue effects should flow through the existing engine without a separate coverage adjustment or a new revenue rule.

Keep `bau_available` and `scenario_available_capex` on their existing original-budget meanings. Read the final source ledger for the full Budget Execution contribution; do not overload an old field and silently change other consumers. The existing `scenario_source_funding.signed_contribution.budget_execution` is sufficient, so a new public response field is unnecessary.

Keep signed execution contributions. If existing inputs allow execution below baseline, a negative contribution must follow the existing negative-source treatment; do not clip the interaction to zero.

## 7. External Funding remains independent

External Funding is a separate source and must not enter `B0 + deltaB`.

Preserve its current calculation:

- One-time mode: the full entered amount in its configured year.
- Recurring mode: the entered amount times the existing sector capital share and configured execution factor, within its existing date range.

Do not silently convert recurring external funding into fully executed capital, apply the improved public execution rate to it, add it to the public GDP/growth reference, or introduce private/donor/FDI subcategories. Those terms describe the renamed intervention; they are not new model inputs.

## 8. Funding deductions and coverage attribution

Use the existing `model/source_funding.py` and `model/coverage_attribution.py` machinery unchanged:

- Preserve the current treatment of negative source contributions.
- Preserve debt servicing against the existing selected eligible sources.
- Preserve pooled replacement funding and the existing proportional charges.
- Preserve the existing Basic/Safely Managed allocation, actual purchases, caps, rollover rules, source stocks and loan-cash separation.

Do not make Public Spending, Budget Execution or External Funding newly eligible for debt servicing or loan sizing merely because they have new labels.

Coverage attribution must continue to represent actual source-funded purchases after the existing deductions. Do not distribute total coverage using gross revenue shares or use a difference between earlier simulation runs. Gross funding shares and final coverage shares need not be identical when source-specific deductions apply.

The added execution gain will increase the Budget Execution funding contribution, and its available balance will fund coverage through the same machinery as every other ordinary source. The Public Spending band retains the coverage funded by its baseline-executed contribution.

## 9. Code touchpoints and output consistency

| File / area | Required action |
|---|---|
| `model/water_supply.py::sector_bau` | Store added public allocation; apply the shared baseline rate; add the execution interaction; reconcile source funding and available total. |
| `model/sanitation.py` | Verify the shared implementation receives the correct sanitation capital share, execution inputs and flags. Avoid duplicated logic. |
| `model/engine.py` | Verify existing scenario and without-debt ledger aliases carry the corrected contributions. Preserve existing response keys. |
| `frontend/src/components/InterventionPanel.tsx` | Rename both headings for both sectors; amend existing help text to explain baseline-executed public funds and the separately attributed execution gain. |
| `frontend/src/components/InterventionCategories.tsx` | Update its literal label matching alongside the headings so both interventions stay in their current category. |
| `frontend/src/interventionRegistry.ts` and `frontend/src/sourceAttribution.ts` | Rename displayed labels; preserve keys, colours, source order and mappings. |
| `frontend/src/components/ResultsDashboard.tsx` | Retain existing source-ledger resource totals and actual source coverage; verify corrected values reach the same rows/bands. |
| `frontend/src/resultsLedger.ts` | Rename the existing “Exogenous intervention injection” row and any corresponding displayed labels. Preserve ledger layout and calculations. |
| `deck_data.py` | Rename intervention definitions. For the Public Spending, Budget Execution and External Funding resource cells, use the final combined scenario’s signed source contributions. Do not use `_released`’s original-budget-only execution difference for this value. |
| `export_data.py` | Make the same three existing resource rows use the final source ledger; Budget Execution must display its corrected contribution rather than a missing or original-base-only value. Preserve financial-gap-effect calculations and columns. |
| `coverage_export.py` | Update user-facing source header text for the renamed sources while preserving their internal lookup keys, field order and values. |
| `deck_aggregate.py`, `contributionView.tsx`, existing live charts | Verify aggregation and label propagation; only change code where needed to carry the corrected data or labels. |
| Existing semantics notes and affected tests | Update directly conflicting descriptions/expectations, including `.agents/memory/financial-commitment-semantics.md`. Avoid unrelated documentation work. |

For resource totals, sum `signed_contribution[source]` over the same forecast years currently displayed, using the existing unit/currency conversions. Use the full selected scenario, including its current debt-view selection and area-specific toggles. Do not substitute post-deduction expansion balances into a resource column that currently reports pre-deduction contributions.

Preserve the existing distinction between utility revenues and funding sources. Do not add public spending or budget execution to a utility sales/collections revenue series. Their corrected amounts belong in the funding/resource outputs where these sources already appear.

Keep the stacked coverage presentation and independent BAU comparison. Retain the current Basic coverage presentation, category grouping and financial-gap chart methodology. A category total should inherit the corrected individual values without a new aggregation rule.

For combined-area results, calculate each area using its own capital share and execution series, then sum amounts and household counts. Do not apply an averaged execution rate to an aggregated budget.

## 10. Verification required before completion

Add focused calculation tests for this change and update affected existing expectations. Do not regenerate unrelated snapshots or create new application features for testing.

1. **Four-toggle matrix:** verify the numeric example above for both sectors; the combined scenario reconciles to 135 and Budget Execution receives 45.
2. **Rate mismatch:** configure the legacy execution factor differently from `baseline_eff`. Verify Public Spending uses `deltaB * baseline_eff`, Budget Execution uses the same baseline, and the baseline/reference and external-injection outputs retain their existing calculation.
3. **Capital share and modes:** cover GDP-based, direct and cost-derived spending; preserve supplied versus missing versus explicit-zero references. Verify the capital share is applied once and already-executed baseline spending is not discounted again.
4. **Timing and zero cases:** test staggered start years, the execution ramp, growth end year, inactive sub-options, zero increment, zero capital share and a zero baseline execution value at the calculation boundary. No division by zero or historical funding.
5. **External Funding exclusion:** both one-time and recurring amounts remain unchanged when execution reform is toggled; they do not create an execution interaction.
6. **Signed funding and deductions:** retain source-cash conservation, existing selected-source debt charges, replacement pooling and coverage-stock reconciliation when the new funding is present. Exercise a permitted negative execution delta through the existing allocator.
7. **Output agreement:** existing chart/tooltips, contribution table, detailed ledger, CSV/XLSX and deck resource rows agree with the same final source ledger. Coverage values agree with actual attributed household stocks. Check individual/category and area/combined views using existing controls.
8. **Regressions:** with Public Spending off, modelled funding and coverage remain unchanged by this patch; External Funding-only and Budget Execution-only scenarios retain their current calculation results. Filling the existing missing execution resource cell is an intended display correction. With Public Spending on, allow the intended baseline-rate correction and interaction, plus their normal downstream effects.
9. **Presentation and compatibility:** old saved profiles still load; both new labels appear; headings remain in the correct category; long labels remain readable; no new rows, columns, charts, controls or debug output are introduced apart from renaming existing labels and filling the existing execution resource value.

Use the current profile fixtures, including `profiles/DRC October 9.json`, for a representative integration check. Also exercise an existing October 8 fixture if available; do not overwrite either saved simulation. Run the relevant existing baseline-spending, external-injection, source-attribution, funding and export tests and the frontend build.

## 11. Completion report

Report the files changed, the new labels, the annual reconciliation example, the tests actually run and any remaining failure. Explicitly note that public-spending-only numbers can change where the legacy configured execution rate differs from the execution intervention’s baseline rate.

This brief is based on source review. The proposed implementation and its acceptance tests have not yet been executed.

