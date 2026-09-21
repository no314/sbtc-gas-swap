# Leather integration

For Leather engineers. Goal: a Leather user who holds sBTC and no STX swaps sBTC to STX from the swap screen, with the network fee sponsored and repaid inside the transaction. Leather earns the integrator fee on every swap.

Reference: leather-io/mono PR #2554 (`feat/swaps`, head `adedaac5d`, 2026-08-31, not merged at the time of writing). File paths below are from that branch.

## What this repo provides

`@no314/sbtc-gas-swap/leather` ([`sdk/src/leather/`](../sdk/src/leather/)):

- `SbtcGasSwapProvider implements SwapProviderService` with `providerId = "sbtc-gas-swap"`. Base asset sBTC, target asset STX, nothing else. `getSwapQuotes` returns one quote whose `targetAmount` is the pool output minus the rebate (what the user keeps), with `providerQuoteData` carrying pool id, tier, fee split, and the ranked relays. `getSwapExecutionData` returns a `SponsoredStacksContractCallSwapExecutionData`.
- `types.ts` mirrors the mono shapes structurally (`SwapProviderService`, `SwapProviderAsset`, `BaseSwapQuote`, `GetSwapQuotesParams`, `GetSwapExecutionDataParams`, `StacksContractCallSwapExecutionData`). The mirror exists so this package does not depend on mono; replace the imports with the real ones when vendoring. `Money` is reduced to `{amount: bigint, decimals, symbol}`; mono's `Money` carries a BigNumber, so convert at the boundary.
- Constructor options: `chain` (SDK `ChainClient`; pass Leather's fetch and API key), `relays` (`RelayClient`), `integrator` (Leather's principal), `integratorBips` (`0..100`; `100` is 1 percent of the sBTC input, paid to Leather in sBTC inside the transaction), `assetIds` (Leather's canonical ids for sBTC and STX).

## Proposed additions to mono

1. `packages/models/src/swap/swap.model.ts`: add `"sbtc-gas-swap"` to `swapProviderIds`; add `SbtcGasSwapQuote` (fields in `sdk/src/leather/index.ts`) to the `SwapQuote` union; add `"sponsored-stacks-contract-call"` to `swapExecutionTypes` and `SponsoredStacksContractCallSwapExecutionData` to the execution data union. The type equals `StacksContractCallSwapExecutionData` plus `sponsored: true`, `fee: 0`, `relays`, `tier`, `fees`, `minOutUstx`, `poolId`.
2. `packages/services/src/swap/sbtc-gas-swap-provider.service.ts`: an `@injectable()` class that wraps `SbtcGasSwapProvider` (or is it, once the types are the real ones). Register it in `swap.service.ts`: constructor parameter and entry in `getSwapProviderServices()`.
3. `packages/state/src/swap/strategies/execution-type/execution-type.ts`: a new `ExecutionStrategy` for `sponsored-stacks-contract-call`:
   - `getNetworkFee`: return a fee of `0` STX with a `sponsored` fee mode (see 4); the tier is shown as a line item from `executionData.tier`, denominated in STX but paid from the swap output, not from the user's balance.
   - `submitSwap`: build with `generateStacksUnsignedTransaction({... sponsored: true, fee: 0, nonce})` (today `build-stacks-tx.ts` hardcodes `sponsored: false`; make it a parameter), sign with `stacks.stacksSigner`, then instead of `stacks.broadcast` call `RelayClient.submit(signedTx.serialize(), executionData.relays)` and return `{status: "submitted", txid}` from the relay's response. `SwapDependencies.stacks.broadcast` is already injectable; a `sponsorBroadcast` sibling keeps the strategy free of HTTP.
4. `packages/state/src/swap/swap-state.types.ts`: `FeeMode` gains `"sponsored"`; `ProtocolStrategy.getFeeCapabilities()` is keyed on the base-asset protocol today, so let the quote's execution type override it.
5. `swap-validation.ts`: a user with `0` STX must pass validation when the selected quote is sponsored; the `STX_SAFETY_BUFFER` check applies only to STX-paying quotes.
6. Leather API `swap-dexes` map: an entry for `sbtc-gas-swap` (dex path `bitflow` or `velar` by pool) so `dexPath` renders.
7. Analytics events in `packages/analytics/src/events.ts`; test stubs in `packages/state/src/swap/tests/test-utils/services.stub.ts`.
8. Signing flow: the RPC path already returns `{transaction}` without broadcasting for `AuthType.Sponsored` (`use-sign-and-broadcast-stacks-transaction.ts`); the swap path needs the same branch. Leather issue #2316 (nonce not incremented locally after signing a sponsored tx) applies: pass the nonce explicitly and refresh after the relay confirms.

## Post-conditions

Leather already verifies a `gte` min-receive post-condition on the target asset (`hasValidMinReceiveAmountPostCondition`). Our set contains exactly that condition on the pool principal (`gte minOut` STX to the user) plus two on the user: sBTC `eq amount` (or `lte` for the DLMM pool, which can fill partially) and STX `eq tier` (the rebate). All three are required by the relay; a transaction with a different set is refused before broadcast, so a wallet that drops post-conditions cannot get sponsored. [contract.md](contract.md#post-conditions) has the derivation.

Note that the user sends STX (`eq tier`) in a transaction meant for a user who has none: the STX arrives from the pool in the same transaction and leaves to the sponsor. Review copy should say "repaid from the swap output".

## Economics for Leather

Per swap Leather receives `integratorBips / 10000 * amount` sBTC, at most 1 percent, floored to whole sats (`0` below `100` sats at `100` bips). Stacks Labs receives the fixed `50` bips service fee. The sponsor receives the tier. The user receives the pool output minus the tier. All four legs are in one atomic transaction.

## Open questions for Leather

- Which principal receives the integrator fee, and at what bips.
- Whether Leather wants to run its own relay ([operator guide](operator-guide.md)); the SDK ranks relays by minimum tier and fee, so Leather's relay can be first for Leather users by listing it first in the provider's `RelayClient`.
- Ledger: the sponsored auth type is standard Stacks; confirm the Ledger Stacks app signs a sponsored contract call with three post-conditions (research found no blocker, not verified on device).
- Xverse and other wallets are outside this document; the relay's post-condition check protects users regardless of wallet.
