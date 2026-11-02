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

**Why:** The user approved the intervention functionality and refined the layout
to match BAU's long-form Graph/Table page and numbered section navigation,
preserving existing controls rather than replacing or simplifying them.

**How to apply:** Navigation must not enable a lever. Keep enabling controls
separate, preserve dormant/paused settings and local validation, and report
scenario—not BAU—funding fields. At-least-basic coverage combines exclusive SM
and Basic-only stocks once. Existing no-loan intervention preview semantics stay
unchanged; missing outputs must remain unavailable rather than becoming zeros.

Section navigation must retain its requested position through the short
responsive reflow after rails collapse, but stop following as soon as the user
interacts or scrolls.

**Why:** Responsive chart resizing and pending result cards can move a destination
after the initial scroll, especially in the stacked mobile layout.
