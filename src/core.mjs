export const validAddress = (a) =>
  typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a);
// Provider strings must never be interpreted as terminal controls (including OSC).
export const clean = (v, n = 120) =>
  String(v ?? '')
    .replace(/[^\x20-\x7e]/g, '')
    .slice(0, n);
export const normalize = (s) =>
  String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
export const short = (a) => (a ? `${a.slice(0, 8)}..${a.slice(-4)}` : '--');
export const usd = (n) =>
  !Number.isFinite(n)
    ? '--'
    : n === 0
      ? '$0'
      : Math.abs(n) < 0.001
        ? '$' + n.toPrecision(3)
        : '$' +
          (Math.abs(n) >= 1e6
            ? (n / 1e6).toFixed(2) + 'm'
            : Math.abs(n) >= 1e3
              ? (n / 1e3).toFixed(1) + 'k'
              : n.toFixed(3));
export const pct = (n) =>
  !Number.isFinite(n) ? '--' : `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;
export function clones(tokens) {
  const result = [];
  for (let i = 0; i < tokens.length && result.length < 150; i++)
    for (let j = i + 1; j < tokens.length && result.length < 150; j++) {
      const a = tokens[i],
        b = tokens[j],
        an = normalize(a.name),
        bn = normalize(b.name),
        as = normalize(a.symbol),
        bs = normalize(b.symbol);
      const reason =
        as && as === bs
          ? 'same ticker'
          : an && an !== 'unresolved' && an === bn
            ? 'same name'
            : an !== 'unresolved' &&
                bn !== 'unresolved' &&
                Math.min(an.length, bn.length) >= 5 &&
                Math.abs(an.length - bn.length) <= 3 &&
                (an.startsWith(bn) || bn.startsWith(an))
              ? 'similar name'
              : null;
      if (reason)
        result.push({
          a: a.block <= b.block ? a : b,
          b: a.block <= b.block ? b : a,
          reason,
        });
    }
  return result;
}
export function summary(tokens, now = Date.now()) {
  const d = new Date(now),
    start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const today = tokens.filter((t) => t.seenAt >= start && t.seenAt <= now),
    priced = tokens.filter((t) => Number.isFinite(t.market?.change)),
    up = priced.filter((t) => t.market.change > 0).length,
    down = priced.filter((t) => t.market.change < 0).length;
  const names = new Map();
  for (const t of today) {
    const name = normalize(t.name);
    if (name && name !== 'unresolved')
      names.set(name, (names.get(name) || 0) + 1);
  }
  return {
    today: today.length,
    priced: priced.length,
    up,
    down,
    flat: priced.length - up - down,
    weather:
      priced.length < 5
        ? 'INSUFFICIENT DATA'
        : up / priced.length >= 0.65
          ? 'SUNNY'
          : down / priced.length >= 0.65
            ? 'STORMY'
            : 'MIXED SKIES',
    names: [...names].sort((a, b) => b[1] - a[1]).slice(0, 6),
    hours: Array.from(
      { length: 24 },
      (_, i) =>
        today.filter((t) => Math.floor((t.seenAt - start) / 3600000) === i)
          .length,
    ),
  };
}
export function settle(g, q, now = Date.now()) {
  if (g.result || now < g.due) return g;
  if (
    q &&
    q.address === g.address &&
    q.pair === g.entry.pair &&
    Number.isFinite(q.price) &&
    q.price > 0 &&
    q.observedAt >= g.due &&
    q.observedAt <= g.due + 120000 &&
    q.observedAt <= now
  )
    return {
      ...g,
      exit: q,
      result:
        q.price === g.entry.price
          ? 'draw'
          : (q.price > g.entry.price ? 'up' : 'down') === g.direction
            ? 'won'
            : 'lost',
    };
  return now > g.due + 120000 ? { ...g, result: 'void' } : g;
}
export function daily(state, now = Date.now()) {
  const s = summary(state.tokens, now);
  return [
    `SHERIFF DAILY | ${new Date(now).toISOString().slice(0, 10)} UTC`,
    state.demo ? 'DEMO / SIMULATED DATA' : 'LIVE PROVIDER OBSERVATIONS',
    `${s.today} first observed today; ${state.tokens.length} retained locally.`,
    `${s.up} UP / ${s.down} DOWN / ${s.priced} with stored 24h moves.`,
    ...s.names.map(([n, c]) => `NAME ${clean(n)}: ${c}`),
    'Most active (stored 24h volume):',
    ...state.tokens
      .filter((t) => Number.isFinite(t.market?.volume))
      .sort((a, b) => b.market.volume - a.market.volume)
      .slice(0, 5)
      .map((t) => `${clean(t.symbol)} ${usd(t.market.volume)}`),
    'Largest stored 24h moves:',
    ...state.tokens
      .filter((t) => Number.isFinite(t.market?.change))
      .sort((a, b) => Math.abs(b.market.change) - Math.abs(a.market.change))
      .slice(0, 5)
      .map((t) => `${clean(t.symbol)} ${pct(t.market.change)}`),
    `Scanned through block ${state.cursor ?? 'unknown'}; start ${state.start ?? 'unknown'}.`,
    `Last successful scan ${state.lastScan ? new Date(state.lastScan).toISOString() : 'unknown'}.`,
    'Observed sample only. Prices may lag; names are not safety verdicts.',
    'SHERIFF CAT / SMALL CAT. BIG CLUES.',
  ].join('\n');
}
