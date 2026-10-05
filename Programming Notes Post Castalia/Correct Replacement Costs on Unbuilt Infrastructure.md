# Correct Replacement Costs on Unbuilt Infrastructure

**Date:** 5 October 2026  
**Status:** Review of the previously implemented correction, verified in the current development code.  
**Scope:** Water supply and sanitation; independent BAU and intervention scenarios; area-level calculations and National aggregation.

## 1. Initial problem

The previous accounting treated the cost of unmet expansion as though it represented constructed infrastructure. That inflated the asset base and generated future replacement requirements on assets that had not been funded or built.

The historical code used:

```text
Closing target asset stock = opening stock + residual expansion requirement
Next-year replacement = opening target asset stock / asset life
```

In particular, `stock[t] = booked + prior_stock + nc_total` added the calculated unmet expansion requirement to stock. The service-level stock attribution similarly added `new_capex_by_service`.

Two errors could follow:

- **Fictitious replacement:** unfunded connections generated replacement obligations.
- **Repeated capitalization:** the same unmet work could remain in successive target-minus-coverage gaps and be added to stock again.

The previous BAU stock also followed a separate depreciating/cash-based convention. Consequently, the stock used for reported replacement obligations could differ from the stock used to reserve replacement funding.

### Terminology

The affected calculation is **replacement capital expenditure**, calculated using asset life. It is not a general operating-maintenance model. The correction should not be described as eliminating all maintenance expenses; separate intervention maintenance costs, such as those associated with NRW reduction, were not the subject of this correction.

## 2. Assessment of the implemented correction

The current code no longer capitalizes unmet expansion requirements.

It separates:

1. **Planned expansion:** new work implied by the annual target pathway.
2. **Outstanding expansion:** work still awaiting funding/delivery.
3. **Funded asset stock:** existing assets plus actual paid expansion.

Replacement is assessed on opening funded stock. Funded expansion is assumed delivered within the year and enters the replacement base **the following year**. Unfunded expansion remains an outstanding obligation, not an asset.

The current replacement calculation and replacement reserve use the same funded-stock base. Water and sanitation share this accounting through `sector_bau`; BAU and intervention scenarios run independently.

**Assessment:** The original unbuilt-infrastructure capitalization problem is corrected in the inspected development implementation. A rising financing requirement does not, by itself, indicate that this error has returned.

## 3. Programming changes

### A. Explicit expansion carry-forward ledger

`model/expansion_ledger.py` tracks opening outstanding households, new planned work, delivery and closing outstanding households separately.

Outstanding work is priced at the applicable year's unit costs. Advance delivery and target reductions are handled explicitly, rather than treating the entire recurring coverage gap as new annual work.

### B. Funded-only asset roll-forward

`model/water_supply.py` now updates gross funded stock using:

```text
Closing funded stock =
    opening funded stock
    + actual sector-funded expansion
    + externally financed expansion
    + paid ancillary capital

Replacement requirement =
    opening funded stock / asset life
```

Actual paid connection purchases add to the corresponding service-level stock. Paid ancillary capital is capitalized once; its unpaid balance is carried separately. Physical NRW service improvements that reuse infrastructure do not create an additional new-connection asset or a second cash injection.

### C. Funding and shortfalls remain distinct

Available capital is allocated to replacement before expansion, subject to the existing allocation rules. Delivered connections reduce outstanding work; the same capital is not subtracted again as a second financing credit.

The agreed simplification uses **gross funded capital**, not a depreciating net-book-value model:

- Replacement maintains existing assets; it does not duplicate their value.
- Unpaid replacement is reported as a shortfall.
- Neither unpaid replacement nor negative cash automatically reduces asset stock or models service failure.

### D. Outputs distinguish annual flows from closing balances

The engine exposes funded stock, funded expansion, planned expansion, closing outstanding expansion, replacement and shortfalls explicitly. The scenario results have corresponding fields, and financing tables/exports distinguish flows from balances.

```text
Year-end requirement =
    closing outstanding expansion
    + unpaid replacement accumulated since baseline
    + cash deficits accumulated since baseline
```

Yearly outstanding-expansion snapshots must **not** be summed. Annual unpaid replacement can accumulate because each year is a separate obligation on existing funded assets.

## 4. Numerical illustrations

### No expansion funding

Suppose existing funded assets are $100 million, the replacement rate is 10%, and $20 million of expansion remains entirely unbuilt.

| Measure | Old formula implication | Correct treatment |
|---|---:|---:|
| Closing asset stock after adding the unmet expansion amount | $120m | $100m |
| Following-year replacement | $12m | $10m |
| Outstanding unbuilt expansion | $20m | $20m |

This is an illustrative application of the historical formula, not a reconstructed DRC before/after run. The $20m expansion obligation remains real; the extra $2m replacement on unbuilt assets is false.

### Funded expansion

With $100m existing stock, a 10% replacement rate and $50m available capital:

- $10m funds replacement.
- $40m funds expansion, where eligible work is available.
- Closing gross funded stock is **$140m**.
- Following-year replacement is **$14m**.

These funded-stock values are verified by the current regression tests in both sector modes.

## 5. Verification and limitations

The review checked the supplied maintenance-accounting instruction, the historical implementation, the current engine/ledger, and `docs/financing-ledger.md`.

**18 targeted tests passed** across:

- `test_expansion_ledger.py`
- `test_residual_financing_gap.py`
- `test_service_gap_attribution.py`
- `test_scenario_gap_composition.py`

Coverage includes funded-only replacement, no-funding and negative-cash cases, expansion carry-forward, catch-up funding, ancillary costs, external/physical delivery, service attribution and geographic reconciliation.

No model code, saved profile or target was changed during this review. Historical DRC financial results were not reconstructed, so this note makes no claim about the numerical size of the earlier DRC overstatement.

**Remaining interpretation limit:** Accumulated unpaid replacement and cash shortfalls are retained; the current accumulator has no explicit later-funding pay-down mechanism. This is separate from the corrected unbuilt-asset problem and matters when interpreting the year-end figure as a current payable balance.

## 6. Summary

**Before:** unmet expansion was added to asset stock, allowing unbuilt work to generate replacement costs and potentially be capitalized repeatedly.  
**After:** only paid expansion creates assets; unbuilt work stays in the outstanding-expansion ledger. Legitimate replacement on existing and funded assets remains.

Source instruction: `attached_assets/02_Financing_Gap_Maintenance_Cost_Fix_WSS_Simulation_Fix_1791066051162.md`.  
Detailed accounting reference: `docs/financing-ledger.md`.
