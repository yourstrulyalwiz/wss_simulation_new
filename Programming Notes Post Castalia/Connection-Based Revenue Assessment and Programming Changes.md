# Connection-Based Revenue — Assessment and Programming Changes

**Date:** 5 October 2026  
**Status:** Implemented in development; not published.  
**Scope:** Optional baseline feature for water supply and sanitation, configured independently for each area and sector. No empirical billing or operating-cost values have been invented.

## 1. Financing graph treatment

Connection revenue is a baseline-model option, not an intervention.

- The BAU financing reference is recalculated in the selected revenue mode, including connection cash even when all interventions are off.
- Each scenario uses its own prior-year delivered billed households. It does not borrow the full scenario's future customer volumes.
- The existing Collection Efficiency and Tariff Reform contributions remain separate and in the existing order.
- Contributions are differences between successive full model runs. They therefore include later revenue effects from the connections caused by each intervention.
- No additional “dynamic revenue” intervention band has been added.
- Revenue mode is labeled on BAU/intervention charts and in Results; mixed area modes are disclosed rather than silently treated as uniformly dynamic.
- The financing charts continue to cover safely managed + basic service.

**An annual cash contribution is not a one-for-one reduction in the year-end financing requirement.** Replacement priority, delivery/target ceilings and subsequent replacement obligations on newly funded assets affect the outcome. Connection cash may be negative when billing falls below the funding reference.

## 2. Ledger treatment and calculation order

For each forecast year:

1. Read SM/basic households delivered at the end of the previous year.
2. Apply explicit billed shares and constant calibrated consumption to calculate household billed volume.
3. Add the independently projected non-household volume.
4. Apply baseline or enabled scenario tariff/collection schedules.
5. Compare against the frozen funding-reference volume and deduct the household volume-related variable-cost difference.
6. Add connection net cash, collection cash and tariff cash to available capital **once**.
7. Apply existing replacement priority and eligible expansion allocation; close the asset/service ledger.
8. Use the closing delivered households for next year's revenue.

```text
Additional net cash = connection net cash + collection cash + tariff cash

Year-end financing requirement =
    closing outstanding expansion
    + accumulated unpaid replacement
    + accumulated cash deficits
```

Reference collected revenue is comparison-only: it is not credited to capital again. Dynamic tariff/collection streams replace the exogenous equivalents when enabled; the two sets are not added together.

Connection cash is a funding flow, not an asset or a direct coverage credit. Unfunded targets generate neither new assets nor new-customer revenue. Annual outstanding-expansion snapshots must not be summed as annual financing needs. Existing historical-shortfall pay-down behavior is unchanged.

## 3. Assessment of the previous model

Previously, household billed volume grew exogenously with population or a user growth rate, independently of delivered connections. Reform cash was calculated before the annual service-delivery loop.

There is **no full utility operating-cost account**, either before or after this change. Capital replacement remains separate. NRW-specific fixing/maintenance costs and avoided-production-cost valuation are not a complete utility operating-cost budget.

The new feature introduces only a marginal variable-cost adjustment on household volume differences. Existing exogenous-mode tariff/collection revenue continues to follow the previous treatment when the feature is disabled.

## 4. Inputs, provenance and migration

Data Inputs → Revenue Inputs now includes a dedicated **Connection-based revenue** subsection following the existing sector and area selectors.

The feature defaults **off**. Enabling it requests dynamic modeling, but an incomplete/conflicting configuration remains visibly exogenous with local validation messages. Disabling it retains entered values and restores the previous calculations.

The versioned `connection_revenue` configuration stores independent `water` and `sanitation` settings within each area's inputs:

| Field | Meaning |
|---|---|
| `version`, `enabled` | Configuration version and requested mode. |
| `billed_share_sm`, `billed_share_basic` | Shares between 0 and 1, supplied explicitly. |
| `household_volume_share` | Household fraction of billed volume; remainder is non-household. |
| `marginal_cost`, `zero_cost_confirmed` | Nonnegative real-local-currency cost per billed m³; zero needs explicit simplification confirmation. |
| `alignment`, `baseline_volume_mld` | Authorize existing-growth estimation or supply a baseline-year volume observation. |
| `funding_reference`, `reference_confirmed` | Confirm exogenous, fixed baseline or supplied household-volume reference. |
| `reference_series` | Raw household m³/year for every forecast year if supplied-series mode is chosen. |
| `funding_includes_reforms` | Future reforms already included in funding must be reconciled before dynamic mode activates. |
| `nonhousehold_growth_rate` | Optional separate growth override; otherwise use the aligned canonical growth rule. |
| `consumption_m3` | Explicit consumption assumption when a zero billed-household/zero-volume baseline cannot calibrate it. |
| `observed_billed_households` | Optional consistency check against modeled billed-household equivalents. |
| `provenance` | Observed/assumed source type, source/note and reference year where applicable. |

The canonical volume, tariff and collection base remains shared with existing reforms. Original volume/year anchors are retained. A non-baseline anchor cannot silently become a baseline observation: the user must authorize conversion or supply an observation.

Valid zeros are preserved. Positive household volume with zero modeled billed households is rejected. An observed customer count conflicting with the billed shares is flagged, not used as a second denominator. Non-household-only mode is supported.

Limited/lower billing is outside this version and is disclosed in inputs/outputs. Shares are average propensities, not customer cohorts. Equally billed basic-to-SM upgrades do not create another customer's volume.

## 5. Collection efficiency and operating-cost source

- **BAU:** uses the canonical baseline collection ratio.
- **Scenario with Collection Efficiency off:** uses the same baseline ratio.
- **Scenario with Collection Efficiency on:** uses its existing schedule.
- Tariff follows the equivalent baseline-versus-enabled-schedule rule.

Connection mode itself changes neither rate.

The marginal cost is a **new user-supplied value**, based on utility evidence or an explicit documented assumption. It is not inferred from GDP, the funding budget, connection capital costs or replacement expenditure. Average total operating expenditure per m³ must not automatically be described as marginal variable cost.

The same configured real-price marginal cost applies in BAU and scenarios in this version:

```text
Incremental variable operating cost =
    (dynamic household volume − funding-reference household volume) × marginal cost
```

Do not deduct all existing operating expenses again from baseline funding assumed to already contain the reference net contribution. Negative cost differences are avoided variable cost under the explicit symmetric assumption; they do not remove fixed expenses or assets. Incremental net cash is reinvested 100%.

## 6. Calibration and revenue identity

Quantities below use raw households and m³/year; the engine consistently uses millions for household/volume/cash arrays. The displayed billed-household diagnostic is raw households; tariff and marginal cost are real currency per m³.

```text
N0 = billed share SM × baseline SM + billed share basic × baseline basic
q = baseline household billed volume / N0

Dynamic household volume in year t =
    q × (billed share SM × delivered SM[t−1]
         + billed share basic × delivered basic[t−1])
```

Household dynamic volume is not additionally multiplied by population growth. Non-household dynamic/reference volume is identical in this version. Funding references are frozen and identical across BAU, scenario, cumulative and debt-sizing passes.

```text
Connection gross difference = Δ household volume × baseline tariff × baseline collection
Connection net cash = connection gross difference − incremental variable operating cost
Collection cash = dynamic total volume × baseline tariff × collection uplift
Tariff cash = dynamic total volume × tariff uplift × applicable collection

Total additional net cash =
    dynamic collected revenue − reference collected revenue
    − incremental variable operating cost
```

Verified calibration: 60 SM/40 basic, both fully billed and household volume 10,000 m³/year produce 100 billed-household equivalents and 100 m³/household/year. A 70 SM/30 basic upgrade preserves 10,000 m³. Ten genuinely additional billed households produce 11,000 m³ in the subsequent year.

Verified cash example: dynamic/reference volume 11,000/10,000 m³, baseline tariff/collection 1/.8, scenario tariff/collection 1.2/.9 and marginal cost .2:

| Quantity | Currency units |
|---|---:|
| Reference collected revenue | 8,000 |
| Dynamic collected revenue | 11,880 |
| Connection gross difference | 800 |
| Collection cash | 1,100 |
| Tariff cash | 1,980 |
| Incremental variable operating cost | 200 |
| Connection net cash | 600 |
| **Total additional net cash** | **3,680** |

Both reforms off give 600. Confirmed zero variable cost with both reforms on gives 3,880. Equal dynamic/reference volume gives no connection adjustment and recovers the prior reform formula. These are controlled test fixtures, not validated DRC observations.

## 7. Outputs, exports and changed files

Results contains an annual **Revenue Details** table for BAU and scenario, with billed-household equivalents, household/non-household/total/reference volume, applicable rates, collected/reference revenue, gross connection difference, variable cost, connection net cash, reform cash and total additional net cash.

CSV/Excel include diagnostic fields, mode/configuration/provenance and limitations. Excel has dedicated revenue-detail and assumptions sheets. Both PowerPoint paths include annual revenue appendices with full diagnostics/configuration in speaker notes. Monetary conversion never scales households or volume; local-source tariff assumptions remain clearly labeled. Spreadsheet-compatible detailed outputs use approximately 15 significant digits rather than the old four-decimal currency-million ledger-summary rounding.

Main changes:

- Model: `model/connection_revenue.py`, `model/service_history.py`, `model/water_supply.py`, `model/sanitation.py`, `model/engine.py`, `model/inputs.py`, `model/utility_revenue.py`.
- Input/API bridge: `demo_adapter.py`, `app.py`.
- Frontend: `ConnectionRevenue.tsx`, `RevenueBase.tsx`, `ResultsDashboard.tsx`, `LiveBAUChart.tsx`, `LiveInterventionChart.tsx`, `frontend/src/connectionRevenueMode.ts`.
- Exports/aggregation: `revenue_export.py`, `export_data.py`, `export_pptx.py`, `export_deck.py`, `deck_aggregate.py`.
- Tests: `test_connection_revenue.py`, `frontend/tests/revenue-reconciliation.mjs`, `frontend/tests/connection-revenue-browser.mjs`.
- Rebuilt frontend assets served from `static/`.

## 8. Verification

- Full Python suite: **81 tests passed**, including **13 connection-revenue tests**.
- After the branded PowerPoint notes-placeholder correction, all 13 feature tests passed again, including a complete urban/rural/national branded deck round trip.
- Six frontend regression scripts passed: revenue reconciliation, contribution grouping, service access, calculation errors, cost mixes and development-preview preservation.
- TypeScript/Vite production build passed; existing large-bundle warning remains.
- Browser checks passed for enable/disable, calibrated status, retained inputs, debounced autosave/reload, sector isolation, annual tables, financing chart scope and mobile rendering.
- Before implementation, legacy outputs were captured for both reform states; every pre-existing result field matched exactly after the disabled-mode model changes.
- CSV, Excel, standard PowerPoint and branded PowerPoint HTTP exports were parsed successfully with connection-based mode enabled. The urban/rural/national branded deck contained 24 revenue appendices with retained diagnostics/provenance; its complete round trip is also covered by the feature regression.
- Language-server diagnostics reported no errors. Application startup and calculation/revenue-validation requests succeeded.

## 9. Remaining limitations and separate work

1. Baseline funding is not a complete utility account. The funding-reference selection is an explicit user assumption, not a deduction from the budget.
2. Marginal variable cost is not full operating expenditure, depreciation or asset replacement.
3. NRW cash and physical effects remain unchanged. Existing NRW water valuation and modeled connection billing can overlap; no full revenue reconciliation is claimed when NRW is enabled.
4. Debt eligibility remains limited to the existing eligible revenue streams. Connection net cash is not silently made a new pledged-revenue source; a test verifies that connection cash alone does not create borrowing capacity.
5. Detailed utility accounts, elasticity, separate SM/basic consumption, customer cohorts, lower-service billing and historical-shortfall pay-down are not introduced.

Development is ready for review with the feature off by default. Saved profiles were not populated with invented empirical assumptions. No publication was performed.
