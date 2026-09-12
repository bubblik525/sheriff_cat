import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startCompanion } from '../src/local-server.mjs';
test('desktop backend uses assigned port, authenticates requests and releases profile', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sheriff-desktop-'));
  let server;
  try {
    server = await startCompanion({ demo: true, dataDir: dir });
    const url = new URL(server.url),
      key = url.hash.slice(1);
    assert.notEqual(url.port, '0');
    assert.equal((await fetch(server.origin + '/')).status, 200);
    assert.equal((await fetch(server.origin + '/api/state')).status, 401);
    const headers = { 'X-Sheriff-Session': key };
    const state = await (
      await fetch(server.origin + '/api/state', { headers })
    ).json();
    assert.equal(state.demo, true);
    assert.equal(state.tokens.length, 28);
    assert.equal(
      (
        await fetch(server.origin + '/api/state', {
          headers: { ...headers, Origin: 'https://untrusted.example' },
        })
      ).status,
      403,
    );
    await server.close();
    server = await startCompanion({ demo: true, dataDir: dir });
    assert.equal(
      (await fetch(server.origin + '/api/state', { headers })).status,
      401,
    );
  } finally {
    await server?.close();
    await rm(dir, { recursive: true, force: true });
  }
});
