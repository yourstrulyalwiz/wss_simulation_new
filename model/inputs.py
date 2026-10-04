"""
Canonical input schema for the WSS Strategic Scenarios tool.

This is the single source of truth for model inputs. It mirrors the hardcoded
"Input" (grey) cells of the Excel `I|General` sheet — 168 parameters — documented
in `INPUT_CONTRACT.md`. Comments cite the contract item number (#N) and the Excel
cell where useful.

Structure notes:
  * The model is PER AREA. One `ModelInputs` describes one area (Urban, Rural, or
    National). The orchestrator runs each entered area and aggregates Urban+Rural
    into National.
  * Macro / population fields are ANNUAL TIME SERIES (one value per year over the
    historical range, forecast filled by the engine).
  * Service levels are TWO POINTS only: the start year and the baseline year.
  * Default values are illustrative (Nepal Kathmandu Valley) and exist only so the
    schema is runnable for testing — the binding part is the field list, units and
    structure, not the numbers.
"""

from pydantic import BaseModel
from typing import List, Optional


# ──────────────────────────────────────────────────────────────────────────
# Constants & labels  (contract #1-#18) — universal, not per-scenario
# ──────────────────────────────────────────────────────────────────────────
class Constants(BaseModel):
    days_in_month: int = 30        # #1
    days_in_year: int = 365        # #2
    thousand: int = 1_000          # #3
    million: int = 1_000_000       # #4
    cubic_meter_liters: int = 1_000  # #5
    months_in_year: int = 12       # used to annualise monthly income (tariff calcs)


class CountryConfig(BaseModel):
    country: str = "Nepal"                 # #6
    area: str = "Kathmandu Valley"
    area_type: str = "Urban"               # #7  — "Urban" | "Rural" | "National"
    currency: str = "NPR"                  # #8
    currency_usd: str = "USD"
    # Water service-level labels — JMP ladder (#9-#13)
    ws_serv1_name: str = "Safely managed"
    ws_serv2_name: str = "Basic"
    ws_serv3_name: str = "Limited"
    ws_serv4_name: str = "Unimproved"
    ws_serv5_name: str = "No Service"
    # Sanitation service-level labels (#14-#18)
    san_serv1_name: str = "Safely managed"
    san_serv2_name: str = "Basic"
    san_serv3_name: str = "Limited"
    san_serv4_name: str = "Unimproved"
    san_serv5_name: str = "No Service"


# ──────────────────────────────────────────────────────────────────────────
# Time scales
# ──────────────────────────────────────────────────────────────────────────
class PeriodInputs(BaseModel):
    model_start_year: int = 2011      # first historical (service-level "start") year
    baseline_year: int = 2025         # most recent complete-data year
    forecast_end_year: int = 2040     # last projection year (model horizon)
    target1_year: int = 2030          # interim target (Target 1)
    target2_year: int = 2040          # final target (Target 2)
    # As-is forecast window (Excel inputs G18/G19): the years that simply continue current
    # trends/budgets before the performance-improvement (target) path branches off.
    #   end-of-as-is year = as_is_forecast_start + as_is_forecast_length - 1   (2026 + 2 - 1 = 2027)
    #   performance-improvement start = end-of-as-is + 1                        (2028)
    as_is_forecast_start: int = 2026
    as_is_forecast_length: int = 2
    real_price_year: int = 2025       # anchor year for real-price deflation (Excel G51)


# ──────────────────────────────────────────────────────────────────────────
# Macroeconomics  (contract #19-#23) — annual time series
# ──────────────────────────────────────────────────────────────────────────
class MacroInputs(BaseModel):
    # test2: REAL GDP in local currency (millions) is now the PRIMARY macro input — entered directly,
    # so the engine no longer needs nominal-USD / inflation / FX to derive real GDP. Historical values
    # are hard; blank forecast years are filled at the mean historical growth (or a user override).
    gdp_real_local: List[float] = []      # real GDP, local currency millions (base-year prices)
    gdp_growth: List[float] = []          # #19 annual real GDP growth, % (historical)
    gdp_growth_forecast: float = 0.05     # fallback real GDP growth if <2 historical points to average
    # ── Legacy nominal-USD chain (kept only for backward compatibility / the Test Harness). When
    #    gdp_real_local is supplied the engine uses it directly and ignores everything below. ──
    gdp_nominal_usd: List[float] = []     # #20 GDP hard values (historical + any forecast years with data)
    inflation_local_ongoing: float = 0.05    # fixed local inflation for forecast years past the hard series
    inflation_us_ongoing: float = 0.022      # fixed US inflation for forecast years past the hard series
    inflation_local: List[float] = []   # #21 annual local inflation, %
    inflation_us: List[float] = []      # #22 annual US inflation, %
    exchange_rate: List[float] = []     # #23 local currency per 1 USD


# ──────────────────────────────────────────────────────────────────────────
# Population  (contract #24-#25) — annual time series
# ──────────────────────────────────────────────────────────────────────────
class PopulationInputs(BaseModel):
    # Households (#25) are the PRIMARY series for the 4a-4d math (sheet I!92): historical actuals,
    # forecast at the MEAN historical year-on-year HH growth (sheet G93). Population (#24, I!89) is a
    # parallel series forecast at the mean historical population growth (G90). Household SIZE (I!95)
    # is DERIVED for display only = population / households — it is NOT an input and not used in 4a-4d.
    pop_ts: List[float] = []   # #24 total population (millions of people), historical
    hh_ts: List[float] = []    # #25 total households (millions), historical


# ──────────────────────────────────────────────────────────────────────────
# Service levels  (contract #26-#45) — 5 levels, START year + BASELINE year
# ──────────────────────────────────────────────────────────────────────────
class WaterServiceLevelInputs(BaseModel):
    # Start year, % of HHs at each level (#26-#30) — full workbook precision (I!102-106)
    pct_serv1_start: float = 0.56560166762623     # Safely managed
    pct_serv2_start: float = 0.3403983323737703   # Basic
    pct_serv3_start: float = 0.0260               # Limited
    pct_serv4_start: float = 0.0580               # Unimproved
    pct_serv5_start: float = 0.0100               # No Service
    # Baseline year, % of HHs at each level (#31-#35) — full workbook precision (I!116-120)
    pct_serv1_baseline: float = 0.513729462650536
    pct_serv2_baseline: float = 0.386270537349464
    pct_serv3_baseline: float = 0.0320
    pct_serv4_baseline: float = 0.0590
    pct_serv5_baseline: float = 0.0090
    # test2: FULL per-rung historical share series (index 0 = model_start_year), when the user enters
    # every historical year. Empty ⇒ fall back to the start/baseline two-point path above.
    serv1_ts: List[float] = []
    serv2_ts: List[float] = []
    serv3_ts: List[float] = []
    serv4_ts: List[float] = []
    serv5_ts: List[float] = []
    # First historical YEAR used to compute the BAU growth rate (mean YoY, first_year → baseline).
    # 0 ⇒ use model_start_year.
    bau_first_year: int = 0


class SanitationServiceLevelInputs(BaseModel):
    # Start year (#36-#40) — I!152-156
    pct_sserv1_start: float = 0.0288   # Safely managed
    pct_sserv2_start: float = 0.9700   # Basic
    pct_sserv3_start: float = 0.0001   # Limited
    pct_sserv4_start: float = 0.0010   # Unimproved
    pct_sserv5_start: float = 0.0001   # No Service
    # Baseline year (#41-#45) — full workbook precision (I!166-170)
    pct_sserv1_baseline: float = 0.07774752344348565
    pct_sserv2_baseline: float = 0.909252476556514
    pct_sserv3_baseline: float = 0.0080
    pct_sserv4_baseline: float = 0.0030
    pct_sserv5_baseline: float = 0.0020
    # test2: FULL per-rung historical share series (index 0 = model_start_year); empty ⇒ two-point path.
    sserv1_ts: List[float] = []
    sserv2_ts: List[float] = []
    sserv3_ts: List[float] = []
    sserv4_ts: List[float] = []
    sserv5_ts: List[float] = []
    # First historical YEAR used to compute the BAU growth rate (mean YoY). 0 ⇒ model_start_year.
    bau_first_year: int = 0


# ──────────────────────────────────────────────────────────────────────────
# Targets  (contract #46-#66)
# ──────────────────────────────────────────────────────────────────────────
class TargetPoint(BaseModel):
    """test2: one target year and its 5-rung service-level shares (fractions, Σ≈1).

    A target is any forecast year the user fills a full service-level column for. The engine
    interpolates (piecewise CAGR) between consecutive targets, so ANY number of them is allowed."""
    year: int
    shares: List[float] = [0.0, 0.0, 0.0, 0.0, 0.0]


class WaterTargetInputs(BaseModel):
    # test2: N-target list (any number of target years). When non-empty this REPLACES the two
    # target1/target2 sets below; those remain as a fallback for legacy payloads.
    targets: List[TargetPoint] = []
    # Target 1 (2030) — % of HHs at each level (#46-#50)
    target1_serv1: float = 0.66
    target1_serv2: float = 0.34
    target1_serv3: float = 0.0
    target1_serv4: float = 0.0
    target1_serv5: float = 0.0
    # Target 2 (2040) (#51-#55)
    target2_serv1: float = 1.0
    target2_serv2: float = 0.0
    target2_serv3: float = 0.0
    target2_serv4: float = 0.0
    target2_serv5: float = 0.0


class SanitationTargetInputs(BaseModel):
    onsite_collection_treatment_pct: float = 0.12   # #56 % on-site sanitation
    targets: List[TargetPoint] = []                 # test2: N-target list (see WaterTargetInputs)
    # Target 1 (2030) (#57-#61)
    target1_sserv1: float = 0.66
    target1_sserv2: float = 0.34
    target1_sserv3: float = 0.0
    target1_sserv4: float = 0.0
    target1_sserv5: float = 0.0
    # Target 2 (2040) (#62-#66)
    target2_sserv1: float = 1.0
    target2_sserv2: float = 0.0
    target2_sserv3: float = 0.0
    target2_sserv4: float = 0.0
    target2_sserv5: float = 0.0


# ──────────────────────────────────────────────────────────────────────────
# Technology mix + unit costs  (contract #67-#95)
# Costs are per HH, in local currency, at base-year prices.
# The Safely-managed and Basic rungs each have their OWN technology mix — different technologies
# and/or shares — so the two weighted costs are computed from independent lists. Each list is open
# (name editable, add/remove) and its shares must total 1. Weighted cost = Σ(share × cost).
# ──────────────────────────────────────────────────────────────────────────
class Tech(BaseModel):
    name: str = "Technology"
    share: float = 0.0    # share of HHs at this rung served by this technology (fraction)
    cost: float = 0.0     # capex per HH for this technology (base-year prices)


class WaterUnitCosts(BaseModel):
    # Component costs at full workbook precision (I!258-261 / I!266-269)
    sm_technologies: List[Tech] = [        # safely-managed mix -> weighted SM connection cost (=96,878)
        Tech(name="Piped network",       share=0.65, cost=105_388.31832439502),
        Tech(name="Protected well",      share=0.15, cost=60_000.0),
        Tech(name="Water tanker",        share=0.10, cost=96_878.0),
        Tech(name="Borehole + handpump", share=0.10, cost=96_877.9308914323),
    ]
    basic_technologies: List[Tech] = [     # basic mix -> weighted basic-rung cost (=86,875.593)
        Tech(name="Piped network",       share=0.65, cost=90_000.0),
        Tech(name="Protected well",      share=0.15, cost=60_000.0),
        Tech(name="Water tanker",        share=0.10, cost=96_878.0),
        Tech(name="Borehole + handpump", share=0.10, cost=96_877.9308914323),
    ]


class SanitationUnitCosts(BaseModel):
    # Component costs at full workbook precision (I!284-289 / I!295-299)
    sm_technologies: List[Tech] = [        # safely-managed mix -> weighted SM cost (=105,050.234)
        Tech(name="Piped / network", share=0.6570, cost=117_290.76671794064),
        Tech(name="Septic tank",     share=0.3360, cost=83_000.0),
        Tech(name="Pit latrine",     share=0.0060, cost=14_600.0),
        Tech(name="VIP latrine",     share=0.0,    cost=16_500.0),
        Tech(name="Pit + slab",      share=0.0010, cost=14_600.0),
        Tech(name="Composting",      share=0.0,    cost=22_000.0),
    ]
    basic_technologies: List[Tech] = [     # basic mix -> weighted basic-rung cost (=105,050.234)
        Tech(name="Piped / network", share=0.6570, cost=117_290.76671794064),
        Tech(name="Septic tank",     share=0.3360, cost=83_000.0),
        Tech(name="Pit latrine",     share=0.0060, cost=14_600.0),
        Tech(name="VIP latrine",     share=0.0,    cost=16_500.0),
        Tech(name="Pit + slab",      share=0.0010, cost=14_600.0),
        Tech(name="Composting",      share=0.0,    cost=22_000.0),
    ]


# ──────────────────────────────────────────────────────────────────────────
# WSS budget  (contract #96-#98)
# ──────────────────────────────────────────────────────────────────────────
class WSSBudgetInputs(BaseModel):
    capex_pct_budget: float = 0.21          # #96 capex as % of total budget (shared fallback / legacy)
    # Per-sector capex share of that sector's budget. Water and sanitation carry DIFFERENT capex
    # fractions in the workbook (excel2 I|General Urban: water G321 = 0.21, sanitation G328 = 0.15).
    # If None, the sector falls back to capex_pct_budget (backward-compatible with old payloads).
    ws_capex_pct: Optional[float] = None    # water capex as % of water budget  (sheet G321)
    san_capex_pct: Optional[float] = None   # sanitation capex as % of sanitation budget (sheet G328)
    ws_budget_pct_gdp: float = 0.0016496186144332283   # #97 water supply budget as % of GDP (sheet G324)
    san_budget_pct_gdp: float = 0.0004  # #98 sanitation budget as % of GDP (final.xlsx sheet G331)
    # Budget execution rate (%GDP mode only): the share of the ALLOCATED capex budget that is
    # actually spent. actual capex = allocated (%GDP × real GDP × %capex) × execution_rate. A single
    # rate shared by both sectors. 1.0 = full execution (reproduces the pre-execution-rate results).
    execution_rate: float = 1.0
    # Budget source: 'pct_gdp' (full budget = real GDP × %GDP), 'direct' (enter the actual expenditure
    # series directly, real terms), or 'from_cost' (test2: historical budget = cost of NEW connections
    # that year = Σ_rung max(0,ΔHH)×unit cost for the Safely-managed + Basic rungs; forecast budget =
    # avg historical (budget ÷ real GDP) × real GDP, then blank cells filled at mean growth / overridden).
    # In 'direct' mode the *_budget_direct series is the full sector budget per year; years past the
    # hard values compound at *_budget_direct_ongoing.
    budget_input_mode: str = 'pct_gdp'
    budget_source: str = 'pct_gdp'          # test2 alias: 'pct_gdp' | 'direct' | 'from_cost'
    ws_budget_direct: List[float] = []      # user overrides (direct mode; also per-year overrides in from_cost)
    san_budget_direct: List[float] = []
    ws_budget_direct_ongoing: float = 0.05
    san_budget_direct_ongoing: float = 0.05
    # ALLOCATED capital budget (manual input, bigger than what's actually used/spent on service). Blank
    # years default to used ÷ 0.8 (history) and mean(allocated÷used) × used-forecast (forecast); capex
    # efficiency = used ÷ allocated. Per-year overrides, same shape as *_budget_direct.
    ws_budget_allocated: List[float] = []
    san_budget_allocated: List[float] = []


# ──────────────────────────────────────────────────────────────────────────
# Planned investments  (contract #99-#108)
# Five fixed 5-year periods: 2026-30, 2031-35, 2036-40, 2041-45, 2046-50.
# Amounts in local currency, millions.
# ──────────────────────────────────────────────────────────────────────────
class PlannedInvestmentInputs(BaseModel):
    first_period_start: int = 2026
    period_length_years: int = 5
    n_periods: int = 5
    # sheet I!326-330 exact values (Σ = 47,069.921); annual planned = Σ ÷ (target2 − baseline)
    ws_planned: List[float] = [16_223.765355365464, 14_005.46734156549, 9_306.350838959635,
                               4_817.250716358515, 2_717.0869163112056]           # #99-#103
    san_planned: List[float] = [17_000.0, 12_000.0, 11_000.0, 7_000.0, 5_000.0]   # #104-#108 (I!338-342)


# ──────────────────────────────────────────────────────────────────────────
# Technical  (contract #109-#112)
# ──────────────────────────────────────────────────────────────────────────
class TechnicalInputs(BaseModel):
    ws_non_hh_pct: float = 0.10           # #109 % water sold to non-HH
    ws_asset_life: int = 30               # #110 useful life of assets (years) — water depreciation
    ws_water_req_who_lpcd: float = 75.0   # #111 WHO water requirement, L/capita/day
    san_non_hh_pct: float = 0.10          # #112 % sanitation services sold to non-HH
    san_asset_life: int = 30              # sanitation depreciation (Excel I!G367, separate from water)


# ──────────────────────────────────────────────────────────────────────────
# Water supply interventions  (contract #113-#142)
# ──────────────────────────────────────────────────────────────────────────
class WaterInterventionInputs(BaseModel):
    # Financial commitments and injection share settings but have independent intervention switches.
    # The GDP value is
    # the TARGET total sector-spending share (not an uplift); only the positive difference above BAU is added.
    fin_gdp_enabled: bool = False
    fin_gdp_start_year: int = 2026
    fin_gdp_target_share: float = 0.0
    fin_growth_enabled: bool = False
    fin_growth_rate: float = 0.0
    fin_growth_start_year: int = 2026
    fin_growth_end_year: int = 2040
    fin_injection_enabled: bool = False
    fin_injection_mode: str = 'one_time'  # 'one_time' | 'recurring'
    fin_injection_amount: float = 0.0      # local-currency millions
    fin_injection_start_year: int = 2026
    fin_injection_end_year: int = 2040

    # Increased collection efficiency (#113-#118)
    ce_start_year: int = 2028
    ce_target_year: int = 2031
    ce_current_ratio: float = 0.83
    ce_target_ratio: float = 0.98
    ce_water_sold_mld: float = 240.0         # volume of water sold at ce_start_year (the anchor year)
    ce_current_tariff: float = 32.0          # local currency per m3
    # Volume grows each forecast year off the ce_start_year value. None → scale with population
    # (the default); a number → fixed compound real growth rate (e.g. 0.03 = 3%/yr).
    ce_vol_growth: Optional[float] = None

    # NRW reduction (#119-#126) — reduce non-revenue water; the recovered PHYSICAL water upgrades basic
    # households to safely-managed (capped at the SM target), and a money ledger nets the water's value
    # against the cost of fixing → drawn from / added to the connection budget.
    nrw_start_year: int = 2028
    nrw_target_year: int = 2034
    nrw_current_pct: float = 0.40
    nrw_target_pct: float = 0.15
    nrw_treatment_cost_pct_capex: float = 0.40   # #123 water treatment cost as % of total capex (BAU adder)
    nrw_physical_loss_pct: float = 0.50          # #124 physical losses as % of total NRW (only physical → new water)
    nrw_lag_years: int = 1                       # #125 years between the works/spend and the recovered-water benefit
    nrw_capex_unit_cost_usd: float = 510.0       # #126 USD(2023) per m3/day (legacy; superseded by the local unit below)
    # test2 simplified NRW lever inputs:
    nrw_system_input_vol: float = 146.0          # total water produced at nrw_start_year, MLD (million litres/day)
    # System volume grows off the NRW start year. None → scale with population (default); a number →
    # fixed compound real growth (same options as ce_vol_growth).
    nrw_vol_growth: Optional[float] = None
    nrw_water_per_upgrade: float = 100.0         # extra water for a basic→SM upgrade, m³ / household / year
    nrw_capex_unit_cost_local: float = 73_809.0  # "cost of fixing" — local currency per m³/day of NRW recovered
    nrw_value_basis: str = 'tariff'              # value the recovered water at 'tariff' or 'production' cost
    nrw_tariff: float = 32.0                      # water tariff, local currency per m³ (value if basis='tariff')
    nrw_production_cost: float = 20.0             # avoided production cost, local currency per m³ (if basis='production')

    # Increased capital-expenditure efficiency (#127-#128).
    # test2 redefinition: capex efficiency = capital that becomes new service ÷ allocated capital budget
    # ("budget used ÷ budget"). The baseline is AUTO-computed from history (engine returns it); the
    # intervention ramps it from the baseline up to `capeff_target_pct` (≤1.0) between start & target year.
    # `capeff_current_pct` > 0 overrides the auto baseline (for what-if). `capeff_gains_pct` is the old
    # unit-cost-reduction knob, kept for back-compat but no longer used.
    capeff_start_year: int = 2027
    capeff_gains_pct: float = 0.20
    capeff_target_year: int = 2035
    capeff_target_pct: float = 1.00          # target execution efficiency (≤ 1.0)
    capeff_current_pct: float = 0.0          # 0 → use the auto-calculated baseline

    # ── Capex efficiency (test2, unit-cost discount) — DISTINCT from capeff above (which is budget
    # execution = used ÷ allocated). This DISCOUNTS the safely-managed CONNECTION COST, ramping the
    # discount UP from BAU: 0 at costeff_start_year, growing linearly to (costeff_target_pct −
    # costeff_current_pct) by costeff_target_year, then held. Applied via the engine's cost_factor hook
    # (forecast only), so the same budget builds more connections. Toggle ws_costeff_enabled.
    costeff_start_year: int = 2027
    costeff_target_year: int = 2035
    costeff_current_pct: float = 0.0         # current capex efficiency (discount baseline = the BAU point)
    costeff_target_pct: float = 0.0          # target capex efficiency (discount reached by the target year)

    # ── Optimised technology selection (test2) — a re-modelled safely-managed technology MIX that changes
    # the SM connection cost from techmix_start_year onward (STEP change, no ramp). The frontend edits the
    # per-technology mix; the adapter collapses it to techmix_sm_cost = the new REAL weighted SM connection
    # cost (0 → no change / keep the BAU cost). Applied via the same cost_factor hook. Toggle ws_techmix_enabled.
    techmix_start_year: int = 2027
    techmix_sm_cost: float = 0.0             # new real weighted SM connection cost (0 → keep the BAU cost)
    # ── Investment split between service levels (test2) ────────────────────────────────────────────
    # Share of NEW investment (after replacement) directed at BASIC service for households at
    # limited-and-below. The remainder buys SAFELY MANAGED service for households at basic-and-below.
    # 0.0 = every currency unit goes to safely managed, which is the default and the pre-split model.
    # This is a scenario-wide assumption rather than a toggled lever, so it moves the BAU curve too.
    basic_share: float = 0.0
    # New weighted BASIC connection cost from techmix_start_year (0 -> keep the BAU basic cost), the
    # basic-rung counterpart of techmix_sm_cost.
    techmix_basic_cost: float = 0.0


    # Tariff reform (#129-#135) — simplified: raise the tariff linearly from current→target over
    # start→target year; the extra revenue (volume × tariff rise) is recycled into capex for new service.
    tariff_start_year: int = 2028
    tariff_target_year: int = 2033
    tariff_volume_mld: float = 240.0         # volume of water sold at tariff_start_year (scales with population)
    tariff_current: float = 32.0             # current average tariff, local currency per m3
    tariff_target: float = 40.0              # target average tariff, local currency per m3

    # ── Microfinance + means-based grant (affordability lever) ──────────────────────────────────────
    # Households in the safely-managed service gap that the budget can't reach are financed by a CONNECTION
    # LOAN. A share `mf_partial_share` of gap HH pay part (`mf_upfront_payable_ratio`) of the upfront fee, so
    # their loan principal is reduced; the rest finance the whole SM connection cost. A household affords the
    # loan if its annual capacity (12 × its income bracket's monthly income × `mf_pct_income`) covers the level
    # annuity (REAL rate, tenor) → microfinance connects it. Those who can only service a smaller loan get a
    # MEANS-BASED GRANT that buys the principal down to the affordable level; the one-time `grant_total` pool
    # (local-currency millions) funds the cheapest grants first. `mf_takeup_rate` is the annual take-up among
    # eligible gap HH. `mf_gap_shares` splits the SM gap across the 5 income brackets (low→high, Σ≈1).
    mf_connection_fee: float = 0.0        # capital cost of a connection financed by the loan; 0 → use the SM
                                          # new-service cost (cost_sm), the same capex the rest of the model uses
    mf_start_year: int = 2028
    mf_end_year: int = 2040
    mf_pct_income: float = 0.05           # max share of monthly income this service's loan repayment may take
    mf_interest_rate: float = 0.10        # REAL annual interest rate on the connection loan
    mf_tenor: int = 10                    # loan tenor, years
    mf_partial_share: float = 0.0         # share of gap HH who can pay part of the upfront fee (s_p)
    mf_upfront_payable_ratio: float = 0.0 # fraction of the upfront fee those partial-payers cover (u)
    mf_takeup_rate: float = 0.5           # share of eligible (loan-needing) gap HH who take up the loan
    mf_gap_shares: List[float] = [0.40, 0.30, 0.15, 0.10, 0.05]  # SM-gap split across the 5 income brackets
    mf_selffinance_share: float = 0.0     # share of the SM gap that can pay the connection upfront (self-finance);
                                          # peeled off richest-bracket-first, connected as their own band, and
                                          # EXCLUDED from the microfinance/grant loan pool (they don't need a loan)
    grant_total: float = 0.0              # means-based grant pool, local-currency MILLIONS (one-time)


# ──────────────────────────────────────────────────────────────────────────
# Sanitation interventions  (contract #143-#160)
# ──────────────────────────────────────────────────────────────────────────
class SanitationInterventionInputs(BaseModel):
    ce_current_ratio: Optional[float] = None
    ce_target_ratio: Optional[float] = None
    # Financial commitments and injection — same independent mechanics and units as water.
    fin_gdp_enabled: bool = False
    fin_gdp_start_year: int = 2026
    fin_gdp_target_share: float = 0.0
    fin_growth_enabled: bool = False
    fin_growth_rate: float = 0.0
    fin_growth_start_year: int = 2026
    fin_growth_end_year: int = 2040
    fin_injection_enabled: bool = False
    fin_injection_mode: str = 'one_time'
    fin_injection_amount: float = 0.0
    fin_injection_start_year: int = 2026
    fin_injection_end_year: int = 2040

    # Increased collection efficiency (#143-#146)
    ce_start_year: int = 2027
    ce_target_year: int = 2030
    ce_wastewater_collected_pct: float = 0.80    # #145
    ce_sewer_tariff_pct_water: float = 0.50      # #146 sewer tariff as % of water tariff

    # Increased capital-expenditure efficiency (#147-#148). test2: same "budget used ÷ budget" execution
    # model as water — auto baseline (engine-computed), ramped to capeff_target_pct over start→target year.
    capeff_start_year: int = 2027
    capeff_gains_pct: float = 0.20
    capeff_target_year: int = 2035
    capeff_target_pct: float = 1.00
    capeff_current_pct: float = 0.0

    # Capex efficiency (unit-cost discount) — same mechanic as water (see WaterInterventionInputs): discount
    # the SM connection cost, ramping the discount up from BAU 0 → (target − current) over start→target year.
    # Toggle san_costeff_enabled.
    costeff_start_year: int = 2027
    costeff_target_year: int = 2035
    costeff_current_pct: float = 0.0
    costeff_target_pct: float = 0.0

    # Optimised technology selection — new weighted SM connection cost from techmix_start_year (step change).
    # techmix_sm_cost is the new real weighted SM cost (0 → keep the BAU cost). Toggle san_techmix_enabled.
    techmix_start_year: int = 2027
    techmix_sm_cost: float = 0.0

    # ── Investment split between service levels (test2) ────────────────────────────────────────────
    # Share of NEW investment (after replacement) directed at BASIC service for households at
    # limited-and-below. The remainder buys SAFELY MANAGED service for households at basic-and-below.
    # 0.0 = every currency unit goes to safely managed, which is the default and the pre-split model.
    # This is a scenario-wide assumption rather than a toggled lever, so it moves the BAU curve too.
    basic_share: float = 0.0
    # New weighted BASIC connection cost from techmix_start_year (0 -> keep the BAU basic cost), the
    # basic-rung counterpart of techmix_sm_cost.
    techmix_basic_cost: float = 0.0

    # ── NRW-linked sanitation revenue (test2, cross-sector) — the PHYSICAL water recovered by the WATER
    # NRW-reduction lever returns to the sewer as wastewater the sanitation utility can charge for. Revenue
    # per year = recovered_water(M m³/yr) × return_ratio × sewer_charge(LC/m³) × collection_rate, folded into
    # sanitation capex (extra_cash) to build more safely-managed sanitation connections. Zero unless BOTH the
    # water NRW lever and this lever are on (the recovered volume is 0 when water NRW is off). Toggle
    # san_nrw_link_enabled. The recovered volume is LINKED from the water NRW lever, not re-entered here.
    nrw_link_return_ratio: float = 0.80     # fraction of recovered water returning to the sewer as wastewater
    nrw_link_sewer_charge: float = 16.0     # sanitation charge per m³ of wastewater (LC/m³) → revenue
    nrw_link_collection_rate: float = 0.80  # fraction of that billed sanitation revenue actually collected

    # Tariff reform (#149-#151) — simplified: raise the sewer tariff linearly from current→target over
    # start→target year; the extra revenue (volume × tariff rise) is recycled into capex for new service.
    tariff_start_year: int = 2028
    tariff_target_year: int = 2033
    tariff_volume_mld: float = 120.0         # volume of wastewater billed at tariff_start_year (scales with population)
    tariff_current: float = 16.0             # current average sewer tariff, local currency per m3
    tariff_target: float = 24.0              # target average sewer tariff, local currency per m3

    # ── Microfinance + means-based grant (affordability lever) — see WaterInterventionInputs for the full
    #    mechanic. Sanitation runs it independently with its own willingness-to-pay %, loan terms, gap split
    #    and grant pool; the connection cost is the sanitation SM new-service cost. ──
    mf_connection_fee: float = 0.0        # capital cost of a connection financed by the loan; 0 → use the SM
                                          # new-service cost (cost_sm), the same capex the rest of the model uses
    mf_start_year: int = 2028
    mf_end_year: int = 2040
    mf_pct_income: float = 0.05           # max share of monthly income this service's loan repayment may take
    mf_interest_rate: float = 0.10        # REAL annual interest rate on the connection loan
    mf_tenor: int = 10                    # loan tenor, years
    mf_partial_share: float = 0.0         # share of gap HH who can pay part of the upfront fee (s_p)
    mf_upfront_payable_ratio: float = 0.0 # fraction of the upfront fee those partial-payers cover (u)
    mf_takeup_rate: float = 0.5           # share of eligible (loan-needing) gap HH who take up the loan
    mf_gap_shares: List[float] = [0.40, 0.30, 0.15, 0.10, 0.05]  # SM-gap split across the 5 income brackets
    mf_selffinance_share: float = 0.0     # share of the SM gap that can pay the connection upfront (self-finance);
                                          # peeled off richest-bracket-first, connected as their own band, and
                                          # EXCLUDED from the microfinance/grant loan pool (they don't need a loan)
    grant_total: float = 0.0              # means-based grant pool, local-currency MILLIONS (one-time)


# ──────────────────────────────────────────────────────────────────────────
# Income distribution (test2 affordability data) — feeds the microfinance + grant lever
# ──────────────────────────────────────────────────────────────────────────
class IncomeBracket(BaseModel):
    income_monthly: float = 0.0   # household monthly income, local currency, base-year real (held constant real)
    hh_share: float = 0.0         # share of all households in this bracket (fraction, Σ≈1)


class IncomeDistribution(BaseModel):
    """Five income brackets (quintiles), CONSTANT real over the forecast. Each bracket's monthly income sets
    how much a household can put toward a connection loan (income × the lever's `mf_pct_income`), which decides
    whether microfinance alone connects it or a means-based grant is needed."""
    brackets: List[IncomeBracket] = [
        IncomeBracket(income_monthly=6_000.0,  hh_share=0.20),
        IncomeBracket(income_monthly=10_904.0, hh_share=0.20),
        IncomeBracket(income_monthly=16_000.0, hh_share=0.20),
        IncomeBracket(income_monthly=24_000.0, hh_share=0.20),
        IncomeBracket(income_monthly=45_000.0, hh_share=0.20),
    ]


# ──────────────────────────────────────────────────────────────────────────
# Custom interventions (test2) — user-defined levers that ACTUALLY affect the model, for either sector.
# ──────────────────────────────────────────────────────────────────────────
class CustomIntervention(BaseModel):
    """A user-defined intervention that drives the calculation (both sectors). Two types:

    'new_revenue'   — invest `implement_cost` (total, spread evenly over `cost_years` from `start_year`)
                      to produce `output_quantity` of `output_unit` each year from `output_start_year`,
                      each unit worth `output_value`. The NET (revenue − cost) per year folds into that
                      sector's capex (like the tariff/NRW cash levers) to build more safely-managed HH.
    'cost_reduction'— from `start_year`, cut the safely-managed connection cost per HH by `cost_effect`
                      (a fraction when `cost_effect_mode`='pct', a flat currency amount when 'flat').

    `sector` routes it ('water' | 'sanitation' | 'both'); `enabled` gates it and is forced OFF in the BAU
    pass (the engine clears the whole list), so the BAU counterfactual never moves. Money fields are in
    ACTUAL currency (the engine scales revenue/cost to the model's millions)."""
    name: str = 'Custom intervention'
    enabled: bool = True
    sector: str = 'both'                     # 'water' | 'sanitation' | 'both'
    intervention_type: str = 'new_revenue'   # 'new_revenue' | 'cost_reduction'
    color: str = '#9333ea'
    start_year: int = 2028
    end_year: int = 2040                     # kept for compatibility; the two types below use start_year timing
    # New revenue source
    implement_cost: float = 0.0     # total cost to implement (currency), spread evenly over cost_years
    cost_years: int = 1             # number of years the implementation cost is spread over, from start_year
    output_unit: str = 'unit'       # label for the output (e.g. m³, kWh, tonnes)
    output_start_year: int = 2028   # first year output (and its revenue) is produced, through the forecast end
    output_quantity: float = 0.0    # output produced per year, in output_unit
    output_value: float = 0.0       # value per unit of output (currency/unit)
    # Cost reduction
    outputs_affected: str = 'sm'    # which cost it reduces (only the safely-managed connection cost drives the forecast)
    cost_effect_mode: str = 'pct'   # 'pct' (fraction off) | 'flat' (currency amount off the per-HH cost)
    cost_effect: float = 0.0        # the % (fraction) or flat amount


# ──────────────────────────────────────────────────────────────────────────
# Run configuration (not part of the 168 — scenario switches for the tool)
# ──────────────────────────────────────────────────────────────────────────
class InterventionToggles(BaseModel):
    # Water supply
    ws_collection_efficiency_enabled: bool = True
    ws_nrw_enabled: bool = True
    ws_capital_efficiency_enabled: bool = True
    ws_tariff_enabled: bool = True
    # test2 cost-side levers (default False so a payload that predates them stays OFF, not silently on):
    # ws_costeff_enabled = capex efficiency (unit-cost discount); ws_techmix_enabled = optimised technology.
    ws_costeff_enabled: bool = False
    ws_techmix_enabled: bool = False
    # One affordability intervention: loan-financed SM connections. It carries a self-finance carve-out
    # (`mf_selffinance_share` isolates the BAU-anyway HH who'd pay upfront) and a means-based grant sub-lever
    # (`grant_total` buys the loan down for HH who can't service it). No separate self-finance/grant toggles.
    ws_microfinance_enabled: bool = True
    ws_financial_commitment_enabled: bool = False
    ws_exogenous_injection_enabled: bool = False
    # Sanitation
    san_collection_efficiency_enabled: bool = True
    san_capital_efficiency_enabled: bool = True
    san_tariff_enabled: bool = True
    san_microfinance_enabled: bool = True
    # test2 cost-side levers (default False, same rationale as the water pair above).
    san_costeff_enabled: bool = False
    san_techmix_enabled: bool = False
    # NRW-linked sanitation revenue (needs the water NRW lever on to have any recovered volume to charge for).
    san_nrw_link_enabled: bool = False
    san_financial_commitment_enabled: bool = False
    san_exogenous_injection_enabled: bool = False


# ──────────────────────────────────────────────────────────────────────────
# Top-level model inputs (one area)
# ──────────────────────────────────────────────────────────────────────────
class ModelInputs(BaseModel):
    revenue_bases: dict = {}
    revenue_legacy: dict = {}
    country_config: CountryConfig = CountryConfig()
    period: PeriodInputs = PeriodInputs()
    constants: Constants = Constants()
    macro: MacroInputs = MacroInputs()
    wss_budget: WSSBudgetInputs = WSSBudgetInputs()
    population: PopulationInputs = PopulationInputs()
    water_service: WaterServiceLevelInputs = WaterServiceLevelInputs()
    sanitation_service: SanitationServiceLevelInputs = SanitationServiceLevelInputs()
    water_targets: WaterTargetInputs = WaterTargetInputs()
    sanitation_targets: SanitationTargetInputs = SanitationTargetInputs()
    water_costs: WaterUnitCosts = WaterUnitCosts()
    sanitation_costs: SanitationUnitCosts = SanitationUnitCosts()
    planned_investments: PlannedInvestmentInputs = PlannedInvestmentInputs()
    technical: TechnicalInputs = TechnicalInputs()
    water_interventions: WaterInterventionInputs = WaterInterventionInputs()
    sanitation_interventions: SanitationInterventionInputs = SanitationInterventionInputs()
    income_distribution: IncomeDistribution = IncomeDistribution()
    toggles: InterventionToggles = InterventionToggles()
    custom_interventions: List[CustomIntervention] = []
