---
name: Saved-scenario financing compatibility
description: Safe legacy defaults and durable disclosure of uncertain migrated assumptions.
---

Older saved scenarios must default to reinvest-all/no-new-borrowing, with historical inputs,
targets, geography and sectors preserved. Do not activate legacy prototype credit settings
as if they specified a current loan contract. Already-supported explicit current financing
choices should remain intact. Retain prior settings for review, rather than losing them.

**Why:** The user explicitly requires backward compatibility and safe legacy financing
defaults, plus clear identification of assumptions that cannot be migrated unambiguously.

**How to apply:** Warn about missing rate basis (retain the legacy real interpretation),
unknown broader baseline obligations, nested injection intent, and asset/customer information
not inferable from coverage targets. Do not pretend missing information was established.

Acknowledging a migration warning must not delete its assumption notes from saved snapshots
or exported reports.

**Why:** Review is an acknowledgment, not evidence that the missing financial or asset
information has been supplied; recipients of exported results still need the disclosure.

**How to apply:** Store acknowledgment separately from the notes; preserve those notes across
save/load and include them with the reporting methodology.