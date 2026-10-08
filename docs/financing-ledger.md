# Funded assets and expansion carry-forward

The earlier double-credit correction remains in place. Expansion funding is
never subtracted again after it has delivered households.

## Accounting

- All engine household and monetary quantities are in millions; unit costs are
  currency per household.
- Expansion has two transitions: Basic to Safely Managed, and Lower to Basic.
  The second depends on the combined Basic + SM target, not exclusive Basic.
- Annual planned work is the positive change in cumulative target transitions.
  Reductions cancel unfulfilled demand; advance delivery offsets later demand.
  Outstanding households are repriced at each year's effective unit costs.
- Replacement is opening **gross funded capital** divided by asset life.
  Replacement maintains that capital. Unpaid replacement does not cause modeled
  deterioration; it is recorded as a shortfall. Negative cash never reduces stock.
- Only actual sector-funded purchases, externally financed connections, and paid
  ancillary amounts add assets. NRW physical upgrades reuse infrastructure and
  do not add the value of a new connection to stock or to sector cash.
- The legacy fixed treatment/ancillary capital adder retains its existing engine
  monetary units (millions), not a per-household price. It is committed once when
  expansion starts, carried until paid from spare expansion capital, and only
  paid amounts are capitalized. This preserves its legacy magnitude, not an
  independent validation of the workbook's treatment-cost calibration.
- BAU and scenario passes remain independent; geography sums each area's ledger.

## Output contract

New explicit fields include `annual_planned_expansion_cost`, `catch_up_requirement`,
`closing_outstanding_expansion`, `endline_financing_requirement`,
`funded_asset_stock`, `sector_funded_expansion`, `externally_funded_expansion`,
`ancillary_outstanding`, `ancillary_paid`, and transition household matrices.
Each has a scenario-prefixed equivalent.

Compatibility fields: `new_capex_total` now prices closing outstanding transitions
and ancillary work. `financing_gap` remains this closing balance plus **current-year**
unpaid replacement and negative cash; it must not be summed over time.
`total_investment_need` is closing expansion plus current replacement, not gross
annual planned investment. `connection_purchase_capital` now represents actual
paid purchases after eligibility/caps, not hypothetical pre-cap spending.
`replacement_capex` and `bau_replacement_capex` now share the funded-stock base.

Endline requirement = closing expansion + unpaid replacement and cash deficits
accumulated since baseline. Annual flows may be summed; snapshots may not.
Subperiod closing balances include earlier outstanding work. Subperiod endline
requirements include all shortfalls since baseline, so adjacent balances are
not additive.

## Source-of-need reporting contract

Reporting exposes the existing calculation, rather than repairing replacement
policy. The user explicitly confirmed that legacy replacement-shortfall
accumulation and its contribution to financial totals must remain unchanged.
Deferred-replacement correction is separate and does not block these views.

All fields below are two-by-year matrices: row 0 is Basic → SM upgrades and
row 1 is lower service → Basic entries. Monetary fields are millions of native
currency; household fields are millions of households. Each field has a
`scenario_` equivalent, including on cumulative intervention passes.
Financial reporting applies after the historical baseline; historical cells
are not applicable, not evidence of zero financial obligations.

| Display / meaning | Exact source | Timing |
|---|---|---|
| Scheduled expansion cost — reference | `scheduled_household_expansion_by_service` | Annual flow, reference only |
| Expansion still requiring funding — before this year's spending | `prefunding_household_expansion_by_service` | Before funding |
| Ancillary infrastructure still requiring funding | `prefunding_ancillary_by_service` | Before funding |
| Current-year replacement requirement | `replacement_by_service` | Annual allowance on opening funded assets |
| Current cash shortfall | `current_cash_shortfall_by_service` | This year's negative ordinary cash after debt service |
| Remaining household expansion | `closing_household_expansion_by_service` | Year-end balance |
| Unpaid ancillary allowance | `closing_ancillary_by_service` | Year-end balance |
| Current-year unpaid replacement | `current_unpaid_replacement_by_service` | Year-end shortfall for this year |
| Prior replacement shortfall | `prior_replacement_shortfall_by_service` | Legacy accumulator at opening of year |
| Accumulated replacement shortfall — legacy measure | `accumulated_replacement_shortfall_by_service` | Year-end legacy balance, prior plus current |
| Prior cash shortfall | `prior_cash_shortfall_by_service` | Accumulator at opening of year |
| Accumulated cash shortfall | `accumulated_cash_shortfall_by_service` | Year-end diagnostic, prior plus current |
| Household expansion paid | `household_expansion_paid_by_service` | Actual annual sector and external cash purchases, excluding ancillary |
| Sector-funded household expansion paid | `sector_household_expansion_paid_by_service` | Actual sector cash purchases only; excludes ancillary, so this plus external household cash reconciles household expansion paid |
| Ancillary paid | `ancillary_paid_by_service` | Actual annual cash spending |
| Current replacement paid | `replacement_funding_applied_by_service` | Actual annual reserved replacement funding |
| External household finance applied | `externally_funded_expansion_by_service` | Actual annual external cash purchases |
| Physical reuse delivery | `noncash_delivery_hh_by_service` | Annual household delivery, not money |
| Physical reuse credit against due work | `noncash_delivery_credit_by_service` | Noncash reference value, not cash spending |

The scheduled household reference is the positive change in required target
transitions priced at current effective costs. It is not added again to the
pre-funding obligation. Required transitions are measured against baseline
SM and baseline SM + Basic-only; prior delivered transitions, including delivery
ahead of schedule, already reduce the pre-funding work still due.

The effective transition costs retain existing multipliers, including the
non-household capital multiplier. The ancillary rows isolate the separate
fixed treatment/ancillary adder; they do not reinterpret either unit-cost input.

### Formulas and invariance

- Before-funding requirement = pre-funding household expansion + pre-funding
  ancillary allowance + current replacement requirement + current cash shortfall.
  It is the existing `catch_up_requirement` plus current cash shortfall. It does
  not silently include historical replacement diagnostics the engine cannot pay down.
- Remaining financing need at year-end = closing household expansion + closing
  ancillary allowance + accumulated legacy replacement shortfalls + accumulated
  cash shortfalls. This reconciles to `endline_financing_requirement_by_service`
  and its sector total, within floating-point precision.
- Advanced residual = closing household expansion + closing ancillary allowance
  + current unpaid replacement + current cash shortfall. It reconciles to
  `financing_gap_by_service`. Label it **Closing expansion plus current-year
  financial shortfall**; it contains a balance and is not a summable annual flow.
- Accumulated replacement = prior replacement + current unpaid replacement.
  Current unpaid is already included: do not add it again to the accumulator.
- Actual expansion cash = household expansion paid + ancillary paid =
  sector-funded expansion + externally funded expansion. Physical reuse is
  separately reported and excluded from cash payments.

The new separate replacement and cash reporting counters are parallel to the
unchanged combined legacy accumulator. They never feed delivery, payment
allocation, assets, replacement policy or old output fields. They do not record
or infer deferred-replacement repayments. Independently accumulating components
can differ from the original combined arithmetic by floating-point roundoff.

“Accumulated replacement shortfall — legacy measure” means funding missed
historically. It is not a validated, settleable backlog: paying current
replacement or expansion does not reduce this counter. Totals containing it
retain that meaning and must be visibly qualified. Do not label it “Verified
deferred replacement” or invent a “deferred replacement paid” amount.

Cash shortfalls are recorded negative ordinary cash after debt servicing,
including the model's existing intervention cash effects. They are not a newly
verified register of unpaid invoices. The negative cash amount and unpaid
replacement are separate entries in the existing model; neither is copied into
the other by reporting. Their existing modelling interpretation is retained.

### Attribution and reconciliation detail

Replacement uses the actual opening funded-asset service split. Cash shortfalls
use the recorded engine attribution based on due expansion and replacement
costs (with the existing investment-share fallback when those costs are zero).
Ancillary attribution uses the first committed expansion's cost weights, or
sector delivery weights if no planned cost exists. This is a **recorded legacy
allocation**, not independent validation of treatment calibration or asset
ownership. Do not compute new service shares in the frontend.

When a source genuinely cannot attribute a component, show a shared/unallocated
reconciling row rather than apportioning it or displaying unavailable as zero.
Whole-sector available cash is shared; service-specific actual applied cash
must not be presented as a service-specific share of all available funding.
Areas retain their own settings. National obligations sum local obligations,
not a new calculation from net national coverage.

Additional source diagnostics explain changes without forcing an incorrect
cash subtraction bridge:

| Source | Meaning |
|---|---|
| `opening_household_expansion_cost_by_service` | Previous closing unfinished work at its previous prices |
| `outstanding_repricing_by_service` | Opening unfinished work × change in effective unit costs |
| `cancelled_household_expansion_cost_by_service` | Previously unfinished target work cancelled this year, priced at current costs |
| `advance_delivery_credit_by_service` | Prior delivery ahead of target that offsets current planned work |
| `new_ancillary_commitment_by_service` | Fixed ancillary commitment in its first committed year only |

Annual reference expansion plus new ancillary commitment reconciles to the
existing `annual_planned_expansion_cost_by_service`. Household and ancillary
pre-funding/closing components reconcile to their previously combined fields.
Cash paid can also purchase advance delivery; it must not be assumed identical
to the reduction in unfinished work.

## Presentation, charts and exports

The default financial view is **Where the requirement/gap comes from**.
Its year-column hierarchy retains combined-scenario totals, geographic and
service subtotals, components and an aligned **Funding applied during the year**
section. BAU source detail and **Effects of interventions** remain accessible.
Opening requirements use **Requirements before this year's funding**; closing
gaps use **Remaining financing need at year-end**.

Financial need effects use positive **Reduction in financing need**:
each reduction is before minus after on the same selected metric. Thus
BAU − sum(ordered reductions) = combined scenario. Negative effects increase
need and must stay visible. Coverage and funding retain their distinct
after-minus-before change meanings. Categories are display groupings, not
different calculation passes.

The companion **Remaining financing need—with interventions** chart uses the
same unrounded selected closing series as the table, plus the comparable BAU
series. Legacy residual bands must remain clearly identified if shown separately;
they cannot be relabelled as closing-balance reductions without changing their
data source to the corresponding cumulative closing snapshots.

National signed attainment is actual minus the matching national target.
Local unmet households are summed positive deficits against area-specific
targets. These are separate explanatory indicators for SM and at-least-Basic,
not currency obligations; an urban surplus does not eliminate rural unmet
households. National coverage uses household-weighted denominators.

Exports retain unrounded amounts with explicit scenario, sector, area, service,
component, hierarchy, timing, units and limitation/status metadata. Reference
flows remain distinct from additive obligations. Do not sum subtotals together
with their children or closing balances across years. A subperiod summary uses
**Outstanding at [closing year]**, preserving all earlier carried shortfalls.

## Controlled comparison

### Indicative loan funding

Loan funding is optional and Results opens with it excluded, even when saved
settings enable it. Explicit inclusion changes the calculated tables, charts
and live exports without deleting those settings. The fourth workflow stage
shows the configured indicative scenario directly.

Loan sizing uses the selected year's additional net cash in a frozen no-loan
reference. Fixed annual principal-and-interest obligations deduct ordinary cash
from the following year through maturity, before replacement and expansion.
Do not deduct financing use from source receipts or a second time in the ledger.

Each area and sector sizes separately from a frozen intervention-only reference
with all utility loans disabled. The selected annual collection, tariff and NRW
cash (including the existing eligible sanitation link, counted once) is summed
signed, floored at zero, multiplied by allocation and the real-rate annuity
present-value factor. At zero interest, the factor equals the explicit term.
New-connection cash is optional; existing loan source selections are preserved.
Collection/tariff interaction attribution is preserved. Keep the full contractual
repayment schedule beyond the forecast, showing horizon outstanding principal
and remaining obligations without extrapolating future ordinary cash or coverage.
Restricted loan proceeds remain expansion-only; unspent proceeds are not the
same quantity as outstanding debt. Scheduled obligations are not a certification
that payments were made. Affordability is not assessed and fees are excluded.

There is one injection in the selected reference year. Existing restricted
capital allocation and delivery limits govern its use. For each model year,
opening unspent proceeds + new injection = loan-funded investment + closing
unspent proceeds. Opening cash is not another disbursement and loan availability
is not a second credit to ordinary capital. National roll-ups add actual
area/sector injections and balances, preserving their timing and assumptions
without pooling eligibility or averaging rates/terms.

This is gross financing, not affordability verification or a net benefit after
financing costs. Legacy grace, repayment structure and ceiling settings remain
inactive migration metadata; a valid old maturity-minus-disbursement span
supplies the migrated indicative term. New blank rates and terms are not zero
or invented defaults. Existing replacement and transition-pricing qualifications
remain unchanged.

With $20m scheduled and $12m financed annually, closing expansion is $8m, $16m,
$24m. The endline balance is $24m, not the $48m sum of yearly snapshots.
With $100m existing stock, 10% replacement and $50m available, $10m maintains
assets and $40m finances expansion: closing stock $140m, next replacement $14m.
Without funding, planned/unfunded expansion adds zero assets.

Developer restore point: branch `checkpoint/before-maintenance-carryover`.