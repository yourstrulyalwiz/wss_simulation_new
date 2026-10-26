import unittest
from types import SimpleNamespace

import numpy as np

from demo_adapter import coerce_to_engine
from model.engine import calculate
from model.inputs import CustomIntervention
from model.water_supply import custom_streams
from test_support import frontend_defaults


class CustomPauseTests(unittest.TestCase):
    def test_both_types_and_sectors_are_neutral(self):
        for sector in ('water', 'sanitation', 'both'):
            for kind in ('new_revenue', 'cost_reduction'):
                with self.subTest(sector=sector, kind=kind):
                    custom = CustomIntervention(
                        enabled=True, sector=sector, intervention_type=kind,
                        start_year=2026, output_start_year=2026,
                        output_quantity=100000000, output_value=100,
                        implement_cost=1000000, cost_years=2,
                        cost_effect=.9)
                    for target in ('water', 'sanitation'):
                        cash, factor = custom_streams(
                            {'n': 3, 'years': [2025, 2026, 2027]},
                            SimpleNamespace(baseline_year=2025), 100, [custom], target)
                        np.testing.assert_array_equal(cash, [0, 0, 0])
                        np.testing.assert_array_equal(factor, [1, 1, 1])

    def test_saved_enabled_settings_preserved_and_results_unchanged(self):
        inputs = coerce_to_engine(frontend_defaults())
        expected = calculate(inputs)
        inputs.custom_interventions = [
            CustomIntervention(enabled=True, sector='both', intervention_type=kind,
                               start_year=2026, output_start_year=2026,
                               output_quantity=100000000, output_value=100, cost_effect=.9)
            for kind in ('new_revenue', 'cost_reduction')]
        saved = inputs.model_dump()
        actual = calculate(inputs)
        self.assertEqual(inputs.model_dump(), saved)
        for sector in ('water_supply', 'sanitation'):
            self.assertEqual(actual[sector], expected[sector])


if __name__ == '__main__':
    unittest.main()
