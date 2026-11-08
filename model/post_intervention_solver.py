"""Bounded engine-backed search; balances are never summed across years."""
import time
import numpy as np

MONEY_FLOOR = 1e-6  # million LCU, not the display-materiality threshold
HH_TOLERANCE = 1e-6  # one household
SOURCE = 'post_intervention_funding'
COMPONENTS = ('household_expansion', 'ancillary', 'replacement_backlog', 'cash_shortfall')


def composition(result, index):
    fields = {
        'household_expansion': 'closing_household_expansion_by_service',
        'ancillary': 'closing_ancillary_by_service',
        'replacement_backlog': 'replacement_backlog_closing',
        'cash_shortfall': 'accumulated_cash_shortfall_by_service',
    }
    out = {}
    for key, field in fields.items():
        values = np.asarray(result[field], dtype=float)
        amount = float(values[..., index].sum())
        if not np.isfinite(amount) or amount < -MONEY_FLOOR:
            raise ValueError(f'Invalid residual {key}')
        out[key] = max(0., amount)
    out['total'] = sum(out.values())
    expected = float(result['endline_financing_requirement'][index])
    if not np.isclose(out['total'], expected, atol=MONEY_FLOOR, rtol=1e-8):
        raise ValueError('Residual composition does not reconcile to the engine ledger')
    return out


def coverage(hh, total):
    h = np.asarray(hh, dtype=float)
    return dict(sm=h[0].tolist(), basic=h[1].tolist(), at_least_basic=(h[0]+h[1]).tolist(),
                total=np.asarray(total, dtype=float).tolist())


def residual_vector(result, index):
    from .service_gaps import assess_service_gaps
    actual, targets = np.array(result['bau_hh']), np.array(result['target_hh'])
    gaps = assess_service_gaps(actual.sum(axis=0), actual, targets)
    parts = composition(result, index)
    return np.array([gaps['sm_access_gap'][index], gaps['at_least_basic_access_gap'][index],
                     *(parts[k] for k in COMPONENTS)], dtype=float)


def solve_share(run, zero, index, gdp_sum, deadline, max_share=1., max_trials=38):
    """Keep tested feasible upper bounds; report uncertain/nonmonotonic responses."""
    residual = residual_vector(zero, index)
    money_tolerance = max(MONEY_FLOOR, 1e-9 * composition(zero, index)['total'])
    tolerances = np.array([HH_TOLERANCE, HH_TOLERANCE, *([money_tolerance]*4)])
    calls, observations = 0, [(0., residual)]
    diagnostics = dict(household_tolerance=HH_TOLERANCE, monetary_tolerance=money_tolerance,
                       max_share=max_share, max_trials=max_trials, trials=0)
    def feasible(v):
        return bool(np.all(v <= tolerances))
    if feasible(residual):
        return 0., zero, 'already_funded', diagnostics
    low, high = 0., min(max_share, max(1e-8, composition(zero, index)['total']/gdp_sum))
    candidate, vec = zero, residual
    nonmonotonic = False
    def trial(q):
        nonlocal calls, nonmonotonic
        if calls >= max_trials or time.monotonic() >= deadline:
            raise TimeoutError
        result = run(q); calls += 1
        vector = residual_vector(result, index)
        for oldq, old in observations:
            if q > oldq and np.any(vector > old + tolerances * 2):
                nonmonotonic = True
            if q < oldq and np.any(old > vector + tolerances * 2):
                nonmonotonic = True
        observations.append((q, vector))
        diagnostics['trials'] = calls
        return result, vector
    try:
        while True:
            candidate, vec = trial(high)
            if nonmonotonic:
                diagnostics['reason'] = 'Residual components increased with funding; no monotonic bracket verified.'
                return None, candidate, 'nonconvergent', {**diagnostics, 'candidate_fraction': high}
            if feasible(vec):
                break
            if high >= max_share:
                status = 'coverage_met_finance_unresolved' if np.all(vec[:2] <= tolerances[:2]) else 'not_resolved_within_bounds'
                return None, candidate, status, {**diagnostics, 'candidate_fraction': high}
            low, high = high, min(max_share, high * 2)
        # The upper bound is always an actual feasible engine execution.
        for _ in range(24):
            if high - low <= max(1e-10, high * 1e-6):
                break
            mid = (low + high) / 2
            result, vector = trial(mid)
            if nonmonotonic:
                return None, result, 'nonconvergent', {**diagnostics, 'candidate_fraction': mid}
            if feasible(vector):
                high, candidate = mid, result
            else:
                low = mid
        return high, candidate, 'solved', {**diagnostics, 'tested_lower': low, 'tested_upper': high}
    except TimeoutError:
        return None, candidate, 'nonconvergent', {**diagnostics, 'reason': 'Calculation runtime or iteration limit reached.'}
