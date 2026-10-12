# WSS Simulation Tool — Programming Instructions

## Budget forecasts, capital share, and Public Spending × Budget Execution

**Status:** Approved modeling scope; implementation instructions only. No application code has been changed in preparing this document.

**Prepared:** 12 October 2026.

**Repository reviewed:** [yourstrulyalwiz/wss_simulation_new](https://github.com/yourstrulyalwiz/wss_simulation_new), latest `main` verified at [07be7ee71d2e8535d85ee2b5de8450d40348a454](https://github.com/yourstrulyalwiz/wss_simulation_new/commit/07be7ee71d2e8535d85ee2b5de8450d40348a454).

## 1. Implementation mandate and scope

Implement exactly these three connected changes:

1. Forecast executed spending and allocated budgets independently from entered historical spending/GDP shares, using a three-year initialization and subsequent two-year moving averages. Use executed capital spending to fund BAU service expansion.
2. Add an explicit total-spending toggle and capital-share slider in the existing Data Inputs → Budget section.
3. Define the Increase in Public Spending target as executed spending evaluated at baseline budget execution. Apply subsequent execution improvements to the entire expanded allocation and attribute that additional execution effect to Budget Execution.

Apply consistently to urban water, rural water, urban sanitation, and rural sanitation through the existing area/sector architecture. Retain the existing national/single-area workflow and aggregation behavior.

Preserve the current chart types, table structures, source names, colors, service-transition rules, and intervention controls except for the new capital-share controls and text needed to explain the corrected calculations. Recalculate existing outputs using the corrected backend values. Do not add another dashboard, forecast-method selector, or intervention.

**Revenue changes are deferred.** Preserve baseline billed-volume growth, new-connection revenue, tariff/collection calculations, NRW reconciliation, and their existing activation and timing rules. Do not add baseline utility revenue or new BAU connection revenue to available funding. Those calculations may naturally produce different results when their existing inputs change following the revised service path; that does not authorize changing their formulas.

Also preserve debt-financing and repayment rules, External Funding semantics, replacement accounting, household investment shares, Basic/SM investment allocation, unit-cost interventions, target definitions, and currency conversion. Do not fix unrelated issues encountered during implementation.

## 2. What the reviewed code currently does

| Location | Current behavior relevant to this change | Required work |
|---|---|---|
| `model/water_supply.py`, shared `sector_bau`, approximately lines 350–490 | In `from_cost` mode, constructs historical investment from service transitions and unit costs, averages positive historical cost/GDP ratios, and applies entered positive overrides afterward. Allocations use a separate fallback and a historical allocated/used ratio. | Replace the active Budget-input workflow with independent forecasts from entered executed and allocated data. Preserve the service-transition calculation for its other uses. |
| `model/water_supply.py`, public-spending block | Uses a pre-execution spending reference; can gross up cost-derived investment through the old capital share and execution assumptions. | Compare the target with executed BAU spending on the same input basis. Infer the additional allocation using the calculated baseline execution rate. |
| `model/water_supply.py`, source construction near `allocate_sources` | Already separates `baseline`, `financial`, and `budget_execution`, including an interaction term. | Retain this source accounting architecture and supply corrected amounts. Avoid counting the interaction twice. |
| `model/inputs.py`, `WSSBudgetInputs`; `demo_adapter.py`; `calculation_setup.py` | Legacy capital-share defaults/fallbacks include 21%; budget series are typed as numeric lists; restoration can reintroduce legacy assumptions. | Carry explicit budget basis and capital share end to end. Preserve missing versus zero budget values. |
| `model/sanitation.py` and the water wrapper | Select per-sector capital shares and call the shared solver. | Pass the same new budget contract through both wrappers, independently by area. |
| `frontend/src/components/InputPanel.tsx`, `budgetCostCell` and Budget section | Displays connection-cost-derived placeholders. Treats zero as unset and writes cleared cells as zero. | Correct labels/placeholders and missing-value handling; add the toggle/slider. |
| `frontend/src/components/InterventionPanel.tsx`, `financialFields` and execution controls | Displays a total-spending reference, potentially cost-derived; execution reference is currently a scalar from the old method. | Display the executed-spending reference, its basis/year, and the corrected execution reference. Keep existing controls and timing. |
| `frontend/src/App.tsx` and `InputPanel.tsx`, year-shifting helpers | Shift executed-budget arrays but omit allocated-budget arrays. | Include both allocated series and preserve blank budget cells when shifting analysis years. |
| `excel_io.py` | Budget labels describe connection costs; zero is exported as blank for budget input rows; calculated rows use existing capital-budget outputs. | Preserve zero/missing semantics and show calculated values on the same basis as the corresponding input row. Preserve the workbook structure. |
| `model/source_funding.py`, `model/coverage_attribution.py`, reporting consumers | Attribute actual delivered service using funding sources after deductions. | Reuse them; verify that corrected Public Spending and Budget Execution cash reach all existing outputs consistently. |

Line numbers refer to the reviewed commit. Locate the named functions if the branch advances. Inspect the current working tree and preserve unrelated user changes before implementing.

## 3. Common definitions and units

For each area, sector, and year `t`, define:

| Symbol | Definition |
|---|---|
| `G[t]` | Real GDP in the existing local-currency-million units and price basis. |
| `E[t]` | BAU executed spending, entered or forecast, on the selected budget input basis. |
| `A[t]` | BAU allocated budget, entered or forecast, on that same basis. |
| `e[t] = E[t] / G[t]` | Executed-spending share of real GDP. |
| `a[t] = A[t] / G[t]` | Allocated-budget share of real GDP. |
| `r0[t] = E[t] / A[t]` | Baseline execution rate, calculated independently of interventions. |
| `r1[t]` | Scenario execution rate under the existing Budget Execution timing/ramp; equals `r0[t]` when that intervention is off. |
| `k` | Effective capital share: slider value when the total-spending toggle is on; otherwise `1`. |
| `T` | Public-spending GDP target, entered as a percentage in the UI and stored as a fraction. |
| `D[t]` | Additional executed spending attributed to Public Spending, valued at baseline execution. |

All percentages must follow the existing fraction convention: `2% = 0.02`, `20% = 0.20`, and `0.06% = 0.0006`. Display percentage-point contributions clearly.

Keep raw budget values, derived capital amounts, and execution rates distinct. Do not overwrite an entered total budget with its capital component. Real GDP, budget values, and real unit costs must use compatible currency and price units. Do not add a new deflation or FX framework as part of this task.

For the current urban/rural configuration, preserve the shared national GDP denominator. Aggregate area amounts before calculating national ratios; do not average area execution rates or divide by an invented urban/rural GDP series.

## 4. Area 1 — Correct executed and allocated budget forecasts

### 4.1 Authoritative inputs

Continue using the existing frontend budget series:

- `bau.ws_expend_ts` and `bau.san_expend_ts`: executed spending.
- `bau.ws_alloc_ts` and `bau.san_alloc_ts`: allocated budgets.

They currently map to `ws_budget_direct`, `san_budget_direct`, `ws_budget_allocated`, and `san_budget_allocated` in `WSSBudgetInputs`. Keep these mappings or provide explicit compatibility mappings; do not create competing copies of the same entered series.

Use a small shared helper for the forecast, called by both sectors. Do not copy separate forecast algorithms into water, sanitation, the frontend, or exports. The current Budget-input workflow must no longer obtain its financial forecast anchor from connections × unit cost, all-history averages, or a default 80% execution assumption.

If a new internal `budget_source` value is useful, migrate the active workflow to it without adding a new user-facing selector. Existing saved configurations using `from_cost` must reach the corrected entered-data workflow. Preserve compatibility with other legacy callers through explicit adapters where necessary; do not let a legacy mode silently restore the old forecast in the current UI.

### 4.2 Three-year initialization

Resolve executed and allocated series independently. For either series `X`:

1. Identify its latest usable actual financial-data year `L`, at or before the service baseline year. Actual zero counts as an observation. A computed placeholder or future override is not a historical actual.
2. Use the calendar window `{L-2, L-1, L}`. Calculate each usable year's `X[y] / G[y]` using that year's real GDP.
3. Initialize the first estimated year after `L` with the arithmetic mean of these annual shares:

```text
share_X[L+1] = mean(X[y] / G[y] for usable y in {L-2, L-1, L})
X[L+1]      = share_X[L+1] * G[L+1]
```

This is the mean of annual ratios, not `sum(budgets) / sum(GDP)`, and not the mean of currency amounts.

If only one or two observations are available within the window, use those observations and disclose the actual years/count in the existing budget context or calculation message. Do not silently reach further back to obtain three observations. With no usable observations, identify the missing sector/area/series and request input through the existing validation mechanism; do not synthesize a country budget.

Executed and allocated series can have different latest usable years. Report the actual window for each and forecast each independently to the same model years. Derive execution only after both annual paths have been resolved.

### 4.3 Subsequent two-year moving average

After the first estimated year, recursively use the preceding two annual GDP shares:

```text
share_X[t] = (share_X[t-1] + share_X[t-2]) / 2
X[t]       = share_X[t] * G[t]
```

For a series last observed in 2024:

```text
share[2025] = mean(share[2022], share[2023], share[2024])
share[2026] = mean(share[2024], share[2025])
share[2027] = mean(share[2025], share[2026])
```

This smooths the GDP share. It does not impose an additional annual budget-growth trend. Currency amounts still change with real GDP.

Retain explicitly entered future-year overrides, including zero. An override supplies that year's realized forecast share for subsequent moving-average steps; do not restart the three-year initialization or promote it into the historical window. Clear an override to restore the calculated value. Do not write calculated values back into raw inputs during normal recalculation or save/export, since they would then be mistaken for observations.

### 4.4 Missing data, zero, and year alignment

- Represent missing budget cells as `null`/`None` or an equally explicit presence mask; preserve numeric zero as observed zero.
- Update budget-specific schema, adapter, input-cell, export/import, and year-shifting code consistently. Do not globally change missing-value conventions for population, GDP, service shares, or other unrelated inputs.
- Use finite, nonnegative budget values and positive finite GDP for the annual ratios. Surface malformed inputs rather than quietly substituting demonstration data.
- Include `ws_alloc_ts` and `san_alloc_ts` in both area and active-panel year-shifting paths. Prepending a missing budget year must prepend `null`, not a fabricated zero observation.
- Do not infer whether a legacy zero is missing merely from its numeric value. Convert known legacy padding only where its origin can be established; otherwise retain the value and disclose any input review needed.
- Do not use the service baseline year as evidence that financial observations exist through that year.

For financial data ending in 2024 and a service baseline of 2025, estimate the missing 2025 financial values using the three-year seed. Preserve the entered 2025 service stocks. With the existing 2026 service-forecast start, fund forward coverage changes from 2026 using the resolved budget path. Do not retrospectively rebuild the 2025 observed service baseline from the estimated 2025 budget.

### 4.5 Execution rate and capital budget

For each valid year with `A[t] > 0`:

```text
r0[t]              = E[t] / A[t]
executed_capital[t] = k * E[t]
allocated_capital[t]= k * A[t]
```

Use `E/A` on the input basis to avoid `0/0` when the capital share is zero. Applying the same share to both budgets leaves the execution rate unchanged.

Do not calculate the new baseline execution rate as the reciprocal of an average historical allocated/executed ratio. Do not multiply already executed spending by an execution rate again. A stale `execution_rate` or `capeff_current_pct` must not override the execution rate calculated from the new authoritative budget series in this workflow.

If entered/resolved executed spending exceeds allocation, report the inconsistency instead of silently clipping the ratio and breaking the budget identity. If `A=0` and `E>0`, the pair is invalid. If both are zero, BAU capital is zero and execution is unavailable; do not display a fabricated 100% execution rate. If `A>0` and `E=0`, baseline execution is a valid zero.

### 4.6 BAU coverage and household growth

Supply `k * E[t]` as baseline executed capital to the existing cash/delivery engine. Retain the current order of source losses, eligible debt service, replacement funding, household investment share, and Basic/SM investment allocation. In pure BAU, ordinary expansion follows executed capital remaining after replacement and the household share.

Preserve current delivery rules:

- Funded below-Basic → Basic entries and Basic → SM upgrades use existing unit costs and eligible pools.
- An SM upgrade removes that household from exclusive Basic; it does not create another household.
- Purchases use prior-year eligible pools, with existing caps and reallocation of unusable spending.
- Population/households follow their existing projection logic. Household growth enters the denominator and the lower-service residual under the existing end-of-year convention; it does not automatically create Basic/SM connections.
- Newly arriving households are eligible for funded transitions in the following year under the existing convention. Do not introduce a new demographic timing model.
- Retain replacement/asset accounting, including the existing treatment of unpaid replacement. Do not add service attrition or O&M modeling.

Illustration: start with 100 households, 30 SM and 30 exclusive Basic. If households grow to 110 with no funded additions, at-least-Basic coverage becomes `60/110 = 54.55%`. Funding 5 additional Basic households gives `65/110 = 59.09%`. Coverage can decline despite additional connections when household growth is faster.

## 5. Area 2 — Explicit capital-share toggle and slider

### 5.1 UI behavior

Add the controls within the existing **Data Inputs → Budget** section, beside/above the existing budget table and investment split. Use the existing sector selector and area context; do not create another tab or a separate configuration screen.

Toggle label, exactly:

> Budget Provided is Total Spending, Specify Capital Share

| Toggle state | Input interpretation | Effective capital share |
|---|---|---:|
| Off | Executed and allocated inputs already describe capital spending/budgets. | `k = 1` |
| On | Executed and allocated inputs describe total sector spending/budgets. | `k = selected slider fraction` |

When on, activate a **Capital share of total spending** slider from 0% to 100%, displaying its selected value. A 1-percentage-point UI step is sufficient. When off, hide or disable the slider and ignore its stored value in calculations. Preserve its explicit saved selection when switching off and back on.

Maintain separate values for water and sanitation within each area's existing input object. Do not copy one area's selection into another except through an existing explicit copy action.

For newly introduced controls, initialize the toggle off. If there is no explicit stored slider choice, a visible 100% initial slider position preserves the off-state calculation when first activated; it is a UI starting value, not an estimated country capital share. Do not silently initialize from the inherited 21% Nepal assumption.

Suggested help text:

> Enable this if the budget includes both capital and recurrent spending. Specify the share available for capital investment. Leave it off if the budget already reports capital spending. The household investment share is applied separately within capital spending.

### 5.2 Data contract and migration

Reuse per-sector capital-share fields where practical and add explicit per-sector total-spending booleans, for example `ws_budget_is_total_spending` and `san_budget_is_total_spending`. These are suggested internal names; keep one authoritative mapping through frontend state, saved profiles, adapter, and `WSSBudgetInputs`.

Persist both toggle and slider through ordinary save/load and area switching. Preserve existing import/export capabilities. Where the current Excel template does not carry configuration settings, keep the active toggle/share on import and display the budget basis; a new workbook settings interface is not required.

The new calculation must bypass the legacy `capex_pct_budget=0.21` fallback. A null per-sector share must not become 21% through `restore_automatic_inputs`. Keep legacy fields only where needed for compatibility with out-of-scope callers/features; do not let them independently rescale this budget workflow.

For existing profiles without an explicit total-spending choice, use the off interpretation for the current capital-labeled budget rows. Preserve legacy fields in the saved payload if needed, but do not infer that the user selected total spending simply because an old default capital-share field is populated. Do not batch rewrite country profiles in the repository.

### 5.3 Apply the share once and maintain consistent displays

Forecast `E` and `A` on the original selected input basis, then derive their capital components using `k`. Apply `k` once to baseline spending, Public Spending, and Budget Execution cash. Do not multiply it again in the funding ledger or delivery loop.

The same input basis governs the public-spending target:

- Toggle off: target is executed capital spending/GDP.
- Toggle on: target is executed total sector spending/GDP; its capital component is determined by the slider.

Budget-table placeholders and Excel calculated values must match the basis of their input rows. In total-spending mode, a raw total-budget cell must not display a capital-only placeholder under the same label. Preserve existing capital outputs for downstream consumers and expose separate raw-basis calculated values as necessary.

Show the selected basis in existing budget/public-spending helper text. Do not automatically reinterpret or rescale an entered target when the user changes the toggle; it follows the now-visible selected basis.

## 6. Area 3 — Public Spending and Budget Execution

### 6.1 GDP target is executed spending at baseline execution

When the GDP target option is active in year `t`:

```text
target_executed[t] = T * G[t]
D_gdp[t]          = max(target_executed[t] - E[t], 0)
```

When inactive or before its existing start year, `D_gdp[t] = 0`.

This is a recurring annual level target. With a constant 1% BAU share and a 2% target, Public Spending contributes 1 percentage point in each eligible year. Do not add another percentage point cumulatively each year. If the BAU forecast changes, compare the target with that year's `E[t]`, not a fixed historical amount.

If BAU already exceeds the target, this option contributes zero and does not reduce BAU spending.

### 6.2 Preserve the existing annual-growth option and timing

The Public Spending panel already offers a GDP target and an annual spending-growth option, with additive overlap when both are selected. Retain that behavior and its existing start/end-year rules. Correct only the spending basis:

```text
D_growth[t] = max(E[t] * ((1 + g) ** (t - growth_start + 1) - 1), 0)
              within the currently defined active growth window; otherwise 0
D[t]        = D_gdp[t] + D_growth[t]
```

The growth option therefore still compounds under its existing definition. The GDP-target option does not. When both are selected, 2% is the GDP option's target and the growth option can add further spending; do not silently replace their current additive relationship with a cap or maximum rule.

Keep existing toggles, option activation, year validation, and forecast gating. Do not apply interventions to historical/service-baseline years.

### 6.3 Infer the expanded allocation

For `r0[t] > 0`:

```text
additional_allocation[t] = D[t] / r0[t]
scenario_allocation[t]   = A[t] + additional_allocation[t]
```

The public-spending target is thus the portion of the expanded allocation that would be executed at the baseline rate. It is not an allocation target and is not the final spending ceiling after execution improves.

`r0[t]` comes from the intervention-free budget path and is fixed with respect to scenario toggles. Do not recalculate it from scenario spending or the expanded allocation.

### 6.4 Apply execution and attribute its full effect

Keep the existing execution target/start/target-year ramp, using `r0[t]` as the year's baseline. If Budget Execution is disabled, `r1[t] = r0[t]`. Preserve the existing signed treatment where a configured target is below baseline; do not silently clamp the resulting cash contribution to zero.

The three public-budget funding sources must be:

```text
baseline_cash[t] = k * E[t]

public_spending_cash[t] = k * D[t]

budget_execution_cash[t] =
    k * (A[t] + additional_allocation[t]) * (r1[t] - r0[t])

final_executed_capital[t] =
    baseline_cash[t] + public_spending_cash[t] + budget_execution_cash[t]
  = k * (A[t] + additional_allocation[t]) * r1[t]
```

The identity holds because `E[t] = A[t] * r0[t]`. For positive baseline execution it can also be written:

```text
final_executed_capital[t] = k * (E[t] + D[t]) * r1[t] / r0[t]
```

For a binding GDP target alone:

```text
final_executed_share_on_input_basis = T * r1[t] / r0[t]
final_executed_capital_share        = k * T * r1[t] / r0[t]
```

The entire execution uplift belongs to `budget_execution`, including execution gains on the additional allocation created by Public Spending. Keep `financial` as the existing internal source key for Public Spending; it receives `k * D[t]` only.

Do not multiply the executed-spending target or `D[t]` by baseline execution again. The division by `r0[t]` determines its implied allocation; baseline execution has already been reflected in the executed target.

### 6.5 Approved numerical examples

**Example A — final user confirmation, capital share 100%:**

| Quantity | Share of GDP |
|---|---:|
| BAU executed spending | 1% |
| Baseline execution rate | 20% of allocation |
| Implied BAU allocation: `1% / 20%` | 5% |
| Public-spending executed target | 2% |
| Additional executed spending from Public Spending | 1 percentage point |
| Additional allocation: `1% / 20%` | 5% |
| Expanded allocation | 10% |
| Improved execution rate | 40% of allocation |
| Final executed spending: `10% × 40%` | **4%** |
| Contribution attributed to Budget Execution: `10% × (40%-20%)` | **2 percentage points** |

The ledger must show **baseline 1% + Public Spending 1 percentage point + Budget Execution 2 percentage points = 4%**. Of the execution uplift, 1 percentage point comes from the original allocation and 1 from the added allocation; both belong to Budget Execution.

**Example B — earlier agreed values:** baseline executed spending `0.017%`, baseline execution `16%`, target executed spending `0.06%`, improved execution `40%`.

```text
Expanded allocation = 0.06% / 0.16 = 0.375% of GDP
Final execution     = 0.375% * 0.40 = 0.150% of GDP
Baseline source     = 0.017% of GDP
Public Spending     = 0.043 percentage points
Budget Execution    = 0.090 percentage points
```

**Example C — total-spending mode:** apply a 30% capital share to Example A. Executed total spending remains 4% of GDP. Capital funding is `4% × 30% = 1.2%`, decomposed as baseline `0.3%`, Public Spending `0.3%`, and Budget Execution `0.6%` of GDP. Baseline execution remains 20%.

### 6.6 Zero-execution boundaries

- If `D[t] = 0`, use `additional_allocation[t] = 0` without division. An existing allocation with zero baseline execution can still generate spending when the execution intervention raises the rate: `k * A[t] * r1[t]`.
- If `D[t] > 0` and `r0[t] = 0`, a positive executed target cannot imply a finite allocation at that baseline rate. Show a targeted validation message requesting a valid execution/allocation baseline. Do not substitute 1, an epsilon, 80%, or 100%.
- If both budgets are zero, keep BAU spending zero and execution unavailable. A positive public-spending target requires a usable execution baseline; this task does not add a separate override control for that case.
- If `k = 0`, all three capital contributions are zero. Raw budgets and their execution ratio remain available. Do not derive the rate from zeroed capital amounts.
- Validate positive GDP, finite target values, and valid execution/share ranges before calculation. Avoid `NaN` or infinite values in results and exports.

### 6.7 Integrate without double counting

The reviewed solver already includes execution on the original allocation in `bau_available` and adds a separate `execution_interaction` for the increased allocation. Either preserve that decomposition or simplify the local assembly, but use one consistent identity.

If preserving the existing pattern:

```text
bau_available[t]         = k * A[t] * r1[t]
baseline_capital[t]      = k * E[t]
financial_cash[t]        = k * D[t]
execution_interaction[t] = k * additional_allocation[t] * (r1[t] - r0[t])
budget_execution_cash[t] = bau_available[t] - baseline_capital[t]
                          + execution_interaction[t]

public_budget_available = bau_available[t] + financial_cash[t]
                          + execution_interaction[t]
```

Do not add `budget_execution_cash` again to `public_budget_available` under this pattern; its original-allocation component is already in `bau_available`.

Alternatively assemble available public-budget cash directly as the three source contributions. In either case, add the other existing funding sources once through their existing logic and retain the current source-sum reconciliation assertion.

Keep External Funding outside the expanded public allocation. Do not apply the Budget Execution intervention to one-time or recurring external injections. Preserve their existing conversion and timing rules; isolate the shared legacy injection variables if refactoring the public-spending block would otherwise change them. The capital-share toggle must not silently redefine the External Funding feature.

## 7. Output, UI, and reporting integration

### 7.1 Preserve result compatibility

Retain the existing public result structure and source keys. In particular:

- `budget_used` should continue to identify baseline executed **capital** for existing downstream consumers.
- `budget_allocated` should identify baseline allocated **capital** on that same basis.
- Provide raw-basis resolved executed/allocated series separately for the budget input placeholders and matching Excel rows. Suggested names are `budget_executed_input_basis` and `budget_allocated_input_basis`.
- Expose the per-year baseline execution series for the intervention calculation and diagnostics. Preserve the existing scalar reference where needed, but calculate and label it from the appropriate resolved reference year, not the old reciprocal historical ratio.
- `financial_commitment_base` should reference the executed BAU series `E[t]` on the selected input basis.
- Replace the UI's use of the misleading total-spending reference with an executed-spending reference and basis metadata. An additive `baseline_bau_executed_spending_share` field is preferable to silently making a field named “total” mean capital. Keep an old field as a compatibility alias only if its consumers are updated/documented.
- Preserve existing scenario-prefixed funding, source-ledger, and coverage-attribution outputs. Add only the metadata needed to identify basis, initialization years, missing-data fallback, and forecast/entered status.

The displayed three-year seed and the annual BAU comparison need not be identical after subsequent moving averages. Label the seed window and the reference year accurately. The intervention always uses that year's resolved `E[t]` and `r0[t]`.

### 7.2 Correct existing labels and explanations

In the Budget section, replace references to historical “new households × unit cost,” all-history mean budget/GDP, allocated/executed-ratio forecasting, and default execution with the agreed three-year/two-year rules.

In Public Spending, use wording such as:

> Target executed spending as a share of GDP

> The target is evaluated at baseline budget execution. Public Spending supplies the difference above that year's BAU executed spending. Improved budget execution increases spending from the expanded allocation; that additional effect is attributed to Budget Execution.

Identify “capital spending” or “total spending” according to the toggle. Remove the cost-derived total-spending gross-up explanation for this workflow.

Update the existing added-capital summary to explain that the capital share has been applied and that any additional execution benefit appears under Budget Execution. Do not say the executed target is reduced by baseline execution again.

Keep Current Budget Execution calculated/read-only. Its reference must agree with the new budget path. Preserve its existing target and timing controls.

### 7.3 Funding and coverage attribution

Use corrected source contributions in `scenario_source_funding`, then retain the existing loss/debt/replacement allocation and purchase attribution. The `financial` and `budget_execution` coverage bands must follow actual purchases paid for by each source after deductions.

Do not assign coverage directly from gross GDP shares or force coverage percentages to equal funding percentages. Replacement costs, household shares, Basic/SM costs, eligible pools, and existing stocks affect the relationship. The requirement is correct source ownership and reconciliation to actual delivered service.

Check existing financing charts, coverage charts, annual tables, breakdowns, and Excel/PowerPoint reporting consumers (`export_data.py`, `deck_data.py`, and their existing helpers). They must use the same authoritative source ledger. Do not introduce a new cumulative-pass attribution method or alter intervention order merely to reproduce the budget arithmetic.

## 8. Saved DRC profile: input review required for reliable anchors

The reviewed `profiles/Oct 10.json` has real entered executed-spending observations through 2024. Its allocated-budget arrays also contain 2025 values of `2784` for water and `3469` for sanitation in both urban and rural inputs, matching legacy demonstration defaults. Do not silently treat inherited demonstration entries as verified DRC financial observations.

Use provenance where available to distinguish inherited defaults from entered observations; otherwise visibly flag the questionable entries for review. Do not delete genuine data solely because it equals one of these numbers, and do not rewrite saved profiles during this implementation.

For a controlled fixture explicitly treating 2024 as the last observed financial year, the three-year 2022–2024 arithmetic means from that saved profile are:

| Area/sector | Executed share of GDP | Allocated share of GDP | Execution: mean executed share / mean allocated share |
|---|---:|---:|---:|
| Urban water | 0.0174320800% | 0.1071653043% | 16.2665334% |
| Rural water | 0.0043580200% | 0.0267913261% | 16.2665334% |
| Urban sanitation | 0.0052607084% | 0.0070854906% | 74.2462118% |
| Rural sanitation | 0.0013151771% | 0.0017713726% | 74.2462118% |

These values are data-specific verification examples, not constants to hardcode. They describe the input basis before any chosen capital-share conversion. A confirmed actual 2025 allocation would legitimately give that series a different initialization window.

## 9. Focused acceptance checks

Add/update tests only for the changed calculations and their integration risks. Preserve independent tests of revenue, debt, service transitions, and external injections; do not change their expected formulas to make this work pass.

### 9.1 Forecast arithmetic and input handling

1. Historical executed shares for 2022–2024 are `0.5%, 1.0%, 1.5%`; allocated shares are `2.5%, 5.0%, 7.5%`. Expect:

   | Year | Executed share | Allocated share | Baseline execution |
   |---|---:|---:|---:|
   | 2025 seed | 1.0% | 5.0% | 20% |
   | 2026 | 1.25% | 6.25% | 20% |
   | 2027 | 1.125% | 5.625% | 20% |

   Change the GDP path and confirm these shares remain correct while amounts change. Older pre-2022 observations must not affect the seed.

2. Change executed and allocated histories independently. Verify neither forecast is manufactured from the other or from a fixed execution assumption.
3. A window containing shares `0%, 1%, 2%` averages to `1%`. A window containing `missing, 1%, 2%` averages to `1.5%` with a two-observation notice.
4. Confirm no-history validation, different latest years, valid future zero overrides, and recursion after future overrides. Confirm input arrays remain unchanged by calculation.
5. With finance ending in 2024 and service baseline 2025, verify the 2025 bridge estimate and unchanged baseline service stocks.
6. Change technology costs with budget observations held fixed. Forecast financial amounts must remain unchanged; affordable connections may change.

### 9.2 Capital share

1. Toggle off with a stored slider value of 30%: use `k=1`.
2. Toggle on at 30%: raw budgets/forecast shares remain unchanged; executed and allocated capital equal 30% of their raw amounts; execution ratio is unchanged.
3. Toggle on at 0%: all public-budget capital contributions are zero without division errors. At 100%, results match the off state on otherwise identical inputs.
4. Verify sector/area isolation, toggle persistence, slider persistence, and no fallback to 21%.
5. Check displayed placeholders/Excel calculated rows against the selected raw input basis; do not compare a total-budget input with a capital-only placeholder.

### 9.3 Public Spending × Budget Execution matrix

Use Example A with `k=1`, all other interventions off, and a year when the execution target has been reached:

| Public Spending | Budget Execution | Baseline | Public Spending source | Budget Execution source | Total executed share |
|---|---|---:|---:|---:|---:|
| Off | Off | 1% | 0 | 0 | 1% |
| On, target 2% | Off | 1% | +1 pp | 0 | 2% |
| Off | On, 20% → 40% | 1% | 0 | +1 pp | 2% |
| On, target 2% | On, 20% → 40% | 1% | +1 pp | +2 pp | **4%** |

Repeat for water/sanitation and urban/rural fixtures. Also check:

- Example B gives 0.150% final executed spending and the agreed 0.017/0.043/0.090 decomposition.
- Example C gives 1.2% executed capital, decomposed 0.3/0.3/0.6.
- A target below BAU gives zero additional Public Spending; execution can still improve the original allocation.
- Changing only execution leaves the Public Spending source unchanged while changing the Budget Execution source.
- Consecutive years with unchanged GDP shares retain the target level; the GDP option does not compound.
- Before/within/after the existing execution ramp and spending start years, cash follows the existing timing convention.
- Annual-growth-only and both-options-enabled cases retain their current timing and additive definitions on the new executed basis.
- Zero baseline execution, zero allocation, invalid `E>A`, and signed lower execution rates behave as specified.

### 9.4 Delivery, attribution, and compatibility

- Sum signed funding sources and compare with available cash for every year. Public Spending and the execution interaction must appear once each.
- Sum source-attributed actual Basic entries and SM upgrades and compare with combined delivered flows; source-attributed stocks must reconcile to actual exclusive service stocks.
- Retain the current source deductions and verify that replacement/debt reduce the appropriate available amounts before expansion.
- In a no-expansion fixture with growing households, service counts do not grow automatically and coverage falls appropriately. In a funded fixture, additional households reconcile with paid purchases and existing transition caps.
- Verify UI, Excel, and deck totals use the same ledger and preserve existing layouts.
- Round-trip budget `null`, zero, and positive entries through saved profiles and Excel. Shift the analysis start year and verify executed and allocated values still correspond to the correct calendar year in both areas.
- Run existing revenue and external-funding regression tests on controlled inputs. Keep formulas unchanged; explain any profile-level output changes caused by the new budget/service path.

Relevant existing suites include `test_public_spending_execution.py`, `test_baseline_spending_share.py`, `test_historical_transitions.py`, `test_source_attribution.py`, `test_expansion_ledger.py`, `test_calculation_setup.py`, `test_exogenous_injection.py`, and the existing revenue tests. Update old tests that explicitly assert cost-derived spending references to assert the newly approved definition; retain independent service-transition assertions.

Use targeted Python tests during development and the repository's normal test gate at completion. Run the existing frontend build (`npm run build` within `frontend`) and verify the new controls, area switching, and corrected labels through the existing UI test/manual-check workflow. No dependency additions should be needed for this change.

## 10. Suggested implementation order and completion report

1. Add the budget-basis contract and budget-specific missing-value support; wire save/load and adapters.
2. Implement the shared historical-share forecast helper and focused arithmetic tests.
3. Integrate the resolved executed/allocated paths and derived execution rate into both sector wrappers/shared solver; preserve historical service stocks.
4. Add the capital-share toggle/slider and correct Budget placeholders/help text.
5. Replace the public-spending base and allocation/execution formulas; retain existing source keys and deduction/delivery logic.
6. Update the existing reference labels, budget import/export mappings, and any reporting consumers needed for consistent values.
7. Run the focused acceptance checks and normal completion gates. Review the diff for unrelated modifications.

The implementation handoff should state:

- Files changed and why each change was needed for these three areas.
- Test/build results and any unresolved input-calibration warnings.
- The Example A source decomposition: `1% baseline + 1 pp Public Spending + 2 pp Budget Execution = 4%`.
- The forecasting window/basis used in the inspected country scenario.
- Confirmation that revenue formulas and unrelated model features were preserved.

Do not claim saved-country results are validated until questionable historical budget observations have been resolved. Do not deploy, rewrite unrelated files, redesign outputs, or implement the deferred revenue proposal as part of this task.
