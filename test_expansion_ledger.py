import unittest
import numpy as np
from model.expansion_ledger import ExpansionLedger
from test_residual_financing_gap import fixture
from demo_adapter import frontend_defaults, coerce_to_engine
from model.engine import calculate
from deck_aggregate import aggregate


def step(ledger, t, sm, basic, funded=0, cost=1000, physical=0, external=0, ancillary=0, spare=0):
    return ledger.step(t, [sm, basic], [cost, cost], [funded, 0],
                       [external, 0], [physical, 0], replacement=0,
                       unpaid_by_service=[0, 0], deficit_by_service=[0, 0],
                       ancillary_cost=ancillary, spare_capital=spare, asset_stock=0,
                       sector_capital=funded * cost, external_capital=external * cost)


class ExpansionLedgerTests(unittest.TestCase):
    def test_carry_forward_and_catch_up(self):
        ledger = ExpansionLedger(0, 100, 5)
        for t in range(1, 4):
            step(ledger, t, .02*t, 100-.02*t, funded=.012)
        np.testing.assert_allclose(ledger.series['closing_outstanding_expansion'][1:4], [8,16,24])
        self.assertAlmostEqual(sum(ledger.series['annual_planned_expansion_cost']), 60)
        self.assertAlmostEqual(sum(ledger.series['sector_funded_expansion']), 36)
        step(ledger, 4, .06, 99.94, funded=.024)
        self.assertAlmostEqual(ledger.series['closing_outstanding_expansion'][4], 0)
        self.assertAlmostEqual(ledger.series['annual_planned_expansion_cost'][4], 0)

    def test_repricing_reduction_and_advance(self):
        ledger = ExpansionLedger(0, 100, 6)
        step(ledger, 1, .1, 99.9, funded=.04)
        step(ledger, 2, .1, 99.9, cost=2000)
        self.assertAlmostEqual(ledger.series['closing_outstanding_expansion'][2], 120)
        step(ledger, 3, .05, 99.95, cost=2000)
        self.assertAlmostEqual(ledger.series['closing_outstanding_expansion'][3], 20)
        step(ledger, 4, .05, 99.95, funded=.06)
        step(ledger, 5, .1, 99.9)
        self.assertAlmostEqual(ledger.series['closing_outstanding_expansion'][5], 0)

    def test_basic_transition_not_exclusive_basic_change(self):
        ledger = ExpansionLedger(10, 20, 2)
        step(ledger, 1, 20, 20)
        np.testing.assert_allclose(ledger.series['planned_expansion_hh'][:, 1], [10, 10])

    def test_external_physical_and_fixed_ancillary_once(self):
        ledger = ExpansionLedger(0, 100, 4)
        step(ledger, 1, .1, 99.9, physical=.02, external=.03, ancillary=7)
        step(ledger, 2, .1, 99.9, ancillary=7, spare=3)
        step(ledger, 3, .1, 99.9, ancillary=7, spare=10)
        np.testing.assert_allclose(ledger.series['ancillary_outstanding'][1:], [7,4,0])
        np.testing.assert_allclose(ledger.series['ancillary_paid'][1:], [0,3,4])
        self.assertAlmostEqual(sum(ledger.series['annual_planned_expansion_cost']), 107)
        self.assertAlmostEqual(ledger.series['closing_outstanding_expansion'][3], 50)

    def test_funded_stock_only_in_both_sector_modes(self):
        for sanitation in (False, True):
            example = fixture(50e6, 10e6, years=3, sanitation=sanitation, opening_stock=100e6)
            self.assertAlmostEqual(example['replacement_capex'][1], 10)
            self.assertAlmostEqual(example['sector_funded_expansion'][1], 40)
            self.assertAlmostEqual(example['funded_asset_stock'][1], 140)
            self.assertAlmostEqual(example['replacement_capex'][2], 14)
            no_funds = fixture(0, 10000, years=4, sanitation=sanitation)
            np.testing.assert_allclose(no_funds['funded_asset_stock'], [.3]*4)
            np.testing.assert_allclose(no_funds['replacement_capex'], [0,.01,.01,.01])
            self.assertAlmostEqual(no_funds['endline_financing_requirement'][-1], .13)
            paid = fixture(50000, 30000, years=3, sanitation=sanitation)
            # $300k existing, 10% replacement, $50k cash => $20k expansion.
            self.assertAlmostEqual(paid['funded_asset_stock'][1], .32)
            self.assertAlmostEqual(paid['replacement_capex'][2], .032)
            negative = fixture(-5000, 10000, years=4, sanitation=sanitation)
            np.testing.assert_allclose(negative['funded_asset_stock'], [.3]*4)
            self.assertAlmostEqual(negative['endline_financing_requirement'][-1], .145)

    def test_geographic_sum_and_counterfactual(self):
        inputs = frontend_defaults()
        a = calculate(coerce_to_engine(inputs))
        national = aggregate([a, a])
        for sector in ('water_supply', 'sanitation'):
            np.testing.assert_allclose(national[sector]['endline_financing_requirement'],
                                       np.array(a[sector]['endline_financing_requirement'])*2)
            sec = a[sector]
            np.testing.assert_allclose(np.sum(sec['endline_financing_requirement_by_service'], axis=0),
                                       sec['endline_financing_requirement'])
        inputs['toggles']['ws_tariff'] = True
        b = calculate(coerce_to_engine(inputs))
        for sector in ('water_supply', 'sanitation'):
            self.assertEqual(a[sector]['funded_asset_stock'], b[sector]['funded_asset_stock'])


if __name__ == '__main__':
    unittest.main()