"""Aggregate coverage expansion; volumes/cash in millions, shares as fractions."""
import copy
import math
import numpy as np
from .utility_revenue import number, volume_path, RevenueInputError

MIGRATION_NOTICE = ('Connection revenue is addition-only and fixed loan repayments now reduce future funding. '
                    'Recalculate saved scenarios; historical inputs are preserved.')
ACTIVE = {'version', 'enabled', 'method', 'new_billed_share_basic', 'new_billed_share_sm',
          'shared_assumption_note', 'legacy_parameters', 'migration_notice'}
DIAGNOSTIC_FIELDS = (
    'baseline_billed_volume_million_m3', 'connection_raw_volume_million_m3',
    'connection_overlap_volume_million_m3', 'connection_volume_million_m3',
    'connection_scale', 'connection_aggregate_volume_proxy', 'connection_revenue_cash',
    'connection_signed_scale', 'connection_signed_candidate_volume_million_m3',
    'connection_addition_only_adjustment_million_m3', 'connection_unapplied_overlap_volume_million_m3',
    'connections_cash', 'nrw_avoided_sales_adjustment',
    'reference_billed_volume_million_m3', 'reference_collected_revenue',
    'connection_revenue_delta', 'connection_net_cash', 'additional_net_cash',
    'applicable_tariff', 'applicable_collection_ratio',
    # Inactive, zero-only compatibility outputs. Never infer household observations.
    'connection_billed_households', 'household_billed_volume_million_m3',
    'nonhousehold_billed_volume_million_m3', 'incremental_variable_operating_cost',
    'connection_billed_basic_households', 'connection_billed_sm_households',
    'connection_billed_basic_entry_households', 'connection_billed_basic_transfer_households',
    'connection_billed_sm_transfer_households', 'connection_reference_billed_households',
    'nrw_tagged_billed_households', 'connection_annual_cost_per_household',
    'connection_equivalent_marginal_cost',
)


def migrate_connection(config):
    old = copy.deepcopy(config or {})
    version = old.get('version', 5)
    cfg = {k: v for k, v in old.items() if k in ACTIVE}
    legacy = copy.deepcopy(old.get('legacy_parameters') or {})
    legacy.update({k: v for k, v in old.items() if k not in ACTIVE})
    if version in (1, 2):
        for service in ('basic', 'sm'):
            key = 'new_billed_share_' + service
            if key not in old:
                cfg[key] = old.get('billed_share_' + service)
    if legacy:
        cfg['legacy_parameters'] = legacy
    if version in (1, 2, 3, 4):
        if cfg.get('migration_notice'):
            legacy.setdefault('prior_migration_notice', cfg['migration_notice'])
            cfg['legacy_parameters'] = legacy
        cfg['migration_notice'] = MIGRATION_NOTICE
    cfg.update(version=5 if version in (1, 2, 3, 4, 5) else version,
               method='aggregate_coverage_expansion', enabled=bool(old.get('enabled', False)))
    return cfg


def prepare_connection(config, base, ctx, history, days=365, liters=1000):
    if config is not None and not isinstance(config, dict):
        return {'requested': True, 'effective': False, 'state': 'incomplete',
                'errors': ['Connection revenue configuration must be an object.'],
                'configuration': config, 'calibration': None, 'warnings': []}, None
    cfg = migrate_connection(config)
    status = dict(requested=cfg['enabled'], effective=False, state='off',
                  errors=[], configuration=cfg, calibration=None, warnings=[])
    if cfg.get('migration_notice'):
        status['migration_notice'] = cfg['migration_notice']
    try:
        bi = ctx['bi']
        hh = np.asarray(ctx['total_hh'], dtype=float)
        h0 = number(hh[bi], 'Baseline households')
        if h0 <= 0:
            raise RevenueInputError('Baseline Basic/Safely Managed coverage is needed to estimate additional billed volume.')
        sm = number(history[0, bi], 'Baseline SM households') / h0
        basic = number(history[1, bi], 'Baseline Basic households') / h0
        s0 = sm + basic
        if s0 <= 0 or s0 > 1 + 1e-8:
            raise RevenueInputError('Baseline Basic/Safely Managed coverage is needed to estimate additional billed volume.')
        if base is None:
            raise RevenueInputError('A valid shared revenue base is required.')
        baseline = volume_path(base, ctx, days, liters)
        status['calibration'] = dict(
            baseline_year=int(ctx['years'][bi]), baseline_coverage=s0,
            baseline_basic_share=basic, baseline_sm_share=sm, baseline_households=h0 * 1e6,
            baseline_volume_million_m3=float(baseline[bi]),
            aggregate_volume_proxy_m3=float(baseline[bi] / (h0 * s0)),
            baseline_tariff=base['tariff'], baseline_collection_ratio=base['collection_ratio'],
            original_volume_mld=base['volume_mld'], original_reference_year=base['reference_year'],
            growth_rate=base.get('growth_rate'))
        if not cfg['enabled']:
            return status, None
        if cfg['version'] != 5:
            raise RevenueInputError('Unsupported connection configuration version.')
        fb = number(cfg.get('new_billed_share_basic'), 'new_billed_share_basic', 1)
        fs = number(cfg.get('new_billed_share_sm'), 'new_billed_share_sm', 1)
        status.update(effective=True, state='active')
        return status, dict(baseline=baseline.copy(), total_hh=hh.copy(), bi=bi,
                            s0=s0, sm0=sm, basic0=basic, new_sm=fs, new_basic=fb,
                            p0=base['tariff'], c0=base['collection_ratio'])
    except (RevenueInputError, ValueError, TypeError, IndexError, KeyError) as exc:
        if cfg['enabled']:
            status['state'] = 'incomplete'
            status['errors'].append(str(exc))
        return status, None


def annual_connection_cash(runtime, previous_sm, previous_basic, t, tariff, collection, billing=None):
    """Previous-year *coverage*, not counts, removes population-only expansion."""
    r = runtime
    b = float(r['baseline'][t])
    scale = proxy = 0.0
    if t > r['bi']:
        hh = number(r['total_hh'][t - 1], 'Prior-year households')
        sm = number(previous_sm, 'Delivered SM households')
        basic = number(previous_basic, 'Delivered Basic households')
        if hh <= 0 or sm + basic > hh + 1e-8:
            raise RevenueInputError('Delivered service stocks require a valid matching household denominator.')
        scale = (r['new_basic'] * (basic / hh - r['basic0']) +
                 r['new_sm'] * (sm / hh - r['sm0'])) / r['s0']
        proxy = b / (hh * r['s0'])
    signed = b * scale
    if not math.isfinite(signed):
        raise RevenueInputError('Aggregate coverage expansion must be finite.')
    added = max(0.0, signed)
    from .revenue_reconciliation import reconcile_revenue
    row = reconcile_revenue(b + added, b, 0, 0, r['p0'], r['c0'], tariff, collection)
    row.update(connection_scale=max(0.0, scale), connection_signed_scale=scale,
               connection_signed_candidate_volume_million_m3=signed,
               connection_addition_only_adjustment_million_m3=added-signed,
               connection_aggregate_volume_proxy=proxy)
    return row


def tagged_nrw_volume(runtime, retained_origin_households, t):
    """Prior delivered NRW origins only; million HH × m³/HH = million m³."""
    if t <= runtime['bi']:
        return 0.0
    hh = runtime['total_hh'][t - 1]
    if hh <= 0:
        raise RevenueInputError('NRW overlap needs prior-year household coverage.')
    return (retained_origin_households * max(0, runtime['new_sm'] - runtime['new_basic']) *
            runtime['baseline'][t] / (hh * runtime['s0']))
