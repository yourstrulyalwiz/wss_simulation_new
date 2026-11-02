import copy
import unittest

from calculation_setup import economic_projections
from demo_adapter import coerce_to_engine
from model.engine import calculate
from test_support import frontend_defaults


class IndependentBudgetProjectionTests(unittest.TestCase):
    def fixture(self):
        data = frontend_defaults()
        n = data['period']['baseline_year'] - data['period']['model_start_year'] + 1
        for prefix in ('ws', 'san'):
            data['bau'][prefix + '_expend_ts'] = [70.] * n
            data['bau'][prefix + '_alloc_ts'] = [100.] * n
        return data

    def test_matches_full_calculation(self):
        data = self.fixture()
        projected = economic_projections(data)
        full = calculate(coerce_to_engine(data), allow_partial=True)
        for sector in ('water_supply', 'sanitation'):
            for field in ('budget_executed_input_basis', 'budget_allocated_input_basis',
                          'budget_execution_baseline', 'budget_forecast_metadata'):
                self.assertEqual(projected[sector][field], full[sector][field])

    def test_missing_revenue_and_costs_do_not_block_budgets_or_mutate_inputs(self):
        data = self.fixture()
        expected = economic_projections(data)
        data['revenue_bases'] = {}
        data['water_costs'] = {}
        data['sanitation_costs'] = {}
        data['connection_revenue'] = {}
        saved = copy.deepcopy(data)
        result = economic_projections(data)
        self.assertEqual(data, saved)
        for sector in ('water_supply', 'sanitation'):
            self.assertEqual(result[sector], expected[sector])
            self.assertGreater(result[sector]['budget_allocated_input_basis'][-1], 0)

    def test_invalid_sector_does_not_block_other_budget(self):
        for bad, good in [('ws', 'sanitation'), ('san', 'water_supply')]:
            data = self.fixture()
            data['bau'][bad + '_alloc_ts'] = []
            result = economic_projections(data)
            self.assertIn(good, result)
            self.assertEqual(len(result['budget_errors']), 1)
            self.assertIn('no historical budget observations',
                          next(iter(result['budget_errors'].values())))

    def test_explicit_zero_and_forecast_override(self):
        data = self.fixture()
        n = len(data['bau']['san_expend_ts'])
        data['bau']['san_expend_ts'] += [0, 123.]
        result = economic_projections(data)
        self.assertEqual(result['sanitation']['budget_executed_input_basis'][n:n+2], [0, 123.])


if __name__ == '__main__':
    unittest.main()
