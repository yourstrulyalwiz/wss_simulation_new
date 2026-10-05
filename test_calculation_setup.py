import copy
import asyncio
import hashlib
import json
import unittest
from pathlib import Path

import numpy as np
from app import development_preview, run_calculation, project_economics, missing_country_inputs
from calculation_setup import economic_projections, restore_automatic_inputs, CountryCalibrationError
from demo_adapter import coerce_to_engine, frontend_defaults
from model.engine import calculate

PROFILE = Path("profiles/DRC_Data_Preview_Settings_Pending.json")


def configured_fixture(inputs):
    """Explicit test calibration, never written to the bundled profile."""
    value = copy.deepcopy(inputs)
    value["water_costs"].update(network_cost_per_hh_serv1=1000, network_cost_per_hh_serv2=500)
    value["sanitation_costs"].update(sewer_cost_per_hh_sserv1=900, sewer_cost_per_hh_sserv2=400)
    value["technical"].update(ws_asset_life=30, san_asset_life=30, ws_non_hh_pct=0, san_non_hh_pct=0)
    value["revenue_bases"] = {sector: {
        "version": 1, "volume_mld": 1, "reference_year": 2025,
        "tariff": 1, "collection_ratio": 1, "growth_rate": None,
    } for sector in ("water", "sanitation")}
    return value


class CalculationSetupTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bundle = json.loads(PROFILE.read_text())

    def areas(self):
        return (self.bundle["inputs"], self.bundle["altInputs"]["rural"])

    def test_null_configuration_restored_without_changing_data(self):
        for area in self.areas():
            before = copy.deepcopy(area)
            fixed = restore_automatic_inputs(area)
            self.assertEqual(area, before)
            self.assertEqual(fixed["period"]["as_is_forecast_length"], 2)
            self.assertEqual(fixed["period"]["perf_improvement_start_year"], 2026)
            for key in ("population", "water_service", "sanitation_service",
                        "water_costs", "sanitation_costs", "technical", "revenue_bases"):
                self.assertEqual(fixed[key], before[key])
            self.assertEqual(fixed["macro"]["gdp_real_local"], before["macro"]["gdp_real_local"])
            self.assertEqual(restore_automatic_inputs(fixed), fixed)

    def test_explicit_zero_and_custom_overrides_preserved(self):
        area = copy.deepcopy(self.bundle["inputs"])
        area["period"]["as_is_forecast_length"] = 0
        area["macro"].update(gdp_growth_forecast=0, inflation_local_ongoing=0,
                             inflation_us_ongoing=.031, execution_rate=0)
        area["bau"]["ws_budget_ongoing"] = 0
        fixed = restore_automatic_inputs(area)
        self.assertEqual(fixed["period"]["as_is_forecast_length"], 0)
        self.assertEqual(fixed["macro"]["inflation_local_ongoing"], 0)
        self.assertEqual(fixed["macro"]["gdp_growth_forecast"], 0)
        self.assertEqual(fixed["macro"]["inflation_us_ongoing"], .031)
        self.assertEqual(fixed["macro"]["execution_rate"], 0)
        self.assertEqual(fixed["bau"]["ws_budget_ongoing"], 0)

    def test_existing_default_calculation_is_unchanged(self):
        defaults = frontend_defaults()
        self.assertEqual(calculate(coerce_to_engine(defaults)),
                         calculate(coerce_to_engine(restore_automatic_inputs(defaults))))

    def test_disabled_reform_targets_use_own_revenue_base_not_zero(self):
        area = configured_fixture(self.bundle["inputs"])
        area["revenue_bases"]["sanitation"]["collection_ratio"] = .72
        fixed = restore_automatic_inputs(area)
        self.assertEqual(fixed["water_interventions"]["ce_target_ratio"], 1)
        self.assertEqual(fixed["sanitation_interventions"]["ce_target_ratio"], .72)
        self.assertEqual(fixed["water_interventions"]["tariff_target"], 1)
        area["toggles"]["ws_tariff_enabled"] = True
        self.assertIsNone(restore_automatic_inputs(area)["water_interventions"]["tariff_target"])

    def test_economic_rows_match_full_engine_with_country_calibration(self):
        for area in self.areas():
            full = calculate(coerce_to_engine(configured_fixture(area)))
            partial = economic_projections(area)
            for key, values in partial.items():
                np.testing.assert_allclose(values, full[key])
                self.assertEqual(len(values), 25)
                self.assertTrue(np.isfinite(values).all())
            for sector in ("water_supply", "sanitation"):
                self.assertEqual(len(full[sector]["bau_hh"][0]), 25)
                self.assertEqual(len(full[sector]["bau_hh"][1]), 25)

    def test_calibration_remains_explicit_and_returns_actionable_422(self):
        for area in self.areas():
            with self.assertRaises(CountryCalibrationError):
                coerce_to_engine(area)
            try:
                run_calculation(area)
            except CountryCalibrationError as error:
                response = asyncio.run(missing_country_inputs(None, error))
            else:
                self.fail("Uncalibrated country inputs must not calculate.")
            self.assertEqual(response.status_code, 422)
            detail = json.loads(response.body)["detail"]
            self.assertIn("Missing country-specific inputs", detail)
            self.assertNotIn("as_is_forecast_length", detail)
            self.assertIn("7. Unit Costs", detail)
            response = project_economics(area)
            self.assertEqual(len(response["years"]), 25)
            self.assertNotIn("water_supply", response)
            self.assertNotIn("financing_gap", response)

    def test_supplied_future_gdp_and_household_values_are_honoured(self):
        area = copy.deepcopy(self.bundle["altInputs"]["rural"])
        area["population"]["hh_ts"] += [12] * 11
        values = economic_projections(area)
        self.assertEqual(values["gdp_real_local"][19], area["macro"]["gdp_real_local"][19])
        self.assertEqual(values["total_hh"][24], 12)

    def test_projection_and_calculation_endpoints_agree(self):
        for area in self.areas():
            fixture = configured_fixture(area)
            full = run_calculation(fixture)
            projection = project_economics(fixture)
            self.assertEqual(projection["gdp_real_local"], full["gdp_real_local"])

    def test_bootstrap_revision_and_browser_session_not_replaced(self):
        raw = PROFILE.read_bytes()
        preview = development_preview()
        self.assertEqual(preview["revision"], hashlib.sha256(raw).hexdigest()[:16])
        self.assertEqual(preview["bundle"], self.bundle)


if __name__ == "__main__":
    unittest.main()