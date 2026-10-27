---
name: Data Inputs navigation scope
description: Continuous Data Inputs form, standalone investment split and sector grouping.
---
The Data Inputs design has nine top-level sections, with left-hand
navigation that scrolls to headings in one continuous expanded form, not nine
separate screens or top-level accordions.

**Why:** The user originally requested seven sections and a single long form,
then requested Investment Split by Service Level as a standalone section styled
like Revenue Inputs. The user subsequently requested Sector Selection as section
6 immediately after Budget, followed by Investment Split, Revenue Inputs, and Unit Costs.
Water and Sanitation are sector choices within that structure, not additional
top-level sections.

**How to apply:** Keep unit costs and technical parameters as one sector-adaptive
section. Preserve this grouping when adding or reorganizing input details; ask
before changing the number of top-level sections.

The modern Data Inputs workspace should use a flush-left section panel spanning
the available workspace height, with transparent, unboxed main sections and
slightly larger headings.

**Why:** The user requested this treatment to let the page fill show through the
main body rather than enclosing the long form in white cards.

**How to apply:** Preserve the navy/teal/slate scheme and Noto Sans. Keep field
and table backgrounds that communicate input semantics; the surrounding section
containers should not become white cards again. The user has explicitly approved
production graduation; these requirements now apply to frontend/src. Preserve
production data, callbacks, autosave and exports; do not copy preview runtime behavior.

Place Tab 1 geographical scope controls in the main body immediately below
the baseline heading and subtitle, without an enclosing banner.
**Why:** The user requested the controls be integrated into the page rather than
occupying a separate full-width banner.
**How to apply:** Retain scope choices and urban/rural switching; do not apply
this relocation to the other tabs.
