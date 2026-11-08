# Post-intervention options

Visible Tab 6 is an isolated analysis workspace; Slide Deck is visible Tab 7 but retains its original internal navigation identity. No new deck slides are generated.

## Saved state and calculations
- Only the optional `bundle.postIntervention` overrides are saved. Opening the tab does not create settings or mark a draft modified. Reset removes overrides, restoring the complete original schedules, not just the last target.
- The loan inclusion choice is shared with Results and Slide Deck in `presentation.includeDebt`. Existing disabled loan configurations remain disabled.
- Revised paths linearly interpolate SM and at-least-basic shares from baseline to the selected in-horizon year. They do not rewrite country data, baseline coverage, original targets or intervention parameters. When all baseline households are already at least basic, a diagnostic lower-tier remainder goes to Limited, with a visible explanation.
- Reference loan principal and repayment plans are frozen before revised targets or additional funding are introduced. Sanitation replays use the resulting water NRW volumes.
- Additional funding enters the existing source allocation system after public execution/capital-share adjustments. It is not eligible to service debt restricted to selected original revenue sources.
- The residual is closing household expansion, ancillary work, replacement backlog and accumulated cash shortfalls. These reconcile to the existing endline requirement. Annual closing balances are not summed. Historical cash shortfalls do not acquire a new repayment rule.

## Solver and reporting boundaries
`POST /api/post-intervention` accepts `{bundle, settings?, includeDebt}` under the same identity/project-header policy as existing calculations. Published example access is preserved; private access is not bypassed.

The schedule starts in baseline+1 and ends in the selected target year. Each active area/sector receives a constant fraction of one national real-GDP path. The bounded search checks zero first, expands a bracket, checks residual monotonicity and bisects a tested feasible upper bound. It verifies the final dependent-sector replay before exposing funded coverage.

Current limits: 100% of GDP per bucket, 38 trial evaluations per bucket, 24 bisections, 20 seconds per request, 120 modeled years, two concurrent calculations. Browser requests stop waiting after 30 seconds. One-household tolerance is `1e-6` million households. Financial tolerance is the larger of `1e-6` million local currency and `1e-9` times the zero-additional-funding residual. The display rounds verified funding shares upward.

These are verified schedule equivalents, not globally optimal investment strategies or allocated-budget recommendations. A deadline, nonmonotonic response, delivery restriction, invalid inputs or outstanding financial component cannot produce a successful full-gap headline. Different GDP copies suppress the GDP equivalent while preserving independently valid residuals. Missing constituents are never zero.

Only complete verified full-project results produce a combined funding percentage. A known combined unfunded residual can still be displayed when a funding solution is unresolved. Available, used and unused amounts are reported separately; unspent availability is not executed spending.

## Verification
- Controlled 100-household fixture: 40 SM initially, target 60 SM/100 at least basic over two years, 1,000 LCU per upgrade, GDP 1 million LCU annually. Verified funding is approximately 1% of GDP annually within declared tolerances.
- One-year below-basic→SM target does not become feasible merely by increasing cash.
- Tests cover untouched-schedule parity, lower/zero/invalid targets, independent sectors, conflicting GDP, bounded failure, selected-source debt restrictions, frozen fixed loan plans, publication filtering and input non-mutation.
- Existing residual, service-gap, replacement, source, debt, revenue and sector-independence regression suites passed.
- UI reference: existing Intervention Design, Loan Funding and Results tabs. Chromium checks cover 1440/1024/390 layouts, edited/loading/error/read-only states, stale responses, display-only selection isolation, legacy Slide Deck navigation and saved override restoration.
- The actual public example route and API were checked without bypassing authentication. Signed-in production saving was not exercised; browser interaction/persistence tests use isolated in-memory fixtures.
