import os
import unittest
from unittest.mock import patch
from uuid import uuid4
from fastapi.testclient import TestClient
from app import app
from simulation_management.store import connect


class ReplitIdentityTests(unittest.TestCase):
    def test_verified_replit_subject_can_create_save_resume_but_not_read_another_users_draft(self):
        subject = 'replit:identity-test-' + str(uuid4())
        other = subject + '-other'
        headers = {'x-wss-gateway': 'test-only-gateway', 'x-wss-user': subject,
                   'x-wss-provider': 'replit', 'x-wss-email': 'viewer@example.test'}
        sid = None
        with patch.dict(os.environ, {'WSS_AUTH_PROVIDER': 'replit',
                                    'WSS_PUBLIC_READ_ONLY': 'false',
                                    'SESSION_SECRET': 'test-only-gateway'}), TestClient(app) as client:
            try:
                self.assertEqual(client.get('/api/access-mode').json()['auth_provider'], 'replit')
                self.assertIsNone(client.get('/api/session').json()['user'])
                self.assertEqual(client.post('/api/simulations', json={}).status_code, 401)
                self.assertIsNone(client.get('/api/session', headers={
                    'x-wss-user': subject, 'x-wss-provider': 'replit',
                    'x-wss-email': 'viewer@example.test'}).json()['user'])
                self.assertIsNone(client.get('/api/session', headers={
                    **headers, 'x-wss-gateway': 'wrong-gateway'}).json()['user'])
                self.assertIsNone(client.get('/api/session', headers={
                    **headers, 'x-wss-user': 'clerk-user'}).json()['user'])
                user = client.get('/api/session', headers=headers).json()['user']
                self.assertEqual(user['id'], subject)
                self.assertFalse(user['is_admin'])
                created = client.post('/api/simulations', headers=headers, json={
                    'name': 'New Replit simulation', 'country_code': 'NPL',
                    'scope': {'sectors': ['water'], 'scopeMode': 'urban_rural',
                              'areaUrban': True, 'areaRural': False}})
                self.assertEqual(created.status_code, 200, created.text)
                record = created.json()
                sid = record['id']
                self.assertTrue(record['is_owner'])
                self.assertFalse(record['read_only'])
                bundle = record['bundle']
                bundle['inputs']['country_config']['area'] = 'Progress saved under verified Replit identity'
                saved = client.patch(f'/api/simulations/{sid}', headers=headers, json={
                    'revision': record['revision'], 'name': 'Saved Replit progress',
                    'bundle': bundle, 'scope': record['scope']})
                self.assertEqual(saved.status_code, 200, saved.text)
                resumed = client.get(f'/api/simulations/{sid}', headers=headers).json()
                self.assertEqual(resumed['name'], 'Saved Replit progress')
                self.assertEqual(resumed['bundle']['inputs']['country_config']['area'],
                                 'Progress saved under verified Replit identity')
                mine = client.get('/api/simulations?collection=mine', headers=headers).json()['items']
                self.assertIn(sid, [item['id'] for item in mine])
                # Same email does not imply ownership; issuer subject is authoritative.
                self.assertEqual(client.get(f'/api/simulations/{sid}',
                                 headers={**headers, 'x-wss-user': other}).status_code, 404)
                self.assertEqual(client.patch(f'/api/simulations/{sid}',
                                 headers={**headers, 'x-wss-user': other},
                                 json={'revision': 2, 'name': 'Not mine'}).status_code, 404)
                self.assertEqual(client.get(f'/api/simulations/{sid}').status_code, 404)
            finally:
                with connect() as db:
                    if sid:
                        db.execute('DELETE FROM wss_versions WHERE simulation_id=%s', (sid,))
                        db.execute('DELETE FROM wss_simulations WHERE id=%s', (sid,))
                    db.execute('DELETE FROM wss_users WHERE id IN (%s,%s)', (subject, other))
