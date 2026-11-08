"""Eligible sales and production savings: numerical and integrated acceptance cases."""
import copy
import unittest
import numpy as np
from model.nrw_allocation import allocate_recovery, ALLOCATION_FIELDS
from model.utility_revenue import RevenueInputError
from model.engine import calculate, build_context
from model.sanitation import calculate_sanitation
from demo_adapter import coerce_to_engine
from simulation_management.blank import blank_inputs
from test_utility_revenue import example
from test_consolidated_revenue import project
from deck_aggregate import aggregate
from revenue_export import revenue_table
from intervention_validation import validate_interventions


class NrwAllocationTests(unittest.TestCase):
    def case(self, funding=False, reforms=False):
        # Prior-year public funding creates exactly 3 million m³ billable demand.
        return project(n=3, full_budget=np.array([0., 2.7, 0.]), basic_share=0,
            nrw_enabled=True, nrw_start=2027, nrw_target_year=2027,
            nrw_physical=.6, nrw_existing_demand=5, nrw_production_reduction_share=1,
            nrw_production_cost=.25, nrw_vol_m3yr=40/1.03,
            nrw_vol_m3day=40e6/(365*1.03), nrw_capex_unit_m3day=36.5,
            connection_config=dict(enabled=funding, new_billed_share_basic=0., new_billed_share_sm=1.),
            ce_enabled=reforms, ce_start=2027, ce_target_year=2027, ce_target_ratio=.9,
            tariff_enabled=reforms, tariff_start=2027, tariff_target_year=2027, tariff_target=1.5)

    def test_c_eligible_existing_sales_and_savings(self):
        s = project(nrw_enabled=True, nrw_physical=.6, nrw_existing_demand=5,
            nrw_production_reduction_share=1, nrw_production_cost=.25,
            nrw_vol_m3yr=40, nrw_vol_m3day=40e6/365, nrw_capex_unit_m3day=36.5)
        for key, expected in dict(nrw_recovery_total=20, nrw_physical_recovery=12,
            nrw_commercial_recovery=8, nrw_physical_sales_existing=5, nrw_physical_sales_connections=0,
            nrw_production_avoided_volume=7, nrw_direct_sales_volume=13,
            nrw_sales_cash=10.4, nrw_avoided_cost_cash=1.75, nrw_implementation_cost=2,
            nrw_net=10.15, nrw_delivered_upgrade_hh=0).items():
            self.assertAlmostEqual(s[key][1], expected, msg=key)
        self.assertAlmostEqual(s['nrw_recurring_cash'][1], 12.15)

    def test_d_e_connection_demand_and_signed_identity_on_and_off(self):
        for funding in (False, True):
            for reforms in (False, True):
                s = self.case(funding, reforms)
                expected = dict(nrw_physical_sales_existing=5, nrw_physical_sales_connections=3,
                    nrw_production_avoided_volume=4, nrw_unused_physical_capacity=0,
                    nrw_physical_delivered_volume=8, nrw_direct_sales_volume=13,
                    billed_volume_million_m3=116, nrw_net=9.4,
                    connection_net_cash=2.4 if funding else 0)
                if reforms:
                    expected.update(collected_revenue=156.6, collection_cash=11.6,
                                    tariff_cash=52.2, additional_net_cash=75.6 if funding else 73.2)
                for key, value in expected.items():
                    self.assertAlmostEqual(s[key][2], value, msg=f'{funding}/{reforms}/{key}')
                self.assertEqual(s['nrw_physical_sales_connections'][1], 0)
                np.testing.assert_allclose(s['nrw_delivered_upgrade_hh'], 0)

    def test_a_commercial_only_has_no_physical_savings_or_delivery(self):
        s = project(nrw_enabled=True, nrw_physical=0, nrw_production_reduction_share=1,
                    nrw_production_cost=100)
        self.assertGreater(s['nrw_sales_cash'][1], 0)
        for key in ('nrw_physical_recovery', 'nrw_physical_delivered_volume',
                    'nrw_avoided_cost_cash', 'nrw_delivered_upgrade_hh'):
            np.testing.assert_allclose(s[key], 0)

    def test_b_unused_water_never_delivers_households_or_accumulates(self):
        base = project()
        s = project(nrw_enabled=True, nrw_physical=1, nrw_vol_m3yr=24)
        np.testing.assert_allclose(s['bau_hh'], base['bau_hh'])
        np.testing.assert_allclose(s['nrw_unused_physical_capacity'], [0, 12, 12, 12])
        for key in ('nrw_net', 'nrw_physical_delivered_volume', 'nrw_origin_households',
                    'nrw_capacity_committed', 'nrw_delivered_upgrade_hh'):
            np.testing.assert_allclose(s[key], 0)

    def test_f_capacity_identity_and_partial_reduction(self):
        a = allocate_recovery(20, .6, 5, 3, .5)
        self.assertEqual((a.existing_sales, a.connection_sales, a.production_avoided, a.unused), (5, 3, 2, 2))
        for demand in (0, 5, 100):
            for connections in (0, 3, 100):
                for reduction in (0, .5, 1):
                    a = allocate_recovery(20, .6, demand, connections, reduction)
                    self.assertAlmostEqual(a.physical, a.delivered+a.production_avoided+a.unused)
                    self.assertLessEqual(a.existing_sales, demand)
                    self.assertLessEqual(a.connection_sales, connections)

    def test_g_lag_preserves_works_schedule_and_all_physical_shares_pay_same_cost(self):
        physical = project(nrw_enabled=True, nrw_physical=1, nrw_lag=1, nrw_capex_unit_m3day=36.5)
        commercial = project(nrw_enabled=True, nrw_physical=0, nrw_lag=1, nrw_capex_unit_m3day=36.5)
        self.assertGreater(physical['nrw_implementation_cost'][1], 0)
        self.assertEqual(physical['nrw_recovery_total'][1], 0)
        self.assertGreater(physical['nrw_recovery_total'][2], 0)
        self.assertLess(physical['nrw_net'][1], 0)
        np.testing.assert_allclose(physical['nrw_implementation_cost'], commercial['nrw_implementation_cost'])

    def test_missing_active_assumptions_do_not_become_zero(self):
        for key, bad in (('nrw_existing_demand', None), ('nrw_existing_demand', -1),
                         ('nrw_production_reduction_share', None), ('nrw_production_reduction_share', 1.1),
                         ('nrw_existing_demand', float('nan'))):
            with self.assertRaises(RevenueInputError):
                project(nrw_enabled=True, **{key: bad})
            project(nrw_enabled=False, **{key: bad})
        with self.assertRaises(RevenueInputError):
            project(nrw_enabled=True, nrw_production_reduction_share=1, nrw_production_cost=None)
        project(nrw_enabled=True, nrw_production_reduction_share=0, nrw_production_cost=None)
        project(nrw_enabled=True, nrw_production_reduction_share=1, nrw_production_cost=0)

    def test_new_blank_and_legacy_draft_validation_without_mutation(self):
        self.assertEqual(blank_inputs()['water_interventions']['nrw_existing_customer_sales_capacity_mld'], 0)
        p = example()
        p['toggles']['ws_nrw_enabled'] = True
        for key in ('nrw_allocation_version', 'nrw_existing_customer_sales_capacity_mld', 'nrw_unsold_production_reduction_share'):
            p['water_interventions'].pop(key, None)
        before = copy.deepcopy(p)
        issues = validate_interventions(p)
        self.assertTrue(any('nrw_existing_customer_sales_capacity_mld' in str(i) for i in issues))
        self.assertEqual(p, before)
        self.assertIsNone(coerce_to_engine(p).water_interventions.nrw_existing_customer_sales_capacity_mld)

    def test_h_link_uses_delivered_volume_and_current_markers_across_passes(self):
        p = example()
        p['toggles'].update(ws_nrw_enabled=True, san_nrw_link_enabled=True)
        p['water_interventions'].update(nrw_physical_loss_pct=.6, nrw_commercial_loss_pct=.4,
            nrw_existing_customer_sales_capacity_mld=1, nrw_unsold_production_reduction_share=1, nrw_production_cost=.25)
        p['sanitation_interventions'].update(nrw_link_return_ratio=.8, nrw_link_eligible_share=.5,
                                           nrw_link_overlap_m3_series={})
        m = coerce_to_engine(p)
        r = calculate(m)
        for prefix in ('', 'scenario_', 'scenario_without_utility_debt_'):
            w, s = r['water_supply'], r['sanitation']
            self.assertEqual(w[prefix+'nrw_allocation_version'], 1)
            self.assertEqual(s[prefix+'revenue_reconciliation']['nrw_allocation_version'], 1)
            np.testing.assert_allclose(s[prefix+'nrw_sales_volume'],
                np.asarray(w[prefix+'nrw_physical_delivered_volume'])*.4)
        with self.assertRaises(RevenueInputError):
            calculate_sanitation(m, build_context(m), nrw_recovered_vol=None)
        merged = aggregate([r, r])
        self.assertEqual(merged['water_supply']['scenario_nrw_allocation_version'], 1)
        for key in ALLOCATION_FIELDS:
            np.testing.assert_allclose(merged['water_supply']['scenario_'+key],
                                      np.asarray(r['water_supply']['scenario_'+key])*2)
        headers, rows = revenue_table(merged, 'water_supply', 'LCU')
        self.assertTrue(any('Production avoided' in h for h in headers))
        self.assertTrue(rows)
        stale = copy.deepcopy(r)
        del stale['water_supply']['nrw_allocation_version']
        with self.assertRaises(ValueError):
            aggregate([r, stale])
        with self.assertRaises(ValueError):
            revenue_table(stale, 'water_supply', 'LCU')


if __name__ == '__main__':
    unittest.main()
