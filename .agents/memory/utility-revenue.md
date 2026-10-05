---
name: Utility revenue scope and default reconciliation
description: Standing boundaries for collected-revenue changes.
---
For narrow tariff/collection maintenance, keep exogenous volume growth and do
not introduce additional connection feedback incidentally. The user subsequently
authorized a separately configurable connection-based baseline feature; see
connection-revenue-policy.md. Preserve separate collection and tariff contributions,
collection first in the full existing order, with the interaction attributed to
tariff. Do not change NRW benefits as part of these revenue fixes.

**Why:** The user explicitly scoped this correction to tariff/collection
interaction while preserving financing, funded-asset and service-target fixes.

**How to apply:** Reject proposals to merge the contributions or introduce
elasticity, general operating accounts or new reinvestment assumptions as incidental
improvements. The optional connection feature's explicit marginal-cost adjustment
is separate from a general operating-cost account.

Automatic revenue-base reconciliation should be silent. Shared revenue input
entry and its correction controls belong on the first Data Inputs page, directly
after Budget, following the existing sector toggle and the selected area.
Do not show a revenue-input message at the top of the application.

**Why:** The user explicitly asked to replace the top message with a revenue
section after Budget, using the existing Water Supply / Sanitation toggle.
They still need direct access to the inputs without errors elsewhere in the
model preventing entry; valid legacy fallback should not require manual action.

**How to apply:** Preserve automatic migration and input validation. Keep
canonical shared bases available for both first-page editing and intervention
editing. Show local field errors in the revenue section, preserve independent
sector/area values, and do not reintroduce a top reconciliation panel.

Recovery must be explicit and preserve entered custom revenue values, including
zeros and partially completed inputs. Never silently overwrite an invalid
custom base with legacy values.

**Why:** A missing value and an intentional zero are different. Validation
failure does not give permission to replace user work.

**How to apply:** Offer user-initiated recovery for entirely unfilled drafts;
keep partially entered custom bases editable rather than resetting them.
