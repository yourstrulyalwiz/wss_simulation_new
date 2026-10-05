---
name: Default profile rollout
description: User-approved startup behavior and assumption boundaries for the DRC workbook profile.
---
The DRC urban/rural default should open for both existing and new users once
when they first encounter that default. Preserve an existing working session as
a saved scenario before switching; do not repeatedly replace subsequent edits.

**Why:** The user selected a one-time default switch with prior-session backup,
rather than a default applying only to new sessions.

**How to apply:** Treat a default rollout separately from ordinary reloads.
Retain both areas and the prior scenario's scope and presentation settings.

Do not assume that uploaded year-by-year templates supply unit costs, technical
assumptions, or intervention settings, or that the user approved model defaults
for those settings.

**Why:** The user said they will provide settings absent from these templates
instead of authorizing inheritance from the model defaults.

**How to apply:** Obtain the supplied settings or a complete saved dev profile
before activating the template-derived profile as the default simulation.

A template-only data preview is permitted in development before the full model
settings are supplied. Do not load that incomplete preview into the live
production session or present calculated results using assumed settings.

**Why:** The user clarified that they wanted the uploaded data visible in the
development preview, not loaded directly onto production. Viewing supplied
data does not authorize importing Nepal assumptions into a DRC simulation.

**How to apply:** Show both uploaded areas and clearly label missing settings;
keep missing assumptions blank and let ordinary model validation report errors.
Do not disable navigation or add a calculation/export block based solely on
the profile being a data preview.
Treat production activation of the completed simulation as separate work.

**Why:** The user explicitly requested removal of the recently added preview
restriction. They want to access BAU and the later pages without a readiness
gate; that does not authorize inventing missing assumptions.

Separate missing country assumptions from the model's established automatic
forecasting and internal configuration. Do not create new mandatory manual
inputs just because an import has blanked values used by that existing workflow.

**Why:** History review showed that blanket clearing of numeric configuration
prevented the unchanged forecasting code from running. Supplied series can
already support automatic projections, so requiring a redundant fallback rate
misdiagnoses the import problem. The user explicitly approved restoring the
established underlying calculations and relevant input fields after that review.

**How to apply:** Check established derivation and default behavior before
requiring more user inputs. Preserve automatic projections from uploaded data.
Keep actual unit-cost, technical and inflation assumptions distinct; this rule
does not authorize carrying over Nepal's country-specific assumptions.

Automatic economic and demographic rows must remain available before financial
calibration is complete. Clearly distinguish those projections from a fully
calibrated BAU simulation; never invent funding or service results for a partial
projection.

**Why:** Restoring the original automatic workflow must not require guessing
country costs just to display GDP, households or population. Financial results
still depend on actual costs, technical settings and shared revenue inputs.

**How to apply:** Keep missing calibration errors local to the calculations
that require it. Preserve explicit zero and custom overrides, show restored
forecast presets as optional model defaults rather than country observations,
and repair current inputs without repeating the one-time profile switch.