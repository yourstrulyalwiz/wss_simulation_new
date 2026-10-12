import copy
import unittest
import numpy as np
from model.budget_forecast import forecast_budget, resolve_budget
from model.engine import calculate
from demo_adapter import coerce_to_engine
from test_support import frontend_defaults


class BudgetForecastTests(unittest.TestCase):
    def test_seed_recursion_overrides_and_missing(self):
        years = list(range(2022, 2028))
        e, a, r, meta = resolve_budget([.5, 1, 1.5], [2.5, 5, 7.5], years, [100]*6, 2024, 'Fixture')
        np.testing.assert_allclose(e[3:], [1, 1.25, 1.125])
        np.testing.assert_allclose(a[3:], [5, 6.25, 5.625])
        np.testing.assert_allclose(r, [.2]*6)
        for raw, expected, count in [([0, 1, 2], 1, 3), ([None, 1, 2], 1.5, 2)]:
            before = raw[:]
            values, m = forecast_budget(raw, years, [100]*6, 2024, 'Fixture')
            self.assertEqual(values[3], expected)
            self.assertEqual(m['observation_count'], count)
            self.assertEqual(before, raw)
        values, _ = forecast_budget([.5, 1, 1.5, None, 0], years, [100]*6, 2024, 'Fixture')
        self.assertEqual(values[-1], .5)
        values, _ = forecast_budget([.5, 1, 1.5], years, [100,100,100,200,300,400], 2024, 'Fixture')
        np.testing.assert_allclose(values[3:], [2,3.75,4.5])
        with self.assertRaisesRegex(ValueError, 'no historical'):
            forecast_budget([], years, [100]*6, 2024, 'Fixture')
        _, _, rates, _ = resolve_budget([2], [1], years, [100]*6, 2024, 'Fixture')
        self.assertEqual(rates, [2.] * 6)

    def fixture(self, executed=1, allocated=5):
        d = frontend_defaults()
        n = d['period']['baseline_year'] - d['period']['model_start_year'] + 1
        d['toggles'] = {k: False for k in d['toggles']}
        for p, sector in [('ws','water'), ('san','sanitation')]:
            d['bau'][p+'_expend_ts'] = [executed]*n
            d['bau'][p+'_alloc_ts'] = [allocated]*n
            d[sector+'_interventions'].update(
                fin_gdp_enabled=True, fin_growth_enabled=False, fin_gdp_target_share=.02,
                fin_gdp_start_year=2026, capeff_target_pct=.4,
                capeff_start_year=2026, capeff_target_year=2026, capeff_current_pct=.99)
        # Keep real GDP fixed, independent of financial inputs, for exact GDP-share examples.
        m = coerce_to_engine(d)
        m.macro.gdp_real_local = [100.] * (m.period.forecast_end_year-m.period.model_start_year+1)
        return m

    def test_public_sources_matrix_and_capital_share(self):
        for total, k in [(False,.3),(True,.3),(True,0),(True,1)]:
            for spending, execution in [(False,False),(True,False),(False,True),(True,True)]:
                m = self.fixture()
                for p in ['ws','san']:
                    setattr(m.wss_budget,p+'_budget_is_total_spending',total)
                    setattr(m.wss_budget,p+'_budget_capital_share',k)
                    setattr(m.toggles,p+'_financial_commitment_enabled',spending)
                    setattr(m.toggles,p+'_capital_efficiency_enabled',execution)
                r = calculate(m)
                i = r['years'].index(2026)
                factor = k if total else 1.
                for name in ['water_supply','sanitation']:
                    s = r[name]
                    cash = s['scenario_source_funding']['signed_contribution']
                    self.assertAlmostEqual(cash['baseline'][i],factor)
                    self.assertAlmostEqual(cash['financial'][i],factor*int(spending))
                    self.assertAlmostEqual(cash['budget_execution'][i],factor*(1+int(spending))*int(execution))
                    self.assertAlmostEqual(sum(v[i] for v in cash.values()),s['scenario_available_total'][i])
                    self.assertAlmostEqual(s['budget_execution_baseline'][i],.2)
                    self.assertAlmostEqual(s['budget_executed_input_basis'][i],1)
                    for rung in ['sm','basic']:
                        np.testing.assert_allclose(s['scenario_coverage_attribution']['reconciliation_error'][rung],0,atol=1e-10)

    def test_example_b_and_zero_execution(self):
        m = self.fixture(.017,.017/.16)
        for p, sector in [('ws','water'),('san','sanitation')]:
            getattr(m,sector+'_interventions').fin_gdp_target_share=.0006
            setattr(m.toggles,p+'_financial_commitment_enabled',True)
            setattr(m.toggles,p+'_capital_efficiency_enabled',True)
        r=calculate(m); i=r['years'].index(2026)
        for sec in ['water_supply','sanitation']:
            cash=r[sec]['scenario_source_funding']['signed_contribution']
            np.testing.assert_allclose([cash[k][i] for k in ['baseline','financial','budget_execution']],[.017,.043,.09])
        m=self.fixture(0,5)
        m.toggles.ws_capital_efficiency_enabled=True
        r=calculate(m)
        self.assertAlmostEqual(r['water_supply']['scenario_available_total'][i],2)
        m.toggles.ws_financial_commitment_enabled=True
        with self.assertRaisesRegex(ValueError,'positive baseline execution'):
            calculate(m)

    def test_execution_above_allocation_does_not_block_or_clip(self):
        for allocation, rate in [(1, 2), (0, 1)]:
            m = self.fixture(2, allocation)
            r = calculate(m)
            i = r['years'].index(2026)
            for sector in ['water_supply', 'sanitation']:
                s = r[sector]
                self.assertEqual(s['budget_execution_baseline'][i], rate)
                self.assertEqual(s['budget_allocated_input_basis'][i], allocation)
                self.assertAlmostEqual(s['scenario_available_total'][i], 2)
                self.assertEqual(s['scenario_source_funding']['signed_contribution']['budget_execution'][i], 0)
            m.toggles.ws_financial_commitment_enabled = True
            m.water_interventions.fin_gdp_target_share = .03
            r = calculate(m)
            self.assertAlmostEqual(r['water_supply']['scenario_available_total'][i], 3)
            m.toggles.ws_capital_efficiency_enabled = True
            r = calculate(m)
            cash = r['water_supply']['scenario_source_funding']['signed_contribution']
            self.assertAlmostEqual(sum(v[i] for v in cash.values()), 3 * .4 / rate)

    def test_input_roundtrip_and_cost_independence(self):
        from excel_io import build_template, parse_template
        d = frontend_defaults()
        d['bau']['ws_expend_ts'][:3] = [None, 0, 100]
        d['macro'].update(ws_budget_is_total_spending=True, ws_budget_capital_share=.3)
        restored, _ = parse_template(build_template(d).getvalue(), d)
        self.assertEqual(restored['bau']['ws_expend_ts'][:3], [None, 0, 100])
        self.assertEqual(restored['macro']['ws_budget_capital_share'], .3)
        m=self.fixture()
        before=copy.deepcopy(m.wss_budget.model_dump())
        a=calculate(m)
        m.water_costs.sm_technologies[0].cost *= 1.5
        b=calculate(m)
        self.assertEqual(a['water_supply']['budget_used'],b['water_supply']['budget_used'])
        self.assertEqual(before,m.wss_budget.model_dump())

    def test_drc_controlled_2024_seed(self):
        import json
        from pathlib import Path
        from model.engine import build_context
        path = Path('profiles/Oct 10.json')
        original = path.read_bytes()
        bundle = json.loads(original)
        expected = {'urban': [('ws',.0174320800,.1071653043),('san',.0052607084,.0070854906)],
                    'rural': [('ws',.0043580200,.0267913261),('san',.0013151771,.0017713726)]}
        for area, data in [('urban',bundle['inputs']),('rural',bundle['altInputs']['rural'])]:
            ctx = build_context(coerce_to_engine(data))
            years = list(ctx['years'])
            for p, eshare, ashare in expected[area]:
                # Controlled review fixture: only verified 2022–2024 observations.
                e = [v if 2022<=y<=2024 else None for y,v in zip(years,data['bau'][p+'_expend_ts'])]
                a = [v if 2022<=y<=2024 else None for y,v in zip(years,data['bau'][p+'_alloc_ts'])]
                ev,av,rate,meta = resolve_budget(e,a,years,ctx['gdp_real_local'],2025,p)
                i=years.index(2025)
                self.assertAlmostEqual(ev[i]/ctx['gdp_real_local'][i]*100,eshare,places=9)
                self.assertAlmostEqual(av[i]/ctx['gdp_real_local'][i]*100,ashare,places=9)
                self.assertEqual(meta['executed']['initialization_years'],[2022,2023,2024])
        self.assertEqual(path.read_bytes(),original)

    def test_external_funding_isolated_and_signed_execution(self):
        for mode in ['one_time','recurring']:
            values=[]
            for total,k,target in [(False,1,.4),(True,.3,.4),(True,0,.1)]:
                m=self.fixture()
                m.wss_budget.ws_budget_is_total_spending=total
                m.wss_budget.ws_budget_capital_share=k
                m.toggles.ws_exogenous_injection_enabled=True
                m.toggles.ws_capital_efficiency_enabled=True
                m.toggles.ws_financial_commitment_enabled=True
                iv=m.water_interventions
                iv.capeff_target_pct=target
                iv.fin_injection_mode=mode
                iv.fin_injection_amount=100
                iv.fin_injection_start_year=2026
                iv.fin_injection_end_year=2027
                r=calculate(m)
                values.append(r['water_supply']['scenario_exogenous_injection_cash'])
            self.assertEqual(values[0],values[1])
            self.assertEqual(values[1],values[2])
        m=self.fixture()
        m.toggles.ws_capital_efficiency_enabled=True
        m.toggles.ws_financial_commitment_enabled=True
        m.water_interventions.capeff_target_pct=.1
        r=calculate(m); i=r['years'].index(2026)
        self.assertAlmostEqual(r['water_supply']['scenario_source_funding']['signed_contribution']['budget_execution'][i],-1)
