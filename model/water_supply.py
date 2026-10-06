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

from model.gap_attribution import attribute_gap
from model.expansion_ledger import ExpansionLedger
from model.service_gaps import assess_service_gaps, reconcile_expansion_gaps
from model.utility_revenue import collected_revenue, volume_path, number, RevenueInputError
from model.service_history import historical_households, historical_transition_counts
from model.connection_revenue import prepare_connection, annual_connection_cash, DIAGNOSTIC_FIELDS

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


def custom_streams(ctx, period, base_sm_cost, customs, sector):
    """Aggregate the enabled CUSTOM interventions that apply to `sector` ('water'|'sanitation') into a
    (net_cash, cost_factor) pair for sector_bau. Returns (all-0.0, all-1.0) when nothing applies, so the
    BAU pass (the engine clears the list) is untouched; history (year ≤ baseline) is never affected.

      • 'new_revenue'   → per-year NET cash (revenue − spread implementation cost) in LC MILLIONS, added to
        `avail`. cost = implement_cost/cost_years over [start, start+cost_years); revenue = quantity×value
        from output_start_year on; both raw-currency, divided by 1e6 to reach the model's millions.
      • 'cost_reduction'→ a per-year SM-cost multiplier from start_year: (1−effect) for 'pct', or
        (cost−effect)/cost for 'flat'. Multiple reductions compose.

    A custom with sector 'both' applies to both sectors."""
    n, years, by = ctx['n'], ctx['years'], period.baseline_year
    net_cash = np.zeros(n)
    cf = np.ones(n)
    for c in (customs or []):
        if not bool(getattr(c, 'enabled', True)):
            continue
        csec = getattr(c, 'sector', 'both')
        if csec not in (sector, 'both'):
            continue
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
                net_cash[t] += (rev_t - cost_t) / 1_000_000.0        # raw currency → LC millions
        elif ctype == 'cost_reduction':
            start = int(getattr(c, 'start_year', 0) or 0)
            mode = getattr(c, 'cost_effect_mode', 'pct')
            amt = float(getattr(c, 'cost_effect', 0.0) or 0.0)
            for t in range(n):
                y = years[t]
                if y <= by or (start and y < start):
                    continue
                if mode == 'flat':
                    f = ((base_sm_cost - amt) / base_sm_cost) if base_sm_cost > 0 else 1.0
                else:
                    f = 1.0 - amt
                cf[t] *= max(1e-6, f)
    return net_cash, cf


class FinancialCommitmentInputError(ValueError):
    """An enabled spending intervention has an invalid calendar schedule."""


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


def sector_bau(ctx, *, period, pct_start, pct_base, tgt1, tgt2, cost_sm, cost_basic,
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
               nrw_physical=0.5, nrw_vol_m3yr=0.0, nrw_vol_m3day=0.0, nrw_water_per_upgrade=0.0,
               nrw_value_unit=0.0, nrw_capex_unit_m3day=0.0, nrw_vol_growth=None, nrw_lag=0,
               afford_enabled=False, grant_enabled=False, afford_start=0, afford_end=0,
               afford_pct_income=0.0, afford_interest=0.0, afford_tenor=0, afford_partial_share=0.0,
               afford_upfront_payable_ratio=0.0, afford_takeup=0.0, afford_gap_shares=None,
               afford_bracket_income=None, afford_grant_total=0.0,
               selffinance_enabled=False, selffinance_share=0.0, connection_fee=0.0,
                financial_enabled=False, injection_enabled=False, financial_settings=None, financial_execution_rate=None,
                extra_cash=None, eligible_nrw_cash=None, custom_cash=None, revenue_base=None, revenue_volume=None,
                utility_debt_execution=None, full_spending_provided=True, connection_config=None):
    """Shared 4a-4d core. All HH and money values are in MILLIONS; costs in actual currency.

    `full_budget` is the sector's FULL budget per year in real terms, from EITHER %GDP mode
    (GDP_real × budget%) OR direct entry (actual expenditure series). The BAU INVESTMENT that drives
    the model = the capex budget (full_budget × capex_pct) = `bau_available`, for BOTH sectors. The BAU
    additional safely-managed HH each year (4a) =
        (BAU investment − replacement capex) × HH/(HH+non-HH) ÷ SM cost
    so replacement (depreciation of the existing stock) is funded first, and only the household share
    buys new connections. `growth_capex_pct` and `planned_list` are kept for the caller signature but
    are no longer used. NOTE: this deliberately DIVERGES from the reference workbook's BAU (which grew
    SM on the %GDP capex budget alone). The financing gap uses a residual ledger:
    remaining new-service cost + unpaid replacement + negative net cash."""
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
    # Extra per-year capex cash (LC millions) injected into `avail` — a caller-supplied revenue stream on
    # top of the sector's own levers (used by sanitation for the water-NRW-linked sewer revenue). Defaults
    # to all-0.0, so the BAU pass and every other sector are untouched. Only added in the forecast loop.
    extra_cash_arr = np.zeros(n) if extra_cash is None else np.asarray(extra_cash, dtype=float)
    if extra_cash_arr.shape[0] < n:
        extra_cash_arr = np.concatenate([extra_cash_arr, np.zeros(n - extra_cash_arr.shape[0])])
    eligible_nrw_cash_arr = (np.zeros(n) if eligible_nrw_cash is None
                             else np.asarray(eligible_nrw_cash, dtype=float))
    if eligible_nrw_cash_arr.shape[0] < n:
        eligible_nrw_cash_arr = np.concatenate(
            [eligible_nrw_cash_arr, np.zeros(n - eligible_nrw_cash_arr.shape[0])])
    custom_cash_arr = np.zeros(n) if custom_cash is None else np.asarray(custom_cash, dtype=float)
    if custom_cash_arr.shape[0] < n:
        custom_cash_arr = np.concatenate([custom_cash_arr, np.zeros(n - custom_cash_arr.shape[0])])
    debt_execution = utility_debt_execution or {}

    def _debt_array(key):
        values = np.asarray(debt_execution.get(key, np.zeros(n)), dtype=float)
        if values.shape[0] < n:
            values = np.concatenate([values, np.zeros(n - values.shape[0])])
        return values[:n]

    debt_disbursement_arr = _debt_array('disbursement')
    debt_principal_arr = _debt_array('principal_payment')
    debt_interest_arr = _debt_array('interest_payment')
    debt_service_arr = _debt_array('debt_service')
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
    bau, cagr = historical_households(ctx, pct_start, pct_base, hist_series,
                                     first_year_idx, hist_all_proportional)
    # ── Budget finalisation ──────────────────────────────────────────────────────────────────────
    # capex_budget = the capex actually SPENT each forecast year (the BAU investment that funds new
    # connections). For pct_gdp/direct this is full_budget × %capex × execution. For 'from_cost' the
    # budget IS the capital investment, so no further %capex split applies (capex%/execution = 1).
    if budget_source == 'from_cost':
        gdp = np.asarray(gdp_real if gdp_real is not None else ctx['gdp_real_local'], dtype=float)
        # Historical budget follows the forward transition convention: below
        # Basic -> Basic entries and Basic -> SM upgrades. Basic-only stock
        # growth misses entries offset by upgrades; neither decline is refunded.
        hist_budget = np.zeros(n)
        sm_upgrades, basic_entries = historical_transition_counts(
            bau[0, :bi + 1], bau[1, :bi + 1])
        hist_budget[1:bi + 1] = sm_upgrades * cost_sm + basic_entries * cost_basic
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
    commitment_exec = execution_rate if financial_execution_rate is None else financial_execution_rate
    financial_capex_factor = max(0.0, float(capex_pct)) * max(0.0, float(commitment_exec))
    commitment_base = full_budget_in
    spending_reference_source = 'entered_total_spending'
    if budget_source == 'from_cost' and not full_spending_provided:
        # No observed total spending was supplied. Express the existing derived
        # BAU investment as an equivalent total budget using the SAME treatment
        # applied to new commitments; this is an estimate, never observed spending.
        if financial_capex_factor > 0:
            commitment_base = np.asarray(full_budget, dtype=float) / financial_capex_factor
            spending_reference_source = 'cost_derived_equivalent'
        else:
            spending_reference_source = 'unavailable_zero_capex_factor'
    if commitment_base.shape[0] < n:
        commitment_base = np.concatenate([commitment_base, np.zeros(n - commitment_base.shape[0])])
    if financial_enabled or injection_enabled:
        gdp = np.asarray(gdp_real if gdp_real is not None else ctx['gdp_real_local'], dtype=float)
        if financial_enabled and fs.get('gdp_enabled') and int(fs.get('gdp_start_year') or 0) <= 0:
            raise FinancialCommitmentInputError("Enter a positive start year for the GDP spending target.")
        if financial_enabled and fs.get('growth_enabled'):
            start, end = int(fs.get('growth_start_year') or 0), int(fs.get('growth_end_year') or 0)
            if start <= 0 or end < start:
                raise FinancialCommitmentInputError("Annual spending increase needs a positive start year and an end year no earlier than the start year.")
        if injection_enabled:
            start, end = int(fs.get('injection_start_year') or 0), int(fs.get('injection_end_year') or 0)
            if start <= 0 or (fs.get('injection_mode') == 'recurring' and end < start):
                raise FinancialCommitmentInputError("Funding injection needs a positive start year and, when recurring, an end year no earlier than the start year.")
        # The financial levers are defined against TOTAL sector spending even when the BAU connection
        # budget itself is derived from historical service costs. `full_budget_in` preserves that total
        # spending series when supplied, otherwise the explicitly estimated equivalent above.
        # New commitments then pass through the sector's ordinary
        # capex share and execution rate before becoming capital available for connections.
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

    # ── Collection efficiency (test2) ──────────────────────────────────────────────────────────────
    # Better revenue COLLECTION (cash collected ÷ revenue billed) recovers billed-but-uncollected revenue
    # and turns it into extra capital for new connections. The additional collected cash each forecast
    # year = billed_volume × tariff × (collected_ratio[t] − baseline_ratio). Billed volume follows
    # population or configured fixed growth, NEVER new connections. 100% of that cash is added to capex
    # (folded into `avail` in the 4a loop below). Gated by ce_enabled → 0 in the BAU pass, so the BAU
    # counterfactual is unchanged; only the scenario pass (toggle on) moves. The per-year band the UI shows
    # is the marginal scenario SM this adds, attributed by the cumulative-pass diff in LiveInterventionChart.
    if (ce_enabled or tariff_enabled) and (revenue_base is None or revenue_volume is None):
        raise RevenueInputError('Utility reforms require a resolved shared revenue base and billed-volume path.')
    if revenue_base is not None:
        ce_current_ratio = revenue_base['collection_ratio']
        ce_tariff = tariff_current = revenue_base['tariff']
    for enabled, baseline_value, target_value, label, maximum in (
            (ce_enabled, ce_current_ratio, ce_target_ratio, 'Collection target', 1),
            (tariff_enabled, tariff_current, tariff_target, 'Tariff target', None)):
        if enabled or revenue_base is not None:
            target_value = number(target_value, label, maximum)
            if target_value < baseline_value:
                raise RevenueInputError(f'{label} cannot be below the shared baseline.')
    ce_add_ratio = np.zeros(n)                       # collected-ratio uplift vs baseline, per year (≥0)
    if ce_enabled and ce_target_ratio > ce_current_ratio and ce_start:
        for t in range(n):
            y = years[t]
            if y <= by:
                r = ce_current_ratio                 # history / baseline: no uplift
            elif ce_target_year and ce_target_year > ce_start:
                if y >= ce_target_year:
                    r = ce_target_ratio
                elif y >= ce_start:
                    r = ce_current_ratio + (ce_target_ratio - ce_current_ratio) * (y - ce_start) / (ce_target_year - ce_start)
                else:
                    r = ce_current_ratio
            else:
                r = ce_target_ratio if y >= ce_start else ce_current_ratio
            ce_add_ratio[t] = max(0.0, r - ce_current_ratio)
    served_base = bau[0, bi] + bau[1, bi]            # baseline connected (SM+Basic) HHs = billed customer base
    collection_cash = np.zeros(n)                    # additional collected revenue → capex, per forecast year

    # Billed-volume grows off its anchor year. Default = scale with POPULATION (exogenous → no circular
    # dependency on the connections it funds); or a fixed compound growth rate when the user supplies one.
    population = ctx['population']
    def _vol_factor(t, anchor_year, growth):
        ai = int(np.clip((anchor_year or by) - msy, 0, n - 1))
        if growth is not None:
            return (1.0 + float(growth)) ** (years[t] - years[ai])
        pa = population[ai]
        return (population[t] / pa) if pa > 0 else 0.0

    # ── Tariff reform (test2) ────────────────────────────────────────────────────────────────────────
    # Raise the tariff linearly from `tariff_current` to `tariff_target` between tariff_start and
    # tariff_target_year (flat before the start year, held at target after). The extra revenue each
    # forecast year = billed_volume × (tariff[t] − tariff_current) × applicable collection ratio goes into
    # service (folded into `avail` in the 4a loop). Gated by tariff_enabled → 0 in the BAU pass, so the
    # BAU counterfactual is unchanged; only the scenario pass (toggle on) moves.
    tariff_add = np.zeros(n)                          # tariff rise vs current, per year (≥0)
    if tariff_enabled and tariff_target > tariff_current and tariff_start:
        for t in range(n):
            y = years[t]
            if y <= by or y < tariff_start:
                tr = tariff_current                  # history / before the reform: no rise
            elif tariff_target_year and tariff_target_year > tariff_start:
                if y >= tariff_target_year:
                    tr = tariff_target
                else:
                    tr = tariff_current + (tariff_target - tariff_current) * (y - tariff_start) / (tariff_target_year - tariff_start)
            else:
                tr = tariff_target if y >= tariff_start else tariff_current
            tariff_add[t] = max(0.0, tr - tariff_current)
    tariff_cash = np.zeros(n)                         # additional tariff revenue → capex, per forecast year
    billed_volume = np.zeros(n) if revenue_volume is None else np.asarray(revenue_volume)
    baseline_revenue, scenario_revenue, collection_cash, tariff_cash = collected_revenue(
        billed_volume, tariff_current, ce_current_ratio, tariff_add, ce_add_ratio)
    connection_status, connection_runtime = prepare_connection(
        connection_config, revenue_base, ctx, bau)
    revenue_diagnostics = {key: np.zeros(n) for key in DIAGNOSTIC_FIELDS}
    revenue_diagnostics['reference_billed_volume_million_m3'][:] = billed_volume
    revenue_diagnostics['reference_collected_revenue'][:] = baseline_revenue
    revenue_diagnostics['additional_net_cash'][:] = collection_cash + tariff_cash
    revenue_diagnostics['applicable_tariff'][:] = tariff_current + tariff_add
    revenue_diagnostics['applicable_collection_ratio'][:] = ce_current_ratio + ce_add_ratio
    if connection_runtime:
        for t in range(bi + 1):
            row = annual_connection_cash(connection_runtime, bau[0, t], bau[1, t], t,
                                         tariff_current, ce_current_ratio)
            for key in ('connection_billed_households', 'household_billed_volume_million_m3',
                        'nonhousehold_billed_volume_million_m3'):
                revenue_diagnostics[key][t] = row[key]
            if t == bi:
                billed_volume[t] = row['billed_volume_million_m3']
                baseline_revenue[t] = scenario_revenue[t] = row['collected_revenue']
                revenue_diagnostics['reference_billed_volume_million_m3'][t] = billed_volume[t]
                revenue_diagnostics['reference_collected_revenue'][t] = baseline_revenue[t]

    # ── NRW reduction (test2) ───────────────────────────────────────────────────────────────────────
    # Reduce non-revenue water from nrw_current → nrw_target over start→target year. The recovered
    # PHYSICAL water (only leaks free up deliverable water; commercial losses are billing, not new water)
    # upgrades basic households to safely-managed: new SM = recovered_physical ÷ water_per_upgrade. A money
    # ledger nets the water's value (tariff OR avoided production cost, on ALL recovered water) against the
    # cost of fixing (capex on the incremental capacity recovered each year + maintenance). The net folds
    # into `avail` (can be negative → drawn from the BAU budget first; positive → funds new connections).
    # Upgrades are added to SM in the 4a loop and capped at the SM target (so basic never drops below its
    # target). Gated by nrw_enabled → all zero in the BAU pass.
    nrw_reduction = np.zeros(n)                       # NRW percentage-points recovered vs current (≥0)
    nrw_upgrade_cum = np.zeros(n)                     # cumulative basic→SM upgrades (million HH)
    nrw_net = np.zeros(n)                             # money ledger: value − fixing cost, per year (millions)
    nrw_sales_cash = np.zeros(n)
    nrw_implementation_cost = np.zeros(n)
    nrw_recovered_phys = np.zeros(n)                  # recovered PHYSICAL (deliverable) water per year (M m³/yr) —
                                                      # this is the water that becomes wastewater the sanitation
                                                      # sector can charge for (see the san NRW-linked lever).
    if nrw_enabled and nrw_current > nrw_target and nrw_start:
        for t in range(n):
            y = years[t]
            if y <= by or y < nrw_start:
                rate = nrw_current                   # history / before the programme: no reduction
            elif nrw_target_year and nrw_target_year > nrw_start:
                if y >= nrw_target_year:
                    rate = nrw_target
                else:
                    rate = nrw_current + (nrw_target - nrw_current) * (y - nrw_start) / (nrw_target_year - nrw_start)
            else:
                rate = nrw_target if y >= nrw_start else nrw_current
            nrw_reduction[t] = max(0.0, nrw_current - rate)
        # Benefit lag: the recovered water (and its value) shows up nrw_lag years AFTER the works that
        # deliver it, so there is a real delay between spending (fixing capex, charged on the works schedule)
        # and the benefit. Other levers bake this delay into their start year; NRW models it explicitly.
        # lag = 0 reproduces the no-delay behaviour exactly.
        lag = max(0, int(nrw_lag))
        for t in range(n):
            red = nrw_reduction[t]                                   # reduction the WORKS deliver this year (drives capex)
            red_ben = nrw_reduction[t - lag] if t - lag >= 0 else 0.0  # reduction actually IN EFFECT now (works done `lag` ago)
            # System input volume scales off the NRW start year — with POPULATION by default, or a fixed
            # compound rate when nrw_vol_growth is set (same treatment as the collection-efficiency and
            # tariff volumes), so a growing system recovers more water for the same NRW percentage.
            vf = _vol_factor(t, nrw_start, nrw_vol_growth)
            recovered_yr = red_ben * nrw_vol_m3yr * vf               # recovered water now in effect (million m³/yr)
            recovered_phys = nrw_physical * recovered_yr             # only physical losses → deliverable water
            nrw_recovered_phys[t] = recovered_phys                   # exposed so sanitation can charge for it (also lagged)
            nrw_upgrade_cum[t] = (recovered_phys / nrw_water_per_upgrade) if nrw_water_per_upgrade > 0 else 0.0
            value = nrw_value_unit * recovered_yr                    # recurring value of the recovered water
            # Fixing capex tracks the INCREMENTAL recovered capacity on the WORKS schedule (NO lag) — you pay
            # as the losses are cut, and it grows as the system itself grows, so holding the target on a bigger
            # network keeps costing a little.
            cap_now = red * nrw_vol_m3day * vf
            cap_prev = (nrw_reduction[t - 1] * nrw_vol_m3day * _vol_factor(t - 1, nrw_start, nrw_vol_growth)) if t > 0 else 0.0
            capex = nrw_capex_unit_m3day * max(0.0, cap_now - cap_prev) / 1_000_000.0   # millions
            nrw_net[t] = value - capex
            nrw_sales_cash[t] = value
            nrw_implementation_cost[t] = capex

    # Forecast keeps a SELF-CONTAINED unadjusted series (sheet r36-40): each rung compounds from its
    # OWN prior unadjusted value (NOT the rescaled/adjusted prior), seeded at the baseline from the
    # adjusted baseline counts. SM accumulates the budget-funded increase; the others grow at CAGR.
    # The adjusted row (r45-49) is then derived each year: SM kept, lower × total/Σunadj, Basic = plug.
    # 4b prep — target boundary points. test2: ANY number of targets (a sorted list of (year, [5
    # shares])); falls back to the two target1/target2 sets when no list is supplied. Each boundary's
    # COUNTS = that year's total households × share; the path CAGRs between consecutive boundaries.
    eai = int(eay - msy)
    if targets:
        tlist = sorted(((int(ty), list(sh)) for ty, sh in targets if int(ty) > eay), key=lambda x: x[0])
    else:
        tlist = [tp for tp in [(int(t1y), list(tgt1)), (int(t2y), list(tgt2))] if tp[0] > eay]
    tgt_years = [ty for ty, _ in tlist]
    tgt_counts = [[total_hh[int(np.clip(ty - msy, 0, n - 1))] * sh[r] for r in range(5)] for ty, sh in tlist]
    last_tgt_year = tgt_years[-1] if tgt_years else eay
    last_shares = tlist[-1][1] if tlist else [0.0, 0.0, 0.0, 0.0, 0.0]

    # Intervention SM ceiling (protects the basic target): interventions may CLOSE the SM gap but not
    # overshoot it — the ceiling is the target-path SM count, CAGR'd from the baseline SM through the SM
    # target boundaries. inf where there is nothing to protect (history / no targets). Only ever binds in
    # the scenario pass; the BAU SM sits below the target, so the clamp is a no-op there (parity kept).
    sm_cap = np.full(n, np.inf)
    if tgt_years:
        sm_pts = [(eay, bau[0, bi])] + list(zip(tgt_years, [tc[0] for tc in tgt_counts]))
        for t in range(n):
            y = years[t]
            if y <= eay:
                continue
            if y >= last_tgt_year:
                sm_cap[t] = total_hh[t] * last_shares[0]
                continue
            for k in range(1, len(sm_pts)):
                y0, c0 = sm_pts[k - 1]; y1, c1 = sm_pts[k]
                if y <= y1:
                    if c0 > 0 and c1 > 0 and y1 > y0:
                        g = (c1 / c0) ** (1.0 / (y1 - y0)) - 1.0
                        sm_cap[t] = c0 * (1.0 + g) ** (y - y0)
                    else:
                        sm_cap[t] = c1
                    break

    # 4c — opening asset stock (booked at the baseline year)
    opening_stock = (bau[0, bi] * cost_sm + bau[1, bi] * cost_basic) * (1.0 + nonhh_mult)
    opening_sm = bau[0, bi] * cost_sm * (1.0 + nonhh_mult)
    ledger = ExpansionLedger(bau[0, bi], bau[1, bi], n)
    ledger.series['funded_asset_stock'][bi] = opening_stock

    # BAU forecast (4a), targets (4b) and investment need (4d) are computed together in ONE forward
    # pass, because the BAU additional safely-managed HH depend on the BAU replacement capex:
    #     additional HH = (BAU investment − BAU replacement) × HH-share ÷ SM cost
    # BAU investment = bau_available (capex budget); BAU replacement = prior-year BAU-OWN asset stock ×
    # depreciation (performance-improvement years only); HH-share = HH/(HH+non-HH) = 1 − non-HH%. The BAU
    # stock is kept separate from the target `stock` so the BAU never depends on the target (no circularity).
    depr = 1.0 / asset_life
    hh_share = 1.0 - nonhh_pct
    tgt_unadj = np.zeros((5, n)); tgt = np.zeros((5, n))
    hh_gap = np.zeros(n); hh_gap_basic = np.zeros(n); new_capex_total = np.zeros(n); stock = np.zeros(n)
    replacement = np.zeros(n); total_need = np.zeros(n); financing_gap = np.zeros(n)
    available_total = np.zeros(n)  # effective budget plus all signed intervention cash reaching the gap calculation
    replacement_reserved = np.zeros(n); replacement_credit = np.zeros(n)
    unfunded_replacement = np.zeros(n); cash_deficit = np.zeros(n)
    expansion_capital_available = np.zeros(n); connection_purchase_capital = np.zeros(n)
    unallocated_positive_capital = np.zeros(n)
    debt_cash_opening = np.zeros(n); debt_cash_closing = np.zeros(n)
    debt_cash_available = np.zeros(n); debt_investment_used = np.zeros(n)
    debt_cash_balance = 0.0
    cash_deficit_by_service = np.zeros((2, n))
    # Replacement obligations follow gross funded assets, by service.
    # `funded_by_service` remains a compatibility alias for replacement credit only.
    need_stock_by_service = np.zeros((2, n))
    new_capex_by_service = np.zeros((2, n))
    replacement_by_service = np.zeros((2, n))
    funded_by_service = np.zeros((2, n))
    replacement_funding_applied_by_service = np.zeros((2, n))
    financing_gap_by_service = np.zeros((2, n))
    # Compatibility alias for funded stock. Neither alias includes outstanding work.
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
        tgt_unadj[:, t] = bau[:, t]; tgt[:, t] = bau[:, t]
        booked = opening_stock if years[t] == by else 0.0
        stock[t] = booked + (stock[t - 1] if t > 0 else 0.0)
        need_stock_by_service[0, t] = opening_sm if years[t] == by else 0.0
        need_stock_by_service[1, t] = opening_stock - opening_sm if years[t] == by else 0.0
        bau_stock[t] = booked + (bau_stock[t - 1] if t > 0 else 0.0)

    unadj = [bau[r, bi] for r in range(5)]                              # forecast SM accumulates on the baseline count
    seg_cagr = None
    # Affordability-lever SM accounting: `budget_sm` is SM from the budget + NRW only (no levers); the lever
    # cumulatives accumulate on top. `gap_served_hw` = high-water mark of the budget gap already partitioned,
    # so each year only the NEW gap is offered to self-finance / microfinance / grant (shares stay meaningful).
    budget_sm = bau[0, bi]
    selffin_cum = 0.0; mf_cum = 0.0; grant_cum = 0.0; gap_served_hw = 0.0
    for t in range(bi + 1, n):
        ff, pf = ctx['forecast_flag'][t], ctx['perf_flag'][t]
        prior_stock = stock[t - 1]
        # Depreciation starts the FIRST forecast year (baseline+1, e.g. 2026), matching excel2 — which
        # depreciates the existing stock from baseline+1, NOT the later performance-improvement year (2028).
        replacement[t] = prior_stock * depr if ff > 0 else 0.0
        replacement_by_service[0, t] = need_stock_by_service[0, t - 1] * depr if ff > 0 else 0.0
        replacement_by_service[1, t] = replacement[t] - replacement_by_service[0, t]
        # 4a — additional safely-managed HH funded by (BAU investment − replacement), household share only.
        # Both replacement series use the same opening funded assets.
        bau_replacement[t] = bau_stock[t - 1] * depr if ff > 0 else 0.0
        # Collection-efficiency cash: billed volume scales with population (or a fixed growth rate) off
        # its anchor year — exogenous, so it grows with coverage without a circular dependency on the
        # connections it funds.
        # Both utility streams were reconciled on the shared exogenous billed
        # volume above. Baseline revenue is comparison-only, never extra capex.
        # avail = capex budget + collection-efficiency cash + tariff-reform cash + NRW money ledger +
        # extra caller cash (sanitation's water-NRW-linked sewer revenue). The NRW ledger is negative when
        # fixing costs exceed the water's value that year (drawn from the BAU budget first) and positive
        # later (surplus funds new connections). All the lever terms are 0 when their lever is off.
        if connection_runtime:
            row = annual_connection_cash(
                connection_runtime, bau[0, t - 1], bau[1, t - 1], t,
                tariff_current + tariff_add[t], ce_current_ratio + ce_add_ratio[t])
            for key in DIAGNOSTIC_FIELDS:
                revenue_diagnostics[key][t] = row[key]
            billed_volume[t] = row['billed_volume_million_m3']
            baseline_revenue[t] = row['baseline_collected_revenue']
            scenario_revenue[t] = row['collected_revenue']
            collection_cash[t], tariff_cash[t] = row['collection_cash'], row['tariff_cash']
        avail = bau_available[t] + collection_cash[t] + tariff_cash[t] + revenue_diagnostics['connection_net_cash'][t] + nrw_net[t] + financial_cash[t] + injection_cash[t] + extra_cash_arr[t]
        available_total[t] = avail
        debt_cash_opening[t] = debt_cash_balance
        debt_cash_available[t] = max(0.0, debt_cash_balance + debt_disbursement_arr[t])
        cash_after_debt_service = avail - debt_service_arr[t]
        replacement_reserved[t] = min(max(cash_after_debt_service, 0.0), max(bau_replacement[t], 0.0))
        if replacement[t] > 0:
            replacement_funding_applied_by_service[:, t] = (
                replacement_reserved[t] * replacement_by_service[:, t] / replacement[t])
        expansion_capital_available[t] = (
            max(0.0, cash_after_debt_service - replacement_reserved[t]) + debt_cash_available[t])
        # ── Investment split (test2) ───────────────────────────────────────────────────────────────────
        # Replacement is funded first, then the remainder is split: `basic_share` buys BASIC service for
        # households at limited-and-below, the rest buys SAFELY MANAGED for households at basic-and-below.
        # Both flows are drawn from the PRIOR year's counts, so a household cannot climb two rungs and be
        # paid for twice in one year. Money whose source pool is exhausted rolls over to the other rung.
        # basic_share = 0 is the default and reproduces the pre-split single-purchase behaviour exactly.
        invest = (max(0.0, cash_after_debt_service - bau_replacement[t]) + debt_cash_available[t]) * hh_share
        bs = float(np.clip(basic_share, 0.0, 1.0))
        pool_basic = max(0.0, bau[1, t - 1])                            # eligible for a safely-managed upgrade
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
        # Physical upgrades reuse infrastructure, and share the same eligible
        # Basic pool with funded upgrades. Never pay for capped-out connections.
        nrw_upg = max(0.0, nrw_upgrade_cum[t] - nrw_upgrade_cum[t - 1])
        room_sm = max(0.0, sm_cap[t] - bau[0, t - 1]) if (nrw_enabled or afford_enabled) else pool_basic
        nrw_upg = min(nrw_upg, pool_basic, room_sm)
        actual_sm = min(new_sm, max(0.0, min(pool_basic, room_sm) - nrw_upg))
        released = (new_sm - actual_sm) * cost_sm_t[t]
        new_sm = actual_sm
        if cost_basic_t[t] > 0:
            new_basic += min(max(0.0, pool_lower - new_basic), released / cost_basic_t[t])
        # Actual paid purchases, including the corresponding non-household share.
        connection_purchase_capital[t] = (
            (new_sm * cost_sm_t[t] + new_basic * cost_basic_t[t]) / hh_share
            if hh_share > 0 else 0.0)
        unallocated_positive_capital[t] = max(
            0.0, expansion_capital_available[t] - connection_purchase_capital[t])
        budget_sm = budget_sm + new_sm + nrw_upg                      # SM from the budget + NRW only (no levers)
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
            gap_target = max(0.0, sm_cap[t] - budget_sm - mf_cum - grant_cum)
            new_gap = gap_target - gap_served_hw
            if new_gap > 1e-15:
                gap_served_hw = gap_target
                new_gap = min(new_gap, max(0.0, pool_basic - new_sm - nrw_upg))
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
        sm_level = sm_total
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
        # Gross funded asset roll-forward, deliberately replacing the workbook's
        # depreciating-stock convention. Replacement does not duplicate assets.
        external_cost = (mf_flow[t] + grant_flow[t]) * cost_sm_t[t]
        # Gross funded capital proxy: replacement maintains existing assets.
        # Neither unpaid replacement nor negative cash destroys asset stock.
        paid_by_service = np.array([new_sm * cost_sm_t[t], new_basic * cost_basic_t[t]]) / hh_share if hh_share > 0 else np.zeros(2)
        paid_by_service[0] += external_cost
        need_stock_by_service[:, t] = need_stock_by_service[:, t - 1] + paid_by_service
        stock[t] = prior_stock + paid_by_service.sum()
        bau_stock[t] = stock[t]

        # 4b — target path: = BAU through end-of-as-is, then piecewise CAGR through the ordered target
        # boundaries (test2: any number). Past the last target the target SHARES are held (counts scale
        # with total HHs). With no targets at all, the target path just equals the BAU path.
        if years[t] <= eay or not tgt_years:
            tgt_unadj[:, t] = bau[:, t]; tgt[:, t] = bau[:, t]
        elif years[t] > last_tgt_year:
            for r in range(5):
                tgt_unadj[r, t] = total_hh[t] * last_shares[r]
                tgt[r, t] = total_hh[t] * last_shares[r]
        else:
            if seg_cagr is None:                                       # branch off the (new) BAU at end-of-as-is
                bpoints = [(eay, [bau[r, eai] for r in range(5)])] + list(zip(tgt_years, tgt_counts))
                seg_cagr = []
                for k in range(1, len(bpoints)):
                    (y0, c0), (y1, c1) = bpoints[k - 1], bpoints[k]
                    dy = y1 - y0
                    # A target SHARE of 0 means the rung empties by that year. The old guard required
                    # c1 > 0 and silently HELD the rung at its previous level instead, which left a
                    # phantom target (e.g. a basic target of 0% still reporting households) and let the
                    # five target rungs sum to more than the population. Decay toward a negligible floor
                    # so the rung lands at effectively zero and the remainder flows to the rungs the
                    # target actually asks for.
                    row = []
                    for r in range(5):
                        if dy <= 0 or c0[r] <= 0:
                            row.append(0.0)
                        else:
                            c1r = c1[r] if c1[r] > 0 else c0[r] * 1e-9
                            row.append((c1r / c0[r]) ** (1.0 / dy) - 1.0)
                    seg_cagr.append(row)
            seg = next((k for k, ty in enumerate(tgt_years) if years[t] <= ty), len(tgt_years) - 1)
            chosen = seg_cagr[seg]
            for r in range(5):
                tgt_unadj[r, t] = tgt_unadj[r, t - 1] * (1.0 + chosen[r])
            if not target_adjusted:
                for r in range(5):
                    tgt[r, t] = tgt_unadj[r, t]
            else:
                # Adjusted block: SM = unadjusted, Basic = plug (or total−SM when the lower rungs hit 0),
                # lower rungs = (total − SM − Basic) × prior-year adjusted lower shares.
                sm = min(tgt_unadj[0, t], total_hh[t])
                rest = sum(tgt_unadj[r, t] for r in range(1, 5))
                basic = (total_hh[t] - sm) if rest == 0.0 else min(tgt_unadj[1, t], total_hh[t] - sm)
                remaining = max(0.0, total_hh[t] - sm - basic)
                prior_lower = [tgt[r, t - 1] for r in LOWER]
                psum = sum(prior_lower)
                for j, r in enumerate(LOWER):
                    tgt[r, t] = remaining * (prior_lower[j] / psum) if psum > 0 else 0.0
                tgt[0, t], tgt[1, t] = sm, basic

        # 4d — residual new-service costs; expansion funding has already bought connections.
        gap = max(0.0, tgt[0, t] - bau[0, t]); hh_gap[t] = gap
        # Retain the legacy raw exclusive-category diagnostic for API compatibility.
        # It is NOT a basic-entry cost driver; explicit hierarchy-aware fields follow below.
        gap_b = max(0.0, tgt[1, t] - bau[1, t]); hh_gap_basic[t] = gap_b
        # Price outstanding transition households, not exclusive Basic shortfall.
        # Replacement is attributed to opening funded capital, not target need.
        replacement_credit[t] = replacement_reserved[t]
        unpaid_by_service = replacement_by_service[:, t] * (
            1 - replacement_credit[t] / replacement[t]) if replacement[t] > 0 else np.zeros(2)
        cash_deficit[t] = max(-cash_after_debt_service, 0.0)
        due_cost = np.maximum(np.array([tgt[0, t], sum(tgt[:2, t])]) - ledger.base - ledger.delivered, 0) * np.array([cost_sm_t[t], cost_basic_t[t]])
        weights = due_cost + replacement_by_service[:, t]
        sm_share = weights[0] / weights.sum() if weights.sum() > 0 else 1.0 - bs
        cash_deficit_by_service[:, t] = cash_deficit[t] * np.array([sm_share, 1 - sm_share])
        closing, ancillary_paid = ledger.step(
            t, tgt[:, t], np.array([cost_sm_t[t], cost_basic_t[t]]) * (1 + nonhh_mult),
            [new_sm, new_basic], [mf_flow[t] + grant_flow[t], 0], [nrw_upg, 0],
            replacement=replacement[t], unpaid_by_service=unpaid_by_service,
            deficit_by_service=cash_deficit_by_service[:, t],
            ancillary_cost=capex_adder * (1 + nonhh_mult),
            spare_capital=unallocated_positive_capital[t], asset_stock=stock[t],
            sector_capital=connection_purchase_capital[t], external_capital=external_cost)
        stock[t] += ancillary_paid
        bau_stock[t] = stock[t]
        # The fixed shared ancillary asset retains its service attribution.
        need_stock_by_service[:, t] += ledger.series['ancillary_paid_by_service'][:, t]
        unallocated_positive_capital[t] -= ancillary_paid
        ordinary_expansion_cash = max(0.0, cash_after_debt_service - bau_replacement[t])
        actual_sector_investment = connection_purchase_capital[t] + ancillary_paid
        debt_investment_used[t] = min(
            debt_cash_available[t], max(0.0, actual_sector_investment - ordinary_expansion_cash))
        debt_cash_balance = max(0.0, debt_cash_available[t] - debt_investment_used[t])
        debt_cash_closing[t] = debt_cash_balance
        nc_total = float(closing.sum())
        new_capex_total[t] = nc_total
        new_capex_by_service[:, t] = closing
        total_need[t] = (nc_total + replacement[t]) if (ff > 0 or pf > 0) else 0.0
        if ff > 0 or pf > 0:
            replacement_credit[t] = min(replacement_reserved[t], max(replacement[t], 0.0))
            unfunded_replacement[t] = max(replacement[t] - replacement_credit[t], 0.0)
            cash_deficit[t] = max(-cash_after_debt_service, 0.0)
            financing_gap[t] = max(0.0, nc_total + unfunded_replacement[t] + cash_deficit[t])
            sm_gap, basic_gap, sm_paid, basic_paid = attribute_gap(
                new_capex_by_service[0, t], new_capex_by_service[1, t],
                replacement_by_service[0, t], replacement_by_service[1, t],
                replacement_credit[t], basic_share, cash_deficit[t])
            financing_gap_by_service[0, t] = sm_gap
            financing_gap_by_service[1, t] = basic_gap
            funded_by_service[0, t] = sm_paid
            funded_by_service[1, t] = basic_paid
            # Use the same cash attribution in annual and accumulated ledgers.
            financing_gap_by_service[:, t] = closing + unpaid_by_service + cash_deficit_by_service[:, t]

    # Affordability lever running totals (cumulative over the forecast).
    selffin_upgrade_cum = np.cumsum(selffin_flow)
    mf_upgrade_cum = np.cumsum(mf_flow)
    grant_upgrade_cum = np.cumsum(grant_flow)
    grant_spend_cum = np.cumsum(grant_spend_flow)
    mf_loan_cum = np.cumsum(mf_loan_flow)

    service_gaps = assess_service_gaps(total_hh, bau, tgt, years)
    reconcile_expansion_gaps(ledger.series['closing_outstanding_hh'], service_gaps, bi, years)

    return {
        'connection_revenue': connection_status,
        **{key: values.tolist() for key, values in revenue_diagnostics.items()},
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
        'billed_volume_million_m3': billed_volume.tolist(),
        'baseline_collected_revenue': baseline_revenue.tolist(),
        'collected_revenue': scenario_revenue.tolist(),
        'additional_collected_revenue': (collection_cash + tariff_cash + revenue_diagnostics['connection_revenue_delta']).tolist(),
        'collection_cash': collection_cash.tolist(),   # collection-efficiency revenue folded into capex (scenario)
        'tariff_cash': tariff_cash.tolist(),           # tariff-reform revenue folded into capex (scenario)
        'financial_commitment_cash': financial_cash.tolist(),  # GDP target + annual growth
        'exogenous_injection_cash': injection_cash.tolist(),   # separately attributable effective capex
        'nrw_net': nrw_net.tolist(),                   # NRW money ledger (value − fixing cost) folded into capex
        'nrw_sales_cash': nrw_sales_cash.tolist(),
        'nrw_implementation_cost': nrw_implementation_cost.tolist(),
        'nrw_recurring_cash': (
            nrw_sales_cash if nrw_enabled and (not nrw_target_year or nrw_target_year <= years[-1])
            else np.minimum(nrw_net, 0.0)).tolist(),
        'nrw_recovered_phys_vol': nrw_recovered_phys.tolist(),  # recovered physical water per year (M m³/yr) → wastewater
        'nrw_link_cash': extra_cash_arr.tolist(),      # caller-injected extra capex cash (san water-NRW-linked revenue)
        'eligible_nrw_link_cash': eligible_nrw_cash_arr[:n].tolist(),
        'custom_cash': custom_cash_arr[:n].tolist(),
        'eligible_additional_revenue': (
            collection_cash + tariff_cash + nrw_net + eligible_nrw_cash_arr[:n]).tolist(),
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
        'bau_hh': bau.tolist(),
        'target_hh': tgt.tolist(),
        # Reference for the GDP-target commitment input. This is the baseline
        # share of the TOTAL-spending series the commitment compares against,
        # not the capex budget (which can be cost-derived in from_cost mode).
        'baseline_bau_total_spending_share': (
            float(commitment_base[bi] / ctx['gdp_real_local'][bi])
            if ctx['gdp_real_local'][bi] > 0 and spending_reference_source != 'unavailable_zero_capex_factor' else None
        ),
        'baseline_spending_reference_source': spending_reference_source,
        'financial_commitment_base': commitment_base.tolist(),
        **ledger.result(),
        **{key: value.tolist() for key, value in service_gaps.items()},
        'opening_stock': opening_stock,
        'household_gap': hh_gap.tolist(),
        'household_gap_basic': hh_gap_basic.tolist(),
        'new_capex_total': new_capex_total.tolist(),
        'new_capex_by_service': new_capex_by_service.tolist(),
        'replacement_capex': replacement.tolist(),
        'replacement_by_service': replacement_by_service.tolist(),
        'bau_replacement_capex': bau_replacement.tolist(),
        'total_investment_need': total_need.tolist(),  # compatibility: residual new cost + reported replacement, NOT gross need
        'financing_gap': financing_gap.tolist(),
        'funded_by_service': funded_by_service.tolist(),
        'replacement_funding_applied_by_service': replacement_funding_applied_by_service.tolist(),
        'replacement_reserved': replacement_reserved.tolist(),
        'replacement_credit': replacement_credit.tolist(),
        'replacement_credit_by_service': funded_by_service.tolist(),
        'unfunded_replacement': unfunded_replacement.tolist(),
        'cash_deficit': cash_deficit.tolist(),
        'cash_deficit_by_service': cash_deficit_by_service.tolist(),
        'expansion_capital_available': expansion_capital_available.tolist(),
        'connection_purchase_capital': connection_purchase_capital.tolist(),
        'unallocated_positive_capital': unallocated_positive_capital.tolist(),
        'financing_gap_by_service': financing_gap_by_service.tolist(),
        'utility_debt_disbursement': debt_disbursement_arr.tolist(),
        'utility_debt_principal_payment': debt_principal_arr.tolist(),
        'utility_debt_interest_payment': debt_interest_arr.tolist(),
        'utility_debt_service': debt_service_arr.tolist(),
        'utility_debt_cash_opening': debt_cash_opening.tolist(),
        'utility_debt_cash_available': debt_cash_available.tolist(),
        'utility_debt_investment_used': debt_investment_used.tolist(),
        'utility_debt_cash_closing': debt_cash_closing.tolist(),
    }


def _target_points(tgt_inputs, per):
    """test2: the target list the engine consumes — an explicit N-target list when present, else the
    two legacy target1/target2 sets pinned to the period's target years."""
    if getattr(tgt_inputs, 'targets', None):
        return [(tp.year, list(tp.shares)) for tp in tgt_inputs.targets]
    return None


def calculate_water_supply(inputs, ctx, utility_debt_execution=None):
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
    # Custom interventions (water + 'both'): new-revenue net cash → extra_cash; cost-reduction → cost factor.
    cust_cash, cust_cf = custom_streams(ctx, inputs.period, cost_sm,
                                        getattr(inputs, 'custom_interventions', None) or [], 'water')
    cost_factor = cost_factor * cust_cf
    bracket_income = [br.income_monthly for br in inputs.income_distribution.brackets]
    # Legacy volume arguments are retained for compatibility; canonical billed volume is supplied below.
    _mld_to_m3 = inputs.constants.days_in_year / inputs.constants.cubic_meter_liters
    ce_vol_base_m3 = float(getattr(nrw, 'ce_water_sold_mld', 0.0) or 0.0) * _mld_to_m3
    tariff_vol_base_m3 = float(getattr(nrw, 'tariff_volume_mld', 0.0) or 0.0) * _mld_to_m3
    # NRW: system input volume in million m³/yr (for value & upgrades) and m³/day (for the fixing capex).
    nrw_sys_mld = float(getattr(nrw, 'nrw_system_input_vol', 0.0) or 0.0)
    nrw_vol_m3yr = nrw_sys_mld * _mld_to_m3
    nrw_vol_m3day = nrw_sys_mld * inputs.constants.thousand      # 1 MLD = 1000 m³/day
    nrw_value_unit = (float(getattr(nrw, 'nrw_tariff', 0.0) or 0.0)
                      if getattr(nrw, 'nrw_value_basis', 'tariff') == 'tariff'
                      else float(getattr(nrw, 'nrw_production_cost', 0.0) or 0.0))
    # WATER adder (G168 × G173 × G174 × G175): cost × treatment%capex × current-NRW% × physical-loss%
    capex_adder = cost_sm * nrw.nrw_treatment_cost_pct_capex * nrw.nrw_current_pct * nrw.nrw_physical_loss_pct
    src = getattr(b, 'budget_source', None) or b.budget_input_mode
    full_budget = sector_full_budget(ctx, budget_pct=b.ws_budget_pct_gdp,
        direct_series=b.ws_budget_direct, direct_ongoing=b.ws_budget_direct_ongoing, mode=b.budget_input_mode)
    # Water capex share of the water budget (workbook G321 = 0.21); falls back to the shared capex%.
    ws_capex = b.ws_capex_pct if b.ws_capex_pct is not None else b.capex_pct_budget
    res = sector_bau(
        revenue_base=inputs.revenue_bases['water'],
        connection_config=inputs.connection_revenue.get('water'),
        revenue_volume=volume_path(inputs.revenue_bases['water'], ctx, inputs.constants.days_in_year, inputs.constants.cubic_meter_liters),
        ctx=ctx, period=inputs.period,
        pct_start=[sl.pct_serv1_start, sl.pct_serv2_start, sl.pct_serv3_start, sl.pct_serv4_start, sl.pct_serv5_start],
        pct_base=[sl.pct_serv1_baseline, sl.pct_serv2_baseline, sl.pct_serv3_baseline, sl.pct_serv4_baseline, sl.pct_serv5_baseline],
        hist_series=[getattr(sl, f'serv{i+1}_ts', None) for i in range(5)],
        first_year_idx=(int(sl.bau_first_year) - inputs.period.model_start_year) if getattr(sl, 'bau_first_year', 0) else 0,
        tgt1=[wt.target1_serv1, wt.target1_serv2, wt.target1_serv3, wt.target1_serv4, wt.target1_serv5],
        tgt2=[wt.target2_serv1, wt.target2_serv2, wt.target2_serv3, wt.target2_serv4, wt.target2_serv5],
        targets=_target_points(wt, inputs.period),
        cost_sm=cost_sm, cost_basic=cost_no_treatment(wc),
        cost_factor=cost_factor,                               # test2: capex-efficiency + optimised-technology + custom cost cuts
        cost_factor_basic=cost_factor_basic * cust_cf,
        basic_share=float(getattr(nrw, 'basic_share', 0.0) or 0.0),
        financial_enabled=financial_on,
        injection_enabled=injection_on,
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
        full_spending_provided=b.ws_total_spending_provided,
        extra_cash=cust_cash,                                  # custom new-revenue net cash → water capex
        custom_cash=cust_cash,
        utility_debt_execution=utility_debt_execution,
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
        ce_volume_base_m3=ce_vol_base_m3,
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
        nrw_physical=float(getattr(nrw, 'nrw_physical_loss_pct', 0.5) or 0.5),
        nrw_vol_m3yr=nrw_vol_m3yr,
        nrw_vol_m3day=nrw_vol_m3day,
        nrw_water_per_upgrade=float(getattr(nrw, 'nrw_water_per_upgrade', 0.0) or 0.0),
        nrw_value_unit=nrw_value_unit,
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
    return res
