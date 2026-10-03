"""Preservation checks for scenarios saved before borrowing was introduced."""

import copy
import unittest
import zipfile

from demo_adapter import coerce_to_engine, frontend_defaults
from export_data import scenario_csv, scenario_xlsx
from export_pptx import create_pptx
from model.engine import calculate


class ScopeCompatibilityTests(unittest.TestCase):
    def test_legacy_saved_scenario_retains_projections_and_exports(self):
        current = frontend_defaults()
        legacy = copy.deepcopy(current)
        for prefix, section in (
            ("ws", "water_interventions"), ("san", "sanitation_interventions")
        ):
            legacy["toggles"].pop(f"{prefix}_borrowing_enabled")
            for key in (
                "cash_allocation_alpha", "borrow_drawdown_year", "borrow_interest_rate",
                "borrow_term_years", "borrow_min_dscr", "borrow_ceiling", "existing_debt_service",
            ):
                legacy[section].pop(key)
        saved_snapshot = copy.deepcopy(legacy)
        parsed = coerce_to_engine(legacy)
        for prefix, section in (
            ("ws", "water_interventions"), ("san", "sanitation_interventions")
        ):
            self.assertFalse(getattr(parsed.toggles, f"{prefix}_borrowing_enabled"))
            self.assertEqual(getattr(parsed, section).cash_allocation_alpha, 0)
        old_result = calculate(parsed)
        new_result = calculate(coerce_to_engine(current))
        self.assertEqual(old_result["years"], new_result["years"])
        for sector in ("water_supply", "sanitation"):
            for key in (
                "target_hh", "bau_hh", "scenario_hh",
                "total_investment_need", "scenario_financing_gap",
            ):
                self.assertEqual(old_result[sector][key], new_result[sector][key])
            self.assertEqual(sum(old_result[sector]["scenario_loan_drawdown"]), 0)
        self.assertTrue(scenario_csv(legacy).strip())
        workbook = scenario_xlsx(legacy)
        with zipfile.ZipFile(workbook) as archive:
            self.assertIn("xl/workbook.xml", archive.namelist())
        with zipfile.ZipFile(create_pptx(old_result, legacy)) as archive:
            self.assertIn("ppt/presentation.xml", archive.namelist())
        self.assertEqual(legacy, saved_snapshot, "calculations and exports must not mutate saved inputs")


if __name__ == "__main__":
    unittest.main()