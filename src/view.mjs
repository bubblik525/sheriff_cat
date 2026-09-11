import { clean, short, usd, pct, summary, clones } from './core.mjs';
import { tradeLines } from './trading.mjs';
export const TABS = [
  'RADAR',
  'DEV COUNTER',
  'WATCHLIST',
  'WEATHER',
  'CLONES',
  'GUESS MOVE',
  'DAILY',
  'RESEARCH',
];
const tones = {
  normal: '\x1b[38;2;199;215;210m',
  dim: '\x1b[38;2;107;132;129m',
  bright: '\x1b[38;2;238;245;240m',
  green: '\x1b[38;2;140;193;164m',
  red: '\x1b[38;2;209;144;142m',
  gold: '\x1b[38;2;203;185;137m',
  select: '\x1b[48;2;27;46;41m\x1b[38;2;229;242;234m',
};
const fit = (s, w) =>
  clean(s, 10000).slice(0, Math.max(0, w)).padEnd(Math.max(0, w));
export function tokenRows(app) {
  const state = app.state;
  let rows =
    app.tab === 2
      ? state.tokens.filter((t) => state.watch[t.address])
      : app.tab === 1
        ? state.tokens.filter(
            (t) => app.devCreator && t.creator === app.devCreator,
          )
        : state.tokens;
  return rows.filter((t) =>
    `${t.name} ${t.symbol} ${t.address}`
      .toLowerCase()
      .includes(app.filter.toLowerCase()),
  );
}
export function selected(app) {
  if (app.tab === 7 && app.tradePick)
    return app.state.tokens.find((t) => t.address === app.tradePick) || null;
  if (app.tab === 5 && app.gamePick)
    return app.state.tokens.find((t) => t.address === app.gamePick) || null;
  if (app.tab === 4)
    return clones(app.state.tokens.slice(0, 500))[app.index]?.a || null;
  const rows = tokenRows(app);
  return rows[Math.min(app.index, rows.length - 1)] || null;
}
export function render(app, width = 120, height = 38, color = true) {
  const out = [],
    s = app.state,
    now = Date.now(),
    sum = summary(s.tokens),
    rows = tokenRows(app),
    pick = selected(app),
    p = (text, tone = 'normal') => ({ text, tone });
  const add = (text, tone) => out.push(p(text, tone));
  if (width < 76 || height < 24) {
    add(
      'SHERIFF CAT / Make this terminal at least 76 columns x 24 rows.',
      'bright',
    );
    add(`Current: ${width} x ${height}. Resize window, or press Q to quit.`);
    return paint(out, width, height, color);
  }
  const logo = [
    ' ____  _   _ _____ ____  ___ _____ _____    ____    _  _____',
    '/ ___|| | | | ____|  _ \\|_ _|  ___|  ___|  / ___|  / \\|_   _|',
    '\\___ \\| |_| |  _| | |_) || || |_  | |_    | |     / _ \\ | |',
    ' ___) |  _  | |___|  _ < | ||  _| |  _|   | |___ / ___ \\| |',
    '|____/|_| |_|_____|_| \\_\\___|_|   |_|      \\____/_/   \\_\\_|',
  ];
  const cat = [
    '      __/\\__      ',
    '    _/  *   \\_    ',
    '   /__________\\   ',
    '    /\\ o  o /\\__  ',
    '   (___=^=___)  ) ',
    '    /| |  | |\\_/  ',
    '    (_|_)(_|_)    ',
  ];
  add(
    ` + SHERIFF CAT / FIELD TERMINAL 001${' '.repeat(Math.max(1, width - 78))}${s.demo ? 'DEMO / SIMULATED' : 'ROBINHOOD CHAIN / 4663'}`,
    'dim',
  );
  if (Math.floor(now / 1000) % 8 === 0) cat[3] = cat[3].replace('o  o', '-  -');
  const compact = height < 34;
  if (compact) add(' SHERIFF CAT / * LOCAL PATROL *', 'bright');
  for (let i = 0; i < (compact ? 0 : 6); i++)
    add(
      fit(logo[i] || '', Math.min(66, width - 23)) + fit(cat[i + 1], 20),
      'bright',
    );
  add(
    ` ${s.demo ? 'DEMO DATA' : app.status} | ${s.tokens.length} retained | block ${s.cursor ?? '--'} | ${Object.keys(s.watch).length} watched | ${app.calls || 0} provider calls`,
    'green',
  );
  add(
    ` Last scan: ${s.lastScan ? Math.floor((now - s.lastScan) / 1000) + 's ago' : 'none'} | 12-block confirmation lag | ${app.paused ? 'SCAN PAUSED' : 'poll 8s'} | prices may lag`,
    'dim',
  );
  add('-'.repeat(width), 'dim');
  add(
    (width < 110
      ? ['RADAR', 'DEV', 'WATCH', 'WEATHER', 'CLN', 'GAME', 'DAY', 'DESK']
      : TABS
    )
      .map(
        (t, i) =>
          `${i === app.tab ? '[' : ' '}${i + 1} ${t}${i === app.tab ? ']' : ' '}`,
      )
      .join(' '),
    'bright',
  );
  const leftWidth = width >= 106 ? Math.floor(width * 0.66) : width - 2,
    rightWidth = width - leftWidth - 3,
    split = width >= 106,
    bodyHeight = height - (compact ? 10 : 15),
    left = [],
    right = [];
  const l = (text, tone = 'normal') => left.push(p(text, tone)),
    r = (text, tone = 'normal') => right.push(p(text, tone));
  l(
    ` ${TABS[app.tab]} / ${app.tab === 7 ? (app.tradePage || 'alerts').toUpperCase() : app.filter ? 'FILTER: ' + app.filter : 'FIELD OBSERVATIONS'}`,
    'green',
  );
  if (app.showReport && app.report) {
    l(' CASE FILE / ESC to return', 'bright');
    const wrapped = app.report.lines.flatMap((x) => {
      const parts = [];
      const text = clean(x, 1000);
      for (let n = 0; n < text.length; n += leftWidth - 3)
        parts.push(text.slice(n, n + leftWidth - 3));
      return parts;
    });
    wrapped.slice(app.detailScroll || 0).forEach((x) => l(' ' + x));
    l(' UP/DOWN scroll evidence / ESC return', 'dim');
  } else if (app.help) {
    [
      'KEYBOARD / NO MOUSE NEEDED',
      '',
      '1..8           Switch desk',
      ':              Research command (examples on desk 8)',
      'Left/Right     Research subpage (desk 8)',
      'Up/Down, j/k   Select token / scroll desk',
      'PgUp/PgDn      Jump ten rows',
      '/              Filter tokens (Enter applies)',
      'd              Paste token contract -> trace creator',
      'Enter / i      Inspect selected token',
      'Space / w      Toggle watchlist',
      'u / n          Predict higher / lower (desk 6)',
      'e              Export daily text + JSON to data folder',
      'r              Refresh scan',
      'p              Pause collection',
      '?              Show / hide help',
      'q / Ctrl-C     Save and quit',
      'Ctrl-U         Clear current input',
      'Esc            Close help / evidence',
      '',
      'No wallet connection. No signing. No trades.',
      'Keys are kept in memory; not written to disk.',
      'Unknown evidence is never a safe verdict.',
    ]
      .slice(app.detailScroll || 0)
      .forEach((x) => l(x));
  } else if (app.tab === 7) {
    l(' < ALERTS | CHANGES | WALLETS | PAPER >', 'bright');
    l(' Left/right switch; : command; up/down scroll', 'dim');
    tradeLines(s, app.tradePage || 'alerts')
      .slice(app.index)
      .forEach((x) => l(' ' + x));
  } else if (app.tab === 0 || app.tab === 1 || app.tab === 2) {
    if (app.tab === 1) {
      l(' Paste a TOKEN address with D to trace its creator.', 'dim');
      l(` Creator: ${app.devCreator || 'not selected'}`);
      l(` ${rows.length} matching launches in local retained history.`, 'gold');
    }
    l(
      fit(' TOKEN', 19) +
        fit('PRICE', 13) +
        fit(app.tab === 2 ? 'SINCE OPEN' : '24H', 10) +
        fit('LIQUIDITY', 13) +
        'BLOCK',
      'dim',
    );
    const limit = bodyHeight - left.length - 1,
      start = Math.max(0, app.index - limit + 1);
    rows.slice(start, start + limit).forEach((t, i) => {
      const baseline = app.baseline[t.address]?.price,
        move =
          app.tab === 2
            ? baseline && t.market?.price
              ? (t.market.price / baseline - 1) * 100
              : null
            : t.market?.change;
      l(
        `${stateStar(s, t)} ${fit(t.symbol === '?' ? short(t.address) : t.symbol, 16)}${fit(usd(t.market?.price), 13)}${fit(pct(move), 10)}${fit(usd(t.market?.liquidity), 13)}${t.block}`,
        start + i === app.index ? 'select' : 'normal',
      );
    });
    if (!rows.length)
      l(' No matching records. / clears or changes the filter.', 'dim');
  } else if (app.tab === 3) {
    l('');
    l('          .--.        MEME WEATHER', 'bright');
    l('       .-(    ).');
    l('      (___.__)__)');
    l('');
    l(` ${sum.weather}`, 'bright');
    l('');
    l(` ${sum.up} UP     ${sum.down} DOWN     ${sum.flat} FLAT`, 'green');
    l(` ${sum.priced}/${s.tokens.length} records have stored 24h changes.`);
    l('');
    l(' Sunny/stormy: >=65% up/down; at least 5 readings.', 'dim');
    l(' Descriptive sample, not a forecast or trust rating.', 'gold');
  } else if (app.tab === 4) {
    const pairs = clones(s.tokens.slice(0, 500));
    l(` ${pairs.length} matches / latest 500 records / max 150 pairs`, 'dim');
    l(' Similar names are NOT proof of fraud.', 'gold');
    pairs
      .slice(app.index, app.index + bodyHeight - 5)
      .forEach((c) =>
        l(
          ` ${fit(c.a.symbol, 12)} ${short(c.a.address)} -> ${short(c.b.address)} / ${c.reason}`,
        ),
      );
    if (!pairs.length) l(' No matches in the observed sample.');
    l(' Order: block number; same-block order unknown.', 'dim');
  } else if (app.tab === 5) {
    const active = s.games.find((g) => !g.result),
      wins = s.games.filter((g) => g.result === 'won').length;
    let streak = 0;
    for (const g of [...s.games].reverse()) {
      if (!g.result || g.result === 'draw' || g.result === 'void') continue;
      if (g.result !== 'won') break;
      streak++;
    }
    l('');
    l(' FIVE MINUTES. ONE INSTINCT.', 'bright');
    l(` Selected: ${pick?.symbol ?? 'choose a token in Radar'}`);
    l('');
    l(` ${wins * 100} POINTS    ${streak} WIN STREAK`, 'green');
    l('');
    if (active) {
      l(
        ` LOCKED: ${active.symbol} / ${active.direction.toUpperCase()}`,
        'gold',
      );
      l(
        ` Entry ${usd(active.entry.price)} | ${Math.max(0, Math.ceil((active.due - now) / 1000))}s remaining`,
      );
      l(' Settlement grace window: 120s; keep this app open.', 'dim');
    } else {
      l(' [U] HIGHER                 [N] LOWER', 'bright');
      l(' A fresh observed price locks your five-minute round.', 'dim');
    }
    l('');
    l(' No stakes. No cash. Local points, not a public ranking.', 'gold');
    l(' Same pool required. Missing quotes void the round.', 'dim');
    [...s.games]
      .reverse()
      .slice(0, Math.max(0, bodyHeight - left.length - 1))
      .forEach((g) =>
        l(
          ` ${fit(g.symbol, 12)} ${fit(g.direction, 6)} ${fit(g.result || 'PENDING', 9)} ${usd(g.entry.price)} -> ${usd(g.exit?.price)}`,
          g.result === 'won' ? 'green' : g.result === 'lost' ? 'red' : 'normal',
        ),
      );
  } else {
    l('');
    l(' THE DAILY PAWPRINT.', 'bright');
    l(` ${new Date(now).toISOString().slice(0, 10)} UTC`, 'dim');
    l('');
    l(` ${sum.today} NEW OBSERVATIONS TODAY`, 'green');
    l('');
    l(' UTC HOUR / LAUNCH OBSERVATIONS', 'dim');
    const max = Math.max(1, ...sum.hours);
    l(
      ' ' +
        sum.hours.map((n) => ' .:-=+*#%@'[Math.round((n / max) * 9)]).join(' '),
      'green',
    );
    l(' 00:00 UTC                              23:00 UTC', 'dim');
    l('');
    sum.names.forEach(([n, c]) => l(` ${fit(n, 24)} ${c}`));
    l('');
    l(' [E] Export the full dispatch as TXT + JSON', 'bright');
    l(' Local retained sample only; stored market readings.', 'dim');
  }
  r(' SELECTED / CASE FILE', 'green');
  r('');
  r(` ${pick?.symbol ?? 'NO TOKEN SELECTED'}`, 'bright');
  r(` ${pick?.name ?? 'Select a row in Radar'}`);
  r('');
  r(` ${pick ? short(pick.address) : ''}`, 'dim');
  r(` Creator ${short(pick?.creator)}`);
  r(` Price   ${usd(pick?.market?.price)}`);
  r(` Liq     ${usd(pick?.market?.liquidity)}`);
  r(` Move    ${pct(pick?.market?.change)}`);
  r(
    ` Quote   ${pick?.market?.observedAt ? Math.floor((now - pick.market.observedAt) / 1000) + 's ago' : 'unknown'}`,
    'dim',
  );
  r('');
  if (app.report && pick && app.report.address === pick.address) {
    app.report.lines.forEach((x) => r(' ' + x));
    r(' [ENTER] Refresh evidence', 'dim');
  } else {
    r(' [ENTER] Investigate', 'bright');
    r(' No automatic safety verdict.', 'gold');
    r(' [W] Add/remove watch', 'dim');
  }
  r('');
  r(' SESSION / EVENT LOG', 'green');
  app.events
    .slice(-5)
    .reverse()
    .forEach((e) => r(' ' + e, 'dim'));
  for (let i = 0; i < bodyHeight; i++) {
    const a = left[i] || p(''),
      b = right[i] || p('');
    if (split)
      out.push({
        text: fit(a.text, leftWidth) + ' | ' + fit(b.text, rightWidth),
        tone: a.tone,
        right: b.tone,
        leftWidth,
      });
    else out.push(a);
  }
  add('-'.repeat(width), 'dim');
  add(
    app.input
      ? ` > ${app.input.kind === 'command' ? 'COMMAND' : app.input.kind === 'dev' ? 'CONTRACT' : 'FILTER'}: ${app.input.value}_`
      : ` ${clean(app.message || 'SMALL CAT. BIG CLUES.')} `,
    app.error ? 'red' : 'gold',
  );
  add(
    ' 1-8 desks  : command  / filter  Enter dossier  W watch  ? help  Q quit',
    'dim',
  );
  return paint(out, width, height, color);
}
function stateStar(s, t) {
  return s.watch[t.address] ? '*' : ' ';
}
function paint(lines, width, height, color) {
  return lines
    .slice(0, height)
    .map((l) => {
      const text = fit(l.text, width);
      if (!color) return text;
      if (l.right)
        return (
          tones[l.tone] +
          text.slice(0, l.leftWidth) +
          tones.dim +
          ' | ' +
          tones[l.right] +
          text.slice(l.leftWidth + 3) +
          '\x1b[0m\x1b[48;2;7;12;13m'
        );
      return (
        (tones[l.tone] || tones.normal) + text + '\x1b[0m\x1b[48;2;7;12;13m'
      );
    })
    .join('\r\n');
}
