"""Replacement settlement: real balances, independent service obligations and restricted funds."""
import unittest
import random
import numpy as np
from model.source_funding import allocate_sources, allocate_purchases
from test_residual_financing_gap import fixture


class ReplacementBacklogTests(unittest.TestCase):
    def test_random_settlements_preserve_source_conservation(self):
        rng = random.Random(27)
        for _ in range(500):
            cash = {s: rng.uniform(-100, 400) for s in ('baseline', 'tariff', 'nrw')}
            need, opening = rng.uniform(0, 300), rng.uniform(0, 500)
            a = allocate_sources(cash, need, 20, ('tariff',), opening)
            ordinary = sum(a['expansion_available'].values())
            self.assertAlmostEqual(opening+need,a['replacement_paid_total']+a['replacement_backlog_closing'])
            if ordinary > 1e-8:
                self.assertAlmostEqual(a['replacement_backlog_closing'],0)
            allocate_purchases(a,ordinary*.2,ordinary*.3,ordinary*.1,80)
            for source, value in cash.items():
                self.assertAlmostEqual(max(value,0),sum(a[k][source] for k in (
                    'loss_charge','debt_charge','replacement_current_charge','replacement_backlog_charge',
                    'basic_capital_spent','sm_capital_spent','ancillary_spent','unused')))

    def test_backlog_is_not_cancelled_by_targets_or_cash_loss_repayment(self):
        for sanitation in (False,True):
            for full_target in (False,True):
                s=fixture([-5000,12000,50000],10000,years=4,sanitation=sanitation,fully_sm_target=full_target)
                np.testing.assert_allclose(np.array(s['replacement_backlog_closing'])*1e6,[0,10000,8000,0],atol=1e-7)
                np.testing.assert_allclose(np.sum(s['accumulated_cash_shortfall_by_service'],axis=0)*1e6,[0,5000,5000,5000],atol=1e-7)
                self.assertAlmostEqual(s['endline_financing_requirement'][-1]-s['financing_gap'][-1],.005)

    def test_allocator_acceptance(self):
        for f, r, b, cp, bp, close, exp in [
            (25,10,0,10,0,0,15), (5,10,5,5,0,10,0),
            (12,10,5,10,2,3,0), (15,10,5,10,5,0,0),
            (25,10,5,10,5,0,10), (8,0,5,0,5,0,3),
            (0,10,5,0,0,15,0)]:
            a = allocate_sources({'baseline': f*.3, 'tariff': f*.7}, r, replacement_backlog=b)
            self.assertAlmostEqual(a['replacement_paid'], cp)
            self.assertAlmostEqual(a['replacement_backlog_paid'], bp)
            self.assertAlmostEqual(a['replacement_backlog_closing'], close)
            self.assertAlmostEqual(sum(a['expansion_available'].values()), exp)
            self.assertAlmostEqual(b+r, cp+bp+close)
            allocate_purchases(a, exp*.3, exp*.5, exp*.2)
            for s, contribution in a['signed_contribution'].items():
                self.assertAlmostEqual(contribution, sum(a[k][s] for k in (
                    'loss_charge','debt_charge','replacement_current_charge','replacement_backlog_charge',
                    'basic_capital_spent','sm_capital_spent','ancillary_spent','unused')))

    def test_losses_and_selected_debt_precede_settlement(self):
        a = allocate_sources({'baseline': 20, 'tariff': 30, 'nrw': -10}, 10, 8, ('tariff',), 15)
        self.assertAlmostEqual(a['eligible_capital_after_losses_debt'], 32)
        self.assertEqual(a['replacement_backlog_paid'], 15)
        self.assertAlmostEqual(sum(a['expansion_available'].values()), 7)
        a = allocate_sources({'baseline': 2, 'nrw': -10}, 10, replacement_backlog=5)
        self.assertEqual(a['loss_unfunded'], 8)
        self.assertEqual(a['replacement_backlog_closing'], 15)
        self.assertEqual(a['replacement_paid_total'], 0)

    def test_multiyear_both_sectors_and_restricted_loans(self):
        for sanitation in (False, True):
            s = fixture([5000,25000,25000],10000,years=4,sanitation=sanitation)
            for key, values in {
                'replacement_current_paid':[0,5000,10000,310000/30],
                'replacement_backlog_opening':[0,0,5000,0],
                'replacement_backlog_paid':[0,0,5000,0],
                'replacement_backlog_closing':[0,5000,0,0],
            }.items():
                np.testing.assert_allclose(np.array(s[key])*1e6,values,atol=1e-7)
            self.assertAlmostEqual((s['bau_hh'][0][2]-s['bau_hh'][0][1])*1e6,10)
            self.assertAlmostEqual(s['funded_asset_stock'][2]*1e6,310000)
            for key in ('replacement_backlog_opening','replacement_current_paid','replacement_backlog_paid',
                        'replacement_backlog_closing','replacement_paid_total'):
                np.testing.assert_allclose(np.sum(s[key+'_by_service'],axis=0),s[key],atol=1e-10)
            for i in range(1,4):
                np.testing.assert_allclose(
                    np.array(s['replacement_backlog_opening_by_service'])[:,i] + np.array(s['replacement_by_service'])[:,i],
                    np.array(s['replacement_current_paid_by_service'])[:,i] + np.array(s['replacement_backlog_paid_by_service'])[:,i] + np.array(s['replacement_backlog_closing_by_service'])[:,i])
                self.assertAlmostEqual(s['financing_gap'][i],s['new_capex_total'][i]+s['replacement_backlog_closing'][i]+s['cash_deficit'][i])
            loan = fixture([5000,5000,5000],10000,years=4,sanitation=sanitation,debt_cash=[0,20000,0,0])
            self.assertGreater(loan['replacement_backlog_closing'][1],0)
            self.assertGreater(loan['utility_debt_investment_used'][1],0)
            self.assertEqual(loan['replacement_backlog_paid'][1],0)
            self.assertEqual(loan['ordinary_expansion_available'][1],0)
            carry = fixture([0,0,0],10000,years=4,sanitation=sanitation,debt_cash=[0,1000000,0,0])
            self.assertGreater(carry['utility_debt_cash_closing'][1],0)
            self.assertAlmostEqual(carry['utility_debt_cash_closing'][1],carry['utility_debt_cash_available'][2])
            self.assertGreater(carry['replacement_backlog_closing'][2],0)
            short = fixture([0,5000,50000],10000,years=4,sanitation=sanitation)
            np.testing.assert_allclose(np.array(short['replacement_backlog_closing'])*1e6,[0,10000,15000,0],atol=1e-7)

if __name__ == '__main__':
    unittest.main()
