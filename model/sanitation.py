"""
Sanitation BAU — provisional.

Runs the sanitation inputs through the shared 4a-4d core (`water_supply.sector_bau`).
This already yields a sanitation BAU distinct from water (different service levels,
targets, costs, budget %, planned spend). The sanitation-specific divergences
(on-site / FSM / sewered, fecal-sludge treatment sizing, microfinance) are pending
the sanitation sheet spec — there is no NRW concept here, so the new-capex adder is 0.
"""

import numpy as np
from .water_supply import (sector_bau, sector_full_budget, cost_with_treatment, cost_no_treatment,
                           _target_points, build_cost_factor, custom_streams)


def calculate_sanitation(inputs, ctx, nrw_recovered_vol=None, utility_debt_execution=None):
    # `nrw_recovered_vol` (M m³/yr per year) is the PHYSICAL water the WATER NRW lever recovers, threaded in
    # by the engine: 0 in the sanitation BAU pass and when the water NRW lever is off, the water scenario
    # volume otherwise. The NRW-linked sanitation-revenue lever charges a (partly-collected) sewer fee on it.
    sl, st, sc = inputs.sanitation_service, inputs.sanitation_targets, inputs.sanitation_costs
    b = inputs.wss_budget
    src = getattr(b, 'budget_source', None) or b.budget_input_mode
    cost_sm = cost_with_treatment(sc)
    # Capex efficiency = budget used ÷ budget (execution). Baseline auto-computed in sector_bau; the
    # san_capital_efficiency_enabled toggle ramps it to capeff_target_pct over start → target year.
    si = inputs.sanitation_interventions
    tog = getattr(inputs, 'toggles', None)
    san_capeff_on = bool(getattr(tog, 'san_capital_efficiency_enabled', False)) if tog is not None else False
    san_ce_on = bool(getattr(tog, 'san_collection_efficiency_enabled', False)) if tog is not None else False
    san_tariff_on = bool(getattr(tog, 'san_tariff_enabled', False)) if tog is not None else False
    san_mf_on = bool(getattr(tog, 'san_microfinance_enabled', False)) if tog is not None else False
    san_financial_on = bool(getattr(tog, 'san_financial_commitment_enabled', False)) if tog is not None else False
    san_injection_on = bool(getattr(tog, 'san_exogenous_injection_enabled', False)) if tog is not None else False
    # Cost-side levers (test2): capex efficiency (unit-cost discount) + optimised technology selection →
    # per-year SM cost factor. Gated by their toggles, so the BAU pass keeps cost_factor = 1.0.
    san_costeff_on = bool(getattr(tog, 'san_costeff_enabled', False)) if tog is not None else False
    san_techmix_on = bool(getattr(tog, 'san_techmix_enabled', False)) if tog is not None else False
    cost_factor = build_cost_factor(
        ctx, inputs.period, cost_sm,
        costeff_on=san_costeff_on,
        costeff_start=int(getattr(si, 'costeff_start_year', 0) or 0),
        costeff_target_year=int(getattr(si, 'costeff_target_year', 0) or 0),
        costeff_current=float(getattr(si, 'costeff_current_pct', 0.0) or 0.0),
        costeff_target=float(getattr(si, 'costeff_target_pct', 0.0) or 0.0),
        techmix_on=san_techmix_on,
        techmix_start=int(getattr(si, 'techmix_start_year', 0) or 0),
        techmix_sm_cost=float(getattr(si, 'techmix_sm_cost', 0.0) or 0.0))
    # Basic rung's own cost factor: shared capex-efficiency discount, basic's own technology-mix step.
    cost_basic_base = cost_no_treatment(sc)
    cost_factor_basic = build_cost_factor(
        ctx, inputs.period, cost_basic_base,
        costeff_on=san_costeff_on,
        costeff_start=int(getattr(si, 'costeff_start_year', 0) or 0),
        costeff_target_year=int(getattr(si, 'costeff_target_year', 0) or 0),
        costeff_current=float(getattr(si, 'costeff_current_pct', 0.0) or 0.0),
        costeff_target=float(getattr(si, 'costeff_target_pct', 0.0) or 0.0),
        techmix_on=san_techmix_on,
        techmix_start=int(getattr(si, 'techmix_start_year', 0) or 0),
        techmix_sm_cost=float(getattr(si, 'techmix_basic_cost', 0.0) or 0.0))
    # NRW-linked sanitation revenue: recovered physical water → wastewater the sewer charges for. revenue
    # (LC millions/yr) = recovered_vol(M m³/yr) × return_ratio × sewer_charge(LC/m³) × collection_rate,
    # injected into sanitation capex (extra_cash) → more SM connections. Gated by san_nrw_link_enabled and,
    # implicitly, by the water NRW lever (recovered_vol is 0 when it is off — and in the BAU pass).
    san_nrw_link_on = bool(getattr(tog, 'san_nrw_link_enabled', False)) if tog is not None else False
    _n = ctx['n']
    _rv = np.asarray(nrw_recovered_vol, dtype=float) if nrw_recovered_vol is not None else np.zeros(_n)
    if _rv.shape[0] < _n:
        _rv = np.concatenate([_rv, np.zeros(_n - _rv.shape[0])])
    _rv = _rv[:_n]
    nrw_link_cash = np.zeros(_n)
    if san_nrw_link_on:
        _ret = float(getattr(si, 'nrw_link_return_ratio', 0.0) or 0.0)
        _charge = float(getattr(si, 'nrw_link_sewer_charge', 0.0) or 0.0)
        _coll = float(getattr(si, 'nrw_link_collection_rate', 0.0) or 0.0)
        nrw_link_cash = _rv * _ret * _charge * _coll
    # Custom interventions (sanitation + 'both'): new-revenue net cash adds to the sanitation capex on top
    # of the NRW-linked revenue; cost-reduction customs compose into the SM cost factor.
    cust_cash, cust_cf = custom_streams(ctx, inputs.period, cost_sm,
                                        getattr(inputs, 'custom_interventions', None) or [], 'sanitation')
    cost_factor = cost_factor * cust_cf
    extra_cash = nrw_link_cash + cust_cash
    bracket_income = [br.income_monthly for br in inputs.income_distribution.brackets]
    _mld_to_m3 = inputs.constants.days_in_year / inputs.constants.cubic_meter_liters
    # 4d adder (sheet r178 = gap*cost + G166*(treat%*NRW%*phys%)). Unlike water — which multiplies the
    # COST (r179 = ...+G168*factors ≈ 7,750) — sanitation multiplies G166 = I!G174 = the BASELINE SM
    # HOUSEHOLD COUNT (total_hh[baseline] × baseline SM %), so the adder is negligible (~0.006), NOT
    # cost-based. The factors (0.4×0.4×0.5=0.08) still read the water NRW cells.
    nrw = inputs.water_interventions
    san_sm_baseline = ctx['total_hh'][ctx['bi']] * sl.pct_sserv1_baseline
    capex_adder = san_sm_baseline * nrw.nrw_treatment_cost_pct_capex * nrw.nrw_current_pct * nrw.nrw_physical_loss_pct
    full_budget = sector_full_budget(ctx, budget_pct=b.san_budget_pct_gdp,
        direct_series=b.san_budget_direct, direct_ongoing=b.san_budget_direct_ongoing, mode=b.budget_input_mode)
    # Sanitation capex share of the sanitation budget (workbook G328 = 0.15, DISTINCT from water's
    # 0.21); falls back to the shared capex% when not provided.
    san_capex = b.san_capex_pct if b.san_capex_pct is not None else b.capex_pct_budget
    from model.utility_revenue import volume_path
    res = sector_bau(
        revenue_base=inputs.revenue_bases['sanitation'],
        revenue_volume=volume_path(inputs.revenue_bases['sanitation'], ctx, inputs.constants.days_in_year, inputs.constants.cubic_meter_liters),
        ctx=ctx, period=inputs.period,
        pct_start=[sl.pct_sserv1_start, sl.pct_sserv2_start, sl.pct_sserv3_start, sl.pct_sserv4_start, sl.pct_sserv5_start],
        pct_base=[sl.pct_sserv1_baseline, sl.pct_sserv2_baseline, sl.pct_sserv3_baseline, sl.pct_sserv4_baseline, sl.pct_sserv5_baseline],
        hist_series=[getattr(sl, f'sserv{i+1}_ts', None) for i in range(5)],
        first_year_idx=(int(sl.bau_first_year) - inputs.period.model_start_year) if getattr(sl, 'bau_first_year', 0) else 0,
        tgt1=[st.target1_sserv1, st.target1_sserv2, st.target1_sserv3, st.target1_sserv4, st.target1_sserv5],
        tgt2=[st.target2_sserv1, st.target2_sserv2, st.target2_sserv3, st.target2_sserv4, st.target2_sserv5],
        targets=_target_points(st, inputs.period),
        cost_sm=cost_sm, cost_basic=cost_no_treatment(sc),
        cost_factor=cost_factor,                               # test2: capex-efficiency + optimised-technology SM cost discount
        cost_factor_basic=cost_factor_basic * cust_cf,
        basic_share=float(getattr(si, 'basic_share', 0.0) or 0.0),
        financial_enabled=san_financial_on,
        injection_enabled=san_injection_on,
        financial_settings={
            'gdp_enabled': si.fin_gdp_enabled, 'gdp_start_year': si.fin_gdp_start_year,
            'gdp_target_share': si.fin_gdp_target_share,
            'growth_enabled': si.fin_growth_enabled, 'growth_rate': si.fin_growth_rate,
            'growth_start_year': si.fin_growth_start_year, 'growth_end_year': si.fin_growth_end_year,
            'injection_enabled': si.fin_injection_enabled, 'injection_mode': si.fin_injection_mode,
            'injection_amount': si.fin_injection_amount, 'injection_start_year': si.fin_injection_start_year,
            'injection_end_year': si.fin_injection_end_year,
        },
        financial_execution_rate=b.execution_rate,
        full_budget=full_budget, capex_pct=san_capex,
        growth_capex_pct=1.0,   # sanitation 4a SM growth uses the sanitation capex budget (I!333)
        hist_all_proportional=False,  # sanitation history I!193-197 = SM kept / Basic plug / lower proportional
        # Sanitation's FINAL target rows (r128-132, which feed the % rows r136-140 and the outputs)
        # apply the SAME adjusted block as water (r129-133): SM = unadjusted, Basic = plug when the
        # unadjusted lower rungs hit 0, lower rungs share the remainder by prior-year adjusted shares.
        # r120-124 are only the intermediate raw-CAGR series the block reads from.
        target_adjusted=True,
        planned_list=inputs.planned_investments.san_planned,
        nonhh_pct=inputs.technical.san_non_hh_pct, asset_life=inputs.technical.san_asset_life,
        capex_adder=capex_adder,
        # Shared execution rate (%GDP mode only); direct mode is already actual spend, so 1.0.
        execution_rate=(b.execution_rate if b.budget_input_mode == 'pct_gdp' else 1.0),
        budget_source=src, budget_override=b.san_budget_direct, gdp_real=ctx['gdp_real_local'],
        capeff_enabled=san_capeff_on,
        capeff_start=int(getattr(si, 'capeff_start_year', 0) or 0),
        capeff_target_year=int(getattr(si, 'capeff_target_year', 0) or 0),
        capeff_target_pct=float(getattr(si, 'capeff_target_pct', 1.0) or 1.0),
        capeff_current_pct=float(getattr(si, 'capeff_current_pct', 0.0) or 0.0),
        allocated_series=getattr(b, 'san_budget_allocated', None),
        # Collection efficiency (sanitation): collected-ratio ramp is INHERITED from water (nrw.ce_*), the
        # billed volume is the water volume × wastewater-collected%, and the sewer tariff is the water tariff
        # × sewer-tariff%. Start/target YEARS are sanitation's own. Recovered revenue → capex, same as water.
        ce_enabled=san_ce_on,
        ce_start=int(getattr(si, 'ce_start_year', 0) or 0),
        ce_target_year=int(getattr(si, 'ce_target_year', 0) or 0),
        ce_current_ratio=float(getattr(nrw, 'ce_current_ratio', 0.0) or 0.0),
        ce_target_ratio=si.ce_target_ratio if si.ce_target_ratio is not None else nrw.ce_target_ratio,
        ce_volume_base_m3=(float(getattr(nrw, 'ce_water_sold_mld', 0.0) or 0.0)
                           * _mld_to_m3
                           * float(getattr(si, 'ce_wastewater_collected_pct', 0.0) or 0.0)),
        ce_tariff=float(getattr(nrw, 'ce_current_tariff', 0.0) or 0.0) * float(getattr(si, 'ce_sewer_tariff_pct_water', 0.0) or 0.0),
        # Volume anchor = sanitation CE start year; growth INHERITED from water (nrw.ce_vol_growth),
        # so water and sanitation billed volumes scale on the same basis (population by default).
        ce_vol_anchor_year=int(getattr(si, 'ce_start_year', 0) or 0),
        ce_vol_growth=(float(nrw.ce_vol_growth) if getattr(nrw, 'ce_vol_growth', None) is not None else None),
        # Tariff reform (sanitation): its own sewer volume + current/target tariff. Extra revenue → capex.
        tariff_enabled=san_tariff_on,
        tariff_start=int(getattr(si, 'tariff_start_year', 0) or 0),
        tariff_target_year=int(getattr(si, 'tariff_target_year', 0) or 0),
        tariff_current=float(getattr(si, 'tariff_current', 0.0) or 0.0),
        tariff_target=float(getattr(si, 'tariff_target', 0.0) or 0.0),
        tariff_volume_base_m3=float(getattr(si, 'tariff_volume_mld', 0.0) or 0.0) * _mld_to_m3,
        # Microfinance + means-based grant (affordability lever): same mechanic as water, with sanitation's
        # own willingness-to-pay %, loan terms, gap split and grant pool; connection cost = sanitation SM cost.
        afford_enabled=san_mf_on,
        grant_enabled=san_mf_on,
        afford_start=int(getattr(si, 'mf_start_year', 0) or 0),
        afford_end=int(getattr(si, 'mf_end_year', 0) or 0),
        afford_pct_income=float(getattr(si, 'mf_pct_income', 0.0) or 0.0),
        afford_interest=float(getattr(si, 'mf_interest_rate', 0.0) or 0.0),
        afford_tenor=int(getattr(si, 'mf_tenor', 0) or 0),
        afford_partial_share=float(getattr(si, 'mf_partial_share', 0.0) or 0.0),
        afford_upfront_payable_ratio=float(getattr(si, 'mf_upfront_payable_ratio', 0.0) or 0.0),
        afford_takeup=float(getattr(si, 'mf_takeup_rate', 0.0) or 0.0),
        afford_gap_shares=list(getattr(si, 'mf_gap_shares', []) or []),
        afford_bracket_income=bracket_income,
        afford_grant_total=float(getattr(si, 'grant_total', 0.0) or 0.0),
        selffinance_enabled=san_mf_on,
        selffinance_share=float(getattr(si, 'mf_selffinance_share', 0.0) or 0.0),
        connection_fee=float(getattr(si, 'mf_connection_fee', 0.0) or 0.0),
        # Water-NRW-linked sewer revenue + custom new-revenue net cash → sanitation capex (0 when off).
        extra_cash=extra_cash,
        eligible_nrw_cash=nrw_link_cash,
        custom_cash=cust_cash,
        utility_debt_execution=utility_debt_execution,
    )
    res['sector'] = 'sanitation'
    return res
