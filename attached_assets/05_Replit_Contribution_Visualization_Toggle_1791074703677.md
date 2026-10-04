# Replit instruction — Switch contribution charts between interventions and categories

## Objective

Add a display toggle labeled **Contribution view** with two options:

- **Individual interventions** — default; preserve the current presentation.
- **Categories** — aggregate the existing contributions into the five agreed categories.

Apply the selected view to contribution graphs in **Intervention Design**, the **Results dashboard**, and relevant **PowerPoint and Excel outputs**. This is a visualization change only. Switching views must not change model inputs, enabled interventions, calculations, cumulative attribution order, scenario results or numerical summaries. Presentation changes to export code are allowed; economic/model changes are not. Implement against the current Replit version, preserving the prior UI grouping work if already applied. Create a checkpoint and leave the tested development version ready for review; do not publish automatically.

## 1. Category mapping

Reuse a shared display-only category definition from the intervention-panel improvement if available. Otherwise create one reusable frontend module, such as `frontend/src/interventionCategories.ts`. Match by stable intervention keys, never by user-visible labels, string fragments or array positions.

| Category ID | Display label | Existing intervention keys |
|---|---|---|
| `funding` | Funding Mobilization | `ws_financial_commitment_enabled`, `ws_exogenous_injection_enabled`, `san_financial_commitment_enabled`, `san_exogenous_injection_enabled` |
| `operations` | Operational Efficiency Improvements | `ws_collection_efficiency_enabled`, `ws_nrw_enabled`, `san_collection_efficiency_enabled`, `san_nrw_link_enabled` |
| `investment` | Investment Planning and Delivery Improvements | `ws_capital_efficiency_enabled`, `ws_costeff_enabled`, `ws_techmix_enabled`, `san_capital_efficiency_enabled`, `san_costeff_enabled`, `san_techmix_enabled` |
| `tariff` | Tariff Reform | `ws_tariff_enabled`, `san_tariff_enabled` |
| `household` | Household Financing and Affordability | `ws_microfinance_enabled`, `san_microfinance_enabled` |

Apply the mapping within each chart's sector and geographic scope. Do not combine water and sanitation contributions into one sector chart. Display categories in the order above, without changing the order in which intervention effects were calculated.

Tariff Reform remains standalone. Means-based grants already inside Microfinance stay in its contribution; do not count them twice. **Energy improvements** and **Subsidies** are Coming soon placeholders and contribute no series, fields, zeros or legend entries.

## 2. Toggle placement and state

Place the segmented toggle in the chart toolbar on:

1. The Intervention Design screen, controlling its existing contribution charts together.
2. The Results screen, controlling both sectors' coverage-contribution and financing-gap-contribution charts together.

Use one shared UI state, preferably in `App.tsx`, passed to both screens:

```typescript
type ContributionView = 'individual' | 'category';
```

Default to `individual` and retain the selection while navigating within the app. Do not store it in model inputs, scenario payloads or backend schemas. Session/local preference persistence is unnecessary for this first version.

Keep the existing scope, year-window and units controls independent. Switching contribution view must not reset those controls, alter sector selection, change intervention checkboxes or invoke a model setter. The toggle is available once chart data exists; it does not enable or disable any category.

Use accessible labeled buttons or a radio group with keyboard operation, visible focus and a clearly indicated selected state. Allow wrapping on narrow screens. Avoid five category-level on/off controls: users are selecting a visualization granularity, not a new scenario.

## 3. Aggregate already calculated contribution series

Keep the current individual series as the source of truth. Derive grouped series with a pure frontend transform, preferably memoized. Do not mutate source rows.

For each year and metric:

```text
Category contribution = sum of the existing member intervention contributions
```

For example, if a chart's financing-gap reductions are 12 from collection and 8 from NRW, Operational Efficiency Improvements displays 20 in that chart's existing monetary units. If their coverage contributions are 4 and 3, the coverage category displays 7 in that chart's household units. Never derive coverage from cash or use revenue as a substitute for financing-gap reduction.

Recommended band metadata:

```typescript
type ContributionBand = {
  key: string;            // chart data key
  label: string;
  color: string;
  interventionKey?: string; // original stable toggle identity
  categoryId?: string;
  kind: 'builtin' | 'custom';
};
```

Adapt this to current types with minimal changes. The reviewed Live chart already carries toggle keys, while Results bands often use labels as their data keys. Add stable identity metadata when constructing Results bands without altering any calculated values or cumulative passes. Generated category keys should be namespaced, such as `category:operations`, to avoid collisions with custom labels or reference fields.

The transform must:

- Sum only the member bands present in the existing source representation; do not introduce disabled or placeholder interventions.
- Preserve each chart's existing filtering semantics. A category should appear when its included members produce a nonzero contribution under those semantics.
- Keep full available numerical precision during grouping; format/round only for presentation. Do not round each category member again before summing.
- Preserve the units already used by each chart. In the reviewed Results code, financing rows are already in billions; do not convert them a second time.
- Copy reserved/reference fields unchanged: year, BAU, total households, target, remaining gap and BAU gap where present.
- Preserve signs if the current source series contains signed values. Do not apply a new `max(0, ...)` to category totals.
- Return new display rows and bands without changing source rows, `inputs`, `toggles`, `summary` or stored scenario results.

For coverage percentage mode, aggregate household counts first, then divide by the same year's total households. Sum percentage-point contributions using the common denominator; never average member percentages. Keep the existing geographic aggregation and unit-conversion rules.

Do not add contribution-view state to API effect dependencies or cumulative request payloads. A view switch alone must cause **zero new `/api/calculate` requests**. Calculation effects should continue to respond only to their existing model dependencies.

## 4. Preserve attribution and reference lines

Categories summarize the existing intervention attribution. They are **not independently simulated category effects** and do not imply the effect of enabling a category by itself.

Do not group interventions into new engine passes, reorder existing passes, or recompute an allocation of interaction benefits. Collection/tariff interactions remain attributed according to the current calculation sequence; category view simply adds the already attributed member values.

Preserve every BAU, target, scenario and total-household line or base, existing chart limits, endline summary and remaining-gap value. Where the chart shows reductions from a BAU financing gap, change only the coloured contribution series and their legend/tooltips.

Use a short category-view note:

> Categories sum the existing intervention contributions. Model results and attribution order are unchanged.

The reviewed live and Results charts use separately declared intervention orders, and some orders differ. Preserve each chart's existing order; do not align them as part of this display change. Compare individual and category modes within the same chart and calculation context.

### Existing display limitations found in the review

The reviewed code rounds some individual contributions and clips negative marginal contributions to zero before plotting. Those behaviours can already prevent a plotted stack from exactly matching the full scenario, especially for exclusive basic coverage. This task must not silently change that behaviour in individual mode or claim to resolve it.

The required invariant is **category total equals the sum of its existing individual source contributions**. Both modes must preserve the same reference lines and full-scenario results. If an existing stack does not reconcile to its scenario, document it separately rather than inventing a balancing category or changing model calculations. Preserve any signed-value correction already made in the current Replit version.

## 5. Custom interventions

Retain custom contributions in a separate **Custom interventions** display band in category mode, following the five built-in categories. This is a residual custom group, not a sixth built-in policy category. Show it only when the current source contains a contributing custom series.

- The reviewed Live chart calculates custom contributions individually. Sum those existing custom bands into this residual group in category mode; preserve their individual labels and colours in individual mode.
- The reviewed Results dashboard calculates one combined custom-intervention pass. Preserve that combined band directly. Do not allocate it between funding and investment categories using custom labels, intervention counts, revenue amounts or assumed weights.
- If a newer implementation provides individual custom series, still group them into the same residual custom band for consistency in this version.
- Preserve water/sanitation applicability and existing handling of customs assigned to Both.

Every contributing source band must map exactly once. For an unexpected unmapped built-in key, surface a development warning and retain its contribution visibly as an unmapped series; do not silently drop it or call it a known policy category. Complete the mapping for all currently supported built-ins before delivery.

## 6. Chart presentation and applicable surfaces

Keep current chart types, sizes and individual-mode colours. Define a consistent category palette in the existing `chartColors.ts` or equivalent. Reuse distinct existing palette colours where appropriate, keep BAU/target/scenario reference colours reserved, and verify legibility with the full category labels.

Category legends show category names. Tooltips should show the category total and a compact breakdown of its nonzero members where individual source details are available. The Results custom aggregate has no finer attribution; do not fabricate one. Individual-mode legends and tooltips retain their existing behaviour.

Apply the transform to:

- `LiveInterventionChart.tsx`: its existing SM and basic contribution charts, preserving their respective measures and current limitations.
- `ResultsDashboard.tsx`: the SM coverage contribution chart and financing-gap contribution chart, using grouped data/bands passed into `StackChart`.

The reviewed Results basic-coverage chart shows BAU/scenario/target lines without an intervention stack. Leave it unchanged. Do not create a new basic contribution calculation just to make it respond to the toggle. More generally, leave charts without contribution series unchanged.

Existing detailed intervention controls and resources/households tables remain at intervention level. Label a detailed table clearly if necessary; do not aggregate its monetary resources column into a category metric, since some interventions have no comparable cash amount.

## 7. PowerPoint and Excel outputs

The selected contribution view must propagate to relevant exports from both screens. Updating on-screen charts alone is insufficient: the reviewed Results PowerPoint button normally uses `/api/export/deck` when area inputs are provided, which builds native charts server-side rather than using the captured UI images.

### Presentation metadata

Add an optional export-only field such as `contribution_view`, with values `individual` or `category` and default `individual`. Pass it from `ExportButtons.tsx` and any separate saved-scenario export buttons. On direct export requests, place it in a clearly separate export-options envelope or reserved metadata field and extract it before model input coercion. On area-based deck requests, keep it alongside `areas`, not inside each area's model inputs.

Do not pass this preference to `/api/calculate`, store it as a model toggle, or use it to alter the cumulative model-pass sequence. Export endpoints may run their existing calculations as usual when exporting, but the requested view must only transform the resulting individual contributions. Generating a category export must not require new category-level simulations.

### Excel

- Chart-specific Excel exports must match the selected mode, including category columns, legend entries and native Excel chart series. Use the same derived rows/bands as the visible chart; preserve the selected units and year window on these chart-specific downloads.
- The full scenario workbook from `/api/export/xlsx` must also honor the selection on contribution summaries and any contribution charts. In category mode, provide a clearly titled category contribution sheet/section derived from existing individual output. Retain the detailed individual contribution data on a separate clearly labeled sheet for traceability.
- Preserve baseline/scenario time series, input sheets, totals and all unrelated analytical content. Do not turn missing resource values into zero or combine unlike financial metrics when creating category summaries. Category household or financing-gap contributions can be summed where the source measures are comparable; otherwise retain the individual detail with an explanatory label.
- Label the selected contribution view in workbook metadata or the relevant sheet heading. Add an `individual` or `categories` suffix to filenames where practical.

### PowerPoint

- Update both `/api/export/pptx` and `/api/export/deck` presentation paths where they exist. Update contribution chart series, legends and relevant slide captions to reflect the selected view.
- For screenshot-based charts, capture the selected view. Preserve capture identities such as `water_coverage`, `water_gap`, `san_coverage` and `san_gap` and the DOM relationships required by the exporter.
- For server-generated native charts, group their existing individually attributed output series using the same category mapping and palette. Preserve that export path's existing computation order, metrics and geographic aggregation. Apply the selected view to every relevant area/sector slide in the deck, not only the currently visible UI sector.
- Where a slide includes a contribution summary intended to explain the chart, show the corresponding grouped contribution measure or explicitly label the table as individual detail. Retain intervention-specific parameter/detail slides; grouping does not merge intervention inputs or invent category settings.
- Preserve original chart types, reference lines, totals, template layout and unrelated tables. Adapt legend wrapping and table row layout to the longer category names; no clipped labels or unreadable font reduction.

Relevant reviewed paths include `frontend/src/components/ExportButtons.tsx`, export handlers in `app.py`, `export_data.py`, `export_pptx.py`, `deck_data.py` and `export_deck.py`. Check current signatures and any additional export entry points. Reuse a single declarative category mapping across frontend/export layers where practical, or maintain matched mappings with a small parity check. Do not duplicate economic formulas.

Full-model CSV retains its existing individual detail in this version; any chart-specific CSV representing the selected view should use the selected chart series. Clearly distinguish chart-view downloads from full-model data. Preserve each export's existing scope and period conventions; this preference changes contribution granularity only. For a like-for-like comparison, use the same scope, period, metric and attribution context.

## 8. Focused verification

1. **Arithmetic:** use a small fixture with funding contributions 5 and 7, operational contributions 12 and 8, investment contributions 2, 3 and 4, tariff 6 and household 1. Expect category totals 12, 20, 9, 6 and 1; the grand total stays 48. With custom contributions 2 and 3, the residual custom band is 5 and total is 53.
2. **Per-year invariant:** category sums equal their member sums for every displayed year and metric, within the existing numerical tolerance. Reference fields and total displayed contribution are unchanged between modes.
3. **No calculations:** confirm switching mode changes no model input, scenario payload, toggle, network calculation request or summary value. Preserve the current chart computation order exactly.
4. **Coverage and finance:** test both sectors, count/share modes, selected year windows and available geographic scopes. Confirm category shares use the common household denominator and finance values are not converted twice.
5. **Customs:** test duplicate custom display names, custom labels matching category names, mixed custom types and Both-sector customs. Results must retain the existing combined custom band without invented disaggregation.
6. **Zero and signed contributions:** test no interventions, zero-effect enabled levers, one active member, a nonzero custom-only case and signed source data if currently supported. No Coming soon placeholder appears in a legend or export.
7. **UI state:** the selection is shared across Intervention Design and Results, independent of units/scope/years, keyboard accessible and readable on narrow screens. Line-only basic coverage stays unchanged.
8. **Exports:** download category and individual Excel outputs from both screens. Verify native chart series and summary-sheet grouping, retained individual detail, units and invariant totals. Export both native-template and screenshot-based PowerPoint paths; inspect category legends, captions and every applicable area/sector. Check saved-scenario export buttons, omitted-option backward compatibility and existing capture keys. UI and export group sums must agree for identical underlying contributions; document pre-existing computation-order differences rather than changing them.
9. Run normal frontend build/type checks and focused export smoke tests. A small pure-helper aggregation test and mapping parity check are appropriate; a new economics test suite is unnecessary for this display-only change. Inspect generated slides and spreadsheets for layout defects.

## Completion report

Provide changed files, screenshots of both views, sample PowerPoint/Excel outputs, aggregation checks and confirmation that view switching triggers no calculation requests. List any pre-existing attribution-order or negative-contribution display discrepancy separately. Confirm that the five built-in categories, separate tariff category and residual Custom interventions band are correctly represented on both screens and in relevant exports, with no model changes or publication.
