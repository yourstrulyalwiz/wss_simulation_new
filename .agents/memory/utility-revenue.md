---
name: Utility revenue scope and default reconciliation
description: Standing boundaries for collected-revenue changes and intentional default conflict.
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

The built-in sanitation example must require reconciliation when opened; do not
choose either conflicting legacy volume automatically.

**Why:** The user explicitly selected “Require reconciliation when the example
opens” instead of either legacy volume.

**How to apply:** Keep production defaults unresolved. Regression fixtures may
explicitly select a base, but must not change the real default to make tests pass.