"""Post-intervention numeric, isolation, scope and bounded-search acceptance."""
import copy
import json
import time
import unittest
from types import SimpleNamespace
import numpy as np
from test_support import frontend_defaults
from demo_adapter import coerce_to_engine
from model.engine import calculate
from model.water_supply import sector_bau
from model.post_intervention import analyse, target_path, fixed_reference
from model.post_intervention_solver import solve_share, composition, SOURCE
from model.source_funding import allocate_sources
from simulation_scope import public_bundle


def controlled(q=0., years=3, lower=False, execution=None):
    start = [0, 0, 1, 0, 0] if lower else [.4, .6, 0, 0, 0]
    target = [1, 0, 0, 0, 0] if lower else [.6, .4, 0, 0, 0]
    ys = list(range(2025, 2025+years))
    total = np.full(years, .0001)  # 100 households
    original = np.repeat(np.array(start)[:, None]*.0001, years, axis=1)
    pathway, _ = target_path(original, total, ys, 2025, ys[-1],
                            dict(safelyManagedShare=target[0], atLeastBasicShare=sum(target[:2])))
    ctx = dict(n=years, bi=0, years=np.array(ys), total_hh=total, population=total*3,
               forecast_flag=np.r_[0., np.ones(years-1)], perf_flag=np.r_[0., np.ones(years-1)],
               end_asis_year=2025, gdp_real_local=np.ones(years),
               post_options=dict(targets=pathway, funding=np.r_[0., np.full(years-1, q)]))
    return sector_bau(ctx, period=SimpleNamespace(model_start_year=2025, baseline_year=2025,
        target1_year=ys[-1], target2_year=ys[-1]), pct_start=start, pct_base=start, tgt1=target, tgt2=target,
        cost_sm=1000, cost_basic=1000, full_budget=np.zeros(years), capex_pct=.1, growth_capex_pct=0,
        planned_list=[], nonhh_pct=0, asset_life=float('inf'), basic_share=0,
        capex_adder=0, hist_all_proportional=True, target_adjusted=False,
        utility_debt_execution=execution)


def bundle():
    raw = frontend_defaults()
    return dict(__wss_bundle=1, inputs=raw, altInputs={},
                scope=dict(scopeMode='urban_rural', areaUrban=True, areaRural=False, sectors=['water', 'sanitation']))


def settings(**changes):
    return dict(version=1, targetYear=2040, fundingMethod='constant_gdp_share',
                targetOverrides={}, toggleOverrides={}, **changes)


class PostInterventionTests(unittest.TestCase):
    def test_controlled_one_percent_engine_replay_and_independence_from_capital_share(self):
        zero = controlled()
        self.assertAlmostEqual(composition(zero, 2)['total'], .02)
        q, financed, status, diagnostic = solve_share(controlled, zero, 2, 2., time.monotonic()+5)
        self.assertEqual(status, 'solved')
        self.assertAlmostEqual(q, .01, places=6)
        self.assertLessEqual(composition(financed, 2)['total'], diagnostic['monetary_tolerance'])
        self.assertAlmostEqual(financed['bau_hh'][0][2]*1e6, 60, delta=.001)
        ledger = financed['source_funding']
        for i in (1, 2):
            self.assertAlmostEqual(ledger['signed_contribution'][SOURCE][i], q)
            self.assertAlmostEqual(ledger['sm_capital_spent'][SOURCE][i], q)
            self.assertAlmostEqual(ledger['unused'][SOURCE][i], 0)
        self.assertIn(SOURCE, financed['coverage_attribution']['source_keys'])

    def test_one_year_cannot_double_transition_even_with_unlimited_cash(self):
        result = controlled(1., years=2, lower=True)
        self.assertEqual(result['bau_hh'][0][1], 0)
        self.assertGreater(composition(result, 1)['total'], 0)
        q, _, status, _ = solve_share(lambda q: controlled(q, years=2, lower=True),
                                     controlled(years=2, lower=True), 1, 1., time.monotonic()+5)
        self.assertIsNone(q)
        self.assertNotEqual(status, 'solved')

    def test_extra_source_cannot_service_selected_source_debt(self):
        allocation = allocate_sources({SOURCE: 10., 'tariff': 0.}, debt_due=5., selected=('tariff',))
        self.assertEqual(allocation['debt_service_paid'], 0)
        self.assertEqual(allocation['expansion_available'][SOURCE], 10)

    def test_target_zero_blank_hierarchy_and_linear_zero_sm(self):
        original = np.array([[0, 0, 0], [0, 0, 0], [1, 1, 1], [0, 0, 0], [0, 0, 0]], dtype=float)
        path, _ = target_path(original, np.ones(3), [2025, 2026, 2027], 2025, 2027,
                              dict(safelyManagedShare=.6, atLeastBasicShare=1.))
        self.assertEqual(path[0, 1], .3)
        zero, _ = target_path(original, np.ones(3), [2025, 2026, 2027], 2025, 2027,
                              dict(safelyManagedShare=0, atLeastBasicShare=0))
        self.assertEqual(zero[0, -1], 0)
        for sm, ab in ((None, 1), (.9, .5), (0, float('nan')), (-.1, 1)):
            with self.assertRaises(ValueError):
                target_path(original, np.ones(3), [2025, 2026, 2027], 2025, 2027,
                            dict(safelyManagedShare=sm, atLeastBasicShare=ab))

    def test_unedited_reference_exact_parity_and_no_mutation(self):
        b = bundle(); before = copy.deepcopy(b)
        r = analyse(dict(bundle=b, includeDebt=False))
        normal = calculate(coerce_to_engine(b['inputs']))
        for sector, key in [('water', 'water_supply'), ('sanitation', 'sanitation')]:
            actual = r['per_area_sector']['urban'][sector]
            self.assertEqual(actual['reference_coverage']['sm'], normal[key]['scenario_hh'][0])
            self.assertEqual(actual['target_coverage']['sm'], normal[key]['scenario_target_hh'][0])
            self.assertEqual(actual['adjusted_existing_funding_coverage']['sm'], actual['reference_coverage']['sm'])
            self.assertAlmostEqual(actual['target_year_residual_total'], normal[key]['scenario_endline_financing_requirement'][-1])
        self.assertEqual(b, before)
        json.dumps(r, allow_nan=False)

    def test_lower_targets_cancel_work_without_demolition_or_refunds(self):
        b = bundle()
        s = settings()
        s['targetOverrides'] = {'urban': {'water': dict(safelyManagedShare=0, atLeastBasicShare=0)}}
        r = analyse(dict(bundle=b, settings=s, includeDebt=False))
        bucket = r['per_area_sector']['urban']['water']
        self.assertEqual(bucket['target_year_residual_components']['household_expansion'], 0)
        self.assertGreater(bucket['adjusted_existing_funding_coverage']['sm'][-1], 0)
        self.assertEqual(bucket['target_coverage']['sm'][-1], 0)

    def test_invalid_sanitation_preserves_water(self):
        b = bundle()
        b['inputs']['connection_revenue']['sanitation'].update(enabled=True, new_billed_share_basic=None)
        r = analyse(dict(bundle=b, includeDebt=False))
        self.assertEqual(r['per_area_sector']['urban']['sanitation']['solver_status'], 'invalid_inputs')
        self.assertIn('target_year_residual_total', r['per_area_sector']['urban']['water'])
        self.assertFalse(r['combined']['complete'])

    def test_conflicting_gdp_suppresses_equivalent_not_residuals(self):
        b = bundle(); b['scope']['areaRural'] = True
        b['altInputs']['rural'] = copy.deepcopy(b['inputs'])
        b['altInputs']['rural']['macro']['gdp_real_local'] = [v*2 if v else v for v in b['inputs']['macro']['gdp_real_local']]
        r = analyse(dict(bundle=b, includeDebt=False))
        self.assertIsNone(r['national_gdp'])
        self.assertIsNone(r['combined']['funding_fraction'])
        for a in ('urban', 'rural'):
            self.assertIn('target_year_residual_total', r['per_area_sector'][a]['water'])

    def test_target_year_and_malformed_settings_rejected(self):
        b = bundle()
        for year in (None, 2025, 2041, 2030.5):
            s = settings(); s['targetYear'] = year
            with self.assertRaises(ValueError):
                analyse(dict(bundle=b, settings=s))
        with self.assertRaises(ValueError):
            analyse(dict(bundle=b, settings=[]))

    def test_dormant_overrides_preserved_privately_but_not_published(self):
        b = bundle(); b['postIntervention'] = settings()
        b['postIntervention']['targetOverrides'] = {'urban': {'water': dict(safelyManagedShare=.5, atLeastBasicShare=1)},
                                                   'rural': {'water': dict(safelyManagedShare=.8, atLeastBasicShare=1)}}
        result = public_bundle(b)
        self.assertIn('urban', result['postIntervention']['targetOverrides'])
        self.assertNotIn('rural', result['postIntervention']['targetOverrides'])
        self.assertIn('rural', b['postIntervention']['targetOverrides'])

    def test_bounded_timeout_never_claims_success(self):
        q, _, status, _ = solve_share(controlled, controlled(), 2, 2., time.monotonic()-1)
        self.assertIsNone(q); self.assertEqual(status, 'nonconvergent')

    def test_fixed_loan_plan_does_not_depend_on_new_targets_or_cash(self):
        summary = dict(accepted_principal=10., fixed_annual_debt_service=5., annual_real_interest_rate=0,
                       loan_term_years=2, reference_year=2026, revenue_sources=['tariff'])
        plan = fixed_reference(summary, [2025, 2026, 2027, 2028])
        self.assertEqual(plan['disbursement'], [0, 10, 0, 0])
        self.assertEqual(plan['debt_service'], [0, 0, 5, 5])
        self.assertNotIn(SOURCE, plan['servicing_sources'])


if __name__ == '__main__':
    unittest.main()
