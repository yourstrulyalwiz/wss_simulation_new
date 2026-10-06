# Replit instruction 2: clarify the ledger UI and financing graphs

Repository: `yourstrulyalwiz/wss_simulation_new`

## Objective and scope

Make the financial tables answer **What still needs financing, and where?** Implement all five refinements below. Retain years across the table columns, the BAU-to-scenario comparison, and the existing intervention-effects view.

The historical transition correction is specified separately in `Replit_01_Fix_Transition_Inconsistency.md`. Prefer implementing that correction before taking final comparison screenshots. This UI brief does not change unit-cost assumptions, NRW/microfinance caps, investment allocation shares, or replacement priorities. The incremental-versus-full SM cost question stays deferred.

Inspect the current repository instructions, `docs/financing-ledger.md`, engine outputs, financial graph/table components and exports before editing. Add reporting fields where needed to expose actual calculations. Do not approximate missing balances in the frontend or present unverified legacy allowances as validated obligations. Keep unresolved replacement and ancillary-cost questions visible in concise component-level explanations.

## 1. Default view: Where the requirement/gap comes from

Provide two financial-view choices:

- **Where the requirement/gap comes from** — selected by default.
- **Effects of interventions** — preserves the existing BAU-to-scenario comparison and attribution order.

Retain **years across columns**. Use a pinned row-label column, clearly indented expandable rows and visible subtotals. Keep the combined scenario total visible when expanding detail. Here “combined scenario” means the scenario with all selected interventions; it does not introduce a new aggregation of sectors.

For the selected sector and scenario, use this row hierarchy:

| Level | Rows |
|---|---|
| Total | Combined scenario total / national total |
| Geography | Urban; Rural |
| Service | Safely managed; Basic access |
| Components within area/service | Household expansion; ancillary infrastructure; replacement; separately defined cash shortfall |

Make replacement expandable into current-year and deferred amounts when the engine supplies that distinction. Use the precise transition labels in section 4 for expansion component rows. Keep a separate BAU comparison accessible without replacing the default geographical/component breakdown with intervention contributions.

Apply the view to both water and sanitation. If an existing combined water-and-sanitation view is supported, retain a sector level above geography so totals remain traceable.

### Aggregation and missing attribution

- Sum the actual service/area components to each subtotal; do not independently recompute a national gap by netting an urban surplus against rural obligations.
- Preserve scenario settings specific to each area.
- Trace obligations to their source in the engine. Do not allocate shared cash deficits or ancillary obligations using arbitrary percentages or duplicate them under Basic and SM.
- Where a component is genuinely shared, show **Shared / not allocated by service** as a separate reconciling row at the appropriate area or sector level.
- Distinguish zero from missing/unavailable data. Do not display missing components as zero.
- Do not revive ancillary infrastructure that has been removed. If the current engine still contains an allowance, display it separately with its actual status; hide the row if it is absent throughout the selected scope and years.

### Historical DRC illustration — not hard-coded expected results

The following figures were supplied from an earlier saved DRC scenario review for the 2035 water financing balance. They illustrate the requested explanation, not a fresh verification or an acceptance target. They include questioned replacement carryover and ancillary allowances. Recalculate from current saved inputs and the current engine after changes; do not hard-code these values into production or tests.

| Area | SM-related obligations | Basic-related obligations | Total |
|---|---:|---:|---:|
| Urban | 167.8 | 1,573.8 | 1,741.7 |
| Rural | 1,144.2 | 2,711.3 | 3,855.5 |
| National | 1,312.0 | 4,285.2 | 5,597.2 |

US$ million. Values are reproduced as supplied; some displayed sums differ by 0.1. Use unrounded source values for all actual totals, and explain rounding where necessary. This single-year cross-section illustrates a drill-down; it does not replace the required years-across-columns main table.

Expanding Urban → SM would explain the 167.8 as follows:

| Component | US$ million |
|---|---:|
| Remaining SM household expansion | 0.0 |
| Unpaid ancillary/treatment allowance | 69.6 |
| Accumulated unpaid replacement | 98.2 |
| Total | 167.8 |

The UI should make this interpretation clear: **The SM household target can be met while other amounts remain in that service's financial balance.** Show the replacement and ancillary components without implying their assumptions have been independently validated.

## 2. Distinguish scheduled expansion from expansion still needed

Use the headline **Requirements before this year's funding** and the following labels:

| Proposed label | Meaning and handling |
|---|---|
| Scheduled expansion cost — reference | Cost implied by annual growth in the target pathway; supporting annual-flow information, outside the unpaid-requirement subtotal |
| Expansion still requiring funding — before this year's spending | Unfinished household expansion after crediting previous delivery, including delivery ahead of schedule; includes relevant current-year work once |
| Current-year replacement requirement | Replacement allowance for infrastructure already built, using the engine's actual asset base |
| Verified deferred replacement | Legitimate unfinished replacement, carried once and reduced when completed; use this label only when the ledger supports that behavior |
| Ancillary infrastructure still requiring funding | Separately identified supporting infrastructure still outstanding, if present in the current engine |

If separately defined outstanding cash obligations form part of the engine's pre-funding requirement, display them explicitly and document their meaning and overlap checks.

Keep the scheduled expansion row visible as supporting information, with a clear **Reference — annual flow** tag. It must not be added again to outstanding expansion. Do not relabel a closing/year-end balance as a requirement before funding. Expose the correct pre-funding value from the calculation if necessary.

Distinguish legitimate deferred replacement from an accumulated legacy diagnostic. If the separate deferred-replacement correction is not implemented, label the reported amount **Accumulated replacement shortfall — legacy measure** and explain its limitation. Do not silently declare that it can be settled or that it is verified.

## 3. Financing gap as a clear closing balance

Default headline: **Remaining financing need at year-end**.

The intended closing balance is:

```text
remaining household expansion
+ unpaid ancillary work
+ legitimate unpaid replacement (current and prior years, counted once)
+ separately defined outstanding cash obligations
```

Every included component must have a stated meaning, correct timing, and no overlap with another component. Cash shortfall must not duplicate unpaid replacement or other obligations. If a legacy output prevents a fully verified balance, retain the visible breakdown and explicitly mark the affected component and total as including an unresolved allowance; do not hide the issue or invent a corrected value.

### Funding applied alongside the closing balance

Show **Funding applied during the year** in an adjacent section aligned to the same year columns and area/service rows, covering the actual supported breakdown, such as current replacement paid, deferred replacement paid, household expansion paid and ancillary work paid. Distinguish available funding, actual spending and unspent funding where the engine provides those values. Do not treat physical NRW upgrades as cash spending; identify noncash delivery separately where needed to explain the closing balance. Keep externally financed delivery distinct from sector cash and avoid duplicate credit.

Do not subtract total available funding again from a closing balance: funded household delivery has already reduced outstanding expansion. Do not force a simple pre-funding-need-minus-cash formula if noncash delivery, target revisions or repricing also affect the balance. Where material, show these separately in the reconciliation or explanatory detail.

### Advanced residual view

Retain the existing current-year residual measure in an advanced view, labeled **Closing expansion plus current-year financial shortfall** where that matches the actual formula. Explain that it includes outstanding expansion and **is not an annual flow that can be summed**. Document the precise included components.

In multi-year summaries, sum genuine annual flows only. For balances, use the selected closing year and label it **Outstanding at [year]**. A sequence of balances 8, 16 and 24 has a closing balance of 24, not a cumulative gap of 48. Selecting a later starting year must not discard earlier obligations still outstanding at the closing year.

## 4. Clarify service and geographic interpretation

Use these expansion labels consistently in tables, tooltips and exports:

- **Basic access expansion: lower service → Basic**.
- **SM upgrades: Basic → safely managed**.

Use **Basic-only** for the exclusive coverage category. The minimum Basic-access threshold is **at least Basic**, which includes SM. Do not add inclusive at-least-Basic household counts to SM household counts when forming totals. Explain that a household can pass through both investment transitions; transition counts are not necessarily unique beneficiaries to be summed.

### Show both national attainment and local unmet targets

Display two distinct coverage indicators alongside the financial interpretation, for each selected sector and service threshold:

1. **National coverage surplus/shortfall** — signed actual coverage minus the corresponding national target.
2. **Households still below area-specific targets** — the sum of positive unmet targets across Urban and Rural, with area detail available.

For area a and a consistently defined threshold:

```text
actual_SM[a] = SM_households[a]
actual_at_least_Basic[a] = Basic_only_households[a] + SM_households[a]

local_unmet = sum_a max(target_households[a] - actual_households[a], 0)
national_signed_difference = total_actual_households - national_target_households
```

Use the engine's actual target definitions. Where national targets are the aggregation of area targets, national_target_households is their sum. If the model has an independent national target, label that distinction; do not invent a new national pathway. Use household-weighted national coverage, not an unweighted average of area percentages. Show units explicitly (households, percent, or percentage points).

Illustrative check: Urban exceeds its target by 200 households and Rural falls short by 100. National net attainment can be +100 while 100 households remain below the Rural target. Show both; do not allow national surplus to erase the local-target shortfall. These coverage indicators are explanatory and must not be added to currency-valued financial obligations.

## 5. Make the financing graph reconcile with the table

Add an explicit line or companion chart labeled **Remaining financing need—with interventions**. It must show the same closing-balance series as the default financing-gap table, for identical sector, geography, year, currency and scenario selections. Keep BAU remaining financing need available for comparison.

Retain existing colored intervention-effect bands in the **Effects of interventions** view. Explain visibly that they represent changes from BAU, not the remaining need. Prefer a companion closing-balance chart if adding the line to existing bands would mix incompatible quantities or make the result ambiguous.

### Consistent sign convention

Use one convention across graph, effects table, legend, tooltips and exports. Recommended convention:

```text
reduction_i = balance_before_intervention_i - balance_after_intervention_i

BAU_balance - sum(reduction_i) = combined_scenario_balance
```

Label these **Reduction in financing need**: positive means reduced need; negative means increased need. Show negative effects faithfully and explain them. Do not truncate them to zero or call all effects savings. Retain the model's existing sequential attribution order and explain that an effect is marginal to the interventions preceding it; do not substitute a sum of standalone runs.

If retaining signed changes instead, define them as after minus before, label every related display **Change in financing need**, and use BAU + sum(changes) = scenario. Do not mix conventions.

Reconcile using the same financial metric throughout. If existing attribution bands use the legacy residual while the new headline uses the full closing obligation, expose consistent cumulative-pass reporting for the chosen balance, or retain the legacy bands in a clearly labeled advanced chart. Do not silently relabel legacy data or imply they reconcile to a different metric. State any unresolved component limitations in both chart and table.

## Shared implementation requirements

- Keep year columns, scenario labels, sector, geography, currency and scale visible. Preserve existing currency conversion behavior and calculate totals before rounding.
- Tag financial quantities as **Annual flow**, **Before funding**, **Year-end balance** or **Reference**, as appropriate.
- Synchronize graph and table filters; expanding rows must not alter model results or scenario inputs.
- Support keyboard-operated expansion controls with meaningful labels and expanded-state announcements; preserve readable headers and horizontal scrolling for many years.
- Carry the displayed hierarchy and definitions into existing CSV/Excel exports. Export area, service, component, timing and units as explicit fields so indentation alone is not needed to interpret a row. Keep reference flows distinct from balances in exports.
- Inspect existing fields such as `annual_planned_expansion_cost`, `catch_up_requirement`, `closing_outstanding_expansion`, `endline_financing_requirement`, paid replacement/expansion fields and scenario equivalents. Verify their formulas and timing; do not map from names alone.
- Add exact reporting breakdowns at their calculation source if missing. Do not infer service-level replacement from expansion shares, or treat missing attribution as zero.
- Update ledger documentation with UI labels, source fields, formulas, timing and remaining limitations. Preserve underlying model behavior except for separately authorized model corrections.

## Acceptance checks and completion report

1. On opening financial requirements or financing gap, the default is the source-of-need view with years across columns. Urban/Rural → SM/Basic → components expands correctly, and Effects of interventions remains accessible.
2. Area/service/component totals reconcile using unrounded values, including shared obligations. Verify water and sanitation, BAU and combined scenario, and both areas; do not hard-code the DRC illustration.
3. A case with zero outstanding SM household expansion but nonzero replacement or ancillary obligations clearly explains the positive SM financial balance.
4. Scheduled expansion is a reference flow, distinct from pre-funding need; previously funded or advance delivery is not charged again.
5. Closing balances are not summed over years or reduced by available funding a second time. Deferred replacement and ancillary limitations remain visible where unresolved.
6. A case with urban overachievement and rural underachievement displays both national net attainment and local unmet households correctly, using the right threshold.
7. The remaining-need line/companion chart matches the default table. Intervention effects reconcile under one stated sign convention, including a negative-effect case where applicable.
8. Changing display mode or expanding detail does not change calculated household delivery, spending, cap behavior or allocation.
9. Existing exports preserve the new meanings, units, timing and hierarchy, and the expansion controls work with the keyboard.

Report changed files, verified source-field mappings, any reporting dependencies still unresolved, and focused verification results. Include screenshots of the default view, an expanded area/service, the intervention-effects view, the coverage comparison and the remaining-need graph. Do not claim that presentation changes resolve replacement legitimacy or ancillary calibration.

This file is a programming instruction; producing it does not change repository code.
