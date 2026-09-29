import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { deserializeTransaction, AuthType, getAddressFromPrivateKey, makeRandomPrivKey } from "@stacks/transactions";
import { handleSponsor, buildInfo, planRbf, type RelayDeps, type RelayChain, type PendingRecord, type Policy } from "../src/core/relay.js";
import { POLICY, RelayError, TIERS, type TierName } from "../src/core/config.js";
import { MemoryStore } from "../src/core/store.js";
import { buildUserSignedSwap, GOOD, USER_ADDRESS } from "./fixtures.js";

function keys(): Record<TierName, { privateKey: string; address: string }> {
  const mk = () => { const privateKey = makeRandomPrivKey(); return { privateKey, address: getAddressFromPrivateKey(privateKey, "mainnet") }; };
  return { low: mk(), mid: mk(), high: mk() };
}

interface FakeChain extends RelayChain { broadcasts: string[]; badNonceOnce: boolean }
function fakeChain(o: Partial<{ sbtc: bigint; userNext: number; quote: bigint; sponsorNext: number }> = {}): FakeChain {
  const c: FakeChain = {
    broadcasts: [], badNonceOnce: false,
    getSbtcBalance: async () => o.sbtc ?? 1_000_000n,
    getNonces: async (addr: string) => addr === USER_ADDRESS
      ? { lastExecuted: (o.userNext ?? 0) - 1, lastMempool: null, possibleNext: o.userNext ?? 0, missing: [] }
      : { lastExecuted: (o.sponsorNext ?? 7) - 1, lastMempool: null, possibleNext: o.sponsorNext ?? 7, missing: [] },
    quotePool: async () => ({ out: o.quote ?? 90_000_000n, in: 0n }),
    broadcast: async (hex: string) => {
      if (c.badNonceOnce) { c.badNonceOnce = false; return { error: "transaction rejected", reason: "BadNonce", reason_data: { expected: 8, actual: 7 } }; }
      c.broadcasts.push(hex);
      return { txid: deserializeTransaction(hex).txid() };
    },
  };
  return c;
}

function deps(chain: RelayChain = fakeChain(), k = keys(), store = new MemoryStore(), policy: Policy = { ...POLICY }): RelayDeps {
  return { chain, keys: k, store, policy, now: () => 1_700_000_000_000 };
}
const rejects = (p: Promise<unknown>, code: string) => assert.rejects(p, (e: any) => (e instanceof RelayError && e.code === code) || (() => { throw new Error(`expected ${code}, got ${e?.code}: ${e?.message}`); })());

describe("handleSponsor", () => {
  test("sponsors a valid swap with the tier's key, fee within the tier, and broadcasts", async () => {
    const chain = fakeChain();
    const k = keys();
    const d = deps(chain, k);
    const hex = (await buildUserSignedSwap(GOOD)).serialize();
    const r = await handleSponsor(hex, d);
    assert.equal(r.tier, "mid");
    assert.equal(r.sponsor, k.mid.address);
    // mid opens at its fixed bid; no estimator is consulted
    assert.equal(BigInt(r.fee), POLICY.openingBid.mid);
    assert.equal(BigInt(r.fee), 6_000n);
    assert.equal(chain.broadcasts.length, 1);
    const tx = deserializeTransaction(r.sponsoredTx);
    assert.equal(tx.auth.authType, AuthType.Sponsored);
    assert.equal(BigInt((tx.auth as any).sponsorSpendingCondition.fee), 6_000n);
    assert.equal(BigInt((tx.auth as any).sponsorSpendingCondition.nonce), 7n);
    assert.match(r.txid, /^[0-9a-f]{64}$/);
    const st = await d.store.getNonceState(k.mid.address);
    assert.equal(st.next, 8n);
    assert.deepEqual(st.pending, [7n]);
    const pend = await d.store.listPending();
    assert.equal(pend.length, 1);
    assert.equal(pend[0].originalTx, hex);
  });
  test("each tier opens at its fixed bid, whatever the mempool says", async () => {
    const k = keys();
    const seen: Record<string, bigint> = {};
    for (const t of ["low", "mid", "high"] as TierName[]) {
      const hex = (await buildUserSignedSwap({ ...GOOD, tier: TIERS[t], minOut: TIERS[t] > GOOD.minOut ? TIERS[t] : GOOD.minOut })).serialize();
      const r = await handleSponsor(hex, deps(fakeChain({ quote: 2_000_000_000n }), k));
      seen[t] = BigInt(r.fee);
    }
    assert.deepEqual(seen, { low: 3_000n, mid: 6_000n, high: 800_000n });
    // and never above the tier, even when the operator sets an opening bid above it
    const low = (await buildUserSignedSwap({ ...GOOD, tier: TIERS.low })).serialize();
    const r = await handleSponsor(low, deps(fakeChain(), keys(), new MemoryStore(), { ...POLICY, openingBid: { ...POLICY.openingBid, low: 50_000n } }));
    assert.equal(BigInt(r.fee), TIERS.low);
  });
  test("2026-09-29 incident: the relay does not consult the node's fee estimator at all", async () => {
    // Observed on mainnet: node estimates low 632, mid 632717, high 712364 for this swap while the
    // mempool held 17 transactions. Trusting any of them made minTier high and refused every user.
    // RelayChain has no estimateFee any more; a fake that throws on it proves nothing reaches it.
    const chain = fakeChain() as FakeChain & { estimateFee?: () => never };
    chain.estimateFee = () => { throw new Error("estimator consulted"); };
    const low = (await buildUserSignedSwap({ ...GOOD, tier: TIERS.low })).serialize();
    const r = await handleSponsor(low, deps(chain));
    assert.equal(r.tier, "low");
    assert.equal(BigInt(r.fee), POLICY.openingBid.low);
  });
  test("refuses a tier below the operator's minimum tier", async () => {
    const low = (await buildUserSignedSwap({ ...GOOD, tier: TIERS.low })).serialize();
    await rejects(handleSponsor(low, deps(fakeChain(), keys(), new MemoryStore(), { ...POLICY, minTier: "mid" })), "TIER_BELOW_MIN");
    const mid = (await buildUserSignedSwap(GOOD)).serialize();
    await rejects(handleSponsor(mid, deps(fakeChain(), keys(), new MemoryStore(), { ...POLICY, minTier: "high" })), "TIER_BELOW_MIN");
    // at the minimum is accepted
    assert.equal((await handleSponsor(mid, deps(fakeChain(), keys(), new MemoryStore(), { ...POLICY, minTier: "mid" }))).tier, "mid");
  });
  test("refuses when the user lacks sBTC, when the nonce is stale, and when the live quote is below min-out", async () => {
    const hex = (await buildUserSignedSwap(GOOD)).serialize();
    await rejects(handleSponsor(hex, deps(fakeChain({ sbtc: 29_999n }))), "INSUFFICIENT_SBTC");
    await rejects(handleSponsor(hex, deps(fakeChain({ userNext: 3 }))), "BAD_NONCE");
    await rejects(handleSponsor(hex, deps(fakeChain({ quote: GOOD.minOut - 1n }))), "QUOTE_BELOW_MIN_OUT");
  });
  test("rate limits per origin and never charges the sponsor for a refused request", async () => {
    const chain = fakeChain();
    const d = deps(chain, keys(), new MemoryStore(), { ...POLICY, perOriginPerHour: 2 });
    for (let n = 0; n < 2; n++) await handleSponsor((await buildUserSignedSwap({ ...GOOD }, { nonce: BigInt(n) })).serialize(), { ...d, chain: fakeChain({ userNext: n }) });
    await rejects(handleSponsor((await buildUserSignedSwap(GOOD, { nonce: 2n })).serialize(), { ...d, chain: fakeChain({ userNext: 2 }) }), "RATE_LIMITED");
  });
  test("SPONSOR_BUSY when the tier's key has too many pending transactions", async () => {
    const k = keys();
    const store = new MemoryStore();
    await store.setNonceState(k.mid.address, { next: 27n, pending: Array.from({ length: 20 }, (_, i) => 7n + BigInt(i)) });
    await rejects(handleSponsor((await buildUserSignedSwap(GOOD)).serialize(), deps(fakeChain(), k, store)), "SPONSOR_BUSY");
  });
  test("a BadNonce from the node triggers one reconcile and retry", async () => {
    const chain = fakeChain({ sponsorNext: 7 });
    chain.badNonceOnce = true;
    let calls = 0;
    const orig = chain.getNonces;
    chain.getNonces = async (addr: string) => { const r = await orig(addr); if (addr !== USER_ADDRESS) { calls++; if (calls > 1) return { ...r, possibleNext: 8, lastExecuted: 7 }; } return r; };
    const r = await handleSponsor((await buildUserSignedSwap(GOOD)).serialize(), deps(chain));
    assert.equal(BigInt((deserializeTransaction(r.sponsoredTx).auth as any).sponsorSpendingCondition.nonce), 8n);
    assert.equal(chain.broadcasts.length, 1);
  });
  test("other broadcast rejections surface as BROADCAST_FAILED with the node's reason", async () => {
    const chain = fakeChain();
    chain.broadcast = async () => ({ error: "transaction rejected", reason: "NotEnoughFunds" });
    await rejects(handleSponsor((await buildUserSignedSwap(GOOD)).serialize(), deps(chain)), "BROADCAST_FAILED");
  });
  test("each tier is signed by its own key", async () => {
    const k = keys();
    for (const t of ["low", "mid", "high"] as TierName[]) {
      const hex = (await buildUserSignedSwap({ ...GOOD, tier: TIERS[t], minOut: TIERS[t] > GOOD.minOut ? TIERS[t] : GOOD.minOut })).serialize();
      const r = await handleSponsor(hex, deps(fakeChain({ quote: 2_000_000_000n }), k));
      assert.equal(r.sponsor, k[t].address);
    }
  });
});

describe("buildInfo", () => {
  test("publishes sponsors per tier, the opening bid per tier, and the operator's minimum tier", async () => {
    const k = keys();
    const info = await buildInfo(deps(fakeChain(), k));
    assert.equal(info.sponsors.mid, k.mid.address);
    assert.equal(info.minTier, "low");
    assert.deepEqual(info.feeEstimate, { low: "3000", mid: "6000", high: "800000" });
    assert.deepEqual(info.feePolicy.firstBid, { low: "3000", mid: "6000", high: "800000" });
    assert.deepEqual(info.feePolicy.rbfAfterSeconds, POLICY.rbfAfterSeconds);
    assert.equal(info.feePolicy.maxFee.high, TIERS.high.toString());
    assert.ok(!("nodeEstimate" in info));
    assert.ok(!("estimatePercentile" in info));
  });
  test("the minimum tier is the operator's policy, not a market reading", async () => {
    const info = await buildInfo(deps(fakeChain(), keys(), new MemoryStore(), { ...POLICY, minTier: "high" }));
    assert.equal(info.minTier, "high");
  });
});

describe("planRbf", () => {
  const rec = (o: Partial<PendingRecord>): PendingRecord => ({
    txid: "aa", tier: "mid", sponsor: "SPX", sponsorNonce: 7n, fee: 5_000n, originalTx: "00", broadcastAt: 0, bumps: 0, ...o,
  });
  test("bumps a transaction pending longer than the threshold, within the tier", () => {
    const plan = planRbf([rec({ broadcastAt: 0 })], { SPX: { lastExecuted: 6, lastMempool: 7, possibleNext: 8, missing: [] } }, 31 * 60_000, POLICY);
    assert.equal(plan.bump.length, 1);
    assert.equal(plan.bump[0].newFee, 5_500n);
  });
  test("drops records the chain has executed and leaves young ones alone", () => {
    const plan = planRbf([rec({ sponsorNonce: 5n }), rec({ sponsorNonce: 7n, broadcastAt: 30 * 60_000 })], { SPX: { lastExecuted: 6, lastMempool: 7, possibleNext: 8, missing: [] } }, 31 * 60_000, POLICY);
    assert.deepEqual(plan.done.map((r) => r.sponsorNonce), [5n]);
    assert.equal(plan.bump.length, 0);
  });
  test("the bump threshold is per tier: low and mid wait 30 minutes, high waits one 10 minute sweep", () => {
    const nonces = { SPX: { lastExecuted: 6, lastMempool: 7, possibleNext: 8, missing: [] } };
    assert.deepEqual(POLICY.rbfAfterSeconds, { low: 1800, mid: 1800, high: 600 });
    // mid (the default record) at 11 minutes: untouched; at 31: bumped
    assert.equal(planRbf([rec({ broadcastAt: 0 })], nonces, 11 * 60_000, POLICY).bump.length, 0);
    assert.equal(planRbf([rec({ broadcastAt: 0 })], nonces, 31 * 60_000, POLICY).bump.length, 1);
    // low behaves like mid
    assert.equal(planRbf([rec({ tier: "low", fee: 3_000n, broadcastAt: 0 })], nonces, 29 * 60_000, POLICY).bump.length, 0);
    assert.equal(planRbf([rec({ tier: "low", fee: 3_000n, broadcastAt: 0 })], nonces, 31 * 60_000, POLICY).bump.length, 1);
    // high at 11 minutes: bumped already
    const high = planRbf([rec({ tier: "high", fee: 800_000n, broadcastAt: 0 })], nonces, 11 * 60_000, POLICY);
    assert.equal(high.bump.length, 1);
    assert.equal(high.bump[0].newFee, 880_000n);
  });
  test("a fee already at the tier is reported as stuck instead of bumped", () => {
    const plan = planRbf([rec({ fee: TIERS.mid })], { SPX: { lastExecuted: 6, lastMempool: 7, possibleNext: 8, missing: [] } }, 60 * 60_000, POLICY);
    assert.equal(plan.stuck.length, 1);
  });
});
