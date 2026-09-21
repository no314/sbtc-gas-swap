# Operator guide: run a sponsor relay

For Werner first, and for any second operator (Hiro, Bitflow, a wallet) who wants an independent relay. Nothing here requires talking to Stacks Labs: the contract pays whichever relay co-signs.

Two paths. Path A (Cloudflare Worker) is the default and needs no server. Path B (Docker) is the appendix.

## Before you start

- A Cloudflare account on the free plan: dash.cloudflare.com/sign-up, email and password, verify the email, enable two-factor under My Profile, Authentication. No card, no domain. Open Compute (Workers), accept the Workers terms once, and choose a `workers.dev` subdomain. The Worker itself is created by `wrangler deploy`, not in the dashboard. Werner's subdomain is `labs2`, so the relay URL is `https://sbtc-gas-relay.labs2.workers.dev`.
- Optional: a Hiro API key (free) from platform.hiro.so. The relay works anonymously; the key only raises the per-IP request budget. Store it in your password manager if you make one.
- Node 22 or later and npm on your Mac (`node -v`).
- A funded STX wallet you control (Leather) to send the initial STX to the three sponsor addresses.
- The repo at `/Users/werner/Claude/Projects/sponsored-sbtc-stx-swap/sbtc-gas-swap`.

## Path A: Cloudflare Worker

Shortcut: `bash relay/scripts/bootstrap.sh` runs steps 1 to 9 below in order, pausing where you paste a secret or confirm funding. It is safe to rerun after a failure. The manual steps follow for reference.

Run every command from the `relay/` folder unless stated. Each step says what you should see.

### 1. Build and test locally

```
cd sdk && npm ci && npm run build && cd ../relay
npm ci
npm test
```

Expect: `# pass 53`, `# fail 0`.

### 2. Log in to Cloudflare from the terminal

```
npx wrangler login
```

A browser tab opens on your Cloudflare account; click Allow. The terminal prints `Successfully logged in`.

### 3. Create the KV namespace

```
npx wrangler kv namespace create RELAY_KV
```

Expect a line like `id = "0123abcd..."`. Open `relay/wrangler.toml`, find `[[kv_namespaces]]`, replace `REPLACE_WITH_KV_NAMESPACE_ID` with that id, and remove the `preview_id = "local"` line.

### 4. Generate the three sponsor keys

```
npm run keygen
```

Prints one new 24-word seed phrase and, derived from it with Leather's derivation path, three accounts: account 1 is the LOW sponsor, 2 MID, 3 HIGH. For each: mainnet address, the funding amount, the private key, and the exact `wrangler secret put` command. Save the seed phrase and the three keys in your password manager now; the seed phrase restores the whole sponsor wallet in Leather (Add wallet, restore from seed) so you can always see or move the STX. Nothing is written to disk. `MNEMONIC="..." npm run keygen -- --from-mnemonic --accounts N` re-derives accounts from any seed phrase, which is also how to get the private key of a Leather account (Leather account N is index N-1), for example the dust-swap user.

### 5. Fund the sponsor addresses

Send STX from your wallet to each of the three addresses. Suggested start: `2` STX to LOW, `5` STX to MID, `10` STX to HIGH. Each sponsored swap costs the key the network fee (about `0.003` to `0.02` STX today) and repays the tier (`0.01`, `0.1`, `1` STX), so the balances grow after the first swaps. Wait until the three transfers are confirmed (explorer.hiro.so, search each address).

### 6. Store the secrets

```
npx wrangler secret put SPONSOR_KEY_LOW
npx wrangler secret put SPONSOR_KEY_MID
npx wrangler secret put SPONSOR_KEY_HIGH
npx wrangler secret put HIRO_API_KEY   # optional
```

Each command asks for the value; paste it and press Enter. The terminal prints `Success! Uploaded secret`. The values never appear in `wrangler.toml` or in git.

### 7. Check the public settings

In `relay/wrangler.toml` under `[vars]`: `FEE_FACTOR = "1.0"`, `FEE_FLOOR_USTX = "3000"`, `PER_ORIGIN_PER_HOUR = "5"`, `GLOBAL_PER_HOUR = "500"`, `MAX_PENDING_PER_KEY = "20"`, `MID_FIRST_BID_MULTIPLE = "2"`, `HIGH_FIRST_BID_PCT = "80"`, `RBF_AFTER_SECONDS_LOW = "1800"`, `RBF_AFTER_SECONDS_MID = "1800"`, `RBF_AFTER_SECONDS_HIGH = "600"`, `CONTRACT_ID`, `TERMS_URL`. Leave the defaults for the first deploy. `CONTRACT_ID` must be the deployed contract; see [contract.md](contract.md#deployment).

Those five set what a tier buys. Low bids the market rate. Mid opens at twice the low bid. High opens at 80 percent of its tier. A pending transaction is bumped 10 percent after the tier's wait: 30 minutes for low and mid, 10 minutes (every sweep) for high, so high reaches the user's full tier within half an hour. Raising `HIGH_FIRST_BID_PCT` to `100` makes high bid its full 1 STX immediately and leaves no room for a replacement, so the transaction can only wait. Full derivation in [relay.md](relay.md#fee-policy).

### 8. Deploy

```
npm run build
npx wrangler deploy
```

Expect `Deployed sbtc-gas-relay triggers` and the URL `https://sbtc-gas-relay.<subdomain>.workers.dev`, plus `schedule: */10 * * * *` (the RBF sweep).

### 9. Verify

```
curl https://sbtc-gas-relay.<subdomain>.workers.dev/healthz
curl https://sbtc-gas-relay.<subdomain>.workers.dev/v1/info
```

`/v1/info` must show your three sponsor addresses under `sponsors`, `minTier` `low`, and `feeEstimate` values between `3000` and the tier (today: about `3000` low, `6000` mid, `800000` high). `feePolicy` repeats the opening bids and the bump cadence. If it shows an error about a key, a secret is missing or malformed: repeat step 6 for that name.

### 10. First real swap

From `sdk/`, with a throwaway account holding a few hundred sats of sBTC (never a main wallet key):

```
DUST_USER_KEY=<hex key> RELAYS=https://sbtc-gas-relay.<subdomain>.workers.dev AMOUNT_SATS=1000 TIER=low npm run dust-swap
```

The script prints the quote, the relay's answer and polls until the transaction is mined, then compares `received` with the quote to the uSTX. Then check `/v1/info` again: `pending.low` back to `0`, and the LOW address balance up by `0.01` STX minus the fee.

### 11. List the relay

Add your URL to [`docs/sponsors.json`](sponsors.json) in a pull request (format in [sponsors.md](sponsors.md)), then run `bash scripts/publish-stx-fan.sh` so the file reaches `https://stx.fan/zero_to/gas/sponsors.json`. The SDK and the dapp discover relays from that URL and rank them by `/v1/info`.

### 12. Watch it

- `npx wrangler tail` streams requests, errors, and the RBF sweep log line every 10 minutes. Watch the CPU time on `/v1/sponsor` during the first swaps: the free plan allows 10 ms per request; if you see `Exceeded CPU` errors, upgrade to Workers Paid (5 USD per month) in the dashboard. Nothing else changes.
- Balances: check the three addresses weekly at first. A key that stops growing while `pending` stays high means transactions are stuck; the sweep reports `stuck` in the log.
- Turn the dial: raise `FEE_FACTOR` in `wrangler.toml` (for example `1.5`) and redeploy when transactions take more than a few blocks; `minTier` rises accordingly and the relay refuses tiers it would lose on. `FEE_FACTOR` lifts every tier's floor; `MID_FIRST_BID_MULTIPLE` and `HIGH_FIRST_BID_PCT` change only what the mid and high tiers open at.
- Rotate a key: `npm run keygen`, fund the new address, `wrangler secret put SPONSOR_KEY_<TIER>` with the new key, redeploy, then move the remaining STX off the old address.

## Publish the demo app and sponsors.json

Two files must be reachable over HTTPS: `sponsors.json`, which the SDK reads to discover relays, and `disclaimer.html`, which the relay publishes as `termsUrl`. Both ship with the demo app to stx.fan.

```
git clone git@github.com:no314/stx-fan.git ../stx-fan   # once
bash scripts/publish-stx-fan.sh
cd ../stx-fan && git add zero_to/gas && git commit -m "sbtc-gas: publish" && git push
```

The script builds the SDK and the app, runs the fixture harness, and stages `app/dist/` plus `docs/sponsors.json` into `../stx-fan/zero_to/gas/`. It never commits. `deploy.html` is excluded: that page is the local-only Ledger deploy tool. Live at `https://stx.fan/zero_to/gas/`.

The source repo itself needs no website. Integrators install `@no314/sbtc-gas-swap` from npm and read `docs/` on GitHub.

## Contract deploy with Leather and a Ledger

The deployer account lives on a Ledger, so the deploy goes through Leather instead of `scripts/deploy-mainnet.mjs`:

```
cd app && npm run dev
```

Open `http://localhost:5173/deploy.html` in the browser with Leather. The page hashes the reviewed source (must match `5702f09a5ab5…`), connects Leather (switch to the Ledger account `SP2BM6AQSMQ04CX8KDE62QBFVZTDZ2ZX80GZJSBZ4`; the page refuses any other account), and sends `stx_deployContract` (Clarity 3, deny mode, no post-conditions). Confirm on the Ledger. The page shows the txid and an explorer link. When mined, run `node scripts/pin-contract.mjs` in `contracts/` and paste the publish height into `docs/contract.md`. The page is a build entry (`dist/deploy.html`) but is not linked from the app.

## Path B: Docker on your own server (appendix)

Same code, file state instead of KV. From the repo root:

```
cd sdk && npm ci && npm run build && cd ../relay && npm ci && npm run build
cd .. && docker build -f relay/Dockerfile -t sbtc-gas-relay .
docker run -d --name sbtc-gas-relay -p 8787:8787 -v sbtc-gas-relay-state:/state \
  -e SPONSOR_KEY_LOW=... -e SPONSOR_KEY_MID=... -e SPONSOR_KEY_HIGH=... \
  -e HIRO_API_KEY=... -e STACKS_API_URL=https://api.hiro.so \
  -e CONTRACT_ID=SP2BM6AQSMQ04CX8KDE62QBFVZTDZ2ZX80GZJSBZ4.sbtc-gas-swap-v1 sbtc-gas-relay
curl localhost:8787/v1/info
```

To use your own stacks-node for reads and broadcasts set `STACKS_API_URL` to it; the relay then falls back from the Hiro `/extended` nonce endpoint to `/v2/accounts`, which does not see the mempool, so keep `MAX_PENDING_PER_KEY` low (for example `5`) in that mode. Put the container behind TLS (Caddy or the like) before publishing its URL. This path is optional; a second independent operator using Path A gives the same redundancy without exposing a home server.

Handoff for a Cowork session on the node: connect the repo folder, then ask for "build the relay Docker image from relay/Dockerfile, run it with the environment in relay/.env.example filled from my password manager, and put Caddy in front on <domain>". The keys are pasted by you, never stored in the repo.
