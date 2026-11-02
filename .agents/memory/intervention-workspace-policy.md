---
name: Intervention workspace layout
description: BAU-aligned intervention navigation, cascading inputs and scenario reporting.
---
Use a persistent three-item numbered navigation for Intervention Design:
Intervention Design, Intervention Graph, Intervention Table. Graph and Table are
sections on one long scrollable page, with BAU's reading-column width and toggle
placement. Selecting Design reveals the intervention list beside the navigation;
selecting Graph or Table hides that list and its nested input drawer. Individual
intervention inputs still push the main content right rather than overlaying it.
Keep coverage and available funding together, shared geography/sector/service
selectors synchronized, and scenario KPI cards above the graph.
The page background should match BAU Scenario. Geography and sector selectors
belong at the top only, not repeated in Intervention Table; the table retains its
service-level selector and uses the shared top selections.
Use “BAU Scenario” and “Intervention Design” as the workflow page titles.
Numbered sections in both workspaces must match Data Inputs headings, including
number badges, uppercase bold type, matching font size and underline.
**Why:** The user explicitly requested heading consistency across these workflows.
Intervention Table keeps BAU's structure but uses intervention-adjusted access
gaps, costs, replacement balances, financing gaps and available funding.
Retain BAU households as the comparison, immediately followed by intervention
households, then target households, in both the table and exports. This supersedes
the earlier BAU-statistics-plus-two-columns interpretation.

**Why:** The user clarified that this table should show the intervention scenario,
not unchanged BAU finances. Coverage surplus must not produce negative access
gaps or remaining coverage-related new-service costs; legitimate replacement
obligations can still remain.

**Why:** The user approved the intervention functionality and refined the layout
to match BAU's long-form Graph/Table page and numbered section navigation,
preserving existing controls rather than replacing or simplifying them.

**How to apply:** Navigation must not enable a lever. Keep enabling controls
separate, preserve dormant/paused settings and local validation, and use scenario
funding and obligations throughout the intervention table, retaining BAU households
only as the coverage comparison. At-least-basic coverage combines exclusive SM
and Basic-only stocks once. Existing no-loan intervention preview semantics stay
unchanged; missing outputs must remain unavailable rather than becoming zeros.

Section navigation must retain its requested position through the short
responsive reflow after rails collapse, but stop following as soon as the user
interacts or scrolls.

**Why:** Responsive chart resizing and pending result cards can move a destination
after the initial scroll, especially in the stacked mobile layout.

BAU and Intervention tables use signed gap presentation: negative/red deficits,
positive/green genuine surpluses, neutral dark-blue zeros. This supersedes the
earlier unsigned display only; underlying unmet obligations stay nonnegative.
Access overachievement may be shown only when the existing gap is zero; retain
SM credit and do not net away local deficits. Never fabricate a financing surplus
by subtracting already-applied funding from residual obligations.

**Why:** The user requested explicit signs and consistent red/green/dark-blue
formatting in both tables, plus wrapping Intervention columns to fit like BAU.
**How to apply:** Keep this a reporting convention, not a model-accounting change.

The former additional-revenue chart should report Sector Available Funds, grouped
into Mobilized Funds (Public Spending + External Funding) and Additional Revenues
Generated, retaining the revenue-source breakdown. Show forecast years after the
baseline (2026 onward for the current scenario), and use Intervention Table styling.
**Why:** The user wants the full sector funding picture, not revenues alone.
**How to apply:** Reconcile against actual scenario available funding without
counting loans, losses or already-applied funding twice.
