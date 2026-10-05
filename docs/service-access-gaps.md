# Hierarchy-aware service access gaps

Safely managed (SM) service satisfies the basic minimum. Coverage remains in five
mutually exclusive categories; original targets and delivered households are not
changed to make a basic-only category match its target.

All fields below are arrays of **million households**, assessed separately for
each geography and year. The corresponding `scenario_` fields describe the
independently calculated intervention pass:

| Field | Meaning |
|---|---|
| `sm_overachievement` | SM coverage above the original SM target |
| `effective_basic_only_target` | Original basic-only target less SM surplus, floored at zero |
| `adjusted_basic_only_gap` | Effective basic-only target less basic-only coverage, floored at zero; diagnostic only |
| `sm_access_gap` | Remaining SM threshold deficit |
| `at_least_basic_target` | Original SM plus basic-only target |
| `at_least_basic_coverage` | Achieved SM plus basic-only coverage |
| `at_least_basic_access_gap` | Combined threshold deficit; lower-to-basic costing driver |
| `scenario_target_hh` | Scenario pass's original five-rung target pathway |

`household_gap_basic` intentionally retains its **legacy raw exclusive-category
shortfall** meaning for compatibility. It is not used to cost basic entries.
`household_gap` and `service_gap` retain their original SM meanings.

Under existing no-deterioration flow assumptions, forecast closing outstanding
SM upgrades reconcile to `sm_access_gap`, and closing lower-to-basic entries
reconcile to `at_least_basic_access_gap`. The existing ledger already uses the
combined objective; no second SM-surplus subtraction or cash credit is applied.

Gaps are assessed locally and then summed. A national gap is therefore not always
the positive part of national target minus national coverage: surplus in one
area cannot erase another area's deficit. Aggregated effective basic-only
targets likewise sum local diagnostics rather than recalculating net surplus.

Validation rejects nonfinite or materially negative values, SM-plus-basic
targets/coverage above total households, and exclusive coverage that does not
sum to total households. The absolute tolerance is `1e-8` million households
(0.01 household); positive gap residues at or below that tolerance are zero.
Validation never rescales coverage or changes target pathways.

Connection-expansion costs follow outstanding transitions, not the exclusive
basic diagnostic. Closing expansion costs may also include legitimate ancillary
obligations. Replacement and cash shortfalls remain separate; endline financing
includes closing expansion plus accumulated financial shortfalls.

Diagnostics are recalculated from inputs on each calculation request; there is
no persistent calculated-result cache to migrate. Saved inputs and scenarios are
preserved. CSV/Excel forecast exports include both passes, and both PowerPoint
export paths include endline service-access reconciliation slides.
