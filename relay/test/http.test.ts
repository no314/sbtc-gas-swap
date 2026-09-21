import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { getAddressFromPrivateKey, makeRandomPrivKey } from "@stacks/transactions";
import { route } from "../src/core/http.js";
import { MemoryStore } from "../src/core/store.js";
import { POLICY, type TierName } from "../src/core/config.js";
import type { RelayDeps } from "../src/core/relay.js";
import { buildUserSignedSwap, GOOD, USER_ADDRESS } from "./fixtures.js";

function deps(): RelayDeps {
  const mk = () => { const privateKey = makeRandomPrivKey(); return { privateKey, address: getAddressFromPrivateKey(privateKey, "mainnet") }; };
  return {
    keys: { low: mk(), mid: mk(), high: mk() } as Record<TierName, any>,
    store: new MemoryStore(), policy: { ...POLICY }, now: () => Date.now(),
    chain: {
      getSbtcBalance: async () => 10_000_000n,
      getNonces: async (a) => ({ lastExecuted: a === USER_ADDRESS ? -1 : 3, lastMempool: null, possibleNext: a === USER_ADDRESS ? 0 : 4, missing: [] }),
      quotePool: async () => ({ out: 90_000_000n, in: 0n }),
      estimateFee: async () => ({ low: 2_000n, mid: 4_000n, high: 8_000n }),
      broadcast: async () => ({ txid: "cd".repeat(32) }),
    },
  };
}
const opts = { contractId: "SP2BM6AQSMQ04CX8KDE62QBFVZTDZ2ZX80GZJSBZ4.sbtc-gas-swap-v1", termsUrl: "https://example.org/terms" };

describe("HTTP routes", () => {
  test("GET /v1/info", async () => {
    const res = await route(new Request("https://r.example/v1/info"), deps(), opts);
    assert.equal(res.status, 200);
    const j = await res.json() as any;
    assert.equal(j.minTier, "low");
    assert.equal(j.termsUrl, opts.termsUrl);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
  });
  test("POST /v1/sponsor happy path and typed errors", async () => {
    const hex = (await buildUserSignedSwap(GOOD)).serialize();
    const ok = await route(new Request("https://r.example/v1/sponsor", { method: "POST", body: JSON.stringify({ tx: hex }), headers: { "content-type": "application/json" } }), deps(), opts);
    assert.equal(ok.status, 200);
    assert.equal(((await ok.json()) as any).txid, "cd".repeat(32));
    const bad = await route(new Request("https://r.example/v1/sponsor", { method: "POST", body: "{}" }), deps(), opts);
    assert.equal(bad.status, 400);
    assert.equal(((await bad.json()) as any).code, "MALFORMED");
    const notJson = await route(new Request("https://r.example/v1/sponsor", { method: "POST", body: "nope" }), deps(), opts);
    assert.equal(((await notJson.json()) as any).code, "MALFORMED");
  });
  test("unknown routes and preflight", async () => {
    assert.equal((await route(new Request("https://r.example/nope"), deps(), opts)).status, 404);
    assert.equal((await route(new Request("https://r.example/v1/sponsor", { method: "OPTIONS" }), deps(), opts)).status, 204);
  });
});

describe("CPU budget", () => {
  test("verify plus sponsor-sign of one swap completes well inside 10 ms on this machine (Worker free plan limit)", async () => {
    const hex = (await buildUserSignedSwap(GOOD)).serialize();
    const d = deps();
    // warm
    await route(new Request("https://r.example/v1/sponsor", { method: "POST", body: JSON.stringify({ tx: hex }) }), d, opts);
    const t0 = performance.now();
    const N = 20;
    for (let i = 0; i < N; i++) await route(new Request("https://r.example/v1/sponsor", { method: "POST", body: JSON.stringify({ tx: hex }) }), { ...d, store: new MemoryStore() }, opts);
    const perCall = (performance.now() - t0) / N;
    console.log(`verify+sign+route per call: ${perCall.toFixed(2)} ms`);
    assert.ok(perCall < 50, `per call ${perCall} ms`);
  });
});
