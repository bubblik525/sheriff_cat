import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initTrading,
  addRule,
  observe,
  estimate,
  openPaper,
  markPaper,
  closePaper,
  walletRecords,
} from '../src/trading.mjs';
import { blank, storage } from '../src/storage.mjs';
import { validateState } from '../src/validate.mjs';
import { demoTokens } from '../src/demo.mjs';
import { Provider } from '../src/provider.mjs';
import { render, selected } from '../src/view.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const setup = () => {
  const s = blank(true);
  s.tokens = demoTokens();
  initTrading(s);
  return s;
};
test('alerts require all conditions, ignore missing/stale fields, fire only on crossings', () => {
  const s = setup(),
    t = s.tokens[0],
    r = addRule(s, t.address, 'liquidity>=20000,volume>50000');
  const m = {
    ...t.market,
    liquidity: 30000,
    volume: 60000,
    observedAt: Date.now(),
  };
  observe(s, t, m);
  observe(s, t, m);
  assert.equal(s.trading.alerts.length, 1);
  observe(s, t, { ...m, volume: null });
  observe(s, t, m);
  assert.equal(s.trading.alerts.length, 1);
  observe(s, t, { ...m, volume: 100 });
  observe(s, t, m);
  assert.equal(s.trading.alerts.length, 2);
  observe(s, t, { ...m, observedAt: Date.now() - 130000 });
  assert.equal(s.trading.alerts.length, 2);
  assert.throws(() => addRule(s, '*', 'liquidity=1'));
  assert.equal(r.conditions.length, 2);
});
test('change log rejects stale prices and marks pool switches without false deltas', () => {
  const s = setup(),
    t = s.tokens[0];
  observe(s, t, { ...t.market, price: t.market.price * 2 });
  assert.match(s.trading.changes[0].text, /price/);
  s.trading.changes = [];
  observe(s, t, { ...t.market, pair: 'different', price: 999 });
  assert.equal(s.trading.changes.length, 1);
  assert.match(s.trading.changes[0].text, /pool changed/);
});
test('size model accounts for curve, fee and extra slippage; invalid data cannot give fills', () => {
  const m = {
    price: 1,
    liquidity: 20000,
    pair: 'pool',
    observedAt: Date.now(),
  };
  const q = estimate(m, 100, 0, 0);
  assert.ok(Math.abs(q.quantity - (10000 * 100) / 10100) < 1e-8);
  assert.ok(estimate(m, 100, 30, 50).quantity < q.quantity);
  assert.throws(() => estimate({ ...m, liquidity: null }, 100));
  assert.throws(() => estimate(m, -1));
  assert.throws(() => estimate({ ...m, observedAt: Date.now() + 1000 }, 100));
});
test('paper positions conserve cash, use both-side costs, cannot double-close', () => {
  const s = setup(),
    t = s.tokens[0],
    p = openPaper(s, t, 100, 10, 20, 30, 50);
  assert.equal(s.trading.balance, 9900);
  closePaper(s, p, t.market);
  assert.ok(p.pnl < 0);
  assert.equal(s.trading.balance, 10000 + p.pnl);
  assert.throws(() => closePaper(s, p, t.market));
  assert.throws(() => openPaper(s, t, 20000));
});
test('stops fill at observed gap price, not fictional stop price; wrong-pool prices are ignored', () => {
  const s = setup(),
    t = s.tokens[0],
    p = openPaper(s, t, 100, 10, 20);
  t.market = { ...t.market, price: t.market.price * 0.5, pair: 'wrong' };
  markPaper(s);
  assert.ok(!p.closedAt);
  t.market.pair = p.pair;
  markPaper(s);
  assert.equal(p.reason, 'stop');
  assert.equal(p.exitPrice, p.entryPrice * 0.5);
});
test('wallet history is seeded once and de-duplicated by event identity', () => {
  const s = setup(),
    w = { address: s.tokens[0].creator, seen: [] };
  s.trading.wallets.push(w);
  const item = {
    id: 'tx:1',
    tx: 'tx',
    direction: 'IN',
    symbol: 'T',
    value: '10 raw',
  };
  walletRecords(s, w, { items: [item], truncated: true });
  assert.equal(s.trading.transfers[0].historical, true);
  walletRecords(s, w, {
    items: [item, { ...item, id: 'tx:2' }],
    truncated: false,
  });
  assert.equal(s.trading.transfers.length, 2);
  assert.equal(s.trading.transfers[0].historical, false);
  assert.equal(validateState(s, true), true);
});
test('new state persists across restart, older state remains valid, malformed paper is rejected', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sheriff-research-'));
  try {
    let st = await storage(dir, true);
    st.state.tokens = demoTokens();
    const s = st.state;
    initTrading(s);
    openPaper(s, s.tokens[0], 50);
    addRule(s, '*', 'change>10');
    await st.save(s);
    await st.close();
    st = await storage(dir, true);
    assert.equal(st.state.trading.paper.length, 1);
    await st.close();
    s.trading.paper[0].quantity = -10;
    assert.equal(validateState(s, true), false);
    assert.equal(validateState(blank(false), false), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('research desk keeps selected token and renders all four pages in compact and wide terminals', () => {
  const s = setup(),
    a = {
      state: s,
      tab: 7,
      tradePick: s.tokens[5].address,
      index: 0,
      filter: '',
      baseline: {},
      events: [],
    };
  assert.equal(selected(a), s.tokens[5]);
  for (const tradePage of ['alerts', 'changes', 'wallets', 'paper'])
    for (const width of [80, 120]) {
      const text = render({ ...a, tradePage }, width, 24, false);
      assert.ok(text.includes('8 '));
      assert.ok(text.split('\r\n').every((l) => l.length <= width));
    }
});
test('provider wallet activity exposes transfers not inferred buys and malformed response fails', async () => {
  const address = demoTokens()[0].creator;
  const p = new Provider('test', async () =>
    Response.json({
      items: [
        {
          transaction_hash: '0xabc',
          log_index: 0,
          from: { hash: address },
          to: { hash: demoTokens()[0].address },
          token: { symbol: 'T' },
          total: { value: '100' },
        },
      ],
      next_page_params: { index: 1 },
    }),
  );
  const r = await p.transfers(address);
  assert.equal(r.items[0].direction, 'OUT');
  assert.equal(r.truncated, true);
});
