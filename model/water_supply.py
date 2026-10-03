"""
Sector BAU calculation — Excel WS sheet sections 4a-4d, generalised so the same
engine runs for Water Supply or Sanitation.

Rungs (JMP ladder), index order:
    0 = Safely managed   1 = Basic   2 = Limited   3 = Unimproved   4 = No Service

`sector_bau()` is the shared 4a-4d core. `calculate_water_supply()` wires the water
inputs into it; `calculate_sanitation()` (in sanitation.py) wires the sanitation inputs.

NOTE: sanitation is currently run through the SAME water-supply BAU structure with
sanitation inputs (different service levels, targets, costs, budget %, planned spend).
That already produces a distinct sanitation BAU; the sanitation-specific divergences
(on-site / FSM / sewered, fecal-sludge treatment sizing) await the sanitation sheet spec.
"""

import numpy as np

from model.finance import (
    annual_asset_requirements, funding_ledger, loan_schedule, target_transition_capex,
    tariff_collection_cash, target_household_trajectory, intervention_output,
)
from model.gap_attribution import attribute_gap
from model.volumes import exogenous_volume_factors

RUNGS = ["Safely managed", "Basic", "Limited", "Unimproved", "No Service"]
LOWER = [2, 3, 4]   # Limited, Unimproved, No Service


def weighted_cost(techs):
    """Weighted unit cost of a rung's technology mix: Σ(share × cost)."""
    return sum(t.share * t.cost for t in techs)


def cost_with_treatment(uc):
    """Weighted safely-managed connection cost (G263/G291): Σ(share × cost) over the SM mix."""
    return weighted_cost(uc.sm_technologies)


def cost_no_treatment(uc):
    """Weighted basic-rung cost (G271/G301): Σ(share × cost) over the Basic mix."""
    return weighted_cost(uc.basic_technologies)


def build_cost_factor(ctx, period, base_sm_cost, *,
                      costeff_on=False, costeff_start=0, costeff_target_year=0,
                      costeff_current=0.0, costeff_target=0.0,
                      techmix_on=False, techmix_start=0, techmix_sm_cost=0.0):
    """Per-year multiplier on the SM connection cost from the two cost-side interventions (test2), fed to
    sector_bau's `cost_factor` hook. Both default to 1.0, so the BAU pass (toggles off) is untouched and
    history (year ≤ baseline) is always left at 1.0 — only the forecast cost moves, preserving BAU parity.

      • Capex efficiency (unit-cost discount): the discount ramps UP from BAU — 0 at costeff_start, linearly
        to (costeff_target − costeff_current) by costeff_target_year, held after (flat before the start year).
        factor = 1 − discount. The discount is capped at 95% so the connection cost stays positive.
      • Optimised technology selection: a STEP change to the new weighted SM cost from techmix_start onward,
        factor = techmix_sm_cost / base_sm_cost (no ramp; 0/absent new cost → no change).

    The two levers compose by multiplication when both are on."""
    years, n, by = ctx['years'], ctx['n'], period.baseline_year
    cf = np.ones(n)
    for t in range(n):
        y = years[t]
        if y <= by:
            continue                                             # history untouched (BAU parity)
        f = 1.0
        if costeff_on and costeff_start and costeff_target > costeff_current:
            if costeff_target_year and costeff_target_year > costeff_start:
                if y >= costeff_target_year:
                    eff = costeff_target
                elif y >= costeff_start:
                    eff = costeff_current + (costeff_target - costeff_current) * (y - costeff_start) / (costeff_target_year - costeff_start)
                else:
                    eff = costeff_current
            else:
                eff = costeff_target if y >= costeff_start else costeff_current
            disc = min(max(0.0, eff - costeff_current), 0.95)    # ramp up from BAU; cap so cost stays > 0
            f *= (1.0 - disc)
        if techmix_on and techmix_start and techmix_sm_cost > 0 and base_sm_cost > 0 and y >= techmix_start:
            f *= (techmix_sm_cost / base_sm_cost)                # step to the new mix's weighted SM cost
        cf[t] = max(f, 1e-6)
    return cf


def custom_streams(ctx, period, base_sm_cost, base_basic_cost, customs, sector):
    """Return sector-allocated custom revenue, implementation capex, and SM/Basic cost factors.

    A legacy "both" intervention with no explicit split is migrated to a 50/50 allocation.
    Sector-specific interventions remain 100% assigned to their selected sector.
    """
    n, years, by = ctx['n'], ctx['years'], period.baseline_year
    revenue = np.zeros(n)
    implementation = np.zeros(n)
    cf_sm, cf_basic = np.ones(n), np.ones(n)
    for c in (customs or []):
        if not bool(getattr(c, 'enabled', True)):
            continue
        csec = getattr(c, 'sector', 'both')
        if csec not in (sector, 'both'):
            continue
        if csec == 'both':
            shares = [float(getattr(c, 'water_allocation_share', 0.5)),
                      float(getattr(c, 'sanitation_allocation_share', 0.5))]
            if (not np.all(np.isfinite(shares)) or min(shares) < 0 or max(shares) > 1
                    or not np.isclose(sum(shares), 1.0)):
                raise ValueError("Shared custom intervention sector allocations must total 100%.")
            allocation = float(np.clip(
                getattr(c, 'water_allocation_share' if sector == 'water' else 'sanitation_allocation_share', 0.5),
                0.0, 1.0))
        else:
            allocation = 1.0
        ctype = getattr(c, 'intervention_type', '')
        if ctype == 'new_revenue':
            start = int(getattr(c, 'start_year', 0) or 0)
            cost_years = int(getattr(c, 'cost_years', 0) or 0)
            annual_cost = (float(getattr(c, 'implement_cost', 0.0) or 0.0) / cost_years) if cost_years > 0 else 0.0
            out_start = int(getattr(c, 'output_start_year', 0) or 0)
            rev = float(getattr(c, 'output_quantity', 0.0) or 0.0) * float(getattr(c, 'output_value', 0.0) or 0.0)
            for t in range(n):
                y = years[t]
                if y <= by:
                    continue
                cost_t = annual_cost if (start and start <= y < start + max(0, cost_years)) else 0.0
                rev_t = rev if (out_start and y >= out_start) else 0.0
                revenue[t] += allocation * rev_t / 1_000_000.0
                implementation[t] += allocation * cost_t / 1_000_000.0
        elif ctype == 'cost_reduction':
            start = int(getattr(c, 'start_year', 0) or 0)
            mode = getattr(c, 'cost_effect_mode', 'pct')
            amt = float(getattr(c, 'cost_effect', 0.0) or 0.0)
            affected = getattr(c, 'outputs_affected', 'sm')
            for t in range(n):
                y = years[t]
                if y <= by or (start and y < start):
                    continue
                if mode == 'flat':
                    f_sm = ((base_sm_cost - amt) / base_sm_cost) if base_sm_cost > 0 else 1.0
                    f_basic = ((base_basic_cost - amt) / base_basic_cost) if base_basic_cost > 0 else 1.0
                else:
                    f_sm = f_basic = 1.0 - amt
                if affected in ('sm', 'both'):
                    cf_sm[t] *= max(1e-6, f_sm)
                if affected in ('basic', 'both'):
                    cf_basic[t] *= max(1e-6, f_basic)
    return revenue, implementation, cf_sm, cf_basic


def sector_full_budget(ctx, *, budget_pct, direct_series, direct_ongoing, mode):
    """The sector's FULL budget per year in real terms (millions).

    mode='pct_gdp'  -> real GDP × budget% (workbook default).
    mode='direct'   -> the entered actual-expenditure series (real terms), used as-is where given
                       and COMPOUNDED at the sector's own ongoing growth rate beyond the hard values.
                       Only forecast years feed the calc (history is zeroed by the `active` flag)."""
    n = ctx['n']
    if mode == 'direct':
        a = np.array(direct_series, dtype=float) if direct_series else np.array([], dtype=float)
        out = np.zeros(n, dtype=float)
        k = min(len(a), n)
        out[:k] = a[:k]
        g = float(direct_ongoing or 0.0)
        for t in range(k, n):
            out[t] = out[t - 1] * (1.0 + g)
        return out
    return np.asarray(ctx['gdp_real_local'], dtype=float) * float(budget_pct or 0.0)


def _planned_annual(planned_list, years, baseline_year, target2_year):
    """J162 — G331 = SUM of ALL planned-investment buckets (all five periods, 2026-2050),
    spread evenly over the forecast window (target2 - baseline) years. The sheet deliberately
    spreads the full 25-year plan total across the 15 forecast years."""
    total = sum(planned_list)
    span = max(1, target2_year - baseline_year)
    annual = total / span
    return np.array([annual if int(y) > baseline_year else 0.0 for y in years], dtype=float)


def _annuity_factors(r, n):
    """(capital-recovery factor CRF, annuity present-value factor AF) for a real rate `r` over `n` years.
    Level annuity = principal × CRF; the PV of paying `A` per year for `n` years = A × AF; CRF × AF = 1."""
    if n <= 0:
        return 0.0, 0.0
    if r <= 0:
        return 1.0 / n, float(n)
    disc = (1.0 + r) ** (-n)
    crf = r / (1.0 - disc)
    af = (1.0 - disc) / r
    return crf, af


def affordability_close(bracket_gap, cost_sm, *, pct_income, interest, tenor, partial_share, upfront_payable_ratio,
                        bracket_income_monthly, takeup, grant_enabled, grant_pool):
    """Close part of a year's safely-managed gap with microfinance + a means-based grant. `bracket_gap` is
    the per-income-bracket gap count (million HH) STILL needing a loan — i.e. after any self-financing
    households have already been removed. Returns (mf_hh, grant_hh, grant_spend, mf_loan_volume): HH counts
    in MILLIONS, money in local-currency MILLIONS.

    Every household here is offered a connection loan. A share `partial_share` pay `upfront_payable_ratio` of
    the upfront fee themselves (principal reduced by that amount); the rest borrow the whole SM connection
    cost. A household can service its loan if its annual capacity A = 12 × its bracket's monthly income ×
    `pct_income` ≥ the level annuity (real `interest`, `tenor`) → MICROFINANCE connects it. Otherwise a
    MEANS-BASED GRANT buys the principal down so the reduced annuity = A (grant = principal − A × AF, in
    present value). The one-time `grant_pool` funds the cheapest grants first to maximise connections;
    microfinance is uncapped. `takeup` is the share of eligible households who take up the loan (applied to
    each year's incremental gap; see sector_bau for how the gap increment is derived)."""
    if not bracket_gap or pct_income <= 0 or tenor <= 0 or cost_sm <= 0 or takeup <= 0:
        return 0.0, 0.0, 0.0, 0.0
    crf, af = _annuity_factors(float(interest), int(tenor))
    payer_types = [(max(0.0, partial_share),       cost_sm * (1.0 - upfront_payable_ratio)),   # partial-payers
                   (max(0.0, 1.0 - partial_share), cost_sm)]                                    # full-financers
    mf_hh = 0.0
    mf_loan_volume = 0.0
    grant_cells = []                                    # (grant_per_hh, hh_count_millions, principal)
    for inc_m, n_full in zip(bracket_income_monthly, bracket_gap):
        n_bracket = max(0.0, float(n_full)) * takeup
        if n_bracket <= 0:
            continue
        cap = 12.0 * float(inc_m) * pct_income          # annual repayment capacity for THIS service
        for share, principal in payer_types:
            n_cell = n_bracket * share
            if n_cell <= 0 or principal <= 0:
                continue
            annuity = principal * crf
            if cap >= annuity:                          # can service the full loan → microfinance alone
                mf_hh += n_cell
                mf_loan_volume += n_cell * principal
            elif cap > 0 and grant_enabled:             # needs a means-based grant to reach an affordable loan
                grant_ph = principal - cap * af
                if grant_ph > 0:
                    grant_cells.append((grant_ph, n_cell, principal))
                else:                                   # rounding: fully affordable after all
                    mf_hh += n_cell
                    mf_loan_volume += n_cell * principal
            # else: cap == 0 (no income) or grant off → stays unserved
    # Means-based grant: fund the CHEAPEST grants first, drawing down the one-time pool (max connections).
    grant_hh = 0.0
    grant_spend = 0.0
    pool = float(grant_pool)
    for grant_ph, n_cell, principal in sorted(grant_cells, key=lambda x: x[0]):
        if pool <= 0:
            break
        cost_cell = grant_ph * n_cell                   # LC millions = (currency/HH) × (million HH)
        if cost_cell <= pool:
            grant_hh += n_cell; grant_spend += cost_cell; pool -= cost_cell
            mf_loan_volume += n_cell * (principal - grant_ph)             # residual serviced loan
        else:
            frac = pool / cost_cell
            grant_hh += n_cell * frac; grant_spend += pool
            mf_loan_volume += n_cell * frac * (principal - grant_ph)
            pool = 0.0
    return mf_hh, grant_hh, grant_spend, mf_loan_volume


def sector_bau(ctx, **kwargs):
    """Apply debt/direct-investment allocations to coverage without borrowing against new sales."""
    first = _sector_bau(ctx, **kwargs)
    loan = first.pop('_loan_schedule')
    cash = np.asarray(first['additional_net_utility_cash'])
    allocated = loan['cash_allocated_to_direct_investment'] + loan['drawdowns']
    if np.allclose(cash, allocated, atol=1e-10, rtol=0):
        return first
    # Target costs and established intervention cash are independent of loan-funded
    # households. Freeze the contract; rerun only the simulated physical purchases.
    result = _sector_bau(ctx, **kwargs, _coverage_cash=allocated, _loan_override=loan)
    result.pop('_loan_schedule')
    # Other household finance may change with funded coverage. A NEW proposal may
    # shrink to the revised need, never grow recursively with loan-funded sales.
    if not loan['is_fixed_contract'] and loan['loan_principal'] > 0:
        for _ in range(20):
            ledger = funding_ledger(
                result['total_investment_need'], result['public_capital'],
                result['other_capital'], loan['cash_allocated_to_direct_investment'],
                baseline_index=ctx['bi'])
            draw = kwargs['borrowing_settings']['drawdown_year']
            remaining = sum(min(g, req) for y, g, req in zip(
                ctx['years'], ledger['gap'], result['total_investment_need']) if y >= draw)
            if loan['loan_principal'] <= remaining + 1e-7:
                break
            settings = {**kwargs['borrowing_settings'], 'borrowing_ceiling': remaining}
            # Zero is the conventional unlimited ceiling, so disable a no-need proposal explicitly.
            proposal = _sector_bau(ctx, **{**kwargs, 'borrowing_settings': settings,
                                          'borrowing_enabled': remaining > 1e-9})
            loan = proposal.pop('_loan_schedule')
            result = _sector_bau(ctx, **kwargs,
                                _coverage_cash=loan['cash_allocated_to_direct_investment'] + loan['drawdowns'],
                                _loan_override=loan)
            result.pop('_loan_schedule')
        else:
            raise ValueError("Borrowing and household financing did not reconcile to remaining investment need.")
    return result


def _sector_bau(ctx, *, period, pct_start, pct_base, tgt1, tgt2, cost_sm, cost_basic,
               full_budget, capex_pct, growth_capex_pct, planned_list, nonhh_pct, asset_life, capex_adder,
               hist_all_proportional, target_adjusted, execution_rate=1.0,
               basic_share=0.0, cost_factor_basic=None,
               targets=None, budget_source='pct_gdp', budget_override=None, gdp_real=None,
               hist_series=None, first_year_idx=0, cost_factor=None,
               capeff_enabled=False, capeff_start=0, capeff_target_year=0,
               capeff_target_pct=1.0, capeff_current_pct=0.0, allocated_series=None,
               ce_enabled=False, ce_start=0, ce_target_year=0, ce_current_ratio=0.0,
               ce_target_ratio=0.0, ce_volume_base_m3=0.0, ce_tariff=0.0,
               ce_vol_anchor_year=0, ce_vol_growth=None,
               tariff_enabled=False, tariff_start=0, tariff_target_year=0,
               tariff_current=0.0, tariff_target=0.0, tariff_volume_base_m3=0.0,
               nrw_enabled=False, nrw_start=0, nrw_target_year=0, nrw_current=0.0, nrw_target=0.0,
                nrw_physical=0.5, nrw_commercial=0.5, nrw_service_share=0.5,
                nrw_vol_m3yr=0.0, nrw_vol_m3day=0.0, nrw_water_per_upgrade=0.0,
                nrw_tariff=0.0, nrw_production_cost=0.0, nrw_maintenance_annual=0.0,
                nrw_capex_unit_m3day=0.0, nrw_vol_growth=None, nrw_lag=0,
               afford_enabled=False, grant_enabled=False, afford_start=0, afford_end=0,
               afford_pct_income=0.0, afford_interest=0.0, afford_tenor=0, afford_partial_share=0.0,
               afford_upfront_payable_ratio=0.0, afford_takeup=0.0, afford_gap_shares=None,
               afford_bracket_income=None, afford_grant_total=0.0,
               selffinance_enabled=False, selffinance_share=0.0, connection_fee=0.0,
               financial_enabled=False, injection_enabled=False, financial_settings=None, financial_execution_rate=None,
               borrowing_enabled=False, borrowing_settings=None,
                 extra_cash=None, custom_revenue=None, custom_implementation_capex=None,
                 _coverage_cash=None, _loan_override=None):
    """Shared 4a-4d core. All HH and money values are in MILLIONS; costs in actual currency.

    `full_budget` is the sector's FULL budget per year in real terms, from EITHER %GDP mode
    (GDP_real × budget%) OR direct entry (actual expenditure series). The BAU INVESTMENT that drives
    the model = the capex budget (full_budget × capex_pct) = `bau_available`, for BOTH sectors. The BAU
    additional safely-managed HH each year (4a) =
        (BAU investment − replacement capex) × HH/(HH+non-HH) ÷ SM cost
    so replacement (depreciation of the existing stock) is funded first, and only the household share
    buys new connections. `growth_capex_pct` and `planned_list` are kept for the caller signature but
    are no longer used. NOTE: this deliberately DIVERGES from the reference workbook's BAU (which grew
    SM on the %GDP capex budget alone). Target investment is costed independently of this coverage."""
    n, bi, years, total_hh = ctx['n'], ctx['bi'], ctx['years'], ctx['total_hh']
    msy, by = period.model_start_year, period.baseline_year
    t1y, t2y = period.target1_year, period.target2_year
    eay = ctx['end_asis_year']

    nonhh_mult = nonhh_pct / (1.0 - nonhh_pct) if nonhh_pct < 1.0 else 0.0
    active = np.maximum(ctx['forecast_flag'], ctx['perf_flag'])
    exec_rate = float(execution_rate)
    planned_annual = np.zeros(n)                                                     # planned investment removed from the model
    full_budget_in = np.asarray(full_budget, dtype=float)                            # raw total-spending budget
    # Per-year unit-cost factor: a cost-side intervention (e.g. capital efficiency) DISCOUNTS the connection
    # cost from its start year, so cost varies by year. Defaults to all-1.0 → BAU pass is untouched. Only the
    # forecast 4a/4d cost reads it; history & opening stock keep the base cost so BAU parity is preserved.
    cf = np.ones(n) if cost_factor is None else np.asarray(cost_factor, dtype=float)
    if cf.shape[0] < n:
        cf = np.concatenate([cf, np.ones(n - cf.shape[0])])
    cost_sm_t = cost_sm * cf[:n]
    # Basic carries its OWN factor. `cf` includes an SM-specific technology-mix ratio, so applying it to
    # basic would price basic off the safely-managed mix. Falls back to `cf` only when no basic factor is
    # supplied, which keeps the pre-split behaviour identical.
    cfb = cf if cost_factor_basic is None else np.asarray(cost_factor_basic, dtype=float)
    if cfb.shape[0] < n:
        cfb = np.concatenate([cfb, np.ones(n - cfb.shape[0])])
    cost_basic_t = cost_basic * cfb[:n]
    # Separate caller-supplied revenue and implementation-cost schedules (LC millions). Sanitation uses
    # extra_cash for the water-NRW-linked sewer revenue; custom revenue/cost are passed independently.
    extra_cash_arr = np.zeros(n) if extra_cash is None else np.asarray(extra_cash, dtype=float)
    if extra_cash_arr.shape[0] < n:
        extra_cash_arr = np.concatenate([extra_cash_arr, np.zeros(n - extra_cash_arr.shape[0])])
    custom_revenue_arr = np.zeros(n) if custom_revenue is None else np.asarray(custom_revenue, dtype=float)
    if custom_revenue_arr.shape[0] < n:
        custom_revenue_arr = np.concatenate([custom_revenue_arr, np.zeros(n - custom_revenue_arr.shape[0])])
    custom_implementation_arr = (
        np.zeros(n) if custom_implementation_capex is None
        else np.asarray(custom_implementation_capex, dtype=float))
    if custom_implementation_arr.shape[0] < n:
        custom_implementation_arr = np.concatenate(
            [custom_implementation_arr, np.zeros(n - custom_implementation_arr.shape[0])])
    # Budget (capex_budget / bau_available / allocated / actual) is finalised AFTER the 4a history
    # block below — the 'from_cost' source derives the historical budget from the historical household
    # counts, which must be computed first. See "Budget finalisation" further down.

    # ── Per-rung historical growth RATE (mean year-on-year) + unadjusted count path ──────────────
    # test2 (items 7 & 8): service levels may be entered for EVERY historical year (like real GDP),
    # and each rung's growth rate is the MEAN of its year-on-year count growth over the window
    # [first_year .. baseline]; blank years fill forward at that rate. `first_year_idx` lets the user
    # choose where the BAU rate starts. BACKWARD-COMPAT: with only the start & baseline points entered,
    # mean-YoY over a two-point geometric series equals the previous two-point CAGR, so the validated
    # numbers are unchanged unless richer annual data / a later first year is supplied.
    fi = max(0, min(int(first_year_idx or 0), bi))
    hs = hist_series or []
    def _hist_share(r, t):
        if r < len(hs):
            a = hs[r]
            if a is not None and t < len(a):
                v = a[t]
                return float(v) if (v and v > 0) else 0.0
        if t == 0:
            return float(pct_start[r] or 0.0)
        if t == bi:
            return float(pct_base[r] or 0.0)
        return 0.0
    cagr = []                          # kept name; now holds the MEAN-YoY rate per rung
    unadj_hist = np.zeros((5, bi + 1))
    for r in range(5):
        known = {}
        for t in range(bi + 1):
            sh = _hist_share(r, t)
            if sh > 0:
                known[t] = sh * total_hh[t]                              # entered count = share × total HHs
        ks = sorted(k for k in known if fi <= k <= bi)
        yoy = []
        for j in range(1, len(ks)):
            t0, t1 = ks[j - 1], ks[j]
            if known[t0] > 0 and t1 > t0:
                yoy.append((known[t1] / known[t0]) ** (1.0 / (t1 - t0)) - 1.0)   # annualised between entered years
        g = float(np.mean(yoy)) if yoy else 0.0
        cagr.append(g)
        prev = None
        for t in range(bi + 1):
            if t in known:
                unadj_hist[r, t] = known[t]; prev = known[t]
            elif prev is not None:
                unadj_hist[r, t] = prev * (1.0 + g); prev = unadj_hist[r, t]
            else:
                unadj_hist[r, t] = 0.0

    # 4a — BAU forecast
    bau = np.zeros((5, n))
    # Historical block: the UNADJUSTED per-rung counts above are rescaled to each year's total HHs —
    # WATER: all five rungs × (total/Σunadj); SANITATION: SM kept, lower proportional, Basic = plug.
    for t in range(bi + 1):
        unadj = [unadj_hist[r, t] for r in range(5)]
        total_unadj = sum(unadj)
        scale = total_hh[t] / total_unadj if total_unadj > 0 else 0.0
        if hist_all_proportional:
            for r in range(5):
                bau[r, t] = unadj[r] * scale
        else:
            for r in LOWER:
                bau[r, t] = unadj[r] * scale
            bau[0, t] = unadj[0]
            bau[1, t] = total_hh[t] - unadj[0] - sum(bau[r, t] for r in LOWER)
    # ── Budget finalisation ──────────────────────────────────────────────────────────────────────
    # capex_budget = the capex actually SPENT each forecast year (the BAU investment that funds new
    # connections). For pct_gdp/direct this is full_budget × %capex × execution. For 'from_cost' the
    # budget IS the capital investment, so no further %capex split applies (capex%/execution = 1).
    if budget_source == 'from_cost':
        gdp = np.asarray(gdp_real if gdp_real is not None else ctx['gdp_real_local'], dtype=float)
        # Historical budget = cost of the NEW connections added that year (Safely-managed + Basic),
        # floored per rung at 0 (a shrinking rung is not refunded).
        hist_budget = np.zeros(n)
        for t in range(1, bi + 1):
            d_sm = max(0.0, bau[0, t] - bau[0, t - 1])
            d_basic = max(0.0, bau[1, t] - bau[1, t - 1])
            hist_budget[t] = d_sm * cost_sm + d_basic * cost_basic
        ratios = [hist_budget[t] / gdp[t] for t in range(1, bi + 1) if gdp[t] > 0 and hist_budget[t] > 0]
        ratio = float(np.mean(ratios)) if ratios else 0.0                            # mean historical budget/GDP
        ov = np.asarray(budget_override, dtype=float) if (budget_override is not None and len(budget_override)) else np.zeros(0)
        full_budget = np.zeros(n)
        for t in range(n):
            o = ov[t] if t < len(ov) else 0.0
            if o > 0:
                full_budget[t] = o                                                   # user override (any year)
            elif t <= bi:
                full_budget[t] = hist_budget[t]                                       # historical: from cost
            else:
                full_budget[t] = ratio * gdp[t] if gdp[t] > 0 else 0.0                # forecast: ratio × real GDP
        capex_pct_eff, exec_eff = 1.0, 1.0
    else:
        full_budget = np.asarray(full_budget_in, dtype=float)
        capex_pct_eff, exec_eff = capex_pct, float(exec_rate)
    # Financial commitments and exogenous injections have independent switches and cash ledgers.
    # The GDP entry is a target TOTAL share: only max(target×GDP − BAU full spending, 0) counts.
    financial_cash = np.zeros(n)
    injection_cash = np.zeros(n)
    fs = financial_settings or {}
    if financial_enabled or injection_enabled:
        gdp = np.asarray(gdp_real if gdp_real is not None else ctx['gdp_real_local'], dtype=float)
        # The financial levers are defined against TOTAL sector spending even when the BAU connection
        # budget itself is derived from historical service costs. `full_budget_in` preserves that total
        # spending series across budget modes. New commitments then pass through the sector's ordinary
        # capex share and execution rate before becoming capital available for connections.
        commitment_base = full_budget_in
        if commitment_base.shape[0] < n:
            commitment_base = np.concatenate([commitment_base, np.zeros(n - commitment_base.shape[0])])
        commitment_exec = execution_rate if financial_execution_rate is None else financial_execution_rate
        financial_capex_factor = max(0.0, float(capex_pct)) * max(0.0, float(commitment_exec))
        for t, y in enumerate(years):
            if y <= by:
                continue
            extra_full = 0.0
            if financial_enabled and fs.get('gdp_enabled') and y >= int(fs.get('gdp_start_year') or 0):
                target_total = max(0.0, float(fs.get('gdp_target_share') or 0.0)) * gdp[t]
                extra_full += max(0.0, target_total - commitment_base[t])
            gs, ge = int(fs.get('growth_start_year') or 0), int(fs.get('growth_end_year') or years[-1])
            gr = max(0.0, float(fs.get('growth_rate') or 0.0))
            if financial_enabled and fs.get('growth_enabled') and gs <= y <= ge:
                extra_full += max(0.0, commitment_base[t] * ((1.0 + gr) ** (y - gs + 1) - 1.0))
            iy, ie = int(fs.get('injection_start_year') or 0), int(fs.get('injection_end_year') or 0)
            amt = max(0.0, float(fs.get('injection_amount') or 0.0))
            if injection_enabled:
                if fs.get('injection_mode') == 'recurring' and iy <= y <= ie:
                    injection_cash[t] = amt * financial_capex_factor
                elif fs.get('injection_mode') != 'recurring' and y == iy:
                    injection_cash[t] = amt * financial_capex_factor
            financial_cash[t] = extra_full * financial_capex_factor
    # "Budget used" = the capital that becomes service each year (the from_cost cost-of-service budget,
    # or the user's per-year override). This is the DRIVER of the baseline BAU. capex_pct_eff/exec_eff
    # are 1.0 in from_cost; in %GDP mode it is the capital share of the (executed) budget.
    used_budget = full_budget * capex_pct_eff * exec_eff
    # ── Capex efficiency (test2) = budget used ÷ budget allocated ──────────────────────────────────
    # "Budget allocated" is a MANUAL input, bigger than what is actually used. Default = used ÷
    # DEFAULT_CAPEX_EFF (efficiency starts below 100%). Its FORECAST = mean historical (allocated ÷ used)
    # × the used-budget forecast for that year (the user's "average budget execution × used forecast").
    # Per-year efficiency = used ÷ allocated; the BAU applies it, and the capex-efficiency intervention
    # ramps it up to a target. bau_available = allocated × efficiency (baseline ⇒ = used, so BAU is
    # unchanged; the intervention lets more of the allocated budget reach service).
    DEFAULT_CAPEX_EFF = 0.80
    alloc_in = np.asarray(allocated_series, dtype=float) if (allocated_series is not None and len(allocated_series)) else np.zeros(0)
    def _alloc_entered(t):
        return float(alloc_in[t]) if (t < len(alloc_in) and alloc_in[t] > 0) else 0.0
    allocated = np.zeros(n)
    for t in range(bi + 1):                                               # history: entered, else used ÷ default eff
        a = _alloc_entered(t)
        allocated[t] = a if a > 0 else (used_budget[t] / DEFAULT_CAPEX_EFF if used_budget[t] > 0 else 0.0)
    exec_ratios = [allocated[t] / used_budget[t] for t in range(1, bi + 1) if used_budget[t] > 0 and allocated[t] > 0]
    exec_ratio = float(np.mean(exec_ratios)) if exec_ratios else (1.0 / DEFAULT_CAPEX_EFF)   # mean allocated ÷ used
    for t in range(bi + 1, n):                                            # forecast: entered, else ratio × used
        a = _alloc_entered(t)
        allocated[t] = a if a > 0 else exec_ratio * used_budget[t]
    allocated_capex = allocated                                          # the allocated capital budget (all years)
    actual_capex = used_budget                                          # what actually reaches service at baseline
    e0_auto = float(np.clip(1.0 / exec_ratio, 0.0, 1.0)) if exec_ratio > 0 else 1.0   # baseline efficiency = used÷allocated
    tgt = float(np.clip(capeff_target_pct or 1.0, 0.0, 1.0))
    override = float(np.clip(capeff_current_pct, 0.0, 1.0)) if (capeff_current_pct and capeff_current_pct > 0) else 0.0
    eff = np.ones(n)
    for t in range(n):
        if years[t] <= by:
            continue                                                      # history: bau_available is 0 anyway
        base = override if override > 0 else ((used_budget[t] / allocated[t]) if allocated[t] > 0 else 1.0)
        e = base                                                          # baseline efficiency (also the BAU)
        if capeff_enabled and capeff_start:
            if capeff_target_year and capeff_target_year > capeff_start:
                if years[t] >= capeff_target_year:
                    e = tgt
                elif years[t] >= capeff_start:
                    e = base + (tgt - base) * (years[t] - capeff_start) / (capeff_target_year - capeff_start)
            elif years[t] >= capeff_start:
                e = tgt
        eff[t] = float(np.clip(e, 0.0, 1.0))
    capex_budget = active * allocated                                    # allocated capital budget (forecast-gated)
    bau_available = capex_budget * eff                                   # effective capex that reaches service

    # Combined tariff/collection revenue uses one exogenous billed-volume base for both interventions.
    # Keep the existing population/fixed-growth convention; do not infer billable connections from
    # simulated coverage or compound population growth twice.
    billed_growth = exogenous_volume_factors(
        years, ctx['population'], anchor_year=tariff_start or ce_start,
        baseline_year=by, growth_rate=ce_vol_growth)
    nrw_growth = exogenous_volume_factors(
        years, ctx['population'], anchor_year=nrw_start,
        baseline_year=by, growth_rate=nrw_vol_growth)

    def _ramp(values, current, target, start, end, enabled, lower=None, upper=None):
        out = np.full(n, float(current))
        if not enabled or not start:
            return out
        for i, year in enumerate(years):
            if year <= by or year < start:
                continue
            if end and end > start and year < end:
                value = current + (target - current) * (year - start) / (end - start)
            else:
                value = target
            if lower is not None:
                value = max(lower, value)
            if upper is not None:
                value = min(upper, value)
            out[i] = value
        return out

    collection_scenario = _ramp(None, ce_current_ratio, ce_target_ratio, ce_start, ce_target_year,
                                ce_enabled, 0.0, 1.0)
    tariff_scenario = _ramp(None, tariff_current, tariff_target, tariff_start, tariff_target_year,
                            tariff_enabled, 0.0, None)
    billed_volume = np.zeros(n)
    # Tariff reform's billed-volume input is the shared BAU volume for both tariff and collection effects.
    # Collection is attributed first at the BAU tariff; tariff is then measured at scenario collection,
    # so both contributions sum exactly to the combined revenue change without interaction double-counting.
    common_volume = max(0.0, float(tariff_volume_base_m3 or 0.0))
    for t in range(bi + 1, n):
        if ctx['forecast_flag'][t] <= 0:
            continue
        billed_volume[t] = common_volume * billed_growth[t]
    collection_cash, tariff_cash = tariff_collection_cash(
        billed_volume, tariff_current, tariff_scenario, ce_current_ratio,
        collection_scenario, tariff_enabled=tariff_enabled,
        collection_enabled=ce_enabled)
    shared_revenue_cash = collection_cash + tariff_cash

    # NRW physical benefits, commercial billing recovery, implementation capex, and maintenance are
    # separate ledgers. Physical recovery is allocated once between service and production savings;
    # commercial recovery is a billing improvement and never creates physical service capacity.
    nrw_reduction = np.zeros(n)
    nrw_upgrade_cum = np.zeros(n)
    nrw_recovered_phys = np.zeros(n)             # physical water allocated to additional service (M m3/year)
    nrw_recovered_phys_total = np.zeros(n)
    nrw_commercial_vol = np.zeros(n)
    nrw_commercial_cash = np.zeros(n)
    nrw_service_cash = np.zeros(n)
    nrw_production_avoided_vol = np.zeros(n)
    nrw_production_savings = np.zeros(n)
    nrw_implementation = np.zeros(n)
    nrw_service_upgrade_capex = np.zeros(n)
    nrw_maintenance_cost = np.zeros(n)
    nrw_net = np.zeros(n)                         # recurring cash: commercial revenue + savings - maintenance
    if nrw_enabled and (
        not np.all(np.isfinite([nrw_physical, nrw_commercial, nrw_service_share]))
        or min(nrw_physical, nrw_commercial) < 0
        or not np.isclose(nrw_physical + nrw_commercial, 1.0)
        or not 0.0 <= nrw_service_share <= 1.0
    ):
        raise ValueError("NRW physical/commercial shares must total 100%; service allocation must be between 0% and 100%.")
    physical_share, commercial_share = nrw_physical, nrw_commercial
    service_share = float(nrw_service_share)
    if nrw_enabled and nrw_current > nrw_target and nrw_start:
        for t, y in enumerate(years):
            if y <= by or y < nrw_start:
                continue
            if nrw_target_year and nrw_target_year > nrw_start and y < nrw_target_year:
                rate = nrw_current + (nrw_target - nrw_current) * (y - nrw_start) / (nrw_target_year - nrw_start)
            else:
                rate = nrw_target
            nrw_reduction[t] = max(0.0, nrw_current - rate)
        lag = max(0, int(nrw_lag))
        for t in range(bi + 1, n):
            if ctx['forecast_flag'][t] <= 0:
                continue
            red = nrw_reduction[t]
            red_benefit = nrw_reduction[t - lag] if t - lag >= 0 else 0.0
            volume_factor = nrw_growth[t]
            total_recovered = red_benefit * nrw_vol_m3yr * volume_factor
            physical_recovered = total_recovered * physical_share
            service_volume = physical_recovered * service_share
            production_volume = physical_recovered * (1.0 - service_share)
            commercial_volume = total_recovered * commercial_share
            nrw_recovered_phys_total[t] = physical_recovered
            nrw_recovered_phys[t] = service_volume
            nrw_production_avoided_vol[t] = production_volume
            nrw_commercial_vol[t] = commercial_volume
            nrw_upgrade_cum[t] = (
                service_volume / nrw_water_per_upgrade if nrw_water_per_upgrade > 0 else 0.0)
            if t > bi:
                nrw_upgrade_cum[t] = max(nrw_upgrade_cum[t], nrw_upgrade_cum[t - 1])

            nrw_production_savings[t] = production_volume * max(0.0, nrw_production_cost)
            # NRW is attributed after collection, before tariff reform. Both physical-service
            # sales and recovered billing use the shared BAU tariff and scenario collection.
            nrw_commercial_cash[t] = commercial_volume * max(0.0, tariff_current) * collection_scenario[t]
            nrw_service_cash[t] = service_volume * max(0.0, tariff_current) * collection_scenario[t]
            cap_now = red * nrw_vol_m3day * volume_factor
            cap_prev = (
                nrw_reduction[t - 1] * nrw_vol_m3day
                * nrw_growth[t - 1]) if t > 0 else 0.0
            nrw_implementation[t] = (
                nrw_capex_unit_m3day * max(0.0, cap_now - cap_prev) / 1_000_000.0)
            upgrade_flow = max(0.0, nrw_upgrade_cum[t] - nrw_upgrade_cum[t - 1])
            nrw_service_upgrade_capex[t] = (
                upgrade_flow * max(0.0, cost_sm_t[t] - cost_basic_t[t]) * (1.0 + nonhh_mult))
            if y >= nrw_start:
                nrw_maintenance_cost[t] = max(0.0, nrw_maintenance_annual) / 1_000_000.0
            nrw_net[t] = (
                nrw_commercial_cash[t] + nrw_service_cash[t]
                + nrw_production_savings[t] - nrw_maintenance_cost[t])
    billed_volume_scenario = billed_volume + nrw_commercial_vol + nrw_recovered_phys
    # Tariff reform is last: its interaction with recovered billed volumes belongs here,
    # not also in NRW revenue. This telescopes to Qs*Ts*Cs - Qb*Tb*Cb.
    _, tariff_cash = tariff_collection_cash(
        billed_volume_scenario, tariff_current, tariff_scenario, ce_current_ratio,
        collection_scenario, tariff_enabled=tariff_enabled, collection_enabled=False)
    shared_revenue_cash = collection_cash + nrw_commercial_cash + nrw_service_cash + tariff_cash
    # NRW rehabilitation enables the programme and is a distinct implementation cost.
    # NRW-enabled household upgrades are already priced in scheduled target expansion.
    # Their simulated-path purchase cost must not be added a second time to target need.
    implementation_capex = nrw_implementation + custom_implementation_arr
    additional_net_utility_cash = (
        shared_revenue_cash + nrw_production_savings - nrw_maintenance_cost
        + extra_cash_arr + custom_revenue_arr)
    nrw_potential_upgrade_cum = nrw_upgrade_cum.copy()
    nrw_upgrade_cum = np.zeros(n)
    nrw_service_upgrade_capex[:] = 0.0

    # Forecast keeps a SELF-CONTAINED unadjusted series (sheet r36-40): each rung compounds from its
    # OWN prior unadjusted value (NOT the rescaled/adjusted prior), seeded at the baseline from the
    # adjusted baseline counts. SM accumulates the budget-funded increase; the others grow at CAGR.
    # The adjusted row (r45-49) is then derived each year: SM kept, lower × total/Σunadj, Basic = plug.
    # 4b prep — target boundary points. test2: ANY number of targets (a sorted list of (year, [5
    # shares])); falls back to the two target1/target2 sets when no list is supplied. Each boundary's
    # COUNTS = that year's total households × share; the path CAGRs between consecutive boundaries.
    if targets:
        tlist = sorted(((int(ty), list(sh)) for ty, sh in targets if int(ty) > eay), key=lambda x: x[0])
    else:
        tlist = [tp for tp in [(int(t1y), list(tgt1)), (int(t2y), list(tgt2))] if tp[0] > eay]
    tgt_years = [ty for ty, _ in tlist]

    # Intervention SM ceiling (protects the basic target): interventions may CLOSE the SM gap but not
    # overshoot it — the ceiling is the target-path SM count, CAGR'd from the baseline SM through the SM
    # target boundaries. inf where there is nothing to protect (history / no targets). Only ever binds in
    # the scenario pass; the BAU SM sits below the target, so the clamp is a no-op there (parity kept).
    sm_cap = np.full(n, np.inf)

    # 4c — opening asset stock (booked at the baseline year)
    opening_stock = (bau[0, bi] * cost_sm + bau[1, bi] * cost_basic) * (1.0 + nonhh_mult)
    opening_sm = bau[0, bi] * cost_sm * (1.0 + nonhh_mult)

    # BAU forecast (4a), targets (4b) and investment need (4d) are computed together in ONE forward
    # pass, because the BAU additional safely-managed HH depend on the BAU replacement capex:
    #     additional HH = (BAU investment − BAU replacement) × HH-share ÷ SM cost
    # BAU investment = bau_available (capex budget); BAU replacement = prior-year BAU-OWN asset stock ×
    # depreciation (performance-improvement years only); HH-share = HH/(HH+non-HH) = 1 − non-HH%. The BAU
    # stock is kept separate from the target `stock` so the BAU never depends on the target (no circularity).
    depr = 1.0 / asset_life
    hh_share = 1.0 - nonhh_pct
    tgt = np.zeros((5, n))
    hh_gap = np.zeros(n); hh_gap_basic = np.zeros(n); new_capex_total = np.zeros(n); stock = np.zeros(n)
    replacement = np.zeros(n); total_need = np.zeros(n); financing_gap = np.zeros(n)
    available_total = np.zeros(n)  # effective budget plus all signed intervention cash reaching the gap calculation
    # These are target-need accounting ledgers. They do not alter the BAU stock
    # used to project household connections or the existing sector-wide figures.
    need_stock_by_service = np.zeros((2, n))
    new_capex_by_service = np.zeros((2, n))
    replacement_by_service = np.zeros((2, n))
    funded_by_service = np.zeros((2, n))
    financing_gap_by_service = np.zeros((2, n))
    # BAU's OWN asset stock + its depreciation, kept SEPARATE from `stock` (which accumulates the
    # scheduled target expansion). The BAU 4a replacement depreciates THIS, so the BAU counterfactual
    # never depends on the target path — this fixes the cross-scenario circularity.
    bau_stock = np.zeros(n); bau_replacement = np.zeros(n)

    # Microfinance + means-based grant (affordability lever): per-year SM connections and grant spend,
    # accumulated after the loop. `grant_pool_left` is the running one-time grant budget (LC millions).
    # `selffin_flow` = households that self-finance the connection upfront (own band, no loan, richest-first).
    mf_flow = np.zeros(n); grant_flow = np.zeros(n); grant_spend_flow = np.zeros(n); mf_loan_flow = np.zeros(n)
    selffin_flow = np.zeros(n)
    grant_pool_left = float(afford_grant_total or 0.0)
    afford_gap_shares = list(afford_gap_shares) if afford_gap_shares else []
    afford_bracket_income = list(afford_bracket_income) if afford_bracket_income else []
    selffin_share = float(np.clip(selffinance_share or 0.0, 0.0, 1.0))

    # History (start..baseline): target = BAU; the opening stock is booked at the baseline year.
    for t in range(bi + 1):
        tgt[:, t] = bau[:, t]
        booked = opening_stock if years[t] == by else 0.0
        stock[t] = booked + (stock[t - 1] if t > 0 else 0.0)
        need_stock_by_service[0, t] = opening_sm if years[t] == by else 0.0
        need_stock_by_service[1, t] = opening_stock - opening_sm if years[t] == by else 0.0
        bau_stock[t] = booked + (bau_stock[t - 1] if t > 0 else 0.0)

    if tgt_years:
        target_schedule = target_household_trajectory(years, total_hh, bau[:, bi], bi, tlist)
        tgt[:, bi + 1:] = target_schedule[:, bi + 1:]
        sm_cap[bi + 1:] = tgt[0, bi + 1:]
    unadj = [bau[r, bi] for r in range(5)]                              # forecast SM accumulates on the baseline count
    # Affordability-lever SM accounting: `budget_sm` is SM from the budget + NRW only (no levers); the lever
    # cumulatives accumulate on top. `gap_served_hw` = high-water mark of the budget gap already partitioned,
    # so each year only the NEW gap is offered to self-finance / microfinance / grant (shares stay meaningful).
    budget_sm = bau[0, bi]
    selffin_cum = 0.0; mf_cum = 0.0; grant_cum = 0.0; gap_served_hw = 0.0
    for t in range(bi + 1, n):
        ff, pf = ctx['forecast_flag'][t], ctx['perf_flag'][t]
        # 4a — additional safely-managed HH funded by (BAU investment − replacement), household share only.
        # BAU replacement depreciates the BAU's OWN stock (baseline existing stock + BAU's own additions),
        # NOT the target-gap stock — so the BAU counterfactual is independent of the target path.
        bau_replacement[t] = bau_stock[t - 1] * depr if ff > 0 else 0.0
        # Public capital and additional net utility cash are distinct sources. Implementation capex is a
        # requirement and is paid before the remaining resources can support new simulated coverage.
        coverage_cash = (additional_net_utility_cash[t] if _coverage_cash is None else _coverage_cash[t])
        avail = (bau_available[t] + financial_cash[t] + injection_cash[t]
                 + coverage_cash - implementation_capex[t])
        available_total[t] = (
            bau_available[t] + financial_cash[t] + injection_cash[t]
            + additional_net_utility_cash[t])
        # ── Investment split (test2) ───────────────────────────────────────────────────────────────────
        # Replacement is funded first, then the remainder is split: `basic_share` buys BASIC service for
        # households at limited-and-below, the rest buys SAFELY MANAGED for households at basic-and-below.
        # Both flows are drawn from the PRIOR year's counts, so a household cannot climb two rungs and be
        # paid for twice in one year. Money whose source pool is exhausted rolls over to the other rung.
        # basic_share = 0 is the default and reproduces the pre-split single-purchase behaviour exactly.
        invest = max(0.0, avail - bau_replacement[t]) * hh_share
        # Recovered water alone does not buy an upgrade. Reserve the incremental connection
        # cost from available household investment before buying any other connections.
        potential_upgrades = max(0.0, nrw_potential_upgrade_cum[t] - nrw_potential_upgrade_cum[t - 1])
        upgrade_unit_cost = max(0.0, cost_sm_t[t] - cost_basic_t[t])
        upgrade_room = min(max(0.0, bau[1, t - 1]), max(0.0, sm_cap[t] - budget_sm))
        nrw_upg = min(potential_upgrades, upgrade_room,
                      invest / upgrade_unit_cost if upgrade_unit_cost > 0 else potential_upgrades)
        upgrade_spend = nrw_upg * upgrade_unit_cost
        invest -= upgrade_spend
        nrw_service_upgrade_capex[t] = upgrade_spend * (1.0 + nonhh_mult)
        nrw_upgrade_cum[t] = nrw_upgrade_cum[t - 1] + nrw_upg
        bs = float(np.clip(basic_share, 0.0, 1.0))
        pool_basic = max(0.0, bau[1, t - 1] - nrw_upg)                   # do not buy the NRW upgrade twice
        pool_lower = sum(max(0.0, bau[r, t - 1]) for r in LOWER)        # eligible for a basic upgrade
        money_basic, money_sm = invest * bs, invest * (1.0 - bs)
        new_basic = money_basic / cost_basic_t[t] if cost_basic_t[t] > 0 else 0.0
        if new_basic > pool_lower:                                      # basic pool dry → roll the rest to SM
            money_sm += (new_basic - pool_lower) * cost_basic_t[t]
            new_basic = pool_lower
        new_sm = money_sm / cost_sm_t[t] if cost_sm_t[t] > 0 else 0.0
        if new_sm > pool_basic:                                         # SM pool dry → roll back to basic
            spare = (new_sm - pool_basic) * cost_sm_t[t]
            new_sm = pool_basic
            room = max(0.0, pool_lower - new_basic)
            new_basic += min(room, (spare / cost_basic_t[t]) if cost_basic_t[t] > 0 else 0.0)
        budget_sm = budget_sm + new_sm + nrw_upg                      # SM from the budget + NRW only (no levers)
        if nrw_enabled:
            budget_sm = min(budget_sm, sm_cap[t])                     # cap at the SM target → basic stays ≥ its target
        # ── Microfinance affordability intervention (with self-finance carve-out + means-based grant) ──
        # Addresses the gap the budget leaves (sm_cap − budget_sm). To keep the shares meaningful, only the
        # INCREMENT of that gap beyond the high-water mark already partitioned (`new_gap`) is handled each year
        # — otherwise re-drawing a share of the whole standing gap every year over-serves it. Of the new gap:
        #   • `selffin_share` (richest bracket first) can pay the connection UPFRONT → these are ISOLATED as
        #     BAU-anyway: excluded from the microfinance credit AND not added to SM (tracked only for reporting).
        #   • the residual is offered connection loans of `principal = connection fee` (default = SM capex): a
        #     household connects if it can service the loan (MICROFINANCE); if it can only service a smaller one,
        #     the MEANS-BASED GRANT (`grant_total` pool) buys the principal down to what it can afford.
        # Gated by afford_enabled → no effect in the BAU pass, so the BAU counterfactual is untouched.
        loan_fee = connection_fee if connection_fee > 0 else cost_sm_t[t]
        in_window = (not afford_start or afford_start <= years[t] <= afford_end)
        if ff > 0 and np.isfinite(sm_cap[t]) and in_window and afford_enabled:
            gap_target = max(0.0, sm_cap[t] - budget_sm)
            new_gap = gap_target - gap_served_hw
            if new_gap > 1e-15:
                gap_served_hw = gap_target
                bracket_gap = [new_gap * max(0.0, float(gs)) for gs in afford_gap_shares]
                # Self-financers (isolated): the top `selffin_share` of the new gap, richest bracket first.
                if selffin_share > 0:
                    to_remove = new_gap * selffin_share
                    for b in range(len(bracket_gap) - 1, -1, -1):      # richest (last) → poorest
                        take = min(bracket_gap[b], to_remove)
                        bracket_gap[b] -= take; selffin_flow[t] += take; to_remove -= take
                        if to_remove <= 1e-15:
                            break
                    selffin_cum += selffin_flow[t]
                # Microfinance + grant on the residual (loan-needing) new gap.
                mf_hh, grant_hh, grant_spent, mf_loan = affordability_close(
                    bracket_gap, loan_fee, pct_income=afford_pct_income, interest=afford_interest,
                    tenor=afford_tenor, partial_share=afford_partial_share,
                    upfront_payable_ratio=afford_upfront_payable_ratio,
                    bracket_income_monthly=afford_bracket_income, takeup=afford_takeup,
                    grant_enabled=grant_enabled, grant_pool=grant_pool_left)
                mf_cum += mf_hh; grant_cum += grant_hh; grant_pool_left -= grant_spent
                mf_flow[t] = mf_hh; grant_flow[t] = grant_hh
                grant_spend_flow[t] = grant_spent; mf_loan_flow[t] = mf_loan
        # Total SM = budget + microfinance/grant connections (self-financers are ISOLATED, not added). Capped at
        # the SM target; the cap only engages when NRW or the lever is active so the pure-BAU pass is unchanged.
        sm_total = budget_sm + mf_cum + grant_cum
        sm_level = min(sm_total, sm_cap[t]) if (nrw_enabled or afford_enabled) else sm_total
        if True:
            # ── Explicit named flows ───────────────────────────────────────────────────────────────────
            # Households move between NAMED rungs instead of being redistributed by a proportional squeeze.
            # The safely-managed flow is read off the level change, so every lever that raises SM (budget,
            # NRW upgrades, microfinance, grants) is carried through automatically. Basic gains what was
            # bought for it and loses what moved up to safely managed. The three lower rungs give up the
            # basic purchases pro rata, then absorb the residual (population growth) in the same
            # proportions, which is what keeps the five rungs summing to total households.
            sm_flow = max(0.0, sm_level - bau[0, t - 1])
            prev_lower = [max(0.0, bau[r, t - 1]) for r in LOWER]
            psum = sum(prev_lower)
            for j, r in enumerate(LOWER):
                bau[r, t] = prev_lower[j] - new_basic * ((prev_lower[j] / psum) if psum > 0 else 0.0)
            bau[0, t] = sm_level
            bau[1, t] = max(0.0, bau[1, t - 1] + new_basic - sm_flow)
            resid = total_hh[t] - (bau[0, t] + bau[1, t] + sum(bau[r, t] for r in LOWER))
            lsum = sum(bau[r, t] for r in LOWER)
            for j, r in enumerate(LOWER):
                share = (bau[r, t] / lsum) if lsum > 0 else (1.0 / len(LOWER))
                bau[r, t] = max(0.0, bau[r, t] + resid * share)
            for r in range(5):
                unadj[r] = bau[r, t]                                   # keep the unadjusted vector in step
        # BAU stock roll-forward (final workbook C|Urban Water r29 = X29 + budget − replacement): the
        # existing stock DEPRECIATES and the FULL capex budget is added each year — so an underfunded
        # sector (budget < replacement) sees the stock, and next year's replacement, DECLINE. Independent
        # of the target path (driven by bau_available / bau_replacement, not the target-gap stock).
        bau_stock[t] = bau_stock[t - 1] - bau_replacement[t] + avail

        # Fixed milestones were scheduled before resource-constrained coverage. With no future
        # milestones, retain the legacy unspecified-target behavior (target equals BAU).
        if not tgt_years:
            tgt[:, t] = bau[:, t]

        # Service gaps describe coverage only. Investment needs are calculated after the full target
        # trajectory is known; the standing target-minus-simulated gap is never added to asset stock.
        gap = max(0.0, tgt[0, t] - bau[0, t]); hh_gap[t] = gap
        gap_b = max(0.0, tgt[1, t] - bau[1, t]); hh_gap_basic[t] = gap_b

    # Affordability lever running totals (cumulative over the forecast).
    selffin_upgrade_cum = np.cumsum(selffin_flow)
    mf_upgrade_cum = np.cumsum(mf_flow)
    grant_upgrade_cum = np.cumsum(grant_flow)
    grant_spend_cum = np.cumsum(grant_spend_flow)
    mf_loan_cum = np.cumsum(mf_loan_flow)

    # 4d — target investment programme. The target asset stock is hypothetical and independent of the
    # resource-constrained BAU/intervention coverage path. Annual target transitions are costed once;
    # replacement is the straight-line allowance on the prior target stock (a simplified approximation).
    target_program = target_transition_capex(
        tgt[0], tgt[1], cost_sm_t, cost_basic_t, nonhh_mult,
        implementation_capex=implementation_capex, capex_adder=capex_adder,
        baseline_index=bi, total_households=total_hh)
    asset_program = annual_asset_requirements(
        target_program['expansion'], opening_stock, depr, baseline_index=bi,
        expansion_by_service=[target_program['expansion_sm'], target_program['expansion_basic']],
        opening_assets_by_service=[opening_sm, max(0.0, opening_stock - opening_sm)],
        implementation_capex=implementation_capex, service_households=tgt[:2],
        service_upgrades=target_program['sm_upgrades'],
        service_downgrades=target_program['sm_downgrades'])
    new_capex_total = target_program['expansion']
    new_capex_by_service = np.asarray(
        [target_program['expansion_sm'], target_program['expansion_basic']], dtype=float)
    replacement = asset_program['replacement']
    replacement_by_service = asset_program['replacement_by_service']
    stock = asset_program['target_asset_stock']
    need_stock_by_service = asset_program['target_asset_stock_by_service']
    total_need = asset_program['total_need']

    # Household microfinance and means-based grants are other capital sources, not utility operating cash.
    other_capital = mf_loan_flow + grant_spend_flow
    public_capital = bau_available + financial_cash + injection_cash
    bs = borrowing_settings or {}
    streams = {
        'collection': collection_cash, 'tariff': tariff_cash,
        'nrw': nrw_commercial_cash + nrw_service_cash + nrw_production_savings - nrw_maintenance_cost,
        'custom': custom_revenue_arr, 'nrw_link': extra_cash_arr,
    }
    selected = list(bs.get('cash_streams', streams.keys()))
    if len(set(selected)) != len(selected) or any(key not in streams for key in selected):
        raise ValueError("Borrowing eligible cash streams must be unique recognised intervention streams.")
    eligible_cash = sum((streams[key] for key in selected), np.zeros(n))
    # Selecting positive receipts must not hide the same entity's negative
    # intervention cash effects. This changes eligibility, not the cash account:
    # total utility cash already contains those costs exactly once.
    eligible_cash += sum((np.minimum(0, value) for key, value in streams.items()
                          if key not in selected), np.zeros(n))
    loan = _loan_override if _loan_override is not None else loan_schedule(
        years, bi, total_need, public_capital, other_capital, eligible_cash,
        float(bs.get('cash_allocation_alpha', 0.0) or 0.0),
        enabled=borrowing_enabled,
        drawdown_year=int(bs.get('drawdown_year', 0) or 0),
        interest_rate=float(bs.get('interest_rate', 0.0) or 0.0),
        term_years=int(bs.get('term_years', 0) or 0),
        minimum_dscr=float(bs.get('minimum_dscr', 1.0) or 1.0),
        borrowing_ceiling=float(bs.get('borrowing_ceiling', 0.0) or 0.0),
        existing_debt_service=(float(bs.get('existing_debt_service', 0.0) or 0.0)
                               if borrowing_enabled else 0.0),
        total_cash=additional_net_utility_cash,
        price_index=ctx.get('debt_price_index', np.ones(n)),
        inflation_rate=float(ctx.get('inflation_local', np.zeros(n))[-1]),
        rate_basis=bs.get('rate_basis', 'real'),
        contracted_principal=float(bs.get('contracted_principal', 0.0) or 0.0))
    sector_name = bs.get('sector', 'water')
    area_name = ctx.get('borrowing_area', 'Selected area')
    pool = {
        'enabled': bool(borrowing_enabled),
        'entity_name': bs.get('entity_name') or f"{area_name} — {sector_name}",
        'sector': sector_name, 'area': area_name, 'eligible_streams': selected,
        'baseline_obligations_known': bool(bs.get('baseline_obligations_known', False)),
        'capacity_label': ("Incremental estimate with entered baseline obligations; not a full credit assessment."
                           if bs.get('baseline_obligations_known', False) else
                           "Incremental estimate conditional on baseline obligations being covered; not a full credit assessment."),
        'rate_basis': bs.get('rate_basis', 'real'),
        'loan_principal': loan['loan_principal'], 'loan_end_year': loan['loan_end_year'],
        'automatic_capacity': loan['automatic_capacity'], 'is_fixed_contract': loan['is_fixed_contract'],
        'projection_end_year': int(years[-1]),
        'outstanding_at_projection_end': loan['outstanding_at_projection_end'],
        'post_horizon_assumption': (
            "Established intervention cash and entered prior debt service held flat in real terms after "
            "the projection; local inflation held at its final projected rate. No revenue from loan-funded connections."),
        'reserve_policy': ("Committed cash exceeds or falls short of scheduled debt service through a separate "
                           "zero-interest reserve. Reserves pay debt, never direct investment, until released at maturity "
                           "after obligations. Unpaid interest accrues in outstanding debt; no automatic refinancing."),
        'schedule': loan['schedule'],
    }
    ledger = funding_ledger(
        total_need, public_capital, other_capital,
        loan['cash_allocated_to_direct_investment'], baseline_index=bi,
        loan_drawdowns=loan['drawdowns'])
    # Compare explicit public contributions using a second fully reconciled carry path.
    # Hold the scenario's other financing and loan allocations fixed, not its carried cash.
    additional_public_capital = financial_cash + injection_cash
    before_public = funding_ledger(
        total_need, bau_available, other_capital,
        loan['cash_allocated_to_direct_investment'], baseline_index=bi,
        loan_drawdowns=loan['drawdowns'])
    available_total = ledger['available']
    financing_gap = ledger['gap']
    cumulative_requirement = ledger['cumulative_requirement']
    cumulative_financing_gap = ledger['cumulative_gap']
    outputs = {
        'collection_efficiency': intervention_output(n, revenue=collection_cash),
        'tariff_reform': intervention_output(n, revenue=tariff_cash),
        'nrw': intervention_output(
            n, revenue=nrw_commercial_cash + nrw_service_cash,
            savings=nrw_production_savings, operating_costs=nrw_maintenance_cost,
            implementation=nrw_implementation,
            physical={
                'water_for_service_million_m3': nrw_recovered_phys,
                'water_production_avoided_million_m3': nrw_production_avoided_vol,
                'commercial_billing_recovered_million_m3': nrw_commercial_vol,
                'funded_upgrades_million_hh': np.diff(nrw_upgrade_cum, prepend=0.0),
            }),
        'custom': intervention_output(n, revenue=custom_revenue_arr,
                                      implementation=custom_implementation_arr),
        'nrw_link': intervention_output(n, revenue=extra_cash_arr),
    }

    # Implementation capex is included in the sector-wide gap. Attribute it across service levels in
    # proportion to scheduled expansion (or 50/50 when there is no expansion) so the service components
    # still reconcile exactly to the total.
    implementation_by_service = np.zeros((2, n))
    for t in range(bi + 1, n):
        expansion_sum = new_capex_by_service[:, t].sum()
        shares = (new_capex_by_service[:, t] / expansion_sum
                  if expansion_sum > 0 else np.array([0.5, 0.5]))
        implementation_by_service[:, t] = max(0.0, implementation_capex[t]) * shares
        sm_gap, basic_gap, sm_paid, basic_paid = attribute_gap(
            new_capex_by_service[0, t] + implementation_by_service[0, t],
            new_capex_by_service[1, t] + implementation_by_service[1, t],
            replacement_by_service[0, t], replacement_by_service[1, t],
            available_total[t], basic_share)
        financing_gap_by_service[0, t] = sm_gap
        financing_gap_by_service[1, t] = basic_gap
        funded_by_service[0, t] = sm_paid
        funded_by_service[1, t] = basic_paid

    service_gap_raw = tgt - bau
    scenario_service_gap = np.maximum(0.0, service_gap_raw)

    return {
        '_loan_schedule': loan,
        'borrowing_pools': [pool],
        'eligible_net_cash': loan['eligible_net_cash'].tolist(),
        'existing_debt_service_paid': loan['existing_debt_service_paid'].tolist(),
        'loan_reserve_used': loan['reserve_used'].tolist(),
        'loan_reserve_release': loan['reserve_release'].tolist(),
        'loan_debt_service_paid': loan['debt_service_paid'].tolist(),
        'rungs': RUNGS,
        'cost_per_hh': cost_sm,
        'cost_basic': cost_basic,
        'hist_cagr': cagr,
        'capex_budget': capex_budget.tolist(),
        'allocated_capex': allocated_capex.tolist(),
        'actual_capex': actual_capex.tolist(),
        'execution_rate': exec_eff,
        'planned_annual': planned_annual.tolist(),
        'bau_available': bau_available.tolist(),
        'available_total': available_total.tolist(),
        'collection_cash': collection_cash.tolist(),
        'tariff_cash': tariff_cash.tolist(),
        'shared_revenue_cash': shared_revenue_cash.tolist(),
        'billed_volume': billed_volume.tolist(),
        'public_capital': public_capital.tolist(),
        'other_capital': other_capital.tolist(),
        'additional_net_utility_cash': additional_net_utility_cash.tolist(),
        'cash_allocated_to_direct_investment': loan['cash_allocated_to_direct_investment'].tolist(),
        'cash_committed_to_debt': loan['cash_committed_to_debt'].tolist(),
        'loan_drawdown': loan['drawdowns'].tolist(),
        'loan_principal': loan['loan_principal'],
        'loan_end_year': loan['loan_end_year'],
        'loan_opening_debt': loan['opening_debt'].tolist(),
        'loan_closing_debt': loan['closing_debt'].tolist(),
        'loan_interest': loan['interest'].tolist(),
        'loan_principal_paid': loan['principal'].tolist(),
        'loan_debt_service': loan['debt_service'].tolist(),
        'loan_debt_service_shortfall': loan['debt_service_shortfall'].tolist(),
        'loan_cash_reserve': loan['retained_cash_reserve'].tolist(),
        'available_before_borrowing': ledger['available_before_explicit_public'].tolist(),
        'financing_gap_before_borrowing': ledger['gap_before_explicit_public'].tolist(),
        'cash_carry_forward': ledger['cash_carry_forward'].tolist(),
        'cash_opening': ledger['opening_cash'].tolist(),
        'current_year_financing': ledger['fresh_financing'].tolist(),
        'funded_investment': ledger['financing_applied'].tolist(),
        'financing_cash_deficit': ledger['financing_cash_deficit'].tolist(),
        'cash_drawn_from_carry': ledger['cash_drawn_from_carry'].tolist(),
        'cash_added_to_carry': ledger['cash_added_to_carry'].tolist(),
        'cumulative_new_financing': ledger['cumulative_new_financing'].tolist(),
        'cumulative_financing_applied': ledger['cumulative_financing_applied'].tolist(),
        'cash_carry_policy': 'Zero opening programme cash; unused financing carried forward without interest; no retroactive offset of annual shortfalls; no automatic backlog rescheduling.',
        'financial_commitment_cash': financial_cash.tolist(),  # GDP target + annual growth
        'exogenous_injection_cash': injection_cash.tolist(),   # separately attributable effective capex
        'nrw_net': nrw_net.tolist(),
        'nrw_recovered_phys_vol': nrw_recovered_phys.tolist(),
        'nrw_recovered_phys_total_vol': nrw_recovered_phys_total.tolist(),
        'nrw_commercial_recovered_vol': nrw_commercial_vol.tolist(),
        'nrw_commercial_cash': nrw_commercial_cash.tolist(),
        'nrw_service_cash': nrw_service_cash.tolist(),
        'nrw_production_avoided_vol': nrw_production_avoided_vol.tolist(),
        'nrw_potential_upgrade_hh': nrw_potential_upgrade_cum.tolist(),
        'intervention_outputs': outputs,
        'billed_volume_bau': billed_volume.tolist(),
        'billed_volume_scenario': billed_volume_scenario.tolist(),
        'tariff_path': tariff_scenario.tolist(),
        'collection_path': collection_scenario.tolist(),
        'revenue_attribution_order': 'Collection at BAU volume/tariff; NRW recovered billing and physical-service sales at BAU tariff and scenario collection; tariff at full scenario volume and collection.',
        'nrw_production_savings': nrw_production_savings.tolist(),
        'nrw_maintenance_cost': nrw_maintenance_cost.tolist(),
        'nrw_implementation_capex': nrw_implementation.tolist(),
        'nrw_service_upgrade_capex': nrw_service_upgrade_capex.tolist(),
        'implementation_capex': implementation_capex.tolist(),
        'nrw_link_cash': extra_cash_arr.tolist(),
        'custom_revenue_cash': custom_revenue_arr.tolist(),
        'custom_implementation_capex': custom_implementation_arr.tolist(),
        'nrw_upgrade_hh': nrw_upgrade_cum.tolist(),    # cumulative basic→SM upgrades from recovered water (M HH)
        'selffinance_upgrade_hh': selffin_upgrade_cum.tolist(),  # cumulative self-financed SM connections (M HH)
        'mf_upgrade_hh': mf_upgrade_cum.tolist(),      # cumulative microfinance-alone SM connections (M HH)
        'grant_upgrade_hh': grant_upgrade_cum.tolist(),# cumulative grant-enabled SM connections (M HH)
        'grant_spend': grant_spend_cum.tolist(),       # cumulative means-based grant spend (LC millions)
        'mf_loan_volume': mf_loan_cum.tolist(),        # cumulative microfinance loan volume mobilised (LC millions)
        'budget_used': used_budget.tolist(),           # capital that becomes service (drives baseline BAU)
        'budget_allocated': allocated.tolist(),        # allocated capital budget (manual input, ≥ used)
        'capex_efficiency_baseline': e0_auto,          # baseline efficiency = used ÷ allocated (=1/mean exec ratio)
        'capex_efficiency': eff.tolist(),              # per-year efficiency actually applied
        # Per-year EFFECTIVE safely-managed connection cost, after the cost-side levers' factor. In the
        # BAU pass cf is all-1.0 so this is just cost_sm repeated; in a scenario pass it carries the
        # capex-efficiency / optimised-technology discount. Exported so the deck can price each
        # cost-side lever as (BAU unit cost − scenario unit cost) × households connected, rather than
        # re-deriving the ramp outside the engine where it would drift from this logic.
        'cost_sm_t': cost_sm_t.tolist(),
        'cost_basic_t': cost_basic_t.tolist(),
        'bau_hh': bau.tolist(),
        'target_hh': tgt.tolist(),
        'target_service_shares': np.divide(tgt, total_hh, out=np.zeros_like(tgt), where=total_hh > 0).tolist(),
        'target_new_sm_connections': target_program['new_sm_connections'].tolist(),
        'target_new_basic_connections': target_program['new_basic_connections'].tolist(),
        'target_sm_upgrades': target_program['sm_upgrades'].tolist(),
        'target_sm_downgrades': target_program['sm_downgrades'].tolist(),
        # Reference for the GDP-target commitment input. This is the baseline
        # share of the TOTAL-spending series the commitment compares against,
        # not the capex budget (which can be cost-derived in from_cost mode).
        'baseline_bau_total_spending_share': (
            float(full_budget_in[bi] / ctx['gdp_real_local'][bi])
            if ctx['gdp_real_local'][bi] > 0 else None
        ),
        'opening_stock': opening_stock,
        'target_asset_stock': stock.tolist(),
        'target_asset_stock_by_service': need_stock_by_service.tolist(),
        'target_asset_transfer_to_sm': asset_program['target_asset_transfer_to_sm'].tolist(),
        'bau_asset_stock': bau_stock.tolist(),
        'replacement_method': 'Simplified annual allowance: prior scheduled target asset value / asset life; no cohort renewal timing.',
        'household_gap': hh_gap.tolist(),
        'household_gap_basic': hh_gap_basic.tolist(),
        'scenario_service_gap': scenario_service_gap.tolist(),
        'service_gap_raw': service_gap_raw.tolist(),
        'service_gap_display': scenario_service_gap.tolist(),
        'terminal_service_gap': service_gap_raw[:, -1].tolist(),
        'terminal_unmet_service_gap': scenario_service_gap[:, -1].tolist(),
        'programme_investment_requirement': float(cumulative_requirement[-1]),
        'programme_financing_shortfall': float(cumulative_financing_gap[-1]),
        'new_capex_total': new_capex_total.tolist(),
        'new_capex_by_service': new_capex_by_service.tolist(),
        'implementation_capex_by_service': implementation_by_service.tolist(),
        'replacement_capex': replacement.tolist(),
        'replacement_by_service': replacement_by_service.tolist(),
        'bau_replacement_capex': bau_replacement.tolist(),
        'total_investment_need': total_need.tolist(),
        'cumulative_investment_requirement': cumulative_requirement.tolist(),
        'financing_gap': financing_gap.tolist(),
        'cumulative_financing_gap': cumulative_financing_gap.tolist(),
        'financing_gap_before_additional_public': before_public['gap'].tolist(),
        'available_before_additional_public': before_public['available'].tolist(),
        'additional_public_capital': additional_public_capital.tolist(),
        'cumulative_residual_public_before': before_public['cumulative_gap'].tolist(),
        'cumulative_residual_public_after': ledger['cumulative_gap'].tolist(),
        'funded_by_service': funded_by_service.tolist(),
        'financing_gap_by_service': financing_gap_by_service.tolist(),
    }


def _target_points(tgt_inputs, per):
    """test2: the target list the engine consumes — an explicit N-target list when present, else the
    two legacy target1/target2 sets pinned to the period's target years."""
    if getattr(tgt_inputs, 'targets', None):
        return [(tp.year, list(tp.shares)) for tp in tgt_inputs.targets]
    return None


def calculate_water_supply(inputs, ctx):
    sl, wt, wc = inputs.water_service, inputs.water_targets, inputs.water_costs
    nrw = inputs.water_interventions
    b = inputs.wss_budget
    cost_sm = cost_with_treatment(wc)
    # ── Capital-efficiency intervention (toggle ws_capital_efficiency_enabled): capex efficiency =
    # budget used ÷ budget (execution). sector_bau auto-computes the historical baseline and, when this
    # toggle is on, ramps it to capeff_target_pct between capeff_start_year and capeff_target_year — the
    # improved efficiency lets the same budget build more connections. Off (BAU pass) → baseline only. ──
    tog = getattr(inputs, 'toggles', None)
    capeff_on = bool(getattr(tog, 'ws_capital_efficiency_enabled', False)) if tog is not None else False
    ce_on = bool(getattr(tog, 'ws_collection_efficiency_enabled', False)) if tog is not None else False
    tariff_on = bool(getattr(tog, 'ws_tariff_enabled', False)) if tog is not None else False
    nrw_on = bool(getattr(tog, 'ws_nrw_enabled', False)) if tog is not None else False
    mf_on = bool(getattr(tog, 'ws_microfinance_enabled', False)) if tog is not None else False
    financial_on = bool(getattr(tog, 'ws_financial_commitment_enabled', False)) if tog is not None else False
    injection_on = bool(getattr(tog, 'ws_exogenous_injection_enabled', False)) if tog is not None else False
    borrowing_on = bool(getattr(tog, 'ws_borrowing_enabled', False)) if tog is not None else False
    # Two cost-side levers (test2) → a per-year SM cost factor via sector_bau's cost_factor hook. Both are
    # gated by their own toggle, so the BAU pass (all toggles off) keeps cost_factor = 1.0 and is unchanged.
    costeff_on = bool(getattr(tog, 'ws_costeff_enabled', False)) if tog is not None else False
    techmix_on = bool(getattr(tog, 'ws_techmix_enabled', False)) if tog is not None else False
    cost_factor = build_cost_factor(
        ctx, inputs.period, cost_sm,
        costeff_on=costeff_on,
        costeff_start=int(getattr(nrw, 'costeff_start_year', 0) or 0),
        costeff_target_year=int(getattr(nrw, 'costeff_target_year', 0) or 0),
        costeff_current=float(getattr(nrw, 'costeff_current_pct', 0.0) or 0.0),
        costeff_target=float(getattr(nrw, 'costeff_target_pct', 0.0) or 0.0),
        techmix_on=techmix_on,
        techmix_start=int(getattr(nrw, 'techmix_start_year', 0) or 0),
        techmix_sm_cost=float(getattr(nrw, 'techmix_sm_cost', 0.0) or 0.0))
    # Basic gets its own factor: the same capex-efficiency discount (a procurement gain applies to both
    # rungs) but the basic rung's OWN technology-mix step, priced off the basic base cost.
    cost_basic_base = cost_no_treatment(wc)
    cost_factor_basic = build_cost_factor(
        ctx, inputs.period, cost_basic_base,
        costeff_on=costeff_on,
        costeff_start=int(getattr(nrw, 'costeff_start_year', 0) or 0),
        costeff_target_year=int(getattr(nrw, 'costeff_target_year', 0) or 0),
        costeff_current=float(getattr(nrw, 'costeff_current_pct', 0.0) or 0.0),
        costeff_target=float(getattr(nrw, 'costeff_target_pct', 0.0) or 0.0),
        techmix_on=techmix_on,
        techmix_start=int(getattr(nrw, 'techmix_start_year', 0) or 0),
        techmix_sm_cost=float(getattr(nrw, 'techmix_basic_cost', 0.0) or 0.0))
    # Route custom revenue and implementation costs separately; a cost reduction can target
    # SM, Basic, or both without leaking the SM technology cost into the Basic unit cost.
    cust_revenue, cust_implementation, cust_cf_sm, cust_cf_basic = custom_streams(
        ctx, inputs.period, cost_sm, cost_basic_base,
        getattr(inputs, 'custom_interventions', None) or [], 'water')
    cost_factor = cost_factor * cust_cf_sm
    cost_factor_basic = cost_factor_basic * cust_cf_basic
    bracket_income = [br.income_monthly for br in inputs.income_distribution.brackets]
    # Billed volume base: MLD → million m³/yr. One exogenous tariff-volume input drives tariff
    # and collection cash so the combined revenue change reconciles exactly.
    _mld_to_m3 = inputs.constants.days_in_year / inputs.constants.cubic_meter_liters
    tariff_vol_base_m3 = float(getattr(nrw, 'tariff_volume_mld', 0.0) or 0.0) * _mld_to_m3
    # NRW: system input volume in million m³/yr (for value & upgrades) and m³/day (for the fixing capex).
    nrw_sys_mld = float(getattr(nrw, 'nrw_system_input_vol', 0.0) or 0.0)
    nrw_vol_m3yr = nrw_sys_mld * _mld_to_m3
    nrw_vol_m3day = nrw_sys_mld * inputs.constants.thousand      # 1 MLD = 1000 m³/day
    # WATER adder (G168 × G173 × G174 × G175): cost × treatment%capex × current-NRW% × physical-loss%
    capex_adder = cost_sm * nrw.nrw_treatment_cost_pct_capex * nrw.nrw_current_pct * nrw.nrw_physical_loss_pct
    src = getattr(b, 'budget_source', None) or b.budget_input_mode
    full_budget = sector_full_budget(ctx, budget_pct=b.ws_budget_pct_gdp,
        direct_series=b.ws_budget_direct, direct_ongoing=b.ws_budget_direct_ongoing, mode=b.budget_input_mode)
    # Water capex share of the water budget (workbook G321 = 0.21); falls back to the shared capex%.
    ws_capex = b.ws_capex_pct if b.ws_capex_pct is not None else b.capex_pct_budget
    res = sector_bau(
        ctx, period=inputs.period,
        pct_start=[sl.pct_serv1_start, sl.pct_serv2_start, sl.pct_serv3_start, sl.pct_serv4_start, sl.pct_serv5_start],
        pct_base=[sl.pct_serv1_baseline, sl.pct_serv2_baseline, sl.pct_serv3_baseline, sl.pct_serv4_baseline, sl.pct_serv5_baseline],
        hist_series=[getattr(sl, f'serv{i+1}_ts', None) for i in range(5)],
        first_year_idx=(int(sl.bau_first_year) - inputs.period.model_start_year) if getattr(sl, 'bau_first_year', 0) else 0,
        tgt1=[wt.target1_serv1, wt.target1_serv2, wt.target1_serv3, wt.target1_serv4, wt.target1_serv5],
        tgt2=[wt.target2_serv1, wt.target2_serv2, wt.target2_serv3, wt.target2_serv4, wt.target2_serv5],
        targets=_target_points(wt, inputs.period),
        cost_sm=cost_sm, cost_basic=cost_no_treatment(wc),
        cost_factor=cost_factor,                               # test2: capex-efficiency + optimised-technology + custom cost cuts
        cost_factor_basic=cost_factor_basic,
        basic_share=float(getattr(nrw, 'basic_share', 0.0) or 0.0),
        financial_enabled=financial_on,
        injection_enabled=injection_on,
        borrowing_enabled=borrowing_on,
        borrowing_settings={
            'cash_allocation_alpha': getattr(nrw, 'cash_allocation_alpha', 0.0),
            'drawdown_year': getattr(nrw, 'borrow_drawdown_year', 0),
            'interest_rate': getattr(nrw, 'borrow_interest_rate', 0.0),
            'term_years': getattr(nrw, 'borrow_term_years', 0),
            'minimum_dscr': getattr(nrw, 'borrow_min_dscr', 1.0),
            'borrowing_ceiling': getattr(nrw, 'borrow_ceiling', 0.0),
            'existing_debt_service': getattr(nrw, 'existing_debt_service', 0.0),
            'entity_name': nrw.borrow_entity_name, 'cash_streams': nrw.borrow_cash_streams,
            'rate_basis': nrw.borrow_rate_basis, 'baseline_obligations_known': nrw.baseline_obligations_known,
            'contracted_principal': nrw.borrow_contract_principal, 'sector': 'water',
        },
        financial_settings={
            'gdp_enabled': nrw.fin_gdp_enabled, 'gdp_start_year': nrw.fin_gdp_start_year,
            'gdp_target_share': nrw.fin_gdp_target_share,
            'growth_enabled': nrw.fin_growth_enabled, 'growth_rate': nrw.fin_growth_rate,
            'growth_start_year': nrw.fin_growth_start_year, 'growth_end_year': nrw.fin_growth_end_year,
            'injection_enabled': nrw.fin_injection_enabled, 'injection_mode': nrw.fin_injection_mode,
            'injection_amount': nrw.fin_injection_amount, 'injection_start_year': nrw.fin_injection_start_year,
            'injection_end_year': nrw.fin_injection_end_year,
        },
        financial_execution_rate=b.execution_rate,
        custom_revenue=cust_revenue,
        custom_implementation_capex=cust_implementation,
        full_budget=full_budget, capex_pct=ws_capex,
        growth_capex_pct=ws_capex,                             # water 4a uses the water CAPEX budget (I!326)
        hist_all_proportional=True,                            # water history I!143-147 = all-proportional
        target_adjusted=True,                                  # water targets use the adjusted block r129-133
        planned_list=inputs.planned_investments.ws_planned,
        nonhh_pct=inputs.technical.ws_non_hh_pct, asset_life=inputs.technical.ws_asset_life,
        capex_adder=capex_adder,
        # Execution rate applies only in %GDP mode; in direct mode the entered series is already the
        # actual spend, so execution is 1.0 (no double-count).
        execution_rate=(b.execution_rate if b.budget_input_mode == 'pct_gdp' else 1.0),
        budget_source=src, budget_override=b.ws_budget_direct, gdp_real=ctx['gdp_real_local'],
        capeff_enabled=capeff_on,
        capeff_start=int(getattr(nrw, 'capeff_start_year', 0) or 0),
        capeff_target_year=int(getattr(nrw, 'capeff_target_year', 0) or 0),
        capeff_target_pct=float(getattr(nrw, 'capeff_target_pct', 1.0) or 1.0),
        capeff_current_pct=float(getattr(nrw, 'capeff_current_pct', 0.0) or 0.0),
        allocated_series=getattr(b, 'ws_budget_allocated', None),
        # Collection efficiency: ramp collected-ratio current→target, recovered revenue → capex.
        ce_enabled=ce_on,
        ce_start=int(getattr(nrw, 'ce_start_year', 0) or 0),
        ce_target_year=int(getattr(nrw, 'ce_target_year', 0) or 0),
        ce_current_ratio=float(getattr(nrw, 'ce_current_ratio', 0.0) or 0.0),
        ce_target_ratio=float(getattr(nrw, 'ce_target_ratio', 0.0) or 0.0),
        ce_tariff=float(getattr(nrw, 'ce_current_tariff', 0.0) or 0.0),
        # Volume anchor + growth: default anchor is the CE start year; growth None → scale with population.
        ce_vol_anchor_year=int(getattr(nrw, 'ce_start_year', 0) or 0),
        ce_vol_growth=(float(nrw.ce_vol_growth) if getattr(nrw, 'ce_vol_growth', None) is not None else None),
        # Tariff reform: ramp tariff current→target, extra revenue → capex for new service.
        tariff_enabled=tariff_on,
        tariff_start=int(getattr(nrw, 'tariff_start_year', 0) or 0),
        tariff_target_year=int(getattr(nrw, 'tariff_target_year', 0) or 0),
        tariff_current=float(getattr(nrw, 'tariff_current', 0.0) or 0.0),
        tariff_target=float(getattr(nrw, 'tariff_target', 0.0) or 0.0),
        tariff_volume_base_m3=tariff_vol_base_m3,
        # NRW reduction: recovered physical water → basic→SM upgrades (capped at target); money ledger
        # (value − fixing cost) → avail. Water-only lever.
        nrw_enabled=nrw_on,
        nrw_start=int(getattr(nrw, 'nrw_start_year', 0) or 0),
        nrw_target_year=int(getattr(nrw, 'nrw_target_year', 0) or 0),
        nrw_current=float(getattr(nrw, 'nrw_current_pct', 0.0) or 0.0),
        nrw_target=float(getattr(nrw, 'nrw_target_pct', 0.0) or 0.0),
        nrw_physical=float(
            0.5 if getattr(nrw, 'nrw_physical_loss_pct', None) is None
            else getattr(nrw, 'nrw_physical_loss_pct')),
        nrw_commercial=float(
            0.5 if getattr(nrw, 'nrw_commercial_loss_pct', None) is None
            else getattr(nrw, 'nrw_commercial_loss_pct')),
        nrw_service_share=float(
            0.5 if getattr(nrw, 'nrw_service_allocation_pct', None) is None
            else getattr(nrw, 'nrw_service_allocation_pct')),
        nrw_vol_m3yr=nrw_vol_m3yr,
        nrw_vol_m3day=nrw_vol_m3day,
        nrw_water_per_upgrade=float(getattr(nrw, 'nrw_water_per_upgrade', 0.0) or 0.0),
        nrw_tariff=float(getattr(nrw, 'nrw_tariff', 0.0) or 0.0),
        nrw_production_cost=float(getattr(nrw, 'nrw_production_cost', 0.0) or 0.0),
        nrw_maintenance_annual=float(getattr(nrw, 'nrw_maintenance_cost_annual', 0.0) or 0.0),
        nrw_capex_unit_m3day=float(getattr(nrw, 'nrw_capex_unit_cost_local', 0.0) or 0.0),
        nrw_vol_growth=(float(nrw.nrw_vol_growth) if getattr(nrw, 'nrw_vol_growth', None) is not None else None),
        nrw_lag=int(getattr(nrw, 'nrw_lag_years', 0) or 0),
        # Microfinance + means-based grant (affordability lever): finance affordable gap HH with connection
        # loans (mf_on), and buy the loan down for those who can't service it in full (grant_on). Uses the
        # global income distribution + this sector's willingness-to-pay %, loan terms, gap split and grant pool.
        afford_enabled=mf_on,
        grant_enabled=mf_on,
        afford_start=int(getattr(nrw, 'mf_start_year', 0) or 0),
        afford_end=int(getattr(nrw, 'mf_end_year', 0) or 0),
        afford_pct_income=float(getattr(nrw, 'mf_pct_income', 0.0) or 0.0),
        afford_interest=float(getattr(nrw, 'mf_interest_rate', 0.0) or 0.0),
        afford_tenor=int(getattr(nrw, 'mf_tenor', 0) or 0),
        afford_partial_share=float(getattr(nrw, 'mf_partial_share', 0.0) or 0.0),
        afford_upfront_payable_ratio=float(getattr(nrw, 'mf_upfront_payable_ratio', 0.0) or 0.0),
        afford_takeup=float(getattr(nrw, 'mf_takeup_rate', 0.0) or 0.0),
        afford_gap_shares=list(getattr(nrw, 'mf_gap_shares', []) or []),
        afford_bracket_income=bracket_income,
        afford_grant_total=float(getattr(nrw, 'grant_total', 0.0) or 0.0),
        selffinance_enabled=mf_on,
        selffinance_share=float(getattr(nrw, 'mf_selffinance_share', 0.0) or 0.0),
        connection_fee=float(getattr(nrw, 'mf_connection_fee', 0.0) or 0.0),
    )
    res['sector'] = 'water'
    res['intervention_outputs']['custom']['unit_cost_adjustments'] = {
        'sm': cust_cf_sm.tolist(), 'basic': cust_cf_basic.tolist(),
    }
    res['intervention_outputs']['capex_efficiency'] = intervention_output(
        ctx['n'], unit_costs={'sm': cost_factor / cust_cf_sm, 'basic': cost_factor_basic / cust_cf_basic})
    return res
