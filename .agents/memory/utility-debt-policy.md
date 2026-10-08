---
name: Utility debt eligibility scope
description: User-confirmed net-revenue interpretation and exclusion of connection revenue.
---

Use incremental net revenues, not the entire utility revenue account, for
utility borrowing. Selectable sources now include collection efficiency, tariff
reforms, NRW reductions and connections. Preserve existing selections without
automatically adding the newly supported connections source.

**Why:** The 2026-10-08 instruction explicitly supersedes the earlier exclusion:
baseline-rate reconciled connection receipts are an optional source, without
connection operating costs. It does not authorize repayment or resizing changes.

**How to apply:** Keep the separate optional connection-based baseline model
unchanged. Explain modeled net-cash assumptions rather than claiming a complete
or audited utility operating surplus. Borrowing is incremental financing, not
a lender credit assessment.

## Loan-start sizing and workflow boundary

Size one indicative loan injection from the selected year's signed, selected
intervention cash pool in a frozen no-loan reference. Floor the sum at zero,
then apply allocation and the ordinary annuity present-value factor. The same
year receives the injection. Repayment accounting, fees and affordability
verification are deferred: neither annual allocation nor interest/principal
payments deduct cash in this version. Do not restore start-year capital
protection, future-year checks, ceilings or iterative resizing.

**Why:** On 2026-10-06 the user's simplified-loan specification explicitly
superseded the earlier affordability constraints and full-maturity repayment
verification. This is an indicative gross financing scenario, not free finance
or verified affordable borrowing.

**How to apply:** Keep Intervention Design as the intervention-only stage and
 Loan funding as the separate fourth workflow stage, with Results fifth.
Show the same intervention contributions plus signed debt effects, and leave
new-connection receipts eligible only when explicitly selected.

## Optional debt and ordinary Results

Debt servicing is optional. Users may go straight from Intervention Design to
Results without visiting the fourth stage. Disabled or absent borrowing must
preserve all standard graphs, summaries, tables, scope controls and exports;
unused blank loan settings must not become prerequisites for ordinary results.
Results must open with debt excluded, even when an enabled loan is saved in
either area. Including configured borrowing is an explicit view choice.

**Why:** The user explicitly clarified that tab 4 is an option and that, without
it, "every outputs like previously should appear in results dashboard."
They subsequently requested that Results default to without debt servicing.

**How to apply:** Keep ordinary-input validation strict, but separate it from
enabled-loan validation. Excluding debt from a Results view must not erase saved
loan terms or interventions, and its live exports must use that same debt choice
across all entered areas. Report genuine calculation failures clearly; do not
silently keep stale charts or fabricate missing intervention contributions.
