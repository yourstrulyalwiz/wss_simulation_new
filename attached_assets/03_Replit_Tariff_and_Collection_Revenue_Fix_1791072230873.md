# Replit instruction — Reconcile tariff reform and collection efficiency

## Objective and agreed scope

Correct additional utility revenue from tariff reform and collection-efficiency improvements using a shared billed-revenue base. Retain **separate Collection efficiency and Tariff reform contributions in both the financing-gap and coverage-gap charts**, with their existing labels, colours and cumulative intervention order.

Work from the current Replit development version. Preserve the previous corrections to capital double counting, annual expansion and funded-asset replacement, and service-target accounting. Create a checkpoint before editing. Implement, test and report; do not publish automatically.

This change covers tariff and collection interaction only. Keep billed-volume growth exogenous using the existing population or configured fixed-growth approach. Revenue growth from newly connected households will be a separate subsequent change. Do not introduce demand elasticity, a new reinvestment share, new operating-cost assumptions, or changes to NRW benefits in this task.

## 1. Problem

The reviewed code calculated collection cash as billed volume × baseline tariff × improvement in collection rate, but tariff cash as billed volume × tariff increase. The latter treats the tariff increase as fully collected, even when collection is below 100%.

Both interventions also affect the same revenue: improved collection applies to the higher tariff. Their combined effect must reconcile to actual collected revenue. Do not add an interaction term to the old tariff formula; replace the old formula so the same benefit is not counted twice.

## 2. One shared revenue base per sector and modeled geography

Resolve these inputs once, independently of which interventions are enabled:

- Billed volume at a defined reference year and its exogenous growth rule.
- Baseline billed tariff in real local currency per m³.
- Baseline collection ratio, meaning cash collected divided by the amount billed.
- Separate tariff and collection target values and their separate intervention schedules.

Use **billed volume**, not system input volume, for this calculation. Do not deduct NRW again from a volume already defined as billed. Keep water and sanitation revenue bases separate.

### Input consolidation and existing scenarios

The reviewed inputs included separate collection and tariff volumes and baseline tariffs. They can differ. Collection also allowed its own volume growth setting and anchor year. Sanitation collection inherited water collection ratios, derived its volume from water volume and wastewater-collected share, and derived its tariff from a water tariff percentage, while sanitation tariff reform had separate inputs.

Inspect the current equivalents before changing them. Establish one canonical revenue base per sector; both intervention panels must read it. Keep independent target values, start years and target years. A shared base can be displayed in both panels, but edits must update the same underlying value.

For saved scenarios:

1. Use existing canonical fields if the current application already has them.
2. Normalize units and anchor years before comparing legacy revenue bases. Equal numeric volumes anchored in different years are not necessarily equivalent.
3. Migrate equivalent bases automatically. If only one complete base exists, use it and record its origin.
4. Where legacy bases materially disagree, retain the original values and show a concise reconciliation choice identifying the alternatives and units. Require a consistent base before calculating the corrected result; do not silently average values or choose a base according to the enabled toggle.
5. Persist the resolved base and migration/schema version so reloads and cumulative chart passes use exactly the same inputs. Preserve scenario names, original inputs needed for traceability and unrelated settings.

For sanitation, preserve any explicit link to water as a documented input derivation, or materialize the resolved values when appropriate to the current schema. The sanitation engine must receive one consistent sewer revenue base. Water tariff reform must not silently change the sanitation baseline tariff or create a second sanitation tariff benefit. Use sanitation's own reform toggle and schedule. Do not silently assume collection is 100% when the collection intervention is off or its baseline input is missing; zero is a valid collection ratio, not a missing value.

## 3. Annual collected-revenue calculation

For each forecast year, let:

- `Q_t` = billed volume under the shared exogenous volume path.
- `p0` = baseline billed tariff.
- `c0` = baseline collection ratio.
- `p_t` = tariff under the enabled tariff intervention and its schedule, otherwise `p0`.
- `c_t` = collection ratio under the enabled collection intervention and its schedule, otherwise `c0`.

Calculate:

```python
baseline_collected_revenue = Q_t * p0 * c0
scenario_collected_revenue = Q_t * p_t * c_t
additional_collected_revenue = (
    scenario_collected_revenue - baseline_collected_revenue
)

# Cash attribution: collection first, then tariff.
collection_cash = Q_t * p0 * (c_t - c0)
tariff_cash = Q_t * (p_t - p0) * c_t

# Must hold within a documented numeric tolerance:
additional_collected_revenue == collection_cash + tariff_cash
```

Use the existing valid schedule semantics, including forecast gating and ramp behaviour. Tariff and collection can start and finish in different years. Before each reform starts, its applicable value remains at baseline. After it reaches its target, its effect continues under the existing assumptions.

When only tariff is enabled, use `c0` to calculate its collected cash. When only collection is enabled, use `p0`. When both are disabled, additional cash is zero even if the baseline revenue grows with exogenous volume.

Validate finite nonnegative billed volume and tariffs, and collection ratios between zero and one. Preserve the model's supported improvement-only input constraints; do not broaden the model to price cuts or deterioration in this change. If unsupported adverse targets are supplied, make the validation explicit rather than inconsistently clamping separate terms and breaking reconciliation.

Keep unit conversions consistent: if `Q_t` is million m³ per year and tariff is currency per m³, revenue is in currency millions per year. Convert MLD to annual volume once. Keep real-price conventions unchanged.

## 4. Capital accounting

Retain the existing assumption that 100% of additional collected revenue is available for capital investment. Feed `collection_cash` and `tariff_cash` into the current available-capital calculation once. Do not add their sum again as a third cash stream. Baseline collected revenue is a comparison quantity, not a new capital injection.

Preserve replacement priority, the expansion allocation rule, actual funded-asset accounting and the previous financing-gap corrections. Do not apply the public-budget execution multiplier to this utility cash simply because it is now calculated in a shared helper. Preserve the existing treatment of these utility cash streams.

Baseline budget funding and non-tariff interventions remain unchanged in this task. Do not allow toggling tariff or collection reform to mutate the BAU counterfactual or its revenue-base inputs.

## 5. Preserve both separate chart contributions

This is a firm display requirement:

- Keep Collection efficiency and Tariff reform as distinct interventions in **both financing-gap and coverage-gap displays**.
- Keep the existing chart types, intervention labels, colours, service selectors and target/BAU lines.
- Keep the full existing cumulative intervention order, with collection before tariff. Other intervening levers retain their positions.
- Do not merge the two bands, create a third interaction band, or split interaction equally between them.

The revenue interaction `Q_t * (p_t - p0) * (c_t - c0)` is included in tariff cash under the collection-first convention. This is an attribution choice; the combined cash total is independent of display order.

**Chart contributions must still come from model runs**, not by treating raw additional cash as financing-gap reduction or dividing it by a single unit cost to estimate coverage. Replacement, allocation, service pools and target limits can change how cash affects outcomes.

For cumulative run results `R_0, R_1, ..., R_n`, preserve the existing outcome definitions and use successive differences:

```text
Financing-gap reduction from intervention k = gap(R[k-1]) - gap(R[k])
Coverage increase from intervention k = coverage(R[k]) - coverage(R[k-1])
If displaying coverage-gap reduction, use gap_before - gap_after instead.
```

Use the corrected annual/endline financing metric already implemented; do not restore sums of outstanding annual backlog snapshots. With all enabled interventions, marginal contributions must reconcile to the total change from BAU. Do not conceal negative marginal outcomes by clamping them to zero; basic-only coverage can legitimately decline when households upgrade to SM. Preserve or correct signed-value handling as needed for faithful existing displays.

Apply the same order and definitions in dashboard calculations, tables, legends/tooltips and exports. Clarify in a tooltip: “Contributions are incremental in the displayed intervention order. The tariff contribution includes its interaction with collection improvement.” The numerical bands can change after this correction; the separate presentation stays.

## 6. Worked example and expected results

Use annual billed volume of 1,000,000 m³, baseline tariff of 1.00 currency unit/m³, target tariff of 1.20, baseline collection of 80%, and target collection of 90%. Test a forecast year when both schedules have reached their targets.

| Enabled interventions | Collected revenue | Additional cash | Collection attribution | Tariff attribution |
|---|---:|---:|---:|---:|
| Neither | 800,000 | 0 | 0 | 0 |
| Tariff only | 960,000 | 160,000 | 0 | 160,000 |
| Collection only | 900,000 | 100,000 | 100,000 | 0 |
| Both | 1,080,000 | 280,000 | 100,000 | 180,000 |

The joint benefit exceeds the sum of the two standalone benefits by 20,000. This interaction is included in the tariff contribution when both are active. The old formulas would produce 300,000 combined additional cash in this example, overstating it by 20,000.

These are revenue expectations. Do not require financing-gap or coverage contributions to equal these cash values: validate those against the successive full model runs.

## 7. Tests and verification

1. Reproduce all four rows above and verify the revenue identity annually, not just at the endline.
2. Test different reform start and target years. Tariff uses baseline collection before the collection reform, then the applicable improved ratio as that reform progresses.
3. At 100% baseline collection with no collection uplift, tariff cash equals volume × tariff increase. At zero collection with no collection uplift, tariff cash is zero. At zero volume, both cash streams are zero.
4. Test unchanged tariff and unchanged collection targets; the corresponding benefit is zero. Toggling a lever with no effective change must not alter the other's revenue base.
5. Test consistent legacy inputs, differently anchored but equivalent bases, conflicting bases and scenario reloads. All cumulative passes must use the same resolved base and annual volume series.
6. Exercise both water and sanitation, including sanitation's linked legacy inputs. A sector's tariff calculation must use its own applicable billed tariff, volume and collection ratio.
7. Test a growing exogenous volume series. Preserve its population/fixed-growth setting after base reconciliation. New modeled connections must not feed back into `Q_t` in this task.
8. Verify additional utility cash enters available capital exactly once; rerun established financing-ledger and replacement regressions. BAU results must not change when intervention toggles change.
9. Test charts with each lever alone and both together, including another enabled lever between them in the existing order. Confirm both named contributions remain present when nonzero and their marginal outcomes reconcile to the full scenario.
10. Verify UI and export agreement for financing and coverage metrics. Check a case where extra cash cannot produce proportional coverage gains because of replacement needs or an eligible-pool limit.

## 8. Implementation locations and completion report

Inspect the current equivalents of input schemas in `model/inputs.py`, adapters/defaults in `demo_adapter.py`, sector wiring in `model/water_supply.py` and `model/sanitation.py`, scenario mapping in `model/engine.py`, input/intervention panels, `LiveInterventionChart.tsx`, financing dashboards and export modules. Reuse a shared pure revenue helper instead of duplicating the formulas across sectors or chart passes.

Report the changed files, canonical input mapping and migration behaviour, before-and-after numerical example, tests run, and confirmation that the two separate chart contributions remain. Identify any unresolved legacy-input conflicts or adjacent NRW/revenue issue separately. Leave the tested development version ready for review; do not publish automatically.
