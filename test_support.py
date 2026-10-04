"""Explicitly resolved example for model regressions unrelated to migration.

Production defaults intentionally remain unresolved. Tests choose the historical
collection-derived sanitation base rather than silently changing production data.
"""
from demo_adapter import frontend_defaults as unresolved_defaults, coerce_to_engine
from model.engine import build_context
from model.utility_revenue import resolve_bases


def frontend_defaults():
    data = unresolved_defaults()
    engine = coerce_to_engine(data)
    choices = resolve_bases(engine, build_context(engine))
    data['revenue_bases'] = {
        sector: choice['base'] or choice['alternatives'][0]['base']
        for sector, choice in choices.items()
    }
    data['sanitation_interventions']['ce_target_ratio'] = data['water_interventions']['ce_target_ratio']
    return data