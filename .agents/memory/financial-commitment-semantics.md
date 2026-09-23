---
name: Financial commitment semantics
description: Product rules for interpreting the built-in increase in financial commitments intervention.
---

The GDP target and annual growth are additive commitment options; exogenous injection is a separate intervention, independently switched and separately attributed. The GDP entry is a target total sector-spending share, not an uplift; add only the positive difference above BAU. Annual growth compounds over its inclusive range, and absolute injections may be one-time or recurring.

All added commitments are full-spending amounts and become capital available for service through the sector's existing capex-share and budget-execution treatment. In cost-derived budget mode, compare GDP targets and growth with the preserved total-spending BAU series, not the derived capital budget.

**Why:** This prevents double-counting BAU, keeps the intervention economically consistent across budget modes, preserves the agreed distinction between pledged spending and effective capital, and lets users identify injections separately from spending commitments.

**How to apply:** Use these rules for calculations, attribution, and exports in both water supply and sanitation. Keep sector and geographic-area settings independent. When reading old saved inputs, migrate an enabled injection before constructing cumulative attribution passes; otherwise the injection can be counted under commitments instead.