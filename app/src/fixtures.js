// Golden fixtures for `?fixture=<name>` (static-first-architecture: fixture mode ships in the
// production build behind a URL flag; the harness runs every acceptance criterion against the
// exact deployed artifact with zero external requests).
//
// RECORDED TRUTH (mainnet, Stacks tip 8923977, read 2026-09-05; docs/research-findings.md):
//   XYK pool xyk-pool-sbtc-stx-v-1-1: x-balance 44,730,224 sats, y-balance 136,671,025,817 uSTX,
//     protocol fee 10 bips, provider fee 40 bips, pool enabled.
//   Velar univ2-pool-v1_0_0-0070: reserve0 212,869,098,374 uSTX, reserve1 69,663,360 sats,
//     swap-fee 9970/10000.
//   DLMM dlmm-pool-stx-sbtc-v-2-bps-15: active bin 340, bin-step 15, initial-price 19,610,
//     fees 25 + 25 + 0 bips, on-chain STX 1,298,977,172,826 uSTX.
//   The contract source is the reviewed source in contracts/contracts/sbtc-gas-swap-v1.clar,
//     served as /v2/contracts/source; its structure hash is the SDK's PINNED_STRUCTURE_HASH.
// SYNTHETIC (placeholders the app never validates cryptographically):
//   the user principal and its sBTC balance, DLMM per-bin balances and bin factors, relay URLs,
//   sponsor addresses, fee estimates, every txid, signed hex, nonces, block heights of the
//   swap transaction, and the tx_result tuples (their arithmetic is consistent with the quote).
import {
  cvToHex, responseOkCV, tupleCV, uintCV, intCV, boolCV, someCV, listCV,
} from "./vendor/transactions.js";

export const FIXTURE_USER = "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7";
export const FIXTURE_RELAY = "https://relay.fixture.invalid";
const SPONSORS = {
  low: "SP3TB3AJ0XMZ9S6CGY2CQ6R06H1Z6DJQ1SH15ZP2H",
  mid: "SPMPMA1V6P430M8C91QS1G9XJ95S59JS1TZFZ4Q4",
  high: "SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF",
};
export const FIXTURE_TXID = "7d3f0a5c9e1b2846a0c3d5e7f9b1d3a5c7e9f1b3d5a7c9e1f3b5d7a9c1e3f5b7";
const SPONSORED_HEX = "808000000005" + "cd".repeat(180);
export const TIP = 8923977;

const ok = (cv) => ({ okay: true, result: cvToHex(responseOkCV(cv)) });
const unsupported = (why) => ({ okay: false, cause: why });

const XYK_POOL = () => ok(tupleCV({
  "x-balance": uintCV(44_730_224n), "y-balance": uintCV(136_671_025_817n),
  "x-protocol-fee": uintCV(10), "x-provider-fee": uintCV(40), "pool-status": boolCV(true),
}));
const VELAR_POOL = () => ok(tupleCV({ reserve0: uintCV(212_869_098_374n), reserve1: uintCV(69_663_360n) }));
const VELAR_FEES = () => ok(tupleCV({ "swap-fee": tupleCV({ num: uintCV(9970), den: uintCV(10_000) }) }));
const DLMM_INFO = () => ok(tupleCV({
  "active-bin-id": intCV(340), "bin-step": uintCV(15), "initial-price": uintCV(19_610),
  "protocol-fee": uintCV(25), "provider-fee": uintCV(25), "variable-fee": uintCV(0),
}));
// Bin factors are synthetic: the active bin and its neighbours carry a plausible 1.0015^n factor
// scaled by 1e8; every other slot is 1.0. Only the walked bins matter to the quote.
const DLMM_FACTORS = () => ok(someCV(listCV(Array.from({ length: 1001 }, (_, i) =>
  uintCV(i === 840 ? 166_460_000n : i === 841 ? 166_710_000n : i === 842 ? 166_960_000n : i === 843 ? 167_210_000n : 100_000_000n)))));
// Per-bin balances are synthetic; the total STX across bins is scaled so the DLMM reserve
// stays far below the recorded pool total (the pool's STX sits in many bins, not four).
const DLMM_BIN = () => ok(tupleCV({ "x-balance": uintCV(50_000_000_000n), "y-balance": uintCV(0), "bin-shares": uintCV(1) }));

const relayInfo = (minTier) => ({
  contract: "SP2BM6AQSMQ04CX8KDE62QBFVZTDZ2ZX80GZJSBZ4.sbtc-gas-swap-v1",
  network: "mainnet",
  sponsors: SPONSORS,
  minTier,
  feeEstimate: { low: "3200", mid: "3200", high: "3200" },
  feeFactor: 1,
  maxPerOriginPerHour: 5,
  termsUrl: "./disclaimer.html",
  version: "0.1.0",
});

// A mined swap of 5,000 sats through the Velar pool (best at the recorded reserves), tier low.
const SUCCESS_RESULT = "(ok (tuple (integrator-fee u0) (pool-id u2) (rebate u10000) (received u15155105) (service-fee u25)))";
const txBody = (status, repr, extra = {}) => ({
  tx_id: "0x" + FIXTURE_TXID, tx_status: status, tx_type: "contract_call",
  sender_address: FIXTURE_USER, sponsored: true, sponsor_address: SPONSORS.low,
  fee_rate: "3200", nonce: 5,
  ...(repr ? { tx_result: { hex: "0x", repr } } : {}),
  ...extra,
});

export const FIXTURES = {
  // Every pool answers, one relay with minimum tier low; the swap mines after one pending poll.
  happy: {
    inputs: { amount: "5000", unit: "sats" }, balanceSats: 250_000n, minTier: "low",
    txSequence: [txBody("pending"), txBody("success", SUCCESS_RESULT, { block_height: TIP + 3 })],
  },
  // Velar's get-pool read fails: shown as unavailable, never as 0.
  "velar-down": {
    inputs: { amount: "5000", unit: "sats" }, balanceSats: 250_000n, minTier: "low",
    velarDown: true,
    txSequence: [txBody("pending"), txBody("success", SUCCESS_RESULT, { block_height: TIP + 3 })],
  },
  // No relay reachable: /v1/info fails like a network error.
  "no-relay": {
    inputs: { amount: "5000", unit: "sats" }, balanceSats: 250_000n, minTier: "low",
    relayDown: true,
    txSequence: [],
  },
  // The relay demands the mid tier and the amount is tiny: min-out lands below the tier.
  "min-out-below-tier": {
    inputs: { amount: "30", unit: "sats" }, balanceSats: 250_000n, minTier: "mid",
    txSequence: [],
  },
  // The swap mines but aborts inside the XYK pool: (err u1020), output below minimum.
  "tx-abort-1020": {
    inputs: { amount: "5000", unit: "sats" }, balanceSats: 250_000n, minTier: "low",
    txSequence: [txBody("abort_by_response", "(err u1020)", { block_height: TIP + 3 })],
  },
  // The swap mines successfully on the first poll.
  "tx-success": {
    inputs: { amount: "5000", unit: "sats" }, balanceSats: 250_000n, minTier: "low",
    txSequence: [txBody("success", SUCCESS_RESULT, { block_height: TIP + 3 })],
  },
};

// A fetch replacement that answers every URL the SDK's ChainClient and RelayClient request.
// Stateful per page load: the transaction poll walks `txSequence` and stays on its last entry.
// `contractSource` is the reviewed Clarity source (the app passes the ?raw import of
// contracts/contracts/sbtc-gas-swap-v1.clar; the Node tests read the same file from disk).
export function makeFixtureFetch(fx, contractSource) {
  let polls = 0;
  let sponsored = false;
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const delay = () => new Promise((r) => setTimeout(r, 80));
  const callRead = {
    "xyk-pool-sbtc-stx-v-1-1/get-pool": XYK_POOL,
    "univ2-pool-v1_0_0-0070/get-pool": () => fx.velarDown ? unsupported("Unchecked(NoSuchContract)") : VELAR_POOL(),
    "univ2-fees-v1_0_0-0070/get-fees": VELAR_FEES,
    "dlmm-pool-stx-sbtc-v-2-bps-15/get-pool-for-swap": DLMM_INFO,
    "dlmm-core-v-1-1/get-bin-factors-by-step": DLMM_FACTORS,
    "dlmm-pool-stx-sbtc-v-2-bps-15/get-bin-balances": DLMM_BIN,
    "sbtc-token/get-balance": () => ok(uintCV(fx.balanceSats)),
  };
  return async function fixtureFetch(url, init = {}) {
    await delay();
    const u = String(url);
    const m = u.match(/call-read\/[^/]+\/([^/]+)\/([^/?]+)/);
    if (m) {
      const a = callRead[`${m[1]}/${m[2]}`];
      return json(a ? a() : unsupported(`no fixture for ${m[1]}/${m[2]}`));
    }
    if (u.includes("/v2/contracts/source/")) return json({ source: contractSource, publish_height: TIP - 1200 });
    if (u.includes("/v2/info")) return json({ stacks_tip_height: TIP, burn_block_height: 962700, network_id: 1, server_version: "fixture" });
    if (/\/extended\/v1\/address\/[^/]+\/nonces/.test(u)) return json({ last_executed_tx_nonce: 4, last_mempool_tx_nonce: null, possible_next_nonce: 5, detected_missing_nonces: [] });
    if (u.includes("/v2/accounts/")) return json({ balance: "0x0", locked: "0x0", nonce: 5 });
    if (u.includes("/extended/v1/tx/")) {
      const seq = fx.txSequence;
      if (!sponsored || seq.length === 0) return json({ error: "not found", tx_status: undefined });
      const body = seq[Math.min(polls, seq.length - 1)];
      polls++;
      return json(body);
    }
    if (u.startsWith(FIXTURE_RELAY)) {
      if (fx.relayDown) throw new TypeError("Failed to fetch");
      if (u.endsWith("/v1/info")) return json(relayInfo(fx.minTier));
      if (u.endsWith("/v1/sponsor") && init.method === "POST") {
        let tx = "";
        try { tx = JSON.parse(init.body).tx; } catch {}
        if (!/^[0-9a-f]+$/i.test(String(tx))) return json({ code: "MALFORMED", message: "tx is not hex" }, 400);
        sponsored = true;
        return json({ txid: FIXTURE_TXID, sponsoredTx: SPONSORED_HEX, fee: "3200", tier: fx.minTier, sponsor: SPONSORS[fx.minTier] });
      }
    }
    return json({ error: "unsupported in fixture mode", url: u });
  };
}
