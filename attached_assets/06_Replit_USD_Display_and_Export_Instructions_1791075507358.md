# Replit instruction — Local currency and USD display conversion

## Objective and scope

Add a display-currency option for monetary graphs, result tables, summaries and relevant exports. Users enter one fixed exchange rate and switch between the original local currency and USD.

The model must continue to calculate and store numerical results in its original local currency. This feature changes presentation only. It must not change financing gaps in local-currency terms, funding allocations, service coverage, intervention attribution, input values or model assumptions.

Work from the current Replit development version and create a checkpoint. Integrate with the separate Individual interventions / Categories visualization preference if already implemented. Do not implement pending accounting or dynamic-revenue proposals in this task. Leave the tested development version ready for review; do not publish automatically.

## 1. Where the controls appear

### Rate setup in Data Inputs

Inside the existing **Country, Area of Focus & Currency** section, add a subsection **USD display conversion**, with:

- **Exchange rate — [currency code] per US$1**: finite positive decimal input; do not round it to an integer or restrict it to two decimal places.
- **Rate reference year**: integer year identifying the supplied rate; this is not an annual exchange-rate forecast.
- **Source or note**: optional free text.

Suggested explanatory text:

> Used to translate monetary results and exports into USD. Model inputs and calculations remain in [currency code]. One fixed rate applies across the projection.

Do not change the meaning of the existing Currency code field. It specifies the currency of model inputs; it is not the display-currency selector.

### Viewing controls in Interventions and Results

Add **Display currency: [local currency code] / USD** to the chart toolbar in both the Intervention Design and Results screens. Use one shared selection for all monetary outputs in both screens, sectors and geographic scopes.

Next to it, show a compact rate note such as **US$1 = 100 NPR · 2025 reference rate** and an **Edit rate** link. The link navigates to and opens the USD display conversion fields in the country/currency section, bringing them into view and focusing the rate input. It must not reset inputs or change scope.

Keep the control independent of Contribution view, geographic scope, sector, year range and coverage count/share controls. Currency selection has no effect on household or percentage coverage charts; their axes remain in their existing units. Any monetary summary next to them should use the selected currency.

Default to local currency. If no valid rate and reference year are configured, keep USD unavailable with a visible “Set exchange rate” action. Do not silently assume a rate of 1. If the model currency itself is USD, conversion is the identity (rate 1); avoid two indistinguishable USD options and an unnecessary rate-entry requirement.

## 2. Separate display metadata from model inputs

Use shared presentation state in `App.tsx` or an equivalent provider. A suggested shape is:

```typescript
type CurrencyDisplaySettings = {
  mode: 'local' | 'usd';
  sourceCurrency: string;
  localPerUsd: number | null;
  rateReferenceYear: number | null;
  sourceNote?: string;
};
```

Persist these settings with the working project and saved scenarios as presentation metadata, alongside the existing area bundle rather than inside each area's engine inputs. The reviewed `areaBundle.ts` and `App.tsx` pack/save/restore logic need to carry this optional metadata through local storage, saved scenarios, profile save/load and import/export paths where applicable.

- Legacy scenarios without settings open in local-currency mode with no fabricated rate.
- Loading a scenario restores its own display settings, rather than borrowing a rate from another country or scenario.
- One rate applies to all areas of the same country/currency analysis. Do not create competing urban/rural rates.
- Preserve settings when switching areas or sectors.
- Changing the model currency invalidates a previously configured rate for a different source currency and returns the display to local mode with a concise setup message. Keep prior metadata for traceability if useful, but do not reuse it silently.
- USD exports spanning multiple areas must validate that the areas use the expected common source currency. Do not sum mixed currencies or apply one country's rate to another.

Use dedicated presentation setters. Editing the display rate, reference year or currency mode must not mutate `inputs`, trigger `/api/calculate`, resize macro arrays or reset scenario results. Saving presentation metadata must not indirectly trigger a calculation effect through a bundle/dependency change.

### Existing exchange-rate fields are not this setting

The reviewed code already contains `macro.exchange_rate`, used by the legacy nominal-USD macro chain, and USD-denominated cost inputs such as `nrw_capex_unit_cost_usd`. Do not overwrite or reinterpret them. Do not auto-populate this display rate from an arbitrary element of that series without a separate explicit user action and matching reference-year validation. No automatic rate fetching is required.

## 3. Conversion and units

The rate direction is always **local-currency units per US$1**:

```text
USD amount = local-currency amount / localPerUsd
```

Use shared, typed display helpers, for example `currencyDisplay.ts`, to convert and label monetary results. Preserve source arrays; convert copies or derived display values. Repeated switching must always start from the original local-currency value, never the previously converted value.

Scale and currency are separate:

| Source amount | Rate | USD display |
|---|---:|---|
| 5,000 million LCU | 100 LCU/US$ | US$50 million |
| 5 billion LCU | 100 LCU/US$ | US$0.05 billion |
| 2,500 LCU per household | 100 LCU/US$ | US$25 per household |
| −200 million LCU | 100 LCU/US$ | −US$2 million |

If a series is already in billions, divide by the exchange rate only; do not apply its million-to-billion scaling again. Use labels such as **US$ million**, **US$ billion** and **US$/household**, preserving whether the metric is an annual flow, a closing balance or a cumulative amount. Do not add “per year” to a balance solely because it is plotted by year.

Convert monetary axes, data series, tooltips, legend text containing monetary units, summaries, totals, table columns and monetary reference lines together. Axis limits and money-based formatting thresholds must use the displayed scale, while model numerical tolerances remain unchanged. Format only after conversion; retain sufficient precision for small USD amounts.

Do not convert household counts, population, percentages, collection ratios, years, physical volumes, asset lives, interest rates or dimensionless ratios. Ratios such as gap reduction percent and spending/GDP remain unchanged; avoid mixing a converted numerator with an unconverted denominator.

Do not convert data-entry fields in this version. Editable local-currency costs, budgets and tariffs retain their original values and clear local-currency labels. Existing USD input fields remain USD. A results table containing per-unit monetary outputs may be translated with an explicit unit label, but must not write the converted value back to its input.

Use explicit monetary-field metadata or adapters for each result structure; do not recursively divide all numeric fields or infer money solely from a loose name match.

## 4. Real-price convention

Apply one fixed rate to the whole projection. Prefer a reference year matching the model's constant-price base, where known. Do not assume the model baseline year is necessarily the price base, rebase prices, apply inflation again or introduce forecast exchange rates.

Show a concise note on monetary outputs or shared toolbar:

> Constant-price model values translated at [rate] [LCU] per US$1 ([year] reference rate). No annual exchange-rate forecast applied.

If the model has a known price-base year, include it separately in exported metadata. If it is not available, say “model constant-price basis” rather than invent a year. A different rate reference year is a disclosed translation convention, not an implicit price adjustment.

Validate rate/year at UI and export boundaries. Reject zero, negative, nonfinite and malformed rates. Treat a blank entry as missing, not zero. If a user clears an active rate, revert to local display with a clear prompt; never leave USD labels on unconverted values.

## 5. Integration with contribution categories and charts

Apply the currency selector to both Individual interventions and Categories views. Aggregate source contributions first and translate them once, or use an equivalent consistent transform that preserves precision. For a common rate, grouping and conversion must commute:

```text
sum(local intervention contributions) / rate
    = sum(converted intervention contributions)
```

Do not change cumulative intervention order, attribution, chart colours or group membership. Preserve existing treatment of custom interventions and exclude Coming soon placeholders. Endline monetary summaries must use the same rate as the graph regardless of contribution mode.

Review monetary surfaces beyond the main financing chart, including `ScenarioGapTables`, resources/contributions tables and narrative impact summaries. Coverage charts themselves remain unchanged. Existing BAU-only monetary result charts, if any, should also consume the shared display settings; editable BAU input tables remain in their input currency.

## 6. Export handling

Carry the selected display currency, source currency, rate and reference metadata as **export options**, separate from model inputs. Extend the presentation options from the contribution-view task rather than introducing conflicting envelopes. Default omitted options to local currency for backward compatibility.

Extract and validate these options before model input coercion. Export handlers may run their existing model calculations in local currency; translate only the resulting presentation data. Do not alter Python economic functions or submit converted model inputs to produce USD outputs.

### Excel

- Chart-specific exports must match the visible currency, contribution view, units and selected year window. Pass correctly converted rows and labels into both the data sheet and native Excel chart specification.
- Full scenario workbooks should show monetary result/contribution summaries in the selected currency. In USD mode, retain clearly labeled local-currency detail on separate sheets or in a dedicated source-data section. Do not duplicate nonmonetary rows unnecessarily.
- Keep input/source sheets in their original currencies and label them accordingly. Never label raw local-currency detail as USD.
- Include rate direction, rate value, reference year, optional source note and price-basis note in a metadata sheet. Existing grouping preference metadata should coexist with these fields.
- Use numeric cells for converted values, not strings containing currency symbols. Verify formulas, chart series, headers and displayed totals agree.

### PowerPoint

- Update both `/api/export/pptx` (including captured charts) and `/api/export/deck` (native template charts). The reviewed area-based Results export uses the latter, so frontend conversion alone is insufficient.
- Translate every monetary result chart, monetary reference line, table and narrative result figure that belongs to the selected-view presentation. Preserve household/coverage content, template layout, totals and intervention attribution.
- Captured chart images are already converted; do not convert them again. Their adjacent text/tables must use the same export options. Native charts should convert once from local-currency source results.
- Apply one validated rate to all relevant water/sanitation and urban/rural/national slides in the analysis. Preserve scenario-specific settings when exporting a saved scenario.
- Add a readable exchange-rate/reference note in the assumptions or metadata slide and appropriate currency units on individual monetary slides. Parameter detail slides that retain original inputs must explicitly retain their original currency labels.

### CSV and generic chart/table exports

For consistency, monetary result CSVs should follow the selected currency and carry clearly labeled units and rate metadata. Existing local-currency source downloads must remain explicitly labeled. Generic chart/table export endpoints should either receive already converted presentation rows or convert raw rows once through an explicit unit-aware path; never both.

Use a currency suffix such as `_USD` or `_NPR` in output filenames where practical, alongside the contribution-view suffix. Export failures caused by invalid USD settings must return a useful validation message, not silently fall back to local-currency numbers under USD labels.

## 7. Suggested code locations

- `frontend/src/components/InputPanel.tsx`: rate setup in the country/currency section, via presentation props rather than model setters.
- `frontend/src/App.tsx` and `frontend/src/areaBundle.ts`: shared state, persistence, scenario restoration and Edit rate navigation.
- `frontend/src/components/InterventionPanel.tsx` and `ResultsDashboard.tsx`: selectors, rate note and downstream display props.
- `LiveInterventionChart.tsx`, `ScenarioGapTables.tsx` and other monetary result components: unit-aware conversion of displayed data and summaries.
- A shared frontend currency helper and a matching export-layer helper: keep direction, validation and labeling consistent, without economic calculations.
- `ExportButtons.tsx`, chart/table export components, saved-scenario export actions and relevant handlers in `app.py`: presentation metadata propagation.
- `export_data.py`, `export_pptx.py`, `deck_data.py`, `export_deck.py` and their render helpers: result-only translation for native outputs.

Use current file names/signatures and preserve prior fixes. Do not repurpose `country_config.currency`, `macro.exchange_rate`, GDP inputs, model cost fields or intervention toggle definitions for the display preference.

## 8. Focused acceptance checks

1. Reproduce the conversion table above, including a negative amount. Verify rates below 1 and rates requiring several decimal places.
2. Switch local → USD → local repeatedly; original displayed local values and underlying result objects remain unchanged. No rate or mode edit triggers `/api/calculate`.
3. Confirm coverage counts, percentages, service targets, enabled interventions and input values remain unchanged. Existing USD-denominated input fields must not be converted twice.
4. Verify local/individual, local/category, USD/individual and USD/category combinations. Category sums and grand totals must reconcile at the same precision.
5. Check both sectors, year windows, urban/rural/national scopes, negative cash/financing contributions if supported, zero values and unavailable/null values. Preserve missing values as missing, not fabricated zeros.
6. Save/reload the working session, a saved scenario and a profile where supported. Restore rate metadata and preference; legacy records open in local currency. Changing the source currency invalidates an unrelated saved rate.
7. Confirm Edit rate navigates to the correct setup fields without changing scenario data. Validate keyboard access and readable controls on narrow screens.
8. Generate USD and local Excel outputs from both screens, chart/table downloads, result CSVs, screenshot-based PPT and native area-based PPT. Inspect converted values, axes, narrative figures and rate notes, plus retained local-currency detail.
9. Confirm an already-USD model uses an identity conversion and multi-area exports reject incompatible source currencies. Missing/invalid USD options must not produce mislabeled files.
10. Run normal frontend build/type checks and focused export smoke checks. A small currency-helper test and frontend/export parity check are sufficient; no new economic-model test suite is required for this feature.

## Completion report

Provide screenshots of rate setup and both currency selectors, changed files, sample USD/local exports and focused test results. Confirm that settings persist, monetary displays/exports convert once, coverage and local-currency calculations are unchanged, and switching currency causes no model requests. Leave the development version ready for review without publishing.
