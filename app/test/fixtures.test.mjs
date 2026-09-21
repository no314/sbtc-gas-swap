// The fixture fetch must answer every URL the SDK's clients request, and the numbers it
// produces through the SDK are the ones the harness asserts on screen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ChainClient, RelayClient, quoteAllPools, verifyContract, buildSwapCall, defaultTier, defaultSlippageBips, PINNED_STRUCTURE_HASH } from "@no314/sbtc-gas-swap";
import { FIXTURES, FIXTURE_USER, FIXTURE_RELAY, FIXTURE_TXID, makeFixtureFetch } from "../src/fixtures.js";
import { parseReceived } from "../src/amounts.js";

const SOURCE = readFileSync(new URL("../../contracts/contracts/sbtc-gas-swap-v1.clar", import.meta.url), "utf8");
const clients = (name) => {
  const f = makeFixtureFetch(FIXTURES[name], SOURCE);
  return { chain: new ChainClient({ fetch: f, minSpacingMs: 0, retries: 0 }), relay: new RelayClient({ fetch: f, relays: [FIXTURE_RELAY] }), f };
};

test("happy: every pool answers and Velar wins for 5,000 sats", async () => {
  const { chain } = clients("happy");
  const q = await quoteAllPools(chain, { amountSats: 5000n });
  assert.equal(q.unavailable.length, 0);
  assert.equal(q.quotes.length, 3);
  assert.equal(q.best.poolId, 2);
  assert.equal(q.fees.serviceFee, 25n);
  assert.equal(q.fees.integratorFee, 0n);
  assert.equal(q.fees.net, 4975n);
  // The recorded success tuple carries exactly this quote (no price movement in fixture mode).
  const received = parseReceived(FIXTURES.happy.txSequence[1].tx_result.repr);
  assert.equal(received, q.best.out, `fixture received ${received} vs quote ${q.best.out}`);
});

test("velar-down: Velar is reported unavailable, not quoted as 0", async () => {
  const { chain } = clients("velar-down");
  const q = await quoteAllPools(chain, { amountSats: 5000n });
  assert.deepEqual(q.unavailable.map((u) => u.poolId), [2]);
  assert.equal(q.quotes.length, 2);
  assert.ok(!q.quotes.some((p) => p.poolId === 2));
});

test("contract source verifies against the pinned structure hash", async () => {
  const { chain } = clients("happy");
  const v = await verifyContract(chain);
  assert.equal(v.ok, true);
  assert.equal(v.liveHash, PINNED_STRUCTURE_HASH);
});

test("balance, info and nonces answer", async () => {
  const { chain } = clients("happy");
  assert.equal(await chain.getSbtcBalance(FIXTURE_USER), 250_000n);
  assert.equal((await chain.getInfo()).stacks_tip_height, 8923977);
  assert.equal((await chain.getNonces(FIXTURE_USER)).possibleNext, 5);
});

test("relay discovery, ranking and sponsoring", async () => {
  const { relay } = clients("happy");
  const cands = await relay.discover();
  const ranked = RelayClient.rank(cands, "low");
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].minTier, "low");
  const res = await relay.submit("00".repeat(40), ranked);
  assert.equal(res.ok, true);
  assert.equal(res.txid, FIXTURE_TXID);
});

test("no-relay: discovery keeps the failure and ranking yields nothing", async () => {
  const { relay } = clients("no-relay");
  const cands = await relay.discover();
  assert.equal(cands.length, 1);
  assert.ok(cands[0].error);
  assert.equal(RelayClient.rank(cands, "high").length, 0);
});

test("min-out-below-tier: 30 sats at the mid tier throws MIN_OUT_BELOW_TIER, low tier passes", async () => {
  const { chain } = clients("min-out-below-tier");
  const q = await quoteAllPools(chain, { amountSats: 30n });
  const tier = defaultTier(30n, { minTier: "mid" });
  assert.equal(tier, "mid");
  const slippage = defaultSlippageBips(30n);
  assert.throws(() => buildSwapCall({ user: FIXTURE_USER, amountSats: 30n, tier, poolId: q.best.poolId, quoteOut: q.best.out, slippageBips: slippage }), (e) => e.code === "MIN_OUT_BELOW_TIER");
  const call = buildSwapCall({ user: FIXTURE_USER, amountSats: 30n, tier: "low", poolId: q.best.poolId, quoteOut: q.best.out, slippageBips: slippage });
  assert.equal(call.postConditions.length, 3);
});

test("tx poll: not found before sponsoring, then the recorded sequence", async () => {
  const { chain, relay } = clients("happy");
  const before = await chain.json(`/extended/v1/tx/0x${FIXTURE_TXID}`);
  assert.equal(before.tx_status, undefined);
  await relay.submit("aa", RelayClient.rank(await relay.discover(), "low"));
  const p1 = await chain.json(`/extended/v1/tx/0x${FIXTURE_TXID}`);
  const p2 = await chain.json(`/extended/v1/tx/0x${FIXTURE_TXID}`);
  const p3 = await chain.json(`/extended/v1/tx/0x${FIXTURE_TXID}`);
  assert.equal(p1.tx_status, "pending");
  assert.equal(p2.tx_status, "success");
  assert.equal(p3.tx_status, "success");
});

test("tx-abort-1020 answers an abort with (err u1020)", async () => {
  const { chain, relay } = clients("tx-abort-1020");
  await relay.submit("aa", RelayClient.rank(await relay.discover(), "low"));
  const tx = await chain.json(`/extended/v1/tx/0x${FIXTURE_TXID}`);
  assert.equal(tx.tx_status, "abort_by_response");
  assert.equal(tx.tx_result.repr, "(err u1020)");
});
