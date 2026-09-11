import { validAddress } from './core.mjs';
export const FACTORY = '0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e';
export const TOPIC =
  '0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607';
const numeric = (v) =>
  v !== null && v !== undefined && Number.isFinite(Number(v))
    ? Number(v)
    : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export class Provider {
  constructor(key, fetcher = fetch) {
    this.key = key;
    this.fetcher = fetcher;
    this.next = {};
    this.calls = 0;
    this.status = 'NOT CHECKED';
  }
  async json(url, body) {
    const host = new URL(url).hostname;
    for (let n = 0; n < 3; n++) {
      const at = Math.max(Date.now(), this.next[host] || 0);
      this.next[host] = at + 400;
      await sleep(at - Date.now());
      let response;
      try {
        this.calls++;
        response = await this.fetcher(url, {
          method: body ? 'POST' : 'GET',
          headers: {
            Accept: 'application/json',
            ...(body ? { 'Content-Type': 'application/json' } : {}),
            ...(host === 'api.blockscout.com'
              ? { Authorization: `Bearer ${this.key}` }
              : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(15000),
        });
      } catch {
        throw Error(`${host}: connection unavailable`);
      }
      if ([429, 502, 503, 504].includes(response.status) && n < 2) {
        const retry = response.headers.get('retry-after');
        const sec = Number(retry);
        const delay = retry
          ? Number.isFinite(sec)
            ? sec * 1000
            : Date.parse(retry) - Date.now()
          : 500 * (n + 1);
        await response.body?.cancel();
        if (delay > 10000)
          throw Error(`${host}: provider cooldown; retry later`);
        await sleep(Math.max(400, Number.isFinite(delay) ? delay : 1000));
        continue;
      }
      if (!response.ok)
        throw Error(
          `${host}: HTTP ${response.status}${response.status === 401 || response.status === 403 ? ' (check API key)' : ''}`,
        );
      try {
        return await response.json();
      } catch {
        throw Error(`${host}: invalid JSON`);
      }
    }
  }
  async rpc(method, params = []) {
    const d = await this.json('https://api.blockscout.com/4663/json-rpc', {
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    });
    if (d.error)
      throw Error(`RPC ${method} failed (${d.error.code ?? 'provider error'})`);
    if (d.result === undefined) throw Error('RPC result missing');
    return d.result;
  }
  async connect() {
    await this.json('https://api.blockscout.com/4663/api/v2/stats');
    const id = await this.rpc('eth_chainId');
    if (Number(BigInt(id)) !== 4663)
      throw Error('Wrong chain: expected Robinhood Chain 4663');
    this.status = 'CONNECTED';
  }
  async scan(state) {
    const head = Number(BigInt(await this.rpc('eth_blockNumber'))),
      toHead = Math.max(0, head - 12),
      from =
        state.cursor === null ? Math.max(0, toHead - 1999) : state.cursor + 1,
      to = Math.min(from + 1999, toHead);
    if (from > to) {
      state.lastScan = Date.now();
      return [];
    }
    const logs = await this.rpc('eth_getLogs', [
      {
        address: FACTORY,
        topics: [TOPIC],
        fromBlock: '0x' + from.toString(16),
        toBlock: '0x' + to.toString(16),
      },
    ]);
    if (!Array.isArray(logs)) throw Error('Invalid factory log response');
    const tokens = logs
      .filter((l) => !l.removed)
      .map((l) => {
        if (
          l.address?.toLowerCase() !== FACTORY ||
          l.topics?.[0] !== TOPIC ||
          l.topics.length < 4
        )
          throw Error('Unexpected factory event');
        const address = '0x' + l.topics[1].slice(-40),
          creator = '0x' + l.topics[3].slice(-40);
        const block = Number(BigInt(l.blockNumber));
        if (
          !validAddress(address) ||
          !validAddress(creator) ||
          !Number.isSafeInteger(block) ||
          block < from ||
          block > to
        )
          throw Error('Malformed factory event');
        return {
          address: address.toLowerCase(),
          creator: creator.toLowerCase(),
          block,
          tx: l.transactionHash,
          name: 'Unresolved',
          symbol: '?',
          seenAt: Date.now(),
          market: null,
        };
      });
    const known = new Map(state.tokens.map((t) => [t.address, t]));
    for (const t of tokens) if (!known.has(t.address)) known.set(t.address, t);
    const sorted = [...known.values()].sort((a, b) => b.block - a.block);
    const pinned = sorted.filter(
      (t) =>
        state.watch?.[t.address] ||
        state.trading?.paper.some(
          (p) => !p.closedAt && p.address === t.address,
        ) ||
        state.trading?.rules.some((r) => r.address === t.address),
    );
    const keep = new Map(
      [
        ...pinned,
        ...sorted
          .filter((t) => !pinned.includes(t))
          .slice(0, 5000 - pinned.length),
      ].map((t) => [t.address, t]),
    );
    state.tokens = [...keep.values()].sort((a, b) => b.block - a.block);
    state.start ??= from;
    state.cursor = to;
    state.lastScan = Date.now();
    return tokens;
  }
  async markets(addresses, pair = null) {
    const a = [...new Set(addresses.filter(validAddress))].slice(0, 30);
    if (!a.length) return [];
    const result = await this.json(
      `https://api.dexscreener.com/tokens/v1/robinhood/${a.join(',')}`,
    );
    if (!Array.isArray(result)) throw Error('Market response invalid');
    return a.flatMap((address) => {
      const pairs = result
        .filter(
          (p) =>
            (!pair || p.pairAddress?.toLowerCase() === pair.toLowerCase()) &&
            p.chainId === 'robinhood' &&
            p.baseToken?.address?.toLowerCase() === address.toLowerCase(),
        )
        .sort((x, y) => (y.liquidity?.usd || 0) - (x.liquidity?.usd || 0));
      const p = pairs[0];
      return p
        ? [
            {
              address,
              name: p.baseToken.name,
              symbol: p.baseToken.symbol,
              market: {
                price: numeric(p.priceUsd),
                change: numeric(p.priceChange?.h24),
                buys: numeric(p.txns?.h1?.buys),
                volume: numeric(p.volume?.h24),
                liquidity: numeric(p.liquidity?.usd),
                pair: p.pairAddress,
                observedAt: Date.now(),
              },
            },
          ]
        : [];
    });
  }
  async transfers(address) {
    if (!validAddress(address)) throw Error('Invalid public address');
    const result = await this.json(
      `https://api.blockscout.com/4663/api/v2/addresses/${address}/token-transfers`,
    );
    if (!Array.isArray(result.items)) throw Error('Invalid transfer response');
    const items = result.items.slice(0, 50).flatMap((t) => {
      if (
        typeof t.transaction_hash !== 'string' ||
        !Number.isSafeInteger(t.log_index)
      )
        return [];
      const from = t.from?.hash?.toLowerCase(),
        to = t.to?.hash?.toLowerCase();
      if (from !== address && to !== address) return [];
      let value = String(t.total?.value ?? '?') + ' raw';
      const decimals = Number(t.token?.decimals);
      if (
        /^\d+$/.test(String(t.total?.value)) &&
        Number.isInteger(decimals) &&
        decimals >= 0 &&
        decimals <= 36
      ) {
        const digits = String(t.total.value).padStart(decimals + 1, '0');
        value = decimals
          ? digits.slice(0, -decimals) + '.' + digits.slice(-decimals)
          : digits;
      }
      return [
        {
          id: `${t.transaction_hash}:${t.log_index}:${t.total?.token_id || ''}`,
          tx: t.transaction_hash,
          from,
          to,
          direction:
            from === address && to === address
              ? 'SELF'
              : to === address
                ? 'IN'
                : 'OUT',
          symbol: String(t.token?.symbol || '?'),
          value,
          timestamp: t.timestamp || null,
        },
      ];
    });
    return { items, truncated: !!result.next_page_params };
  }
  async quote(address) {
    const result = await this.markets([address]);
    const m = result[0]?.market;
    if (
      !m ||
      !Number.isFinite(m.price) ||
      m.price <= 0 ||
      !validAddress(m.pair)
    )
      throw Error('No indexed price for this token');
    return { address, price: m.price, pair: m.pair, observedAt: m.observedAt };
  }
  async metadata(address) {
    return this.json(
      `https://api.blockscout.com/4663/api/v2/tokens/${address}`,
    );
  }
  async creator(address) {
    const d = await this.json(
      `https://api.blockscout.com/4663/api/v2/addresses/${address}`,
    );
    return validAddress(d.creator_address_hash)
      ? d.creator_address_hash.toLowerCase()
      : null;
  }
  async investigate(address) {
    const results = await Promise.allSettled(
      [
        'tokens/' + address,
        'smart-contracts/' + address,
        'tokens/' + address + '/holders',
        'addresses/' + address,
      ].map((p) => this.json('https://api.blockscout.com/4663/api/v2/' + p)),
    );
    const [token, code, holders, info] = results.map((r) =>
      r.status === 'fulfilled' ? r.value : null,
    );
    let listed = null;
    try {
      if (
        token?.total_supply &&
        BigInt(token.total_supply) > 0n &&
        holders?.items
      ) {
        const total = holders.items
          .slice(0, 10)
          .reduce((a, h) => a + BigInt(h.value), 0n);
        listed = Number((total * 10000n) / BigInt(token.total_supply)) / 100;
      }
    } catch {}
    return {
      checkedAt: Date.now(),
      name: token?.name,
      symbol: token?.symbol,
      creator: info?.creator_address_hash,
      lines: [
        `Verified source: ${code ? (code.is_verified === true ? 'YES' : code.is_verified === false ? 'NO' : 'UNKNOWN') : 'UNKNOWN'}`,
        `Holders count: ${token?.holders_count ?? 'UNKNOWN'}`,
        `Top ${Math.min(holders?.items?.length || 0, 10)} listed holders: ${listed === null ? 'UNKNOWN' : listed.toFixed(2) + '%'}`,
        `Proxy implementations: ${Array.isArray(code?.implementations) ? code.implementations.length : 'UNKNOWN'}`,
        `Sources available: ${results.filter((r) => r.status === 'fulfilled').length}/4`,
        'Holdings include pools/contracts; no wallet-only inference.',
        'Mint / tax / blacklist / LP lock: NOT CHECKED.',
        'These checks do not establish that a token is safe.',
      ],
    };
  }
}
