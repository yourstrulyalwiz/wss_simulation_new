"""Regression checks for BAU service-level financing-gap attribution."""

import copy
import unittest

from demo_adapter import coerce_to_engine, frontend_defaults
from export_data import per_year_table
from model.engine import calculate
from model.gap_attribution import attribute_gap


class GapAttributionTests(unittest.TestCase):
    def test_replacement_is_funded_by_actual_obligation_not_new_investment_split(self):
        sm_gap, basic_gap, sm_paid, basic_paid = attribute_gap(
            30, 40, 80, 20, 50, 0.0)
        self.assertEqual((sm_paid, basic_paid), (40, 10))
        self.assertEqual((sm_gap, basic_gap), (70, 50))
        self.assertEqual(sm_gap + basic_gap, 120)

    def test_residual_new_service_cost_gets_no_second_credit(self):
        for basic_share in (0.0, 0.4, 1.0):
            with self.subTest(basic_share=basic_share):
                sm_gap, basic_gap, sm_paid, basic_paid = attribute_gap(
                    50, 10, 0, 0, 70, basic_share)
                self.assertEqual((sm_gap, basic_gap), (50, 10))
                self.assertEqual(sm_paid + basic_paid, 0)

    def test_negative_available_still_reconciles(self):
        sm_gap, basic_gap, sm_paid, basic_paid = attribute_gap(30, 10, 60, 0, 0, 0.4, 20)
        self.assertEqual(sm_paid + basic_paid, 0)
        self.assertAlmostEqual(sm_gap + basic_gap, 120)

    def test_model_components_and_exports_reconcile_in_both_sectors(self):
        for basic_share in (0.0, 0.4, 1.0):
            inputs = frontend_defaults()
            inputs['water_interventions']['basic_share'] = basic_share
            inputs['sanitation_interventions']['basic_share'] = basic_share
            result = calculate(coerce_to_engine(inputs))
            for sector in ('water_supply', 'sanitation'):
                with self.subTest(basic_share=basic_share, sector=sector):
                    sec = result[sector]
                    headers, rows = per_year_table(result, inputs, sector)
                    total_i = headers.index('Financing gap — BAU sector-wide (NPR M)')
                    sm_i = headers.index('Financing gap — BAU safely-managed (NPR M)')
                    basic_i = headers.index('Financing gap — BAU basic (NPR M)')
                    self.assertTrue(any(x > 0 for x in sec['financing_gap']))
                    for i, year in enumerate(result['years']):
                        with self.subTest(year=year):
                            self.assertAlmostEqual(
                                sum(service[i] for service in sec['new_capex_by_service']),
                                sec['new_capex_total'][i], delta=1e-5)
                            self.assertAlmostEqual(
                                sum(service[i] for service in sec['replacement_by_service']),
                                sec['replacement_capex'][i], delta=1e-5)
                            self.assertAlmostEqual(
                                sum(service[i] for service in sec['financing_gap_by_service']),
                                sec['financing_gap'][i], delta=1e-5)
                            self.assertGreaterEqual(sec['financing_gap_by_service'][0][i], 0)
                            self.assertGreaterEqual(sec['financing_gap_by_service'][1][i], 0)
                            self.assertAlmostEqual(rows[i][sm_i] + rows[i][basic_i],
                                                   rows[i][total_i], delta=0.00011)

    def test_bau_attribution_does_not_move_when_scenario_is_enabled(self):
        inputs = frontend_defaults()
        inputs['water_interventions']['basic_share'] = 0.4
        baseline = calculate(coerce_to_engine(inputs))
        scenario_inputs = copy.deepcopy(inputs)
        scenario_inputs['toggles']['ws_exogenous_injection_enabled'] = True
        scenario_inputs['water_interventions'].update(
            fin_injection_amount=1000, fin_injection_start_year=2028)
        scenario = calculate(coerce_to_engine(scenario_inputs))
        for sector in ('water_supply', 'sanitation'):
            for key in ('bau_hh', 'financing_gap', 'financing_gap_by_service'):
                self.assertEqual(baseline[sector][key], scenario[sector][key])

    def test_urban_rural_attribution_sums_to_national_gap(self):
        urban_inputs = frontend_defaults()
        rural_inputs = copy.deepcopy(urban_inputs)
        rural_inputs['country_config']['area'] = 'Rural'
        rural_inputs['water_interventions']['basic_share'] = 0.4
        rural_inputs['sanitation_interventions']['basic_share'] = 0.4
        urban = calculate(coerce_to_engine(urban_inputs))
        rural = calculate(coerce_to_engine(rural_inputs))
        for sector in ('water_supply', 'sanitation'):
            for i, _ in enumerate(urban['years']):
                national_total = sum(result[sector]['financing_gap'][i]
                                     for result in (urban, rural))
                national_sm = sum(result[sector]['financing_gap_by_service'][0][i]
                                  for result in (urban, rural))
                national_basic = sum(result[sector]['financing_gap_by_service'][1][i]
                                     for result in (urban, rural))
                self.assertAlmostEqual(national_sm + national_basic, national_total,
                                       delta=1e-5)


if __name__ == '__main__':
    unittest.main()