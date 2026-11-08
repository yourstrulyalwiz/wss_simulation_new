import type { Express, Request, Response } from 'express';
import session from 'express-session';
import pg from 'pg';
import * as oidc from 'openid-client';
import { CoordinatedSessionStore } from './sessionStore';
import { eligible, qualifyActivity, refreshDue, sessionPolicy, type SessionAccount, type SessionPolicy } from './sessionPolicy';

declare module 'express-session' {
  interface SessionData {
    account?: SessionAccount;
    login?: { verifier: string; state: string; nonce: string; redirectUri: string; next: string; started: number };
  }
}
export const cookieName = '__Host-wss-session';
let discovery: Promise<oidc.Configuration> | undefined;
async function configuration() {
  if (!process.env.REPL_ID) throw new Error('Replit Auth requires this project’s managed REPL_ID.');
  const result = await (discovery ??= oidc.discovery(new URL(process.env.ISSUER_URL || 'https://replit.com/oidc'), process.env.REPL_ID,
    { token_endpoint_auth_method: 'none' }, oidc.None()).catch(error => { discovery = undefined; throw error; }));
  result.timeout = 10;
  return result;
}
export function safeNext(value: unknown) {
  return typeof value === 'string' && /^\/(?:auth\/complete|user-portal|simulations\/(?:new|[a-f0-9-]+))$/.test(value)
    ? value : '/user-portal';
}
// Pure compatibility helper; the gateway uses the coordinated async resolver below.
export function currentAccount(req: Request): SessionAccount | null {
  const value = req.session?.account;
  return eligible(value, Date.now()) && value!.providerExpiresAt > Date.now() ? value! : null;
}
type Tokens = { expires_in?: number; refresh_token?: string; claims(): { sub?: string; exp?: number } | undefined };
export function renewedAccount(account: SessionAccount, tokens: Tokens, now: number): SessionAccount {
  const claims = tokens.claims();
  if (claims && (typeof claims.exp !== 'number' || claims.exp * 1000 <= now || `replit:${claims.sub}` !== account.subject)) {
    throw new Error('Refreshed identity does not match');
  }
  const expiry = typeof tokens.expires_in === 'number' && tokens.expires_in > 0
    ? now + tokens.expires_in * 1000 : claims?.exp ? claims.exp * 1000 : 0;
  if (!expiry) throw new Error('Provider token lifetime unavailable');
  return { ...account, providerIssuedAt: now, providerExpiresAt: expiry,
    refreshToken: tokens.refresh_token || account.refreshToken, refreshRetryAt: undefined };
}
export type Resolution = { status: 'authenticated' | 'anonymous' | 'reauthentication_required' | 'temporary_error'; account?: SessionAccount };
export async function resolveStoredAccount(value: session.SessionData, now: number, policy: SessionPolicy,
  refresh: (token: string) => Promise<Tokens>, activity = false, clock = () => now): Promise<Resolution> {
  let account = value.account;
  if (!account) return { status: 'anonymous' };
  if (!eligible(account, now)) return { status: 'reauthentication_required' };
  if (refreshDue(account, now, policy)) {
    if (account.refreshToken) {
      try {
        const tokens = await refresh(account.refreshToken);
        now = clock();
        if (!eligible(account, now)) return { status: 'reauthentication_required' };
        value.account = account = renewedAccount(account, tokens, now);
      }
      catch (error: any) {
        if (['invalid_grant', 'invalid_token', 'unauthorized_client', 'invalid_client'].includes(error?.error) ||
            error?.message === 'Refreshed identity does not match') {
          account.reauthenticationRequired = true; delete account.refreshToken;
          return { status: 'reauthentication_required' };
        }
        account.refreshRetryAt = now + 15_000;
        if (account.providerExpiresAt <= now) return { status: 'temporary_error' };
      }
    } else if (account.providerExpiresAt <= now) return { status: 'reauthentication_required' };
  }
  if (account.providerExpiresAt <= now) return { status: account.refreshToken ? 'temporary_error' : 'reauthentication_required' };
  if (activity) qualifyActivity(account, now, policy);
  return { status: 'authenticated', account };
}
export function setupReplitAuth(app: Express, options: {
  policy?: SessionPolicy; now?: () => number; refresh?: (token: string) => Promise<Tokens>;
} = {}) {
  if (!process.env.REPL_ID || !process.env.DATABASE_URL || !process.env.SESSION_SECRET) {
    throw new Error('Replit Auth requires managed project identity, PostgreSQL and SESSION_SECRET.');
  }
  const policy = options.policy || sessionPolicy();
  const clock = options.now || Date.now;
  const database = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10_000, max: 8 });
  const store = new CoordinatedSessionStore(database);
  app.use(session({
    name: cookieName, secret: process.env.SESSION_SECRET, store,
    resave: false, saveUninitialized: false, proxy: true, rolling: true,
    cookie: { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: policy.idleMs },
  }));
  const resolve = async (req: Request, res: Response, activity = false): Promise<Resolution> => {
    try {
      const result = await store.coordinate(req.sessionID, async value => {
        const now = clock();
        // Coalesce activity even when several tabs send together.
        const allowActivity = activity && (!value.account || now - value.account.lastActivityAt >= Math.min(15_000, policy.activityMs));
        return resolveStoredAccount(value, now, policy, options.refresh || (async token => oidc.refreshTokenGrant(await configuration(), token)), allowActivity, clock);
      });
      const account = result?.account;
      if (account) {
        req.session.cookie.maxAge = Math.max(1, Math.min(account.idleExpiresAt, account.absoluteExpiresAt) - Date.now());
      } else if (req.session.account) {
        res.clearCookie(cookieName, { secure: true, httpOnly: true, sameSite: 'lax', path: '/' });
      }
      return result || { status: 'anonymous' };
    } catch { return { status: 'temporary_error' }; }
  };
  const statusBody = (result: Resolution) => {
    const account = result.account;
    return { status: result.status, user: account ? { id: account.subject, email: account.email,
      is_admin: (process.env.WSS_ADMIN_SUBJECTS || '').split(',').map(s => s.trim()).includes(account.subject) } : null,
      serverTime: Date.now(), idleExpiresAt: account?.idleExpiresAt ?? null, absoluteExpiresAt: account?.absoluteExpiresAt ?? null,
      activityIntervalMs: policy.activityMs, warningMs: policy.warningMs };
  };
  app.get('/api/session', async (req, res) => {
    const result = await resolve(req, res);
    res.setHeader('Cache-Control', 'no-store');
    res.status(result.status === 'temporary_error' ? 503 : 200).json(statusBody(result));
  });
  app.post('/api/session/activity', async (req, res) => {
    const result = await resolve(req, res, true);
    res.setHeader('Cache-Control', 'no-store');
    const status = result.status === 'authenticated' ? 200 : result.status === 'temporary_error' ? 503 : 401;
    res.status(status).json({ ...statusBody(result), code: status === 401 ? 'AUTH_REQUIRED' : status === 503 ? 'AUTH_TEMPORARY' : undefined });
  });
  app.get('/api/login', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const config = await configuration();
      const origin = new URL(`https://${req.get('host')}`);
      const verifier = oidc.randomPKCECodeVerifier(), state = oidc.randomState(), nonce = oidc.randomNonce();
      const redirectUri = new URL('/api/auth/callback', origin).href;
      req.session.login = { verifier, state, nonce, redirectUri, next: safeNext(req.query.next), started: Date.now() };
      const supported = config.serverMetadata().scopes_supported || [];
      const scope = ['openid', 'email', 'profile', ...(supported.includes('offline_access') ? ['offline_access'] : [])].join(' ');
      const url = oidc.buildAuthorizationUrl(config, { redirect_uri: redirectUri, response_type: 'code', scope,
        code_challenge: await oidc.calculatePKCECodeChallenge(verifier), code_challenge_method: 'S256', state, nonce });
      await new Promise<void>((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
      res.redirect(url.href);
    } catch {
      res.status(503).type('html').send('<h1>Replit sign-in is temporarily unavailable</h1><p>No work has been changed.</p><a href="/sign-in">Try again</a>');
    }
  });
  app.get('/api/auth/callback', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const pending = req.session.login;
    delete req.session.login;
    try {
      if (!pending || Date.now() - pending.started > 10 * 60_000) throw new Error('Expired login');
      const config = await configuration();
      const callback = new URL(pending.redirectUri);
      callback.search = new URL(req.originalUrl, callback).search;
      const tokens = await oidc.authorizationCodeGrant(config, callback, {
        pkceCodeVerifier: pending.verifier, expectedState: pending.state, expectedNonce: pending.nonce, idTokenExpected: true });
      const claims = tokens.claims(), now = Date.now();
      if (!claims?.sub || typeof claims.exp !== 'number' || claims.exp * 1000 <= now) throw new Error('Invalid identity');
      let account: SessionAccount = { subject: `replit:${claims.sub}`,
        email: typeof claims.email === 'string' ? claims.email.toLowerCase().trim() : '',
        signedInAt: now, lastActivityAt: now, idleExpiresAt: now + Math.min(policy.idleMs, policy.absoluteMs),
        absoluteExpiresAt: now + policy.absoluteMs, providerExpiresAt: claims.exp * 1000, providerIssuedAt: now };
      account = renewedAccount(account, tokens, now);
      await new Promise<void>((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
      req.session.account = account;
      req.session.cookie.maxAge = account.idleExpiresAt - now;
      await new Promise<void>((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
      console.info(JSON.stringify({ event: 'auth_signin', refreshAvailable: !!tokens.refresh_token,
        accessLifetimeSeconds: tokens.expires_in ?? null, idLifetimeSeconds: Math.round(claims.exp - now / 1000) }));
      res.redirect(pending.next);
    } catch {
      res.status(401).type('html').send('<h1>Sign-in could not be verified</h1><p>Please start sign-in again.</p><a href="/sign-in">Return to sign-in</a>');
    }
  });
  app.get('/auth/complete', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; frame-ancestors 'none'");
    res.type('html').send('<!doctype html><title>Sign-in complete</title><h1>Sign-in complete</h1><p>You can close this window and return to your original editor.</p><script>if(window.opener){window.opener.postMessage({type:"wss-auth-complete"},location.origin);window.close()}</script>');
  });
  app.post('/api/logout', (req, res) => {
    req.session.destroy(error => {
      if (error) { res.status(503).json({ code: 'AUTH_TEMPORARY', detail: 'Could not sign out. Please retry.' }); return; }
      res.clearCookie(cookieName, { secure: true, httpOnly: true, sameSite: 'lax', path: '/' }); res.status(204).end();
    });
  });
  // Every API request resolves authoritative state before the gateway forwards identity.
  app.use(async (req, res, next) => {
    if (!req.path.startsWith('/api/')) { next(); return; }
    const result = await resolve(req, res);
    if (result.status === 'temporary_error') {
      res.status(503).json({ code: 'AUTH_TEMPORARY', detail: 'Sign-in verification is temporarily unavailable. Your edits have not been discarded.' }); return;
    }
    res.locals.wssAccount = result.account || null;
    next();
  });
  return { store, database, policy };
}
