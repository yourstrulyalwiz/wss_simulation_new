# Session renewal and save recovery

## Policy

The Replit gateway enforces application deadlines separately from provider-token validity:

| Setting | Default |
|---|---|
| `WSS_SESSION_IDLE_MINUTES` | 120 |
| `WSS_SESSION_ABSOLUTE_HOURS` | 12 |
| `WSS_SESSION_ACTIVITY_SECONDS` | 60 |
| `WSS_SESSION_REFRESH_MARGIN_SECONDS` | 120 |
| `WSS_SESSION_WARNING_MINUTES` | 5 |

Invalid, zero, negative, nonfinite or excessive values fail startup. Do not put shortened test durations in shared/production settings. The absolute deadline starts at a completed interactive sign-in, including sign-in using an existing provider SSO session. Refresh cannot move it.

Fresh draft edits, explicit save actions and Stay signed in signal meaningful activity. Activity is coalesced client-side and rate-coalesced server-side. Passive status checks, calculations, assets, refresh and retry timers do not extend inactivity. Hidden tabs stop sending activity. Resume/focus/online status checks use server time; a suspended timer cannot revive an expired session.

## Provider behavior

Replit's discovery metadata was checked during implementation. It advertises `offline_access` and the `refresh_token` grant. The real app login redirect was checked and requests `openid email profile offline_access`, preserving PKCE S256, state and nonce. This establishes protocol support, not refresh-token issuance for every account.

The installed `openid-client` performs code exchange and refresh. Only server-side sessions retain refresh credentials. An optional rotated credential replaces the prior one; a response without a new refresh token retains the previous credential. Returned ID-token claims are library-validated and checked against the original subject. A refresh response may omit the ID token. Access-token lifetime and application deadlines are separate.

Actual production refresh-token issuance and lifetimes have **not** been observed through a completed user sign-in in this implementation session. Privacy-safe `auth_signin` logs report only credential availability and access/ID lifetime in seconds—never tokens, authorization codes, subjects or session IDs. Missing/revoked refresh credentials fall back to user-initiated sign-in without discarding the editor. Provider outages return temporary service errors once authentication can no longer be established.

## Persistence and concurrency

No schema migration is required. Existing `wss_auth_sessions` JSON stores application policy metadata and provider credentials. PostgreSQL row locks serialize renewal and activity for one session across instances. Delayed Express session saves preserve authoritative credentials/deadlines; they cannot recreate a previously loaded session after logout. Legacy sessions require a one-time sign-in rather than receiving a fabricated new lifetime.

The gateway owns `/api/session` for Replit mode and preserves its `user` contract. Clerk and public-read-only mode retain the FastAPI route. `/api/session/activity` is same-origin protected. `/auth/complete` is the only additional approved continuation route; popup messages only trigger a fresh authenticated status request.

## Save and recovery rules

- Draft writes have a 25-second request deadline; reads have a 15-second deadline.
- Only draft persistence retries automatically. Backoff is approximately 2, 5, 10, 20 and 60 seconds, with jitter; `Retry-After` is honored.
- Authentication, permission and revision conflicts stop writes. Validation errors wait for a correction or explicit action.
- A timeout does not prove failure. Before replaying an uncertain write, check the original revision and exact snapshot. A different newer server state is a conflict, never permission to overwrite.
- An acknowledgement clears only its snapshot; edits made while saving remain pending.
- Browser recovery stores original base revision, account/project, timestamp, independent editor identifier, draft and unapplied setup. Recovering setup does not apply its coverage/name changes.
- Legacy account/project recovery keys remain readable. New per-editor copies do not overwrite other tabs' copies; competing pending copies require an explicit choice.
- Local-storage failure is a separate warning. It does not prevent authenticated server saves and does not promise browser persistence.
- Reauthentication leaves the live editor mounted. The same account must be verified again, followed by a revision check. A different account hides and disables the original editor instead of uploading its work.

## Verification

```sh
npx tsx --test server/replitAuth.test.ts server/sessionLifecycle.test.ts server/sessionStore.integration.test.ts
node frontend/src/draft-recovery.test.mjs
node frontend/src/tests/session-recovery-browser.mjs
python -m unittest test_replit_identity test_simulation_management
npm --prefix frontend run build
```

PostgreSQL integration tests create/delete only isolated session rows and run local test HTTP servers. They cover two-instance renewal, rotation, stale-save/logout races, passive status/activity, cookie flags, deadline enforcement and the installed OIDC client's HTTP refresh behavior.

The browser regression exercises the real editor with isolated, explicitly mocked API responses; **all simulation mutations are intercepted**, never forwarded to the database. It covers expiry, same/different-account recovery, network/429/timeouts, in-flight edits, lost committed responses, storage failure, reload and revision conflicts. It is not proof of a real provider sign-in or production refresh issuance.

The packaged managed browser tester was unavailable in this environment. A live institutional sign-in-and-refresh acceptance test remains unverified. No test policy overrides remain configured. Publishing is a separate user action.
