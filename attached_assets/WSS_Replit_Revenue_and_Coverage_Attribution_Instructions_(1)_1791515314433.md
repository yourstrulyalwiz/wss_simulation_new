# WSS Simulation Tool — consolidated Replit instructions, revision 2

**Updated:** 8 October 2026, after the 11:00 pm New York discussion  
**Repository:** https://github.com/yourstrulyalwiz/wss_simulation_new  
**Verified main commit:** cea9331bb303e700c51c8e46882aeb45bc6e4188  
**Reference:** profiles/DRC OCT 8.json  
**Status:** Proposed implementation instructions; no repository changes have been made.

**Use this document instead of the previous version.** The previous instructions have not been implemented. Implement this consolidated version directly; do not first implement its superseded replay approach.

## 1. Scope and decisions

The objective is to attribute achieved coverage to the funding sources that actually finance expansion, consistently with the reconciled revenue breakdown. Preserve the current application layout and stacked coverage chart style.

Agreed behavior:

1. Keep the combined-scenario revenue calculations, one-year connection-revenue lag, and recurring receipts from the entire eligible post-baseline coverage increment.
2. Direct connection receipts use baseline tariff and collection. Tariff and collection increments use the expanded reconciled volume and remain attributed to their own sources.
3. Use gross additional collected revenue, without new connection operating-cost deductions. NRW remains net of implementation cost under its existing sales/avoided-cost assumptions.
4. Cover negative source contributions proportionally from positive ordinary funding, including baseline funding. Preserve the originating source's signed revenue.
5. Service debt only from originally selected revenue sources. Preserve the accepted loan amount and contractual repayment schedule; report any unpaid amount without charging unselected sources.
6. Pay replacement from the entire remaining eligible ordinary pool FIRST. Allocate that actual payment proportionally back to sources SECOND. There are no source-specific replacement obligations or source-specific replacement shortfalls.
7. Remaining funding follows the configured Basic/SM investment split, unit costs, non-household allocation and eligibility/reallocation rules. Attribute actual purchases to their funding sources.
8. Restricted loan proceeds remain separate and available only for expansion, with the existing unused-proceeds carryover.
9. Charts, coverage-contribution tables and exports use the same backend attribution.
10. Preserve unrelated calculations, inputs, workflow, financial-gap presentation, currency controls, defaults and profile data.

**Superseded:** Do not implement the previous fixed-revenue replay, a new comparison-order control, or moving the connection stage last as the solution. Do not use successive full-scenario differences to compute cash-source coverage bands.

Source attribution is an accounting decomposition, not an independently identifiable causal marginal effect. The only intended change to actual financing/delivery behavior is restricting debt payments to selected sources when those sources are insufficient. Proportional allocation of losses and replacement must not independently change aggregate spending.

The implementation conventions below resolve details not uniquely determined by the accounting: proportional payment within selected debt sources, proportional purchase attribution, and proportional removal of unattributed household origins during service transitions. These are backend conventions, not new user settings.

## 2. Repository verification and current findings

The main revision was checked again for this update and is **identical** to the earlier review: cea9331bb303e700c51c8e46882aeb45bc6e4188. Eight locally inspected key files were matched against their Git blob hashes, including the saved October 8 profile, revenue and funding code, engine, loan code and both coverage consumers.

This verifies the connected GitHub main revision. It does not prove that an unsynced Replit working directory is identical. Replit should check its own working tree before editing and preserve any unrelated local changes.

| Area | Current behavior | Revision 2 action |
| --- | --- | --- |
| model/connection_revenue.py | Prior-year delivered coverage, aggregate increment, nonnegative direct connection receipts | Preserve equations and timing. |
| model/revenue_reconciliation.py | Baseline-rate connection/NRW cash; collection then tariff on reconciled volume | Preserve signed source amounts and interaction ownership. |
| model/water_supply.py, sector_bau | Pooled signed cash, pooled contractual debt deduction, replacement reservation and actual delivery | Add source ledger; replace the pooled debt deduction with funded payments from selected sources. |
| model/utility_debt.py, solve_scenario | Frozen no-loan sizing; passes schedule into financed calculation | Preserve sizing/schedule; also pass immutable servicing-source keys. |
| model/engine.py | Separate pure BAU and scenario; exposes scenario outputs | Preserve BAU and expose one source-accounting result. |
| LiveInterventionChart.tsx and ResultsDashboard.tsx | Coverage contributions from successive toggle runs | Consume actual source-funded coverage; no replay for coverage. |
| deck_data.py and export_data.py | Similar cumulative household-contribution logic | Use the same backend coverage fields as the UI. |
| BasicCoverageChart.tsx | Exclusive Basic paths, allowing decreases after SM upgrades | Retain this existing representation. |

Current key names need care: ws_capital_efficiency_enabled is labelled Budget execution, whereas ws_costeff_enabled is Capex efficiency. Follow the registry and mechanics, not an inference from the toggle name.

## 3. October 8 scenario: verified timing and review observations

The saved profile has a 2025 baseline and a forecast beginning in 2026. Urban collection and tariff ramps start in 2026, but their improvement is zero at the start point and becomes positive in 2027. Urban NRW starts in 2027; urban financial commitments start in 2028. Water connection revenue is enabled for urban and disabled for rural; sanitation connection revenue is disabled in both areas.

Pre-change calculations of the saved profile produced the following **urban water connection receipts**, in the engine's native **million CDF/year** units:

| Year | Without configured borrowing | With configured borrowing |
| --- | ---: | ---: |
| 2026 | 0 | 0 |
| 2027 | 0 | 0 |
| 2028 | 0 | 0 |
| 2029 | 5,175.553565 | 5,175.553565 |
| 2030 | 15,253.076615 | 17,818.104469 |
| 2035 | 70,188.166110 | 70,342.053899 |

**Clarification to the discussion:** 2027 is the earliest theoretically eligible revenue year for connections delivered in 2026. In this actual saved simulation, the first positive urban connection receipt is **2029**, reflecting the 2028 delivered coverage. The signed candidate volume is negative in 2027 and 2028 and is floored at zero. There must be no hard-coded 2027 or 2029 activation rule.

Rural connection revenue is zero because the saved feature is disabled. Do not automatically enable it while aggregating urban and rural results.

The saved rural water collection target is `0.009000000000000001` (0.9%), compared with a baseline of 70%. This creates negative collection contributions. Mention this input in the implementation completion report; do not add a new warning panel or silently change it to 90%. It is also a useful signed-attribution test case.

## 4. Preserve the annual revenue calculation

### 4.1 Aggregate connection-volume increment

For baseline year b and revenue year t, retain the current definition:

```text
s0 = baseline_basic_share + baseline_sm_share

weighted_increment_t =
    billed_share_basic * (delivered_basic_(t-1) / total_households_(t-1) - baseline_basic_share)
  + billed_share_sm    * (delivered_sm_(t-1) / total_households_(t-1) - baseline_sm_share)

candidate_connection_volume_t = baseline_volume_t * weighted_increment_t / s0
raw_connection_volume_t = max(0, candidate_connection_volume_t)
connection_volume_t = raw_connection_volume_t - valid_identified_overlap_t
```

Overlap cannot exceed the positive increment or remove baseline volume. Preserve matching units, the prior-year denominator, population/volume growth handling, SM-versus-Basic weighting, and sanitation-specific overlap eligibility.

This is an aggregate additional-coverage proxy. The label “Revenue from post-baseline connections” is useful, but its tooltip must not imply that every individual post-baseline household is tracked or that population-only growth automatically generates an extra connection component.

### 4.2 Revenue-source identity

Let V0 be the baseline billed-volume path, VC the reconciled connection increment, VN eligible incremental NRW sales, p0/c0 baseline tariff/collection, and pt/ct current-year rates. Then:

```text
V = V0 + VC + VN

connections_cash = VC * p0 * c0
collection_cash  = V * p0 * (ct - c0)
tariff_cash      = V * (pt - p0) * ct
nrw_net         = VN * p0 * c0 + configured_avoided_cost_savings - implementation_cost
```

For the standard sales-only case, the cash reconciliation is:

```text
connections_cash + collection_cash + tariff_cash + nrw_net
    = V * pt * ct - V0 * p0 * c0 - implementation_cost
```

Keep water-to-sanitation linked cash separate as the existing code does, and count it once. Preserve avoided-cost scenarios rather than silently converting all NRW into sales.

Optional diagnostic decomposition, useful for testing interaction ownership:

```text
collection_on_connections = VC * p0 * (ct - c0)
tariff_on_connections     = VC * (pt - p0) * ct
```

These are explanatory subsets of collection/tariff cash, not additional funding rows to add again.

### 4.3 Annual calculation order

Resolve all selected interventions for the combined scenario. In each year, obtain connection volume from the preceding year's achieved coverage, reconcile volumes and current-year rates, calculate funding, then deliver that year's service transitions. All selected interventions therefore influence the next year's eligible base.

Do not move revenue calculation after current-year investment and feed it back into that same investment. Do not do an end-of-horizon revenue pass and spend its receipts retrospectively. Keep the forward annual calculation; no same-year fixed-point iteration is needed.

Do not add last year's total connection receipts to the current full-base calculation. The current calculation already represents recurring annual receipts associated with the eligible increment.

## 5. Replace pooled source attribution with one annual funding ledger

Implement a small pure allocation helper, called inside the existing annual sector loop. Do not build a second delivery engine or a new end-user workflow.

Use engine units throughout: money in million local currency and households in millions. Calculate independently for each area, sector and year.

### 5.1 Construct ordinary source amounts exactly once

Let r[s] be each source's signed current-year contribution to ordinary funding:

- Baseline effective capital funding, not gross baseline utility turnover.
- Budget-execution increment, separately identified from the baseline component.
- Financial commitments, exogenous injections and other existing cash interventions.
- Baseline-rate connection receipts.
- Collection receipts, tariff receipts and signed NRW net cash.
- Sanitation-linked NRW cash and custom cash, exactly once.

Reconcile their sum to the existing available_total before any new deductions. In particular, do not add reference_collected_revenue as extra funding.

Where the existing scenario's bau_available includes improved execution, decompose that effective-budget component into its unchanged baseline part and the execution increment. Do not tag both the full effective budget and its increment as cash. Separate other budget modifiers using the existing formulas; cross-effects already included in a financial-commitment cash row must not be tagged a second time as execution cash.

Use stable keys internally. Labels/category grouping must not determine calculations. Restricted loans and separately accounted household microfinance/grant mechanisms are not ordinary utility-revenue sources.

### 5.2 Cover negative contributions proportionally

For all ordinary sources:

~~~text
positive[s] = max(r[s], 0)
P = sum(positive[s])
loss_due = sum(max(-r[s], 0))
loss_paid = min(loss_due, P)

loss_charge[s] = loss_paid * positive[s] / P       if P > 0, otherwise 0
after_loss[s] = positive[s] - loss_charge[s]
uncovered_loss = loss_due - loss_paid
~~~

Keep r[s] signed in the revenue table. The positive sources' loss charges explain how that negative contribution is absorbed; they are not a second expense to subtract from an already netted pool.

If several sources are negative, allocate covered loss back to those originating sources proportionally to their loss amounts for internal audit. Do not give a negative source a negative purchase or a negative number of financed connections.

Check:

~~~text
sum(after_loss) = max(sum(r), 0)
uncovered_loss = max(-sum(r), 0)
~~~

Restricted loan proceeds cannot cover these losses. No available pool means zero division and an explicit shortfall, not NaN or invented cash.

### 5.3 Pay scheduled debt only from selected sources

Let S contain the revenue-source keys selected when the modeled loan is sized; use the existing normalized selection. Keep the current mapping of connections, collection, tariff and NRW/eligible linked cash. Use each area's and sector's own selection. Do not add sources to legacy selections automatically.

For fixed contractual debt service D in this year:

~~~text
selected_capacity = sum(after_loss[s] for s in S)
debt_paid = min(D, selected_capacity)

debt_charge[s] =
    debt_paid * after_loss[s] / selected_capacity  for s in S and selected_capacity > 0
    0                                            otherwise

after_debt[s] = after_loss[s] - debt_charge[s]
unpaid_debt_service = D - debt_paid
~~~

This recommended allocation uses the current positive selected-source balances, after loss absorption. It does not use negative weights or assign repayments to baseline funding when baseline was not selected.

The existing allocation_share continues to size the fixed annual commitment and initial loan. Do not multiply the scheduled payment by that percentage again. No new annually recalculated repayment ceiling or payment percentage is introduced by this brief.

Preserve the interest rate, tenor, accepted principal, start date, schedule and frozen no-loan sizing reference. Do not resize loans from the financed scenario or the source-accounting output.

**Unpaid does not mean forgiven.** Keep contractual debt_service_due separate from debt_service_paid and debt_service_shortfall. Retain the contractual amortization schedule; do not describe its principal reductions as fully cash-paid if there is a shortfall. Record unpaid principal/interest funding distinctly if the existing debt table shows those components. Do not invent refinancing, penalties, interest on arrears or automatic future catch-up payments.

The approved selected-source restriction allows other ordinary sources to remain available for replacement/expansion while a selected-source repayment shortfall is reported. This is a modeling convention, not verified affordable borrowing. It can change actual outcomes compared with the old pooled contractual deduction.

### 5.4 Calculate replacement from the whole remaining pool FIRST

Use the actual replacement obligation already calculated from funded assets, with the same timing and service attribution as today.

~~~text
remaining_pool = sum(after_debt[s])
replacement_paid = min(replacement_due, remaining_pool)
unfunded_replacement = replacement_due - replacement_paid

replacement_charge[s] =
    replacement_paid * after_debt[s] / remaining_pool   if remaining_pool > 0
    0                                                  otherwise

ordinary_expansion[s] = after_debt[s] - replacement_charge[s]
~~~

Allocate a payment already known to be affordable. Never allocate the gross replacement obligation to sources first, floor their balances separately and sum the resulting deficits.

The invariant is: if unfunded_replacement is positive, all eligible ordinary funds have been applied and ordinary expansion is zero. A zero-balance source cannot create a replacement shortfall while another eligible source still has cash.

Do not substitute pure-BAU replacement for the actual scenario's funded-asset obligation. The current local name bau_replacement inside sector_bau reflects that pass's funded stock, not permission to use the separate BAU counterfactual's obligation.

Restricted loan proceeds are excluded. Preserve existing reporting of unfunded replacement and accumulated shortfalls; do not charge prior shortfalls again as current replacement unless the existing model explicitly does so.

### 5.5 Shortfalls and compatibility fields

Record uncovered_loss, unpaid_debt_service and unfunded_replacement once each. Uncovered loss and unpaid debt belong in the existing cash-shortfall framework; replacement remains its separate shortfall component. Preserve existing service-level allocation and roll-forward conventions.

The old max(-(available_total - scheduled_debt_service), 0) expression is insufficient under source-restricted payments: selected sources can be short even when other sources are positive. Update all dependent funding, gap, loan-summary and export consumers rather than leaving a second old calculation active.

Keep scheduled debt fields contractual. Add explicit actual-funded payment fields rather than silently changing their meaning. The ordinary spendable balance is sum(after_debt); do not subtract the unpaid scheduled portion from unselected sources elsewhere.

## 6. Fund and attribute actual Basic/SM expansion

### 6.1 Preserve the delivery engine

Sum ordinary_expansion and add the available restricted loan balance to obtain expansion capacity. Reuse the existing Basic/SM split, actual unit costs, non-household share, opening eligible pools, physical NRW priority, spillover between service allocations, ancillary spending and stock roll-forward.

Do not independently simulate expansion once per source. That could purchase the same eligible household more than once or make results depend on source ordering.

First calculate the actual delivered transitions and expenditures once from the combined capacity. Then assign the purchases to sources using the rules below. This implements the shared Basic/SM funding proportions without duplicating eligibility constraints.

### 6.2 Source participation in actual purchases

Preserve the existing priority of spending ordinary expansion cash before restricted loan cash.

Let actual_sector_spend include paid household-transition capital and ancillary capital, excluding separately accounted microfinance/grant expenditure.

~~~text
O = sum(ordinary_expansion)
ordinary_used = min(O, actual_sector_spend)
loan_used = actual_sector_spend - ordinary_used

ordinary_spent[s] =
    ordinary_used * ordinary_expansion[s] / O     if O > 0
    0                                             otherwise
~~~

Require loan_used to be no greater than available restricted loan cash. Retain the existing loan cash closing balance. Do not introduce carryover for unused ordinary cash.

Assign each source's spend proportionally across the actual capital-spending categories: Basic transitions, SM transitions and ancillary expenditure. Include loan-used as a separate financing source in that allocation. The sum for each category must reproduce the authoritative category spend. This preserves source proportions through common Basic/SM splits and eligibility-driven reallocation while respecting the ordinary-first loan rule.

For actual paid transition j, with N[j] delivered households and capital X[j]:

~~~text
source_households[s,j] = N[j] * source_capital[s,j] / X[j]   if X[j] > 0
~~~

Use the engine's exact transition expenditure, including its non-household factor consistently. Do not divide sector cash by a household-only unit cost without applying that factor. Ancillary expenditure and unused funds earn no direct new-household credit.

Zero-cost delivery requires a separate physical/cost mechanism attribution; do not divide by zero or distribute households based on nonexistent cash.

### 6.3 Worked annual example

Assume all figures use consistent illustrative money units; no loan proceeds or non-cash upgrades. Only tariff is selected to service a debt payment of 30. Replacement due is 60.

| Source | Signed contribution | Charge covering negative NRW | Debt paid | Replacement paid | Expansion balance |
| --- | ---: | ---: | ---: | ---: | ---: |
| Baseline | 100 | 10 | 0 | 36 | 54 |
| Tariff | 60 | 6 | 30 | 9.6 | 14.4 |
| Connections | 40 | 4 | 0 | 14.4 | 21.6 |
| NRW | -20 | Loss covered by others | 0 | 0 | 0 |
| Total positive cash / uses | 200 | 20 | 30 | 60 | 90 |

The combined signed contribution is 180, not 200. Do not subtract both the -20 and another 20 from that already-netted amount.

If the investment split is 40% Basic / 60% SM, the 90 finances 36 Basic capital and 54 SM capital. With Basic unit cost 2, SM unit cost 6, no non-household factor and sufficient eligible households, delivery is 18 Basic entries and 9 SM upgrades:

| Source | Basic entries | SM upgrades |
| --- | ---: | ---: |
| Baseline | 10.8 | 5.4 |
| Tariff | 2.88 | 1.44 |
| Connections | 4.32 | 2.16 |
| Total | 18 | 9 |

These are delivered transition counts, not the net change in exclusive Basic stock.

### 6.4 Preserve non-cash effects without double-counting

- **NRW physical upgrades:** add the actual delivered upgrades to NRW separately from its source-funded purchases. A negative NRW cash contribution can coexist with a positive physical contribution. Preserve existing overlap and capacity logic.
- **Microfinance/grants:** use the existing separate delivered flows and attribution. Preserve the current exclusion of self-financers; do not count their hypothetical connections as delivered.
- **Budget execution:** attribute its effective funding increment once, as a cash-capacity source, without reclassifying it as utility revenue.
- **Capex efficiency and technology:** retain their actual lower unit costs. Consequently, their delivery benefit is already embedded in households financed by all sources. Do not add the old sequential efficiency household band on top of source-funded counts.
- **Mixed custom interventions:** tag their actual cash and direct physical flows; cost modifiers remain embodied in unit costs. Preserve all existing input/functionality.

A pure cost-efficiency intervention is not an independent funding source. Keep its existing cost-savings/resource information, but mark its coverage cell briefly as “Included in funded additions” where it previously showed a separate sequential contribution. Do not create another view or fictitious cash stream to preserve that old number. This necessary attribution correction does not remove the cost intervention or change its physical result.

## 7. Coverage stocks, BAU and chart reconciliation

### 7.1 Track the source of current service stocks, not just annual receipts

Initialize historical/baseline service stocks under an opening/baseline key. For forecast years, carry source-attributed stocks forward:

1. Add paid Lower-to-Basic entries to Basic under their funding source.
2. Remove all Basic-to-SM upgrades from the opening Basic source stocks. Where household identity is unavailable, allocate removals proportionally across opening Basic source stocks, with a cap at each stock.
3. Credit the resulting SM households to the current upgrade's funding/physical source.
4. Current-year Basic entrants cannot enter the opening upgrade pool.
5. Carry SM stocks forward under the engine's actual retention rules. Allocate any actual reductions consistently to existing source stocks; do not introduce retirement merely because replacement was unpaid.
6. Keep actual population-residual treatment unchanged. Any existing demographically driven change in a plotted service stock must have an explicit opening/baseline attribution, not a fabricated intervention credit.

Retain both annual Basic-entry/SM-upgrade counts and source-attributed current Basic/SM stocks. A Basic household financed by source A can later leave A's Basic layer when source B finances its SM upgrade. That is a service transition, not a negative revenue receipt.

For each year, sector and area:

~~~text
sum(source_stock[s, Basic]) = actual_scenario_basic_stock
sum(source_stock[s, SM])    = actual_scenario_sm_stock
~~~

Track direct physical and externally financed flows exactly once. Sum area counts before converting to percentage coverage.

### 7.2 Essential BAU correction with minimal visual change

It is mathematically invalid to stack all non-baseline source-funded households above the old pure-BAU path. Baseline cash can fund a different amount of expansion in the combined scenario because other sources share replacement/losses and cost interventions change purchasing power.

Use the existing stacked chart with:

- The familiar baseline-colored layer representing **opening plus baseline-funded coverage in the actual scenario**.
- Colored source/physical layers from the same scenario.
- Pure BAU retained as a thin comparison line, using the existing BAU color/conventions; reuse an existing BAU line where available.
- Existing target/ceiling, percentage/count controls, time window, colors and category grouping preserved.

Rename the affected base label to “Opening and baseline-funded coverage”; do not label that layer simply “BAU”. Keep the independent BAU data and total scenario-minus-BAU summary unchanged. A line and a corrected label in the existing chart are the minimum necessary reconciliation change, not a new panel or feature.

The source layers are funded/enabled coverage, not standalone causal marginal effects. Remove misleading “previous run” or sequential marginal wording from these coverage surfaces.

For tables:

~~~text
total coverage gain over BAU =
    (scenario opening/baseline-funded stock - pure_BAU stock)
  + sum(other source/physical attributed stocks)
~~~

Include the signed baseline-funded difference as a reconciliation row in an existing contribution table only where that table's rows are required to sum to the gain over BAU. Otherwise label the source column “Attributed coverage” or “Funded additions,” whichever metric it actually contains, and keep the existing total-gain summary separately. No opaque residual band, forced rescaling or unexplained “other” balancing number.

### 7.3 Negative contributions and Basic presentation

A negative cash source has no cash-funded positive expansion that year; its loss reduces the positive sources' remaining funding. It does not receive a made-up negative household band. Its historical funded stock can persist, and its direct physical contribution can still be positive.

Signed source effects remain visible in revenue/funding tables. Do not add a new coverage-loss chart or counterfactual mode. Preserve the existing exclusive-Basic comparison chart. If a coverage table reports net Basic changes, those can be negative because upgrades remove households from Basic.

## 8. Integration: use existing surfaces and one shared output

Suggested backend modules are small internal files such as model/source_funding.py and model/coverage_attribution.py. They are code organization, not new application tabs, downloadable reports or user-configurable modes.

Expose one versioned result alongside existing outputs:

~~~text
source_funding:
  version, method, debt_included, years, source_keys
  signed_contribution
  loss_charge, debt_charge, replacement_charge
  expansion_available
  basic_capital_spent, sm_capital_spent, ancillary_spent, unused
  loss_unfunded, debt_service_due, debt_service_paid, debt_service_unfunded
  replacement_due, replacement_paid, replacement_unfunded

coverage_attribution:
  version, method, source_keys
  annual_basic_entries, annual_sm_upgrades
  basic_stock, sm_stock
  opening_baseline_stock, pure_bau_stock, combined_stock
  baseline_difference_from_bau, reconciliation_error
~~~

Arrays must carry area/sector/year dimensions consistently. Keep units and metric definitions explicit in code. Restrict technical diagnostics to backend responses/tests and existing exports; do not surface raw schemas in the app.

| Touchpoint | Required change |
| --- | --- |
| model/water_supply.py shared annual sector loop | Integrate source allocation before delivery; attribute actual expenditure and transitions afterwards. Update all uses of available_after_debt_service and cash_deficit consistently. |
| model/sanitation.py | Pass proper source identity/selected servicing keys through shared logic; preserve water-NRW linkage. |
| model/utility_debt.py and model/fixed_loan.py | Pass selected keys to funded execution; preserve sizing and contractual schedule. Distinguish scheduled versus actually funded service in summaries. |
| model/engine.py | Preserve pure BAU; attach the new scenario ledger and stock attribution once. |
| frontend/src/components/LiveInterventionChart.tsx | Stop calculating coverage bands from cumulative payloads; consume attributed stocks. |
| frontend/src/components/ResultsDashboard.tsx | Update coverage bands, source household columns and the relevant existing funding rows from the same data. Keep other calculations. |
| frontend/src/components/BasicCoverageChart.tsx | Retain current Basic full-path presentation. |
| frontend/src/interventionRegistry.ts and contributionView.tsx | Keep stable source keys/colors/categories; separate pure cost mechanisms from funding sources. |
| deck_data.py, deck_aggregate.py, export_data.py, revenue_export.py and chart/table exporters | Propagate and aggregate new fields; remove old sequential coverage values. Preserve actual revenue rows and unrelated export content. |
| Existing loan/reporting consumers | Show funded versus unfunded service in existing rows or notes, without silently treating due as paid. |

Preserve existing resource amounts where their meaning remains valid. Additional pre-/post-deduction details should fit as rows/columns in existing funding tables or their existing expansion mechanism; do not introduce a dashboard, audit console, wizard, toggle, persistent banner or new navigation item.

Financial-gap attribution remains a distinct metric. Existing requirement/gap tables and ordered gap-effect comparisons may continue, but they must use the updated actual funding/shortfall engine. Do not paste source-funded household contributions into financing-gap rows. Keep their conventions intact and explain only where existing labels would otherwise be misleading.

If old cumulative calculations are still required for financial-gap effects or cost-savings reports, retain them for those outputs only. They must no longer supply source coverage bands or household-contribution cells. Reuse the same actual backend results across UI/export consumers.

Do not bulk-rename inputs or modify saved profiles. No new suspicious-input warning is required for the saved rural collection target; record that finding in Replit's completion message.

## 9. Acceptance tests

### Existing behavior to preserve

- Revenue identities, signed collection/tariff/NRW streams, aggregate coverage increment, overlap caps, lag and recurring-receipt interpretation.
- Pure BAU inputs/path, target definitions, transition pricing and eligibility, costs, physical NRW schedule, microfinance/grant rules and debt sizing/schedule.
- With debt off, the new loss/replacement allocation must reproduce old aggregate spending and actual coverage within numerical tolerance.
- With debt on and sufficient selected-source cash every year, aggregate funding/delivery must also match the old model.
- When selected sources cannot pay, changed aggregate results must be explained by the new payment restriction and reconciled debt shortfall, not by chart attribution.

### Allocation fixtures

1. Baseline 20, tariff 80, replacement due 60: replacement charges 12 and 48; expansion balances 8 and 32; unfunded replacement zero.
2. Same funding, replacement 120: paid 100, unpaid 20, ordinary expansion zero. No further redistribution and no remaining ordinary money.
3. Baseline 0, tariff 150, replacement 120: no unfunded replacement; tariff expansion 30.
4. Tariff 100 selected for debt of 80, connections 100 unselected, no losses/replacement: expansion 20 and 100, not 60 and 60.
5. Tariff 10 selected, baseline 100 unselected, debt due 30, replacement 60: debt paid 10/unpaid 20; replacement paid 60; baseline expansion 40. Do not take the missing 20 from baseline or erase it.
6. Run the worked example in section 6 exactly; assert every row and both capital-to-household conversions.
7. Negative sources exceeding all positive ordinary funding: uncovered loss remains visible, no ordinary expansion, no negative allocation weights. Any separately restricted loan remains expansion-only.
8. Zero pools, no selected cash, disabled loan, zero-rate loan, negative selected source and floating-point roundoff must be deterministic.
9. For each source, positive cash equals its covered-loss charge plus debt charge plus replacement charge plus actual ordinary spend plus unused cash. Losses and payments also reconcile in aggregate.

### Delivery and attribution fixtures

10. Common Basic/SM split with different costs; exhausted Basic or SM eligible pools; spillover; ancillary spending; positive loan carryover. Source-capital sums equal actual spending by category.
11. Ordinary funds spent before restricted loans. Loan-used equals disbursement plus opening balance minus closing balance; loans never cover losses, debt or replacement.
12. Source-funded annual transitions sum to actual paid transitions; direct NRW and external delivery reconcile separately.
13. Basic source-stock removal on later SM upgrades; no double counting or two-rung same-year transition; source stocks sum to actual Basic/SM every year.
14. Pure cost-efficiency scenario: cheaper costs increase actual source-funded households; no duplicate efficiency coverage layer. Cost-savings reporting remains available.
15. Negative NRW net with positive physical upgrades: signed cash loss preserved, physical coverage still shown.
16. Urban/rural/mixed connection toggles, water-to-sanitation links, all-off BAU and connection-only settings; aggregate counts before percentages.
17. Revenue interactions on post-baseline volume stay in tariff/collection source cash and their subsequent expansion allocations. Changing UI toggle order must not change results.
18. Verify the displayed stack equals actual scenario coverage, the independent BAU line remains unchanged, and the table's signed baseline reconciliation explains total scenario-minus-BAU gain.
19. Charts, source household tables, category grouping, CSV/XLSX/PPTX and endline summaries use the same metric/year/unit/debt view. Remove stale sequential numbers only from coverage outputs.
20. Build frontend and inspect existing live/Results charts at desktop and narrow widths. No new tabs, cards, controls or banners. Check labels, tooltip totals, zero contributors and unchanged Basic display.

Use full precision internally; apply rounding only at display. Test households in million-household units with a scale-aware tolerance (for example absolute 1e-8 plus a relative tolerance), and money/volume at suitable scales.

## 10. Review evidence and implementation delivery

### Verified for this revision

- Re-queried GitHub main; confirmed the same commit as the original MD.
- Matched eight inspected key files against Git blob hashes from that revision.
- Reran all 12 existing tests in test_aggregate_revenue.py successfully.
- The prior review also passed 19 targeted existing revenue/funding tests and executed the October 8 urban/rural profile with debt excluded/included.
- Validated the proposed annual allocation equations on the worked example and 1,000 numerical cases: cash conservation, nonselected debt exclusion, nonnegative expansion and no unfunded replacement with remaining ordinary expansion all held.
- These equation checks are not tests of an implemented application change. The new ledger/coverage implementation, frontend and exports still require the acceptance tests above.
- The earlier export integration check was unverified because export_deck was absent from the locally retrieved subset; this was not a demonstrated production defect.

The October 8 figures in section 3 are pre-change reference results. Debt-off results should remain stable. Debt-on results may change only when the selected-source repayment restriction binds, with subsequent annual revenue/coverage effects reported transparently.

### Replit implementation sequence

1. Confirm working revision and read applicable repository instructions. Save a pre-change numerical comparison for the October 8 profile without changing its inputs.
2. Implement/test the pure annual source allocator and explicit servicing-source propagation.
3. Integrate into the existing annual funding/delivery loop; reconcile every cash and shortfall field before changing charts.
4. Add actual purchase/source-stock attribution; verify household conservation and the BAU comparison.
5. Wire existing chart/table/export consumers to the same fields; make only the necessary base/coverage labels and comparison-line changes.
6. Run targeted model regressions plus new allocation/stock/UI/export tests. Preserve unrelated files and features.
7. Provide a concise completion report with changed files, test outcomes and screenshots of existing charts. Explain any changed combined outcomes, particularly debt shortfalls.

**Definition of done:** every displayed source coverage amount traces to actual spending or an explicit physical/external transition; all totals reconcile; replacement allocation cannot manufacture an unfunded gap; loan-source restrictions are respected; tables/exports match charts; the superseded coverage replay has not been implemented; no unnecessary application artifacts have been introduced.

## 11. Source reference

All source findings refer to commit `cea9331bb303e700c51c8e46882aeb45bc6e4188`. Before implementation, compare Replit's working revision with that commit and preserve any later valid changes.

- [Saved October 8 scenario](https://github.com/yourstrulyalwiz/wss_simulation_new/blob/cea9331bb303e700c51c8e46882aeb45bc6e4188/profiles/DRC%20OCT%208.json)
- [Connection revenue](https://github.com/yourstrulyalwiz/wss_simulation_new/blob/cea9331bb303e700c51c8e46882aeb45bc6e4188/model/connection_revenue.py)
- [Revenue reconciliation](https://github.com/yourstrulyalwiz/wss_simulation_new/blob/cea9331bb303e700c51c8e46882aeb45bc6e4188/model/revenue_reconciliation.py)
- [Funding and delivery](https://github.com/yourstrulyalwiz/wss_simulation_new/blob/cea9331bb303e700c51c8e46882aeb45bc6e4188/model/water_supply.py)
- [Live coverage chart](https://github.com/yourstrulyalwiz/wss_simulation_new/blob/cea9331bb303e700c51c8e46882aeb45bc6e4188/frontend/src/components/LiveInterventionChart.tsx)
- [Results dashboard](https://github.com/yourstrulyalwiz/wss_simulation_new/blob/cea9331bb303e700c51c8e46882aeb45bc6e4188/frontend/src/components/ResultsDashboard.tsx)
