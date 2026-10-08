"""Authoritative October 8 aggregate coverage and full-volume attribution contract."""
import copy
import itertools
import unittest
from types import SimpleNamespace
import numpy as np
from model.connection_revenue import prepare_connection, annual_connection_cash, migrate_connection, tagged_nrw_volume
from model.revenue_reconciliation import reconcile_revenue
from model.engine import calculate
from model.utility_debt import solve_scenario, normalize_indicative_config
from demo_adapter import coerce_to_engine
from test_utility_revenue import example
from deck_data import cumulative_passes
from deck_aggregate import aggregate
from revenue_export import revenue_table


def config(**updates):
    return dict(version=4, enabled=True, method='aggregate_coverage_expansion',
                new_billed_share_basic=.5, new_billed_share_sm=.9, **updates)


def setup():
    ctx = dict(years=np.array([2025, 2026, 2027, 2028]), bi=0, n=4,
               total_hh=np.array([.01, .011, .012, .013]), population=np.array([.05, .055, .06, .065]))
    history = np.zeros((5, 4))
    history[:, 0] = [.002, .004, .004, 0, 0]
    base = dict(version=1, volume_mld=1.2*1000/365, tariff=2,
                collection_ratio=.8, reference_year=2025, growth_rate=0)
    return ctx, history, base


class AggregateRevenueTests(unittest.TestCase):
    def test_coverage_case_and_lag(self):
        ctx, history, base = setup()
        status, r = prepare_connection(config(), base, ctx, history)
        self.assertTrue(status['effective'], status)
        row = annual_connection_cash(r, .011*.23, .011*.42, 2, 2, .8)
        self.assertAlmostEqual(row['connection_raw_volume_million_m3'], .074)
        self.assertAlmostEqual(row['connection_net_cash'], .1184)
        for t in (0, 1):
            row = annual_connection_cash(r, .002, .004, t, 2, .8)
            self.assertAlmostEqual(row['connection_net_cash'], 0)

    def test_population_only_and_transfers(self):
        ctx, hist, base = setup()
        base['growth_rate'] = None
        _, r = prepare_connection(config(), base, ctx, hist)
        row = annual_connection_cash(r, .011*.2, .011*.4, 2, 2, .8)
        self.assertAlmostEqual(row['connection_net_cash'], 0)
        row = annual_connection_cash(r, .011*.22, .011*.38, 2, 2, .8)
        self.assertAlmostEqual(row['connection_scale'], .008/.6)
        r['new_sm'] = r['new_basic'] = .8
        self.assertAlmostEqual(annual_connection_cash(r, .011*.22, .011*.38, 2, 2, .8)['connection_net_cash'], 0)
        r['new_sm'] = .2
        self.assertLess(annual_connection_cash(r, .011*.22, .011*.38, 2, 2, .8)['connection_net_cash'], 0)

    def test_exact_attribution_examples(self):
        for overlap, expected in [(0, [320,110,260,1170,1860]), (20,[288,110,256,1152,1806])]:
            row = reconcile_revenue(1200, 1000, 100, overlap, 2, .8, 3, .9, 999, 50)
            np.testing.assert_allclose([row[k] for k in ('connection_net_cash','nrw_net','collection_cash','tariff_cash','additional_net_cash')], expected)
            self.assertEqual(row['incremental_variable_operating_cost'], 0)
            self.assertEqual(row['nrw_operating_cost'], 0)

    def test_migration_and_no_obsolete_gates(self):
        from model.inputs import WaterInterventionInputs
        self.assertEqual(WaterInterventionInputs(revenue_integration_version=3).revenue_integration_version, 3)
        old = dict(version=3, enabled=True, new_billed_share_basic=0, new_billed_share_sm=.9,
                   marginal_cost=None, cost_proxy=None, funding_reference=None)
        migrated = migrate_connection(old)
        self.assertEqual(migrated, migrate_connection(migrated))
        self.assertEqual(migrated['new_billed_share_basic'], 0)
        self.assertIn('cost_proxy', migrated['legacy_parameters'])
        ctx, hist, base = setup()
        self.assertTrue(prepare_connection(old, base, ctx, hist)[0]['effective'])
        for value in (None, -1, 2, True, float('nan')):
            old['new_billed_share_sm'] = value
            self.assertEqual(prepare_connection(old, base, ctx, hist)[0]['state'], 'incomplete')
        hist[:, 0] = 0
        self.assertIn('Baseline Basic/Safely Managed coverage', prepare_connection(config(), base, ctx, hist)[0]['errors'][0])

    def test_zero_volume_and_changed_anchor(self):
        ctx, hist, base = setup()
        base.update(volume_mld=0, reference_year=2024)
        status, r = prepare_connection(config(), base, ctx, hist)
        self.assertTrue(status['effective'])
        self.assertEqual(annual_connection_cash(r, .003, .005, 2, 2, .8)['connection_net_cash'], 0)

    def test_tagged_origin_scale_and_lag(self):
        ctx, hist, base = setup()
        _, r = prepare_connection(config(), base, ctx, hist)
        self.assertEqual(tagged_nrw_volume(r, .001, 0), 0)
        self.assertAlmostEqual(tagged_nrw_volume(r, .001, 2), .001*.4*1.2/(.011*.6))
        r['new_sm'] = .1
        self.assertEqual(tagged_nrw_volume(r, .001, 2), 0)

    def test_all_16_combinations_identity_bau_and_order(self):
        pure = None
        for bits in itertools.product((False, True), repeat=4):
            d = example()
            d['connection_revenue'] = {s: config() for s in ('water','sanitation')}
            for key in d['toggles']:
                d['toggles'][key] = False
            for prefix, sector in [('ws','water'),('san','sanitation')]:
                d['connection_revenue'][sector]['enabled'] = bits[0]
                for name, enabled in zip(('nrw','collection_efficiency','tariff'), bits[1:]):
                    d['toggles'][prefix+'_'+name+'_enabled'] = enabled
            a = calculate(coerce_to_engine(d))
            d['toggles'] = dict(reversed(list(d['toggles'].items())))
            self.assertEqual(a, calculate(coerce_to_engine(d)))
            if pure is None:
                pure = a
            for sk in ('water_supply','sanitation'):
                sec = a[sk]
                self.assertEqual(sec['bau_hh'], pure[sk]['bau_hh'])
                self.assertFalse(sec['connection_revenue']['effective'])
                for i in range(len(a['years'])):
                    total = sum(sec['scenario_'+k][i] for k in ('connection_net_cash','collection_cash','tariff_cash','nrw_net'))
                    self.assertAlmostEqual(total, sec['scenario_additional_net_cash'][i])
                    self.assertAlmostEqual(total,
                        sec['scenario_collected_revenue'][i]-sec['scenario_reference_collected_revenue'][i]
                        +sec['scenario_nrw_avoided_cost_cash'][i]-sec['scenario_nrw_implementation_cost'][i])

    def test_connection_only_stage_and_exports(self):
        d = example()
        d['toggles'] = {k: False for k in d['toggles']}
        d['connection_revenue'] = {s: config() for s in ('water','sanitation')}
        result = calculate(coerce_to_engine(d))
        self.assertTrue(result['water_supply']['scenario_connection_revenue']['effective'])
        passes, enabled, _ = cumulative_passes([d])
        self.assertEqual({x[0] for x in enabled}, {'ws_connections_enabled','san_connections_enabled'})
        self.assertEqual(passes[0]['water_supply']['scenario_hh'], result['water_supply']['bau_hh'])
        self.assertEqual(passes[-1]['water_supply']['scenario_hh'], result['water_supply']['scenario_hh'])
        headers, rows = revenue_table(aggregate([result,result]), 'water_supply', 'USD')
        self.assertFalse(any('operating cost' in h.lower() for h in headers))
        self.assertTrue(rows)
        from export_data import intervention_breakdown, WATER_INTV
        contributions = intervention_breakdown(d, 'water_supply', WATER_INTV)
        self.assertEqual(contributions[0][0], 'Revenue from new connections')
        by = d['period']['baseline_year']
        cash = sum(v for y,v in zip(result['years'], result['water_supply']['scenario_connection_net_cash']) if y > by)
        self.assertEqual(contributions[0][2], round(cash/1000,4))

    def test_signed_connections_loan_and_frozen_reference(self):
        from model.inputs import UtilityDebtInputs
        self.assertEqual(UtilityDebtInputs(water={'revenue_sources':['connections']}).water.revenue_sources, ['connections'])
        cfg = dict(enabled=True, allocation_share=.5, revenue_sources=['connections','nrw'],
                   disbursement_year=2026, annual_real_interest_rate=0, loan_term_years=10)
        calls = []
        def calc(inputs, ctx, utility_debt_execution=None):
            calls.append(utility_debt_execution)
            return dict(connection_net_cash=[0,100,999], collection_cash=[0,0,0], tariff_cash=[0,0,0],
                        nrw_net=[0,-30,0], eligible_nrw_link_cash=[0,0,0],
                        utility_debt_cash_opening=[0,0,0], utility_debt_investment_used=[0,350,0],
                        utility_debt_cash_closing=[0,0,0])
        _,_,summary,_ = solve_scenario(calc, SimpleNamespace(period=SimpleNamespace(baseline_year=2025)),
                                      dict(years=[2025,2026,2027]), cfg)
        self.assertEqual(summary['eligible_pool'], 70)
        self.assertEqual(summary['indicative_principal'], 350)
        self.assertEqual(len(calls), 2)
        self.assertNotIn('connections', normalize_indicative_config({})['revenue_sources'])

    def test_staggered_reforms_and_zero_commercial_physical_supply(self):
        from test_consolidated_revenue import project
        sec = project(nrw_enabled=True, nrw_physical=0, nrw_value_basis='tariff',
                      connection_config=config())
        self.assertTrue(all(x == 0 for x in sec['nrw_delivered_upgrade_hh']))
        self.assertGreater(max(sec['nrw_sales_cash']), 0)
        d = example()
        by = d['period']['baseline_year']
        d['connection_revenue'] = {s: config() for s in ('water','sanitation')}
        for sector in ('water','sanitation'):
            d[sector+'_interventions'].update(ce_start_year=by+1,ce_target_year=by+2,ce_target_ratio=.95,
                                              tariff_start_year=by+3,tariff_target_year=by+5,tariff_target=1.5)
        for prefix in ('ws','san'):
            d['toggles'][prefix+'_collection_efficiency_enabled'] = True
            d['toggles'][prefix+'_tariff_enabled'] = True
        result = calculate(coerce_to_engine(d))
        for sk in ('water_supply','sanitation'):
            sec = result[sk]
            p0 = sec['scenario_connection_revenue']['calibration']['baseline_tariff']
            self.assertEqual(sec['scenario_applicable_tariff'][result['years'].index(by+2)],p0)
            self.assertEqual(sec['scenario_applicable_collection_ratio'][result['years'].index(by+3)],.95)

    def test_sales_modes_and_avoided_sales_exclusion(self):
        from test_consolidated_revenue import project
        args = dict(nrw_enabled=True,connection_config=config(),nrw_value_basis='tariff')
        all_sales = project(**args)
        restricted = project(**args,nrw_sales_assumption='household_only')
        self.assertGreater(all_sales['nrw_sales_volume'][1],0)
        self.assertEqual(restricted['nrw_sales_volume'][1],0)  # no same-year origin billing
        self.assertGreater(restricted['nrw_sales_volume'][2],0)
        avoided = project(nrw_enabled=True,connection_config=config(),nrw_value_basis='production',nrw_value_unit=.1)
        self.assertEqual(max(avoided['nrw_sales_volume']),0)
        self.assertGreater(max(avoided['nrw_avoided_sales_adjustment']),0)
        self.assertGreater(max(avoided['nrw_avoided_cost_cash']),0)

    def test_backend_frontend_comparison_order_agree(self):
        from deck_data import WATER_INTV,SAN_INTV
        expected = ['ws_connections_enabled','san_connections_enabled',
                    *[d[0] for d in WATER_INTV[1:]], *[d[0] for d in SAN_INTV[1:]]]
        d = example()
        d['toggles'] = {k: True for k in expected}
        d['connection_revenue'] = {s: config() for s in ('water','sanitation')}
        _, enabled, _ = cumulative_passes([d])
        self.assertEqual([row[0] for row in enabled], expected)


if __name__ == '__main__':
    unittest.main()
