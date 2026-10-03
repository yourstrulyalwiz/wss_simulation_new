"""One explicitly separate borrowing pool, with contractual debt and reserve accounting."""
import numpy as np


def schedule_loan(years, baseline_index, required, public_capital, other_capital, eligible_cash,
                  allocation_alpha, *, enabled=False, drawdown_year=0, interest_rate=0.0,
                  term_years=0, minimum_dscr=1.0, borrowing_ceiling=0.0,
                  existing_debt_service=0.0, direct_cash_available=None,
                  total_cash=None, actual_cash=None, price_index=None, inflation_rate=0.0,
                  rate_basis="real", contracted_principal=0.0):
    """Amounts are real reporting-currency millions unless explicitly named nominal.

    Selected streams size the loan. Unselected signed cash remains in direct investment.
    Prior debt is deducted before alpha. Committed cash is retained, used only for debt
    service, and released at maturity only after current and overdue loan obligations.
    Post-horizon cash/obligations are flat in real terms; inflation is held at its last rate.
    Fixed contracts are not resized when cash forecasts change.
    """
    from model.finance import funding_ledger, annuity_present_value_factor

    years = np.asarray(years, dtype=int)
    n = len(years)
    if not n:
        raise ValueError("A borrowing schedule requires projection years.")
    alpha = float(allocation_alpha)
    rate, dscr = float(interest_rate), float(minimum_dscr)
    existing, ceiling = float(existing_debt_service), float(borrowing_ceiling)
    fixed = float(contracted_principal)
    if (not np.all(np.isfinite([alpha, rate, dscr, existing, ceiling, fixed, inflation_rate]))
            or not 0 <= alpha <= 1 or rate < 0 or dscr < 1
            or min(existing, ceiling, fixed) < 0 or inflation_rate <= -1):
        raise ValueError("Invalid borrowing inputs: alpha 0–1, nonnegative amounts/rate, DSCR ≥ 1.")
    if rate_basis not in ("real", "nominal"):
        raise ValueError("Borrowing rate basis must be real or nominal.")

    def series(values):
        arr = np.asarray(values, dtype=float)
        if arr.shape != (n,) or not np.all(np.isfinite(arr)):
            raise ValueError("Borrowing cash and requirement schedules must match projection years.")
        return arr

    cash = series(eligible_cash)
    total = cash if total_cash is None else series(total_cash)
    realised = cash if actual_cash is None else series(actual_cash)
    prices = np.ones(n) if price_index is None else series(price_index)
    if np.any(prices <= 0):
        raise ValueError("Borrowing price indexes must be positive.")
    draw, term = int(drawdown_year), int(term_years)
    draw_idx = next((i for i, y in enumerate(years) if y == draw), None)
    active = enabled and draw_idx is not None and draw_idx > baseline_index and term > 0
    if enabled and (draw_idx is None or draw_idx <= baseline_index or term <= 0):
        raise ValueError("Loan drawdown must be a forecast year and repayment term must be positive.")
    end = draw + term if active else int(years[-1])
    full_years = np.arange(years[0], max(int(years[-1]), end) + 1)
    if not np.array_equal(years, full_years[:n]):
        raise ValueError("Borrowing requires consecutive annual projection years.")
    m = len(full_years)

    def extend(arr):
        return np.concatenate([arr, np.full(m - n, arr[-1])])

    full_prices = np.concatenate([
        prices, prices[-1] * (1 + inflation_rate) ** np.arange(1, m - n + 1)])
    # A real-rate schedule uses real amounts throughout. A nominal schedule converts
    # BOTH the committed cash and the principal to the same nominal-year currency.
    factor = full_prices if rate_basis == "nominal" else np.ones(m)
    net = extend(cash) - existing
    realised_net = extend(realised) - existing
    prior = np.where(full_years > years[baseline_index], existing, 0.0)
    net[full_years <= years[baseline_index]] = 0
    realised_net[full_years <= years[baseline_index]] = 0
    proposed = np.where((full_years >= draw) & (full_years <= end),
                        alpha * np.maximum(0, net), 0) if active else np.zeros(m)
    direct_for_need = (total - prior[:n] - proposed[:n] if direct_cash_available is None
                       else series(direct_cash_available))
    ledger = funding_ledger(series(required), series(public_capital), series(other_capital),
                            direct_for_need, baseline_index=baseline_index)
    # Negative operating cash can make a financing gap exceed that year's capital
    # requirement. It must remain visible, but cannot expand the loan's eligible
    # investment requirement into an operating-deficit financing allowance.
    need = (float(np.sum(np.minimum(series(required), ledger["gap"])[draw_idx:]))
            if active else 0.0)
    capacity = 0.0
    if active and alpha > 0:
        annual_capacity = min(proposed[i] * factor[i] / dscr
                              for i in range(draw_idx + 1, draw_idx + term + 1))
        capacity = annual_capacity * annuity_present_value_factor(rate, term) / factor[draw_idx]
        if ceiling > 0:
            capacity = min(capacity, ceiling)
    automatic = max(0, min(capacity, need))
    principal = fixed if active and fixed > 0 else automatic
    # Do not withhold cash for an undrawn, zero-capacity proposal.
    committed = np.where((full_years >= draw) & (full_years <= end),
                         alpha * np.maximum(0, realised_net), 0) if principal > 0 else np.zeros(m)
    direct = extend(total) + extend(realised - cash) - prior - committed
    direct[full_years <= years[baseline_index]] = total[:baseline_index + 1]
    fields = ("drawdowns", "opening_debt", "closing_debt", "interest", "principal",
              "debt_service", "debt_service_paid", "retained_cash_reserve", "reserve_used",
              "reserve_release", "debt_service_shortfall", "scheduled_principal",
              "nominal_debt_service", "nominal_closing_debt")
    full = {key: np.zeros(m) for key in fields}
    full.update(years=full_years, cash_committed_to_debt=committed,
                cash_allocated_to_direct_investment=direct, eligible_net_cash=realised_net,
                existing_debt_service_paid=prior)
    balance = planned_balance = reserve = arrears = 0.0
    payment = (principal * factor[draw_idx] / annuity_present_value_factor(rate, term)
               if principal > 0 else 0.0)
    for i, year in enumerate(full_years):
        f = factor[i]
        full["opening_debt"][i] = balance / f
        if principal > 0 and year == draw:
            balance = planned_balance = principal * f
            full["drawdowns"][i] = principal
            reserve += committed[i] * f
        elif principal > 0 and draw < year <= end:
            old_reserve = reserve
            current = committed[i] * f
            interest = balance * rate
            scheduled_interest = planned_balance * rate
            due = min(payment, planned_balance + scheduled_interest)
            planned_balance = max(0, planned_balance + scheduled_interest - due)
            # Repayment arrears are explicitly due in addition to THIS year's fixed payment.
            # Unpaid interest accrues in debt; no automatic refinancing or smaller contract.
            obligations = due + arrears
            paid = min(obligations, reserve + current)
            reserve = max(0, reserve + current - paid)
            arrears = max(0, obligations - paid)
            principal_paid = max(0, min(balance, paid - interest))
            balance = max(0, balance + interest - paid)
            full["interest"][i] = interest / f
            full["principal"][i] = principal_paid / f
            full["scheduled_principal"][i] = max(0, due - scheduled_interest) / f
            full["debt_service"][i] = due / f
            full["nominal_debt_service"][i] = due if rate_basis == "nominal" else due * full_prices[i]
            full["debt_service_paid"][i] = paid / f
            full["reserve_used"][i] = min(old_reserve, max(0, paid - current)) / f
            full["debt_service_shortfall"][i] = max(0, due - max(0, paid - (obligations - due))) / f
            if year == end:
                # Any remaining debt is due at maturity before reserves can be released.
                catch_up = min(reserve, balance)
                full["debt_service_paid"][i] += catch_up / f
                full["principal"][i] = max(0, min(
                    full["opening_debt"][i], full["debt_service_paid"][i] - interest / f))
                full["debt_service_shortfall"][i] = max(
                    0, full["debt_service_shortfall"][i] - catch_up / f)
                balance -= catch_up
                reserve -= catch_up
                arrears = max(0, arrears - catch_up)
                if balance <= 1e-8:
                    full["reserve_release"][i] = reserve / f
                    direct[i] += reserve / f
                    reserve = 0
        elif principal > 0 and year > end:
            # Overdue debt remains visible; no automatic loan rollover.
            pass
        full["closing_debt"][i] = balance / f
        full["nominal_closing_debt"][i] = balance if rate_basis == "nominal" else balance * full_prices[i]
        full["retained_cash_reserve"][i] = reserve / f

    result = {key: values[:n].copy() for key, values in full.items() if key != "years"}
    result.update(loan_principal=float(principal), automatic_capacity=float(automatic),
                  is_fixed_contract=bool(active and fixed > 0),
                  loan_end_year=end if principal > 0 else None,
                  outstanding_at_projection_end=float(full["closing_debt"][n - 1]),
                  schedule={key: values.tolist() for key, values in full.items()})
    return result