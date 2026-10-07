"""Canonical shared revenue bases and exogenous paths; optional feedback is in connection_revenue."""
import copy
import math
import numpy as np


class RevenueInputError(ValueError):
    pass


def number(value, label, maximum=None):
    if isinstance(value, bool) or value is None:
        raise RevenueInputError(f'{label} is required.')
    try:
        value = float(value)
    except (TypeError, ValueError):
        raise RevenueInputError(f'{label} must be numeric.')
    if not math.isfinite(value) or value < 0 or (maximum is not None and value > maximum):
        raise RevenueInputError(f'{label} must be finite and between 0 and {maximum}.' if maximum is not None
                                else f'{label} must be finite and nonnegative.')
    return value


def validate_base(base):
    if not isinstance(base, dict):
        raise RevenueInputError('Shared revenue base must be an object.')
    b = copy.deepcopy(base)
    if b.get('version') != 1:
        raise RevenueInputError('Unsupported utility revenue-base version.')
    for field in ('volume_mld', 'tariff', 'reference_year'):
        b[field] = number(b.get(field), field)
    if b['reference_year'] != int(b['reference_year']) or b['reference_year'] < 1:
        raise RevenueInputError('Revenue reference year must be a positive integer.')
    b['reference_year'] = int(b['reference_year'])
    b['collection_ratio'] = number(b.get('collection_ratio'), 'collection_ratio', 1)
    growth = b.get('growth_rate')
    if growth is not None:
        try:
            growth = float(growth)
        except (TypeError, ValueError):
            raise RevenueInputError('Volume growth must be numeric or blank.')
        if not math.isfinite(growth) or growth <= -1:
            raise RevenueInputError('Volume growth must be finite and greater than -100%.')
    b['growth_rate'] = growth
    return b


def volume_path(base, ctx, days=365, liters=1000):
    b = validate_base(base)
    years = np.asarray(ctx['years'])
    if b['growth_rate'] is not None:
        factor = (1 + b['growth_rate']) ** (years - b['reference_year'])
    else:
        matches = np.where(years == b['reference_year'])[0]
        if not len(matches):
            raise RevenueInputError('Revenue reference year must be inside the model horizon for population growth.')
        population = np.asarray(ctx['population'])
        anchor = population[matches[0]]
        if anchor <= 0:
            if b['volume_mld'] == 0:
                return np.zeros(len(years))
            raise RevenueInputError('A positive reference-year population is required for billed-volume growth.')
        factor = population / anchor
    q = b['volume_mld'] * days / liters * factor
    if not np.all(np.isfinite(q)) or np.any(q < 0):
        raise RevenueInputError('Billed-volume projection must be finite and nonnegative.')
    return q


def resolve_bases(inputs, ctx):
    """Resolve without toggle-dependent choices; legacy conflicts fall back to collection inputs."""
    raw = inputs.revenue_legacy or {
        'water_interventions': inputs.water_interventions.model_dump(),
        'sanitation_interventions': inputs.sanitation_interventions.model_dump(),
    }
    w = raw.get('water_interventions', {})
    s = raw.get('sanitation_interventions', {})
    out = {}
    for sector, iv in (('water', w), ('sanitation', s)):
        canonical = inputs.revenue_bases.get(sector)
        if canonical is not None:
            base = validate_base(canonical)
            volume_path(base, ctx, inputs.constants.days_in_year, inputs.constants.cubic_meter_liters)
            out[sector] = {'base': base, 'alternatives': [], 'error': None}
            continue
        alternatives = []
        errors = []
        for origin in ('collection', 'tariff'):
            try:
                ratio = w.get('ce_current_ratio') if sector == 'water' or s.get('ce_current_ratio') is None else s['ce_current_ratio']
                if origin == 'collection':
                    volume = number(w.get('ce_water_sold_mld'), 'Legacy collection billed volume')
                    tariff = number(w.get('ce_current_tariff'), 'Legacy collection tariff')
                    if sector == 'sanitation':
                        volume *= number(s.get('ce_wastewater_collected_pct', inputs.sanitation_interventions.ce_wastewater_collected_pct), 'Wastewater share', 1)
                        tariff *= number(s.get('ce_sewer_tariff_pct_water'), 'Sewer tariff share', 1)
                    anchor = w.get('ce_start_year')
                    growth = w.get('ce_vol_growth')
                else:
                    volume = iv.get('tariff_volume_mld')
                    tariff = iv.get('tariff_current')
                    anchor = iv.get('tariff_start_year')
                    growth = None
                base = validate_base(dict(version=1, volume_mld=volume, tariff=tariff,
                                          collection_ratio=ratio, reference_year=anchor,
                                          growth_rate=growth, origin=origin,
                                          legacy=copy.deepcopy(raw)))
                path = volume_path(base, ctx, inputs.constants.days_in_year, inputs.constants.cubic_meter_liters)
                alternatives.append({'base': base, 'annual_volume_million_m3': path.tolist()})
            except (RevenueInputError, TypeError, ValueError) as exc:
                errors.append(str(exc))
        selected = None
        if not alternatives and sector == 'water':
            # Sole valid legacy NRW tariff: retain its rate and explicitly derive
            # the existing billed-water anchor from system input less baseline NRW.
            try:
                selected = validate_base(dict(
                    version=1,
                    volume_mld=number(w.get('nrw_system_input_vol'), 'Legacy NRW system input') *
                        (1 - number(w.get('nrw_current_pct'), 'Legacy NRW proportion', 1)),
                    tariff=w.get('nrw_tariff'), collection_ratio=w.get('ce_current_ratio'),
                    reference_year=w.get('nrw_start_year'),
                    growth_rate=w.get('nrw_vol_growth'), origin='sole legacy NRW tariff',
                    legacy=copy.deepcopy(raw)))
                volume_path(selected, ctx, inputs.constants.days_in_year, inputs.constants.cubic_meter_liters)
            except (RevenueInputError, TypeError, ValueError) as exc:
                errors.append(str(exc))
                selected = None
        if len(alternatives) == 1:
            selected = alternatives[0]['base']
        elif len(alternatives) == 2:
            a, b = alternatives
            if (np.allclose(a['annual_volume_million_m3'], b['annual_volume_million_m3'], rtol=1e-8, atol=1e-10)
                    and math.isclose(a['base']['tariff'], b['base']['tariff'], rel_tol=1e-8, abs_tol=1e-10)
                    and math.isclose(a['base']['collection_ratio'], b['base']['collection_ratio'], abs_tol=1e-10)):
                selected = a['base']
                selected['origin'] = 'equivalent legacy bases'
            else:
                # When legacy values disagree, keep the shared-base model but use the
                # collection-efficiency inputs as the explicit fallback instead of
                # blocking calculation on a reconciliation prompt.
                selected = copy.deepcopy(a['base'])
                selected['origin'] = 'collection-efficiency fallback'
        out[sector] = {'base': selected, 'alternatives': alternatives,
                       'error': None if selected else ('Conflicting billed-revenue bases. Choose one or enter a shared base.'
                                                      if alternatives else '; '.join(errors))}
    return out


def collected_revenue(q, tariff, collection, tariff_delta, collection_delta):
    """Collection-first identity, tolerance rtol=1e-10, atol=1e-9 (currency M)."""
    q = np.asarray(q, dtype=float)
    p = number(tariff, 'Baseline tariff')
    c = number(collection, 'Baseline collection ratio', 1)
    dp = np.asarray(tariff_delta, dtype=float)
    dc = np.asarray(collection_delta, dtype=float)
    if not all(np.all(np.isfinite(x)) for x in (q, dp, dc)) or np.any(q < 0) or np.any(p + dp < 0) or np.any(c + dc < 0) or np.any(c + dc > 1 + 1e-12):
        raise RevenueInputError('Utility reforms require nonnegative volume/tariffs and collection ratios within 0–100%.')
    baseline = q * p * c
    scenario = q * (p + dp) * (c + dc)
    ce = q * p * dc
    tr = q * dp * (c + dc)
    if not np.allclose(scenario - baseline, ce + tr, rtol=1e-10, atol=1e-9):
        raise RevenueInputError('Collected-revenue identity did not reconcile.')
    return baseline, scenario, ce, tr