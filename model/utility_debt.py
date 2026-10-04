"""Utility-level loan schedules and conservative capacity sizing.

Amounts use the model's local-currency millions. The schedule is real and
annual; loan proceeds are kept separate from the recurring cash available for
debt service.
"""
from __future__ import annotations

import math


class UtilityDebtInputError(ValueError):
    """Raised when an enabled utility debt configuration is incomplete or invalid."""


def normalize_config(config):
    if hasattr(config, 'model_dump'):
        config = config.model_dump()
    return dict(config or {})


def validate_config(config, years, baseline_year):
    cfg = normalize_config(config)
    share = cfg.get('allocation_share', 0.0)
    try:
        share = float(share)
    except (TypeError, ValueError):
        raise UtilityDebtInputError('Utility debt allocation share must be a number from 0 to 1.')
    if not math.isfinite(share) or not 0.0 <= share <= 1.0:
        raise UtilityDebtInputError('Utility debt allocation share must be between 0% and 100%.')
    cfg['allocation_share'] = share
    cfg['enabled'] = bool(cfg.get('enabled', False))
    try:
        cfg['principal_grace_years'] = int(cfg.get('principal_grace_years') or 0)
    except (TypeError, ValueError):
        raise UtilityDebtInputError('Utility debt principal grace years must be a whole number.')
    if cfg['principal_grace_years'] < 0:
        raise UtilityDebtInputError('Utility debt principal grace years cannot be negative.')
    if cfg.get('repayment_structure') not in ('annuity', 'equal_principal'):
        raise UtilityDebtInputError('Utility debt repayment structure must be annuity or equal principal.')
    rate = cfg.get('annual_real_interest_rate')
    if rate not in (None, ''):
        try:
            rate = float(rate)
        except (TypeError, ValueError):
            raise UtilityDebtInputError('Utility debt annual real interest rate must be a number.')
        if not math.isfinite(rate) or rate < 0.0:
            raise UtilityDebtInputError('Utility debt annual real interest rate cannot be negative.')
    cfg['annual_real_interest_rate'] = rate
    ceiling = cfg.get('loan_ceiling')
    if ceiling not in (None, ''):
        try:
            ceiling = float(ceiling)
        except (TypeError, ValueError):
            raise UtilityDebtInputError('Utility debt loan ceiling must be a non-negative amount.')
        if not math.isfinite(ceiling) or ceiling < 0.0:
            raise UtilityDebtInputError('Utility debt loan ceiling must be a non-negative amount.')
    cfg['loan_ceiling'] = ceiling
    if not cfg['enabled'] or share == 0:
        return cfg

    if rate is None:
        raise UtilityDebtInputError('Enter an annual real interest rate to enable utility borrowing.')
    disbursement = cfg.get('disbursement_year')
    maturity = cfg.get('maturity_year')
    if disbursement is None or maturity is None:
        raise UtilityDebtInputError('Enter both a loan disbursement year and final principal year.')
    try:
        disbursement, maturity = int(disbursement), int(maturity)
    except (TypeError, ValueError):
        raise UtilityDebtInputError('Utility debt disbursement and maturity years must be whole years.')
    forecast_years = [int(y) for y in years if int(y) > int(baseline_year)]
    if disbursement not in forecast_years:
        raise UtilityDebtInputError('Utility debt must be disbursed in a forecast year within the simulation horizon.')
    first_principal_year = disbursement + cfg['principal_grace_years'] + 1
    if maturity < first_principal_year:
        raise UtilityDebtInputError('Final principal year must be on or after the first principal-payment year.')
    cfg['disbursement_year'] = disbursement
    cfg['maturity_year'] = maturity
    cfg['first_principal_year'] = first_principal_year
    return cfg


def build_schedule(principal, config):
    """Return one annual row per year from disbursement through final repayment."""
    cfg = normalize_config(config)
    amount = max(0.0, float(principal or 0.0))
    if amount <= 0.0:
        return []
    rate = float(cfg['annual_real_interest_rate'])
    disbursement = int(cfg['disbursement_year'])
    first_principal = int(cfg.get(
        'first_principal_year',
        disbursement + int(cfg.get('principal_grace_years') or 0) + 1))
    maturity = int(cfg['maturity_year'])
    n_principal = maturity - first_principal + 1
    if n_principal <= 0:
        return []
    annuity = (amount / n_principal if rate == 0 else
               amount * rate / (1.0 - (1.0 + rate) ** (-n_principal)))
    balance = 0.0
    rows = []
    for year in range(disbursement, maturity + 1):
        opening = balance
        disbursed = amount if year == disbursement else 0.0
        balance += disbursed
        interest = balance * rate if year > disbursement else 0.0
        principal_paid = 0.0
        if year >= first_principal:
            if cfg.get('repayment_structure') == 'equal_principal':
                principal_paid = amount / n_principal
            else:
                principal_paid = max(0.0, annuity - interest)
            if year == maturity:
                principal_paid = balance
            principal_paid = min(balance, max(0.0, principal_paid))
            balance -= principal_paid
        total = interest + principal_paid
        rows.append({
            'year': year,
            'opening_principal': opening,
            'disbursement': disbursed,
            'principal_payment': principal_paid,
            'interest_payment': interest,
            'total_debt_service': total,
            'closing_principal': max(0.0, balance),
        })
    return rows


def execution_plan(principal, config, years):
    """Prepare arrays consumed by the annual infrastructure cash ledger."""
    rows = build_schedule(principal, config)
    by_year = {row['year']: row for row in rows}
    result = {
        'loan_amount': float(principal or 0.0),
        'schedule': rows,
        'disbursement': [],
        'principal_payment': [],
        'interest_payment': [],
        'debt_service': [],
    }
    for year in years:
        row = by_year.get(int(year), {})
        result['disbursement'].append(row.get('disbursement', 0.0))
        result['principal_payment'].append(row.get('principal_payment', 0.0))
        result['interest_payment'].append(row.get('interest_payment', 0.0))
        result['debt_service'].append(row.get('total_debt_service', 0.0))
    return result


def schedule_unit_capacity(config, capacity_by_year):
    """Initial principal upper bound from capacity divided by unit debt service."""
    unit = build_schedule(1.0, config)
    if not unit:
        return 0.0
    bounds = []
    for row in unit:
        service = row['total_debt_service']
        if service > 1e-15:
            bounds.append(max(0.0, float(capacity_by_year.get(row['year'], 0.0))) / service)
    return min(bounds) if bounds else 0.0


def solve_scenario(calc_fn, inputs, ctx, config, calc_kwargs=None, asset_life=30):
    """Size, rerun and verify a single non-revolving utility loan.

    The callback is the sector calculator. Each candidate is run through its
    ordinary funded-asset and replacement accounting before capacity is
    recalculated. Only a candidate whose full-maturity schedule passes every
    annual capacity test is returned.
    """
    cfg = validate_config(config, ctx['years'], inputs.period.baseline_year)
    kwargs = dict(calc_kwargs or {})
    reference = calc_fn(inputs, ctx, **kwargs)
    years = [int(y) for y in ctx['years']]
    target_end = years[-1]
    share = cfg['allocation_share']
    zero_plan = {
        'loan_amount': 0.0, 'schedule': [], 'disbursement': [0.0] * len(years),
        'principal_payment': [0.0] * len(years), 'interest_payment': [0.0] * len(years),
        'debt_service': [0.0] * len(years),
    }

    def summary(status, result, principal=0.0, requested_max=0.0,
                verified=False, capacities=None, schedule=None):
        capacities = capacities or {}
        schedules = schedule or []
        rows_by_year = {int(y): i for i, y in enumerate(years)}
        out_rows = []
        final_cash = float((result.get('utility_debt_cash_closing') or [0.0])[-1] or 0.0)
        previous_cash = final_cash
        for row in schedules:
            year = int(row['year'])
            i = rows_by_year.get(year)
            if i is not None:
                cash_open = float(result['utility_debt_cash_opening'][i] or 0.0)
                disbursed = float(result['utility_debt_disbursement'][i] or 0.0)
                used = float(result['utility_debt_investment_used'][i] or 0.0)
                cash_close = float(result['utility_debt_cash_closing'][i] or 0.0)
                eligible = float(result['eligible_additional_revenue'][i] or 0.0)
                predebt = float(result['available_total'][i] or 0.0)
                replacement_need = float(result['replacement_capex'][i] or 0.0)
            else:
                cash_open = previous_cash
                disbursed = used = 0.0
                cash_close = previous_cash
                eligible = float(result['eligible_additional_revenue'][-1] or 0.0)
                predebt = max(
                    0.0,
                    float(result['available_total'][-1] or 0.0)
                    - float((result.get('exogenous_injection_cash') or [0.0])[-1] or 0.0)
                    - float((result.get('custom_cash') or [0.0])[-1] or 0.0))
                terminal_stock = float((result.get('funded_asset_stock') or [0.0])[-1] or 0.0)
                replacement_need = terminal_stock / max(1.0, float(asset_life))
            out_rows.append({
                **row,
                'eligible_additional_revenue': eligible,
                'pre_debt_available_capital': predebt,
                'replacement_requirement': replacement_need,
                'annual_service_capacity': float(capacities.get(year, 0.0)),
                'payment_shortfall': max(
                    0.0, float(row['total_debt_service']) - float(capacities.get(year, 0.0))),
                'opening_restricted_cash': cash_open,
                'disbursement': disbursed,
                'investment_from_loan_proceeds': used,
                'closing_restricted_cash': cash_close,
            })
            previous_cash = cash_close
        return {
            'schema_version': 1,
            'status': status,
            'enabled': bool(cfg.get('enabled')),
            'verified_feasible': bool(verified),
            'allocation_share': share,
            'annual_real_interest_rate': cfg.get('annual_real_interest_rate'),
            'repayment_structure': cfg.get('repayment_structure'),
            'disbursement_year': cfg.get('disbursement_year'),
            'principal_grace_years': cfg.get('principal_grace_years', 0),
            'first_principal_year': cfg.get('first_principal_year'),
            'maturity_year': cfg.get('maturity_year'),
            'loan_ceiling': cfg.get('loan_ceiling'),
            'requested_max_principal': float(requested_max or 0.0),
            'accepted_principal': float(principal or 0.0),
            'total_interest': sum(float(row['interest_payment']) for row in schedules),
            'total_principal_repaid': sum(float(row['principal_payment']) for row in schedules),
            'closing_restricted_cash': final_cash,
            'tail_capacity_assumption': (
                'Terminal eligible revenue and recurring resources held constant; one-off injection '
                'and terminal custom cash excluded; funded assets held at closing stock.'
            ),
            'schedule': out_rows,
        }

    if not cfg.get('enabled'):
        return reference, zero_plan, summary('disabled', reference), reference
    if share == 0:
        return reference, zero_plan, summary('zero allocation share', reference), reference

    def capacity_map(result):
        available = result['available_total']
        eligible = result['eligible_additional_revenue']
        replacement = result['replacement_capex']
        capacities = {}
        for i, year in enumerate(years):
            if year <= inputs.period.baseline_year:
                continue
            resources = max(0.0, float(available[i]) - float(replacement[i]))
            capacities[year] = share * min(max(0.0, float(eligible[i])), resources)
        if target_end < int(cfg['maturity_year']):
            terminal_eligible = float(eligible[-1])
            terminal_available = (
                float(available[-1])
                - float((result.get('exogenous_injection_cash') or [0.0])[-1] or 0.0)
                - float((result.get('custom_cash') or [0.0])[-1] or 0.0))
            terminal_stock = float((result.get('funded_asset_stock') or [0.0])[-1] or 0.0)
            terminal_replacement = terminal_stock / max(1.0, float(asset_life))
            tail_resources = max(0.0, terminal_available - terminal_replacement)
            tail_capacity = share * min(max(0.0, terminal_eligible), tail_resources)
            for year in range(target_end + 1, int(cfg['maturity_year']) + 1):
                capacities[year] = tail_capacity
        return capacities

    capacities = capacity_map(reference)
    upper = schedule_unit_capacity(cfg, capacities)
    if cfg.get('loan_ceiling') is not None:
        upper = min(upper, float(cfg['loan_ceiling']))
    if not math.isfinite(upper) or upper <= 1e-10:
        return reference, zero_plan, summary(
            'no positive capacity', reference, requested_max=max(0.0, upper),
            capacities=capacities), reference

    requested_max = upper
    principal = upper
    accepted = None
    accepted_plan = None
    accepted_caps = None
    for _ in range(80):
        plan = execution_plan(principal, cfg, years)
        candidate_kwargs = {**kwargs, 'utility_debt_execution': plan}
        candidate = calc_fn(inputs, ctx, **candidate_kwargs)
        candidate_caps = capacity_map(candidate)
        debt_rows = plan['schedule']
        shortfalls = [
            max(0.0, float(row['total_debt_service'])
                - float(candidate_caps.get(int(row['year']), 0.0)))
            for row in debt_rows
        ]
        tolerance = max(1e-7, principal * 1e-9)
        if max(shortfalls, default=0.0) <= tolerance:
            accepted, accepted_plan, accepted_caps = candidate, plan, candidate_caps
            break
        ratios = [
            float(candidate_caps.get(int(row['year']), 0.0)) / float(row['total_debt_service'])
            for row in debt_rows if float(row['total_debt_service']) > 1e-15
        ]
        scale = min(ratios, default=0.0)
        if scale <= 0.0:
            principal = 0.0
            break
        principal *= min(0.999999999, scale)
        if principal <= 1e-10:
            principal = 0.0
            break

    if accepted is None:
        return reference, zero_plan, summary(
            'no verified feasible loan', reference, requested_max=requested_max,
            capacities=capacities), reference
    output = summary(
        'verified feasible', accepted, principal=principal,
        requested_max=requested_max, verified=True, capacities=accepted_caps,
        schedule=accepted_plan['schedule'])
    accepted['utility_debt'] = output
    return accepted, accepted_plan, output, reference