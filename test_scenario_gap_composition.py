"""The dashboard's scenario spending ledger must reconcile for each service level."""

import copy
import unittest

from demo_adapter import coerce_to_engine, frontend_defaults
from model.engine import calculate


class ScenarioGapCompositionTests(unittest.TestCase):
    def test_no_interventions_match_bau_and_scenario_ledgers_reconcile(self):
        inputs = frontend_defaults()
        off = calculate(coerce_to_engine(inputs))

        cases = [
            copy.deepcopy(inputs),
            copy.deepcopy(inputs),
            copy.deepcopy(inputs),
            copy.deepcopy(inputs),
            copy.deepcopy(inputs),
            copy.deepcopy(inputs),
        ]
        cases[1]['toggles']['ws_exogenous_injection_enabled'] = True
        cases[1]['toggles']['san_exogenous_injection_enabled'] = True
        for section in ('water_interventions', 'sanitation_interventions'):
            cases[1][section].update(
                fin_injection_amount=1000, fin_injection_start_year=2028,
                fin_injection_mode='recurring',
            )
        cases[2]['toggles']['ws_financial_commitment_enabled'] = True
        cases[2]['toggles']['san_financial_commitment_enabled'] = True
        for section in ('water_interventions', 'sanitation_interventions'):
            cases[2][section].update(fin_gdp_enabled=True, fin_gdp_start_year=2028,
                                     fin_gdp_target_share=0.05, basic_share=0.5)
        cases[3]['toggles']['ws_costeff_enabled'] = True
        cases[3]['toggles']['san_costeff_enabled'] = True
        for prefix, section in (('ws', 'water_interventions'), ('san', 'sanitation_interventions')):
            cases[4]['toggles'][f'{prefix}_exogenous_injection_enabled'] = True
            cases[4][section].update(fin_injection_amount=1e9, fin_injection_start_year=2028,
                                     fin_injection_mode='recurring')
            cases[5]['toggles'][f'{prefix}_microfinance_enabled'] = True
            cases[5][section].update(mf_takeup_rate=1, grant_total=100000)

        for case_idx, case in enumerate(cases):
            result = calculate(coerce_to_engine(case))
            for sector in ('water_supply', 'sanitation'):
                with self.subTest(case=case_idx, sector=sector):
                    sec = result[sector]
                    if case_idx in (1, 3, 4, 5):
                        for name in ('bau_hh', 'target_hh', 'financing_gap'):
                            self.assertEqual(sec[name], off[sector][name])
                    if case_idx == 5:
                        self.assertGreater(sec['scenario_mf_loan_volume'][-1], 0)
                        self.assertGreater(sec['scenario_grant_spend'][-1], 0)
                        for key in ('scenario_mf_loan_volume', 'scenario_grant_spend'):
                            flows = [sec[key][i] - sec[key][i - 1]
                                     for i, y in enumerate(result['years']) if y > case['period']['baseline_year']]
                            self.assertAlmostEqual(sum(flows), sec[key][-1], places=5)
                    for i, year in enumerate(result['years']):
                        if year <= case['period']['baseline_year']:
                            continue
                        with self.subTest(year=year):
                            def rung_sum(name):
                                return sum(row[i] for row in sec[name])

                            self.assertAlmostEqual(rung_sum('scenario_new_capex_by_service'),
                                                   sec['scenario_new_capex_total'][i], places=5)
                            self.assertAlmostEqual(rung_sum('scenario_replacement_by_service'),
                                                   sec['scenario_replacement_capex'][i], places=5)
                            self.assertAlmostEqual(rung_sum('scenario_financing_gap_by_service'),
                                                   sec['scenario_financing_gap'][i], places=5)
                            available = sec['scenario_available_total'][i]
                            need = sec['scenario_total_investment_need'][i]
                            paid = rung_sum('scenario_funded_by_service')
                            self.assertAlmostEqual(paid, min(max(available, 0), need), places=5)
                            self.assertAlmostEqual(need + max(0, -available),
                                                   paid + sec['scenario_financing_gap'][i], places=5)
                            self.assertAlmostEqual(
                                sec['scenario_financing_gap'][i],
                                max(0, sec['scenario_total_investment_need'][i] -
                                    sec['scenario_available_total'][i]), places=5)
                            self.assertAlmostEqual(
                                sec['scenario_available_total'][i],
                                sum(sec[name][i] for name in (
                                    'scenario_public_capital', 'scenario_other_capital',
                                    'scenario_cash_allocated_to_direct_investment',
                                    'scenario_loan_drawdown'))
                                + (sec['scenario_cash_carry_forward'][i - 1] if i > 0 else 0.0),
                                places=5)
                            self.assertAlmostEqual(
                                sec['scenario_additional_net_utility_cash'][i],
                                sum(sec[name][i] for name in (
                                    'scenario_collection_cash', 'scenario_tariff_cash',
                                    'scenario_nrw_net', 'scenario_nrw_link_cash',
                                    'scenario_custom_revenue_cash')),
                                places=5)
                            if case_idx == 0:
                                self.assertAlmostEqual(sec['scenario_financing_gap'][i],
                                                       sec['financing_gap'][i], places=5)
                                for name in ('new_capex_by_service', 'replacement_by_service',
                                             'funded_by_service', 'financing_gap_by_service'):
                                    self.assertEqual(sec['scenario_' + name], sec[name])
                            if case_idx == 3:
                                self.assertAlmostEqual(sec['scenario_available_total'][i],
                                                       sec['bau_available'][i], places=5)
                            if case_idx == 4 and year >= 2028:
                                self.assertGreater(available - paid, 0)


if __name__ == '__main__':
    unittest.main()