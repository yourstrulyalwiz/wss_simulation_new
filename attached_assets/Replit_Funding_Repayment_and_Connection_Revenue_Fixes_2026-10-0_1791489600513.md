# Replit implementation instructions: funding, loan repayments and connection revenue

**Date:** 8 October 2026  
**Repository:** https://github.com/yourstrulyalwiz/wss_simulation_new  
**Reviewed revision:** `5a1d2f4` — Refactor memory policies and update deck aggregation logic  
**Deliverable:** Instructions for Replit to implement. Preparing this document has not changed application source code or saved simulation inputs.

## 1. Implement this scope

Implement these three agreed model changes, plus one UI warning:

1. Add the full entered **one-time funding injection** to ordinary available funds in its selected year, without capital-spending-share or execution-rate adjustments.
2. Activate **fixed annual utility debt-service deductions** from future ordinary funding, beginning the year after the loan injection and continuing through the loan term.
3. Make **new-connection revenue addition-only**: a decline in the coverage-based volume estimate must not subtract from the existing baseline revenue path. Preserve Basic-to-Safely-Managed transfer accounting and remove genuine NRW overlap once.
4. Warn when the **target collection rate is below the baseline rate**, and explain the percentage-entry convention.

This is a follow-on to `Replit_Revenue_Connections_NRW_Implementation_2026-10-08.md`. For this work, the instructions below supersede that earlier document wherever it requires **signed negative connection-revenue adjustments** or **deferred loan repayment accounting**. Its other revenue-source attribution and baseline-preservation requirements remain applicable. Update contradictory active documentation, comments, tests and policy notes; merely appending this document would leave conflicting instructions.

The latest reviewed public repo contains the Oct 6 DRC profiles. A profile named “DRC Simulation Oct 8” was not present at review time. Replit may inspect that development profile if it is available locally, but must not overwrite its user-entered settings or claim this document verified its exact results.

### Scope boundaries

- Apply the changes independently to water/sanitation and to each geography. National output aggregates the resulting area calculations.
- Preserve the baseline population and billed-volume growth paths, baseline tariffs and baseline collection rates.
- Keep NRW implementation costs inside signed NRW net cash. NRW can remain negative.
- Keep the current fixed revenue-source attribution: connection and NRW sales at baseline rates, collection uplift on full reconciled volume, then tariff uplift including the collection interaction.
- Retain current Basic/SM investment shares, eligible service pools, replacement priority, one-year delivery-to-revenue lag, physical NRW upgrades and household microfinance rules.
- Do not reintroduce connection operating costs, household-volume calibration inputs or historic allocation-confirmation gates.
- One-time injection is the agreed scope. Preserve the existing calculation for recurring injections and financial-commitment interventions; give their UI descriptions the correct mode-specific meaning.
- Keep utility loan proceeds as the current separate expansion-capital pool, with carryforward and ordinary expansion cash used first. They cannot pay debt service or replacement under this model.
- Do not introduce a new repayment-method selector, grace period, fees, loan-ceiling optimization or automatic affordability-based resizing. Existing legacy fields remain inactive metadata.

## 2. Current code and reasons for the changes

| Area | Current behavior and principal locations | Required change |
|---|---|---|
| One-time injection | `model/water_supply.py::sector_bau` multiplies both one-time and recurring injection amounts by `financial_capex_factor`. Sanitation calls this shared engine. | Bypass that factor only in the one-time branch. |
| Loan sizing and execution | The active `model/utility_debt.py::solve_scenario` sizes principal using a frozen no-debt revenue reference, but builds an empty schedule and zero repayment arrays. There are older schedule helpers elsewhere in the same module. | Generate the fixed-payment schedule and pass it through the active workflow. Do not accidentally reactivate the old capacity optimizer. |
| Funding deduction | `sector_bau` already computes `cash_after_debt_service = avail - debt_service_arr[t]` before replacement and expansion. The zero schedule currently makes this a no-op. | Reuse this deduction point exactly once and report its result consistently. |
| Connection revenue | `model/connection_revenue.py::annual_connection_cash` uses signed changes in weighted coverage shares. `model/revenue_reconciliation.py::reconcile_revenue` can then subtract NRW overlap from baseline volume as well as from the marginal increment. | Floor the combined candidate increment and restrict overlap deductions to that positive increment. |
| Collection target | `InterventionPanel.tsx` displays the target as a percentage and divides the typed number by 100. `RevenueBase.tsx` currently displays the shared baseline collection input as a fraction, 0–1. | Add a scoped warning and explicit entry examples without converting saved values twice. |
| Reporting | `loanFunding.ts`, `UtilityDebtPreview.tsx`, `ResultsDashboard.tsx`, `resultsLedger.ts`, `loan_reporting.py` and `deck_aggregate.py` still describe repayments as deferred. | Show modeled repayment amounts and funding after debt service throughout UI and exports. |

The negative connection-coverage effect was reproduced in the available urban Oct 6 profile: the connection-only comparison had about 48,823 fewer SM households than its all-off comparison by 2035. That is evidence of the existing negative funding feedback, not an acceptance target for the corrected model. Coverage bands are scenario-comparison effects; they are not cash-source amounts.

## 3. One-time injection: full usable funding

### Calculation

Let `I` be the entered amount in the existing local-currency millions, and `T` the selected injection year:

```text
one_time_injection[t] = I   if enabled and t == T and t > baseline_year
                       0   otherwise
```

In the non-recurring branch of `sector_bau`, replace:

```python
injection_cash[t] = amt * financial_capex_factor
```

with:

```python
injection_cash[t] = amt
```

Retain the existing timing and enablement gates and nonnegative amount handling. The baseline run must still have zero intervention injection. Do not change `financial_capex_factor` globally: financial commitments and recurring injections still use it in this scope.

The injection enters the ordinary `available_total` calculation once. It can then be used according to ordinary funding priorities, including active debt service and replacement before expansion. The full amount being available does not imply it is all spent on new household connections. Existing household/non-household capital allocation remains part of downstream service delivery.

### UI and migration

- For one-time mode, label/helper: **“One-time available funding (LCU millions). The full amount enters available funds in the selected year; capital spending share and execution rate are not applied.”** Use the actual configured currency.
- For recurring mode, retain and accurately describe its existing spending-share/execution adjustments. Do not present the one-time promise for both modes.
- Keep saved numerical amounts unchanged. Do not divide old amounts by previous factors or automatically compensate for the behavior change.
- Add an informational recalculation notice for a loaded scenario using one-time injection: its full entered amount is now used. No extra confirmation gate is needed.
- Ensure API values, Intervention Design, Results and exports all read the same injection series.

### Acceptance case

Amount = 100; capital spending share = 20%; execution rate = 80%; one-time year = 2028. The injection cash series must contain **100 in 2028**, rather than 16, and zero in other years. Changing either factor, including to zero, must not alter this injection series. It can still alter other independently modeled funding or service outcomes.

## 4. Utility debt: fixed repayments after the injection year

### 4.1 Freeze the sizing reference

Keep one no-utility-debt reference run with the selected interventions, including the corrected connection-revenue method. For a sector and area, let:

- `T`: selected reference/injection year;
- `S_T`: sum of the selected signed revenue sources in that reference year;
- `a`: selected allocation fraction;
- `A`: fixed annual debt-service amount;
- `r`: annual real interest rate;
- `n`: loan term in years;
- `P`: one-time loan principal.

```text
S_T = sum(selected reference-year source cash)
eligible_pool = max(0, S_T)
A = a * eligible_pool

P = A * [1 - (1 + r)^(-n)] / r     if r > 0
P = A * n                         if r == 0
```

Keep the numerically stable annuity-factor calculation already in `indicative_principal`.

Selected sources remain collection, tariff, NRW net/eligible sanitation-link net, and optional new-connection cash. Sum signed sources before the single pool floor. For example, selected collection = 100 and NRW net = -30 produce a pool of 70, not 100. Do not deduct the NRW implementation cost a second time.

Freeze `P` and `A` for the simulated loan. Future growth in revenues, including revenue from connections funded by the loan, affects future cash but must not resize this loan. A deliberate edit to the user's inputs triggers a fresh calculation and may change its reference and principal.

Retain the existing independent no-loan water reference used to size sanitation borrowing. Sanitation reference cash must not change merely because the water borrowing allocation changes.

### 4.2 Schedule and timing

```text
loan_disbursement[t] = P   if t == T, else 0
debt_service[t] = A        if T < t <= T + n, else 0
```

There is no repayment in `T`. The first payment is in `T+1`; the final payment is in `T+n`. All payments are annual, include principal and interest, and use the same real-currency units as the rest of the model.

For schedule reporting:

```text
opening debt at T = 0
closing debt at T = P
interest[t] = opening debt[t] * r              for repayment years
principal payment[t] = A - interest[t]
closing debt[t] = opening debt[t] - principal payment[t]
```

Use floating-point tolerance and a final residual adjustment to close the balance at zero; do not round the underlying annual payments to UI precision. At zero interest, principal payment is `A` each year. Use the stable annuity factor to avoid small-rate cancellation.

Create the schedule in the **active** `solve_scenario` path. Either implement a small fixed-allocation schedule helper or adapt `build_schedule`/`execution_plan` through a controlled configuration with zero grace, annuity repayment and maturity `T+n`. Do not let saved legacy grace/structure/ceiling fields control the new schedule.

Populate existing plan fields: `loan_amount`, `schedule`, `disbursement`, `principal_payment`, `interest_payment`, `debt_service`. Disabled borrowing, zero allocation, empty selected sources or a nonpositive selected pool must produce no loan and no payment obligations.

The loan term may extend beyond the simulation horizon. Keep the full contractual schedule through maturity, but pass only matching model-year payments to the coverage simulation. Report outstanding principal at the horizon and remaining scheduled payments. Do not assume the debt disappears at the chart end or invent future revenues beyond modeled years.

### 4.3 Deduct once from ordinary funding

Use the existing order in `sector_bau`:

```text
ordinary_before[t] = available_total[t]  # includes cash sources and ordinary injections once
ordinary_after[t] = ordinary_before[t] - debt_service[t]

replacement_reserved[t] = min(max(ordinary_after[t], 0), replacement_requirement[t])
ordinary_expansion[t] = max(ordinary_after[t] - replacement_requirement[t], 0)
expansion_capital_available[t] = ordinary_expansion[t] + restricted_loan_cash_available[t]
cash_deficit[t] = max(-ordinary_after[t], 0)
```

Reuse the actual existing coverage-stock replacement series and existing deficit/financing-gap attribution. Do not add a second repayment cost to financing requirements after its deduction has already reduced funds and generated any shortfall. Preserve existing ancillary-capital handling.

Keep `available_total` as ordinary funds **before** debt service for compatibility. Add an explicit `available_after_debt_service` output and its `scenario_` counterpart, and carry it through aggregation/export plumbing. Consumers must use this series or calculate `available_total - utility_debt_service` exactly once. `resultsLedger.ts` already performs that subtraction: replacing its input with an already-net series without removing the subtraction would double-deduct.

Keep source revenue series as receipts before financing use. A separate debt-service row explains how much is reserved from the ordinary funding total. Do not both reduce `collection_cash`/`tariff_cash`/`nrw_net`/`connection_net_cash` and subtract the same amount from the total. Source selection determines sizing; the repayment deduction occurs once at the pooled ordinary-funding level.

If future ordinary cash is insufficient, retain the scheduled payment and expose the modeled cash shortfall. Do not silently reduce the payment, manufacture revenue, use restricted loan proceeds for debt service, refinance automatically or resize the original principal. Label principal/interest as **scheduled obligations**: displaying a modeled deficit does not establish that the payment was actually made.

Continue the separate loan-proceeds identity:

```text
opening unspent proceeds + new disbursement
    = proceeds used for expansion + closing unspent proceeds
```

An unspent-proceeds balance and an outstanding-principal balance are different quantities; show and aggregate each under its own label.

### 4.4 Outputs, UI and exports

Add a clearly named full repayment schedule to the loan summary, retaining the existing `annual_injection` proceeds-use contract. For example, `repayment_schedule` contains year, opening principal, disbursement, scheduled principal, scheduled interest, total scheduled debt service and closing principal. Avoid changing the meaning of existing proceeds fields.

Expose fixed annual debt service, first repayment year, maturity year, modeled-horizon closing principal and remaining contractual obligations. In the model-year funding table show ordinary funds before debt service, repayment deduction, ordinary funds after debt service, and the existing separate proceeds balances. Values outside the simulated cash horizon must be marked unavailable for cash/coverage, rather than filled from the last model year.

Update at least:

- `frontend/src/loanFunding.ts` and migration notices;
- `frontend/src/components/UtilityDebtPreview.tsx`;
- loan controls/panel helper text and `ResultsDashboard.tsx::UtilityDebtSchedule`;
- `frontend/src/resultsLedger.ts` funding rows;
- `loan_reporting.py`, `deck_aggregate.py`, and CSV/XLSX/PPTX consumers;
- API/engine aliases and typed result interfaces where applicable.

Suggested qualification:

> Loan size uses selected additional revenue in the reference year. Fixed annual principal-and-interest obligations are deducted from ordinary available funds from the following year through maturity. Full affordability is not assessed; fees are excluded.

Set repayment metadata to a meaningful modeled state, such as `repayment_accounting: 'fixed_annuity_modeled'`. Keep `feasibility_status: 'not_assessed'` and `verified_feasible: false` unless a separate, explicitly implemented assessment supports something stronger. Remove hardcoded claims that repayment is deferred or not deducted from current recalculated results. Label historical results according to their actual metadata.

Aggregate repayment amounts and balances by calendar year across areas and sectors; do not size a new national loan from a pooled national reference or average terms/rates. Respect the existing “include loan funding” control: off excludes both proceeds and repayments, on includes both. Household microfinance remains a distinct calculation.

### 4.5 Numeric acceptance cases

**Fixed annuity:** selected pool 100, allocation 20%, rate 5%, term 10, injection year 2028:

| Item | Expected amount, model currency millions |
|---|---:|
| Fixed annual debt service | 20 |
| Principal injected in 2028 | 154.434698584 |
| Debt service in 2028 | 0 |
| Debt service in every year 2029–2038 | 20 |
| Debt service from 2039 onward | 0 |
| First payment: interest | 7.721734929 |
| First payment: principal | 12.278265071 |
| Principal balance after first payment | 142.156433513 |
| Principal balance after final payment | 0, within tolerance |

**Changing future revenue:** with the same loan, future selected-source receipts of 130 still leave `130 - 20 = 110` from those receipts after the repayment allocation, before other funds/obligations. Do not allocate 20% of 130 and increase payment to 26. A lower future source amount does not reduce the fixed payment either.

**Zero interest:** `A=20`, `n=10`, `r=0` gives `P=200`, followed by ten payments of 20.

**Funding order:** ordinary funds 100, scheduled debt service 20, replacement requirement 30, opening restricted proceeds 40 and no new disbursement give ordinary funds after service 80, ordinary expansion funds 50 and total expansion funds 90. If actual expansion costs 70, use 50 ordinary plus 20 loan proceeds; close restricted proceeds at 20.

**Deficit:** ordinary funds 10 and service 20 give ordinary net cash -10 and a cash deficit of 10. Keep the separate unpaid replacement obligation under the existing ledger rules; do not count the repayment or cash deficit twice.

## 5. New-connection revenue: addition-only after overlap accounting

### 5.1 Preserve the existing coverage-based estimator

For each sector/area and revenue year `t`, retain:

- `B[t]`: the untouched exogenous baseline billed-volume path;
- `sBasic0`, `sSM0`: baseline-year shares; `S0 = sBasic0 + sSM0`;
- `sBasic[t-1]`, `sSM[t-1]`: delivered prior-year coverage, using that same prior year's household denominator;
- `fBasic`, `fSM`: the existing marginal billing-share inputs;
- `p0`, `c0`: shared baseline tariff and collection rate.

Compute the combined signed candidate before any floor:

```text
signed_scale[t] = (
    fBasic * (sBasic[t-1] - sBasic0)
  + fSM    * (sSM[t-1]    - sSM0)
) / S0

signed_candidate_volume[t] = B[t] * signed_scale[t]
positive_candidate_volume[t] = max(0, signed_candidate_volume[t])
```

Do not floor the Basic and SM terms separately. Otherwise a Basic-to-SM transfer would create false additional volume when the two billing percentages are equal. Preserve the existing baseline/history gates and validation for zero baseline coverage, missing billing shares and invalid inputs.

This retains the agreed definition of marginal **coverage expansion**. Some physical new connections can occur without positive qualifying revenue if population growth still leaves weighted coverage below its baseline level. The correction prevents a negative adjustment; it does not change the feature into a count of every gross physical connection.

### 5.2 Remove overlap only from the positive increment

Let `eligible_overlap[t]` be the existing, properly tagged and volume-bounded overlap with NRW-derived sales or explicitly linked sanitation volume. Let `W[t]` be independently eligible NRW sales volume (or the sector's eligible sanitation-link volume).

```text
O[t] = min(positive_candidate_volume[t], eligible_overlap[t])
N[t] = positive_candidate_volume[t] - O[t]
V[t] = B[t] + N[t] + W[t]
connection_cash[t] = N[t] * p0 * c0
```

`N[t] >= 0` and the baseline component `B[t]` stays intact. A candidate overlap can remove only duplicated new-connection volume. It cannot consume baseline volume merely because the modeled marginal increment is small or zero.

Implement this as a coordinated change across `annual_connection_cash`, the annual reconciliation block in `sector_bau`, and `reconcile_revenue`. Supply `raw = B + positive_candidate_volume` and an overlap bounded by `raw - reference`, rather than only by `raw`. Add an invariant or explicit validation at the shared reconciliation boundary so another call path cannot reintroduce a negative connection increment.

Keep independent overlap-eligibility validation: nonnegative finite input, genuine origin tags, and existing water/sanitation volume caps. An invalid overlap larger than its eligible NRW/link source must still be rejected. After those eligibility checks, cap its *applied connection deduction* to the positive marginal volume, and expose any unapplied candidate overlap as a diagnostic if needed. Cap the combined applied deduction across sources; two overlap deductions must not each spend the same increment.

When connections are off or there is no qualifying positive increment, apply zero overlap against the connection increment. NRW can still have eligible independent receipts and costs. Preserve avoided-production-cost mode: its valid overlap adjustment also cannot reduce the baseline, and that mode still adds no NRW tariff-sale receipts. Preserve the existing `household_only` compatibility behavior and tagged source eligibility without introducing a household split into the default aggregate revenue model.

### 5.3 Reconcile all sources against the corrected volume

At scenario tariff `p[t]` and collection rate `c[t]`:

```text
connection_cash = N * p0 * c0
NRW_net         = W * p0 * c0 + avoided_cost_cash - NRW_implementation_cost
collection_cash = V * p0 * (c - c0)
tariff_cash     = V * (p - p0) * c

additional_net_cash
    = connection_cash + NRW_net + collection_cash + tariff_cash
    = V * p * c - B * p0 * c0 + avoided_cost_cash - NRW_implementation_cost
```

For sanitation, use the existing eligible-link source attribution and avoid adding its alias again. Operating-cost compatibility outputs remain zero. NRW net, tariff changes and collection changes can still be signed; only the new-connection addition is subject to this new rule.

Do not clamp `connection_net_cash` after the old reconciliation while leaving negative volume or other source series unchanged. All receipts, reform uplifts, eligible loan sources and funding must use the same corrected `V` and retain the accounting identity above.

Keep diagnostic separation between the signed candidate and the applied addition. Suggested additions are `connection_signed_scale`, `connection_signed_candidate_volume_million_m3` and `connection_addition_only_adjustment_million_m3 = positive_candidate_volume - signed_candidate_volume`. Existing raw/applied volume fields must match the volumes actually used by the revised reconciliation. Diagnostic adjustments are not separate cash sources.

### 5.4 UI and charts

Add this concise explanation to the connection-revenue section:

> Adds revenue from positive marginal coverage expansion at baseline tariff and collection rates. If weighted coverage falls below baseline, this feature adds zero; it does not deduct baseline revenue. Receipts begin one year after delivery.

Preserve the two billing-share inputs and the optional source note. State that transfers use the difference between Basic and SM billing percentages. No additional user inputs or confirmation checkboxes are required.

Use corrected source series in Intervention Design, Results, loan-source selection and exports. Keep source-cash charts distinct from marginal household-effect charts. Recalculate all cumulative comparison passes with the new rule; do not mask negative bars with a frontend `max(0, value)`.

This correction does not imply that every Basic-only coverage band must be positive. Basic households can still move to SM, population denominators can change, and repayment/infrastructure obligations can affect later outcomes. No change to service-transition accounting or the user's 50/50 allocation is authorized here.

### 5.5 Numeric acceptance cases

Use annual volume units consistently; these examples use arbitrary matching units.

| Baseline B | Signed candidate | Valid eligible overlap | NRW sales W | Applied connection N | Final billed volume V |
|---:|---:|---:|---:|---:|---:|
| 100 | -10 | 8 | 15 | 0 | 115 |
| 100 | 20 | 30 | 30 | 0 | 130 |
| 100 | 20 | 5 | 15 | 15 | 130 |
| 100 | 0 | 0 | 0 | 0 | 100 |

For the third row, with `p0=2`, `c0=0.7`, `p=3`, `c=0.9`, NRW cost `K=5` and no avoided costs:

```text
connection cash = 21
NRW net = 16
collection uplift = 52
tariff uplift = 117
total additional cash = 206
identity check = 130 * 3 * 0.9 - 100 * 2 * 0.7 - 5 = 206
```

Also verify:

- Equal Basic/SM billing shares and a pure Basic-to-SM transfer produce zero incremental volume.
- Unequal shares use the combined signed transfer difference before the total floor.
- Population-only growth with unchanged coverage shares produces zero connection addition.
- Falling weighted coverage produces zero connection addition even if gross household counts rose.
- A transition from positive qualifying expansion to below-baseline coverage removes the prior modeled addition prospectively but never subtracts baseline revenue.
- Delivery in year `u` first affects receipts in `u+1`; use `H[u]` for its coverage denominator.
- NRW implementation cost remains in NRW net; negative NRW must still reduce available funds and the selected debt-sizing pool.

## 6. Collection-rate warning and percentage clarity

Add a non-blocking warning for the active area and sector when collection improvement is enabled and both valid rates are available but `target < baseline`.

Use the authoritative resolved shared revenue base, not a stale `ce_current_ratio` legacy field. For unresolved legacy bases, resolve through the existing revenue-base workflow before comparing. Do not substitute zero for a missing rate.

Example warning:

> Rural water: the target collection rate is 0.9%, below the baseline of 70%. This will reduce collected revenue. If you intend 90%, enter 90 in the target percentage field.

Near the target field show **“Enter 90 for 90%.”** Near the shared baseline fraction input, clarify **“0.70 means 70%.”** Keep its existing labeled 0–1 storage/input contract in this scoped change. UI percentages remain stored as fractions; do not divide them twice or automatically reinterpret a saved 0.009 as 0.9.

- Warning uses that area's water/sanitation values and updates on edits.
- Equality is neutral; a higher target is improvement; neither gets the below-baseline warning.
- A deliberate valid reduction remains calculable and produces signed revenue. No blocking acknowledgement checkbox or new save gate.
- Invalid rates outside 0–100%, nonfinite values and required missing values retain ordinary input validation, distinct from the warning.
- Preserve saved values. Do not silently correct the DRC rural target or copy the urban rate into rural inputs.

At the reviewed revision, the available mock profile's rural target is approximately `0.009` against baseline `0.70`. That is a useful warning fixture, not permission to edit that profile.

## 7. Versioning, compatibility and implementation sequence

Use explicit metadata so old outputs are not relabeled as corrected calculations. Suggested versions: connection configuration **5**, revenue reconciliation **4**, utility-debt configuration/summary **3**. Apply these consistently if used; never bump one producer while leaving readers pinned to an earlier version.

- Update Python and frontend migrations together. Preserve enabled flags, explicit zeros, cleared required fields, billing shares, selected sources, loan dates/term/rate/allocation and inactive legacy metadata.
- Existing connection versions 1–4 migrate to the new calculation without reviving obsolete cost/reference gates. Do not change lower-level revenue integration switches blindly; inspect their role separately from output metadata.
- Existing loan schema 2 inputs retain their values and acquire active fixed repayment accounting on recalculation. Retain `indicative_lump_sum` mode to minimize unnecessary schema changes.
- Include a concise informational notice that funding/coverage results can change because repayment deductions and addition-only connection revenue are now applied. Recalculation must be available without confirmation gates.
- Update equality checks such as `RevenueSourceChart.tsx`'s reconciliation `=== 3`, NRW diagnostics, frontend test expectations, engine metadata and export qualification handling. Old cached results remain labeled legacy until recalculated.
- Do not overwrite imported legacy metadata with an inaccurate new notice. Preserve it for provenance while showing the current behavior notice separately or clearly updating the active explanatory text.

Recommended sequence:

1. Implement and test the addition-only volume reconciliation, including water and sanitation overlap paths.
2. Change one-time injection treatment and mode-specific UI help.
3. Implement the fixed debt schedule using the corrected, frozen no-debt reference, then verify the existing deduction point.
4. Add the explicit net-funding output and update aggregation, funding tables, loan schedule views and exports together.
5. Add collection warnings and migration/version updates.
6. Run focused tests, build the frontend and check the affected screens with saved inputs. Report any remaining issue rather than changing unrelated model logic.

## 8. Required validation before completion

### Engine/accounting checks

- Full one-time injection in both water and sanitation; exactly one injection year; off means zero; recurring and financial-commitment behavior unchanged.
- Annuity and zero-interest schedules, first payment `T+1`, last payment `T+n`, no payments after maturity, and remaining debt visible when maturity exceeds the simulation horizon.
- Disabled/zero/empty/nonpositive loan cases have no proceeds or obligations; incomplete selected source inputs retain clear validation.
- Freeze loan sizing against the no-debt reference. Future source growth and loan-funded expansion must not trigger iterative resizing. Cross-sector sanitation reference remains independent of water borrowing allocation.
- Principal repaid sums to original principal within tolerance; interest plus principal equals each scheduled debt-service amount.
- Repayment lowers ordinary funding once; source receipts remain intact; deficit and replacement shortfalls are not duplicated; restricted proceeds satisfy their separate balance identity.
- Check per-area schedules with different start years and terms, then national calendar-year aggregation and currency conversion.
- Addition-only/overlap examples and source reconciliation identity in section 5 pass for all relevant combinations of connections, NRW, collection and tariff toggles, including connection-off and avoided-cost modes.
- Baseline calculation remains invariant when only intervention settings change. The all-off comparator does not activate connection revenue or borrowing.

### UI/export checks

- Enter target **90**: store **0.9** and display **90%**. Enter **0.9**: store **0.009**, display **0.9%**, and show the below-baseline warning when appropriate.
- Confirm area and sector switching does not leak values/warnings, overwrite assumptions or reset allocation shares.
- Verify Intervention Design and Results use consistent geographic scope and corrected source cash. Household comparison charts use actual recalculations, including any valid negative service effects.
- Loan preview and Results show the fixed annual commitment, repayment years, principal/interest schedule, funding after repayment, and distinct outstanding debt/unspent proceeds balances.
- Include-loan on/off controls switch both proceeds and repayment effects. Source revenue graphs remain receipts, with debt use shown separately.
- Inspect CSV/XLSX/PPTX loan tables and national rollups for repayment amounts and current qualifications; remove obsolete “repayments not modeled” assertions for new results.
- Save/reload keeps user inputs, explicit zeros and disabled flags; migration is idempotent and does not reactivate obsolete settings.

Extend the existing targeted tests: `test_exogenous_injection.py`, `test_indicative_loans.py`, `test_debt_servicing.py`, `test_utility_debt_sources.py`, `test_aggregate_revenue.py`, `test_connection_revenue.py` and `test_consolidated_revenue.py`, plus the related frontend loan/revenue/ledger tests. Some tests explicitly assert an empty repayment schedule or deferred accounting; replace those obsolete assertions with schedule and funding identities rather than deleting coverage. Keep legacy-helper tests distinct from the active workflow.

Use the project's installed dependencies and run the frontend build (`npm run build` from `frontend`). Do not describe pre-change tests or arithmetic checks in this instruction document as proof that the implementation is finished. The handoff author checked current source paths and the numeric examples; Replit must run the implementation checks after making the changes.

## 9. Completion report requested from Replit

Report the changed calculation/UI paths, tests run and results, migration behavior, and any unresolved limitation. Include one compact loan example demonstrating the injection and subsequent deductions, and one connection example demonstrating a negative candidate becoming a zero addition while the revenue identity still reconciles.

If the Oct 8 development simulation is available, report its actual per-area collection targets and Basic allocations without changing them. Explain any remaining Basic-only decline with the annual lower-to-Basic inflow, Basic-to-SM outflow and population denominator. That review is diagnostic; it does not authorize changes to transition rules, target shares, saved rates or Basic/SM allocations.

