---
name: Transition pricing boundary
description: The user has deferred changing SM upgrade unit-cost interpretation.
---

Preserve the existing SM and Basic-entry unit-cost meanings when correcting
historical transition inference. Whether an SM upgrade should cost an incremental
upgrade or a full SM connection remains a separate, unresolved modelling decision.
Do not silently resolve that question through a budget-inference correction.

**Why:** The user explicitly separated transition-count consistency from pricing
interpretation in the supplied model-correction instructions. Under the retained
two-stage convention, entry followed by upgrade incurs both applicable charges.

**How to apply:** Any later proposal to reinterpret SM costs needs its own scope
and an explicit before/after analysis. Do not describe correcting historical
transition counts as establishing the economic correctness of upgrade prices.
