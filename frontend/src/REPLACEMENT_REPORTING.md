# Replacement settlement reporting

Reporting-only changes; the model is the sole owner of replacement settlement.
Existing WSS layout, chart geometry, fonts, colors and no-animation charts are preserved.

## Authoritative inputs

For BAU (no prefix), `scenario_`, and `scenario_without_utility_debt_`, consume:

- `eligible_capital_after_losses_debt`: nonnegative pooled capital after current losses and funded debt charges.
- `replacement_backlog_opening`: previous year's closing backlog; a snapshot.
- `replacement_capex`: current requirement, unchanged.
- `replacement_current_paid`: current provision paid; a flow.
- `replacement_backlog_paid`: payment against opening arrears; a flow.
- `replacement_paid_total`: current plus backlog paid; a subtotal, not another payment.
- `replacement_backlog_closing`: net closing liability; a snapshot.
- `ordinary_expansion_available`: authoritative pooled residual after both replacement stages.

Matching replacement `_by_service` arrays preserve actual SM/basic obligations. Do not
allocate old obligations using today's expansion split. Missing reporting data is
unavailable, not zero; service shares are never invented.

`replacement_reserved`, `replacement_credit`, `replacement_credit_by_service`,
`funded_by_service`, and `replacement_funding_applied_by_service` remain **current-only**.
They must not be used as total replacement spending. Old prior/accumulated aliases
are retained in the snapshot schema for compatibility but no longer define displayed
replacement liabilities.

## Reconciliation

```text
opening backlog + current requirement
    = current paid + backlog paid + closing backlog

funding applied
    = total replacement paid + sector expansion paid + external expansion paid

financing_gap
    = closing expansion + closing replacement backlog + current cash deficit

endline_financing_requirement
    = closing expansion + closing replacement backlog + accumulated cash shortfalls
```

Current unpaid replacement is already in closing backlog; do not add it again.
Expansion is already net of payments; do not subtract those payments a second time.
Historical operating/debt cash shortfalls keep their existing accumulation convention:
they are not settled by backlog payments.

The source requirements subtotal includes pre-funding household/ancillary expansion,
opening replacement backlog, current replacement and current cash shortfall.
Historical cash shortfalls are excluded. Engine `catch_up_requirement` is read directly
in existing forecast/export tables; the results ledger explicitly adds current cash
shortfall to its pre-funding subtotal. `total_investment_need` is only the legacy residual
expansion plus current replacement subtotal, not a complete backlog-inclusive requirement.

## Funding restrictions

Replacement-first applies to pooled eligible capital. Restricted loans remain expansion
only, with ordinary-cash-first purchase attribution and unused loan carry preserved.
Earmarked household microfinance/grants and noncash delivery may support connections
while pooled backlog remains. Physical NRW delivery is not cash. No frontend operation
pays arrears, creates assets, transfers funding between areas, or changes coverage.

Source-funding v2 has separate `replacement_current_charge` and
`replacement_backlog_charge`; `replacement_charge` is their total, **not an additional
charge**. Source-ledger `replacement_paid` stays current-only; `replacement_paid_total`
includes arrears. Eligible pooled capital and opening/paid/closing backlog totals are
propagated through aggregation. Mixed v1/v2 source contracts are unavailable rather
than silently combining different semantics. Coverage-attribution version remains 1.

## UI, downloads and periods

- BAU annual chart retains its existing layout and current requirement bars.
  Its caption and chart export headers explicitly exclude opening backlog.
- BAU tables include collapsible annual reconciliation, independently by area and total.
- Results technical audit includes BAU/scenario/without-loan waterfalls for each area,
  plus selected-scope totals. Source-ledger detail includes service payments and snapshots.
- Annual waterfall tables export CSV and Excel through the existing export/validation
  layer, retaining selected display currency. Payment subtotals are clearly labelled.
- Whole-scenario exports append all three variants' explicit settlement fields, service
  fields, existing expansion/ancillary/unused amounts and restricted-loan use/carry.
  New monetary values retain engine precision; missing values are blank.
- PowerPoint investment data and dashboard period tables sum payment flows, use each
  period's opening backlog once, and use the final year's closing backlog once.
  They never sum closing liabilities as an investment requirement.

## Verification commands

```sh
node frontend/src/replacement-reporting.test.mjs
python -m unittest discover -s frontend/src -p test_replacement_exports.py -v
cd frontend && npm run build
```

These tests use deterministic in-memory reports and freshly calculated fixtures.
They do not read/write saved user scenarios, publish or deploy.

## PowerPoint

`export_deck.py` investment-slide prose uses the same closing-backlog definitions.
`test_residual_financing_gap.py` checks the generated presentation's new labels and
reconciles the displayed closing expansion, closing backlog and accumulated cash.
The existing dynamic table renderer adds the `deck_data.py` rows and fits the table.
Visual inspection of a rendered PowerPoint remains a separate manual check.
No model files are changed by this reporting task.
