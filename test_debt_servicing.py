"""Start-year anchoring, annual diagnostics and one-time coverage financing."""
import copy
import unittest
from types import SimpleNamespace

from model.utility_debt import solve_scenario
from model.engine import calculate
from demo_adapter import coerce_to_engine
from test_utility_revenue import example
from test_connection_revenue import configuration as connection_config
from export_data import _utility_debt_tables
from deck_aggregate import _aggregate_utility_debt


class DebtServicingTests(unittest.TestCase):
    def solve(self, revenues, *, start=2026, maturity=2029, rate=0,
              structure='annuity', grace=0, available=None, replacement_fraction=0):
        years = list(range(2026, 2026 + len(revenues)))
        cfg = dict(enabled=True, allocation_share=.5, annual_real_interest_rate=rate,
                   disbursement_year=start, maturity_year=maturity,
                   repayment_structure=structure, principal_grace_years=grace,
                   revenue_sources=['collection'])
        inputs = SimpleNamespace(period=SimpleNamespace(baseline_year=2025))

        def calc(inputs, ctx, utility_debt_execution=None):
            plan = utility_debt_execution or {}
            principal = plan.get('loan_amount', 0)
            n = len(years)
            return dict(
                collection_cash=list(revenues), available_total=list(available or [1000]*n),
                replacement_capex=[0] + [principal*replacement_fraction]*(n-1),
                funded_asset_stock=[0]*n,
                utility_debt_cash_opening=[0]*n,
                utility_debt_cash_closing=[0]*n,
                utility_debt_disbursement=plan.get('disbursement', [0]*n),
                utility_debt_investment_used=plan.get('disbursement', [0]*n),
            )
        return solve_scenario(calc, inputs, {'years': years}, cfg)[2]

    def test_growth_does_not_inflate_start_year_principal(self):
        debt = self.solve([10, 20, 40, 80])
        self.assertEqual(debt['annual_allocation'], 5)
        self.assertAlmostEqual(debt['accepted_principal'], 15)
        self.assertEqual(debt['reference_source_cash']['collection'], 10)
        self.assertNotIn('binding_constraint', debt)
        self.assertEqual(sum(r['disbursement'] > 0 for r in debt['annual_injection']), 1)
        self.assertAlmostEqual(sum(r['disbursement'] for r in debt['annual_injection']), 15)

    def test_later_start_uses_that_year_not_first_forecast_row(self):
        early = self.solve([10, 20, 40, 80])
        later = self.solve([10, 20, 40, 80], start=2027, maturity=2030)
        self.assertEqual(later['selected_signed_pool'], 20)
        self.assertEqual(later['annual_allocation'], 10)
        self.assertAlmostEqual(later['accepted_principal'], 30)
        self.assertGreater(later['accepted_principal'], early['accepted_principal'])
        self.assertEqual(later['annual_injection'][-1]['year'], 2029)

    def test_later_shortfall_does_not_resize_indicative_loan(self):
        debt = self.solve([20, 8, 4, 30])
        self.assertAlmostEqual(debt['accepted_principal'], 30)
        self.assertEqual(debt['repayment_accounting'], 'deferred')
        self.assertNotIn('limiting_repayment_year', debt)

    def test_zero_start_and_grace_interest_shortfall(self):
        self.assertEqual(self.solve([0, 100, 100, 100])['accepted_principal'], 0)
        self.assertGreater(self.solve([10, 0, 100, 100], rate=.05, grace=1)['accepted_principal'], 0)

    def test_rates_and_structures_respect_start_limit_and_full_schedule(self):
        for structure in ('annuity', 'equal_principal'):
            for rate in (0, .05):
                debt = self.solve([10, 20, 30, 40], structure=structure, rate=rate)
                self.assertGreater(debt['accepted_principal'], 0)
                self.assertFalse(debt['verified_feasible'])
                self.assertEqual(debt['feasibility_status'], 'not_assessed')
                self.assertNotIn('total_principal_repaid', debt)
                self.assertNotIn('schedule', debt)

    def test_candidate_replacement_does_not_resize_frozen_reference(self):
        debt = self.solve([10]*4, available=[10]*4, replacement_fraction=.5)
        self.assertEqual(debt['accepted_principal'], 15)
        self.assertEqual(debt['reference_source_cash']['collection'], 10)

    def scenario(self, enabled=True, connection=False):
        data = example()
        by = data['period']['baseline_year']
        data['toggles'].update(ws_collection_efficiency_enabled=True, ws_tariff_enabled=True,
                               san_collection_efficiency_enabled=True, san_tariff_enabled=True)
        cfg = dict(enabled=enabled, allocation_share=.5, annual_real_interest_rate=.05,
                   disbursement_year=by+5, maturity_year=data['period']['forecast_end_year']+3,
                   principal_grace_years=0, repayment_structure='annuity', loan_ceiling=.01)
        data['utility_debt'] = {'water': copy.deepcopy(cfg), 'sanitation': copy.deepcopy(cfg)}
        data['water_interventions']['basic_share'] = .35
        data['sanitation_interventions']['basic_share'] = .35
        if connection:
            data['connection_revenue'] = {sector: connection_config(funding_reference='fixed')
                                          for sector in ('water', 'sanitation')}
        original = copy.deepcopy(data)
        results = calculate(coerce_to_engine(data))
        self.assertEqual(data, original)
        return data, results

    def test_disabled_table_and_existing_split_and_access_diagnostics(self):
        off_data, off = self.scenario(False)
        data, on = self.scenario(True)
        self.assertEqual(data['water_interventions']['basic_share'], .35)
        for sector in ('water_supply', 'sanitation'):
            table = off[sector]['scenario_utility_debt']['annual_injection']
            self.assertTrue(table)
            self.assertTrue(all(r['disbursement'] == 0 for r in table))
            sec = on[sector]
            self.assertEqual(sec['scenario_without_utility_debt_hh'], off[sector]['scenario_hh'])
            for key in ('sm_access_gap', 'at_least_basic_access_gap'):
                self.assertEqual(sec['scenario_without_utility_debt_' + key], off[sector]['scenario_' + key])
            debt = sec['scenario_utility_debt']
            rows = debt['annual_injection']
            self.assertEqual(sum(r['disbursement'] > 0 for r in rows), 1)
            self.assertAlmostEqual(sum(r['disbursement'] for r in rows), debt['accepted_principal'])
            self.assertTrue(all(v == 0 for v in sec['scenario_utility_debt_principal_payment']))

    def test_customer_feedback_changes_reforms_but_connection_cash_stays_excluded(self):
        _, result = self.scenario(connection=True)
        for sector in ('water_supply', 'sanitation'):
            sec = result[sector]
            self.assertTrue(sec['scenario_connection_revenue']['effective'])
            debt = sec['scenario_utility_debt']
            self.assertTrue(sec['scenario_connection_revenue']['effective'])
            self.assertTrue(any(abs(v) > 0 for v in sec['scenario_connection_net_cash']))
            self.assertAlmostEqual(debt['selected_signed_pool'],
                                   sum(debt['reference_source_cash'][s] for s in debt['revenue_sources']))
            self.assertNotIn('connections', debt['revenue_sources'])

    def test_exports_and_area_specific_aggregation(self):
        _, results = self.scenario()
        sec = results['water_supply']
        debt = sec['scenario_utility_debt']
        summary, annual = _utility_debt_tables(sec, 'CDF')
        self.assertIn(['Indicative loan proceeds', None, debt['indicative_principal']], summary[1])
        self.assertTrue(any('Opening unspent' in h for h in annual[0]))
        total = _aggregate_utility_debt([debt, debt])
        self.assertEqual(total['annual_allocation'], 2*debt['annual_allocation'])
        self.assertEqual(total['indicative_principal'], 2*debt['indicative_principal'])
        self.assertNotIn('limiting_repayment_year', total)
        self.assertEqual(total['areas'], [debt, debt])


if __name__ == '__main__':
    unittest.main()
