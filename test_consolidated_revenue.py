"""Consolidated billing, physical-pool and cohort acceptance cases."""
import copy
import unittest
from types import SimpleNamespace
import numpy as np

from model.water_supply import sector_bau
from model.revenue_reconciliation import reconcile_revenue
from model.service_cohorts import EligibleCohorts
from model.engine import calculate, build_context
from model.utility_revenue import resolve_bases
from demo_adapter import coerce_to_engine
from test_utility_revenue import example
from test_connection_revenue import configuration
from deck_aggregate import aggregate
from revenue_export import revenue_table
from model.utility_debt import solve_scenario


def project(n=4, initial=(.6, .3, .1, 0, 0), **overrides):
    ctx = dict(n=n, bi=0, years=np.arange(2025, 2025+n), total_hh=np.ones(n),
               population=np.full(n, 3.), forecast_flag=np.array([0.]+[1.]*(n-1)),
               perf_flag=np.array([0.]+[1.]*(n-1)), end_asis_year=2025,
               gdp_real_local=np.ones(n))
    args = dict(
        period=SimpleNamespace(model_start_year=2025, baseline_year=2025,
                               target1_year=2026, target2_year=2026),
        pct_start=np.asarray(initial), pct_base=np.asarray(initial),
        tgt1=np.array([.8, .2, 0, 0, 0]), tgt2=np.array([.8, .2, 0, 0, 0]),
        cost_sm=100, cost_basic=50, full_budget=np.zeros(n), capex_pct=1,
        growth_capex_pct=0, planned_list=[], nonhh_pct=0, asset_life=float('inf'),
        capex_adder=0, hist_all_proportional=True, target_adjusted=True,
        revenue_base=dict(version=1, volume_mld=100000/365, tariff=1,
                          collection_ratio=.8, reference_year=2025, growth_rate=0),
        revenue_volume=np.full(n, 100.),
        nrw_start=2026, nrw_target_year=2026, nrw_current=.5, nrw_target=0,
        nrw_physical=.5, nrw_vol_m3yr=100, nrw_vol_m3day=100e6/365,
        nrw_water_per_upgrade=100, nrw_value_basis='production', nrw_value_unit=0)
    args.update(overrides)
    return sector_bau(ctx, **args)


class ConsolidatedRevenueTests(unittest.TestCase):
    def test_exact_document_examples_and_partial_overlap(self):
        for overlap, revenue, expected in (
                (0, 1755, [160, 130, 585, 80]),
                (100, 1620, [80, 120, 540, 80]),
                (40, 1701, [128, 126, 567, 80])):
            row = reconcile_revenue(1200, 1000, 100, overlap, 1, .8, 1.5, .9)
            self.assertAlmostEqual(row['collected_revenue'], revenue)
            actual = [row[k] for k in ('connection_revenue_delta', 'collection_cash',
                                      'tariff_cash', 'nrw_sales_cash')]
            np.testing.assert_allclose(actual, expected)
            self.assertAlmostEqual(sum(actual), revenue-800)

    def test_overlap_operating_cost_moves_once_and_signed_reductions(self):
        row = reconcile_revenue(1200, 1000, 100, 100, 1, .8, 1.5, .9, marginal_cost=.2)
        self.assertAlmostEqual(row['incremental_variable_operating_cost'], 0)
        self.assertAlmostEqual(row['nrw_operating_cost'], 0)
        self.assertAlmostEqual(row['connection_net_cash'], 80)
        self.assertAlmostEqual(row['additional_net_cash'], 820)
        row = reconcile_revenue(100, 100, 20, 0, 1, .8, .5, .6)
        self.assertLess(row['collection_cash'], 0)
        self.assertLess(row['tariff_cash'], 0)
        self.assertAlmostEqual(row['nrw_sales_cash'], 16)

    def test_850k_sm_target_is_not_a_ceiling(self):
        sec = project(nrw_enabled=True)
        self.assertAlmostEqual(sec['bau_hh'][0][1], .85)
        self.assertAlmostEqual(sec['nrw_delivered_upgrade_hh'][1], .25)
        self.assertAlmostEqual(sec['target_sm_overachievement_hh'][1], .05)
        self.assertAlmostEqual(sec['sm_access_gap'][1], 0)
        self.assertAlmostEqual(sec['nrw_delivered_upgrade_hh'][2], 0)

    def test_zero_effect_toggles_do_not_cap_public_delivery(self):
        kwargs = dict(full_budget=np.array([0, 30., 0, 0]))
        reference = project(**kwargs)
        nrw = project(**kwargs, nrw_enabled=True, nrw_current=0, nrw_target=0)
        mf = project(**kwargs, afford_enabled=True, afford_takeup=0,
                     afford_gap_shares=[1], afford_bracket_income=[1000])
        for actual in (nrw, mf):
            np.testing.assert_allclose(actual['bau_hh'], reference['bau_hh'])
        self.assertAlmostEqual(reference['bau_hh'][0][1], .9)

    def test_cohorts_offer_once_and_new_basic_next_year(self):
        sec = project(full_budget=np.array([0, 5., 0, 0]), basic_share=1,
                      afford_enabled=True, afford_start=2026, afford_end=2030,
                      afford_gap_shares=[.5, .5], afford_bracket_income=[1000, 10000],
                      afford_pct_income=.2, afford_interest=0, afford_tenor=5,
                      afford_takeup=.5, afford_partial_share=1, connection_fee=100)
        np.testing.assert_allclose(sec['microfinance_cohort_offers'], [0, .3, .1, 0])
        np.testing.assert_allclose(sec['mf_flow_hh'], [0, .15, .05, 0])
        self.assertAlmostEqual(sec['microfinance_cohort_unserved'][-1], .2)
        self.assertAlmostEqual(sec['eligible_basic_remaining_hh'][1], .15)

    def test_spare_capacity_can_serve_later_basic_entries(self):
        sec = project(initial=(.9, 0, .1, 0, 0), nrw_enabled=True,
                      full_budget=np.array([0, 5., 0, 0]), basic_share=1)
        np.testing.assert_allclose(sec['nrw_delivered_upgrade_hh'], [0, 0, .1, 0], atol=1e-15)
        self.assertAlmostEqual(sec['nrw_capacity_uncommitted'][1], 25)
        self.assertAlmostEqual(sec['nrw_capacity_uncommitted'][2], 15)
        np.testing.assert_allclose(np.asarray(sec['bau_hh']).sum(axis=0), 1)
        self.assertGreaterEqual(np.asarray(sec['bau_hh']).min(), 0)

    def test_nrw_tagged_share_difference_lag_and_no_unrelated_subtraction(self):
        sec = project(nrw_enabled=True, nrw_value_basis='tariff', nrw_lag=1,
                      nrw_capex_unit_m3day=0,
                      connection_config=configuration(billed_share_basic=.5, marginal_cost=0,
                                                        zero_cost_confirmed=True))
        q = sec['connection_revenue']['calibration']['aggregate_volume_proxy_m3']
        self.assertEqual(sec['nrw_overlap_volume'][1], 0)
        self.assertEqual(sec['nrw_overlap_volume'][2], 0)
        expected = sec['nrw_origin_households'][2] * q * .5
        self.assertAlmostEqual(sec['nrw_overlap_volume'][3], min(50, expected))
        for t in range(1, 4):
            self.assertAlmostEqual(sec['billed_volume_million_m3'][t],
                sec['raw_billed_volume_million_m3'][t]-sec['nrw_overlap_volume'][t]+sec['nrw_sales_volume'][t])

    def test_signed_cost_and_no_physical_funding_gate(self):
        for budget, expected in ((50, -30), (200, 120)):
            sec = project(nrw_enabled=True, nrw_value_basis='tariff',
                          nrw_vol_m3yr=20, nrw_vol_m3day=20e6/365,
                          nrw_capex_unit_m3day=3650,
                          revenue_base=dict(version=1, volume_mld=100000/365, tariff=2,
                                            collection_ratio=1, reference_year=2025, growth_rate=0),
                          full_budget=np.array([0, budget, 0, 0]))
            self.assertAlmostEqual(sec['nrw_implementation_cost'][1], 100)
            self.assertAlmostEqual(sec['nrw_net'][1], -80)
            self.assertAlmostEqual(sec['available_total'][1], expected)
            self.assertGreater(sec['nrw_delivered_upgrade_hh'][1], 0)

    def test_avoided_cost_has_no_sales_or_rate_uplift(self):
        sec = project(nrw_enabled=True, nrw_value_unit=.25, tariff_enabled=True,
                      tariff_start=2026, tariff_target_year=2026, tariff_target=3,
                      ce_enabled=True, ce_start=2026, ce_target_year=2026, ce_target_ratio=1)
        self.assertEqual(sec['nrw_sales_cash'][1], 0)
        self.assertAlmostEqual(sec['nrw_avoided_cost_cash'][1], 12.5)
        self.assertAlmostEqual(sec['nrw_net'][1], 12.5)

    def test_sewer_link_uses_sewer_rates_and_tagged_overlap(self):
        base = dict(version=1, volume_mld=100000/365, tariff=2,
                    collection_ratio=.5, reference_year=2025, growth_rate=0)
        sec = project(revenue_base=base, linked_nrw_volume=[0, 10, 10, 10],
                      linked_overlap_volume=[0, 3, 3, 3], connection_config=configuration(),
                      tariff_enabled=True, tariff_start=2026, tariff_target_year=2026, tariff_target=3,
                      ce_enabled=True, ce_start=2026, ce_target_year=2026, ce_target_ratio=.6)
        self.assertAlmostEqual(sec['nrw_sales_cash'][1], 10)
        self.assertAlmostEqual(sec['eligible_nrw_link_cash'][1], 10)
        self.assertAlmostEqual(sec['nrw_overlap_volume'][1], 0)
        self.assertAlmostEqual(sec['connection_unapplied_overlap_volume_million_m3'][1], 3)
        self.assertEqual(sec['nrw_net'][1], 0)
        self.assertAlmostEqual(sec['additional_net_cash'][1],
            sec['connection_net_cash'][1]+sec['collection_cash'][1]+sec['tariff_cash'][1]+
            sec['eligible_nrw_link_cash'][1])

    def test_legacy_nrw_tariff_only_migrates_and_conflicts_are_flagged(self):
        data = example()
        data['revenue_bases'].pop('water')
        w = data['water_interventions']
        w.update(ce_water_sold_mld=None, ce_current_tariff=None,
                 tariff_volume_mld=None, tariff_current=None, nrw_tariff=7,
                 nrw_system_input_vol=100, nrw_current_pct=.2, ce_current_ratio=.8)
        inputs = coerce_to_engine(data)
        resolved = resolve_bases(inputs, build_context(inputs))
        self.assertEqual(resolved['water']['base']['tariff'], 7)
        data = example()
        data['water_interventions']['nrw_tariff'] = 7
        metadata = calculate(coerce_to_engine(data))['water_supply']['scenario_revenue_reconciliation']
        self.assertFalse(metadata['legacy_rate_conflict'])
        self.assertEqual(data['water_interventions']['nrw_tariff'], 7)
        self.assertEqual(metadata['shared_tariff'], 1)

    def test_national_arrays_and_export_identity(self):
        data = example()
        data['toggles']['ws_nrw_enabled'] = True
        data['water_interventions'].update(nrw_current_pct=.4, nrw_target_pct=.2,
                                          nrw_start_year=2026, nrw_target_year=2026, nrw_lag_years=0)
        first = calculate(coerce_to_engine(data))
        combined = aggregate([first, copy.deepcopy(first)])
        sec = combined['water_supply']
        np.testing.assert_allclose(sec['scenario_nrw_net'],
                                   2*np.asarray(first['water_supply']['scenario_nrw_net']))
        np.testing.assert_allclose(sec['scenario_applicable_tariff'],
                                   first['water_supply']['scenario_applicable_tariff'])
        headers, rows = revenue_table(combined, 'water_supply', 'LCU')
        self.assertTrue(any('Tagged household overlap' in h for h in headers))
        self.assertTrue(any('NRW implementation cost' in h for h in headers))
        self.assertEqual(len(rows), 2*len(first['years']))

    def test_proportional_cohort_deductions_and_self_exclusion(self):
        cohort = EligibleCohorts(.3, [.5, .5])
        cohort.remove(.1)
        offered, self_excluded = cohort.offer(.25)
        self.assertAlmostEqual(self_excluded, .05)
        self.assertAlmostEqual(sum(offered), .15)
        cohort.deliver(.075)
        cohort.add_entrants(.1)
        second, _ = cohort.offer(0)
        self.assertAlmostEqual(sum(second), .1)
        self.assertAlmostEqual(cohort.remaining, .225)

    def test_exact_signed_loan_pool_and_frozen_no_loan_reference(self):
        for nrw, expected_pool, expected_allocation in ((-30, 70, 35), (-120, 0, 0)):
            def calculator(inputs, ctx, utility_debt_execution=None):
                plan = utility_debt_execution or {}
                principal = plan.get('loan_amount', 0)
                # Financing-generated revenue must not enlarge its own snapshot.
                uplift = 999 if principal else 0
                return dict(collection_cash=[0, 40+uplift], tariff_cash=[0, 60+uplift],
                            nrw_net=[0, nrw], eligible_nrw_link_cash=[0, 0],
                            available_total=[0, 100+nrw], replacement_capex=[0, 0],
                            utility_debt_cash_opening=[0, 0],
                            utility_debt_investment_used=[0, 0],
                            utility_debt_cash_closing=[0, principal])
            cfg = dict(enabled=True, mode='indicative_lump_sum', allocation_share=.5,
                       annual_real_interest_rate=0, loan_term_years=10,
                       disbursement_year=2026, revenue_sources=['collection', 'tariff', 'nrw'])
            _, plan, summary, _ = solve_scenario(
                calculator, SimpleNamespace(period=SimpleNamespace(baseline_year=2025)),
                {'years': [2025, 2026]}, cfg)
            self.assertEqual(summary['eligible_pool'], expected_pool)
            self.assertEqual(summary['indicative_principal'], expected_allocation*10)
            self.assertEqual(sum(plan.get('debt_service', [])), 0)

    def test_known_affordability_outcomes_preserve_income_bands(self):
        cohort = EligibleCohorts(.3, [.5, .5])
        cohort.offer(0)
        cohort.deliver_by_band([0, .15])
        np.testing.assert_allclose(cohort.offered_unserved, [.15, 0])


if __name__ == '__main__':
    unittest.main()
