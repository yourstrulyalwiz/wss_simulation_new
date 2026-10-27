---
name: Independent sector results
description: Water must remain usable when sanitation inputs are incomplete, and vice versa.
---
Urban water must not require sanitation entries. Display available sector results
independently and mark combined results incomplete instead of treating an
unavailable sector or geography as zero.
**Why:** The user explicitly requires water independence; shared-request failure
previously hid valid water results behind unrelated sanitation calibration errors.
**How to apply:** Preserve the optional one-way water-to-sanitation NRW dependency.
Never infer water from sanitation or silently drop that link when water is invalid.

Budget projections in Data Inputs must remain available even when revenue or
service calibration blocks the full calculation.
**Why:** The user requested independent budget forecasts after missing sanitation
revenue assumptions hid valid allocated and executed projections.
**How to apply:** Use the same budget forecasting rules with budget/GDP inputs
only; report budget-specific failures independently without fabricating service results.
