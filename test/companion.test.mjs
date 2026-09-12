import test from 'node:test';
import assert from 'node:assert/strict';
import { blank, storage } from '../src/storage.mjs';
import { companion } from '../src/companion.mjs';
import {
  units,
  quantity,
  tierFor,
  accessFor,
  initPet,
  reward,
  care,
} from '../src/pet.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('token access uses exact quantities, never rounded floats or XP', () => {
  const thresholds = ['10000', '100000', '1000000'];
  assert.equal(
    tierFor(units('9999.999999999999999999', 18), 18, thresholds),
    0,
  );
  assert.equal(tierFor(units('10000', 18), 18, thresholds), 1);
  assert.equal(tierFor(units('1000000', 18), 18, thresholds), 3);
  assert.equal(
    quantity(units('100000000000000000.123', 18), 18),
    '100000000000000000.123',
  );
  assert.equal(quantity(0n, 18), '0');
  assert.throws(() => tierFor(1n, 18, ['2', '1', '3']));
  assert.throws(() => units('1.0001', 2));
  assert.equal(accessFor({ tier: 3, at: 100 }, 300101).tier, 0);
  assert.equal(accessFor({ tier: 3, at: 100 }, 99).tier, 0);
});
test('care is capped, repeated tasks deduplicate, daily fish reset in UTC', () => {
  const s = blank(true),
    now = Date.UTC(2026, 8, 12, 12);
  initPet(s, now);
  care(s, 'daily', 0, now);
  assert.equal(s.pet.fish, 6);
  assert.throws(() => care(s, 'daily', 3, now + 1));
  care(s, 'feed', 0, now);
  assert.equal(s.pet.fish, 5);
  assert.throws(() => care(s, 'feed', 0, now + 1));
  for (let i = 0; i < 10; i++) reward(s, 'investigate', 'token-' + i, now);
  assert.equal(s.pet.xp, 100);
  assert.equal(reward(s, 'investigate', 'token-0', now), false);
  care(s, 'daily', 3, now + 86400000);
  assert.equal(s.pet.fish, 17);
  assert.equal(s.pet.daily.xp, 10);
});
test('companion flow persists profile, gates access, preserves paper results', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sheriff-companion-test-'));
  let db = await storage(dir, true);
  const app = companion(db.state, db.save);
  const a = app.snapshot().tokens[0].address;
  await app.run({ type: 'investigate', address: a });
  assert.equal(app.snapshot().pet.xp, 25);
  await app.run({ type: 'investigate', address: a });
  assert.equal(app.snapshot().pet.xp, 25);
  await assert.rejects(app.run({ type: 'outfit', outfit: 'marshal' }));
  for (const t of app.snapshot().tokens.slice(0, 5))
    await app.run({ type: 'watch', address: t.address });
  await assert.rejects(
    app.run({ type: 'watch', address: app.snapshot().tokens[5].address }),
  );
  await app.run({ type: 'demo-tier', tier: 3 });
  await app.run({ type: 'outfit', outfit: 'marshal' });
  await app.run({
    type: 'paper',
    address: a,
    amount: 100,
    stop: 10,
    target: 20,
    fee: 30,
    slip: 50,
  });
  const p = app.snapshot().trading.paper[0];
  await app.run({ type: 'close', id: p.id });
  assert.ok(
    app.snapshot().trading.balance < 10000,
    'round-trip costs are charged',
  );
  await app.run({ type: 'demo-tier', tier: 0 });
  await assert.rejects(
    app.run({
      type: 'compare',
      addresses: app
        .snapshot()
        .tokens.slice(0, 3)
        .map((t) => t.address),
    }),
  );
  await app.run({
    type: 'settings',
    name: 'Whiskers',
    address: '',
    reducedMotion: true,
  });
  await db.close();
  db = await storage(dir, true);
  const restored = companion(db.state, db.save).snapshot();
  assert.equal(restored.pet.name, 'Whiskers');
  assert.equal(restored.settings.reducedMotion, true);
  assert.ok(restored.trading.paper[0].closedAt);
  assert.equal(restored.access.tier, 0);
  await db.close();
  await rm(dir, { recursive: true });
});
test('live startup has no invented balances, market data or demo unlock', async () => {
  const app = companion(blank(false), async () => {});
  assert.equal(app.snapshot().tokens.length, 0);
  assert.equal(app.snapshot().access.tier, 0);
  assert.equal(app.snapshot().access.configured, false);
  await assert.rejects(app.run({ type: 'demo-tier', tier: 3 }));
  await assert.rejects(app.run({ type: 'refresh' }));
  assert.equal(app.snapshot().tokens.length, 0);
});
