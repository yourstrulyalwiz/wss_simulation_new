"""Baseline total-spending reference shown beside the financial commitment target."""

import copy
import unittest

from demo_adapter import coerce_to_engine, frontend_defaults
from model.engine import calculate


class BaselineSpendingShareTests(unittest.TestCase):
    def test_matches_commitment_base_for_both_sectors(self):
        inputs = frontend_defaults()
        result = calculate(coerce_to_engine(inputs))
        for sector, field in (
            ('water_supply', 'ws_budget_pct_gdp'),
            ('sanitation', 'san_budget_pct_gdp'),
        ):
            with self.subTest(sector=sector):
                self.assertAlmostEqual(
                    result[sector]['baseline_bau_total_spending_share'],
                    inputs['macro'][field])

        with_levers = copy.deepcopy(inputs)
        with_levers['toggles']['ws_financial_commitment_enabled'] = True
        with_levers['toggles']['ws_exogenous_injection_enabled'] = True
        with_levers['water_interventions'].update(
            fin_gdp_enabled=True, fin_gdp_target_share=0.05,
            fin_injection_amount=1000, fin_injection_start_year=2028)
        scenario = calculate(coerce_to_engine(with_levers))
        for sector in ('water_supply', 'sanitation'):
            self.assertEqual(
                scenario[sector]['baseline_bau_total_spending_share'],
                result[sector]['baseline_bau_total_spending_share'])

    def test_direct_budget_uses_baseline_total_expenditure_not_capex(self):
        inputs = frontend_defaults()
        inputs['macro']['budget_input_mode'] = 'direct'
        inputs['macro']['budget_source'] = 'direct'
        inputs['bau']['budget_input_mode'] = 'direct'
        inputs['bau']['budget_source'] = 'direct'
        baseline_index = inputs['period']['baseline_year'] - inputs['period']['model_start_year']
        water_budget = [1000.0] * (baseline_index + 1)
        sanitation_budget = [500.0] * (baseline_index + 1)
        inputs['bau']['ws_expend_ts'] = water_budget
        inputs['bau']['san_expend_ts'] = sanitation_budget
        result = calculate(coerce_to_engine(inputs))
        baseline_gdp = result['gdp_real_local'][baseline_index]
        self.assertGreater(baseline_gdp, 0)
        self.assertAlmostEqual(
            result['water_supply']['baseline_bau_total_spending_share'],
            water_budget[-1] / baseline_gdp)
        self.assertAlmostEqual(
            result['sanitation']['baseline_bau_total_spending_share'],
            sanitation_budget[-1] / baseline_gdp)


if __name__ == '__main__':
    unittest.main()