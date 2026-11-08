"""Isolated post-intervention target/funding analysis, never a saved-input mutation."""
import copy
import hashlib
import json
import math
import time
import numpy as np
from .engine import calculate, build_context
from .water_supply import calculate_water_supply
from .sanitation import calculate_sanitation
from .fixed_loan import fixed_schedule
from .inputs import InterventionToggles
from .post_intervention_solver import composition, coverage, residual_vector, solve_share, SOURCE

METHOD = 'constant-gdp-share-v1'
SECTOR_OUTPUT = {'water': 'water_supply', 'sanitation': 'sanitation'}


def target_path(original, total, years, baseline, target_year, override):
    sm, ab = override.get('safelyManagedShare'), override.get('atLeastBasicShare')
    if any(type(v) not in (float, int) or not math.isfinite(v) for v in (sm, ab)) or not 0 <= sm <= ab <= 1:
        raise ValueError('Enter finite targets satisfying 0 ≤ Safely managed ≤ At least basic ≤ 100%.')
    baseline_index = years.index(baseline)
    base = np.asarray(original, dtype=float)[:, baseline_index]
    if total[baseline_index] <= 0:
        raise ValueError('Positive baseline households are required for revised targets.')
    base = base/total[baseline_index]
    lower = base[2:]
    diagnostic_remainder = lower.sum() == 0
    lower = lower/lower.sum() if lower.sum() else np.array([1., 0., 0.])
    result = np.array(original, dtype=float)
    for i, year in enumerate(years):
        if year <= baseline:
            continue
        w = min(1., (year-baseline)/(target_year-baseline))
        s, a = base[0]+w*(sm-base[0]), sum(base[:2])+w*(ab-sum(base[:2]))
        result[:, i] = np.r_[s, a-s, lower*(1-a)] * total[i]
    return result, diagnostic_remainder


def fixed_reference(summary, years):
    plan = fixed_schedule(summary.get('accepted_principal', 0.), summary.get('fixed_annual_debt_service', 0.),
                          summary.get('annual_real_interest_rate'), summary.get('loan_term_years'),
                          summary.get('reference_year'), years)
    plan['servicing_sources'] = tuple(summary.get('revenue_sources', ()))
    return plan


def prepare_area(raw, sectors, toggle_overrides, include_debt):
    from demo_adapter import coerce_to_engine
    from intervention_validation import validate_interventions
    from .utility_revenue import resolve_bases
    value = copy.deepcopy(raw)
    value['calculation_scope'] = sectors
    allowed = set(InterventionToggles.model_fields)
    for key, enabled in toggle_overrides.items():
        if key not in allowed or type(enabled) is not bool or 'custom' in key:
            raise ValueError('Invalid or unavailable local intervention toggle.')
        value.setdefault('toggles', {})[key] = enabled
        if key.endswith('_connections_enabled'):
            value.setdefault('connection_revenue', {}).setdefault('water' if key.startswith('ws_') else 'sanitation', {})['enabled'] = enabled
    if not include_debt:
        value['utility_debt'] = {s: {**value.get('utility_debt', {}).get(s, {}), 'enabled': False} for s in sectors}
    issues = validate_interventions(value)
    errors = {s: '; '.join(x['message'] for x in issues if x['sector'] == s and x['severity'] == 'error') for s in sectors}
    valid = [s for s in sectors if not errors[s]]
    if 'water' in sectors and 'water' not in valid and value.get('toggles', {}).get('san_nrw_link_enabled'):
        errors['sanitation'] = 'Sanitation requires valid water inputs for the active NRW link.'
        valid = [s for s in valid if s != 'sanitation']
    if not valid:
        return None, None, None, errors, value
    engine = coerce_to_engine({**value, 'calculation_scope': valid})
    reference = calculate(engine, allow_partial=True)
    ctx = build_context(engine)
    configs = copy.deepcopy(engine.connection_revenue)
    for prefix, sector in [('ws', 'water'), ('san', 'sanitation')]:
        enabled = getattr(engine.toggles, prefix+'_connections_enabled', None)
        if enabled is not None:
            configs[sector] = {**configs.get(sector, {}), 'enabled': enabled}
    bases = resolve_bases(engine, ctx)
    engine = engine.model_copy(update={'connection_revenue': configs, 'custom_interventions': [],
                                      'revenue_bases': {s: v['base'] for s, v in bases.items()}})
    for sector in valid:
        key = SECTOR_OUTPUT[sector]
        if not reference.get(key):
            errors[sector] = reference.get('sector_errors', {}).get(key, 'Selected scenario is unavailable.')
    return engine, ctx, reference, errors, value


def analyse(payload):
    from simulation_scope import normalize_scope, active_areas
    started = time.monotonic()
    deadline = started + 20.
    # The signature includes dormant saved settings, all input parameters and the shared loan choice.
    encoded = json.dumps(payload, sort_keys=True, separators=(',', ':'), allow_nan=False)
    if len(encoded) > 2_000_000:
        raise ValueError('Post-intervention inputs exceed the request limit.')
    signature = hashlib.sha256((METHOD+encoded).encode()).hexdigest()
    bundle = copy.deepcopy(payload.get('bundle') or {})
    scope = normalize_scope(bundle.get('scope'))
    areas = active_areas(bundle)
    settings = payload.get('settings', bundle.get('postIntervention'))
    settings = {} if settings is None else settings
    if not isinstance(settings, dict):
        raise ValueError('Post-intervention settings must be an object.')
    if settings and (settings.get('version') != 1 or settings.get('fundingMethod') != 'constant_gdp_share'):
        raise ValueError('Unsupported post-intervention settings version or funding method.')
    for group in ('targetOverrides', 'toggleOverrides'):
        values = settings.get(group, {})
        if not isinstance(values, dict) or any(a not in ('urban', 'rural', 'national') or not isinstance(v, dict)
                                               for a, v in values.items()):
            raise ValueError(f'Invalid {group} structure.')
    for targets in settings.get('targetOverrides', {}).values():
        if any(s not in SECTOR_OUTPUT or not isinstance(v, dict) for s, v in targets.items()):
            raise ValueError('Invalid target override structure.')
    include_debt = payload.get('includeDebt', True)
    if type(include_debt) is not bool:
        raise ValueError('Loan inclusion must be boolean.')
    first = next(iter(areas.values()))
    period = dict(first['period'])
    period['real_price_year'] = period.get('real_price_year') or period['baseline_year']
    baseline, end = period['baseline_year'], period['forecast_end_year']
    if any(type(v) is not int for v in (baseline, end, period['model_start_year'])) or not period['model_start_year'] <= baseline < end:
        raise ValueError('A valid historical and forecast period is required.')
    year = settings.get('targetYear', end)
    if type(year) is not int or not baseline < year <= end:
        raise ValueError('Target year must be an integer after baseline within the existing forecast horizon.')
    years = list(range(period['model_start_year'], end+1))
    if len(years) > 120:
        raise ValueError('Post-intervention analysis is limited to 120 modeled years.')
    index = years.index(year)
    window = np.array([baseline < y <= year for y in years], dtype=bool)
    output = dict(method_version=METHOD, input_signature=signature, status='invalid_inputs', selected_year=year,
                  funding_window=dict(start=baseline+1, end=year), years=years, national_gdp=None,
                  currency=first.get('country_config', {}).get('currency', 'LCU'), real_price_year=period['real_price_year'],
                  units=dict(households='million households', money='million real local currency'),
                  effective_scope=scope, intervention_mask={}, loan_inclusion=include_debt,
                  fixed_loan_reference={}, per_area_sector={}, warnings=[])
    prepared = {}
    gdp_paths = []
    for area, raw in areas.items():
        output['per_area_sector'][area] = {}
        try:
            if any(raw['period'].get(k) != period.get(k) for k in ('model_start_year', 'baseline_year', 'forecast_end_year')):
                raise ValueError('Active areas must share the analysis period and real price year.')
            if (raw['period'].get('real_price_year') or raw['period']['baseline_year']) != period['real_price_year']:
                raise ValueError('Active areas must share the real price year.')
            if raw.get('country_config', {}).get('currency', 'LCU') != output['currency']:
                raise ValueError('Active areas must share the real local-currency basis.')
            overrides = settings.get('toggleOverrides', {}).get(area, {})
            engine, ctx, ref, errors, effective = prepare_area(raw, scope['sectors'], overrides, include_debt)
            output['intervention_mask'][area] = effective.get('toggles', {})
            if ctx is not None:
                gdp_paths.append(np.asarray(ctx['gdp_real_local'], dtype=float))
                prepared[area] = (engine, ctx, ref)
            for sector, message in errors.items():
                if message:
                    output['per_area_sector'][area][sector] = dict(solver_status='invalid_inputs', error=message, warnings=[])
        except (ValueError, TypeError, KeyError) as exc:
            for sector in scope['sectors']:
                output['per_area_sector'][area][sector] = dict(solver_status='invalid_inputs', error=str(exc), warnings=[])
    gdp_valid = bool(gdp_paths) and all(np.isfinite(g[window]).all() and (g[window] > 0).all() for g in gdp_paths)
    if gdp_valid and any(not np.allclose(g, gdp_paths[0], rtol=1e-8, atol=1e-6) for g in gdp_paths[1:]):
        gdp_valid = False
        output['warnings'].append('National GDP copies conflict across areas. Combined GDP funding is unavailable.')
    elif not gdp_valid:
        output['warnings'].append('Positive finite forecast national GDP is required for a funding equivalent.')
    if gdp_valid:
        output['national_gdp'] = gdp_paths[0].tolist()
    for area, (engine, ctx, reference) in prepared.items():
        buckets = output['per_area_sector'][area]
        total = ctx['total_hh']
        options, plans, adjusted, fractions = {}, {}, {}, {}
        output['fixed_loan_reference'][area] = {}
        for sector in scope['sectors']:
            if sector in buckets:
                continue
            sec = reference[SECTOR_OUTPUT[sector]]
            plans[sector] = fixed_reference(sec['scenario_utility_debt'], years)
            output['fixed_loan_reference'][area][sector] = sec['scenario_utility_debt']
            opts = {'funding': np.zeros(len(years))}
            warnings = []
            override = settings.get('targetOverrides', {}).get(area, {}).get(sector)
            try:
                if override is not None:
                    opts['targets'], remainder = target_path(sec['scenario_target_hh'], total, years, baseline, year, override)
                    if remainder:
                        warnings.append('Any diagnostic below-basic target remainder is assigned to Limited; actual households are not downgraded.')
                options[sector] = opts
            except (ValueError, TypeError, KeyError) as exc:
                buckets[sector] = dict(solver_status='invalid_inputs', error=str(exc), warnings=[])
                continue
            buckets[sector] = dict(reference_coverage=coverage(sec['scenario_hh'], total),
                                   original_target_coverage=coverage(sec['scenario_target_hh'], total), warnings=warnings)

        def run_all(shares):
            local = copy.deepcopy(options)
            for s in local:
                local[s]['funding'] = np.where(window, ctx['gdp_real_local'] * shares.get(s, 0.), 0.)
            context = {**ctx, 'post_intervention': local}
            out = {}
            if 'water' in local:
                out['water'] = calculate_water_supply(engine, context, utility_debt_execution=plans['water'])
            if 'sanitation' in local:
                if engine.toggles.san_nrw_link_enabled and 'water' not in out:
                    raise ValueError('Sanitation requires valid water results for its NRW link.')
                out['sanitation'] = calculate_sanitation(engine, context,
                    nrw_recovered_vol=out.get('water', {}).get('nrw_recovered_phys_vol', []),
                    utility_debt_execution=plans['sanitation'])
            return out

        try:
            adjusted = run_all({})
        except (ValueError, TypeError, KeyError) as exc:
            for sector in options:
                buckets[sector] = dict(solver_status='invalid_inputs', error=str(exc), warnings=[])
            continue
        for sector in scope['sectors']:
            if sector not in adjusted:
                continue
            zero = adjusted[sector]
            bucket = buckets[sector]
            components = composition(zero, index)
            vec = residual_vector(zero, index)
            bucket.update(adjusted_existing_funding_coverage=coverage(zero['bau_hh'], total),
                          target_coverage=coverage(zero['target_hh'], total),
                          sm_gap=float(vec[0]), at_least_basic_gap=float(vec[1]),
                          target_year_residual_components=components, target_year_residual_total=components['total'])
            # Sanitation trials use the final verified water schedule, not an inconsistent independent reference.
            runner = lambda q, s=sector: run_all({**fractions, s: q})[s]
            if gdp_valid:
                # Zero for this bucket includes the already-selected water schedule.
                local_zero = runner(0.) if fractions else zero
                q, candidate, status, diag = solve_share(runner, local_zero, index,
                    float(np.asarray(ctx['gdp_real_local'])[window].sum()), deadline)
            else:
                q, candidate, status, diag = None, zero, 'invalid_inputs', {'reason': 'GDP is unavailable or inconsistent.'}
            if q is None and year == baseline+1:
                opening = sum(np.asarray(zero['bau_hh'])[:2, ctx['bi']])
                target_sm = zero['target_hh'][0][index]
                if target_sm > opening + 1e-6 and not np.any(np.diff(ctx['total_hh']) < 0):
                    status = 'delivery_constraint'
                    diag['reason'] = 'The one-year target requires more SM households than the opening basic/SM pool; one household cannot take two transitions in one year.'
            if q is not None:
                fractions[sector] = q
            available = np.where(window, ctx['gdp_real_local'] * (q or 0.), 0.)
            unused = np.array(candidate['source_funding']['unused'].get(SOURCE, [0.]*len(years))) if q is not None else np.zeros(len(years))
            used = available-unused
            if q is not None and (np.any(used < -1e-6) or not np.allclose(used+unused, available)):
                q, status = None, 'nonconvergent'
                fractions.pop(sector, None)
            bucket.update(funding_fraction=q, candidate_fraction=diag.get('candidate_fraction'), solver_status=status,
                          funding_available_by_year=available.tolist(), funding_used_by_year=np.maximum(used, 0).tolist(),
                          unused_by_year=unused.tolist(), verified_funded_coverage=coverage(candidate['bau_hh'], total) if q is not None else None,
                          remaining_financial_components=composition(candidate, index), convergence_diagnostics=diag)
        if fractions:
            final = run_all(fractions)
            for sector, q in fractions.items():
                bucket = buckets[sector]
                tolerance = bucket['convergence_diagnostics']['monetary_tolerance']
                v = residual_vector(final[sector], index)
                if np.any(v > [1e-6, 1e-6, tolerance, tolerance, tolerance, tolerance]):
                    bucket.update(solver_status='nonconvergent', funding_fraction=None, verified_funded_coverage=None)
                    bucket['warnings'].append('Final dependent-sector replay failed full-financing verification.')
                else:
                    bucket['verified_funded_coverage'] = coverage(final[sector]['bau_hh'], total)
                    bucket['remaining_financial_components'] = composition(final[sector], index)
    all_buckets = [v for a in output['per_area_sector'].values() for v in a.values()]
    complete = len(all_buckets) == len(areas)*len(scope['sectors']) and all(b.get('funding_fraction') is not None for b in all_buckets) and gdp_valid
    residual_complete = all('target_year_residual_total' in b for b in all_buckets)
    output['combined'] = dict(complete=complete,
        funding_fraction=sum(b['funding_fraction'] for b in all_buckets) if complete else None,
        target_year_residual_total=sum(b['target_year_residual_total'] for b in all_buckets) if residual_complete else None,
        **{k: np.sum([b[k] for b in all_buckets], axis=0).tolist() if complete else None
           for k in ('funding_available_by_year', 'funding_used_by_year', 'unused_by_year')})
    output['status'] = 'already_funded' if complete and output['combined']['funding_fraction'] == 0 else 'solved' if complete else 'incomplete'
    output['warnings'].append('Funding is an execution-adjusted financing equivalent, not an allocated public budget or a fiscal recommendation.')
    return output
