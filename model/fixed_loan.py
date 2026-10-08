"""Fixed annuity obligations, independent of future source receipts or cash capacity."""
import math


def fixed_schedule(principal, annual, rate, term, injection_year, years):
    rows = []
    if principal > 0:
        balance = principal
        rows.append(dict(year=injection_year, opening_principal=0.0,
                         disbursement=principal, principal_payment=0.0,
                         interest_payment=0.0, debt_service=0.0, closing_principal=balance))
        for payment in range(1, term + 1):
            opening = balance
            interest = opening * rate
            repayment = annual - interest
            balance = opening - repayment
            if payment == term:
                tolerance = max(1e-8, principal * 1e-9)
                if abs(balance) > tolerance:
                    raise ValueError('Fixed loan schedule does not amortize within tolerance.')
                repayment = opening
                interest = annual - repayment
                balance = 0.0
            if not all(math.isfinite(v) for v in (balance, interest, repayment)):
                raise ValueError('Fixed loan schedule must be finite.')
            rows.append(dict(year=injection_year+payment, opening_principal=opening,
                             disbursement=0.0, principal_payment=repayment,
                             interest_payment=interest, debt_service=annual,
                             closing_principal=balance))
    by_year = {row['year']: row for row in rows}
    plan = dict(loan_amount=principal, schedule=rows)
    for key in ('disbursement', 'principal_payment', 'interest_payment', 'debt_service'):
        plan[key] = [by_year.get(int(y), {}).get(key, 0.0) for y in years]
    return plan
