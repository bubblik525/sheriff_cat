import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../cloud/worker.mjs';
function harness() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(
    readFileSync(new URL('../cloud/schema.sql', import.meta.url), 'utf8'),
  );
  const DB = {
    prepare(sql) {
      let values = [];
      return {
        bind(...v) {
          values = v;
          return this;
        },
        async first() {
          return sqlite.prepare(sql).get(...values) || null;
        },
        async run() {
          const r = sqlite.prepare(sql).run(...values);
          return { meta: { changes: Number(r.changes) } };
        },
      };
    },
  };
  const env = {
    DB,
    SHERIFF_TOKEN_CONTRACT: '',
    SHERIFF_TOKEN_THRESHOLDS: '',
    RPC_URL: '',
  };
  return {
    sqlite,
    async request(path, body = {}, key = 'a'.repeat(64)) {
      return worker.fetch(
        new Request('https://companion.test' + path, {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + key,
            'Content-Type': 'application/json',
            'CF-Connecting-IP': '127.0.0.1',
          },
          body: JSON.stringify(body),
        }),
        env,
        {
          waitUntil(p) {
            p.catch(() => {});
          },
        },
      );
    },
  };
}
test('cloud rejects anonymous changes and client-supplied XP, stores care once', async () => {
  const h = harness();
  assert.equal((await h.request('/profile', {}, 'bad')).status, 401);
  let r = await h.request('/profile');
  assert.equal(r.status, 200);
  assert.equal((await r.json()).access.tier, 0);
  r = await h.request('/action', {
    type: 'care',
    action: 'daily',
    xp: 999999,
    tier: 3,
  });
  assert.equal(r.status, 200);
  let p = await r.json();
  assert.equal(p.pet.fish, 6);
  assert.equal(p.pet.xp, 10);
  assert.equal(
    (await h.request('/action', { type: 'care', action: 'daily' })).status,
    400,
  );
  assert.equal(
    (await h.request('/action', { type: 'outfit', outfit: 'marshal', tier: 3 }))
      .status,
    400,
  );
  r = await h.request('/profile');
  p = await r.json();
  assert.equal(p.pet.fish, 6);
  h.sqlite.close();
});
test('cloud concurrent claims cannot double award, profiles cannot edit one another', async () => {
  const h = harness();
  await h.request('/profile');
  const r = await Promise.all([
    h.request('/action', { type: 'care', action: 'daily' }),
    h.request('/action', { type: 'care', action: 'daily' }),
  ]);
  assert.equal(r.filter((x) => x.status === 200).length, 1);
  assert.equal((await (await h.request('/profile')).json()).pet.fish, 6);
  const other = await (await h.request('/profile', {}, 'b'.repeat(64))).json();
  assert.equal(other.pet.fish, 3);
  h.sqlite.close();
});
