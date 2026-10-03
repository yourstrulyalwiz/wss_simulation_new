"""Annual report definitions shared by API, CSV, Excel and both PowerPoint paths.

No finance or coverage is recalculated here: use the model's already reconciled
per-area arrays, including its unmet-service gaps and cumulative forecast flows.
"""

# Label, engine key, optional service rung. Amounts are native real currency M;
# household counts are M HH. Debt schedules through maturity remain separate.
GROUPS = [
    ('Safely-managed coverage and gaps (M HH)', [
        ('BAU', 'bau_hh', 0), ('Intervention', 'scenario_hh', 0), ('Target', 'target_hh', 0),
        ('BAU unmet', 'service_gap_display', 0), ('Intervention unmet', 'scenario_service_gap_display', 0)]),
    ('Basic coverage and gaps (M HH)', [
        ('BAU', 'bau_hh', 1), ('Intervention', 'scenario_hh', 1), ('Target', 'target_hh', 1),
        ('BAU unmet', 'service_gap_display', 1), ('Intervention unmet', 'scenario_service_gap_display', 1)]),
    ('Gross scheduled transitions (M HH)', [
        ('New Basic', 'scenario_target_new_basic_connections', None),
        ('New SM', 'scenario_target_new_sm_connections', None),
        ('Basic to SM upgrades', 'scenario_target_sm_upgrades', None),
        ('SM to Basic', 'scenario_target_sm_downgrades', None)]),
    ('Annual investment requirements', [
        ('BAU expansion', 'new_capex_total', None), ('BAU replacement', 'replacement_capex', None),
        ('Scenario expansion', 'scenario_new_capex_total', None),
        ('Scenario replacement', 'scenario_replacement_capex', None),
        ('Implementation', 'scenario_implementation_capex', None),
        ('Scenario total', 'scenario_total_investment_need', None)]),
    ('Annual financing sources and carry', [
        ('Usable public capital', 'scenario_public_capital', None),
        ('Other capital', 'scenario_other_capital', None),
        ('Direct reinvestment', 'scenario_cash_allocated_to_direct_investment', None),
        ('Borrowing drawdowns', 'scenario_loan_drawdown', None),
        ('New financing', 'scenario_current_year_financing', None),
        ('Opening carry', 'scenario_cash_opening', None),
        ('Closing carry', 'scenario_cash_carry_forward', None)]),
    ('Annual and cumulative financing gaps', [
        ('BAU annual gap', 'financing_gap', None),
        ('Scenario annual gap', 'scenario_financing_gap', None),
        ('BAU cumulative gap', 'cumulative_financing_gap', None),
        ('Scenario cumulative gap', 'scenario_cumulative_financing_gap', None),
        ('Cumulative requirement', 'scenario_cumulative_investment_requirement', None)]),
    ('Residual additional public financing', [
        ('Annual before', 'scenario_financing_gap_before_additional_public', None),
        ('Explicit contribution', 'scenario_additional_public_capital', None),
        ('Annual after', 'scenario_financing_gap', None),
        ('Cumulative before', 'scenario_cumulative_residual_public_before', None),
        ('Cumulative after', 'scenario_cumulative_residual_public_after', None)]),
    ('Operating cash and debt', [
        ('Additional net cash', 'scenario_additional_net_utility_cash', None),
        ('Cash committed', 'scenario_cash_committed_to_debt', None),
        ('Scheduled service', 'scenario_loan_debt_service', None),
        ('Paid service', 'scenario_loan_debt_service_paid', None),
        ('Closing debt', 'scenario_loan_closing_debt', None),
        ('Repayment shortfall', 'scenario_loan_debt_service_shortfall', None)]),
]

METHODOLOGY_NOTES = [
    ('Requirements', 'Gross expansion/upgrades + approximate replacement + implementation capex. '
     'Coverage shortfalls are not repeatedly repriced as additional programme need.'),
    ('Replacement approximation', 'Prior-year target-path asset value divided by useful life; '
     'no asset-age cohorts or explicit retirement model. Upgrade asset transfers are not new spending.'),
    ('Financing', 'Public and other capital + direct utility reinvestment + loan drawdowns. '
     'Opening investment carry is not a new receipt. Additional public residual is an output, not automatic funding.'),
    ('Gap timing', 'Cumulative shortfalls sum forecast annual gaps. Later surpluses do not erase earlier '
     'shortfalls or automatically reprogramme missed investment. Service gaps are annual HH snapshots.'),
    ('Cash allocation', 'Reinvest-all (alpha=0), partial, or all eligible cash (alpha=1). '
     'Known obligations are deducted before alpha; negative cash effects remain signed. Capital is not debt-service cash.'),
    ('Borrowing', 'Separate area/sector loans, established eligible net cash, DSCR and remaining need caps. '
     'A fixed principal is a contractual assumption. No recursive borrowing against loan-funded connections.'),
    ('Reserves and shortfalls', 'Committed cash is retained for debt only; surplus releases after maturity obligations. '
     'Contractual payments do not shrink with low cash. Unpaid interest accrues; no automatic refinancing.'),
    ('Reporting basis', 'Amounts are real currency millions except explicitly nominal schedule columns. '
     'Nominal fixed payments are converted and deflated with local inflation independently of GDP entry basis.'),
    ('Beyond projection', 'Established net cash and prior obligations held flat in real terms; final projected '
     'inflation continues to maturity. Debt schedules do not extend the coverage forecast.'),
    ('Capacity disclosure', 'Incremental estimate conditional on baseline obligations being covered; '
     'not a full utility financial plan or creditworthiness assessment.'),
    ('National aggregation', 'National flows and unmet gaps sum already-reconciled area results. '
     'An unused surplus in one area does not automatically close another area’s gap; entity cash and debt stay separate.'),
    ('Volume scope', 'Entered volume grows with population ratio ONCE or a fixed compound rate INSTEAD. '
     'Basic-to-SM upgrades are not automatically new paying customers; endogenous feedback is deferred.'),
]


def annual_reporting_tables(result, inputs, sector):
    currency = (inputs.get('country_config') or {}).get('currency') or 'LCU'
    sec = result[sector]
    tables = []
    for title, fields in GROUPS:
        unit = '' if '(M HH)' in title else f' (real {currency} M)'
        rows = []
        for i, year in enumerate(result['years']):
            values = []
            for _, key, rung in fields:
                series = sec[key]  # Missing required data fails explicitly.
                if rung is not None:
                    series = series[rung]
                values.append(float(series[i]))
            rows.append([year, *values])
        column_unit = ' (M HH)' if '(M HH)' in title else f' (real {currency} M)'
        tables.append({'title': title + unit,
                       'headers': ['Year', *[label + column_unit for label, _, _ in fields]], 'rows': rows})
    return tables


def assumption_rows(inputs):
    from input_compatibility import migrate_input_compatibility
    migrated = migrate_input_compatibility(inputs)
    return [list(row) for row in METHODOLOGY_NOTES] + [
        ['Saved scenario — review required', note] for note in migrated.get('migration_notes', [])]