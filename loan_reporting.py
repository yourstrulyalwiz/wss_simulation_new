"""Shared indicative-loan presentation for spreadsheets and both PPTX paths."""
from model.utility_debt import INDICATIVE_QUALIFICATION

INJECTION_FIELDS = (
    ('disbursement', 'New loan injection'),
    ('opening_unspent_proceeds', 'Opening unspent loan proceeds'),
    ('investment_from_loan_proceeds', 'Investment from loan proceeds'),
    ('closing_unspent_proceeds', 'Closing unspent loan proceeds'),
)


def loan_tables(debt, currency, money_factor=1.0):
    headers = ['Assumption or balance', 'Value', f'Amount ({currency} M)']
    rows = [
        ['Qualification', INDICATIVE_QUALIFICATION, None],
        ['Mode', 'Indicative loan funding', None],
        ['Status', debt.get('status', 'disabled'), None],
        ['Repayment accounting', 'Deferred — principal, interest and fees not modeled', None],
        ['Affordability verification', 'Not assessed', None],
        ['Indicative loan proceeds', None, (debt.get('indicative_principal') or 0) * money_factor],
        ['Closing unspent loan proceeds', None, (debt.get('closing_restricted_cash') or 0) * money_factor],
    ]
    for i, area in enumerate(debt.get('areas') or [debt]):
        prefix = f"{area.get('area') or f'Area {i + 1}'} — " if debt.get('areas') else ''
        for label, key in (
            ('Reference / injection year', 'reference_year'),
            ('Revenue allocation share', 'allocation_share'),
            ('Annual real interest rate', 'annual_real_interest_rate'),
            ('Loan term (years)', 'loan_term_years'), ('Annuity factor', 'annuity_factor'),
            ('Migration note', 'migration_notice'),
        ):
            rows.append([prefix + label, area.get(key), None])
        rows.append([prefix + 'Selected intervention sources', ', '.join(area.get('revenue_sources') or []) or 'None', None])
        for label, key in (('Selected signed cash pool', 'selected_signed_pool'),
                           ('Eligible cash pool (zero floor after summing)', 'eligible_pool'),
                           ('Hypothetical annual servicing allocation — not deducted', 'annual_allocation')):
            value = area.get(key)
            rows.append([prefix + label, None, value * money_factor if value is not None else None])
        for source, value in (area.get('reference_source_cash') or {}).items():
            rows.append([prefix + f'{source.title()} reference-year cash', None,
                         value * money_factor if value is not None else None])
    annual_headers = ['Year', *[f'{label} ({currency} M)' for _, label in INJECTION_FIELDS],
                      'Repayment accounting']
    annual_rows = [[row['year'], *[row.get(key, 0) * money_factor for key, _ in INJECTION_FIELDS],
                    'Deferred — not modeled'] for row in debt.get('annual_injection') or []]
    return (headers, rows), (annual_headers, annual_rows)
