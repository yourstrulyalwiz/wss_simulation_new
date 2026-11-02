import unittest
import numpy as np
from model.source_funding import allocate_sources, allocate_purchases
from test_residual_financing_gap import fixture


class TreatmentPriorityTests(unittest.TestCase):
    def test_order_and_source_conservation(self):
        for cash in (0, 5, 20, 30, 45, 60, 100):
            a = allocate_sources({'baseline': cash*.6, 'tariff': cash*.4},
                                 replacement_due=20, replacement_backlog=10, treatment_backlog=15)
            paid = min(15, max(0, cash-30))
            self.assertAlmostEqual(a['treatment_backlog_paid'], paid)
            self.assertAlmostEqual(sum(a['expansion_available'].values()), max(0, cash-45))
            available = sum(a['expansion_available'].values())
            allocate_purchases(a, available, 0, 0)
            for s, contribution in a['signed_contribution'].items():
                self.assertAlmostEqual(contribution, sum(a[k][s] for k in (
                    'loss_charge', 'debt_charge', 'replacement_charge',
                    'basic_capital_spent', 'sm_capital_spent', 'ancillary_spent', 'unused')))

    def test_restricted_loan_does_not_settle_treatment(self):
        a = allocate_sources({'baseline': 0}, treatment_backlog=15)
        allocate_purchases(a, 10, 0, 0, loan_available=10)
        self.assertEqual(a['treatment_backlog_paid'], 0)
        self.assertEqual(a['ancillary_spent']['loan'], 0)

    def test_multiyear_partial_payment_and_no_repeat_charge(self):
        for sanitation in (False, True):
            r = fixture([0, 10000, 30000, 30000], 0, years=5,
                        capex_adder=.025, sanitation=sanitation)
            np.testing.assert_allclose(r['treatment_backlog_opening'], [0, 0, .025, .015, 0], atol=1e-10)
            np.testing.assert_allclose(r['treatment_backlog_paid'], [0, 0, .01, .015, 0], atol=1e-10)
            np.testing.assert_allclose(r['ordinary_expansion_available'], [0, 0, 0, .015, .03], atol=1e-10)
            np.testing.assert_allclose(r['ancillary_outstanding'], [0, .025, .015, 0, 0], atol=1e-10)
            np.testing.assert_allclose(r['ancillary_paid'], [0, 0, .01, .015, 0], atol=1e-10)
            for t in range(1, 5):
                a = r['source_funding']
                self.assertAlmostEqual(sum(a['ancillary_spent'][s][t] for s in a['source_keys']),
                                       r['ancillary_paid'][t])
                self.assertAlmostEqual(r['funded_asset_stock'][t] - r['funded_asset_stock'][t-1],
                                       r['connection_purchase_capital'][t] + r['ancillary_paid'][t])

    def test_replacement_precedes_treatment_in_simulation(self):
        r = fixture([0, 25000], 10000, years=3, capex_adder=.025)
        self.assertAlmostEqual(r['replacement_paid_total'][2], .02)
        self.assertAlmostEqual(r['treatment_backlog_paid'][2], .005)
        self.assertAlmostEqual(r['ordinary_expansion_available'][2], 0)


if __name__ == '__main__':
    unittest.main()
