"""Multi-area engine runs + Urban/Rural → National aggregation.

The engine is PER AREA: one `ModelInputs` describes one area and `calculate()` returns one flat result
with no geography key (see `model/inputs.py`). Everything the tool shows as "National (Urban + Rural)"
is an element-wise sum done in the browser, reimplemented in three places. The slide deck needs all
three scopes in a single export, so the sum lives here instead — server-side, once.

Additivity is the whole contract. Household counts, capex, budgets, gaps and cash ledgers are extensive
and simply sum. Unit costs, growth rates and efficiency ratios are intensive and must NOT be summed —
they are re-derived from the summed components (a ratio of sums, never a sum of ratios) or
household-weighted, which is what the deck's own footnote promises: "National figures are the
household-weighted aggregate of the urban and rural results."
"""

from typing import Dict, List, Optional

from model.engine import calculate
from demo_adapter import coerce_to_engine

SECTORS = ('water_supply', 'sanitation')

# Country-level macro: identical in every area's payload, so it is carried across, never summed
# (summing would report 2× the country's GDP for a two-area national roll-up).
_SHARED_TOP = ('years', 'end_asis_year', 'gdp_nominal_usd', 'gdp_nominal_local', 'gdp_real_local',
               'exchange_rate', 'inflation_local', 'inflation_us')

# Intensive sector fields — re-derived below rather than summed or averaged.
_DERIVED_SECTOR = ('rungs', 'sector', 'cost_per_hh', 'cost_basic', 'hist_cagr',
                   'execution_rate', 'capex_efficiency', 'capex_efficiency_baseline')


def _sum_series(series_list: List[Optional[list]]) -> list:
    """Element-wise sum of equal-length numeric lists, tolerating None and short lists."""
    present = [s for s in series_list if s]
    if not present:
        return []
    n = max(len(s) for s in present)
    out = [0.0] * n
    for s in present:
        for i, v in enumerate(s):
            if v is not None:
                out[i] += v
    return out


def _sum_2d(mats: List[Optional[list]]) -> list:
    """Element-wise sum of [rung][year] matrices."""
    present = [m for m in mats if m]
    if not present:
        return []
    n_rung = max(len(m) for m in present)
    return [_sum_series([(m[r] if r < len(m) else None) for m in present]) for r in range(n_rung)]


def _ratio(nums: list, dens: list) -> list:
    """Ratio of summed components, element-wise; 0 where the denominator is 0."""
    return [(nums[i] / dens[i]) if i < len(dens) and dens[i] else 0.0
            for i in range(len(nums))]


def _agg_hist_cagr(secs: List[dict], years: list, end_asis_year) -> list:
    """National per-rung historical growth, as a household-weighted mean of the areas' rates.

    The engine's `hist_cagr` is the mean of annualised YoY rates between the years the user actually
    ENTERED a service-level share (model/water_supply.py:315-330) — it is derived from the inputs, not
    from any output series, so it cannot be recomputed from the summed households. Weighting each
    area's rate by that rung's own baseline household count is the right aggregate: it reduces exactly
    to the shared rate when the areas agree, and tracks the larger area when they don't."""
    try:
        bi = years.index(end_asis_year)
    except (ValueError, TypeError):
        bi = len(years) - 1
    n_rung = max((len(s.get('hist_cagr') or []) for s in secs), default=0)
    out = []
    for r in range(n_rung):
        rates, wts = [], []
        for s in secs:
            hc = s.get('hist_cagr') or []
            if r >= len(hc):
                continue
            bh = s.get('bau_hh') or []
            cnt = bh[r][bi] if (r < len(bh) and bi < len(bh[r])) else 0.0
            rates.append(hc[r])
            wts.append(cnt)
        out.append(_wavg(rates, wts) if rates else 0.0)
    return out


def _budget_weighted(series_list: List[Optional[list]], weight_list: List[Optional[list]]) -> list:
    """Per-year weighted mean of several areas' ratio series, weighted by a matching money series.
    Falls back to a plain mean in years where every weight is zero."""
    present = [(s, wt) for s, wt in zip(series_list, weight_list) if s]
    if not present:
        return []
    n = max(len(s) for s, _ in present)
    out = [0.0] * n
    for i in range(n):
        num = den = 0.0
        for s, wt in present:
            if i >= len(s) or s[i] is None:
                continue
            wi = (wt[i] if (wt and i < len(wt) and wt[i]) else 0.0)
            num += s[i] * wi
            den += wi
        if den:
            out[i] = num / den
        else:
            vals = [s[i] for s, _ in present if i < len(s) and s[i] is not None]
            out[i] = (sum(vals) / len(vals)) if vals else 0.0
    return out


def _baseline_efficiency(used: list, allocated: list, years: list, end_asis_year) -> float:
    """National baseline capex efficiency, derived the way the engine derives the per-area one."""
    DEFAULT_CAPEX_EFF = 0.80
    if not used or not allocated or not years:
        return 1.0
    try:
        bi = years.index(end_asis_year)
    except (ValueError, TypeError):
        bi = len(years) - 1
    ratios = [allocated[t] / used[t] for t in range(1, min(bi, len(used) - 1) + 1)
              if t < len(allocated) and used[t] > 0 and allocated[t] > 0]
    exec_ratio = (sum(ratios) / len(ratios)) if ratios else (1.0 / DEFAULT_CAPEX_EFF)
    return max(0.0, min(1.0, 1.0 / exec_ratio)) if exec_ratio > 0 else 1.0


def _weights(results: List[dict]) -> List[float]:
    """Household weights for intensive quantities — each area's endline household count."""
    w = []
    for r in results:
        th = r.get('total_hh') or []
        w.append(th[-1] if th else 0.0)
    return w if any(w) else [1.0] * len(results)


def _wavg(values: List[float], weights: List[float]) -> float:
    tot = sum(weights)
    if not tot:
        return values[0] if values else 0.0
    return sum(v * w for v, w in zip(values, weights)) / tot


def aggregate(results: List[dict]) -> dict:
    """Element-wise sum of several per-area engine results into one national result.

    Extensive fields sum; intensive fields are re-derived from the summed components so the national
    figures stay internally consistent (e.g. national capex efficiency = Σ used ÷ Σ allocated, which is
    NOT the mean of the areas' efficiencies)."""
    if not results:
        return {}
    if len(results) == 1:
        return results[0]

    base = results[0]
    out = {k: base.get(k) for k in _SHARED_TOP}
    out['total_hh'] = _sum_series([r.get('total_hh') for r in results])
    out['population'] = _sum_series([r.get('population') for r in results])
    # Household size is people ÷ households, not a sum of the areas' sizes.
    out['hh_size'] = _ratio(out['population'], out['total_hh'])

    years = out.get('years') or []
    end_asis = out.get('end_asis_year')
    w = _weights(results)

    for sk in SECTORS:
        secs = [r.get(sk) or {} for r in results]
        agg: Dict[str, object] = {}
        for key, val in (secs[0] or {}).items():
            if key in _DERIVED_SECTOR:
                continue
            if isinstance(val, list) and val and isinstance(val[0], list):
                agg[key] = _sum_2d([s.get(key) for s in secs])
            elif isinstance(val, list):
                agg[key] = _sum_series([s.get(key) for s in secs])
            elif isinstance(val, (int, float)):
                agg[key] = sum((s.get(key) or 0) for s in secs)
            else:
                agg[key] = val

        agg['rungs'] = secs[0].get('rungs')
        agg['sector'] = secs[0].get('sector')
        # Unit costs are per-household prices → household-weighted, per the deck's own footnote.
        agg['cost_per_hh'] = _wavg([s.get('cost_per_hh') or 0.0 for s in secs], w)
        agg['cost_basic'] = _wavg([s.get('cost_basic') or 0.0 for s in secs], w)
        # `capex_efficiency` is the intervention's efficiency RAMP (1.0 when the lever is off), not
        # used÷allocated — weight the areas' ramps by the budget they apply to, per year.
        agg['capex_efficiency'] = _budget_weighted(
            [s.get('capex_efficiency') for s in secs], [s.get('budget_allocated') for s in secs])
        # Baseline efficiency mirrors the engine: reciprocal of the MEAN over historical years of
        # allocated ÷ used (model/water_supply.py:404-411). A ratio of sums over all years would
        # silently disagree with the per-area figure even when the areas are identical.
        agg['capex_efficiency_baseline'] = _baseline_efficiency(
            agg.get('budget_used') or [], agg.get('budget_allocated') or [], years, end_asis)
        agg['execution_rate'] = _wavg([s.get('execution_rate') or 0.0 for s in secs], w)
        agg['hist_cagr'] = _agg_hist_cagr(secs, years, end_asis)
        for prefix in ('', 'scenario_'):
            metadata = [s.get(prefix + 'connection_revenue') or {} for s in secs]
            modes = [bool(m.get('effective')) for m in metadata]
            agg[prefix + 'connection_revenue'] = {
                'requested': any(m.get('requested') for m in metadata),
                'effective': all(modes), 'mixed': len(set(modes)) > 1,
                'area_configurations': metadata,
            }
            # Intensive rates are revenue/billed-volume weighted, never summed.
            volumes = [s.get(prefix + 'billed_volume_million_m3') or [] for s in secs]
            rates = [s.get(prefix + 'applicable_tariff') or [] for s in secs]
            for field in ('applicable_tariff', 'applicable_collection_ratio'):
                vals = [s.get(prefix + field) or [] for s in secs]
                combined = []
                for i in range(len(years)):
                    weights = [(vol[i] if i < len(vol) else 0) *
                               (rates[j][i] if field.endswith('collection_ratio') and i < len(rates[j]) else 1)
                               for j, vol in enumerate(volumes)]
                    denom = sum(weights)
                    combined.append(sum((v[i] if i < len(v) else 0) * weights[j]
                                        for j, v in enumerate(vals)) / denom if denom else 0)
                agg[prefix + field] = combined
        if any(s.get('scenario_utility_debt') for s in secs):
            agg['scenario_utility_debt'] = _aggregate_utility_debt(
                [s.get('scenario_utility_debt') or {} for s in secs])
        out[sk] = agg

    return out


def _aggregate_utility_debt(summaries: List[dict]) -> dict:
    """Sum debt balances and annual schedules without averaging area-specific loan assumptions."""
    summaries = [s for s in summaries if s]
    numeric = ('accepted_principal', 'requested_max_principal', 'total_interest',
               'total_principal_repaid', 'closing_restricted_cash')
    rows_by_year = {}
    for summary in summaries:
        for row in summary.get('schedule') or []:
            year = int(row['year'])
            target = rows_by_year.setdefault(year, {'year': year})
            for key, value in row.items():
                if key != 'year' and isinstance(value, (int, float)):
                    target[key] = target.get(key, 0.0) + float(value or 0.0)
    statuses = list(dict.fromkeys(s.get('status', 'disabled') for s in summaries))
    enabled = [s for s in summaries if s.get('enabled')]
    result = {
        'schema_version': 1,
        'status': ' · '.join(statuses),
        'enabled': bool(enabled),
        'verified_feasible': bool(enabled) and all(s.get('verified_feasible') for s in enabled),
        'schedule': [rows_by_year[y] for y in sorted(rows_by_year)],
        'areas': summaries,
    }
    for key in numeric:
        result[key] = sum(float(s.get(key) or 0.0) for s in summaries)
    result['tail_capacity_assumption'] = next(
        (s.get('tail_capacity_assumption') for s in enabled if s.get('tail_capacity_assumption')), None)
    return result


def run_areas(area_inputs: Dict[str, dict]) -> Dict[str, dict]:
    """Run the engine once per entered area and add the aggregated National roll-up.

    `area_inputs` maps a scope name ('urban' | 'rural' | 'national') to that area's frontend-shaped
    inputs. Scopes the user never filled in must simply be absent — the deck drops their slides.
    A 'national' entry supplied directly (the no-breakdown entry mode) is used as-is and never
    overwritten by a roll-up."""
    results: Dict[str, dict] = {}
    for scope, fe in area_inputs.items():
        if not fe:
            continue
        results[scope] = calculate(coerce_to_engine(fe))

    if 'national' not in results:
        parts = [results[s] for s in ('urban', 'rural') if s in results]
        if len(parts) > 1:
            results['national'] = aggregate(parts)
        elif len(parts) == 1:
            # Only one of the two was entered: there is no meaningful national roll-up distinct
            # from it, so don't invent one — the caller drops the National slides.
            pass
    return results
