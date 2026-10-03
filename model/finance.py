"""Small, auditable finance ledgers shared by the WSS sector calculations."""

from __future__ import annotations

import numpy as np


def target_transition_capex(target_sm, target_basic, cost_sm, cost_basic, nonhousehold_multiplier,
                            implementation_capex=None, capex_adder=0.0, baseline_index=0):
    """Cost positive annual target transitions once, including Basic→SM upgrades.

    Counts are millions of households and per-household costs are in model currency.
    When Basic shrinks as Safely Managed grows, the overlapping movement is priced as
    an upgrade (the incremental cost over a Basic connection), not as a second new
    connection. Other positive target changes are new connections.
    """
    sm = np.asarray(target_sm, dtype=float)
    basic = np.asarray(target_basic, dtype=float)
    sm_cost = np.asarray(cost_sm, dtype=float)
    basic_cost = np.asarray(cost_basic, dtype=float)
    n = len(sm)
    impl = np.zeros(n) if implementation_capex is None else np.asarray(implementation_capex, dtype=float)
    if len(impl) < n:
        impl = np.pad(impl, (0, n - len(impl)))
    add = np.zeros(n) if np.isscalar(capex_adder) else np.asarray(capex_adder, dtype=float)
    if np.isscalar(capex_adder):
        add[:] = float(capex_adder)
    elif len(add) < n:
        add = np.pad(add, (0, n - len(add)))

    new_sm = np.zeros(n)
    new_basic = np.zeros(n)
    upgrades = np.zeros(n)
    expansion_sm = np.zeros(n)
    expansion_basic = np.zeros(n)
    expansion = np.zeros(n)
    for t in range(max(0, int(baseline_index)) + 1, n):
        sm_increase = max(0.0, sm[t] - sm[t - 1])
        total_service_increase = max(
            0.0, (sm[t] + basic[t]) - (sm[t - 1] + basic[t - 1]))
        basic_reduction = max(0.0, basic[t - 1] - basic[t])
        upgrades[t] = min(sm_increase, basic_reduction)
        new_sm[t] = sm_increase - upgrades[t]
        # Positive service growth not already priced as a new SM connection is new Basic service.
        # This also avoids pricing a downgrade from SM to Basic as a new connection.
        new_basic[t] = max(0.0, total_service_increase - new_sm[t])

        unit_sm = max(0.0, sm_cost[t])
        unit_basic = max(0.0, basic_cost[t])
        sm_direct = new_sm[t] * unit_sm + upgrades[t] * max(0.0, unit_sm - unit_basic)
        basic_direct = new_basic[t] * unit_basic
        direct = sm_direct + basic_direct
        shared_adder = max(0.0, add[t]) if direct > 0 else 0.0
        factor = max(0.0, 1.0 + float(nonhousehold_multiplier))
        expansion_sm[t] = (sm_direct + shared_adder * (sm_direct / direct if direct else 0.0)) * factor
        expansion_basic[t] = (basic_direct + shared_adder * (basic_direct / direct if direct else 0.0)) * factor
        expansion[t] = expansion_sm[t] + expansion_basic[t]
    return {
        "new_sm_connections": new_sm,
        "new_basic_connections": new_basic,
        "sm_upgrades": upgrades,
        "expansion_sm": expansion_sm,
        "expansion_basic": expansion_basic,
        "expansion": expansion,
        "implementation_capex": impl[:n],
    }


def annual_asset_requirements(expansion, opening_assets, replacement_rate, baseline_index=0,
                              expansion_by_service=None, opening_assets_by_service=None,
                              implementation_capex=None):
    """Apply annual replacement to the prior target-asset stock, without adding replacement twice."""
    expansion = np.asarray(expansion, dtype=float)
    n = len(expansion)
    implementation = np.zeros(n) if implementation_capex is None else np.asarray(implementation_capex, dtype=float)
    if len(implementation) < n:
        implementation = np.pad(implementation, (0, n - len(implementation)))
    expansion_services = np.asarray(expansion_by_service if expansion_by_service is not None
                                    else np.zeros((2, n)), dtype=float)
    if expansion_services.shape != (2, n):
        expansion_services = np.resize(expansion_services, (2, n))
    opening_services = np.asarray(opening_assets_by_service if opening_assets_by_service is not None
                                  else [opening_assets, 0.0], dtype=float)
    if len(opening_services) < 2:
        opening_services = np.pad(opening_services, (0, 2 - len(opening_services)))

    stock = np.zeros(n)
    stock_by_service = np.zeros((2, n))
    replacement = np.zeros(n)
    replacement_by_service = np.zeros((2, n))
    need = np.zeros(n)
    for t in range(max(0, baseline_index), n):
        if t == baseline_index:
            stock[t] = float(opening_assets)
            stock_by_service[:, t] = opening_services[:2]
            continue
        replacement[t] = max(0.0, stock[t - 1] * replacement_rate)
        replacement_by_service[:, t] = np.maximum(0.0, stock_by_service[:, t - 1] * replacement_rate)
        stock[t] = stock[t - 1] + expansion[t]
        stock_by_service[:, t] = stock_by_service[:, t - 1] + expansion_services[:, t]
        need[t] = expansion[t] + replacement[t] + max(0.0, implementation[t])
    return {
        "target_asset_stock": stock,
        "target_asset_stock_by_service": stock_by_service,
        "replacement": replacement,
        "replacement_by_service": replacement_by_service,
        "implementation_capex": implementation[:n],
        "total_need": need,
    }


def funding_ledger(requirement, public_capital, other_capital, direct_cash, explicit_public=None,
                   baseline_index=0):
    """Fund each year's requirement once; carry only positive cash surpluses forward.

    Negative resource flows remain signed and reduce that year's available financing.
    Repeated financing-gap snapshots are not rolled into later years.
    """
    need = np.asarray(requirement, dtype=float)
    n = len(need)
    public = np.resize(np.asarray(public_capital, dtype=float), n)
    other = np.resize(np.asarray(other_capital, dtype=float), n)
    direct = np.resize(np.asarray(direct_cash, dtype=float), n)
    explicit = np.zeros(n) if explicit_public is None else np.resize(np.asarray(explicit_public, dtype=float), n)
    carry = np.zeros(n)
    available_before_explicit = np.zeros(n)
    available = np.zeros(n)
    gap_before_explicit = np.zeros(n)
    gap = np.zeros(n)
    for t in range(max(0, baseline_index + 1), n):
        opening = carry[t - 1] if t > 0 else 0.0
        available_before_explicit[t] = public[t] + other[t] + direct[t] + opening
        gap_before_explicit[t] = max(0.0, need[t] - available_before_explicit[t])
        available[t] = available_before_explicit[t] + explicit[t]
        gap[t] = max(0.0, need[t] - available[t])
        carry[t] = max(0.0, available[t] - need[t])
    return {
        "available_before_explicit_public": available_before_explicit,
        "available": available,
        "gap_before_explicit_public": gap_before_explicit,
        "gap": gap,
        "cash_carry_forward": carry,
        "cumulative_requirement": np.cumsum(need),
        "cumulative_gap": np.cumsum(gap),
    }


def tariff_collection_cash(volume, current_tariff, tariff_path, current_collection,
                           collection_path, *, tariff_enabled, collection_enabled):
    """Reconcile tariff and collection changes against one billed-volume base.

    Collection effects are valued at the current tariff; tariff effects use the scenario
    collection ratio. This assigns the interaction once and sums to the exact combined
    change in collected revenue.
    """
    volume = np.asarray(volume, dtype=float)
    tariff_path = np.resize(np.asarray(tariff_path, dtype=float), len(volume))
    collection_path = np.resize(np.asarray(collection_path, dtype=float), len(volume))
    collection_cash = (
        volume * float(current_tariff) * (collection_path - float(current_collection))
        if collection_enabled else np.zeros(len(volume)))
    tariff_cash = (
        volume * collection_path * (tariff_path - float(current_tariff))
        if tariff_enabled else np.zeros(len(volume)))
    return collection_cash, tariff_cash


def annuity_present_value_factor(rate, term):
    """PV factor for annual level payments at a fixed real rate."""
    term = int(term)
    rate = max(0.0, float(rate))
    if term <= 0:
        return 0.0
    return float(term) if rate == 0 else (1.0 - (1.0 + rate) ** -term) / rate


def loan_schedule(years, baseline_index, required, public_capital, other_capital, eligible_cash,
                  allocation_alpha, *, enabled=False, drawdown_year=0, interest_rate=0.0,
                  term_years=0, minimum_dscr=1.0, borrowing_ceiling=0.0,
                  existing_debt_service=0.0, direct_cash_available=None):
    """Size one real, fixed-rate loan against established cash and remaining target investment need.

    Cash beyond the coverage horizon is held flat at the last projected real value. The loan is
    drawn once in the selected year and repaid with level annual payments beginning the next year.
    """
    years = np.asarray(years, dtype=int)
    n = len(years)
    zeros = np.zeros(n)
    result = {
        "drawdowns": zeros.copy(), "opening_debt": zeros.copy(), "closing_debt": zeros.copy(),
        "interest": zeros.copy(), "principal": zeros.copy(), "debt_service": zeros.copy(),
        "cash_committed_to_debt": zeros.copy(), "cash_allocated_to_direct_investment": zeros.copy(),
        "retained_cash_reserve": zeros.copy(), "debt_service_shortfall": zeros.copy(),
        "loan_principal": 0.0, "loan_end_year": None,
    }
    alpha = float(np.clip(allocation_alpha, 0.0, 1.0))
    cash = np.resize(np.asarray(eligible_cash, dtype=float), n)
    result["cash_allocated_to_direct_investment"] = cash.copy()
    if not enabled or alpha <= 0 or n == 0:
        return result

    draw = int(drawdown_year)
    draw_idx = next((i for i, y in enumerate(years) if y == draw), None)
    term = int(term_years)
    if draw_idx is None or draw_idx <= baseline_index or term <= 0:
        return result

    committed = np.zeros(n)
    direct = cash.copy()
    end_year = draw + term
    for i, year in enumerate(years):
        if draw <= year <= end_year:
            committed[i] = max(0.0, cash[i]) * alpha
            direct[i] = cash[i] - committed[i]
    rate = max(0.0, float(interest_rate))
    dscr = max(1.0, float(minimum_dscr))
    existing = max(0.0, float(existing_debt_service))
    pay_years = list(range(draw_idx + 1, draw_idx + term + 1))
    cash_for_year = []
    for idx in pay_years:
        value = committed[idx] if idx < n else (committed[-1] if n else 0.0)
        cash_for_year.append(max(0.0, float(value)))
    if not pay_years:
        return result
    annual_capacity = min(max(0.0, (v - existing) / dscr) for v in cash_for_year)
    cash_capacity = annual_capacity * annuity_present_value_factor(rate, term)
    ceiling = float(borrowing_ceiling)
    if ceiling > 0:
        cash_capacity = min(cash_capacity, ceiling)

    req = np.resize(np.asarray(required, dtype=float), n)
    public = np.resize(np.asarray(public_capital, dtype=float), n)
    other = np.resize(np.asarray(other_capital, dtype=float), n)
    # Drawdowns never exceed the target investment gaps remaining after public/other sources,
    # directly reinvested cash, and any cash already carried forward before the loan.
    direct_for_need = direct if direct_cash_available is None else np.resize(
        np.asarray(direct_cash_available, dtype=float), n)
    base_ledger = funding_ledger(
        req, public, other, direct_for_need, baseline_index=baseline_index)
    eligible_need = float(np.sum(base_ledger['gap'][draw_idx:]))
    principal = max(0.0, min(cash_capacity, eligible_need))
    if principal <= 0:
        result["cash_allocated_to_direct_investment"] = cash.copy()
        return result

    pv = annuity_present_value_factor(rate, term)
    annual_payment = principal / pv if pv > 0 else 0.0
    result["loan_principal"] = principal
    result["loan_end_year"] = draw + term
    result["drawdowns"][draw_idx] = principal
    result["cash_committed_to_debt"] = committed
    result["cash_allocated_to_direct_investment"] = direct
    reserve = 0.0
    balance = 0.0
    for i, year in enumerate(years):
        result["opening_debt"][i] = balance
        if year == draw:
            balance += principal
            reserve += committed[i]
        if draw < year <= end_year:
            interest = balance * rate
            due = min(annual_payment, balance + interest)
            available_for_service = max(0.0, reserve + committed[i] - existing)
            paid = min(due, available_for_service)
            shortfall = max(0.0, due - paid)
            balance_before = balance
            balance = max(0.0, balance + interest - paid)
            principal_paid = max(0.0, min(balance_before, paid - interest))
            reserve = max(0.0, available_for_service - paid)
            result["interest"][i] = interest
            result["principal"][i] = principal_paid
            result["debt_service"][i] = due
            result["debt_service_shortfall"][i] = shortfall
            if year == end_year:
                result["cash_allocated_to_direct_investment"][i] += reserve
                reserve = 0.0
        elif year > end_year:
            # After maturity, the debt-commitment share and any reserve return to investment.
            result["cash_allocated_to_direct_investment"][i] = cash[i] + reserve
            reserve = 0.0
        result["closing_debt"][i] = balance
        result["retained_cash_reserve"][i] = reserve
    return result
