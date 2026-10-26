import copy
import unittest
from pathlib import Path

import numpy as np

from calculation_setup import economic_projections
from demo_adapter import coerce_to_engine
from model.engine import build_context, calculate
from model.forecast_policy import (
    OPTIONAL_FORECAST_ASSUMPTIONS_ENABLED,
    OPTIONAL_FORECAST_FIELDS,
    effective_forecast_macro,
)
from model.inputs import MacroInputs, ModelInputs
from test_support import frontend_defaults


class ForecastPolicyTests(unittest.TestCase):
    def test_ui_and_engine_both_pause_optional_forecast_controls(self):
        self.assertFalse(OPTIONAL_FORECAST_ASSUMPTIONS_ENABLED)
        source = Path("frontend/src/components/InputPanel.tsx").read_text()
        self.assertIn("const OPTIONAL_FORECAST_ASSUMPTIONS_ENABLED = false;", source)
        self.assertIn("{OPTIONAL_FORECAST_ASSUMPTIONS_ENABLED ? <>", source)
        self.assertIn("Previously saved assumptions are retained but not applied.", source)

    def test_effective_defaults_do_not_mutate_saved_assumptions_or_series(self):
        saved = MacroInputs(gdp_growth_forecast=0, inflation_local_ongoing=.45,
                            inflation_us_ongoing=.12, gdp_real_local=[100, 110],
                            inflation_local=[.17], inflation_us=[.03])
        before = saved.model_dump()
        effective = effective_forecast_macro(saved)
        for key in OPTIONAL_FORECAST_FIELDS:
            self.assertEqual(getattr(effective, key), MacroInputs.model_fields[key].default)
        self.assertEqual(effective.inflation_local, [.17])
        self.assertEqual(effective.inflation_us, [.03])
        self.assertEqual(effective.gdp_real_local, [100, 110])
        self.assertEqual(saved.model_dump(), before)

    def test_direct_engine_ignores_overrides_but_honors_entered_values(self):
        model = ModelInputs(macro=MacroInputs(
            gdp_real_local=[100], gdp_growth_forecast=.9,
            inflation_local=[.17], inflation_local_ongoing=.45,
            inflation_us=[.03], inflation_us_ongoing=.12,
        ))
        before = model.model_dump()
        context = build_context(model)
        self.assertAlmostEqual(context["gdp_real_local"][1], 105)
        self.assertAlmostEqual(context["inflation_local"][0], .17)
        self.assertAlmostEqual(context["inflation_local"][1], .05)
        self.assertAlmostEqual(context["inflation_us"][0], .03)
        self.assertAlmostEqual(context["inflation_us"][1], .022)
        model.macro.gdp_real_local = [100, 110, 135]
        np.testing.assert_allclose(build_context(model)["gdp_real_local"][:3], [100, 110, 135])
        model.macro.gdp_real_local = [100]
        self.assertEqual(model.model_dump(), before)

    def test_urban_rural_projections_and_full_calculation_ignore_saved_overrides(self):
        for area in ("Urban", "Rural"):
            inputs = frontend_defaults()
            inputs["country_config"]["area"] = area
            # A single observation exercises the GDP fallback rather than mean growth.
            inputs["macro"]["gdp_real_local"] = [100]
            overridden = copy.deepcopy(inputs)
            overridden["macro"].update(gdp_growth_forecast=.9,
                                        inflation_local_ongoing=.45,
                                        inflation_us_ongoing=.12)
            before = copy.deepcopy(overridden)
            with self.subTest(area=area):
                projection = economic_projections(overridden)
                self.assertEqual(projection, economic_projections(inputs))
                full = calculate(coerce_to_engine(overridden))
                self.assertEqual(full, calculate(coerce_to_engine(inputs)))
                self.assertEqual(projection["gdp_real_local"], full["gdp_real_local"])
                self.assertEqual(overridden, before)
