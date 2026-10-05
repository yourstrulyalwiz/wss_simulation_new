"""
Demo adapter — bridges the demo frontend's (rich) input schema to the validated engine.

The React demo (frontend/src/components/InputPanel.tsx) reads a schema of its own:
budget under macro.*, inflation_nepal, per-year service-level time series (serv1_ts…),
per-service-level network costs, budget modes, and the five interventions. The validated
engine (model/) uses a leaner schema. Rather than rewrite the 900-line UI, this module:

  * FRONTEND_DEFAULTS — the shape the InputPanel expects, populated with the sheet-validated
    Kathmandu-Valley numbers, so /api/defaults renders a working, editable input sheet.
  * to_engine(fe) — translates that frontend shape into a model.inputs.ModelInputs for the
    engine's BAU (4a-4d). Interventions in the UI are carried but not yet computed.
"""
from model.inputs import (
    ModelInputs, PeriodInputs, Constants, MacroInputs, PopulationInputs,
    WaterServiceLevelInputs, SanitationServiceLevelInputs, WaterTargetInputs,
    SanitationTargetInputs, WaterUnitCosts, SanitationUnitCosts, Tech,
    PlannedInvestmentInputs, TechnicalInputs, WSSBudgetInputs,
    WaterInterventionInputs, SanitationInterventionInputs, CountryConfig, TargetPoint,
    InterventionToggles, IncomeDistribution, IncomeBracket, CustomIntervention, UtilityDebtInputs,
)

# Default 5-bracket income distribution shared with the microfinance + grant lever (quintiles; monthly
# income in local currency, HH share fraction). Used both as the frontend default and the parse fallback.
_INCOME_BRACKETS_DEFAULT = [
    {'income_monthly': 6_000.0,  'hh_share': 0.20},
    {'income_monthly': 10_904.0, 'hh_share': 0.20},
    {'income_monthly': 16_000.0, 'hh_share': 0.20},
    {'income_monthly': 24_000.0, 'hh_share': 0.20},
    {'income_monthly': 45_000.0, 'hh_share': 0.20},
]
_GAP_SHARES_DEFAULT = [0.40, 0.30, 0.15, 0.10, 0.05]   # SM-gap split across brackets, skewed to the poor

# ── validated Kathmandu-Valley values (from the reference workbook) ──────────
# All series/scalars carry the workbook's FULL float precision (I|General Urban). Rounding these
# (even at the 5th-6th decimal) shifts every money output by ~1e-5 relative — visibly off Excel.
_GDP_USD = [21.685,21.703,22.162,22.722,24.361,24.524,28.972,33.112,34.186,33.434,36.927,41.183,40.907,43.419,46.08,49.603,54.449,59.728,65.494,71.783]
_INFL_LOCAL = [0.096,0.083,0.099,0.09,0.078,0.099,0.045,0.041,0.046,0.061,0.036,0.064,0.077,0.054,0.049,0.05,0.051,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05,0.05]
_INFL_US = [0.031,0.021,0.015,0.016,0.001,0.013,0.021,0.024,0.018,0.013,0.047,0.08,0.041,0.03,0.03,0.025,0.021,0.022,0.022,0.022,0.022,0.022,0.022,0.022,0.022,0.022,0.022,0.022,0.022,0.022]
_FX = [74.5973698630137,85.4278961748633,93.6310410958903,97.62424657534244,102.61506849315076,107.48286885245902,104.19501369863016,109.41323287671237,112.63893150684937,118.55868493150682,118.2669863013699,125.73810958904113,132.1363561643834,133.86980874316944]
_POP = [2.423388,2.477757119096809,2.533346018563647,2.5901820643791393,2.6482932364822645,2.707708142546658,2.768456032063945,2.830566810743036,2.8940710552324713,2.959000028173066,3.0253856935882634,3.0932607326197694,3.1626585596162253,3.233613338582828]
_HH = [0.61,0.6292760000000001,0.6491611216000001,0.6696746130425602,0.6908363308147051,0.7126667588684498,0.7351870284486929,0.7584189385476716,0.7823849770057781,0.8071083422791607,0.8326129658951823,0.8589235356174701,0.8860655193429823,0.9140651897542206]
_WS_START = [0.56560166762623,0.3403983323737703,0.026,0.058,0.01]
_WS_BASE  = [0.513729462650536,0.386270537349464,0.032,0.059,0.009]
# Sample targets keep a real BASIC share at the final target year. A 100%-safely-managed target leaves
# nothing for basic investment to aim at, so the investment split would only ever look harmful.
_WS_T1 = [0.66,0.34,0,0,0]
_WS_T2 = [0.75,0.25,0,0,0]
_SAN_START = [0.0288,0.97,0.0001,0.001,0.0001]
_SAN_BASE  = [0.07774752344348565,0.909252476556514,0.008,0.003,0.002]
_SAN_T1 = [0.66,0.34,0,0,0]
_SAN_T2 = [0.75,0.25,0,0,0]
_WS_COST_SM, _WS_COST_BASIC = 96878.0, 86875.59308914324
_SAN_COST_SM = 105050.23373368701


# ── Technology mixes (test2): two tables per sector — Safely-managed and Basic ────────────────
# WATER: the two rungs use DIFFERENT technologies. Safely-managed = on-premises improved sources
# (piped into dwelling, tubewell on own premises, …); basic = shared / communal or lower-spec supplies
# (piped to yard/neighbour, public tap, communal well, kiosk) — the JMP "capped at basic" pathway.
# SANITATION: the two rungs use the SAME technologies (the JMP service level is set by service
# attributes — sharing, emptying, treatment — not the hardware); they are still two tables so the costs
# can differ if wanted, and default equal. The per-technology costs are Kathmandu-Valley ESTIMATES (to
# be reviewed); each mix is then scaled so its share-weighted total hits the validated unit cost exactly,
# so this exhaustive breakdown leaves the BAU unchanged.
def _weighted(mix, key='cost'):
    return sum((t.get('share') or 0) * (t.get(key) or 0) for t in mix)


def _scale_single(mix, target):
    """Scale a single-cost technology mix so its share-weighted cost equals the validated unit cost
    exactly (the mix is a transparent, editable breakdown of the SAME cost — BAU output preserved)."""
    w = _weighted(mix)
    k = (target / w) if w else 1.0
    return [{**t, 'cost': t['cost'] * k} for t in mix]


# Water — Safely managed: on-premises improved sources.
_WS_SM_MIX = _scale_single([
    {'name': 'Piped into dwelling',                'share': 0.40, 'cost': 120000.0},
    {'name': 'Piped to yard/plot',                 'share': 0.15, 'cost':  95000.0},
    {'name': 'Tubewell/borehole on own premises',  'share': 0.20, 'cost':  70000.0},
    {'name': 'Protected dug well on own premises', 'share': 0.08, 'cost':  55000.0},
    {'name': 'Rainwater collection (cistern/tank)','share': 0.02, 'cost':  60000.0},
    {'name': 'Bottled water',                      'share': 0.03, 'cost':  90000.0},
    {'name': 'Sachet water',                       'share': 0.02, 'cost':  85000.0},
    {'name': 'Wholesale vendor / tanker water',    'share': 0.10, 'cost': 100000.0},
], _WS_COST_SM)

# Water — Basic: shared / communal or lower-spec supplies (JMP "capped at basic").
_WS_BASIC_MIX = _scale_single([
    {'name': 'Piped to yard/plot',                 'share': 0.45, 'cost':  92000.0},
    {'name': 'Piped to neighbour',                 'share': 0.22, 'cost':  85000.0},
    {'name': 'Tubewell/borehole on own premises',  'share': 0.15, 'cost':  75000.0},
    {'name': 'Public tap / standpipe',             'share': 0.10, 'cost':  62000.0},
    {'name': 'Communal protected well / kiosk',    'share': 0.08, 'cost':  50000.0},
], _WS_COST_BASIC)

# Sanitation — SAME technology list for both rungs (networked + improved on-site). Default costs equal;
# the service-level difference is attribute-driven (sharing / emptying / treatment), not technological.
_SAN_MIX_BASE = [
    {'name': 'Flush/pour-flush to piped sewer',            'share': 0.15, 'cost': 170000.0},
    {'name': 'Flush/pour-flush to septic tank',            'share': 0.55, 'cost': 113000.0},
    {'name': 'Flush/pour-flush to pit latrine',            'share': 0.10, 'cost':  70000.0},
    {'name': 'Ventilated improved pit (VIP) latrine',      'share': 0.05, 'cost':  60000.0},
    {'name': 'Pit latrine with slab / covered',            'share': 0.10, 'cost':  40000.0},
    {'name': 'Composting toilet (incl. twin-pit)',         'share': 0.03, 'cost':  55000.0},
    {'name': 'Other improved on-site (e.g. biogas-attached)','share': 0.02, 'cost': 90000.0},
]
_SAN_SM_MIX = _scale_single([dict(t) for t in _SAN_MIX_BASE], _SAN_COST_SM)
_SAN_BASIC_MIX = _scale_single([dict(t) for t in _SAN_MIX_BASE], _SAN_COST_SM)
_WS_BUDGET_PCT, _SAN_BUDGET_PCT = 0.0016496186144332283, 0.0004  # san %GDP = final.xlsx G331
# GDP-derived real budget 2011-2030 (real GDP x %GDP) — the seamless direct-entry default.
_WS_BUDGET_DIRECT = [6499.543652769706, 6878.455752682857, 7004.910275298227, 6869.917578680842, 7181.824137317749, 6890.668861747498, 7551.61681596089, 8706.00809507662, 8846.447991197832, 8582.986824519227, 9127.766789271474, 10171.857267441954, 9858.69894610241, 10058.228475636557, 10363.749934479772, 10884.000000000005, 11701.58672000642, 12559.776877555345, 13475.800452242762, 14451.860633584014]
# Sanitation direct-entry default = real GDP × sanitation %GDP, DERIVED from the water series (real GDP =
# _WS_BUDGET_DIRECT ÷ _WS_BUDGET_PCT) so it stays consistent with %GDP mode when _SAN_BUDGET_PCT changes.
_SAN_BUDGET_DIRECT = [g * (_SAN_BUDGET_PCT / _WS_BUDGET_PCT) for g in _WS_BUDGET_DIRECT]
# test2: REAL GDP in local currency (millions) — the primary macro input. Derived from the water
# budget series (real GDP = budget ÷ %GDP) so it stays consistent with the historical budget.
_GDP_REAL_LOCAL = [round(g / _WS_BUDGET_PCT, 3) for g in _WS_BUDGET_DIRECT]
_START_YR, _BASE_YR, _END_YR = 2011, 2025, 2040
_NYEARS = _END_YR - _START_YR + 1                       # 30
_BASE_IDX = _BASE_YR - _START_YR                        # 14


def _svc_series(start, base):
    """A per-year service-share series the UI can show: linear start→baseline over history, then BLANK
    (0) over the forecast — test2: forecast service cells are user-entered TARGETS, so they must start
    empty (a filled forecast column is what defines a target year). The engine still reads index 0
    (start) and the baseline index at FULL precision; only the display-only interpolated years between
    them are rounded."""
    out = []
    for i in range(_NYEARS):
        if i == 0:
            out.append(start)
        elif i == _BASE_IDX:
            out.append(base)
        elif i < _BASE_IDX:
            f = i / _BASE_IDX
            out.append(round(start * (1 - f) + base * f, 6))
        else:
            out.append(0.0)          # forecast year: blank until the user sets a target here
    return out


def _svc_with_targets(starts, bases, tgt_years_shares):
    """Build the 5 per-rung service series and stamp the default example TARGETS into their forecast
    columns. `tgt_years_shares` = list of (year, [5 shares]); each rung r gets series[year-idx]=share[r]."""
    series = [_svc_series(starts[r], bases[r]) for r in range(5)]
    for yr, shares in tgt_years_shares:
        idx = yr - _START_YR
        if 0 <= idx < _NYEARS:
            for r in range(5):
                series[r][idx] = shares[r]
    return series


def frontend_defaults() -> dict:
    """The frontend-shaped default inputs (what InputPanel.tsx reads), with validated values."""
    return {
        'country_config': {
            'country': 'Nepal', 'area': 'Kathmandu Valley', 'currency': 'NPR',
            'ws_serv1_name': 'Safely managed', 'ws_serv2_name': 'Basic', 'ws_serv3_name': 'Limited',
            'ws_serv4_name': 'Unimproved', 'ws_serv5_name': 'No service',
            'san_serv1_name': 'Safely managed', 'san_serv2_name': 'Basic', 'san_serv3_name': 'Limited',
            'san_serv4_name': 'Unimproved', 'san_serv5_name': 'No service',
            'provider1_name': 'Provider 1', 'provider2_name': 'Provider 2',
        },
        'period': {
            'model_start_year': _START_YR, 'baseline_year': _BASE_YR, 'forecast_end_year': _END_YR,
            'perf_improvement_start_year': 2028, 'target1_year': 2030, 'target2_year': 2040,
            'as_is_forecast_start': 2026, 'as_is_forecast_length': 2,
        },
        'macro': {
            'ws_budget_pct_gdp': _WS_BUDGET_PCT, 'san_budget_pct_gdp': _SAN_BUDGET_PCT,
            'capex_pct_budget': 0.21,
            # Per-sector capex share of budget — water and sanitation differ in the workbook
            # (excel2 I|General Urban: water G321 = 21%, sanitation G328 = 15%).
            'ws_capex_pct': 0.21, 'san_capex_pct': 0.15,
            'execution_rate': 1.0,
            # test2: budget is derived from the cost of new connections (see 'bau' below); real GDP in
            # local currency is entered directly (no nominal-USD / inflation / FX chain needed).
            'budget_input_mode': 'from_cost', 'budget_source': 'from_cost',
            'gdp_real_local': list(_GDP_REAL_LOCAL),         # real GDP, local M — hard values; tail auto-fills
            # legacy nominal-USD chain kept for the Test Harness only (ignored once real GDP is present):
            'gdp_nominal_usd': _GDP_USD,
            'inflation_nepal': _INFL_LOCAL, 'inflation_us': _INFL_US, 'exchange_rate': _FX,
            'inflation_local_ongoing': 0.05, 'inflation_us_ongoing': 0.022,
            'gdp_growth_forecast': 0.05, 'real_price_year': 2025,
        },
        'population': {'pop_ts': _POP, 'hh_ts': _HH,
                       'total_pop_start': _POP[0], 'total_hh_start': _HH[0],
                       'total_pop_baseline': None, 'total_hh_baseline': None},
        'water_service': {f'serv{i+1}_ts': s for i, s in enumerate(
            _svc_with_targets(_WS_START, _WS_BASE, [(2030, _WS_T1), (2040, _WS_T2)]))},
        'sanitation_service': {f'sserv{i+1}_ts': s for i, s in enumerate(
            _svc_with_targets(_SAN_START, _SAN_BASE, [(2030, _SAN_T1), (2040, _SAN_T2)]))},
        'water_targets': {**{f'target1_serv{i+1}': _WS_T1[i] for i in range(5)},
                          **{f'target2_serv{i+1}': _WS_T2[i] for i in range(5)},
                          'providers': []},
        'sanitation_targets': {**{f'target1_sserv{i+1}': _SAN_T1[i] for i in range(5)},
                               **{f'target2_sserv{i+1}': _SAN_T2[i] for i in range(5)}},
        'water_costs': {'network_cost_per_hh_serv1': _weighted(_WS_SM_MIX),
                        'network_cost_per_hh_serv2': _weighted(_WS_BASIC_MIX),
                        # test2: technology costs are entered as NOMINAL prices for a given year; the
                        # real price = nominal × price_index/100. Index defaults to 100 (real = nominal).
                        'price_index_year': _BASE_YR, 'price_index': 100.0,
                        # Two technology mixes — water SM and basic use DIFFERENT technologies. Each mix's
                        # weighted Σ(share×cost) is written through to its serv1/serv2 unit-cost field.
                        'sm_tech_mix': [dict(t) for t in _WS_SM_MIX],
                        'basic_tech_mix': [dict(t) for t in _WS_BASIC_MIX]},
        'sanitation_costs': {'sewer_cost_per_hh_sserv1': _weighted(_SAN_SM_MIX),
                             'sewer_cost_per_hh_sserv2': _weighted(_SAN_BASIC_MIX),
                             'price_index_year': _BASE_YR, 'price_index': 100.0,
                             # Two tables sharing the SAME technologies (service level is attribute-driven).
                             'sm_tech_mix': [dict(t) for t in _SAN_SM_MIX],
                             'basic_tech_mix': [dict(t) for t in _SAN_BASIC_MIX]},
        'bau': {'budget_input_mode': 'from_cost', 'budget_source': 'from_cost',
                # test2: budget is computed from the cost of new connections (historical) and the mean
                # historical budget/GDP ratio × real GDP (forecast). These override series start EMPTY —
                # the engine fills them; any value the user types here overrides that year.
                'ws_budget_ts': [], 'san_budget_ts': [], 'ws_expend_ts': [], 'san_expend_ts': [],
                # ALLOCATED capital budget (manual input, larger than the budget-in-the-works). Seeded with
                # explicit historical values (index 0 = model start year) implying ~77% budget execution
                # (budget-in-the-works ÷ allocated), with lower-execution dips in 2016 & 2020. Forecast years
                # are left blank → the engine fills them at mean(allocated ÷ used) × the used forecast.
                # Blank years (or a blank tail) fall back to used ÷ 0.8. Regenerate via scratchpad/seed_alloc.py.
                'ws_alloc_ts': [0, 2194, 2230, 2267, 2306, 2409, 2417, 2459, 2502, 2682, 2624, 2671, 2718, 2734, 2784],
                'san_alloc_ts': [0, 2732, 2777, 2824, 2872, 3000, 3010, 3062, 3116, 3340, 3268, 3327, 3386, 3406, 3469],
                'ws_budget_ongoing': 0.05, 'san_budget_ongoing': 0.05},
        'technical': {'ws_asset_life': 30, 'ws_non_hh_pct': 0.10,
                      'san_asset_life': 30, 'san_non_hh_pct': 0.10},
        'water_interventions': _default_ws_intervention(),
        'sanitation_interventions': _default_san_intervention(),
        # ws_capital_efficiency_enabled / san_capital_efficiency_enabled key the single "Budget execution
        # improvement" lever (used ÷ allocated → target); the old separate *_budget_execution_enabled stubs
        # were removed. Internal key name kept to avoid touching the validated engine wiring.
        'toggles': {k: False for k in [
            'ws_collection_efficiency_enabled','ws_nrw_enabled','ws_capital_efficiency_enabled','ws_tariff_enabled',
            'ws_microfinance_enabled','ws_costeff_enabled','ws_techmix_enabled',
            'ws_financial_commitment_enabled','ws_exogenous_injection_enabled',
            'san_collection_efficiency_enabled',
            'san_capital_efficiency_enabled','san_tariff_enabled','san_microfinance_enabled',
            'san_costeff_enabled','san_techmix_enabled','san_nrw_link_enabled',
            'san_financial_commitment_enabled','san_exogenous_injection_enabled']},
        # Income distribution (5 brackets) shared by both sectors' microfinance + means-based grant lever.
        'income_distribution': {'brackets': [dict(b) for b in _INCOME_BRACKETS_DEFAULT]},
        'custom_interventions': [],
        'utility_debt': {
            'schema_version': 1,
            'water': {
                'enabled': False, 'allocation_share': 0.0,
                'annual_real_interest_rate': None, 'disbursement_year': _BASE_YR + 1,
                'principal_grace_years': 0, 'maturity_year': _END_YR,
                'repayment_structure': 'annuity', 'loan_ceiling': None,
            },
            'sanitation': {
                'enabled': False, 'allocation_share': 0.0,
                'annual_real_interest_rate': None, 'disbursement_year': _BASE_YR + 1,
                'principal_grace_years': 0, 'maturity_year': _END_YR,
                'repayment_structure': 'annuity', 'loan_ceiling': None,
            },
        },
    }


# Microfinance + means-based grant lever defaults, shared by both sectors (see WaterInterventionInputs).
def _afford_defaults():
    return {'mf_connection_fee':0.0,   # 0 → the engine uses the SM new-service cost (cost_sm)
            'mf_start_year':2028,'mf_end_year':2040,'mf_pct_income':0.05,'mf_interest_rate':0.10,'mf_tenor':10,
            'mf_partial_share':0.0,'mf_upfront_payable_ratio':0.0,'mf_takeup_rate':0.5,
            'mf_gap_shares':list(_GAP_SHARES_DEFAULT),'mf_selffinance_share':0.10,'grant_total':0.0}


def _default_ws_intervention():
    return {'fin_gdp_enabled':False,'fin_gdp_start_year':2026,'fin_gdp_target_share':0.0,
            'fin_growth_enabled':False,'fin_growth_rate':0.0,'fin_growth_start_year':2026,'fin_growth_end_year':2040,
            'fin_injection_enabled':False,'fin_injection_mode':'one_time','fin_injection_amount':0.0,
            'fin_injection_start_year':2026,'fin_injection_end_year':2040,
            'ce_start_year':2026,'ce_target_year':2035,'ce_current_ratio':0.90,'ce_target_ratio':0.95,
            'ce_water_sold_mld':87.6,'ce_current_tariff':32.0,
            'nrw_start_year':2026,'nrw_target_year':2035,'nrw_current_pct':0.40,'nrw_target_pct':0.25,
            'nrw_treatment_cost_pct_capex':0.40,
            'nrw_commercial_loss_pct':0.5,'nrw_physical_loss_pct':0.5,'nrw_capex_unit_cost_usd':500,'nrw_lag_years':1,
            'nrw_system_input_vol':146.0,'nrw_water_per_upgrade':100.0,'nrw_capex_unit_cost_local':73809.0,
            'nrw_value_basis':'tariff','nrw_tariff':32.0,'nrw_production_cost':20.0,
            'capeff_start_year':2026,'capeff_target_year':2035,'capeff_target_pct':1.0,'capeff_current_pct':0.0,'capeff_gains_pct':0.20,
            # Capex efficiency (unit-cost discount): 20% cheaper SM connections by the target year (0 at start).
            'costeff_start_year':2026,'costeff_target_year':2035,'costeff_current_pct':0.0,'costeff_target_pct':0.20,
            # Optimised technology selection: pre-fill the editor with the BAU SM mix (weighted = BAU cost, so
            # zero effect until the user re-weights it). techmix_sm_cost is derived from this mix in to_engine.
            'techmix_start_year':2026,'techmix_sm_tech_mix':[dict(t) for t in _WS_SM_MIX],
            'techmix_basic_tech_mix':[dict(t) for t in _WS_BASIC_MIX],
            # Investment split: share of new capital directed at BASIC service. 0 = all safely managed.
            'basic_share':0.0,
            'tariff_start_year':2026,'tariff_target_year':2035,'tariff_volume_mld':87.6,
            'tariff_current':32.0,'tariff_target':40.0,
            **_afford_defaults()}


def _default_san_intervention():
    return {'fin_gdp_enabled':False,'fin_gdp_start_year':2026,'fin_gdp_target_share':0.0,
            'fin_growth_enabled':False,'fin_growth_rate':0.0,'fin_growth_start_year':2026,'fin_growth_end_year':2040,
            'fin_injection_enabled':False,'fin_injection_mode':'one_time','fin_injection_amount':0.0,
            'fin_injection_start_year':2026,'fin_injection_end_year':2040,
            'ce_start_year':2026,'ce_target_year':2035,'ce_sewer_tariff_pct_water':0.5,
            'capeff_start_year':2026,'capeff_target_year':2035,'capeff_target_pct':1.0,'capeff_current_pct':0.0,'capeff_gains_pct':0.20,
            # Capex efficiency (unit-cost discount) + optimised technology selection (see water for the mechanic).
            'costeff_start_year':2026,'costeff_target_year':2035,'costeff_current_pct':0.0,'costeff_target_pct':0.20,
            'techmix_start_year':2026,'techmix_sm_tech_mix':[dict(t) for t in _SAN_SM_MIX],
            'techmix_basic_tech_mix':[dict(t) for t in _SAN_BASIC_MIX],
            'basic_share':0.0,
            # NRW-linked sanitation revenue: charge a (partly-collected) sewer fee on the water the water NRW
            # lever recovers, and spend it on SM sanitation connections.
            'nrw_link_return_ratio':0.80,'nrw_link_sewer_charge':16.0,'nrw_link_collection_rate':0.80,
            'tariff_start_year':2026,'tariff_target_year':2035,'tariff_volume_mld':43.8,
            'tariff_current':16.0,'tariff_target':24.0,
            **_afford_defaults()}


def _g(d, *path, default=None):
    for p in path:
        if not isinstance(d, dict):
            return default
        d = d.get(p)
    return d if d is not None else default


def _at(series, idx, default=0.0):
    return series[idx] if series and 0 <= idx < len(series) else default


def _targets_from_service(svc: dict, prefix: str, msy: int, baseline: int, end: int):
    """test2: derive the N-target list from the service-level table. A forecast year (baseline < year
    ≤ end) whose 5 rung shares are all present and sum to ~100% is a TARGET at that year."""
    arrs = [svc.get(f'{prefix}{i+1}_ts', []) or [] for i in range(5)]
    maxlen = max((len(a) for a in arrs), default=0)
    out = []
    for idx in range(maxlen):
        yr = msy + idx
        if yr <= baseline or yr > end:
            continue
        shares = [(arrs[r][idx] if idx < len(arrs[r]) else 0) or 0 for r in range(5)]
        s = sum(shares)
        if s > 0 and abs(s - 1.0) < 0.02:                # a fully-entered column (Σ≈100%) = a target
            out.append(TargetPoint(year=yr, shares=[float(x) for x in shares]))
    return out


def _real_cost(costs: dict, field: str, default: float) -> float:
    """test2: real unit cost = entered NOMINAL cost × price_index/100 (index defaults to 100)."""
    nominal = costs.get(field, default)
    idx = costs.get('price_index', 100.0)
    if idx in (None, 0):
        idx = 100.0
    return float(nominal) * float(idx) / 100.0


def _techmix_cost(iv: dict, costs: dict, mix_key: str = 'techmix_sm_tech_mix') -> float:
    """test2 optimised-technology lever: the new REAL weighted SM connection cost from the intervention's
    edited technology mix (0 → no mix entered → keep the BAU cost). Weighted nominal Σ(share×cost) deflated
    by the SAME sector price_index as the BAU unit costs, so the engine's cost_factor (new ÷ BAU) is on a
    like-for-like real basis (the price index cancels)."""
    w = _weighted(iv.get(mix_key) or [])
    if w <= 0:
        return 0.0
    idx = costs.get('price_index', 100.0)
    if idx in (None, 0):
        idx = 100.0
    return float(w) * float(idx) / 100.0


def financial_toggles(inputs: dict) -> dict:
    """Return toggles with pre-split injection settings migrated before attribution or calculation."""
    tg = dict(inputs.get('toggles') or {})
    for prefix, section in [('ws', 'water_interventions'), ('san', 'sanitation_interventions')]:
        key = f'{prefix}_exogenous_injection_enabled'
        if key not in tg:
            tg[key] = bool(tg.get(f'{prefix}_financial_commitment_enabled') and
                           (inputs.get(section) or {}).get('fin_injection_enabled', False))
    return tg


class DataPreviewError(ValueError):
    """A data-only profile is not yet a calibrated simulation."""


def coerce_to_engine(inputs: dict) -> ModelInputs:
    """Accept EITHER shape and return a ModelInputs.

    The bau-test harness posts ENGINE-shaped inputs (wss_budget, water_costs.sm_technologies,
    water_service.pct_serv1_start, macro.inflation_local); the demo posts FRONTEND-shaped inputs
    (budget under macro.*, water_costs.network_cost_per_hh_*, water_service.serv1_ts,
    macro.inflation_nepal). Frontend markers are checked FIRST so demo-side additions (e.g. the
    tech-mix calculator fields) can never flip a demo payload into the engine path."""
    if (inputs.get('profile_metadata') or {}).get('status') == 'data_preview':
        raise DataPreviewError('This is a spreadsheet data preview. Supply unit costs, technical assumptions '
                         'and the remaining model settings before running a simulation or exporting results.')
    inputs = {**inputs, 'toggles': financial_toggles(inputs),
              'revenue_legacy': inputs.get('revenue_legacy') or {
                  key: inputs.get(key, {}) for key in ('water_interventions', 'sanitation_interventions')}}
    macro = inputs.get('macro') or {}
    ws = inputs.get('water_service') or {}
    if 'inflation_nepal' in macro or 'serv1_ts' in ws:
        return to_engine(inputs)                # frontend-shaped (demo) -> adapt
    wc = inputs.get('water_costs') or {}
    if 'wss_budget' in inputs or 'sm_technologies' in wc or 'technologies' in wc or 'pct_serv1_start' in ws:
        return ModelInputs(**inputs)            # engine-shaped (standalone harness)
    return to_engine(inputs)


def _afford_fields(d: dict) -> dict:
    """Microfinance + means-based grant fields for a (water|sanitation)_interventions dict → schema kwargs."""
    # null-safe per element: a cleared array cell serialises positionally to null → None; coerce to 0.0.
    gs = [float(x or 0.0) for x in (d.get('mf_gap_shares') or _GAP_SHARES_DEFAULT)]
    return dict(
        mf_connection_fee=float(d.get('mf_connection_fee', 0.0) or 0.0),
        mf_start_year=int(d.get('mf_start_year', 0) or 0),
        mf_end_year=int(d.get('mf_end_year', 0) or 0),
        mf_pct_income=float(d.get('mf_pct_income', 0.0) or 0.0),
        mf_interest_rate=float(d.get('mf_interest_rate', 0.0) or 0.0),
        mf_tenor=int(d.get('mf_tenor', 0) or 0),
        mf_partial_share=float(d.get('mf_partial_share', 0.0) or 0.0),
        mf_upfront_payable_ratio=float(d.get('mf_upfront_payable_ratio', 0.0) or 0.0),
        mf_takeup_rate=float(d.get('mf_takeup_rate', 0.0) or 0.0),
        mf_gap_shares=gs,
        mf_selffinance_share=float(d.get('mf_selffinance_share', 0.0) or 0.0),
        grant_total=float(d.get('grant_total', 0.0) or 0.0),
    )


def _financial_fields(d: dict) -> dict:
    """Frontend commitment and separately switched injection settings shared by both sectors."""
    return dict(
        fin_gdp_enabled=bool(d.get('fin_gdp_enabled', False)),
        fin_gdp_start_year=int(d.get('fin_gdp_start_year', 0) or 0),
        fin_gdp_target_share=max(0.0, float(d.get('fin_gdp_target_share', 0.0) or 0.0)),
        fin_growth_enabled=bool(d.get('fin_growth_enabled', False)),
        fin_growth_rate=max(0.0, float(d.get('fin_growth_rate', 0.0) or 0.0)),
        fin_growth_start_year=int(d.get('fin_growth_start_year', 0) or 0),
        fin_growth_end_year=int(d.get('fin_growth_end_year', 0) or 0),
        fin_injection_enabled=bool(d.get('fin_injection_enabled', False)),
        fin_injection_mode=('recurring' if d.get('fin_injection_mode') == 'recurring' else 'one_time'),
        fin_injection_amount=max(0.0, float(d.get('fin_injection_amount', 0.0) or 0.0)),
        fin_injection_start_year=int(d.get('fin_injection_start_year', 0) or 0),
        fin_injection_end_year=int(d.get('fin_injection_end_year', 0) or 0),
    )


def _income_distribution(fe: dict) -> IncomeDistribution:
    """Build the 5-bracket income distribution from the frontend payload (fallback = the default quintiles)."""
    brackets_in = (fe.get('income_distribution') or {}).get('brackets') or _INCOME_BRACKETS_DEFAULT
    return IncomeDistribution(brackets=[
        IncomeBracket(income_monthly=float(b.get('income_monthly', 0.0) or 0.0),
                      hh_share=float(b.get('hh_share', 0.0) or 0.0))
        for b in brackets_in])


def to_engine(fe: dict) -> ModelInputs:
    """Translate the frontend-shaped inputs into a ModelInputs for the validated engine (BAU)."""
    per = fe.get('period', {})
    msy = per.get('model_start_year', _START_YR)
    bi = int(per.get('baseline_year', _BASE_YR) - msy)
    macro = fe.get('macro', {})

    period = PeriodInputs(
        model_start_year=msy, baseline_year=per.get('baseline_year', _BASE_YR),
        forecast_end_year=per.get('forecast_end_year', _END_YR),
        as_is_forecast_start=per.get('as_is_forecast_start', per.get('baseline_year', _BASE_YR) + 1),
        as_is_forecast_length=per.get('as_is_forecast_length', 2),
        target1_year=per.get('target1_year', 2030), target2_year=per.get('target2_year', 2040),
    )

    m = MacroInputs(
        gdp_real_local=macro.get('gdp_real_local', []),      # test2: real GDP local — the primary input
        gdp_nominal_usd=macro.get('gdp_nominal_usd', []),
        gdp_growth_forecast=macro.get('gdp_growth_forecast', 0.05),
        inflation_local=macro.get('inflation_nepal', macro.get('inflation_local', [])),
        inflation_local_ongoing=macro.get('inflation_local_ongoing', 0.05),
        inflation_us=macro.get('inflation_us', []),
        inflation_us_ongoing=macro.get('inflation_us_ongoing', 0.022),
        exchange_rate=macro.get('exchange_rate', []),
    )

    pop = fe.get('population', {})
    population = PopulationInputs(pop_ts=pop.get('pop_ts', []), hh_ts=pop.get('hh_ts', []))

    wsv = fe.get('water_service', {})
    ws_serv = WaterServiceLevelInputs(**{
        **{f'pct_serv{i+1}_start': _at(wsv.get(f'serv{i+1}_ts', []), 0) for i in range(5)},
        **{f'pct_serv{i+1}_baseline': _at(wsv.get(f'serv{i+1}_ts', []), bi) for i in range(5)},
        # test2: forward the FULL per-rung historical series + the per-sector BAU first year (a YEAR).
        **{f'serv{i+1}_ts': list(wsv.get(f'serv{i+1}_ts', []) or []) for i in range(5)},
        'bau_first_year': int(wsv.get('bau_first_year', 0) or 0),
    })
    ssv = fe.get('sanitation_service', {})
    san_serv = SanitationServiceLevelInputs(**{
        **{f'pct_sserv{i+1}_start': _at(ssv.get(f'sserv{i+1}_ts', []), 0) for i in range(5)},
        **{f'pct_sserv{i+1}_baseline': _at(ssv.get(f'sserv{i+1}_ts', []), bi) for i in range(5)},
        **{f'sserv{i+1}_ts': list(ssv.get(f'sserv{i+1}_ts', []) or []) for i in range(5)},
        'bau_first_year': int(ssv.get('bau_first_year', 0) or 0),
    })

    end_yr = per.get('forecast_end_year', _END_YR)
    base_yr = per.get('baseline_year', _BASE_YR)
    wt = fe.get('water_targets', {})
    ws_tgt = WaterTargetInputs(
        targets=_targets_from_service(wsv, 'serv', msy, base_yr, end_yr),
        **{k: wt.get(k, 0.0) for k in [f'target1_serv{i+1}' for i in range(5)] + [f'target2_serv{i+1}' for i in range(5)]})
    st = fe.get('sanitation_targets', {})
    san_tgt = SanitationTargetInputs(
        targets=_targets_from_service(ssv, 'sserv', msy, base_yr, end_yr),
        **{k: st.get(k, 0.0) for k in [f'target1_sserv{i+1}' for i in range(5)] + [f'target2_sserv{i+1}' for i in range(5)]})

    # Unit costs: entered as NOMINAL prices; real = nominal × price_index/100 (test2). The weighted
    # SM / Basic cost the engine consumes is deflated here.
    wc = fe.get('water_costs', {})
    ws_costs = WaterUnitCosts(
        sm_technologies=[Tech(name='Weighted', share=1.0, cost=_real_cost(wc, 'network_cost_per_hh_serv1', _WS_COST_SM))],
        basic_technologies=[Tech(name='Weighted', share=1.0, cost=_real_cost(wc, 'network_cost_per_hh_serv2', _WS_COST_BASIC))])
    sc = fe.get('sanitation_costs', {})
    san_costs = SanitationUnitCosts(
        sm_technologies=[Tech(name='Weighted', share=1.0, cost=_real_cost(sc, 'sewer_cost_per_hh_sserv1', _SAN_COST_SM))],
        basic_technologies=[Tech(name='Weighted', share=1.0, cost=_real_cost(sc, 'sewer_cost_per_hh_sserv2', _SAN_COST_SM))])

    # planned investments: sum the frontend's investment periods into a single bucket each sector
    periods = _g(fe, 'bau', 'investment_periods', default=[]) or []
    ws_planned = [round(sum(float(p.get('ws_inv', 0) or 0) for p in periods), 4)] or [0.0]
    san_planned = [round(sum(float(p.get('san_inv', 0) or 0) for p in periods), 4)] or [0.0]
    planned = PlannedInvestmentInputs(ws_planned=ws_planned, san_planned=san_planned)

    tech = fe.get('technical', {})
    technical = TechnicalInputs(
        ws_asset_life=int(tech.get('ws_asset_life', 30)), ws_non_hh_pct=tech.get('ws_non_hh_pct', 0.10),
        san_asset_life=int(tech.get('san_asset_life', 30)), san_non_hh_pct=tech.get('san_non_hh_pct', 0.10),
    )
    bau = fe.get('bau', {}) or {}
    budget = WSSBudgetInputs(
        ws_budget_pct_gdp=macro.get('ws_budget_pct_gdp', _WS_BUDGET_PCT),
        san_budget_pct_gdp=macro.get('san_budget_pct_gdp', _SAN_BUDGET_PCT),
        capex_pct_budget=macro.get('capex_pct_budget', 0.21),
        # Per-sector capex share; None -> engine falls back to capex_pct_budget (legacy payloads).
        ws_capex_pct=macro.get('ws_capex_pct'),
        san_capex_pct=macro.get('san_capex_pct'),
        # Shared budget execution rate (%GDP mode): actual capex = allocated × this. Default 1.0.
        execution_rate=macro.get('execution_rate', 1.0),
        # direct-entry budget: 'actual expenditure' series drives the model (real terms, full budget)
        budget_input_mode=macro.get('budget_input_mode', bau.get('budget_input_mode', 'pct_gdp')),
        # test2 budget source: 'pct_gdp' | 'direct' | 'from_cost' (historical from connection cost)
        budget_source=macro.get('budget_source', bau.get('budget_source',
                                 macro.get('budget_input_mode', bau.get('budget_input_mode', 'pct_gdp')))),
        ws_budget_direct=bau.get('ws_expend_ts', []) or [],
        san_budget_direct=bau.get('san_expend_ts', []) or [],
        ws_budget_direct_ongoing=bau.get('ws_budget_ongoing', 0.05),
        san_budget_direct_ongoing=bau.get('san_budget_ongoing', 0.05),
        # ALLOCATED capital budget overrides (manual input, ≥ used); blank → engine default (used ÷ 0.8).
        ws_budget_allocated=bau.get('ws_alloc_ts', []) or [],
        san_budget_allocated=bau.get('san_alloc_ts', []) or [],
    )
    # NRW factors (feed the 4d capex adder; sanitation reads the same water cells)
    wi = fe.get('water_interventions', {}) or {}
    ws_intv = WaterInterventionInputs(
        **_financial_fields(wi),
        # null-safe: a cleared cell serialises to JSON null (dict.get returns None), so guard with `or default`.
        nrw_treatment_cost_pct_capex=float(wi.get('nrw_treatment_cost_pct_capex', 0.40) or 0.40),
        nrw_current_pct=float(wi.get('nrw_current_pct', 0.40) or 0.40),
        nrw_target_pct=float(wi.get('nrw_target_pct', 0.15) or 0.15),
        nrw_physical_loss_pct=float(wi.get('nrw_physical_loss_pct', 0.50) or 0.50),
        nrw_start_year=int(wi.get('nrw_start_year', 0) or 0),
        nrw_target_year=int(wi.get('nrw_target_year', 0) or 0),
        # Benefit lag (years): delay between the works/spend and the recovered water showing up. A cleared
        # field (null) → 0 (no lag); absent (old profile) → the schema default. 0 is a legitimate value.
        nrw_lag_years=int(wi.get('nrw_lag_years', 1) or 0),
        # NRW reduction lever (simplified): recovered physical water → basic→SM upgrades + a money ledger.
        nrw_system_input_vol=float(wi.get('nrw_system_input_vol', 0.0) or 0.0),
        # Blank/absent → None (scale with population); a number → fixed compound growth.
        nrw_vol_growth=(float(wi['nrw_vol_growth']) if wi.get('nrw_vol_growth') not in (None, '') else None),
        nrw_water_per_upgrade=float(wi.get('nrw_water_per_upgrade', 0.0) or 0.0),
        nrw_capex_unit_cost_local=float(wi.get('nrw_capex_unit_cost_local', 0.0) or 0.0),
        nrw_value_basis=(wi.get('nrw_value_basis') or 'tariff'),
        nrw_tariff=float(wi.get('nrw_tariff', 0.0) or 0.0),
        nrw_production_cost=float(wi.get('nrw_production_cost', 0.0) or 0.0),
        # Collection efficiency: collected-ratio ramp + billed volume (MLD) + tariff (price per m³).
        ce_start_year=int(wi.get('ce_start_year', 2028) or 0),
        ce_target_year=int(wi.get('ce_target_year', 0) or 0),
        ce_current_ratio=float(wi.get('ce_current_ratio', 0.0) or 0.0),
        ce_target_ratio=float(wi.get('ce_target_ratio', 0.0) or 0.0),
        ce_water_sold_mld=float(wi.get('ce_water_sold_mld', 0.0) or 0.0),
        ce_current_tariff=float(wi.get('ce_current_tariff', 0.0) or 0.0),
        # Volume growth: blank/absent → None (scale with population); a number → fixed compound growth.
        ce_vol_growth=(float(wi['ce_vol_growth']) if wi.get('ce_vol_growth') not in (None, '') else None),
        capeff_start_year=int(wi.get('capeff_start_year', 2027) or 2027),
        capeff_gains_pct=float(wi.get('capeff_gains_pct', 0.20) or 0.20),
        # test2 capex-efficiency (budget used ÷ budget): ramp baseline → target over start→target year.
        capeff_target_year=int(wi.get('capeff_target_year', 0) or 0),
        capeff_target_pct=float(wi.get('capeff_target_pct', 1.0) or 1.0),
        capeff_current_pct=float(wi.get('capeff_current_pct', 0.0) or 0.0),
        # Capex efficiency (unit-cost discount) — ramp the discount up from BAU (DISTINCT from capeff above).
        costeff_start_year=int(wi.get('costeff_start_year', 0) or 0),
        costeff_target_year=int(wi.get('costeff_target_year', 0) or 0),
        costeff_current_pct=float(wi.get('costeff_current_pct', 0.0) or 0.0),
        costeff_target_pct=float(wi.get('costeff_target_pct', 0.0) or 0.0),
        # Optimised technology selection — new real weighted SM cost from the edited mix (0 → keep BAU).
        techmix_start_year=int(wi.get('techmix_start_year', 0) or 0),
        techmix_sm_cost=_techmix_cost(wi, fe.get('water_costs', {}) or {}),
        techmix_basic_cost=_techmix_cost(wi, fe.get('water_costs', {}) or {}, 'techmix_basic_tech_mix'),
        basic_share=float(wi.get('basic_share', 0.0) or 0.0),
        # Tariff reform (simplified): start/target year, volume (MLD), current & target tariff.
        tariff_start_year=int(wi.get('tariff_start_year', 0) or 0),
        tariff_target_year=int(wi.get('tariff_target_year', 0) or 0),
        tariff_volume_mld=float(wi.get('tariff_volume_mld', 0.0) or 0.0),
        tariff_current=float(wi.get('tariff_current', 0.0) or 0.0),
        tariff_target=float(wi.get('tariff_target', 0.0) or 0.0),
        # Microfinance + means-based grant (affordability lever).
        **_afford_fields(wi),
    )
    si = fe.get('sanitation_interventions', {}) or {}
    san_intv = SanitationInterventionInputs(
        ce_current_ratio=si.get('ce_current_ratio'),
        ce_target_ratio=si.get('ce_target_ratio'),
        **_financial_fields(si),
        # Collection efficiency (sanitation): own start/target years + wastewater-collected% + sewer-tariff%
        # (collected ratios and billed volume are inherited from water_interventions in the engine).
        ce_start_year=int(si.get('ce_start_year', 2027) or 0),
        ce_target_year=int(si.get('ce_target_year', 0) or 0),
        ce_wastewater_collected_pct=float(si.get('ce_wastewater_collected_pct', 0.80) or 0.0),
        ce_sewer_tariff_pct_water=float(si.get('ce_sewer_tariff_pct_water', 0.0) or 0.0),
        capeff_start_year=int(si.get('capeff_start_year', 2027) or 2027),
        capeff_gains_pct=float(si.get('capeff_gains_pct', 0.20) or 0.20),
        capeff_target_year=int(si.get('capeff_target_year', 0) or 0),
        capeff_target_pct=float(si.get('capeff_target_pct', 1.0) or 1.0),
        capeff_current_pct=float(si.get('capeff_current_pct', 0.0) or 0.0),
        # Capex efficiency (unit-cost discount) + optimised technology selection (see water for the mechanic).
        costeff_start_year=int(si.get('costeff_start_year', 0) or 0),
        costeff_target_year=int(si.get('costeff_target_year', 0) or 0),
        costeff_current_pct=float(si.get('costeff_current_pct', 0.0) or 0.0),
        costeff_target_pct=float(si.get('costeff_target_pct', 0.0) or 0.0),
        techmix_start_year=int(si.get('techmix_start_year', 0) or 0),
        techmix_sm_cost=_techmix_cost(si, fe.get('sanitation_costs', {}) or {}),
        techmix_basic_cost=_techmix_cost(si, fe.get('sanitation_costs', {}) or {}, 'techmix_basic_tech_mix'),
        basic_share=float(si.get('basic_share', 0.0) or 0.0),
        # NRW-linked sanitation revenue: charge a partly-collected sewer fee on the water the water NRW lever recovers.
        nrw_link_return_ratio=float(si.get('nrw_link_return_ratio', 0.0) or 0.0),
        nrw_link_sewer_charge=float(si.get('nrw_link_sewer_charge', 0.0) or 0.0),
        nrw_link_collection_rate=float(si.get('nrw_link_collection_rate', 0.0) or 0.0),
        # Tariff reform (sanitation, simplified): start/target year, sewer volume, current & target tariff.
        tariff_start_year=int(si.get('tariff_start_year', 0) or 0),
        tariff_target_year=int(si.get('tariff_target_year', 0) or 0),
        tariff_volume_mld=float(si.get('tariff_volume_mld', 0.0) or 0.0),
        tariff_current=float(si.get('tariff_current', 0.0) or 0.0),
        tariff_target=float(si.get('tariff_target', 0.0) or 0.0),
        # Microfinance + means-based grant (affordability lever).
        **_afford_fields(si),
    )
    # Intervention toggles: forward the frontend's on/off flags (only keys the engine schema knows;
    # the two-pass compare sends all-off for the BAU baseline and the user's selection for the scenario).
    tg = financial_toggles(fe)
    # Some frontend toggle keys use a shorter alias than the engine field (the UI's "Collection efficiency"
    # historically keyed *_collection_enabled); map them onto the engine's *_collection_efficiency_enabled.
    _toggle_alias = {'ws_collection_enabled': 'ws_collection_efficiency_enabled',
                     'san_collection_enabled': 'san_collection_efficiency_enabled'}
    tg_mapped = {}
    for k, v in tg.items():
        k2 = _toggle_alias.get(k, k)
        if k2 in InterventionToggles.model_fields:
            tg_mapped[k2] = bool(v)
    toggles = InterventionToggles(**tg_mapped)

    return ModelInputs(
        revenue_bases=fe.get('revenue_bases', {}),
        revenue_legacy=fe.get('revenue_legacy') or {key: fe.get(key, {}) for key in ('water_interventions', 'sanitation_interventions')},
        country_config=CountryConfig(**{k: v for k, v in fe.get('country_config', {}).items()
                                        if k in CountryConfig.model_fields}),
        period=period, constants=Constants(), macro=m, population=population,
        water_service=ws_serv, sanitation_service=san_serv,
        water_targets=ws_tgt, sanitation_targets=san_tgt,
        water_costs=ws_costs, sanitation_costs=san_costs,
        planned_investments=planned, technical=technical,
        water_interventions=ws_intv, sanitation_interventions=san_intv,
        income_distribution=_income_distribution(fe),
        toggles=toggles,
        wss_budget=budget,
        # Custom interventions: forward only the fields the schema knows (extra UI fields are ignored); old
        # payloads whose type isn't new_revenue/cost_reduction simply have no effect in the engine.
        custom_interventions=[CustomIntervention(**{k: v for k, v in (c or {}).items() if k in CustomIntervention.model_fields})
                              for c in (fe.get('custom_interventions') or [])],
        utility_debt=UtilityDebtInputs(**(fe.get('utility_debt') or {})),
    )
