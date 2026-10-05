---
name: Funding-balance materiality
description: User-approved tolerance for displaying negligible funding balances.
---

US$10,000 is a user-approved reporting-materiality tolerance, not merely a
machine-precision epsilon or permission to forgive financial obligations.

**Why:** After reviewing the surplus/unapplied-funding rows, the user asked that
very small balances, "perhaps less than 10000 usd", be rounded to zero.

**How to apply:** Apply the tolerance to the magnitude of funding balances
(both positive and negative), using USD or a validated local-currency equivalent.
Keep precise model amounts and auditable exports. Do not extend this permission
to coverage gaps, financing obligations, loan repayments, or the model's funding
allocation without a separate request.
