# Replit instruction — Five intervention categories and coming soon placeholders

## Objective

Reorganize the intervention controls into five clearly labeled categories. Give Tariff Reform its own category. Add two display-only placeholders: **Energy improvements** and **Subsidies**, each with the exact badge **Coming soon**.

This is a UI-only change. Preserve every existing model calculation, parameter value, default, input binding, toggle, saved-scenario payload, chart contribution and export calculation. Do not implement the pending service-gap or dynamic-revenue proposals as part of this task.

Work from the current Replit development version, retaining any earlier fixes already applied there. Create a checkpoint, implement the interface changes and perform focused verification. Do not publish automatically.

## 1. Proposed categories and contents

Use the following category order under both the Water Supply and Sanitation sector tabs. Retain the existing geographic scope selector and scope banner.

| Category | Water Supply | Sanitation |
|---|---|---|
| **1. Funding Mobilization** | Increase in Financial Commitments; Exogenous Injection of Funds | Increase in Financial Commitments; Exogenous Injection of Funds |
| **2. Operational Efficiency Improvements** | Collection efficiency; NRW reduction; **Energy improvements — Coming soon** | Collection efficiency; NRW-linked sanitation revenue; **Energy improvements — Coming soon** |
| **3. Investment Planning and Delivery Improvements** | Budget execution improvement; Capex efficiency (unit cost); Optimised technology selection | Budget execution improvement; Capex efficiency (unit cost); Optimised technology selection |
| **4. Tariff Reform** | Existing tariff reform control and all its existing fields | Existing tariff reform control and all its existing fields |
| **5. Household Financing and Affordability** | Microfinance, including its existing means-based grant and self-finance carve-out fields; **Subsidies — Coming soon** | Microfinance, including its existing means-based grant and self-finance carve-out fields; **Subsidies — Coming soon** |

Suggested brief category descriptions:

- Funding Mobilization: “Increase sector funding through spending commitments and additional funds.”
- Operational Efficiency Improvements: “Improve revenue collection and reduce operational losses.”
- Investment Planning and Delivery Improvements: “Improve budget execution and the cost of delivering services.”
- Tariff Reform: “Adjust tariffs to increase collected revenue.”
- Household Financing and Affordability: “Help households finance access to services.”

Keep **Custom Interventions** as the existing separate tool below the five categories, with its current creation, editing and sector controls. It is not a sixth numbered category. Do not automatically reclassify custom interventions, rename their stored types, or alter their calculation order.

## 2. Category behaviour and visual treatment

Implement five lightweight expandable sections in the existing left-hand intervention panel. Use the current typography, spacing, borders and colour palette. Keep the right-hand charts in their existing layout.

- Show all five section headings at all times; allow multiple sections to be open.
- Initially expand the five sections while retaining the existing collapsed parameter panels, so users can discover all interventions and both placeholders.
- Category headers only expand or collapse their contents. They have no model checkbox and no “enable all” action.
- Preserve each active intervention's existing checkbox and independent Show/Hide behaviour: checking it changes enabled state; Show/Hide only reveals parameters.
- Keep category expansion state in UI state, not in `inputs`, `toggles` or saved model scenarios.
- Give sections stable keys per sector. Prefer keeping hidden contents mounted so collapsing a category does not discard field edits, intervention panel expansion state or input focus unnecessarily.
- Do not call the model `onChange` handler, reset inputs or trigger calculations just because a section is expanded/collapsed.
- Keep headings and badges readable at the current approximately 460px control-panel width. Allow long category names to wrap rather than truncate or overflow.
- Add keyboard-accessible header buttons with `type="button"`, `aria-expanded`, `aria-controls` and visible focus. Hidden content must not remain keyboard-focusable.

The category order is presentation only. It must not become the source of intervention calculation order.

## 3. Coming soon placeholders

Add one placeholder row under Operational Efficiency Improvements and one under Household Financing and Affordability in each sector tab.

### Energy improvements

- Label: **Energy improvements**
- Badge: **Coming soon**
- Supporting text: “Energy efficiency measures will be available in a future update.”

### Subsidies

- Label: **Subsidies**
- Badge: **Coming soon**
- Supporting text: “Additional subsidy options will be available in a future update.”
- Add a short note: “Means-based grants within Microfinance remain available.”

Use an unavailable row/card treatment with a muted background and readable text. The badge must communicate availability through text, not colour alone. Prefer no checkbox or Show button for these rows. They are informational placeholders, not disabled model interventions.

Do not give either placeholder editable fields, an input key, a toggle key, a value, a calculation callback, a stored scenario entry, a chart series, an export row or a claimed numerical benefit. Clicking or focusing a placeholder must not affect the current scenario.

The existing means-based grant is already active within Microfinance. Do not rename it to “Coming soon,” disable it, move it into the placeholder, or remove its fields. The new Subsidies placeholder represents additional future functionality. Keep the self-finance carve-out as an existing Microfinance assumption, not a new standalone intervention.

## 4. Code review findings and implementation scope

The reviewed repository places the active editor in `frontend/src/components/InterventionPanel.tsx`. It contains:

- Water and sanitation blocks with individual `InterventionToggle` controls.
- An existing `Section` component that can be adapted for category containers, adding appropriate accessibility and state-preservation behaviour.
- Shared field builders for financial commitments, funding injections and microfinance.
- A separate Custom Interventions editor.
- The two existing live service-level charts on the right.

The intended change is to wrap/reposition the current intervention controls, not reconstruct their parameter fields. Reuse the current fields and bindings, including any tariff/collection input changes made since the reviewed version.

Suggested frontend-only components, if useful:

- `InterventionCategory`: heading, short description, expansion state and existing children.
- `ComingSoonIntervention`: label, badge and supporting text only; no model setter props.

Do not centralize UI categories and model execution into a single sorted list. A display-only grouping definition is acceptable, but it must not drive scenario requests or cumulative engine passes.

`frontend/src/App.tsx` contains guidance cards and section-focus routing. Update the sector overview to explain the five categories and unavailable placeholders. Preserve existing intervention guide identifiers such as `ws_ce`, `ws_nrw`, `ws_tariff`, `ws_microfinance` and their sanitation equivalents. Opening an existing intervention should still focus its existing guide. Category expansion need not jump to a different intervention guide. Do not rewrite formula explanations as part of this UI task.

`frontend/src/components/InputPanel.tsx` also contains intervention-related markup. Check whether those paths are reachable in the current application before editing them. Avoid creating a second inconsistent active editor, but do not refactor dormant code unnecessarily.

Preserve existing sector-switching and custom-intervention behaviour. If a pre-existing behaviour mutates custom inputs when changing sector, report it separately rather than changing it under this categorization task. Category expansion must not invoke sector-switch handlers.

No changes are expected to Python model files, input schemas, adapters, default values or backend endpoints. Update built frontend assets only through the project's normal build process if the deployment requires them.

## 5. Protect chart attribution and calculations

The reviewed code declares intervention sequences separately in `LiveInterventionChart.tsx`, `ResultsDashboard.tsx` and export code. Some sequences differ, particularly the position of NRW relative to investment-efficiency levers. Since contributions come from cumulative model passes, changing those sequences can change attributed results even when the total remains the same.

For this UI task:

- Preserve each existing chart/export execution sequence exactly as found in the current Replit version.
- Do not reconcile pre-existing ordering differences in this change; report them separately if still present.
- Do not sort intervention arrays by the new category order.
- Preserve individual chart labels, colours, bands, legends, contribution values and total results.
- Keep Tariff reform and Collection efficiency displayed separately in financing-gap and coverage charts.
- Do not add category-level aggregate bands or Coming soon entries to charts or exports.

The only ordering change authorized here is the visual arrangement of the left-hand controls and related navigation guidance.

## 6. Focused verification

Use the current development version as the before-change reference, not an older model snapshot. This is a reversible presentation change, so a broad new economics test suite is unnecessary.

1. Confirm the five headings, membership and order in both sector tabs. Tariff Reform must be standalone. Check the relevant geography views and a narrower viewport for wrapping and overflow.
2. Confirm Energy improvements and Subsidies have the exact **Coming soon** badge and cannot be enabled. Existing Microfinance grant fields must remain editable and functional.
3. Verify checkboxes and Show/Hide retain their separate functions. Opening/closing categories must not clear parameters or change any model toggle. Verify keyboard operation and hidden-content focus handling.
4. Load a representative saved scenario with multiple enabled interventions and custom interventions. Compare its serialized model inputs before and after the UI change without editing values. No new placeholder keys, category fields or changed defaults may appear.
5. With identical inputs, compare representative financing-gap, coverage and per-intervention chart outputs before and after. Include collection and tariff together and an NRW/investment-efficiency combination to catch accidental attribution reordering. Results must be unchanged within the existing numerical tolerance.
6. Verify existing export contents and numerical contributions are unchanged; no placeholders may appear as modeled effects.
7. Run the normal frontend type/build checks and inspect the resulting interface. Reuse existing tests as appropriate; add only a targeted UI regression if the project's test setup makes that useful.

## 7. Completion report

Provide screenshots of the updated Water Supply and Sanitation panels, the files changed, and a brief summary of the focused checks. Confirm that all changes are presentational, the placeholders have no model bindings, and numerical outputs and attribution order remain unchanged. Identify unrelated issues separately without fixing them in this task. Leave the development version ready for review; do not publish automatically.
