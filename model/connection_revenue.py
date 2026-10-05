"""Optional lagged household revenue. Volumes/cash in millions, consumption in m³/HH."""
import copy
import math
import numpy as np
from .utility_revenue import number, volume_path, RevenueInputError


DIAGNOSTIC_FIELDS = (
    'connection_billed_households', 'household_billed_volume_million_m3',
    'nonhousehold_billed_volume_million_m3', 'reference_billed_volume_million_m3',
    'reference_collected_revenue', 'connection_revenue_delta',
    'incremental_variable_operating_cost', 'connection_net_cash',
    'additional_net_cash', 'applicable_tariff', 'applicable_collection_ratio',
)


def prepare_connection(config, base, ctx, history, days=365, liters=1000):
    """Resolve frozen references and calibration without depending on scenario toggles."""
    if config is not None and not isinstance(config, dict):
        return {'requested': True, 'effective': False,
                'errors': ['Connection revenue configuration must be an object.'],
                'configuration': config, 'calibration': None, 'warnings': []}, None
    cfg = copy.deepcopy(config or {})
    status = {'requested': bool(cfg.get('enabled')), 'effective': False,
              'errors': [], 'configuration': cfg, 'calibration': None,
              'warnings': ['Only SM/basic billing is modeled; billed shares are average propensities, not customer cohorts.',
                           'Baseline funding must already represent the selected reference net contribution.',
                           'NRW cash/physical effects are unchanged; overlap with billed volume is not fully reconciled.']}
    if not status['requested']:
        return status, None
    errors = status['errors']
    values = {}
    required = ('billed_share_sm', 'billed_share_basic', 'household_volume_share', 'marginal_cost')
    for key in required:
        try:
            values[key] = number(cfg.get(key), key, 1 if key != 'marginal_cost' else None)
        except RevenueInputError as exc:
            errors.append(str(exc))
    if cfg.get('version') != 1:
        errors.append('Connection revenue configuration must have version 1.')
    if base is None:
        errors.append('A valid shared revenue base is required.')
    if cfg.get('reference_confirmed') is not True:
        errors.append('Confirm the household revenue path already represented in funding.')
    if cfg.get('funding_includes_reforms') is not False:
        errors.append('Confirm baseline funding does not already include future tariff/collection reforms.')
    if cfg.get('funding_reference') not in ('exogenous', 'fixed', 'series'):
        errors.append('Select exogenous, fixed or supplied-series funding reference.')
    if values.get('marginal_cost') == 0 and cfg.get('zero_cost_confirmed') is not True:
        errors.append('Zero marginal cost requires confirmation of the gross-revenue simplification.')
    provenance_fields = list(required)
    if cfg.get('alignment') == 'observation':
        provenance_fields.append('baseline_volume_mld')
    for key in ('consumption_m3', 'observed_billed_households', 'nonhousehold_growth_rate'):
        if cfg.get(key) is not None:
            provenance_fields.append(key)
    if cfg.get('funding_reference') == 'series':
        provenance_fields.append('reference_series')
    provenance = cfg.get('provenance') or {}
    if not isinstance(provenance, dict):
        provenance = {}
        errors.append('Provenance must be an object keyed by assumption.')
    for key in provenance_fields:
        source = provenance.get(key) or {}
        if not isinstance(source, dict):
            source = {}
        if source.get('source_type') not in ('observed', 'assumed') or not str(source.get('note') or '').strip():
            errors.append(f'{key}: select observed/assumed and supply a source or assumption note.')
        year = source.get('reference_year')
        if year is not None and (isinstance(year, bool) or not isinstance(year, (float, int)) or
                                 not math.isfinite(year) or year < 1 or int(year) != year):
            errors.append(f'{key}: source reference year must be a positive integer.')
    if errors:
        return status, None
    try:
        years, bi = np.asarray(ctx['years']), ctx['bi']
        by = int(years[bi])
        original = volume_path(base, ctx, days, liters)
        aligned = copy.deepcopy(base)
        if cfg.get('alignment') == 'observation':
            aligned['volume_mld'] = number(cfg.get('baseline_volume_mld'), 'Baseline observed volume')
            aligned['reference_year'] = by
        elif int(base['reference_year']) != by and cfg.get('alignment') != 'estimate':
            raise RevenueInputError('Volume anchor differs from baseline: supply a baseline observation or explicitly authorize the growth estimate.')
        exogenous = volume_path(aligned, ctx, days, liters)
        q0 = float(exogenous[bi])
        fsm, fb, h, v = [values[k] for k in required]
        n0 = fsm * history[0, bi] + fb * history[1, bi]  # million HH
        hh0 = h * q0  # million m³
        if n0 <= 0 and hh0 > 0:
            raise RevenueInputError('Positive household volume with zero billed-household equivalents is inconsistent.')
        if h == 0:
            q = 0.0
        elif n0 <= 0:
            q = number(cfg.get('consumption_m3'), 'Consumption assumption for zero starting calibration')
        else:
            q = hh0 / n0
            if cfg.get('consumption_m3') is not None and not math.isclose(
                    number(cfg['consumption_m3'], 'Consumption assumption'), q, rel_tol=1e-6):
                raise RevenueInputError('Entered consumption conflicts with baseline calibration.')
        if not math.isfinite(q):
            raise RevenueInputError('Calibrated consumption must be finite; reconcile the billed shares and volume.')
        observed = cfg.get('observed_billed_households')
        if observed is not None and not math.isclose(
                number(observed, 'Observed billed households'), n0 * 1e6, rel_tol=1e-6, abs_tol=1e-6):
            raise RevenueInputError('Observed billed households conflict with modeled billed shares; reconcile the inputs.')
        growth = cfg.get('nonhousehold_growth_rate')
        if growth is None:
            nh = (1 - h) * exogenous
        else:
            if isinstance(growth, bool):
                raise RevenueInputError('Non-household growth must be numeric, not boolean.')
            growth = float(growth)
            if not math.isfinite(growth) or growth <= -1:
                raise RevenueInputError('Non-household growth must be finite and greater than -100%.')
            nh = (1 - h) * q0 * (1 + growth) ** (years - by)
        ref_kind = cfg['funding_reference']
        if ref_kind == 'exogenous':
            hh_ref = h * exogenous
        elif ref_kind == 'fixed':
            hh_ref = np.full(len(years), hh0)
        else:
            series = cfg.get('reference_series')
            if not isinstance(series, dict):
                raise RevenueInputError('Supply household reference volume in m³/year for every forecast year.')
            hh_ref = h * exogenous
            for t in range(bi + 1, len(years)):
                hh_ref[t] = number(series.get(str(int(years[t])), series.get(int(years[t]))),
                                   f'Reference household volume in {years[t]}') / 1e6
        if not np.all(np.isfinite(nh)) or not np.all(np.isfinite(hh_ref)):
            raise RevenueInputError('Revenue reference projections must be finite.')
        status['calibration'] = {
            'baseline_year': by, 'baseline_billed_households': n0 * 1e6,
            'consumption_m3': q, 'baseline_volume_million_m3': q0,
            'original_volume_mld': base['volume_mld'], 'original_reference_year': base['reference_year'],
            'original_baseline_estimate_million_m3': float(original[bi]),
            'alignment': cfg.get('alignment') or 'baseline anchor',
            'funding_reference': ref_kind,
        }
        status['effective'] = True
        runtime = {'fsm': fsm, 'fb': fb, 'h': h, 'q': q, 'v': v, 'nh': nh,
                   'hh_ref': hh_ref, 'p0': base['tariff'], 'c0': base['collection_ratio']}
        return status, runtime
    except (RevenueInputError, TypeError, ValueError, OverflowError) as exc:
        errors.append(str(exc))
        return status, None


def annual_connection_cash(runtime, previous_sm, previous_basic, t, tariff, collection):
    """One-year lag; raw cost/rates times million volumes produce currency millions."""
    r = runtime
    billed = r['fsm'] * previous_sm + r['fb'] * previous_basic
    household = r['q'] * billed
    total = household + r['nh'][t]
    reference = r['hh_ref'][t] + r['nh'][t]
    delta = household - r['hh_ref'][t]
    gross = delta * r['p0'] * r['c0']
    cost = delta * r['v']
    ce = total * r['p0'] * (collection - r['c0'])
    tr = total * (tariff - r['p0']) * collection
    net = gross - cost
    additional = net + ce + tr
    collected = total * tariff * collection
    ref_collected = reference * r['p0'] * r['c0']
    if not all(math.isfinite(value) for value in (
            billed, household, total, reference, gross, cost, ce, tr, net, additional,
            collected, ref_collected)):
        raise RevenueInputError('Annual connection revenue/cost projections must be finite.')
    if not math.isclose(additional, collected - ref_collected - cost, rel_tol=1e-10, abs_tol=1e-9):
        raise RevenueInputError('Connection revenue identity did not reconcile.')
    return {'connection_billed_households': billed * 1e6,
            'household_billed_volume_million_m3': household,
            'nonhousehold_billed_volume_million_m3': r['nh'][t],
            'reference_billed_volume_million_m3': reference,
            'reference_collected_revenue': ref_collected,
            'connection_revenue_delta': gross, 'incremental_variable_operating_cost': cost,
            'connection_net_cash': net, 'additional_net_cash': additional,
            'applicable_tariff': tariff, 'applicable_collection_ratio': collection,
            'billed_volume_million_m3': total, 'baseline_collected_revenue': total * r['p0'] * r['c0'],
            'collected_revenue': collected, 'collection_cash': ce, 'tariff_cash': tr}
