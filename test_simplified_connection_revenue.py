"""v3 operating-cost behavior is superseded; preserve migration/audit, never its gates."""
import unittest
from model.connection_revenue import migrate_connection, prepare_connection
from test_connection_revenue import fixture
from model.revenue_reconciliation import reconcile_revenue


class SimplifiedConnectionTests(unittest.TestCase):
    def test_all_old_cost_methods_are_inactive(self):
        ctx,hist,base = fixture()
        for method in ('per_m3','annual_household','expenditure_proxy'):
            old = dict(version=3, enabled=True,new_billed_share_basic=.5,new_billed_share_sm=.9,
                       cost_basis=method,cost_proxy=None,annual_cost_per_household=99999,
                       marginal_cost=99999,provenance={},reference_confirmed=False)
            status,_ = prepare_connection(old,base,ctx,hist)
            self.assertTrue(status['effective'], status)
            saved = migrate_connection(old)
            self.assertEqual(saved['legacy_parameters']['cost_basis'], method)
            self.assertEqual(saved,migrate_connection(saved))

    def test_legacy_cost_argument_cannot_return_to_ledger(self):
        zero = reconcile_revenue(1200,1000,100,20,2,.8,3,.9,0,50)
        old = reconcile_revenue(1200,1000,100,20,2,.8,3,.9,99999,50)
        self.assertEqual(zero,old)
        self.assertEqual(old['additional_net_cash'],1806)
