# Replit instruction — Correct false basic gaps from safely managed overachievement

## Starting point and scope

Implement this change in the current Replit development version. Assume these two earlier corrections are already implemented:

1. Available capital is credited once in the financing-gap calculation.
2. Annual planned expansion, outstanding unfunded expansion and funded asset stock are tracked separately. Only funded assets generate subsequent replacement costs.

Preserve those corrections. This instruction is an incremental change, not a replacement for the previous work. Create a checkpoint, inspect the current implementation, implement the necessary changes, run the tests below, and report the results. Do not publish automatically.

Do not apply an earlier patch file or rebuild the accounting model from an older repository version. If the current ledger already handles this issue correctly, preserve it and correct only the remaining calculations, labels or outputs. If either prerequisite is missing, identify that specifically rather than silently applying a second version of it.

## 1. Intended behaviour

Treat service targets as minimum achievements. Safely managed (SM) service satisfies the basic minimum. Therefore:

- SM overachievement can offset a corresponding basic-only target shortfall.
- Basic overachievement cannot offset an SM shortfall.
- Preserve the original annual targets and target interpolation for reporting.
- Preserve mutually exclusive coverage categories in charts: SM, basic only, limited, unimproved and no service.
- Assess gaps within each modeled geography and year before aggregation. Do not offset one geography's deficit with another geography's surplus.

Use household counts internally, consistent with the current engine. Use the same year's projected household total for targets and coverage; convert to population using the existing conversion only when reporting requires it.

### Example of the issue

There are 100 households. Targets are 70 SM and 30 basic only. The simulation achieves 80 SM and 20 basic only.

The old basic-only calculation gives `max(0, 30 - 20) = 10`. That is an artifact: all households already have at least basic service. Requiring 80 actual SM plus 30 basic would imply 110 households in mutually exclusive categories.

The corrected basic expansion gap is zero. Any legitimate existing-asset replacement shortfall remains separately reportable.

## 2. Add or reuse one shared service-gap function

Use descriptive field names; the short names below are pseudocode:

```python
# For one sector, modeled geography and year:
# H = projected total households
# S, B = projected SM and basic-only households after that year's flows
# Ts, Tb = original annual SM and basic-only targets

sm_surplus = max(0.0, S - Ts)
effective_basic_target = max(0.0, Tb - sm_surplus)
basic_only_gap = max(0.0, effective_basic_target - B)
sm_gap = max(0.0, Ts - S)

# Distinct metric used for entry into the service ladder:
at_least_basic_target = Ts + Tb
at_least_basic_coverage = S + B
at_least_basic_gap = max(0.0, at_least_basic_target - at_least_basic_coverage)
```

Validate nonnegative finite values, `Ts + Tb <= H`, `S + B <= H`, and reconciliation of all exclusive coverage categories to `H`, within a documented floating-point tolerance expressed in the model's units. With valid inputs, `effective_basic_target <= H - S`. Handle tiny numerical residues consistently; surface materially invalid inputs or flows instead of concealing them by clipping totals or scaling coverage.

The effective basic target is a derived diagnostic. Do not write it back into the original target pathway, feed it into target interpolation, or use it to lower the original combined at-least-basic objective.

## 3. Distinguish reporting gaps from expansion transitions

**Do not simply replace every basic-cost input with `basic_only_gap`.** The exclusive basic category can meet its target while further SM upgrades require new lower-to-basic entries to maintain total access.

Example: targets 70 SM / 30 basic; actual 60 SM / 30 basic / 10 below basic. The exclusive basic gap is zero, but there is a 10-household SM gap and a 10-household at-least-basic gap. Under the existing staged pathway, completing the targets requires 10 lower-to-basic entries and 10 basic-to-SM upgrades. These are two distinct transitions with their existing respective costs.

The current ordinary budget-funded pathway uses previous-year pools for both purchases. Preserve that rule and the configured budget split. Do not introduce direct lower-service-to-SM connections or a same-year double upgrade in this change.

For financing purposes:

- Basic-entry requirements follow the combined SM-plus-basic objective.
- SM-upgrade requirements follow the SM objective.
- A basic-to-SM upgrade changes the exclusive categories but leaves total at-least-basic coverage unchanged.
- A lower-to-basic entry increases at-least-basic coverage once.
- External or physical service contributions must receive the appropriate service credit once under the existing corrected ledger, without becoming a second cash injection.

## 4. Integrate with the existing annual expansion ledger

Inspect how the prior correction records annual commitments, delivered transitions, early delivery, cancellations and closing outstanding households. Reuse those mechanisms.

If the ledger already measures planned basic entries using growth in `target_SM + target_basic`, and credits actual lower-to-basic deliveries, it may already avoid this false financing gap. **Do not subtract SM surplus from that combined commitment or subtract it again from its closing balance.** The combined objective already accounts for the service hierarchy.

For a ledger based on baseline coverage and cumulative deliveries, a useful reconciliation under the existing no-deterioration flow assumptions is:

```python
required_sm_upgrades = max(0.0, Ts - baseline_SM)
required_basic_entries = max(0.0, Ts + Tb - baseline_SM - baseline_basic)

outstanding_sm = max(0.0, required_sm_upgrades - cumulative_SM_upgrades)
outstanding_basic_entries = max(
    0.0, required_basic_entries - cumulative_lower_to_basic_entries
)
```

This illustrates a reconciliation, not an instruction to replace the implemented ledger. Verify that its baseline and delivery definitions match the actual coverage flows. Under those assumptions, closing outstanding basic entries should reconcile to `at_least_basic_gap`, and closing outstanding SM upgrades to `sm_gap`. Investigate discrepancies rather than forcing balances to agree by erasing costs.

Retain the prior accounting rules:

- Annual additions come from the phased original targets, not repeated booking of the entire standing gap.
- Outstanding genuine expansion carries forward in households and is repriced at current applicable unit costs.
- Early delivery remains credited in subsequent years; target reductions are handled explicitly.
- Credit available funding once through the existing mechanism.
- Do not capitalize unpaid expansion or generate replacement on it.
- Preserve actual funded asset stock and its legitimate replacement requirements.
- Preserve the treatment of ancillary costs, non-household costs and external contributions. Review a cost if it was attached solely to a spurious expansion obligation; do not erase unrelated costs.
- Do not sum annual closing backlog snapshots into a cumulative financing requirement.

Recalculate results from inputs so any legacy artificial basic backlog is removed through corrected logic. Do not add an arbitrary negative financing adjustment. Refresh any persisted or cached calculated outputs affected by the changed semantics, preserving original user inputs and scenarios.

## 5. Outputs and affected code

Locate the current equivalents of `sector_bau` in `model/water_supply.py`, the expansion ledger, scenario output mapping in `model/engine.py`, service-level attribution, dashboards and CSV/Excel/PowerPoint exports. Filenames are navigation hints; use the current Replit implementation.

Expose or clearly label:

- Original SM and basic-only targets.
- Projected SM and basic-only coverage.
- SM overachievement and the effective basic requirement.
- Remaining SM gap, adjusted basic-only gap, and at-least-basic access gap.
- Outstanding expansion costs by transition, plus replacement and other shortfalls under the existing corrected accounting.

Use **At-least-basic access gap** for the basic-entry measure used in costing. If showing **Basic-only target shortfall after SM credit**, make clear that it is a diagnostic rather than the complete basic-entry cost driver. Do not silently change an API field's meaning: update all consumers and document the change, or add an explicit field.

Keep original target markers and exclusive service shares in coverage charts. A tooltip or note can explain: “Safely managed coverage above its target counts toward the basic minimum.” No population should be moved between categories solely to make a chart match its target.

Apply the gap logic to BAU and intervention scenarios. Toggling interventions must not alter the BAU counterfactual. Because water and sanitation share core code, apply the hierarchy consistently where the same minimum-service interpretation holds and test both sectors.

## 6. Preserve intervention behaviour in this change

The reviewed model had SM ceilings in NRW and affordability calculations. This gap correction must work wherever overachievement already occurs; it does not require a blanket change to intervention delivery.

Do not add an SM target ceiling or downgrade achieved SM households to protect basic targets. Preserve existing intervention eligibility, physical capacity, allocation and cost assumptions for this incremental fix. Report existing target ceilings and any inconsistency they cause as a separate finding. Removing them across interventions requires a separate review of combined source-pool limits and financing effects.

## 7. Required acceptance tests

Use these as household counts; scale them consistently if the engine uses millions. For the first five rows, total households are 100 and original targets are 70 SM / 30 basic.

| Projected SM / basic | Effective basic target | Basic-only gap | SM gap | At-least-basic gap |
|---|---:|---:|---:|---:|
| 80 / 20 | 20 | 0 | 0 | 0 |
| 80 / 15 | 20 | 5 | 0 | 5 |
| 60 / 40 | 30 | 0 | 10 | 0 |
| 60 / 30 | 30 | 0 | 10 | 10 |
| 100 / 0 | 0 | 0 | 0 | 0 |

Also verify:

1. **Partial coverage target:** 60 SM / 30 basic targets and 70 SM / 20 basic coverage produce no remaining gap at either threshold, while 10 households remain below basic as allowed by this target.
2. **Financing integration:** with no ancillary or other shortfalls, 80/20 against 70/30 produces zero outstanding connection expansion cost. In 80/15, five lower-to-basic entries remain, priced once at the applicable basic-entry cost. In 60/30, ten basic entries and ten SM upgrades remain under the staged costing convention.
3. **Replacement remains:** a fully achieved service target with unpaid replacement reports that replacement shortfall. SM overachievement must not clear it or reduce actual asset stock.
4. **Across years:** start at 70/30 with a constant 70/30 target, then fund ten eligible basic-to-SM upgrades to reach 80/20. Outstanding basic entries remain zero in that year and the next. Use a valid budget and retain the funded additions in asset accounting.
5. **Real unmet access remains:** with target 70/30 and coverage 80/15, fund five lower-to-basic entries later. The genuine five-household balance closes once, and the basic-only category becomes 20 without any further obligation to restore it to 30.
6. **Population and units:** growing household totals, exact target achievement, zero basic target and floating-point boundary cases reconcile. Invalid totals are detected. Five exclusive categories still sum to total households.
7. **Aggregation and scenarios:** geographic deficits are aggregated after local assessment; surplus elsewhere does not erase them. Exercise water, sanitation, BAU and intervention output paths, including an existing path that permits SM overachievement.
8. **Regression:** rerun the established tests for funding credited once, annual expansion carry-forward and funded-stock replacement. Confirm dashboard and exported totals reconcile with the corrected backend results.

Zero outstanding household gaps do not by themselves imply zero total financing gap when legitimate ancillary, replacement or other previously defined obligations remain.

## 8. Completion report

Provide a concise account of:

- What was already correct in the prior ledger and what this change modified.
- Files and output fields changed, including any changed field meanings.
- Before-and-after results for the 70/30 target and 80/20 projection, plus the genuine-shortfall examples.
- Tests run and their results.
- Any remaining intervention ceiling or source-pool issue identified for separate work.

Leave the tested development version ready for review. Do not publish automatically.
