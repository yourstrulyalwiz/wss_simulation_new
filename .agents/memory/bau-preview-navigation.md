---
name: Modern BAU preview design requirements
description: Three-section long-form layout, sector and area controls, and baseline/outcome indicators.
---
The modern BAU Scenario design should follow the Data Inputs treatment: a
full-height left panel, transparent main body, and a continuous long form.
Use two primary navigation sections: BAU Graph and BAU Table.
Keep Water Supply/Sanitation switching and Urban/Rural graph controls.
Include baseline-year and target-year result KPI cards.

**Why:** The user removed Review Baseline Information from tab 2 because the
same inputs are already available in Data Inputs.

**How to apply:** Safely managed and Basic outputs belong within the graph/table
sections, not additional top-level navigation sections. Baseline editing stays
in Data Inputs rather than being duplicated here. The user has
explicitly approved production integration. Apply this structure in frontend/src
using real engine data and React callbacks, not preview DOM observers or parsing.
