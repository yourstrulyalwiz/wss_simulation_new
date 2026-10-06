# Replit instruction 1: fix the transition inconsistency

Repository: `yourstrulyalwiz/wss_simulation_new`

## Objective and scope

Correct historical cost-derived BAU investment inference so it uses the same household transitions as the forward model: below Basic to Basic, and Basic to safely managed (SM).

This is a standalone model correction. Ledger presentation and graph changes are specified separately in `Replit_02_Ledger_UI_and_Financing_Graphs.md`.

Keep the current unit-cost inputs and their existing interpretation. The question of incremental upgrade cost versus full SM connection cost is deferred. Preserve NRW/microfinance cap behavior, investment allocation shares, explicit spending inputs, and replacement-priority behavior. The previously issued deferred-replacement correction remains a separate work item; preserve it if already implemented. Do not fold other audit findings into this task.

Read the repository instructions and inspect the current historical cost-derived budget path and the forward transition path before editing. Identify all water/sanitation and urban/rural call sites and any legacy alternate paths. Preserve existing units: where households and money are represented in millions, multiplication by currency per household must retain that convention.

## Transition correction


### Problem

The historical inference counts positive growth in SM households and positive growth in Basic-only households independently. Basic-only growth is not the same as entry into Basic: households upgrading to SM leave the Basic-only category. The forward model represents two transitions: below Basic to Basic, and Basic to SM.

### Required calculation

For adjacent historical observations, let S be SM households, B be Basic-only households, and A = S + B be households with at least Basic service. Use household counts, not percentage-point changes.

```text
sm_upgrades = max(S[t] - S[t-1], 0)
basic_entries = max((S[t] + B[t]) - (S[t-1] + B[t-1]), 0)

historical_expansion_cost =
    sm_upgrades * existing_SM_cost
  + basic_entries * existing_Basic_entry_cost
```

This is a consistent inference under the model's transition convention, not a claim that aggregate historical coverage identifies every household's actual transition. Preserve the existing treatment of declines, historical periods, annualization, prices, replacement costs, units, and budget-growth settings. Only replace the inconsistent transition-count term. Do not add replacement twice.

If Basic input is already an inclusive at-least-Basic measure, use that measure directly for A; do not add SM again. Verify the stored definitions before implementation.

Apply the correction independently to water and sanitation and to each modeled urban/rural area. Aggregate the resulting monetary values afterward. Explicit user-entered spending paths must remain unchanged; only cost-derived paths should change through this correction.

### Controlled checks

Use illustrative costs of 1,000 currency units for each transition:

| Initial S, B | Final S, B | SM upgrades | Basic entries | Expansion cost |
|---|---|---:|---:|---:|
| 100, 200 | 150, 200 | 50 | 50 | 100,000 |
| 100, 200 | 150, 150 | 50 | 0 | 50,000 |
| 100, 200 | 100, 250 | 0 | 50 | 50,000 |
| 100, 200 | 100, 200 | 0 | 0 | 0 |

The first case is the key regression: the old expression counts only 50 SM additions and misses 50 entries into Basic. Under the retained two-stage convention, households entering and then upgrading incur both applicable transition charges. Do not reinterpret the SM unit cost in this change.

Verify the correction reaches the BAU budget derived from these costs and the downstream forecast, and that explicit-budget mode is unaffected. Explain any changed baseline outputs in the completion report.

## Acceptance and handoff

- Add focused regression checks for the four controlled examples above, plus a case with declining coverage to confirm the existing nonnegative-cost convention is retained.
- Verify that cost-derived BAU budget inference and its downstream forecast use the corrected values in each sector and area.
- Confirm that explicit user-entered budget paths do not change, and replacement is neither omitted nor counted twice.
- Reuse an existing shared transition helper if its semantics match; avoid two definitions that can drift apart.
- Update the relevant model documentation to distinguish Basic-only household stocks from entry into at-least-Basic access, and explain the retained cost convention.
- Report changed files, verification results and a before/after example of the effect on cost-derived BAU. Do not claim the unit-cost interpretation has been resolved by this correction.

This file is a programming instruction; producing it does not change repository code.
