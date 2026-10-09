"""Shared loan and scheduled-obligation presentation for all export paths."""
from model.utility_debt import INDICATIVE_QUALIFICATION

INJECTION_FIELDS = (
    ('disbursement', 'New loan injection'),
    ('opening_unspent_proceeds', 'Opening unspent loan proceeds'),
    ('investment_from_loan_proceeds', 'Investment from loan proceeds'),
    ('closing_unspent_proceeds', 'Closing unspent loan proceeds'),
)


def loan_tables(debt, currency, money_factor=1.0):
    modeled = debt.get('repayment_accounting') == 'fixed_annuity_modeled'
    accounting = 'Fixed annual scheduled obligations; paid only from selected sources. Unfunded amounts remain due; principal balances are contractual.' if modeled else 'Legacy — repayments deferred'
    headers = ['Assumption or balance', 'Value', f'Amount ({currency} M)']
    rows = [
        ['Qualification', debt.get('qualification') or (INDICATIVE_QUALIFICATION if modeled else accounting), None],
        ['Mode', 'Indicative loan funding', None],
        ['Status', debt.get('status', 'disabled'), None],
        ['Repayment accounting', accounting, None],
        ['Affordability verification', 'Not assessed', None],
        ['Indicative loan proceeds', None, (debt.get('indicative_principal') or 0) * money_factor],
        ['Closing unspent loan proceeds', None, (debt.get('closing_restricted_cash') or 0) * money_factor],
    ]
    if modeled:
        for label, key in (('Fixed annual debt service', 'fixed_annual_debt_service'),
                           ('Outstanding principal at modeled horizon', 'horizon_closing_principal'),
                           ('Remaining contractual debt service', 'remaining_contractual_debt_service'),
                           ('Funded service within horizon', 'horizon_debt_service_paid'),
                           ('Unfunded service within horizon', 'horizon_debt_service_unfunded')):
            rows.append([label, None, (debt.get(key) or 0)*money_factor])
        rows.append(['Remaining contractual payment count', debt.get('remaining_contractual_payments'), None])
    for i, area in enumerate(debt.get('areas') or [debt]):
        prefix = f"{area.get('area') or f'Area {i + 1}'} — " if debt.get('areas') else ''
        for label, key in (
            ('Reference / injection year', 'reference_year'),
            ('Revenue allocation share', 'allocation_share'),
            ('Annual real interest rate', 'annual_real_interest_rate'),
            ('Loan term (years)', 'loan_term_years'), ('Annuity factor', 'annuity_factor'),
            ('Migration note', 'migration_notice'),
            ('First repayment year', 'first_repayment_year'), ('Maturity year', 'maturity_year'),
        ):
            rows.append([prefix + label, area.get(key), None])
        rows.append([prefix + 'Selected intervention sources', ', '.join(area.get('revenue_sources') or []) or 'None', None])
        for label, key in (('Selected signed cash pool', 'selected_signed_pool'),
                           ('Eligible cash pool (zero floor after summing)', 'eligible_pool'),
                           ('Fixed annual scheduled debt service' if modeled else 'Legacy hypothetical allocation — not deducted', 'annual_allocation')):
            value = area.get(key)
            rows.append([prefix + label, None, value * money_factor if value is not None else None])
        for source, value in (area.get('reference_source_cash') or {}).items():
            rows.append([prefix + f'{source.title()} reference-year cash', None,
                         value * money_factor if value is not None else None])
    fields = (*INJECTION_FIELDS,
              ('ordinary_before_debt_service', 'Ordinary funds before debt service'),
              ('debt_service', 'Scheduled debt service'),
              ('debt_service_paid', 'Funded debt service'),
              ('debt_service_unfunded', 'Unfunded debt service'),
              ('funded_principal', 'Funded principal'),
              ('funded_interest', 'Funded interest'),
              ('unfunded_principal', 'Unfunded principal'),
              ('unfunded_interest', 'Unfunded interest'),
              ('ordinary_after_debt_service', 'Ordinary funds after debt service'),
              ('opening_principal', 'Opening outstanding principal'),
              ('principal_payment', 'Scheduled principal'),
              ('interest_payment', 'Scheduled interest'),
              ('closing_principal', 'Closing outstanding principal'))
    annual_headers = ['Year', *[f'{label} ({currency} M)' for _, label in fields], 'Repayment accounting']
    cash = {row['year']: row for row in debt.get('annual_injection') or []}
    schedule = {row['year']: row for row in debt.get('repayment_schedule') or []}
    annual_rows = []
    for year in sorted(set(cash) | set(schedule)):
        row = {**schedule.get(year, {}), **cash.get(year, {})}
        values = []
        for key, _ in fields:
            value = row.get(key)
            if key in ('opening_principal', 'principal_payment', 'interest_payment', 'closing_principal') and year in cash and year not in schedule:
                previous = [item for y,item in schedule.items() if y < year]
                value = (max(previous, key=lambda item:item['year'])['closing_principal'] if previous else 0) if key in ('opening_principal','closing_principal') else 0
            values.append(value*money_factor if value is not None else None)
        annual_rows.append([year, *values, accounting])
    return (headers, rows), (annual_headers, annual_rows)
