// Deterministic pet rules. Token quantity grants access; XP never grants access.
export const TIERS = [
  { name: 'Scout', watch: 5, rules: 3, compare: 2, fish: 3 },
  { name: 'Deputy', watch: 15, rules: 10, compare: 3, fish: 5 },
  { name: 'Sheriff', watch: 40, rules: 25, compare: 5, fish: 8 },
  { name: 'Marshal', watch: 100, rules: 50, compare: 8, fish: 12 },
];
export function units(value, decimals) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36)
    throw Error('Unsupported token decimals');
  const match = String(value).match(/^(\d+)(?:\.(\d+))?$/);
  if (!match || (match[2]?.length || 0) > decimals)
    throw Error('Invalid token quantity');
  return BigInt(match[1] + (match[2] || '').padEnd(decimals, '0'));
}
export function quantity(raw, decimals) {
  const digits = BigInt(raw)
    .toString()
    .padStart(decimals + 1, '0');
  return decimals
    ? (digits.slice(0, -decimals) + '.' + digits.slice(-decimals)).replace(
        /\.?0+$/,
        '',
      )
    : digits;
}
export function tierFor(raw, decimals, thresholds) {
  if (!Array.isArray(thresholds) || thresholds.length !== 3)
    throw Error('Configure exactly three token thresholds');
  const values = thresholds.map((t) => units(t, decimals));
  if (values[0] <= 0n || values.some((v, i) => i && v <= values[i - 1]))
    throw Error('Thresholds must be positive and increasing');
  return values.filter((v) => BigInt(raw) >= v).length;
}
export function accessFor(check, now = Date.now()) {
  const current =
    check?.at <= now &&
    now - check.at <= 300000 &&
    Number.isInteger(check.tier) &&
    check.tier >= 0 &&
    check.tier < 4;
  const tier = current ? check.tier : 0;
  return { ...TIERS[tier], tier, current: !!current };
}
const day = (now) => new Date(now).toISOString().slice(0, 10);
export function initPet(s, now = Date.now()) {
  s.pet ??= {
    name: 'Miso',
    xp: 0,
    fish: 3,
    mood: 65,
    updatedAt: now,
    events: {},
    daily: { date: day(now), xp: 0 },
    journal: [],
    outfit: 'classic',
  };
  return s.pet;
}
export function petView(s, now = Date.now()) {
  const p = initPet(s, now);
  const mood = Math.max(
    20,
    Math.round(p.mood - (Math.max(0, now - p.updatedAt) / 3600000) * 2),
  );
  return {
    ...p,
    mood,
    level: 1 + Math.floor(p.xp / 100),
    progress: p.xp % 100,
    moodLabel: mood >= 80 ? 'Playful' : mood >= 45 ? 'Curious' : 'Sleepy',
  };
}
export function reward(s, kind, id, now = Date.now()) {
  const p = initPet(s, now);
  if (p.daily.date !== day(now)) p.daily = { date: day(now), xp: 0 };
  const key = `${day(now)}:${kind}:${id}`;
  if (p.events[key]) return false;
  const values = {
    investigate: 25,
    compare: 15,
    review: 20,
    play: 5,
    feed: 5,
    daily: 10,
  };
  if (!(kind in values)) throw Error('Unknown task');
  const earned = Math.max(0, Math.min(values[kind], 100 - p.daily.xp));
  p.xp += earned;
  p.daily.xp += earned;
  p.events[key] = now;
  p.journal.unshift({ at: now, kind, xp: earned });
  p.journal = p.journal.slice(0, 100);
  p.events = Object.fromEntries(
    Object.entries(p.events).filter(([, at]) => now - at < 172800000),
  );
  return true;
}
export function care(s, action, tier = 0, now = Date.now()) {
  const p = initPet(s, now),
    current = petView(s, now);
  if (action === 'daily') {
    if (!reward(s, 'daily', 'claim', now))
      throw Error('Today’s fish already collected. Resets at 00:00 UTC.');
    p.fish += TIERS[tier].fish;
  } else if (action === 'feed' || action === 'play') {
    if (action === 'feed' && p.fish < 1)
      throw Error('No fish left. Collect your daily fish.');
    if (!reward(s, action, String(Math.floor(now / 60000)), now))
      throw Error('Let your cat rest for a minute.');
    if (action === 'feed') p.fish--;
    p.mood = Math.min(100, current.mood + (action === 'feed' ? 15 : 8));
    p.updatedAt = now;
  } else throw Error('Unknown care action');
  return petView(s, now);
}
export function clue(s, now = Date.now()) {
  const alert = s.trading?.alerts?.[0];
  if (alert && now - alert.at < 300000) return alert.text;
  const change = s.trading?.changes?.[0];
  if (change) return change.text;
  return s.tokens.length
    ? `I’m watching ${s.tokens.length} observed launches. Pick a token and I’ll gather the evidence.`
    : 'Ready for patrol. Add your personal API key to start observing launches.';
}
