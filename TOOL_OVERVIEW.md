# WSS Strategic Scenarios Tool: Model Overview

## Executive summary

Governments that set water and sanitation targets need to know three things. How far will current
spending carry them? What does the remaining shortfall cost? Which interventions close it? The WSS
Strategic Scenarios Tool answers all three questions for one country or region at a time.

### Scope and methodological boundary

This is a **forward-looking scenario model**, not a delivery-monitoring system. It retains simulated
BAU and intervention coverage projections, annual investment requirements, and remaining financing
and access gaps. Users can compare directly reinvesting additional net utility cash with committing
cash to repay a loan that finances investment earlier, and identify the additional public capital
still required.

Actual-versus-plan delivery reports, implementation-tracking workflows, catch-up replanning, and
automatic rescheduling of missed investment are **excluded**. Historical observations remain inputs
for the forecast; simulated future coverage is not a claim that infrastructure has been delivered.

Existing national, urban, rural, and combined urban/rural scopes, separate Water Supply and Sanitation
inputs, historical series, target milestones, saved scenarios, and export formats are retained.
Saved inputs created before borrowing was introduced default to reinvesting all additional utility
cash, with new borrowing switched off.

The tool projects two futures side by side. The **business-as-usual scenario** continues today's
budgets at today's performance. The **target path** follows the service targets the government has
adopted. The distance between the two is the **service gap**, counted in households. Annual
investment requirements come from additions and replacement along the target pathway; the part
not covered by available financing is the **financing gap**.

The tool then tests interventions against those gaps. Eight built-in interventions, plus any number
the user defines, each do one of three things. They raise capital, they cut the cost of a
connection, or they finance households directly.[^1] The tool reports how many households each
intervention reaches and how much of the financing gap it removes.

Three design decisions shape every result the tool produces:

- **The tool models one area at a time.** National figures are the sum of a separate urban run and
  a separate rural run.[^2]
- **The tool buys two service levels.** Investment is split between safely managed and basic, at a
  share the user sets per sector, and each is bought at its own unit cost.[^3]
- **The tool holds business as usual fixed.** The intervention scenario runs as a second,
  independent calculation, so switching an intervention on can never move the BAU curve.[^4]

This document walks through the model tab by tab, in the order a user works through it.
`MODEL_OVERVIEW.md` in the same folder carries the formulas, the parameter list, and the
module-by-module detail.

## Introduction: the model runs as fifteen steps across four tabs

The tool is a sequence, not a black box. Each step takes a defined input, produces a defined
output, and hands that output to the next step. The four tabs run left to right, and the
calculation follows them.[^5] A reader who follows the sequence can see where any number comes
from. A reader who disputes a result can point to the step that produced it.

Figure 1 shows the four tabs and what each one contributes.

**Figure 1. The four tabs of the tool**

```
   TAB 1                 TAB 2                TAB 3                 TAB 4
   Data Inputs           BAU Scenario         Intervention Design   Results Dashboard

   Steps 1 to 4          Steps 5 to 9         Steps 10 to 13        Steps 14 to 15

   Country, period,      Unit costs and  -->  Eight interventions   National roll-up
   service ladder,  -->  technical            plus custom ones -->  Coverage and gap
   targets, economy,     parameters           Three channels        charts, tables,
   budget                BAU projection       Live impact graph     exports
                         Target path
                         Service gap
                         Financing gap
```

Two selections sit above the tabs and apply throughout. The **geographical scope** dropdown chooses
urban plus rural, a single area, or national. The **Water Supply / Sanitation** toggle chooses
which sector the input tabs are editing.[^6] Users switch between the two sectors to complete both.

The fifteen steps are:

**Tab 1. Data Inputs**
1. Set the country, the area, and the analysis period
2. Fix the service ladder and set the targets
3. Project the economic and demographic base
4. Derive the budget from the cost of new service

**Tab 2. BAU Scenario**
5. Price a connection from the technology mix
6. Fund replacement before growth
7. Draw the target path from the baseline to each target
8. Measure the service gap in households
9. Price the gap and net off the money available

**Tab 3. Intervention Design**
10. Run the intervention scenario as a second calculation
11. Route each intervention through one of three channels
12. Add interventions the tool does not provide
13. Layer the interventions one at a time to attribute results

**Tab 4. Results Dashboard**
14. Sum the areas into a national result
15. Read the results within their boundaries

The sections below take the steps in that order, under the same headings.

---

# Tab 1. Data Inputs

The first tab collects everything the model needs before it can project anything. It has five
numbered sections on screen: *Country, Area of Focus & Currency*, *Analysis Period*, *Service
levels*, *Economic & demographic data*, and *Budget*.[^7] Sections 1 and 2 apply to the whole
analysis. Sections 3 to 5 are entered separately for each area.[^8]

One convention runs through every table on this tab. Cream cells hold historical data and need a
value. Blue cells hold forecast years and are optional.[^9] A blue cell left blank fills itself
from the growth rate. A blue cell filled by hand overrides the projection.

## Step 1. Set the country, the area, and the analysis period

The user first fixes the boundaries of the run. Selecting a country fills the currency
automatically.

The area is the unit of calculation. One input set describes one area: urban, rural, or
national.[^2] The engine runs once for each area the user enters. A country entered as urban plus
rural therefore produces two runs, combined later in Step 14.

The *Analysis Period* section sets the horizon. The default configuration starts in 2011, treats
2025 as the baseline year, and forecasts to 2040.[^10] The baseline year is the last year of
complete data. Forecasting begins the year after.

## Step 2. Fix the service ladder and set the targets

The *Service levels* section places every household on a five-level ladder. The levels come from
the Joint Monitoring Programme: safely managed, basic, limited, unimproved, and no service.[^3]

The top two levels are purchased. Budget and interventions are expressed as households lifted to
safely managed or to basic, and the split between the two is set with the budget inputs on Tab 1.
The three lowest levels are never bought directly. A household leaves them only by being upgraded
to basic.

The tool reads the historical trend off the record. Each level grows at the average year-on-year
rate of its own household count, measured over the historical window.[^11] Two entered points
produce the same answer as a simple compound growth rate, so richer data refines the curve without
breaking the simple case.

Households move between named levels rather than being redistributed by an arithmetic rule.[^12]
Money for safely managed moves them up from basic and below; money for basic moves them up from
limited and below. Population growth then feeds the three lowest levels in their prior proportions,
which is what keeps the five levels summing to the population. New households therefore arrive
unserved and have to be reached, rather than appearing at basic for free.

**Targets live in the same table.** Filling a whole future column so it totals 100 percent marks
that year as a target.[^13] The tool accepts as many target years as the user wants, not just two.
Targets enter as shares rather than counts, so a 90 percent target in 2040 converts to a household
count using the 2040 population. The target rises as the country grows.

## Step 3. Project the economic and demographic base

The *Economic & demographic data* section supplies real GDP, population, and households.

Real GDP in local currency is the primary macroeconomic input.[^14] Taking real GDP directly keeps
the whole model in real terms at base-year prices. The tool needs no inflation forecast and no
exchange rate.

Users rarely hold a complete series, so the tool fills the blanks itself. A blank sitting between
two entered values fills by geometric interpolation, so the curve lands exactly on the later value.
A blank past the last entered value grows at the average historical rate.[^15] A user with two data
points and a user with fifteen both get a usable projection.

## Step 4. Derive the budget from the cost of new service

The *Budget* section does not ask for a budget. It derives one, because historical budget records
are usually harder to obtain than the coverage record they paid for.

The tool reads the past budget off the past connections.[^16] It counts the new safely managed and
basic connections added in each historical year. It multiplies those counts by their unit costs.
The product is what the sector must have spent on capital that year. Dividing that spend by real
GDP gives a ratio, which the tool applies to forecast GDP to project the future budget. Any cell
can be overridden by hand. Two alternative methods remain available: a share of GDP, or an
expenditure series entered directly.[^17]

The tool then splits the budget in two. **Allocated budget** is the capital appropriated on paper.
**Executed budget** is the capital that becomes service. The ratio between them is budget
execution. The tool computes it from whatever allocated figures the user enters, and falls back to
80 percent for any year left blank.[^18] The BAU scenario uses the historical rate, so the split
changes nothing on its own. It creates the room for one specific intervention on Tab 3.

---

# Tab 2. BAU Scenario

The second tab holds the *Unit Costs & Technical Parameters* section for the selected sector, and
draws the BAU graph beside it.[^19] The graph updates live as the user types. Steps 6 to 9 are what
the engine does behind that graph, repeated for every forecast year.

## Step 5. Price a connection from the technology mix

The price of a connection comes from a technology mix, not a single figure. The user specifies
which technologies serve safely managed households and in what proportion. The tool takes the
share-weighted average cost.[^20] Safely managed and basic each carry their own independent mix.

Prices are entered as nominal figures for the price-index year. The tool converts them to real
using the index.[^19]

Two numbers now drive every coverage result: the money available from Step 4 and the price from
Step 5. Every intervention on Tab 3 works by moving one of them.

## Step 6. Fund replacement before growth

Business as usual is a capital waterfall. Money arrives, existing obligations take their cut, and
new connections buy what is left. Figure 2 shows the order of priority.

**Figure 2. The capital waterfall in each forecast year**

```
   CAPITAL AVAILABLE
     Effective capex budget            (allocated x execution efficiency)
     + Collection efficiency cash      |
     + Tariff reform cash              |  Tab 3 interventions.
     + NRW net ledger                  |  All zero in the BAU scenario.
     + Cross-sector and custom cash    |
              |
              v
   FIRST CALL      Asset replacement
                   Opening stock divided by asset life
              |
              v
   SECOND CALL     Non-household share
                   The network also serves businesses and institutions
              |
              v
   RESIDUAL        Split between the two purchased levels
                   Safely-managed share -> upgrades households from basic and below
                   Basic share          -> upgrades households from limited and below
                   Each share divided by that level's own cost per connection
```

**The residual is split between two service levels.** The user sets the share per sector, and the
default sends everything to safely managed. The safely-managed share upgrades households from basic
and below. The basic share upgrades households from limited and below. Each share buys households
at its own unit cost, so the same money buys more basic connections than safely-managed ones.

Both flows are drawn from the previous year's household counts, so no household climbs two levels
and is paid for twice in one year. A share whose source households are exhausted rolls over to the
other level rather than going unspent. The split is an assumption about how a sector spends rather
than a lever a user switches on, so it moves the business-as-usual curve as well as the scenario.

Replacement holds the first claim on capital. The tool depreciates the existing asset stock on a
straight line over the asset life, 30 years by default, starting the first forecast year.[^21]
Non-household customers take the second claim, since the network serving households also serves
businesses. The residual buys new households at the price set in Step 5.

The asset stock then rolls forward. It loses that year's depreciation and gains that year's capital
spending.[^22] A sector spending less than its replacement charge sees the stock decline, which
reduces next year's replacement charge in turn. This behavior is deliberate. It reproduces an
underfunded utility rather than assuming assets last forever.

The BAU scenario keeps its own asset stock, held separately from the target path.[^23] The
separation removes a circularity. Business as usual can never depend on a target it is failing to
meet.

## Step 7. Draw the target path from the baseline to each target

The target path matches the BAU scenario through the baseline year. It branches the following
year.[^24]

From the baseline household counts, the tool grows each service level at a constant annual rate
that lands exactly on the first target. It repeats the exercise between consecutive targets. Past
the final target year, the tool holds the target shares constant, so counts continue to grow with
the population.[^25]

The target path retains household-count growth-rate interpolation where it is defined. A category
starting at zero uses linear interpolation; a category ending at zero approaches a negligible
floor geometrically and is exactly zero at its milestone. Safely Managed and Basic are bounded by
total households; the lower levels share the remainder in their interpolated proportions. At each
milestone all five categories match the entered shares times projected households.

## Step 8. Measure the service gap in households

The service gap is the target path's safely managed households less the BAU scenario's, floored at
zero.[^26] A sector already meeting its target reports no gap.

This is the tool's central result. It converts an abstract coverage target into a countable number
of households, which is the form a minister can act on.

## Step 9. Price the target pathway and net off financing

The target investment pathway and resource-constrained coverage simulation are separate.
Investment need prices each year's target additions once, including incremental Basic-to-Safely
Managed upgrades, and includes non-household infrastructure, replacement of the prior target asset
stock, and implementation costs. The remaining coverage gap is not repeatedly added to that stock.
Net new households adopt the current year's target mix; movements of continuing households are
calculated separately, so population growth does not hide Basic-to-Safely Managed upgrades.
Existing Basic assets supporting an upgrade transfer into Safely Managed without a second
investment charge. Replacement is a simplified annual allowance on the prior scheduled asset
value, not additional capacity. This approximation retains assets and does not model retirements,
asset-age cohorts, or reuse of spare capacity.

Projected BAU and intervention financing determines simulated coverage independently. Subtracting
available financing from annual target investment need gives the financing gap, floored at zero.
Positive unused cash can be carried forward; missed investments are not automatically rescheduled.

The financing gap is not the cost of the targets. It is the part of that cost the sector cannot
currently fund. A sector can carry a large investment need and a small financing gap if its budget
is already close to sufficient.

---

# Tab 3. Intervention Design

The third tab holds *Water Supply Interventions*, *Sanitation Interventions*, and *Custom
Interventions*.[^28] Each intervention has its own toggle and its own parameters. The impact graph
beside them updates live.

## Step 10. Run the intervention scenario as a second calculation

The engine runs each sector twice.[^4] The first pass forces every intervention off and clears any
custom intervention. This pass is the BAU scenario, and its results are fixed. The second pass
applies the interventions the user has switched on.

Running two independent passes guarantees a stable comparison. A user who changes an intervention
parameter sees the intervention move against a BAU curve that stays still. The alternative,
adjusting one calculation in place, would let an intervention quietly redefine the thing it is
measured against.

## Step 11. Route each intervention through one of three channels

Step 5 established that only two quantities drive coverage: the capital available and the price of
a connection. Interventions therefore reach the results through three channels, set out in Table 1.
The channel determines how they combine. Cash interventions add together. Cost interventions
multiply. Household interventions bypass the budget entirely.

**Table 1. The eight built-in interventions and the channel each uses**

| Intervention, as named on screen | Channel | What it does | Sector |
|---|---|---|---|
| Increased collection efficiency | Cash | Collects more of the revenue already billed | Both |
| Tariff reform | Cash | Raises the tariff on a growing volume | Both |
| Budget execution improvement | Money reaching service | Delivers more of the budget already allocated | Both |
| Capex efficiency (unit cost) | Cost | Discounts the price of a connection over time | Both |
| Optimised technology selection | Cost | Steps to a cheaper technology mix | Both |
| NRW reduction | Households and cash | Recovers physical water and its value | Water only |
| NRW-linked sanitation revenue | Cash | Charges for wastewater the water lever recovers | Sanitation only |
| Microfinance | Households | Finances households the budget cannot reach | Both |

Two pairs in Table 1 look similar and are not. Budget execution improvement moves money already
allocated but never spent on service. Capex efficiency lowers the price of what that money buys. A
user can run either without the other.

### The cash interventions recycle utility revenue into capital

Increased collection efficiency and tariff reform share one mechanism. Both raise the revenue the
utility earns on a volume of water or wastewater. Both recycle the whole increase into
capital.[^29]

Collection efficiency ramps the collected share of billed revenue from its current level to a
target. Tariff reform ramps the tariff itself. In both cases the billed volume grows with
population rather than with the connections the intervention funds.[^30] The choice is deliberate.
A volume that grew with coverage would depend on the very connections it was paying for.

Sanitation runs both on its own terms. Its collection intervention inherits the water utility's
collection ratio, then applies the share of wastewater actually collected and a sewer tariff set as
a percentage of the water tariff.[^31]

### The cost interventions lower the price of a connection

Capex efficiency and optimised technology selection both act on the price of a safely managed
connection. Neither touches history, so the BAU curve stays exactly where it was.[^32]

Capex efficiency applies a discount that grows over time. The discount starts at zero in the first
year of the intervention, rises in a straight line to the improvement the user specifies, then
holds. The tool caps it at 95 percent so the price stays positive.[^33]

Optimised technology selection applies a single step change instead of a ramp. The user
re-specifies the mix of technologies used for safely managed connections. The tool recalculates the
weighted cost and applies the new figure from the start year onward.[^34] A mix left unchanged
produces no effect.

The two compose by multiplication when both run.

### NRW reduction is a physical intervention before it is a financial one

Reducing non-revenue water saves water first and money second. The tool models both effects and
keeps them separate.

Only the physical share of losses represents real water. Fixing a leak frees water the utility can
deliver. Correcting a billing error does not. The tool therefore converts only recovered physical
water into households, dividing it by the water a household upgrade requires.[^35] Those upgrades
are capped at the safely managed target, so the intervention cannot overshoot.

A separate money ledger values all recovered water, physical and commercial, at either the tariff
or the avoided production cost. It nets the cost of the repairs against that value.[^36] The result
can be negative in early years, in which case the tool draws it from the budget before anything
else. The ledger turns positive later and funds new connections.

The intervention carries an explicit lag. Repairs are charged when the works happen. The recovered
water and its value appear a specified number of years later.[^37] Other interventions bury this
delay in their start year. This one shows it.

### One intervention crosses from water to sanitation

Physical water recovered from leaks returns to the sewer as wastewater. A sanitation utility can
charge for it. The tool models the link directly: recovered volume multiplied by the share
returning to the sewer, the sewer charge, and the collection rate.[^38] The revenue funds
sanitation connections.

This link is the reason the engine computes water before sanitation.[^39] The recovered volume from
the water run is threaded into the matching sanitation run. NRW-linked sanitation revenue produces
nothing on its own. It needs NRW reduction switched on to have any water to charge for.

### Microfinance reaches households the budget cannot

Microfinance is the only intervention that addresses demand rather than public capital. It works on
the households the budget leaves unserved, in three stages.

First, the tool removes households that could pay for a connection themselves, taking them from the
richest income bracket down. These households are tracked for reporting but excluded from the
coverage result, since they would have connected anyway.[^40]

Second, the tool offers every remaining household a connection loan. A household connects if its
repayment capacity covers the loan. Capacity is its bracket's monthly income multiplied by the
share of income it will commit to the service. The loan is a level annuity at a real interest rate
over a fixed term.[^41]

Third, a means-based grant reaches households that can service only a smaller loan. The grant buys
the principal down to the affordable level. A one-time pool funds the cheapest grants first, which
maximizes connections per unit of grant money.[^42] The self-finance carve-out and the grant both
sit inside the microfinance intervention rather than carrying their own toggles.

Microfinance works on the increment of the gap each year, not the whole standing gap.[^43] The
distinction matters. Re-offering the same accumulated gap every year would serve it several times
over.

## Step 12. Add interventions the tool does not provide

The *Custom Interventions* section accepts user-defined levers in two forms.[^44] A **new revenue**
custom spends an implementation cost over a set number of years, produces a quantity of output each
year from a start year, and folds the net proceeds into capital. A **cost reduction** custom cuts
the price of a connection by a percentage or a fixed amount. Each routes to water, sanitation, or
both.

Custom interventions drive the calculation exactly as the built-in ones do. The BAU pass clears
them all, so they cannot move the BAU curve either.

## Step 13. Layer the interventions one at a time to attribute results

The tool does not decompose its results algebraically. It runs the calculation repeatedly.[^45] The
first run is the pure BAU scenario. Each subsequent run adds one more intervention on top of the
previous set. The households each run adds become that intervention's band on the impact graph.

The method has one property users should know. The bands sum exactly to the total, so nothing is
double counted. The share credited to any single intervention depends on its position in the
sequence. Two interventions that would close the same households will not both be credited with
them.

---

# Tab 4. Results Dashboard

The fourth tab compares the BAU and intervention scenarios.[^46] Toggles switch interventions on
and off without returning to Tab 3, and the parameters stay where the user set them. Two stacked
charts carry the headline story. The coverage chart puts the BAU base at the bottom and stacks each
intervention's added households on top, against the target line. The financing gap chart stacks the
gap each intervention removes, leaving the space up to the dashed line as the gap that
remains.[^47]

## Step 14. Sum the areas into a national result

National figures are the element-wise sum of the urban run and the rural run.[^48] Household
counts, budgets, capex, and gaps add up naturally, since each is a total rather than a rate.

Ratios do not add. Unit costs, growth rates, and efficiency ratios are rebuilt from the summed
components rather than averaged.[^49] A national budget execution rate is total executed budget
divided by total allocated budget, never the average of two percentages.

## Step 15. Read the results within their boundaries

The dashboard reports coverage by service level, the service gap, investment need, and the
financing gap, each for every sector and every forecast year, in BAU and intervention versions.
Presentation tables sit below the charts. Everything exports: the whole scenario to PowerPoint,
Excel, or CSV, and any single chart or table from its own button.[^46]

Every number on the dashboard rests on the assumptions set out in the next section. A reader
quoting a headline figure should carry the relevant assumption with it.

---

# Model assumptions and restrictions

The model answers a strategic financing question, not an engineering one. Its assumptions follow
from that purpose and from the data a planning ministry can realistically supply. Detail the
available inputs cannot support would add false precision rather than accuracy, so the model
chooses the simplest mechanism that still answers the question. Each assumption below is visible
on screen or derivable from an entered input, which lets a reader who is not a modeler check it.
The assumptions hold a value or a behavior fixed. The restrictions mark work the model leaves to
the user's judgment.

## What the model measures

- **Capital spending drives coverage.** The model converts money into connections at a unit cost
  per household. Operating cost enters at one point only. Tariff and collection interventions raise
  revenue, which the model puts toward new connections. Forecasting operating cost properly would
  need utility-level data that rarely exists at national scale. The results therefore describe what
  a sector can build, not what it can afford to run.
- **The model buys two service levels, and new households arrive at the bottom.** Investment is
  split between safely managed and basic, and each is bought at its own unit cost.[^12] Households
  move between named levels: money for basic moves them up from limited and below, money for safely
  managed moves them up from basic and below. Population growth feeds the three lowest levels in
  their prior proportions, so a growing population arrives unserved and has to be reached. Limited,
  unimproved and no service are still never purchased directly. A household leaves them only by
  being upgraded to basic.
- **Sanitation is modeled the same way as water.** Both sectors run through one calculation, each
  with its own service levels, targets, unit costs, and budget share.[^50] A sanitation connection
  is a household reached at a unit cost, whatever technology stands behind it. One shared
  calculation is far easier to audit than two. Treatment capacity and fecal sludge handling sit
  inside the unit cost.
- **One area is the unit of calculation, and national is the sum of its parts.** The model runs
  urban and rural separately, then adds them.[^2] Connection costs, coverage, and budgets differ
  sharply between the two. A single national average would hide the difference that most affects
  the answer.

## How the model handles money

- **Every figure is real, at base-year prices.** Real GDP in local currency is the primary
  macroeconomic input.[^14] A nominal model would compound an inflation forecast error across
  fifteen years or more. Real terms keep any two years directly comparable.
- **The budget is derived from the cost of service delivered.** The model reads the historical
  capital budget off the connections it paid for, then projects it as a constant share of
  GDP.[^16] Historical budget records are usually less complete and less consistent than the
  coverage record. Deriving the budget keeps the baseline consistent with observed delivery. Any
  year can be overridden by hand.
- **Budget execution falls back to 80 percent for any year left blank.** The model separates the
  allocated budget from the executed budget that reaches service.[^18] The separation is what makes
  budget execution a testable intervention rather than an untestable claim. The fallback is a
  placeholder, and a country figure should replace it wherever one is available. The shipped Nepal
  profile carries its own allocated series, which implies about 77 percent execution.
- **Every additional unit of revenue becomes capital.** Cash interventions assume the full revenue
  increase is available for new connections.[^29] A utility would in practice commit part of any
  increase to operations. Any split between operations and capital would be an assumption no better
  founded than the whole. These interventions therefore represent the upper end of what a revenue
  measure can deliver.

## How the model handles households and attribution

- **Household incomes stay at their base-year level in real terms.** The five income brackets hold
  constant across the whole forecast.[^51] Income growth forecasts by quintile are rarely available
  at country level. Microfinance affordability is judged against today's incomes in every year,
  which is the conservative case if real incomes rise.
- **Billed volumes grow in proportion to population.** Collection efficiency and tariff reform earn
  revenue on a volume of water sold or wastewater collected. The model holds that volume per person
  constant and scales the total with population.[^30] A volume that grew with new connections would
  make a revenue stream depend on the connections it is funding.
- **Business as usual is a fixed counterfactual.** The model calculates the BAU scenario and the
  intervention scenario separately.[^4] The restriction is deliberate. It lets a user change any
  intervention parameter and see the effect against a curve that never moves.
- **Interventions are credited in the order they are switched on.** The model adds one intervention
  at a time and credits each with what it adds to the set already running.[^45] The contributions
  therefore sum exactly to the total, and nothing is counted twice. Two interventions that would
  reach the same households will not both be credited with them, so a single intervention's share
  depends on its position in the sequence.
- **Interventions that connect households directly stop at the target path.** Non-revenue water
  reduction and microfinance are capped at the target level of safely managed service.[^54] The cap
  protects the basic-service target. An uncapped lever would claim credit beyond the goal the
  government set.

## Two legacy items

Two features remain visible in the interface without affecting the calculation. The five-period
planned investment inputs stay in the schema and on screen, and the model derives the budget
instead.[^52] The sanitation treatment allowance is scaled off a baseline household count rather
than a cost, which makes it negligible in practice.[^53] Both are carried over from the source
workbook.

---

## Notes

All references are to the tool's own source code, `test2` branch. The code is the authoritative
statement of the model.

[^1]: Castalia Advisors, WSS Strategic Scenarios Tool source, 2026, `model/inputs.py`, `InterventionToggles` and `CustomIntervention`.
[^2]: Source, `model/inputs.py`, `ModelInputs` docstring: "The model is PER AREA."
[^3]: Source, `model/water_supply.py`, `RUNGS` and `LOWER`.
[^4]: Source, `model/engine.py`, `calculate()` and `_sector_with_scenario()`.
[^5]: Source, `frontend/src/App.tsx`, `const tabs = ['Data Inputs', 'BAU Scenario', 'Intervention Design', 'Results Dashboard']`.
[^6]: Source, `frontend/src/App.tsx`, Tool Overview panel, "Make your selections first".
[^7]: Source, `frontend/src/components/InputPanel.tsx`, `Section` titles 1 to 5.
[^8]: Source, `frontend/src/components/InputPanel.tsx`, scope-specificity flag below section 2.
[^9]: Source, `frontend/src/App.tsx`, Tool Overview panel, cream and blue cell convention.
[^10]: Source, `model/inputs.py`, `PeriodInputs`.
[^11]: Source, `model/water_supply.py`, `sector_bau()`, per-rung mean year-on-year block.
[^12]: Source, `model/water_supply.py`, `sector_bau()`, adjusted-block assignment of rung 1.
[^13]: Source, `frontend/src/App.tsx`, target-year check on the service-level table; `model/inputs.py`, `TargetPoint`.
[^14]: Source, `model/engine.py`, `build_context()`, real-GDP primary path.
[^15]: Source, `model/engine.py`, `_project_series()`.
[^16]: Source, `model/water_supply.py`, `sector_bau()`, `budget_source == 'from_cost'` block.
[^17]: Source, `model/water_supply.py`, `sector_full_budget()`; `model/inputs.py`, `WSSBudgetInputs.budget_source`.
[^18]: Source, `model/water_supply.py`, `sector_bau()`, `DEFAULT_CAPEX_EFF = 0.80` and the allocated-budget block.
[^19]: Source, `frontend/src/App.tsx`, Tool Overview panel, "BAU Scenario"; `frontend/src/components/InputPanel.tsx`, section 6.
[^20]: Source, `model/water_supply.py`, `weighted_cost()`, `cost_with_treatment()`, `cost_no_treatment()`.
[^21]: Source, `model/water_supply.py`, `sector_bau()`, `depr = 1.0 / asset_life`; `model/inputs.py`, `TechnicalInputs.ws_asset_life = 30`.
[^22]: Source, `model/water_supply.py`, `sector_bau()`, `bau_stock[t] = bau_stock[t-1] - bau_replacement[t] + avail`.
[^23]: Source, `model/water_supply.py`, `sector_bau()`, comment on separating `bau_stock` from `stock`.
[^24]: Source, `model/engine.py`, `build_context()`, `perf_start_year = baseline_year + 1`.
[^25]: Source, `model/water_supply.py`, `sector_bau()`, section 4b segment-CAGR block.
[^26]: Source, `model/water_supply.py`, `sector_bau()`, section 4d.
[^27]: Source, `model/water_supply.py`, `sector_bau()`, `nonhh_mult`.
[^28]: Source, `frontend/src/components/InterventionPanel.tsx`, panel headings.
[^29]: Source, `model/water_supply.py`, `sector_bau()`, `avail` assembly in the forecast loop.
[^30]: Source, `model/water_supply.py`, `sector_bau()`, `_vol_factor()`.
[^31]: Source, `model/sanitation.py`, `calculate_sanitation()`, collection-efficiency arguments.
[^32]: Source, `model/water_supply.py`, `build_cost_factor()`, history guard `if y <= by: continue`.
[^33]: Source, `model/water_supply.py`, `build_cost_factor()`, `min(max(0.0, eff - costeff_current), 0.95)`.
[^34]: Source, `model/water_supply.py`, `build_cost_factor()`, `techmix_sm_cost / base_sm_cost`.
[^35]: Source, `model/water_supply.py`, `sector_bau()`, `nrw_upgrade_cum` and `nrw_physical`.
[^36]: Source, `model/water_supply.py`, `sector_bau()`, `nrw_net[t] = value - capex`.
[^37]: Source, `model/water_supply.py`, `sector_bau()`, `lag = max(0, int(nrw_lag))`.
[^38]: Source, `model/sanitation.py`, `calculate_sanitation()`, `nrw_link_cash`.
[^39]: Source, `model/engine.py`, `calculate()`, water computed before sanitation.
[^40]: Source, `model/water_supply.py`, `sector_bau()`, self-finance carve-out block.
[^41]: Source, `model/water_supply.py`, `affordability_close()` and `_annuity_factors()`.
[^42]: Source, `model/water_supply.py`, `affordability_close()`, `sorted(grant_cells, key=lambda x: x[0])`.
[^43]: Source, `model/water_supply.py`, `sector_bau()`, `gap_served_hw` high-water mark.
[^44]: Source, `model/water_supply.py`, `custom_streams()`; `model/inputs.py`, `CustomIntervention`.
[^45]: Source, `frontend/src/components/LiveInterventionChart.tsx`, cumulative multi-pass comparison.
[^46]: Source, `frontend/src/App.tsx`, Tool Overview panel, "Results Dashboard".
[^47]: Source, `frontend/src/components/ResultsDashboard.tsx`, `StackChart` subtitles.
[^48]: Source, `deck_aggregate.py`, module docstring and `_sum_series()`.
[^49]: Source, `deck_aggregate.py`, `_DERIVED_SECTOR` and `_ratio()`.
[^50]: Source, `model/sanitation.py`, module docstring.
[^51]: Source, `model/inputs.py`, `IncomeDistribution` docstring.
[^52]: Source, `model/water_supply.py`, `sector_bau()`, `planned_annual = np.zeros(n)`.
[^53]: Source, `model/sanitation.py`, `calculate_sanitation()`, `capex_adder` comment.
[^54]: Source, `model/water_supply.py`, `sector_bau()`, `sm_cap` and its application when NRW or the affordability lever is active.
