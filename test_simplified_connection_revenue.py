"""Delivered billing cohorts and household-cost acceptance/regression checks."""
import copy
import itertools
import json
import unittest
import numpy as np
from model.billing_cohorts import BillingCohorts
from model.connection_revenue import prepare_connection, annual_connection_cash, migrate_connection
from model.revenue_reconciliation import reconcile_revenue
from model.engine import calculate
from demo_adapter import coerce_to_engine, _connection_sources
from test_connection_revenue import configuration, fixture
from test_consolidated_revenue import project
from test_utility_revenue import example
from deck_aggregate import aggregate
from revenue_export import revenue_table, FIELDS


def config(**patch):
    cfg = dict(configuration(), version=3, new_billed_share_basic=.8,
               new_billed_share_sm=.9, cost_basis='annual_household',
               annual_cost_per_household=40, shared_assumption_note='Controlled test assumptions.')
    cfg.update(patch)
    return cfg


def calibrated(**patch):
    ctx, history, base = fixture()
    base['volume_mld'] = .012 * 1000 / 365  # 100 billed households × 120 m³
    status, runtime = prepare_connection(config(**patch), base, ctx, history)
    return status, runtime, ctx, history, base


class SimplifiedConnectionTests(unittest.TestCase):
    def test_four_rate_examples_and_recurring_stock(self):
        status, r, _, h, _ = calibrated()
        self.assertTrue(status['effective'], status['errors'])
        billing = BillingCohorts(h[0, 0], h[1, 0], 1, 1, .9, .8)
        baseline = annual_connection_cash(r, *h[:2, 0], 1, 1, .8, billing)
        self.assertAlmostEqual(baseline['additional_net_cash'], 0)
        flow = billing.close(.001, 0, 0, h[0, 0], h[1, 0] + .001)
        self.assertAlmostEqual(flow['connection_billed_basic_entry_households'], 800)
        for tariff, collection, expected in [(1, .8, 44800), (1.5, .8, 83200),
                                               (1, .9, 54400), (1.5, .9, 97600)]:
            for year in (2, 3):
                row = annual_connection_cash(r, 0, 0, year, tariff, collection, billing)
                existing_reform = .012 * (tariff * collection - .8)
                self.assertAlmostEqual((row['additional_net_cash'] - existing_reform) * 1e6, expected)
                self.assertAlmostEqual(row['incremental_variable_operating_cost'] * 1e6, 32000)

    def test_basic_to_sm_transfer_not_entirely_new_customers(self):
        b = BillingCohorts(0, .001, .9, .6, .9, .8)
        flow = b.close(0, 0, .001, .001, 0)
        self.assertAlmostEqual(flow['connection_billed_basic_transfer_households'], 600)
        self.assertAlmostEqual(flow['connection_billed_sm_transfer_households'], 900)
        self.assertAlmostEqual(b.billed_sm - .0006, .0003)
        equal = BillingCohorts(0, .001, .6, .6, .6, .8)
        equal.close(0, .001, 0, .001, 0)
        self.assertAlmostEqual(equal.billed_sm, .0006)
        self.assertEqual(equal.nrw_billed, 0)

    def test_mixed_cohort_weight_and_only_nrw_tagged(self):
        b = BillingCohorts(0, .001, .9, .6, .9, .2)
        b.close(.001, 0, 0, 0, .002)  # Basic mixture now billed 40%, not 60%/20%.
        flow = b.close(0, .0005, .0005, .001, .001)
        self.assertAlmostEqual(flow['connection_billed_basic_transfer_households'], 400)
        self.assertAlmostEqual(flow['connection_billed_sm_transfer_households'], 900)
        self.assertAlmostEqual(b.nrw_billed * 1e6, 250)
        self.assertAlmostEqual(b.billed_basic * 1e6, 400)
        self.assertLessEqual(b.billed_sm, b.sm)

    def test_signed_decrease_and_attrition(self):
        b = BillingCohorts(0, .001, 1, .9, .2, 0)
        b.close(0, .001, 0, .001, 0)
        self.assertAlmostEqual(b.billed_sm - .0009, -.0007)
        self.assertEqual(b.nrw_billed, 0)
        b._align(.0005, 0)
        self.assertAlmostEqual(b.billed_sm, .0001)
        self.assertRaises(ValueError, b.close, .001, .001, 0, .0015, .001)

    def test_future_billing_does_not_recalibrate_history(self):
        for share in (0, .35, 1):
            status, r, _, _, _ = calibrated(new_billed_share_basic=share, new_billed_share_sm=share)
            self.assertTrue(status['effective'], status['errors'])
            self.assertAlmostEqual(r['q'], 120)
            self.assertEqual(status['calibration']['baseline_billed_households'], 100)
        for value in (None, -1, 1.01, float('nan'), True):
            for name in ('new_billed_share_basic', 'new_billed_share_sm'):
                status, *_ = calibrated(**{name: value})
                self.assertFalse(status['effective'], (name, value))
                self.assertTrue(any(name in error for error in status['errors']))

    def test_reference_growth_cost_and_signed_differences(self):
        _, r, _, h, _ = calibrated()
        b = BillingCohorts(*h[:2, 0], 1, 1, .9, .8)
        b.close(.001, 0, 0, h[0, 0], h[1, 0] + .001)
        r['hh_ref'][2] = 300 * 120 / 1e6
        row = annual_connection_cash(r, 0, 0, 2, 1, .8, b)
        self.assertAlmostEqual(row['connection_reference_billed_households'], 300)
        self.assertAlmostEqual(row['incremental_variable_operating_cost'] * 1e6, 24000)
        r['hh_ref'][2] = 1000 * 120 / 1e6
        row = annual_connection_cash(r, 0, 0, 2, 1, .8, b)
        self.assertLess(row['connection_net_cash'], 0)
        self.assertAlmostEqual(row['incremental_variable_operating_cost'] * 1e6, -4000)

    def test_cost_units_authoritative_and_equivalent(self):
        _, annual, _, h, _ = calibrated()
        _, volume, *_ = calibrated(cost_basis='per_m3', marginal_cost=1/3,
                                   annual_cost_per_household=99999)
        self.assertAlmostEqual(annual['v'], volume['v'])
        self.assertAlmostEqual(volume['k'], 40)
        b = BillingCohorts(*h[:2, 0], 1, 1, .9, .8)
        b.close(.001, 0, 0, h[0, 0], h[1, 0] + .001)
        a = annual_connection_cash(annual, 0, 0, 2, 1, .8, b)
        v = annual_connection_cash(volume, 0, 0, 2, 1, .8, b)
        for key in a:
            self.assertAlmostEqual(a[key], v[key], places=10, msg=key)

    def test_legacy_migration_drafts_zeros_and_sources(self):
        old = configuration(billed_share_basic=0, marginal_cost=0)
        migrated = migrate_connection(old)
        self.assertEqual(migrated['new_billed_share_basic'], 0)
        self.assertEqual(migrated['marginal_cost'], 0)
        self.assertEqual(migrated['cost_basis'], 'per_m3')
        self.assertEqual(migrated['provenance'], old['provenance'])
        self.assertEqual(migrated, migrate_connection(migrated))
        self.assertIsNone(migrate_connection(dict(version=2))['new_billed_share_sm'])
        self.assertNotIn('new_billed_share_sm', migrate_connection(dict(version=3)))
        self.assertEqual(json.loads(json.dumps(migrated)), migrated)

    def test_common_note_and_observed_override(self):
        status, *_ = calibrated(provenance={})
        self.assertTrue(status['effective'], status['errors'])
        status, *_ = calibrated(provenance={'billed_share_sm': {'source_type': 'observed', 'note': ''}})
        self.assertFalse(status['effective'])
        status, *_ = calibrated(provenance={}, shared_assumption_note='')
        self.assertFalse(status['effective'])

    def test_zero_cost_and_degenerate_calibration(self):
        status, *_ = calibrated(annual_cost_per_household=0)
        self.assertFalse(status['effective'])
        status, *_ = calibrated(annual_cost_per_household=0, zero_cost_confirmed=True)
        self.assertTrue(status['effective'], status['errors'])
        status, *_ = calibrated(household_volume_share=0)
        self.assertFalse(status['effective'])
        self.assertTrue(any('positive calibrated' in e.lower() for e in status['errors']))
        status, *_ = calibrated(household_volume_share=0, cost_basis='per_m3')
        self.assertTrue(status['effective'], status['errors'])
        status, *_ = calibrated(billed_share_basic=0, billed_share_sm=0)
        self.assertFalse(status['effective'])

    def test_expenditure_proxy_source_validation(self):
        source = dict(expenditure=8000, baseline_year=2025, currency='USD',
                      currency_basis='real_raw', sector='water', area='urban')
        proxy = dict(source, household_allocation=.5, allocation_confirmed=True, note='Explicit average-cost allocation.')
        status, r, *_ = calibrated(cost_basis='expenditure_proxy', cost_proxy=proxy,
                                   operating_expenditure_source=source)
        self.assertTrue(status['effective'], status['errors'])
        self.assertAlmostEqual(r['k'], 40)  # raw currency / 100 raw households
        for field, value in [('expenditure', 0), ('baseline_year', 2024),
                             ('currency_basis', 'nominal'), ('currency', 'OTHER'),
                             ('sector', 'sanitation'), ('area', 'rural')]:
            changed = dict(proxy, **{field: value})
            status, *_ = calibrated(cost_basis='expenditure_proxy', cost_proxy=changed,
                                     operating_expenditure_source=source)
            self.assertFalse(status['effective'], field)
        for value in (None, False):
            status, *_ = calibrated(cost_basis='expenditure_proxy', cost_proxy=dict(proxy, allocation_confirmed=value),
                                     operating_expenditure_source=source)
            self.assertFalse(status['effective'])
        zero = dict(source, expenditure=0)
        status, *_ = calibrated(cost_basis='expenditure_proxy', cost_proxy=dict(proxy, expenditure=0),
                                 operating_expenditure_source=zero)
        self.assertFalse(status['effective'])

    def test_adapter_plumbs_area_sector_and_detects_stale_snapshot(self):
        d = example()
        d['country_config'].update(area='Urban', currency='USD')
        d['water_interventions']['tariff_op_expenditure'] = 8000
        d['sanitation_interventions']['tariff_op_expenditure'] = 12000
        d['connection_revenue'] = {'water': config(), 'sanitation': config()}
        sources = _connection_sources(d)
        self.assertEqual(sources['water']['operating_expenditure_source']['expenditure'], 8000)
        self.assertEqual(sources['sanitation']['operating_expenditure_source']['expenditure'], 12000)
        self.assertEqual(sources['water']['operating_expenditure_source']['area'], 'urban')
        self.assertNotIn('operating_expenditure_source', d['connection_revenue']['water'])

    def test_final_reconciliation_cost_transfer_once(self):
        _, r, *_ = calibrated()
        row = reconcile_revenue(.108, .012, .04, .024, 1, .8, 1.5, .9, r['v'], .03)
        self.assertAlmostEqual(row['incremental_variable_operating_cost'], .096/3)
        self.assertAlmostEqual(row['nrw_operating_cost'], .024/3)
        self.assertAlmostEqual(sum(row[k] for k in ('connection_net_cash', 'collection_cash', 'tariff_cash', 'nrw_net')),
                               row['collected_revenue'] - row['reference_collected_revenue'] - .096/3 - .03)

    def test_full_model_delivery_and_tag_lag(self):
        sec = project(full_budget=np.array([0., 100., 100., 100.]),
                         revenue_base=dict(version=1, volume_mld=120*1000/365, tariff=1,
                                           collection_ratio=.8, reference_year=2025, growth_rate=0),
                         connection_config=config(billed_share_sm=.9, billed_share_basic=.6,
                                                  new_billed_share_basic=.2, new_billed_share_sm=.9))
        self.assertTrue(sec['connection_revenue']['effective'])
        self.assertAlmostEqual(sec['connection_billed_households'][1], .72*1e6)
        self.assertGreater(sec['funded_basic_entry_hh'][1], 0)
        self.assertEqual(sec['connection_billed_basic_entry_households'][1], 0)
        self.assertAlmostEqual(sec['connection_billed_basic_entry_households'][2],
                               sec['funded_basic_entry_hh'][1] * .2 * 1e6)
        for t in range(1, 4):
            self.assertAlmostEqual(sec['connection_billed_households'][t],
                                   sec['connection_billed_basic_households'][t] + sec['connection_billed_sm_households'][t])

    def test_nrw_tag_uses_actual_source_status_and_one_year_lag(self):
        sec = project(nrw_enabled=True, nrw_value_basis='tariff',
                      connection_config=config(billed_share_sm=.9, billed_share_basic=.6,
                                               new_billed_share_basic=.2, new_billed_share_sm=.9))
        delivered = sec['nrw_delivered_upgrade_hh'][1]
        self.assertGreater(delivered, 0)
        self.assertEqual(sec['nrw_tagged_billed_households'][1], 0)
        self.assertAlmostEqual(sec['nrw_tagged_billed_households'][2], delivered * .3 * 1e6)
        q = sec['connection_revenue']['calibration']['consumption_m3']
        self.assertAlmostEqual(sec['nrw_overlap_volume'][2], delivered * .3 * q)
        self.assertAlmostEqual(sec['nrw_origin_households'][1], delivered)
        self.assertAlmostEqual(sec['nrw_operating_cost'][2],
                               sec['nrw_overlap_volume'][2] * 40 / q)

    def test_staggered_rates_and_off_baseline_inheritance(self):
        d = example()
        d['connection_revenue'] = {'water': config(), 'sanitation': config()}
        by = d['period']['baseline_year']
        for sector in ('water', 'sanitation'):
            d[sector+'_interventions'].update(
                ce_start_year=by+1, ce_target_year=by+2, ce_target_ratio=.95,
                tariff_start_year=by+3, tariff_target_year=by+5, tariff_target=1.5)
        for key in d['toggles']:
            d['toggles'][key] = False
        off = calculate(coerce_to_engine(d))
        for sk in ('water_supply', 'sanitation'):
            cal = off[sk]['connection_revenue']['calibration']
            np.testing.assert_allclose(off[sk]['scenario_applicable_tariff'], cal['baseline_tariff'])
            np.testing.assert_allclose(off[sk]['scenario_applicable_collection_ratio'], cal['baseline_collection_ratio'])
        for prefix in ('ws', 'san'):
            d['toggles'][prefix+'_tariff_enabled'] = True
            d['toggles'][prefix+'_collection_efficiency_enabled'] = True
        result = calculate(coerce_to_engine(d))
        indexes = {year:i for i,year in enumerate(result['years'])}
        for sk in ('water_supply', 'sanitation'):
            p, c = result[sk]['scenario_applicable_tariff'], result[sk]['scenario_applicable_collection_ratio']
            p0 = result[sk]['connection_revenue']['calibration']['baseline_tariff']
            c0 = result[sk]['connection_revenue']['calibration']['baseline_collection_ratio']
            self.assertEqual(p[indexes[by+2]], p0)
            self.assertEqual(c[indexes[by]], c0)
            self.assertGreater(c[indexes[by+2]], c0)
            self.assertEqual(c[indexes[by+3]], .95)
            self.assertEqual(p[indexes[by+5]], 1.5)

    def test_expenditure_api_calibration_and_source_change(self):
        from app import revenue_bases
        d = example()
        d['country_config'].update(area='Urban', currency='USD')
        d['water_interventions']['tariff_op_expenditure'] = 8000
        d['connection_revenue'] = {'water': config(cost_basis='expenditure_proxy')}
        source = _connection_sources(d)['water']['operating_expenditure_source']
        d['connection_revenue']['water']['cost_proxy'] = dict(
            source, household_allocation=.5, allocation_confirmed=True, note='Documented scope allocation.')
        item = revenue_bases(d)['water']['connection']
        self.assertTrue(item['effective'], item['errors'])
        n0 = item['calibration']['baseline_billed_households']
        self.assertAlmostEqual(item['calibration']['annual_cost_per_household'], 4000/n0)
        d['water_interventions']['tariff_op_expenditure'] = 9000
        changed = revenue_bases(d)['water']['connection']
        self.assertFalse(changed['effective'])
        self.assertTrue(any('changed' in error for error in changed['errors']))

    def test_incomplete_cost_keeps_baseline_denominator_but_not_effective_mode(self):
        status, runtime, *_ = calibrated(cost_basis='expenditure_proxy', cost_proxy=None)
        self.assertFalse(status['effective'])
        self.assertIsNone(runtime)
        self.assertEqual(status['calibration']['baseline_billed_households'], 100)
        self.assertAlmostEqual(status['calibration']['consumption_m3'], 120)
        status, *_ = calibrated(new_billed_share_sm=None)
        self.assertFalse(status['effective'])
        self.assertEqual(status['calibration']['baseline_billed_households'], 100)

    def test_unit_cost_currency_conversion_preserves_household_units(self):
        from export_data import _currency_table
        headers = ['Households (HH)', 'Annual cost (NPR/HH/year, real)',
                   'Equivalent cost (NPR/m³, real)', 'Collected revenue (NPR M)']
        out, rows, columns = _currency_table(headers, [[100, 40, 1/3, .032]], {
            'mode': 'usd', 'source_currency': 'NPR', 'factor': .01})
        self.assertEqual(columns, [1, 2, 3])
        self.assertEqual(rows[0][0], 100)
        self.assertEqual(rows[0][1], .4)
        self.assertAlmostEqual(rows[0][2], 1/300)
        self.assertIn('US$/HH/year', out[1])

    def test_all_eight_reforms_and_pass_isolation(self):
        for bits in itertools.product((False, True), repeat=3):
            d = example()
            d['connection_revenue'] = {'water': config(), 'sanitation': config()}
            for key in d['toggles']:
                d['toggles'][key] = False
            for sector in ('ws', 'san'):
                for name, value in zip(('nrw', 'tariff', 'collection_efficiency'), bits):
                    d['toggles'][sector + '_' + name + '_enabled'] = value
            result = calculate(coerce_to_engine(d))
            again = calculate(coerce_to_engine(copy.deepcopy(d)))
            self.assertEqual(result, again)
            for sector in ('water_supply', 'sanitation'):
                sec = result[sector]
                for prefix in ('', 'scenario_'):
                    self.assertTrue(sec[prefix+'connection_revenue']['effective'])
                    for i in range(len(result['years'])):
                        if result['years'][i] <= d['period']['baseline_year']:
                            continue
                        self.assertAlmostEqual(sec[prefix+'billed_volume_million_m3'][i],
                                               sec[prefix+'raw_billed_volume_million_m3'][i] -
                                               sec[prefix+'nrw_overlap_volume'][i] + sec[prefix+'nrw_sales_volume'][i])
                        self.assertAlmostEqual(sec[prefix+'additional_net_cash'][i],
                                               sec[prefix+'collected_revenue'][i] -
                                               sec[prefix+'reference_collected_revenue'][i] -
                                               sec[prefix+'incremental_variable_operating_cost'][i] -
                                               sec[prefix+'nrw_implementation_cost'][i] +
                                               sec[prefix+'nrw_avoided_cost_cash'][i])

    def test_aggregate_and_exports_raw_households_weighted_unit_cost(self):
        d = example()
        d['connection_revenue'] = {'water': config(), 'sanitation': config()}
        first = calculate(coerce_to_engine(d))
        d['connection_revenue']['water']['annual_cost_per_household'] = 80
        second = calculate(coerce_to_engine(d))
        national = aggregate([first, second])
        sec = national['water_supply']
        self.assertAlmostEqual(sec['connection_annual_cost_per_household'][0], 60)
        self.assertAlmostEqual(sec['connection_billed_households'][0],
                               first['water_supply']['connection_billed_households'][0] * 2)
        headers, rows = revenue_table(national, 'water_supply', 'USD')
        self.assertIn('Lagged incremental NRW-tagged billed equivalents (HH)', headers)
        self.assertEqual(len(rows), len(first['years'])*2)
        self.assertEqual(len(headers), 3+len(FIELDS))


if __name__ == '__main__':
    unittest.main()
