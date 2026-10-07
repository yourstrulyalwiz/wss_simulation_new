# WSS Simulation Tool — consolidated revenue, NRW and eligibility changes

Proposed implementation instructions for Replit · 6 October 2026 · Revised: retain NRW implementation costs within NRW net cash

Reviewed main commit: `e9154a033337e3dc46088f6538976ef91ca4ee5f` in `yourstrulyalwiz/wss_simulation_new`. This proposal incorporates the discussion supplied by Billy and the newer simplified-loan implementation. It is not a patch and has not been implemented or integration-tested.

**Revision:** Billy has withdrawn the proposed relocation of NRW implementation costs to a separate requirement ledger. Preserve their deduction inside `nrw_net`. To avoid introducing a different cost treatment through loan sizing, this revision also preserves the existing signed, after-implementation-cost NRW loan source. The earlier recurring-only loan-source proposal is deferred. All volume/rate integration, overlap reconciliation and target-cap changes remain in scope.

## 1. Task and boundaries

Implement one coordinated change covering connection-based revenue, NRW, tariff reform, collection efficiency, microfinance eligibility, financing ledgers and their downstream loan/reporting outputs. Compare your working tree with the reviewed commit first and preserve newer unrelated changes.

The governing rules are:

1. Policy targets are benchmarks for unmet service requirements, not ceilings on intervention delivery.
2. All delivered transitions must respect eligible household pools and conserve population.
3. New connections, NRW sales, tariff reform and collection efficiency feed one reconciled collected-revenue calculation per year, area and sector.
4. Every billed volume, cash receipt, implementation cost and funded transition is counted once.
5. Preserve the selected Basic/SM investment allocation and within-area rollover. Keep urban/rural simulations separate.
6. Retain NRW implementation costs within signed NRW net cash and preserve the existing funding/shortfall treatment. Preserve scheduled physical effects; do not introduce a new funding-availability gate or a separate NRW unpaid-works ledger.
7. Preserve the new indicative lump-sum loan workflow, including signed source pooling, after-implementation-cost NRW cash, frozen no-loan sizing and deferred repayments.

GDP/profile cleanup, national urban/rural redistribution, alternative SM transition unit costs, new loan affordability checks and repayment accounting are outside this change.

## 2. What the latest code already does

| Finding | Evidence at reviewed commit | Treatment |
|---|---|---|
| Connection revenue uses prior-year household service counts. Tariff and collection reform apply to that resulting volume. | `model/connection_revenue.py`, `annual_connection_cash()` | Retain and extend; this is already implemented. |
| NRW values recovered water using a separate fixed unit value; its implementation cost is deducted through `nrw_net`. | `model/water_supply.py:612–626,762` | Reconcile sales volume/rates; retain implementation costs inside `nrw_net`. |
| Enabling NRW or affordability imposes a target-based ceiling on the shared SM investment pool. | `model/water_supply.py:797–799` | Replace with physical eligibility limits. |
| Microfinance applicants are derived from a target-gap high-water mark. | `model/water_supply.py:812–850` | Replace with tracked eligible cohorts. |
| Connection configuration explicitly warns that NRW overlap is not reconciled. | `model/connection_revenue.py:24–28` | Resolve overlap; remove warning only once verified. |
| The expansion ledger already uses cumulative SM and Basic-or-better requirements. | `model/expansion_ledger.py:64–106` | Preserve this hierarchy-aware correction. |
| Indicative loan sizing is now implemented; active source selection still reads `nrw_net` plus linked sanitation cash. | `model/utility_debt.py:534–625` | Preserve sizing and signed net-cost treatment; reconcile the revenue feeding the existing source fields. |
| NRW-linked sanitation revenue uses fixed sewer charge/collection settings on recovered physical volume. | `model/sanitation.py:60–81` | Reconcile actual eligible sewer billing and applicable sanitation rates. |

The preceding review cited `8a89257`. The new `e9154a0` commit adds the simplified loan feature but does not modify `water_supply.py`, `connection_revenue.py`, `utility_revenue.py`, `sanitation.py` or `expansion_ledger.py`. Their cap and NRW integration issues remain.

## 3. Remove policy-target ceilings; retain physical limits

### Shared service delivery

Replace the target-dependent `room_sm` branch with the eligible opening Basic household pool. Apply the same rule regardless of which interventions are enabled.

For each area/sector/year, use opening household counts and actual named flows:

```text
NRW actual upgrades <= opening eligible Basic households
Funded SM upgrades <= opening Basic - NRW actual upgrades
Microfinance/grant upgrades <= opening Basic - NRW upgrades - funded SM upgrades
Funded Basic entries <= opening lower-service households
```

Preserve the current ordering of NRW physical upgrades, funded SM upgrades and then affordability-supported upgrades. Do not allow households newly entering Basic to receive a second Basic→SM transition in the same year. Keep every source's delivered count separately for audit and revenue attribution.

Apply the selected Basic/SM capital allocation after prior funding obligations. When an eligible pool is exhausted, reallocate unused capital to the other eligible rung. NRW physical upgrades do not consume the SM household-purchase allocation, but reduce its eligible pool. Recalculate rollover after those upgrades release unused SM capital. If both pools are exhausted, retain unallocated capital; never fabricate coverage.

Targets must remain available for requirement/gap calculations. Do not delete target data or the caps used only to calculate a nonnegative target shortfall.

### Microfinance and grants

Remove both the `isfinite(sm_cap)` gate and the target-gap/high-water-mark enrollment logic. Removing only a `min()` leaves enrollment target-dependent.

Recommended default: one offer per eligible household cohort during the intervention window, consistent with the existing intent to avoid repeated application of take-up percentages.

- At the start, initialize the eligible Basic cohort and partition it by the existing income-band assumptions.
- Record offers, self-finance exclusions, microfinance delivery, grant-assisted delivery and unserved households separately.
- Track newly eligible Basic entrants from actual flows; they become eligible in the next year. Do not infer entrants only from net growth of the Basic stock.
- Deduct households served through NRW or ordinary capital from the same remaining cohorts. Apply a documented proportional allocation across income bands where household identity is unavailable.
- Apply take-up once per newly offered cohort. Do not silently introduce annual reapplication of take-up to all remaining Basic households. Future re-offering may be a separate explicit option.
- Retain income affordability, loan terms, grant limits and the existing treatment of self-financers as an excluded counterfactual group. Changing that counterfactual is outside scope.
- Clamp delivery against the remaining physical pool and reconcile all cohort totals annually.

This cohort mechanism is a proposed implementation choice, not a claim that the current code already tracks customers individually.

## 4. Reconcile billing volume before computing revenue

### Common revenue identity

For each area and sector, let:

- `Q_ref[t]`: billed-volume reference already represented in baseline funding.
- `Q_conn_raw[t]`: volume produced by the existing connection/nonhousehold module, potentially including NRW-related household billing.
- `Q_nrw_sales[t]`: total incremental billed volume attributed to NRW, including any portion already represented in `Q_conn_raw`.
- `Q_overlap[t]`: that explicitly identified overlapping portion.

Then:

```text
Q_pre_nrw = Q_conn_raw - Q_overlap
Q_total = Q_pre_nrw + Q_nrw_sales
R_reference = Q_ref * P_reference * C_reference
R_scenario = Q_total * P_scenario * C_scenario
Revenue_increment = R_scenario - R_reference
Recurring_net_increment = Revenue_increment - Incremental_recurring_operating_cost
```

When connection revenue is disabled, use the existing exogenous billed-volume reference for `Q_conn_raw`; standalone NRW must still use the shared applicable tariff and collection rate. These formulas assume the common tariff/collection basis used by the current model. If customer classes differ, calculate class-specific products and sum; do not force different services to share a water tariff.

### Identify overlap rather than guessing it

Extend the service-flow/revenue state to retain NRW-origin household upgrades and their billed-volume effect under the existing billed-share and consumption assumptions. At a common consumption rate, the incremental billed-household effect of a Basic→SM upgrade depends on the difference between SM and Basic billed shares, not the whole upgraded household's water consumption.

Use that tagged effect, reconciled to actual NRW sales, to identify `Q_overlap`. Do not subtract all new-connection volume or simply take the minimum of unrelated connection growth and recovered water. Some new connections are unrelated to NRW. Do not subtract a billed volume already included in the baseline funding reference as if it were a new NRW benefit.

Keep the following distinct:

1. Physical-loss recovery: additional usable water under the unchanged-production assumption.
2. Commercial-loss recovery: existing consumption newly metered/billed; it does not supply new physical water for household upgrades.
3. Actual incremental sales: recovered water or commercial recovery assumed sold/billed.
4. Household overlap: incremental sales already counted through connection-based billing.
5. Residual recovered capacity/water: not used for attributed household service or additional sales.

The simplified scenario may assume recovered eligible volume is sold, but expose that assumption. Do not automatically treat all unused physical recovery as sales if no modeled demand or explicit sales assumption supports it. Keep avoided-production-cost valuation, if retained, as a separate savings mode: tariff and collection multipliers apply to sales, not to avoided costs. Do not book both sales and avoided production costs for the same water under unchanged production.

### Timing and capacity

Preserve the current one-year lag for connection-derived billing, the NRW works/benefit lag and each reform's own schedule. Value sales using the tariff and collection rate in the actual revenue year. An NRW upgrade delivered in year t cannot generate connection-based revenue in year t if the connection module requires year t+1.

Track recovered annual capacity, capacity committed to existing NRW upgrades, uncommitted capacity and actual annual use. Do not repeatedly award the same annual recovered capacity as new household upgrades each year. Conversely, do not permanently lose capacity merely because eligible households were unavailable in the year it was recovered. Allocate uncommitted capacity to later eligible cohorts only if it still exists and is sufficient to sustain the added service. Preserve the model's assumed physical-to-SM relationship as a scenario assumption.

## 5. Use one explicit attribution convention

One total revenue identity is essential, but its interaction benefits need an explicit allocation for reporting and loan-source selection. Recommended convention: preserve collection-before-tariff attribution on the non-NRW volume and assign the full joint-rate NRW benefit to NRW.

```text
Connection revenue contribution = (Q_pre_nrw - Q_ref) * P0 * C0
Collection contribution = Q_pre_nrw * P0 * (C - C0)
Tariff contribution = Q_pre_nrw * (P - P0) * C
NRW sales contribution = Q_nrw_sales * P * C
```

These four signed contributions sum exactly to `R_scenario - R_reference`. Assign applicable incremental recurring operating costs once to the relevant source; their net contributions must sum to the recurring net increment. For overlapping sales, remove both duplicate revenue and duplicate costs from the connection attribution.

This convention gives NRW the interaction on NRW-attributed sales, while tariff and collection apply to the growing non-NRW connection base. It does not omit the reforms on NRW sales; those effects are included in the NRW line. Explain this in tooltips. Standalone intervention simulations will generally not sum to the joint effect.

If a separate chart uses marginal scenario reruns for service or financing impacts, retain that valid decomposition with a clear label. Do not substitute those marginal impacts for source cash used by the loan calculator.

Illustration, excluding costs and overlap:

| Input/output | Value |
|---|---:|
| Reference volume | 1,000 |
| Additional non-NRW connection volume | 200 |
| NRW incremental sales | 100 |
| Reference tariff / collection | 1.00 / 80% |
| Scenario tariff / collection | 1.50 / 90% |
| Reference revenue | 800 |
| Scenario revenue | 1,755 |
| Connection contribution | 160 |
| Collection contribution | 120 |
| Tariff contribution | 540 |
| NRW contribution | 135 |
| Total revenue increment | **955** |

For a separate overlap test, if `Q_conn_raw=1,200`, `Q_nrw_sales=100` and `Q_overlap=100`, the total is 1,200, not 1,300. The contributions become 80 + 110 + 495 + 135 = 820, matching 1,620 minus 800.

The existing connection helper was checked with the first example's connection/rate inputs: before adding NRW, it returns revenue 1,620 and contributions 160 + 120 + 540 = 820. This confirms that tariff/collection integration with connections already exists. It does not validate the proposed NRW integration.

## 6. Keep NRW implementation costs within NRW net cash

Retain the existing cost formula, works schedule and deduction through `nrw_net`. Change the revenue component to the reconciled joint-scenario sales value; do not relocate implementation costs to financing requirements.

```text
NRW sales cash = reconciled NRW billed volume * scenario tariff * scenario collection
NRW net cash = NRW sales cash - applicable NRW recurring costs - NRW implementation cost
Available funding = existing other funding + connection net cash
                  + collection cash + tariff cash + NRW net cash
```

The funding expression is schematic: preserve all other existing funding terms and count each once. Applicable recurring costs are those actually modeled under the agreed volume/cost assumptions; this is not an instruction to invent a new cost rate. Preserve the implementation cost calculation and timing.

- Keep negative `nrw_net` signed in available funding. Do not use `max(nrw_net, 0)` to make an expensive NRW intervention appear costless.
- Do not add gross NRW sales cash and `nrw_net` to the same funding total.
- Do not add implementation costs again under requirements, replacement or a new NRW arrears ledger.
- Preserve the existing total-cash deficit and replacement-shortfall accounting. A negative NRW contribution is not itself an additional gap if other funding already covers it.
- Gross receipts, implementation costs and net cash may remain separate diagnostic rows, but only net cash enters funding.
- Preserve scheduled NRW physical effects and the existing implementation assumption. Cap removal changes eligible service delivery, not cost accounting or the intervention's works schedule.

Illustration: other available funding is 50, NRW sales receipts are 20 and NRW implementation cost is 100, with no additional recurring cost. `nrw_net = -80`, so available funding is `50 - 80 = -30`. The existing engine handles the resulting 30 cash deficit and any other obligations. Do not also add 100 of NRW requirements or another 80 NRW deficit. If other funding were 200 instead, available funding would be 120; the negative NRW contribution would be covered by that funding.

Retain applicable incremental operating costs without imposing a new production cost on recovered physical water already produced under the unchanged-production assumption. Additional billing, distribution or wastewater costs may still apply where modeled. Do not count the same cost in both connection and NRW modules. New NRW asset-lifecycle or unpaid-implementation ledgers are outside this revision.

## 7. Preserve minimum-service gaps and the new loan workflow

### Service and financing gaps

Keep exclusive service categories for population accounting, but calculate minimum-service diagnostics as:

```text
SM shortfall = max(0, target_SM - scenario_SM)
Basic-or-better shortfall = max(0, target_SM + target_Basic - scenario_SM - scenario_Basic)
```

Preserve the current transition ledger for pricing and carrying unmet work. Do not replace it with a raw exclusive-Basic difference, or sum a gross requirement and residual expansion need as if they were independent costs. Exceeding a target closes only the corresponding service shortfall. Replacement, ancillary obligations and cash shortfalls (including those arising from negative NRW net cash) can remain. Do not add a separate unpaid-NRW obligation on top of the existing net-cash treatment.

### Indicative loan

The latest commit already sizes one injection using:

```text
Annual allocation = allocation_share * max(0, sum(selected signed net source cash))
Loan = Annual allocation * (1 - (1 + interest_rate)^(-term)) / interest_rate
At zero interest: Loan = Annual allocation * term
```

Preserve this formula, user-selected snapshot year, one disbursement, restricted unspent-proceeds balance and deferred repayment accounting. Keep the no-loan reference frozen, including the no-water-loan reference used for sanitation. The loan must not increase its own size by generating new connections and then borrowing against their revenue.

Preserve the active `solve_scenario()` cost basis: the NRW source uses reconciled `nrw_net` (after implementation cost), plus any eligible linked sanitation cash belonging to that sector. Update underlying volumes/rates and eliminate overlap, but do not switch the source to gross NRW sales or recurring cash before implementation cost. Keep signed source values and floor only their selected sum at zero.

If NRW is selected and its net cash is negative, it reduces the combined selected pool. A negative source is not individually set to zero before adding the positive sources:

```text
Selected pool = tariff_selected * tariff_cash
              + collection_selected * collection_cash
              + nrw_selected * (nrw_net + eligible_linked_cash)
Eligible pool = max(Selected pool, 0)
Annual allocation = allocation_share * Eligible pool
```

Example: selected tariff cash = 60, selected collection cash = 40, selected NRW net cash = -30. The eligible pool is 70; at 50% allocation, the annual sizing amount is 35. If NRW net cash is -120, the sum is -20, so the eligible pool and loan are zero. If only NRW is selected and its net cash is negative, the loan is zero. If NRW is not selected, it is omitted from the sizing pool but still reduces ordinary available funding when its intervention is active. This preserves the simplified selected-source calculator; it is not a test of overall utility affordability.

The earlier draft proposed a different basis: exclude upfront NRW implementation cost from the loan source and use recurring net cash. That proposal could yield a positive loan-sizing source even when the implementation-year `nrw_net` is negative. It is deferred in this revision, so keeping the current implementation-cost treatment does not silently change loan eligibility.

Retain the existing exclusion of the connection source itself from selectable loan sources. Reform uplift earned on the expanded connection base remains in tariff/collection sources under this convention. NRW-related overlap assigned to NRW is excluded from the connection source. Surface this attribution in the loan preview so users can understand partial-source selection.

Do not add new repayment deductions, affordability gates or loan restrictions as part of this work. Any change to the allowed uses of restricted loan proceeds, such as paying NRW works, needs a separately specified policy; retain the current infrastructure-expansion routing here.

## 8. Sanitation, outputs and saved inputs

Where NRW-linked sanitation billing is enabled, reconcile sewer-billable volume with sanitation connection billing. Physical recovery alone does not prove additional sewer billing: use the return/collection/connection assumptions that establish eligibility. Apply the sanitation scenario tariff and collection rate in the revenue year, not automatically the water rates. Count water receipts in water and sewer receipts in sanitation; these are different services, not duplicate cash by definition.

Use consistent fields in backend results, frontend ledgers, intervention views, loan previews, national aggregation and every export:

- Reference and scenario billed volume; connection effect; NRW sales; identified overlap; residual recovery.
- Applicable tariff and collection rate; collected revenue; recurring operating-cost increment; reconciled source net cash.
- Potential NRW service capacity; delivered upgrades by source; remaining eligible pools.
- NRW gross sales cash, implementation cost and signed `nrw_net` as diagnostics; retain current cash-deficit reporting without a separate implementation-obligation ledger.
- Available funding including signed NRW net cash, actual funding applied, unallocated ordinary capital and restricted loan proceeds.
- SM and Basic-or-better shortfalls; target overachievement as a separate diagnostic.

Use the shared revenue inputs as the authoritative rates for NRW sales. Migrate the old NRW-only tariff transparently: reuse it when no shared rate exists and it is the sole valid legacy value; if legacy and shared rates conflict, flag the conflict rather than silently selecting an unrelated default. Retain valuation-mode-specific inputs for avoided-cost scenarios. Version changed settings, preserve saved profiles and add migration tests.

Do not recreate an urban/rural national allocation control in this task. Calculate separately, then aggregate money and household counts. Recompute national percentages from aggregated numerators/denominators; do not add percentage values.

## 9. Implementation order and acceptance checks

Implement in this order: canonical volumes/rates and overlap state; recurring revenue/attribution; cap removal and cohort eligibility; preservation of net implementation-cost treatment; loan-source reconciliation; UI, migration and exports. Keep changes reviewable and report the actual changed files.

| Check | Required result |
|---|---|
| All interventions off | Existing BAU results remain equal within numerical tolerance. |
| Connections + tariff + collection, NRW off | Preserve existing valid revenue results and lag. |
| Joint numerical example above | Revenue 1,755; four contributions sum to 955. |
| Full overlap example above | Total volume 1,200; revenue increment 820; no duplicate volume/cost. |
| Partial overlap and unrelated connections | Subtract only tagged shared sales. |
| Staggered starts/lags | No early benefit; each year's rates apply to that year's sales. |
| Connection feature off, NRW on | Correct exogenous base and scenario rates; no reliance on connection runtime. |
| Tariff/collection reductions | Signed effects retained, not individually floored. |
| Avoided-cost mode | No tariff/collection uplift on avoided costs and no simultaneous sales credit for the same recovery. |
| 1m HH: SM 600k, Basic 300k, lower 100k; SM target 800k; NRW capacity 250k | Deliver 250k upgrades to 850k SM when otherwise eligible; service target shortfall zero. |
| Shared target cap regression | Turning on a zero-effect NRW or affordability intervention must not cap tariff/public-funded SM delivery. |
| Eligible-pool exhaustion | No negative household categories; totals equal population; released cash rolls over or remains unallocated. |
| Microfinance across years | No duplicate cohort offers/delivery; preserve affordability, take-up and grant budget. |
| NRW spare capacity | No repeated use of committed capacity; feasible unused capacity remains identifiable for later years. |
| NRW cost exceeds revenue/funding | Retain signed `nrw_net`; total funding and existing deficits reconcile; no separate cost requirement, duplicate shortfall or new physical-effect gate. |
| Target overachievement | No false exclusive-Basic financing gap; legitimate non-expansion obligations remain. |
| Loan sizing | Uses reconciled selected net cash including NRW implementation cost, signed pooled floor and frozen no-loan reference; one injection only. |
| Negative NRW source | Selected 60 tariff + 40 collection - 30 NRW gives pool 70; 50% allocation gives 35. With NRW -120, loan is zero. Negative NRW remains in general funding even when excluded from loan sizing. |
| Sanitation link | Proper sanitation rates and eligible volume; no duplicate connection/linked cash. |
| Saved settings and exports | Migration preserves user inputs; UI, API, exports and urban/rural sums reconcile. |

Run the existing relevant backend and frontend suites plus these focused regression checks. Return a concise implementation report with commit, changed files, numerical examples, tests and limitations. Do not claim every model issue is resolved merely because this change passes.

## Source links

- [Reviewed commit](https://github.com/yourstrulyalwiz/wss_simulation_new/commit/e9154a033337e3dc46088f6538976ef91ca4ee5f)
- [Water supply/shared sector core](https://github.com/yourstrulyalwiz/wss_simulation_new/blob/e9154a033337e3dc46088f6538976ef91ca4ee5f/model/water_supply.py)
- [Connection revenue](https://github.com/yourstrulyalwiz/wss_simulation_new/blob/e9154a033337e3dc46088f6538976ef91ca4ee5f/model/connection_revenue.py)
- [Shared utility revenue](https://github.com/yourstrulyalwiz/wss_simulation_new/blob/e9154a033337e3dc46088f6538976ef91ca4ee5f/model/utility_revenue.py)
- [Active loan calculation](https://github.com/yourstrulyalwiz/wss_simulation_new/blob/e9154a033337e3dc46088f6538976ef91ca4ee5f/model/utility_debt.py)
- [Sanitation link](https://github.com/yourstrulyalwiz/wss_simulation_new/blob/e9154a033337e3dc46088f6538976ef91ca4ee5f/model/sanitation.py)
- [Expansion ledger](https://github.com/yourstrulyalwiz/wss_simulation_new/blob/e9154a033337e3dc46088f6538976ef91ca4ee5f/model/expansion_ledger.py)
