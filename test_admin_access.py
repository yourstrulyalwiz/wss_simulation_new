"""Explicit admin subjects may read private drafts, not edit their originals."""
import os
import unittest
from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient
from app import app
from simulation_management.store import connect


class AdminAccessTests(unittest.TestCase):
    def test_allowlisted_admin_can_publish_a_copy_but_not_change_the_original(self):
        owner, admin, viewer = [
            'replit:admin-access-test-' + str(uuid4()) for _ in range(3)
        ]
        ids = []

        def headers(subject):
            return {
                'x-wss-gateway': 'admin-access-test-gateway',
                'x-wss-user': subject,
                'x-wss-provider': 'replit',
                # Even the same email must not turn another subject into an admin.
                'x-wss-email': 'allowlisted@example.test',
            }

        with patch.dict(os.environ, {
            'WSS_AUTH_PROVIDER': 'replit',
            'WSS_PUBLIC_READ_ONLY': 'false',
            'SESSION_SECRET': 'admin-access-test-gateway',
            'WSS_ADMIN_SUBJECTS': admin,
        }), TestClient(app) as client:
            try:
                self.assertTrue(client.get('/api/session', headers=headers(admin))
                                .json()['user']['is_admin'])
                self.assertFalse(client.get('/api/session', headers=headers(viewer))
                                 .json()['user']['is_admin'])
                self.assertEqual(client.get('/api/simulations?collection=all',
                                 headers=headers(viewer)).status_code, 403)
                created = client.post('/api/simulations', headers=headers(owner), json={
                    'name': 'Private original for admin regression test',
                    'country_code': 'NPL',
                    'scope': {'sectors': ['water'], 'scopeMode': 'urban_rural',
                              'areaUrban': True, 'areaRural': False},
                })
                self.assertEqual(created.status_code, 200, created.text)
                original = created.json()
                sid = original['id']
                ids.append(sid)
                self.assertEqual(client.get(f'/api/simulations/{sid}',
                                 headers=headers(viewer)).status_code, 404)
                readable = client.get(f'/api/simulations/{sid}',
                                      headers=headers(admin))
                self.assertEqual(readable.status_code, 200, readable.text)
                self.assertTrue(readable.json()['read_only'])
                self.assertFalse(readable.json()['is_owner'])
                self.assertEqual(client.patch(f'/api/simulations/{sid}',
                                 headers=headers(admin), json={
                                     'revision': original['revision'],
                                     'name': 'Forbidden overwrite',
                                 }).status_code, 403)
                self.assertEqual(client.post(f'/api/simulations/{sid}/publish',
                                 headers=headers(admin), json={
                                     'revision': original['revision'],
                                     'version_id': str(uuid4()),
                                 }).status_code, 403)
                duplicated = client.post(f'/api/simulations/{sid}/duplicate',
                                         headers=headers(admin),
                                         json={'name': 'Public review copy'})
                self.assertEqual(duplicated.status_code, 200, duplicated.text)
                copy = duplicated.json()
                ids.append(copy['id'])
                self.assertTrue(copy['is_owner'])
                version = client.post(f"/api/simulations/{copy['id']}/versions",
                                      headers=headers(admin),
                                      json={'revision': copy['revision'],
                                            'label': 'Review checkpoint'})
                self.assertEqual(version.status_code, 200, version.text)
                published = client.post(f"/api/simulations/{copy['id']}/publish",
                                        headers=headers(admin),
                                        json={'revision': copy['revision'],
                                              'version_id': version.json()['id']})
                self.assertEqual(published.status_code, 200, published.text)
                self.assertEqual(client.get(f"/api/simulations/{copy['id']}",
                                 headers=headers(viewer)).status_code, 200)
                unchanged = client.get(f'/api/simulations/{sid}',
                                       headers=headers(owner)).json()
                self.assertEqual(unchanged['visibility'], 'private')
                self.assertEqual(unchanged['revision'], original['revision'])
                self.assertEqual(unchanged['bundle'], original['bundle'])
                self.assertEqual(unchanged['name'], original['name'])
            finally:
                with connect() as db:
                    for sid in ids:
                        db.execute('DELETE FROM wss_versions WHERE simulation_id=%s', (sid,))
                        db.execute('DELETE FROM wss_simulations WHERE id=%s', (sid,))
                    db.execute('DELETE FROM wss_users WHERE id IN (%s,%s,%s)',
                               (owner, admin, viewer))
