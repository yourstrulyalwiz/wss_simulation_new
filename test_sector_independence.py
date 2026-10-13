import unittest
import copy
from test_utility_revenue import example
from model.engine import calculate
from model.utility_revenue import RevenueInputError
from demo_adapter import coerce_to_engine


class SectorIndependenceTests(unittest.TestCase):
    def data(self):
        data = example()
        data['toggles'].update(ws_collection_efficiency_enabled=True,
                              san_collection_efficiency_enabled=True)
        return data

    def test_invalid_sanitation_preserves_identical_water(self):
        data = self.data()
        expected = calculate(coerce_to_engine(data))['water_supply']
        data['connection_revenue']['sanitation']['new_billed_share_basic'] = None
        original = copy.deepcopy(data)
        result = calculate(coerce_to_engine(data), allow_partial=True)
        self.assertEqual(result['water_supply'], expected)
        self.assertIsNone(result['sanitation'])
        self.assertEqual(set(result['sector_errors']), {'sanitation'})
        self.assertEqual(data, original)
        with self.assertRaises(RevenueInputError):
            calculate(coerce_to_engine(data))  # combined exports stay explicitly incomplete

    def test_invalid_water_preserves_unlinked_sanitation(self):
        data = self.data()
        expected = calculate(coerce_to_engine(data))['sanitation']
        data['connection_revenue']['water']['new_billed_share_sm'] = None
        result = calculate(coerce_to_engine(data), allow_partial=True)
        self.assertEqual(result['sanitation'], expected)
        self.assertIsNone(result['water_supply'])
        self.assertEqual(set(result['sector_errors']), {'water_supply'})
        data['toggles']['san_nrw_link_enabled'] = True
        linked = calculate(coerce_to_engine(data), allow_partial=True)
        self.assertIsNone(linked['sanitation'])
        self.assertIn('water-to-sanitation NRW link', linked['sector_errors']['sanitation'])

    def test_restoring_inputs_clears_errors(self):
        data = self.data()
        result = calculate(coerce_to_engine(data), allow_partial=True)
        self.assertEqual(result['sector_errors'], {})
        self.assertTrue(result['water_supply'])
        self.assertTrue(result['sanitation'])
