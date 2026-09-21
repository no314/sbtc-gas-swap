# sBTC to Stacks gas

A sponsored sBTC to STX swap where the sponsor is repaid inside the transaction. A user with sBTC and no STX gets gas in one signature; the wallet or dapp that built the call earns a fee; anyone can run the sponsor relay because the contract pays whoever co-signed.

Docs: [docs/index.md](docs/index.md). Legal: [docs/disclaimer.md](docs/disclaimer.md). Build spec: [PROMPT.md](PROMPT.md).

## Layout

| Folder | Contents | Tests |
| --- | --- | --- |
| `contracts/` | Clarinet project: `sbtc-gas-swap-v1.clar`, simnet variant, pool mocks, verbatim mainnet pool sources in `.cache/requirements` | `npm test` (vitest + simnet, 37), `clarinet check` |
| `relay/` | Sponsor relay: pure core, Cloudflare Worker and Node adapters | `npm test` (node --test, 64) |
| `sdk/` | `@no314/sbtc-gas-swap`: quote, build, submit, Leather and Bitflow adapters, dust-swap script | `npm test` (node --test, 57) |
| `app/` | Reference dapp "sBTC to Stacks gas" (Vite, React, fixture mode, browser harness) | `npm run build && npm run verify` (165 checks) |
| `docs/` | Markdown docs read on GitHub, `sponsors.json`, mainnet sources and fixtures | |
| `scripts/` | `publish-stx-fan.sh`: build the app and stage it into the stx.fan clone | |

Build order for a fresh clone: `sdk` first (`npm ci && npm run build`), then `relay` and `app` (both depend on `file:../sdk`).

## What is published where

This repo needs no website. Integrators get the SDK from npm and read the docs here on GitHub. Two files must be reachable over HTTPS, and both are served from stx.fan:

| URL | Source | Published by |
| --- | --- | --- |
| `https://stx.fan/zero_to/sbtc-gas/` | `app/dist/` | `scripts/publish-stx-fan.sh` |
| `https://stx.fan/zero_to/sbtc-gas/sponsors.json` | `docs/sponsors.json` | the same script |
| `https://stx.fan/zero_to/sbtc-gas/disclaimer.html` | `app/disclaimer.html` | the same script |

The app is the proof of concept: a working reference implementation of the SDK and the demo to point people at. Nothing in the contract or the relay depends on it.

## Status

Contract deployed to mainnet 2026-09-06 (`SP2BM6AQSMQ04CX8KDE62QBFVZTDZ2ZX80GZJSBZ4.sbtc-gas-swap-v1`, block 8930825, source hash verified against the pin). Relay live at `https://sbtc-gas-relay.labs2.workers.dev` (deployed 2026-09-06, three funded sponsor keys). First mainnet sponsored swap mined 2026-09-06 (block 8932782): received equals the quote, sponsor repaid, user started with 0 STX. Dapp builds and passes its fixture harness; live rounds through Leather pending. See [docs/operator-guide.md](docs/operator-guide.md) for the deploy steps and [docs/contract.md](docs/contract.md#deployment) for the deployment record.

## License

MIT.
