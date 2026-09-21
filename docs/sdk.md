# SDK: @no314/sbtc-gas-swap

TypeScript, ESM, no backend of its own. It reads the chain through any Stacks node or the Hiro API, builds the exact contract call and post-conditions, and submits the wallet's signed hex to a relay. Source: [`sdk/`](../sdk/). Depends on `@stacks/transactions` and `@stacks/network` `7.6.0`.

```
npm install @no314/sbtc-gas-swap
```

Until it is published on npm, depend on the folder: `"@no314/sbtc-gas-swap": "file:../sdk"` and run `npm run build` in `sdk/`.

## End-to-end sequence

1. `verifyContract(chain)`: the live source's structure hash equals the pinned hash. Refuse to continue on mismatch; show "unavailable" on a failed read.
2. `readPoolStates(chain)` then `quoteFromStates(states, {amountSats, integratorBips})`, or `quoteAllPools(chain, ...)` for both in one call. Get `best` (pool, output), `fees` (b, c, net), `unavailable` (pools whose read failed).
3. `new RelayClient().discover()` then `RelayClient.rank(candidates, tier)`: the relays that accept the tier, best first. `defaultTier(amountSats, {minTier})` picks the tier from the amount and the lowest relay minimum; `defaultSlippageBips(amountSats)` gives `1000` (10 percent) up to `30000` sats and `100` above.
4. `buildSwapCall({user, amountSats, tier, poolId, quoteOut, slippageBips, integrator?, integratorBips?})`: returns the SIP-030 `stx_callContract` parameters with `sponsored: true`, `fee: 0`, `postConditionMode: "deny"` and the three post-conditions. Throws `SwapBuildError` with code `MIN_OUT_BELOW_TIER` (and `BAD_AMOUNT`, `BAD_BIPS`, `UNKNOWN_POOL`).
5. Re-quote immediately before signing; block if the fresh output is below `call.minOut`.
6. `request("stx_callContract", call)` with `@stacks/connect`. Leather returns `{ transaction }` (hex) and does not broadcast a sponsored transaction. Do not expect a `txid` from the wallet.
7. `relayClient.submit(transactionHex, rankedRelays)`: `{ok: true, txid, relay, fee, tier, sponsor, sponsoredTx}` or `{ok: false, attempts}`. Final verdicts stop the fallback chain; relay conditions move to the next relay.
8. Poll `chain.getTransaction(txid)` until `tx_status` is `success` or an abort; `explainTxFailure(status, tx_result.repr)` maps aborts to actions (mostly "re-quote and retry with 2 or 5 percent slippage").

## Exports

### Identity and rules (`config.ts`)

`NETWORK`, `CHAIN_ID`, `CONTRACT` (`address`, `name`, `fn`), `SBTC`, `TIERS` (`low 10000n`, `mid 100000n`, `high 1000000n`), `TIER_NAMES`, `tierNameOf(value)`, `FEE_BIPS 50n`, `MAX_INTEGRATOR_BIPS 100n`, `POOLS` (id, name, `stxSender` principal, `sbtcCondition` eq or lte), `XYK`, `VELAR`, `DLMM` principals, `DLMM_MIN_OUTPUT_USTX 100_000_000n`, `SMALL_SWAP_MAX_SATS 30_000n`, `LARGE_SWAP_MIN_SATS 10_000_000n`.

### Quoting (`quote/`)

- `splitFees(amountSats, integratorBips)` -> `{serviceFee, integratorFee, net}`, the contract's `quote-fees` in TypeScript (integer floors).
- `quoteXyk(state, netSats)`, `quoteVelar(state, netSats)`, `quoteDlmm(state, netSats)` -> `PoolQuote {poolId, in, out, feeSats, impactBips, reserveStx, partial?, reason?}`. Pure ports of the deployed pool arithmetic, tested against values computed independently from the contract sources.
- `selectPool(quotes, minOut)`: highest `out`; DLMM skipped when the best other output is at most 100 STX; ties by `reserveStx`.
- `readPoolStates(chain, dlmmBinsAhead = 3)` -> `PoolStates {xyk?, velar?, dlmm?, unavailable, readAt}`. One failed pool read is recorded, never zeroed.
- `quoteFromStates(states, {amountSats, integratorBips?})` -> `QuoteResult {fees, quotes, unavailable, best, readAt}`. Pure: re-quote on every keystroke without reads.
- `quoteAllPools(chain, request)`: the two above in one call.

### Defaults (`defaults.ts`)

`defaultTier(amountSats, {minTier})`, `defaultSlippageBips(amountSats)`, `minOutFor(quoteOut, slippageBips)` (floors; slippage `0..9999` bips).

### Building (`build.ts`, `postconditions.ts`)

`buildSwapCall(input)` -> `SwapCall`:

```ts
{
  contract: "SP2BM6AQSMQ04CX8KDE62QBFVZTDZ2ZX80GZJSBZ4.sbtc-gas-swap-v1",
  functionName: "swap-sbtc-for-gas",
  functionArgs: [uint amount, uint tier, uint minOut, uint poolId, (optional principal) integrator, uint bips],
  postConditions: [
    { type: "ft-postcondition", address: user, condition: "eq" | "lte", amount, asset: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token" },
    { type: "stx-postcondition", address: user, condition: "eq", amount: tier },
    { type: "stx-postcondition", address: poolStxSender, condition: "gte", amount: minOut },
  ],
  postConditionMode: "deny", sponsored: true, fee: 0, network: "mainnet",
  minOut, tierUstx, fees: { serviceFee, integratorFee, net },
}
```

`expectedPostConditions({user, amount, tier, minOut, poolId})` is the same set on its own; the relay verifies against an identical function.

### Relays (`relays.ts`)

`RelayClient({fetch?, sponsorsUrl?, relays?, timeoutMs?})`: `listUrls()`, `discover()` -> `RelayCandidate[]` (`info` or `error` per relay), static `rank(candidates, tier)` -> `RelayInfo[]`, `submit(hex, relays)`. `DEFAULT_SPONSORS_URL` points at [`sponsors.json`](sponsors.md).

### Explanations (`explain.ts`)

`explainRelayError(code)` and `explainTxFailure(status, resultRepr)` -> `{title, action, retryable}`. Copy follows the design skill: declarative, actionable, no em dashes.

### Contract pinning (`verify-contract.ts`)

`structureHash(source)` (comments stripped, tokens joined with U+0001, SHA-256), `PINNED_STRUCTURE_HASH`, `verifyContract(chain)` -> `{ok, liveHash, pinnedHash, publishHeight?, error?}`.

### Chain reads (`client/chain.ts`)

`new ChainClient({baseUrl?, apiKey?, fetch?, minSpacingMs?, retries?, sender?, cacheBust?})`. One gate for every read: spacing between requests, retry with backoff on `429` and `5xx`, cache-buster on GETs, no caching of failures. Methods: `callRead`, `readXykState`, `readVelarState`, `readDlmmState(binsAhead)`, `getSbtcBalance`, `getStxBalance`, `getNonces` (Hiro extended with node fallback), `getContractSource`, `estimateFee`, `broadcast`, `getTransaction`, `getInfo`. `baseUrl` is the `?api=` override in the dapp: reads only, never what the wallet signs. The anonymous Hiro budget is 50 requests per minute per IP, 500 with `apiKey`.

## Adapters

- [`@no314/sbtc-gas-swap/leather`](leather-integration.md): `SbtcGasSwapProvider`, a `SwapProviderService` for Leather's swap module.
- [`@no314/sbtc-gas-swap/bitflow`](bitflow-integration.md): `getSponsoredRoute(...)` for Bitflow's aggregator.

## Mainnet smoke test

`sdk/scripts/dust-swap.ts` performs one real swap without a wallet, from a throwaway key holding a few hundred sats:

```
DUST_USER_KEY=<hex> RELAYS=https://<relay> AMOUNT_SATS=1000 TIER=low [SLIPPAGE_BIPS=1000] [HIRO_API_KEY=...] npm run dust-swap
```

It verifies the contract, prints every pool's quote, discovers relays, builds and signs the sponsored call, submits, polls, and compares the mined `received` with the quote to the uSTX. Exit code `0` only on a mined success.
