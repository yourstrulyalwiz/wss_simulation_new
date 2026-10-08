# Replit implementation instructions: new-connection revenue, NRW and revenue attribution

Prepared for Billy Hoo — 8 October 2026

Repository: https://github.com/yourstrulyalwiz/wss_simulation_new  
Reviewed `main`: `75de110da175bea95af83e1684b4f6f5573393cc` — “Add DRC mock simulation profile”  
Status: implementation proposal based on a source review; this document does not represent applied code changes.

## 1. Implement this agreed model, superseding the previous connection-revenue instructions

Preserve the existing aggregate billed-volume baseline, including its population-growth rule or explicit volume-growth override. Add collected revenue attributable to marginal coverage expansion. Use the existing total billed volume and a single average tariff and collection rate per service and area. Do not introduce household/non-household revenue accounts.

Value the direct new-connection and NRW sales contributions at baseline tariff and collection rates. Selected collection and tariff reforms then earn separate marginal contributions on the entire reconciled volume, including additional connection and NRW sales. A fixed attribution convention must make the final result independent of the order in which the user selects interventions.

Remove all incremental connection operating-cost calculations and controls. NRW implementation costs remain inside signed NRW net cash. Retain NRW's avoided-production-cost mode as a separate valuation option.

The feature must appear in Intervention Design, Results, exports, and Loan Funding, including as a selectable loan source. Implement the backend and UI together; hiding inputs while retaining their validation requirements is not sufficient.

### Boundaries

- Preserve pure BAU funding, demographic projections, service transitions, capital-cost allocation, asset replacement, and existing NRW works/benefit schedules.
- Preserve separate water/sanitation and urban/rural inputs. “Single tariff” means one shared tariff within each service/area, not one tariff forced across services or geographies.
- Do not add the entire baseline collected revenue to funding. The existing funding amount is the reference; this feature adds only marginal contributions.
- Do not revive historical billing-share calibration, manual household-consumption inputs, operating-expenditure estimates, or household cost allocation.
- Do not apply `1 - ws_non_hh_pct` or `1 - san_non_hh_pct` to revenue volumes. Keep those technical inputs in their existing capital-allocation calculations.
- Preserve the active indicative lump-sum loan workflow, including deferred repayment accounting. Extending its source list is not authorization to add repayment schedules or resize loans recursively.

## 2. Findings in the current repository

| Current location | Finding | Required response |
| --- | --- | --- |
| `model/utility_revenue.py::volume_path` | Projects total billed volume using population relative to the volume reference year, or explicit compound volume growth. | Reuse unchanged for the baseline. |
| `model/connection_revenue.py::prepare_connection` | Requires historical Basic/SM billed shares, household volume share, calibration, funding confirmations and operating cost. | Replace the active calculation with the simpler aggregate coverage method below. |
| `frontend/src/components/ConnectionRevenue.tsx` | Contains Advanced calibration and three cost methods. `proxySourceChanged` compares fields even when no snapshot exists. | Remove the obsolete workflow and its validators, rather than just patching the warning. |
| `frontend/src/connectionRevenueConfig.ts::operatingExpenditureSource` | Reads `tariff_op_expenditure`, which is absent in the saved DRC profile. Its editable control is in an old `InputPanel` intervention branch not mounted by the current app. | Removing the cost proxy removes the blocked button and missing-input dependency. Do not add an operating-expenditure form for this task. |
| `model/revenue_reconciliation.py::reconcile_revenue` | Applies collection/tariff uplifts only to non-NRW volume and values NRW sales at scenario rates. | Value NRW at baseline rates; apply reforms to the full reconciled volume. |
| `model/engine.py::calculate` | Turns ordinary toggles off for BAU but leaves `connection_revenue` in the copied inputs. `any_toggle_on` does not include the connection feature. | Explicitly disable connection revenue in BAU and recognize a connection-only scenario. |
| `model/water_supply.py::sector_bau` | Connection revenues feed next-year service delivery; NRW overlap uses legacy household consumption and billing cohorts. | Replace the calibration-dependent volume producer and retain origin tracking/one-year feedback. |
| `LiveInterventionChart.tsx`, `ResultsDashboard.tsx`, `deck_data.py` | Use ordered cumulative reruns; connection revenue is not an explicit contribution in the ordinary intervention definitions. | Add an explicit connection stage for coverage comparisons and use final-scenario source cash for revenue charts. |
| `model/utility_debt.py`, `loanFunding.ts`, `DebtServicingControls.tsx`, `UtilityDebtPreview.tsx` | Source whitelist is only collection, tariff and NRW. Current loan mode sizes a single injection from a frozen no-loan reference. | Add a `connections` source throughout and retain the frozen-reference contract. |
| `NRWDiagnostics.tsx`, `nrwRevenue.ts`, `RevenueBase.tsx`, exports | Descriptions and labels still expose old attribution and operating-cost calibration. | Update metadata, labels, units and export rows to match the new calculation. |

The saved `profiles/DRC Mock Simulation Oct 6.json` uses `all_recovered_sold` and tariff valuation for water NRW in both datasets. Its primary water non-household share is 40%; that remains a capital-cost assumption, not a revenue haircut.

## 3. New-connection revenue: precise replacement calculation

### 3.1 Preserve the baseline volume path

Use the current `volume_path` function. Let `B_t` denote baseline annual total billed volume in million m³. With population growth:

```text
B_t = volume_mld × days_in_year / cubic_meter_liters × (P_t / P_reference)
```

With an explicit volume-growth rate `g`, use its current factor `(1 + g)^(year - reference_year)` instead. Keep the existing baseline tariff `T0` and collection ratio `C0` authoritative.

`B_t × T0 × C0` is the baseline collected-revenue reference in currency millions. It is not an additional injection into model funding.

### 3.2 Make “marginal coverage expansion” unambiguous

The following is the recommended implementation of the agreed aggregate simplification. It replaces the old calibrated billed-customer-stock model. It does not estimate observed household consumption.

Let:

- `b` = model baseline year index.
- `H_u` = all households in service observation year `u`.
- `HBasic_u`, `HSM_u` = mutually exclusive, actually delivered Basic and Safely Managed household stocks in that calculation pass. Do not use target household counts or unbuilt requirements.
- `sBasic_u = HBasic_u / H_u`; `sSM_u = HSM_u / H_u`.
- `S0 = sBasic_b + sSM_b`: unweighted baseline Basic-or-better coverage.
- `fBasic`, `fSM` = main-form billing percentages stored as fractions from 0 to 1.

Freeze baseline service shares from the historical/baseline data, independently of interventions. For revenue year `t > b`, use the preceding year's delivered coverage, `u = t - 1`:

```text
delta_sBasic = sBasic_u - sBasic_b
delta_sSM    = sSM_u    - sSM_b

weighted_coverage_change = fBasic × delta_sBasic + fSM × delta_sSM
connection_scale_t      = weighted_coverage_change / S0
N_raw_t                 = B_t × connection_scale_t
```

`N_raw_t` is the incremental aggregate billed volume before identified NRW overlap is removed. Set it to zero for historical/baseline years and when the connection feature is disabled.

This uses the fixed baseline coverage shares as the population-only coverage reference. Do not subtract the full budget-driven BAU service path: that would remove revenue from genuine coverage gains financed by ordinary investment. Pure BAU remains a separate calculation with this feature disabled. When the feature is enabled, actual coverage gains above the fixed baseline shares can arise from ordinary investment, other interventions or prior connection receipts.

The year-specific aggregate volume proxy is `B_t / (H_u × S0)`, using matching raw household units when displaying m³ per reference served-household equivalent. It is a scaling proxy for the entire customer base, including the implied non-household component. Do not label it “annual billed household consumption.”

### 3.3 Why this formulation

- **Population alone:** if coverage shares are unchanged, the connection contribution is zero even if population, households and `B_t` grow.
- **No duplicate population subtraction:** the coverage difference already removes growth at unchanged coverage. Do not additionally subtract `B_t - B_b`.
- **No historical recalibration:** changing `fBasic` or `fSM` changes only the incremental coverage weighting. It does not change `B_t`, `T0`, `C0`, `S0` or historical receipts.
- **No household/non-household split:** do not multiply by 60%, or divide by it. Total volume is scaled in aggregate under a constant customer-mix assumption.
- **Basic-to-SM upgrades:** a transfer reduces Basic and increases SM. At equal billing percentages it adds zero revenue volume. At different percentages its weight is `fSM - fBasic`, not the full `fSM` again.
- **Persistence:** use the accumulated delivered coverage stocks each year. Do not book a one-time revenue flow only in the delivery year.
- **One-year lag:** works delivered at the close of year `y` first change revenue in `y + 1`. Population growth in the revenue year still comes through `B_t`.
- **Different household/population growth:** use coverage ratios calculated with each observation year's household denominator. Do not assume the two growth rates are identical.

Keep category differences signed; do not floor the Basic decline before adding the SM gain. Recommended handling of an overall negative difference is a visible signed revenue adjustment, consistent with the existing reconciliation contract, not an invented positive addition. Label negative values clearly. Reject a calculation that produces a materially negative total billed volume rather than silently hiding it. This is a proposed edge-case rule, not a new assumption that coverage must decline.

This simplified coverage method uses common billing propensities as weights on marginal changes. It does not reconstruct each historical customer's actual billing status. Retain delivery-origin tracking needed for NRW overlap, but remove the separate baseline billed-share calibration. If an implementation uses a cohort helper internally, it must reproduce the coverage formula and transfer examples here without introducing hidden historical billing inputs.

### 3.4 Validation

- Require finite `fBasic` and `fSM` in `[0,1]` when enabled. UI entry is 0–100%; explicit zero is valid and must not be replaced by a default.
- Require a valid shared revenue base and valid baseline/delivered service counts.
- If `S0 <= 0`, a ratio-based aggregate proxy is undefined: report “Baseline Basic/Safely Managed coverage is needed to estimate additional billed volume.” Do not silently assume a household consumption value. Leave the baseline calculable and show the requested feature as incomplete.
- A zero billed-volume base is valid and produces zero connection sales; do not fabricate demand.
- If the volume anchor year differs from model baseline, use the existing shared volume path. No new alignment approval or second volume observation is required.
- Do not require old costs, provenance overrides, historical billed shares, reference-series entries or funding checkboxes for this mode.

### 3.5 Suggested active schema

```json
{
  "version": 4,
  "enabled": true,
  "method": "aggregate_coverage_expansion",
  "new_billed_share_basic": 0.50,
  "new_billed_share_sm": 0.90,
  "shared_assumption_note": "Illustrative billing assumptions"
}
```

The note can be optional documentation; it must not conceal a second calibration gate. Preserve sector-specific copies under `connection_revenue.water` and `.sanitation`. Backend-returned calculation metadata must distinguish requested/effective/incomplete/off states.

## 4. NRW sales and the common revenue identity

### 4.1 Preserve NRW recovery and implementation costs

Keep existing calculations and timing for:

- Current and target NRW percentages, works start/target years and benefit lag.
- System input volume and population/explicit growth path.
- Physical versus commercial shares of recovery.
- Physical capacity supporting delivered Basic-to-SM upgrades, including eligible-pool limits and already committed capacity.
- Implementation cost and its timing, retained once inside signed NRW net cash.

Under `all_recovered_sold`, additional eligible sales include all recovered billable volume; they are not restricted to the household portion. Physical recovery creates deliverable water; commercial recovery improves billing of water already supplied. Do not count commercial recovery as new physical supply.

Keep the existing `household_only` option compatible if used in another saved profile, but explicitly label it as an alternative restriction. It must use genuinely tagged household-equivalent volume, not apply a blanket household percentage. In the new aggregate method the household portion of a tagged aggregate proxy, if required by this alternative, is a separate eligibility calculation using the technical household share; it must not reduce the aggregate connection stream or the default all-sales mode. Show this dependency if no tagged volume is available. Do not silently migrate saved household-only profiles to all-sales.

### 4.2 Reconcile connection/NRW overlap before calculating receipts

Let `W_t` be eligible incremental NRW billed sales (including the eligible sanitation link in its own sector), and `O_t` be verified volume already represented in both `N_raw_t` and `W_t`.

```text
N_t = N_raw_t - O_t
V_t = B_t + N_t + W_t
```

Assign the overlapping direct sales to NRW, consistent with the current source convention. Retain the matching negative adjustment to connections; never subtract the overlap a second time from NRW.

Replace the old `billing.nrw_billed × calibrated_q` dependency. Carry explicit origin information for NRW-driven upgrades into the new coverage-volume calculation. For a tagged Basic-to-SM transfer, use its positive incremental billing weight, `max(0, fSM - fBasic)`, its retained coverage contribution and the same aggregate scale as the connection calculation. Remove only the resulting genuinely tagged sales overlap, bounded by eligible NRW sales and represented tagged volume. Negative billing changes remain signed connection adjustments, not negative overlap. Ordinary funded connections, commercial-loss recovery and growth in unrelated cohorts are not automatically overlapping.

Test tagged volume in the revenue year, after the applicable delivery lag. Do not use same-year potential NRW upgrades. Existing sanitation explicit overlap must remain separately identified and valid for the volume series it claims to overlap.

In avoided-production-cost mode, preserve the current conservation rule for any tagged connection volume that would contradict the avoided-sales assumption. Such an exclusion must be reported as an avoided-sales adjustment, not relabelled as positive NRW sales.

### 4.3 Fixed attribution on the final reconciled volume

Use one backend function to produce authoritative annual source series:

```text
connections_cash = N_t × T0 × C0
nrw_sales_cash   = W_t × T0 × C0
collection_cash  = V_t × T0 × (C_t - C0)
tariff_cash      = V_t × (T_t - T0) × C_t
nrw_net          = nrw_sales_cash + avoided_cost_cash - implementation_cost

additional_cash = connections_cash + nrw_net + collection_cash + tariff_cash
collected_revenue = V_t × T_t × C_t
reference_collected_revenue = B_t × T0 × C0
```

Required identity:

```text
additional_cash
  = collected_revenue - reference_collected_revenue
    + avoided_cost_cash - implementation_cost
```

Use `T_t = T0` when tariff reform is off and `C_t = C0` when collection improvement is off. Use each intervention's existing schedule when on. The tariff contribution receives the tariff–collection interaction exactly once. Both reforms now apply to eligible NRW sales as well as baseline and connection sales.

Keep signed NRW cash: negative implementation-year cash reduces available funding. Do not floor each source before summing. No additional connection operating-cost deduction remains, including any old cost transferred from connections to `nrw_operating_cost`. Do not remove the distinct NRW fixing cost or avoided-cost valuation.

For fixed physical volumes, reassigning NRW reform gains changes source amounts, not the combined total. During a full simulation, revenues can change future investment/delivery and therefore future volumes; baseline-rate attribution does not prohibit that existing feedback.

### 4.4 Sanitation link

Preserve `physical water recovery × return ratio × explicit sewer-billable share`, the link enable toggle and identified overlap. Value its direct sales at sanitation `T0 × C0`; put collection/tariff uplifts in sanitation's respective reform streams. Never put sanitation-linked cash inside water `nrw_net` as well. Water production-cost savings do not by themselves imply new water sales; preserve the existing explicit sanitation-link assumptions rather than automatically inferring them.

### 4.5 Result fields and versioning

Use a new revenue-reconciliation version (recommended `3`) and connection-config version `4`. Return baseline volume, connection volume before/after overlap, NRW sales, overlap, scenario volume, baseline/scenario rates, and all four source-cash series.

Prefer a canonical `connection_revenue_cash` with user label “Revenue from new connections.” During migration, `connection_revenue_delta` and `connection_net_cash` may be exact aliases of that one value for old consumers. They must never be added as separate sources. Obsolete operating-cost arrays should be removed from active presentation; compatibility arrays, if required, are explicitly zero. Do not relabel household-only volume/count diagnostics as observed under the aggregate proxy; provide newly named aggregate coverage/volume diagnostics instead.

Use consistent native units: volumes in million m³/year and cash in real local-currency millions; percentages stored as fractions. Raw m³/year = MLD × 1,000 × days; million m³/year = MLD × days / 1,000. Convert money for display only. Do not apply a million multiplier twice.

## 5. Engine integration and pass isolation

1. Deep-copy/disable both sectors' connection configs for the pure BAU pass in `model/engine.py`. Ordinary toggle clearing alone is insufficient.
2. Include an enabled connection feature in the decision to execute a scenario, even if every ordinary intervention and loan is off. Apply the same rule in chart/deck reruns.
3. Compute scenario connection revenue from that pass's preceding delivered coverage, with baseline shares frozen. Never borrow coverage from a different pass or geography.
4. Add the single reconciled `additional_cash` to the funding ledger exactly once. Avoid adding both old and new aliases, both a total and its components, or NRW fixing costs in a second financing-requirement row.
5. Preserve the forward annual sequence: prior-year delivery → current volume and receipts → current available funds → current delivery. Do not solve a same-year revenue/investment loop.
6. Calculate water before sanitation and preserve matched BAU, unfinanced-scenario and financed-scenario physical NRW link inputs.
7. Keep baseline reference revenue as a comparison-only amount. Explain the incremental modelling assumption in the UI rather than requiring users to assert facts about the origin of every funding input.

## 6. UI changes

### 6.1 New-connection panel

Keep a single saved configuration accessible from Data Inputs and Intervention Design. Do not create separate values for the same feature on different screens.

**Editable controls:**

- “Include revenue from new connections.”
- “Basic expansion billed (%)” — 0–100, mapped to `new_billed_share_basic`.
- “Safely Managed expansion billed (%)” — 0–100, mapped to `new_billed_share_sm`.
- One optional source/assumption note.

**Read-only context:** shared baseline tariff/collection rate, baseline billed-volume anchor and growth method, baseline Basic-or-better coverage, and calculated aggregate volume-scaling basis. Explain Basic-to-SM transfers and the one-year lag briefly.

Suggested explanatory text:

> Keeps the existing population/volume-growth revenue baseline. Additional coverage scales total billed volume using the existing customer mix. New-connection revenue uses baseline tariff and collection rates; selected reforms add their effects separately. Connection operating costs are excluded.

Remove the entire Advanced section, historical Basic/SM billing-share fields, household volume-share field, optional consumption and billed-household checks, separate non-household growth, alignment controls, custom funding reference, field-specific provenance editors, all operating-cost controls and warnings, zero-cost confirmation, funding-reference dropdown and the three old declarations. Remove corresponding activation gates in both frontend and backend.

The reviewed source-change warning and disabled expenditure-estimate button disappear with this removal. Do not retain a disabled or hidden proxy dependency. An enabled feature with genuinely missing current inputs shows an accurate incomplete state; a checkbox alone must not claim successful activation.

### 6.2 NRW panel

- Keep the physical NRW and implementation-cost inputs already listed in section 4.
- Replace the editable “Legacy NRW-only tariff (retained)” with read-only shared baseline tariff and collection rate. Preserve old values only in inactive migration metadata.
- Replace text saying “NRW receives the joint reform effect.” State that NRW sales are valued at baseline rates and reform uplifts appear separately.
- Clearly label the default sales scope “All eligible recovered volume sold/billed — households and other customers.” Keep compatible handling of the explicit household-only alternative.
- Hide sales-only controls when production-cost valuation is selected; retain the production unit-cost input in that mode.
- Show recovered physical/commercial volume, eligible sales, identified overlap, baseline-rate sales revenue, implementation costs, avoided costs where relevant, and signed NRW cash.
- Version-gate metadata correctly. Do not display the old v2 explanation for every version `>=2`; old saved results must retain their old attribution label until recalculated.
- Do not describe implementation costs as both a separate additional financing requirement and a deduction within NRW cash.

## 7. Intervention Design, graphs, Results and exports

### 7.1 Revenue graphs must use the final scenario ledger

Add an annual “Additional revenue by source” chart/table to Intervention Design and Loan Funding with four visible series: new connections, NRW signed cash, collection improvement and tariff reform. A selected source with zero contribution remains visible in the accompanying table. Negative values must render as negative. Keep funding injections and capital-efficiency benefits distinct from collected revenue.

Use final-scenario backend source series for revenue attribution. Do not infer a source's cash by subtracting cumulative reruns: a collection pass run before NRW would otherwise omit collection gains on NRW volume. Use the same final-ledger values in tooltips, totals, exports and source-selection previews.

Add connections to the shared label/color/category registry. In individual view it must be a distinct legend entry; category view must include it once, with a clear mapping such as Funding Mobilization. Respect each area's selected controls before national aggregation. Sum cash and volume; do not average tariffs or percentages to recalculate national receipts.

### 7.2 Existing household-coverage charts

The current chart bands represent effects on delivered households, not cash receipts. Keep that distinction visible.

Add a connection-enabled comparison stage so its effect on Basic/SM delivery appears as a band. The pure baseline stage must disable connection revenue; the connection stage enables it; subsequent stages retain it. Freeze one documented global comparison order, shared by the live charts, Results and deck exports. Insert the connection stage consistently and retain the existing cross-sector NRW dependency; loan funding is the final comparison stage.

Cumulative household effects can depend on the chosen comparison convention even though the final scenario and its fixed cash-source attribution are order-independent. Do not promise that arbitrary permutations of marginal household bands give identical source allocations. The same selected final configuration must produce identical final outputs regardless of UI click order or JSON key order.

All stages must telescope to the final household path, with no hidden connection-enabled baseline and no duplicate residual band.

### 7.3 Update all presentation paths

Inspect and update `LiveInterventionChart.tsx`, `ResultsDashboard.tsx`, Results ledger builders, `contributionView.tsx`, `chartColors.ts`, `deck_data.py`, `deck_aggregate.py`, `revenue_export.py`, `loan_reporting.py` and associated spreadsheet/PPTX generators. Update `connectionRevenueMode.ts` and labels that currently describe baseline mode as connection-based. The pure baseline is always exogenous under the new method.

Remove active cost-calibration rows from result/export tables. Carry new metadata and aliases through BAU/scenario/unfinanced-scenario prefixes without double counting. A saved table with legacy results is not evidence that the new backend method is active.

## 8. Loan Funding integration — extend the current model, do not redesign it

The active `solve_scenario` in `model/utility_debt.py` implements indicative lump-sum sizing, not a full debt-service ledger. This source review supersedes any earlier conversational suggestion that the present task should start deducting an actual repayment schedule.

Add `connections` to backend and frontend whitelists, selectors, previews, schemas, aggregations and exports. Its source is the reconciled baseline-rate connection contribution; collection/tariff uplifts are already in their own sources.

At the selected reference/injection year, use the frozen scenario **without utility-debt funding**, with the user's enabled connection/NRW/reform settings:

```text
signed_pool = sum(selected signed source cash)
eligible_pool = max(0, signed_pool)
annual_allocation = allocation_share × eligible_pool
principal = annual_allocation × existing_annuity_factor(rate, term)
```

Retain the current annuity formula and the zero-interest branch; do not replace it with a different financing formula in this task. Sum signed sources before the single zero floor. Example: connections 100 and NRW -30 produce pool 70, not 100.

Freeze the reference once. Do not use loan-financed future connections to resize the same original loan. Inject proceeds once and retain existing unspent-proceeds carryover. Source selection must not silently enable the underlying connection or reform feature. With a source correctly disabled, its contribution is zero; with invalid enabled inputs, report the actual incomplete calculation.

Keep the current qualification: allocation is hypothetical for sizing; principal, interest and fees are not deducted from annual funding in this version. Show source cash, selected allocation and indicative proceeds separately. Do not stack the hypothetical allocation as another cash inflow, and do not claim that it is a modelled repayment or a verified sustainable borrowing capacity.

Preserve NRW negative years and one-time costs in the selected source. Water NRW and the sanitation link must not be added twice in a combined scope. Migration must not automatically select the newly available connection source for an existing loan configuration.

## 9. Migration and backward compatibility

1. Use connection config version 4 and reconciliation metadata version 3 (or equivalent explicit method identifiers). Do not silently reinterpret a v3 result as v4.
2. Preserve the feature's enabled state, existing new Basic/SM billing values, explicit zeros and shared note. For genuinely older configs without new-share keys, reuse the existing documented v1/v2 share migration; preserve explicitly cleared v3 fields as missing.
3. Archive removed calibration/cost/funding fields as inactive legacy metadata if needed for audit. They must not affect the new calculation, validation, or loan eligibility.
4. Display a one-time migration notice: “New-connection revenue now uses aggregate coverage expansion at baseline rates. Historical calibration and connection operating costs no longer apply; recalculated results may change.”
5. Preserve shared revenue bases, ordinary intervention toggles, NRW schedules/costs, saved sales assumptions, population data and technical non-household capital shares.
6. Preserve old NRW-specific tariffs in inactive metadata, without allowing them to override the shared baseline rates or block the new method.
7. Default an absent connection configuration to disabled; do not auto-enable or choose a nonzero billing assumption.
8. Keep saved loan source selections unchanged. Existing “all sources” migrations must mean the old explicitly supported set, not silently add `connections`.
9. Migrate per area and per service. Repeated migration must be idempotent. Invalidate stale calculation caches when the method version changes.
10. Update the saved DRC fixture only as an intentional fixture migration; do not invent expenditure, volume, or billing observations.

## 10. Files to change and implementation sequence

| Stage | Main files | Work |
| --- | --- | --- |
| 1. Schema and volume helper | `frontend/src/connectionRevenueConfig.ts`, `model/connection_revenue.py`, `model/inputs.py`, `demo_adapter.py` | v4 migration, aggregate coverage method and validation; remove active cost-source plumbing. |
| 2. Delivery and isolation | `model/engine.py`, `model/water_supply.py`, `model/billing_cohorts.py`, `model/sanitation.py` | Pure BAU off, connection-only scenario, prior-year delivered coverage, origin tagging and matched sanitation inputs. |
| 3. Common cash attribution | `model/revenue_reconciliation.py`, `model/utility_revenue.py` | Reuse baseline path; fixed baseline-rate direct sources and full-volume reform effects. |
| 4. Form and diagnostics | `ConnectionRevenue.tsx`, `RevenueBase.tsx`, `InterventionPanel.tsx`, `NRWDiagnostics.tsx`, `nrwRevenue.ts`, `connectionRevenueMode.ts` | Simplified controls, inherited values, correct versioned explanatory text. |
| 5. Loan source | `model/utility_debt.py`, `frontend/src/loanFunding.ts`, `DebtServicingControls.tsx`, `UtilityDebtPreview.tsx`, `loan_reporting.py` | Connections source, signed pool, frozen no-loan reference and current indicative semantics. |
| 6. Charts and exports | Files in section 7, `DebtServicingPanel.tsx`, `export_deck.py` and other export callers | Shared definitions, final-ledger cash chart, explicit connection coverage stage and identical exports. |
| 7. Regression and docs | Existing Python/frontend test files, `docs/utility-revenue.md` | Replace obsolete expectations; add meaningful accounting and UI acceptance cases. |

Before editing, read any repository instructions and inspect changes after the reviewed commit. Prefer shared helpers over copying formulas into chart components. Do not mechanically delete `BillingCohorts` until its NRW-origin responsibilities are replaced.

## 11. Acceptance cases

### A. Aggregate coverage scaling

Use baseline total households 10,000; Basic 4,000; SM 2,000. Thus `S0 = 0.60`. Let the revenue year's baseline billed volume be 1.2 million m³, with `fBasic = 0.50`, `fSM = 0.90`, `T0 = 2`, `C0 = 0.80`.

For prior-year delivered shares Basic 42%, SM 23%:

```text
weighted change = 0.50 × (0.42 - 0.40) + 0.90 × (0.23 - 0.20) = 0.037
scale = 0.037 / 0.60 = 0.0616666667
additional volume before overlap = 1.2 × scale = 0.074 million m³
connection receipts = 0.074 × 2 × 0.80 = 0.1184 million currency units
```

Do not multiply the 74,000 m³ by the technical household share. Holding delivered coverage fixed, changing the technical non-household percentage must not directly change this revenue formula. In an end-to-end run, it may still change delivery through the preserved capital-cost calculation.

### B. Transfers, timing and baseline protection

- Unchanged Basic/SM coverage with 10% population growth: zero connection adjustment; baseline volume still grows 10%.
- Identical test with different household and population growth: zero adjustment if coverage shares remain fixed.
- A 2-percentage-point Basic-to-SM transfer at `fBasic = fSM = 0.8`: zero extra volume from that transfer.
- Same transfer at `fBasic = 0.5`, `fSM = 0.9`: weighted change `0.008`, not `0.018`; keep the Basic subtraction.
- Revenue cannot arise in the delivery year. It persists in later years while the coverage gain persists.
- Connection enabled with all ordinary reforms off: scenario runs and can differ from pure BAU. Changing billing percentages must never change pure BAU series.
- If coverage declines or a transfer reduces the billing weight, verify signed handling and nonnegative total-volume validation, not a hidden floor on each category.
- Zero billing percentages give zero connection receipts. Zero baseline served coverage gives the explicit incomplete state, without invented defaults.

### C. Revenue attribution identity

Use raw annual units in this arithmetic fixture; convert consistently when testing the engine:

```text
Baseline billed volume B = 1,000 m³
Non-overlapping connection addition N = 200 m³
NRW sales W = 100 m³
Baseline tariff T0 = 2; baseline collection C0 = 0.8
Scenario tariff T = 3; scenario collection C = 0.9
NRW implementation cost K = 50
```

| Source | Expected cash |
| --- | ---: |
| New connections | 320 |
| NRW sales before fixing cost | 160 |
| NRW signed net | 110 |
| Collection improvement | 260 |
| Tariff reform | 1,170 |
| Total additional cash after NRW fixing cost | **1,860** |

Check `1,300 × 3 × 0.9 - 1,000 × 2 × 0.8 - 50 = 1,860`.

With a 20 m³ identified overlap included in the raw 200 m³ connection addition, use `N = 180`, `V = 1,280`; expected connections 288, NRW net 110, collection 256 and tariff 1,152; total 1,806. Do not reduce the baseline volume, or subtract the same 20 m³ twice.

### D. NRW and combination tests

- Exercise all 16 on/off combinations of connections, NRW, collection and tariff, with same-year schedules held fixed; also test staggered start/target years and benefit lag.
- Same final inputs assembled in different UI click orders/key orders must produce identical final volume, cash-source series, funding and coverage.
- NRW at baseline rates is unchanged by enabling a tariff/collection reform in a fixed-volume fixture; those changes appear in their reform streams.
- Physical/commercial split remains valid; commercial recovery does not create physical upgrades.
- Test all-recovered sales, the saved household-only alternative, and avoided-production-cost mode. No sales-mode household haircut; no tariff receipts on avoided-cost savings.
- Only proven, prior-year NRW-origin connection volume is removed as overlap. Include a mixture of ordinary and NRW upgrades and a case with no overlap.
- Implementation-year NRW deficits remain signed and charged once.
- Sanitation link uses its own tariff/collection schedules, eligible physical volume and overlap; no duplicated water/sanitation source cash.

### E. UI, migration, loan and export tests

- The new panel contains only the current toggle, two percentages, optional note and read-only derived context. No Advanced or cost/proxy controls and no obsolete warnings remain.
- Missing obsolete fields in the DRC profile do not prevent activation. Missing required current shares still does.
- Explicit 0% survives edits, reload and migration; displayed 50% stores 0.50, not 50.
- Switching area/service retains independent values; national totals sum area receipts, including mixed enabled states.
- The connection series appears in individual and category graphs, source tables, loan preview and spreadsheet/PPTX exports.
- Revenue-source graph totals equal the authoritative final-scenario ledger, not partial-pass effects. Household bands telescope in their documented fixed order.
- An unchanged saved loan selection does not automatically acquire the new source. Selected connections plus negative NRW use the signed sum before the pool floor.
- Source selection does not enable its intervention. Loan-disabled and zero-allocation cases produce no proceeds.
- Loan amount is frozen from the no-loan reference; a funded rerun cannot bootstrap a larger original principal. Proceeds appear once, and the deferred-repayment label remains accurate.
- Cached v2 attribution is not presented as v3; removed legacy values do not reactivate costs or block valid v4 calculations.

## 12. Verification performed for this review and handoff requirements

This review fetched `main`, inspected the files identified above and left the repository source unchanged. The current source was checked with:

```bash
python -m unittest test_utility_revenue test_connection_revenue test_consolidated_revenue -q
node frontend/tests/connection-revenue-config.mjs
node frontend/tests/nrw-revenue-migration.mjs
node frontend/tests/loan-funding-config.mjs
```

Python result: 36 tests attempted; 35 passed and one endpoint test could not execute because FastAPI is absent in this review environment. All three listed frontend scripts passed. These validate existing behavior, not the proposed replacement.

A direct fixed-volume check against current `reconcile_revenue` confirmed that moving the NRW tariff/collection interaction into the reform streams preserves the 1,860 combined cash total in section 11C. The current allocation is connections 320, NRW net 220, collection 240, tariff 1,080; the proposed allocation is 320, 110, 260 and 1,170.

Replit must update the affected tests, run the focused Python and frontend suites with project dependencies installed, run the frontend build, and exercise the actual Data Inputs → Intervention Design → Loan Funding flow. Include the connection-only scenario, all four revenue levers together, the DRC saved profile, and area/service switching. Preserve unrelated regression gates for service transitions, financing gaps, asset replacement and indicative loan carryover.

Return a change summary listing modified files, the implemented equations, migration behavior, checks run and any remaining limitations. Do not report the new behavior complete until the same source values reconcile across the engine, live UI, loan preview and exports.
