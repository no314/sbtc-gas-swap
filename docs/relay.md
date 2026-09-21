# Relay: sbtc-gas-relay

The relay is the one component that cannot be static: it holds STX-funded keys and co-signs user transactions at request time. It does five things in order: verify, apply policy, preflight, co-sign with the tier's key, broadcast. Source: [`relay/`](../relay/). Deployment: [operator guide](operator-guide.md).

Anyone can run one. The contract pays whoever co-signed (`tx-sponsor?`), so every relay is self-funding from the first swap and no relay is privileged. [`sponsors.json`](sponsors.md) is a directory of known relays, not a gate.

## HTTP API

All responses are JSON with `access-control-allow-origin: *`.

### GET /healthz

`{"ok": true}`.

### GET /v1/info

| Field | Meaning |
| --- | --- |
| `contract` | The contract this relay sponsors calls to |
| `network` | `mainnet` |
| `sponsors` | `{low, mid, high}`: the address that co-signs each tier. The contract pays the rebate to it |
| `minTier` | Lowest tier the relay accepts at the current fee estimate, or `none` when even `high` does not cover the fee |
| `feeEstimate` | `{low, mid, high}` in uSTX: the fee the relay would bid for each tier right now |
| `feeFactor` | The operator's multiplier on the node estimate |
| `feePolicy` | `firstBid`, `rbfAfterSeconds` and `maxFee` per tier, plus `rbfBumpBips`: what the tier buys and how fast it is bumped |
| `maxPerOriginPerHour` | Requests accepted per origin address per hour |
| `pending` | `{low, mid, high}`: sponsored transactions not yet mined per key |
| `termsUrl` | The disclaimer the operator publishes |
| `version` | Relay version |

### POST /v1/sponsor

Request: `{"tx": "<hex>"}`, the transaction exactly as the wallet returned it (sponsored auth, fee `0`, origin signed).

Response `200`: `{"txid", "sponsoredTx", "fee", "tier", "sponsor"}`. `sponsoredTx` is the fully signed hex that was broadcast.

Errors: `{"code", "message"}` with these codes.

| Code | HTTP | Meaning |
| --- | --- | --- |
| `MALFORMED` | 400 | Not JSON, not hex, not a transaction, or a multisig origin |
| `NOT_SPONSORED_AUTH` | 400 | Standard auth, or a sponsor signature already present |
| `WRONG_NETWORK` | 400 | Chain id is not mainnet |
| `WRONG_CONTRACT` | 400 | Not a contract call to `sbtc-gas-swap-v1` |
| `WRONG_FUNCTION` | 400 | Not `swap-sbtc-for-gas` |
| `BAD_ARGS` | 400 | Wrong argument count or types, or amount `0` |
| `BAD_TIER` | 400 | Tier is not `10000`, `100000`, or `1000000` |
| `MIN_OUT_BELOW_TIER` | 400 | `min-out < tier` |
| `UNKNOWN_POOL` | 400 | Pool id not whitelisted |
| `BAD_BIPS` | 400 | Integrator bips above `100` |
| `BAD_POST_CONDITIONS` | 400 | Mode is not deny, or the set differs from the exact three ([contract.md](contract.md#post-conditions)) |
| `TIER_BELOW_MIN` | 409 | Tier below the relay's current `minTier` |
| `INSUFFICIENT_SBTC` | 400 | Origin holds less sBTC than `amount` |
| `BAD_NONCE` | 409 | Origin nonce differs from the chain's `possible_next_nonce` |
| `QUOTE_BELOW_MIN_OUT` | 409 | The relay's own re-quote of the selected pool is below `min-out` |
| `RATE_LIMITED` | 429 | Per-origin or global hourly cap reached |
| `SPONSOR_BUSY` | 503 | The tier's key has `maxPendingPerKey` transactions pending |
| `BROADCAST_FAILED` | 502 | The node rejected the sponsored transaction; the message carries the node's reason |

A verdict about the transaction itself (`MALFORMED` through `BAD_POST_CONDITIONS`, `INSUFFICIENT_SBTC`) is final: the SDK stops trying other relays. The rest are relay or timing conditions and the SDK moves to the next relay.

## Verification (pure, no network)

`relay/src/core/verify.ts`, in order: deserialize; auth type `Sponsored` and no sponsor signature yet; chain id `1`; single-signature origin (`P2PKH` or `P2WPKH`); payload is a contract call to the pinned principal and function; six arguments with the right types; tier valid; `min-out >= tier`; pool whitelisted; bips at most `100`; deny mode; the post-condition set equals the expected three for the origin, amount, tier, min-out and pool (eq sBTC for pools 1 and 2, lte for pool 3). Nothing here costs the sponsor anything: a refused request is never broadcast.

## Preflight (chain reads)

Runtime aborts are paid by the sponsor (the network debits the fee and advances both nonces before rolling the state back), so the relay checks what it can before signing: the origin's sBTC balance covers `amount`; the origin nonce equals `possible_next_nonce`; the selected pool's live quote for `net` is at least `min-out`. The quote uses the same SDK math as integrators (`quoteXyk`, `quoteVelar`, `quoteDlmm`). A price move between preflight and mining can still abort; that is the residual cost of sponsoring and the reason for the tier margin.

## Fee policy

The market rate is the same for every tier: `market = max(estimate * feeFactor, byteLength * 1, feeFloorUstx)`.

- `estimate` is the node's middle estimate from `POST /v2/fees/transaction` for this payload; when the node has none (`400`), the floor is used.
- `feeFactor` defaults to `1.0`: the operator's dial. Raise it when transactions sit; the relay then bids more and publishes a higher `minTier`.
- `feeFloorUstx` defaults to `3000`; `1` uSTX per byte is the network admission floor.
- `minTier` is the lowest tier whose value is at least `estimate * feeFactor`. A tier below it is refused with `TIER_BELOW_MIN`, so the relay never sponsors at a loss.

The tier then sets the opening bid, so a user who paid for a higher tier gets a higher bid rather than a larger sponsor margin. `lowBid` is `min(market, 10000)`, the bid the low tier would place right now.

| Tier | Opening bid | Typical today (market `3000`) | Bumped after |
| --- | --- | --- | --- |
| low | `market` | `3000` | 30 minutes |
| mid | `max(market, 2 * lowBid)` | `6000` | 30 minutes |
| high | `max(market, 80% of the tier)` | `800000` | 10 minutes |

`fee = min(openingBid, tier)`. No tier ever bids above its own tier, because the tier is what the user repays; the sponsor's margin is `tier - fee`. The mid multiple and the high percentage are the `MID_FIRST_BID_MULTIPLE` and `HIGH_FIRST_BID_PCT` variables in `wrangler.toml`; setting `HIGH_FIRST_BID_PCT = "100"` makes the high tier bid its full 1 STX and leaves no room for a replacement.

What this buys is fairness, not speed. Stacks blocks arrive every few seconds and the mempool is rarely contested, so `3000` uSTX and `800000` uSTX are mined in the same block on a normal day. The user pays the tier either way. The policy decides who keeps the difference: the miner, or the sponsor. Above the market rate the high tier hands it to the miner.

## Keys and nonces

Three keys, one per tier, so a low-tier queue cannot block mid or high. Per key the relay keeps `next` and `pending` nonces, reconciles them against Hiro's `/extended/v1/address/{addr}/nonces` on every request (a reported missing nonce is filled first, the chain view wins when it is ahead), caps pending at `maxPendingPerKey` (default `20`; the network's chaining limit is `25`, per `MAXIMUM_MEMPOOL_TX_CHAINING`), and on a `BadNonce` or `ConflictingNonceInMempool` rejection forgets the local counter and retries once with the chain's view. Adding more keys per tier is a v2 change: `keys` becomes `Record<TierName, SponsorKey[]>` and the reconcile picks the key with the fewest pending.

## Replace-by-fee sweep

Every 10 minutes (Worker Cron Trigger, or a timer in the Node adapter): drop pending records the chain has executed; for records pending longer than the tier's `rbfAfterSeconds`, re-sponsor the original user transaction at the same sponsor nonce with `fee + 10 percent` (at least `+1` uSTX, the mempool requires a strictly higher total fee), never above the tier; records already at the tier are reported as stuck for operator attention. Low and mid wait 30 minutes: low bids the market rate and mid already opens high, so a bump there is a correction, not the plan. High waits one sweep interval, 10 minutes, so it reaches the user's full tier as fast as the mempool rule allows: `800000`, `880000`, `968000`, `1000000` over 30 minutes, then stuck. The margin on the high tier is meant for the miner, not the sponsor. Mempool garbage collection is about 42.7 hours in Nakamoto, so a stuck record resolves by itself if nothing else does.

## Rate limits and state

Defaults: `5` requests per origin per hour, `500` per relay per hour. State is per-key nonces, pending records (3 day TTL), and rate-limit windows: KV in the Worker, one JSON file in the Node adapter.

## Threat model

| Threat | Mitigation |
| --- | --- |
| Abort griefing (sponsor pays for failing transactions) | Verification of the exact post-conditions, balance and nonce checks, live re-quote, per-origin rate limit, fee capped at the tier |
| Fee market spike | `minTier` rises with the estimate; `feeFactor` dial; RBF within the tier; refusal when even `high` does not cover |
| Nonce gap blocks a key | Missing-nonce fill, chain-view reconcile, per-tier isolation, `maxPendingPerKey` headroom, RBF at the same nonce |
| Key exposure | Keys hold only working STX; each is a separate account; rotate by generating a new key and updating the secret; the contract needs no registration of sponsors |
| Wallet drops post-conditions | Refused with `BAD_POST_CONDITIONS`; a sponsored transaction cannot reach the chain without them |
| Another relay intercepts the signed hex | Harmless to the user (the user pays the tier either way); the relay that co-signs earns the rebate |

## Adapters

`relay/src/adapters/worker.ts` (Cloudflare Worker: KV binding `RELAY_KV`, Cron Trigger, secrets) and `relay/src/adapters/node.ts` (Node HTTP, file state, `Dockerfile`). Both call the same `route()` and `handleSponsor()`. Measured cost of verify plus sign plus route: about 6.6 ms per request in Node on the build machine; the Workers Free plan allows 10 ms of CPU per request, so confirm with `wrangler tail` after deploying and move to the paid plan if requests exceed it.
