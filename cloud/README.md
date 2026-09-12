# Optional cloud companion service

Cloudflare Worker + D1. Prepared but **not deployed**. Stores pet progress, not API keys, launches or trading orders.

## Configure and deploy

Use the existing Cloudflare account and authenticated Wrangler. From this repository root:

```sh
npx wrangler d1 create sheriff-cat-companions
```

Copy the returned database ID into `cloud/wrangler.jsonc`. Set a trusted Robinhood Chain RPC URL (chain ID 4663), the actual `SHERIFF_TOKEN_CONTRACT`, and three increasing quantities in `SHERIFF_TOKEN_THRESHOLDS`. Until configured access stays Scout.

If the RPC URL contains a credential, remove the empty `RPC_URL` entry from `vars` and use a secret instead of committing it:

```sh
npx wrangler secret put RPC_URL --config cloud/wrangler.jsonc
```

Apply the schema and deploy after selecting the intended account:

```sh
npx wrangler d1 execute DB --remote --config cloud/wrangler.jsonc --file cloud/schema.sql
npx wrangler deploy --config cloud/wrangler.jsonc
```

Set `SHERIFF_CLOUD_URL` on the user's computer to the deployed HTTPS service and start `node bin/companion.mjs`. The app creates a cloud profile using a random 256-bit credential saved in `cloud-profile-key` in its data directory. Back up that file to recover the profile elsewhere. Never publish it. The personal Blockscout key stays local; the server uses its own RPC. New cloud profiles start fresh; local XP is never uploaded as trusted progress.

## Behavior

- `/health`: public service status.
- `POST /profile`: authenticated retrieval / creation.
- `POST /action`: settings, care, daily fish, outfits and research tasks.
- Only credential hashes are stored in D1.
- Daily tasks deduplicate by UTC date; care cooldowns and XP caps apply.
- Revision compare-and-swap prevents concurrent double awards.
- Research tasks award once per type per day. These are engagement rewards, not proof of reading or actual trades.
- 30 requests/minute/profile, 5 new profiles/day/IP; mitigations, not Sybil resistance.
- Balance checks cache for one minute and fail to base access. Client-supplied XP/balances/tiers are ignored.
- No signature means no ownership proof. Multiple profiles may observe one public address.
- Local markets/watchlists/paper positions are not backed up.

Use current Wrangler for production. Configuration uses the current compatibility date; an older local runtime may need an earlier date for testing. Verify deployed health and profile/care flows before announcing availability.
