// Explainable activity filters, not a safety verdict or price prediction.
export function analyzeToken(t, tokens, now = Date.now()) {
  const m = t.market;
  const fresh =
    !!m &&
    Number.isFinite(m.observedAt) &&
    m.observedAt <= now &&
    now - m.observedAt < 120000;
  const checks = [
    {
      name: 'FRESH QUOTE',
      pass: fresh,
      detail: fresh ? 'Observed within 120 seconds' : 'Quote missing or stale',
    },
    {
      name: 'LIQUIDITY',
      pass: fresh && Number.isFinite(m.liquidity) ? m.liquidity >= 10000 : null,
      detail:
        fresh && Number.isFinite(m.liquidity)
          ? `$${Math.round(m.liquidity).toLocaleString('en-US')} / $10,000 threshold`
          : 'Unknown',
    },
    {
      name: 'ACTIVITY',
      pass:
        fresh && m.liquidity > 0 && Number.isFinite(m.volume)
          ? m.volume / m.liquidity >= 0.5
          : null,
      detail:
        fresh && m.liquidity > 0 && Number.isFinite(m.volume)
          ? `${(m.volume / m.liquidity).toFixed(2)}x 24h volume / liquidity`
          : 'Unknown',
    },
    {
      name: '24H MOVE',
      pass:
        fresh && Number.isFinite(m.change)
          ? m.change >= -15 && m.change <= 35
          : null,
      detail:
        fresh && Number.isFinite(m.change)
          ? `${m.change.toFixed(1)}% / -15% to +35% range`
          : 'Unknown',
    },
  ];
  const passed = checks.filter((c) => c.pass === true).length;
  return {
    address: t.address,
    symbol: t.symbol,
    score: fresh ? passed * 25 : null,
    verdict: !fresh ? 'WAIT' : passed === 4 ? 'WATCH' : 'REVIEW',
    checks,
    reason: !fresh
      ? 'Waiting for a fresh quote'
      : passed === 4
        ? 'All four activity filters match'
        : checks.find((c) => c.pass !== true)?.detail,
    creatorLaunches: t.creator
      ? tokens.filter((x) => x.creator === t.creator).length
      : null,
  };
}
export function updateEngine(state, now = Date.now()) {
  const engine = (state.engine ||= { events: [], history: {}, seq: 0 });
  const push = (kind, t, text) =>
    engine.events.unshift({
      id: ++engine.seq,
      at: now,
      kind,
      address: t?.address,
      symbol: t?.symbol || 'SYSTEM',
      text,
    });
  let changed = 0;
  for (const t of state.tokens.slice(0, 120)) {
    const m = t.market;
    if (!m || !Number.isFinite(m.price) || m.price <= 0) continue;
    const h = (engine.history[t.address] ||= []);
    const prev = h.at(-1);
    if (prev?.at === m.observedAt) continue;
    if (!prev) {
      push('NEW', t, 'First market quote in this session history');
      changed++;
    } else if (prev.price !== m.price || prev.liquidity !== m.liquidity) {
      push(
        'MOVE',
        t,
        `Price ${((m.price / prev.price - 1) * 100).toFixed(2)}% since prior observation; liquidity $${Math.round(m.liquidity || 0)}`,
      );
      changed++;
    }
    h.push({ at: m.observedAt, price: m.price, liquidity: m.liquidity });
    h.splice(0, Math.max(0, h.length - 60));
    const a = analyzeToken(t, state.tokens, now);
    if (t.activityVerdict !== a.verdict) {
      push('SCAN', t, `${a.verdict}: ${a.reason}`);
      t.activityVerdict = a.verdict;
    }
  }
  const keep = new Set(state.tokens.slice(0, 120).map((t) => t.address));
  for (const key of Object.keys(engine.history))
    if (!keep.has(key)) delete engine.history[key];
  engine.events.splice(150);
  engine.at = now;
  engine.changed = changed;
}
export function demoStep(state, now = Date.now()) {
  state.demoStep = (state.demoStep || 0) + 1;
  if (state.demoStep % 8 === 0 && state.tokens.length < 120) {
    const n = state.demoStep / 8,
      address = '0xd' + n.toString(16).padStart(39, '0');
    if (!state.tokens.some((t) => t.address === address))
      state.tokens.unshift({
        address,
        creator: '0x' + (100 + (n % 5)).toString(16).padStart(40, '0'),
        name: `Demo Patrol ${n}`,
        symbol: `CAT${n}`,
        block: 10000 + state.demoStep,
        seenAt: now,
        market: {
          price: 0.0002 * (1 + (n % 5)),
          liquidity: 12000 + n * 75,
          volume: 18000 + n * 100,
          change: 0,
          pair: 'demo-new-' + n,
          observedAt: now,
        },
      });
  }
  return state.tokens.map((t, i) => {
    if (!t.market) return t;
    const factor = 1 + Math.sin(state.demoStep * 0.63 + i * 1.7) * 0.004;
    return {
      ...t,
      market: {
        ...t.market,
        price: t.market.price * factor,
        liquidity: t.market.liquidity * (1 + (factor - 1) * 0.15),
        change: Math.max(
          -99,
          Math.min(200, (t.market.change || 0) + (factor - 1) * 100),
        ),
        volume: t.market.volume + Math.abs(factor - 1) * 500,
        observedAt: now,
      },
    };
  });
}
