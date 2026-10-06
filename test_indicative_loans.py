"""Acceptance checks for indicative sizing, frozen references and execution."""
import copy
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from calculation_setup import restore_automatic_inputs
from demo_adapter import coerce_to_engine, frontend_defaults
from model.engine import calculate
from model.utility_debt import (
    UtilityDebtInputError, indicative_principal, normalize_indicative_config,
    solve_scenario, validate_config,
)
import test_debt_servicing as debt_fixture
from deck_aggregate import _aggregate_utility_debt
from loan_reporting import loan_tables


def config(**overrides):
    return dict(enabled=True, mode='indicative_lump_sum', allocation_share=.5,
                annual_real_interest_rate=.05, loan_term_years=10,
                disbursement_year=2026, revenue_sources=['collection', 'tariff'], **overrides)


class IndicativeLoanTests(unittest.TestCase):
    def solve(self, collection=6, tariff=-2, future_collection=-999, future_tariff=-999, **changes):
        cfg = config()
        cfg.update(changes)
        years = [2025, 2026, 2027]
        calls = []

        def calc(inputs, ctx, utility_debt_execution=None):
            plan = utility_debt_execution or {}
            calls.append(plan)
            principal = plan.get('loan_amount', 0)
            return {
                'collection_cash': [0, collection, future_collection],
                'tariff_cash': [0, tariff, future_tariff],
                'nrw_net': [0, -1, -999], 'eligible_nrw_link_cash': [0, 3, -999],
                'available_total': [0, -20, -30], 'replacement_capex': [0, 100, 200],
                'connection_net_cash': [10000]*3,
                'utility_debt_cash_opening': [0, 0, principal],
                'utility_debt_investment_used': [0, 0, principal / 2],
                'utility_debt_cash_closing': [0, principal, principal / 2],
            }
        inputs = SimpleNamespace(period=SimpleNamespace(baseline_year=2025))
        with patch('model.utility_debt.build_schedule', side_effect=AssertionError('Inactive schedule called')), \
             patch('model.utility_debt.revenue_capacity_rows', side_effect=AssertionError('Future affordability called')):
            result, plan, summary, reference = solve_scenario(calc, inputs, {'years': years}, cfg)
        return summary, plan, calls, reference

    def test_formula_and_small_rates(self):
        self.assertAlmostEqual(indicative_principal(5, .05, 10)[0], 38.608674646, places=8)
        self.assertEqual(indicative_principal(5, 0, 10), (50, 10))
        self.assertAlmostEqual(indicative_principal(5, 1e-12, 10)[0], 50, places=8)

    def test_signed_pool_one_rerun_and_carry_identity(self):
        debt, plan, calls, _ = self.solve()
        self.assertEqual(debt['selected_signed_pool'], 4)
        self.assertAlmostEqual(debt['indicative_principal'], 15.443469858, places=8)
        self.assertEqual(len(calls), 2)
        self.assertAlmostEqual(sum(plan['disbursement']), debt['indicative_principal'])
        self.assertEqual(sum(v > 0 for v in plan['disbursement']), 1)
        self.assertEqual(plan['schedule'], [])
        for key in ('principal_payment', 'interest_payment', 'debt_service'):
            self.assertEqual(plan[key], [0, 0, 0])
        for row in debt['annual_injection']:
            self.assertAlmostEqual(row['opening_unspent_proceeds'] + row['disbursement'],
                                   row['investment_from_loan_proceeds'] + row['closing_unspent_proceeds'])
        self.assertEqual(debt['annual_injection'][2]['disbursement'], 0)
        self.assertGreater(debt['annual_injection'][2]['closing_unspent_proceeds'], 0)

    def test_zero_and_empty_inputs_skip_rerun(self):
        for changes in ({'revenue_sources': []}, {'allocation_share': 0}, {'enabled': False}):
            debt, plan, calls, _ = self.solve(annual_real_interest_rate=None, loan_term_years=None, **changes)
            self.assertEqual(debt['indicative_principal'], 0)
            self.assertEqual(len(calls), 1)
        debt, _, calls, _ = self.solve(collection=1, tariff=-6)
        self.assertEqual(debt['selected_signed_pool'], -5)
        self.assertEqual(debt['eligible_pool'], 0)
        self.assertEqual(len(calls), 1)

    def test_nrw_link_is_counted_once_and_connections_excluded(self):
        debt, _, _, _ = self.solve(revenue_sources=['nrw'])
        self.assertEqual(debt['selected_signed_pool'], 2)
        self.assertEqual(debt['reference_source_cash']['nrw'], 2)

    def test_reference_does_not_change_with_allocation(self):
        low = self.solve(allocation_share=.2)[0]
        high = self.solve(allocation_share=.8)[0]
        self.assertEqual(low['reference_source_cash'], high['reference_source_cash'])
        self.assertAlmostEqual(high['indicative_principal'], 4 * low['indicative_principal'])
        self.assertEqual(self.solve()[0]['indicative_principal'],
                         self.solve(future_collection=100000, future_tariff=100000)[0]['indicative_principal'])

    def test_validation_and_no_term_horizon_cap(self):
        for field, values in {
            'allocation_share': [-.1, 1.1, float('nan'), float('inf')],
            'annual_real_interest_rate': [-1, float('nan'), None],
            'loan_term_years': [0, -1, 2.5, None],
            'revenue_sources': [['connections'], ['collection', 'collection'], 'tariff'],
            'disbursement_year': [2025, 2028, 2026.5, None],
        }.items():
            for value in values:
                cfg = config()
                cfg[field] = value
                with self.subTest(field=field, value=value), self.assertRaises(UtilityDebtInputError):
                    validate_config(cfg, [2025, 2026, 2027], 2025)
        cfg = config()
        cfg['loan_term_years'] = 100
        self.assertEqual(validate_config(cfg, [2025, 2026], 2025)['loan_term_years'], 100)

    def test_missing_selected_cash_fails_instead_of_zero(self):
        inputs = SimpleNamespace(period=SimpleNamespace(baseline_year=2025))
        for value in (None, float('nan')):
            with self.assertRaisesRegex(UtilityDebtInputError, 'collection'):
                solve_scenario(lambda *a, **k: {'collection_cash': [value]}, inputs,
                               {'years': [2026]}, {**config(), 'revenue_sources': ['collection']})

    def test_migration_and_roundtrip(self):
        for structure in ('annuity', 'equal_principal'):
            old = dict(enabled=True, allocation_share=.5, annual_real_interest_rate=.05,
                       disbursement_year=2026, maturity_year=2046, principal_grace_years=4,
                       repayment_structure=structure, loan_ceiling=.01)
            original = copy.deepcopy(old)
            cfg = normalize_indicative_config(old)
            self.assertEqual(cfg['loan_term_years'], 20)
            self.assertEqual(cfg['legacy_parameters']['repayment_structure'], structure)
            self.assertEqual(cfg['legacy_parameters']['loan_ceiling'], .01)
            self.assertEqual(normalize_indicative_config(cfg), cfg)
            self.assertEqual(old, original)
            cleared = dict(cfg, loan_term_years=None)
            self.assertIsNone(normalize_indicative_config(cleared)['loan_term_years'])
        defaults = frontend_defaults()['utility_debt']
        self.assertEqual(defaults['schema_version'], 2)
        self.assertIsNone(defaults['water']['loan_term_years'])

    def test_model_execution_no_repayments_and_preinjection_equality(self):
        fixture = debt_fixture.DebtServicingTests()
        data, on = fixture.scenario(connection=True)
        _, off = fixture.scenario(False, connection=True)
        for sector in ('water_supply', 'sanitation'):
            sec = on[sector]
            debt = sec['scenario_utility_debt']
            first = on['years'].index(debt['reference_year'])
            for key in ('hh', 'available_total', 'replacement_capex', 'nrw_net'):
                actual, expected = sec['scenario_' + key], off[sector]['scenario_' + key]
                if key == 'hh':
                    for a, e in zip(actual, expected):
                        self.assertEqual(a[:first], e[:first])
                else:
                    self.assertEqual(actual[:first], expected[:first])
            for key in ('principal_payment', 'interest_payment', 'service'):
                self.assertEqual(sec['scenario_utility_debt_' + key], [0]*len(on['years']))
            for row in debt['annual_injection']:
                self.assertAlmostEqual(row['opening_unspent_proceeds'] + row['disbursement'],
                                       row['investment_from_loan_proceeds'] + row['closing_unspent_proceeds'])
            self.assertEqual(debt['repayment_accounting'], 'deferred')

    def test_independent_geography_timing_and_currency_conversion(self):
        early = self.solve()[0]
        late = self.solve(disbursement_year=2027, loan_term_years=5, annual_real_interest_rate=0,
                          future_collection=20, future_tariff=4)[0]
        negative = self.solve(collection=1, tariff=-600)[0]
        total = _aggregate_utility_debt([early, late, negative])
        self.assertEqual(total['areas'][1]['reference_year'], 2027)
        self.assertEqual(total['indicative_principal'], early['indicative_principal'] + late['indicative_principal'])
        self.assertNotIn('annual_real_interest_rate', total)
        self.assertNotIn('loan_term_years', total)
        self.assertEqual(sum(r['disbursement'] for r in total['annual_injection']), total['indicative_principal'])
        summary, annual = loan_tables(early, 'USD', money_factor=.001)
        self.assertIn(['Indicative loan proceeds', None, early['indicative_principal']*.001], summary[1])
        self.assertIn(['Loan term (years)', 10, None], summary[1])
        self.assertTrue(all('Deferred' in row[-1] for row in annual[1]))

    def test_sanitation_reference_uses_water_without_any_loan(self):
        fixture = debt_fixture.DebtServicingTests()
        inputs, _ = fixture.scenario(connection=True)
        inputs['toggles'].update(ws_nrw_enabled=True, san_nrw_link_enabled=True)
        inputs['utility_debt']['water']['revenue_sources'] = ['collection', 'tariff']
        results = []
        for share in (.1, .9):
            data = copy.deepcopy(inputs)
            data['utility_debt']['water']['allocation_share'] = share
            results.append(calculate(coerce_to_engine(data)))
        self.assertGreater(results[1]['water_supply']['scenario_utility_debt']['indicative_principal'],
                           results[0]['water_supply']['scenario_utility_debt']['indicative_principal'])
        low, high = (r['sanitation']['scenario_utility_debt'] for r in results)
        self.assertEqual(low['reference_source_cash'], high['reference_source_cash'])
        self.assertEqual(low['indicative_principal'], high['indicative_principal'])
        self.assertEqual(results[0]['sanitation']['scenario_without_utility_debt_hh'],
                         results[1]['sanitation']['scenario_without_utility_debt_hh'])


if __name__ == '__main__':
    unittest.main()
