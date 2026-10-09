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
| `minTier` | Lowest tier the operator accepts (`MIN_TIER`); tiers below it are refused with `TIER_BELOW_MIN` |
| `feeEstimate` | `{low, mid, high}` in uSTX: the opening bid for each tier (the name is kept for SDK compatibility; nothing is estimated) |
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
| `BAD_SIGNATURE` | 400 | The origin signature does not verify against the origin account over the sponsored sighash |
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
| `TIER_BELOW_MIN` | 409 | Tier below the operator's `minTier` |
| `TIER_TOO_SMALL` | 400 | The tier cannot carry the network's admission floor (`length × 1 uSTX`); the message names the lowest tier that can. Unreachable with this contract call, a guard |
| `ORIGIN_NONCE_IN_FLIGHT` | 409 | The relay already has a transaction in flight for this origin nonce; the message names its txid when it was broadcast |
| `INSUFFICIENT_SBTC` | 400 | Origin holds less sBTC than `amount` |
| `BAD_NONCE` | 409 | Origin nonce differs from the chain's `possible_next_nonce` |
| `QUOTE_BELOW_MIN_OUT` | 409 | The relay's own re-quote of the selected pool is below `min-out` |
| `RATE_LIMITED` | 429 | Per-origin or global hourly cap reached |
| `SPONSOR_BUSY` | 503 | The tier's key has `maxPendingPerKey` transactions pending |
| `UPSTREAM_RATE_LIMITED` | 503 | The chain API rate-limited the relay's own reads (HTTP 429); nothing was signed |
| `BROADCAST_FAILED` | 502 | The node rejected the sponsored transaction; the message carries the node's reason |

A verdict about the transaction itself (`MALFORMED` through `BAD_POST_CONDITIONS`, `BAD_SIGNATURE`, `INSUFFICIENT_SBTC`, `TIER_TOO_SMALL`) is final: the SDK stops trying other relays. So is `ORIGIN_NONCE_IN_FLIGHT`: the swap is already on its way and another relay would only make a twin. The rest are relay or timing conditions and the SDK moves to the next relay.

## Verification (pure, no network)

`relay/src/core/verify.ts`, in order: deserialize; auth type `Sponsored` and no sponsor signature yet; chain id `1`; single-signature origin (`P2PKH` or `P2WPKH`); the origin signature verifies (`verifyOrigin`); payload is a contract call to the pinned principal and function; six arguments with the right types; tier valid; `min-out >= tier`; pool whitelisted; bips at most `100`; deny mode; the post-condition set equals the expected three for the origin, amount, tier, min-out and pool (eq sBTC for pools 1 and 2, lte for pool 3). Nothing here costs the sponsor anything: a refused request is never broadcast.

## Preflight (chain reads)

Runtime aborts are paid by the sponsor (the network debits the fee and advances both nonces before rolling the state back), so the relay checks what it can before signing: the origin's sBTC balance covers `amount`; the origin nonce equals `possible_next_nonce`; the selected pool's live quote for `net` is at least `min-out`. The quote uses the same SDK math as integrators (`quoteXyk`, `quoteVelar`, `quoteDlmm`). A price move between preflight and mining can still abort; that is the residual cost of sponsoring and the reason for the tier margin.

## Fee policy

No fee estimator. Each tier opens at a fixed bid the operator sets, and the replace-by-fee ladder climbs from there on the tier's own schedule, never above the tier:

```
fee = min(max(openingBid[tier], byteLength * 1), tier)
```

| Tier | Opening bid (`OPENING_BID_*`) | Bumped after (`RBF_AFTER_SECONDS_*`) | Ladder |
| --- | --- | --- | --- |
| low | `3000` | 30 minutes | `3000`, `3300`, `3630`, ... up to `10000` |
| mid | `6000` | 30 minutes | `6000`, `6600`, `7260`, ... up to `100000` |
| high | `800000` | 10 minutes | `800000`, `880000`, `968000`, `1000000` |

`1` uSTX per byte is the network admission floor. No tier ever bids above its own tier, because the tier is what the user repays; the sponsor's margin is `tier - fee`. The bump is per tier, on the tier's own clock, and moves the bid within the bracket the user chose. Differences inside a bracket are the design; a low-tier bid never competes with a high-tier bid, because each tier has its own sponsor key and therefore its own nonce sequence.

`minTier` is an operator setting (`MIN_TIER`, default `low`), not a market reading. Raise it to stop sponsoring a bracket; the relay then refuses that tier with `TIER_BELOW_MIN` and publishes the new minimum so the SDK skips it.

Why no estimator. The node's `POST /v2/fees/transaction` is not a market price: a handful of mispriced mempool transactions pull the middle and high estimates up by orders of magnitude. Observed on 2026-09-29 with 17 transactions in the mempool: contract-call p75 of 1051 STX, and estimates of 632 / 632717 / 712364 uSTX for a swap that clears at 3000. A relay that trusted it computed `minTier` `high` and refused every user. Under-bidding is corrected by the ladder; a refusal is corrected by nothing. So the relay bids what the operator decided the bracket is worth and lets the ladder do the rest.

Accepted risk: under real congestion every tier opens below the clearing price and waits for its ladder; with one key per tier the bracket's transactions then queue behind each other. That is accepted for now, since use is low. The mitigation when it matters is more keys per bracket so each key has at most one pending transaction, not an estimator.

What the brackets buy is fairness, not speed. Stacks blocks arrive every few seconds and the mempool is rarely contested, so `3000` uSTX and `800000` uSTX are mined in the same block on a normal day. The user pays the tier either way. The policy decides who keeps the difference: the miner, or the sponsor. High hands most of it to the miner.

## Keys and nonces

Three keys, one per tier, so a low-tier queue cannot block mid or high. Per key the relay keeps `next` and `pending` nonces, reconciles them against Hiro's `/extended/v1/address/{addr}/nonces` on every request (a reported missing nonce is filled first, the chain view wins when it is ahead), caps pending at `maxPendingPerKey` (default `20`; the network's chaining limit is `25`, per `MAXIMUM_MEMPOOL_TX_CHAINING`), and on a `BadNonce` or `ConflictingNonceInMempool` rejection gives the nonce back, forgets the local counter and retries once with the chain's view.

Allocation is one atomic step in the store (`allocateNonce`: reconcile, take, record as pending, advance), and the store has one writer per key. This is what prevents twins. The chain's view of both the sponsor and the origin lags a broadcast by seconds, so two submissions in that window (a double click, a retry after the app's timeout) would both pass the nonce checks and both sign the same sponsor nonce; one of them would then vanish once the other mined, which is what happened on 2026-09-30 at sponsor nonce 5 of the low key. An eventually consistent store cannot carry this counter: Cloudflare KV may serve a read up to 60 seconds stale, which is exactly how the two twins were signed. The Worker therefore keeps nonces, pending records and the in-flight memory below in Durable Objects, one instance per tier, each single-threaded with strongly consistent storage; the Node adapter is one process and needs nothing more.

One sponsored transaction per origin nonce. Before any chain read, the relay reserves `(origin, nonce)` in a store instance shared by all tiers (`origins`); a second request for the same pair is refused with `ORIGIN_NONCE_IN_FLIGHT`, naming the pending txid, and costs nothing. A reservation without a txid (a request still running, or one that died between reserve and release) expires after two minutes; one with a txid lives until the sweep sees the origin nonce executed, or six hours. The reservation is per origin rather than per key because a twin can arrive on a different tier than the first submission.

More keys per tier is deferred (see decisions log, 2026-09-30): it buys throughput and confirmation independence, one transaction in flight per key, but not twin prevention, which the reservation already provides with one key or many. The shape when it comes: `keys` becomes `Record<TierName, SponsorKey[]>` and the tier's object picks the key with the fewest pending.

## Replace-by-fee sweep

Every 10 minutes (Worker Cron Trigger, or a timer in the Node adapter): drop pending records the chain has executed; for records pending longer than the tier's `rbfAfterSeconds`, re-sponsor the original user transaction at the same sponsor nonce with `fee + 10 percent` (at least `+1` uSTX, the mempool requires a strictly higher total fee), never above the tier; records already at the tier are reported as stuck for operator attention. Low and mid wait 30 minutes: a bump there is a correction, not the plan. High waits one sweep interval, 10 minutes, so it reaches the user's full tier as fast as the mempool rule allows: `800000`, `880000`, `968000`, `1000000` over 30 minutes, then stuck. The margin on the high tier is meant for the miner, not the sponsor. Mempool garbage collection is about 42.7 hours in Nakamoto, so a stuck record resolves by itself if nothing else does.

## Rate limits and state

Defaults: `5` requests per origin per hour, `500` per relay per hour. State is per-key nonces, pending records (3 day TTL), origin reservations, and rate-limit windows. In the Worker the first three live in Durable Objects (`TierState`, instances `low`, `mid`, `high`, `origins`) and only the rate-limit windows in KV, where a lost update under-counts by one request and costs nothing; in the Node adapter everything is one JSON file.

## Threat model

| Threat | Mitigation |
| --- | --- |
| Abort griefing (sponsor pays for failing transactions) | Verification of the exact post-conditions, balance and nonce checks, live re-quote, per-origin rate limit, fee capped at the tier |
| Fee market spike | RBF ladder within the tier on the tier's schedule; `OPENING_BID_*` and `MIN_TIER` are the operator's dials; more keys per bracket when queues form (accepted risk, see fee policy) |
| Nonce gap blocks a key | Missing-nonce fill, chain-view reconcile, per-tier isolation, `maxPendingPerKey` headroom, RBF at the same nonce |
| Twin transactions (double submission inside the chain's indexing lag) | Atomic nonce allocation in a single-writer store; origin-nonce reservation refused with `ORIGIN_NONCE_IN_FLIGHT`; the app follows the wallet's nonce, not one txid |
| Chain API rate limit | Reads retried with backoff inside the client timeout; `UPSTREAM_RATE_LIMITED` instead of `INTERNAL` so the SDK moves on; an API key on the relay (50 requests per minute on the free plan) |
| Key exposure | Keys hold only working STX; each is a separate account; rotate by generating a new key and updating the secret; the contract needs no registration of sponsors |
| Wallet drops post-conditions | Refused with `BAD_POST_CONDITIONS`; a sponsored transaction cannot reach the chain without them |
| Another relay intercepts the signed hex | Harmless to the user (the user pays the tier either way); the relay that co-signs earns the rebate |

## Adapters

`relay/src/adapters/worker.ts` (Cloudflare Worker: Durable Object binding `TIER_STATE`, KV binding `RELAY_KV` for rate limits, Cron Trigger, secrets) and `relay/src/adapters/node.ts` (Node HTTP, file state, `Dockerfile`). Both call the same `route()` and `handleSponsor()`. Measured cost of verify plus sign plus route: about 6.6 ms per request in Node on the build machine; the Workers Free plan allows 10 ms of CPU per request, so confirm with `wrangler tail` after deploying and move to the paid plan if requests exceed it.
