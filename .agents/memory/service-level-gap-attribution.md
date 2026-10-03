---
name: Service-level gap attribution
description: The user's chosen policy for separating shared BAU financing gaps by service level.
---

When separating Safely Managed and Basic financing gaps, attribute replacement using each level's actual costed asset obligations, **not** the configured new-investment split. The financing ledger is residual: new-service costs already reflect budget-financed connections and must never receive a second expansion-capital credit.

Recognize only replacement funding reserved by the coverage calculation, capped at the reported replacement obligation, then allocate that credit proportionally to each service's reported replacement. Allocate any negative net cash once by original new-service-plus-replacement need shares, falling back to the investment split when needs are zero. The two service gaps must sum to the sector gap.

**Why:** The user explicitly requested removal of duplicate capital credit while preserving coverage and asset calculations. Investment preferences need not match replacement obligations; coverage-stock replacement and target-needs replacement have different bases.

**How to apply:** Preserve the single-credit identity in both BAU and scenarios. The later funded-assets/carry-forward decision supersedes the original exclusion of backlog tracking; see [Funded assets](funded-assets.md). Do not sum closing expansion balances across years.