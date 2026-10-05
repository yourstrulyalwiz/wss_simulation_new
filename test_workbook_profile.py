import os
import unittest
from unittest.mock import patch
from workbook_profile import build_preview, PREVIEW_PROFILE_NAME
from demo_adapter import coerce_to_engine, frontend_defaults
from app import development_preview

URBAN = "attached_assets/wss_input_template_urban_1791162260127.xlsx"
RURAL = "attached_assets/wss_input_template_rural_1791162260126.xlsx"


class WorkbookProfileTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bundle = build_preview(URBAN, RURAL)

    def test_supplied_cells_and_both_areas(self):
        self.assertEqual(self.bundle["inputs"]["profile_metadata"]["imported_cells"], 265)
        self.assertEqual(self.bundle["altInputs"]["rural"]["profile_metadata"]["imported_cells"], 273)
        self.assertTrue(self.bundle["scope"]["areaUrban"] and self.bundle["scope"]["areaRural"])
        self.assertEqual(self.bundle["inputs"]["population"]["pop_ts"][0], 28.187377)
        self.assertEqual(self.bundle["altInputs"]["rural"]["population"]["pop_ts"][0], 42.661934)

    def test_period_targets_and_conflicting_gdp_preserved(self):
        for area in (self.bundle["inputs"], self.bundle["altInputs"]["rural"]):
            self.assertEqual(area["period"]["forecast_end_year"], 2035)
            self.assertEqual(area["period"]["target1_year"], 2030)
            self.assertEqual(area["period"]["target2_year"], 2035)
            self.assertEqual(area["country_config"]["currency"], "CDF")
        self.assertEqual(len(self.bundle["inputs"]["macro"]["gdp_real_local"]), 14)
        self.assertEqual(self.bundle["altInputs"]["rural"]["macro"]["gdp_real_local"][14], 6282512.724)

    def test_no_inherited_assumptions_or_results(self):
        for area in (self.bundle["inputs"], self.bundle["altInputs"]["rural"]):
            self.assertIsNone(area["water_costs"]["network_cost_per_hh_serv1"])
            self.assertIsNone(area["technical"]["ws_asset_life"])
            self.assertIsNone(area["water_interventions"]["ce_water_sold_mld"])
            self.assertEqual(area["macro"]["exchange_rate"], [])
            with self.assertRaisesRegex(ValueError, "Missing country-specific inputs"):
                coerce_to_engine(area)

    def test_preview_metadata_does_not_block_valid_inputs(self):
        inputs = frontend_defaults()
        inputs["profile_metadata"] = {"status": "data_preview"}
        self.assertEqual(coerce_to_engine(inputs).period.baseline_year, inputs["period"]["baseline_year"])

    def test_no_production_default(self):
        with patch.dict(os.environ, {"REPLIT_DEPLOYMENT": "1"}):
            self.assertEqual(development_preview(), {"profile": None})
        with patch.dict(os.environ, {"REPLIT_DEPLOYMENT": ""}):
            preview = development_preview()
            self.assertEqual(preview["profile"], PREVIEW_PROFILE_NAME)
            self.assertIn("rural", preview["bundle"]["altInputs"])


if __name__ == "__main__":
    unittest.main()