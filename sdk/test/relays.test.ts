import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { RelayClient, type RelayInfo } from "../src/relays.js";
import { explainRelayError, explainTxFailure } from "../src/explain.js";
import { structureHash, verifyContract } from "../src/verify-contract.js";
import { ChainClient } from "../src/client/chain.js";
import { readFileSync } from "node:fs";

const info = (url: string, minTier: RelayInfo["minTier"], mid = "5000"): RelayInfo => ({
  url, contract: "SP2BM6AQSMQ04CX8KDE62QBFVZTDZ2ZX80GZJSBZ4.sbtc-gas-swap-v1", network: "mainnet",
  sponsors: { low: "SP1", mid: "SP2", high: "SP3" }, minTier, feeEstimate: { low: "3000", mid, high: "9000" },
  feeFactor: 1, maxPerOriginPerHour: 5, version: "0.1.0",
});

function fakeRelays(behaviour: Record<string, (path: string, init?: RequestInit) => Response>) {
  const f = (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const h = behaviour[u.origin];
    if (!h) return new Response("no such relay", { status: 502 });
    return h(u.pathname, init);
  }) as unknown as typeof fetch;
  return new RelayClient({ fetch: f, relays: Object.keys(behaviour) });
}

describe("RelayClient", () => {
  test("discover keeps unreachable relays with their error", async () => {
    const c = fakeRelays({
      "https://a.example": (p) => new Response(JSON.stringify(info("https://a.example", "low"))),
      "https://b.example": () => new Response("down", { status: 503 }),
    });
    const d = await c.discover();
    assert.equal(d.length, 2);
    assert.equal(d[0].info?.minTier, "low");
    assert.match(d[1].error!, /503/);
  });
  test("rank filters by the relay's minimum tier and sorts by fee", () => {
    const ranked = RelayClient.rank([
      { url: "x", info: info("x", "mid", "7000") }, { url: "y", info: info("y", "low", "6000") }, { url: "z", info: info("z", "high") }, { url: "w", error: "down" },
    ], "mid");
    assert.deepEqual(ranked.map((r) => r.url), ["y", "x"]);
    assert.deepEqual(RelayClient.rank([{ url: "z", info: info("z", "high") }], "low"), []);
  });
  test("submit falls through to the next relay on transient errors and stops on a final verdict", async () => {
    let bCalls = 0;
    const c = fakeRelays({
      "https://a.example": (p) => p === "/v1/sponsor" ? new Response(JSON.stringify({ code: "SPONSOR_BUSY", message: "busy" }), { status: 503 }) : new Response("{}"),
      "https://b.example": (p) => { bCalls++; return new Response(JSON.stringify({ txid: "ab".repeat(32), fee: "5000", sponsor: "SP2", sponsoredTx: "00" })); },
    });
    const ok = await c.submit("00", [info("https://a.example", "low"), info("https://b.example", "low")]);
    assert.equal(ok.ok, true);
    assert.equal((ok as any).relay, "https://b.example");
    const c2 = fakeRelays({
      "https://a.example": () => new Response(JSON.stringify({ code: "BAD_POST_CONDITIONS", message: "nope" }), { status: 400 }),
      "https://b.example": () => { bCalls++; return new Response("{}"); },
    });
    const before = bCalls;
    const fail = await c2.submit("00", [info("https://a.example", "low"), info("https://b.example", "low")]);
    assert.equal(fail.ok, false);
    assert.equal((fail as any).attempts.length, 1);
    assert.equal(bCalls, before, "final verdicts are not retried elsewhere");
  });
});

describe("explanations", () => {
  test("every relay code has a title and an action", () => {
    for (const code of ["BAD_POST_CONDITIONS", "QUOTE_BELOW_MIN_OUT", "SPONSOR_BUSY", "UNKNOWN_CODE"]) {
      const e = explainRelayError(code);
      assert.ok(e.title.length > 10 && e.action.length > 10);
    }
  });
  test("on-chain aborts map pool error codes to slippage advice", () => {
    assert.match(explainTxFailure("abort_by_response", "(err u1020)").action, /slippage/);
    assert.match(explainTxFailure("abort_by_response", "(err u2003)").title, /DLMM/);
    assert.match(explainTxFailure("abort_by_post_condition").title, /post-condition/);
  });
  test("no em dashes in any copy", () => {
    const all = JSON.stringify([explainRelayError("BAD_TIER"), explainTxFailure("abort_by_response", "(err u107)")]);
    assert.equal(all.includes("—"), false);
  });
});

describe("verifyContract", () => {
  const source = readFileSync(new URL("../../../contracts/contracts/sbtc-gas-swap-v1.clar", import.meta.url), "utf8");
  test("structure hash is formatting independent and matches the contracts project's hash", async () => {
    const a = await structureHash(source);
    const b = await structureHash(source.replace(/\n\s+/g, "\n").replace(/\(\s+/g, "("));
    assert.equal(a, b);
    assert.equal(a, "5702f09a5ab584d56d7e803b94143d1c51327c5a95f2a2309df4e604215ed608");
  });
  test("a failed source read is unavailable, not a mismatch", async () => {
    const client = new ChainClient({ fetch: (async () => new Response("nope", { status: 500 })) as any, minSpacingMs: 0, retries: 0 });
    const v = await verifyContract(client, "abc");
    assert.equal(v.ok, false);
    assert.ok(v.error);
    assert.equal(v.liveHash, "");
  });
  test("live source equal to the reviewed source verifies", async () => {
    const client = new ChainClient({ fetch: (async () => new Response(JSON.stringify({ source, publish_height: 1 }))) as any, minSpacingMs: 0, retries: 0 });
    const v = await verifyContract(client);
    assert.equal(v.ok, true);
  });
});
