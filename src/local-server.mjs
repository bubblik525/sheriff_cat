#!/usr/bin/env node
import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { storage } from './storage.mjs';
import { companion } from './companion.mjs';
import { cloudProfile } from './cloud-profile.mjs';

export async function startCompanion({
  port = 0,
  demo = false,
  dataDir = join(homedir(), '.sheriff-cat', 'companion'),
} = {}) {
  const db = await storage(resolve(dataDir), demo);
  const cloud =
    process.env.SHERIFF_CLOUD_URL && !demo
      ? await cloudProfile(process.env.SHERIFF_CLOUD_URL, db.dir)
      : null;
  const app = companion(db.state, db.save, {
    cloud,
    contract: process.env.SHERIFF_TOKEN_CONTRACT,
    thresholds: process.env.SHERIFF_TOKEN_THRESHOLDS?.split(',').map((s) =>
      s.trim(),
    ),
  });
  await app.initialize();
  const session = randomBytes(32).toString('hex');
  let origin;
  const root = fileURLToPath(new URL('../companion/', import.meta.url));
  const files = {
    '/': ['index.html', 'text/html'],
    '/app.js': ['app.js', 'text/javascript'],
    '/pets.js': ['pets.js', 'text/javascript'],
    '/style.css': ['style.css', 'text/css'],
    '/cat.svg': ['cat.svg', 'image/svg+xml'],
  };
  const server = http.createServer(async (req, res) => {
    const send = (code, data) => {
      res.writeHead(code, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(data));
    };
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    if (
      req.headers.host !== `127.0.0.1:${port}` ||
      (req.headers.origin && req.headers.origin !== origin)
    )
      return send(403, { error: 'Local origin only' });
    const path = new URL(req.url, origin).pathname;
    try {
      if (path.startsWith('/api/')) {
        const key = req.headers['x-sheriff-session'];
        if (
          typeof key !== 'string' ||
          !/^[a-f0-9]{64}$/.test(key) ||
          !timingSafeEqual(Buffer.from(key), Buffer.from(session))
        )
          return send(401, {
            error:
              'Open the private URL from your terminal to unlock this session.',
          });
        if (req.method === 'GET' && path === '/api/state')
          return send(200, app.snapshot());
        if (req.method === 'POST' && path === '/api/action') {
          let text = '';
          for await (const chunk of req) {
            text += chunk;
            if (Buffer.byteLength(text) > 8192)
              return send(413, { error: 'Request too large' });
          }
          const body = JSON.parse(text);
          if (!body || typeof body.type !== 'string')
            throw Error('Invalid action');
          return send(200, await app.run(body));
        }
        return send(404, { error: 'Unknown endpoint' });
      }
      if (req.method !== 'GET' || !files[path])
        return send(404, { error: 'Not found' });
      const [file, mime] = files[path];
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' });
      res.end(await readFile(join(root, file)));
    } catch (e) {
      send(400, { error: e.message });
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  }).catch(async (error) => {
    await db.close();
    throw error;
  });
  port = server.address().port;
  origin = `http://127.0.0.1:${port}`;
  const timer = setInterval(() => app.tick(), 1000);
  let closing;
  function close() {
    return (closing ||= (async () => {
      clearInterval(timer);
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      while (app.snapshot().busy)
        await new Promise((resolve) => setTimeout(resolve, 100));
      await db.close();
    })());
  }
  return { url: `${origin}/#${session}`, origin, close };
}
