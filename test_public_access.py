"""Public viewing never grants identity, draft access or shared write access."""
import os
import unittest
from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient
from app import app
from simulation_management.store import connect


class PublicAccessTests(unittest.TestCase):
    def test_public_mode_published_snapshots_only_and_no_mutations(self):
        owner = {'id': 'public-test-' + str(uuid4()),
                 'email': 'test@worldbankgroup.org', 'is_admin': False}
        ids = []
        with TestClient(app) as client:
            try:
                with patch.dict(os.environ, {'WSS_PUBLIC_READ_ONLY': 'false'}), \
                     patch('simulation_management.routes.identity', return_value=owner):
                    seed = client.get('/api/simulations?collection=examples').json()['items'][0]
                    for _ in range(2):
                        response = client.post(f"/api/simulations/{seed['id']}/duplicate", json={})
                        self.assertEqual(response.status_code, 200, response.text)
                        ids.append(response.json()['id'])
                    sid, private_id = ids
                    version = client.post(f'/api/simulations/{sid}/versions',
                                          json={'revision': 1, 'label': 'Public checkpoint'}).json()
                    self.assertEqual(client.post(f'/api/simulations/{sid}/publish',
                                     json={'revision': 1, 'version_id': version['id']}).status_code, 200)
                    self.assertEqual(client.patch(f'/api/simulations/{sid}',
                                     json={'revision': 2, 'name': 'PRIVATE DRAFT TITLE'}).status_code, 200)

                with patch.dict(os.environ, {'WSS_PUBLIC_READ_ONLY': 'true',
                                              'SESSION_SECRET': 'test-public-boundary'}):
                    self.assertEqual(client.get('/api/access-mode').json(), {'public_read_only': True})
                    cards = client.get('/api/simulations?collection=public')
                    self.assertEqual(cards.status_code, 200, cards.text)
                    items = {row['id']: row for row in cards.json()['items']}
                    self.assertIn(sid, items)
                    self.assertNotIn(private_id, items)
                    self.assertNotEqual(items[sid]['name'], 'PRIVATE DRAFT TITLE')
                    visible = client.get(f'/api/simulations/{sid}')
                    self.assertEqual(visible.status_code, 200, visible.text)
                    record = visible.json()
                    self.assertTrue(record['read_only'])
                    self.assertFalse(record['is_owner'])
                    self.assertIsNone(record['revision'])
                    self.assertEqual(record['scenarios'], [])
                    self.assertEqual(record['location'], {})
                    self.assertNotEqual(record['name'], 'PRIVATE DRAFT TITLE')
                    self.assertEqual(client.get(f'/api/simulations/{private_id}').status_code, 404)
                    self.assertEqual(client.get(f'/api/simulations/{private_id}/export').status_code, 404)
                    self.assertEqual(client.post(f'/api/simulations/{private_id}/calculate').status_code, 404)
                    self.assertEqual(client.get(f'/api/simulations/{sid}/export').status_code, 200)
                    self.assertEqual(client.post(f'/api/simulations/{sid}/calculate').status_code, 200)
                    self.assertEqual(client.post('/api/revenue-bases', json=record['bundle']['inputs'],
                                     headers={'x-simulation-id': sid}).status_code, 200)
                    self.assertEqual(client.post('/api/revenue-bases',
                                     json=record['bundle']['inputs']).status_code, 401)
                    for collection in ('mine', 'archived', 'all'):
                        self.assertEqual(client.get('/api/simulations?collection=' + collection).status_code, 401)
                    for route, method in (
                        ('/api/simulations', 'POST'), ('/api/simulations/import', 'POST'),
                        (f'/api/simulations/{sid}', 'PATCH'),
                        *((f'/api/simulations/{sid}/{suffix}', 'POST') for suffix in
                          ('duplicate', 'versions', 'restore', 'publish', 'unpublish')),
                    ):
                        self.assertEqual(client.request(method, route, json={}).status_code, 401, route)
                    self.assertEqual(client.get(f'/api/simulations/{sid}/versions').status_code, 401)
                    self.assertEqual(client.get(f'/api/simulations/{sid}/versions/{version["id"]}').status_code, 401)
                    forged = {'x-wss-gateway': 'test-public-boundary', 'x-wss-user': owner['id'],
                              'x-wss-email': owner['email']}
                    self.assertEqual(client.get('/api/me', headers=forged).status_code, 401)
                    self.assertEqual(client.patch(f'/api/simulations/{sid}', headers=forged,
                                     json={'revision': 3, 'name': 'FORGED'}).status_code, 401)
                    with connect() as db:
                        db.execute('UPDATE wss_simulations SET archived_at=now() WHERE id=%s', (sid,))
                    self.assertEqual(client.get(f'/api/simulations/{sid}').status_code, 404)
                    self.assertNotIn(sid, [c['id'] for c in client.get(
                        '/api/simulations?collection=public').json()['items']])
                with patch.dict(os.environ, {'WSS_PUBLIC_READ_ONLY': 'false'}):
                    self.assertEqual(client.get('/api/access-mode').json(), {'public_read_only': False})
                    self.assertEqual(client.get('/api/simulations?collection=public').status_code, 401)
                    self.assertEqual(client.get('/api/simulations?collection=examples').status_code, 200)
            finally:
                with connect() as db:
                    for sid in ids:
                        db.execute('DELETE FROM wss_versions WHERE simulation_id=%s', (sid,))
                        db.execute('DELETE FROM wss_simulations WHERE id=%s', (sid,))
                    db.execute('DELETE FROM wss_users WHERE id=%s', (owner['id'],))


if __name__ == '__main__':
    unittest.main()
