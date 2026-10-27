---
name: Data Inputs navigation scope
description: Continuous Data Inputs form, standalone investment split and sector grouping.
---
The Data Inputs design has nine top-level sections, with left-hand
navigation that scrolls to headings in one continuous expanded form, not separate
separate screens or top-level accordions.

**Why:** The user originally requested seven sections and a single long form,
then requested Investment Split by Service Level as a standalone section styled
like Revenue Inputs. The user subsequently requested Sector Selection as section
immediately after Budget, followed by Investment Split, Revenue Inputs, and Unit Costs.
The user subsequently moved Country/Area/Currency and Analysis Period into a new
workflow step 0, Setup, together with simulation sector and geographical coverage.
Edit setup must open that tab, not a modal. Data Inputs retains area/sector
view selectors, while inclusion settings live in Setup.

Setup has four sections in order: Simulation Name; Country Profile (country name,
ISO, income group, region and area of focus); Simulation Coverage; Currency.
Analysis Period is now Data Inputs section 1, followed by Geographical Scope
Selection at 2. The seven detailed sections start at 3, with area suffixes only
from section 3 onward.
**Why:** The user requested a separate Currency section and retrospective country
profiles for existing DRC and Nepal simulations, then a standalone name section
first and coverage before currency, then moved Analysis Period back to Data Inputs
and made the Urban/Rural viewing toggle its own second section.
**How to apply:** Resolve descriptive country classifications from the same
World Bank catalogue used at creation, using stable country identity. These are
current descriptive metadata, not historical simulation assumptions; do not
rewrite preserved inputs or immutable results to fill these display fields.
Water and Sanitation are sector choices within that structure, not additional
top-level sections.

Area of focus offers National or Subnational, with a free-text area name only
for Subnational. Keep this separate from Urban/Rural calculation geography.
**Why:** The user requested this country-profile selection while retaining named areas.
**How to apply:** Preserve legacy area names as subnational descriptions; do not
reinterpret this descriptive choice as a change to sector/geographical coverage.

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

Keep Urban/Rural viewing controls in Data Inputs section 2.
**Why:** The user moved geographical coverage configuration to Setup, but area-specific
data still needs an area selector.
**How to apply:** Do not duplicate editable coverage controls outside Setup.
