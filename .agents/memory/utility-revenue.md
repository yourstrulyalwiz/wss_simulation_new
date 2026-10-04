---
name: Utility revenue scope and default reconciliation
description: Standing boundaries for collected-revenue changes.
---
Keep volume growth exogenous; revenue feedback from new connections is separate
future work. Preserve separate collection and tariff contributions, collection
first in the full existing order, with the interaction attributed to tariff.
Do not change NRW benefits as part of tariff/collection fixes.

**Why:** The user explicitly scoped this correction to tariff/collection
interaction while preserving financing, funded-asset and service-target fixes.

**How to apply:** Reject proposals to merge the contributions or introduce
elasticity, operating costs, new reinvestment assumptions or connection feedback
as incidental improvements to this work.

Automatic revenue-base reconciliation should be silent. Only actual failures
should show inline errors with a way to correct the inputs. Users must be able
to minimize the correction details while keeping a compact warning visible.

**Why:** The user approved hiding automatic reconciliation in production while
retaining genuine input errors; valid legacy fallback is not a reason to ask
users to reconcile values manually. They also requested minimization because
the correction panel occupied too much app space.

**How to apply:** Preserve automatic migration and input validation. Do not
reintroduce a loading/reconciliation popup, silently accept invalid bases, or
leave users without correction controls when a saved profile is invalid.

Recovery must be explicit and preserve entered custom revenue values, including
zeros and partially completed inputs. Never silently overwrite an invalid
custom base with legacy values.

**Why:** A missing value and an intentional zero are different. Validation
failure does not give permission to replace user work.

**How to apply:** Offer user-initiated recovery for entirely unfilled drafts;
keep partially entered custom bases editable rather than resetting them.
