"""Expansion balances are households; money is repriced, never carried as new work.

The two transitions are Basic -> SM and Lower -> Basic, in that order.
SM + Basic (not exclusive Basic) defines demand for the second transition.
Amounts use the engine's millions convention.
"""
import numpy as np


class ExpansionLedger:
    def __init__(self, opening_sm, opening_basic, n):
        self.base = np.array([opening_sm, opening_sm + opening_basic])
        self.required = np.zeros(2)
        self.delivered = np.zeros(2)
        self.outstanding = np.zeros(2)
        self.ancillary_committed = False
        self.ancillary = np.zeros(2)
        self.shortfalls = np.zeros(2)
        # Parallel reporting counters only. Keep the legacy combined accumulator
        # and all model calculations unchanged, including their arithmetic order.
        self.replacement_shortfalls = np.zeros(2)
        self.cash_shortfalls = np.zeros(2)
        self.last_costs = None
        self.series = {key: np.zeros((2, n)) for key in (
            'opening_outstanding_hh', 'planned_expansion_hh', 'cancelled_expansion_hh',
            'delivered_sector_hh', 'delivered_external_hh', 'delivered_physical_hh',
            'closing_outstanding_hh', 'advance_delivery_hh',
            'endline_financing_requirement_by_service',
            'ancillary_paid_by_service',
            'annual_planned_expansion_cost_by_service',
            'prefunding_expansion_cost_by_service',
            'closing_outstanding_expansion_by_service',
            'accumulated_shortfalls_by_service',
            'sector_funded_expansion_by_service',
            'externally_funded_expansion_by_service',
            'scheduled_household_expansion_by_service',
            'prefunding_household_expansion_by_service',
            'closing_household_expansion_by_service',
            'prefunding_ancillary_by_service',
            'closing_ancillary_by_service',
            'current_unpaid_replacement_by_service',
            'prior_replacement_shortfall_by_service',
            'accumulated_replacement_shortfall_by_service',
            'current_cash_shortfall_by_service',
            'prior_cash_shortfall_by_service',
            'accumulated_cash_shortfall_by_service',
            'household_expansion_paid_by_service',
            'sector_household_expansion_paid_by_service',
            'noncash_delivery_hh_by_service',
            'noncash_delivery_credit_by_service',
            'cancelled_household_expansion_cost_by_service',
            'outstanding_repricing_by_service',
            'opening_household_expansion_cost_by_service',
            'advance_delivery_credit_by_service',
            'new_ancillary_commitment_by_service',
        )}
        self.series.update({key: np.zeros(n) for key in (
            'annual_planned_expansion_cost', 'catch_up_requirement',
            'closing_outstanding_expansion', 'endline_financing_requirement',
            'funded_asset_stock', 'sector_funded_expansion', 'externally_funded_expansion',
            'ancillary_outstanding', 'ancillary_paid', 'capital_credited_to_due_expansion',
        )})

    def step(self, t, target, costs, sector, external, physical, *,
             replacement, unpaid_by_service, deficit_by_service,
             ancillary_cost, spare_capital, asset_stock, sector_capital, external_capital):
        required = np.maximum(np.array([target[0], sum(target[:2])]) - self.base, 0)
        planned = np.maximum(required - self.required, 0)
        reductions = np.maximum(self.required - required, 0)
        opening = self.outstanding.copy()
        due = np.maximum(required - self.delivered, 0)
        # A reduction first cancels unmet work; already delivered assets remain.
        cancelled = np.minimum(opening, reductions)
        costs = np.asarray(costs)
        new_ancillary = 0.0
        if not self.ancillary_committed and (np.any(planned > 0) or np.any(np.asarray(sector) > 0)):
            self.ancillary_committed = True
            new_ancillary = max(0.0, ancillary_cost)
            weights = planned * costs
            if not weights.sum():
                weights = np.asarray(sector) * costs
            if weights.sum():
                self.ancillary = new_ancillary * weights / weights.sum()
        # Reporting snapshots preserve pre-funding need and actual service purchases.
        # They do not feed back into delivery, funding allocation or gap accounting.
        planned_cost_by_service = planned * costs + (self.ancillary.copy() if new_ancillary else 0)
        prefunding_cost_by_service = due * costs + self.ancillary.copy()
        prefunding_ancillary = self.ancillary.copy()
        prior_replacement = self.replacement_shortfalls.copy()
        prior_cash = self.cash_shortfalls.copy()
        catch_up = float(prefunding_cost_by_service.sum() + replacement)
        delivered = np.asarray(sector) + np.asarray(external) + np.asarray(physical)
        # Only actual capital purchases receive a capital credit; physical reuse is not cash.
        physical_credit = np.minimum(due, physical)
        sector_credit = np.minimum(np.maximum(due - physical_credit, 0), sector)
        self.delivered += delivered
        self.outstanding = np.maximum(required - self.delivered, 0)
        paid = min(max(0.0, spare_capital), self.ancillary.sum())
        paid_by_service = self.ancillary * paid / self.ancillary.sum() if self.ancillary.sum() > 0 else np.zeros(2)
        if self.ancillary.sum() > 0:
            self.ancillary *= 1 - paid / self.ancillary.sum()
        closing_by_service = self.outstanding * costs + self.ancillary
        self.shortfalls += np.asarray(unpaid_by_service) + np.asarray(deficit_by_service)
        self.replacement_shortfalls += np.asarray(unpaid_by_service)
        self.cash_shortfalls += np.asarray(deficit_by_service)
        endline = closing_by_service + self.shortfalls
        sector_weights = np.asarray(sector) * costs
        external_weights = np.asarray(external) * costs
        sector_purchases = (
            sector_weights * sector_capital / sector_weights.sum()
            if sector_weights.sum() > 0 else np.zeros(2))
        external_purchases = (
            external_weights * external_capital / external_weights.sum()
            if external_weights.sum() > 0 else np.zeros(2))
        values = {
            'opening_outstanding_hh': opening, 'planned_expansion_hh': planned,
            'cancelled_expansion_hh': cancelled, 'delivered_sector_hh': sector,
            'delivered_external_hh': external, 'delivered_physical_hh': physical,
            'closing_outstanding_hh': self.outstanding,
            'advance_delivery_hh': np.maximum(self.delivered - required, 0),
            'endline_financing_requirement_by_service': endline,
            'annual_planned_expansion_cost': float(planned @ costs + new_ancillary),
            'catch_up_requirement': catch_up,
            'closing_outstanding_expansion': float(closing_by_service.sum()),
            'endline_financing_requirement': float(endline.sum()),
            'funded_asset_stock': asset_stock + paid,
            'sector_funded_expansion': sector_capital + paid,
            'externally_funded_expansion': external_capital,
            'ancillary_outstanding': float(self.ancillary.sum()),
            'ancillary_paid': paid,
            'ancillary_paid_by_service': paid_by_service,
            'capital_credited_to_due_expansion': float(sector_credit @ costs + paid),
            'annual_planned_expansion_cost_by_service': planned_cost_by_service,
            'prefunding_expansion_cost_by_service': prefunding_cost_by_service,
            'closing_outstanding_expansion_by_service': closing_by_service,
            'accumulated_shortfalls_by_service': self.shortfalls.copy(),
            'sector_funded_expansion_by_service': sector_purchases + paid_by_service,
            'externally_funded_expansion_by_service': external_purchases,
            'scheduled_household_expansion_by_service': planned * costs,
            'prefunding_household_expansion_by_service': due * costs,
            'closing_household_expansion_by_service': self.outstanding * costs,
            'prefunding_ancillary_by_service': prefunding_ancillary,
            'closing_ancillary_by_service': self.ancillary.copy(),
            'current_unpaid_replacement_by_service': np.asarray(unpaid_by_service),
            'prior_replacement_shortfall_by_service': prior_replacement,
            'accumulated_replacement_shortfall_by_service': self.replacement_shortfalls.copy(),
            'current_cash_shortfall_by_service': np.asarray(deficit_by_service),
            'prior_cash_shortfall_by_service': prior_cash,
            'accumulated_cash_shortfall_by_service': self.cash_shortfalls.copy(),
            'household_expansion_paid_by_service': sector_purchases + external_purchases,
            'sector_household_expansion_paid_by_service': sector_purchases,
            'noncash_delivery_hh_by_service': np.asarray(physical),
            'noncash_delivery_credit_by_service': physical_credit * costs,
            'cancelled_household_expansion_cost_by_service': cancelled * costs,
            'outstanding_repricing_by_service': (
                opening * (costs - self.last_costs) if self.last_costs is not None else np.zeros(2)),
            'opening_household_expansion_cost_by_service': (
                opening * (self.last_costs if self.last_costs is not None else costs)),
            'advance_delivery_credit_by_service': np.maximum(opening + planned - cancelled - due, 0) * costs,
            'new_ancillary_commitment_by_service': prefunding_ancillary.copy() if new_ancillary else np.zeros(2),
        }
        for key, value in values.items():
            self.series[key][..., t] = value
        self.required = required
        self.last_costs = costs.copy()
        return closing_by_service, paid

    def result(self):
        return {key: value.tolist() for key, value in self.series.items()}