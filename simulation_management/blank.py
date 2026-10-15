"""New projects contain structure and forecasting configuration, not Nepal observations."""
from copy import deepcopy


def blank_inputs(country=None, area_label='', shared=None):
    from demo_adapter import frontend_defaults
    defaults = frontend_defaults()
    out = deepcopy(defaults)
    def cleared(value):
        if isinstance(value, dict):
            return {key: cleared(v) for key, v in value.items()}
        if isinstance(value, list):
            return []
        if isinstance(value, bool):
            return False
        if isinstance(value, (int, float)):
            return None
        return value
    for key in ('macro', 'population', 'water_service', 'sanitation_service',
                'water_costs', 'sanitation_costs', 'technical', 'water_targets',
                'sanitation_targets', 'income_distribution', 'bau'):
        out[key] = cleared(defaults.get(key, {}))
    for key in ('gdp_growth_forecast', 'inflation_local_ongoing', 'inflation_us_ongoing',
                'capex_pct_budget', 'execution_rate'):
        if key in defaults['macro']:
            out['macro'][key] = defaults['macro'][key]
    for prefix in ('ws', 'san'):
        out['bau'][prefix+'_budget_ongoing'] = .05
        out['macro'][prefix+'_budget_is_total_spending'] = False
        out['macro'][prefix+'_budget_capital_share'] = 1.
        # GDP shares are not the entered-budget input; leave unavailable observations blank.
        out['macro'][prefix+'_budget_pct_gdp'] = 0.
    out['macro']['budget_source'] = 'entered_budget'
    out['bau']['investment_periods'] = []
    out['toggles'] = {key: False for key in defaults['toggles']}
    for sector in ('water', 'sanitation'):
        out[sector+'_interventions'] = cleared(defaults.get(sector+'_interventions', {}))
        out[sector+'_interventions'].update(fin_gdp_enabled=False, fin_growth_enabled=False)
    out['custom_interventions'] = []
    out['connection_revenue'] = {}
    out['revenue_bases'] = {}
    out['utility_debt'] = {'water': {'enabled': False}, 'sanitation': {'enabled': False}}
    out['country_config'].update(country=(country or {}).get('name', ''), area=area_label,
                                 currency='LCU', provider1_name='', provider2_name='')
    if shared:
        out['country_config'] = deepcopy(shared.get('country_config', out['country_config']))
        out['period'] = deepcopy(shared.get('period', out['period']))
    out['profile_metadata'] = {'status': 'new_simulation',
                               'notice': 'Country-specific assumptions have not been calibrated.'}
    return out
