import { clean, validAddress, short, usd, pct } from './core.mjs';
export const fresh = (m, now = Date.now()) =>
  !!m &&
  Number.isFinite(m.price) &&
  m.price > 0 &&
  typeof m.pair === 'string' &&
  Number.isFinite(m.observedAt) &&
  m.observedAt <= now &&
  now - m.observedAt <= 120000;
export function initTrading(s) {
  s.trading ??= {
    rules: [],
    alerts: [],
    changes: [],
    wallets: [],
    transfers: [],
    paper: [],
    balance: 10000,
  };
  return s.trading;
}
const bounded = (n, lo, hi, label) => {
  n = Number(n);
  if (!Number.isFinite(n) || n < lo || n > hi)
    throw Error(`${label}: expected ${lo} to ${hi}`);
  return n;
};
export function conditions(text) {
  const parts = text.split(',');
  if (!parts.length || parts.length > 6)
    throw Error('Use up to 6 conditions separated by commas');
  return parts.map((p) => {
    const m = p
      .trim()
      .match(
        /^(price|liquidity|volume|change|buys)(>=|<=|>|<)(-?\d+(?:\.\d+)?)$/,
      );
    if (!m) throw Error('Example: liquidity>=20000,volume>50000,change>0');
    return {
      field: m[1],
      op: m[2],
      value: bounded(m[3], -1e15, 1e15, 'Threshold'),
    };
  });
}
export function addRule(s, address, text) {
  const x = initTrading(s);
  if (x.rules.length >= 50) throw Error('Maximum 50 rules');
  const r = {
    id: crypto.randomUUID(),
    address,
    conditions: conditions(text),
    matches: {},
  };
  x.rules.push(r);
  return r;
}
export function observe(s, t, m, now = Date.now()) {
  const x = initTrading(s),
    old = t.market;
  if (!fresh(m, now)) return;
  if (old?.pair && old.pair !== m.pair) {
    x.changes.unshift({
      at: now,
      address: t.address,
      text: `${clean(t.symbol)}: market pool changed; deltas reset`,
    });
  } else if (old) {
    for (const field of ['price', 'liquidity', 'volume']) {
      if (
        Number.isFinite(old[field]) &&
        old[field] > 0 &&
        Number.isFinite(m[field])
      ) {
        const d = (m[field] / old[field] - 1) * 100;
        if (Math.abs(d) >= (field === 'price' ? 3 : 10))
          x.changes.unshift({
            at: now,
            address: t.address,
            text: `${clean(t.symbol)} ${field} ${pct(d)} / ${usd(old[field])} -> ${usd(m[field])}`,
          });
      }
    }
  }
  x.changes = x.changes.slice(0, 300);
  for (const rule of x.rules) {
    if (rule.address !== '*' && rule.address !== t.address) continue;
    if (!rule.conditions.every((c) => Number.isFinite(m[c.field]))) continue;
    const match = rule.conditions.every((c) => {
      const v = m[c.field];
      return (
        Number.isFinite(v) &&
        (c.op === '>'
          ? v > c.value
          : c.op === '>='
            ? v >= c.value
            : c.op === '<'
              ? v < c.value
              : v <= c.value)
      );
    });
    const previous = rule.matches[t.address];
    if (match && !previous) {
      x.alerts.unshift({
        at: now,
        address: t.address,
        rule: rule.id,
        text: `${clean(t.symbol)} matched ${rule.conditions.map((c) => c.field + c.op + c.value).join(',')}`,
      });
    }
    rule.matches[t.address] = match;
    const retained = new Set(s.tokens.map((t) => t.address));
    for (const a of Object.keys(rule.matches))
      if (!retained.has(a)) delete rule.matches[a];
  }
  x.alerts = x.alerts.slice(0, 300);
}
export function estimate(m, amount, fee = 30, slip = 50, now = Date.now()) {
  amount = bounded(amount, 0.01, 1e7, 'USD size');
  fee = bounded(fee, 0, 1000, 'Fee bps');
  slip = bounded(slip, 0, 5000, 'Slippage bps');
  if (!fresh(m, now)) throw Error('Need a price observed within 120 seconds');
  if (!Number.isFinite(m.liquidity) || m.liquidity <= 0)
    throw Error('Liquidity unavailable; cannot model the fill');
  // Explicit hypothetical equal-value constant-product pool, NOT a routed swap quote.
  const reserve = m.liquidity / 2,
    effective = amount * (1 - fee / 10000);
  const poolTokens = ((reserve / m.price) * effective) / (reserve + effective);
  const quantity = poolTokens * (1 - slip / 10000);
  if (!Number.isFinite(quantity) || quantity <= 0)
    throw Error('Invalid fill estimate');
  return {
    amount,
    fee,
    slip,
    quantity,
    fill: amount / quantity,
    impact: (effective / reserve) * 100,
    pair: m.pair,
    observedAt: m.observedAt,
  };
}
export function openPaper(
  s,
  t,
  amount,
  stop = 10,
  target = 20,
  fee = 30,
  slip = 50,
  now = Date.now(),
) {
  const x = initTrading(s);
  stop = bounded(stop, 0.1, 95, 'Stop %');
  target = bounded(target, 0.1, 10000, 'Target %');
  if (x.paper.filter((p) => !p.closedAt).length >= 20)
    throw Error('Maximum 20 open paper positions');
  if (x.paper.length >= 200) {
    const closed = x.paper.findIndex((p) => p.closedAt);
    if (closed >= 0) x.paper.splice(closed, 1);
  }
  const q = estimate(t.market, amount, fee, slip, now);
  if (q.amount > x.balance) throw Error('Insufficient virtual cash');
  const p = {
    id: crypto.randomUUID(),
    address: t.address,
    symbol: clean(t.symbol),
    entryPrice: t.market.price,
    openedAt: now,
    stop,
    target,
    ...q,
  };
  x.balance -= q.amount;
  x.paper.push(p);
  return p;
}
export function sellValue(p, m, now = Date.now()) {
  if (!fresh(m, now) || m.pair !== p.pair || !(m.liquidity > 0))
    throw Error('Waiting for fresh same-pool price and liquidity');
  const r = m.liquidity / 2,
    effective = p.quantity * (1 - p.fee / 10000);
  return ((r * effective) / (r / m.price + effective)) * (1 - p.slip / 10000);
}
export function closePaper(s, p, m, reason = 'manual', now = Date.now()) {
  if (p.closedAt) throw Error('Position already closed');
  const proceeds = sellValue(p, m, now);
  p.closedAt = now;
  p.exitPrice = m.price;
  p.proceeds = proceeds;
  p.pnl = proceeds - p.amount;
  p.reason = reason;
  initTrading(s).balance += proceeds;
  return p;
}
export function markPaper(s, now = Date.now()) {
  for (const p of initTrading(s).paper.filter((p) => !p.closedAt)) {
    const latest = s.tokens.find((t) => t.address === p.address)?.market;
    const m = latest?.pair === p.pair ? latest : p.lastQuote;
    try {
      const value = sellValue(p, m, now);
      p.mark = value;
      p.markAt = m.observedAt;
      p.status = 'MARKED';
      const move = (m.price / p.entryPrice - 1) * 100;
      if (move <= -p.stop || move >= p.target)
        closePaper(s, p, m, move <= -p.stop ? 'stop' : 'target', now);
    } catch {
      p.status = 'STALE / POOL UNAVAILABLE';
    }
  }
}
export function walletRecords(s, w, result, now = Date.now()) {
  const x = initTrading(s),
    known = new Set(w.seen || []),
    items = result.items;
  const newRows = items.filter((i) => !known.has(i.id));
  // First fetch seeds historical context; do not call old transfers new activity.
  for (const i of newRows)
    x.transfers.unshift({
      ...i,
      wallet: w.address,
      at: now,
      historical: !w.checkedAt,
    });
  x.transfers = x.transfers.slice(0, 500);
  w.seen = [...new Set([...items.map((i) => i.id), ...known])].slice(0, 1000);
  w.status = result.truncated
    ? 'PARTIAL: more transfers than this scan window'
    : 'Latest provider window';
  w.checkedAt = now;
}
export function tradeLines(s, page = 'alerts', now = Date.now()) {
  const x = initTrading(s),
    lines = [];
  const stamp = (n) => new Date(n).toISOString().slice(5, 19).replace('T', ' ');
  if (page === 'alerts') {
    lines.push(
      'ALERTS / threshold crossings; local, app must run',
      ':alert liquidity>=20000,volume>50000',
      ':alert all change>10  | :unalert ID',
      ...x.rules.map(
        (r) =>
          `${r.id.slice(0, 8)} ${r.address === '*' ? 'ALL' : short(r.address)} ${r.conditions.map((c) => c.field + c.op + c.value).join(',')}`,
      ),
      '',
      'RECENT MATCHES',
      ...x.alerts.map((a) => `${stamp(a.at)} ${a.text}`),
    );
  } else if (page === 'changes') {
    lines.push(
      'CHANGES / persisted observations, not every trade',
      'Price >=3%; liquidity / rolling 24h volume >=10%',
      'Snapshot comparison across restarts; gaps may exist',
      ...x.changes.map((a) => `${stamp(a.at)} ${a.text}`),
    );
  } else if (page === 'wallets') {
    lines.push(
      'PUBLIC ADDRESSES / token transfers, not inferred trades',
      ':wallet 0x...  | :unwallet 0x...',
      ...x.wallets.map(
        (w) =>
          `${short(w.address)} ${w.checkedAt ? stamp(w.checkedAt) : 'not checked'} ${w.status || ''}`,
      ),
      '',
      'RECENT TRANSFERS (IN/OUT does not mean BUY/SELL)',
      ...x.transfers.map(
        (t) =>
          `${stamp(t.at)} ${t.historical ? 'HISTORY' : 'SEEN'} ${short(t.wallet)} ${t.direction} ${t.symbol} ${t.value} tx ${short(t.tx)}`,
      ),
    );
  } else {
    lines.push(
      `PAPER / virtual cash ${usd(x.balance)} / starts at $10,000`,
      ':paper USD STOP% TARGET% FEEbps SLIPbps',
      ':paper 100 10 20 30 50  | :close ID',
      ':size 100 30 50 (selected token; model only)',
      'Stops use observed spot moves; fills use observed price.',
      'No intrapoll highs/lows; no gas/tax/MEV in model.',
      '',
    );
    for (const p of [...x.paper].reverse())
      lines.push(
        `${p.id.slice(0, 8)} ${p.symbol} ${usd(p.amount)} SL ${p.stop}% TP ${p.target}%`,
        p.closedAt
          ? `  CLOSED ${p.reason} PnL ${usd(p.pnl)}`
          : `  ${p.status || 'OPEN'} net PnL ${Number.isFinite(p.mark) ? usd(p.mark - p.amount) : '--'} / ${p.markAt ? stamp(p.markAt) : 'unmarked'}`,
      );
  }
  return lines;
}
