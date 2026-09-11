import { validAddress } from './core.mjs';
const count = (n) => Number.isSafeInteger(n) && n >= 0;
const quote = (q) =>
  q &&
  validAddress(q.address) &&
  Number.isFinite(q.price) &&
  q.price > 0 &&
  typeof q.pair === 'string' &&
  q.pair.length > 0 &&
  count(q.observedAt);
export function validateState(s, demo) {
  if (!validTrading(s?.trading)) return false;
  if (
    !s ||
    s.version !== 1 ||
    s.demo !== demo ||
    !Array.isArray(s.tokens) ||
    s.tokens.length > 5000 ||
    !Array.isArray(s.games) ||
    s.games.length > 100 ||
    !s.watch ||
    typeof s.watch !== 'object' ||
    Array.isArray(s.watch)
  )
    return false;
  if (![s.cursor, s.start, s.lastScan].every((n) => n === null || count(n)))
    return false;
  if (s.cursor !== null && s.start !== null && s.start > s.cursor) return false;
  if (
    !s.tokens.every(
      (t) =>
        t &&
        validAddress(t.address) &&
        (!t.creator || validAddress(t.creator)) &&
        typeof t.name === 'string' &&
        typeof t.symbol === 'string' &&
        count(t.block) &&
        count(t.seenAt) &&
        (!t.market ||
          (typeof t.market === 'object' &&
            ['price', 'liquidity', 'volume', 'change', 'observedAt'].every(
              (k) => t.market[k] == null || Number.isFinite(t.market[k]),
            ))),
    )
  )
    return false;
  if (new Set(s.tokens.map((t) => t.address)).size !== s.tokens.length)
    return false;
  if (
    Object.keys(s.watch).length > 100 ||
    !Object.entries(s.watch).every(
      ([a, v]) =>
        validAddress(a) &&
        v &&
        typeof v === 'object' &&
        (v.price === null || Number.isFinite(v.price)),
    )
  )
    return false;
  return (
    s.games.filter((g) => !g?.result).length <= 1 &&
    s.games.every(
      (g) =>
        g &&
        typeof g.id === 'string' &&
        typeof g.symbol === 'string' &&
        validAddress(g.address) &&
        ['up', 'down'].includes(g.direction) &&
        quote(g.entry) &&
        g.entry.address === g.address &&
        count(g.due) &&
        (!g.result || ['won', 'lost', 'draw', 'void'].includes(g.result)) &&
        (!g.exit || quote(g.exit)),
    )
  );
}

export function validTrading(x) {
  if (x === undefined) return true;
  const array = (v, n) => Array.isArray(v) && v.length <= n;
  const num = (n) => Number.isFinite(n) && n >= 0;
  if (
    !x ||
    !num(x.balance) ||
    !array(x.rules, 50) ||
    !array(x.alerts, 300) ||
    !array(x.changes, 300) ||
    !array(x.wallets, 10) ||
    !array(x.transfers, 500) ||
    !array(x.paper, 200)
  )
    return false;
  if (
    !x.rules.every(
      (r) =>
        r &&
        typeof r.id === 'string' &&
        (r.address === '*' || validAddress(r.address)) &&
        array(r.conditions, 6) &&
        r.conditions.length &&
        r.conditions.every(
          (c) =>
            c &&
            ['price', 'liquidity', 'volume', 'change', 'buys'].includes(
              c.field,
            ) &&
            ['>', '>=', '<', '<='].includes(c.op) &&
            Number.isFinite(c.value),
        ) &&
        r.matches &&
        typeof r.matches === 'object' &&
        !Array.isArray(r.matches) &&
        Object.entries(r.matches).every(
          ([a, v]) => validAddress(a) && typeof v === 'boolean',
        ),
    )
  )
    return false;
  if (
    ![...x.alerts, ...x.changes].every(
      (a) =>
        a &&
        count(a.at) &&
        validAddress(a.address) &&
        typeof a.text === 'string',
    )
  )
    return false;
  if (
    !x.wallets.every(
      (w) =>
        w &&
        validAddress(w.address) &&
        array(w.seen, 1000) &&
        w.seen.every((v) => typeof v === 'string') &&
        (!w.checkedAt || count(w.checkedAt)),
    )
  )
    return false;
  if (
    !x.transfers.every(
      (t) =>
        t &&
        typeof t.id === 'string' &&
        typeof t.tx === 'string' &&
        validAddress(t.wallet) &&
        count(t.at) &&
        typeof t.symbol === 'string' &&
        typeof t.value === 'string' &&
        ['IN', 'OUT', 'SELF'].includes(t.direction),
    )
  )
    return false;
  return (
    x.paper.filter((p) => !p?.closedAt).length <= 20 &&
    x.paper.every(
      (p) =>
        p &&
        typeof p.id === 'string' &&
        validAddress(p.address) &&
        typeof p.symbol === 'string' &&
        typeof p.pair === 'string' &&
        ['amount', 'quantity', 'entryPrice', 'fill'].every(
          (k) => Number.isFinite(p[k]) && p[k] > 0,
        ) &&
        count(p.openedAt) &&
        p.stop >= 0.1 &&
        p.stop <= 95 &&
        p.target >= 0.1 &&
        p.target <= 10000 &&
        p.fee >= 0 &&
        p.fee <= 1000 &&
        p.slip >= 0 &&
        p.slip <= 5000 &&
        (!p.closedAt ||
          (count(p.closedAt) && num(p.proceeds) && Number.isFinite(p.pnl))),
    )
  );
}
