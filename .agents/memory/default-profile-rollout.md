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
keep calculations and result exports unavailable for the incomplete profile.
Treat production activation of the completed simulation as separate work.