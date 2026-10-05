import unittest
from app import cost_mix_templates
from demo_adapter import frontend_defaults
from unit_cost_templates import blank_cost_mix_templates


class UnitCostTemplateTests(unittest.TestCase):
    def test_original_catalogue_without_inheriting_numbers(self):
        defaults = frontend_defaults()
        templates = blank_cost_mix_templates()
        for section, mixes in templates.items():
            for mix, rows in mixes.items():
                self.assertEqual([row["name"] for row in rows],
                                 [row["name"] for row in defaults[section][mix]])
                self.assertTrue(rows)
                self.assertTrue(all(row["share"] is None and row["cost"] is None for row in rows))
        self.assertEqual(cost_mix_templates(), templates)

    def test_templates_are_independent_editable_copies(self):
        first = blank_cost_mix_templates()
        first["water_costs"]["sm_tech_mix"][0].update(name="Custom DRC technology", share=1, cost=400)
        second = blank_cost_mix_templates()
        self.assertIsNone(second["water_costs"]["sm_tech_mix"][0]["cost"])
        self.assertNotEqual(second["water_costs"]["sm_tech_mix"][0]["name"], "Custom DRC technology")