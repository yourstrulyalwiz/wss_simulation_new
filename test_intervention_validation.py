import copy
import json
import unittest

from intervention_validation import validate_interventions, InterventionInputError, require_valid_interventions
from demo_adapter import coerce_to_engine
from test_support import frontend_defaults
from app import run_calculation


class InterventionValidationTests(unittest.TestCase):
    def fixture(self):
        f = frontend_defaults()
        f['toggles'] = {k: False for k in f['toggles']}
        return f

    def errors(self, f):
        return [i for i in validate_interventions(f) if i['severity'] == 'error']

    def test_raw_missing_malformed_and_zero(self):
        for prefix, sector in [('ws', 'water'), ('san', 'sanitation')]:
            f = self.fixture()
            f['toggles'][prefix+'_exogenous_injection_enabled'] = True
            iv = f[sector+'_interventions']
            iv.update(fin_injection_mode='one_time', fin_injection_start_year=2027, fin_injection_amount=0)
            iv.pop('fin_injection_end_year', None)
            self.assertEqual(self.errors(f), [])
            self.assertTrue(any(i['code'] == 'zero' for i in validate_interventions(f)))
            for value in [None, '', ' ', '12abc', True, float('inf'), -1]:
                iv['fin_injection_amount'] = value
                self.assertTrue(self.errors(f), repr(value))
                with self.assertRaises(InterventionInputError):
                    require_valid_interventions(f)
            iv.pop('fin_injection_amount')
            self.assertTrue(self.errors(f))
            f['toggles'][prefix+'_exogenous_injection_enabled'] = False
            self.assertEqual(self.errors(f), [])

    def test_modes_and_preserved_draft(self):
        f = self.fixture()
        f['toggles']['ws_exogenous_injection_enabled'] = True
        iv = f['water_interventions']
        iv.update(fin_injection_mode='recurring', fin_injection_start_year=None, fin_injection_end_year=None, fin_injection_amount=0)
        saved = json.loads(json.dumps(f))
        self.assertTrue(self.errors(f))
        self.assertEqual(f, saved)
        iv.update(fin_injection_mode='one_time', fin_injection_start_year=2027)
        self.assertFalse(self.errors(f))

    def test_six_zero_values_survive_adapter(self):
        f = self.fixture()
        fields = ['nrw_treatment_cost_pct_capex','nrw_current_pct','nrw_target_pct','nrw_physical_loss_pct','capeff_target_pct']
        for field in fields:
            f['water_interventions'][field] = 0
        f['sanitation_interventions']['capeff_target_pct'] = 0
        m = coerce_to_engine(f)
        for field in fields:
            self.assertEqual(getattr(m.water_interventions, field), 0)
        self.assertEqual(m.sanitation_interventions.capeff_target_pct, 0)

    def test_partial_results_and_paused_customs(self):
        f = self.fixture()
        f['toggles']['san_exogenous_injection_enabled'] = True
        f['sanitation_interventions']['fin_injection_amount'] = None
        f['custom_interventions'] = [{'enabled': True, 'sector': 'both'}]
        result = run_calculation(f)
        self.assertIsNone(result['sanitation'])
        self.assertIsNotNone(result['water_supply'])
        self.assertTrue(result['incomplete'])
        self.assertTrue(result['intervention_issues'])

    def test_disabled_connection_dependency_and_optional_growth(self):
        f = self.fixture()
        f['toggles']['ws_collection_efficiency_enabled'] = True
        f['toggles']['ws_connections_enabled'] = False
        f['water_interventions']['ce_target_ratio'] = 0
        f['revenue_bases']['water']['growth_rate'] = None
        f['connection_revenue']['water']['new_billed_share_basic'] = None
        self.assertTrue(any(i['field'].endswith('new_billed_share_basic') for i in self.errors(f)))
        self.assertFalse(any(i['field'].endswith('growth_rate') for i in self.errors(f)))

    def test_invalid_text_can_be_disabled_without_mutating_saved_values(self):
        f = self.fixture()
        f['water_interventions']['fin_injection_amount'] = '-'
        saved = copy.deepcopy(f)
        result = run_calculation(f)
        self.assertIsNotNone(result['water_supply'])
        self.assertEqual(f, saved)
        f['toggles']['ws_exogenous_injection_enabled'] = True
        self.assertIsNone(run_calculation(f)['water_supply'])

    def test_calculated_export_boundaries(self):
        from app import export_csv, export_xlsx, validate_export_inputs
        from fastapi import HTTPException
        f = self.fixture()
        f['toggles']['ws_tariff_enabled'] = True
        f['water_interventions']['tariff_target'] = None
        for export in (export_csv, export_xlsx):
            with self.assertRaises(InterventionInputError):
                export(copy.deepcopy(f))
        with self.assertRaises(InterventionInputError):
            validate_export_inputs({'_validation_inputs': {'urban': f}})
        with self.assertRaises(HTTPException):
            validate_export_inputs({})

    def test_zero_fee_does_not_invent_principal(self):
        from model.engine import calculate
        f = self.fixture()
        for prefix, sector in [('ws', 'water'), ('san', 'sanitation')]:
            f['toggles'][prefix+'_microfinance_enabled'] = True
            f[sector+'_interventions']['mf_connection_fee'] = 0
        self.assertEqual(self.errors(f), [])
        result = calculate(coerce_to_engine(f))
        for key in ('water_supply', 'sanitation'):
            self.assertTrue(all(v == 0 for v in result[key]['scenario_mf_loan_volume']))


if __name__ == '__main__':
    unittest.main()
