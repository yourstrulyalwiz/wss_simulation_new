import type { Express, Request } from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import * as oidc from 'openid-client';

type Account = { subject: string; email: string; expiresAt: number };
declare module 'express-session' {
  interface SessionData {
    account?: Account;
    login?: { verifier: string; state: string; nonce: string; redirectUri: string; next: string; started: number };
  }
}

const cookieName = '__Host-wss-session';
const issuer = new URL('https://replit.com/oidc');
let discovery: Promise<oidc.Configuration> | undefined;
function configuration() {
  if (!process.env.REPL_ID) throw new Error('Replit Auth requires this project’s managed REPL_ID.');
  return discovery ??= oidc.discovery(issuer, process.env.REPL_ID,
    { token_endpoint_auth_method: 'none' }, oidc.None()).catch(error => {
      discovery = undefined; throw error;
    });
}
export function safeNext(value: unknown) {
  return typeof value === 'string' && /^\/(?:user-portal|simulations\/(?:new|[a-f0-9-]+))$/.test(value)
    ? value : '/user-portal';
}
export function currentAccount(req: Request): Account | null {
  const account = req.session?.account;
  if (!account || account.expiresAt <= Date.now() || !account.subject) return null;
  return account;
}
export function setupReplitAuth(app: Express) {
  if (!process.env.REPL_ID || !process.env.DATABASE_URL || !process.env.SESSION_SECRET) {
    throw new Error('Replit Auth requires managed project identity, PostgreSQL and SESSION_SECRET.');
  }
  const PgStore = connectPgSimple(session);
  app.use(session({
    name: cookieName, secret: process.env.SESSION_SECRET,
    store: new PgStore({ conString: process.env.DATABASE_URL, tableName: 'wss_auth_sessions',
      createTableIfMissing: false }),
    resave: false, saveUninitialized: false, proxy: true,
    cookie: { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 8 * 60 * 60 * 1000 },
  }));
  app.get('/api/login', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const config = await configuration();
      // The actual request origin works in development and on the published domain.
      // Replit's OIDC server also validates the callback against this project's domains.
      const origin = new URL(`https://${req.get('host')}`);
      const verifier = oidc.randomPKCECodeVerifier();
      const state = oidc.randomState(), nonce = oidc.randomNonce();
      const redirectUri = new URL('/api/auth/callback', origin).href;
      req.session.login = { verifier, state, nonce, redirectUri, next: safeNext(req.query.next), started: Date.now() };
      const url = oidc.buildAuthorizationUrl(config, {
        redirect_uri: redirectUri, response_type: 'code', scope: 'openid email profile',
        code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
        code_challenge_method: 'S256', state, nonce,
      });
      // Do not force a fresh password prompt: reuse the existing Replit SSO session.
      await new Promise<void>((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
      res.redirect(url.href);
    } catch {
      res.status(503).type('html').send('<h1>Replit sign-in is temporarily unavailable</h1><p>No work has been changed.</p><a href="/sign-in">Try again</a>');
    }
  });
  app.get('/api/auth/callback', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const pending = req.session.login;
    if (!pending) {
      res.status(401).type('html').send('<h1>Start sign-in first</h1><a href="/sign-in">Continue with Replit</a>');
      return;
    }
    delete req.session.login; // one attempt only, including failed callbacks
    try {
      if (!pending || Date.now() - pending.started > 10 * 60 * 1000) throw new Error('Expired login');
      const config = await configuration();
      const callback = new URL(pending.redirectUri);
      callback.search = new URL(req.originalUrl, callback).search;
      const tokens = await oidc.authorizationCodeGrant(config, callback, {
        pkceCodeVerifier: pending.verifier, expectedState: pending.state, expectedNonce: pending.nonce,
        idTokenExpected: true,
      });
      const claims = tokens.claims();
      if (!claims?.sub || typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now()) {
        throw new Error('Invalid identity');
      }
      const account: Account = {
        subject: `replit:${claims.sub}`,
        email: typeof claims.email === 'string' ? claims.email.toLowerCase().trim() : '',
        expiresAt: Math.min(claims.exp * 1000, Date.now() + 8 * 60 * 60 * 1000),
      };
      await new Promise<void>((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
      req.session.account = account;
      req.session.cookie.maxAge = account.expiresAt - Date.now();
      await new Promise<void>((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
      res.redirect(pending.next);
    } catch {
      await new Promise<void>(resolve => req.session.save(() => resolve()));
      res.status(401).type('html').send('<h1>Sign-in could not be verified</h1><p>Please start sign-in again.</p><a href="/sign-in">Return to sign-in</a>');
    }
  });
  app.post('/api/logout', (req, res) => {
    req.session.destroy(error => {
      if (error) { res.status(503).json({ detail: 'Could not sign out. Please retry.' }); return; }
      res.clearCookie(cookieName, { secure: true, httpOnly: true, sameSite: 'lax', path: '/' });
      // End this application's session, not the user's WB workspace SSO session.
      res.status(204).end();
    });
  });
}
