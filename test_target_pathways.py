"""Target obligations must stay independent of resource-constrained coverage."""

import copy
import unittest

import numpy as np

from demo_adapter import coerce_to_engine, frontend_defaults
from model.engine import calculate


class TargetPathwayTests(unittest.TestCase):
    def test_financing_changes_coverage_not_target_investment_or_assets(self):
        inputs = frontend_defaults()
        baseline = calculate(coerce_to_engine(inputs))
        first = baseline["years"].index(inputs["period"]["baseline_year"]) + 1
        for prefix, section, sector in (
            ("ws", "water_interventions", "water_supply"),
            ("san", "sanitation_interventions", "sanitation"),
        ):
            with self.subTest(sector=sector):
                funded = copy.deepcopy(inputs)
                funded["toggles"][f"{prefix}_exogenous_injection_enabled"] = True
                funded[section].update(
                    fin_injection_amount=1_000_000,
                    fin_injection_start_year=baseline["years"][first],
                    fin_injection_mode="one_time",
                )
                low = baseline[sector]
                high = calculate(coerce_to_engine(funded))[sector]
                self.assertGreater(high["scenario_hh"][0][first], low["scenario_hh"][0][first])
                for key in (
                    "target_hh", "scenario_new_capex_by_service",
                    "scenario_replacement_by_service", "scenario_total_investment_need",
                    "scenario_target_asset_stock", "scenario_target_asset_stock_by_service",
                ):
                    np.testing.assert_allclose(low[key], high[key], err_msg=key)
                for result in (low, high):
                    stock = np.asarray(result["scenario_target_asset_stock"])
                    expansion = np.asarray(result["scenario_new_capex_total"])
                    replacement = np.asarray(result["scenario_replacement_capex"])
                    implementation = np.asarray(result["scenario_implementation_capex"])
                    need = np.asarray(result["scenario_total_investment_need"])
                    np.testing.assert_allclose(
                        stock[first:] - stock[first - 1:-1], expansion[first:],
                        err_msg="only scheduled target expansion is added to target assets",
                    )
                    np.testing.assert_allclose(
                        need[first:], (expansion + replacement + implementation)[first:],
                        err_msg="annual obligations are counted once",
                    )

    def test_corrected_default_no_borrowing_benchmark(self):
        result = calculate(coerce_to_engine(frontend_defaults()))
        first = result["years"].index(2026)
        expected = {
            "water_supply": (16130.525177451287, 13617.018028608018, 232795.69253990575),
            "sanitation": (3621.086631519019, 490.4743762943317, 83973.1900016299),
        }
        for sector, (need, annual_gap, cumulative_gap) in expected.items():
            with self.subTest(sector=sector):
                self.assertAlmostEqual(result[sector]["total_investment_need"][first], need, places=6)
                self.assertAlmostEqual(result[sector]["financing_gap"][first], annual_gap, places=6)
                self.assertAlmostEqual(sum(result[sector]["financing_gap"][first:]), cumulative_gap, places=6)
                self.assertEqual(sum(result[sector]["scenario_loan_drawdown"]), 0)


if __name__ == "__main__":
    unittest.main()