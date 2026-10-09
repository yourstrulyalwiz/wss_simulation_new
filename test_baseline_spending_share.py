"""Baseline total-spending reference shown beside the financial commitment target."""

import copy
import unittest
import json
from pathlib import Path
from mock_drc import populate_mock_bundle
from model.water_supply import FinancialCommitmentInputError

from demo_adapter import coerce_to_engine, frontend_defaults
from test_support import frontend_defaults
from model.engine import calculate


class BaselineSpendingShareTests(unittest.TestCase):
    def drc(self):
        return populate_mock_bundle(json.loads(Path("profiles/DRC_Data_Preview_Settings_Pending.json").read_text()))["bundle"]

    def test_missing_total_spending_uses_labelled_cost_equivalent(self):
        bundle = self.drc()
        for inputs in (bundle["inputs"], bundle["altInputs"]["rural"]):
            model = coerce_to_engine(inputs)
            result = calculate(model)
            index = result["years"].index(inputs["period"]["baseline_year"])
            for sector, capex in (("water_supply", model.wss_budget.ws_capex_pct),
                                   ("sanitation", model.wss_budget.san_capex_pct)):
                reference = result[sector]
                factor = (capex if capex is not None else model.wss_budget.capex_pct_budget) * model.wss_budget.execution_rate
                self.assertEqual(reference["baseline_spending_reference_source"], "cost_derived_equivalent")
                self.assertGreater(reference["baseline_bau_total_spending_share"], 0)
                self.assertAlmostEqual(reference["financial_commitment_base"][index] * factor,
                                       reference["budget_used"][index])
                self.assertAlmostEqual(reference["baseline_bau_total_spending_share"],
                                       reference["financial_commitment_base"][index] / result["gdp_real_local"][index])

    def test_drc_growth_gdp_target_dates_and_master_toggle(self):
        bundle = self.drc()
        for inputs in (bundle["inputs"], bundle["altInputs"]["rural"]):
            for prefix, section, sector in (("ws", "water_interventions", "water_supply"),
                                            ("san", "sanitation_interventions", "sanitation")):
                case = copy.deepcopy(inputs)
                case["toggles"][prefix + "_financial_commitment_enabled"] = True
                case[section].update(fin_growth_enabled=True, fin_growth_rate=.1,
                                     fin_growth_start_year=None, fin_growth_end_year=2028)
                model = coerce_to_engine(case)
                iv = getattr(model, section)
                self.assertEqual(iv.fin_growth_start_year, 2026)
                result = calculate(model)
                base = result[sector]["financial_commitment_base"]
                capex = getattr(model.wss_budget, prefix + "_capex_pct")
                capital_share = capex if capex is not None else model.wss_budget.capex_pct_budget
                for year in (2026, 2027, 2028):
                    index = result["years"].index(year)
                    override = iv.capeff_current_pct
                    sec = result[sector]
                    baseline_eff = override if override > 0 else min(1, sec["budget_used"][index] / sec["budget_allocated"][index]) if sec["budget_allocated"][index] > 0 else 1
                    factor = capital_share * baseline_eff
                    self.assertGreater(result[sector]["scenario_financial_commitment_cash"][index], 0)
                    self.assertAlmostEqual(result[sector]["scenario_financial_commitment_cash"][index],
                                           base[index] * (1.1 ** (year - 2026 + 1) - 1) * factor)
                self.assertEqual(result[sector]["scenario_financial_commitment_cash"][result["years"].index(2029)], 0)
                case[section].update(fin_gdp_enabled=True, fin_gdp_start_year=None, fin_gdp_target_share=.05)
                combined = calculate(coerce_to_engine(case))
                index = combined["years"].index(2026)
                baseline_eff = iv.capeff_current_pct if iv.capeff_current_pct > 0 else min(1, result[sector]["budget_used"][index] / result[sector]["budget_allocated"][index]) if result[sector]["budget_allocated"][index] > 0 else 1
                factor = capital_share * baseline_eff
                expected = max(.05 * combined["gdp_real_local"][index] - base[index], 0) * factor
                self.assertAlmostEqual(combined[sector]["scenario_financial_commitment_cash"][index],
                                       result[sector]["scenario_financial_commitment_cash"][index] + expected)
                self.assertEqual(combined[sector]["bau_hh"], result[sector]["bau_hh"])
                case["toggles"][prefix + "_financial_commitment_enabled"] = False
                disabled = calculate(coerce_to_engine(case))
                self.assertTrue(all(value == 0 for value in disabled[sector]["scenario_financial_commitment_cash"]))

    def test_entered_spending_including_zero_is_not_replaced(self):
        for share in (0, .03):
            inputs = self.drc()["inputs"]
            for prefix in ("ws", "san"):
                inputs["macro"][prefix + "_budget_pct_gdp"] = share
            result = calculate(coerce_to_engine(inputs))
            for sector in ("water_supply", "sanitation"):
                self.assertEqual(result[sector]["baseline_spending_reference_source"], "entered_total_spending")
                self.assertAlmostEqual(result[sector]["baseline_bau_total_spending_share"], share)

    def test_invalid_growth_schedule_does_not_overflow(self):
        inputs = self.drc()["inputs"]
        inputs["toggles"]["ws_financial_commitment_enabled"] = True
        inputs["water_interventions"].update(fin_growth_enabled=True, fin_growth_rate=.1, fin_growth_start_year=0)
        with self.assertRaisesRegex(FinancialCommitmentInputError, "positive start year"):
            calculate(coerce_to_engine(inputs))

    def test_zero_execution_does_not_create_estimated_spending(self):
        inputs = self.drc()["inputs"]
        inputs["macro"]["execution_rate"] = 0
        result = calculate(coerce_to_engine(inputs))
        for sector in ("water_supply", "sanitation"):
            self.assertIsNone(result[sector]["baseline_bau_total_spending_share"])
            self.assertEqual(result[sector]["baseline_spending_reference_source"], "unavailable_zero_capex_factor")

    def test_matches_commitment_base_for_both_sectors(self):
        inputs = frontend_defaults()
        result = calculate(coerce_to_engine(inputs))
        for sector, field in (
            ('water_supply', 'ws_budget_pct_gdp'),
            ('sanitation', 'san_budget_pct_gdp'),
        ):
            with self.subTest(sector=sector):
                self.assertAlmostEqual(
                    result[sector]['baseline_bau_total_spending_share'],
                    inputs['macro'][field])

        with_levers = copy.deepcopy(inputs)
        with_levers['toggles']['ws_financial_commitment_enabled'] = True
        with_levers['toggles']['ws_exogenous_injection_enabled'] = True
        with_levers['water_interventions'].update(
            fin_gdp_enabled=True, fin_gdp_target_share=0.05,
            fin_injection_amount=1000, fin_injection_start_year=2028)
        scenario = calculate(coerce_to_engine(with_levers))
        for sector in ('water_supply', 'sanitation'):
            self.assertEqual(
                scenario[sector]['baseline_bau_total_spending_share'],
                result[sector]['baseline_bau_total_spending_share'])

    def test_direct_budget_uses_baseline_total_expenditure_not_capex(self):
        inputs = frontend_defaults()
        inputs['macro']['budget_input_mode'] = 'direct'
        inputs['macro']['budget_source'] = 'direct'
        inputs['bau']['budget_input_mode'] = 'direct'
        inputs['bau']['budget_source'] = 'direct'
        baseline_index = inputs['period']['baseline_year'] - inputs['period']['model_start_year']
        water_budget = [1000.0] * (baseline_index + 1)
        sanitation_budget = [500.0] * (baseline_index + 1)
        inputs['bau']['ws_expend_ts'] = water_budget
        inputs['bau']['san_expend_ts'] = sanitation_budget
        result = calculate(coerce_to_engine(inputs))
        baseline_gdp = result['gdp_real_local'][baseline_index]
        self.assertGreater(baseline_gdp, 0)
        self.assertAlmostEqual(
            result['water_supply']['baseline_bau_total_spending_share'],
            water_budget[-1] / baseline_gdp)
        self.assertAlmostEqual(
            result['sanitation']['baseline_bau_total_spending_share'],
            sanitation_budget[-1] / baseline_gdp)


if __name__ == '__main__':
    unittest.main()