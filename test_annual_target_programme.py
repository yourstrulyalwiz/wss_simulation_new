"""Annual target trajectories, mutually exclusive transitions, and scheduled asset bases."""

import copy
import unittest

import numpy as np

from demo_adapter import coerce_to_engine, frontend_defaults
from export_data import per_year_table
from model.engine import calculate
from model.finance import annual_asset_requirements, target_household_trajectory, target_transition_capex


class AnnualTargetProgrammeTests(unittest.TestCase):
    def test_milestones_zeros_growth_and_exclusive_categories(self):
        years = [2025, 2026, 2027, 2028, 2029, 2030]
        households = np.array([100, 110, 120, 130, 140, 150])
        first = [0.2, 0.4, 0.2, 0.1, 0.1]
        final = [0.6, 0.0, 0.1, 0.2, 0.1]
        path = target_household_trajectory(
            years, households, [0, 50, 20, 20, 10], 0, [(2027, first), (2029, final)])
        np.testing.assert_allclose(path.sum(axis=0), households)
        self.assertTrue(np.all(path >= 0))
        self.assertAlmostEqual(path[0, 1], 12)
        np.testing.assert_allclose(path[:, 2], np.array(first) * 120)
        np.testing.assert_allclose(path[:, 4], np.array(final) * 140)
        np.testing.assert_allclose(path[:, 5], np.array(final) * 150)
        self.assertEqual(path[1, 4], 0)

    def test_positive_count_cagr_is_retained(self):
        path = target_household_trajectory(
            [2025, 2026, 2027], [100, 100, 100], [10, 50, 20, 10, 10], 0,
            [(2027, [0.4, 0.25, 0.15, 0.1, 0.1])])
        self.assertAlmostEqual(path[0, 1], 20)
        self.assertAlmostEqual(path[1, 1], np.sqrt(50 * 25))
        np.testing.assert_allclose(path[:, 2], [40, 25, 15, 10, 10])

    def test_legacy_milestone_after_forecast_window_is_preserved(self):
        path = target_household_trajectory(
            [2025, 2026], [100, 100], [10, 50, 20, 10, 10], 0,
            [(2027, [0.4, 0.25, 0.15, 0.1, 0.1])])
        self.assertAlmostEqual(path[0, 1], 20)
        self.assertAlmostEqual(path[:, 1].sum(), 100)

    def test_population_growth_does_not_hide_upgrades_when_basic_count_rises(self):
        program = target_transition_capex(
            [10, 22], [50, 53.9], [100, 100], [60, 60], 0,
            total_households=[100, 110])
        self.assertAlmostEqual(program["sm_upgrades"][1], 1)
        self.assertAlmostEqual(program["new_sm_connections"][1], 11)
        self.assertAlmostEqual(program["new_basic_connections"][1], 4.9)
        self.assertAlmostEqual(program["expansion"][1], 11 * 100 + 1 * 40 + 4.9 * 60)
        self.assertAlmostEqual(program["new_sm_connections"][1] + program["sm_upgrades"][1], 12)
        self.assertAlmostEqual(program["new_basic_connections"][1] - program["sm_upgrades"][1], 3.9)

    def test_constant_shares_price_growth_once_with_current_year_costs(self):
        program = target_transition_capex(
            [20, 22], [50, 55], [100, 80], [60, 50], 0,
            total_households=[100, 110])
        self.assertAlmostEqual(program["new_sm_connections"][1], 2)
        self.assertAlmostEqual(program["new_basic_connections"][1], 5)
        self.assertEqual(program["sm_upgrades"][1], 0)
        self.assertAlmostEqual(program["expansion"][1], 410)

    def test_upgrade_transfers_existing_assets_and_replacement_does_not_expand_stock(self):
        program = target_transition_capex(
            [10, 12, 12], [5, 3, 3], [100] * 3, [60] * 3, 0,
            total_households=[20] * 3)
        assets = annual_asset_requirements(
            program["expansion"], 1300, 0.1,
            expansion_by_service=[program["expansion_sm"], program["expansion_basic"]],
            opening_assets_by_service=[1000, 300], service_households=[[10, 12, 12], [5, 3, 3]],
            service_upgrades=program["sm_upgrades"], service_downgrades=program["sm_downgrades"])
        self.assertAlmostEqual(assets["target_asset_transfer_to_sm"][1], 120)
        np.testing.assert_allclose(assets["target_asset_stock_by_service"][:, 1], [1200, 180])
        np.testing.assert_allclose(assets["target_asset_stock"], [1300, 1380, 1380])
        np.testing.assert_allclose(assets["replacement_by_service"][:, 2], [120, 18])
        np.testing.assert_allclose(assets["target_asset_stock_by_service"].sum(axis=0),
                                   assets["target_asset_stock"])

    def test_downward_moves_and_population_contraction_do_not_buy_duplicate_connections(self):
        downgrade = target_transition_capex(
            [12, 10], [3, 5], [100, 100], [60, 60], 0, total_households=[20, 20])
        self.assertEqual(downgrade["sm_downgrades"][1], 2)
        self.assertEqual(downgrade["expansion"][1], 0)
        contraction = target_transition_capex(
            [20, 18], [50, 45], [100, 100], [60, 60], 0, total_households=[100, 90])
        self.assertEqual(contraction["expansion"][1], 0)

    def test_both_sectors_hit_entered_milestones_and_export_the_programme(self):
        inputs = frontend_defaults()
        result = calculate(coerce_to_engine(inputs))
        first = result["years"].index(inputs["period"]["baseline_year"]) + 1
        for sector, service, prefix in (
            ("water_supply", "water_service", "serv"),
            ("sanitation", "sanitation_service", "sserv"),
        ):
            with self.subTest(sector=sector):
                output = result[sector]
                counts = np.asarray(output["target_hh"])
                np.testing.assert_allclose(counts[:, first:].sum(axis=0), result["total_hh"][first:])
                for i in range(first, len(result["years"])):
                    shares = [inputs[service][f"{prefix}{r + 1}_ts"][i] for r in range(5)]
                    if all(isinstance(s, (float, int)) for s in shares) and np.isclose(sum(shares), 1):
                        np.testing.assert_allclose(counts[:, i], np.array(shares) * result["total_hh"][i])
                headers, rows = per_year_table(result, inputs, sector)
                column = headers.index("Target basic-to-safely-managed upgrades (M HH)")
                self.assertAlmostEqual(rows[first][column], output["target_sm_upgrades"][first], places=6)
                self.assertIn("bau_asset_stock", output)
                self.assertIn("scenario_bau_asset_stock", output)

    def test_eligible_efficiency_changes_unit_costs_not_milestones_or_opening_assets(self):
        inputs = frontend_defaults()
        baseline = calculate(coerce_to_engine(inputs))
        year = baseline["years"].index(2030)
        for prefix, section, sector in (
            ("ws", "water_interventions", "water_supply"),
            ("san", "sanitation_interventions", "sanitation"),
        ):
            with self.subTest(sector=sector):
                efficient = copy.deepcopy(inputs)
                efficient["toggles"][f"{prefix}_costeff_enabled"] = True
                efficient[section].update(
                    costeff_start_year=2026, costeff_target_year=2030,
                    costeff_current_pct=0, costeff_target_pct=0.2)
                result = calculate(coerce_to_engine(efficient))[sector]
                np.testing.assert_allclose(result["target_hh"], baseline[sector]["target_hh"])
                self.assertEqual(result["opening_stock"], baseline[sector]["opening_stock"])
                self.assertAlmostEqual(result["scenario_cost_sm_t"][year],
                                       baseline[sector]["cost_sm_t"][year] * 0.8)
                self.assertLess(result["scenario_new_capex_total"][year],
                                baseline[sector]["new_capex_total"][year])


if __name__ == "__main__":
    unittest.main()