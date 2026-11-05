---
name: Coverage KPI reporting
description: Compatibility and population conversion decisions for graph coverage indicators.
---
Keep the existing household-share basis for percentage coverage when adding the
millions-of-people view. Convert household coverage to people using each area's
own population and household denominator before aggregating; do not assume one
household size for Urban and Rural.

**Why:** The user requested the percentage coverage "as it is now" alongside a
people view. Changing percentage semantics incidentally would break comparison
with existing graphs, while an assumed common household size would misstate
people served across geographies.

**How to apply:** Treat these as reporting choices only, not changes to delivery,
targets, funding or saved inputs. Label target differences in percentage points
or millions of people according to the selected view. Missing population makes
people unavailable, not zero.
