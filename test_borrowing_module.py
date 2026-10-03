"""Cash allocation, fixed contracts, conversion and separate borrowing pools."""
import copy
import unittest

import numpy as np

from deck_aggregate import aggregate
from demo_adapter import coerce_to_engine, frontend_defaults
from model.engine import calculate
from model.finance import funding_ledger, loan_schedule


class BorrowingModuleTests(unittest.TestCase):
    def schedule(self, **options):
        args = dict(enabled=True, drawdown_year=2026, interest_rate=0,
                    term_years=2, minimum_dscr=1.2)
        args.update(options)
        return loan_schedule([2025, 2026, 2027, 2028], 0,
                             [0, 500, 500, 500], [0]*4, [0]*4,
                             [0, 60, 60, 60], args.pop('alpha', 1), **args)

    def test_allocation_modes_and_signed_cash_conservation(self):
        for alpha in (0, .4, 1):
            loan = self.schedule(alpha=alpha)
            s = loan['schedule']
            reserve_open = 0
            for i in range(4):
                self.assertAlmostEqual([0, 60, 60, 60][i],
                    s['cash_allocated_to_direct_investment'][i] +
                    s['cash_committed_to_debt'][i] - s['reserve_release'][i])
                self.assertAlmostEqual(reserve_open + s['cash_committed_to_debt'][i],
                    s['retained_cash_reserve'][i] + s['debt_service_paid'][i] +
                    s['reserve_release'][i])
                reserve_open = s['retained_cash_reserve'][i]
            if alpha == 0:
                self.assertEqual(loan['loan_principal'], 0)

    def test_prior_obligations_are_deducted_before_alpha(self):
        loan = self.schedule(alpha=.5, existing_debt_service=20)
        self.assertEqual(loan['eligible_net_cash'][1], 40)
        self.assertEqual(loan['cash_committed_to_debt'][1], 20)
        self.assertEqual(loan['cash_allocated_to_direct_investment'][1], 20)
        self.assertAlmostEqual(loan['loan_principal'], 20 / 1.2 * 2)

    def test_nominal_payments_fixed_real_reporting_deflated_and_full_maturity(self):
        loan = self.schedule(term_years=7, interest_rate=.08, price_index=[1, 1.1, 1.21, 1.331],
                             inflation_rate=.1, rate_basis='nominal')
        s = loan['schedule']
        self.assertEqual(s['years'][-1], 2033)
        self.assertGreater(loan['outstanding_at_projection_end'], 0)
        payments = s['nominal_debt_service'][2:]
        np.testing.assert_allclose(payments, payments[0], atol=1e-8)
        self.assertGreater(s['debt_service'][2], s['debt_service'][-1])
        self.assertAlmostEqual(s['closing_debt'][-1], 0, places=8)
        self.assertAlmostEqual(s['debt_service'][2] * 1.21, payments[0])

    def test_repayment_terms_not_hard_coded_and_zero_interest(self):
        for term in (1, 3, 12):
            loan = self.schedule(term_years=term)
            self.assertEqual(loan['loan_end_year'], 2026 + term)
            self.assertAlmostEqual(loan['loan_principal'], 50 * term)
            self.assertAlmostEqual(sum(loan['schedule']['interest']), 0)

    def test_fixed_contract_cash_shortfall_does_not_reduce_scheduled_payment(self):
        loan = self.schedule(contracted_principal=120, actual_cash=[0, 0, 0, -10])
        s = loan['schedule']
        self.assertEqual(loan['loan_principal'], 120)
        self.assertEqual(s['debt_service'][2:], [60, 60])
        self.assertEqual(s['debt_service_shortfall'][2:], [60, 60])
        self.assertEqual(s['closing_debt'][-1], 120)
        self.assertEqual(s['cash_allocated_to_direct_investment'][-1], -10)
        self.assertEqual(sum(s['reserve_release']), 0)

    def test_reserve_use_is_explicit_when_realised_cash_falls(self):
        loan = self.schedule(contracted_principal=120, actual_cash=[0, 60, 0, 0])
        self.assertEqual(loan['reserve_used'][2], 60)
        self.assertEqual(loan['debt_service_shortfall'][2], 0)
        self.assertEqual(loan['debt_service_shortfall'][3], 60)

    def test_ceiling_and_remaining_need_cap_new_principal(self):
        self.assertEqual(self.schedule(borrowing_ceiling=7)['loan_principal'], 7)
        loan = loan_schedule([2025, 2026, 2027], 0, [0, 5, 0],
                             [0]*3, [0]*3, [0, 100, 100], 1,
                             enabled=True, drawdown_year=2026, term_years=10)
        self.assertEqual(loan['loan_principal'], 5)
        funded = loan_schedule([2025, 2026, 2027], 0, [0, 5, 0],
                             [0, 5, 0], [0]*3, [0, 100, 100], 1,
                             enabled=True, drawdown_year=2026, term_years=10)
        self.assertEqual(funded['loan_principal'], 0)
        self.assertEqual(sum(funded['cash_committed_to_debt']), 0)

    def test_negative_cash_not_removed_by_eligibility_clamp(self):
        loan = loan_schedule([2025, 2026, 2027], 0, [0, 100, 100],
                             [0]*3, [0]*3, [0, -20, -30], 1,
                             enabled=True, drawdown_year=2026, term_years=2)
        self.assertEqual(loan['loan_principal'], 0)
        np.testing.assert_allclose(loan['cash_allocated_to_direct_investment'], [0, -20, -30])

    def test_operating_deficit_does_not_expand_eligible_investment_need(self):
        loan = loan_schedule([2025, 2026, 2027, 2028], 0, [0, 100, 0, 0],
                             [0]*4, [0]*4, [0, -50, 120, 120], 1,
                             enabled=True, drawdown_year=2026, term_years=2)
        self.assertEqual(loan['loan_principal'], 100)
        self.assertEqual(loan['cash_allocated_to_direct_investment'][1], -50)

    def model_inputs(self):
        inputs = frontend_defaults()
        inputs['macro'].update(ws_budget_pct_gdp=0, budget_input_mode='pct_gdp', budget_source='pct_gdp')
        inputs['toggles'].update(ws_tariff_enabled=True, ws_borrowing_enabled=True)
        inputs['water_interventions'].update(tariff_start_year=2026, tariff_target_year=2026,
            tariff_target=150, cash_allocation_alpha=1, borrow_drawdown_year=2026,
            borrow_term_years=20, borrow_ceiling=100000, borrow_rate_basis='real')
        return inputs

    def run_model(self, inputs):
        return calculate(coerce_to_engine(inputs))

    def test_loan_and_debt_allocations_drive_physical_coverage(self):
        inputs = self.model_inputs()
        inputs['water_interventions']['cash_allocation_alpha'] = 0
        reinvest = self.run_model(inputs)['water_supply']
        inputs['water_interventions']['cash_allocation_alpha'] = 1
        borrowed = self.run_model(inputs)['water_supply']
        self.assertGreater(borrowed['scenario_loan_principal'], 0)
        self.assertFalse(np.allclose(borrowed['scenario_hh'], reinvest['scenario_hh']))
        self.assertEqual(sum(borrowed['scenario_cash_committed_to_debt']) > 0, True)
        np.testing.assert_allclose(borrowed['bau_hh'], reinvest['bau_hh'])

    def test_bau_invariant_to_borrowing_inputs_and_contracts(self):
        inputs = self.model_inputs()
        first = self.run_model(inputs)
        inputs['water_interventions'].update(existing_debt_service=100,
                                             borrow_contract_principal=5000)
        changed = self.run_model(inputs)
        np.testing.assert_allclose(first['water_supply']['bau_hh'], changed['water_supply']['bau_hh'])
        np.testing.assert_allclose(first['water_supply']['financing_gap'], changed['water_supply']['financing_gap'])

    def test_stream_selection_and_negative_omitted_effects(self):
        inputs = self.model_inputs()
        inputs['water_interventions']['borrow_cash_streams'] = []
        result = self.run_model(inputs)['water_supply']
        self.assertEqual(result['scenario_loan_principal'], 0)
        np.testing.assert_allclose(result['scenario_cash_allocated_to_direct_investment'],
                                   result['scenario_additional_net_utility_cash'])
        inputs['toggles']['ws_nrw_enabled'] = True
        inputs['water_interventions'].update(borrow_cash_streams=['tariff'], nrw_maintenance_cost_annual=1e11)
        result = self.run_model(inputs)['water_supply']
        self.assertLess(min(result['scenario_eligible_net_cash']), 0)
        self.assertEqual(result['scenario_loan_principal'], 0)
        self.assertLess(min(result['scenario_cash_allocated_to_direct_investment']), 0)

    def test_sectors_and_area_pools_not_implicitly_combined_in_aggregate(self):
        inputs = self.model_inputs()
        inputs['water_interventions']['borrow_entity_name'] = 'Same display name'
        one = self.run_model(inputs)
        other_inputs = copy.deepcopy(inputs)
        other_inputs['country_config']['area'] = 'Other area'
        two = self.run_model(other_inputs)
        national = aggregate([one, two])
        pools = national['water_supply']['scenario_borrowing_pools']
        self.assertEqual(len(pools), 2)
        self.assertNotEqual(pools[0]['area'], pools[1]['area'])
        self.assertEqual(len(national['sanitation']['scenario_borrowing_pools']), 2)
        np.testing.assert_allclose(national['water_supply']['scenario_loan_drawdown'],
            np.asarray(one['water_supply']['scenario_loan_drawdown']) + two['water_supply']['scenario_loan_drawdown'])
        self.assertTrue(all('conditional on baseline' in p['capacity_label'] for p in pools))
        self.assertEqual(national['water_supply']['scenario_loan_end_year'],
                         one['water_supply']['scenario_loan_end_year'])

    def test_price_conversion_not_disabled_by_real_gdp_entry(self):
        inputs = self.model_inputs()
        inputs['water_interventions'].update(borrow_rate_basis='nominal')
        inputs['macro'].update(inflation_local=[.1]*20, inflation_local_ongoing=.1)
        result = self.run_model(inputs)['water_supply']
        s = result['scenario_borrowing_pools'][0]['schedule']
        first = next(i for i, year in enumerate(s['years']) if year == 2027)
        self.assertNotAlmostEqual(s['nominal_debt_service'][first], s['debt_service'][first])
        self.assertAlmostEqual(s['nominal_debt_service'][first], s['nominal_debt_service'][first+1])

    def test_no_recursive_operating_revenue_from_loan_financed_households(self):
        inputs = self.model_inputs()
        first = self.run_model(inputs)['water_supply']
        inputs['water_interventions']['borrow_ceiling'] = 1
        second = self.run_model(inputs)['water_supply']
        np.testing.assert_allclose(first['scenario_additional_net_utility_cash'],
                                   second['scenario_additional_net_utility_cash'])

    def test_invalid_settings_fail_explicitly(self):
        for options in ({'alpha': 1.1}, {'interest_rate': -1}, {'term_years': 0},
                        {'minimum_dscr': .5}, {'rate_basis': 'unknown'}):
            with self.subTest(options=options), self.assertRaises(ValueError):
                self.schedule(**options)


if __name__ == '__main__':
    unittest.main()