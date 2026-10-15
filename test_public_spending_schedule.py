"""Controlled acceptance cases for signed, stepwise executed-spending targets."""
import copy
import json
import unittest
from types import SimpleNamespace
import numpy as np
from demo_adapter import coerce_to_engine, _financial_fields
from model.engine import calculate
from model.public_spending import PublicSpendingTarget, resolve_schedule
from model.utility_debt import solve_scenario
import test_budget_forecast
from test_consolidated_revenue import project
from test_support import frontend_defaults


class PublicSpendingScheduleTests(unittest.TestCase):
    def model(self, points=None, execution=False, executed=1, allocated=5):
        m = test_budget_forecast.BudgetForecastTests().fixture(executed, allocated)
        for prefix, sector in [('ws', 'water'), ('san', 'sanitation')]:
            setattr(m.toggles, prefix + '_financial_commitment_enabled', True)
            setattr(m.toggles, prefix + '_capital_efficiency_enabled', execution)
            getattr(m, sector + '_interventions').fin_gdp_targets = copy.deepcopy(points)
        return m

    def test_exact_arithmetic_both_sectors_capital_and_execution(self):
        for share in [.02, .005, 0]:
            for execution in [False, True]:
                for total, k in [(False, .3), (True, 0), (True, .3), (True, 1)]:
                    with self.subTest(share=share, execution=execution, total=total, k=k):
                        m = self.model([dict(year=2026, target_share=share)], execution)
                        for prefix in ['ws', 'san']:
                            setattr(m.wss_budget, prefix + '_budget_is_total_spending', total)
                            setattr(m.wss_budget, prefix + '_budget_capital_share', k)
                        result = calculate(m)
                        i = result['years'].index(2026)
                        factor = k if total else 1
                        for name in ['water_supply', 'sanitation']:
                            s = result[name]
                            cash = s['scenario_source_funding']['signed_contribution']
                            expected = [factor, factor*(100*share-1), factor*100*share*int(execution)]
                            for key, value in zip(['baseline', 'financial', 'budget_execution'], expected):
                                self.assertAlmostEqual(cash[key][i], value)
                            self.assertAlmostEqual(sum(values[i] for values in cash.values()), sum(expected))
                            self.assertAlmostEqual(s['scenario_available_total'][i], sum(expected))
                            for rung in ['sm', 'basic']:
                                np.testing.assert_allclose(s['scenario_coverage_attribution']['reconciliation_error'][rung], 0, atol=1e-10)
                                for values in s['scenario_coverage_attribution'][rung + '_stock'].values():
                                    self.assertGreaterEqual(min(values), -1e-10)

    def test_legacy_adoption_step_replacement_and_gdp_growth(self):
        legacy = self.model()
        legacy.water_interventions.fin_gdp_target_share = .005
        self.assertEqual(sum(calculate(legacy)['water_supply']['scenario_financial_commitment_cash']), 0)
        positive = self.model([dict(year=2026, target_share=.02)])
        scalar = self.model()
        np.testing.assert_allclose(calculate(positive)['water_supply']['scenario_financial_commitment_cash'],
                                   calculate(scalar)['water_supply']['scenario_financial_commitment_cash'])
        points = [dict(year=2035, target_share=.004), dict(year=2028, target_share=.005),
                  dict(year=2031, target_share=.008)]
        m = self.model(points)
        years = list(range(m.period.model_start_year, m.period.forecast_end_year+1))
        m.macro.gdp_real_local = [100 * 1.05**max(0, y-2030) for y in years]
        m.wss_budget.ws_budget_direct = [3 if y == 2032 else 1 for y in years]
        s = calculate(m)['water_supply']
        for i, y in enumerate(years):
            share = .004 if y >= 2035 else .008 if y >= 2031 else .005 if y >= 2028 else None
            expected = 0 if share is None else share*m.macro.gdp_real_local[i]-s['financial_commitment_base'][i]
            self.assertAlmostEqual(s['scenario_financial_commitment_cash'][i], expected)
        self.assertEqual(m.water_interventions.fin_gdp_targets, points)
        self.assertGreater(.004*m.macro.gdp_real_local[-1], .004*100)

    def test_growth_additive_disabled_and_pure_bau(self):
        m = self.model([dict(year=2028, target_share=0), dict(year=2031, target_share=.008)])
        target = calculate(m)
        for sector in ['water', 'sanitation']:
            iv = getattr(m, sector + '_interventions')
            iv.fin_growth_enabled = True
            iv.fin_growth_rate = .1
            iv.fin_growth_start_year = 2028
            iv.fin_growth_end_year = 2030
        combined = calculate(m)
        for sector in ['water', 'sanitation']:
            getattr(m, sector + '_interventions').fin_gdp_enabled = False
        growth = calculate(m)
        for sector in ['water_supply', 'sanitation']:
            np.testing.assert_allclose(combined[sector]['scenario_financial_commitment_cash'],
                np.array(target[sector]['scenario_financial_commitment_cash']) +
                np.array(growth[sector]['scenario_financial_commitment_cash']))
            np.testing.assert_allclose(target[sector]['bau_hh'], growth[sector]['bau_hh'])
        m.water_interventions.fin_gdp_targets = [{'year': '', 'target_share': None}]
        calculate(m)  # disabled incomplete settings do not invalidate other interventions
        m.water_interventions.fin_gdp_enabled = True
        m.toggles.ws_financial_commitment_enabled = False
        self.assertEqual(sum(calculate(m)['water_supply']['scenario_financial_commitment_cash']), 0)

    def test_strict_validation_and_inactive_scalar_placeholders(self):
        invalid = [[], [{'year': True, 'target_share': .1}], [{'year': 2026.5, 'target_share': .1}],
                   [{'year': '2026', 'target_share': .1}], [{'year': 2025, 'target_share': .1}],
                   [{'year': 2041, 'target_share': .1}],
                   [{'year': 2026, 'target_share': -1}]]
        # Keep malformed scalar cases separate so each bad row has an attributable message.
        invalid += [[{'year': 2026, 'target_share': value}] for value in ['', None, True, float('nan'), float('inf')]]
        invalid += [[dict(year=2026, target_share=0), dict(year=2026, target_share=.01)]]
        for raw in invalid:
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                resolve_schedule(raw, 2025, 2040, 'Urban Water budget')
        for raw in invalid:
            m = self.model(raw)
            result = calculate(m, allow_partial=True)
            self.assertIn('water_supply', result['sector_errors'])
        m = self.model([dict(year=2026, target_share=0)])
        m.water_interventions.fin_gdp_start_year = 0
        m.water_interventions.fin_gdp_target_share = float('nan')
        calculate(m)
        with self.assertRaises(ValueError):
            PublicSpendingTarget(year=True, target_share=0)

    def test_execution_boundaries(self):
        for e, a in [(2, 1), (1, 0)]:
            m = self.model([dict(year=2026, target_share=.005)], True, e, a)
            result = calculate(m)
            i = result['years'].index(2026)
            cash = result['water_supply']['scenario_source_funding']['signed_contribution']
            r0 = e / (a or e)
            self.assertAlmostEqual(sum(v[i] for v in cash.values()), .5*.4/r0)
        m = self.model([dict(year=2026, target_share=.01)], True, 0, 5)
        with self.assertRaisesRegex(ValueError, 'positive baseline execution'):
            calculate(m)
        m = self.model([dict(year=2026, target_share=0)], True, 0, 5)
        result = calculate(m)
        i = result['years'].index(2026)
        self.assertAlmostEqual(result['water_supply']['scenario_source_funding']['signed_contribution']['budget_execution'][i], 2)

    def test_adapter_roundtrip_and_scope_independence(self):
        original = frontend_defaults()
        points = [dict(year=2026, target_share=.005), dict(year=2031, target_share=0)]
        original['water_interventions']['fin_gdp_targets'] = points
        original['toggles']['ws_financial_commitment_enabled'] = True
        original['water_interventions']['fin_gdp_enabled'] = True
        copied = json.loads(json.dumps(original))
        model = coerce_to_engine(copied)
        self.assertEqual(model.water_interventions.fin_gdp_targets, points)
        self.assertIsNone(model.sanitation_interventions.fin_gdp_targets)
        self.assertEqual(original, copied)
        self.assertIsNone(_financial_fields({})['fin_gdp_targets'])
        self.assertEqual(_financial_fields({'fin_gdp_targets': []})['fin_gdp_targets'], [])
        copied['water_interventions']['fin_gdp_target_draft'] = [{'year': '', 'share': '0.5'}]
        result = calculate(coerce_to_engine(copied), allow_partial=True)
        self.assertIn('water_supply', result['sector_errors'])
        self.assertNotIn('sanitation', result['sector_errors'])

    def dynamic(self, points, **overrides):
        args = dict(n=11, initial=(.1, .2, .7, 0, 0), asset_life=30,
            budget_source='entered_budget', budget_override=[10.]*11, allocated_series=[50.]*11,
            basic_share=.5, ce_current_ratio=.8, ce_enabled=True, ce_start=2026,
            ce_target_year=2026, ce_target_ratio=.9,
            connection_config=dict(enabled=False, new_billed_share_basic=.5, new_billed_share_sm=1.),
            financial_enabled=True, financial_settings=dict(gdp_enabled=True, gdp_targets=points))
        args.update(overrides)
        return project(**args)

    def test_next_year_volume_funding_off_nrw_and_loan(self):
        low = [dict(year=2026, target_share=5)]
        high = [dict(year=2026, target_share=15), dict(year=2030, target_share=0)]
        a, b = self.dynamic(low), self.dynamic(high)
        self.assertEqual(a['billed_volume_million_m3'][1], b['billed_volume_million_m3'][1])
        self.assertGreater(b['bau_hh'][0][1], a['bau_hh'][0][1])
        self.assertGreater(b['billed_volume_million_m3'][2], a['billed_volume_million_m3'][2])
        self.assertGreater(b['collection_cash'][2], a['collection_cash'][2])
        self.assertEqual(sum(b['connection_net_cash']), 0)
        nrw = self.dynamic(high, nrw_enabled=True, nrw_physical=0, nrw_capex_unit_m3day=.01)
        self.assertGreater(nrw['nrw_dynamic_system_input_million_m3'][2], 100)
        cfg = dict(enabled=True, mode='indicative_lump_sum', allocation_share=.5,
            annual_real_interest_rate=.05, loan_term_years=10, disbursement_year=2027,
            revenue_sources=['collection'])
        inputs = SimpleNamespace(period=SimpleNamespace(baseline_year=2025))
        ctx = {'years': list(range(2025, 2036))}
        def solve(points):
            return solve_scenario(lambda inputs, ctx, utility_debt_execution=None:
                self.dynamic(points, utility_debt_execution=utility_debt_execution), inputs, ctx, cfg)
        financed, _, debt, reference = solve(high)
        self.assertEqual(reference, b)
        self.assertAlmostEqual(debt['indicative_principal'], b['collection_cash'][2]*.5*debt['annuity_factor'])
        later_change = [dict(year=2026, target_share=15), dict(year=2030, target_share=25)]
        self.assertEqual(solve(later_change)[2]['indicative_principal'], debt['indicative_principal'])
        self.assertGreater(financed['billed_volume_million_m3'][3], reference['billed_volume_million_m3'][3])
        print('Controlled schedule volume (low/high):', a['billed_volume_million_m3'][1:3],
              b['billed_volume_million_m3'][1:3], 'frozen principal:', debt['indicative_principal'])

    def test_unsupported_direct_engine_basis(self):
        with self.assertRaisesRegex(ValueError, 'entered-budget basis'):
            project(financial_enabled=True, financial_settings=dict(gdp_enabled=True,
                gdp_targets=[dict(year=2026, target_share=.01)]))

    def test_signed_exports_and_linked_sanitation(self):
        from export_data import intervention_breakdown, WATER_INTV, SAN_INTV
        data = frontend_defaults()
        data['toggles'] = {key: False for key in data['toggles']}
        n = data['period']['forecast_end_year'] - data['period']['model_start_year'] + 1
        data['macro']['gdp_real_local'] = [100.] * n
        for prefix, sector in [('ws', 'water'), ('san', 'sanitation')]:
            data['bau'][prefix + '_expend_ts'] = [1.] * n
            data['bau'][prefix + '_alloc_ts'] = [5.] * n
            data['toggles'][prefix + '_financial_commitment_enabled'] = True
            data[sector + '_interventions'].update(fin_gdp_enabled=True,
                fin_gdp_targets=[dict(year=2026, target_share=.005), dict(year=2031, target_share=0)])
        result = calculate(coerce_to_engine(data))
        for sector, definitions in [('water_supply', WATER_INTV), ('sanitation', SAN_INTV)]:
            rows = intervention_breakdown(data, sector, definitions)
            financial = next(row for row in rows if row[0] == 'Increase in Public Spending')
            expected = sum(result[sector]['scenario_financial_commitment_cash']) / 1000
            self.assertLess(financial[2], 0)
            self.assertEqual(financial[2], round(expected, 4))
        # A scheduled sanitation cut coexists with the established linked NRW
        # cash/overlap pathway, without changing its independently supplied flows.
        linked_settings = dict(revenue_sector='Sanitation', extra_cash=[0.]+[3.]*10,
            eligible_nrw_cash=[0.]+[3.]*10, linked_nrw_volume=[0.]+[2.]*10,
            linked_overlap_volume=[0.]+[1.]*10)
        linked = self.dynamic([dict(year=2026, target_share=5)], **linked_settings)
        reference = self.dynamic(None, financial_enabled=False, **linked_settings)
        self.assertEqual(linked['nrw_link_cash'], reference['nrw_link_cash'])
        self.assertAlmostEqual(linked['nrw_link_cash'][1], 2 * 1 * .8)


if __name__ == '__main__':
    unittest.main()
