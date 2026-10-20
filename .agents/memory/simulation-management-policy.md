---
name: Simulation management product requirements
description: Seed preservation, institutional identity, scope and publication rules for the requested landing page.
---
Feature the saved DRC October 12 and October 13 bundles as TWO separate DRC
simulations, alongside the saved Nepal Kathmandu Valley profile, as read-only
examples with private owned copies for editing. Do not substitute one DRC
version for the other or substitute Nepal frontend defaults; retain other legacy sources separately.
Keep DRC's illustrative-data notice.

**Why:** The user explicitly selected these sources for the simulation-management
transition, rather than the newest file or the current default session.

**How to apply:** Follow the attached WSS Landing Page and Simulation Management
brief dated 2026-10-15. Preserve source payloads and test lossless editor migration.

Scope-aware dispatch and validation routing are approved, but underlying model
calculations must not change. Either sector may run for one area or Urban + Rural.
**Why:** After clarification, the user explicitly approved independent sector/area
selection without unrelated inputs blocking it, while protecting the equations.
**How to apply:** Skip inactive sectors and their validation without changing
active formulas, assumptions, or outputs. Preserve dormant data and configured
NRW linkage; deactivate linkage effectively while water is excluded. Missing
active inputs still get accurate validation, not invented values.
Legacy sanitation revenue can depend on shared billed-water anchors even when
water delivery is excluded. Retain only the shared sanitation dependencies, not
unrelated water interventions, until a canonical sanitation revenue base exists.
**Why:** Removing all water-labeled fields changes legacy sanitation revenue,
which violates the calculation-preservation requirement.

Projects own drafts, versions, comparison scenarios and editable sector/area
scope. Excluded data stays dormant; new areas must not inherit urban observations.
Verified institutional identity owns private projects. Public access refers to a
selected immutable version, never ongoing autosaves or excluded dormant data.
Initially restrict public viewing to signed-in World Bank users. Administrators
have read-all access, not automatic edit-all access.
The intended application login is WB institutional SSO.

Temporary rollout exception: login is deactivated, and everyone who can access
the production application can select and view published simulations and featured
examples. Do not expose private drafts, version history or anonymous write access.
Keep the authentication implementation available to re-enable later.

**Why:** The user requested deployment without login for now while keeping
simulation selection available to everyone accessing the production application.

**Why:** These are explicit privacy and preservation requirements in the user's
brief, not just gallery presentation choices. The user explicitly requested WB
SSO login/identification.

**How to apply:** Enforce permissions and effective calculation/export scope on
the server. Confirm institutional SSO configuration before claiming it works;
verified email fallback is not equivalent to institutional SSO. Country metadata
selection must never silently calibrate costs, GDP, currency or service data.
