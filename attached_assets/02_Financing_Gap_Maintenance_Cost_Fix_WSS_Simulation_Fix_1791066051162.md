# Replit Agent instruction: annual expansion, outstanding funding and replacement costs

## Task

Implement the agreed accounting correction in the current WSS Simulation Tool development project. This instruction **supersedes `Replit_Financing_Gap_Fix.md`** and combines the available-capital double-counting correction with the expansion/asset-stock correction.

Work from the current Replit code. Do not assume the previously supplied patch has been applied, and do not apply it automatically. If the earlier narrow fix has already been implemented, integrate this design with it rather than layering a second adjustment over it. Create a development checkpoint first. Implement, test and report the changes; do not publish automatically.

## Agreed model behavior

The annual target pathway already phases coverage progress across years. It determines new planned expansion each year. Expansion that funding cannot cover remains outstanding until financed. **Unfunded expansion must never enter asset stock or generate replacement costs.** Funded expansion is assumed delivered within the year; no separate delivery-failure or construction-delay model is required.

Apply this consistently to water and sanitation, BAU and intervention scenarios, and urban/rural/national reporting. Preserve the existing target interpolation, intervention revenue assumptions, technology costs and investment-split controls except where a change is necessary for this accounting correction.

## 1. Separate annual additions from outstanding expansion

For each service transition, maintain:

- New expansion scheduled by the annual target pathway.
- Opening outstanding expansion.
- Expansion financed/delivered this year, identifying sector-funded and externally funded/physical contributions.
- Closing outstanding expansion.

In the simple case:

```text
Expansion due this year = opening outstanding expansion + new planned expansion
Closing outstanding expansion = expansion due − expansion delivered
```

Track outstanding expansion in households by service transition and reprice it at the applicable year's effective unit costs. Account for advance delivery and target reductions explicitly; never produce negative balances or charge for previously delivered service again.

Calculate annual new requirements from changes along the target pathway, not each year's entire target-minus-projected coverage gap. Preserve service transitions: basic-to-safely-managed upgrades reduce exclusive basic counts, so basic additions cannot be inferred from positive changes in basic counts alone. Reconcile basic additions, SM upgrades and lower-service households using the existing transition and unit-cost conventions.

## 2. Apply available funding once

Within each forecast year:

1. Calculate replacement obligations on opening funded assets.
2. Allocate available capital to replacement first, by each service level's replacement obligation.
3. Allocate remaining capital to expansion using the configured basic/SM split and existing transfer/eligibility rules.
4. Record delivered expansion and reduce the outstanding household balance accordingly.
5. Report unused capital separately where eligible expansion cannot absorb it.

Do not subtract the full capital pool again after funded connections have already reduced outstanding expansion. Distinguish capital spent from capital credited against currently due target requirements, including when the model delivers service ahead of targets.

Loans/grants or physical NRW improvements may also close service gaps. Record their contribution once; do not add their service value to sector cash as another financing injection. Preserve the existing NRW cash calculation and distinguish physical upgrades that reuse infrastructure from new funded assets.

## 3. Correct the replacement-cost base

Use opening **existing and funded expansion assets**, with the existing asset-life/replacement-rate inputs. Add financed expansion to stock once, with replacement beginning the following year. Do not add planned requirements or outstanding funding balances to stock.

For this simplified version, use gross funded capital as the replacement-cost proxy. Replacement maintains existing assets and does not create an additional asset of the same value. Report unpaid replacement on existing assets as a separate annual shortfall; do not infer asset deterioration or service failure. Document this assumption and any consequent change from the previous stock convention.

Inspect ancillary/treatment capital adders already in the engine. Keep their units and purpose explicit, avoid booking the same outstanding obligation as a new cost each year, and capitalize only paid amounts. Do not silently turn fixed costs into per-household charges or remove legitimate obligations.

## 4. Separate flows and balances in every output

Expose these concepts clearly in engine results, dashboard tables/charts and CSV/Excel/PowerPoint exports:

| Output | Treatment |
| --- | --- |
| Annual planned expansion cost | New scheduled work; sum annual flows |
| Annual replacement requirement | Funded opening assets × replacement rate; sum annual flows |
| Catch-up requirement before funding | Opening outstanding expansion at current costs + new work + current replacement; do not sum snapshots |
| Closing outstanding expansion | Remaining household/ancillary obligation; use the closing balance |
| Annual unpaid replacement and negative cash | Separate annual shortfalls; count each once |
| Endline financing requirement | Closing expansion + replacement/cash shortfalls accumulated over the analysis period |

Do not sum yearly outstanding balances to produce a cumulative financing gap. For subperiods, explain whether an opening balance is included; adjacent period-end balances are not additive. Distinguish a year-end balance from an annual flow in labels and units.

Keep SM/basic attribution reconciled to the sector total. Derive intervention gap reductions from the corrected scenarios. Remove any old formula or label that subtracts total available capital from a requirement already net of funded expansion. Avoid silently changing API field meanings: add explicit fields or document and update all consumers.

## 5. Acceptance tests

Use controlled examples with constant prices and no unrelated costs:

- **Single-year double credit:** 100 required connections at $1,000 each; $40,000 finances 40. Remaining expansion is $60,000, not $20,000.
- **Carry-forward:** $20m new expansion scheduled annually and $12m funded annually produces closing balances of $8m, $16m and $24m. Total planned expansion is $60m; funded expansion is $36m. The outstanding expansion is $24m, not the $48m sum of snapshots.
- **Replacement:** $100m existing funded stock, 10% replacement rate and $50m available capital means $10m replacement and $40m expansion. Closing gross stock is $140m and next-year replacement is $14m. Unfunded expansion contributes nothing to stock.
- **No funds:** outstanding expansion grows with newly scheduled work; it produces no new assets or replacement obligations.
- **Catch-up funding:** later funding reduces the carried household balance; the same requirement is not counted again as new planned work.

Also test both sectors, basic/SM transitions, changing unit costs, target reductions, surplus/negative capital, replacement-only shortages, external/physical service contributions and geographic aggregation. Toggling interventions must not change the BAU counterfactual.

Run existing tests and the frontend build; check API calculations and exports against the new ledger. Update tests that encode the obsolete accounting identity. Return changed files, assumptions, test results and a before/after numerical example. Flag remaining unrelated issues separately.
