# Replacement backlog reconciliation

Amounts use the existing real million-local-currency basis. Each sector, area
and engine pass owns an independent expansion ledger. Forecast backlog starts
at zero; there is no inferred historical obligation.

The source allocator settles current losses, selected-source debt, current
replacement and opening replacement backlog, in that order. The remaining
ordinary source cash, plus restricted loan cash, funds purchases and ancillary
spending. Loan proceeds and earmarked household finance cannot settle replacement.
Physical NRW delivery is noncash. These restricted/noncash deliveries can occur
while an ordinary replacement backlog remains.

The expansion ledger is the sole owner of the carried replacement balance.
It receives explicit service-level settlement, checks opening balances against
its prior close, and carries opening minus repayment plus current unpaid need.
Current payments follow current asset obligations; backlog payments follow
opening service balances, not the current investment split. Replacement payments
maintain stock, never add stock or household coverage. No deterioration, interest
or cost-intervention repricing of deferred provisions is introduced.

## Compatibility and reporting

- Source funding version 2 splits current/backlog source charges; their sum is
  `replacement_charge`. `replacement_paid` remains current-only.
- `replacement_reserved`, `replacement_credit` and `funded_by_service` remain
  **current-year** replacement payments, not total replacement spending.
- Explicit `replacement_paid_total` includes current and backlog payments.
- `unfunded_replacement` remains the **current annual** unpaid flow.
- Accumulated replacement shortfall now means **net closing outstanding backlog**.
- Combined shortfalls are closing replacement backlog plus accumulated cash
  shortfalls. Historical cash shortfalls continue accumulating without repayment.
- Financing gap = closing expansion + closing replacement backlog + current cash
  deficit. Endline need substitutes accumulated cash shortfalls.
- Catch-up requirement includes prefunding expansion + current replacement +
  opening replacement backlog, excluding historical cash shortfalls.
- Legacy `total_investment_need` retains closing residual expansion plus current
  replacement. It is not a complete prefunding/backlog-inclusive requirement.
- Summaries sum payment flows, not opening/closing snapshots.

Utility debt keeps its existing frozen sizing and selected-source repayment
policy. The underlying scenario simulations now use reconciled funding/stock;
actual loan-use attribution remains ordinary-cash-first and unused loans carry.

## Controlled reproduction (ordinary currency units)

| Year | Eligible cash | Current need | Current paid | Opening backlog | Backlog paid | Closing backlog | Expansion |
|---|---:|---:|---:|---:|---:|---:|---:|
| 2026 | 5,000 | 10,000 | 5,000 | 0 | 0 | 5,000 | 0 |
| 2027 | 25,000 | 10,000 | 10,000 | 5,000 | 5,000 | 0 | 10,000 |

Previously 2027 purchased 15,000 of expansion and left 5,000 unpaid replacement.
Corrected 2027 funded stock is 310,000 and 2028 replacement is 310,000 / 30.
Both sector modes are covered by `test_replacement_backlog.py`.

## Verification and limitations

The Python regression suite, frontend ledger/source tests, deterministic
replacement-export tests, CSV/XLSX/PPT content tests, and public-route browser
tests exercise these balances without writing saved inputs. The browser test
uses in-memory inputs after verifying actual public read access.

Unmodified Oct 12 (including its public saved example) and Nepal repository
profiles could not support a before/after scenario comparison: both old and new
engines reject their missing required revenue assumptions. No replacement
assumptions were silently supplied and no saved inputs were changed. A
representative saved-scenario impact comparison therefore remains unavailable.
PPT content is tested; rendered slide fit has not been visually verified.
