"""Historical investment inference uses the forward two-stage convention."""
import unittest
import copy
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np

from model.service_history import historical_transition_counts
from model.water_supply import sector_bau
from model.engine import calculate
from demo_adapter import coerce_to_engine


CASES = [
    ((100, 200), (150, 200), (50, 50), 100000),
    ((100, 200), (150, 150), (50, 0), 50000),
    ((100, 200), (100, 250), (0, 50), 50000),
    ((100, 200), (100, 200), (0, 0), 0),
    ((100, 200), (90, 180), (0, 0), 0),
    # SM declines do not create a refund; growth in combined access still costs.
    ((100, 200), (90, 220), (0, 10), 10000),
]


def legacy_counts(sm, basic):
    return np.maximum(np.diff(sm), 0), np.maximum(np.diff(basic), 0)


def run_history(initial, final, *, sanitation=False, scale=1,
                source='from_cost', override=None, asset_life=float('inf'),
                cost_sm=1000, cost_basic=1000):
    n, bi = 4, 1
    total = 400 * scale / 1e6
    shares = lambda sb: [sb[0] / 400, sb[1] / 400,
                         1 - sum(sb) / 400, 0, 0]
    start, base = shares(initial), shares(final)
    ctx = {
        'n': n, 'bi': bi, 'years': np.arange(2024, 2028),
        'total_hh': np.full(n, total), 'population': np.full(n, total * 3),
        'forecast_flag': np.array([0., 0., 1., 1.]),
        'perf_flag': np.array([0., 0., 1., 1.]),
        'end_asis_year': 2025, 'gdp_real_local': np.array([1., 1., 2., 3.]),
    }
    return sector_bau(
        ctx, period=SimpleNamespace(model_start_year=2024, baseline_year=2025,
                                    target1_year=2026, target2_year=2027),
        pct_start=start, pct_base=base, tgt1=base, tgt2=base,
        cost_sm=cost_sm, cost_basic=cost_basic,
        full_budget=np.array([.01, .02, .03, .04]), capex_pct=.5,
        growth_capex_pct=0, planned_list=[], nonhh_pct=0,
        asset_life=asset_life, capex_adder=0,
        hist_all_proportional=not sanitation, target_adjusted=sanitation,
        basic_share=.5, budget_source=source, budget_override=override,
    )


class HistoricalTransitionTests(unittest.TestCase):
    def test_controlled_transitions_and_millions_convention(self):
        for initial, final, transitions, expected_cost in CASES:
            for units in (1, 1e-6):
                with self.subTest(initial=initial, final=final, units=units):
                    sm, basic = historical_transition_counts(
                        np.array([initial[0], final[0]]) * units,
                        np.array([initial[1], final[1]]) * units)
                    np.testing.assert_allclose([sm[0], basic[0]],
                                               np.array(transitions) * units,
                                               atol=1e-15)
                    self.assertAlmostEqual((sm[0] + basic[0]) * 1000,
                                           expected_cost * units)

    def test_inferred_investment_and_forecast_in_both_sector_area_modes(self):
        for sanitation in (False, True):
            for area, scale in [('urban', 1), ('rural', 2)]:
                for initial, final, _, expected_cost in CASES:
                    with self.subTest(sanitation=sanitation, area=area,
                                      initial=initial, final=final):
                        result = run_history(initial, final,
                                             sanitation=sanitation, scale=scale)
                        # Mean historical investment/GDP = cost / 1 M currency.
                        expected = expected_cost * scale / 1e6
                        np.testing.assert_allclose(result['budget_used'],
                                                   [0, expected, 2*expected, 3*expected],
                                                   atol=1e-12)
                        np.testing.assert_allclose(result['bau_available'][2:],
                                                   result['budget_used'][2:])

    def test_independent_areas_aggregate_after_costing(self):
        # Urban SM increases while Rural decreases: do not net transitions first.
        for sanitation in (False, True):
            urban = run_history((100, 200), (150, 200), sanitation=sanitation)
            rural = run_history((100, 200), (50, 200), sanitation=sanitation)
            self.assertAlmostEqual(urban['budget_used'][1] + rural['budget_used'][1], .1)
            sm, basic = historical_transition_counts([200, 200], [400, 400])
            self.assertEqual(sm[0] + basic[0], 0)

    def test_cost_convention_is_retained(self):
        result = run_history((100, 200), (150, 200), cost_sm=2000, cost_basic=500)
        self.assertAlmostEqual(result['budget_used'][1], .125)

    def test_explicit_budget_paths_unchanged_against_legacy(self):
        for sanitation in (False, True):
            for source, override in [
                ('direct', None), ('pct_gdp', None),
                ('from_cost', [.01, .02, .03, .04]),
            ]:
                with self.subTest(sanitation=sanitation, source=source):
                    kwargs = dict(sanitation=sanitation, source=source,
                                  override=override, asset_life=20)
                    with patch('model.water_supply.historical_transition_counts',
                               side_effect=legacy_counts) as helper:
                        before = run_history((100, 200), (150, 200), **kwargs)
                        if source != 'from_cost':
                            helper.assert_not_called()
                    after = run_history((100, 200), (150, 200), **kwargs)
                    self.assertEqual(before, after)

    def test_replacement_separate_and_priority_unchanged(self):
        for sanitation in (False, True):
            result = run_history((100, 200), (150, 200),
                                 sanitation=sanitation, asset_life=10)
            # Inferred historical investment contains expansion only.
            self.assertAlmostEqual(result['budget_used'][1], .1)
            # Opening funded SM + Basic capital: 350 HH * 1000 = .35 M.
            self.assertAlmostEqual(result['replacement_capex'][2], .035)
            self.assertAlmostEqual(result['bau_replacement_capex'][2], .035)
            self.assertAlmostEqual(sum(row[2] for row in
                                       result['replacement_funding_applied_by_service']), .035)
            self.assertLessEqual(result['connection_purchase_capital'][2],
                                 result['budget_used'][2] - .035 + 1e-12)

    def test_baseline_and_future_coverage_change_only_in_cost_derived_mode(self):
        for sanitation in (False, True):
            with patch('model.water_supply.historical_transition_counts',
                       side_effect=legacy_counts):
                before = run_history((100, 200), (150, 200), sanitation=sanitation)
            after = run_history((100, 200), (150, 200), sanitation=sanitation)
            self.assertAlmostEqual(before['budget_used'][1], .05)
            self.assertAlmostEqual(after['budget_used'][1], .1)
            np.testing.assert_allclose(np.array(before['bau_hh'])[:, :2],
                                       np.array(after['bau_hh'])[:, :2])
            self.assertFalse(np.allclose(np.array(before['bau_hh'])[:, 2:],
                                         np.array(after['bau_hh'])[:, 2:],
                                         atol=1e-12))

    def test_full_engine_sector_area_call_sites_and_gdp_projection(self):
        profile = json.loads((Path(__file__).parent / 'profiles' /
                              'DRC_Mock_Simulation.json').read_text())
        for area, original in [('urban', profile['inputs']),
                               ('rural', profile['altInputs']['rural'])]:
            inputs = copy.deepcopy(original)
            inputs['bau'].update(budget_source='from_cost', budget_input_mode='from_cost',
                                 ws_expend_ts=[], san_expend_ts=[])
            result = calculate(coerce_to_engine(inputs))
            bi = result['years'].index(inputs['period']['baseline_year'])
            gdp = np.asarray(result['gdp_real_local'])
            for sector in ('water_supply', 'sanitation'):
                with self.subTest(area=area, sector=sector):
                    sec = result[sector]
                    sm, basic = np.array(sec['bau_hh'])[:2, :bi+1]
                    expected = (np.maximum(np.diff(sm), 0) * sec['cost_per_hh']
                                + np.maximum(np.diff(sm + basic), 0) * sec['cost_basic'])
                    np.testing.assert_allclose(sec['budget_used'][1:bi+1], expected)
                    valid = (gdp[1:bi+1] > 0) & (expected > 0)
                    ratio = np.mean(expected[valid] / gdp[1:bi+1][valid]) if valid.any() else 0
                    np.testing.assert_allclose(sec['budget_used'][bi+1:],
                                               ratio * gdp[bi+1:])


if __name__ == '__main__':
    unittest.main()
