import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveStoredAccount, renewedAccount } from './replitAuth';
import { sessionPolicy, qualifyActivity, refreshDue, type SessionAccount } from './sessionPolicy';

const policy = sessionPolicy({}), start = 1_000_000;
const account = (): SessionAccount => ({ subject: 'replit:test', email: '', signedInAt: start, lastActivityAt: start,
  idleExpiresAt: start + policy.idleMs, absoluteExpiresAt: start + policy.absoluteMs,
  providerIssuedAt: start, providerExpiresAt: start + 60_000, refreshToken: 'test-only-credential' });
const tokens = (extra = {}) => ({ expires_in: 60, claims: () => undefined, ...extra });

test('configuration defaults and invalid values fail explicitly', () => {
  assert.equal(policy.idleMs, 7_200_000); assert.equal(policy.absoluteMs, 43_200_000);
  for (const value of ['', '0', '-1', 'NaN', 'Infinity', '2000']) {
    assert.throws(() => sessionPolicy({ WSS_SESSION_IDLE_MINUTES: value }));
  }
});
test('passive checks and short tokens do not slide inactivity or repeatedly refresh', async () => {
  assert.equal(refreshDue({ ...account(), providerExpiresAt: start + 1000 }, start + 1, policy), false);
  const value = { account: account() }; let count = 0;
  const refresh = async () => { count++; return tokens({ refresh_token: 'rotated-test-value' }); };
  assert.equal((await resolveStoredAccount(value as any, start + 20_000, policy, refresh)).status, 'authenticated');
  assert.equal(count, 0);
  await resolveStoredAccount(value as any, start + 46_000, policy, refresh);
  assert.equal(count, 1); assert.equal(value.account.refreshToken, 'rotated-test-value');
  await resolveStoredAccount(value as any, start + 47_000, policy, refresh);
  assert.equal(count, 1); assert.equal(value.account.idleExpiresAt, start + policy.idleMs);
});
test('activity moves only idle; sleep, absolute expiry and legacy sessions never revive', async () => {
  const current = account();
  assert.equal(qualifyActivity(current, start + 1000, policy), true);
  assert.equal(current.absoluteExpiresAt, start + policy.absoluteMs);
  assert.equal(current.idleExpiresAt, start + 1000 + policy.idleMs);
  assert.equal(qualifyActivity(current, current.idleExpiresAt + 1, policy), false);
  const expired = { account: { ...account(), idleExpiresAt: start + 100_000, absoluteExpiresAt: start + 50_000 } };
  assert.equal((await resolveStoredAccount(expired as any, start + 50_001, policy, async () => tokens(), true)).status, 'reauthentication_required');
  assert.equal((await resolveStoredAccount({ account: { subject: 'replit:legacy', expiresAt: start + 999_999 } } as any,
    start, policy, async () => tokens())).status, 'reauthentication_required');
});
test('missing or revoked refresh requires sign-in; outage preserves credentials but never forwards expired identity', async () => {
  const noRefresh = account(); delete noRefresh.refreshToken;
  assert.equal((await resolveStoredAccount({ account: noRefresh } as any, start + 61_000, policy, async () => tokens())).status, 'reauthentication_required');
  const revoked = { account: account() };
  assert.equal((await resolveStoredAccount(revoked as any, start + 61_000, policy, async () => { throw { error: 'invalid_grant' }; })).status, 'reauthentication_required');
  assert.equal(revoked.account.refreshToken, undefined);
  const outage = { account: account() };
  assert.equal((await resolveStoredAccount(outage as any, start + 61_000, policy, async () => { throw new Error('network'); })).status, 'temporary_error');
  assert.ok(outage.account.refreshToken);
  const early = { account: account() };
  assert.equal((await resolveStoredAccount(early as any, start + 46_000, policy, async () => { throw new Error('network'); })).status, 'authenticated');
});
test('refresh without an ID token preserves verified identity, omitted rotation preserves credential, wrong subject fails', () => {
  assert.equal(renewedAccount(account(), tokens(), start + 46_000).subject, account().subject);
  assert.equal(renewedAccount(account(), tokens(), start + 46_000).refreshToken, account().refreshToken);
  assert.throws(() => renewedAccount(account(), tokens({ claims: () => ({ sub: 'other', exp: (start + 200_000) / 1000 }) }), start));
});
test('a delayed provider response cannot revive a session that expired while refreshing', async () => {
  const value = { account: account() };
  const result = await resolveStoredAccount(value as any, start + 50_000, policy, async () => tokens(), true,
    () => start + policy.idleMs + 1);
  assert.equal(result.status, 'reauthentication_required');
  assert.equal(value.account.idleExpiresAt, start + policy.idleMs);
});
