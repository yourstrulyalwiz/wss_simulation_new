# WSS Simulation Tool — remaining programming instructions

**Prepared:** 13 October 2026  
**Repository:** [yourstrulyalwiz/wss_simulation_new](https://github.com/yourstrulyalwiz/wss_simulation_new)  
**Code reviewed:** [f953690bc91bc0cf92c2b51ab2dc91f5a7756460](https://github.com/yourstrulyalwiz/wss_simulation_new/commit/f953690bc91bc0cf92c2b51ab2dc91f5a7756460), committed 12 October 2026  
**Purpose:** A bounded implementation handoff for Replit. Preparing this document does not change the application.

## 1. Implementation brief

Implement these three blocks together:

1. **Public spending:** continue annual percentage increases through the chosen end year, then maintain the achieved executed-spending share of GDP through the remaining simulation years. Apply the capital share only when the input spending series represents total spending.
2. **Dynamic annual volume and revenue:** calculate each scenario's annual billed-volume base, `V_t`, from its delivered service coverage, independently of whether new-connection receipts are admitted as financing. Reconcile collection efficiency, tariff reform, NRW and linked sanitation revenue on consistent volumes, without double counting.
3. **Loan funding and comparisons:** size each loan from the dynamic no-loan reference, run the financed scenario with its own evolving coverage and revenue, and use the resulting paired outputs consistently in coverage comparisons, charts and exports.

Use the existing annual simulation, revenue reconciliation and source-attribution machinery. Make the smallest changes needed to connect them correctly. Do not build a new optimization model, a new customer-cohort model, an iterative same-year solver or a new causal-attribution framework.

**The central interaction is:**

> Financing and other interventions change delivered service; delivered service changes the following year's billable volume; that volume changes intervention revenue; admitted revenue changes investment and loan capacity.

Public spending must therefore influence collection efficiency through services delivered and billable volume. Do not multiply collection revenue directly by public spending or add public spending itself to `V_t`.

### Scope boundaries

- Preserve the existing units, real-GDP series, baseline calibration, service-transition rules, replacement logic, intervention schedules and loan amortization convention except where this document explicitly changes their connection.
- Preserve pure BAU as an independent counterfactual. Do not activate new-connection financing in BAU.
- Preserve the current addition-only connection-volume convention and the existing one-year service-to-revenue lag.
- Preserve signed reform cash flows and signed loan comparison results.
- Preserve existing tariff-sales versus avoided-cost NRW modes and the water-to-sanitation link.
- **Keep the current signed net-NRW cash rule for loan eligibility.** Switching eligibility to recurring/gross NRW benefits is a separate policy decision and is not part of this patch.
- Do not reactivate connection operating costs, introduce demand elasticity, invent missing calibration values, change loan restrictions or change affordability/self-finance policy.
- Do not rewrite saved profiles or overwrite user inputs as part of migration.
- If the branch has moved since the reviewed commit, inspect the equivalent active functions before implementing; do not overwrite intervening work.

## 2. What the code already does, and what remains

| Area | Reviewed behavior | Required change |
|---|---|---|
| Annual spending increase | Adds a compounded increment only inside the start/end window; the increment disappears afterwards. | Hold the achieved growth-option spending/GDP share after the end year. |
| Spending basis | The entered-budget path already uses capital share only for total-spending inputs. | Preserve and apply that same rule to both public-spending options and their continuation. |
| Connection volume | The aggregate coverage-expansion calculation exists, but `prepare_connection` returns no runtime when its revenue-funding switch is off. | Separate physical volume calculation from admitting its direct receipts as funding. |
| CE and tariff | Already reconcile on a common volume when that volume is supplied. | Supply each year's dynamic scenario volume even when connection funding is off. |
| NRW | Recovery and works cost are precomputed from an exogenous system-input path. | Calculate them inside the annual loop using the limited dynamic-throughput convention in section 4.5. |
| Source attribution | Combined-run source funding and coverage attribution already exist. | Keep these authoritative; remove remaining use of ordered/no-loan passes for canonical source amounts. |
| Loan engine | Already sizes once from a no-loan reference and reruns the financed scenario. | Feed both passes the corrected dynamic model and preserve their independence. |
| Loan coverage UI | Makes an additional no-loan request even though paired results are embedded in the main response. | Read the paired fields from one response and handle missing/stale data explicitly. |
| Export resource rows | Some revenue rows read `passes[-1]`, the no-loan cumulative pass, while coverage uses the actual combined scenario. | Read consistent combined-scenario cash and coverage. |

## 3. Block 1 — annual percentage increase in public spending

### 3.1 Definitions and input basis

Use the existing resolved spending and GDP series:

- `E_BAU[t]`: BAU **executed** public spending in year `t`, on the basis selected in the inputs.
- `A_BAU[t]`: corresponding allocated spending, using the existing effective-allocation handling.
- `GDP[t]`: the model's real local-currency GDP.
- `r`: annual increase as a decimal; 10% is `0.10`.
- `gs` and `ge`: start and end years, inclusive.
- `s_target`: the separate target executed-spending share of GDP, as a decimal.
- `k`: capital conversion factor.

Define:

~~~text
k = budget_capital_share, if the entered spending is TOTAL spending
k = 1,                    if the entered spending is CAPITAL spending
~~~

An input explicitly marked capital spending must not be multiplied by the capital share again, even if a previous slider value is still stored.

The target's basis follows the input basis: total executed spending if total spending was entered; executed capital spending if capital spending was entered. Apply the same interpretation to the growth option.

Continue using `budget_forecast.py` for BAU forecasts and supplied future overrides. Do not replace that forecast with a new budget projection.

### 3.2 During the increase period

Retain the current compounding interpretation:

~~~text
growth_extra[t] = 0                                      before gs

growth_extra[t] =
    max(0, E_BAU[t] * ((1 + r) ** (year[t] - gs + 1) - 1))
                                                        from gs through ge
~~~

The start year receives the first increase. A 2028–2030 window therefore contains three increases.

This is a cumulative uplift over the same year's BAU executed-spending path. It is not a promise that the currency amount grows by exactly `r` independently of GDP and the BAU forecast. Make the explanatory text consistent with this retained interpretation.

Keep the existing forecast gate: intervention cash is not added to historical years. Preserve the calendar-year exponent if a valid start year precedes the first forecast year; do not silently reset it.

### 3.3 After the increase period

For a positive rate and an end year reached in the modeled forecast, calculate the share achieved by the **growth option alone**, before additional execution-efficiency gains:

~~~text
n = ge - gs + 1

s_hold = E_BAU[ge] * (1 + r) ** n / GDP[ge]

growth_extra[t] = max(0, s_hold * GDP[t] - E_BAU[t])
                                                        for year[t] > ge
~~~

Consequences:

- Additional compounding stops at `ge`.
- The growth-option executed-spending path then follows GDP at the achieved share.
- If real GDP grows 5%, the maintained spending amount also grows 5%, while its GDP share stays constant.
- If BAU spending later exceeds that floor, the intervention adds zero; it must not cut BAU spending.
- Do not merely freeze the multiplier on future BAU spending. That would allow the intended GDP share to drift when the BAU share changes.
- Do not freeze the currency amount.
- Do not include the separate GDP-target option or execution-efficiency improvements in `s_hold`.

Edge cases:

- A zero growth rate must remain a no-op; it must not create a post-window top-up just because BAU shares later fall.
- An end year after the simulation requires no post-window continuation inside the simulation.
- Do not infer an achieved intervention target from an entirely historical/unmodeled increase window. Preserve historical observations and existing calendar validation.
- Preserve meaningful input errors for invalid years, non-finite rates, missing required GDP or invalid execution calibration.

### 3.4 Keep the two public-spending options consistent

The separate increase-to-GDP-target option remains:

~~~text
target_extra[t] = max(0, s_target * GDP[t] - E_BAU[t])
                 from its start year onwards

extra_executed[t] = growth_extra[t] + target_extra[t]
financial_cash[t] = k * extra_executed[t]
~~~

The current options are additive when both are enabled. Preserve that behavior for this patch. Do not introduce a maximum-of-two rule or new exclusivity control.

Because they are additive, a combined run need not equal either standalone target share. The post-growth hold must not capture both options and then add the GDP-target contribution again.

### 3.5 Preserve execution-efficiency attribution

For entered executed spending, `financial_cash` is already an executed capital amount. Do not multiply it by baseline execution efficiency a second time.

Using the existing year-specific baseline execution ratio `e0[t]` and intervention ratio `e[t]`:

~~~text
additional_allocation_capital[t] = financial_cash[t] / e0[t]

expanded_budget_execution_gain[t] =
    additional_allocation_capital[t] * (e[t] - e0[t])

budget_execution_cash[t] =
    execution gain on existing allocated capital
    + expanded_budget_execution_gain[t]
~~~

Keep the existing validation for positive additional spending with invalid/zero baseline execution calibration.

Attribute:

- The extra executed commitment at baseline execution to `financial`.
- Improvements from better execution, including execution of the expanded allocation, to `budget_execution`.

For example, with BAU executed spending of 1% of GDP, baseline execution of 20%, a standalone executed-spending target of 2%, and improved execution of 40%, total executed spending becomes 4% of GDP before any total-to-capital conversion. The source split is 1% BAU, 1% financial commitment and 2% execution gain. Apply `k` once if the inputs represent total spending.

Thus a held public-spending share does not cap additional execution-efficiency benefits.

### 3.6 Numerical acceptance example

Assume the BAU executed-spending share is a constant **0.0286% of GDP**, and annual growth is 10% during 2028–2030.

| Year | Growth-option executed spending / GDP |
|---|---:|
| 2027 | 0.0286000% |
| 2028 | 0.0314600% |
| 2029 | 0.0346060% |
| 2030 | 0.0380666% |
| 2031 onward | 0.0380666%, unless BAU itself exceeds the floor |

This example excludes the separate GDP-target option and execution improvements. The current post-2030 reversion to 0.0286% is the defect to remove.

### 3.7 Code and UI work

Primary locations:

- `model/water_supply.py`: shared `_cash_loop`, financial-commitment arrays, capital conversion and execution interaction.
- `model/sanitation.py`: verify the same shared behavior and sanitation parameters.
- `model/budget_forecast.py`: preserve forecast behavior; change only if a concrete integration defect requires it.
- `demo_adapter.py` and `model/inputs.py`: preserve total-versus-capital flags and decimal conversions.
- `frontend/src/components/InterventionPanel.tsx` and `InputPanel.tsx`: clarify the spending basis and end-year meaning.

Suggested end-year help text:

> Annual increases stop in this year. The achieved executed-spending share of GDP is maintained afterwards.

Label results clearly enough to distinguish the public-spending commitment from the extra gain due to execution improvement.

## 4. Block 2 — dynamic V_t and consistent intervention revenue

### 4.1 Separate volume from admitting connection receipts

The physical billing calculation and the funding switch answer different questions:

| Quantity | Meaning | Controlled by connection-funding switch? |
|---|---|---|
| Additional billable volume | Volume associated with delivered service expansion | No |
| Generated connection receipts | Additional volume valued at baseline tariff and collection | No |
| Connection cash admitted to investment/loan funding | The part of those receipts the model allows to finance investments | Yes |
| CE and tariff increments | Reform gains on the reconciled annual volume | Their own switches and schedules |

When valid calibration is available, compute dynamic volume for the intervention scenario even if new-connection funding is off.

The connection-funding switch may change future coverage by changing reinvestment. Therefore later volumes may diverge between runs. What must remain identical is the volume calculation for **identical opening service stocks and calibration**.

Preserve pure BAU funding and coverage and its existing exogenous reference volume. A no-loan intervention scenario is not pure BAU: it retains all selected non-loan interventions and uses their dynamic service path.

### 4.2 Preserve the existing aggregate coverage-expansion formula

Use the current lightweight calculation, rather than introducing household cohorts or a new demand model.

Definitions:

- `B[t]`: exogenous reference billed volume from the shared calibrated revenue base, including its existing population/fixed-growth rule.
- `H[t-1]`: prior-year total households.
- `Basic[t-1]` and `SM[t-1]`: actual prior-year delivered service stocks in the relevant scenario.
- `b0` and `s0`: baseline Basic-only and Safely Managed coverage shares.
- `f_basic` and `f_sm`: existing additional-billed-share parameters.

~~~text
signed_scale[t] =
    (f_basic * (Basic[t-1] / H[t-1] - b0)
     + f_sm * (SM[t-1] / H[t-1] - s0))
    / (b0 + s0)

N_raw[t] = max(0, B[t] * signed_scale[t])
~~~

Keep the positive floor **after combining** the Basic and SM changes. Flooring each band separately would incorrectly count Basic-to-SM transfers.

Using coverage shares avoids counting population growth again when `B[t]` already includes it. Preserve the existing parameters, their units and their calibration; do not replace the denominator with a newly weighted baseline.

After existing NRW/link overlap reconciliation:

~~~text
N_net[t] = N_raw[t] - O[t]
V[t]     = B[t] + N_net[t] + W[t]
~~~

Here:

- `O[t]` is the eligible tagged overlap, capped at `N_raw[t]`.
- `W[t]` is additional NRW/linked volume admitted as billed sales under the selected valuation and sales modes.
- Physical NRW recovery is not automatically all billed sales in every mode.

Do not add another volume term merely because the source of a funded connection was public spending, a loan or an injection. That service stock is already included.

### 4.3 Which channels can affect volume?

| Channel | How it affects the following year's billing base |
|---|---|
| BAU/public capital and additional public spending | Funds delivered Basic entries or SM upgrades. |
| Better budget execution | Makes more of the allocated capital available for services. |
| External injections and eligible custom funding | Finances additional delivered services. |
| Unit-cost reductions and technology optimization | Changes services delivered per unit of funding. |
| CE, tariff and admitted connection revenue | Reinvestment funds additional services. |
| Loan funding | Brings investment forward; repayments and replacement needs also affect the subsequent path. |
| NRW | Changes recovery/sales and directly supports physical upgrades, with explicit overlap removal. |
| Water-to-sanitation NRW link | Changes the eligible sanitation billing/revenue path. |
| Microfinance and means-based grants | Adds actual delivered services through their existing pathways. |

Only actual modeled service delivery enters the volume calculation. Preserve the current treatment of self-finance as an affordability exclusion where it is not counted as delivered utility service. Do not convert that exclusion into new service stock in this patch.

An intervention need not increase `V_t` in every test case: there may be no eligible households, insufficient funds after obligations, unchanged weighted coverage, or an addition-only floor. Test the interaction using a case with genuine service expansion and available headroom.

### 4.4 Apply a single revenue identity

For each year use:

- `p0` and `c0`: shared baseline tariff and collection ratio.
- `p[t]` and `c[t]`: current tariff and collection ratio after their existing schedules.
- `I_conn`: 1 if connection receipts are admitted as funding, otherwise 0.

~~~text
connection_generated[t] = N_net[t] * p0 * c0
connection_available[t] = I_conn * connection_generated[t]
connection_excluded[t]  = (1 - I_conn) * connection_generated[t]

collection_cash[t] = V[t] * p0 * (c[t] - c0)
tariff_cash[t]     = V[t] * (p[t] - p0) * c[t]

nrw_sales_cash[t] = W[t] * p0 * c0
nrw_net[t] = nrw_sales_cash[t]
             + avoided_cost_cash[t]
             - implementation_cost[t]
~~~

Connection/NRW operating-cost compatibility fields remain inactive at zero.

The gross collected-revenue identity is:

~~~text
V[t] * p[t] * c[t] - B[t] * p0 * c0
    = connection_generated[t]
      + collection_cash[t]
      + tariff_cash[t]
      + nrw_sales_cash[t]
~~~

The cash admitted for utility-related financing is:

~~~text
admitted_utility_increment[t]
    = connection_available[t]
      + collection_cash[t]
      + tariff_cash[t]
      + nrw_net[t]

    = collected_revenue[t] - reference_collected_revenue[t]
      - connection_excluded[t]
      + avoided_cost_cash[t] - implementation_cost[t]
~~~

For sanitation, retain the existing separate linked-NRW ledger and count the corresponding net cash once. The equations express the consolidated identity, not permission to add the same linked cash under both `nrw` and `nrw_link`.

Do not add the full baseline utility revenue to available capital. It remains a reference/comparison quantity; only the defined incremental sources enter financing.

Preserve signed differences if a reform reduces a rate. Do not add positivity clipping to collection or tariff cash.

**Attribution convention:** connections and NRW sales are valued at baseline rates; CE is valued at baseline tariff; tariff reform uses the current collection ratio. The CE–tariff interaction therefore belongs to tariff under this fixed convention. This is reproducible accounting attribution, not a claim of unique causal ownership.

### 4.5 Make NRW throughput respond without a new hydraulic model

The current NRW system-input series is separately calibrated from the billed-volume base. Do not assume those two anchors are interchangeable.

For this limited patch, use the following **explicit modeling assumption**:

> System input grows proportionally with the existing coverage-driven billable-expansion index, after excluding the part attributable to NRW's own direct physical upgrades.

This is a proxy using existing inputs, not a hydraulic estimate. Document it in the model explanation.

Definitions:

- `Q_exo[t]`: existing annual NRW system-input path, retaining its anchor and population/fixed-growth rule.
- `T_nrw[t]`: existing volume proxy from retained prior NRW-origin households, computed by `tagged_nrw_volume`.
- `N_raw[t]`: aggregate expansion from section 4.2.

~~~text
non_nrw_expansion[t] =
    max(0, N_raw[t] - min(N_raw[t], T_nrw[t]))

throughput_scale[t] =
    1 + non_nrw_expansion[t] / B[t]        when B[t] > 0

Q_dynamic[t] = Q_exo[t] * throughput_scale[t]
~~~

When `B[t]` and its implied expansion are zero, there is no inferred expansion multiplier; retain the original throughput path. A nonzero expansion paired with an invalid/zero denominator is a calibration error, not a reason to invent a conversion.

Important distinctions:

- The tag subtraction above prevents NRW's direct physical upgrades from automatically enlarging the system on which their own recovery is calculated.
- Revenue overlap `O[t]` still follows the existing valuation/sales/link rules. It is not replaced wholesale by this throughput tag subtraction.
- Service expansion funded later by reinvested NRW cash may legitimately affect future throughput through its actual delivered service stock.
- Keep the independently entered system-input anchor. Do not replace it with `B[t] / (1 - NRW_current)`.
- Do not multiply population growth twice.
- Zero/missing system input must not fabricate recovered water. Keep zero recovery and surface the missing calibration in the relevant status/help text.

Move recovery and implementation-cost calculations into the annual loop, after the prior-service expansion is known:

~~~text
recovered_volume[t] =
    lagged_nrw_reduction[t] * Q_dynamic[t]

physical_recovery[t] =
    physical_loss_share * recovered_volume[t]

required_works_capacity[t] =
    current_nrw_reduction[t] * Q_dynamic_per_day[t]

implementation_cost[t] =
    unit_works_cost
    * max(0, required_works_capacity[t] - required_works_capacity[t-1])
    / 1_000_000
~~~

Retain the existing reduction ramp and benefit lag: works costs use the current reduction, while benefits use the lagged reduction. Retain the current convention of applying that lagged reduction to the revenue year's system input.

Use the previous **dynamic** works capacity in the cost difference. With growing throughput, further works costs may be necessary even after the NRW rate target has been reached; this follows the existing capacity-cost formulation.

Preserve physical-upgrade eligibility limits and actual delivered NRW-origin tracking. Feed matching water recovery into the matching sanitation scenario. Maintain existing tariff-sales, household-only-sales, avoided-cost and link-overlap treatments.

### 4.6 Annual calculation order

Use one deterministic yearly calculation for each scenario:

1. Read opening/prior-year service stocks and retained delivery-origin tags.
2. Compute the exogenous reference volume and aggregate service-expansion volume.
3. Compute dynamic NRW throughput, recovery, works costs and eligible linked volumes.
4. Reconcile overlaps and calculate `V[t]`.
5. Calculate CE, tariff, NRW and generated connection receipts; apply the connection funding gate.
6. Assemble ordinary funding from its signed source contributions.
7. Apply the existing source allocation: **loss absorption, selected-source debt service, pooled replacement, then expansion**.
8. Allocate ordinary and restricted loan investment using the existing purchase rules; apply physical upgrades and affordability pathways.
9. Store closing service stocks, source attribution and loan cash balances for the next year.

Do not iterate same-year receipts against the connections they purchase. The existing prior-year-stock rule provides the needed lag and prevents a same-year circular calculation.

### 4.7 Field semantics, validation and UI consistency

Update the smallest set of fields and consumers needed to distinguish volume, generated receipts and available cash.

| Output/consumer | Required meaning |
|---|---|
| `billed_volume_million_m3` | Full reconciled dynamic `V[t]` in the intervention scenario. |
| `connection_revenue_delta` | Generated baseline-rate connection receipts, even when excluded from financing. |
| `connection_net_cash`, `connections_cash` and funding-facing `connection_revenue_cash` | Admitted connection funding; zero when the funding switch is off. |
| Explicit excluded-receipts diagnostic | Difference between generated and admitted connection receipts. |
| `additional_collected_revenue` | Gross increase in collected receipts; includes generated receipts. |
| `additional_net_cash` / eligible funding totals | Admitted cash, including the exclusion adjustment and existing NRW costs. |
| Source-funding and loan inputs | Admitted cash only. |
| Volume-mode metadata | Dynamic calculation status independent of whether connection funding is on. |

Keep aliases internally consistent. A UI/export fallback must not resurrect excluded connection funding by reading a generated-revenue field.

Canonical switch precedence must match the backend: an explicit sector connection toggle overrides configuration `enabled`; configuration applies only when that toggle is absent. Fix contradictory frontend interpretation in `interventionRegistry.ts` and related state/migration code.

Revise `prepare_connection` so a funding-off switch does not skip valid volume calibration. Validate the existing billing weights whenever a dependent dynamic calculation needs them. Do not silently substitute 100%, invent missing fees, or report an exogenous fallback as a successful dynamic calculation. Existing baseline/budget-only outputs may remain available, but affected dynamic revenue and borrowing results must be clearly incomplete until required calibration is supplied.

Separate the displayed concepts, for example:

- “Billing volume: dynamic from delivered coverage”
- “New-connection receipts used for funding: off”

Do not label the entire scenario “exogenous” merely because the funding switch is off. Preserve user-entered values and existing legacy metadata; make migrations idempotent. If result semantics require a version marker, update both backend and frontend interpretation without arbitrarily rewriting input versions.

Update misleading comments that still say volume never responds to new connections.

### 4.8 Keep source attribution order independent

Use the actual combined-run `scenario_source_funding` and `scenario_coverage_attribution` as the authoritative ledgers.

| Effect | Attribution |
|---|---|
| Extra public executed commitment | `financial` |
| Gain from execution improvement on existing and expanded allocation | `budget_execution` |
| Admitted connection receipts | `connections` |
| CE receipts, including CE gains on publicly financed expansion | `collection` |
| Tariff receipts on the reconciled volume | `tariff` |
| NRW net receipts and direct physical upgrades | Existing `nrw` / eligible `nrw_link` channels |
| Restricted loan purchases | `loan` |
| Microfinance/grant delivery | Existing explicit delivery sources |

Funding provenance and revenue generation are different accounting stages. A connection financed by public spending can generate CE receipts later; those later receipts belong to CE and must not also be credited as another public-spending cash contribution.

Keep the existing proportional attribution of pooled spending and service-stock transitions. Cost/technology efficiencies are already embodied in delivered services; do not create a second free coverage or cash contribution for them.

Changing the order in which the user activates interventions, while ending with identical inputs, must produce identical final results. This does not mean physically meaningful parameter differences—such as different intervention start years—should produce identical results.

`ResultsDashboard.tsx` still has ordered cumulative passes for financial-effect bridges. Do not use their marginal differences as canonical cash or coverage attribution. Any retained bridge must be identified as a fixed-order diagnostic; keep its aggregate BAU/combined totals consistent. Do not introduce Shapley values, permutations of all subsets or another attribution engine.

### 4.9 Primary code locations

- `model/connection_revenue.py`: calibration/runtime separation, aggregate expansion, diagnostics.
- `model/revenue_reconciliation.py`: shared identity and generated-versus-admitted cash.
- `model/water_supply.py`: annual order, dynamic NRW, ordinary funding assembly.
- `model/sanitation.py`: matching linked-water inputs and cash.
- `model/utility_revenue.py`: preserve shared base resolution.
- `model/source_funding.py` and `coverage_attribution.py`: preserve accounting; adjust only necessary interfaces.
- `model/engine.py`: propagate consistent scenario/no-loan diagnostics.
- Frontend connection configuration/mode/registry files and the connection, revenue-source, results and intervention components.
- `export_data.py`, `deck_data.py`, `deck_aggregate.py`, `coverage_export.py`: consistent combined-result sources.

## 5. Block 3 — loan sizing, dynamic scenarios and coverage comparison

### 5.1 Keep the existing two-pass loan structure

For each geography, calculate:

**A. No-loan reference**

- All selected non-loan interventions remain active.
- Use the corrected spending, dynamic volume, NRW and revenue formulas.
- Include their ordinary reinvestment effects.
- Exclude utility loan proceeds and utility debt repayments.
- Use no-loan water recovery for the linked sanitation reference.

**B. Financed scenario**

- Start from the same input snapshot and historical state.
- Inject the sized loan once, according to its existing disbursement schedule.
- Apply the fixed repayment schedule.
- Recalculate each subsequent year's service stocks, volume, revenues, replacement and investment from this scenario's own state.
- Use financed water recovery for the linked sanitation scenario.

Freeze the reference **within one calculation only**. Recompute it whenever the user changes relevant inputs, spending, intervention schedules or loan settings.

Do not copy no-loan volume arrays into the financed run. Do not share mutable service or cash-balance arrays between runs.

### 5.2 Preserve the current sizing formula and eligibility

In the chosen reference/disbursement year:

~~~text
signed_selected_cash =
    sum(no_loan_reference cash from selected sources)

eligible_pool = max(0, signed_selected_cash)
annual_allocation = allocation_share * eligible_pool

principal = annual_allocation * (1 - (1 + interest_rate)^(-tenor))
            / interest_rate

principal = annual_allocation * tenor                 if interest_rate == 0
~~~

Use the existing decimal rates, annual timing and validation.

Eligible source mappings remain:

| Selected source | No-loan reference field |
|---|---|
| Connections | Admitted `connection_net_cash` |
| Collection efficiency | `collection_cash` |
| Tariff reform | `tariff_cash` |
| NRW | Signed `nrw_net` plus eligible linked-NRW cash, counted once |

Sum signed selected sources before applying the pool's zero floor. Do not floor each source independently, substitute gross NRW receipts or add baseline utility receipts.

**Loan-induced revenues must not enlarge the same loan.** Size principal once from A, then run B. Financed revenues may support actual future funding/debt service under the existing rules, but they do not trigger resizing or an iterative borrowing loop.

In `model/utility_debt.py`, inspect the active later definitions of `validate_config` and `solve_scenario`. Do not fix only an earlier, superseded helper with the same name.

### 5.3 Preserve cash and repayment restrictions

- Restricted proceeds finance eligible expansion under the existing purchase order.
- Unused proceeds carry forward in the existing loan cash account.
- Do not use loan proceeds to pay debt service or replacement if the existing restriction disallows this.
- Ordinary source funds continue to absorb losses, selected-source debt charges and pooled replacement in the existing order.
- Scheduled repayment begins in the year after disbursement, as currently modeled.
- Deduct debt service once. Keep scheduled, paid and unfunded amounts distinct.
- Do not erase an obligation when funds are insufficient, add borrowing to cover it, or introduce a new solvency optimizer.

These mechanisms can legitimately produce earlier access gains followed by smaller or negative final-year differences.

### 5.4 Preserve matched water/sanitation comparisons

The loan page's existing comparison means **the current configuration of utility loans versus no utility loans**, with other interventions unchanged.

Maintain that definition consistently:

- No-loan sanitation consumes no-loan water's NRW recovery.
- Financed sanitation consumes financed water's NRW recovery.
- If water's loan changes linked sanitation volume, sanitation may need a financed rerun even when sanitation's own loan is disabled.
- Preserve the existing `force_financed_run` behavior for differing linked inputs.
- Do not compare financed sanitation with a reference already containing the financed water path.
- Do not substitute pure BAU for the no-loan intervention reference.

For national results, aggregate the matching geography-specific paths. Sum household counts before calculating national percentages; do not average urban/rural percentages.

### 5.5 Use paired response fields in the loan UI

`model/engine.py` already exposes:

- `scenario_hh` and `scenario_without_utility_debt_hh`.
- Matching service-gap fields.
- Matching billed-volume/revenue diagnostics and source-attribution outputs.

Use these from the same completed calculation in `DebtServicingPanel.tsx` / `AccessGapComparison`. Remove the redundant comparison-only no-loan API request and its independent result state where these paired outputs are available.

For each matching year:

~~~text
SM_difference[t] =
    SM_with_loan[t] - SM_without_loan[t]

at_least_basic_difference[t] =
    (SM_with_loan[t] + Basic_with_loan[t])
    - (SM_without_loan[t] + Basic_without_loan[t])

percentage_point_difference[t] =
    household_difference[t] / total_households[t] * 100
~~~

Use the same household units, year index, geography and input revision on both sides.

Required display behavior:

- Keep negative and zero differences.
- Label the end card “Net coverage difference at simulation end” and show the actual year.
- The simulation-end year is not necessarily the loan maturity year.
- Do not silently use an earlier available year as the end-year result.
- Missing paired fields should display unavailable/incomplete, not `0`.
- Do not combine a new reference with stale financed results while inputs are recalculating.
- The annual table, end cards and exported comparison must read the same paired data.

Distinguish two existing concepts:

1. **Coverage funded by the loan source:** source-ledger attribution.
2. **Net coverage difference with versus without loans:** difference between the complete scenario paths.

They need not match. A loan can replace other funding, shift investment timing, affect replacement needs and create repayment obligations.

### 5.6 Reconcile exports and charts

In `export_data.py`, `intervention_breakdown` currently reads some connection/CE/tariff/NRW resource totals from `passes[-1]` while its source coverage comes from `actual`.

Replace that mismatch:

- Canonical source cash and source coverage must both come from the actual combined scenario selected for reporting.
- Explicit loan-sizing-reference rows must use and label the no-loan reference.
- A no-loan report must consistently use its no-loan path.
- Preserve signed amounts and unit conversions.
- Apply the same rule to dashboard source tables, live charts and deck data.
- Do not count eligible linked NRW cash twice through aliases.

Do not infer final results from an ordered marginal pass when the actual combined ledger exists.

### 5.7 What the saved example does and does not prove

The reviewed `profiles/Oct 12.json` provides useful pre-change diagnostics:

| Water comparison | Before this patch |
|---|---|
| Urban, 2029 | Loan case has about 111,455 more SM households and 205,764 more households with at least Basic service. |
| Urban, 2035 | Loan case has about 774 fewer SM households and 1,430 fewer households with at least Basic service. |
| Rural, 2035 | With/without-loan endpoint coverage is equal, despite earlier timing differences. |

The urban loan matures after the 2035 simulation end; so does the rural loan. The rural run also retains substantial unused restricted loan funds.

The existing embedded no-loan household results matched a separately calculated no-loan run in the diagnostic review. Thus identical or negative end values are not, by themselves, evidence of a display defect.

Fix dynamic feedback and result consistency, then explain the resulting signed differences through the existing cash, replacement, service-eligibility and loan-balance outputs. **Do not hard-code these old values as post-change targets or force a positive loan effect.**

## 6. Focused acceptance checks

Extend the relevant existing tests. Use controlled fixtures with valid calibration and room for additional services. Avoid brittle tests tied to incidental implementation details.

### Public spending

| ID | Check | Expected result |
|---|---|---|
| P1 | 10% annual increase in 2028–2030 | Three compounded increases; numerical shares match section 3.6. |
| P2 | Growth ends before simulation, then GDP grows 5% | Achieved share stays fixed; currency spending follows GDP. |
| P3 | BAU shares change after the end year | Hold uses the achieved share, not a frozen multiplier; no cuts when BAU exceeds the floor. |
| P4 | Total versus capital input; capital share 0%, 60%, 100% | Conversion applied once for total inputs; ignored for capital-only inputs. |
| P5 | Public spending plus execution improvement | No second baseline-execution discount; expanded-allocation execution gain attributed to execution. |
| P6 | Both public-spending options enabled | Existing additive behavior preserved; held growth share excludes the other option and execution gains. |
| P7 | Zero rate, disabled option, historical years, end beyond simulation | No artificial top-up, historical mutation or end-window cliff. |

### Volume, revenue and attribution

| ID | Check | Expected result |
|---|---|---|
| V1 | Same opening coverage; connection funding toggled off/on | Same physical volume and generated receipts; admitted connection cash is zero only when off. |
| V2 | Earlier public spending delivers extra weighted coverage with connection funding off | Following-year volume and active CE/tariff receipts respond. |
| V3 | Representative execution, injection, loan, cost-efficiency and grant/MF delivery cases | Actual delivered coverage enters the same volume formula; no source-specific volume multiplier. |
| V4 | Population-only expansion; equal billing weights on a Basic-to-SM transfer | No duplicate population uplift; no false transfer-generated volume. |
| V5 | Combined Basic decrease and SM increase | Signed weighted changes combine before the positive floor. |
| V6 | Combined CE, tariff, connections and NRW, both funding-switch states | Gross receipt identity and admitted cash identity reconcile separately. |
| V7 | Missing billing calibration with a dependent dynamic reform | Explicit incomplete/error state; no silently successful exogenous fallback. |
| V8 | NRW with independent service expansion | Throughput/recovery react; no-expansion case retains the original path. |
| V9 | NRW's direct physical upgrades | Excluded from their own throughput expansion index; eligible revenue overlap counted once. |
| V10 | NRW lag, works cost, valuation modes and sanitation link | Timing, units and signed net cash remain coherent; matching water path used. |
| V11 | Zero/missing NRW system input | No invented recovery. |
| V12 | Combined source accounting and service stocks | Signed source cash reconciles; attributed household stocks sum to actual stocks within established tolerances. |
| V13 | Identical final inputs reached in different toggle orders | Identical simulation and canonical source attribution. |

### Loans and presentation

| ID | Check | Expected result |
|---|---|---|
| L1 | Loan disabled, zero allocation or zero eligible pool | No proceeds/repayments; paired paths coincide unless another enabled linked-sector loan explains a difference. |
| L2 | Positive loan | Principal exactly follows dynamic no-loan selected-source cash and the existing annuity formula. |
| L3 | Loan creates extra future revenue | Financed volume/revenue can change; original principal does not resize. |
| L4 | Before first relevant disbursement | Paired service paths match. |
| L5 | Edit spending or a reform input | Both paths and loan sizing refresh from the same input snapshot. |
| L6 | Insufficient selected cash and unused loan proceeds | Debt obligations, paid/unfunded cash and restricted carry balances remain distinct; no double deduction. |
| L7 | Water loan with linked sanitation and no sanitation loan | Sanitation comparison uses the appropriate separate water paths. |
| L8 | Early access gain and zero/negative endpoint difference | Signed result retained and correctly labelled; no forced positive value. |
| L9 | Combined revenue table and export | Source cash matches the combined scenario rather than an unintended no-loan pass. |
| L10 | Missing/stale paired arrays and national aggregation | No missing-as-zero output; matching year/geography/revision and household-weighted percentages. |

Relevant existing suites include:

- `test_public_spending_execution.py`, `test_budget_forecast.py`, `test_baseline_spending_share.py`.
- `test_connection_revenue.py`, `test_simplified_connection_revenue.py`, `test_consolidated_revenue.py`, `test_utility_revenue.py`.
- `test_source_attribution.py` and `test_indicative_loans.py`.

Update fixtures only where the new valid dynamic calculation genuinely requires explicit billing calibration. Do not alter production defaults to make tests pass.

## 7. Suggested implementation sequence and completion report

1. Fix the public-spending continuation and confirm capital/execution handling.
2. Separate dynamic physical volume from admitted connection funding.
3. Move dynamic NRW recovery/costs into the annual loop and reconcile all revenue identities.
4. Feed corrected outputs through the existing no-loan and financed calculations.
5. Update paired comparison consumers, metadata, source tables and exports.
6. Run the focused checks and review the saved urban/rural example.

On completion, report:

- Files changed and the behavior changed in each block.
- Tests/checks run and any remaining calibration limitations.
- One public-spending table showing the end-year transition.
- One controlled public-spending/CE example with connection funding off, showing opening coverage, volume, CE receipts and eligible loan cash.
- One paired loan example showing annual coverage, principal, debt service, replacement and unused proceeds as needed to explain the end result.
- Confirmation that the original profile inputs were preserved and the NRW loan-eligibility basis was not changed.

The completed model should consolidate the selected interventions into a reproducible annual simulation, with dynamic volume, consistent financing eligibility and reconciled source accounting, without adding features beyond these three blocks.

