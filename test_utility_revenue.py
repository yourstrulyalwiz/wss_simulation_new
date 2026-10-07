import copy
import json
import unittest
import numpy as np
from demo_adapter import frontend_defaults as unresolved_defaults, coerce_to_engine
from test_support import frontend_defaults
from model.engine import calculate, build_context
from model.utility_revenue import collected_revenue, resolve_bases, volume_path, RevenueInputError
from deck_data import cumulative_passes, WATER_INTV, SAN_INTV
from export_data import intervention_breakdown, per_year_table


def example():
    data = frontend_defaults()
    data['toggles'] = {k: False for k in data['toggles']}
    year = data['period']['baseline_year'] + 1
    for sector, key in [('water', 'water_interventions'), ('sanitation', 'sanitation_interventions')]:
        data['revenue_bases'][sector].update(volume_mld=1000/365, tariff=1,
                                           collection_ratio=.8, reference_year=year, growth_rate=0)
        data[key].update(ce_target_ratio=.9, tariff_target=1.2,
                         ce_start_year=year, ce_target_year=year,
                         tariff_start_year=year, tariff_target_year=year)
    return data


class UtilityRevenueTests(unittest.TestCase):
    def test_four_rows_both_sectors_and_cash_once(self):
        for ce, tr, revenue, ce_cash, tr_cash in (
            (False, False, .8, 0, 0), (False, True, .96, 0, .16),
            (True, False, .9, .1, 0), (True, True, 1.08, .1, .18)):
            data = example()
            for prefix in ('ws', 'san'):
                data['toggles'][prefix + '_collection_efficiency_enabled'] = ce
                data['toggles'][prefix + '_tariff_enabled'] = tr
            result = calculate(coerce_to_engine(data))
            idx = result['years'].index(data['period']['baseline_year'] + 1)
            for sector in ('water_supply', 'sanitation'):
                s = result[sector]
                self.assertAlmostEqual(s['scenario_collected_revenue'][idx], revenue)
                self.assertAlmostEqual(s['scenario_collection_cash'][idx], ce_cash)
                self.assertAlmostEqual(s['scenario_tariff_cash'][idx], tr_cash)
                np.testing.assert_allclose(np.array(s['scenario_collected_revenue']) - s['baseline_collected_revenue'],
                                           np.array(s['scenario_collection_cash']) + s['scenario_tariff_cash'], atol=1e-9)
                np.testing.assert_allclose(np.array(s['scenario_available_total']) - s['available_total'],
                                           np.array(s['scenario_collection_cash']) + s['scenario_tariff_cash'], atol=1e-9)

    def test_edge_cases_and_invalid_inputs(self):
        for c, q, expected in [(1, 1, .2), (0, 1, 0), (.8, 0, 0)]:
            _, _, ce, tr = collected_revenue([q], 1, c, [.2], [0])
            self.assertAlmostEqual(tr[0], expected)
            self.assertEqual(ce[0], 0)
        for args in [([1], 1, .8, [-1.1], [0]), ([1], 1, .8, [0], [.3]),
                     ([float('nan')], 1, .8, [0], [0]), ([1], -1, .8, [0], [0])]:
            with self.assertRaises(RevenueInputError):
                collected_revenue(*args)
        data = example()
        data['water_interventions']['tariff_target'] = .5
        data['toggles']['ws_tariff_enabled'] = True
        result = calculate(coerce_to_engine(data))
        self.assertLess(min(result['water_supply']['scenario_tariff_cash']), 0)

    def test_independent_schedules_growth_and_counterfactual(self):
        data = example()
        year = data['period']['baseline_year'] + 1
        data['revenue_bases']['water']['growth_rate'] = .03
        data['water_interventions'].update(ce_start_year=year+2, ce_target_year=year+4)
        off = calculate(coerce_to_engine(data))
        data['toggles']['ws_collection_efficiency_enabled'] = True
        data['toggles']['ws_tariff_enabled'] = True
        on = calculate(coerce_to_engine(data))
        i = on['years'].index(year)
        s = on['water_supply']
        self.assertAlmostEqual(s['scenario_tariff_cash'][i], .16)
        self.assertAlmostEqual(s['scenario_tariff_cash'][i+3], .2 * .85 * 1.03**3)
        for key in ('financing_gap', 'funded_asset_stock', 'billed_volume_million_m3'):
            self.assertEqual(off['water_supply'][key], s[key])
        self.assertEqual(off['sanitation']['scenario_collected_revenue'], on['sanitation']['scenario_collected_revenue'])

    def test_unchanged_targets_are_noops_in_both_sectors(self):
        data = example()
        for section in ('water_interventions', 'sanitation_interventions'):
            data[section].update(ce_target_ratio=.8, tariff_target=1)
        off = calculate(coerce_to_engine(data))
        for prefix in ('ws', 'san'):
            data['toggles'][prefix+'_collection_efficiency_enabled'] = True
            data['toggles'][prefix+'_tariff_enabled'] = True
        on = calculate(coerce_to_engine(data))
        for sector in ('water_supply', 'sanitation'):
            for key in ('scenario_collection_cash', 'scenario_tariff_cash', 'scenario_hh',
                        'scenario_billed_volume_million_m3', 'scenario_endline_financing_requirement'):
                self.assertEqual(off[sector][key], on[sector][key])

    def test_migration_conflict_reload_single_base_zero_and_missing(self):
        data = unresolved_defaults()
        engine = coerce_to_engine(data)
        r = resolve_bases(engine, build_context(engine))
        self.assertIsNotNone(r['water']['base'])
        self.assertIsNotNone(r['sanitation']['base'])
        self.assertEqual(r['sanitation']['base']['origin'], 'collection-efficiency fallback')
        self.assertAlmostEqual(r['sanitation']['base']['volume_mld'], 70.08)
        self.assertIsNone(r['sanitation']['error'])
        self.assertEqual(len(r['sanitation']['alternatives']), 2)
        self.assertIsNotNone(calculate(engine))

        explicit_tariff_base = copy.deepcopy(data)
        explicit_tariff_base.setdefault('revenue_bases', {})
        explicit_tariff_base['revenue_bases']['sanitation'] = copy.deepcopy(
            r['sanitation']['alternatives'][1]['base'])
        explicit_model = coerce_to_engine(explicit_tariff_base)
        explicit = resolve_bases(explicit_model, build_context(explicit_model))
        self.assertEqual(explicit['sanitation']['base']['origin'], 'tariff')
        self.assertAlmostEqual(explicit['sanitation']['base']['volume_mld'], 43.8)

        data['revenue_bases'] = {k: v['base'] or v['alternatives'][0]['base'] for k, v in r.items()}
        data = json.loads(json.dumps(data))
        resolved = calculate(coerce_to_engine(data))
        data['water_interventions']['ce_current_tariff'] = 999
        self.assertEqual(resolved['water_supply']['baseline_collected_revenue'],
                         calculate(coerce_to_engine(data))['water_supply']['baseline_collected_revenue'])
        single = unresolved_defaults()
        del single['water_interventions']['tariff_volume_mld']
        single['water_interventions']['ce_current_ratio'] = 0
        m = coerce_to_engine(single)
        self.assertEqual(resolve_bases(m, build_context(m))['water']['base']['collection_ratio'], 0)
        del single['water_interventions']['ce_current_ratio']
        m = coerce_to_engine(single)
        self.assertIsNone(resolve_bases(m, build_context(m))['water']['base'])

    def test_different_anchors_compared_after_normalization(self):
        data = unresolved_defaults()
        m = coerce_to_engine(data)
        ctx = build_context(m)
        w = data['water_interventions']
        old = w['ce_start_year']; new = old+2
        years = list(ctx['years'])
        w['tariff_start_year'] = new
        w['tariff_volume_mld'] = w['ce_water_sold_mld'] * ctx['population'][years.index(new)] / ctx['population'][years.index(old)]
        m = coerce_to_engine(data)
        self.assertEqual(resolve_bases(m, ctx)['water']['base']['origin'], 'equivalent legacy bases')
        w['tariff_volume_mld'] = w['ce_water_sold_mld']
        m = coerce_to_engine(data)
        self.assertEqual(resolve_bases(m, ctx)['water']['base']['origin'], 'collection-efficiency fallback')

    def test_marginal_outcomes_and_exports_reconcile(self):
        data = example()
        for prefix in ('ws', 'san'):
            for key in ('collection_efficiency', 'capital_efficiency', 'tariff'):
                data['toggles'][prefix+'_'+key+'_enabled'] = True
        passes, definitions, _ = cumulative_passes([data])
        for sector in ('water_supply', 'sanitation'):
            for metric in ('scenario_endline_financing_requirement', 'scenario_hh'):
                series = [np.array(p[sector][metric]) for p in passes]
                np.testing.assert_allclose(sum(series[i+1]-series[i] for i in range(len(series)-1)),
                                           series[-1]-series[0], atol=1e-9)
            defs = WATER_INTV if sector == 'water_supply' else SAN_INTV
            rows = intervention_breakdown(data, sector, [(k, label, resource) for k,label,resource,*_ in defs])
            self.assertIn('Tariff reform', [r[0] for r in rows])
            self.assertIn('Increased collection efficiency', [r[0] for r in rows])
            headers, table = per_year_table(passes[-1], data, sector)
            self.assertTrue(any('Tariff cash incl.' in h for h in headers))
            self.assertEqual(len(headers), len(table[0]))

    def test_cash_does_not_create_connections_when_pool_is_full(self):
        data = example()
        n = data['period']['forecast_end_year'] - data['period']['model_start_year'] + 1
        for key in ('pop_ts', 'hh_ts'):
            data['population'][key] = [next(v for v in data['population'][key] if v > 0)] * n
        for sector, prefix in [('water_service', 'serv'), ('sanitation_service', 'sserv')]:
            for i in range(1, 6):
                data[sector][prefix+str(i)+'_ts'] = [1 if i == 1 else 0] * n
        for prefix in ('ws', 'san'):
            data['toggles'][prefix+'_collection_efficiency_enabled'] = True
            data['toggles'][prefix+'_tariff_enabled'] = True
        result = calculate(coerce_to_engine(data))
        for sector in ('water_supply', 'sanitation'):
            s = result[sector]
            self.assertGreater(max(s['scenario_additional_collected_revenue']), 0)
            np.testing.assert_allclose(s['scenario_hh'][0], s['bau_hh'][0])


if __name__ == '__main__':
    unittest.main()