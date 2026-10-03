# Replit Agent instruction: remove duplicate capital credit

Implement the following targeted fix in `yourstrulyalwiz/wss_simulation_new`. Reference reviewed: `main`, commit `6422f29`. Inspect the current code first and adapt to any subsequent changes.

## Objective and scope

Correct the financing-gap accounting for both water and sanitation, in both BAU and intervention calculations. Available capital must receive credit only once. Preserve the existing coverage projections, targets, intervention cash generation, unit costs, replacement requirements and asset-stock calculations in this patch.

Do not introduce actual-delivery shortfalls or backlog tracking. The separate issue of repeatedly costing a standing service gap across years is outside this patch. Do not claim that this change resolves annualization of investment requirements.

## Existing issue

In `model/water_supply.py`, shared function `sector_bau`:

1. Around lines 709–733, `avail` pays replacement first and the balance finances connections.
2. Around lines 855–863, the model prices the remaining target-minus-projected household gap as `nc_total`.
3. Around lines 874–876, it sets `total_need = nc_total + replacement`, then subtracts the full `avail` again.

The new-service component already reflects connections financed by available capital. Subtracting the full funding pool gives that capital a second credit. The same problem reaches service-level attribution through `attribute_gap(..., avail, ...)`.

## Required accounting change

Use a **residual funding requirement** for this targeted correction: cost of the remaining service gap, plus replacement still unfunded, plus any negative net cash balance.

Do not simply remove all funding credits: replacement already financed must still be recognized. Record the replacement funding reserved by the existing coverage calculation, without changing that calculation. In the current code, the following is the proposed accounting convention:

```python
# All amounts are in the same model money units, for year t.
replacement_reserved = min(max(avail, 0.0), max(bau_replacement[t], 0.0))
replacement_credit = min(replacement_reserved, max(replacement[t], 0.0))
unfunded_replacement = max(replacement[t] - replacement_credit, 0.0)
cash_deficit = max(-avail, 0.0)

financing_gap[t] = nc_total + unfunded_replacement + cash_deficit
```

Retain the existing forecast-year gating and non-negative gap convention. The two replacement series have different stock bases; retain them and expose their distinction. Cap the credit at the replacement obligation being reported. Do not transfer excess replacement credit or the full capital pool to residual new-service needs. Keep unspent positive capital visible separately where relevant; it is not an automatic second financing credit.

For service attribution, allocate replacement credit proportionally to the existing safely managed/basic replacement obligations. Each service gap equals its residual new-service cost plus its unpaid replacement and its allocated share of the cash deficit. Allocate that deficit once, using the existing need-share convention and investment-split fallback when needs are zero. The two service gaps must sum to the sector gap.

## Outputs and labels

Update `model/engine.py` mappings, `model/gap_attribution.py`, dashboard tables and CSV/Excel/PowerPoint consumers as needed. Expose replacement credit and cash deficit explicitly. Preserve API fields where practical, but correct their descriptions; do not silently present residual needs as gross requirements.

Replace any displayed identity stating that the corrected gap equals residual new-service cost plus replacement minus total available capital. Use:

**Remaining financing gap = residual new-service cost + replacement requirement − replacement credit + cash deficit.**

Keep total available capital and capital used to generate connections available for reporting, separately from the credits applied in this residual ledger. Ensure per-intervention gap reductions use the corrected engine outputs. Revisit tests that currently enforce the old accounting identity rather than preserving that identity merely to pass them.

## Acceptance tests

Add deterministic tests with no population growth, non-household costs, adders or other interventions. Use 100 required upgrades, enough eligible basic households, a $1,000 unit cost, all expansion funding directed to safely managed service, and equal BAU/target replacement obligations:

| Available capital | Replacement obligation | Funded upgrades | Remaining financing gap |
| ---: | ---: | ---: | ---: |
| $40,000 | $0 | 40 | $60,000, not $20,000 |
| $40,000 | $10,000 | 30 | $70,000 |
| $5,000 | $10,000 | 0 | $105,000 |
| $0 | $10,000 | 0 | $110,000 |
| −$5,000 | $10,000 | 0 | $115,000 |

Also test unequal replacement series, basic/safely managed attribution, and a fully funded target with excess capital. Verify water and sanitation; toggles off must give matching BAU/scenario gaps, and toggles must not change BAU. Compare pre/post results to confirm household paths, costs and intervention cash streams are unchanged. Check that dashboards and exports agree with the engine.

Run the existing Python tests and frontend build. Report changed files, test results and a before/after example. Implement and validate in development; do not publish as part of this instruction.
