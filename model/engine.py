"""
Calculation engine entry point.

Builds the shared time axis and macro context from `ModelInputs`, then runs the
per-sector calculations. Currently implements the Water Supply sheet
(sections 4a-4d). Sanitation is analogous and not yet ported to the new schema.

All formulas are traced back to the Excel WS sheet; see `water_supply.py` for the
row-by-row mapping and the OPEN QUESTIONS / assumptions list.
"""

import numpy as np
from .inputs import ModelInputs, InterventionToggles
from .water_supply import calculate_water_supply
from .sanitation import calculate_sanitation
from .service_gaps import SERVICE_GAP_FIELDS


def _series(arr, n, default=0.0):
    """Coerce a list to a length-n float array; pad short series by holding the last value."""
    a = np.array(arr, dtype=float) if arr else np.array([], dtype=float)
    if len(a) >= n:
        return a[:n].astype(float)
    out = np.full(n, default, dtype=float)
    if len(a):
        out[:len(a)] = a
        out[len(a):] = a[-1]   # hold last known value forward
    return out


def _series_with_ongoing(arr, n, ongoing):
    """Hard values (historical + any forecast years with real data) followed by a fixed 'ongoing'
    rate that fills EVERY remaining forecast year. Used for inflation (local & US): the user enters
    the years they know plus one long-run assumption for the tail."""
    a = np.array(arr, dtype=float) if arr else np.array([], dtype=float)
    if len(a) >= n:
        return a[:n].astype(float)
    out = np.full(n, float(ongoing), dtype=float)
    if len(a):
        out[:len(a)] = a
    return out


def _zero_pad(arr, n):
    """GDP-USD hard values, zero-padded. Zero marks 'no direct data' so those forecast years are
    projected at the fixed real growth rate instead of read as input."""
    a = np.array(arr, dtype=float) if arr else np.array([], dtype=float)
    out = np.zeros(n, dtype=float)
    k = min(len(a), n)
    if k:
        out[:k] = a[:k]
    return out


def _project_fx(arr, local_infl, us_infl, n):
    """Exchange-rate series. If shorter than n, project forward by the inflation differential:
    FX[t] = FX[t-1] × (1 + local_inflation[t]) / (1 + US_inflation[t])  — the sheet's FX formula."""
    a = np.array(arr, dtype=float) if arr else np.array([], dtype=float)
    if len(a) >= n:
        return a[:n].astype(float)
    out = np.zeros(n, dtype=float)
    if len(a) == 0:
        return out
    out[:len(a)] = a
    for t in range(len(a), n):
        out[t] = out[t - 1] * (1.0 + local_infl[t]) / (1.0 + us_infl[t])
    return out


def _project_hh(arr, n):
    """Time series (households I!92 or population I!89), millions. If supplied full-length, used
    as-is. If shorter, the tail is projected forward by compounding the MEAN of the historical
    year-on-year growth rates (Excel: forward = last_actual * (1 + G)^k, G = AVERAGE of historical
    YoY growth — G93 for households, G90 for population)."""
    a = np.array(arr, dtype=float) if arr else np.array([], dtype=float)
    if len(a) >= n:
        return a[:n].astype(float)
    out = np.zeros(n, dtype=float)
    if len(a) == 0:
        return out
    out[:len(a)] = a
    yoy = [(a[i] / a[i - 1] - 1.0) for i in range(1, len(a)) if a[i - 1] > 0]
    g = float(np.mean(yoy)) if yoy else 0.0
    for t in range(len(a), n):
        out[t] = out[t - 1] * (1.0 + g)
    return out


def _project_series(arr, n, fallback_growth=0.0):
    """test2 projection rule: HONOUR user-entered values (historical AND forecast) and fill only the
    blanks (a value ≤ 0 or missing is 'blank'). Blanks are smoothed by the year-on-year growth rate:

      * INTERIOR blanks — those sitting between two entered values — are filled by GEOMETRIC
        interpolation: a constant year-on-year growth rate is solved between the nearest entered
        value before and the nearest entered value after, so the curve passes smoothly through both.
      * TRAILING blanks (past the last entered value) and any LEADING blanks (before the first)
        extrapolate at the MEAN historical growth (the average YoY of the leading contiguous run of
        entered values), since there is no later anchor to interpolate toward.

    Returns (series, mean_growth). The default Nepal payload supplies a contiguous historical run and
    nothing after it, so there are no interior gaps and the tail extrapolates at mean growth exactly
    as before — parity preserved."""
    a = np.array(arr, dtype=float) if arr else np.array([], dtype=float)
    out = np.zeros(n, dtype=float)
    k = min(len(a), n)
    out[:k] = a[:k]
    anchors = [t for t in range(n) if out[t] > 0]        # indices the user actually supplied
    known = []
    for t in range(n):                       # leading contiguous run of real (>0) values = 'historical'
        if out[t] > 0:
            known.append(out[t])
        else:
            break
    yoy = [known[i] / known[i - 1] - 1.0 for i in range(1, len(known)) if known[i - 1] > 0]
    g = float(np.mean(yoy)) if yoy else float(fallback_growth)
    if not anchors:
        return out, g
    # 1) interior gaps: geometric interpolation between each consecutive pair of anchors.
    for ai in range(len(anchors) - 1):
        lo, hi = anchors[ai], anchors[ai + 1]
        if hi - lo <= 1:
            continue
        v_lo, v_hi = out[lo], out[hi]
        r = (v_hi / v_lo) ** (1.0 / (hi - lo)) - 1.0 if v_lo > 0 and v_hi > 0 else g
        for j in range(1, hi - lo):
            out[lo + j] = v_lo * (1.0 + r) ** j
    # 2) trailing blanks after the last anchor → extrapolate forward at mean historical growth.
    for t in range(anchors[-1] + 1, n):
        out[t] = out[t - 1] * (1.0 + g)
    # 3) leading blanks before the first anchor → back-fill at mean historical growth.
    denom = 1.0 + g
    for t in range(anchors[0] - 1, -1, -1):
        out[t] = out[t + 1] / denom if denom != 0 else 0.0
    return out, g


def build_context(inputs: ModelInputs) -> dict:
    p = inputs.period
    c = inputs.constants
    years = np.arange(p.model_start_year, p.forecast_end_year + 1)
    n = len(years)
    bi = int(p.baseline_year - p.model_start_year)             # baseline index
    # test2: NO as-is lag. Performance improvement begins the year after the last year of historical
    # data (baseline). The former as-is forecast window is removed, so the target path branches
    # immediately at baseline + 1.
    end_asis_year = int(p.baseline_year)                       # = last historical year (kept for payload)
    perf_start_year = int(p.baseline_year) + 1

    # J7 (forecast years) and J8 (performance-improvement years) flags
    forecast_flag = (years > p.baseline_year).astype(float)
    perf_flag = (years >= perf_start_year).astype(float)

    # Households per year, IN MILLIONS (the model carries HH and money both in millions, with
    # per-HH costs in actual currency, so: HH-millions × cost = money-millions — matching the Excel).
    # ACTUALS run only through baseline-1; the BASELINE YEAR ITSELF IS A PROJECTION in the sheet
    # (I!92 baseline = prior×(1+G93)), so households/population are projected from the actuals at mean
    # historical growth from the baseline year onward. Supplied baseline/forecast values are ignored.
    # test2: households/population HONOUR any user-entered forecast values; blank forecast years fill
    # at mean historical growth. With the default payload (historical only) this matches the previous
    # `_project_hh(hh_ts[:bi])` behaviour exactly.
    total_hh, _ = _project_series(inputs.population.hh_ts, n)
    # Population (I!89, millions) projected at mean historical pop growth (G90); household SIZE (I!95)
    # is DERIVED for display only = population / households (both millions -> people per HH). Not used in 4a-4d.
    population, _ = _project_series(inputs.population.pop_ts, n)
    with np.errstate(divide='ignore', invalid='ignore'):
        hh_size = np.where(total_hh > 0, population / total_hh, 0.0)

    infl_local = _series_with_ongoing(inputs.macro.inflation_local, n, inputs.macro.inflation_local_ongoing)
    us_infl = _series_with_ongoing(inputs.macro.inflation_us, n, inputs.macro.inflation_us_ongoing)
    g_fcst = inputs.macro.gdp_growth_forecast   # fallback real growth if <2 historical points to average

    real_gdp_input = list(inputs.macro.gdp_real_local or [])
    if any((v or 0) > 0 for v in real_gdp_input):
        # ── test2 primary path: REAL GDP in local currency is entered directly. No nominal-USD / FX /
        #    deflation needed — user forecast values are honoured, blanks fill at mean historical growth. ──
        gdp_real, _ = _project_series(real_gdp_input, n, fallback_growth=g_fcst)
        gdp_nom = gdp_real.copy()          # nominal ≡ real (base-year prices); no inflation chain
        fx = np.ones(n)
        idx = np.full(n, 100.0)
        gdp_usd_proj = np.zeros(n)
    else:
        # ── Legacy path (no real-GDP series supplied, e.g. the Test Harness): derive real GDP from
        #    nominal USD × FX ÷ inflation index, exactly as before. ──
        rpy = int(np.clip(p.real_price_year - p.model_start_year, 0, n - 1))
        idx = np.zeros(n)
        idx[rpy] = 100.0
        for t in range(rpy - 1, -1, -1):
            idx[t] = idx[t + 1] / (1.0 + infl_local[t + 1])
        for t in range(rpy + 1, n):
            idx[t] = idx[t - 1] * (1.0 + infl_local[t])
        gdp_usd = _zero_pad(inputs.macro.gdp_nominal_usd, n)        # USD billion
        fx = _project_fx(inputs.macro.exchange_rate[:bi], infl_local, us_infl, n)  # local per 1 USD
        gdp_nom = np.zeros(n)
        for t in range(n):
            if gdp_usd[t] > 0:
                gdp_nom[t] = gdp_usd[t] * c.thousand * fx[t]        # USD bn*1000 = USD mn; *fx = local mn
            elif t > 0:
                gdp_nom[t] = gdp_nom[t - 1] * (1.0 + g_fcst) * (1.0 + infl_local[t])
        gdp_real = np.where(idx > 0, gdp_nom * 100.0 / idx, 0.0)    # real, base = real_price_year
        with np.errstate(divide='ignore', invalid='ignore'):
            gdp_usd_proj = np.where((fx > 0), gdp_nom / (c.thousand * fx), 0.0)

    return {
        'years': years, 'n': n, 'bi': bi,
        'end_asis_year': int(end_asis_year), 'perf_start_year': int(perf_start_year),
        'forecast_flag': forecast_flag, 'perf_flag': perf_flag,
        'total_hh': total_hh, 'population': population, 'hh_size': hh_size,
        'gdp_nominal_local': gdp_nom, 'gdp_real_local': gdp_real,
        'gdp_nominal_usd': gdp_usd_proj, 'exchange_rate': fx,
        'inflation_local': infl_local, 'inflation_us': us_infl,
        'inflation_index': idx,
    }


def _ui_aliases(sec):
    """Add the output keys the demo frontend / exporters expect, aliased to the engine's names.
    Keeps the UI and CSV/XLSX/PPTX exports working without a frontend rebuild."""
    sec['bau_hh_serv'] = sec['bau_hh']                 # [rung][year]; [0] = Safely managed
    sec['target_hh_serv'] = sec['target_hh']
    sec['service_gap'] = sec['household_gap']          # target SM - BAU SM (per year, floored at 0)
    sec['investment_need'] = sec['total_investment_need']
    sec['bau_investment'] = sec['bau_available']
    # 'financing_gap' already matches (pure BAU). 'adjusted_financing_gap' = the post-intervention gap
    # from the scenario pass, so downstream (Results) can compare BAU vs intervention.
    if 'scenario_financing_gap' in sec:
        sec['adjusted_financing_gap'] = sec['scenario_financing_gap']
    return sec


def _sector_with_scenario(calc_fn, bau_inputs, scn_inputs, ctx, any_toggle_on, bau_kwargs=None, scn_kwargs=None,
                          debt_config=None, debt_asset_life=30, reference_kwargs=None):
    """Run a sector's calculation as TWO independent passes and merge them.

    BAU pass (`bau_inputs`, every intervention toggle forced OFF) is the canonical business-as-usual
    counterfactual: its `bau_hh` / `target_hh` / `financing_gap` are what the BAU tab shows and CANNOT
    move when an intervention is toggled on or its parameters change. The SCENARIO pass (`scn_inputs`,
    the user's actual toggles) is a separate calculation; its safely-managed path and financing gap are
    attached under `scenario_*` for the intervention chart. When no toggle is on the scenario is, by
    definition, the BAU, so we skip the redundant second pass.

    `bau_kwargs` / `scn_kwargs` pass PER-PASS extra arguments to `calc_fn` (used to feed sanitation the
    water-NRW recovered volume: 0 in the BAU pass, the water scenario volume in the scenario pass)."""
    from model.utility_debt import solve_scenario, validate_config
    bau = calc_fn(bau_inputs, ctx, **(bau_kwargs or {}))
    cfg = validate_config(debt_config, ctx['years'], scn_inputs.period.baseline_year)
    reference = (bau if not any_toggle_on else
                 calc_fn(scn_inputs, ctx, **reference_kwargs) if reference_kwargs is not None else None)
    scn, _, debt_summary, scn_without_debt = solve_scenario(
        calc_fn, scn_inputs, ctx, cfg, calc_kwargs=scn_kwargs,
        asset_life=debt_asset_life, reference_result=reference,
        force_financed_run=reference_kwargs is not None and reference_kwargs != (scn_kwargs or {}))
    scn['utility_debt'] = debt_summary
    bau['scenario_hh'] = scn['bau_hh']                                  # SM path WITH interventions
    bau['scenario_financing_gap'] = scn['financing_gap']
    bau['scenario_total_investment_need'] = scn['total_investment_need']
    # Diagnostics are computed per pass/per geography, never from national net coverage.
    bau['scenario_target_hh'] = scn['target_hh']
    for key in SERVICE_GAP_FIELDS:
        bau['scenario_' + key] = scn[key]
    from model.expansion_ledger import ExpansionLedger
    for key in ExpansionLedger(0, 0, 0).series:
        bau['scenario_' + key] = scn[key]
    # The dashboard's scenario spending tables must use the scenario's own
    # obligations and allocation, not BAU need minus an intervention cash total.
    for key in ('new_capex_by_service', 'replacement_by_service',
                'funded_by_service', 'replacement_funding_applied_by_service', 'financing_gap_by_service',
                'new_capex_total', 'replacement_capex', 'available_total',
                'bau_replacement_capex', 'replacement_reserved', 'replacement_credit',
                'replacement_credit_by_service', 'unfunded_replacement',
                'cash_deficit', 'cash_deficit_by_service', 'expansion_capital_available',
                'connection_purchase_capital', 'unallocated_positive_capital'):
        bau['scenario_' + key] = scn[key]
    for key in (
        'eligible_additional_revenue', 'eligible_nrw_link_cash', 'custom_cash',
        'utility_debt_disbursement', 'utility_debt_principal_payment',
        'utility_debt_interest_payment', 'utility_debt_service',
        'utility_debt_cash_opening', 'utility_debt_cash_available',
        'utility_debt_investment_used', 'utility_debt_cash_closing',
    ):
        bau['scenario_' + key] = scn.get(key, [])
    bau['scenario_utility_debt'] = debt_summary
    bau['scenario_without_utility_debt_hh'] = scn_without_debt['bau_hh']
    bau['scenario_without_utility_debt_nrw_recovered_phys_vol'] = scn_without_debt.get('nrw_recovered_phys_vol', [])
    for key in SERVICE_GAP_FIELDS:
        bau['scenario_without_utility_debt_' + key] = scn_without_debt[key]
    bau['scenario_without_utility_debt_financing_gap'] = scn_without_debt['financing_gap']
    bau['scenario_without_utility_debt_endline_financing_requirement'] = scn_without_debt[
        'endline_financing_requirement']
    bau['scenario_collection_cash'] = scn['collection_cash']            # collection-efficiency revenue (scenario)
    bau['scenario_tariff_cash'] = scn['tariff_cash']                    # tariff-reform revenue (scenario)
    for key in ('billed_volume_million_m3', 'baseline_collected_revenue', 'collected_revenue', 'additional_collected_revenue'):
        bau['scenario_' + key] = scn[key]
    from model.connection_revenue import DIAGNOSTIC_FIELDS
    for key in ('connection_revenue', *DIAGNOSTIC_FIELDS):
        bau['scenario_' + key] = scn[key]
    bau['scenario_financial_commitment_cash'] = scn.get('financial_commitment_cash', [])
    bau['scenario_exogenous_injection_cash'] = scn.get('exogenous_injection_cash', [])
    bau['scenario_nrw_net'] = scn.get('nrw_net', [])                    # NRW money ledger (scenario)
    bau['scenario_nrw_upgrade_hh'] = scn.get('nrw_upgrade_hh', [])      # NRW basic→SM upgrades (scenario)
    bau['scenario_selffinance_upgrade_hh'] = scn.get('selffinance_upgrade_hh', [])  # self-financed connections (scenario)
    bau['scenario_mf_upgrade_hh'] = scn.get('mf_upgrade_hh', [])        # microfinance-alone SM connections (scenario)
    bau['scenario_grant_upgrade_hh'] = scn.get('grant_upgrade_hh', [])  # grant-enabled SM connections (scenario)
    bau['scenario_grant_spend'] = scn.get('grant_spend', [])            # means-based grant spend (scenario)
    bau['scenario_mf_loan_volume'] = scn.get('mf_loan_volume', [])      # microfinance loan volume mobilised (scenario)
    bau['scenario_nrw_recovered_phys_vol'] = scn.get('nrw_recovered_phys_vol', [])  # water: recovered physical vol (scenario)
    bau['scenario_nrw_link_cash'] = scn.get('nrw_link_cash', [])        # sanitation: water-NRW-linked sewer revenue (scenario)
    # The cost-side and budget-execution levers raise no cash, so the deck prices them off these two
    # instead. Both are already computed by the scenario pass — exposing them avoids re-deriving the
    # ramps in the export layer, where they would drift from the engine's own logic.
    #
    # `available_capex` is the effective capex reaching service (allocated budget × execution
    # efficiency). It must come from the SCENARIO pass: the top-level `bau_available` is the fixed BAU
    # counterfactual, identical in every cumulative pass, so a budget-execution lever measured against
    # it would always score zero.
    bau['scenario_available_capex'] = scn.get('bau_available', [])      # effective capex reaching service (scenario)
    bau['scenario_cost_sm_t'] = scn.get('cost_sm_t', [])                # effective SM unit cost per year (scenario)
    return _ui_aliases(bau)


def calculate(inputs: ModelInputs) -> dict:
    ctx = build_context(inputs)
    from model.utility_revenue import resolve_bases, RevenueInputError
    resolutions = resolve_bases(inputs, ctx)
    for sector, resolution in resolutions.items():
        if resolution['base'] is None:
            raise RevenueInputError(f'{sector.title()}: reconcile the shared billed-revenue base before calculating.')
    inputs = inputs.model_copy(update={'revenue_bases': {k: v['base'] for k, v in resolutions.items()}})
    # ── BAU and interventions are SEPARATE calculations. The business-as-usual path must be a fixed
    #    counterfactual, so the BAU pass forces every intervention toggle OFF; changing an intervention
    #    (e.g. capital efficiency, NRW) can then never move the BAU curve. The scenario pass applies the
    #    user's toggles and is returned alongside as scenario_* (see _sector_with_scenario). ──
    bau_toggles = inputs.toggles.model_copy(update={f: False for f in InterventionToggles.model_fields})
    # BAU pass also drops every custom intervention, so custom levers can't move the counterfactual either.
    bau_inputs = inputs.model_copy(update={'toggles': bau_toggles, 'custom_interventions': []})
    customs = getattr(inputs, 'custom_interventions', None) or []
    any_toggle_on = (any(getattr(inputs.toggles, f, False) for f in InterventionToggles.model_fields)
                     or any(getattr(c, 'enabled', False) for c in customs))
    # Water is computed FIRST (both passes) so sanitation can consume the physical water the water NRW lever
    # recovers. The recovered volume is 0 in the water BAU pass (NRW off) and the water scenario value in the
    # scenario pass; each is threaded into the MATCHING sanitation pass, so the sanitation BAU stays a pure
    # counterfactual (0 recovered) and only its scenario sees the water-NRW-linked sewer revenue.
    debt_inputs = getattr(inputs, 'utility_debt', None)
    water_debt = getattr(debt_inputs, 'water', None) if debt_inputs is not None else None
    sanitation_debt = getattr(debt_inputs, 'sanitation', None) if debt_inputs is not None else None
    water = _sector_with_scenario(
        calculate_water_supply, bau_inputs, inputs, ctx, any_toggle_on,
        debt_config=water_debt, debt_asset_life=inputs.technical.ws_asset_life)
    nrw_vol_bau = water.get('nrw_recovered_phys_vol', [])
    nrw_vol_scn = water.get('scenario_nrw_recovered_phys_vol', nrw_vol_bau)
    nrw_vol_reference = water['scenario_without_utility_debt_nrw_recovered_phys_vol']
    sanitation = _sector_with_scenario(
        calculate_sanitation, bau_inputs, inputs, ctx, any_toggle_on,
        bau_kwargs={'nrw_recovered_vol': nrw_vol_bau},
        scn_kwargs={'nrw_recovered_vol': nrw_vol_scn},
        reference_kwargs={'nrw_recovered_vol': nrw_vol_reference},
        debt_config=sanitation_debt, debt_asset_life=inputs.technical.san_asset_life)
    return {
        'years': ctx['years'].tolist(),
        'end_asis_year': ctx['end_asis_year'],
        'total_hh': ctx['total_hh'].tolist(),
        'population': ctx['population'].tolist(),
        'hh_size': ctx['hh_size'].tolist(),
        # Projected macro series (historical + forecast) so the input table can show the engine's
        # computed forecast-year values instead of placeholder markers.
        'gdp_nominal_usd': ctx['gdp_nominal_usd'].tolist(),
        'gdp_nominal_local': ctx['gdp_nominal_local'].tolist(),
        'gdp_real_local': ctx['gdp_real_local'].tolist(),
        'exchange_rate': ctx['exchange_rate'].tolist(),
        'inflation_local': ctx['inflation_local'].tolist(),
        'inflation_us': ctx['inflation_us'].tolist(),
        'water_supply': water,
        'sanitation': sanitation,
    }
