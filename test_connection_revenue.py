"""Legacy profile migration fixtures and v4 API contract (v1–v3 formulas superseded)."""
import copy
import unittest
import numpy as np
from model.connection_revenue import prepare_connection, migrate_connection
from demo_adapter import coerce_to_engine
from model.engine import calculate
from test_utility_revenue import example


def configuration(**overrides):
    cfg = dict(version=1, enabled=True, billed_share_sm=1, billed_share_basic=1,
               household_volume_share=1, marginal_cost=.2, zero_cost_confirmed=False,
               alignment='estimate', funding_reference='fixed', reference_confirmed=True,
               funding_includes_reforms=False, provenance={})
    cfg.update(overrides)
    return cfg


def fixture():
    ctx = dict(years=np.array([2025,2026,2027,2028]), bi=0, n=4,
               population=np.array([500,550,600,650]),
               total_hh=np.array([200,220,240,260])/1e6)
    hist = np.zeros((5,4))
    hist[:,0] = np.array([60,40,100,0,0])/1e6
    base = dict(version=1,volume_mld=.01*1000/365,tariff=1,
                collection_ratio=.8,reference_year=2025,growth_rate=0)
    return ctx,hist,base


class ConnectionRevenueTests(unittest.TestCase):
    def test_legacy_fields_inactive_and_pure_bau(self):
        d = example()
        d['connection_revenue'] = {'water': configuration(marginal_cost=99999, household_volume_share=None)}
        before = copy.deepcopy(d)
        a = calculate(coerce_to_engine(d))
        self.assertEqual(d, before)
        self.assertFalse(a['water_supply']['connection_revenue']['effective'])
        self.assertTrue(a['water_supply']['scenario_connection_revenue']['effective'])
        d['connection_revenue']['water']['marginal_cost'] = 0
        self.assertEqual(a, calculate(coerce_to_engine(before)))  # repeatability
        b = calculate(coerce_to_engine(d))
        self.assertEqual(a['water_supply']['scenario_hh'], b['water_supply']['scenario_hh'])

    def test_api_status_and_migration(self):
        from app import revenue_bases
        d = example()
        d['connection_revenue'] = {'water': configuration(billed_share_basic=0)}
        status = revenue_bases(d)['water']['connection']
        self.assertTrue(status['effective'], status)
        self.assertEqual(status['configuration']['version'], 4)
        self.assertEqual(status['configuration']['new_billed_share_basic'], 0)
        self.assertNotIn('consumption_m3', status['calibration'])
        self.assertGreater(status['calibration']['baseline_coverage'], 0)

    def test_migration_explicit_blanks_and_defaults(self):
        for version in (1,2):
            self.assertEqual(migrate_connection(dict(version=version,billed_share_basic=0))['new_billed_share_basic'], 0)
        cfg = migrate_connection(dict(version=3,new_billed_share_basic=None))
        self.assertIsNone(cfg['new_billed_share_basic'])
        self.assertFalse(migrate_connection(None)['enabled'])
        self.assertEqual(cfg, migrate_connection(cfg))

    def test_invalid_current_inputs_only(self):
        ctx,hist,base = fixture()
        for key in ('marginal_cost','consumption_m3','reference_series','provenance'):
            self.assertTrue(prepare_connection(configuration(**{key: None}),base,ctx,hist)[0]['effective'])
        status,_ = prepare_connection(dict(version=4,enabled=True),base,ctx,hist)
        self.assertFalse(status['effective'])
        self.assertIn('new_billed_share_basic', status['errors'][0])
