"""Small, auditable finance ledgers shared by the WSS sector calculations."""

from __future__ import annotations

import numpy as np


def intervention_output(n, *, revenue=None, savings=None, operating_costs=None,
                        implementation=None, physical=None, unit_costs=None):
    """Common annual output contract; money is LC millions, physical quantities carry named units.

    Cost factors are adjustments, not recurring cash. Cash sources only enter the
    utility ledger as revenue + operating savings - recurring operating costs.
    """
    def values(arr):
        out = np.zeros(n) if arr is None else np.asarray(arr, dtype=float)
        if out.shape != (n,) or not np.all(np.isfinite(out)):
            raise ValueError("Intervention outputs require one finite value per model year.")
        return out.tolist()
    return {
        "additional_collected_revenue": values(revenue),
        "recurring_operating_savings": values(savings),
        "recurring_operating_costs": values(operating_costs),
        "implementation_capex": values(implementation),
        "physical_service_benefits": {key: values(arr) for key, arr in (physical or {}).items()},
        "unit_cost_adjustments": {key: values(arr) for key, arr in (unit_costs or {}).items()},
    }


def target_household_trajectory(years, households, baseline_counts, baseline_index, milestones):
    """Interpolate fixed milestone counts, preserving count-CAGR where it is defined.

    Zero-start categories grow linearly. Positive-to-zero categories retain the existing
    near-zero geometric decline, but land exactly at zero at their milestone.
    """
    years = np.asarray(years, dtype=int)
    households = np.asarray(households, dtype=float)
    result = np.zeros((len(baseline_counts), len(years)))
    bi = int(baseline_index)
    points = [(int(years[bi]), np.asarray(baseline_counts, dtype=float))]
    normalized = []
    for year, shares in sorted(milestones, key=lambda point: point[0]):
        shares = np.asarray(shares, dtype=float)
        if np.any(shares < 0) or not np.all(np.isfinite(shares)) or shares.sum() <= 0:
            raise ValueError("Target shares must be finite, non-negative, and sum to a positive value.")
        shares = shares / shares.sum()
        if int(year) <= years[bi]:
            continue
        # Legacy inputs can retain a later milestone after shortening the forecast window.
        # Preserve the previous endpoint-household clipping instead of rejecting those scenarios.
        idx = min(int(np.searchsorted(years, int(year))), len(years) - 1)
        points.append((int(year), shares * households[idx]))
        normalized.append(shares)
    if len(points) == 1:
        raise ValueError("At least one future target milestone is required.")
    result[:, bi] = baseline_counts
    for t in range(bi + 1, len(years)):
        year = years[t]
        if year >= points[-1][0]:
            result[:, t] = normalized[-1] * households[t]
            continue
        seg = next(k for k in range(1, len(points)) if year <= points[k][0])
        y0, c0 = points[seg - 1]
        y1, c1 = points[seg]
        fraction = (year - y0) / (y1 - y0)
        if year == y1:
            result[:, t] = c1
            continue
        raw = np.zeros(len(c0))
        for rung in range(len(c0)):
            if c0[rung] > 0:
                end = c1[rung] if c1[rung] > 0 else c0[rung] * 1e-9
                raw[rung] = c0[rung] * (end / c0[rung]) ** fraction
            else:
                raw[rung] = c1[rung] * fraction
        # Preserve the existing SM-first/Basic-next balancing; use the interpolated lower
        # categories for the remainder, so all five exclusive categories sum to households.
        result[0, t] = min(raw[0], households[t])
        result[1, t] = min(raw[1], max(0.0, households[t] - result[0, t]))
        remaining = max(0.0, households[t] - result[:2, t].sum())
        lower = raw[2:]
        weights = lower / lower.sum() if lower.sum() > 0 else np.full(len(lower), 1 / len(lower))
        result[2:, t] = remaining * weights
    return result


def target_transition_capex(target_sm, target_basic, cost_sm, cost_basic, nonhousehold_multiplier,
                            implementation_capex=None, capex_adder=0.0, baseline_index=0,
                            total_households=None):
    """Cost positive annual target transitions once, including Basic→SM upgrades.

    Counts are millions of households and per-household costs are in model currency.
    With household totals, new households adopt the current target mix and continuing
    households transition separately. This identifies upgrades even when Basic counts
    rise due to growth. Without totals, use the legacy net-count transition convention.
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
    downgrades = np.zeros(n)
    totals = None if total_households is None else np.asarray(total_households, dtype=float)
    expansion_sm = np.zeros(n)
    expansion_basic = np.zeros(n)
    expansion = np.zeros(n)
    for t in range(max(0, int(baseline_index)) + 1, n):
        if totals is None:
            sm_increase = max(0.0, sm[t] - sm[t - 1])
            basic_reduction = max(0.0, basic[t - 1] - basic[t])
            upgrades[t] = min(sm_increase, basic_reduction)
            downgrades[t] = min(max(0.0, basic[t] - basic[t - 1]),
                                max(0.0, sm[t - 1] - sm[t]))
            new_sm[t] = sm_increase - upgrades[t]
            total_service_increase = max(
                0.0, (sm[t] + basic[t]) - (sm[t - 1] + basic[t - 1]))
            new_basic[t] = max(0.0, total_service_increase - new_sm[t])
        else:
            previous, current = max(0.0, totals[t - 1]), max(0.0, totals[t])
            retained = min(previous, current)
            growth = max(0.0, current - previous)
            shares = np.array([sm[t], basic[t]]) / current if current else np.zeros(2)
            prior = np.array([sm[t - 1], basic[t - 1]]) * (retained / previous if previous else 0)
            changes = shares * retained - prior
            upgrades[t] = min(max(0.0, changes[0]), max(0.0, -changes[1]))
            downgrades[t] = min(max(0.0, changes[1]), max(0.0, -changes[0]))
            new_sm[t] = growth * shares[0] + max(0.0, changes[0] - upgrades[t])
            new_basic[t] = growth * shares[1] + max(0.0, changes[1] - downgrades[t])

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
        "sm_downgrades": downgrades,
        "expansion_sm": expansion_sm,
        "expansion_basic": expansion_basic,
        "expansion": expansion,
        "implementation_capex": impl[:n],
    }


def annual_asset_requirements(expansion, opening_assets, replacement_rate, baseline_index=0,
                              expansion_by_service=None, opening_assets_by_service=None,
                              implementation_capex=None, service_households=None,
                              service_upgrades=None, service_downgrades=None):
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
    asset_transfer = np.zeros(n)
    upgrades = np.zeros(n) if service_upgrades is None else np.asarray(service_upgrades, dtype=float)
    downgrades = np.zeros(n) if service_downgrades is None else np.asarray(service_downgrades, dtype=float)
    service_hh = None if service_households is None else np.asarray(service_households, dtype=float)
    for t in range(max(0, baseline_index), n):
        if t == baseline_index:
            stock[t] = float(opening_assets)
            stock_by_service[:, t] = opening_services[:2]
            continue
        replacement[t] = max(0.0, stock[t - 1] * replacement_rate)
        replacement_by_service[:, t] = np.maximum(0.0, stock_by_service[:, t - 1] * replacement_rate)
        stock[t] = stock[t - 1] + expansion[t]
        stock_by_service[:, t] = stock_by_service[:, t - 1] + expansion_services[:, t]
        if service_hh is not None:
            # Existing Basic base assets move with upgraded households. This is a book-value
            # transfer, not additional expenditure or additional system capacity.
            up_share = min(1.0, upgrades[t] / service_hh[1, t - 1]) if service_hh[1, t - 1] > 0 else 0.0
            down_share = min(1.0, downgrades[t] / service_hh[0, t - 1]) if service_hh[0, t - 1] > 0 else 0.0
            asset_transfer[t] = (stock_by_service[1, t - 1] * up_share -
                                 stock_by_service[0, t - 1] * down_share)
            stock_by_service[:, t] += np.array([asset_transfer[t], -asset_transfer[t]])
        need[t] = expansion[t] + replacement[t] + max(0.0, implementation[t])
    return {
        "target_asset_stock": stock,
        "target_asset_stock_by_service": stock_by_service,
        "target_asset_transfer_to_sm": asset_transfer,
        "replacement": replacement,
        "replacement_by_service": replacement_by_service,
        "implementation_capex": implementation[:n],
        "total_need": need,
    }


def funding_ledger(requirement, public_capital, other_capital, direct_cash, explicit_public=None,
                   baseline_index=0, *, loan_drawdowns=None):
    """Fund each year's requirement once; carry only positive cash surpluses forward.

    Negative resource flows remain signed and reduce that year's available financing.
    Repeated financing-gap snapshots are not rolled into later years. Closing cash is
    the next year's opening cash, not a new receipt. Surpluses earn no interest and
    never retroactively offset earlier annual shortfalls. Opening programme cash is zero.
    ``explicit_public`` is the legacy alias for the separately identified loan drawdowns.
    """
    need = np.asarray(requirement, dtype=float)
    n = len(need)
    def annual(values):
        arr = np.asarray(values, dtype=float)
        if arr.ndim != 1 or len(arr) != n or not np.all(np.isfinite(arr)):
            raise ValueError("Financing ledgers require one finite value per model year.")
        return arr
    need = annual(need)
    if np.any(need < 0):
        raise ValueError("Scheduled investment requirements cannot be negative.")
    public, other, direct = map(annual, (public_capital, other_capital, direct_cash))
    if explicit_public is not None and loan_drawdowns is not None:
        raise ValueError("Supply loan drawdowns once, not also through the legacy alias.")
    draws = loan_drawdowns if loan_drawdowns is not None else explicit_public
    explicit = np.zeros(n) if draws is None else annual(draws)
    carry = np.zeros(n)
    opening_cash = np.zeros(n)
    fresh = np.zeros(n)
    funded = np.zeros(n)
    cash_deficit = np.zeros(n)
    carry_drawn = np.zeros(n)
    carry_added = np.zeros(n)
    available_before_explicit = np.zeros(n)
    available = np.zeros(n)
    gap_before_explicit = np.zeros(n)
    gap = np.zeros(n)
    first = max(0, baseline_index + 1)
    programme_need = need.copy()
    programme_need[:first] = 0
    for t in range(first, n):
        opening = carry[t - 1] if t > 0 else 0.0
        opening_cash[t] = opening
        fresh[t] = public[t] + other[t] + direct[t] + explicit[t]
        available_before_explicit[t] = public[t] + other[t] + direct[t] + opening
        gap_before_explicit[t] = max(0.0, need[t] - available_before_explicit[t])
        available[t] = available_before_explicit[t] + explicit[t]
        gap[t] = max(0.0, need[t] - available[t])
        carry[t] = max(0.0, available[t] - need[t])
        funded[t] = min(need[t], max(0.0, available[t]))
        cash_deficit[t] = max(0.0, -available[t])
        carry_drawn[t] = min(opening, max(0.0, need[t] - fresh[t]))
        carry_added[t] = max(0.0, fresh[t] - need[t])
    return {
        "available_before_explicit_public": available_before_explicit,
        "available": available,
        "gap_before_explicit_public": gap_before_explicit,
        "gap": gap,
        "cash_carry_forward": carry,
        "opening_cash": opening_cash,
        "fresh_financing": fresh,
        "financing_applied": funded,
        "financing_cash_deficit": cash_deficit,
        "cash_drawn_from_carry": carry_drawn,
        "cash_added_to_carry": carry_added,
        "cumulative_new_financing": np.cumsum(fresh),
        "cumulative_financing_applied": np.cumsum(funded),
        "cumulative_requirement": np.cumsum(programme_need),
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
                  existing_debt_service=0.0, direct_cash_available=None, **options):
    """Compatibility entry point; debt accounting lives in model.borrowing."""
    from model.borrowing import schedule_loan
    return schedule_loan(
        years, baseline_index, required, public_capital, other_capital, eligible_cash,
        allocation_alpha, enabled=enabled, drawdown_year=drawdown_year,
        interest_rate=interest_rate, term_years=term_years, minimum_dscr=minimum_dscr,
        borrowing_ceiling=borrowing_ceiling, existing_debt_service=existing_debt_service,
        direct_cash_available=direct_cash_available, **options)
