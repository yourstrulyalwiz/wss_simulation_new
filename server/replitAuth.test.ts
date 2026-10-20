import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Request } from 'express';
import { currentAccount, safeNext } from './replitAuth';

test('post-login redirects stay inside the simulation workspace', () => {
  for (const path of ['/user-portal', '/simulations/new', '/simulations/2ecaa81d-b43e-55cc-9c33-e801444eb13f']) {
    assert.equal(safeNext(path), path);
  }
  for (const path of ['https://evil.example', '//evil.example', '/\\evil.example', '/api/logout', '/user-portal?next=evil', undefined, ['//evil']]) {
    assert.equal(safeNext(path), '/user-portal');
  }
});
test('only a nonexpired server-side account grants an identity', () => {
  const account = { subject: 'replit:verified', email: '', expiresAt: Date.now() + 60_000 };
  assert.equal(currentAccount({ session: { account } } as Request), account);
  assert.equal(currentAccount({ headers: { 'x-wss-user': 'replit:forged' } } as unknown as Request), null);
  assert.equal(currentAccount({ session: { account: { ...account, expiresAt: 1 } } } as Request), null);
  assert.equal(currentAccount({ session: { account: { ...account, subject: '' } } } as Request), null);
});
