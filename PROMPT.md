# Build prompt: sBTC to Stacks gas

A self-sufficient sponsored swap: a user who holds sBTC and no STX swaps sBTC to STX in one transaction whose network fee is paid by a sponsor, and the sponsor is repaid inside that same transaction. No subsidy, no server-side eligibility, no hardcoded sponsor.

Repository: this folder (single repo). Owner: Werner, Stacks Labs. Date of this prompt: 2026-09-05.

## 0. How to read this prompt

Load and follow `static-first-architecture`, `stacks-dapp-architecture`, and `stacks-labs-dapp-design`. They govern the static parts (dapp, docs, SDK), the security tier, post-conditions, contract pinning, wallet gating, and the dapp's look. Section 12 of this prompt lists what those skills do not cover and supplies it. Where this prompt and a skill conflict, this prompt wins only inside section 12; everywhere else the skill wins.

Reference material: `reference/` in this repo holds copies of the source apps the skills say to copy from (see section 13 for the file list). `docs/research-findings.md` and `docs/decisions-log.md` hold the verified chain facts and the decision history; every number in this prompt traces to them. Re-verify every on-chain figure against the chain before it reaches code or copy; the skills require it and several figures here (reserves, fees) are already stale by definition.

Security tier: 3 (production, value-moving, adversarial, multiple users). Mainnet from the first line. No testnet pools exist reliably; testing is simnet with pool mocks plus mainnet dust-size smoke tests.

Be critical of this prompt. Where a requirement is wrong on the evidence, stop and say so before building around it.

## 1. Objective and non-goals

Objective: a wallet or dapp integrator adds one SDK call and its users can turn sBTC into STX with zero STX in hand. Primary integrator: Leather (leather-io/mono, provider pattern per PR #2554). Secondary: Bitflow. When a design choice favors one, favor Leather. The standalone dapp exists to test and demo; the integrable service (contract, relay, SDK, docs) is the deliverable.

Non-goals: BTC to sBTC bridging (sbtc.stacks.co does that; link out). Custom fee amounts. Configurable pool choice by end users. Any asset other than sBTC in and STX out. Mutable fee rates or a mutable pool whitelist (new contract version instead). Running a sponsor for anyone but ourselves (others run their own from this repo).

## 2. Glossary (use verbatim in code, copy, state)

- **swap amount** (P): sBTC the user puts in, in sats.
- **tier**: the STX fee budget the user chooses: `low` 0.01 STX (10,000 uSTX), `mid` 0.1 STX, `high` 1 STX. No other values.
- **rebate** (a): STX moved from the user to `tx-sponsor?`, equal to the tier. Not the actual fee; Clarity cannot read the fee.
- **service fee** (b): 50 bips of P in sBTC, to the fixed `fee-recipient` constant in the contract. Immutable.
- **integrator fee** (c): 0 to 100 bips of P in sBTC, to an optional `integrator` principal passed as an argument. Zero when none.
- **net input**: P minus b minus c, the sBTC that reaches the pool.
- **quote**: STX the chosen pool returns for net input at read time.
- **min-out**: quote times (1 minus slippage), floored. Must be at least the tier.
- **slippage**: user-visible tolerance. Default 10 percent when P is at most 30,000 sats, 1 percent above. User may raise it; no upper cap beyond what the pool accepts.
- **pool id**: small uint the SDK passes selecting one whitelisted pool.
- **sponsor**: the relay key that co-signs and pays the network fee. Three keys, one per tier.
- **relay**: the service that verifies, preflights, co-signs, broadcasts.
- **sponsors.json**: static list of known relay endpoints served from `https://stx.fan/zero_to/sbtc-gas/sponsors.json`.

## 3. Network identity

Pin per `stacks-dapp-architecture`. Mainnet only for the deployed service; testnet deployer address is reserved for a future testnet deploy when pools exist. Deployers: mainnet `SP2BM6AQSMQ04CX8KDE62QBFVZTDZ2ZX80GZJSBZ4`, testnet `ST2BM6AQSMQ04CX8KDE62QBFVZTDZ2ZX80G22E500`. sBTC: `SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token` (8 decimals). Read API default `https://api.hiro.so`, overridable for reads only via `?api=`.

## 4. Contract: `sbtc-gas-swap-v1` (Clarity 3, Clarinet project in `contracts/`)

### 4.1 Public function

```
(swap-sbtc-for-gas
  (amount uint)            ;; P in sats, > 0
  (tier uint)              ;; u10000 | u100000 | u1000000 uSTX, else ERR_BAD_TIER
  (min-out uint)           ;; >= tier, else ERR_MIN_OUT_BELOW_TIER
  (pool-id uint)           ;; whitelisted, else ERR_UNKNOWN_POOL
  (integrator (optional principal))
  (integrator-bips uint))  ;; 0..100, else ERR_BAD_BIPS; ignored when integrator is none
```

Order of operations, all with `tx-sender` = user, contract never holds assets:

1. Assert `tx-sponsor?` is `some`; else ERR_NOT_SPONSORED. (A non-sponsored call is allowed to fail: the whole point is the sponsor repayment. Confirm with Werner during build whether to allow unsponsored calls that skip the rebate. Default: refuse.)
2. b = `(/ (* amount u50) u10000)` sBTC transfer user to `FEE_RECIPIENT` (skip transfer if b is 0).
3. c = `(/ (* amount integrator-bips) u10000)` sBTC transfer user to integrator if some and c > 0.
4. net = amount minus b minus c; assert net > 0.
5. Branch on pool-id and call the pool's swap function with net and min-out (see 4.2). Capture STX received.
6. `(stx-transfer? tier tx-sender sponsor)`. Since received >= min-out >= tier, the user can pay.
7. Return `(ok {received: uint, rebate: tier, service-fee: b, integrator-fee: c, pool-id: pool-id})`.
8. Emit one `print` with the same tuple plus `sponsor` and `user`.

Constants: `FEE_BIPS u50` (immutable). Pool principals as constants (immutable). Data vars: `fee-recipient` (initial: the deployer) and `owner` (initial: the deployer). Public functions `set-fee-recipient (principal)` and `transfer-ownership (principal)`, owner only, ERR_NOT_OWNER otherwise, each emitting a print. The receiver is mutable because it changes only where b lands, never what the user receives; rate and whitelist stay immutable so integrators can rely on them. Error codes as `(err uNNN)` constants, documented in `docs/contract.md`.

### 4.2 Pool whitelist (mainnet, verify each before pinning)

- Pool 1: Bitflow XYK. Core `SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.xyk-core-v-1-2`, pool `SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.xyk-pool-sbtc-stx-v-1-1`, x = sBTC, y = `SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.token-stx-v-1-2`. Call `swap-x-for-y (pool) (x-token) (y-token) (x-amount) (min-dy)`. Quote (off chain): `get-dy` via call-read, or `xyk-swap-helper-v-1-2 get-quote-a`.
- Pool 2: Velar univ2 pool 70. `SP20X3DC5R091J8B6YPQT638J8NR1W83KN6TN5BJY.univ2-pool-v1_0_0-0070`, fees `SP20X3DC5R091J8B6YPQT638J8NR1W83KN6TN5BJY.univ2-fees-v1_0_0-0070`, token0 `SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.wstx`, token1 sBTC. Call `swap (token-in) (token-out) (fees) (amt-in) (amt-out-desired)`. Minimum 2 sats. Quote (off chain) from `get-pool` reserves with `adj = floor(amt * 9970 / 10000)`, `out = r_out * adj / (r_in + adj)`.
- Pool 3: Bitflow DLMM. Router `SP1PFR4V08H1RAZXREBGFFQ59WB739XM8VVGTFSEA.dlmm-swap-router-v-1-1`, pool `SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-pool-stx-sbtc-v-2-bps-15`, x = STX wrapper, y = sBTC (reversed). Call `swap-y-for-x-simple-multi (pool) (x-token) (y-token) (y-amount) (min-dx)`. No on-chain quote; the SDK quotes from `get-active-bin-id` and `get-bin-balances` off chain, or by call-read of the router function if the node allows it (test this; it may hit NotReadOnly). If DLMM cannot be quoted reliably off chain in v1, ship pools 1 and 2, keep the DLMM branch behind a compile-time exclusion, and document why.

Static trait references are fine in public functions. The contract calls each pool directly with its own known principals; no trait arguments from the caller (a trait argument would let a caller substitute a pool; the whitelist is the point).

All pools pull from `tx-sender` and pay to `tx-sender` (verified: none gate on `contract-caller`). Re-verify against deployed source, not docs.

### 4.3 Post-conditions the caller must set (deny mode)

- user sends sBTC `eq` P (covers b, c, net together).
- user sends STX `eq` tier.
- the pool principal (pool 1: the xyk pool contract; pool 2: the univ2 pool; pool 3: the dlmm pool) sends STX `gte` min-out to the user. For pool 1 the STX leaves the pool via `token-stx-v-1-2` `pool-transfer`; confirm which principal is the sender in the resulting event and pin that.
- Nothing else moves. The relay rejects any tx whose post-condition set differs from exactly this.

### 4.4 Tests (Clarinet, written before the contract body)

Unit tests per error code; arithmetic tests for b and c at 1, 199, 200, 201, 30,000, 10,000,000 sats (floors to zero below 200 sats for b; state that in docs); min-out below tier; each pool branch with a mock pool contract that implements the same signature and a settable output; sponsored versus unsponsored call (simnet cannot set `tx-sponsor?`; test the guard by extracting the sponsor-dependent step into a private function exercised via a test-only wrapper, or document the gap and cover it on mainnet). Runtime cost per branch recorded (`clarinet` cost reports) and committed to `docs/contract.md`; this feeds the relay's fee estimate.

### 4.5 Deploy and pin

Deploy from the mainnet deployer. Record txid, block, and the structure hash (per `stacks-dapp-architecture` "Verify the source") in `sdk/src/contracts.ts` and `docs/contract.md`. The SDK verifies live source against the pinned hash before offering the swap.

## 5. Relay: `relay/` (TypeScript, one module, two adapters)

### 5.1 Endpoints

- `GET /v1/info` returns `{ contract, network, sponsors: { low: addr, mid: addr, high: addr }, minTier, feeEstimate: { low, mid, high } uSTX, feeFactor, maxPerOriginPerHour, version }`.
- `POST /v1/sponsor` body `{ tx: hex }` returns `{ txid, sponsoredTx: hex, fee, tier, sponsor }` or a typed error `{ code, message }` with codes: NOT_SPONSORED_AUTH, WRONG_CONTRACT, WRONG_FUNCTION, UNKNOWN_POOL, BAD_TIER, TIER_BELOW_MIN, BAD_POST_CONDITIONS, INSUFFICIENT_SBTC, BAD_NONCE, QUOTE_BELOW_MIN_OUT, RATE_LIMITED, SPONSOR_BUSY, BROADCAST_FAILED.
- `GET /healthz`.

### 5.2 Verification (pure module, tests first)

Deserialize with `@stacks/transactions` v7. Assert: auth type Sponsored; payload ContractCall to the pinned contract and function; args parse and tier is one of three; tier >= relay minTier; post-condition mode Deny and the set equals section 4.3 exactly (amounts derived from the args); origin address has sBTC balance >= P (call-read `get-balance`); origin nonce equals `possible_next_nonce` from Hiro nonces endpoint, else BAD_NONCE; re-quote the selected pool via call-read with the relay's own read path and assert quote >= min-out, else QUOTE_BELOW_MIN_OUT (cheaper than an on-chain abort the sponsor would pay for); per-origin rate limit (default 5 per hour) and a global per-hour cap.

### 5.3 Fee and nonce policy

- Fee = `min(tier, max(floor, estimate * feeFactor))` where estimate comes from `/v2/fees/transaction` middle estimate with the recorded cost of the chosen pool branch, floor = 1 uSTX per byte, `feeFactor` default 1.0 (Werner's dial). `minTier` = the lowest tier whose value >= fee for the most expensive whitelisted branch at current estimate times factor. Publish both.
- Three sponsor keys, one per tier; the key for the tx's tier signs. Nonce per key tracked in KV (Worker) or a JSON file (Node); reconcile against Hiro `nonces` on every request; on `BadNonce` or `ConflictingNonceInMempool`, refetch once and retry; chaining cap 20 pending per key (network limit is 25), else SPONSOR_BUSY.
- RBF: a scheduled task every 10 minutes re-signs any sponsor tx pending longer than 30 minutes with fee plus 10 percent, never above the tier. Log it.
- Keys: generated by `relay/scripts/keygen.mjs` locally, written to Worker secrets or a `.env` never committed. The repo ships `.env.example` only. Each key self-funds through the rebate; initial funding a few STX each.
- Design so that keys per tier can become a list in v2; document the change in `docs/operator-guide.md`.

### 5.4 Adapters

- `relay/src/core/`: pure verification, fee, nonce logic; `node --test` suites first.
- `relay/src/worker.ts`: Cloudflare Worker adapter (fetch handler, KV binding, Cron Trigger for RBF). Measure CPU time of deserialize plus sign; the free plan allows 10 ms per request. If exceeded, document the paid plan requirement (5 USD per month) rather than degrading verification.
- `relay/src/node.ts`: Node HTTP adapter for Docker, same core, JSON state file. Optional deployment; documented, not required.
- `relay/wrangler.toml`, `relay/Dockerfile`.

### 5.5 Operator guide (`docs/operator-guide.md`, step by step, for Werner)

Cover: creating the Cloudflare account (email required, free plan, no card), installing wrangler, `wrangler login`, creating the KV namespace, generating three keys with the keygen script, funding each with STX (amounts and why), `wrangler secret put` for each key, setting `FEE_FACTOR` and `HIRO_API_KEY` (free key, 500 requests per minute), `wrangler deploy`, verifying `/v1/info`, adding the URL to `docs/sponsors.json`, monitoring (a `GET /v1/info` check plus balance alerts), turning the fee dial, rotating a key, and the Docker path as an appendix. Plus a handoff section for a Cowork session on the node if the Docker path is used.

## 6. SDK: `sdk/` (`@no314/sbtc-gas-swap`, TypeScript, ESM, exact pins)

Functions, each with tests first:

- `getPools(client)`: reads reserves and state of whitelisted pools via call-read.
- `quote({ amountSats, integratorBips }, client)`: computes b, c, net; quotes every eligible pool; DLMM excluded when the best non-DLMM quote is at most 100 STX (its runtime cost is not worth it for small swaps; make the threshold a constant and document it); picks the highest output; ties by STX reserve; returns `{ poolId, quote, b, c, net, impactBps }`.
- `defaultTier({ amountSats, relayInfo })`: amount tier (low up to 30,000 sats; high from 10,000,000 sats; mid between), then `max(amountTier, relayInfo.minTier)`.
- `defaultSlippage(amountSats)`: 10 percent up to 30,000 sats, 1 percent above.
- `buildCall({ amountSats, tier, slippage, poolId, integrator, integratorBips, quote })`: returns `{ contractAddress, contractName, functionName, functionArgs, postConditions, postConditionMode: 'deny', sponsored: true, fee: 0 }` in the shape Leather's `StacksContractCallSwapExecutionData` expects plus the sponsored flag. Asserts min-out >= tier, else throws with a message the UI shows ("raise the amount or lower the tier").
- `verifyContract(client)`: live source structure hash equals pinned.
- `listSponsors()`: fetches `sponsors.json`, then `/v1/info` from each; returns those whose minTier <= chosen tier, healthy first.
- `submit({ signedTxHex, relays })`: POST to relays in order until one accepts; maps error codes to user messages; returns `{ txid, relay }`.
- `explainFailure(txResult)`: maps on-chain abort codes (pool ERR_MINIMUM_RECEIVED, contract errors) to actionable text ("price moved; retry with 2 or 5 percent slippage").
- `leather/`: an adapter file implementing Leather's `SwapProviderService` shape against PR #2554 types (`getBaseProviderAssets`, `getTargetProviderAssets`, `getSwapQuotes`, `getSwapExecutionData`) plus a proposed `sponsored-stacks-contract-call` execution type and a `sponsored` fee mode, with a `docs/leather-integration.md` describing the exact files in mono to touch. Do not depend on the mono package; mirror the types locally and say so.
- `bitflow/`: `docs/bitflow-integration.md` describing how Bitflow's aggregator can surface this as a route (quote via our SDK, execute via relay) and how to pass their principal as `integrator`.

Parity test: `sdk/test/quote.parity.test.mjs` recomputes the XYK and Velar quotes from the exact contract formulas against recorded reserve fixtures with real proportions (fixture header states which values are recorded).

## 7. Dapp: `app/` (Vite, React, static, design skill)

Name: **sBTC to Stacks gas**. Step flow, 4 steps, numbered from 1:

1. Connect: wallet selector per `stacks-dapp-architecture` three tiers. Leather verified. Xverse offered untested with the label and the note that the relay rejects any transaction lacking the exact post-conditions, so a wallet that drops them cannot get sponsored. Others per the connect library table.
2. Amount: sBTC amount input with balance; live quote line (pool used, STX out, b, c, tier, min-out, impact) stamped with read time and block; tier selector defaulting per SDK with relay minimum shown; slippage control defaulting per SDK, editable; a warning when min-out is below tier with the fix.
3. Sign and sponsor: shows the post-conditions in plain words, calls the wallet with `sponsored: true`, forwards the hex to the first accepting relay, shows the txid and relay used. Fresh quote immediately before signing; block if it dropped below min-out.
4. Done: STX received, explorer link, "Next steps" (the user now has gas; link out). Failure states: mapped messages from `explainFailure`, with a retry that re-quotes and proposes 2 or 5 percent slippage.

Footer: persistent disclaimer link. Persistence: zero-persistence case (no anchor before broadcast; after broadcast the txid lives in the URL as `?txid=`). URL contract: `?chain=mainnet&api=...&txid=...`.

Legal page `app/disclaimer.html` (second Vite entry, same tokens): the software and any relay are provided as is, without warranty; no guarantee of sponsorship, execution, price, or availability; all responsibility rests with the user or integrator; the relay operator may refuse any transaction; governing law New Jersey, USA; not legal advice; Werner to have counsel review before launch. Link it from the dapp footer and the relay `/v1/info` response (`termsUrl`).

## 8. Docs: `docs/` (markdown, read on GitHub)

`index.md` overview, `contract.md`, `relay.md` (API and error codes), `sdk.md`, `leather-integration.md`, `bitflow-integration.md`, `operator-guide.md`, `sponsors.json`, `disclaimer.md`, `research-findings.md`, `decisions-log.md`. Plain markdown rendered by GitHub. The repo needs no website: only the demo app, `disclaimer.html` and `sponsors.json` are published, to `https://stx.fan/zero_to/sbtc-gas/` by `scripts/publish-stx-fan.sh`.

## 9. Build order (TDD where the skills say)

1. `contracts/`: tests first (4.4), then the contract, then cost report, then mainnet deploy from the deployer, then pin the hash.
2. `relay/src/core/`: pure suites first (verification against fixtures of real signed sponsored txs recorded from a dust run; fee math; nonce reconciliation), then the core, then the Worker adapter, then a local `wrangler dev` run, then deploy to Werner's Cloudflare account, then `/v1/info` live.
3. `sdk/`: pure suites first (quote parity, tier and slippage defaults, post-condition builder, min-out assertion), then the SDK, then a Node smoke script `sdk/scripts/dust-swap.mjs` that performs a real mainnet dust swap with a throwaway user key holding a few hundred sats (this is the only place a key touches code outside the relay; it reads from env, never from the repo).
4. `app/`: harness fixtures first (quotes, relay info, wallet stub), then screens, then the browser harness against `dist/`, then three build-test-fix rounds against mainnet with Leather at dust size.
5. `docs/` and the operator guide, written as each layer lands, not at the end.
6. Screenshots from a committed script; deliver with the build.

## 10. Acceptance criteria

- A user with sBTC and 0 STX completes a 5,000 sat swap on mainnet through the dapp with Leather; the sponsor key receives exactly the tier; b lands at FEE_RECIPIENT; the user's STX equals received minus tier.
- The relay rejects: a non-sponsored tx, a call to another contract, a missing or altered post-condition, a tier below minTier, a min-out above the live quote, a user with insufficient sBTC, the sixth request from one origin in an hour.
- Each sponsor key's STX balance after N swaps is at least its starting balance (self-funding holds at feeFactor 1).
- `clarinet test`, `node --test` in relay and sdk, and the browser harness all pass offline; the harness asserts zero external requests in fixture mode, no em dash in rendered UI, disclaimer link present on every step.
- SDK quote for XYK and Velar matches the on-chain result of the dust swap to the uSTX.
- `docs/operator-guide.md` lets a second operator (Hiro, Bitflow) stand up an independent relay without asking Werner anything.

## 11. Known risks to state in the output

Sponsor pays the fee on on-chain abort; preflight reduces but does not remove it. Cloudflare free plan CPU limit may not fit signing. DLMM off-chain quoting may be unreliable. Xverse `sponsored` support unverified. `tx-sponsor?` payment means any relay that receives the signed hex can sponsor it (harmless to the user). b floors to zero below 200 sats.

## 12. What the three skills do not cover (this section is authoritative)

- Sponsored transaction mechanics: build with `sponsored: true, fee: 0`; the wallet returns `{ transaction }` hex and does not broadcast; the txid regex check from the skills does not apply until the relay returns a txid; the origin signature does not bind sponsor identity or fee; `tx-sponsor?` is `(some principal)` inside the call and survives nested calls.
- Hot-key operations: key generation and storage outside the repo, per-tier keys, nonce tracking and reconciliation, RBF, chaining caps, spend caps, per-origin rate limits, abort-griefing preflight.
- Value-routing contract: immutable whitelist and fee constants, direct pool calls without caller-supplied traits, per-branch cost recording, mock pools in simnet, the `tx-sponsor?` test gap.
- Relay deployment: Worker and Node adapters from one core, secrets handling, KV state, Cron Trigger, `/v1/info` discovery through a static `sponsors.json`.
- Publishing a TypeScript package: ESM, exact pins, types mirrored from Leather's models with attribution, parity tests against contract formulas.
- Legal disclaimer page as part of the product.

Propose, at the end of the build, a fourth skill capturing these as `stacks-sponsored-transactions`.

## 13. Inputs Werner supplies before the build starts

- `reference/zero-to-signing/`: `src/lib.js`, `src/vendor/` (all files), `src/styles/` (tokens.css, app.css, fonts/), `src/main.jsx`, `src/core.jsx`, `src/steps.jsx`, `src/app.jsx`, `scripts/verify-app.mjs`, `scripts/verify-hashes.mjs`, `vite.config.js`, `package.json`, `xverse.html`, `src/xverse-page.js`.
- `reference/sbtc-deposit-recovery/`: `src/clients.js`, `src/fixtures.js`, `src/parse.js`, `src/crypto.js`, `scripts/verify-crypto.mjs`, `scripts/verify-app.mjs`, `src/styles/app.css`.
- `reference/zero-to-claiming/`: `src/chain.js`, `src/core.jsx`, `scripts/verify-app.mjs`, and the sibling `claim-helper/` Clarinet project (contracts and `scripts/`).
- A Cloudflare account (free plan) with wrangler login completed on Werner's machine, or permission for the build to stop at `wrangler deploy` and hand over the exact command.
- A Hiro API key (free) for the relay.
- Fee recipient confirmed: the mainnet deployer (changeable later by the owner).
