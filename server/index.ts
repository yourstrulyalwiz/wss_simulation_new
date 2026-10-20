import express from 'express';
import { clerkMiddleware, getAuth, clerkClient } from '@clerk/express';
import { publishableKeyFromHost } from '@clerk/shared/keys';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { spawn } from 'node:child_process';
import { CLERK_PROXY_PATH, clerkProxyMiddleware, getClerkProxyHost } from './middlewares/clerkProxyMiddleware';

// A thin authentication gateway; all numerical and project services remain Python.
if (!process.env.SESSION_SECRET) throw new Error('SESSION_SECRET is required');
const backend = spawn('python', ['-m', 'uvicorn', 'app:app', '--host', '127.0.0.1', '--port', '5001'], {stdio:'inherit'});
const app = express();
const publicReadOnly = process.env.WSS_PUBLIC_READ_ONLY?.toLowerCase() === 'true';
app.set('trust proxy', 1);
if (!publicReadOnly) {
  app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
  app.use(clerkMiddleware(req => ({
    publishableKey: publishableKeyFromHost(getClerkProxyHost(req) ?? '', process.env.CLERK_PUBLISHABLE_KEY),
  })));
}
app.use(async (req, res, next) => {
  // Never trust identity supplied by the browser, including on anonymous routes.
  for (const key of ['x-wss-gateway', 'x-wss-user', 'x-wss-email']) delete req.headers[key];
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'private, no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.headers.origin;
      const host = getClerkProxyHost(req);
      if (origin && new URL(origin).host !== host) {
        res.status(403).json({detail:'Cross-origin writes are not allowed.'}); return;
      }
    }
    const userId = publicReadOnly ? null : getAuth(req).userId;
    if (userId) {
      try {
        const user = await clerkClient.users.getUser(userId);
        const email = user.emailAddresses.find(e => e.id === user.primaryEmailAddressId &&
          e.verification?.status === 'verified')?.emailAddress.toLowerCase().trim();
        if (!email || email.split('@').length !== 2 || email.split('@')[1] !== 'worldbankgroup.org') {
          res.status(403).json({detail:'A verified @worldbankgroup.org account is required.'}); return;
        }
        req.headers['x-wss-user'] = userId;
        req.headers['x-wss-email'] = email;
      } catch {
        res.status(503).json({detail:'Identity verification is temporarily unavailable. Please retry.'}); return;
      }
    }
  }
  req.headers['x-wss-gateway'] = process.env.SESSION_SECRET!;
  next();
});
app.use(createProxyMiddleware({target:'http://127.0.0.1:5001', changeOrigin:false,
  on: {error: (_error, _req, res: any) => {
    if (!res.headersSent) res.writeHead(503, {'Content-Type':'application/json'});
    res.end(JSON.stringify({detail:'The simulation service is starting. Please retry.'}));
  }},
}));
const server = app.listen(5000, '0.0.0.0', () => console.log('WSS authentication gateway listening on port 5000'));
const stop = () => { server.close(); backend.kill('SIGTERM'); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
backend.on('exit', code => { server.close(); process.exit(code ?? 1); });
