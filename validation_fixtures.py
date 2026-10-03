"""Deterministic mixed-area fixture for backend and frontend integration checks."""
import copy
from demo_adapter import frontend_defaults


def mixed_area_inputs():
    urban = frontend_defaults()
    rural = copy.deepcopy(urban)
    urban['country_config']['area'] = 'Urban'
    rural['country_config']['area'] = 'Rural'
    baseline = urban['period']['baseline_year']
    start = urban['period']['model_start_year']
    end = urban['period']['target2_year']
    rural['macro'].update(ws_budget_pct_gdp=0, san_budget_pct_gdp=0,
                           budget_input_mode='pct_gdp', budget_source='pct_gdp')
    # Urban retains actual assets above deliberately lower service targets.
    # Rural has higher targets and no new public budget: surplus coverage in Urban
    # must not cancel unmet Rural service or move Rural financing gaps to Urban.
    for inputs, shares in ((urban, [0, 0, 1, 0, 0]), (rural, [.5, .5, 0, 0, 0])):
        for section, prefix in (('water_service', 'serv'), ('sanitation_service', 'sserv')):
            # Sanitation starts with more Basic coverage, so a 90% Basic target
            # is needed to create a real Basic deficit in the rural fixture.
            service_shares = [.1, .9, 0, 0, 0] if inputs is rural and section == 'sanitation_service' else shares
            for rung, share in enumerate(service_shares, 1):
                for year in range(baseline + 1, end + 1):
                    inputs[section][f'{prefix}{rung}_ts'][year-start] = share
    return {'urban': urban, 'rural': rural}