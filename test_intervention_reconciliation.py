"""Revenue/physical/capital separation and signed, ordered scenario attribution."""

import copy
import itertools
import unittest

import numpy as np

from deck_aggregate import aggregate
from deck_data import cumulative_passes, intervention_rows
from demo_adapter import coerce_to_engine, frontend_defaults
from export_data import intervention_breakdown, per_year_table, WATER_INTV, SAN_INTV
from model.engine import calculate
from model.finance import funding_ledger
from model.intervention_order import INTERVENTION_ORDER


class InterventionReconciliationTests(unittest.TestCase):
    def run_model(self, inputs):
        return calculate(coerce_to_engine(inputs))

    def test_combined_revenue_formula_and_attribution_all_toggle_combinations(self):
        for collection, tariff, nrw in itertools.product((False, True), repeat=3):
            with self.subTest(collection=collection, tariff=tariff, nrw=nrw):
                inputs = frontend_defaults()
                inputs['toggles'].update(ws_collection_efficiency_enabled=collection,
                                         ws_tariff_enabled=tariff, ws_nrw_enabled=nrw)
                inputs['water_interventions']['ce_current_ratio'] = 0.6
                result = self.run_model(inputs)
                sec = result['water_supply']
                arr = lambda key: np.asarray(sec['scenario_' + key])
                baseline = np.asarray(sec['billed_volume_bau']) * np.asarray(sec['tariff_path']) * np.asarray(sec['collection_path'])
                expected = arr('billed_volume_scenario') * arr('tariff_path') * arr('collection_path') - baseline
                np.testing.assert_allclose(arr('shared_revenue_cash'), expected, atol=1e-8)
                np.testing.assert_allclose(arr('shared_revenue_cash'),
                                           sum(arr(key) for key in ('collection_cash', 'nrw_commercial_cash', 'nrw_service_cash', 'tariff_cash')))
                np.testing.assert_allclose(arr('additional_net_utility_cash'),
                                           expected + arr('nrw_production_savings') - arr('nrw_maintenance_cost')
                                           + arr('custom_revenue_cash') + arr('nrw_link_cash'), atol=1e-8)

    def test_physical_allocation_endpoints_and_commercial_water_distinction(self):
        for share in (0.0, 0.3, 1.0):
            inputs = frontend_defaults()
            inputs['toggles']['ws_nrw_enabled'] = True
            inputs['water_interventions']['nrw_service_allocation_pct'] = share
            sec = self.run_model(inputs)['water_supply']
            field = lambda key: np.asarray(sec['scenario_' + key])
            recovered = field('nrw_recovered_phys_total_vol')
            np.testing.assert_allclose(field('nrw_recovered_phys_vol'), recovered * share)
            np.testing.assert_allclose(field('nrw_production_avoided_vol'), recovered * (1 - share))
            np.testing.assert_allclose(field('nrw_production_savings'),
                                       recovered * (1 - share) * inputs['water_interventions']['nrw_production_cost'])
            if share == 0:
                self.assertEqual(sum(field('nrw_upgrade_hh')), 0)
                self.assertEqual(sum(field('nrw_service_cash')), 0)
            if share == 1:
                self.assertEqual(sum(field('nrw_production_savings')), 0)

        inputs['water_interventions'].update(nrw_physical_loss_pct=0.0, nrw_commercial_loss_pct=1.0)
        sec = self.run_model(inputs)['water_supply']
        self.assertGreater(sum(sec['scenario_nrw_commercial_cash']), 0)
        self.assertEqual(sum(sec['scenario_nrw_recovered_phys_total_vol']), 0)
        self.assertEqual(sum(sec['scenario_nrw_upgrade_hh']), 0)

    def test_invalid_nrw_allocations_fail_explicitly(self):
        inputs = frontend_defaults()
        inputs['toggles']['ws_nrw_enabled'] = True
        inputs['water_interventions'].update(nrw_physical_loss_pct=0.8, nrw_commercial_loss_pct=0.8)
        with self.assertRaisesRegex(ValueError, '100%'):
            self.run_model(inputs)

    def test_no_free_nrw_upgrades_when_no_connection_funding(self):
        inputs = frontend_defaults()
        inputs['toggles']['ws_nrw_enabled'] = True
        inputs['macro'].update(ws_budget_pct_gdp=0, budget_input_mode='pct_gdp', budget_source='pct_gdp')
        inputs['water_interventions'].update(nrw_service_allocation_pct=1.0, tariff_current=0,
                                           nrw_capex_unit_cost_local=0)
        sec = self.run_model(inputs)['water_supply']
        self.assertGreater(sum(sec['scenario_nrw_potential_upgrade_hh']), 0)
        self.assertEqual(sum(sec['scenario_nrw_upgrade_hh']), 0)
        self.assertEqual(sum(sec['scenario_nrw_service_upgrade_capex']), 0)

    def test_legacy_independent_nrw_tariff_does_not_double_value_sales(self):
        inputs = frontend_defaults()
        inputs['toggles'].update(ws_nrw_enabled=True, ws_tariff_enabled=True)
        first = self.run_model(inputs)['water_supply']
        inputs['water_interventions']['nrw_tariff'] = 100000
        after = self.run_model(inputs)['water_supply']
        np.testing.assert_allclose(first['scenario_shared_revenue_cash'], after['scenario_shared_revenue_cash'])

    def test_custom_shared_allocations_cost_factors_and_input_immutability(self):
        inputs = frontend_defaults()
        inputs['custom_interventions'] = [
            {'name': 'Shared income', 'sector': 'both', 'enabled': True,
             'intervention_type': 'new_revenue', 'start_year': 2026, 'cost_years': 2,
             'implement_cost': 1000000, 'output_start_year': 2026,
             'output_quantity': 1000000, 'output_value': 4,
             'water_allocation_share': 0.25, 'sanitation_allocation_share': 0.75},
            {'name': 'SM only', 'sector': 'water', 'enabled': True,
             'intervention_type': 'cost_reduction', 'start_year': 2026,
             'outputs_affected': 'sm', 'cost_effect_mode': 'pct', 'cost_effect': 0.2},
        ]
        original = copy.deepcopy(inputs)
        result = self.run_model(inputs)
        self.assertEqual(inputs, original)
        start = result['years'].index(2026)
        water, san = result['water_supply'], result['sanitation']
        self.assertEqual(water['scenario_custom_revenue_cash'][start], 1)
        self.assertEqual(san['scenario_custom_revenue_cash'][start], 3)
        self.assertEqual(water['scenario_custom_implementation_capex'][start] +
                         san['scenario_custom_implementation_capex'][start], 0.5)
        factors = water['scenario_intervention_outputs']['custom']['unit_cost_adjustments']
        self.assertEqual(factors['sm'][start], 0.8)
        self.assertEqual(factors['basic'][start], 1)
        np.testing.assert_allclose(water['scenario_cost_basic_t'], water['cost_basic_t'])
        inputs['custom_interventions'][0]['sanitation_allocation_share'] = 1.0
        with self.assertRaisesRegex(ValueError, '100%'):
            self.run_model(inputs)

    def test_capital_gains_and_savings_do_not_become_debt_service_cash(self):
        inputs = frontend_defaults()
        base = self.run_model(inputs)
        inputs['toggles'].update(ws_capital_efficiency_enabled=True, ws_costeff_enabled=True,
                                 san_capital_efficiency_enabled=True, san_costeff_enabled=True)
        changed = self.run_model(inputs)
        for sk in ('water_supply', 'sanitation'):
            np.testing.assert_allclose(changed[sk]['scenario_additional_net_utility_cash'],
                                       base[sk]['scenario_additional_net_utility_cash'])
            self.assertGreater(sum(changed[sk]['scenario_available_capex']), sum(base[sk]['scenario_available_capex']))
            self.assertLess(sum(changed[sk]['scenario_total_investment_need']), sum(base[sk]['scenario_total_investment_need']))

    def test_residual_public_comparison_uses_separate_carry_not_loan_alias(self):
        inputs = frontend_defaults()
        for prefix, name in (('ws', 'water_interventions'), ('san', 'sanitation_interventions')):
            inputs['toggles'][prefix + '_exogenous_injection_enabled'] = True
            inputs[name].update(fin_injection_amount=1000000, fin_injection_start_year=2026,
                                fin_injection_mode='one_time')
        result = self.run_model(inputs)
        bi = result['years'].index(inputs['period']['baseline_year'])
        for sk in ('water_supply', 'sanitation'):
            sec = result[sk]
            field = lambda key: np.asarray(sec['scenario_' + key])
            base_public = field('public_capital') - field('additional_public_capital')
            before = funding_ledger(field('total_investment_need'), base_public, field('other_capital'),
                                    field('cash_allocated_to_direct_investment'), baseline_index=bi,
                                    loan_drawdowns=field('loan_drawdown'))
            np.testing.assert_allclose(field('financing_gap_before_additional_public'), before['gap'])
            self.assertGreater(sum(before['gap']), sum(field('financing_gap')))
            self.assertGreater(sum(field('additional_public_capital')), 0)
            self.assertFalse(np.allclose(field('financing_gap_before_additional_public'),
                                        field('financing_gap_before_borrowing')))
            headers, rows = per_year_table(result, inputs, sk)
            self.assertTrue(all(len(row) == len(headers) for row in rows))

    def test_signed_global_passes_include_customs_borrowing_and_reconcile_both_sectors(self):
        inputs = frontend_defaults()
        inputs['toggles'] = {key: True for key in inputs['toggles']}
        inputs['water_interventions']['cash_allocation_alpha'] = 0.5
        inputs['custom_interventions'] = [
            {'name': 'Costly option', 'sector': 'water', 'enabled': True, 'intervention_type': 'new_revenue',
             'start_year': 2026, 'implement_cost': 1e10, 'cost_years': 1,
             'output_quantity': 0, 'output_value': 0},
        ]
        full = self.run_model(inputs)
        passes, defs, has_custom = cumulative_passes([inputs])
        keys = [definition[0] for definition in defs]
        self.assertEqual(keys, sorted(keys, key=INTERVENTION_ORDER.index))
        self.assertLess(keys.index('__custom'), keys.index('ws_financial_commitment_enabled'))
        for sk, definitions in (('water_supply', WATER_INTV), ('sanitation', SAN_INTV)):
            np.testing.assert_allclose(passes[-1][sk]['scenario_hh'], full[sk]['scenario_hh'])
            np.testing.assert_allclose(passes[-1][sk]['scenario_financing_gap'], full[sk]['scenario_financing_gap'])
            rows = intervention_rows(passes, defs, has_custom, sk, full['years'], inputs['period']['baseline_year'])
            np.testing.assert_allclose(sum(np.asarray(row['band']) for row in rows),
                                       np.asarray(full[sk]['scenario_hh'][0]) - np.asarray(passes[0][sk]['scenario_hh'][0]),
                                       atol=1e-8)
            breakdown = intervention_breakdown(inputs, sk, definitions)
            self.assertAlmostEqual(sum(row[3] for row in breakdown),
                                   (sum(passes[0][sk]['scenario_financing_gap']) - sum(full[sk]['scenario_financing_gap'])) / 1000)
        self.assertTrue(any(row[3] < 0 for row in intervention_breakdown(inputs, 'water_supply', WATER_INTV)))

    def test_national_common_outputs_are_additive_not_first_area_only(self):
        inputs = frontend_defaults()
        inputs['toggles']['ws_nrw_enabled'] = True
        one = self.run_model(inputs)
        national = aggregate([one, one])
        for sk in ('water_supply', 'sanitation'):
            for group, output in one[sk]['scenario_intervention_outputs'].items():
                for field in ('additional_collected_revenue', 'recurring_operating_savings',
                              'recurring_operating_costs', 'implementation_capex'):
                    np.testing.assert_allclose(national[sk]['scenario_intervention_outputs'][group][field],
                                               np.asarray(output[field]) * 2)


if __name__ == '__main__':
    unittest.main()