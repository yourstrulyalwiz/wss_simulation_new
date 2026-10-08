"""Selected-source cash, full-maturity sizing and export reconciliation."""
import copy
import unittest

from model.utility_debt import (
    UtilityDebtInputError, build_schedule, revenue_capacity_rows, validate_config,
)
from model.engine import calculate
from demo_adapter import coerce_to_engine
from test_utility_revenue import example
from export_data import _utility_debt_tables
from deck_aggregate import _aggregate_utility_debt


class UtilityDebtSourcesTests(unittest.TestCase):
    def config(self, sources=None):
        cfg = dict(enabled=True, allocation_share=.5, annual_real_interest_rate=.05,
                   disbursement_year=2026, maturity_year=2030, principal_grace_years=0,
                   repayment_structure='annuity')
        if sources is not None:
            cfg['revenue_sources'] = sources
        return cfg

    def ledger(self):
        return dict(collection_cash=[10, 10], tariff_cash=[20, 20],
                    nrw_net=[-15, 25], eligible_nrw_link_cash=[0, 5],
                    nrw_sales_cash=[15, 30], nrw_implementation_cost=[30, 5],
                    nrw_recurring_cash=[15, 30],
                    available_total=[100, 200], replacement_capex=[20, 30],
                    funded_asset_stock=[300, 600], exogenous_injection_cash=[0, 40],
                    custom_cash=[0, 50], connection_net_cash=[999, 999])

    def rows(self, sources=None, ledger=None):
        return revenue_capacity_rows(ledger or self.ledger(), [2026, 2027], 2025,
                                     self.config(sources))

    def test_source_choices_and_legacy_defaults(self):
        for sources, expected in [
            (['collection'], 10), (['tariff'], 20), (['nrw'], -15),
            (['collection', 'tariff'], 30), ([], 0), (None, 15),
        ]:
            with self.subTest(sources=sources):
                row = self.rows(sources)[0]
                self.assertEqual(row['eligible_additional_revenue'], expected)
                self.assertEqual(row['annual_service_capacity'], .5 * max(0, expected))

    def test_signed_sum_and_cash_protection(self):
        ledger = self.ledger()
        ledger['nrw_net'][0] = -40
        self.assertEqual(self.rows(None, ledger)[0]['annual_service_capacity'], 0)
        ledger['available_total'][0] = 23
        # An unselected negative stream still constrains actual available resources.
        row = self.rows(['tariff'], ledger)[0]
        self.assertEqual(row['protected_eligible_revenue'], 3)
        self.assertEqual(row['annual_service_capacity'], 1.5)

    def test_tail_uses_recurring_components_and_closing_assets(self):
        tail = self.rows()[-1]
        self.assertEqual(tail['year'], 2030)
        self.assertTrue(tail['post_target'])
        self.assertEqual(tail['nrw_net_cash'], 35)
        self.assertEqual(tail['eligible_additional_revenue'], 65)
        self.assertEqual(tail['pre_debt_available_capital'], 115)
        self.assertEqual(tail['replacement_requirement'], 20)
        self.assertEqual(tail['annual_service_capacity'], 32.5)
        self.assertEqual(tail['nrw_implementation_cost'], 0)
        ledger = self.ledger()
        del ledger['nrw_recurring_cash']
        # Unsupported positive NRW tail cash is excluded, not guessed.
        self.assertEqual(self.rows(['nrw'], ledger)[-1]['nrw_net_cash'], 5)

    def test_validation_rejects_connections_duplicates_and_unknowns(self):
        for sources in [['unsupported'], ['collection', 'collection'], 'tariff', None]:
            cfg = self.config([])
            cfg['revenue_sources'] = sources
            with self.assertRaises(UtilityDebtInputError):
                validate_config(cfg, [2026, 2027], 2025)
        self.assertEqual(validate_config(self.config(), [2026, 2027], 2025)['revenue_sources'],
                         ['collection', 'tariff', 'nrw'])

    def test_zero_rate_grace_and_both_repayment_structures(self):
        for structure in ['annuity', 'equal_principal']:
            cfg = self.config()
            cfg.update(annual_real_interest_rate=0, principal_grace_years=1,
                       repayment_structure=structure)
            rows = build_schedule(120, cfg)
            self.assertEqual(rows[0]['interest_payment'], 0)
            self.assertEqual(rows[1]['principal_payment'], 0)
            self.assertAlmostEqual(sum(r['principal_payment'] for r in rows), 120)
            self.assertEqual(rows[-1]['closing_principal'], 0)
        cfg = self.config()
        cfg['principal_grace_years'] = 1
        rows = build_schedule(120, cfg)
        self.assertEqual(rows[1]['principal_payment'], 0)
        self.assertAlmostEqual(rows[1]['interest_payment'], 6)

    def scenario(self, sources=None, allocation=.5, structure='annuity', rate=.05):
        data = example()
        by = data['period']['baseline_year']
        data['toggles'].update(ws_collection_efficiency_enabled=True, ws_tariff_enabled=True,
                               san_collection_efficiency_enabled=True, san_tariff_enabled=True)
        cfg = self.config(sources)
        cfg.update(disbursement_year=by+5, maturity_year=data['period']['forecast_end_year']+3,
                   allocation_share=allocation, repayment_structure=structure,
                   annual_real_interest_rate=rate, loan_ceiling=.01)
        data['utility_debt'] = {'water': copy.deepcopy(cfg), 'sanitation': copy.deepcopy(cfg)}
        original = copy.deepcopy(data)
        result = calculate(coerce_to_engine(data))
        self.assertEqual(data, original, 'Calculation must not mutate saved inputs')
        return result

    def test_engine_preview_no_sources_zero_allocation_and_real_loan(self):
        empty = self.scenario([])
        zero = self.scenario(['collection'], allocation=0)
        for sector in ['water_supply', 'sanitation']:
            debt = empty[sector]['scenario_utility_debt']
            self.assertEqual(debt['accepted_principal'], 0)
            self.assertTrue(debt['annual_injection'])
            self.assertEqual(debt['selected_signed_pool'], 0)
            self.assertEqual(empty[sector]['scenario_hh'],
                             empty[sector]['scenario_without_utility_debt_hh'])
            debt_zero = zero[sector]['scenario_utility_debt']
            self.assertEqual(debt_zero['accepted_principal'], 0)
            self.assertGreater(debt_zero['selected_signed_pool'], 0)
            self.assertEqual(debt_zero['annual_allocation'], 0)
        for structure, rate in [('annuity', .05), ('equal_principal', 0)]:
            result = self.scenario(['collection', 'tariff'], structure=structure, rate=rate)
            for sector in ['water_supply', 'sanitation']:
                debt = result[sector]['scenario_utility_debt']
                self.assertGreater(debt['accepted_principal'], 0)
                self.assertFalse(debt['verified_feasible'])
                self.assertNotIn('schedule', debt)
                self.assertAlmostEqual(debt['total_principal_repaid'], debt['accepted_principal'])
                self.assertEqual(debt['repayment_accounting'], 'fixed_annuity_modeled')
                self.assertAlmostEqual(debt['selected_signed_pool'],
                                       debt['reference_source_cash']['collection'] + debt['reference_source_cash']['tariff'])
                values = result[sector]['scenario_utility_debt_service']
                first = result['years'].index(debt['reference_year'])
                self.assertTrue(all(v == 0 for v in values[:first+1]))
                self.assertTrue(all(v == debt['fixed_annual_debt_service'] for v in values[first+1:]))

    def test_exports_and_area_aggregation(self):
        sec = self.scenario(['tariff'])['water_supply']
        debt = sec['scenario_utility_debt']
        summary, annual = _utility_debt_tables(sec, 'CDF')
        self.assertIn(['Selected intervention sources', 'tariff', None], summary[1])
        self.assertEqual(len(annual[1]), len({r['year'] for r in debt['annual_injection']} | {r['year'] for r in debt['repayment_schedule']}))
        self.assertTrue(any('Opening unspent' in h for h in annual[0]))
        total = _aggregate_utility_debt([debt, debt])
        self.assertAlmostEqual(total['accepted_principal'], 2*debt['accepted_principal'])
        self.assertEqual(total['areas'][0]['revenue_sources'], ['tariff'])
        for row, area in zip(total['annual_injection'], debt['annual_injection']):
            self.assertAlmostEqual(row['disbursement'], 2*area['disbursement'])
            self.assertAlmostEqual(row['closing_unspent_proceeds'], 2*area['closing_unspent_proceeds'])


if __name__ == '__main__':
    unittest.main()
