"""Explicitly resolved example for model regressions unrelated to migration.

Production defaults intentionally remain unresolved. Tests choose the historical
collection-derived sanitation base rather than silently changing production data.
"""
from demo_adapter import frontend_defaults as unresolved_defaults, coerce_to_engine
from model.engine import build_context
from model.utility_revenue import resolve_bases


def controlled_budgets(data):
    """Supply explicit synthetic finance for non-financial country-fixture tests."""
    n = data['period']['baseline_year'] - data['period']['model_start_year'] + 1
    for prefix in ('ws', 'san'):
        data.setdefault('bau', {})[prefix + '_expend_ts'] = [100.] * n
        data['bau'][prefix + '_alloc_ts'] = [500.] * n
    for sector in ('water', 'sanitation'):
        data.setdefault('connection_revenue', {}).setdefault(sector, {}).update(
            new_billed_share_basic=.5, new_billed_share_sm=1.)
    return data


def frontend_defaults():
    data = unresolved_defaults()
    controlled_budgets(data)
    # Controlled financial observations for tests unrelated to budget calibration.
    # Production defaults intentionally remain uncalibrated.
    n = data['period']['baseline_year'] - data['period']['model_start_year'] + 1
    for prefix in ('ws', 'san'):
        data['bau'][prefix + '_expend_ts'] = [100.] * n
        data['bau'][prefix + '_alloc_ts'] = [500.] * n
    engine = coerce_to_engine(data)
    choices = resolve_bases(engine, build_context(engine))
    data['revenue_bases'] = {
        sector: choice['base'] or choice['alternatives'][0]['base']
        for sector, choice in choices.items()
    }
    data['sanitation_interventions']['ce_target_ratio'] = data['water_interventions']['ce_target_ratio']
    return data