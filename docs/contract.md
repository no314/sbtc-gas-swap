# Contract: sbtc-gas-swap-v1

Clarity 3, epoch `4.0`, Clarinet project in [`contracts/`](../contracts/README.md). One public swap function, two owner functions, five read-only functions. The contract never holds assets: every transfer is from `tx-sender` (the user) or from a pool to `tx-sender`.

Mainnet principal: `SP2BM6AQSMQ04CX8KDE62QBFVZTDZ2ZX80GZJSBZ4.sbtc-gas-swap-v1`. See [Deployment](#deployment) for status.

## The three fees and what to call them

| Contract field | Name in any user-facing copy | What it is |
| --- | --- | --- |
| `rebate` (the `tier` argument) | network fee | STX the user repays the sponsor inside the transaction, so the sponsor can pay the chain |
| `service-fee` | default provider fee | 50 bips of the sBTC input, immutable, paid in sBTC to `fee-recipient` |
| `integrator-fee` | integrator fee | 0 to 100 bips of the sBTC input, chosen by the integrator, paid in sBTC |

The field names are fixed by the deployed contract and by the SDK types. The names in the right column are the only ones a user should ever read. This document uses the field names because it describes the contract.

## What one call does

`swap-sbtc-for-gas` runs these steps in order, all with `tx-sender` = user:

1. Read `tx-sponsor?`; `none` fails with `u101`.
2. Validate arguments (codes `u102` to `u107`, `u109` below).
3. Transfer the service fee in sBTC from the user to `fee-recipient`, skipped when it is `0`.
4. Transfer the integrator fee in sBTC from the user to `integrator`, skipped when `integrator` is `none` or the fee is `0`.
5. Call the selected pool with `net` sBTC and `min-out`; the pool pulls sBTC from the user and pays STX to the user.
6. Assert the pool paid at least `min-out` (`u108`).
7. Transfer the rebate = `tier` uSTX from the user to the sponsor with `stx-transfer?`.
8. `print` one event and return the result tuple.

Because the pool paid the user at least `min-out` and `min-out >= tier`, a user who started with `0` STX can always pay the rebate.

## Public functions

### swap-sbtc-for-gas

```clarity
(define-public (swap-sbtc-for-gas
    (amount uint)                    ;; P: sBTC in, sats, > 0
    (tier uint)                      ;; a: u10000 | u100000 | u1000000 uSTX
    (min-out uint)                   ;; >= tier
    (pool-id uint)                   ;; u1 | u2 | u3
    (integrator (optional principal))
    (integrator-bips uint)))         ;; 0..100; ignored when integrator is none
```

Returns:

```clarity
(ok {received: uint, rebate: uint, service-fee: uint, integrator-fee: uint, pool-id: uint})
```

`received` is the STX the pool paid the user in uSTX, before the rebate. The user's STX balance grows by `received - tier`.

Print event (topic `"swap-sbtc-for-gas"`): `user`, `sponsor`, `amount`, `pool-id`, `received`, `rebate`, `service-fee`, `integrator-fee`, `integrator`, `min-out`.

`integrator-bips` is validated against `MAX_INTEGRATOR_BIPS` even when `integrator` is `none`; a value above `100` fails with `u106` in both cases. When `integrator` is `none`, c is `0` regardless of `integrator-bips`.

### set-fee-recipient

```clarity
(define-public (set-fee-recipient (new-recipient principal)))  ;; owner only, else u100
```

Changes where b lands from the next swap on. Prints `{topic: "set-fee-recipient", fee-recipient, by}`. Returns `(ok true)`.

### transfer-ownership

```clarity
(define-public (transfer-ownership (new-owner principal)))     ;; owner only, else u100
```

Prints `{topic: "transfer-ownership", owner, by}`. Returns `(ok true)`. The previous owner loses both owner functions immediately.

## Read-only functions

| Function | Returns | Notes |
| --- | --- | --- |
| `(get-owner)` | `principal` | Initial value: the deployer. |
| `(get-fee-recipient)` | `principal` | Initial value: the deployer. |
| `(get-config)` | `{fee-bips: u50, max-integrator-bips: u100, tiers: (list u10000 u100000 u1000000), pools: (list u1 u2 u3), fee-recipient, owner}` | One read for an integrator's sanity check. |
| `(is-valid-tier (tier uint))` | `bool` | True for exactly the three tiers. |
| `(is-known-pool (pool-id uint))` | `bool` | True for `u1`, `u2`, `u3`. |
| `(quote-fees (amount uint) (integrator-bips uint))` | `(ok {service-fee, integrator-fee, net})` or `(err u106)` | The same integer arithmetic the swap uses. Call through `/v2/contracts/call-read`. |

## Constants

| Constant | Value | Meaning |
| --- | --- | --- |
| `FEE_BIPS` | `u50` | Service fee, 50 bips of `amount`. Immutable. |
| `BIPS_DENOM` | `u10000` | |
| `MAX_INTEGRATOR_BIPS` | `u100` | Upper bound on c. |
| `TIER_LOW` | `u10000` | 0.01 STX |
| `TIER_MID` | `u100000` | 0.1 STX |
| `TIER_HIGH` | `u1000000` | 1 STX |
| `POOL_BITFLOW_XYK` | `u1` | |
| `POOL_VELAR` | `u2` | |
| `POOL_BITFLOW_DLMM` | `u3` | |

Data vars: `owner` and `fee-recipient`, both `principal`, both initialised to `tx-sender` at deploy (the deployer).

## Tiers

The tier is the STX fee budget the user chooses and the exact rebate the sponsor receives. Clarity cannot read the network fee, so the rebate is a parameter, not the fee. Any other value fails with `u103`.

| Tier | uSTX | STX |
| --- | --- | --- |
| low | `10000` | 0.01 |
| mid | `100000` | 0.1 |
| high | `1000000` | 1 |

## Pool whitelist

Principals are constants in the contract body. The contract calls each pool directly with its own known principals and no trait arguments from the caller, so a caller cannot substitute a pool. Verified against deployed source on 2026-09-05 (copies in [`docs/mainnet-sources/`](mainnet-sources/MANIFEST.json)).

| Pool id | Name | Called contract and function | Pool contract (STX sender in the post-condition) | Token order |
| --- | --- | --- | --- | --- |
| `u1` | Bitflow XYK | `SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.xyk-core-v-1-2` `swap-x-for-y` | `SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.xyk-pool-sbtc-stx-v-1-1` | x = sBTC, y = `SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.token-stx-v-1-2` |
| `u2` | Velar univ2 pool 70 | `SP20X3DC5R091J8B6YPQT638J8NR1W83KN6TN5BJY.univ2-pool-v1_0_0-0070` `swap` | same | token-in sBTC, token-out `SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.wstx`, fees `SP20X3DC5R091J8B6YPQT638J8NR1W83KN6TN5BJY.univ2-fees-v1_0_0-0070` |
| `u3` | Bitflow DLMM | `SP1PFR4V08H1RAZXREBGFFQ59WB739XM8VVGTFSEA.dlmm-swap-router-v-1-1` `swap-y-for-x-simple-multi` | `SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-pool-stx-sbtc-v-2-bps-15` | x = `token-stx-v-1-2`, y = sBTC (reversed, so sBTC in is y-for-x) |

sBTC in every branch: `SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token` (8 decimals).

Call shapes, with `net` and `min-out` supplied by the contract:

- Pool 1: `(swap-x-for-y pool sbtc-token token-stx-v-1-2 net min-out)`; returns dy in uSTX.
- Pool 2: `(swap sbtc-token wstx univ2-fees net min-out)`; the contract returns `amt-out` from the result tuple. Velar requires `net * 9970 / 10000 > 0`, so amounts under `2` sats cannot route through pool 2.
- Pool 3: `(swap-y-for-x-simple-multi pool token-stx-v-1-2 sbtc-token net min-out)`; the contract returns `out` from `{in, out}`. The router walks up to `350` bins; when liquidity runs out, `in` is below `net` and the user keeps the unswapped sBTC (a partial fill). The router still enforces `min-out` on `out`.

All three pools pull from `tx-sender` and pay to `tx-sender`; none gates on `contract-caller` (research findings, section 5, verified against deployed source).

## Fee arithmetic

Integer division floors:

```
b   = amount * 50 / 10000
c   = amount * integrator-bips / 10000      (0 when integrator is none)
net = amount - b - c
```

The service fee floors to `0` below `200` sats: a sub-`200` sat swap carries no service fee and still pays the rebate. Worked examples, all asserted in [`contracts/tests/sbtc-gas-swap.test.ts`](../contracts/tests/sbtc-gas-swap.test.ts):

| amount (sats) | integrator-bips | b | c | net |
| --- | --- | --- | --- | --- |
| `1` | `0` | `0` | `0` | `1` |
| `199` | `0` | `0` | `0` | `199` |
| `200` | `0` | `1` | `0` | `199` |
| `201` | `100` | `1` | `2` | `198` |
| `30000` | `0` | `150` | `0` | `29850` |
| `30000` | `100` | `150` | `300` | `29550` |
| `10000000` | `50` | `50000` | `50000` | `9900000` |

`net` is always positive for a positive `amount` because b plus c is at most `150` bips. `ERR_NET_ZERO` (`u107`) is defensive.

## Post-conditions

Deny mode, exactly three conditions. The relay rejects any transaction whose set differs from this ([relay verification](relay.md#verification-rules)). The SDK builds the same set in `expectedPostConditions`.

| # | Principal | Asset | Condition | Amount |
| --- | --- | --- | --- | --- |
| 1 | user | sBTC (`sbtc-token::sbtc-token`) | pool 1 and 2: `eq`; pool 3: `lte` | `amount` |
| 2 | user | STX | `eq` | `tier` |
| 3 | pool contract (table above) | STX | `gte` | `min-out` |

Why `lte` for pool 3: the DLMM router can fill partially when bins run out, leaving the user with some of the sBTC. An `eq` condition would abort a valid partial fill and the sponsor would pay the fee for the abort. Pools 1 and 2 always consume exactly `net`, so with b and c the user sends exactly `amount`, and `eq` is the tighter guarantee.

Condition 3 is placed on the pool contract as the sender. For pool 1 the STX leaves the xyk pool contract through `token-stx-v-1-2`; the sender in the resulting event is the pool contract principal, and that is the pinned value (`stxSender` in `sdk/src/config.ts`).

## Error codes

Contract errors, `(err uNNN)`:

| Code | Constant | Meaning | Caller action |
| --- | --- | --- | --- |
| `u100` | `ERR_NOT_OWNER` | `set-fee-recipient` or `transfer-ownership` called by a non-owner. | None for users. Owner functions only. |
| `u101` | `ERR_NOT_SPONSORED` | `tx-sponsor?` is `none`: the transaction was broadcast without a sponsor. | Submit the signed hex to a relay instead of broadcasting. |
| `u102` | `ERR_BAD_AMOUNT` | `amount` is `0`. | Enter a positive amount. |
| `u103` | `ERR_BAD_TIER` | `tier` is not `u10000`, `u100000`, or `u1000000`. | Choose low, mid, or high. |
| `u104` | `ERR_MIN_OUT_BELOW_TIER` | `min-out < tier`. | Raise the amount, lower the tier, or lower the slippage. |
| `u105` | `ERR_UNKNOWN_POOL` | `pool-id` is not `u1`, `u2`, or `u3`. | Re-quote with the SDK. |
| `u106` | `ERR_BAD_BIPS` | `integrator-bips > 100`. | The integrator passes `0` to `100`. |
| `u107` | `ERR_NET_ZERO` | `net` is `0`. Unreachable for a positive amount. | Defensive; report if seen. |
| `u108` | `ERR_RECEIVED_BELOW_MIN` | The pool returned less than `min-out`. Pools enforce this themselves first, so this is a second guard. | Re-quote and retry with more slippage. |
| `u109` | `ERR_SAME_PRINCIPAL` | The sponsor is the user. | Use a relay; do not self-sponsor. |

Pool errors that propagate through `try!` and surface as the transaction result:

| Code | Source | Meaning | Caller action |
| --- | --- | --- | --- |
| `u1002` | `xyk-core-v-1-2` `ERR_INVALID_AMOUNT` | Pool 1: `x-amount` or `min-dy` is `0`. | Not reachable through this contract with valid arguments (`net > 0`, `min-out >= tier > 0`). |
| `u1020` | `xyk-core-v-1-2` `ERR_MINIMUM_Y_AMOUNT` | Pool 1: output below `min-dy`; the price moved. | Re-quote and retry with 2 or 5 percent slippage. |
| `u107` | `univ2-pool-v1_0_0-0070` `err-swap-preconditions` | Pool 2: preconditions failed (adjusted input `0`, or output below `amt-out-desired`). | Re-quote and retry; amounts under `2` sats cannot use pool 2. |
| `u2003` | `dlmm-swap-router-v-1-1` `ERR_MINIMUM_RECEIVED` | Pool 3: `out < min-dx`; the price moved or bins ran out. | Re-quote and retry with more slippage. |

`u107` is both the contract's `ERR_NET_ZERO` and Velar's precondition error. In practice a `u107` result means Velar, since the contract's own `u107` is unreachable. A post-condition abort (`abort_by_post_condition`) means the pool would have paid less than `min-out`; the SDK's `explainTxFailure` maps both cases.

When a swap aborts on chain, nothing moves and the sponsor pays the network fee. Mempool rejections cost nothing.

## Immutability

- `FEE_BIPS`, `MAX_INTEGRATOR_BIPS`, the three tiers, and the three pool principals are constants. Changing any of them requires a new contract version.
- `fee-recipient` and `owner` are the only data vars, changeable only by the owner. Changing `fee-recipient` changes where b lands, never what the user receives.
- There is no pause, no upgrade hook, no admin path over user funds.

## Tests and the tx-sponsor? gap

Closed on mainnet 2026-09-06: transaction [`0xe90984f9bd4b591128d9377192251288075a59842139f297f07b9835d48cbc94`](https://explorer.hiro.so/txid/0xe90984f9bd4b591128d9377192251288075a59842139f297f07b9835d48cbc94?chain=mainnet), block `8932782`, sponsored by `SP1TFTBQZANNVWABSFDRM0YWPJQDP27WZ8SR0NE3S` (the low key) at fee `3000` uSTX. A user with `0` STX swapped `1000` sats through pool 2 (Velar): events in order: `5` sats service fee to the fee recipient, `995` sats to the pool, `2958503` uSTX from the pool to the user, `10000` uSTX rebate from the user to `tx-sponsor?`. Received equals the SDK quote to the uSTX. The sponsor key ended at `2.007` STX (`2` + `0.01` rebate minus `0.003` fee); the user at `2.948503` STX.

`npm test` in `contracts/` runs 37 vitest tests against simnet: every error code, the fee arithmetic table above, each pool branch through a mock pool with the deployed pool's integer arithmetic and error codes, the DLMM partial fill, and the owner functions.

Simnet cannot set `tx-sponsor?`; it is always `none`. The tested contract is `sbtc-gas-swap-v1-simnet.clar`, generated by `scripts/build-simnet-variant.mjs` from the mainnet source by swapping the three pool principals and the `tx-sponsor?` keyword for mocks; `tests/variant.test.ts` proves the two files differ in exactly those tokens by reversing the substitutions and comparing structure hashes. The real sponsor path (`tx-sponsor?` = `(some relay)` and the `stx-transfer?` to it) is covered only by the mainnet dust swap ([SDK, dust-swap script](sdk.md#dust-swap-script)).

## Runtime cost per branch

Maximum observed per branch in `contracts/costs-reports.json` (`npm run test:costs`). These are measured against the simnet mocks, so they are lower bounds: the mock pools skip the deployed pools' bookkeeping, and the DLMM mock does not walk up to `350` bins as the router does. Mainnet observations from dust swaps replace them.

| Branch | runtime | read_count | read_length | write_count | write_length | memory |
| --- | --- | --- | --- | --- | --- | --- |
| Pool 1 (XYK) | `56297` | `41` | `25369` | `11` | `59` | `1787` |
| Pool 2 (Velar) | `46897` | `31` | `19935` | `9` | `58` | `1459` |
| Pool 3 (DLMM) | `45885` | `29` | `19771` | `7` | `22` | `1425` |

Block limits for scale: runtime `5000000000`, read_count `15000`, write_count `15000`. The relay does not use these figures directly; it asks the node's `/v2/fees/transaction` for the payload and falls back to its floor ([relay fee policy](relay.md#fee-policy)).

## Deployment

Status: deployed 2026-09-06, verified: the live source's structure hash equals the pinned hash (869 tokens, 8020 bytes, Clarity 3).

| Field | Value |
| --- | --- |
| Deployer | `SP2BM6AQSMQ04CX8KDE62QBFVZTDZ2ZX80GZJSBZ4` |
| Contract | `SP2BM6AQSMQ04CX8KDE62QBFVZTDZ2ZX80GZJSBZ4.sbtc-gas-swap-v1` |
| Deploy txid | [`0x25d38b110ed5273835354649416cf218c275e9cffec4692b3881952c4fc85e70`](https://explorer.hiro.so/txid/0x25d38b110ed5273835354649416cf218c275e9cffec4692b3881952c4fc85e70?chain=mainnet) |
| Block | `8930825` (2026-09-06T13:51:22Z, burn block `965775`) |
| Structure hash | `5702f09a5ab584d56d7e803b94143d1c51327c5a95f2a2309df4e604215ed608` |

The structure hash is of the reviewed source in [`contracts/contracts/sbtc-gas-swap-v1.clar`](../contracts/contracts/sbtc-gas-swap-v1.clar). It is pinned as `PINNED_STRUCTURE_HASH` in `sdk/src/verify-contract.ts`, and the SDK's `verifyContract` compares the live source from `/v2/contracts/source` against it before offering the swap. The testnet deployer `ST2BM6AQSMQ04CX8KDE62QBFVZTDZ2ZX80G22E500` is reserved; there is no testnet deployment because no testnet pools exist.

### How to verify

The structure hash is formatting-independent and ignores comment text by design:

1. Remove every comment (`;;` to end of line).
2. Tokenize: each `(`, `)`, `{`, `}` is a token; every other run of non-whitespace, non-delimiter characters is a token.
3. Join the tokens with U+0001 (so token boundaries are part of the hash).
4. SHA-256 the UTF-8 bytes; hex encode.

Reference implementations: `structureHash` in `sdk/src/verify-contract.ts` (Web Crypto) and `contracts/scripts/build-simnet-variant.mjs` (Node crypto). `app/scripts/verify-hashes.mjs` asserts the reviewed source hashes to the pin, that the hash is invariant under reformatting, and that an edited source does not match. This is a different algorithm from Clarity's `contract-hash?` (SHA-512/256 over raw bytes); the two never compare equal.
