#!/usr/bin/env node
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import readline from 'node:readline';
import { storage, blank } from '../src/storage.mjs';
import { Provider } from '../src/provider.mjs';
import { clean, validAddress, settle, daily, clones } from '../src/core.mjs';
import { render, selected, tokenRows } from '../src/view.mjs';
import {
  initTrading,
  addRule,
  observe,
  estimate,
  openPaper,
  closePaper,
  markPaper,
  walletRecords,
} from '../src/trading.mjs';
import { demoTokens } from '../src/demo.mjs';
const args = process.argv.slice(2),
  has = (s) => args.includes(s);
if (has('--help') || has('-h')) {
  console.log(`SHERIFF CAT / standalone read-only field terminal

  node bin/sheriff.mjs                  Start; enter your Blockscout PRO key
  node bin/sheriff.mjs --demo           Offline, clearly labeled sample data
  node bin/sheriff.mjs --demo --snapshot Print the demo without interactive UI
  node bin/sheriff.mjs --doctor         Verify your key, chain and market source
  node bin/sheriff.mjs --data-dir PATH  Use a separate local archive

Requires Node.js 22+. No npm dependencies. No wallet or signing.
Get a personal API key at https://dev.blockscout.com/
Optional environment variable: BLOCKSCOUT_API_KEY (never printed or saved).
Controls: 1-8 tabs, : command (desk 8 Research), arrows/j/k select, / filter, D creator, Enter inspect,
W watch, U/N predict, E export, P pause, R refresh, ? help, Q quit.
Default data: ~/.sheriff-cat (demo uses a separate file).
`);
  process.exit(0);
}
const allowed = new Set(['--demo', '--snapshot', '--doctor', '--data-dir']);
for (let i = 0; i < args.length; i++) {
  if (!allowed.has(args[i])) {
    console.error('Unknown option. Use --help.');
    process.exit(1);
  }
  if (args[i] === '--data-dir' && !args[++i]) {
    console.error('--data-dir requires a path');
    process.exit(1);
  }
}
if (Number(process.versions.node.split('.')[0]) < 22) {
  console.error('Node.js 22 or newer is required.');
  process.exit(1);
}
const demo = has('--demo'),
  snapshot = has('--snapshot');
if (snapshot && !demo) {
  console.error('--snapshot requires --demo. It never impersonates live data.');
  process.exit(1);
}
if (snapshot) {
  const state = {
    ...blank(true),
    tokens: demoTokens(),
    cursor: 10000,
    start: 9900,
    lastScan: Date.now(),
  };
  console.log(
    render(
      {
        state,
        tab: 0,
        index: 0,
        filter: '',
        baseline: {},
        status: 'DEMO',
        events: [],
        message: 'DEMO / SIMULATED DATA - No network calls',
        calls: 0,
      },
      120,
      38,
      false,
    ),
  );
  process.exit(0);
}
if (
  (!process.stdin.isTTY || !process.stdout.isTTY) &&
  !(has('--doctor') && process.env.BLOCKSCOUT_API_KEY)
) {
  console.error('Open an interactive terminal, or use --demo --snapshot.');
  process.exit(1);
}
readline.emitKeypressEvents(process.stdin);
async function promptKey() {
  if (process.env.BLOCKSCOUT_API_KEY)
    return process.env.BLOCKSCOUT_API_KEY.trim();
  process.stdout.write(
    '\n  SHERIFF CAT / PERSONAL DATA ACCESS\n  Create an API key: https://dev.blockscout.com/\n  No wallet private keys. Input is hidden and not saved.\n\n  Blockscout PRO key: ',
  );
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let input = '';
    const end = () => {
      process.stdin.off('keypress', onKey);
      process.stdin.setRawMode(false);
      process.stdout.write('\n');
    };
    const onKey = (str, k) => {
      if (k.ctrl && k.name === 'c') {
        end();
        reject(Error('Cancelled'));
      } else if (k.name === 'return') {
        end();
        resolve(input.trim());
      } else if (k.name === 'backspace') {
        input = input.slice(0, -1);
      } else if (str && !k.ctrl && !k.meta) {
        input = (input + str.replace(/[^\x21-\x7e]/g, '')).slice(0, 256);
      }
    };
    process.stdin.on('keypress', onKey);
  });
}
let store,
  provider,
  restored = false,
  timer,
  drawTimer,
  closing = false,
  inFlight = null;
function restore() {
  if (restored) return;
  restored = true;
  clearInterval(timer);
  clearInterval(drawTimer);
  process.stdin.setRawMode?.(false);
  process.stdout.write('\x1b[0m\x1b[?25h\x1b[?1049l');
  process.stdin.pause();
}
async function main() {
  if (!demo) {
    const key = await promptKey();
    if (!/^proapi_[A-Za-z0-9_-]{20,240}$/.test(key))
      throw Error('Expected a Blockscout PRO API key.');
    provider = new Provider(key);
    process.stdout.write('  Verifying API key and chain...\n');
    await provider.connect();
    if (has('--doctor')) {
      await provider.markets(['0xb06b1e58f5ba2a3df1ab74c01cb2a44c5395b3be']);
      console.log(
        '  PASS: Blockscout authentication, Robinhood Chain 4663, DEX market response.',
      );
      process.stdin.pause();
      return;
    }
  }
  const di = args.indexOf('--data-dir'),
    dir = di >= 0 ? resolve(args[di + 1]) : join(homedir(), '.sheriff-cat');
  store = await storage(dir, demo);
  const state = store.state;
  initTrading(state);
  if (demo && !state.tokens.length) state.tokens = demoTokens();
  const app = {
    state,
    tab: 0,
    tradePage: 'alerts',
    index: 0,
    filter: '',
    baseline: structuredClone(state.watch),
    devCreator: null,
    report: null,
    status: demo ? 'DEMO / OFFLINE' : 'CONNECTED',
    events: [],
    message: demo
      ? 'DEMO / SIMULATED DATA - no provider calls'
      : 'Personal API connected. Preparing local archive...',
    calls: 0,
    paused: false,
    help: false,
    input: null,
    error: false,
  };
  const event = (s) => {
    app.events.push(`${new Date().toISOString().slice(11, 19)} ${clean(s)}`);
    app.events = app.events.slice(-30);
  };
  const message = (s, error = false) => {
    app.message = clean(s, 500);
    app.error = error;
    event(s);
  };
  const draw = () => {
    if (closing) return;
    app.calls = provider?.calls || 0;
    process.stdout.write(
      '\x1b[H\x1b[48;2;7;12;13m' +
        render(app, process.stdout.columns || 120, process.stdout.rows || 38) +
        '\x1b[J',
    );
  };
  async function work(fn) {
    if (inFlight || closing) {
      message('A request is still running. Please wait.');
      return;
    }
    inFlight = (async () => {
      try {
        const lastAlert = state.trading.alerts[0];
        await fn();
        if (state.trading.alerts[0] && state.trading.alerts[0] !== lastAlert)
          message('ALERT: ' + state.trading.alerts[0].text);
        await store.save(state);
      } catch (e) {
        message(e.message, true);
      }
    })();
    await inFlight;
    inFlight = null;
    draw();
  }
  async function tick() {
    if (inFlight || closing) return;
    await work(async () => {
      const active = state.games.find((g) => !g.result);
      if (active && Date.now() >= active.due) {
        let q = null;
        if (Date.now() <= active.due + 120000) {
          try {
            q = demo
              ? {
                  ...active.entry,
                  observedAt: Date.now(),
                  price: active.entry.price * 1.03,
                }
              : await provider.quote(active.address);
          } catch {}
        }
        const settled = settle(active, q);
        state.games = state.games.map((g) =>
          g.id === active.id ? settled : g,
        );
        if (settled.result)
          event(`ROUND ${settled.result.toUpperCase()} ${active.symbol}`);
      }
      await researchTick();
      if (app.paused) return;
      if (demo) {
        for (const t of state.tokens) {
          const m = { ...t.market, observedAt: Date.now() };
          observe(state, t, m);
          t.market = m;
        }
        markPaper(state);
        app.status = 'DEMO / OFFLINE';
        return;
      }
      try {
        const picked = selected(app)?.address;
        const fresh = await provider.scan(state);
        if (picked && [0, 1, 2].includes(app.tab)) {
          const idx = tokenRows(app).findIndex((t) => t.address === picked);
          if (idx >= 0) app.index = idx;
        }
        await store.save(state);
        app.status = 'CONNECTED';
        if (fresh.length)
          message(
            `${fresh.length} events scanned; ${state.tokens.length} locally retained`,
          );
        else
          app.message = 'No new confirmed launches. Waiting for the next scan.';
      } catch (e) {
        app.status = 'SCAN UNAVAILABLE';
        message(e.message, true);
      }
      const addresses = [
        ...new Set([
          ...state.trading.paper
            .filter((p) => !p.closedAt)
            .map((p) => p.address),
          ...state.trading.rules
            .filter((r) => r.address !== '*')
            .map((r) => r.address),
          ...Object.keys(state.watch),
          ...state.tokens.slice(0, 20).map((t) => t.address),
        ]),
      ].slice(0, 100);
      // Market updates are batched and slower than the confirmed event scan.
      if (!app.lastMarkets || Date.now() - app.lastMarkets > 30000) {
        app.lastMarkets = Date.now();
        try {
          for (let i = 0; i < addresses.length; i += 30) {
            const updates = await provider.markets(addresses.slice(i, i + 30));
            for (const u of updates) {
              const t = state.tokens.find((t) => t.address === u.address);
              if (t) {
                observe(state, t, u.market);
                Object.assign(t, u);
              }
              if (state.watch[u.address])
                state.watch[u.address].price = u.market.price;
            }
          }
        } catch (e) {
          message(e.message, true);
        }
      }
      markPaper(state);
      const unresolved = state.tokens
        .filter(
          (t) =>
            t.symbol === '?' &&
            (!t.metadataTriedAt || Date.now() - t.metadataTriedAt > 300000),
        )
        .slice(0, 3);
      for (const t of unresolved) {
        t.metadataTriedAt = Date.now();
        try {
          const meta = await provider.metadata(t.address);
          t.name = meta.name || t.name;
          t.symbol = meta.symbol || t.symbol;
        } catch {}
      }
    });
  }
  async function researchTick() {
    const x = state.trading;
    // Position monitoring is independent of the launch scanner and pause toggle.
    for (const p of x.paper.filter((p) => !p.closedAt)) {
      if (demo) continue;
      try {
        const updates = await provider.markets([p.address], p.pair);
        const u = updates[0],
          t = state.tokens.find((t) => t.address === p.address);
        if (t && u) {
          p.lastQuote = u.market;
          observe(state, t, u.market);
          t.market = u.market;
        }
      } catch (e) {
        p.status = clean(e.message);
      }
    }
    markPaper(state);
    if (app.paused) return;
    for (const w of x.wallets) {
      if (w.attemptedAt && Date.now() - w.attemptedAt < 60000) continue;
      w.attemptedAt = Date.now();
      try {
        const result = demo
          ? {
              items: [
                {
                  id: 'demo-transfer',
                  tx: '0x' + 'a'.repeat(64),
                  direction: 'IN',
                  symbol: 'DEMO',
                  value: '100 raw',
                },
              ],
              truncated: false,
            }
          : await provider.transfers(w.address);
        walletRecords(state, w, result);
      } catch (e) {
        w.status = clean(e.message);
      }
    }
  }
  async function command(text) {
    const [verb, ...words] = text.trim().split(/\s+/),
      x = state.trading,
      t = selected(app);
    await work(async () => {
      if (
        ['alerts', 'changes', 'wallets', 'paper'].includes(verb) &&
        !words.length
      ) {
        app.tradePage = verb;
      } else if (verb === 'alert') {
        const all = words[0] === 'all';
        if (!all && !t) throw Error('Select a token in Radar first');
        const r = addRule(
          state,
          all ? '*' : t.address,
          words.slice(all ? 1 : 0).join(''),
        );
        message(
          `Rule ${r.id.slice(0, 8)} saved. Checked on fresh observations.`,
        );
        app.tradePage = 'alerts';
      } else if (verb === 'unalert') {
        const r = x.rules.find((r) => r.id.startsWith(words[0] || '!'));
        if (!r) throw Error('Rule ID not found');
        x.rules = x.rules.filter((v) => v !== r);
        message('Rule removed');
      } else if (verb === 'wallet' || verb === 'unwallet') {
        const address = words[0]?.toLowerCase();
        if (!validAddress(address)) throw Error('Enter a public 0x address');
        if (verb === 'unwallet')
          x.wallets = x.wallets.filter((w) => w.address !== address);
        else if (!x.wallets.some((w) => w.address === address)) {
          if (x.wallets.length >= 10)
            throw Error('Maximum 10 public addresses');
          x.wallets.push({ address, seen: [] });
        }
        app.tradePage = 'wallets';
        message('Public address list saved');
      } else if (verb === 'size' || verb === 'paper') {
        if (!t) throw Error('Select a token in Radar first');
        if (!demo) {
          const u = (await provider.markets([t.address]))[0];
          if (!u) throw Error('No market available');
          observe(state, t, u.market);
          t.market = u.market;
        } else t.market.observedAt = Date.now();
        if (!words.length || words.length > (verb === 'size' ? 3 : 5))
          throw Error(
            'Use size USD FEEbps SLIPbps or paper USD STOP% TARGET% FEEbps SLIPbps',
          );
        if (verb === 'paper') {
          const p = openPaper(state, t, ...words);
          message(`PAPER opened ${p.id.slice(0, 8)} - virtual money only`);
          app.tradePage = 'paper';
        } else {
          const q = estimate(t.market, ...words);
          app.report = {
            address: t.address,
            lines: [
              `SIZE MODEL / ${t.symbol}`,
              `Input: $${q.amount}; fee ${q.fee} bps; slippage ${q.slip} bps`,
              `Model tokens: ${q.quantity.toPrecision(6)}`,
              `All-in average: $${q.fill.toPrecision(6)}`,
              `Curve premium vs spot (before extra slippage): ${q.impact.toFixed(2)}%`,
              'Hypothetical equal-value constant-product pool.',
              'Not an executable quote. Actual pool type/reserves not verified.',
              'Excludes gas, transfer tax, MEV and routing. Real fills may differ.',
              `Observed: ${new Date(q.observedAt).toISOString()}`,
            ],
          };
          app.showReport = true;
          app.detailScroll = 0;
        }
      } else if (verb === 'close') {
        const p = x.paper.find(
          (p) => !p.closedAt && p.id.startsWith(words[0] || '!'),
        );
        if (!p) throw Error('Open position ID not found');
        const t = state.tokens.find((t) => t.address === p.address);
        const m = demo
          ? { ...t.market, observedAt: Date.now() }
          : (await provider.markets([p.address], p.pair))[0]?.market;
        closePaper(state, p, m);
        message('Paper position closed at observed modeled fill');
        app.tradePage = 'paper';
      } else
        throw Error(
          'Commands: alerts, changes, wallets, paper, alert, unalert, wallet, unwallet, size, close',
        );
      app.tradePick = t?.address;
      app.tab = 7;
      app.index = 0;
    });
  }
  async function inspect() {
    const t = selected(app);
    if (!t) return;
    await work(async () => {
      message(`Inspecting ${t.symbol}...`);
      draw();
      const report = demo
        ? {
            lines: [
              'DEMO ONLY / SYNTHETIC EVIDENCE',
              'Verified source: UNKNOWN',
              'Holders: demo sample, not a real contract',
              'No actual safety analysis performed.',
            ],
          }
        : await provider.investigate(t.address);
      if (!demo && validAddress(report.creator))
        t.creator = report.creator.toLowerCase();
      const m = t.market;
      report.lines = [
        `TOKEN ${clean(t.name)} / ${t.address}`,
        `Creator: ${t.creator || 'UNKNOWN'}`,
        `Creator launches in retained archive: ${t.creator ? state.tokens.filter((x) => x.creator === t.creator).length : 'UNKNOWN'}`,
        `Price: ${m?.price ?? 'UNKNOWN'} USD / Liquidity: ${m?.liquidity ?? 'UNKNOWN'} USD`,
        `Market observed: ${m?.observedAt ? new Date(m.observedAt).toISOString() : 'UNKNOWN'} (provider may lag)`,
        `Evidence checked: ${new Date().toISOString()}`,
        ...report.lines,
        'Market source: DEX Screener; contract/holders: Blockscout',
        `Market pool: ${m?.pair || 'UNKNOWN'}`,
      ];
      app.report = { ...report, address: t.address };
      app.showReport = true;
      app.detailScroll = 0;
      message(
        'Case file updated. Arrows scroll evidence; Esc returns to the desk.',
      );
      if (!demo) {
        if (report.name) t.name = report.name;
        if (report.symbol) t.symbol = report.symbol;
      }
    });
  }
  async function predict(direction) {
    const t = selected(app);
    if (!t || app.tab !== 5) return;
    if (state.games.some((g) => !g.result)) {
      message('One prediction at a time. Wait for the open round.');
      return;
    }
    await work(async () => {
      const q = demo
        ? { address: t.address, ...t.market, observedAt: Date.now() }
        : await provider.quote(t.address);
      state.games.push({
        id: crypto.randomUUID(),
        address: t.address,
        symbol: t.symbol,
        direction,
        entry: q,
        due: Date.now() + 300000,
      });
      state.games = state.games.slice(-100);
      message(
        `${demo ? 'DEMO ' : ''}${direction.toUpperCase()} locked for five minutes. No money involved.`,
      );
    });
  }
  async function quit() {
    if (closing) return;
    closing = true;
    restore();
    if (inFlight) await inFlight;
    try {
      await store.save(state);
    } catch {
      process.exitCode = 1;
      console.error(
        'Could not save this session. Previous disk state is retained.',
      );
    } finally {
      await store.close();
      store = null;
    }
    console.log(`SHERIFF CAT / Session saved in ${dir}`);
  }
  const onKey = async (str, k = {}) => {
    try {
      if (k.ctrl && k.name === 'c') {
        await quit();
        return;
      }
      if (closing) return;
      if (app.input) {
        if (k.ctrl && k.name === 'u') {
          app.input.value = '';
          draw();
          return;
        }
        if (k.name === 'escape') {
          app.input = null;
        } else if (k.name === 'backspace') {
          app.input.value = app.input.value.slice(0, -1);
        } else if (k.name === 'return') {
          const input = app.input;
          app.input = null;
          if (input.kind === 'filter') {
            app.filter = input.value;
            app.index = 0;
          } else if (input.kind === 'command') {
            await command(input.value);
          } else if (!validAddress(input.value)) {
            message(
              'Enter a valid token contract: 0x + 40 hexadecimal characters.',
              true,
            );
          } else {
            await work(async () => {
              const address = input.value.toLowerCase();
              app.devCreator =
                state.tokens.find((t) => t.address === address)?.creator ||
                (demo ? null : await provider.creator(address));
              app.tab = 1;
              app.index = 0;
              app.filter = '';
              message(
                app.devCreator
                  ? 'Creator found. Counts cover your retained local archive.'
                  : 'Creator not found; this is not a zero-launch verdict.',
              );
            });
          }
        } else if (str && !k.ctrl && !k.meta) {
          app.input.value = (app.input.value + clean(str)).slice(0, 300);
        }
        draw();
        return;
      }
      if (k.name === 'q') {
        await quit();
        return;
      }
      if (
        (app.showReport || app.help) &&
        ['up', 'down', 'j', 'k', 'pageup', 'pagedown'].includes(k.name)
      ) {
        app.detailScroll = Math.max(
          0,
          Math.min(
            1000,
            (app.detailScroll || 0) +
              (['up', 'k', 'pageup'].includes(k.name) ? -1 : 1),
          ),
        );
        draw();
        return;
      }
      if (/^[1-8]$/.test(str)) {
        const t = selected(app);
        if (Number(str) === 6) app.gamePick = t?.address;
        if (Number(str) === 8) app.tradePick = t?.address;
        app.tab = Number(str) - 1;
        app.index = 0;
        app.help = false;
        app.showReport = false;
      } else if (app.tab === 7 && ['left', 'right'].includes(k.name)) {
        const pages = ['alerts', 'changes', 'wallets', 'paper'];
        app.tradePage =
          pages[
            (pages.indexOf(app.tradePage) + (k.name === 'right' ? 1 : 3)) % 4
          ];
        app.index = 0;
      } else if (k.name === 'down' || k.name === 'j' || k.name === 'pagedown') {
        const max =
          app.tab === 7
            ? 1000
            : app.tab === 4
              ? clones(state.tokens.slice(0, 500)).length
              : tokenRows(app).length;
        app.index = Math.max(
          0,
          Math.min(max - 1, app.index + (k.name === 'pagedown' ? 10 : 1)),
        );
      } else if (k.name === 'up' || k.name === 'k' || k.name === 'pageup')
        app.index = Math.max(0, app.index - (k.name === 'pageup' ? 10 : 1));
      else if (k.name === 'escape') {
        app.showReport = false;
        app.help = false;
        app.detailScroll = 0;
      } else if (str === ':') app.input = { kind: 'command', value: '' };
      else if (str === '/') app.input = { kind: 'filter', value: app.filter };
      else if (k.name === 'd') app.input = { kind: 'dev', value: '' };
      else if (str === '?') {
        app.help = !app.help;
        app.showReport = false;
        app.detailScroll = 0;
      } else if (k.name === 'p') {
        app.paused = !app.paused;
        message(
          app.paused
            ? 'Collection paused. Paper positions and guesses still monitored.'
            : 'Collection resumed.',
        );
      } else if (k.name === 'r') void tick();
      else if (k.name === 'return' || k.name === 'i') void inspect();
      else if (k.name === 'u') void predict('up');
      else if (k.name === 'n') void predict('down');
      else if (k.name === 'w' || k.name === 'space') {
        const t = selected(app);
        if (t) {
          if (state.watch[t.address]) delete state.watch[t.address];
          else if (Object.keys(state.watch).length < 100)
            state.watch[t.address] = { price: t.market?.price ?? null };
          else {
            message('Watchlist holds up to 100 tokens.');
            draw();
            return;
          }
          await store.save(state);
          message('Watchlist saved locally.');
        }
      } else if (k.name === 'e') {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-'),
          base = join(dir, `${demo ? 'demo-' : ''}sheriff-daily-${stamp}`);
        await writeFile(base + '.txt', daily(state), { mode: 0o600 });
        await writeFile(
          base + '.json',
          JSON.stringify(
            {
              generatedAt: Date.now(),
              demo,
              summary: daily(state),
              research: state.trading,
            },
            null,
            2,
          ),
          { mode: 0o600 },
        );
        message(`Exported ${base}.txt + .json`);
      }
      draw();
    } catch (e) {
      message(e.message, true);
      draw();
    }
  };
  process.stdout.write('\x1b[?1049h\x1b[?25l\x1b[2J');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('keypress', onKey);
  process.stdout.on('resize', draw);
  process.once('SIGTERM', () => void quit());
  process.once('SIGINT', () => void quit());
  draw();
  void tick();
  timer = setInterval(() => void tick(), 8000);
  drawTimer = setInterval(draw, 1000);
}
main().catch(async (e) => {
  restore();
  if (store) await store.close().catch(() => {});
  console.error('SHERIFF CAT: ' + clean(e.message, 400));
  process.exitCode = 1;
});
