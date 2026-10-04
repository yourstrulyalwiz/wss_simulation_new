"""Regression checks for the independently switched injection intervention."""

import copy
import unittest

from deck_data import cumulative_passes
from demo_adapter import coerce_to_engine, frontend_defaults
from test_support import frontend_defaults
from export_data import SAN_INTV, WATER_INTV, intervention_breakdown, scenario_csv
from model.engine import calculate


class ExogenousInjectionTests(unittest.TestCase):
    def test_independent_and_legacy_attribution(self):
        defaults = frontend_defaults()
        baseline = calculate(coerce_to_engine(defaults))
        index = baseline["years"].index(2028)

        for prefix, section, sector, definitions in (
            ("ws", "water_interventions", "water_supply", WATER_INTV),
            ("san", "sanitation_interventions", "sanitation", SAN_INTV),
        ):
            with self.subTest(sector=sector):
                inputs = copy.deepcopy(defaults)
                financial = f"{prefix}_financial_commitment_enabled"
                injection = f"{prefix}_exogenous_injection_enabled"
                inputs["toggles"].update({financial: True, injection: True})
                inputs[section].update(
                    fin_gdp_enabled=True, fin_gdp_start_year=2028,
                    fin_gdp_target_share=0.05, fin_injection_amount=100,
                    fin_injection_start_year=2028, fin_injection_mode="one_time",
                )

                both = calculate(coerce_to_engine(inputs))[sector]
                commitment_cash = both["scenario_financial_commitment_cash"][index]
                injection_cash = both["scenario_exogenous_injection_cash"][index]
                self.assertGreater(commitment_cash, 0)
                self.assertGreater(injection_cash, 0)
                self.assertEqual(both["bau_hh"], baseline[sector]["bau_hh"])

                financial_only = copy.deepcopy(inputs)
                financial_only["toggles"][injection] = False
                result = calculate(coerce_to_engine(financial_only))[sector]
                self.assertEqual(result["scenario_financial_commitment_cash"][index], commitment_cash)
                self.assertEqual(result["scenario_exogenous_injection_cash"][index], 0)

                injection_only = copy.deepcopy(inputs)
                injection_only["toggles"][financial] = False
                injection_only["toggles"][injection] = True
                result = calculate(coerce_to_engine(injection_only))[sector]
                self.assertEqual(result["scenario_financial_commitment_cash"][index], 0)
                self.assertEqual(result["scenario_exogenous_injection_cash"][index], injection_cash)

                legacy = copy.deepcopy(inputs)
                legacy["toggles"].pop(injection)
                legacy[section]["fin_injection_enabled"] = True
                self.assertTrue(getattr(coerce_to_engine(legacy).toggles, injection))
                rows = intervention_breakdown(legacy, sector, definitions)
                self.assertTrue(any(label == "Exogenous Injection of Funds" and money > 0
                                    for label, _, money, _ in rows))
                _, enabled, _ = cumulative_passes([legacy])
                self.assertIn(injection, [definition[0] for definition in enabled])
                self.assertIn("Exogenous Injection of Funds", scenario_csv(legacy))

                legacy["toggles"][injection] = False
                self.assertFalse(getattr(coerce_to_engine(legacy).toggles, injection))


if __name__ == "__main__":
    unittest.main()