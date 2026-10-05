---
name: Simulation-focused graph presentation
description: User-approved default viewing period versus retained historical data.
---

Graphs should open with three years of context before the first forecast year
through the simulation end year, not with the oldest stored historical year.
The user approved interpreting simulation start as the year after the last
historical year: a 2026–2040 simulation initially displays 2023–2040.

**Why:** The user wants charts to focus on the simulation while still allowing
longer historical comparisons, rather than always opening at 2011.

**How to apply:** Retain all available historical years in filters and preserve
model dates, stored history and full-data outputs. Reset restores the focused
window; graph filtering must never change model inputs or financing totals.
