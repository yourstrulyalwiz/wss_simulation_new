# Replit programming instructions: stepwise public-spending GDP targets

**Project:** WSS Strategic Simulation Tool  
**Repository:** https://github.com/yourstrulyalwiz/wss_simulation_new  
**Reviewed branch:** `main`  
**Reviewed commit:** `958f3f7112f99dcf21cfc5957dbeadd60d394f33`  
**Commit timestamp:** 2026-10-14 20:57:58 UTC  
**Prepared:** October 14, 2026, America/New_York  
**Status:** Implementation instructions approved in principle by the user; no application changes are included in this document.

## 1. Objective and implementation boundary

Extend **Increase in Public Spending → Target executed spending as a share of GDP** so the user can specify multiple target-share/year pairs. Add an **Add target and year** button after the first pair, and permit removal of additional rows.

Each target replaces the preceding GDP target from its effective year onward. Targets can increase, remain unchanged, or decrease, including below BAU spending. The spending share is stepwise; the monetary amount continues to scale with each year's modeled GDP.

Implement this in both water and sanitation, independently for each existing geographic input area. Preserve the current annual-increase option, capital-share convention, budget-execution attribution, pooled funding, dynamic billed volume, and loan comparison calculations.

This is a focused extension of the existing intervention. Do not introduce interpolation, an optimizer, a same-year feedback solver, new loan eligibility sources, a new dashboard layout, or a new spending forecast method.

## 2. Latest-code review and authoritative implementation points

The latest reviewed commit is two commits after the earlier review at `b177a82d0584fc0dbd73a509bdae415705650854`. Those changes concern the modern input-panel preview and documentation. The production spending, revenue, and loan calculations are unchanged between these commits.

The active frontend adapter explicitly sets `budget_source='entered_budget'`. The executed-spending equations below apply to that production workflow. Older direct-engine budget modes still exist and have regression tests; preserve their existing scalar behavior rather than rewriting their spending basis as part of this task.

| File / symbol | Current behavior and required work |
| --- | --- |
| `frontend/src/components/InterventionPanel.tsx` → `financialFields` | Renders one GDP target/share pair, additive annual-growth option, baseline reference, and effective-capital summary. Add the schedule editor here. |
| `model/inputs.py` → `WaterInterventionInputs`, `SanitationInterventionInputs` | Contains only `fin_gdp_enabled`, `fin_gdp_start_year`, and `fin_gdp_target_share` for this option. Add the optional schedule schema. |
| `demo_adapter.py` → `_financial_fields`, `to_engine`, frontend defaults | Explicitly enumerates financial fields. Pass the new list through this adapter or it will be lost before calculation. |
| `model/water_supply.py` → `sector_bau` | Shared sector calculation. GDP target currently uses `max(target_share * gdp[t] - commitment_base[t], 0)`. Add annual schedule resolution and signed adjustment for the new schedule. |
| `model/water_supply.py` → water caller's `financial_settings` | Pass water's schedule to the shared calculation. |
| `model/sanitation.py` → `financial_settings` | Pass sanitation's schedule to the same calculation. Do not duplicate the schedule algorithm. |
| `model/budget_forecast.py` | Independently forecasts entered executed and allocated spending using their GDP shares. Reuse unchanged. |
| `model/source_funding.py` → `allocate_sources` | Already handles signed contributions and proportional loss charges. Reuse its accounting precedence. |
| `model/connection_revenue.py`, `model/revenue_reconciliation.py` | Already derive scenario volume from prior delivered coverage and reconcile shared revenue. Preserve these formulas. |
| `model/utility_debt.py` → `solve_scenario` | Runs the intervention-only reference, sizes the loan once, and runs the financed scenario. Both runs must receive the schedule. |
| `model/engine.py` | Keeps pure BAU, combined scenario, and scenario without utility debt separate; already exposes signed source-funding outputs. Preserve these boundaries. |
| `frontend/src/App.tsx` and existing profile/session paths | Preserve the new field across area switching, scenario copying, saving, loading, and local-session restoration. |
| `frontend/src/resultsLedger.ts`, `sourceAttribution.ts`, chart/export consumers | Funding uses signed contributions; coverage uses actual funded stocks. Verify negative spending adjustments remain visible and correctly reconciled. |

The production application is built from `frontend/` into `static/` and served by FastAPI. The latest modern design under `artifacts/mockup-sandbox/` is preview-only. Implement and verify the working application; changing only the preview will not complete this task. Preserve the separately requested input-navigation design.

Source links pinned to the reviewed commit:

- [Spending calculation](https://github.com/yourstrulyalwiz/wss_simulation_new/blob/958f3f7112f99dcf21cfc5957dbeadd60d394f33/model/water_supply.py)
- [Spending controls](https://github.com/yourstrulyalwiz/wss_simulation_new/blob/958f3f7112f99dcf21cfc5957dbeadd60d394f33/frontend/src/components/InterventionPanel.tsx)
- [Adapter](https://github.com/yourstrulyalwiz/wss_simulation_new/blob/958f3f7112f99dcf21cfc5957dbeadd60d394f33/demo_adapter.py)
- [Current execution policy](https://github.com/yourstrulyalwiz/wss_simulation_new/blob/958f3f7112f99dcf21cfc5957dbeadd60d394f33/.agents/memory/financial-commitment-semantics.md)
- [Dynamic feedback regression examples](https://github.com/yourstrulyalwiz/wss_simulation_new/blob/958f3f7112f99dcf21cfc5957dbeadd60d394f33/test_dynamic_feedback.py)

## 3. User-interface behavior

Within the existing GDP-target option, show:

1. **Target executed spending share (% of GDP)**.
2. **Effective year**.
3. **Add target and year**.
4. An accessible **Remove target** control for additional rows.

Keep at least one displayed target row. Allow the first row to be edited; users can turn the option off to deactivate the schedule. Use the existing percent-input convention: display 0.50% and store 0.005.

Additional-row defaults should copy the preceding share and suggest the next available forecast year. A repeated share at a later year is valid and initially leaves the funding path unchanged. Do not create duplicate years or silently advance beyond the simulation end.

Evaluate completed rows chronologically, independently of insertion order. Avoid rearranging the row under the user's cursor while they are typing. Keep incomplete UI rows as drafts separate from the last valid serializable schedule. Use existing validation/error presentation while an active draft is invalid; do not present stale results as if calculated from that draft. Turning the option off can deactivate its draft error without discarding the draft.

Suggested help text:

> Each target applies from its effective year until the next target. Spending is recalculated using that year's GDP. Targets may increase or decrease; a target below BAU reduces public funding. Annual spending increases remain additive, and improved budget execution is reported separately.

Replace positive-only descriptions such as “only the positive difference above BAU is added” where they describe the new schedule. Change the summary label **Added effective capital over the forecast** to **Net public-spending capital adjustment over the forecast**, retaining its signed value.

Keep existing source identifiers, colors, intervention toggles, and dashboard structure. No new chart or separate contribution band is needed for each target. All schedule rows belong to the same Public Spending source.

## 4. Data contract and backward compatibility

### 4.1 New optional field

Add one shared target-point type and use it in both intervention input classes:

```python
class PublicSpendingTarget(BaseModel):
    year: int
    target_share: float  # fraction of GDP: 0.005 means 0.50%

# In both WaterInterventionInputs and SanitationInterventionInputs:
fin_gdp_targets: Optional[List[PublicSpendingTarget]] = None
```

Apply strict validation before coercion can turn invalid values into valid-looking ones. The sketch above specifies the shape, not the complete validators.

Example frontend/engine payload:

```json
{
  "fin_gdp_enabled": true,
  "fin_gdp_targets": [
    {"year": 2028, "target_share": 0.005},
    {"year": 2031, "target_share": 0.008},
    {"year": 2035, "target_share": 0.004}
  ],
  "fin_growth_enabled": false
}
```

The existing `fin_gdp_enabled` switch and the sector's master financial-commitment toggle continue to gate the entire option.

### 4.2 Distinguish old scalar inputs from new schedules

Use the optional list to distinguish the new contract without introducing a general migration framework:

| Input state | Interpretation |
| --- | --- |
| Field absent or `null` | Legacy scalar target; retain its existing start year, share, and positive-only calculation. |
| Nonempty list | New stepwise schedule with signed below-BAU adjustments. The list is authoritative. |
| Empty list while enabled | Invalid new schedule; show a validation error. Do not fall back to a stale scalar target. |
| Option disabled | No GDP-target adjustment; preserve entered settings for later reactivation. |

For an existing saved profile, display its scalar target as the first editable row without automatically changing its mathematical behavior. Explicit editing of the GDP target/share/year, or adding a target, adopts the new list contract. Merely loading a profile, changing another intervention, switching areas, or toggling the master intervention must not silently convert a formerly ignored below-BAU target into a spending cut.

A new/edited one-row schedule is valid. Once adopted, do not revert it to legacy behavior when the user removes the extra rows.

Retain the legacy scalar fields for old inputs and existing consumers. If synchronizing them for compatibility, copy only the earliest schedule point; never calculate both scalar and list contributions. When a list is authoritative, validate its points instead of the inactive scalar start-year/share placeholders. In particular, the current scalar-only start-year check must not reject an otherwise valid list. Do not promise that an older application build can reproduce a multi-target schedule.

Do not rewrite saved country-profile files in bulk or change their budget observations. Ensure the adapter distinguishes missing/`null` from `[]`; an `or []` shortcut would erase that distinction.

### 4.3 Validation

For an enabled new schedule:

- Require at least one complete point.
- Require integer, non-boolean years within `baseline_year + 1` through `forecast_end_year`.
- Require finite, nonnegative shares; zero is valid and is not a missing value.
- Reject duplicate years explicitly.
- Permit decreasing shares and repeated shares.
- Reject blank, malformed, negative, NaN, or infinite values rather than silently replacing them with zero.
- Use the model's positive, finite annual real-GDP validation.
- If changing the forecast horizon puts a saved target outside it, show the problem; do not silently drop or shift the target.
- Include area, sector, and offending row/year in useful validation messages.

Normalize a copy for calculation; do not mutate the caller's profile. Disabled schedules must not change BAU or prevent an otherwise valid calculation solely because an unused draft row is incomplete.

## 5. Annual target and spending equations

### 5.1 Target selection

For sorted points `(y_i, s_i)`, the active share in year `t` is the share of the last point satisfying `y_i <= t`.

- Before the first effective year: no GDP-target adjustment.
- On an effective year: apply that target in full.
- Between targets: hold the share constant.
- After the final target: hold its share through the forecast end.
- Historical years: no intervention adjustment.

Example:

| Years | Active share |
| --- | ---: |
| Before 2028 | No GDP-target adjustment |
| 2028–2030 | 0.50% |
| 2031–2034 | 0.80% |
| 2035 onward | 0.40% |

There is no ramp, interpolation, or accumulation across target rows.

### 5.2 Monetary target and signed adjustment

For the current entered-budget workflow, define:

- `GDP_t`: existing `ctx['gdp_real_local'][t]`, in real local-currency millions.
- `E_t`: that year's BAU executed spending on the entered capital/total basis, currently `commitment_base[t]`.
- `s_t`: active target share.
- `T_t = s_t * GDP_t`: target executed spending on the same basis.
- `D_gdp_t = T_t - E_t`: signed adjustment from the new GDP schedule.

Before the schedule begins, or when the GDP option is off, set `D_gdp_t = 0`.

Do not apply `max(0, ...)` to the new schedule's difference. The target itself is nonnegative; its difference from BAU can be negative. For legacy scalar inputs, retain the existing positive-only difference.

Each new target is compared with the same year's BAU executed spending, not the preceding target or baseline-year currency amount. Do not subtract the previous target and then add that difference on top of already accumulated target contributions.

### 5.3 GDP scaling

Recompute `T_t = s_t * GDP_t` every year, including all years after the last target. Use the existing projected GDP series, including its entered values and growth assumptions.

For a constant 0.50% target:

| Year | Modeled real GDP | Target spending |
| --- | ---: | ---: |
| 2030 | 100 billion | 500 million |
| 2031 | 105 billion | 525 million |

Do not freeze spending at 500 million after 2030, multiply by GDP growth twice, add a separate inflation chain, or change the existing USD display conversion. A reduction in share does not necessarily imply a reduction in the monetary amount if GDP has grown enough.

### 5.4 Preserve the additive annual-increase option

Keep the existing annual-growth calculation intact, including:

- Its inclusive exponent `year - growth_start_year + 1`.
- Its use of each year's BAU executed-spending base.
- Its post-window achieved GDP-share floor.
- Its zero-growth no-op behavior.
- Its independence from the GDP-target schedule and execution gains.

Call its existing nonnegative adjustment `D_growth_t`. Then:

```text
D_total_t = D_gdp_t + D_growth_t
Executed spending at baseline execution = E_t + D_total_t
```

For an active new GDP target this becomes `T_t + D_growth_t`. Therefore, the scheduled share is not a ceiling when the annual-increase option is also enabled.

Do not rebase the annual-growth formula on the scheduled target or add the target into the growth option's held-share calculation. A zero GDP target does not cancel the separately enabled annual-growth contribution.

### 5.5 Minimal shared algorithm

Use a small shared resolver, in the existing module or a narrowly scoped helper:

```python
# Pseudocode: preserve existing validation and legacy branches.
schedule = normalize_and_validate_if_enabled(fin_gdp_targets, period)

for t, year in enumerate(years):
    if year <= baseline_year:
        continue

    gdp_delta = 0.0
    if financial_enabled and gdp_enabled:
        if schedule_is_new:
            point = last_point_at_or_before(schedule, year)
            if point is not None:
                gdp_delta = point.target_share * gdp[t] - commitment_base[t]
        else:
            gdp_delta = existing_legacy_scalar_delta(t, year)

    growth_delta = existing_annual_growth_delta(t, year)
    public_delta = gdp_delta + growth_delta
    additional_public_capital[t] = public_delta * applicable_capital_share

# Continue through the existing execution and funding calculations.
```

Both sector callers must pass the full schedule. Avoid separate frontend and backend monetary formulas. Keep one authoritative calculation.

For dormant direct-engine budget modes, preserve their scalar calculations and established conversion factors. Do not silently run the new executed-target equations against an allocation/cost-derived basis. If supporting an explicit new schedule through such a caller requires a different economic interpretation, return a clear unsupported-basis error for that combination rather than inventing one; the production adapter already supplies `entered_budget`.

## 6. Capital share and budget-execution attribution

Use the existing area/sector total-spending flag:

```text
k = configured capital share, if budget_is_total_spending is true
k = 1, otherwise
```

Apply `k` exactly once to the signed spending adjustment. The executed target is not discounted by baseline execution again.

For each forecast year in the entered-budget workflow, let:

- `E`: BAU executed spending on the input basis.
- `A_eff`: effective BAU allocation on that same basis.
- `r0 = E / A_eff`: existing baseline execution rate.
- `r1`: scenario execution rate under the existing execution intervention.
- `D = D_total_t`.

For valid positive `r0`, retain these identities:

```text
Baseline public capital       = k * E
Public Spending contribution  = k * D
Revised effective allocation  = A_eff + D / r0
Budget Execution contribution = k * (A_eff + D / r0) * (r1 - r0)

Combined public capital
  = Baseline + Public Spending + Budget Execution
  = k * (E + D) * r1 / r0
```

The current `financial_cash`, `additional_allocation_capital`, and `execution_interaction` equations already provide this structure. Allow the schedule delta to remain signed through them. Do not clip the interaction or the final Budget Execution source to zero.

Preserve these existing boundaries:

- Executed spending above allocation is valid; do not clip `r0` at 100%.
- Positive executed spending with zero entered allocation uses executed spending as the effective allocation and 100% baseline execution, while retaining the raw allocation.
- When a nonzero spending adjustment requires division by an unavailable/nonpositive baseline execution rate, show a targeted error. Do not silently allow `np.divide(..., out=0)` to discard the adjustment.
- When the adjustment is zero, avoid the unnecessary division and preserve existing execution-only behavior. In particular, zero executed spending with positive allocation can still have an execution-only benefit; do not remove that behavior.
- Capital share zero produces zero public-capital contributions once the financial inputs are otherwise valid.
- External Funding remains a separate source with its existing one-time/recurring rules.

### Exact arithmetic acceptance fixture

Use synthetic inputs: GDP = 100, BAU executed spending = 1, effective allocation = 5, baseline execution = 20%, improved execution = 40%, capital basis (`k=1`), annual growth off.

| New target | Target spending | Baseline source | Public Spending source | Budget Execution source | Combined public capital |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2.00% | 2.00 | 1.00 | 1.00 | 2.00 | 4.00 |
| 0.50% | 0.50 | 1.00 | -0.50 | 0.50 | 1.00 |
| 0.00% | 0.00 | 1.00 | -1.00 | 0.00 | 0.00 |

With execution reform off, the combined amounts are 2.00, 0.50, and 0.00. With total-spending mode and `k=0.30`, all three source amounts and their combined total are multiplied by 0.30. With the total-spending flag off, an inactive 30% slider must have no effect.

## 7. Signed funding, coverage, and reporting

Pass signed `financial_cash` into the existing ordinary-funding total and `sources['financial']`. Keep the identity:

```text
sum(ordinary signed source contributions) == available_total
```

Reuse the existing allocation sequence:

1. Absorb negative contributions proportionally from positive ordinary sources.
2. Pay debt service from the originally selected eligible sources.
3. Pay replacement from the remaining ordinary pool.
4. Allocate actual purchases proportionally, using ordinary funds before restricted loan proceeds.

A spending cut is a signed financial adjustment, not a new replacement obligation. Do not subtract it a second time, add it to replacement requirements, or generate negative purchase weights. Preserve separate loss, debt-service, and replacement shortfall reporting.

Coverage charts must continue to show actual source-funded household stocks from the combined run. A negative financial contribution cannot buy a negative number of households. Earlier Public Spending-funded stock remains attributed under the existing transition rules; it is not deleted simply because a later year's target is lower.

The existing model does not automatically destroy infrastructure because a replacement payment is unfunded. Preserve that behavior. A lower spending path changes future funding and delivery and can affect future revenue; it is not an automatic physical disconnection event.

Keep these existing response contracts:

- `financial_commitment_cash` / `scenario_financial_commitment_cash`: signed combined public-spending adjustment, including enabled annual growth.
- `source_funding.signed_contribution.financial` and scenario-prefixed equivalents.
- Existing budget-execution, funded-purchase, and coverage-attribution fields.

Check charts, axis domains, tables, totals, tooltips, and exports for positive-only assumptions. Display negative funding below zero where applicable, with the existing sign convention. Keep financial-gap effects separate from actual source-funded coverage. Do not introduce a target-row band or reassign all downstream utility revenue to Public Spending.

Use existing outputs and internal resolver checks for verification. Additional public diagnostic fields are not required merely to implement the schedule.

## 8. Dynamic billed volume V_t and loan consistency

Public spending is money; it is not a direct term in billed-water volume.

The existing causal sequence must remain:

```text
Spending adjustment in year t
→ ordinary funding after existing obligations
→ actual funded service delivery during t
→ prior-year coverage input to the volume calculation in t+1
→ tariff, collection, and dynamic NRW calculations on the reconciled volume
```

In `sector_bau`, `annual_connection_cash` receives the previous year's delivered SM and Basic stocks. Preserve this lag. Apply the spending schedule before funding/delivery, so the already-existing pathway transmits the effect naturally.

Preserve:

- The shared revenue-base and NRW-overlap reconciliation.
- The current addition-only direct connection-volume rule.
- The distinction between a dynamic volume base and admitting direct new-connection cash to funding.
- Dynamic volume effects on collection/tariff even when direct new-connection revenue funding is switched off, provided the shared dynamic-volume configuration is valid.
- Current dynamic NRW throughput/cost scaling and exclusion of NRW's own physical upgrades from self-amplifying expansion.
- Consolidated scenario results independent of intervention click order.
- Actual coverage-source accounting and the established revenue interaction attribution.

A spending reduction does not imply an immediate fall in `V_t`. It may yield less expansion and lower future volume than the higher-spending counterfactual. Do not force a volume decrease, remove existing connected customers, or change the addition-only rule to make the graph appear to respond immediately.

For loan comparisons:

- Supply the same schedule to intervention-only/no-loan and financed runs.
- Let each run produce its own coverage and subsequent revenue path.
- Preserve loan sizing from the selected sources in the no-loan reference year.
- Preserve fixed principal and contractual repayments within a run; do not resize after every target change in the simulated timeline.
- Recalculating a user-edited scenario can produce a different loan if the reference-year eligible revenue changed.
- A target change after the loan reference year must not retroactively change that year's revenue or principal through look-ahead.
- Keep Public Spending out of the loan source picker unless separately authorized.
- Verify the no-loan chart reads the no-loan result, including its own dynamic volume; do not reuse the financed series.

No new loan algorithm is requested.

## 9. Focused implementation sequence

1. Add the shared target-point schema and optional list; retain legacy fields.
2. Add schedule pass-through to frontend defaults/serialization as needed, `_financial_fields`, and both sector `financial_settings` dictionaries.
3. Implement one normalization/validation/annual-resolution helper with explicit legacy-versus-new semantics.
4. Replace only the new schedule's GDP contribution with the signed difference. Preserve annual growth and external funding.
5. Carry the signed adjustment through current capital conversion, execution interaction, and source-funding accounting.
6. Add the row editor and revise positive-only help/summary wording.
7. Verify profile/session/area round trips, reporting signs, and the two loan paths.
8. Add the focused regressions below and rebuild the production frontend.
9. Update relevant comments and `.agents/memory/financial-commitment-semantics.md` to distinguish the new signed schedule from legacy scalar targets and the still-positive annual-growth floor.

Do not generalize this into a shared scheduler for every intervention. Do not alter unit costs, target coverage paths, allocation priorities, unrelated UI navigation, or saved country calibration.

## 10. Acceptance and regression checks

Create a focused `test_public_spending_schedule.py` or equivalent small test module. Reuse controlled fixtures from existing budget/dynamic-feedback tests. Country observations must not be modified to make tests pass.

| Check | Required result |
| --- | --- |
| Legacy unchanged | Missing/null list reproduces old scalar results, including a below-BAU scalar target previously contributing zero. |
| One positive target | New one-row schedule above BAU matches the existing single-target result on the production budget path. |
| Adoption behavior | Editing/adding a GDP target adopts signed semantics; loading, area switching, or unrelated edits do not. Removing extra rows retains new semantics. |
| Step boundaries | Example 2028/2031/2035 points apply exactly in those years. Before the first point there is no GDP adjustment. |
| Up then down | A later lower share replaces the earlier share; no accumulation, ramp, or historical rewriting. |
| Below BAU / zero | Exact fixture in Section 6 reconciles, with and without execution reform. |
| GDP growth after last point | Active target amount equals share × that year's GDP in every remaining forecast year. |
| Year-specific BAU override | Delta uses the current year's BAU executed spending, including an explicit forecast override. The new schedule still reaches its target rather than acting as a BAU floor. |
| Capital basis | Total-spending flag on applies k once; flag off ignores slider; test k=0, 0.3, and 1. |
| Execution boundaries | Overspending is not clipped; positive E/zero allocation fallback survives; nonzero adjustment with invalid r0 errors; zero-adjustment execution-only case remains valid. |
| Growth additive | GDP schedule plus existing growth equals the sum of their adjustments. The standalone post-window growth floor and zero-growth no-op remain unchanged. |
| Disabled options | GDP option off leaves annual growth available; master off suppresses both; pure BAU is identical regardless of schedule content. |
| Input validation | Duplicate, noninteger/boolean, out-of-range years and invalid shares fail clearly; unsorted valid rows evaluate chronologically; zero share remains valid. |
| Funding conservation | Signed ordinary sources sum to available funding; negative cuts are charged once; purchase weights remain nonnegative. |
| Coverage conservation | Source stocks reconcile to combined coverage, with no negative purchases or artificial deletion of previously delivered stock. |
| Next-year V_t | A spending change in t can change delivered coverage in t, but that year's opening-volume calculation remains unchanged; volume/reform effects appear in t+1 when delivery differs. |
| Connection funding toggle | Valid dynamic volume still responds with direct connection funding off; that source's admitted cash remains zero. |
| NRW / sanitation link | In a scenario with NRW and linked sanitation, the new funding path flows through existing dynamic calculations without duplicated recovery or revenue. |
| Loan consistency | Same schedule in both runs; separate dynamic outputs; principal frozen within the run; a later target has no look-ahead effect on reference-year sizing. |
| Independent scope | Water edits do not change sanitation settings; urban/rural/national schedules persist independently. Existing cross-sector NRW links still operate when selected. |
| Toggle order | Identical final inputs produce identical outputs regardless of the sequence of UI activation. |
| Round trip | Profile JSON and working-session save/reload preserve rows, fractions, years, and legacy/new distinction. |
| UI / exports | Add/edit/remove works at desktop and narrow widths; negative net capital is labeled correctly; signed tables/graphs/exports reconcile. |

For meaningful volume tests, use eligible unserved households and enough funding for the scenario differences to affect actual delivery. Coverage saturation can legitimately make two spending paths produce identical volume; do not demand strict inequalities in a saturated fixture.

Suggested backend verification from repository root after implementation:

```bash
python -m unittest test_public_spending_schedule test_budget_forecast test_public_spending_execution test_dynamic_feedback test_source_attribution test_sector_independence
```

The first module is new; the other named modules already exist. Use the repository's normal Python environment. Extend relevant existing tests only where a concrete integration risk remains.

Add a focused browser check using the existing `frontend/tests/*-browser.mjs` conventions. Run it against the rebuilt application and exercise profile/session round trips. Do not use a production country profile as a writable test fixture.

Production frontend build, from repository root:

```bash
npm --prefix frontend ci
npm --prefix frontend run build
```

Restart the existing Replit workflow after the build. Its documented command is:

```bash
uvicorn app:app --host 0.0.0.0 --port 5000
```

Confirm the displayed application contains the schedule controls after restart. Do not treat a passing preview build as proof the production bundle was updated.

## 11. Completion report requested from Replit

Return a concise implementation summary with:

- Files changed and the new input shape.
- Confirmation of legacy compatibility and explicit adoption behavior.
- The Section 6 arithmetic results, including the downward and zero targets.
- Evidence that final-target spending continues to scale with GDP.
- A controlled next-year volume example and a with/without-loan consistency check.
- Actual tests/build checks run, their outcomes, and any unresolved limitation.

If the branch has advanced beyond the reviewed commit, inspect intervening changes before applying these instructions and preserve unrelated work. The review behind this document was a source review; the acceptance checks above describe work to perform during implementation, not application tests already executed for this document.

