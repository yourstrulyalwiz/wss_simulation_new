const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { once } = require('node:events');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');
const { createRequire } = require('node:module');

// Exercise the copy actually used by the gateway, not an unrelated direct dependency.
const proxyRequire = createRequire(require.resolve('http-proxy-middleware'));
const httpProxyRequire = createRequire(proxyRequire.resolve('http-proxy'));
const redirects = httpProxyRequire('follow-redirects');

for (const crossRealm of [false, true]) {
  for (const arrayHeaders of [false, true]) {
    test(`redirect strips custom credentials: crossRealm=${crossRealm}, arrayHeaders=${arrayHeaders}`, { timeout: 5000 }, async (t) => {
      const target = createServer((req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(req.headers));
      });
      const source = createServer((_req, res) => {
        // A hostname change ensures a cross-origin redirect even on loopback.
        res.writeHead(302, { Location: `http://localhost:${target.address().port}/target` });
        res.end();
      });
      for (const server of [target, source]) {
        t.after(() => new Promise((resolve, reject) => {
          server.closeAllConnections();
          server.close((error) => error ? reject(error) : resolve());
        }));
        server.listen(0);
        await once(server, 'listening');
      }
      const sensitiveHeaders = crossRealm
        ? runInNewContext("['X-API-Key']")
        : ['X-API-Key'];
      if (crossRealm) {
        assert.equal(Array.isArray(sensitiveHeaders), true);
        assert.equal(sensitiveHeaders instanceof Array, false);
      }
      const headers = arrayHeaders
        ? ['X-API-Key', 'test-only-secret', 'X-Harmless', 'preserved']
        : { 'X-API-Key': 'test-only-secret', 'X-Harmless': 'preserved' };
      const received = await new Promise((resolve, reject) => {
        const request = redirects.http.get({
          hostname: '127.0.0.1',
          port: source.address().port,
          path: '/',
          headers,
          sensitiveHeaders,
          timeout: 2000,
        }, (response) => {
          let body = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => { body += chunk; });
          response.on('error', reject);
          response.on('end', () => {
            try {
              assert.equal(response.statusCode, 200);
              assert.equal(response.redirects?.length ?? 0, 0);
              resolve(JSON.parse(body));
            } catch (error) { reject(error); }
          });
        });
        request.on('error', reject);
        request.on('timeout', () => request.destroy(new Error('Redirect timed out')));
      });
      assert.equal(received['x-api-key'], undefined);
      assert.equal(received['x-harmless'], 'preserved');
    });
  }
}
