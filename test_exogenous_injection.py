"""Regression checks for the independently switched injection intervention."""

import copy
import unittest

from deck_data import cumulative_passes
from demo_adapter import coerce_to_engine, frontend_defaults
from export_data import SAN_INTV, WATER_INTV, intervention_breakdown, scenario_csv
from model.engine import calculate


class ExogenousInjectionTests(unittest.TestCase):
    def test_combined_funding_and_saturated_marginal_outcome(self):
        for prefix, section, sector in (
            ("ws", "water_interventions", "water_supply"),
            ("san", "sanitation_interventions", "sanitation"),
        ):
            for gdp_share, injection_amount, expect_extra_coverage in (
                (0.002, 10000, True),
                (0.05, 100, False),
            ):
                with self.subTest(sector=sector, gdp_share=gdp_share):
                    inputs = frontend_defaults()
                    inputs[section].update(
                        fin_gdp_enabled=True, fin_gdp_start_year=2028,
                        fin_gdp_target_share=gdp_share,
                        fin_injection_mode="recurring", fin_injection_amount=injection_amount,
                        fin_injection_start_year=2028, fin_injection_end_year=2040,
                    )
                    f_key = f"{prefix}_financial_commitment_enabled"
                    i_key = f"{prefix}_exogenous_injection_enabled"
                    runs = {}
                    for name, financial, injection in (
                        ("financial", True, False),
                        ("injection", False, True),
                        ("both", True, True),
                    ):
                        case = copy.deepcopy(inputs)
                        case["toggles"][f_key] = financial
                        case["toggles"][i_key] = injection
                        runs[name] = calculate(coerce_to_engine(case))[sector]

                    year_index = calculate(coerce_to_engine(inputs))["years"].index(2040)
                    f_cash = runs["both"]["scenario_financial_commitment_cash"][year_index]
                    i_cash = runs["both"]["scenario_exogenous_injection_cash"][year_index]
                    self.assertGreater(f_cash, 0)
                    self.assertGreater(i_cash, 0)
                    self.assertAlmostEqual(f_cash, runs["financial"]["scenario_financial_commitment_cash"][year_index])
                    self.assertAlmostEqual(i_cash, runs["injection"]["scenario_exogenous_injection_cash"][year_index])
                    self.assertAlmostEqual(
                        f_cash + i_cash,
                        runs["both"]["scenario_financial_commitment_cash"][year_index]
                        + runs["both"]["scenario_exogenous_injection_cash"][year_index],
                    )
                    extra = (runs["both"]["scenario_hh"][0][year_index]
                             - runs["financial"]["scenario_hh"][0][year_index])
                    if expect_extra_coverage:
                        self.assertGreater(extra, 0)
                    else:
                        self.assertAlmostEqual(extra, 0, places=6)
                        self.assertAlmostEqual(runs["both"]["scenario_financing_gap"][year_index], 0)

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