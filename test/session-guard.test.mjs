import test from 'node:test';
import assert from 'node:assert/strict';
import { guard, guardAction } from '../src/session-guard.mjs';
import { blank } from '../src/storage.mjs';
import { companion } from '../src/companion.mjs';
import { initTrading, openPaper } from '../src/trading.mjs';
import { demoTokens } from '../src/demo.mjs';
function setup() {
  const s = blank(true);
  initTrading(s);
  s.tokens = demoTokens();
  return s;
}
test('time counts visible heartbeats once and ignores long absences', () => {
  const s = setup();
  guard(s, 1000, true);
  guard(s, 16000, true);
  guard(s, 16000, true);
  assert.equal(s.sessionGuard.elapsed, 15000);
  guard(s, 100000, true);
  assert.equal(s.sessionGuard.elapsed, 15000);
  s.sessionGuard.minutes = 1;
  guard(s, 115000, true);
  guard(s, 130000, true);
  assert.equal(guard(s, 145000, true).locked, true);
  assert.throws(() => guardAction(s, { type: 'resume' }, 146000));
  assert.throws(() =>
    guardAction(
      s,
      { type: 'guard-settings', minutes: 180, loss: 50, rest: 1 },
      146000,
    ),
  );
  const restored = JSON.parse(JSON.stringify(s));
  assert.equal(guard(restored, 146000).locked, true);
  guardAction(restored, { type: 'resume' }, 800000);
  assert.equal(guard(restored, 800000).locked, false);
});
test('paper purchases preserve equity; stale data is unknown; actual drawdown locks', () => {
  const s = setup();
  guard(s);
  openPaper(s, s.tokens[0], 100, 10, 20, 30, 50);
  let v = guard(s);
  assert.ok(v.equity > 9900);
  assert.equal(v.locked, false);
  s.tokens[0].market.observedAt = 1;
  assert.equal(guard(s).equity, null);
  assert.equal(guard(s).locked, false);
  s.tokens[0].market.observedAt = Date.now();
  s.trading.balance -= 1000;
  assert.equal(guard(s).locked, true);
});
test('backend blocks new practice but permits position exits during break', async () => {
  const s = setup(),
    app = companion(s, async () => {}),
    address = s.tokens[0].address;
  await app.run({
    type: 'paper',
    address,
    amount: 100,
    stop: 10,
    target: 20,
    fee: 30,
    slip: 50,
  });
  await app.run({ type: 'break' });
  await assert.rejects(
    app.run({ type: 'paper', address, amount: 100, stop: 10, target: 20 }),
    /break/,
  );
  await assert.rejects(
    app.run({ type: 'guess', address, direction: 'up' }),
    /break/,
  );
  await app.run({ type: 'close', id: s.trading.paper[0].id });
  assert.ok(s.trading.paper[0].closedAt);
});
