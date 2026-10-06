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

- **Historical budget** = the inferred cost of positive service transitions that year:
  `max(0, ΔSM_HH) × SM_cost + max(0, Δ(SM_HH + Basic_only_HH)) × Basic_entry_cost`.
  Basic-only is an exclusive household stock, not the number of new Basic entries:
  an SM upgrade leaves that category. The combined SM + Basic-only stock measures
  at-least-Basic access, so its positive growth infers below-Basic entries. Costs
  are inferred independently in each sector and area before monetary aggregation.
  This retains the forward two-stage convention and existing unit-cost meanings:
  an entry followed by an upgrade incurs both transition charges. It is not a
  reconstruction of every household's actual historical transition, nor a
  resolution of incremental versus full SM upgrade pricing. Counts and money
  retain their millions convention; declines do not refund investment. Replacement
  remains separate, and explicit budgets/overrides retain their existing behavior.
  In other words, the
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
target, the target shares are held. Both sectors then apply the "adjusted" block: safely-managed
is taken as computed, Basic is the plug, and the three lower rungs share the remainder in their
prior-year proportions.

### 4c — Asset stock

An opening stock is booked at the baseline year:
`(SM_HH × SM_cost + Basic_HH × Basic_cost) × (1 + non-HH multiplier)`, and thereafter accumulates
the gap-closing capex. Depreciation is straight-line at `1 / asset_life`.

### 4d — Investment need and financing gap

```
service_gap[t]      = max(0, target_SM[t] − BAU_SM[t])
new_capex[t]        = (service_gap × SM_cost[t] + capex_adder) × (1 + non-HH multiplier)
investment_need[t]  = new_capex[t] + replacement[t]
financing_gap[t]    = max(0, investment_need[t] − avail[t])
```

`non-HH multiplier = non-HH% / (1 − non-HH%)` grosses the household investment up to include the
non-household share of the system. The `capex_adder` is a small water-treatment allowance derived
from the NRW parameters (cost-based for water; for sanitation it is scaled off the baseline
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

### 6.1 Collection efficiency

Ramps the collected-to-billed ratio from current to target between a start and target year. The
additional cash each year is `billed_volume × tariff × (ratio[t] − baseline_ratio)`, and 100% of
it is recycled into capex. Billed volume **scales with population** off its anchor year (or a
fixed compound rate if supplied) — exogenous, so it grows with the system without creating a
circular dependency on the connections it funds.

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

- Only the **physical** share of NRW is real recovered water. That water upgrades households:
  `new SM = recovered physical volume ÷ water per upgrade`, capped at the safely-managed target.
- A **money ledger** nets the value of *all* recovered water (at tariff, or at avoided production
  cost) against the cost of fixing — capex on the incremental capacity recovered each year, which
  keeps growing slowly as the network grows. The net folds into `avail` and **can be negative**,
  in which case it is drawn from the budget before it funds anything.
- A **benefit lag** separates the works from the water: capex is charged on the works schedule,
  while the recovered volume and its value appear `nrw_lag_years` later. Other levers bake this
  delay into their start year; NRW models it explicitly.

System input volume scales with population (or a fixed rate) off the NRW start year.

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
