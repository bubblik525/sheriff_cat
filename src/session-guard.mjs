import { sellValue } from './trading.mjs';

export function guard(state, now = Date.now(), heartbeat = false) {
  const g = (state.sessionGuard ||= {
    elapsed: 0,
    last: 0,
    minutes: 45,
    loss: 5,
    rest: 10,
    until: 0,
    reason: '',
    peak: null,
  });
  let equity = state.trading.balance;
  for (const p of state.trading.paper.filter((p) => !p.closedAt)) {
    const m = state.tokens.find((t) => t.address === p.address)?.market;
    try {
      equity += sellValue(p, m?.pair === p.pair ? m : p.lastQuote, now);
    } catch {
      equity = null;
      break;
    }
  }
  if (heartbeat) {
    if (!g.reason && g.last && now - g.last <= 30000)
      g.elapsed += Math.max(0, now - g.last);
    g.last = now;
  }
  if (equity !== null) g.peak = Math.max(g.peak ?? equity, equity);
  const drawdown =
    equity !== null && g.peak > 0
      ? Math.max(0, ((g.peak - equity) / g.peak) * 100)
      : null;
  if (
    !g.reason &&
    (g.elapsed >= g.minutes * 60000 ||
      (drawdown !== null && drawdown >= g.loss))
  ) {
    g.reason =
      g.elapsed >= g.minutes * 60000
        ? 'Session time limit reached'
        : 'Paper equity drawdown limit reached';
    g.until = now + g.rest * 60000;
  }
  return {
    ...g,
    equity,
    drawdown,
    locked: !!g.reason,
    remaining: Math.max(0, g.until - now),
  };
}
export function guardAction(state, body, now = Date.now()) {
  const view = guard(state, now, body.type === 'heartbeat');
  const g = state.sessionGuard;
  if (body.type === 'guard-settings') {
    if (view.locked)
      throw Error('Finish your break before changing session limits.');
    const minutes = Number(body.minutes),
      loss = Number(body.loss),
      rest = Number(body.rest);
    if (
      ![minutes, loss, rest].every(Number.isFinite) ||
      minutes < 1 ||
      minutes > 180 ||
      loss < 0.1 ||
      loss > 50 ||
      rest < 1 ||
      rest > 60
    )
      throw Error(
        'Use 1–180 session minutes, 0.1–50% drawdown and 1–60 break minutes.',
      );
    Object.assign(g, { minutes, loss, rest });
  }
  if (body.type === 'break' && !view.locked)
    Object.assign(g, {
      reason: 'A little breathing room',
      until: now + g.rest * 60000,
    });
  if (body.type === 'resume') {
    if (view.remaining > 0)
      throw Error(
        'Your break is still running. Research and closing positions remain available.',
      );
    Object.assign(g, {
      reason: '',
      until: 0,
      elapsed: 0,
      last: now,
      peak: view.equity,
    });
  }
  if (['paper', 'guess'].includes(body.type) && guard(state, now).locked)
    throw Error(
      'Time for a little break. New practice entries are paused; you can still close positions.',
    );
}
