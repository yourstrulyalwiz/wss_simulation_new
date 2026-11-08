"""Raw-draft intervention inventory and validation, before adapter/model defaults.

Fractions are stored 0..1, money retains its existing units, years are integers.
The API and UI use this same validator. No defaults or draft mutations occur here.
"""
import math
import re
from simulation_scope import sectors_of

NUMBER = re.compile(r'^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$')
TOLERANCE = .005


class InterventionInputError(ValueError):
    def __init__(self, issues):
        self.issues = issues
        super().__init__('Complete the indicated intervention inputs.')


def numeric(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, str):
        if not NUMBER.fullmatch(value.strip()):
            return None
        value = float(value)
    if not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    return float(value)


# Inventory: field, visible label, numeric domain. Schedule pairs are checked below.
INVENTORY = {
    'collection_efficiency': [('ce_start_year', 'Improvement start year', 'year'),
        ('ce_target_year', 'Target year', 'year'), ('ce_target_ratio', 'Target collection ratio', 'share')],
    'tariff': [('tariff_start_year', 'Improvement start year', 'year'),
        ('tariff_target_year', 'Target year', 'year'), ('tariff_target', 'Target tariff', 'amount')],
    'capital_efficiency': [('capeff_start_year', 'Improvement start year', 'year'),
        ('capeff_target_year', 'Target year', 'year'), ('capeff_target_pct', 'Target budget execution', 'share')],
    'costeff': [('costeff_start_year', 'Improvement start year', 'year'),
        ('costeff_target_year', 'Target year', 'year'), ('costeff_target_pct', 'Capex efficiency improvement', 'discount')],
    'nrw': [('nrw_start_year', 'Start year', 'year'), ('nrw_target_year', 'Target year', 'year'),
        ('nrw_lag_years', 'Benefit lag', 'integer'), ('nrw_current_pct', 'Current NRW %', 'share'),
        ('nrw_target_pct', 'Target NRW %', 'share'), ('nrw_commercial_loss_pct', 'Commercial losses % of NRW', 'share'),
        ('nrw_physical_loss_pct', 'Physical losses % of NRW', 'share'),
        ('nrw_system_input_vol', 'System input volume (at start year)', 'amount'),
        ('nrw_existing_customer_sales_capacity_mld', 'Additional billable demand through existing connections', 'amount'),
        ('nrw_unsold_production_reduction_share', 'Share of remaining capacity used to reduce production', 'share'),
        ('nrw_capex_unit_cost_local', 'Cost of fixing', 'amount'),
        ('nrw_treatment_cost_pct_capex', 'Water treatment cost as % of total capex', 'share')],
    'microfinance': [('mf_connection_fee', 'Connection fee', 'amount'),
        ('mf_start_year', 'Improvement start year', 'year'), ('mf_end_year', 'End year', 'year'),
        ('mf_selffinance_share', 'Can pay upfront (share of eligible pool)', 'share'),
        ('mf_pct_income', 'Willingness to pay', 'share'), ('mf_interest_rate', 'Loan interest rate (real)', 'amount'),
        ('mf_tenor', 'Loan tenor', 'positive'), ('mf_takeup_rate', 'Take-up rate', 'share'),
        ('mf_partial_share', 'Partial upfront payers', 'share'), ('grant_total', 'Grant budget (one-time pool)', 'amount')],
    'techmix': [('techmix_start_year', 'Improvement start year', 'year')],
    'nrw_link': [('nrw_link_return_ratio', 'Wastewater return ratio', 'share'),
        ('nrw_link_eligible_share', 'Explicit sewer-billable share', 'share')],
}


def validate_interventions(payload, area=None):
    issues = []
    selected = sectors_of(payload)
    toggles = payload.get('toggles') or {}
    area = area or (payload.get('country_config') or {}).get('area') or 'current'
    period = payload.get('period') or {}
    first, last = period.get('baseline_year', 2025), period.get('forecast_end_year', 2035)

    def issue(sector, intervention, path, label, code, message, severity='error'):
        issues.append(dict(area=area, sector=sector, intervention=intervention,
                           field=path, label=label, code=code, severity=severity, message=message))

    def check(sector, intervention, path, label, value, kind='amount', optional=False):
        missing = value is None or isinstance(value, str) and not value.strip()
        if missing:
            if not optional:
                issue(sector, intervention, path, label, 'required',
                      f'Please enter {label}.' + ('' if kind == 'year' else ' Enter 0 if zero is intended.'))
            return None
        v = numeric(value)
        if v is None:
            issue(sector, intervention, path, label, 'invalid_number', f'{label}: enter a finite number.')
            return None
        invalid = (v < 0 if kind not in ('growth',) else v < -1)
        invalid |= kind in ('share', 'discount') and v > 1
        invalid |= kind == 'discount' and v == 1
        invalid |= kind == 'positive' and v <= 0
        invalid |= kind in ('year', 'integer') and not v.is_integer()
        invalid |= kind == 'year' and not 1900 <= v <= 2200
        if invalid:
            issue(sector, intervention, path, label, 'range', f'{label}: value is outside the supported range ({kind}).')
        elif v == 0:
            issue(sector, intervention, path, label, 'zero', f'0 entered for {label}. Please review; the model will use 0.', 'warning')
        return v

    for sector, prefix in [('water', 'ws'), ('sanitation', 'san')]:
        if sector not in selected:
            continue
        section = sector + '_interventions'
        iv = payload.get(section) or {}
        active = {key: bool(toggles.get(prefix + '_' + key + '_enabled')) for key in INVENTORY}
        active['microfinance'] = bool(toggles.get(prefix + '_affordability_enabled') or toggles.get(prefix + '_microfinance_enabled'))
        active['collection_efficiency'] |= bool(toggles.get(prefix + '_collection_enabled'))
        active['nrw'] &= sector == 'water'
        active['nrw_link'] &= sector == 'sanitation' and 'water' in selected
        active['financial_commitment'] = bool(toggles.get(prefix + '_financial_commitment_enabled'))
        active['exogenous_injection'] = bool(toggles.get(prefix + '_exogenous_injection_enabled') or
            active['financial_commitment'] and iv.get('fin_injection_enabled'))
        config = (payload.get('connection_revenue') or {}).get(sector) or {}
        active['connections'] = bool(toggles.get(prefix + '_connections_enabled', config.get('enabled')))
        for group, enabled in active.items():
            if not enabled:
                continue
            def field(name, label, kind='amount', optional=False):
                return check(sector, group, section + '.' + name, label, iv.get(name), kind, optional)
            for name, label, kind in INVENTORY.get(group, []):
                field(name, label, kind)
            if group in ('collection_efficiency', 'tariff', 'connections', 'nrw_link', 'nrw'):
                base = (payload.get('revenue_bases') or {}).get(sector) or {}
                for key, label, kind in [('volume_mld','Shared billed volume','amount'),
                        ('tariff','Shared tariff','amount'), ('collection_ratio','Shared collection ratio','share'),
                        ('reference_year','Shared revenue reference year','year')]:
                    check(sector, group, f'revenue_bases.{sector}.{key}', label, base.get(key), kind)
                check(sector, group, f'revenue_bases.{sector}.growth_rate', 'Shared volume growth override', base.get('growth_rate'), 'growth', True)
                for rung in ('basic', 'sm'):
                    key = 'new_billed_share_' + rung
                    check(sector, group, f'connection_revenue.{sector}.{key}',
                          ('Basic' if rung == 'basic' else 'Safely Managed') + ' expansion billed (%)', config.get(key), 'share')
            if group == 'exogenous_injection':
                mode = iv.get('fin_injection_mode')
                if mode not in ('one_time', 'recurring'):
                    issue(sector, group, section+'.fin_injection_mode', 'Funding mode', 'required', 'Select one-time or recurring funding.')
                field('fin_injection_amount', 'Annual funding amount' if mode == 'recurring' else 'Funding amount')
                start = field('fin_injection_start_year', 'Start year' if mode == 'recurring' else 'Injection year', 'year')
                end = field('fin_injection_end_year', 'End year', 'year') if mode == 'recurring' else start
                if start is not None and end is not None and (end < start or start <= first or end > last):
                    issue(sector, group, section+'.fin_injection_start_year', 'Start year', 'schedule', 'Funding years must be ordered within the forecast period.')
            if group == 'financial_commitment':
                if iv.get('fin_gdp_enabled'):
                    rows = iv.get('fin_gdp_targets')
                    if 'fin_gdp_target_draft' in iv:
                        rows = [{'year': r.get('year'), 'target_share': numeric(r.get('share')) / 100 if numeric(r.get('share')) is not None else r.get('share')} for r in iv['fin_gdp_target_draft']]
                    if rows is None:
                        rows = [{'year': iv.get('fin_gdp_start_year'), 'target_share': iv.get('fin_gdp_target_share')}]
                    if not rows:
                        issue(sector, group, section+'.fin_gdp_targets', 'GDP targets', 'required', 'Enter at least one GDP spending target.')
                    seen = set()
                    for i, row in enumerate(rows):
                        year = check(sector, group, f'{section}.fin_gdp_targets.{i}.year', f'Target {i+1} year', row.get('year'), 'year')
                        check(sector, group, f'{section}.fin_gdp_targets.{i}.target_share', f'Target {i+1} GDP share', row.get('target_share'))
                        if year is not None:
                            if year in seen or not first < year <= last:
                                issue(sector, group, f'{section}.fin_gdp_targets.{i}.year', f'Target {i+1} year', 'schedule', 'Target years must be unique and within the forecast period.')
                            seen.add(year)
                if iv.get('fin_growth_enabled'):
                    field('fin_growth_rate', 'Annual spending increase')
                    field('fin_growth_start_year', 'Start year', 'year')
                    field('fin_growth_end_year', 'End year', 'year')
            if group == 'nrw':
                field('nrw_vol_growth', 'Volume growth rate', 'growth', True)
                reduction_share = numeric(iv.get('nrw_unsold_production_reduction_share'))
                if reduction_share is not None and reduction_share > 0:
                    field('nrw_production_cost', 'Avoidable variable production cost per m³')
                losses = [numeric(iv.get(k)) for k in ('nrw_commercial_loss_pct','nrw_physical_loss_pct')]
                if all(v is not None for v in losses) and abs(sum(losses)-1) > TOLERANCE:
                    issue(sector, group, section+'.nrw_physical_loss_pct', 'Physical losses % of NRW', 'sum', 'Commercial and physical loss shares must total 100%.')
            if group == 'nrw_link':
                for year, amount in (iv.get('nrw_link_overlap_m3_series') or {}).items():
                    check(sector, group, section+'.nrw_link_overlap_m3_series.'+str(year),
                          'Identified overlap '+str(year), amount, optional=True)
                if not toggles.get('ws_nrw_enabled'):
                    issue(sector, group, 'toggles.ws_nrw_enabled', 'Water NRW reduction', 'dependency', 'Enable and complete Water NRW reduction to use sanitation NRW linkage.')
            if group == 'capital_efficiency':
                bau = payload.get('bau') or {}
                for kind, label in [('expend', 'Executed budget'), ('alloc', 'Allocated budget')]:
                    series = bau.get(prefix+'_'+kind+'_ts') or []
                    if not any(numeric(value) is not None for value in series):
                        issue(sector, group, f'bau.{prefix}_{kind}_ts', label, 'dependency',
                              f'Enter {label} observations in Data Inputs → Budget to calculate current execution.')
            if group == 'techmix':
                for rung in ('basic', 'sm'):
                    rows = iv.get('techmix_'+rung+'_tech_mix')
                    if not rows:
                        issue(sector, group, section+'.techmix_'+rung+'_tech_mix', rung.upper()+' mix', 'required', 'Enter the technology mix shares and costs.')
                        continue
                    shares, weighted = [], 0
                    for i, row in enumerate(rows):
                        path = f'{section}.techmix_{rung}_tech_mix.{i}'
                        if not str(row.get('name') or '').strip():
                            issue(sector, group, path+'.name', f'{rung.upper()} row {i+1} name', 'required', 'Enter the technology name.')
                        share = check(sector, group, path+'.share', f'{rung.upper()} row {i+1} share', row.get('share'), 'share')
                        cost = check(sector, group, path+'.cost', f'{rung.upper()} row {i+1} cost', row.get('cost'), optional=share == 0)
                        if share is not None: shares.append(share)
                        if share is not None and cost is not None: weighted += share * cost
                    if len(shares) == len(rows) and abs(sum(shares)-1) > TOLERANCE:
                        issue(sector, group, section+'.techmix_'+rung+'_tech_mix', rung.upper()+' mix', 'sum', 'Technology shares must total 100%; they are not normalized automatically.')
                    if weighted <= 0 and len(shares) == len(rows) and sum(shares) > 0:
                        issue(sector, group, section+'.techmix_'+rung+'_tech_mix', rung.upper()+' mix cost', 'zero_cost', 'The weighted service cost must be positive to calculate finite service purchases. Entered zero costs are retained.')
            if group == 'microfinance':
                gaps = iv.get('mf_gap_shares') or []
                if len(gaps) != len((payload.get('income_distribution') or {}).get('brackets') or []) or not gaps:
                    issue(sector, group, section+'.mf_gap_shares', 'Eligible-pool distribution', 'required', 'Enter one eligible-pool share per income bracket.')
                values = [check(sector, group, f'{section}.mf_gap_shares.{i}', f'Eligible pool row {i+1}', v, 'share') for i, v in enumerate(gaps)]
                if values and all(v is not None for v in values) and abs(sum(values)-1) > TOLERANCE:
                    issue(sector, group, section+'.mf_gap_shares', 'Eligible-pool distribution', 'sum', 'Eligible-pool shares must total 100%.')
                if (numeric(iv.get('mf_partial_share')) or 0) > 0:
                    field('mf_upfront_payable_ratio', 'Upfront fee they cover', 'share')
                brackets = (payload.get('income_distribution') or {}).get('brackets') or []
                if not brackets:
                    issue(sector, group, 'income_distribution.brackets', 'Income brackets', 'required', 'Enter income and household-share rows.')
                for i, row in enumerate(brackets):
                    for key, label, kind in [('income_monthly','Monthly income','amount'),('hh_share','Household share','share')]:
                        check(sector, group, f'income_distribution.brackets.{i}.{key}', f'{label} row {i+1}', row.get(key), kind)
                shares = [numeric(r.get('hh_share')) for r in brackets]
                if shares and all(v is not None for v in shares) and abs(sum(shares)-1) > TOLERANCE:
                    issue(sector, group, 'income_distribution.brackets', 'Household shares', 'sum', 'Household shares must total 100%.')
            for start_key, end_key in [('ce_start_year','ce_target_year'),('tariff_start_year','tariff_target_year'),
                    ('capeff_start_year','capeff_target_year'),('costeff_start_year','costeff_target_year'),
                    ('nrw_start_year','nrw_target_year'),('mf_start_year','mf_end_year'),
                    ('fin_growth_start_year','fin_growth_end_year')]:
                relevant = start_key in [f[0] for f in INVENTORY.get(group, [])] or group == 'financial_commitment' and iv.get('fin_growth_enabled') and start_key == 'fin_growth_start_year'
                a, b = numeric(iv.get(start_key)), numeric(iv.get(end_key))
                if relevant and a is not None and b is not None and b < a:
                    issue(sector, group, section+'.'+end_key, 'Target year' if 'target' in end_key else 'End year', 'schedule', 'End/target year must not precede the start year.')
    if ('water' in selected and 'sanitation' in selected and toggles.get('san_nrw_link_enabled')
            and any(i['sector'] == 'water' and i['severity'] == 'error' for i in issues)):
        issue('sanitation', 'nrw_link', 'toggles.ws_nrw_enabled', 'Water NRW dependency',
              'dependency', 'Complete the active Water intervention inputs before calculating this linked sanitation scenario.')
    return issues


def require_valid_interventions(payload):
    issues = validate_interventions(payload)
    if any(i['severity'] == 'error' for i in issues):
        raise InterventionInputError(issues)
