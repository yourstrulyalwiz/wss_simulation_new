---
name: Modern BAU preview design requirements
description: Two-section BAU layout, synchronized service views, coverage and capital reporting.
---
The modern BAU Scenario design should follow the Data Inputs treatment: a
full-height left panel, transparent main body, and a continuous long form.
Use two primary navigation sections: BAU Graph and BAU Table.
Keep Water Supply/Sanitation switching and Urban/Rural graph controls.
Include baseline-year and target-year result KPI cards.

Keep geography above sector selection. Graph and table share one service selection:
Safely managed, Basic only, or At least basic. Default both graph and table to
At least basic, as requested by the user. The combined view adds exclusive
categories once; access gaps remain assessed locally by the engine. Capital
requirements show annual expansion and replacement against available capital,
not accumulated need or the residual financing balance.
**Why:** The user requested selective integration of the branch BAU design while
preserving current main navigation, calculations, validation and saved inputs.
**How to apply:** Keep the coverage and capital charts paired on wide screens,
stacked on narrow screens, with expansion and exports. Never merge unrelated
branch changes or substitute a frontend calculation for engine gap semantics.

**Why:** The user removed Review Baseline Information from tab 2 because the
same inputs are already available in Data Inputs.

**How to apply:** Safely managed and Basic outputs belong within the graph/table
sections, not additional top-level navigation sections. Baseline editing stays
in Data Inputs rather than being duplicated here. The user has
explicitly approved production integration. Apply this structure in frontend/src
using real engine data and React callbacks, not preview DOM observers or parsing.
