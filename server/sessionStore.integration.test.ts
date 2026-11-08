import assert from 'node:assert/strict';
import { randomUUID, createHmac } from 'node:crypto';
import { test } from 'node:test';
import express from 'express';
import pg from 'pg';
import { CoordinatedSessionStore } from './sessionStore';
import { resolveStoredAccount, setupReplitAuth, cookieName } from './replitAuth';
import { sessionPolicy, type SessionAccount } from './sessionPolicy';
import * as oidc from 'openid-client';

test('PostgreSQL coordinates two instances, preserves rotations and prevents resurrection after logout', async () => {
  const pool1 = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const pool2 = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const store1 = new CoordinatedSessionStore(pool1), store2 = new CoordinatedSessionStore(pool2);
  const sid = `wss-test-${randomUUID()}`, now = Date.now(), policy = sessionPolicy({});
  const account: SessionAccount = { subject: 'replit:isolated-test', email: '', signedInAt: now, lastActivityAt: now,
    idleExpiresAt: now + policy.idleMs, absoluteExpiresAt: now + policy.absoluteMs,
    providerIssuedAt: now - 60_000, providerExpiresAt: now - 1, refreshToken: 'isolated-test-old' };
  const initial: any = { cookie: { expires: new Date(now + policy.idleMs), originalMaxAge: policy.idleMs }, account };
  const set = (store: CoordinatedSessionStore, value: any) => new Promise<void>((resolve, reject) => store.set(sid, value, err => err ? reject(err) : resolve()));
  try {
    await set(store1, initial);
    const stale: any = await new Promise((resolve, reject) => store1.get(sid, (err, value) => err ? reject(err) : resolve(value)));
    let refreshes = 0;
    const refresh = async (credential: string) => {
      assert.equal(credential, 'isolated-test-old'); refreshes++;
      await new Promise(resolve => setTimeout(resolve, 35));
      return { expires_in: 3600, refresh_token: 'isolated-test-new', claims: () => undefined };
    };
    const outcomes = await Promise.all([store1, store2].map(store => store.coordinate(sid,
      value => resolveStoredAccount(value, now, policy, refresh, true))));
    assert.equal(refreshes, 1); assert.ok(outcomes.every(item => item?.status === 'authenticated'));
    await set(store2, stale);
    const row = (await pool1.query('SELECT sess,expire FROM wss_auth_sessions WHERE sid=$1', [sid])).rows[0];
    assert.equal(row.sess.account.refreshToken, 'isolated-test-new');
    assert.equal(new Date(row.expire).getTime(), row.sess.account.idleExpiresAt);
    const delayed = store1.coordinate(sid, async () => { await new Promise(resolve => setTimeout(resolve, 40)); return true; });
    const logout = new Promise<void>((resolve, reject) => store2.destroy(sid, err => err ? reject(err) : resolve()));
    await Promise.all([delayed, logout]); await set(store1, stale);
    assert.equal((await pool1.query('SELECT 1 FROM wss_auth_sessions WHERE sid=$1', [sid])).rowCount, 0);
  } finally {
    await pool1.query('DELETE FROM wss_auth_sessions WHERE sid=$1', [sid]);
    store1.close(); store2.close();
  }
});

test('installed OIDC client performs real HTTP refresh and accepts a response without an ID token', async () => {
  const provider = express(); provider.use(express.urlencoded({ extended: false }));
  let calls = 0;
  provider.post('/token', (req, res) => {
    assert.equal(req.body.grant_type, 'refresh_token');
    assert.equal(req.body.refresh_token, calls ? 'test-rotated' : 'test-initial');
    calls++;
    res.json({ access_token: 'test-access-response', token_type: 'Bearer', expires_in: 60,
      ...(calls === 1 ? { refresh_token: 'test-rotated' } : {}) });
  });
  const server = provider.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const issuer = `http://127.0.0.1:${(server.address() as any).port}`;
  const config = new oidc.Configuration({ issuer, token_endpoint: `${issuer}/token` }, 'isolated-test-client',
    { token_endpoint_auth_method: 'none' }, oidc.None());
  // HTTP is permitted only in this isolated local test fixture.
  oidc.allowInsecureRequests(config);
  const now = Date.now(), policy = sessionPolicy({});
  const value: any = { account: { subject: 'replit:verified-test', email: '', signedInAt: now, lastActivityAt: now,
    idleExpiresAt: now + policy.idleMs, absoluteExpiresAt: now + policy.absoluteMs,
    providerIssuedAt: now - 60_000, providerExpiresAt: now - 1, refreshToken: 'test-initial' } };
  try {
    const refresh = (token: string) => oidc.refreshTokenGrant(config, token);
    assert.equal((await resolveStoredAccount(value, now, policy, refresh)).status, 'authenticated');
    assert.equal(value.account.refreshToken, 'test-rotated');
    assert.equal((await resolveStoredAccount(value, now + 46_000, policy, refresh)).status, 'authenticated');
    assert.equal(value.account.refreshToken, 'test-rotated'); assert.equal(calls, 2);
  } finally { server.close(); }
});

test('gateway status is passive, activity is explicit, cookie aligns, expiry blocks forwarding, and status has no credentials', async () => {
  const app = express(); app.set('trust proxy', 1);
  const base = Date.now(); let clock = base;
  const configured = setupReplitAuth(app, { now: () => clock });
  const { store, database, policy } = configured;
  app.get('/api/test-protected', (_req, res) => res.status(res.locals.wssAccount ? 200 : 401).end());
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const port = (server.address() as any).port;
  const sid = `wss-test-${randomUUID()}`;
  const account: SessionAccount = { subject: 'replit:isolated-gateway', email: '', signedInAt: base, lastActivityAt: base,
    idleExpiresAt: base + policy.idleMs, absoluteExpiresAt: base + policy.absoluteMs,
    providerIssuedAt: base, providerExpiresAt: base + policy.absoluteMs };
  await new Promise<void>((resolve, reject) => store.set(sid, { cookie: { expires: new Date(base + policy.idleMs),
    httpOnly: true, secure: true, sameSite: 'lax', path: '/' }, account } as any,
    err => err ? reject(err) : resolve()));
  const signed = `${sid}.${createHmac('sha256', process.env.SESSION_SECRET!).update(sid).digest('base64').replace(/=+$/, '')}`;
  const headers = { cookie: `${cookieName}=${encodeURIComponent(`s:${signed}`)}`, 'x-forwarded-proto': 'https' };
  const request = (path: string, method = 'GET') => fetch(`http://127.0.0.1:${port}${path}`, { method, headers });
  try {
    clock += 60_000;
    const passive = await request('/api/session'), info = await passive.json();
    assert.equal(info.idleExpiresAt, account.idleExpiresAt); assert.equal(info.user.id, account.subject);
    assert.equal(info.status, 'authenticated'); assert.ok(!JSON.stringify(info).includes('refreshToken'));
    const active = await request('/api/session/activity', 'POST'), moved = await active.json();
    assert.equal(moved.idleExpiresAt, clock + policy.idleMs);
    assert.equal(moved.absoluteExpiresAt, account.absoluteExpiresAt);
    assert.match(active.headers.get('set-cookie')!, /HttpOnly/); assert.match(active.headers.get('set-cookie')!, /Secure/);
    clock = moved.idleExpiresAt + 1;
    assert.equal((await request('/api/session/activity', 'POST')).status, 401);
    assert.equal((await request('/api/test-protected')).status, 401);
    await request('/api/logout', 'POST');
    assert.equal((await database.query('SELECT 1 FROM wss_auth_sessions WHERE sid=$1', [sid])).rowCount, 0);
  } finally {
    await database.query('DELETE FROM wss_auth_sessions WHERE sid=$1', [sid]);
    server.close(); store.close();
  }
});
