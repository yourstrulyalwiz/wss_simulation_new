---
name: Modern BAU preview design requirements
description: Three-section long-form layout, sector and area controls, and baseline/outcome indicators.
---
The modern BAU Scenario design should follow the Data Inputs treatment: a
full-height left panel, transparent main body, and a continuous long form.
Use three primary navigation sections: BAU Graph, BAU Table, and Review Baseline
Information. Keep Water Supply/Sanitation switching and Urban/Rural graph controls.
Include baseline-year and target-year result KPI cards.

**Why:** The user explicitly requested this structure for tab 2, applying the
same design idea as tab 1; adding separate numbered service-level sections
changes that structure.

**How to apply:** Safely managed and Basic outputs belong within the graph/table
sections, not additional top-level navigation sections. Baseline review should
be expanded rather than a collection of collapsed accordions. The user has
explicitly approved production integration. Apply this structure in frontend/src
using real engine data and React callbacks, not preview DOM observers or parsing.
