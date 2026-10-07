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
    'connection_billed_basic_households', 'connection_billed_sm_households',
    'connection_billed_basic_entry_households', 'connection_billed_basic_transfer_households',
    'connection_billed_sm_transfer_households', 'connection_reference_billed_households',
    'nrw_tagged_billed_households', 'connection_annual_cost_per_household',
    'connection_equivalent_marginal_cost',
)

def migrate_connection(config):
    """Legacy shares/costs are inherited without guessing missing or zero values."""
    cfg = copy.deepcopy(config or {})
    if cfg.get('version') in (1, 2):
        cfg['legacy_version'] = cfg['version']
        cfg['version'] = 3
        cfg.setdefault('new_billed_share_sm', cfg.get('billed_share_sm'))
        cfg.setdefault('new_billed_share_basic', cfg.get('billed_share_basic'))
        cfg.setdefault('cost_basis', 'per_m3')
    return cfg


def operating_cost(cfg, q, n0, baseline_year):
    """One frozen authoritative cost basis; expenditure is an explicitly accepted proxy."""
    basis = cfg.get('cost_basis')
    if basis == 'per_m3':
        v = number(cfg.get('marginal_cost'), 'marginal_cost')
        k = q * v
    elif basis == 'annual_household':
        k = number(cfg.get('annual_cost_per_household'), 'annual_cost_per_household')
        if q <= 0 and k > 0:
            raise RevenueInputError('Positive annual household cost requires positive calibrated household consumption; complete compatible baseline calibration.')
        v = k / q if q > 0 else 0.0
    elif basis == 'expenditure_proxy':
        proxy, current = cfg.get('cost_proxy'), cfg.get('operating_expenditure_source')
        if not isinstance(proxy, dict) or not isinstance(current, dict):
            raise RevenueInputError('Average-cost proxy needs validated existing operating expenditure and its scope, year and currency source.')
        for field in ('expenditure', 'baseline_year', 'currency', 'currency_basis', 'sector', 'area'):
            if proxy.get(field) != current.get(field):
                raise RevenueInputError(f'Operating expenditure source changed or is incompatible ({field}); deliberately refresh the estimate.')
        if current.get('baseline_year') != baseline_year or current.get('currency_basis') != 'real_raw':
            raise RevenueInputError('Operating expenditure must be baseline-year annual real expenditure in raw local currency.')
        expenditure = number(proxy.get('expenditure'), 'Annual operating expenditure')
        allocation = number(proxy.get('household_allocation'), 'Explicit household operating-cost allocation', 1)
        if expenditure <= 0 or n0 <= 0:
            raise RevenueInputError('Average-cost proxy requires positive observed expenditure and baseline billed households; zero placeholders are not zero costs.')
        if proxy.get('allocation_confirmed') is not True or not str(proxy.get('note') or '').strip():
            raise RevenueInputError('Confirm and document the household cost allocation; a volume share is only an assumed proxy.')
        k = expenditure * allocation / (n0 * 1e6)
        if q <= 0 and k > 0:
            raise RevenueInputError('Positive average household cost requires positive compatible household consumption.')
        v = k / q if q > 0 else 0.0
    else:
        raise RevenueInputError('Select per_m3, annual_household or expenditure_proxy operating-cost basis.')
    zero_selected = v == 0 if basis == 'per_m3' else k == 0
    if zero_selected and cfg.get('zero_cost_confirmed') is not True:
        raise RevenueInputError('Zero operating cost requires explicit confirmation.')
    if not math.isfinite(k) or not math.isfinite(v):
        raise RevenueInputError('Operating-cost conversion must be finite.')
    return k, v


def prepare_connection(config, base, ctx, history, days=365, liters=1000):
    """Resolve frozen references and calibration without depending on scenario toggles."""
    if config is not None and not isinstance(config, dict):
        return {'requested': True, 'effective': False,
                'errors': ['Connection revenue configuration must be an object.'],
                'configuration': config, 'calibration': None, 'warnings': []}, None
    cfg = migrate_connection(config)
    status = {'requested': bool(cfg.get('enabled')), 'effective': False,
              'errors': [], 'configuration': cfg, 'calibration': None,
              'warnings': ['Billed-household equivalents are aggregate propensities, not identified customers. Unbilled households may incur costs; this is not a complete utility operating account.',
                            'Baseline funding must already represent the selected reference net contribution.']}
    if not status['requested']:
        return status, None
    errors = status['errors']
    values = {}
    required = ('billed_share_sm', 'billed_share_basic', 'household_volume_share',
                'new_billed_share_sm', 'new_billed_share_basic')
    for key in required:
        try:
            values[key] = number(cfg.get(key), key, 1)
        except RevenueInputError as exc:
            errors.append(str(exc))
    if cfg.get('version') != 3:
        errors.append('Connection revenue configuration must have version 1, 2 or 3.')
    if base is None:
        errors.append('A valid shared revenue base is required.')
    if cfg.get('reference_confirmed') is not True:
        errors.append('Confirm the household revenue path already represented in funding.')
    if cfg.get('funding_includes_reforms') is not False:
        errors.append('Confirm baseline funding does not already include future tariff/collection reforms.')
    if cfg.get('funding_reference') not in ('exogenous', 'fixed', 'series'):
        errors.append('Select exogenous, fixed or supplied-series funding reference.')
    provenance_fields = list(required)
    provenance_fields.append({'per_m3': 'marginal_cost', 'annual_household': 'annual_cost_per_household',
                              'expenditure_proxy': 'cost_proxy'}.get(cfg.get('cost_basis'), 'cost_basis'))
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
        if isinstance(source, dict) and not (source.get('source_type') or
                str(source.get('note') or '').strip() or source.get('reference_year') is not None):
            source = {}
        if not source and cfg.get('legacy_version') and key.startswith('new_billed_share_'):
            source = provenance.get(key.replace('new_', '')) or {}
        if not source and str(cfg.get('shared_assumption_note') or '').strip():
            source = {'source_type': 'assumed', 'note': cfg['shared_assumption_note']}
        if not isinstance(source, dict):
            source = {}
        if source.get('source_type') not in ('observed', 'assumed') or not str(source.get('note') or '').strip():
            errors.append(f'{key}: select observed/assumed and supply a source or assumption note.')
        year = source.get('reference_year')
        if year is not None and (isinstance(year, bool) or not isinstance(year, (float, int)) or
                                 not math.isfinite(year) or year < 1 or int(year) != year):
            errors.append(f'{key}: source reference year must be a positive integer.')
    if base is None or any(key not in values for key in (
            'billed_share_sm', 'billed_share_basic', 'household_volume_share')):
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
        fsm, fb, h = [values[k] for k in ('billed_share_sm', 'billed_share_basic', 'household_volume_share')]
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
        # A provisional baseline is useful even while future shares/costs are incomplete.
        # In particular, choosing the expenditure proxy must not erase the denominator
        # needed to deliberately configure that proxy.
        status['calibration'] = {
            'baseline_year': by, 'baseline_billed_households': n0 * 1e6,
            'consumption_m3': q, 'baseline_volume_million_m3': q0,
            'original_volume_mld': base['volume_mld'], 'original_reference_year': base['reference_year'],
            'original_baseline_estimate_million_m3': float(original[bi]),
            'alignment': cfg.get('alignment') or 'baseline anchor',
            'funding_reference': cfg.get('funding_reference'),
            'baseline_tariff': base['tariff'], 'baseline_collection_ratio': base['collection_ratio'],
            'selected_cost_basis': cfg.get('cost_basis'),
        }
        if errors:
            return status, None
        k, v = operating_cost(cfg, q, n0, by)
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
            'annual_cost_per_household': k, 'equivalent_marginal_cost': v,
            'selected_cost_basis': cfg['cost_basis'],
            'baseline_tariff': base['tariff'], 'baseline_collection_ratio': base['collection_ratio'],
            'cost_source': copy.deepcopy(cfg.get('cost_proxy')) if cfg['cost_basis'] == 'expenditure_proxy'
                           else ('Converted existing unit cost' if cfg['cost_basis'] == 'per_m3' else 'Manual annual cost'),
        }
        status['effective'] = True
        runtime = {'fsm': fsm, 'fb': fb, 'h': h, 'q': q, 'v': v, 'k': k, 'nh': nh,
                   'new_sm': values['new_billed_share_sm'], 'new_basic': values['new_billed_share_basic'],
                   'hh_ref': hh_ref, 'p0': base['tariff'], 'c0': base['collection_ratio']}
        return status, runtime
    except (RevenueInputError, TypeError, ValueError, OverflowError) as exc:
        errors.append(str(exc))
        return status, None


def annual_connection_cash(runtime, previous_sm, previous_basic, t, tariff, collection, billing=None):
    """One-year lag; raw cost/rates times million volumes produce currency millions."""
    r = runtime
    billed_sm = r['fsm'] * previous_sm if billing is None else billing.billed_sm
    billed_basic = r['fb'] * previous_basic if billing is None else billing.billed_basic
    billed = billed_sm + billed_basic
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
            'connection_billed_basic_households': billed_basic * 1e6,
            'connection_billed_sm_households': billed_sm * 1e6,
            'connection_billed_basic_entry_households': 0.0,
            'connection_billed_basic_transfer_households': 0.0,
            'connection_billed_sm_transfer_households': 0.0,
            'connection_reference_billed_households': r['hh_ref'][t] / r['q'] * 1e6 if r['q'] > 0 else 0.0,
            'nrw_tagged_billed_households': billing.nrw_billed * 1e6 if billing is not None else 0.0,
            'connection_annual_cost_per_household': r['k'],
            'connection_equivalent_marginal_cost': r['v'],
            'household_billed_volume_million_m3': household,
            'nonhousehold_billed_volume_million_m3': r['nh'][t],
            'reference_billed_volume_million_m3': reference,
            'reference_collected_revenue': ref_collected,
            'connection_revenue_delta': gross, 'incremental_variable_operating_cost': cost,
            'connection_net_cash': net, 'additional_net_cash': additional,
            'applicable_tariff': tariff, 'applicable_collection_ratio': collection,
            'billed_volume_million_m3': total, 'baseline_collected_revenue': total * r['p0'] * r['c0'],
            'collected_revenue': collected, 'collection_cash': ce, 'tariff_cash': tr}
