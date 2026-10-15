import copy
import json
import os
import unittest
from unittest.mock import patch
from uuid import uuid4
from fastapi.testclient import TestClient
from simulation_management.store import connect
from simulation_management.seeds import import_seeds
from simulation_management.legacy import migrate_legacy
from simulation_scope import public_bundle
from demo_adapter import coerce_to_engine
from model.engine import calculate
from test_support import frontend_defaults


class SimulationManagementTests(unittest.TestCase):
    def test_legacy_sanitation_shared_revenue_anchor_survives_scope(self):
        from model.utility_revenue import resolve_bases
        from model.engine import build_context
        from simulation_scope import effective_payload
        source = frontend_defaults()
        source['revenue_bases'] = {}
        original = coerce_to_engine(source)
        source['calculation_scope'] = ['sanitation']
        scoped = coerce_to_engine(source)
        a = resolve_bases(original, build_context(original))['sanitation']['base']
        b = resolve_bases(scoped, build_context(scoped))['sanitation']['base']
        for key in ['volume_mld','tariff','collection_ratio','reference_year','growth_rate']:
            self.assertEqual(a[key], b[key])
        exported = effective_payload(source)
        self.assertNotIn('water_interventions', exported)
        self.assertNotIn('fin_gdp_target_share', exported['revenue_legacy']['water_interventions'])

    def test_rural_only_primary_preserved_and_new_rural_blank(self):
        from simulation_management.service import prepare_bundle
        original = frontend_defaults()
        scope = {'sectors':['water'],'areaUrban':False,'areaRural':True,'scopeMode':'urban_rural'}
        rural = prepare_bundle({'inputs':original,'altInputs':{},'scope':scope})
        self.assertEqual(rural['altInputs']['rural']['population'], original['population'])
        urban = {'inputs':original,'altInputs':{},'scope':{**scope,'areaUrban':True,'areaRural':False}}
        expanded = prepare_bundle(urban,{**scope,'areaUrban':True})
        self.assertEqual(expanded['altInputs']['rural']['population']['pop_ts'], [])

    def test_selected_sector_parity_and_inactive_invalid_inputs(self):
        original = frontend_defaults()
        both = calculate(coerce_to_engine(original))
        for sector, other, result_key in [('water','sanitation','water_supply'),('sanitation','water','sanitation')]:
            selected = copy.deepcopy(original)
            selected['calculation_scope'] = [sector]
            selected[other+'_costs'] = {'network_cost_per_hh_serv1': None, 'sewer_cost_per_hh_sserv1':None}
            selected[other+'_interventions'] = {'fin_gdp_enabled':True,'fin_gdp_targets':[]}
            selected['technical'][('san' if other == 'sanitation' else 'ws')+'_asset_life'] = None
            result = calculate(coerce_to_engine(selected))
            for key in ['scenario_hh','bau_hh','scenario_available_total','scenario_financial_commitment_cash',
                        'scenario_collection_cash','scenario_tariff_cash','scenario_nrw_net']:
                self.assertEqual(result[result_key].get(key), both[result_key].get(key), key)
            self.assertIsNone(result['sanitation' if sector == 'water' else 'water_supply'])

    def test_seed_migration_preserves_effective_inputs(self):
        for path in ['profiles/Oct 12.json','profiles/Oct 13.json','profiles/nepal_kv.json']:
            with open(path) as source:
                raw = json.load(source)
            migrated = migrate_legacy(raw)
            original = raw.get('inputs',raw)
            self.assertEqual(coerce_to_engine(migrated['inputs']).model_dump(),coerce_to_engine(original).model_dump())
            with open(path) as source:
                self.assertEqual(raw, json.load(source))

    def test_private_public_versions_concurrency_and_restore(self):
        from app import app
        import_seeds()
        owner = {'id':'test-'+str(uuid4()), 'email':'test@worldbankgroup.org','is_admin':False}
        viewer = {**owner,'id':'test-'+str(uuid4())}
        user = [owner]
        def auth(request, required=True):
            return user[0]
        sid = None
        with patch('simulation_management.routes.identity',auth), TestClient(app) as client:
            try:
                seed = client.get('/api/simulations?collection=examples').json()['items'][0]
                project = client.post(f"/api/simulations/{seed['id']}/duplicate",json={}).json()
                sid = project['id']
                user[0] = viewer
                self.assertEqual(client.get('/api/simulations/'+sid).status_code,404)
                self.assertEqual(client.get('/api/simulations?collection=mine').json()['total'],0)
                user[0] = owner
                version = client.post(f'/api/simulations/{sid}/versions',json={'revision':1,'label':'Initial'}).json()
                published = client.post(f'/api/simulations/{sid}/publish',json={'revision':1,'version_id':version['id']})
                self.assertEqual(published.status_code,200,published.text)
                self.assertEqual(client.patch('/api/simulations/'+sid,json={'revision':1,'name':'Stale'}).status_code,409)
                self.assertEqual(client.patch('/api/simulations/'+sid,json={'revision':2,'name':'Private draft title'}).status_code,200)
                user[0] = viewer
                visible = client.get('/api/simulations/'+sid).json()
                self.assertNotEqual(visible['name'],'Private draft title')
                self.assertEqual(client.patch('/api/simulations/'+sid,json={'revision':3,'name':'Forged'}).status_code,403)
                self.assertEqual(client.get(f'/api/simulations/{sid}/versions').status_code,403)
                user[0] = owner
                self.assertEqual(client.post(f'/api/simulations/{sid}/unpublish',json={'revision':3}).status_code,200)
                user[0] = viewer
                self.assertEqual(client.get('/api/simulations/'+sid).status_code,404)
                self.assertEqual(client.get('/api/profiles/Oct%2012').status_code,410)
            finally:
                with connect() as db:
                    if sid:
                        db.execute('DELETE FROM wss_versions WHERE simulation_id=%s',(sid,))
                        db.execute('DELETE FROM wss_simulations WHERE id=%s',(sid,))
                    db.execute('DELETE FROM wss_users WHERE id=ANY(%s)',([owner['id'],viewer['id']],))
