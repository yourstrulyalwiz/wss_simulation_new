"""Financing timing, cash conservation, and separation from service-gap snapshots."""

import unittest

import numpy as np

from demo_adapter import coerce_to_engine, frontend_defaults
from export_data import per_year_table
from model.engine import calculate
from model.finance import annual_asset_requirements, funding_ledger


class ProgrammeFinancingTests(unittest.TestCase):
    def assert_cash_reconciles(self, ledger):
        np.testing.assert_allclose(
            ledger["opening_cash"] + ledger["fresh_financing"] + ledger["financing_cash_deficit"],
            ledger["financing_applied"] + ledger["cash_carry_forward"])
        np.testing.assert_allclose(ledger["opening_cash"][1:], ledger["cash_carry_forward"][:-1])
        np.testing.assert_allclose(
            ledger["cumulative_new_financing"] - ledger["cumulative_financing_applied"]
            + np.cumsum(ledger["financing_cash_deficit"]), ledger["cash_carry_forward"])

    def test_five_sources_including_carry_are_added_once(self):
        ledger = funding_ledger(
            [0, 50, 100], [0, 65, 40], [0, 0, 10], [0, 0, 20],
            loan_drawdowns=[0, 0, 15])
        np.testing.assert_allclose(ledger["available"], [0, 65, 100])
        np.testing.assert_allclose(ledger["gap"], [0, 0, 0])
        self.assertEqual(ledger["cumulative_new_financing"][-1], 150)
        self.assert_cash_reconciles(ledger)

    def test_later_surplus_does_not_cancel_earlier_shortfall_or_reschedule_cost(self):
        ledger = funding_ledger([0, 100, 100, 100], [0, 150, 10, 140], [0] * 4, [0] * 4)
        np.testing.assert_allclose(ledger["gap"], [0, 0, 40, 0])
        np.testing.assert_allclose(ledger["cash_carry_forward"], [0, 50, 0, 40])
        self.assertEqual(ledger["cumulative_gap"][-1], 40)
        self.assertEqual(ledger["cumulative_requirement"][-1], 300)
        self.assertEqual(ledger["cumulative_new_financing"][-1], 300)
        self.assert_cash_reconciles(ledger)

    def test_cash_held_across_empty_years_is_not_a_repeated_receipt(self):
        ledger = funding_ledger([0, 100, 0, 0, 60], [0, 200, 0, 0, 0], [0] * 5, [0] * 5)
        np.testing.assert_allclose(ledger["cash_carry_forward"], [0, 100, 100, 100, 40])
        self.assertEqual(ledger["cumulative_new_financing"][-1], 200)
        self.assertEqual(ledger["cumulative_financing_applied"][-1], 160)
        self.assert_cash_reconciles(ledger)

    def test_signed_outflows_reconcile_without_negative_cash_balances(self):
        ledger = funding_ledger([0, 0, 5], [0, 10, -20], [0] * 3, [0] * 3)
        self.assertEqual(ledger["gap"][-1], 15)
        self.assertEqual(ledger["financing_cash_deficit"][-1], 10)
        self.assertEqual(ledger["cash_carry_forward"][-1], 0)
        self.assert_cash_reconciles(ledger)

    def test_historical_costs_are_not_included_in_forward_programme(self):
        ledger = funding_ledger([1000, 500, 100], [400, 300, 40], [0] * 3, [0] * 3, baseline_index=1)
        np.testing.assert_allclose(ledger["cumulative_requirement"], [0, 0, 100])
        np.testing.assert_allclose(ledger["cumulative_gap"], [0, 0, 60])
        self.assert_cash_reconciles(ledger)

    def test_incomplete_series_and_duplicate_loan_source_fail_explicitly(self):
        with self.assertRaises(ValueError):
            funding_ledger([0, 100, 100], [0, 40], [0] * 3, [0] * 3)
        with self.assertRaises(ValueError):
            funding_ledger([0, 100], [0, 40], [0] * 2, [0] * 2,
                           explicit_public=[0, 20], loan_drawdowns=[0, 20])

    def test_expansion_replacement_and_implementation_are_each_counted_once(self):
        assets = annual_asset_requirements(
            [0, 10], 100, 0.1, implementation_capex=[0, 7])
        self.assertEqual(assets["total_need"][1], 27)
        self.assertEqual(assets["target_asset_stock"][1], 110)
        ledger = funding_ledger(assets["total_need"], [0, 20], [0, 0], [0, 0])
        self.assertEqual(ledger["gap"][1], 7)

    def test_both_sector_reports_reconcile_and_keep_terminal_gaps_separate(self):
        inputs = frontend_defaults()
        for prefix, section in (("ws", "water_interventions"), ("san", "sanitation_interventions")):
            inputs["toggles"][f"{prefix}_exogenous_injection_enabled"] = True
            inputs[section].update(fin_injection_amount=1_000_000,
                                   fin_injection_start_year=2026, fin_injection_mode="one_time")
        result = calculate(coerce_to_engine(inputs))
        first = result["years"].index(2026)
        for sector in ("water_supply", "sanitation"):
            with self.subTest(sector=sector):
                sec = result[sector]
                field = lambda key: np.asarray(sec[f"scenario_{key}"])
                fresh = sum(field(key) for key in (
                    "public_capital", "other_capital", "cash_allocated_to_direct_investment", "loan_drawdown"))
                np.testing.assert_allclose(field("current_year_financing")[first:], fresh[first:])
                np.testing.assert_allclose(field("available_total")[first:],
                                           (fresh + field("cash_opening"))[first:])
                np.testing.assert_allclose(field("financing_gap"), np.maximum(
                    0, field("total_investment_need") - field("available_total")))
                np.testing.assert_allclose(
                    field("cash_opening") + field("current_year_financing") + field("financing_cash_deficit"),
                    field("funded_investment") + field("cash_carry_forward"))
                self.assertGreater(field("cash_carry_forward")[first], 0)
                np.testing.assert_allclose(field("service_gap_raw"),
                                           np.asarray(sec["target_hh"]) - np.asarray(sec["scenario_hh"]))
                np.testing.assert_allclose(field("terminal_unmet_service_gap"),
                                           np.maximum(0, field("service_gap_raw")[:, -1]))
                self.assertAlmostEqual(sec["scenario_programme_investment_requirement"],
                                       field("total_investment_need")[first:].sum())
                self.assertAlmostEqual(sec["scenario_programme_financing_shortfall"],
                                       field("financing_gap")[first:].sum())
                headers, rows = per_year_table(result, inputs, sector)
                cur = inputs["country_config"]["currency"]
                opening = headers.index(f"Opening carried investment cash — scenario ({cur} M)")
                closing = headers.index(f"Closing carried investment cash — scenario ({cur} M)")
                self.assertEqual(rows[first + 1][opening], rows[first][closing])

    def test_nrw_household_upgrade_cost_is_not_added_again_as_implementation(self):
        inputs = frontend_defaults()
        baseline = calculate(coerce_to_engine(inputs))["water_supply"]
        inputs["toggles"]["ws_nrw_enabled"] = True
        nrw = calculate(coerce_to_engine(inputs))["water_supply"]
        self.assertGreater(sum(nrw["scenario_nrw_service_upgrade_capex"]), 0)
        np.testing.assert_allclose(nrw["scenario_new_capex_total"], baseline["scenario_new_capex_total"])
        np.testing.assert_allclose(
            np.asarray(nrw["scenario_total_investment_need"]) - baseline["scenario_total_investment_need"],
            nrw["scenario_nrw_implementation_capex"], atol=1e-8)


if __name__ == "__main__":
    unittest.main()