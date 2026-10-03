"""Release boundary: volume is an entered forecast, not a coverage/revenue feedback loop."""
import unittest
import numpy as np

from demo_adapter import coerce_to_engine, frontend_defaults
from model.engine import calculate
from model.volumes import exogenous_volume_factors


class ExogenousVolumeTests(unittest.TestCase):
    def factors(self, growth=None, **kwargs):
        return exogenous_volume_factors([2025, 2026, 2027], [100, 110, 121],
                                       anchor_year=kwargs.get('anchor_year', 2025),
                                       baseline_year=2025, growth_rate=growth)

    def test_population_ratio_applied_once(self):
        np.testing.assert_allclose(self.factors(), [1, 1.1, 1.21])

    def test_fixed_growth_replaces_population_growth(self):
        np.testing.assert_allclose(self.factors(.03), [1, 1.03, 1.0609])
        np.testing.assert_allclose(self.factors(0), [1, 1, 1])

    def test_existing_anchor_and_zero_population_conventions(self):
        np.testing.assert_allclose(self.factors(anchor_year=0), [1, 1.1, 1.21])
        np.testing.assert_allclose(self.factors(anchor_year=1900), [1, 1.1, 1.21])
        np.testing.assert_allclose(self.factors(anchor_year=2050), [100/121, 110/121, 1])
        np.testing.assert_allclose(exogenous_volume_factors(
            [2025, 2026], [0, 100], anchor_year=2025, baseline_year=2025), [0, 0])

    def test_projection_matches_prior_scalar_formula(self):
        years = np.arange(2020, 2041)
        population = 20 * 1.027 ** np.arange(len(years))
        for anchor in (0, 2010, 2028, 2060):
            ai = int(np.clip((anchor or 2025) - 2020, 0, len(years) - 1))
            for growth in (None, 0, .035, -.01):
                expected = [(1.0 + growth) ** (year - years[ai]) if growth is not None
                            else population[t] / population[ai] for t, year in enumerate(years)]
                actual = exogenous_volume_factors(
                    years, population, anchor_year=anchor, baseline_year=2025, growth_rate=growth)
                np.testing.assert_allclose(actual, expected, rtol=1e-14)

    def test_funded_service_changes_do_not_create_automatic_billable_customers(self):
        inputs = frontend_defaults()
        inputs['toggles'].update(ws_tariff_enabled=True, san_tariff_enabled=True)
        first = calculate(coerce_to_engine(inputs))
        inputs['toggles'].update(ws_costeff_enabled=True, san_costeff_enabled=True)
        inputs['water_interventions']['costeff_target_pct'] = .8
        inputs['sanitation_interventions']['costeff_target_pct'] = .8
        changed = calculate(coerce_to_engine(inputs))
        for sk in ('water_supply', 'sanitation'):
            self.assertFalse(np.allclose(first[sk]['scenario_hh'], changed[sk]['scenario_hh']))
            for key in ('billed_volume_bau', 'billed_volume_scenario', 'shared_revenue_cash',
                        'additional_net_utility_cash', 'nrw_production_savings', 'nrw_maintenance_cost'):
                np.testing.assert_allclose(first[sk]['scenario_' + key], changed[sk]['scenario_' + key])

    def test_nrw_and_billed_growth_remain_independently_entered(self):
        inputs = frontend_defaults()
        inputs['toggles'].update(ws_nrw_enabled=True, ws_tariff_enabled=True)
        inputs['water_interventions'].update(ce_vol_growth=0, nrw_vol_growth=.03)
        result = calculate(coerce_to_engine(inputs))
        sec = result['water_supply']
        billed = np.asarray(sec['scenario_billed_volume_bau'])
        positive = billed[billed > 0]
        np.testing.assert_allclose(positive, positive[0])
        altered = frontend_defaults()
        altered['toggles'].update(ws_nrw_enabled=True, ws_tariff_enabled=True)
        altered['water_interventions'].update(ce_vol_growth=0, nrw_vol_growth=0)
        other = calculate(coerce_to_engine(altered))['water_supply']
        np.testing.assert_allclose(sec['scenario_billed_volume_bau'], other['scenario_billed_volume_bau'])
        self.assertFalse(np.allclose(sec['scenario_nrw_recovered_phys_total_vol'],
                                     other['scenario_nrw_recovered_phys_total_vol']))


if __name__ == '__main__':
    unittest.main()