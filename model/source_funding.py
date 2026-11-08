"""Actual annual source accounting. Money is million local currency.

Losses, selected-source debt, current replacement, prior replacement backlog
and prior treatment costs are charged in that order. Only residual ordinary cash can purchase expansion.
Restricted loan proceeds are introduced by allocate_purchases, never here.
"""
import math

SOURCE_KEYS = ('baseline', 'budget_execution', 'financial', 'injection',
               'connections', 'collection', 'tariff', 'nrw', 'nrw_link', 'custom',
               'loan', 'microfinance', 'grant', 'zero_cost')
MAP_FIELDS = ('signed_contribution', 'loss_charge', 'loss_covered',
              'debt_charge', 'replacement_charge', 'replacement_current_charge', 'replacement_backlog_charge', 'expansion_available',
              'basic_capital_spent', 'sm_capital_spent', 'ancillary_spent', 'treatment_backlog_charge', 'unused')
TOTAL_FIELDS = ('loss_unfunded', 'debt_service_due', 'debt_service_paid',
                'debt_service_unfunded', 'replacement_due', 'replacement_paid',
                'replacement_unfunded', 'eligible_capital_after_losses_debt',
                'replacement_backlog_opening', 'replacement_backlog_paid',
                'replacement_backlog_closing', 'replacement_paid_total',
                'treatment_backlog_opening', 'treatment_backlog_paid')


def allocate_sources(contributions, replacement_due=0., debt_due=0., selected=(), replacement_backlog=0., treatment_backlog=0.):
    r = {s: float(v) for s, v in contributions.items()}
    if not all(math.isfinite(v) for v in [*r.values(), replacement_due, debt_due, replacement_backlog, treatment_backlog]):
        raise ValueError('Non-finite source funding input')
    if replacement_due < 0 or debt_due < 0 or replacement_backlog < 0 or treatment_backlog < 0:
        raise ValueError('Funding obligations cannot be negative')
    positive = {s: max(v, 0.) for s, v in r.items()}
    pool = sum(positive.values())
    loss = sum(max(-v, 0.) for v in r.values())
    paid_loss = min(loss, pool)
    charge = {s: paid_loss * v / pool if pool else 0. for s, v in positive.items()}
    after = {s: max(0., v - charge[s]) for s, v in positive.items()}
    capacity = sum(v for s, v in after.items() if s in selected)
    paid_debt = min(debt_due, capacity)
    debt = {s: paid_debt * v / capacity if s in selected and capacity else 0.
            for s, v in after.items()}
    after = {s: max(0., v - debt[s]) for s, v in after.items()}
    pool = sum(after.values())
    replacement_paid = min(replacement_due, pool)
    replacement = {s: replacement_paid * v / pool if pool else 0.
                   for s, v in after.items()}
    remaining = {s: max(0., v - replacement[s]) for s, v in after.items()}
    remainder = sum(remaining.values())
    backlog_paid = min(replacement_backlog, remainder)
    backlog_charge = {s: backlog_paid * v / remainder if remainder else 0. for s, v in remaining.items()}
    after_replacement = {s: max(0., v-backlog_charge[s]) for s, v in remaining.items()}
    pool_after_replacement = sum(after_replacement.values())
    treatment_paid = min(treatment_backlog, pool_after_replacement)
    treatment_charge = {s: treatment_paid*v/pool_after_replacement if pool_after_replacement else 0.
                        for s, v in after_replacement.items()}
    return dict(
        signed_contribution=r, loss_charge=charge,
        loss_covered={s: paid_loss * max(-v, 0.) / loss if loss else 0. for s, v in r.items()},
        debt_charge=debt, replacement_current_charge=replacement, replacement_backlog_charge=backlog_charge,
        replacement_charge={s: replacement[s] + backlog_charge[s] for s in after},
        treatment_backlog_charge=treatment_charge, treatment_backlog_paid=treatment_paid,
        treatment_backlog_opening=treatment_backlog,
        expansion_available={s: max(0., v-treatment_charge[s]) for s, v in after_replacement.items()},
        eligible_capital_after_losses_debt=pool,
        replacement_backlog_opening=replacement_backlog, replacement_backlog_paid=backlog_paid,
        replacement_backlog_closing=replacement_backlog-backlog_paid+max(0., replacement_due-replacement_paid),
        replacement_paid_total=replacement_paid+backlog_paid,
        loss_unfunded=max(0., loss-paid_loss), debt_service_due=debt_due,
        debt_service_paid=paid_debt, debt_service_unfunded=max(0., debt_due-paid_debt),
        replacement_due=replacement_due, replacement_paid=replacement_paid,
        replacement_unfunded=max(0., replacement_due-replacement_paid))


def allocate_purchases(allocation, basic_capital, sm_capital, ancillary, loan_available=0.):
    """Assign authoritative combined purchases; ordinary cash is used first."""
    available = allocation['expansion_available']
    ordinary = sum(available.values())
    total = basic_capital + sm_capital + ancillary
    used = min(ordinary, total)
    loan_used = max(0., total-used)
    if loan_used > loan_available + 1e-7 * max(1., total):
        raise ValueError('Actual purchases exceed ordinary and restricted expansion cash')
    spent = {s: used*v/ordinary if ordinary else 0. for s, v in available.items()}
    spent['loan'] = loan_used
    for field, amount in [('basic_capital_spent', basic_capital),
                          ('sm_capital_spent', sm_capital), ('ancillary_spent', ancillary)]:
        allocation[field] = {s: amount*v/total if total else 0. for s, v in spent.items()}
    allocation['unused'] = {s: max(0., v-spent.get(s, 0.)) for s, v in available.items()}
    allocation['expansion_available']['loan'] = loan_available
    allocation['unused']['loan'] = max(0., loan_available-loan_used)
    # Priority settlement is already removed from expansion cash; record it once
    # as actual ancillary investment, never as a household purchase or loan use.
    for s, amount in allocation.get('treatment_backlog_charge', {}).items():
        allocation['ancillary_spent'][s] = allocation['ancillary_spent'].get(s, 0.) + amount
    return allocation


def new_ledger(years, debt_included, extra_sources=()):
    n = len(years)
    keys = (*SOURCE_KEYS, *extra_sources)
    return dict(version=2, method='actual_source_funding', units='million local currency',
                debt_included=debt_included, years=list(map(int, years)), source_keys=list(keys),
                **{f: {s: [0.]*n for s in keys} for f in MAP_FIELDS},
                **{f: [0.]*n for f in TOTAL_FIELDS})


def record(ledger, t, row):
    for f in MAP_FIELDS:
        for s, v in row.get(f, {}).items():
            ledger[f][s][t] = float(v)
    for f in TOTAL_FIELDS:
        ledger[f][t] = float(row[f])
