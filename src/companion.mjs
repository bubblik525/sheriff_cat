import { analyzeToken, updateEngine, demoStep } from './market-engine.mjs';
import { guard, guardAction } from './session-guard.mjs';
import { Provider } from './provider.mjs';
import { demoTokens } from './demo.mjs';
import { daily, summary, clones, validAddress, settle } from './core.mjs';
import {
  initTrading,
  observe,
  addRule,
  estimate,
  openPaper,
  closePaper,
  markPaper,
  walletRecords,
} from './trading.mjs';
import {
  initPet,
  petView,
  care,
  reward,
  accessFor,
  tierFor,
  quantity,
  clue,
  TIERS,
} from './pet.mjs';

export function companion(state, save, options = {}) {
  initTrading(state);
  initPet(state);
  if (state.demo && !state.tokens.length) state.tokens = demoTokens();
  let provider,
    busy = false,
    status = state.demo ? 'DEMO / SIMULATED DATA' : 'Add your personal API key',
    lastMarket = 0,
    lastWallet = 0,
    marketOffset = 0;
  let access = null;
  const cloud = options.cloud;
  let cloudStatus = cloud ? 'Connecting cloud profile' : 'Local profile',
    lastCloud = 0;
  const contract = options.contract || '';
  const thresholds = options.thresholds || [];
  const getToken = (address) => {
    const t = state.tokens.find((t) => t.address === address);
    if (!t) throw Error('Select a token in the radar first');
    return t;
  };
  async function checkAccess() {
    if (state.demo) return;
    access = null;
    if (
      !provider ||
      !state.observedAddress ||
      !validAddress(contract) ||
      thresholds.length !== 3
    )
      return;
    const block = await provider.rpc('eth_blockNumber');
    const decimals = Number(
      BigInt(
        await provider.rpc('eth_call', [
          { to: contract, data: '0x313ce567' },
          block,
        ]),
      ),
    );
    const raw = await provider.rpc('eth_call', [
      {
        to: contract,
        data: '0x70a08231' + state.observedAddress.slice(2).padStart(64, '0'),
      },
      block,
    ]);
    access = {
      tier: tierFor(raw, decimals, thresholds),
      quantity: quantity(raw, decimals),
      at: Date.now(),
      block,
      address: state.observedAddress,
    };
  }
  const limits = () => accessFor(access);
  function observed(t, market) {
    const all = state.trading.rules;
    state.trading.rules = all.slice(0, limits().rules);
    try {
      observe(state, t, market);
    } finally {
      state.trading.rules = all;
    }
  }
  async function syncCloud(action) {
    if (!cloud) return;
    try {
      const data = await cloud.request(action);
      state.pet = data.pet;
      state.observedAddress = data.address;
      access = data.access.current ? data.access : null;
      options.cloudContract = data.contract;
      options.cloudThresholds = data.thresholds;
      cloudStatus = 'Cloud profile synced';
      lastCloud = Date.now();
    } catch (e) {
      access = null;
      cloudStatus = 'Cloud unavailable / base access';
      throw e;
    }
  }
  async function earn(kind, id) {
    if (cloud) await syncCloud({ type: 'research', kind });
    else reward(state, kind, id);
  }
  function snapshot() {
    return {
      demo: state.demo,
      connected: !!provider,
      status,
      busy,
      tokens: state.tokens,
      watch: state.watch,
      games: state.games,
      trading: state.trading,
      pet: petView(state),
      access: {
        ...limits(),
        ...(!limits().current
          ? {}
          : { quantity: access.quantity, at: access.at }),
        contract: cloud ? options.cloudContract || '' : contract,
        thresholds: cloud ? options.cloudThresholds || [] : thresholds,
        configured: cloud
          ? validAddress(options.cloudContract) &&
            options.cloudThresholds?.length === 3
          : validAddress(contract) && thresholds.length === 3,
      },
      tiers: TIERS,
      address: state.observedAddress || '',
      lastScan: state.lastScan,
      summary: summary(state.tokens),
      clones: clones(state.tokens.slice(0, 300)),
      daily: daily(state),
      clue: clue(state),
      guard: guard(state),
      engine: state.engine || { events: [], history: {} },
      activity: state.tokens
        .slice(0, 120)
        .map((t) => analyzeToken(t, state.tokens))
        .sort((a, b) => (b.score ?? -1) - (a.score ?? -1)),
      cadence: { scan: 1000, quotes: 1000, confirmations: 12 },
      settings: { reducedMotion: !!state.reducedMotion },
      cloud: !!cloud,
      storage: cloudStatus,
      cloudConfig: cloud
        ? {
            contract: options.cloudContract || '',
            thresholds: options.cloudThresholds || [],
          }
        : null,
    };
  }
  async function refresh() {
    if (state.demo) {
      for (const next of demoStep(state)) {
        const t = getToken(next.address);
        if (next.market) observed(t, next.market);
        Object.assign(t, next);
      }
      state.lastScan = Date.now();
    } else {
      if (!provider)
        throw Error('Add your personal Blockscout API key in Settings');
      if (!state.lastScan || Date.now() - state.lastScan >= 1000)
        await provider.scan(state);
      if (Date.now() - lastMarket >= 1000) {
        const ids = [
          ...new Set([
            ...state.trading.paper
              .filter((p) => !p.closedAt)
              .map((p) => p.address),
            ...state.trading.rules
              .slice(0, limits().rules)
              .filter((r) => r.address !== '*')
              .map((r) => r.address),
            ...Object.keys(state.watch).slice(0, limits().watch),
            ...state.tokens.slice(0, 20).map((t) => t.address),
          ]),
        ].slice(0, 100);
        const batch = ids.slice(marketOffset, marketOffset + 30);
        marketOffset = marketOffset + 30 >= ids.length ? 0 : marketOffset + 30;
        for (const q of await provider.markets(batch)) {
          const t = getToken(q.address);
          observed(t, q.market);
          Object.assign(t, q);
        }
        for (const p of state.trading.paper.filter(
          (p) => !p.closedAt && getToken(p.address).market?.pair !== p.pair,
        )) {
          const q = (await provider.markets([p.address], p.pair))[0];
          if (q) p.lastQuote = q.market;
        }
        lastMarket = Date.now();
      }
      if (Date.now() - lastWallet >= 60000) {
        for (const w of state.trading.wallets) {
          try {
            walletRecords(state, w, await provider.transfers(w.address));
          } catch (e) {
            w.status = e.message;
          }
        }
        if (!cloud) {
          try {
            await checkAccess();
          } catch {
            access = null;
          }
        }
        lastWallet = Date.now();
      }
    }
    if (cloud && Date.now() - lastCloud >= 60000) {
      try {
        await syncCloud();
      } catch {}
    }
    updateEngine(state);
    markPaper(state);
    state.games = state.games.map((g) => {
      const m = state.tokens.find((t) => t.address === g.address)?.market;
      return settle(g, m && { ...m, address: g.address });
    });
    status = state.demo ? 'DEMO / SIMULATED DATA' : 'Patrol active';
    await save(state);
  }
  async function action(body) {
    const type = body.type;
    guardAction(state, body);
    if (['heartbeat', 'guard-settings', 'break', 'resume'].includes(type))
      return;
    if (type === 'connect') {
      if (state.demo)
        throw Error('Restart without --demo to connect live data');
      if (
        typeof body.key !== 'string' ||
        body.key.length < 10 ||
        body.key.length > 512
      )
        throw Error('Enter your personal API key');
      const next = new Provider(body.key.trim());
      await next.connect();
      provider = next;
      status = 'Connected';
      await refresh();
    } else if (type === 'refresh') await refresh();
    else if (type === 'settings') {
      if (body.address && !validAddress(body.address))
        throw Error('Use a valid 0x public address');
      state.observedAddress = (body.address || '').toLowerCase();
      state.pet.name =
        String(body.name || 'Miso')
          .trim()
          .slice(0, 24) || 'Miso';
      state.reducedMotion = !!body.reducedMotion;
      access = null;
      if (cloud)
        await syncCloud({
          type: 'settings',
          name: state.pet.name,
          address: state.observedAddress,
        });
      else {
        try {
          await checkAccess();
        } catch {
          status =
            'Settings saved. Token balance unavailable; base access applies.';
        }
      }
    } else if (type === 'demo-tier' && state.demo) {
      const tier = Number(body.tier);
      if (!Number.isInteger(tier) || tier < 0 || tier > 3)
        throw Error('Invalid demo tier');
      access = { tier, at: Date.now(), quantity: 'Demo balance' };
    } else if (type === 'care') {
      if (cloud) await syncCloud({ type: 'care', action: body.action });
      else care(state, body.action, limits().tier);
    } else if (type === 'outfit') {
      if (!['classic', 'bandana', 'marshal'].includes(body.outfit))
        throw Error('Unknown outfit');
      if (
        (body.outfit === 'bandana' && limits().tier < 1) ||
        (body.outfit === 'marshal' && limits().tier < 3)
      )
        throw Error('This outfit requires more SHERIFF CAT tokens');
      if (cloud) await syncCloud({ type: 'outfit', outfit: body.outfit });
      else state.pet.outfit = body.outfit;
    } else if (type === 'watch') {
      const t = getToken(body.address);
      if (state.watch[t.address]) delete state.watch[t.address];
      else {
        if (Object.keys(state.watch).length >= limits().watch)
          throw Error(
            `Your token access allows ${limits().watch} watched coins`,
          );
        state.watch[t.address] = {
          price: t.market?.price ?? null,
          at: Date.now(),
        };
      }
    } else if (type === 'investigate') {
      if (!validAddress(body.address))
        throw Error('Enter a valid token contract');
      const address = body.address.toLowerCase();
      let t = state.tokens.find((t) => t.address === address);
      let result;
      if (state.demo) {
        t = getToken(address);
        result = {
          checkedAt: Date.now(),
          creator: t.creator,
          lines: [
            'DEMO dossier - no contract checks performed.',
            'Live mode reads source verification, holder concentration and creator.',
            'Mint / tax / blacklist / LP lock: NOT CHECKED.',
          ],
        };
      } else {
        if (!provider) throw Error('Connect your API key first');
        result = await provider.investigate(address);
        if (!t) {
          if (state.tokens.length >= 5000) throw Error('Local archive full');
          t = {
            address,
            creator: validAddress(result.creator)
              ? result.creator.toLowerCase()
              : null,
            name: result.name || 'Unresolved',
            symbol: result.symbol || '?',
            block: 0,
            seenAt: Date.now(),
            market: null,
          };
          state.tokens.push(t);
        }
        try {
          const q = (await provider.markets([address]))[0];
          if (q) Object.assign(t, q);
        } catch {}
      }
      t.dossier = result;
      if (state.demo || !result.lines.includes('Sources available: 0/4')) {
        try {
          await earn('investigate', address);
        } catch {
          status = 'Dossier ready. Cloud XP unavailable.';
        }
      }
      return result;
    } else if (type === 'compare') {
      const ids = [...new Set(body.addresses || [])];
      if (ids.length < 2 || ids.length > limits().compare)
        throw Error(`Select 2 to ${limits().compare} tokens`);
      const tokens = ids.map(getToken);
      try {
        await earn('compare', ids.sort().join(':'));
      } catch {
        status = 'Comparison ready. Cloud XP unavailable.';
      }
      return tokens;
    } else if (type === 'rule') {
      if (state.trading.rules.length >= limits().rules)
        throw Error(`Your access allows ${limits().rules} alerts`);
      if (body.address !== '*') getToken(body.address);
      addRule(state, body.address, String(body.condition || ''));
    } else if (type === 'unrule')
      state.trading.rules = state.trading.rules.filter((r) => r.id !== body.id);
    else if (type === 'wallet') {
      if (!validAddress(body.address))
        throw Error('Enter a valid public address');
      const address = body.address.toLowerCase();
      if (!state.trading.wallets.some((w) => w.address === address)) {
        if (state.trading.wallets.length >= 10)
          throw Error('Maximum 10 observed addresses');
        state.trading.wallets.push({ address, seen: [] });
        ((lastWallet = 0), (marketOffset = 0));
      }
    } else if (type === 'unwallet')
      state.trading.wallets = state.trading.wallets.filter(
        (w) => w.address !== body.address,
      );
    else if (type === 'estimate')
      return estimate(
        getToken(body.address).market,
        body.amount,
        body.fee,
        body.slip,
      );
    else if (type === 'paper')
      openPaper(
        state,
        getToken(body.address),
        body.amount,
        body.stop,
        body.target,
        body.fee,
        body.slip,
      );
    else if (type === 'close') {
      const p = state.trading.paper.find((p) => p.id === body.id);
      if (!p) throw Error('Position not found');
      const m = getToken(p.address).market;
      closePaper(state, p, m?.pair === p.pair ? m : p.lastQuote);
      try {
        await earn('review', p.id);
      } catch {
        status = 'Position closed. Cloud XP unavailable.';
      }
    } else if (type === 'guess') {
      if (state.games.some((g) => !g.result))
        throw Error('Finish the current prediction first');
      if (!['up', 'down'].includes(body.direction))
        throw Error('Choose up or down');
      const t = getToken(body.address);
      estimate(t.market, 1);
      state.games = state.games.slice(-99);
      state.games.push({
        id: crypto.randomUUID(),
        address: t.address,
        symbol: t.symbol,
        direction: body.direction,
        due: Date.now() + 60000,
        entry: { ...t.market, address: t.address },
      });
    } else throw Error('Unknown action');
  }
  return {
    snapshot,
    async initialize() {
      if (cloud) {
        try {
          await syncCloud();
          await save(state);
        } catch {}
      }
    },
    async run(body) {
      if (busy) throw Error('Patrol is updating. Try again in a moment.');
      busy = true;
      try {
        const result = await action(body);
        await save(state);
        busy = false;
        return { result, state: snapshot() };
      } catch (e) {
        await save(state);
        if (body.type === 'refresh' || body.type === 'connect')
          status = e.message;
        throw e;
      } finally {
        busy = false;
      }
    },
    async tick() {
      if (!busy && (provider || state.demo)) {
        try {
          await this.run({ type: 'refresh' });
        } catch {}
      } else if (!busy && cloud && Date.now() - lastCloud >= 60000) {
        busy = true;
        try {
          await syncCloud();
          await save(state);
        } catch {
        } finally {
          busy = false;
        }
      }
    },
  };
}
