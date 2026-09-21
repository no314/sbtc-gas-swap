# Research findings: self-sufficient sponsor for sBTC to STX

Date: 2026-09-05. Chain tip at query time: stacks 8,919,826 / burn 965,540. All contract facts read from deployed source via Hiro `/v2/contracts/source`, `/v2/contracts/interface`, `/v2/data_var`.

## 1. Stacks sponsored-transaction mechanics (stacks-core master, Clarity 2+)

- Origin signature commits only to "I am sponsored", its own nonce, and its own fee field (set to 0). It does NOT commit to sponsor identity, sponsor fee, or sponsor nonce. The sponsor can set or bump the fee and re-sign freely; the txid changes each time. Sponsor-side RBF is therefore trivial.
- `tx-sponsor?` (Clarity 2+, `(optional principal)`) is available inside contract calls and survives `as-contract` and nested `contract-call?`. `stx-transfer?` only requires `from == tx-sender`, so a contract can pay the sponsor with `(stx-transfer? amt tx-sender sponsor)` where sponsor comes from `tx-sponsor?`. This makes sponsoring permissionless: any relay that signs the tx gets paid.
- Clarity has no access to the tx fee. Any rebate must be a parameter (fee tier), not the actual fee.
- Fee is charged to the sponsor on runtime abort (contract `err`, post-condition failure): tx is mined, both nonces advance, state rolls back. Mempool rejection (BadNonce, NotEnoughFunds, wrong arg types, missing function) costs nothing.
- `POST /v2/contracts/call-read` accepts `{sender, sponsor?, arguments}` and runs any public function until the first write (`NotReadOnly`). Good for read-only preflight (quotes, balances), not for a full dry run. Full simulation needs `/v3/blocks/simulate` with rpcAuth on an own node.
- Mempool: chaining limit 25 per account (origin and sponsor independently); RBF requires strictly higher total fee; Nakamoto GC about 42.7 h; a gap in sponsor nonces blocks every later sponsor nonce. Observed live: a sponsor with nonce gap and 2,101 STX fees stuck for 1.5 h.
- Recent confirmed contract-call fees (small sample, uncongested): 417 to 50,000 uSTX organic; a Bitflow `swap-helper-a` paid 17,922 uSTX. Minimum admission 1 uSTX/byte.
- stacks.js v7: `makeContractCall({sponsored:true, fee:0})`, `sponsorTransaction({transaction, sponsorPrivateKey, fee, sponsorNonce})`, `deserializeTransaction`, `broadcastTransaction`. SIP-030 `stx_callContract` takes `sponsored?: boolean`; Leather returns `{transaction}` hex and does not broadcast when auth is Sponsored (txid may be empty string). Xverse support for `sponsored` unverified.
- Hiro API rewrites `/v2/fees/transaction` to the 1 uSTX/byte minimum when recent tenures are not full (if the estimator flag is enabled in prod; unverified).

## 2. Leather (leather-io/mono, PR #2554 `feat/swaps`, NOT merged, head adedaac5d 2026-08-31)

- Provider abstraction: `packages/services/src/swap/swap-provider.interface.ts` `SwapProviderService { providerId; getBaseProviderAssets; getTargetProviderAssets; getSwapQuotes; getSwapExecutionData }`. Providers return data only; the state layer builds, fee-estimates, signs, broadcasts.
- Models: `packages/models/src/swap/swap.model.ts`: `swapProviderIds = ['bitflow-sdk','bitflow-bff-api','sbtc-bridge','alex-sdk','velar-sdk']`, `swapExecutionTypes = ['stacks-contract-call','sbtc-bridge-deposit']`, `StacksContractCallSwapExecutionData {contractAddress, contractName, functionName, functionArgs, postConditions, postConditionMode}`.
- Registry: hard-coded constructor injection in `packages/services/src/swap/swap.service.ts` (`getSwapProviderServices()`). Wallet independently verifies a `gte` min-receive post-condition (`hasValidMinReceiveAmountPostCondition`).
- Execution: `packages/state/src/swap/strategies/execution-type/execution-type.ts`; `build-stacks-tx.ts` hardcodes `sponsored: false`; `submitSwap` always calls `stacks.broadcast`. `FeeMode = 'fixed' | 'tiered'` keyed on base-asset protocol, no "sponsored" mode. Validation never checks STX for fee.
- A new provider adds: id + quote type in models; `@injectable()` service; constructor entry in SwapService; if a new execution type, an `ExecutionStrategy`; a Leather API `swap-dexes` entry; analytics events; test stubs.
- Sponsorship hook: new `executionType` (e.g. `sponsored-stacks-contract-call`) or a flag on the execution data; strategy builds with `sponsored:true, fee:0` and POSTs to a relay instead of broadcasting. `SwapDependencies.stacks.broadcast` is injectable.
- Legacy sponsoring: (a) 2023 ALEX `broadcastSponsoredTx` (ALEX ran the sponsor, no fee); (b) Dec 2024 sBTC sponsorship via `https://sponsor.leather.io` (`/verify` boolean, `/submit`), closed source, pure subsidy, no on-chain payment, eligibility server-decided. PR #2554 deletes the swap-legacy path. Weaknesses: opaque eligibility, hardcoded "middle" fee at verify, no economic backpressure, single operator with a config kill switch.
- RPC path (`use-sign-and-broadcast-stacks-transaction.ts`): if `AuthType.Sponsored`, return `{transaction}` and do not broadcast.

## 3. sendstx.com (friedger/stacks-send-many + stacks-not-sponsoring)

- Payment is an extra recipient row inside the same `send-many` / `transfer-many` call to a hardcoded sponsor address (10,000 NOT or 100 sats), memo `fees`. `sponsored:true, fee:0` via `stx_callContract`; on `AuthType.Sponsored` the dapp POSTs `{tx, network, feesInTokens}` to `https://sponsoring.friedger.workers.dev/<asset>/v1/sponsor`.
- Relay is a Cloudflare Worker (open source). Verification: contract principal string match, recipient equals sponsor address, amount >= minimum. Fee from node estimate capped at 10,000 uSTX. No nonce management (Durable Object exists but disabled), single key, no simulation, no rate limit, `smart-wallet-sbtc` route accepts any sponsored call.
- Weaknesses: fixed unhedged price, sponsor pays on abort, griefable, nonce collisions, hardcoded sponsor address in frontend, contract-specific string matching does not generalize.

## 4. Other open-source relays

- secretkeylabs/stacks-transaction-sponsor (Xverse): Node/Express, N sponsor accounts from one seed, per-account lock, cached nonces, refetch on BadNonce/ConflictingNonceInMempool, MAX_FEE cap.
- alexgo-io/stacks-transaction-sponsor (ALEX): Node + Postgres, RBF worker re-signs with fee+10 at same nonce, per-block submission cap.
- aibtcdev/x402-sponsor-relay: Cloudflare Worker, x402 settlement, daily spend caps.

## 5. Bitflow and mainnet sBTC-STX pools

sBTC: `SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token` (8 dec).

- Bitflow SDK `@bitflowlabs/core-sdk` 4.2.0. Public API, no key, 500 req/min/IP. `GET /getAllTokensAndPools`, `GET /getAllRoutes?tokenX=..&depth=4`. Quoting is client side: iterate routes, call each `quoteData.function` via call-read, pick max. No sponsorship code. Hosts: `bitflowsdk-api-test-7owjsmt8.uk.gateway.dev`, `node.bitflowapis.finance`. Blocked from the sandbox; live route list unverified.
- Bitflow XYK `SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.xyk-pool-sbtc-stx-v-1-1` (pool-id 21, core `xyk-core-v-1-2`). x = sBTC, y = STX wrapper `token-stx-v-1-2`. Fees 10 protocol + 40 provider bps per side. Reserves: 136,237 STX / 0.4507 sBTC (330.8 sats/STX). Swap: `xyk-core-v-1-2 swap-x-for-y (pool-trait) (x-token-trait) (y-token-trait) (x-amount uint) (min-dy uint)`. Quote: `get-dy` (define-public, no writes, callable via call-read and via contract-call? from another contract). Helper: `xyk-swap-helper-v-1-2 swap-helper-a (amount) (min-received) (xyk-tokens {a,b}) (xyk-pools {a})`, `get-quote-a`. Only asserts `x-amount > 0`, `min-dy > 0`. Fees floor to 0 below 250 sats. 1 sat -> 3,022 uSTX; 331 sats -> 0.997 STX.
- Bitflow DLMM `SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-pool-stx-sbtc-v-2-bps-15` (pool-id 15, core `SP1PFR4V08H1RAZXREBGFFQ59WB739XM8VVGTFSEA.dlmm-core-v-1-1`). x = STX, y = sBTC (reversed). 1,261,747 STX / 0.8178 sBTC. 50 bps. Router `dlmm-swap-router-v-1-1 swap-y-for-x-simple-multi`. No read-only quote function; active-bin liquidity not retrieved.
- Velar `SP20X3DC5R091J8B6YPQT638J8NR1W83KN6TN5BJY.univ2-pool-v1_0_0-0070` (pool 70). token0 wstx, token1 sBTC. 211,599 STX / 0.7008 sBTC. 30 bps. `swap (token-in) (token-out) (fees) (amt-in) (amt-out-desired)`. Minimum 2 sats (adj > 0). Read-only `get-pool` gives reserves; quote computable off chain or in a wrapper.
- ALEX: 0.006 sBTC in vault; ignore.
- Wrapper contract feasibility: all three pools use `tx-sender` as the token source and `is-standard` (network check only) on recipients; none gate on `contract-caller`. A wrapper called by the user can route the swap with the user as tx-sender; tokens flow user -> pool -> user and the wrapper never holds assets.
- Routed 2-hop paths (sBTC -> USDh/aeUSDC -> STX): no pools with meaningful sBTC found; two fee floors and two integer floors make them worse for tiny inputs. Direct XYK is the primitive.
- Bitflow sponsored swaps: nothing found in SDK, docs, or Leather's Bitflow post.

## 6. Skill coverage assessment (updated skills read 2026-09-05)

Covered: static build for app, sdk, docs (static-first); security tier (this is Tier 3), post-condition modes, contract pinning by structure hash, wallet capability gating, read gating and fallbacks, network identity (stacks-dapp); reference dapp look and flow (design). stacks-dapp explicitly names "a transaction relayer or sponsored-transaction service" as a legitimate backend trigger.

Not covered by any of the three skills:
- Sponsored-tx specifics: `sponsored:true, fee:0`, wallet returns hex and does not broadcast, txid regex validation fails on sponsored responses (txid empty), relay POST shape, `tx-sponsor?` payment.
- Hot-key operations: key custody, N sponsor accounts, nonce tracking, RBF, spend caps, per-origin rate limits, abort-griefing preflight.
- Writing a value-routing Clarity contract: pool whitelist, trait arguments, on-chain quoting, fee arithmetic and rounding, simnet tests with pool mocks, deploy and verify.
- Relay deployment (Cloudflare Worker and Docker adapters), secrets, health endpoint, `/v1/info` discovery.
- Publishing a TypeScript integration package (SDK) and its parity tests.
