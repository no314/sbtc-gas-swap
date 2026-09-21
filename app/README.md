# sBTC to Stacks gas (app/)

Standalone reference dapp for `sbtc-gas-swap-v1`: a user holding sBTC and no STX swaps sBTC to STX in one sponsored transaction, and the sponsor is repaid inside that transaction. Four steps: Connect, Amount, Sign and sponsor, Done. Mainnet only.

Static Vite + React build (architecture ladder rung 1). No backend of its own: reads go to a Stacks node or the Hiro API (`?api=` overrides them, reads only), the wallet signs, a relay from `sponsors.json` co-signs and broadcasts. Quoting, post-conditions, relay discovery and submission come from the SDK in `../sdk` (`@no314/sbtc-gas-swap`, `file:../sdk`); the wallet bridge uses the vendored, pinned `@stacks/connect` and `@stacks/transactions` bundles in `src/vendor/`.

## Commands

```
npm install
npm run build      # dist/
npm run verify     # node --test (pure helpers, fixture parity), verify-hashes, then the browser harness against dist/
npm run shots      # the harness walk with screenshots only (exit 0 regardless)
```

The harness (`scripts/verify-app.mjs`) drives headless Chromium (playwright-core, `/opt/pw-browsers/chromium` or `CHROMIUM=`) through every fixture in `src/fixtures.js`, asserts zero external requests, an empty `localStorage` throughout, no em dash in rendered text, the disclaimer link on every step, rail geometry, and the step-specific criteria, and writes every step in every fixture state to `screenshots/` at device scale 2.

## URL contract

`?chain=mainnet` always; `?txid=` after a relay broadcast; `?api=` always at its current value (default `https://api.hiro.so`); `?fixture=<name>` runs the app offline against recorded data (`happy`, `velar-down`, `no-relay`, `min-out-below-tier`, `tx-abort-1020`, `tx-success`). Nothing is stored in the browser; the URL is the whole state.

## Deploy

Deploy the **contents of `dist/`** only (`index.html`, `disclaimer.html`, `favicon.svg`, `assets/`). The root `index.html` references the unbuilt entry and 404s on a static host. Asset paths are relative, so `dist/` works from a subdirectory; ship the html and the hashed assets together and remove stale hashed files from earlier builds.

## Layout

```
index.html, disclaimer.html   Vite entries (viewport width=1200)
src/main.jsx                  entry: tokens.css, phosphor, app.css, lib.js, app
src/app.jsx                   shell, header, URL contract, in-memory flow state, wallet connect
src/steps.jsx                 Step1..Step4 and the per-step info copy
src/core.jsx                  constants, UI atoms, rail
src/chain.js                  reads through the SDK: snapshot, local quote from a snapshot, fresh quote, relays
src/clients.js                ChainClient + RelayClient, live or fixture fetch
src/fixtures.js               recorded truth vs synthetic, and the fixture fetch
src/amounts.js                pure amount, slippage, tx_result helpers (test/amounts.test.mjs)
src/lib.js                    wallet bridge over src/vendor (three-tier catalog)
src/styles/                   tokens.css, app.css (shared recipes + one marked app block at the tail), fonts/
scripts/verify-app.mjs        browser harness; scripts/verify-hashes.mjs structure-hash pin
```
