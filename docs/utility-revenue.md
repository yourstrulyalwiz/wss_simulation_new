# Tariff and collection revenue correction

## Shared inputs and migration

Each area's `revenue_bases.water` and `revenue_bases.sanitation` record contains:
`version: 1`, `volume_mld`, `reference_year`, `tariff` (real local currency/m³),
`collection_ratio` (0–1), `growth_rate` (fraction, null means population),
`origin`, and original `legacy` inputs. Both intervention panels edit this same
record. Targets and reform schedules remain in their existing intervention sections.

Legacy water collection uses `ce_water_sold_mld`, `ce_current_tariff`,
`ce_current_ratio`, `ce_start_year`, and `ce_vol_growth`. Legacy tariff uses
`tariff_volume_mld`, `tariff_current`, and `tariff_start_year`, with population
growth. Sanitation's collection base materializes the original water-volume ×
wastewater-share and water-tariff × sewer-share derivation. It inherits the
legacy water collection ratio only if its own ratio is absent; zero is valid.
The UI materializes sanitation's inherited collection target during migration.

Migration compares annual volume paths after unit/anchor normalization, plus
baseline tariffs and collection ratios. Equivalent bases or a sole complete
base migrate automatically. Missing or conflicting bases block calculations and
exports with HTTP 422 until explicitly resolved. No toggle chooses the base.
Resolved inputs persist inside the existing per-area profile/scenario/session
payloads, including names and unrelated settings. Defaults retain the unresolved
sanitation choice: collection-derived 70.08 MLD versus tariff-entered 43.8 MLD,
both anchored in 2026 with tariff 16 and collection 90%.

## Calculation and accounting

Convert MLD to million m³/year once (`MLD × days/year ÷ 1000`), then apply
exogenous population or fixed growth. New connections never change that path.
Baseline revenue is Q × p0 × c0. Scenario revenue is Q × p × c.
Collection cash is Q × p0 × (c − c0); tariff cash is Q × (p − p0) × c.
Their sum must equal scenario minus baseline revenue within `rtol=1e-10`,
`atol=1e-9` in local-currency millions. Legacy equivalence uses `rtol=1e-8`,
`atol=1e-10` for annual volumes. Reference years for population growth must be
inside the model horizon rather than silently clamped to an endpoint.

Tariff and collection retain forecast gating, separate ramps and target-year
holds. Finite, nonnegative volume/tariffs, collection within [0,1], and
improvement-only targets are validated. The two cash streams enter capital once,
without the public-budget execution multiplier. Baseline revenue is not capital.
Funded-asset replacement, expansion priority and financing-gap definitions are unchanged.

For annual volume 1 million m³, tariff 1→1.2, and collection 80→90%:

| Enabled | Collected revenue | Additional cash | Collection cash | Tariff cash |
|---|---:|---:|---:|---:|
| Neither | 800,000 | 0 | 0 | 0 |
| Tariff only | 960,000 | 160,000 | 0 | 160,000 |
| Collection only | 900,000 | 100,000 | 100,000 | 0 |
| Both | 1,080,000 | 280,000 | 100,000 | 180,000 |

Previously, combined additional cash was 300,000: a 20,000 overstatement.

## Presentation, exports and verification

Collection and tariff remain separate bands with unchanged labels, colors,
chart types and cumulative order. Coverage and financing effects use successive
full model results, not cash proxies. Signed marginal results are retained.
Tariff includes the interaction under collection-first attribution.

Changed implementation groups: `model/utility_revenue.py`, input schemas and
adapters, water/sanitation/engine wiring, the revenue-base editor/reconciliation
component and app persistence paths, live/dashboard contribution calculations,
CSV/XLSX and deck attribution, regression fixtures, and utility-revenue tests.

The API and forecast exports expose baseline/scenario collected revenue and both
utility cash streams. CSV and XLSX use the dashboard/deck's global intervention
order. The added utility tests cover worked examples, annual identities,
capital counted once, zero/full collection, zero volume, adverse/invalid inputs,
separate schedules, growth, migration conflicts, equivalent anchors, reloads,
BAU stability, sector separation, and cumulative outcome/export reconciliation.
Existing financing-ledger and funded-asset regressions remain in the test suite.

The initial tariff/collection implementation did not add demand elasticity,
general operating accounts or a new reinvestment assumption. Subsequent optional
connection feedback and NRW reconciliation are described below.

## Optional connection revenue: baseline and new customers

Connection revenue is a baseline modeling choice for BAU and scenarios, not an
intervention. Each calculation pass uses its own delivered household flows.
Water/sanitation and urban/rural configurations remain independent.

Version 3 separates the baseline SM/Basic billed shares from the percentages
of **new** Basic connections and SM upgrades that receive a bill. Baseline shares
and household share of billed volume calibrate annual consumption; changing
future percentages cannot recalibrate consumption or rewrite historical results.
Legacy version 1/2 settings inherit their baseline billing shares and retain
their per-m³ cost basis without numerical changes.

Billed-household equivalents are tracked as accumulated stocks. Basic entries
join the billed Basic stock; SM upgrades remove their proportionate prior Basic
billing status and add the selected SM billing status. An upgrade is not an
entirely new customer. Newly delivered Basic households cannot upgrade in the
same year. Closing stocks bill in the following year and incur recurring cost
with the same lag. Signed reductions in billing and reference-related cost
savings remain signed.

### Operating cost choices

Only one cost basis is authoritative:

- **Existing unit cost:** annual household cost = calibrated annual consumption
  × the existing real-currency cost per m³. This is a unit conversion.
- **Manual annual household cost:** divide by positive calibrated consumption
  to obtain the compatible effective cost per m³ for reconciliation.
- **Average operating cost used as a proxy:** deliberately select compatible
  baseline-year annual expenditure in raw real local currency, explicitly
  allocate it to households, and divide by baseline billed households in raw HH.
  A billed-volume share is only an accepted allocation assumption, not known cost
  allocation. The saved snapshot preserves scope, year, currency and allocation;
  changes to its source invalidate it until deliberately refreshed.

The average proxy includes fixed costs and is not necessarily marginal. Unbilled
households may also incur costs. These options do **not** constitute a complete
utility operating account. Missing expenditure or zero placeholders do not imply
zero operating cost. Positive annual cost with zero household consumption
requires compatible calibration; valid legacy non-household-only cases remain
supported.

### Reference, reforms and NRW

Additional recurring cost uses billed households minus the household equivalents
already included in the funding reference, not total volume with non-household
sales. Funding-reference confirmation remains required. Fixed, existing
volume-growth and explicit annual household-volume reference options remain
available; public-only funding needs explicit reconciliation.

Collected cash uses the revenue year's baseline rates when reforms are off and
their scheduled rates when on. Billing participation is distinct from collection
efficiency, and cost is not discounted by collection efficiency. Connection,
collection, tariff and NRW contributions reconcile once to additional collected
cash less recurring costs and implementation cost.

NRW physical-origin households remain distinct from the positive incremental
billed equivalents attributable to each actual NRW upgrade. Tagged overlap uses
that source pool's prior billing mix and follows the same lag; unrelated delivery
does not become NRW overlap. Overlap costs move between source labels once.
NRW implementation costs remain in signed NRW net cash, including in the selected
loan-source pool. Only the combined selected pool is floored. Connection cash
itself is not a loan-selectable source, and no loan-created revenue increases its
own frozen no-loan sizing reference. No repayment or target-ceiling change is
introduced here.