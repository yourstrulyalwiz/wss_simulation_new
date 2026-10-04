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

NRW benefits and separate NRW-linked sanitation cash are unchanged. No demand
elasticity, operating-cost model, reinvestment fraction or connection-driven
revenue feedback was introduced. No publishing is part of this change.