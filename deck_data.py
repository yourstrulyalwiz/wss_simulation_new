"""Everything the slide deck needs, computed once from the engine.

Kept separate from the .pptx plumbing in `export_deck.py` so the numbers can be tested without
opening PowerPoint. All money is local-currency MILLIONS internally (the engine's native unit) and is
converted to billions only at the point of display; households are millions throughout, which is both
the engine's unit and the unit the deck asks for.
"""

import copy
from typing import Dict, List, Optional, Tuple

from deck_aggregate import aggregate, run_areas
from demo_adapter import coerce_to_engine, financial_toggles
from model.engine import calculate

# Per-intervention definitions, mirroring the Results dashboard exactly — same labels, same colours,
# same order (the order is load-bearing: attribution is marginal and cumulative, so a lever's measured
# contribution depends on what is already switched on beneath it).
# `kind` decides how the lever is priced:
#   revenue   — it mobilises cash; report the cash stream
#   execution — it raises the share of the allocated budget that reaches service
#   cost      — it cuts the unit cost of a connection, so the same budget buys more
WATER_INTV = [
    ('ws_financial_commitment_enabled', 'Increase in Financial Commitments', 'scenario_financial_commitment_cash', '0f766e', 'revenue'),
    ('ws_exogenous_injection_enabled', 'Exogenous Injection of Funds', 'scenario_exogenous_injection_cash', 'b45309', 'revenue'),
    ('ws_collection_efficiency_enabled', 'Increased collection efficiency', 'scenario_collection_cash', '1a9ed6', 'revenue'),
    ('ws_nrw_enabled', 'NRW reduction', 'scenario_nrw_net', 'fb464b', 'revenue'),
    ('ws_capital_efficiency_enabled', 'Budget execution improvement', None, 'c58216', 'execution'),
    ('ws_costeff_enabled', 'Capex efficiency (unit cost)', None, '7238f8', 'cost'),
    ('ws_techmix_enabled', 'Optimised technology selection', None, 'b814a0', 'cost'),
    ('ws_tariff_enabled', 'Tariff reform', 'scenario_tariff_cash', 'c355fb', 'revenue'),
    ('ws_microfinance_enabled', 'Microfinance', 'scenario_mf_loan_volume', 'c5146a', 'revenue'),
]
SAN_INTV = [
    ('san_financial_commitment_enabled', 'Increase in Financial Commitments', 'scenario_financial_commitment_cash', '0f766e', 'revenue'),
    ('san_exogenous_injection_enabled', 'Exogenous Injection of Funds', 'scenario_exogenous_injection_cash', 'b45309', 'revenue'),
    ('san_collection_efficiency_enabled', 'Increased collection efficiency', 'scenario_collection_cash', '1a9ed6', 'revenue'),
    ('san_capital_efficiency_enabled', 'Budget execution improvement', None, 'c58216', 'execution'),
    ('san_costeff_enabled', 'Capex efficiency (unit cost)', None, '7238f8', 'cost'),
    ('san_techmix_enabled', 'Optimised technology selection', None, 'b814a0', 'cost'),
    ('san_nrw_link_enabled', 'NRW-linked sanitation revenue', 'scenario_nrw_link_cash', 'fb464b', 'revenue'),
    ('san_tariff_enabled', 'Tariff reform', 'scenario_tariff_cash', 'c355fb', 'revenue'),
    ('san_microfinance_enabled', 'Microfinance', 'scenario_mf_loan_volume', 'c5146a', 'revenue'),
]
INTV = {'water_supply': WATER_INTV, 'sanitation': SAN_INTV}
CUSTOM_COLOR = 'ae4f0e'
BAU_COLOR = '2563eb'

SECTORS = ('water_supply', 'sanitation')
SCOPES = ('urban', 'rural', 'national')


# ── small helpers ───────────────────────────────────────────────────────────────────────────────

def cur_of(inputs) -> str:
    return (inputs.get('country_config') or {}).get('currency') or 'LCU'


def baseline_year(inputs, years) -> int:
    return int((inputs.get('period') or {}).get('baseline_year') or years[0])


def _target_section(inputs, sector_key) -> dict:
    return inputs.get('water_targets' if sector_key == 'water_supply' else 'sanitation_targets') or {}


def target_points(inputs, sector_key) -> List[Tuple[int, List[float]]]:
    """[(year, 5 service-level shares)] for each target, newest schema first, legacy pair as fallback."""
    sec = _target_section(inputs, sector_key)
    pts = []
    for t in (sec.get('targets') or []):
        if t.get('year'):
            sh = list(t.get('shares') or [])
            pts.append((int(t['year']), (sh + [0.0] * 5)[:5]))
    if pts:
        return sorted(pts)
    p = inputs.get('period') or {}
    tag = 'serv' if sector_key == 'water_supply' else 'sserv'
    for n, yk in ((1, 'target1_year'), (2, 'target2_year')):
        y = p.get(yk)
        if y:
            pts.append((int(y), [float(sec.get(f'target{n}_{tag}{r}') or 0.0) for r in range(1, 6)]))
    return sorted(pts)


def target_years(inputs, sector_key) -> List[int]:
    return [y for y, _ in target_points(inputs, sector_key)]


def _idx(years: List[int], year: int) -> int:
    """Index of a year, clamped into range so a target beyond the horizon still resolves."""
    if year in years:
        return years.index(year)
    return len(years) - 1 if year > years[-1] else 0


def _rng(series, years, lo, hi) -> float:
    """Sum a per-year series over the inclusive year range [lo, hi]."""
    if not series:
        return 0.0
    return sum((series[i] or 0.0) for i, y in enumerate(years) if lo <= y <= hi and i < len(series))


def _at(series, i, rung: Optional[int] = None) -> float:
    if not series:
        return 0.0
    arr = series[rung] if (rung is not None and series and isinstance(series[0], list)) else series
    return (arr[i] if i < len(arr) else 0.0) or 0.0


# ── per-intervention attribution ────────────────────────────────────────────────────────────────

def _run(fe: dict, toggles: dict, keep_customs: bool = False) -> dict:
    f = copy.deepcopy(fe)
    f['toggles'] = dict(toggles)
    if not keep_customs:
        f['custom_interventions'] = []
    return calculate(coerce_to_engine(f))


def cumulative_passes(area_fes: List[dict]) -> Tuple[List[dict], List[tuple], bool]:
    """Aggregated engine results for pass 0 (all levers off) then one per enabled lever.

    The lever order is GLOBAL — every enabled water lever, then every enabled sanitation lever —
    which is what the Results dashboard does and what the cross-sector NRW→sanitation link needs: it
    can only score correctly when water's NRW lever is already on beneath it. `export_data`'s older
    per-sector version measures that lever with water NRW off, so it reports ≈0.

    Each pass is run for every area in `area_fes` and the results summed, so a National block is the
    roll-up of the same cumulative sequence rather than a separate attribution."""
    defs = WATER_INTV + SAN_INTV
    original = [financial_toggles(fe) for fe in area_fes]
    enabled = [d for d in defs if any(tg.get(d[0]) for tg in original)]
    has_custom = any(any((c or {}).get('enabled') for c in (fe.get('custom_interventions') or []))
                     for fe in area_fes)

    # Each area keeps its own selections. This matters for a synthesized National roll-up where, for
    # example, Rural enables a lever that Urban does not: the cumulative pass must not copy Urban's
    # toggle set onto Rural or omit Rural-only levers.
    all_keys = {d[0] for d in defs}
    accumulators = [{**tg, **{k: False for k in all_keys}} for tg in original]
    passes = [aggregate([_run(fe, acc) for fe, acc in zip(area_fes, accumulators)])]
    for key, *_ in enabled:
        for acc, tg in zip(accumulators, original):
            acc[key] = bool(tg.get(key))
        passes.append(aggregate([_run(fe, acc) for fe, acc in zip(area_fes, accumulators)]))
    if has_custom:
        # Customs sit on top of every built-in lever and are reported as one aggregate band.
        passes.append(aggregate([_run(fe, acc, keep_customs=True)
                                 for fe, acc in zip(area_fes, accumulators)]))
    return passes, enabled, has_custom


def _released(before: dict, after: dict, sk: str, kind: str, years, by) -> Optional[float]:
    """Budget released by a lever that mobilises no cash, in local-currency millions.

    execution — extra effective capital reaching service (allocated budget × execution efficiency).
                Must read `scenario_available_capex`: the top-level `bau_available` is the frozen BAU
                counterfactual and is identical in every pass, so it would score this lever at zero.
    cost      — the per-household unit-cost saving times the households actually connected that year."""
    b, a = before[sk], after[sk]
    if kind == 'execution':
        return max(0.0, _rng(a.get('scenario_available_capex'), years, by + 1, years[-1])
                   - _rng(b.get('scenario_available_capex'), years, by + 1, years[-1]))
    if kind == 'cost':
        cb, ca = b.get('scenario_cost_sm_t') or [], a.get('scenario_cost_sm_t') or []
        sm = a.get('scenario_hh') or []
        total = 0.0
        for i, y in enumerate(years):
            if y <= by or i >= len(ca) or i >= len(cb):
                continue
            new_hh = max(0.0, _at(sm, i, 0) - _at(sm, i - 1, 0))     # M HH connected this year
            total += (cb[i] - ca[i]) * new_hh                        # (LC/HH) × M HH = LC millions
        return max(0.0, total)
    return None


def intervention_rows(passes, enabled, has_custom, sk: str, years, by) -> List[dict]:
    """One row per enabled lever for this sector: marginal households, money, and per-year band."""
    e = len(years) - 1
    out = []
    for idx, (key, label, rkey, color, kind) in enumerate(enabled):
        if not key.startswith('ws_' if sk == 'water_supply' else 'san_'):
            continue
        before, after = passes[idx], passes[idx + 1]
        add_hh = max(0.0, _at(after[sk].get('scenario_hh'), e, 0) - _at(before[sk].get('scenario_hh'), e, 0))
        if rkey:
            money = (_rng(after[sk].get(rkey), years, by + 1, years[-1])
                     - _rng(before[sk].get(rkey), years, by + 1, years[-1]))
        else:
            money = _released(before, after, sk, kind, years, by)
        band = [max(0.0, _at(after[sk].get('scenario_hh'), i, 0) - _at(before[sk].get('scenario_hh'), i, 0))
                for i in range(len(years))]
        out.append({'key': key, 'label': label, 'color': color, 'kind': kind,
                    'added_hh': add_hh, 'money_m': money, 'band': band})
    if has_custom:
        before, after = passes[-2], passes[-1]
        band = [max(0.0, _at(after[sk].get('scenario_hh'), i, 0) - _at(before[sk].get('scenario_hh'), i, 0))
                for i in range(len(years))]
        add_hh = max(0.0, _at(after[sk].get('scenario_hh'), e, 0) - _at(before[sk].get('scenario_hh'), e, 0))
        if add_hh > 1e-9 or any(v > 1e-9 for v in band):
            out.append({'key': '__custom', 'label': 'Custom interventions', 'color': CUSTOM_COLOR,
                        'kind': 'revenue', 'added_hh': add_hh, 'money_m': None, 'band': band})
    return out


# ── per-block figures ───────────────────────────────────────────────────────────────────────────

def block_data(result: dict, inputs: dict, sk: str, passes, enabled, has_custom) -> dict:
    """Every number the six slides of one scope×sector block need."""
    years = result['years']
    by = baseline_year(inputs, years)
    bi = _idx(years, by)
    e = len(years) - 1
    sec = result[sk]
    total = result['total_hh']
    tpts = target_points(inputs, sk) or [(years[-1], [1.0, 0.0, 0.0, 0.0, 0.0])]
    tys = [y for y, _ in tpts]
    tshares = dict(tpts)
    ft, lt = tys[0], tys[-1]
    fti, lti = _idx(years, ft), _idx(years, lt)
    first_data = years[0]

    def share(mat, i, rungs):
        t = total[i] if i < len(total) else 0.0
        if not t:
            return 0.0
        return sum(_at(mat, i, r) for r in rungs) / t

    bau, tgt = sec.get('bau_hh'), sec.get('target_hh')
    # ACTUAL columns come from the household counts, which sum exactly to total_hh. TARGET columns come
    # from the shares the user entered, NOT from `target_hh`: past the final target only that array's
    # safely-managed rung is driven to the target, while the lower rungs keep a stale interpolated
    # value — at 2040 the five rungs sum to 1.25× total households, which would print as 125% coverage.
    def target_col(y):
        sh = tshares.get(y) or [0.0] * 5
        tot = sum(sh) or 1.0
        return [v / tot for v in sh]

    cols = []
    for y in (first_data, by):
        i = _idx(years, y)
        cols.append([share(bau, i, [0]), share(bau, i, [1]), share(bau, i, [2, 3, 4])])
    for y in (ft, lt):
        sh = target_col(y)
        cols.append([sh[0], sh[1], sh[2] + sh[3] + sh[4]])
    coverage = {
        'years': [first_data, by, ft, lt],
        'sm': [c[0] for c in cols],
        'basic': [c[1] for c in cols],
        'less': [c[2] for c in cols],
        'total_hh': [(total[_idx(years, y)] if _idx(years, y) < len(total) else 0.0)
                     for y in (first_data, by, ft, lt)],
    }

    gap_years = [by, ft, lt]
    service_gap = {
        'years': gap_years,
        'covered': [_at(bau, _idx(years, y), 0) for y in gap_years],
        'gap': [max(0.0, _at(tgt, _idx(years, y), 0) - _at(bau, _idx(years, y), 0)) for y in gap_years],
    }

    # Investment periods come from the target years, not the retired 5-year planned-investment blocks.
    periods = [(f'{by + 1}–{ft}', by + 1, ft)]
    if lt > ft:
        periods.append((f'{ft + 1}–{lt}', ft + 1, lt))
    periods.append((f'Total {by + 1}–{lt}', by + 1, lt))
    inv_rows = [
        ('Annual planned expansion — sum of flows', 'annual_planned_expansion_cost'),
        ('Replacement requirement — sum of flows', 'replacement_capex'),
        ('Closing outstanding expansion — end balance', 'closing_outstanding_expansion'),
        ('Catch-up before funding — end-year snapshot', 'catch_up_requirement'),
        ('Replacement credit — sum of flows', 'replacement_credit'),
        ('Unpaid replacement — sum of flows', 'unfunded_replacement'),
        ('Negative cash — sum of flows', 'cash_deficit'),
        ('Endline requirement incl. all prior shortfalls', 'endline_financing_requirement'),
        ('Total available capital (reporting only)', 'available_total'),
        ('Coverage-stock replacement basis', 'bau_replacement_capex'),
        ('Replacement funding reserved', 'replacement_reserved'),
        ('Funded expansion — sum of flows', 'sector_funded_expansion'),
        ('External expansion — sum of flows', 'externally_funded_expansion'),
        ('Gross funded stock — end balance', 'funded_asset_stock'),
        ('Unallocated positive expansion capital', 'unallocated_positive_capital'),
    ]
    investment = {
        'periods': [p[0] for p in periods],
        'rows': [(lbl, [(_at(sec[f], _idx(years, hi)) if f in (
            'closing_outstanding_expansion', 'catch_up_requirement',
            'endline_financing_requirement', 'funded_asset_stock') else
            _rng(sec.get(f), years, lo, hi)) for _, lo, hi in periods]) for lbl, f in inv_rows],
    }

    rows = intervention_rows(passes, enabled, has_custom, sk, years, by)
    base_band = [_at(passes[0][sk].get('scenario_hh'), i, 0) for i in range(len(years))]
    # Only show bands for levers that actually move the chart; an enabled-but-unparameterised lever
    # contributes a flat zero and would just add legend noise. It still appears in the table.
    chart_bands = [r for r in rows if any(v > 1e-4 for v in r['band'])]
    fi = bi  # chart starts at the baseline year; history is covered by the coverage table
    interventions = {
        'rows': rows,
        'chart': {
            'years': years[fi:],
            'base': base_band[fi:],
            'bands': [(r['label'], r['color'], r['band'][fi:]) for r in chart_bands],
            # Reference line for the template's line group — the safely-managed target path, clamped
            # to total households (past the final target the raw array over-runs the population).
            'target': [min(total[i] if i < len(total) else 0.0, _at(tgt, i, 0)) for i in range(fi, len(years))],
        },
    }

    tot_need = _rng(sec['annual_planned_expansion_cost'], years, by + 1, lt) + _rng(sec['replacement_capex'], years, by + 1, lt)
    bau_inv = _rng(sec.get('bau_available'), years, by + 1, lt)
    # Households per year the target implies, against the rate actually achieved over the actuals
    # window — the pair the coverage slide's talking points compare.
    hist_span = max(1, by - first_data)
    tgt_span = max(1, lt - by)
    hist_rate = (_at(bau, bi, 0) - _at(bau, 0, 0)) / hist_span
    tgt_sm_end = (tshares.get(lt) or [1.0])[0] * (total[lti] if lti < len(total) else 0.0)
    tgt_rate = max(0.0, tgt_sm_end - _at(bau, bi, 0)) / tgt_span
    return {
        'hist_rate': hist_rate, 'tgt_rate': tgt_rate,
        'years': years, 'baseline_year': by, 'end_year': years[-1], 'first_data_year': first_data,
        'first_target_year': ft, 'last_target_year': lt,
        'coverage': coverage, 'service_gap': service_gap, 'investment': investment,
        'interventions': interventions,
        'cov_now': share(bau, bi, [0]), 'cov_bau_end': share(bau, lti, [0]),
        'cov_tgt_end': share(tgt, lti, [0]),
        'cov_scn_end': (min(total[lti], _at(sec.get('scenario_hh'), lti, 0)) / total[lti]) if total[lti] else 0.0,
        'hh_moved': _at(bau, bi, 0) - _at(bau, 0, 0),
        'unserved_baseline': max(0.0, (total[bi] if bi < len(total) else 0.0) - _at(bau, bi, 0)),
        'gap_end': max(0.0, _at(tgt, lti, 0) - _at(bau, lti, 0)),
        'total_need_m': tot_need, 'bau_investment_m': bau_inv,
        'replacement_credit_m': _rng(sec.get('replacement_credit'), years, by + 1, lt),
        'financing_gap_m': _at(sec['endline_financing_requirement'], _idx(years, lt)),
    }


def _fmt_pct(v) -> str:
    return f'{v * 100:.0f}%'


def lever_performance(inputs: dict, sector_key: str, key: str) -> dict:
    """Baseline/target performance and timing for one lever, read from its own parameters.

    Each lever states its ambition in its own units — a collection ratio, an NRW percentage, a tariff
    per m³ — so there is no single series to read; the figures come from the inputs the user set.
    Microfinance has no single current→target pair (it is a set of loan terms), so it reports n/a."""
    sec = inputs.get('water_interventions' if sector_key == 'water_supply'
                     else 'sanitation_interventions') or {}
    wat = inputs.get('water_interventions') or {}

    def g(name, default=None):
        v = sec.get(name)
        return default if v is None else v

    stem = key.split('_', 1)[1].replace('_enabled', '')
    if 'collection_efficiency' in key:
        # Sanitation reuses water's collection ratios (its own section carries only the sewer-tariff %).
        src = sec if sec.get('ce_current_ratio') is not None else wat
        return {'current': _fmt_pct(src.get('ce_current_ratio') or 0),
                'target': _fmt_pct(src.get('ce_target_ratio') or 0),
                'start_year': g('ce_start_year'), 'target_year': g('ce_target_year')}
    if 'financial_commitment' in key:
        modes = []
        if g('fin_gdp_enabled', False):
            modes.append(f"target {_fmt_pct(g('fin_gdp_target_share', 0))} of GDP")
        if g('fin_growth_enabled', False):
            modes.append(f"{_fmt_pct(g('fin_growth_rate', 0))} annual growth")
        starts = [g(k) for k, enabled in [
            ('fin_gdp_start_year', g('fin_gdp_enabled', False)),
            ('fin_growth_start_year', g('fin_growth_enabled', False)),
        ] if enabled and g(k)]
        ends = [g('fin_growth_end_year') if g('fin_growth_enabled', False) else None]
        return {'current': 'BAU spending', 'target': ', '.join(modes) or 'no mechanism selected',
                'start_year': min(starts) if starts else None,
                'target_year': max([x for x in ends if x] or starts or [None])}
    if 'exogenous_injection' in key:
        mode = g('fin_injection_mode', 'one_time')
        amount = float(g('fin_injection_amount', 0) or 0)
        start = g('fin_injection_start_year')
        return {'current': 'no injection',
                'target': f"{amount:,.0f} {cur_of(inputs)} million" + (' annually' if mode == 'recurring' else ' once'),
                'start_year': start,
                'target_year': g('fin_injection_end_year') if mode == 'recurring' else start}
    if key == 'ws_nrw_enabled':
        return {'current': _fmt_pct(g('nrw_current_pct', 0)), 'target': _fmt_pct(g('nrw_target_pct', 0)),
                'start_year': g('nrw_start_year'), 'target_year': g('nrw_target_year')}
    if key == 'san_nrw_link_enabled':
        return {'current': 'no sewer revenue from recovered water',
                'target': _fmt_pct(g('nrw_link_return_ratio', 0)) + ' of recovered water billed',
                'start_year': wat.get('nrw_start_year'), 'target_year': wat.get('nrw_target_year')}
    if 'capital_efficiency' in key:
        cur = g('capeff_current_pct') or 0
        return {'current': _fmt_pct(cur) if cur > 0 else 'auto (from budget history)',
                'target': _fmt_pct(g('capeff_target_pct', 0)),
                'start_year': g('capeff_start_year'), 'target_year': g('capeff_target_year')}
    if 'costeff' in key:
        return {'current': _fmt_pct(g('costeff_current_pct', 0)), 'target': _fmt_pct(g('costeff_target_pct', 0)),
                'start_year': g('costeff_start_year'), 'target_year': g('costeff_target_year')}
    if 'techmix' in key:
        return {'current': 'BAU technology mix', 'target': 'optimised technology mix',
                'start_year': g('techmix_start_year'), 'target_year': g('techmix_start_year')}
    if 'tariff' in key:
        c = cur_of(inputs)
        return {'current': f"{g('tariff_current', 0):,.0f} {c}/m³",
                'target': f"{g('tariff_target', 0):,.0f} {c}/m³",
                'start_year': g('tariff_start_year'), 'target_year': g('tariff_target_year')}
    if 'microfinance' in key:
        return {'current': 'n/a', 'target': 'n/a',
                'start_year': g('mf_start_year'), 'target_year': g('mf_end_year')}
    return {'current': 'n/a', 'target': 'n/a', 'start_year': None, 'target_year': None}


def build(area_inputs: Dict[str, dict]) -> dict:
    """Run every entered area and assemble the deck's numbers.

    `area_inputs` maps 'urban' / 'rural' / 'national' to that area's frontend-shaped inputs. Scopes the
    user never filled in are simply absent and their slides get dropped."""
    results = run_areas(area_inputs)
    primary = area_inputs.get('urban') or area_inputs.get('national') or next(iter(area_inputs.values()))

    members = {
        'urban': [area_inputs['urban']] if 'urban' in area_inputs else None,
        'rural': [area_inputs['rural']] if 'rural' in area_inputs else None,
    }
    if 'national' in area_inputs:
        members['national'] = [area_inputs['national']]
    elif 'urban' in area_inputs and 'rural' in area_inputs:
        members['national'] = [area_inputs['urban'], area_inputs['rural']]
    else:
        members['national'] = None

    blocks: Dict[Tuple[str, str], dict] = {}
    for scope in SCOPES:
        fes = members.get(scope)
        if not fes or scope not in results:
            continue
        passes, enabled, has_custom = cumulative_passes(fes)
        for sk in SECTORS:
            blocks[(scope, sk)] = block_data(results[scope], primary, sk, passes, enabled, has_custom)

    years = results[next(iter(results))]['years']
    cc = primary.get('country_config') or {}
    tech = primary.get('technical') or {}
    lives = sorted({int(tech.get('ws_asset_life') or 0), int(tech.get('san_asset_life') or 0)} - {0})
    tys = sorted(set(target_years(primary, 'water_supply')) | set(target_years(primary, 'sanitation')))
    return {
        'results': results, 'blocks': blocks, 'inputs': primary, 'area_inputs': area_inputs,
        'scopes': [s for s in SCOPES if s in results],
        'country': cc.get('country') or 'Country',
        'area': cc.get('area') or '',
        'currency': cur_of(primary),
        'baseline_year': baseline_year(primary, years),
        'end_year': years[-1], 'first_data_year': years[0],
        'years': years,
        'target_years': tys,
        # Water and sanitation carry separate asset lives; the appendix has one slot for both.
        'asset_life': '/'.join(str(v) for v in lives) if lives else '30',
    }
