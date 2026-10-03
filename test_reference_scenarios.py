"""Reproducible historical accounting and current borrowing references."""
import json
from pathlib import Path
import unittest
import numpy as np

from demo_adapter import coerce_to_engine
from model.engine import calculate
from tools.capture_financing_references import extract


class CapturedReferenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.capture = json.loads((Path(__file__).parent / 'validation' /
                                  'financing_reference_scenarios.json').read_text())

    def assert_metrics_equal(self, actual, expected):
        self.assertEqual(actual['forecast_years'], expected['forecast_years'])
        for sector in ('water_supply', 'sanitation'):
            for key, value in expected['sectors'][sector].items():
                with self.subTest(sector=sector, metric=key):
                    if value is None:
                        self.assertIsNone(actual['sectors'][sector][key])
                    else:
                        np.testing.assert_allclose(actual['sectors'][sector][key], value,
                                                   rtol=1e-12, atol=1e-10)

    def test_current_captured_cases_reproduce_full_precision_metrics(self):
        for name in ('current_reinvestment_only', 'borrowing_alpha_0',
                     'borrowing_alpha_0.5', 'borrowing_alpha_1'):
            with self.subTest(case=name):
                case = self.capture['cases'][name]
                actual = extract(calculate(coerce_to_engine(case['inputs'])), case['inputs'])
                self.assert_metrics_equal(actual, case['metrics'])

    def test_pre_borrowing_benchmark_and_alpha_zero_are_preserved(self):
        cases = self.capture['cases']
        self.assert_metrics_equal(cases['current_reinvestment_only']['metrics'],
                                  cases['corrected_pre_borrowing']['metrics'])
        self.assert_metrics_equal(cases['borrowing_alpha_0']['metrics'],
                                  cases['current_reinvestment_only']['metrics'])

    def test_borrowing_changes_financing_timing_not_requirements_or_operating_revenue(self):
        cases = self.capture['cases']
        benchmark = cases['current_reinvestment_only']['metrics']['sectors']
        for name in ('borrowing_alpha_0.5', 'borrowing_alpha_1'):
            for sector in ('water_supply', 'sanitation'):
                borrowed = cases[name]['metrics']['sectors'][sector]
                np.testing.assert_allclose(borrowed['investment_requirement_annual_million'],
                                           benchmark[sector]['investment_requirement_annual_million'])
                self.assertEqual(borrowed['first_forecast_collected_revenue_uplift_million'],
                                 benchmark[sector]['first_forecast_collected_revenue_uplift_million'])
                self.assertGreater(borrowed['loan_principal_million'], 0)
                self.assertGreater(borrowed['terminal_sm_households_million'],
                                   benchmark[sector]['terminal_sm_households_million'])
                # This reference commits cash beyond the coverage horizon:
                # higher terminal coverage does not guarantee a lower sum of gaps.
                self.assertGreater(borrowed['annual_shortfalls_sum_million'],
                                   benchmark[sector]['annual_shortfalls_sum_million'])
                self.assertEqual(borrowed['loan_maturity_year'], 2051)


if __name__ == '__main__':
    unittest.main()