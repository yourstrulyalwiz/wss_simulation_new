---
name: Utility debt eligibility scope
description: Frozen sizing with optional connections and fixed repayment obligations.
---

Use incremental net revenues, not the entire utility revenue account, for
utility borrowing. Selectable sources now include collection efficiency, tariff
reforms, NRW reductions and connections. Preserve existing selections without
automatically adding the newly supported connections source.

**Why:** The 2026-10-08 instruction explicitly supersedes the earlier exclusion:
baseline-rate reconciled connection receipts are an optional source, without
connection operating costs. The later funding/repayment specification activates
fixed annual deductions without authorizing iterative resizing or affordability optimization.

**How to apply:** Keep the separate optional connection-based baseline model
unchanged. Explain modeled net-cash assumptions rather than claiming a complete
or audited utility operating surplus. Borrowing is incremental financing, not
a lender credit assessment.

## Loan-start sizing and workflow boundary

Size one indicative loan injection from the selected year's signed, selected
intervention cash pool in a frozen no-loan reference. Floor the sum at zero,
then apply allocation and the ordinary annuity present-value factor. The same
year receives the injection. Fixed annual principal/interest obligations start
the following year through maturity. Actual payments use only originally selected
sources after proportional loss absorption, before pooled replacement. Unselected
cash remains available for replacement/expansion even with unpaid scheduled service.
Keep full contractual schedules beyond the modeled cash horizon.
Fees and affordability verification remain excluded. Restricted proceeds cannot
pay service or replacement. Do not restore start-year capital protection,
future-year checks, ceilings or iterative resizing.

**Why:** On 2026-10-06 the user's simplified-loan specification explicitly
superseded the earlier affordability constraints and full-maturity repayment
verification. The 2026-10-08 follow-on expressly supersedes deferred repayment:
scheduled debt service remains fixed even when future ordinary cash is insufficient.
The later consolidated attribution instructions restrict actual payments to selected
sources without resizing or forgiving obligations. This is not verified affordable
borrowing; report unpaid principal/interest without invented catch-up or penalties.

**How to apply:** Keep Intervention Design as the intervention-only stage and
 Loan funding as the separate fourth workflow stage, with Results fifth.
Show the same intervention contributions plus signed debt effects, and leave
new-connection receipts eligible only when explicitly selected.

## Optional debt and ordinary Results

Debt servicing is optional. Users may go straight from Intervention Design to
Results without visiting the fourth stage. Disabled or absent borrowing must
preserve all standard graphs, summaries, tables, scope controls and exports;
unused blank loan settings must not become prerequisites for ordinary results.
Results now opens with configured indicative borrowing included. This uses only
loans actually enabled in the saved area/sector; it must not enable absent or
disabled loans. Excluding configured borrowing remains an explicit view choice.

**Why:** The user explicitly clarified that tab 4 is an option and that, without
it, "every outputs like previously should appear in results dashboard."
The later Results workspace redesign explicitly superseded the loan-excluded
default: coverage, capital/funding, sector funds, ledger and exports should open
with indicative loans included consistently.

**How to apply:** Keep ordinary-input validation strict, but separate it from
enabled-loan validation. Excluding debt from a Results view must not erase saved
loan terms or interventions, and its live exports must use that same debt choice
across all entered areas. Report genuine calculation failures clearly; do not
silently keep stale charts or fabricate missing intervention contributions.

## Results workspace

Use Tab 3/4's numbered left navigation, long-form reading area, background,
contextual headings and scope/sector toggles. Order: coverage graphs; final
scenario capital requirements and available funding; sector available funds
with a BAU-style table; sector ledger; attributed coverage by source; summary
flows as collapsible tables. Remove separate financial-needs graphs and annual
revenue details from Results without removing their underlying calculations.

**Why:** The user requested a consistent Tab 5 workspace and this specific
presentation order, with configured indicative borrowing included by default.
**How to apply:** Keep all displayed outputs and exports on the same chosen loan
mode. Preserve the sanitation counterpart, actual-source stock attribution,
disabled-loan ordinary results and missing-data validation.

Results initially follows the current editing area, rather than automatically
switching multi-area projects to National; its subsequent scope selection is
independent.

**Why:** Otherwise a valid active sector can appear unavailable simply because
another area's sector inputs are incomplete. National still requires both areas.
**How to apply:** Show area-specific validation reasons for incomplete results,
and never substitute an active area's partial totals for National.

## Loan Funding workspace

Apply Intervention Design's layout to Loan Funding: left numbered navigation,
adjacent loan-settings panel, and an independent long-form graph/table body with
matching background, contextual headings and coverage KPI cards. Hide settings
when Graph or Coverage Comparison is selected, without clearing entered terms.
Show coverage and Sector Available Funds with explicit marginal loan effects,
then the loan-adjusted coverage comparison, then a single Loan Cash Flow &
Repayment section combining proceeds use and the repayment schedule by year.
The combined ledger is always expanded, with wrapping headings and a readable
nonwrapping Year column. **Why:** The user removed the dropdown interaction.
Hide unfunded interest,
unfunded principal, unfunded debt service, new injection/disbursement and
investment-from-proceeds columns in this combined table.
**Why:** The user requested a simplified unified table without those repeated or
unfunded-payment columns. This is a display simplification, not permission to
forgive debt or assume unmodeled revenues/payments.
Do not include the requirements-versus-funds chart here.
Tables start after the baseline (2026 in the current example); the combined
ledger stops at loan maturity, including contractual years beyond the forecast.
Beyond modeled years cash-flow cells remain unavailable. Without an active loan,
use the simulation period.

**Why:** The user requested Tab 3's layout for Tab 4 while replacing its content
with the borrowing comparison and optional detailed schedules.
**How to apply:** Compare matched interventions without/with loan, never BAU as
the no-loan substitute. Distinguish new injection, actual payments and restricted
carry; carry is a balance, not additional annual funding. Preserve negative
marginal effects and missing values, with exports following displayed semantics.
