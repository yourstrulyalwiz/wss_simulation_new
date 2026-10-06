"""Exact source reporting must explain, not change, legacy model balances."""
import copy
import unittest

import numpy as np

from demo_adapter import coerce_to_engine
from model.engine import calculate
from model.expansion_ledger import ExpansionLedger
from test_utility_revenue import example


def report_step(ledger, t, target=(.1, 99.9), costs=(1000, 1000), sector=(0, 0),
                external=(0, 0), physical=(0, 0), unpaid=(0, 0), cash=(0, 0),
                ancillary=0, spare=0):
    return ledger.step(
        t, target, costs, sector, external, physical, replacement=10,
        unpaid_by_service=unpaid, deficit_by_service=cash,
        ancillary_cost=ancillary, spare_capital=spare, asset_stock=0,
        sector_capital=np.dot(sector, costs), external_capital=np.dot(external, costs))


class FinancingReportingTests(unittest.TestCase):
    def test_separate_ancillary_household_payment_and_noncash_snapshots(self):
        ledger = ExpansionLedger(0, 100, 3)
        report_step(ledger, 1, sector=(.04, 0), external=(.01, 0),
                    physical=(.02, 0), ancillary=7, spare=3, unpaid=(2, 3), cash=(1, 2))
        s = ledger.series
        np.testing.assert_allclose(
            s['household_expansion_paid_by_service'],
            s['sector_household_expansion_paid_by_service'] + s['externally_funded_expansion_by_service'])
        np.testing.assert_allclose(
            s['sector_funded_expansion_by_service'],
            s['sector_household_expansion_paid_by_service'] + s['ancillary_paid_by_service'])
        for key, expected in [
            ('scheduled_household_expansion_by_service', [100, 0]),
            ('prefunding_household_expansion_by_service', [100, 0]),
            ('prefunding_ancillary_by_service', [7, 0]),
            ('closing_household_expansion_by_service', [30, 0]),
            ('closing_ancillary_by_service', [4, 0]),
            ('household_expansion_paid_by_service', [50, 0]),
            ('ancillary_paid_by_service', [3, 0]),
            ('noncash_delivery_credit_by_service', [20, 0]),
        ]:
            np.testing.assert_allclose(s[key][:, 1], expected)
        np.testing.assert_allclose(s['noncash_delivery_hh_by_service'][:, 1], [.02, 0])
        self.assertAlmostEqual(s['catch_up_requirement'][1], 117)
        self.assertAlmostEqual(s['endline_financing_requirement'][1], 42)
        report_step(ledger, 2, ancillary=7, spare=5)
        np.testing.assert_allclose(s['prefunding_ancillary_by_service'][:, 2], [4, 0])
        np.testing.assert_allclose(s['new_ancillary_commitment_by_service'][:, 2], [0, 0])
        np.testing.assert_allclose(s['closing_ancillary_by_service'][:, 2], [0, 0])

    def test_legacy_replacement_counter_is_preserved_not_paid_down(self):
        ledger = ExpansionLedger(0, 100, 4)
        report_step(ledger, 1, unpaid=(4, 0), cash=(1, 0))
        report_step(ledger, 2, unpaid=(3, 0), cash=(0, 2))
        # More expansion capital must not silently settle historical replacement.
        report_step(ledger, 3, sector=(.1, 0), spare=20)
        s = ledger.series
        np.testing.assert_allclose(s['accumulated_replacement_shortfall_by_service'][0], [0, 4, 7, 7])
        np.testing.assert_allclose(s['prior_replacement_shortfall_by_service'][0], [0, 0, 4, 7])
        np.testing.assert_allclose(s['accumulated_cash_shortfall_by_service'][:, 3], [1, 2])
        np.testing.assert_allclose(s['accumulated_shortfalls_by_service'][:, 3], [8, 2])
        self.assertAlmostEqual(s['endline_financing_requirement'][3], 10)

    def test_repricing_target_reduction_and_advance_are_reporting_only(self):
        ledger = ExpansionLedger(0, 100, 5)
        report_step(ledger, 1, sector=(.04, 0))
        report_step(ledger, 2, costs=(2000, 2000))
        np.testing.assert_allclose(ledger.series['outstanding_repricing_by_service'][:, 2], [60, 0])
        report_step(ledger, 3, target=(.05, 99.95), costs=(2000, 2000), sector=(.08, 0))
        np.testing.assert_allclose(ledger.series['cancelled_household_expansion_cost_by_service'][:, 3], [100, 0])
        report_step(ledger, 4, target=(.1, 99.9), costs=(2000, 2000))
        np.testing.assert_allclose(ledger.series['scheduled_household_expansion_by_service'][:, 4], [100, 0])
        np.testing.assert_allclose(ledger.series['prefunding_household_expansion_by_service'][:, 4], [0, 0])
        np.testing.assert_allclose(ledger.series['advance_delivery_credit_by_service'][:, 4], [100, 0])
        self.assertEqual(ledger.series['closing_outstanding_expansion'][4], 0)

    def test_engine_mapping_reconciles_each_service_sector_and_pass(self):
        inputs = example()
        for toggles in (inputs['toggles'], {key: False for key in inputs['toggles']}):
            inputs = copy.deepcopy(inputs)
            inputs['toggles'] = toggles
            result = calculate(coerce_to_engine(inputs))
            for sector in ('water_supply', 'sanitation'):
                sec = result[sector]
                for prefix in ('', 'scenario_'):
                    with self.subTest(sector=sector, prefix=prefix):
                        get = lambda key: np.asarray(sec[prefix + key])
                        np.testing.assert_allclose(
                            get('closing_household_expansion_by_service') + get('closing_ancillary_by_service'),
                            get('closing_outstanding_expansion_by_service'))
                        np.testing.assert_allclose(
                            get('prefunding_household_expansion_by_service') + get('prefunding_ancillary_by_service'),
                            get('prefunding_expansion_cost_by_service'))
                        np.testing.assert_allclose(
                            get('scheduled_household_expansion_by_service') + get('new_ancillary_commitment_by_service'),
                            get('annual_planned_expansion_cost_by_service'))
                        np.testing.assert_allclose(
                            get('prior_replacement_shortfall_by_service') + get('current_unpaid_replacement_by_service'),
                            get('accumulated_replacement_shortfall_by_service'))
                        np.testing.assert_allclose(
                            get('prior_cash_shortfall_by_service') + get('current_cash_shortfall_by_service'),
                            get('accumulated_cash_shortfall_by_service'))
                        np.testing.assert_allclose(
                            get('accumulated_replacement_shortfall_by_service') + get('accumulated_cash_shortfall_by_service'),
                            get('accumulated_shortfalls_by_service'))
                        np.testing.assert_allclose(
                            get('closing_household_expansion_by_service') + get('closing_ancillary_by_service')
                            + get('accumulated_replacement_shortfall_by_service') + get('accumulated_cash_shortfall_by_service'),
                            get('endline_financing_requirement_by_service'))
                        np.testing.assert_allclose(
                            get('household_expansion_paid_by_service') + get('ancillary_paid_by_service'),
                            get('sector_funded_expansion_by_service') + get('externally_funded_expansion_by_service'))


if __name__ == '__main__':
    unittest.main()
