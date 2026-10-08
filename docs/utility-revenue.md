# Utility revenue — aggregate coverage expansion (October 8, 2026)

This specification supersedes the historical billed-household and operating-cost
calibration method. Active connection config is version 5; revenue attribution
metadata is version 4; loan summaries use schema 3. Old assumptions are inactive
migration metadata. The funding/repayment follow-on supersedes signed connection
adjustments and deferred utility repayment accounting.

## Baseline and connections

The existing total billed-volume path B is unchanged: population growth relative
to its anchor, or the explicit compound volume-growth override. Each service and
area retains its own baseline tariff T0 and collection ratio C0.

Freeze baseline Basic/SM coverage shares and their sum S0. In revenue year t,
use actual delivered shares from year t−1, dividing stocks by that year's total
households, not the revenue year's population.

    scale = [fBasic × (sBasic[t−1] − sBasic[baseline])
             + fSM × (sSM[t−1] − sSM[baseline])] / S0
    signed_candidate = B[t] × scale
    Nraw = max(0, signed_candidate)

Pure BAU disables connections. An enabled connection-only scenario still runs.
Unchanged coverage creates no additional connection revenue even if population
grows. Equal-weight Basic→SM transfers create no addition. Negative changes stay
combined before flooring the overall candidate at zero. Zero starting coverage makes this feature incomplete; it does not cause
the model to invent consumption.

This is an aggregate customer-mix scaling assumption, not measured household
consumption. Technical non-household shares remain capital-cost inputs only.
There are no connection operating costs, household allocations, historical
billing-share inputs or funding-reference confirmations in the active method.

## Reconciliation and attribution

W is eligible NRW sales. O is proven overlap from prior delivered NRW origins,
bounded by represented tagged volume and eligible sales. Negative upgrade
weights never become negative overlap.

    O = min(Nraw, eligible_overlap)
    N = Nraw − O
    V = B + N + W
    connections = N × T0 × C0
    NRW sales = W × T0 × C0
    collection = V × T0 × (C − C0)
    tariff = V × (T − T0) × C
    NRW net = NRW sales + avoided-cost savings − implementation cost

Their sum equals V×T×C − B×T0×C0 + savings − implementation cost.
An overlap deduction cannot consume the baseline volume; signed candidate and
floor/overlap adjustments remain diagnostics, not cash sources. Connection cash
aliases are not additional sources. Old operating-cost arrays
remain zero for compatibility and are not presented as active costs.

Physical/commercial recovery, works schedules, benefit lag, capacity commitments
and eligible opening Basic pools remain independent of billing assumptions.
Commercial recovery cannot create physical supply. Default all-recovered sales
has no household haircut. The saved household-only alternative uses the tagged
proxy's technical household portion, not a blanket haircut to total receipts.
Avoided-cost valuation excludes conflicting tagged sales without inventing NRW
tariff revenue. Sanitation linked sales use their own service's baseline rates;
reform uplifts appear in sanitation collection/tariff. Linked cash is not counted
in water as well.

## Loan funding and presentation

Connections are an optional source alongside collection, tariff and NRW.
Existing loan selections retain the old source set. A source selector never
enables its underlying intervention.

The chosen year's **frozen no-loan** source amounts are summed with their signs.
Only the total is floored at zero, then multiplied by the allocation and existing
annuity factor. Principal and fixed annual service are frozen for this loan.
One proceeds injection and carryover remain unchanged. Payments start in the
following year and continue through maturity, deducted once from ordinary funds
before replacement and expansion. Source receipts remain gross of financing use.
Insufficient ordinary funds produce a modeled deficit, not an automatically
reduced payment. Restricted loan proceeds cannot pay repayments or replacement.
Full affordability remains unassessed and fees are excluded.

Full contractual principal/interest schedules include years past the cash/coverage
horizon; future cash is unavailable, never extrapolated. Outstanding principal
is distinct from unspent proceeds. Disabling the Results loan view excludes
both loan proceeds and their repayment effects, without clearing saved settings.

One-time ordinary injection amounts enter the selected year's available funds
in full. Recurring injections and financial commitments retain their previous
spending-share/execution treatment. Saved numerical amounts are not compensated.

Below-baseline collection targets get a nonblocking, area/service-specific
warning. Target entry 90 stores 0.9, whereas 0.9 stores 0.009; the shared baseline
fraction input 0.70 means 70%. Saved rates and Basic investment shares are never
silently corrected.

Annual revenue displays use the final scenario ledger, never differences between
cumulative reruns. Household comparison bands follow the documented fixed order:
water connections, sanitation connections, remaining water interventions,
remaining sanitation interventions, custom interventions, then loan funding.
The bands telescope, but their attribution is not invariant to changing that
comparison convention. Final scenario cash is invariant to UI/key order.

Migration preserves enabled state, explicit zero/blank future shares and notes.
v1/v2 shares inherit the former documented baseline-share defaults; cleared v3
values remain missing. Costs and legacy NRW tariffs are archived, never used to
block the new method. Saved numerical results may change on recalculation.
