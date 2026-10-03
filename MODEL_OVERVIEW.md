# WSS Strategic Scenarios Model — Overview

*Scope: the `test2` model as implemented in `model/engine.py`, `model/water_supply.py`,
`model/sanitation.py` and `model/inputs.py`.*

---

## 1. What the model does

The model answers one question, in money and in households:

> **Given a country's current water and sanitation coverage, its budget, and its service
> targets — how far short will it fall, what will closing that gap cost, and how much of
> the shortfall can a set of sector reforms actually close?**

It produces three linked quantities for each sector and each forecast year:

| Quantity | Meaning |
|---|---|
| **BAU coverage** | Households reaching *safely managed* service on current budgets and current performance |
| **Service gap** | Target-path safely-managed households − BAU safely-managed households |
| **Financing gap** | Investment needed to close that gap (plus asset replacement) − capital actually available |

On top of that baseline, eight built-in **interventions** (plus user-defined custom ones) are
each modelled as a distinct mechanism that either raises the capital available, lowers the unit
cost of a connection, or finances households directly — and the tool reports how much of the
gap each one closes.

---

## 2. Structural choices

**Two sectors, run independently.** Water supply and sanitation each have their own service
levels, targets, unit costs, budget share and intervention parameters. They share one macro
context (GDP, population, households) and one income distribution. There is exactly **one
cross-sector link** (see §6.5).

**Five service rungs — the JMP ladder.** Index order is fixed throughout:

```
0 = Safely managed   1 = Basic   2 = Limited   3 = Unimproved   4 = No Service
```

Only rung 0 is *bought*. Everything the budget and every intervention does is expressed as
"how many more households reach safely managed". The lower rungs drift at their own historical
growth rates and **Basic is the balancing plug** — whatever is left of the household total after
safely-managed and the three lower rungs are placed.

**One area per run; National is a sum.** A `ModelInputs` object describes *one* area (Urban,
Rural, or National). The engine runs once per area, and National = Urban + Rural, aggregated
element-wise (`deck_aggregate.py`, and in the browser). Extensive quantities — household counts,
capex, budgets, gaps, cash ledgers — sum. Intensive ones — unit costs, growth rates, efficiency
ratios — are **re-derived as a ratio of sums**, never averaged.

**Units, consistently.** Households and money are in **millions**; per-household costs are in
**actual local currency**. So `HH-millions × cost = money-millions` throughout, with no scaling
factors sprinkled through the formulas. Everything is in **real (base-year) terms** — the
primary macro input is real GDP in local currency, so no inflation or FX chain is needed.

**Time.** Defaults are `model_start_year = 2011`, `baseline_year = 2025`,
`forecast_end_year = 2040`, with targets at 2030 and 2040. The baseline year is the last year of
historical data. In `test2` there is **no "as-is" lag**: the target path branches off the BAU at
`baseline + 1`, and depreciation of the existing stock also begins at `baseline + 1`.

**Targets are a list, not a pair.** Any number of target years is supported — each is a year plus
a full five-rung share column. The path CAGRs piecewise between consecutive targets, and past the
last target the *shares* are held (so counts still grow with households).

---

## 3. Inputs and how blanks are filled

Inputs fall into six groups (schema in `model/inputs.py`, contract in `model/INPUT_CONTRACT.md`):

1. **Macro** — real GDP in local currency (primary), population, households.
2. **Service levels** — the five-rung split, per historical year (or just start + baseline).
3. **Targets** — one five-rung share column per target year, per sector.
4. **Unit costs** — a technology *mix* per rung; the unit cost is `Σ(share × cost)`. Safely-managed
   and Basic each have their own independent mix.
5. **Budget** — see §4.
6. **Intervention parameters** — per sector, plus a global five-bracket income distribution.

Two filling rules matter, because both let a user enter as much or as little as they have:

- **Time series** (`_project_series`): entered values are always honoured, historical *and*
  forecast. Interior blanks between two entered values are filled by **geometric interpolation**
  (a constant year-on-year rate that lands exactly on the later anchor). Trailing and leading
  blanks extrapolate at the **mean historical year-on-year growth**.
- **Service levels** (`sector_bau`): each rung's growth rate is the **mean YoY of its household
  count** over `[bau_first_year … baseline]`; blank years fill forward at that rate. With only the
  start and baseline points entered, this reduces exactly to the two-point CAGR — so richer data
  refines the curve without changing the simple case.

---

## 4. The budget

The capital that drives everything is derived, not entered year by year. Three modes exist; the
`test2` default is **`from_cost`**:

- **Historical budget** = the cost of the new connections actually added that year:
  `Σ_rung max(0, ΔHH) × unit cost`, over the safely-managed and Basic rungs. In other words, the
  model *reads the past budget off the observed coverage growth*, rather than asking for it.
- **Forecast budget** = mean historical (budget ÷ real GDP) × real GDP for that year.
- Any year can be overridden directly.

(The other two modes: `pct_gdp` — real GDP × a budget share, split by sector, then × a capex
share; and `direct` — an entered expenditure series compounding at its own rate.)

On top of that sits the **budget-execution** distinction, which is what makes one of the
interventions possible:

| Term | Definition |
|---|---|
| **Budget allocated** | The capital budget on paper. Entered, or defaulted to `used ÷ 0.80` |
| **Budget used** | The capital that actually becomes service |
| **Execution efficiency** | `used ÷ allocated` — auto-computed from history (≈ 0.8 by default) |
| **`bau_available`** | `allocated × efficiency` — the effective capex reaching service each year |

At baseline, `bau_available` equals the used budget, so the BAU is unchanged by the machinery.
The budget-execution intervention ramps the efficiency upward, letting more of the *same
allocated* budget reach service.

---

## 5. The core calculation

For each sector, one forward pass over the forecast years computes four things together
(the "4a–4d" blocks, named after the source workbook sections).

### 4a — BAU coverage

Each year, the capital available is assembled:

```
avail = bau_available            (effective capex budget)
      + collection_cash          (revenue levers…)
      + tariff_cash
      + nrw_net                  (can be negative)
      + extra_cash               (cross-sector / custom revenue)
```

Replacement is funded first, and only the household share of what remains buys connections:

```
new_SM = max(0, avail − BAU_replacement) × (1 − non-HH%) ÷ SM_unit_cost[t]
```

- `BAU_replacement[t] = BAU_stock[t−1] ÷ asset_life`. The BAU keeps its **own** asset stock,
  separate from the target-path stock, so the counterfactual can never depend on the target.
- The BAU stock rolls forward as `stock[t] = stock[t−1] − replacement[t] + avail`. An
  underfunded sector (budget below replacement) sees the stock — and next year's replacement —
  *decline*, which is the intended behaviour.
- `SM_unit_cost[t]` is the base cost times a per-year **cost factor** (all 1.0 in the BAU;
  the cost-side levers move it — see §6.3).

The other four rungs compound at their own historical rates; the five are then rescaled to that
year's household total, with Basic as the plug.

### 4b — Target path

Equal to the BAU through the baseline year, then a **piecewise CAGR** from the baseline counts
through each target boundary's counts (`target share × that year's households`). Past the last
target, the target shares are held. Zero-start categories use linear count interpolation because
CAGR from zero is undefined. Positive-to-zero categories retain the existing near-zero geometric
decline but reach exactly zero at the milestone. At every milestone all five counts equal the
entered shares times projected households. In intermediate years Safely Managed and Basic are
bounded by total households, and the lower categories share the remainder in their interpolated
proportions. The five mutually exclusive counts sum to projected households.

### 4c — Asset stock

Two distinct pathways are maintained:

- **Target investment pathway (A):** the hypothetical infrastructure required to follow the coverage
  milestones. Opening assets are valued at the baseline:
  `(SM_HH × SM_cost + Basic_HH × Basic_cost) × (1 + non-HH multiplier)`. Each year's scheduled
  target expansion is added once. Replacement maintains existing assets and is not added again to
  the target stock. Existing Basic assets are transferred at their average booked value when
  households upgrade to Safely Managed (and conversely for downgrades); this changes attribution,
  not total stock or investment expenditure.
- **Resource-constrained pathway (B):** the BAU or intervention coverage supported by available
  resources, using its own asset/replacement calculation. Its achieved coverage does not determine
  target-path investment requirements.

The standing difference between target coverage and simulated achieved coverage is a service-gap
indicator only. It is never repeatedly capitalized into either year's target additions or target
asset stock. Replacement uses the prior year's target stock at `1 / asset_life`.

### 4d — Investment need and financing gap

```
service_gap[t]       = max(0, target_SM[t] − simulated_SM[t])
target_expansion[t]  = annual target additions/upgrades at that year's unit costs
target_stock[t]      = target_stock[t−1] + target_expansion[t]
replacement[t]       = target_stock[t−1] / asset_life
investment_need[t]   = target_expansion[t] + replacement[t] + implementation_capex[t]
financing_gap[t]     = max(0, investment_need[t] − available_financing[t])
```

Target transitions are scheduled annually, not inferred from the target-minus-simulated gap.
Because aggregate shares do not identify gross household movements, the model assumes net new
households adopt the current year's target mix. It then allocates changes among continuing
households: overlapping Basic reductions and Safely Managed increases are upgrades, and the
reverse movement is a downgrade. This identifies upgrades obscured by population growth.
Upgrades cost `max(0, SM_cost − Basic_cost)`; new connections use the relevant full unit cost;
downgrades do not buy a second connection. The cost-side interventions can change unit costs
without changing specified milestones.

The annual replacement allowance is an approximation. Booked assets are retained: this simplified
schedule does not model asset-age cohorts, retirements, or relocation/reuse of spare capacity.
Replacement spends money to maintain capacity, not to create additional stock.

Available financing counts public capital, other capital, directly reinvested utility cash, loan
proceeds, and prior positive cash carry once. Unfunded requirements do not become additional asset
stock or automatic catch-up obligations. Required investment is established before and independently
of resource-constrained coverage; financing is not spent to reduce a coverage backlog and then
subtracted again from a costed remaining backlog.

```
new_financing[t] = usable_public_capital[t] + other_eligible_capital[t]
                 + direct_internal_reinvestment[t] + loan_drawdowns[t]
opening_cash[t] = closing_cash[t-1]                  # starts at zero
available_financing[t] = opening_cash[t] + new_financing[t]
financing_applied[t] = min(investment_need[t], max(0, available_financing[t]))
closing_cash[t] = max(0, available_financing[t] - investment_need[t])
unfunded_net_cash_outflows[t] = max(0, -available_financing[t])
opening_cash[t] + new_financing[t] + unfunded_net_cash_outflows[t]
    = financing_applied[t] + closing_cash[t]
```

Unrestricted unused investment financing is carried forward without interest. Sources are counted
on receipt; opening cash is not a new receipt. Debt-service reserves remain separate from investment
cash until explicitly released to direct reinvestment. Signed negative net flows reduce financing
and their unfunded portion is separately identified, rather than creating negative closing cash.
Periods sum new financing flows but report only the final closing cash balance, never a sum of cash
snapshots. Cumulative new financing minus cumulative financing applied, plus cumulative unfunded net
cash outflows, equals closing cash.

Cumulative programme requirements sum scheduled forecast-year costs once. Cumulative annual
shortfalls sum `max(0, investment_need[t] - available_financing[t])`; later-year surpluses do not
retroactively cancel earlier shortfalls, and earlier gaps are not added to later requirements.
Terminal service gaps are the final-year signed target-minus-simulated household differences,
with unmet coverage floored at zero for display. They are not financing requirements.

NRW rehabilitation and custom intervention implementation are separately identified programme
capex. NRW-enabled household upgrades are already included in scheduled target connection/upgrade
costs: their simulated-path purchase diagnostic is not added again to programme implementation.

`non-HH multiplier = non-HH% / (1 − non-HH%)` grosses the household investment up to include the
non-household share of the system. The `capex_adder` is a small water-treatment allowance derived
from the NRW parameters, applied when there is positive target expansion (cost-based for water; for sanitation it is scaled off the baseline
household count instead, making it negligible — a quirk inherited from the source workbook).

---

## 6. Interventions

### The two-pass design

**BAU and interventions are separate calculations.** The engine runs each sector twice:

- **BAU pass** — every toggle forced off and the custom-intervention list cleared. This is the
  canonical counterfactual; its coverage path and financing gap *cannot move* when a user toggles
  a lever or edits its parameters.
- **Scenario pass** — the user's actual toggles. Its results are attached as `scenario_*`.

When no toggle is on, the scenario is the BAU by definition and the second pass is skipped.

Every lever therefore enters through one of exactly **three channels**, which is what keeps them
composable:

| Channel | Effect | Levers using it |
|---|---|---|
| **Cash** → `avail` | More capital per year | Collection efficiency, tariff reform, NRW money ledger, NRW-linked sewer revenue, custom new-revenue |
| **Cost factor** → `SM_unit_cost[t]` | Each connection buys cheaper (factors multiply) | Capex efficiency, optimised technology, custom cost-reduction |
| **Households directly** | Connections not funded from the capex budget | NRW physical-water upgrades, microfinance, means-based grant |

Plus budget execution, which raises `bau_available` itself.

A **safely-managed ceiling** protects the Basic target: interventions may close the safely-managed
gap but never overshoot the target path. (It only engages when NRW or the affordability lever is
active, so the pure BAU is untouched.)

### Agreed intervention sequence and accounting categories

Present budget execution first; operational efficiency (collection then NRW) second;
capex efficiency (unit-cost reductions then supported technology selection) third;
and residual additional public financing requirements as an output fourth.
Tariff reform, microfinance, custom interventions and borrowing remain additional options.

Budget execution releases usable **allocated capital**, not recurring utility cash.
Operations produce collected revenue, recurring savings and recurring costs.
Capex efficiency changes investment prices, not cash for debt service.
Explicit public commitments and injections are separate capital sources.
No government contribution is inferred to close a residual.

Before/after public-financing comparisons hold other scenario sources, including loans
and direct reinvestment, fixed. The before case removes explicit commitment/injection
capital and independently recalculates carry from zero. It does not borrow closing cash
from the after case. Annual residuals and sums of annual residuals remain distinct.

Sequential displays are **order-dependent marginal effects**. Both sectors' execution,
collection, NRW, costs and technology precede additional options (tariff, microfinance,
customs, borrowing); explicit public capital comes last. Preserve negative effects and
cross-sector dependencies. Signed household changes and financing-shortfall reductions
sum to the full combined scenario minus BAU. Cash gained and investment costs avoided
are different quantities and must not be added into one recurring-cash total.

### 6.1 Collection efficiency and the shared collected-revenue ledger

Ramps the collected-to-billed ratio from current to target between a start and target year. The
additional cash each year is `billed_volume × tariff × (ratio[t] − baseline_ratio)`, and 100% of
it is recycled into capex. Billed volume **scales with population** off its anchor year (or a
fixed compound rate if supplied). This baseline billed volume is exogenous.
Scenario billed volume additionally includes NRW commercial billing recovery and the
recovered physical water explicitly allocated to additional service/sales.

Combined additional collected revenue is exactly
`Q_scenario × Tariff_scenario × Collection_scenario − Q_BAU × Tariff_BAU × Collection_BAU`.
Revenue attribution uses collection at BAU volume and tariff first; NRW additional
billing/sales at BAU tariff and scenario collection second; tariff change on the full
scenario volume and collection third. These signed components sum to the combined
change, including interactions once. The legacy independent NRW tariff is retained
in saved inputs but no longer independently prices the same water.

The common intervention output contract separates additional collected revenue,
recurring operating savings, recurring operating costs, implementation capex,
named physical benefits, and SM/Basic unit-cost adjustment factors. Only revenue plus
recurring savings minus recurring costs enters additional utility cash. Shared collected
revenue already includes NRW revenue: adding the NRW money ledger again would duplicate it.

Sanitation inherits the ratio ramp and the water tariff from the water lever, applying its own
`wastewater collected %` and `sewer tariff as % of water tariff`, on its own timing.

### 6.2 Budget execution

Ramps execution efficiency (`used ÷ allocated`) from its auto-computed historical baseline up to
a target between a start and target year. More of the *same allocated budget* reaches service.
Raises no cash and cuts no cost — it recovers capital already appropriated.

### 6.3 Capex efficiency and optimised technology (the two cost-side levers)

Both work through the same per-year cost factor on the safely-managed connection cost, and both
leave history at 1.0 so BAU parity is preserved:

- **Capex efficiency** — a unit-cost **discount that ramps up from BAU**: zero at the start year,
  rising linearly to the stated improvement by the target year, held thereafter. Capped at 95% so
  the cost stays positive.
- **Optimised technology selection** — a **step change** to a re-modelled safely-managed
  technology mix: `factor = new weighted SM cost ÷ base SM cost`, from the start year onward. A
  mix left at its current values is a no-op.

They compose by multiplication when both are on. Note these are distinct from budget execution
(§6.2), which is about *money reaching service*, not the *price of a connection*.

### 6.4 NRW reduction (water only)

Non-revenue water falls from current to target over the programme window. The lever is
deliberately **physical first, financial second**:

- Only the **physical** share is real recovered water. The user allocates it between
  additional service/sales and reduced production; the shares are `service_share` and
  `1 − service_share`, which total 100%. Physical/commercial loss shares also total 100%.
- Only reduced-production water generates avoided production costs. Only service water
  supports physical upgrade capacity: `potential upgrades = service volume ÷ water per upgrade`.
  Commercial-loss recovery improves billing of existing consumption and creates no water.
- Simulated upgrades reserve their incremental connection cost from available household
  investment after implementation and replacement. They are limited by available funding,
  eligible Basic households and the target; unfunded water capacity is not a free connection.
  Dedicated NRW upgrade purchases and other purchases cannot serve the same household twice.
- Both commercial billing recovery and service sales use the shared tariff/collection ledger.
  NRW recurring cash is its attributed collected revenue plus production savings minus
  recurring maintenance, and may be negative. Rehabilitation implementation capex is a
  separate investment requirement, not a recurring operating cost or debt-service cash.
  Target transitions already include their necessary upgrade costs: do not add the simulated
  upgrade-purchase schedule to target implementation capex.
- A **benefit lag** separates the works from the water: capex is charged on the works schedule,
  while the recovered volume and its value appear `nrw_lag_years` later. Other levers bake this
  delay into their start year; NRW models it explicitly.

System input volume scales with population (or a fixed rate) off the NRW start year.
Additional billed sales are a forecast volume assumption for existing and improved service;
they are not inferred as new connections. Report funded physical upgrades separately from
potential water capacity.

### Additional net cash and borrowing

The “Use of additional net utility cash” selector defaults to reinvest all (`alpha = 0`).
Partial allocation uses `0 < alpha < 1`; full allocation uses `alpha = 1`. Selected
established revenue/savings streams net their recurring costs. Negative unselected effects
also reduce eligibility; all signed effects remain in the total cash account once. Entered
prior annual debt obligations are deducted before alpha. Implementation capex stays in
the investment requirement and is not subtracted from eligible recurring cash again.

Each area/sector has one separate loan. Entity names never implicitly pool cash.
New proposed borrowing is constrained by the smallest committed payment capacity over
the entire repayment term, minimum DSCR, any positive user ceiling, and remaining
investment need after other finance and carry. Loan proceeds are capital, not revenue.
Physical coverage uses drawdowns plus cash allocated to direct investment, not the
original cash before debt commitments. No additional revenue is inferred from those
loan-financed connections.

New scenarios default to nominal fixed-rate loans with level annual nominal payments
starting the year after drawdown. Established real cash and principal are converted with
the local price index; annual results are then deflated to reporting prices. Legacy saved
rates retain real-rate semantics unless changed explicitly. The debt conversion index is
independent of GDP input mode.

An optional fixed contracted principal preserves agreed obligations when forecasts change;
it is not resized against revised capacity or investment need. Surplus proceeds remain
capital/carry, not new revenue. This is a forward-looking contract/stress assumption, not
delivery monitoring. Unpaid contractual obligations produce reported shortfalls and
outstanding debt. Unpaid interest accrues; no automatic refinancing is assumed.

Committed cash accumulates in a separate zero-interest reserve and cannot also fund
connections. Show reserve use, payment shortfalls, and reserve release explicitly.
Surplus reserves return to direct investment only at maturity after loan obligations.
An undrawn proposal does not withhold cash.

Debt schedules extend through maturity beyond the coverage projection. After the
projection, established net cash and prior obligations are held flat in real terms;
inflation stays at the final projected rate. Show outstanding debt at projection end,
source-pool maturity schedules and conditional incremental-estimate labels. Entering
baseline information does not turn this module into a full utility credit assessment.

### 6.5 NRW-linked sanitation revenue — the one cross-sector lever

The physical water that water-NRW recovers returns to the sewer as wastewater the sanitation
utility can charge for:

```
revenue = recovered volume × return ratio × sewer charge × collection rate
```

which is injected into sanitation capex. This is why the engine computes **water first**: the
recovered volume is threaded into the matching sanitation pass (zero in the BAU pass, the water
scenario volume in the scenario pass). It requires the water NRW lever to be on — with it off
there is no recovered volume to charge for, and the band reads zero.

### 6.6 Tariff reform

The tariff rises linearly from current to target over the reform window; the extra revenue
(`volume × tariff rise`, on the same population-scaled volume base) is recycled into capex.
Each sector runs its own.

### 6.7 Microfinance + means-based grant (affordability)

The only lever that addresses **demand-side** constraints rather than public capital. Each year it
looks at the *increment* of the safely-managed gap the budget leaves unserved (tracked against a
high-water mark, so a standing gap is not re-offered every year), splits it across the five income
brackets, and then:

1. **Self-finance carve-out** — a share of the gap that could pay upfront anyway is peeled off,
   richest bracket first, tracked for reporting and **excluded** from both the loan pool and the
   safely-managed total (they are BAU-anyway households, not an intervention effect).
2. **Microfinance** — every remaining household is offered a connection loan. It connects if its
   annual repayment capacity (`12 × bracket monthly income × willingness-to-pay %`) covers the
   level annuity at the real interest rate and tenor. Microfinance itself is uncapped.
3. **Means-based grant** — households that can only service a *smaller* loan get a grant that buys
   the principal down to what they can afford (`grant = principal − capacity × annuity factor`).
   A one-time pool funds the **cheapest grants first**, maximising connections per unit of grant.

A take-up rate applies to eligible households, and a partial-payer share can reduce the principal
by covering part of the upfront fee. Income brackets are held constant in real terms.

### 6.8 Custom interventions

User-defined levers that genuinely drive the calculation, in two types:

- **New revenue** — spend `implement_cost` over `cost_years`, produce `output_quantity × output_value`
  per year from the output start year; the **net** per year folds into that sector's capex.
- **Cost reduction** — cut the safely-managed connection cost from a start year, by a percentage
  or a flat amount; multiple reductions compose.

Each routes to water, sanitation, or both. The BAU pass clears the list entirely.

---

## 7. Attribution — how each lever's contribution is measured

The tool does not decompose analytically. It runs **cumulative passes**: one call for the pure BAU
(all toggles off), then one more per enabled intervention, added on top of the previous. The
marginal safely-managed households each pass adds become that lever's stacked band on the chart,
and the top of the stack is the full with-intervention scenario.

The consequence worth knowing: **bands are order-dependent and sum exactly to the total** — no
double-counting, but a lever's attributed share depends on where it sits in the stack. Levers that
don't move the needle produce no band.

---

## 8. Outputs

Per sector, per year: BAU and target coverage by rung; safely-managed path with interventions;
service gap; total investment need; financing gap (BAU) and adjusted financing gap (with
interventions); the capex budget ledgers (allocated / used / effective); per-year effective unit
cost; and each lever's own ledger (collection cash, tariff cash, NRW money and volumes, grant
spend, loan volume mobilised, connections by financing route).

These feed the BAU charts, the live intervention charts, the Results dashboard (stacked coverage
and financing-gap charts plus presentation tables), and the exports: per-table CSV/XLSX, per-chart
PNG/JPG/native-Excel-chart XLSX, and a World Bank-branded PowerPoint deck covering urban, rural
and national scopes.

---

## 9. Assumptions and limitations worth stating up front

- **Real terms throughout.** No inflation or exchange-rate chain when real GDP is entered directly.
- **Capital only.** The coverage math is driven by capex; operations and maintenance appear only
  as the revenue side of the tariff and collection levers. There is no O&M cost constraint on the
  connections the model builds.
- **Revenue is 100% recycled into capex.** Every cash lever assumes the full incremental revenue
  becomes capital for new service.
- **Only safely managed is purchased.** Basic is a residual; the model does not cost a deliberate
  programme of Basic-level service.
- **Sanitation runs the water structure.** Different inputs, costs, targets and budget share — but
  no separate on-site / FSM / sewered treatment-sizing logic. The sanitation `capex_adder` is
  household-count-based rather than cost-based, a carry-over from the source workbook.
- **Planned investments are not used.** The five-period planned-investment inputs remain in the
  schema and the UI but no longer feed the calculation; the budget is derived (§4).
- **Volumes scale exogenously** with population (or a fixed rate), not with the connections the
  levers fund — deliberate, to avoid circularity, but it means volume growth is not endogenous to
  coverage.
- **Income distribution is static** in real terms over the forecast.
- **National is additive.** Urban and Rural are summed; there is no migration or reallocation
  between them beyond what the entered population series already implies.
