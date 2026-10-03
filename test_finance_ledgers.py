import unittest

import numpy as np

from model.finance import (
    annual_asset_requirements,
    funding_ledger,
    loan_schedule,
    tariff_collection_cash,
    target_transition_capex,
)


class FinanceLedgerTests(unittest.TestCase):
    def test_financing_gap_is_need_less_available_financing(self):
        ledger = funding_ledger(
            [0, 100], [0, 40], [0, 0], [0, 0], baseline_index=0)
        self.assertEqual(ledger['gap'][1], 60)
        self.assertNotEqual(ledger['gap'][1], 20)
        self.assertEqual(ledger['financing_applied'][1], 40)
        self.assertEqual(ledger['cumulative_gap'][-1], 60)

    def test_target_replacement_uses_opening_assets_and_expansion_once(self):
        programme = target_transition_capex(
            target_sm=[100, 104, 108, 112, 116, 120], target_basic=[0]*6,
            cost_sm=[1]*6, cost_basic=[1]*6,
            nonhousehold_multiplier=0, baseline_index=0)
        expansion = programme['expansion']
        np.testing.assert_allclose(expansion[1:], [4, 4, 4, 4, 4])
        by_service = np.vstack([expansion, np.zeros_like(expansion)])
        assets = annual_asset_requirements(
            expansion, opening_assets=100, replacement_rate=0.10,
            baseline_index=0, expansion_by_service=by_service,
            opening_assets_by_service=[100, 0])

        np.testing.assert_allclose(
            assets['replacement'][1:], [10, 10.4, 10.8, 11.2, 11.6])
        self.assertAlmostEqual(assets['target_asset_stock'][-1], 120)
        np.testing.assert_allclose(assets['target_asset_stock'], [100, 104, 108, 112, 116, 120])
        np.testing.assert_allclose(assets['total_need'][1:], [14, 14.4, 14.8, 15.2, 15.6])
        self.assertAlmostEqual(assets['total_need'].sum(), 74)

        ledger = funding_ledger(
            assets['total_need'], [0, 10, 10, 10, 10, 10],
            np.zeros(6), np.zeros(6), baseline_index=0)
        self.assertAlmostEqual(ledger['gap'].sum(), 24)
        self.assertAlmostEqual(ledger['cumulative_gap'][-1], 24)
        # Financing is not an input to the hypothetical target asset schedule:
        # unmet expansion cannot be added again to next year's opening assets.
        unfunded = funding_ledger(assets['total_need'], np.zeros(6), np.zeros(6),
                                  np.zeros(6), baseline_index=0)
        self.assertAlmostEqual(unfunded['cumulative_gap'][-1], 74)
        np.testing.assert_allclose(assets['target_asset_stock'], [100, 104, 108, 112, 116, 120])

    def test_tariff_and_collection_cash_reconcile_jointly(self):
        collection, tariff = tariff_collection_cash(
            [100], current_tariff=10, tariff_path=[12],
            current_collection=0.80, collection_path=[0.90],
            tariff_enabled=True, collection_enabled=True)
        self.assertAlmostEqual(collection[0], 100)
        self.assertAlmostEqual(tariff[0], 180)
        self.assertAlmostEqual(collection[0] + tariff[0], 280)

    def test_basic_to_sm_transition_is_incremental_upgrade_cost(self):
        program = target_transition_capex(
            target_sm=[10, 12], target_basic=[5, 3],
            cost_sm=[100, 100], cost_basic=[60, 60],
            nonhousehold_multiplier=0.20, baseline_index=0)
        self.assertEqual(program['sm_upgrades'][1], 2)
        self.assertEqual(program['new_sm_connections'][1], 0)
        self.assertEqual(program['new_basic_connections'][1], 0)
        self.assertAlmostEqual(program['expansion'][1], 96)

    def test_reinvest_all_and_borrowing_allocation(self):
        years = [2025, 2026, 2027, 2028]
        required = [0, 100, 0, 0]
        public = [0, 0, 0, 0]
        other = [0, 0, 0, 0]
        cash = [0, 60, 60, 60]

        reinvest = loan_schedule(
            years, 0, required, public, other, cash, 0.0,
            enabled=True, drawdown_year=2026, interest_rate=0.0,
            term_years=2, minimum_dscr=1.2)
        self.assertEqual(reinvest['loan_principal'], 0)
        np.testing.assert_allclose(reinvest['cash_allocated_to_direct_investment'], cash)

        borrow = loan_schedule(
            years, 0, required, public, other, cash, 1.0,
            enabled=True, drawdown_year=2026, interest_rate=0.0,
            term_years=2, minimum_dscr=1.2)
        self.assertAlmostEqual(borrow['loan_principal'], 100)
        self.assertAlmostEqual(borrow['drawdowns'][1], 100)
        self.assertAlmostEqual(borrow['debt_service'][2], 50)
        self.assertAlmostEqual(borrow['closing_debt'][-1], 0)
        self.assertAlmostEqual(borrow['cash_allocated_to_direct_investment'][-1], 80)
        self.assertAlmostEqual(sum(borrow['debt_service_shortfall']), 0)


if __name__ == '__main__':
    unittest.main()