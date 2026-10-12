"""Executed-spending references supersede the old cost-derived gross-up."""
import unittest
from demo_adapter import coerce_to_engine
from test_support import frontend_defaults
from model.engine import calculate


class BaselineSpendingShareTests(unittest.TestCase):
    def test_reference_matches_raw_executed_basis(self):
        for total in (False, True):
            d = frontend_defaults()
            d['macro'].update(ws_budget_is_total_spending=total, san_budget_is_total_spending=total,
                              ws_budget_capital_share=.3, san_budget_capital_share=.3)
            r = calculate(coerce_to_engine(d))
            i = r['years'].index(d['period']['baseline_year'])
            for name in ('water_supply', 'sanitation'):
                s = r[name]
                self.assertEqual(s['baseline_spending_reference_source'], 'entered_executed_spending')
                self.assertEqual(s['financial_commitment_base'][i], 100)
                self.assertAlmostEqual(s['baseline_bau_executed_spending_share'], 100/r['gdp_real_local'][i])
                self.assertAlmostEqual(s['budget_used'][i], 30 if total else 100)

    def test_growth_uses_executed_basis_and_timing(self):
        d = frontend_defaults()
        for prefix, section in [('ws','water_interventions'), ('san','sanitation_interventions')]:
            d['toggles'][prefix+'_financial_commitment_enabled'] = True
            d[section].update(fin_gdp_enabled=False, fin_growth_enabled=True,
                             fin_growth_rate=.1, fin_growth_start_year=2027, fin_growth_end_year=2028)
        r = calculate(coerce_to_engine(d))
        for name in ('water_supply','sanitation'):
            s = r[name]
            for i,y in enumerate(r['years']):
                expected = s['financial_commitment_base'][i] * (1.1**(y-2026)-1) if 2027<=y<=2028 else 0
                self.assertAlmostEqual(s['scenario_financial_commitment_cash'][i], expected)

    def test_missing_budget_is_not_cost_derived(self):
        d = frontend_defaults()
        d['bau']['ws_expend_ts'] = []
        with self.assertRaisesRegex(ValueError, 'no historical budget'):
            calculate(coerce_to_engine(d))

    def test_explicit_zero_and_stale_execution_override(self):
        d = frontend_defaults()
        d['bau']['ws_expend_ts'] = [0]*15
        d['water_interventions']['capeff_current_pct'] = .99
        d['toggles'] = {k:False for k in d['toggles']}
        r = calculate(coerce_to_engine(d))
        self.assertEqual(r['water_supply']['capex_efficiency_baseline'],0)
        self.assertEqual(sum(r['water_supply']['budget_used']),0)
