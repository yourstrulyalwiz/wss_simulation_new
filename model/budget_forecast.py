"""Entered-budget forecasts on a raw spending/GDP basis."""
import math
import numpy as np


class BudgetInputError(ValueError):
    """Budget calibration error safe to display through the existing API."""


def forecast_budget(values, years, gdp, baseline_year, label):
    raw = list(values or [])
    shares = [None] * len(years)
    amounts = [None] * len(years)
    status = ['missing'] * len(years)
    for i, year in enumerate(years):
        if not math.isfinite(float(gdp[i])) or gdp[i] <= 0:
            raise BudgetInputError(f'{label}: positive finite real GDP required for {year}.')
        value = raw[i] if i < len(raw) else None
        if value is None:
            continue
        if isinstance(value, bool) or not math.isfinite(float(value)) or value < 0:
            raise BudgetInputError(f'{label}: enter a finite nonnegative budget for {year}.')
        amounts[i] = float(value)
        shares[i] = float(value) / gdp[i]
        status[i] = 'actual' if year <= baseline_year else 'override'
    actual = [i for i, y in enumerate(years) if y <= baseline_year and shares[i] is not None]
    if not actual:
        raise BudgetInputError(f'{label}: no historical budget observations. Enter executed and allocated budgets separately.')
    last = actual[-1]
    seed = [i for i in actual if years[i] >= years[last] - 2]
    for i in range(last + 1, len(years)):
        if shares[i] is None:
            shares[i] = (sum(shares[j] for j in seed) / len(seed) if i == last + 1
                         else (shares[i-1] + shares[i-2]) / 2)
            amounts[i] = shares[i] * gdp[i]
            status[i] = 'forecast'
    return amounts, {
        'initialization_years': [int(years[i]) for i in seed],
        'observation_count': len(seed), 'last_actual_year': int(years[last]),
        'status': status,
    }


def resolve_budget(executed, allocated, years, gdp, baseline_year, label):
    e, em = forecast_budget(executed, years, gdp, baseline_year, f'{label} executed')
    a, am = forecast_budget(allocated, years, gdp, baseline_year, f'{label} allocated')
    rates = []
    for i, (ev, av) in enumerate(zip(e, a)):
        rates.append(ev / av if ev is not None and av is not None and av > 0
                     else 1. if ev is not None and ev > 0 and av == 0 else None)
    notices = []
    for name, meta in [('Executed', em), ('Allocated', am)]:
        if meta['observation_count'] < 3:
            notices.append(f"{name} forecast uses {meta['observation_count']} observations in the three-year window.")
    # Matching values are a review warning, never proof that an observation is invalid.
    if 2025 in years:
        i = list(years).index(2025)
        if i < len(allocated) and allocated[i] in (2784, 3469):
            notices.append('Review the 2025 allocation: it matches a legacy demonstration value; confirm it is an actual observation.')
    return e, a, rates, {'executed': em, 'allocated': am, 'notices': notices}
