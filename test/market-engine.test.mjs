import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeToken, updateEngine, demoStep } from '../src/market-engine.mjs';
import { demoTokens } from '../src/demo.mjs';
test('activity filters expose unknown/stale data and do not imply safety', () => {
  const t = demoTokens()[0];
  t.market = { ...t.market, liquidity: 20000, volume: 25000, change: 10 };
  const a = analyzeToken(t, [t]);
  assert.equal(a.verdict, 'WATCH');
  assert.equal(a.score, 100);
  t.market.observedAt = 1;
  assert.equal(analyzeToken(t, [t]).score, null);
  t.market = null;
  assert.equal(analyzeToken(t, [t]).verdict, 'WAIT');
});
test('engine deduplicates observations and keeps bounded history', () => {
  const s = { tokens: demoTokens() };
  updateEngine(s);
  const seq = s.engine.seq;
  updateEngine(s);
  assert.equal(s.engine.seq, seq);
  for (let i = 0; i < 200; i++) {
    s.tokens[0].market.price *= 1.01;
    s.tokens[0].market.observedAt += 1;
    updateEngine(s);
  }
  assert.equal(s.engine.history[s.tokens[0].address].length, 60);
  assert.ok(s.engine.events.length <= 150);
});
test('demo evolves quotes and introduces unique tokens with a bounded universe', () => {
  const s = { tokens: demoTokens() };
  const price = s.tokens[0].market.price;
  for (let i = 0; i < 800; i++) s.tokens = demoStep(s);
  assert.notEqual(s.tokens[0].market.price, price);
  assert.equal(s.tokens.length, 120);
  assert.equal(new Set(s.tokens.map((t) => t.address)).size, 120);
});
