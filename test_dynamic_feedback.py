"""Controlled acceptance examples for the October 13 continuation."""
import copy
import unittest
import numpy as np
from test_consolidated_revenue import project
from model.engine import calculate
from model.revenue_reconciliation import reconcile_revenue


class DynamicFeedbackTests(unittest.TestCase):
    def test_growth_floor_with_variable_gdp_and_bau_override(self):
        from test_budget_forecast import BudgetForecastTests
        m = BudgetForecastTests().fixture(.0286, .143)
        m.toggles.ws_financial_commitment_enabled = True
        iv = m.water_interventions
        iv.fin_gdp_enabled = False
        iv.fin_growth_enabled = True
        iv.fin_growth_rate = .1
        iv.fin_growth_start_year, iv.fin_growth_end_year = 2028, 2030
        years = list(range(m.period.model_start_year, m.period.forecast_end_year+1))
        m.macro.gdp_real_local = [100 * 1.05**max(0,y-2030) for y in years]
        # Explicit declining BAU after the window must not drag the held share down.
        m.wss_budget.ws_budget_direct = [.0286 if y <= 2030 else .01 for y in years]
        m.wss_budget.ws_budget_allocated = [.2 for y in years]
        r = calculate(m)
        for y, expected in [(2027,.0286),(2028,.03146),(2029,.034606),(2030,.0380666),(2031,.0380666),(2035,.0380666)]:
            i=years.index(y);s=r['water_supply']
            self.assertAlmostEqual((s['budget_used'][i]+s['scenario_financial_commitment_cash'][i])/r['gdp_real_local'][i]*100,expected)
        iv.fin_growth_rate = 0
        self.assertEqual(sum(calculate(m)['water_supply']['scenario_financial_commitment_cash']),0)

    def test_generated_and_admitted_identities_signed_rates(self):
        for admitted in [False, True]:
            r = reconcile_revenue(120,100,10,5,2,.8,1.5,.7,
                                  implementation_cost=3,avoided_cost=4,connection_funding=admitted)
            self.assertEqual(r['connection_revenue_delta'],24)
            self.assertEqual(r['connection_net_cash'],24 if admitted else 0)
            self.assertAlmostEqual(r['additional_net_cash'],
                r['collected_revenue']-r['reference_collected_revenue']-r['connection_excluded_receipts']+1)
            self.assertLess(r['collection_cash'],0)
            self.assertLess(r['tariff_cash'],0)

    def dynamic(self, funding=False, n=5, **kw):
        return project(n=n, initial=(.1,.2,.7,0,0),
            full_budget=np.array([0.]+[10.]*(n-1)), basic_share=.5,
            ce_current_ratio=.8, ce_enabled=True, ce_start=2026,
            ce_target_year=2026, ce_target_ratio=.9,
            connection_config=dict(enabled=funding,new_billed_share_basic=.5,new_billed_share_sm=1.),
            **kw)

    def test_funding_off_still_expands_volume_and_collection(self):
        r = self.dynamic()
        self.assertEqual(sum(r['connection_net_cash']),0)
        self.assertGreater(r['connection_revenue_delta'][2],0)
        self.assertGreater(r['billed_volume_million_m3'][2],r['billed_volume_million_m3'][1])
        self.assertGreater(r['collection_cash'][2],r['collection_cash'][1])
        on = self.dynamic(True)
        self.assertEqual(on['billed_volume_million_m3'][2],r['billed_volume_million_m3'][2])
        self.assertEqual(on['connection_revenue_delta'][2],r['connection_revenue_delta'][2])
        self.assertGreater(on['connection_net_cash'][2],0)
        self.assertEqual(r['connection_revenue']['volume_mode'],'dynamic')
        for rung in ['basic','sm']:
            np.testing.assert_allclose(r['coverage_attribution']['reconciliation_error'][rung],0,atol=1e-10)

    def test_dynamic_nrw_and_works_cost(self):
        r = self.dynamic(nrw_enabled=True,nrw_physical=0,nrw_capex_unit_m3day=.01)
        self.assertGreater(r['nrw_dynamic_system_input_million_m3'][2],100)
        self.assertGreater(r['nrw_implementation_cost'][2],0)
        no_input = self.dynamic(nrw_enabled=True,nrw_vol_m3yr=0,nrw_vol_m3day=0)
        self.assertEqual(sum(no_input['nrw_recovered_phys_vol']),0)

    def test_public_spending_affects_following_year_ce_not_same_year(self):
        base = self.dynamic()
        public = self.dynamic(financial_enabled=True, financial_settings=dict(
            growth_enabled=True,growth_rate=.5,growth_start_year=2026,growth_end_year=2027))
        self.assertEqual(base['billed_volume_million_m3'][1],public['billed_volume_million_m3'][1])
        self.assertGreater(public['bau_hh'][0][1],base['bau_hh'][0][1])
        self.assertGreater(public['collection_cash'][2],base['collection_cash'][2])
        self.assertEqual(sum(public['connection_net_cash']),0)

    def test_dynamic_loan_reference_and_frozen_principal(self):
        from types import SimpleNamespace
        from model.utility_debt import solve_scenario
        inputs = SimpleNamespace(period=SimpleNamespace(baseline_year=2025))
        cfg = dict(enabled=True,mode='indicative_lump_sum',allocation_share=.5,
            annual_real_interest_rate=.05,loan_term_years=10,disbursement_year=2027,
            revenue_sources=['collection'])
        fn = lambda inputs,ctx,utility_debt_execution=None: self.dynamic(
            n=11,asset_life=30,utility_debt_execution=utility_debt_execution)
        financed, _, debt, reference = solve_scenario(
            fn,inputs,{'years':list(range(2025,2036))},cfg)
        self.assertEqual(reference,fn(inputs,{}))
        self.assertAlmostEqual(debt['indicative_principal'],
            reference['collection_cash'][2]*.5*debt['annuity_factor'])
        self.assertGreater(financed['bau_hh'][0][2],reference['bau_hh'][0][2])
        self.assertGreater(financed['billed_volume_million_m3'][3],reference['billed_volume_million_m3'][3])
        self.assertEqual(financed['utility_debt_service'][2],0)
        self.assertGreater(financed['utility_debt_service'][3],0)
