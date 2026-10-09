"""Public allocation/execution interaction and unchanged external funding."""
import copy
import json
from pathlib import Path
import unittest
import numpy as np
from demo_adapter import coerce_to_engine
from test_support import frontend_defaults
from model.engine import calculate
from deck_data import cumulative_passes, intervention_rows
from export_data import intervention_breakdown, WATER_INTV, SAN_INTV


class PublicSpendingExecutionTests(unittest.TestCase):
    def model(self, spending=True, execution=True):
        m = coerce_to_engine(frontend_defaults())
        for key in type(m.toggles).model_fields:
            setattr(m.toggles, key, False)
        m.custom_interventions = []
        b = m.wss_budget
        b.budget_input_mode = 'direct'
        b.budget_source = 'manual'
        b.execution_rate = .2  # intentionally not the intervention baseline .6
        b.capex_pct_budget = .5
        n = m.period.forecast_end_year - m.period.model_start_year + 1
        for prefix, section in [('ws', 'water_interventions'), ('san', 'sanitation_interventions')]:
            setattr(b, prefix + '_capex_pct', .5)
            setattr(b, prefix + '_budget_direct', [120.] * n)
            setattr(b, prefix + '_budget_allocated', [100.] * n)
            setattr(m.toggles, prefix + '_financial_commitment_enabled', spending)
            setattr(m.toggles, prefix + '_capital_efficiency_enabled', execution)
            iv = getattr(m, section)
            iv.capeff_current_pct = .6
            iv.capeff_target_pct = .9
            iv.capeff_start_year = 2026
            iv.capeff_target_year = 2026
            iv.fin_gdp_enabled = False
            iv.fin_growth_enabled = True
            iv.fin_growth_rate = 100 / 120
            iv.fin_growth_start_year = 2026
            iv.fin_growth_end_year = 2026
            iv.fin_injection_start_year = 2026
            iv.fin_injection_end_year = 2027
            iv.fin_injection_amount = 100
        return m

    def test_four_toggle_matrix_and_rate_mismatch(self):
        for spending, execution, expected in [(False, False, (60, 0, 0)),
                (True, False, (60, 30, 0)), (False, True, (60, 0, 30)),
                (True, True, (60, 30, 45))]:
            r = calculate(self.model(spending, execution))
            i = r['years'].index(2026)
            for sector in ['water_supply', 'sanitation']:
                sec = r[sector]
                cash = sec['scenario_source_funding']['signed_contribution']
                for source, amount in zip(['baseline', 'financial', 'budget_execution'], expected):
                    self.assertAlmostEqual(cash[source][i], amount)
                self.assertAlmostEqual(sum(cash[s][i] for s in cash), sum(expected))
                self.assertAlmostEqual(sec['scenario_available_total'][i], sum(expected))
                self.assertEqual(sec['scenario_financial_commitment_cash'][i + 1], 0)
                self.assertTrue(all(v == 0 for v in sec['scenario_financial_commitment_cash'][:i]))
                self.assertEqual(sec['financial_commitment_base'][i], 120)
                attr = sec['scenario_coverage_attribution']
                for rung in ['sm', 'basic']:
                    np.testing.assert_allclose(attr['reconciliation_error'][rung], 0, atol=1e-10)

    def test_external_excluded_and_signed_execution(self):
        for mode, amount in [('one_time', 100), ('recurring', 10)]:
            baseline = None
            for reform in [False, True]:
                m = self.model(execution=reform)
                for prefix, section in [('ws', 'water_interventions'), ('san', 'sanitation_interventions')]:
                    setattr(m.toggles, prefix + '_exogenous_injection_enabled', True)
                    getattr(m, section).fin_injection_mode = mode
                r = calculate(m)
                i = r['years'].index(2026)
                for sec in ['water_supply', 'sanitation']:
                    cash = r[sec]['scenario_source_funding']['signed_contribution']
                    self.assertAlmostEqual(cash['injection'][i], amount)
                    self.assertAlmostEqual(cash['budget_execution'][i], 45 if reform else 0)
                if baseline is None:
                    baseline = r
                else:
                    for sec in ['water_supply', 'sanitation']:
                        self.assertEqual(baseline[sec]['scenario_exogenous_injection_cash'], r[sec]['scenario_exogenous_injection_cash'])
        m = self.model()
        m.water_interventions.capeff_target_pct = .3
        r = calculate(m)
        i = r['years'].index(2026)
        cash = r['water_supply']['scenario_source_funding']['signed_contribution']
        self.assertAlmostEqual(cash['budget_execution'][i], -45)
        self.assertAlmostEqual(sum(v[i] for v in cash.values()), 45)

    def test_timing_capital_zero_and_ramp(self):
        m = self.model()
        for section in ['water_interventions', 'sanitation_interventions']:
            iv = getattr(m, section)
            iv.fin_growth_start_year = 2027
            iv.fin_growth_end_year = 2028
            iv.capeff_target_year = 2028
        r = calculate(m)
        for sec in ['water_supply', 'sanitation']:
            cash = r[sec]['scenario_source_funding']['signed_contribution']
            for year, eff in [(2026, .6), (2027, .75), (2028, .9), (2029, .9)]:
                i = r['years'].index(year)
                delta = 60 * ((1 + 100/120) ** (year-2027+1) - 1) if 2027 <= year <= 2028 else 0
                self.assertAlmostEqual(cash['financial'][i], delta * .6)
                self.assertAlmostEqual(cash['budget_execution'][i], (100 + delta) * (eff - .6))
        for share in [0, None]:
            m = self.model()
            m.wss_budget.ws_capex_pct = share
            r = calculate(m)
            self.assertAlmostEqual(r['water_supply']['scenario_financial_commitment_cash'][r['years'].index(2026)], 0 if share == 0 else 30)

    def test_profile_export_resource_agreement(self):
        # Read saved simulations only; never migrate or overwrite them.
        paths = [Path('profiles/DRC October 9.json'), *Path('profiles').glob('*OCT*8*.json')]
        for path in paths:
            bundle = json.loads(path.read_text())
            inputs = copy.deepcopy(bundle.get('inputs', bundle))
            for prefix, section in [('ws', 'water_interventions'), ('san', 'sanitation_interventions')]:
                inputs['toggles'][prefix + '_financial_commitment_enabled'] = True
                inputs['toggles'][prefix + '_capital_efficiency_enabled'] = True
                inputs['toggles'][prefix + '_exogenous_injection_enabled'] = True
                inputs[section].update(fin_growth_enabled=True, fin_growth_rate=.1,
                    fin_growth_start_year=2026, fin_growth_end_year=2028,
                    fin_injection_mode='one_time', fin_injection_start_year=2026, fin_injection_amount=100)
            result = calculate(coerce_to_engine(inputs))
            passes, enabled, custom = cumulative_passes([inputs])
            by = inputs['period']['baseline_year']
            for sector, defs in [('water_supply', WATER_INTV), ('sanitation', SAN_INTV)]:
                deck = intervention_rows(passes, enabled, custom, sector, result['years'], by, result)
                sheet = intervention_breakdown(inputs, sector, defs)
                cash = result[sector]['scenario_source_funding']['signed_contribution']
                for suffix, source in [('financial_commitment_enabled', 'financial'),
                                       ('capital_efficiency_enabled', 'budget_execution'),
                                       ('exogenous_injection_enabled', 'injection')]:
                    row = next(row for row in deck if row['key'].endswith(suffix))
                    expected = sum(v for y, v in zip(result['years'], cash[source]) if y > by)
                    self.assertAlmostEqual(row['money_m'], expected)
                    exported = next(r for r in sheet if r[0] == row['label'])
                    self.assertEqual(exported[2], round(expected / 1000, 4))

    def test_modes_gdp_and_zero_execution_boundary(self):
        for mode in ['pct_gdp', 'direct', 'from_cost']:
            m = self.model()
            m.wss_budget.budget_input_mode = mode
            m.wss_budget.budget_source = 'from_cost' if mode == 'from_cost' else 'manual'
            for section in ['water_interventions', 'sanitation_interventions']:
                iv = getattr(m, section)
                iv.fin_growth_enabled = False
                iv.fin_gdp_enabled = True
                iv.fin_gdp_start_year = 2027
                iv.fin_gdp_target_share = .05
            r = calculate(m)
            i = r['years'].index(2027)
            for sec in ['water_supply', 'sanitation']:
                delta = max(.05 * r['gdp_real_local'][i] - r[sec]['financial_commitment_base'][i], 0) * .5
                cash = r[sec]['scenario_source_funding']['signed_contribution']
                self.assertAlmostEqual(cash['financial'][i], delta * .6)
                self.assertEqual(cash['financial'][i - 1], 0)
                self.assertAlmostEqual(cash['budget_execution'][i], (100 + delta) * .3)
        m = self.model()
        for prefix, section in [('ws', 'water_interventions'), ('san', 'sanitation_interventions')]:
            setattr(m.wss_budget, prefix + '_budget_direct', [0.] * 30)
            iv = getattr(m, section)
            iv.capeff_current_pct = 0
            iv.fin_growth_enabled = False
            iv.fin_gdp_enabled = True
            iv.fin_gdp_start_year = 2026
            iv.fin_gdp_target_share = .05
        r = calculate(m)
        i = r['years'].index(2026)
        for sec in ['water_supply', 'sanitation']:
            cash = r[sec]['scenario_source_funding']['signed_contribution']
            delta = .05 * r['gdp_real_local'][i] * .5
            self.assertEqual(cash['financial'][i], 0)
            self.assertAlmostEqual(cash['budget_execution'][i], (100 + delta) * .9)


if __name__ == '__main__':
    unittest.main()
