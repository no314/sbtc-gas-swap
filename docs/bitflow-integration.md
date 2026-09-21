# Bitflow integration

For Bitflow. Two of the three whitelisted pools are Bitflow pools: `SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.xyk-pool-sbtc-stx-v-1-1` (via `xyk-core-v-1-2 swap-x-for-y`) and `SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-pool-stx-sbtc-v-2-bps-15` (via `dlmm-swap-router-v-1-1 swap-y-for-x-simple-multi`). A sponsored sBTC to STX swap through `sbtc-gas-swap-v1` is therefore mostly a Bitflow swap with a different entry point: the user needs no STX, and the integrator earns a fee inside the transaction.

## What this repo provides

`@no314/sbtc-gas-swap/bitflow` ([`sdk/src/bitflow/`](../sdk/src/bitflow/)): `getSponsoredRoute({user, amountSats, integrator, integratorBips, tier?, slippageBips?})` returns `{call, quoteOutUstx, userReceivesUstx, relays, submit}`. `call` is the SIP-030 `stx_callContract` parameter object (`sponsored: true`, `fee: 0`, deny mode, three post-conditions); after the wallet returns the signed hex, `submit(hex)` posts it to the ranked relays.

## How it fits Bitflow's aggregator

Bitflow's SDK (`@bitflowlabs/core-sdk` 4.2.0) enumerates routes from `getAllRoutes`, quotes each client side, and executes the best with `openContractCall`. A sponsored route is one more candidate: quote with `getSponsoredRoute` (its `userReceivesUstx` is comparable to other routes' outputs, since the tier is already subtracted), and when the user has no STX, or chooses "pay the fee from the swap", execute through `call` and `submit` instead of `openContractCall`. The `provider` argument that some Bitflow wrappers accept has an equivalent here: pass Bitflow's principal as `integrator` with up to `100` bips.

## Pool selection

The SDK quotes all three whitelisted pools from their on-chain state (the same arithmetic as the deployed contracts, see [sdk.md](sdk.md#quoting)) and picks the highest output; the DLMM pool is skipped when the best other output is at most 100 STX because its bin walk costs more runtime than a small swap saves. Bitflow can pass a fixed `poolId` by building the call with `buildSwapCall` directly.

## What Bitflow could add

- A route flag in `getAllRoutes` output marking the sponsored entry point, so wallets that consume Bitflow routes get it without a second SDK.
- A relay of its own ([operator guide](operator-guide.md)): the contract pays whichever relay co-signs, so a Bitflow relay earns the tier on Bitflow-originated swaps and adds redundancy for everyone.
- Adding new pools requires a new contract version: the whitelist is immutable by design ([contract.md](contract.md#immutability)).
