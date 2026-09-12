import {
  initPet,
  petView,
  care,
  reward,
  accessFor,
  tierFor,
  quantity,
} from '../src/pet.mjs';
import { validAddress } from '../src/core.mjs';
const hash = async (value) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
    ),
  )
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
const reply = (value, status = 200) =>
  Response.json(value, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
async function bodyOf(request) {
  if (!request.body) return {};
  const reader = request.body.getReader();
  let length = 0,
    text = '';
  const decoder = new TextDecoder();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 4096) {
      await reader.cancel();
      throw Error('Request too large');
    }
    text += decoder.decode(value, { stream: true });
  }
  return JSON.parse(text + decoder.decode());
}
async function rpc(env, method, params) {
  const response = await fetch(env.RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw Error('Chain source unavailable');
  const data = await response.json();
  if (data.error || data.result === undefined)
    throw Error('Chain source unavailable');
  return data.result;
}
async function balance(profile, env) {
  if (profile.access?.at && Date.now() - profile.access.at < 60000) return;
  profile.access = null;
  const thresholds = (env.SHERIFF_TOKEN_THRESHOLDS || '')
    .split(',')
    .filter(Boolean);
  if (
    !validAddress(profile.address) ||
    !validAddress(env.SHERIFF_TOKEN_CONTRACT) ||
    thresholds.length !== 3
  )
    return;
  try {
    if (Number(BigInt(await rpc(env, 'eth_chainId', []))) !== 4663) return;
    const block = await rpc(env, 'eth_blockNumber', []);
    const decimals = Number(
      BigInt(
        await rpc(env, 'eth_call', [
          { to: env.SHERIFF_TOKEN_CONTRACT, data: '0x313ce567' },
          block,
        ]),
      ),
    );
    const raw = await rpc(env, 'eth_call', [
      {
        to: env.SHERIFF_TOKEN_CONTRACT,
        data: '0x70a08231' + profile.address.slice(2).padStart(64, '0'),
      },
      block,
    ]);
    profile.access = {
      tier: tierFor(raw, decimals, thresholds),
      quantity: quantity(raw, decimals),
      at: Date.now(),
      block,
    };
  } catch {
    profile.access = null;
  }
}
async function rate(db, bucket, max, expires) {
  const row = await db
    .prepare(
      'INSERT INTO request_limits(bucket,hits,expires_at) VALUES(?1,1,?2) ON CONFLICT(bucket) DO UPDATE SET hits=hits+1 RETURNING hits',
    )
    .bind(bucket, expires)
    .first();
  return row.hits <= max;
}
export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    if (request.method === 'GET' && path === '/health')
      return reply({
        service: 'SHERIFF CAT companions',
        mode: 'rules-only',
        configured: validAddress(env.SHERIFF_TOKEN_CONTRACT),
      });
    if (request.method !== 'POST' || !['/profile', '/action'].includes(path))
      return reply({ error: 'Not found' }, 404);
    try {
      // The caller generates a 256-bit profile credential and stores it locally. It is not a wallet signature.
      const credential =
        request.headers.get('Authorization')?.replace(/^Bearer /, '') || '';
      if (!/^[a-f0-9]{64}$/.test(credential))
        return reply({ error: 'Profile credential required' }, 401);
      const key = await hash(credential),
        minute = Math.floor(Date.now() / 60000),
        expiry = Date.now() + 172800000;
      if (!(await rate(env.DB, `request:${key}:${minute}`, 30, expiry)))
        return reply(
          { error: 'Profile request limit. Try again next minute.' },
          429,
        );
      let row = await env.DB.prepare(
        'SELECT profile,revision FROM companions WHERE credential_hash=?1',
      )
        .bind(key)
        .first();
      if (!row) {
        if (path !== '/profile')
          return reply({ error: 'Create a profile first' }, 404);
        const ip = await hash(
          request.headers.get('CF-Connecting-IP') || 'local',
        );
        if (
          !(await rate(
            env.DB,
            `create:${ip}:${new Date().toISOString().slice(0, 10)}`,
            5,
            expiry,
          ))
        )
          return reply({ error: 'Daily profile creation limit reached' }, 429);
        const initial = {};
        initPet(initial);
        await env.DB.prepare(
          'INSERT OR IGNORE INTO companions(credential_hash,profile,updated_at) VALUES(?1,?2,?3)',
        )
          .bind(key, JSON.stringify(initial), Date.now())
          .run();
        row = await env.DB.prepare(
          'SELECT profile,revision FROM companions WHERE credential_hash=?1',
        )
          .bind(key)
          .first();
      }
      const profile = JSON.parse(row.profile),
        body = await bodyOf(request);
      if (path === '/action' && body.type === 'settings') {
        if (body.address && !validAddress(body.address))
          throw Error('Invalid public address');
        const address = (body.address || '').toLowerCase();
        if (address !== profile.address) profile.access = null;
        profile.address = address;
        profile.pet.name = String(body.name || 'Miso').slice(0, 24);
      }
      await balance(profile, env);
      const access = accessFor(profile.access);
      if (path === '/action') {
        if (body.type === 'care') care(profile, body.action, access.tier);
        else if (body.type === 'outfit') {
          if (!['classic', 'bandana', 'marshal'].includes(body.outfit))
            throw Error('Unknown outfit');
          if (
            (body.outfit === 'bandana' && access.tier < 1) ||
            (body.outfit === 'marshal' && access.tier < 3)
          )
            throw Error('This outfit requires more SHERIFF CAT');
          profile.pet.outfit = body.outfit;
        } else if (body.type === 'research') {
          // Research XP is capped for one request per task/day. Do not accept client amounts, XP or balances.
          // These are engagement rewards, not proof of trading or attention.
          if (!['investigate', 'compare', 'review'].includes(body.kind))
            throw Error('Unknown research task');
          reward(profile, body.kind, 'daily-task');
        } else if (body.type !== 'settings') throw Error('Unknown action');
      }
      const result = await env.DB.prepare(
        'UPDATE companions SET profile=?1,revision=revision+1,updated_at=?2 WHERE credential_hash=?3 AND revision=?4',
      )
        .bind(JSON.stringify(profile), Date.now(), key, row.revision)
        .run();
      if (!result.meta.changes)
        return reply(
          { error: 'Another update won. Refresh your profile and retry.' },
          409,
        );
      // Bounded cleanup; parameterized queries and optimistic locking keep repeated grants atomic.
      ctx.waitUntil(
        env.DB.prepare(
          'DELETE FROM request_limits WHERE bucket IN (SELECT bucket FROM request_limits WHERE expires_at < ?1 LIMIT 100)',
        )
          .bind(Date.now())
          .run(),
      );
      return reply({
        pet: petView(profile),
        access: { ...access, ...(access.current ? profile.access : {}) },
        address: profile.address || '',
        contract: env.SHERIFF_TOKEN_CONTRACT,
        thresholds: (env.SHERIFF_TOKEN_THRESHOLDS || '')
          .split(',')
          .filter(Boolean),
      });
    } catch (e) {
      console.error(
        JSON.stringify({ event: 'companion_request_failed', kind: e.name }),
      );
      return reply({ error: 'Unable to apply action: ' + e.message }, 400);
    }
  },
};
