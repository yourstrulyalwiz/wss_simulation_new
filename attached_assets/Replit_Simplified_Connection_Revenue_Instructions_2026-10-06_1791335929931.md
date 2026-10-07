# WSS Simulation Tool — simpler new-connection revenue inputs

Implementation instructions for Replit · 6 October 2026

Reviewed repository: `yourstrulyalwiz/wss_simulation_new`, `main`, commit **`f49cfb0019ac0cbb5bf9def45ccdd58d4f06ca04`** ("Update debt servicing and connection revenue modules"). This is a follow-up to the consolidated NRW/revenue instructions already implemented in that commit. It is a proposed programming specification, not an implemented source-code change.

## 1. Task

Simplify the connection-based revenue configuration and extend the existing calculation to explicitly model the proportion of newly connected/upgraded Basic and Safely Managed households that are billed. Present operating costs per billed household per year, reusing existing calibration/cost data where possible. Continue to calculate additional net cash above the funding reference and add it to available funding once.

User-confirmed behavior:

- Two percentage inputs: **New Basic connections billed (%)** and **New Safely Managed connections billed (%)**.
- Billed households are distinct from collection efficiency: the percentages determine who receives a bill; collection efficiency determines how much of that bill is paid.
- With collection improvement off, apply the baseline collection rate. With it on, apply the scheduled scenario rate in each revenue year. Use the same baseline/scenario rule for tariff reform.
- NRW, when selected, feeds the existing reconciled volume and cash calculation. Count overlapping connection/NRW sales once.
- Additional collected revenue less additional operating cost contributes net cash to available funding. Recurring revenue and costs continue for the accumulated customer base, not just the year's new entrants.
- Keep NRW implementation costs inside signed NRW net cash. Keep the existing selected-source loan pooling, including negative NRW amounts.

This remains an optional baseline modeling feature for BAU and scenario passes, not a new intervention category. Each pass must use its own delivered connections, while sharing frozen baseline calibration/reference assumptions. Keep independent urban/rural and water/sanitation settings.

## 2. What the latest push already implements

Preserve the following work; do not reapply or reverse the earlier consolidated instructions.

| Current implementation | Evidence in reviewed commit | Consequence for this task |
|---|---|---|
| Connection billing follows prior-year SM/Basic household counts and applicable tariff/collection rates. | `model/connection_revenue.py:148–179`; `model/water_supply.py:771–780` | Extend its billing base; preserve schedules and lag. |
| NRW sales, tagged overlap, recurring cost attribution and implementation cost reconcile through one function. | `model/revenue_reconciliation.py`, `reconcile_revenue()`; `model/water_supply.py:781–823` | Continue using this common calculation. Do not append another independent connection cash stream. |
| Current billing shares multiply the entire SM/Basic stock and also calibrate baseline consumption. | `model/connection_revenue.py:85–105,151–157` | New-connection percentages must not silently replace baseline shares. |
| NRW household overlap currently uses accumulated NRW-origin upgrades times the constant SM-minus-Basic billed-share difference. | `model/water_supply.py:784–787` | Update tagging when new-connection shares differ from baseline shares. |
| Target caps were removed from shared SM delivery; microfinance has one-off eligible cohorts. | `model/water_supply.py`; `model/service_cohorts.py` | Preserve physical eligibility, delivery order and one-year rung-transition constraints. |
| The loan source still includes signed `nrw_net`, including implementation cost, and floors only the selected total. | `model/utility_debt.py:565–585` | Preserve this cost basis and the frozen no-loan reference. |
| Frontend supports configuration versions 1/2 but still presents the complex original connection form. | `frontend/src/components/ConnectionRevenue.tsx` | Add compatible migration and a simpler presentation. |
| Annual operating expenditure fields exist in the input UI but are not wired into connection cost calibration. | `frontend/src/components/InputPanel.tsx:1080–1083,1107–1110`; `demo_adapter.py` | Reusing those fields requires explicit plumbing and validation; it is not already automatic. |

Review verification: **47 backend tests passed** across `test_connection_revenue`, `test_consolidated_revenue`, `test_utility_revenue` and `test_indicative_loans`. The existing frontend `revenue-reconciliation.mjs`, `nrw-diagnostics.mjs` and `nrw-revenue-migration.mjs` checks also passed. These are targeted checks of the current implementation, not a complete audit or tests of the new specification. No new browser verification was performed in this review.

## 3. Main input panel

Keep the panel in **Data Inputs → Revenue**, with the current area/sector selection. Use percentage displays from 0–100 while storing fractions from 0–1. Preserve a visibly distinguishable blank versus an explicit zero.

Show:

1. **Include revenue from new connections** — the current baseline-model enable switch.
2. **New Basic connections billed (%)**.
3. **New Safely Managed connections billed (%)** — explain that SM upgrades replace the previous Basic billing status, so an already billed household is not counted as an entirely new customer.
4. **Annual operating cost per billed household** — real local currency/household/year; show the selected source and an optional override.
5. **What household revenue is already included in your funding projection?** — retain the meaningful funding-reference choice, with plain-language descriptions below.
6. One shared **Source / assumption note**, with field-specific observed/assumed overrides available under Advanced.

Immediately below the inputs, show read-only inherited/calculated values:

- Baseline tariff and collection rate, with a note that selected reforms use their own schedules.
- Baseline billed households and estimated consumption per billed household per month/year.
- Cost source: converted existing unit cost, manual annual cost, or an explicit average-cost proxy.
- Revenue begins in the year after service delivery; costs follow the same billing lag.
- Effective mode: active, off, or incomplete, including a clear link to any missing calibration fields.

Do not request tariff, collection rate, billed volume, population or household counts again when valid shared inputs already exist. Do not hide required missing baseline information behind a collapsed panel without showing what needs completion.

### Advanced / baseline calibration

Retain the following controls, collapsed when valid and expanded when needed:

- Baseline SM and Basic billed shares. These remain calibration inputs for existing customers.
- Household share of total billed volume. This remains necessary to distinguish household from non-household consumption when calibrating from total utility volume.
- Baseline volume/year alignment, observed-volume override, optional observed billed-household count and consumption check.
- Non-household growth override; inherit the shared growth rule when blank.
- Manual cost per m³ as a compatible alternative to the annual-per-household input.
- Custom annual funding reference series and field-specific provenance.

When the shared volume reference year equals the model baseline year, align automatically. If they differ, show the derived estimate and a concise choice to use it or supply a baseline observation. Do not invent missing empirical values.

Use one common note for assumed inputs unless a field has its own source. Preserve existing observed provenance and do not silently relabel it. Update backend validation to accept the common-note route; hiding the old per-field editors alone must not disable the feature. Show zero-cost confirmation only when the selected cost is zero.

## 4. Keep baseline calibration separate from future billing inputs

The current formula is:

```text
Baseline billed households N0 = baseline_SM * baseline_SM_billed_share
                             + baseline_Basic * baseline_Basic_billed_share
Annual consumption q = household_share * baseline_annual_billed_volume / N0
```

Retain that calibration, frozen within each calculation. Do not recalibrate `q` or baseline billed households when the user changes a percentage for NEW connections. Otherwise lower billing participation can be offset by artificially higher inferred consumption, obscuring the requested behavior.

Add separate future-delivery fields, e.g. `new_billed_share_basic` and `new_billed_share_sm`. Recommended migration defaults inherit the corresponding existing baseline shares, clearly labeled "Initially uses baseline billing share". Do not assume universal 100% billing. Users can then change the new-connection shares without changing historical calibration.

If no valid starting billed-household calibration exists, request the needed consumption/billing assumption. Do not infer it from GDP, capital requirements, replacement cost or a fabricated default. Preserve the current handling of non-household-only configurations and validate degenerate zero-volume cases explicitly.

## 5. Track delivered billed-household equivalents

Use actual named service-delivery flows, including funded transitions, NRW upgrades and microfinance/grants. Do not use unmet targets or potential NRW capacity as if they were delivered customers. Affordability cohorts already in `service_cohorts.py` are a separate accounting purpose; do not treat them as billing cohorts without adding the needed state.

Initialize billed SM and Basic household equivalents from the baseline. For a year with `E` lower-service→Basic entries and `U` opening-Basic→SM upgrades, let:

```text
b_basic = fraction of new Basic connections billed
b_sm = fraction of newly upgraded SM households billed
r_source = billed fraction of the eligible opening Basic pool being upgraded

New Basic billed equivalents = E * b_basic
Billed Basic households transferred out = U * r_source
Billed SM households transferred in = U * b_sm
Net change from SM upgrades = U * (b_sm - r_source)

Billed_Basic_close = Billed_Basic_open - U*r_source + E*b_basic
Billed_SM_close = Billed_SM_open + U*b_sm
```

Use aggregate cohort bookkeeping, or an equivalent auditable stock/flow implementation. Where actual billing identities are unknown, deduct from the eligible Basic stock proportionally. A single weighted billed fraction is sufficient if all remaining Basic households are eligible under the same assumption. Retain source tags needed for NRW attribution.

The important correction to the simple discussion example is that `r_source` comes from the households being upgraded. It equals the configured Basic share only if the relevant Basic pool has that billing mix. It can differ after several cohorts with different billing assumptions have accumulated.

- Do not count all SM billed households as newly billed when some were already billed under Basic.
- Do not count this year's new Basic entrants again as SM upgrades in the same year.
- Preserve billing of prior delivered cohorts in later years; operating costs recur with that accumulated base.
- Bound billed households by their actual service-category stocks and handle any demographic attrition consistently without creating new customers.
- Use the closing billed stock from year t to calculate billing in year t+1, preserving the current one-year lag.
- Keep signed billing changes if the user's assumptions imply fewer billed equivalents after an upgrade. Do not silently floor them to zero; show the implication and retain signed cash consistency.

For legacy settings where new shares equal baseline shares, the tracked stock should reproduce the current weighted-stock calculation within tolerance. Each BAU, scenario and no-loan reference pass needs its own billing state; do not share mutable state between runs.

## 6. Operating cost: reuse existing data without adding a second cost deduction

### Preferred compatible route

The current model already has `marginal_cost` in currency/m³ and calibrated annual consumption `q` in m³/billed household. Automatically display the equivalent annual cost:

```text
k = q * marginal_cost
```

`k` is annual operating cost per billed household. This is an exact unit conversion under the current constant-consumption assumption, not a new empirical estimate. Existing saved configurations can therefore display the simpler unit without requiring a fresh cost input or changing results.

Allow a user to enter/override `k` directly. With positive `q`, convert back internally using `marginal_cost_effective = k/q` and pass that value through the existing reconciliation function. Choose one authoritative cost basis at a time and show the derived other unit; do not keep contradictory independent values active.

### Optional estimate from operating expenditure

Offer a deliberate action, **Estimate from existing operating expenditure**, only when compatible data exist:

```text
k_proxy = annual household-related operating expenditure / baseline billed households
```

Read the selected area's and sector's existing `tariff_op_expenditure` where present. It is currently a frontend field, not a connected calibration source. Wire the source/derived configuration through the adapter, backend and API status response, or persist a validated estimate with its source metadata; do not rely on a frontend-only label.

The numerator must be annual real operating expenditure in raw currency units for the same service scope and baseline year. The denominator must be raw households, not million households. If the expenditure includes non-household customers, obtain an explicit household-cost allocation. The household share of billed volume may be offered as an assumed allocation proxy, visibly labeled and accepted by the user; do not silently treat a volume share as a known cost share.

Label this **Average operating cost used as a proxy**. It includes fixed costs and is not necessarily marginal cost. A missing, zero-placeholder or incompatible expenditure figure does not automatically imply zero cost. Allow a manual annual-per-household assumption instead. Store the source, year, currency basis and allocation assumption so a saved profile can reproduce the calculation. Alert the user when those source inputs change; do not recalibrate the cost from future scenario customers.

### Incremental recurring cost

For the household component, with `N_reference[t]` the billed-household equivalents already included in the funding reference:

```text
Additional operating cost[t] = (N_billed[t-1] - N_reference[t]) * k
N_reference[t] = household_reference_volume[t] / q       # when q > 0
```

Use the household-only reference volume here, not total volume including non-household sales. This is equivalent to `(household_volume - household_reference_volume) * marginal_cost_effective`. Reference-related cost savings/shortfalls remain signed, as in the current model.

Do not divide by zero. When `q=0`, explicitly distinguish no household billing from missing calibration. A positive annual household cost with a zero-volume configuration requires a defined direct household-cost path, or a clear validation error requesting a compatible configuration; it must not be silently converted to zero or infinity. Keep valid legacy non-household-only behavior.

Only one cost deduction enters funding. `annual_connection_cash()` currently computes an intermediate cost, and `reconcile_revenue()` then recalculates the final cost/attribution. Updating only the former would be overwritten. Make the final reconciled calculation authoritative.

The approved simplification uses billed households as the operating-cost proxy. Explain that unbilled households may also incur costs; do not describe this as a complete utility operating account.

## 7. Preserve the joint tariff, collection and NRW calculation

In each revenue year:

```text
Raw household volume = accumulated lagged billed-household equivalents * q
Raw total volume = raw household volume + existing non-household volume
Reconciled volume = raw total volume - identified NRW overlap + NRW sales volume
Collected revenue = reconciled volume * applicable tariff * applicable collection rate
```

Use baseline rates when a reform is off, baseline rates before its start, its scheduled rates during implementation and its final rate thereafter. Do not add another input for a connection-specific collection rate or tariff. Do not multiply operating costs by the collection rate: unpaid bills still incur the modeled cost.

Continue the current source attribution: connection revenue at reference rates; collection then tariff on non-NRW volumes; the full applicable-rate NRW sales effect assigned to NRW. Although an illustrative new household's net contribution uses the applicable scenario rates, its reported effects may be split across connection, collection and tariff lines. Do not add the full scenario-rate household contribution and then add the same tariff/collection uplifts again.

### Update NRW overlap for the new billing cohorts

The current tag `nrw_origin_hh * q * max(baseline_SM_share - baseline_Basic_share, 0)` assumes constant billing propensities for all households. Once future billing shares can differ, track the positive incremental billed equivalents specifically caused by each actual NRW Basic→SM flow using its source pool's prior billing status and the new SM billing share. Carry that tag forward with the same billing lag and multiply by `q` to obtain overlap volume.

Retain `nrw_origin_households` for physical capacity commitments; do not replace that physical household count with the smaller incremental billed-equivalent count. Preserve the recovered/sold-volume bounds and all-recovered-sold versus household-only sales assumptions. Unrelated new connections must not be subtracted as NRW overlap.

With positive `q`, the equivalent cost per m³ allows the current reconciliation to move overlapping costs from the connection line to NRW exactly once. Do not deduct another `k * NRW households` after that transfer. Retain existing sanitation-specific billing rates, linked-volume eligibility and explicit overlap assumptions.

Keep these existing rules unchanged:

- Implementation cost remains deducted within signed NRW net cash.
- Negative NRW net cash reduces ordinary available funding.
- If NRW is selected for indicative borrowing, its signed after-cost amount enters the selected source sum; only the sum is floored at zero.
- The connection source itself remains excluded from loan-source selection. Existing tariff/collection effects on its expanded base remain eligible under their source labels.
- No loan-generated revenue may enlarge its own frozen no-loan sizing reference.
- No new target ceilings, urban/rural redistribution, repayment deductions or changes to Basic/SM allocation.

## 8. Funding-reference choice

Keep this choice visible in plain language. Population growth alone does not identify what utility contribution is already embedded in a funding projection.

| UI choice | Existing setting | Meaning |
|---|---|---|
| Revenue follows the existing volume-growth assumption | `exogenous` | Compare dynamic household billing with the household share of the existing projected volume path. |
| Only the baseline household revenue contribution is included | `fixed` | Compare with baseline household volume held constant. |
| Specify an annual reference | `series` | Preserve the supplied household-volume reference, under Advanced. |

Preserve confirmation that the selected reference net contribution is already represented in funding and that future tariff/collection reforms are not already included. The interface may combine explanations, but must not silently invent the funding assumption. If funding is public-only and contains no utility contribution, the reference must be explicitly reconciled; neither fixed nor exogenous should be silently assumed correct.

## 9. Configuration, migration and outputs

Introduce a compatible new schema version (e.g. version 3) with explicit fields for future billing shares, selected cost basis, annual cost or its source, and the shared assumption note. Retain original fields and source values for migration/audit.

- Existing version 1/2 profiles must load with unchanged numerical behavior unless the user deliberately changes assumptions.
- Inherit new-connection shares from the existing baseline shares on migration. Preserve zeros and partial drafts.
- Convert existing cost per m³ to annual per-household display using frozen baseline consumption. Persist the chosen authoritative basis so future calibration edits do not leave two conflicting cost values.
- Align frontend/backend validation and `/api/revenue-bases` calibration results.
- Preserve shared inputs, other sectors/areas, scenario toggles, loan settings and saved names.
- Changing future billing shares must not alter baseline calibration or rewrite historical results.

Expose baseline billed households, lagged billed-household stock, Basic/SM billed entry and transfer flows, reference billed equivalents, selected cost basis, equivalent unit cost and net cash diagnostics. Separate physical NRW-origin households from incremental NRW-tagged billed equivalents. Use consistent raw/million units in API, tables, aggregation and exports. Aggregate household counts/cash first; compute national rates with appropriate weights.

Relevant files to inspect/update: `model/connection_revenue.py`, `model/water_supply.py`, `model/revenue_reconciliation.py`, `model/engine.py`, `demo_adapter.py`, `app.py`, `frontend/src/components/ConnectionRevenue.tsx`, `frontend/src/components/RevenueBase.tsx`, result/NRW diagnostics, `revenue_export.py` and `deck_aggregate.py`. `service_cohorts.py` currently models affordability, not billing; use a separate billing helper or explicitly separate its state. The loan formula needs no redesign.

## 10. Worked acceptance cases

### A. New Basic connections and applicable rates

Assume 1,000 actual new Basic connections, 80% billed, 120 m³ per billed household/year, annual operating cost 40 per billed household, and no overlap/reference growth for this isolated example. Billing begins next year.

| Active rates | Collected revenue from the 800 households | Operating cost | Net annual contribution from those households |
|---|---:|---:|---:|
| Baseline tariff 1.00; collection 80% | 76,800 | 32,000 | **44,800** |
| Tariff reform to 1.50 only; collection 80% | 115,200 | 32,000 | **83,200** |
| Collection improvement to 90% only; tariff 1.00 | 86,400 | 32,000 | **54,400** |
| Both: tariff 1.50; collection 90% | 129,600 | 32,000 | **97,600** |

These isolate the new households' contribution; the full model also includes the reforms' effects on existing customers. Do not force the connection attribution line alone to equal the joint-rate total.

### B. Basic→SM transfer

Upgrade 1,000 opening Basic households whose billed share is 60%; the new SM billed share is 90%. Remove 600 billed equivalents from Basic and add 900 to SM. Net increase: **300**, not 900. With identical annual consumption/cost assumptions, incremental operating cost is 300 times the annual unit cost. If both shares are equal, there is no additional billing solely from the upgrade.

### C. Reference growth

If 800 additional billed equivalents exist but 200 are already represented by the funding reference, the operating-cost increment applies to 600 equivalents. At annual cost 40, deduct 24,000, not 32,000. Revenue and cost must use the same reference treatment.

### D. Cost-unit conversion

At consumption 120 m³/year and legacy marginal cost 1/3 per m³, annual cost is 40 per billed household. Switching the display/basis without changing that value must reproduce the legacy net cash. Replacing it with an expenditure-derived average cost is an explicit assumption change, not an automatic migration.

### E. NRW and loans

With joint reforms and NRW on, assert `total_volume = raw_volume - overlap + NRW_sales`. Source cash must sum to collected revenue minus reference revenue, applicable recurring costs and NRW implementation cost, plus any explicitly modeled avoided-cost benefit. Keep the existing 60 tariff + 40 collection - 30 NRW selected-source example: pool 70 and 50% annual allocation 35.

## 11. Required regression checks and delivery

Add focused tests for:

1. All eight NRW/tariff/collection toggle combinations, with connection billing enabled; inherited baseline rates when off and distinct staggered schedules when on.
2. The numerical cases above, next-year billing/cost lag, and continued annual cash from prior cohorts.
3. New billing share 0%, 100%, missing and invalid inputs; changing future shares cannot change baseline consumption or historical revenue.
4. Mixed Basic cohorts, Basic→SM transfers and NRW-specific billing tags; no duplicated customers, sales or operating cost.
5. Different baseline and future billed shares, and exact legacy parity when shares/cost assumptions are equivalent.
6. Per-m³/per-household cost equivalence, explicit proxy allocation, missing/incompatible expenditure, and zero-volume/zero-customer validation.
7. Reference growth versus fixed reference; preserve signed differences and prevent an additional population-growth multiplier on served customers.
8. Both sectors and areas, BAU/scenario/no-loan isolation, save/reload migration, diagnostics and exports.
9. Current target-overachievement, physical eligibility, NRW cost and signed loan-pool tests continue to pass.
10. A browser check of the simplified panel, percentage conversion, cost-source selection, missing-input disclosure and persistence. Confirm the served bundle matches the tested frontend build.

Run the current relevant backend suites and frontend checks plus these new tests. Report changed files, before/after examples, actual test results and limitations. Update product documentation/policy notes to describe the newly authorized per-household cost/proxy options while preserving the existing NRW net-cost decision. Do not describe this as a full utility operating-account model.

## Source links

- [Reviewed commit](https://github.com/yourstrulyalwiz/wss_simulation_new/commit/f49cfb0019ac0cbb5bf9def45ccdd58d4f06ca04)
- [Connection revenue](https://github.com/yourstrulyalwiz/wss_simulation_new/blob/f49cfb0019ac0cbb5bf9def45ccdd58d4f06ca04/model/connection_revenue.py)
- [Shared sector calculation](https://github.com/yourstrulyalwiz/wss_simulation_new/blob/f49cfb0019ac0cbb5bf9def45ccdd58d4f06ca04/model/water_supply.py)
- [Revenue reconciliation](https://github.com/yourstrulyalwiz/wss_simulation_new/blob/f49cfb0019ac0cbb5bf9def45ccdd58d4f06ca04/model/revenue_reconciliation.py)
- [Connection input component](https://github.com/yourstrulyalwiz/wss_simulation_new/blob/f49cfb0019ac0cbb5bf9def45ccdd58d4f06ca04/frontend/src/components/ConnectionRevenue.tsx)
- [Consolidated regression tests](https://github.com/yourstrulyalwiz/wss_simulation_new/blob/f49cfb0019ac0cbb5bf9def45ccdd58d4f06ca04/test_consolidated_revenue.py)
