"""Selection orchestration only. Never modifies stored assumptions or equations."""
import copy

SECTORS = ('water', 'sanitation')


def sectors_of(payload):
    sectors = payload.get('calculation_scope', list(SECTORS))
    if not isinstance(sectors, list) or not sectors or any(s not in SECTORS for s in sectors) or len(set(sectors)) != len(sectors):
        raise ValueError('Select Water supply, Sanitation, or both.')
    return [s for s in SECTORS if s in sectors]


def normalize_scope(scope):
    scope = dict(scope or {})
    sectors = sectors_of({'calculation_scope': scope.get('sectors', list(SECTORS))})
    mode = scope.get('scopeMode', 'urban_rural')
    urban, rural = scope.get('areaUrban', True), scope.get('areaRural', False)
    if mode not in ('national', 'urban_rural') or type(urban) is not bool or type(rural) is not bool:
        raise ValueError('Invalid geographical scope.')
    if mode == 'urban_rural' and not (urban or rural):
        raise ValueError('Select at least one area.')
    return {**scope, 'sectors': sectors, 'scopeMode': mode,
            'areaUrban': urban if mode == 'urban_rural' else False,
            'areaRural': rural if mode == 'urban_rural' else False}


def active_areas(bundle):
    scope = normalize_scope(bundle.get('scope'))
    primary, alt = bundle['inputs'], bundle.get('altInputs', {})
    if scope['scopeMode'] == 'national':
        return {'national': alt.get('national', primary)}
    out = {}
    if scope['areaUrban']:
        out['urban'] = primary
    if scope['areaRural']:
        if 'rural' in alt:
            out['rural'] = alt['rural']
        elif not scope['areaUrban']:
            out['rural'] = primary
        else:
            raise ValueError('Rural inputs are missing; initialize a blank Rural dataset.')
    return out


def effective_payload(payload):
    """Discard inactive validation inputs in a COPY, never in persistent storage.

    Existing schema defaults can occupy unused structural slots, but those slots
    are never resolved or dispatched and never become saved observations.
    """
    sectors = sectors_of(payload)
    if len(sectors) == 2:
        return payload
    out = copy.deepcopy(payload)
    excluded = next(s for s in SECTORS if s not in sectors)
    prefix = 'ws' if excluded == 'water' else 'san'
    for key in list(out):
        if key.startswith(excluded + '_'):
            out.pop(key)
    for key in ('technical', 'macro', 'bau', 'wss_budget', 'toggles', 'planned'):
        if isinstance(out.get(key), dict):
            out[key] = {k: v for k, v in out[key].items() if not k.startswith(prefix + '_')}
    for key in ('connection_revenue', 'utility_debt', 'revenue_bases'):
        if isinstance(out.get(key), dict):
            out[key].pop(excluded, None)
    if isinstance(out.get('revenue_legacy'), dict):
        out['revenue_legacy'].pop(excluded + '_interventions', None)
    if excluded == 'water':
        # Legacy sanitation collection revenue uses shared billed-water anchors.
        # Keep only those active sanitation dependencies, not water interventions.
        if not (out.get('revenue_bases') or {}).get('sanitation'):
            legacy = payload.get('revenue_legacy') or {}
            water = legacy.get('water_interventions', payload.get('water_interventions', {}))
            out.setdefault('revenue_legacy', {})['water_interventions'] = {
                k: water[k] for k in ('ce_current_ratio', 'ce_water_sold_mld', 'ce_current_tariff',
                                     'ce_start_year', 'ce_vol_growth') if k in water}
            out['revenue_legacy']['sanitation_interventions'] = copy.deepcopy(
                legacy.get('sanitation_interventions', payload.get('sanitation_interventions', {})))
        out.setdefault('toggles', {})['san_nrw_link_enabled'] = False
    out['custom_interventions'] = [c for c in out.get('custom_interventions', []) if c.get('sector', 'both') != excluded]
    return out


def public_bundle(bundle):
    """A publication contains active data only, not dormant private assumptions."""
    original = copy.deepcopy(bundle)
    scope = normalize_scope(original.get('scope'))
    areas = active_areas(original)
    visible = {}
    for name, area in areas.items():
        area = effective_payload({**area, 'calculation_scope': scope['sectors']})
        for key in ('_legacy_engine', '_legacy_editor_snapshot'):
            if isinstance(area.get(key), dict):
                area[key] = effective_payload({**area[key], 'calculation_scope': scope['sectors']})
        visible[name] = area
    first = next(iter(visible))
    return {'__wss_bundle': 1, 'inputs': visible[first],
            'altInputs': {k: v for k, v in visible.items() if k != 'urban'},
            'scope': scope, 'presentation': original.get('presentation', {})}
