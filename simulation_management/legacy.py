"""Lossless legacy source bridge. Display mappings never overwrite raw sources."""
from copy import deepcopy


def apply_changed(original, before, after):
    """Apply only explicitly changed editor leaves, retaining unknown raw fields."""
    if isinstance(before, dict) and isinstance(after, dict):
        out = deepcopy(original) if isinstance(original, dict) else {}
        for key, value in after.items():
            if key not in before or value != before[key]:
                out[key] = apply_changed(out.get(key), before.get(key), value)
        for key in before.keys() - after.keys():
            out.pop(key, None)
        return out
    return deepcopy(after)


def legacy_engine_payload(inputs):
    if not isinstance(inputs.get('_legacy_engine'), dict):
        return inputs
    editor = {k: v for k, v in inputs.items() if k not in ('_legacy_engine', '_legacy_editor_snapshot')}
    return apply_changed(inputs['_legacy_engine'], inputs['_legacy_editor_snapshot'], editor)


def migrate_legacy(raw, area='urban'):
    if raw.get('__wss_bundle'):
        out = deepcopy(raw)
        out['scope'] = {**out.get('scope', {}), 'sectors': ['water', 'sanitation']}
        return out
    from demo_adapter import frontend_defaults
    # Keep every original leaf; defaults supply the editor's structural keys only.
    def merge(a, b):
        out = deepcopy(a)
        for k, v in b.items():
            out[k] = merge(out.get(k, {}), v) if isinstance(v, dict) else deepcopy(v)
        return out
    editor = merge(frontend_defaults(), raw)
    legacy = 'serv1_ts' not in raw.get('water_service', {})
    if legacy:
        first = raw['period']['model_start_year']
        baseline = raw['period']['baseline_year']
        end = raw['period']['forecast_end_year']
        n, bi = end - first + 1, baseline - first
        for sector, stem in [('water', 'serv'), ('sanitation', 'sserv')]:
            source = raw.get(sector + '_service', {})
            for rung in range(1, 6):
                values = [None] * n
                values[0] = source.get(f'pct_{stem}{rung}_start')
                values[bi] = source.get(f'pct_{stem}{rung}_baseline')
                for number in (1, 2):
                    year = raw['period'].get(f'target{number}_year')
                    if year is not None and first <= year <= end:
                        values[year-first] = raw.get(sector+'_targets', {}).get(f'target{number}_{stem}{rung}')
                editor[sector+'_service'][f'{stem}{rung}_ts'] = values
        pop = raw.get('population', {})
        for field, start, last, divisor in [
            ('pop_ts', 'total_pop_start', 'total_pop_baseline', 1_000_000),
            ('hh_ts', 'total_hh_start', 'total_hh_baseline', 1),
        ]:
            values = [None] * (bi + 1)
            values[0] = pop.get(start) / divisor if pop.get(start) is not None else None
            values[bi] = pop.get(last) / divisor if pop.get(last) is not None else None
            editor['population'][field] = values
        # Missing observations remain blank, never borrowed from frontend defaults.
        for section in ('bau', 'macro'):
            for key, value in editor[section].items():
                if key not in raw.get(section, {}) and isinstance(value, list):
                    editor[section][key] = []
        editor['_legacy_editor_snapshot'] = deepcopy(editor)
        editor['_legacy_engine'] = deepcopy(raw)
    return {'__wss_bundle': 1, 'inputs': editor, 'altInputs': {},
            'scope': {'scopeMode': 'urban_rural', 'areaUrban': area == 'urban',
                      'areaRural': area == 'rural', 'sectors': ['water', 'sanitation']}}
