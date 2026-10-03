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

## Controlled comparison

With $20m scheduled and $12m financed annually, closing expansion is $8m, $16m,
$24m. The endline balance is $24m, not the $48m sum of yearly snapshots.
With $100m existing stock, 10% replacement and $50m available, $10m maintains
assets and $40m finances expansion: closing stock $140m, next replacement $14m.
Without funding, planned/unfunded expansion adds zero assets.

Developer restore point: branch `checkpoint/before-maintenance-carryover`.