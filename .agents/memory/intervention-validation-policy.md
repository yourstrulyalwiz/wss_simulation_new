---
name: Intervention input semantics
description: Required blanks, explicit zeros, local messages and paused controls.
---
Active intervention blanks must not acquire defaults; valid explicit zeros must
survive edits, conversion and calculation. Errors and zero-review notices belong
only inside the consuming intervention box, not page/chart banners or alerts.
Draft saves remain available. Existing paused custom interventions stay paused.

**Why:** The user requested the full intervention-input validation specification,
including correction of downstream zero/default substitutions.

**How to apply:** Validate raw payloads at calculation/export boundaries before
conversion; maintain independent sectors and projections; keep internal
counterfactuals distinct from user drafts. Do not reintroduce zero-fee SM-cost
fallbacks or rescale external injections.
