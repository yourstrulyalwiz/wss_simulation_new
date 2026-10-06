# WSS Simulation Tool — simplified loan injection

Implementation instructions for Replit Agent · 6 October 2026

Reviewed repository: `yourstrulyalwiz/wss_simulation_new`, branch `main`, commit `8a89257526b3019e542ade0ac4ee6c3d89efc077`. This is a proposed change, not an implemented patch.

**Task for Replit Agent:** Implement the simplified borrowing workflow specified below. First compare your working code against the reviewed commit and preserve any newer unrelated changes. Use the existing infrastructure investment engine for a single loan injection, make the associated UI/export changes, and verify the acceptance checks. Report the files changed, numerical example, tests run and any remaining limitations. This instruction supersedes earlier requirements for start-year cash protection, iterative loan resizing and full-maturity repayment verification in the active borrowing workflow.

## 1. Agreed outcome

Replace the current complex utility borrowing calculation in the active workflow with an indicative loan calculator. The user selects a year, revenue sources, allocation percentage, annual interest rate and loan term. Calculate one loan amount from the intervention-only cash flows in that year and inject that amount once into infrastructure funding in the same year.

Principal repayments, interest expenses, financing fees and debt-affordability verification are deferred. The interest rate is used to calculate the indicative principal; it does not trigger cash deductions in this version. The allocation percentage is a hypothetical annual servicing commitment used for sizing, not a deduction from available funding.

Use this visible qualification in the calculator, Results and exports:

> Indicative loan proceeds — repayment accounting deferred. Loan sizing uses the selected year's additional net cash and assumes equal annual repayments. Principal and interest payments are not deducted from model funding in this version.

This produces a gross financing scenario. It must not be described as verified affordable borrowing, free financing, or a net benefit after financing costs. Ordinary intervention revenue remains in the model's funding stream because repayments are explicitly deferred.

## 2. What the code already provides

| Current implementation | Proposed treatment |
| --- | --- |
| `model/utility_debt.py`: `solve_scenario()` calculates a no-debt reference, tests repayment capacity and reruns loan candidates | Replace its active sizing path with the simple formula and one financed rerun. Preserve the caller contract or update all callers together. |
| `model/water_supply.py`: shared `sector_bau()` accepts `utility_debt_execution` | Reuse this injection mechanism. Sanitation already uses the same core. |
| Restricted proceeds opening balance, disbursement, investment used and closing balance | Retain. Unspent proceeds are a balance carried forward, not a new annual loan. |
| `model/engine.py`: independent BAU/scenario passes and `scenario_` outputs | Retain. Calculate borrowing from the intervention-only reference. |
| Debt controls and annual preview | Simplify to the inputs and diagnostics below. |
| Results exclude debt by default and can include configured borrowing | Retain the optional workflow; update labels to explain indicative loan funding. |
| Per-area/sector loans and national aggregation | Retain independent calculation before aggregation. |

Two findings from the code review are relevant:

1. `frontend/src/resultsLedger.ts`, lines 138–141 at the reviewed commit, reads unprefixed BAU cash, debt-service and restricted-cash arrays even in scenario mode. Fix this in the same change so the calculated injection appears in available funding.
2. The existing iterative solver can stop below a feasible principal, or return zero after an oversized trial even when a smaller loan is feasible. The simplified mode bypasses that solver; there is no need to repair its optimization as part of this task. Any future reactivation needs a separate correction.

The preceding review ran all 112 existing backend tests and selected frontend ledger/debt-view checks successfully. Those tests do not establish the new specification: add the focused acceptance checks in section 10.

## 3. Inputs and revenue pool

Provide these controls independently for each entered geographic area and sector:

| Control | Rule |
| --- | --- |
| Include indicative borrowing | Optional; default off for new configurations. |
| Reference year / loan injection year | One forecast year after baseline and within the model horizon. The same year supplies revenue and receives the loan. |
| Eligible intervention sources | Collection efficiency, tariff reform and NRW-related net cash only. Checkboxes select sources; they do not enable interventions. |
| Revenue allocation | One percentage of the combined selected pool, from 0% to 100%. |
| Annual real interest rate | Explicit finite nonnegative input, consistent with the model's constant-price monetary basis. Zero is valid; blank is not zero. |
| Loan term | Explicit positive whole number of years. Do not cap the term at the simulation end: it is a sizing assumption, not an instruction to extend simulation. |

The year selected is a snapshot of annual incremental cash from all selected active reforms in that year. It is not cumulative revenue, the year-on-year change in revenue, or only the revenue from reforms newly launched that year. A reform that has not yet generated cash contributes zero.

Use the reference result with the requested interventions active and utility loans disabled:

| Source | Raw sector-calculation field | Merged engine output field |
| --- | --- | --- |
| Collection | `collection_cash[y]` | `scenario_collection_cash[y]` in the no-loan result |
| Tariff | `tariff_cash[y]` | `scenario_tariff_cash[y]` in the no-loan result |
| NRW | `nrw_net[y] + eligible_nrw_link_cash[y]` | Corresponding `scenario_` fields in the no-loan result |

The existing NRW mapping includes eligible water-NRW-linked sanitation revenue where applicable; do not count the linked amount twice. Preserve the existing collection/tariff interaction attribution; do not recompute each intervention in isolation and sum inconsistent stand-alone results.

Exclude standalone `connection_net_cash`, baseline gross utility collections, financial commitments, exogenous injections, household microfinance, grants, custom intervention cash and capital-efficiency effects from the eligible pool. They can still operate elsewhere in the ordinary scenario. Existing optional customer-based billing may influence collection/tariff incremental cash; this does not make standalone connection cash a selectable source.

Sum selected signed net flows, then apply a zero floor to the total. For example, collection +6 and NRW −2 produce a pool of 4, not 6. Do not floor each source before summing. Missing required source data is an error/unavailable result; a valid modeled zero is zero.

The pool is incremental cash net of the costs already modeled for each intervention, not a complete audited operating surplus. No additional operating-cost assumptions are introduced.

## 4. Formula

Let `y` be the selected year, `S` the selected sources, `R[s,y]` each source's additional annual net cash, `a` the allocation share, `r` the annual real interest rate and `N` the term in years.

```text
signed_pool = sum(R[s,y] for s in S)
eligible_pool = max(0, signed_pool)
annual_allocation = a * eligible_pool

if r == 0:
    loan = annual_allocation * N
else:
    loan = annual_allocation * (1 - (1+r)^(-N)) / r
```

This is the present value of equal annual end-of-year payments, with the first hypothetical payment one year after disbursement. There is no grace-period option or repayment-structure selector in the simplified workflow.

Use a numerically stable calculation for small positive rates:

```python
factor = term if rate == 0 else -math.expm1(-term * math.log1p(rate)) / rate
principal = annual_allocation * factor
```

Validate finite inputs and output. Reject fractional terms rather than silently truncating them. The model uses millions of local currency: an annual pool of 10 means 10 million, and the resulting principal is also in millions. Do not multiply the result by another million. USD conversion remains presentation-only.

Examples, in millions of the same currency:

| Signed eligible pool/year | Allocation | Rate | Term | Annual allocation | Indicative principal |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 10 | 50% | 5% | 10 | 5 | 38.608674646 |
| 10 | 50% | 0% | 10 | 5 | 50 |
| 4 (6 minus 2) | 50% | 5% | 10 | 2 | 15.443469858 |
| 0 or negative | 50% | 5% | 10 | 0 | 0 |

Do not apply the current `min(eligible revenue, available capital minus replacement)` protection, later-year capacity limits, post-target extrapolation, a loan ceiling, or replacement-feedback resizing. These belong to the deferred affordability model. Later revenue growth does not increase this loan. Later revenue declines do not reduce it in this simplified version.

## 5. Backend execution and cash accounting

Recommended execution sequence:

1. Validate ordinary model inputs and run the intervention-only reference with loans disabled. Keep the reference unchanged. For cross-sector inputs such as recovered NRW volume, use the consistent no-loan water reference when sizing sanitation borrowing.
2. Read the selected year's source cash, calculate the signed pool, annual allocation and principal exactly once.
3. Construct the execution plan below. Do not call the existing repayment-schedule generator, because it would populate repayment arrays.
4. Run the existing sector calculation with that plan once. Preserve normal investment splits, transition eligibility, funded-asset accounting and optional connection-revenue feedback.
5. Return the financed result and frozen sizing reference with explicit indicative-mode metadata.

```text
loan_amount = L
disbursement[t] = L if year[t] == y else 0
principal_payment[t] = 0 for every model year
interest_payment[t] = 0 for every model year
debt_service[t] = 0 for every model year
```

Those zero execution arrays mean no deductions are applied in this version. They do not mean the loan has no contractual repayment obligations. Reporting must say 'not modeled' for repayment costs, not 'zero cost'.

The shared sector ledger already computes:

```text
restricted_cash_available[t] = opening_unspent_loan_cash[t] + disbursement[t]
closing_unspent_loan_cash[t] = restricted_cash_available[t] - actual_loan_funded_investment[t]
```

Use that path. Do not also add the principal to `available_total`, the financial-commitment intervention, custom cash or the exogenous-injection intervention. That would credit the loan twice. `available_total` remains ordinary cash; total available funding in reporting combines ordinary cash and restricted loan cash.

Retain the existing priority of ordinary cash for current replacement, with loan proceeds funding eligible expansion/ancillary investment through the existing loan channel. This is an infrastructure-funding injection, not a new general mechanism for settling legacy replacement shortfalls.

Keep normal replacement generated by newly funded assets. Removing replacement from loan sizing does not remove replacement from the underlying infrastructure model. Similarly, connection-based revenue may respond to delivered assets, but must not feed back into sizing this same loan.

The simplified loan must not change any year before its injection. After injection, future available funding, replacement and coverage may change through ordinary model feedback. The remaining financing gap need not fall by exactly the face value of the loan: proceeds may be unspent, delivery constrained, and assets create replacement needs.

## 6. Configuration and output contract

Suggested versioned configuration, retaining the existing `utility_debt` container:

```json
{
  "schema_version": 2,
  "water": {
    "enabled": true,
    "mode": "indicative_lump_sum",
    "disbursement_year": 2030,
    "revenue_sources": ["collection", "tariff"],
    "allocation_share": 0.5,
    "annual_real_interest_rate": 0.05,
    "loan_term_years": 10
  }
}
```

The numbers above are examples, not defaults to insert into user profiles. Apply equivalent configuration to sanitation and each independent area. New blank rate or term inputs remain blank.

For old saved configurations, preserve source selection, year, allocation and rate. If no explicit new term exists, derive `loan_term_years = maturity_year - disbursement_year` when this is a valid positive integer. This preserves the overall old time span while the simplified formula assumes no grace. Otherwise leave the term unresolved and explain the missing input only when borrowing is enabled. Preserve original legacy values as inactive metadata for future recovery. Grace, equal-principal choice and ceiling must not silently affect simplified sizing. Use a small informational note on migrated records explaining this change; an extra approval flow is unnecessary.

Disabled borrowing, an empty source selection or zero allocation must not block ordinary results because a rate/term is blank. Preserve and validate ordinary country inputs. Validate supported source keys, duplicate selections and finite percentages rather than silently correcting malformed input.

Return explicit fields such as:

```text
schema_version: 2
mode: indicative_lump_sum
status: indicative / disabled / zero_allocation / no_selected_sources / no_positive_pool
repayment_accounting: deferred
feasibility_status: not_assessed
reference_year, disbursement_year
reference_source_cash: {collection, tariff, nrw}
selected_signed_pool
eligible_pool
allocation_share, annual_allocation
annual_real_interest_rate, loan_term_years, annuity_factor
indicative_principal
annual_injection: [{year, disbursement, opening_unspent_proceeds,
                    investment_from_loan_proceeds, closing_unspent_proceeds}]
```

Existing consumers use `accepted_principal`. It may temporarily alias `indicative_principal` for compatibility, but UI/export labels must say 'Indicative loan proceeds'. Do not set `verified_feasible=true`; ideally replace the binary feasibility field with `feasibility_status`. If an old consumer requires the boolean, use false together with the explicit 'not assessed' status rather than treating it as a failed affordability test.

Do not return an apparent amortization schedule, zero total financing cost, or a fully repaid loan. Update consumers to use the annual injection/cash ledger. Preserve backend zero payment arrays only where required by the execution contract. The backend is the single source of the formula and principal; the frontend formats its outputs.

## 7. Concrete file changes

| File(s) | Required change |
| --- | --- |
| `model/inputs.py` | Versioned indicative mode and `loan_term_years`; retain legacy fields only for migration/future use. |
| `demo_adapter.py`, `calculation_setup.py` | Defaults, legacy normalization and enabled-only borrowing validation. Preserve saved data and missing-versus-zero distinctions. |
| `model/utility_debt.py` | Pure formula helper, reference-year source extraction and injection-only plan. Replace/bypass iterative solver in the active workflow. Separate indicative summary from repayment-capacity reporting. |
| `model/engine.py` | Preserve independent BAU/reference/financed runs; attach revised summary and existing cash arrays. Ensure cross-sector reference consistency. |
| `model/water_supply.py`, `model/sanitation.py` | Reuse shared injection/carry-forward behavior. Change only necessary interface plumbing; no replacement-priority or transition rewrite. |
| `frontend/src/components/DebtServicingControls.tsx` | Year, source checkboxes, allocation, real rate and term; remove active grace, maturity, structure and ceiling controls. Retain optional enable and inherited investment mix. |
| `frontend/src/components/UtilityDebtPreview.tsx` | Display reference-year source amounts, signed pool, annual allocation, formula factor and indicative principal; show proceeds-use ledger instead of repayment verification. |
| `frontend/src/components/DebtServicingPanel.tsx`, `frontend/src/App.tsx` | Rename relevant product labels to 'Loan funding' / 'Indicative borrowing'; keep the existing step and coverage comparison. |
| `frontend/src/resultsLedger.ts` | Correct scenario cash-field selection; show loan injection and carried proceeds accurately. |
| `frontend/src/components/ResultsLedgerPanel.tsx`, `ResultsDashboard.tsx`, `LiveInterventionChart.tsx`, `frontend/src/resultsDebtMode.ts` | Preserve include/exclude behavior, independent intervention contributions, signed comparison and defaults; replace repayment language. |
| `deck_data.py`, `deck_aggregate.py` | Update debt contribution labels and aggregate additive indicative amounts and cash rows; preserve area-specific terms. |
| `export_data.py`, `export_deck.py`, `export_pptx.py` | Export revised assumptions and proceeds-use ledger; remove feasible-loan, debt-service and total-interest claims in indicative mode. Both PowerPoint exporters must be covered. |
| `.agents/memory/utility-debt-policy.md`, `docs/financing-ledger.md`, relevant help text | Record the newly agreed simplification and deferred repayments so later work does not reinstate the old behavior inadvertently. |

### Required funding-table correction

In `ledgerSnapshots()`, use the already-defined `prefix` consistently:

```typescript
const operatingCash = optionalAt(sec, prefix + 'available_total', index);
const debtService = scenario
  ? optionalAt(sec, prefix + 'utility_debt_service', index) : 0;
const restricted = scenario
  ? optionalAt(sec, prefix + 'utility_debt_cash_available', index) : 0;
```

Under indicative mode, the debt-service execution array is zero. Ordinary cash and restricted loan cash must still come from the same scenario as its paid-investment rows. Retain the existing separation of whole-sector funding, service-specific actual applied funding, and unspent/shared cash. Do not invent a Basic/SM split of all available cash.

Show new loan proceeds separately from opening unspent loan proceeds. Repeated availability of an unspent balance is valid; adding that balance as new borrowing in successive years is not. Total loan proceeds over the horizon equals the principal exactly once.

## 8. Proposed user interface

Use one compact calculator:

1. Reference year / injection year.
2. Revenue source checkboxes with their modeled annual net cash for that year.
3. Pooled net cash, allocation percentage and hypothetical annual servicing allocation.
4. Annual real interest rate and term in years.
5. Prominent result: 'Indicative loan proceeds: [amount]'.

Below it, show the qualification from section 1 and an annual proceeds-use table with year, new injection, opening unspent proceeds, loan-funded investment and closing unspent proceeds. Retain coverage comparison against the intervention-only scenario, labeling it 'With indicative loan funding' versus 'Without loan funding'.

Remove or hide grace, repayment structure, principal ceiling, binding constraint, protected revenue, tightest repayment year, headroom and 'verified feasible' badges. These are not part of the requested calculator.

Keep Results defaulting to loan funding excluded. Explicit inclusion must flow consistently into tables, charts and live exports, without deleting saved loan settings. The dedicated Loan funding stage shows the enabled indicative scenario directly.

## 9. Geography, exports and scope limits

Calculate Urban and Rural separately, for water and sanitation separately. National totals sum their actual annual injections and cash balances. Do not pool one area's negative revenue against another area's positive revenue before sizing; do not average interest rates or terms. If injection years differ, keep each area's timing. Existing direct-national entry remains its own configured calculation rather than an extra loan on top of an Urban/Rural roll-up.

CSV, Excel, both PowerPoint export paths and per-table downloads must use the same calculated principal and include the repayment-deferred qualification. New monetary fields need the existing currency-conversion handling; years, rates, factors and terms must not be currency-converted. Do not display missing/not-modeled repayment data as zero financing cost.

This change does not resolve deferred replacement accounting, ancillary calibration or the full-versus-incremental SM upgrade price convention. Keep their existing qualifications. It does not add new eligible sources, a second investment split, multi-year disbursement, revolving borrowing, or a second selectable advanced debt mode.

## 10. Acceptance checks

1. **Formula:** pool 10, share 0.5, rate 0.05, term 10 produces 38.608674646 million within numerical tolerance. At zero interest it produces 50. Check small positive rates approach the zero-rate result smoothly.
2. **Selected signed pool:** selected +6 and −2 produce pool 4 and principal 15.443469858 at 50% / 5% / 10 years. Empty sources, zero share and nonpositive pool produce zero injection, not a solver failure.
3. **Validation:** blank active terms are visibly incomplete; invalid source keys, NaN, negative rates, allocation outside 0–1 and fractional/nonpositive terms fail clearly. Disabled borrowing with blank terms leaves ordinary Results usable.
4. **Frozen reference:** increasing loan allocation does not change the reference source cash used to size that same loan. Altering future-year cash after the reference year does not alter principal if the selected-year pool is unchanged. No future cash checks or post-target sizing assumptions execute.
5. **One injection:** across all model years, the sum of disbursements equals L, with exactly one nonzero year for positive L. All earlier financed outputs equal the no-loan outputs.
6. **Deferred repayment:** execution principal, interest and service deductions are zero in every year. No separate subtraction of annual allocation occurs. UI/exports say repayments are deferred, not free or already repaid.
7. **Cash identity:** opening unspent proceeds + new injection = loan-funded investment + closing unspent proceeds every year. A constrained-delivery case carries cash forward without another disbursement or duplicate availability credit.
8. **Infrastructure behavior:** existing Basic/SM allocation, delivery constraints, replacement on funded assets and optional connection revenue still operate. Do not assert gap reduction must equal principal or all future outcomes must be monotonic.
9. **Funding-field regression:** use distinct BAU/scenario ordinary cash and a nonzero scenario injection. Assert scenario funding uses scenario ordinary cash, injection/carry balances and actual spending; BAU retains its own values. This must test expected source values, not merely a self-reconciling frontend bridge.
10. **Geography/sector:** different areas/sectors with different terms and injection years retain independent sizing; National sums without averaged rates or an additional National loan.
11. **Migration/results/export:** round-trip new settings; load legacy annuity/equal-principal/grace/ceiling records with the documented inactive-field treatment; verify default excluded view and explicit included view across charts, table downloads, CSV/XLSX and both PPTX paths.

Update existing integration tests that expect affordability constraints or repayment deductions in the active workflow. Legacy pure schedule tests may remain for preserved inactive utilities, but must not force the simplified path to generate repayment schedules. Run the relevant regression suite and frontend build. Verify the loan-enabled browser flow after implementation.

## 11. Suggested delivery order

1. Add/normalize configuration and implement the formula plus injection-only execution plan.
2. Wire the no-loan reference and financed rerun; fix scenario funding fields.
3. Simplify controls, preview and Results labels.
4. Update aggregation, exports and policy/help documentation.
5. Run focused acceptance tests and existing relevant regressions, then verify the browser flow.

The completed change should let the user select a year's intervention cash, set allocation/rate/term, and immediately see one indicative loan injection contributing to infrastructure funding, with repayment accounting explicitly deferred.
