import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Cl, Pc, PostConditionMode, sponsorTransaction } from "@stacks/transactions";
import { verifySponsoredSwap, type VerifiedSwap } from "../src/core/verify.js";
import { RelayError, TIERS } from "../src/core/config.js";
import {
  buildUserSignedSwap, expectedPostConditions, swapFunctionArgs, GOOD, GOOD_WITH_INTEGRATOR, USER_ADDRESS, USER_KEY,
} from "./fixtures.js";

async function hexOf(args = GOOD, o = {}) {
  return (await buildUserSignedSwap(args, o)).serialize();
}
function rejects(promise: Promise<unknown>, code: string) {
  return assert.rejects(promise, (e: unknown) => e instanceof RelayError && e.code === code
    ? true : (() => { throw new Error(`expected ${code}, got ${(e as any)?.code}: ${(e as Error).message}`); })());
}
const verify = async (hex: string) => verifySponsoredSwap(hex);

describe("verifySponsoredSwap accepts", () => {
  test("a correct XYK swap and extracts its fields", async () => {
    const v: VerifiedSwap = await verify(await hexOf(GOOD));
    assert.equal(v.origin, USER_ADDRESS);
    assert.equal(v.originNonce, 0n);
    assert.equal(v.amount, 30_000n);
    assert.equal(v.tier, TIERS.mid);
    assert.equal(v.tierName, "mid");
    assert.equal(v.minOut, 81_000_000n);
    assert.equal(v.poolId, 1);
    assert.equal(v.integrator, undefined);
    assert.equal(v.integratorBips, 0n);
    assert.equal(v.serviceFee, 150n);
    assert.equal(v.integratorFee, 0n);
    assert.equal(v.net, 29_850n);
    assert.ok(v.byteLength > 200);
  });
  test("a swap with an integrator and fee split", async () => {
    const v = await verify(await hexOf(GOOD_WITH_INTEGRATOR));
    assert.equal(v.integrator, GOOD_WITH_INTEGRATOR.integrator);
    assert.equal(v.integratorBips, 100n);
    assert.equal(v.integratorFee, 300n);
    assert.equal(v.net, 29_550n);
  });
  test("Velar (eq) and DLMM (lte) post-condition shapes", async () => {
    const velar = { ...GOOD, poolId: 2 };
    assert.equal((await verify(await hexOf(velar))).poolId, 2);
    const dlmm = { ...GOOD, poolId: 3, amount: 1_000_000n, minOut: 2_900_000_000n };
    assert.equal((await verify(await hexOf(dlmm))).poolId, 3);
  });
  test("every tier", async () => {
    for (const tier of [TIERS.low, TIERS.mid, TIERS.high]) {
      const v = await verify(await hexOf({ ...GOOD, tier, minOut: tier > GOOD.minOut ? tier : GOOD.minOut }));
      assert.equal(v.tier, tier);
    }
  });
  test("integrator bips 0 with an integrator present", async () => {
    const v = await verify(await hexOf({ ...GOOD_WITH_INTEGRATOR, integratorBips: 0n }));
    assert.equal(v.integratorFee, 0n);
  });
});

describe("verifySponsoredSwap rejects", () => {
  test("malformed hex", async () => {
    await rejects(verify("00ff"), "MALFORMED");
    await rejects(verify("zz"), "MALFORMED");
  });
  test("standard (non-sponsored) auth", async () => {
    await rejects(verify(await hexOf(GOOD, { sponsored: false, fee: 1000n })), "NOT_SPONSORED_AUTH");
  });
  test("a transaction already carrying a sponsor signature", async () => {
    const tx = await buildUserSignedSwap(GOOD);
    const sponsored = await sponsorTransaction({ transaction: tx, sponsorPrivateKey: USER_KEY, fee: 3000n, sponsorNonce: 0n, network: "mainnet" });
    await rejects(verify(sponsored.serialize()), "NOT_SPONSORED_AUTH");
  });
  test("testnet transaction", async () => {
    await rejects(verify(await hexOf(GOOD, { network: "testnet", postConditions: expectedPostConditions(GOOD, "ST227DXSVTHZZKF3B9N38G5GGG03N1Z4V85S1MSPX") })), "WRONG_NETWORK");
  });
  test("another contract or function", async () => {
    await rejects(verify(await hexOf(GOOD, { contractName: "sbtc-gas-swap-v2" })), "WRONG_CONTRACT");
    await rejects(verify(await hexOf(GOOD, { contractAddress: "SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE" })), "WRONG_CONTRACT");
    await rejects(verify(await hexOf(GOOD, { functionName: "set-fee-recipient" })), "WRONG_FUNCTION");
  });
  test("wrong argument count or types", async () => {
    await rejects(verify(await hexOf(GOOD, { functionArgs: swapFunctionArgs(GOOD).slice(0, 5) as any })), "BAD_ARGS");
    const args = swapFunctionArgs(GOOD); args[0] = Cl.int(30_000) as any;
    await rejects(verify(await hexOf(GOOD, { functionArgs: args })), "BAD_ARGS");
  });
  test("tier outside the three values", async () => {
    await rejects(verify(await hexOf({ ...GOOD, tier: 50_000n })), "BAD_TIER");
  });
  test("min-out below tier", async () => {
    await rejects(verify(await hexOf({ ...GOOD, tier: TIERS.high, minOut: TIERS.high - 1n })), "MIN_OUT_BELOW_TIER");
  });
  test("unknown pool", async () => {
    await rejects(verify(await hexOf({ ...GOOD, poolId: 9 })), "UNKNOWN_POOL");
  });
  test("integrator bips above 100", async () => {
    await rejects(verify(await hexOf({ ...GOOD_WITH_INTEGRATOR, integratorBips: 101n })), "BAD_BIPS");
  });
  test("allow mode", async () => {
    await rejects(verify(await hexOf(GOOD, { postConditionMode: PostConditionMode.Allow })), "BAD_POST_CONDITIONS");
  });
  test("missing, extra, or altered post-conditions", async () => {
    const good = expectedPostConditions(GOOD);
    await rejects(verify(await hexOf(GOOD, { postConditions: good.slice(0, 2) })), "BAD_POST_CONDITIONS");
    await rejects(verify(await hexOf(GOOD, { postConditions: [...good, Pc.principal(USER_ADDRESS).willSendLte(1n).ustx()] })), "BAD_POST_CONDITIONS");
    // sBTC amount off by one sat
    const offByOne = expectedPostConditions({ ...GOOD, amount: GOOD.amount + 1n });
    await rejects(verify(await hexOf(GOOD, { postConditions: offByOne })), "BAD_POST_CONDITIONS");
    // STX out to the sponsor as gte instead of eq
    const loose = [good[0], Pc.principal(USER_ADDRESS).willSendGte(GOOD.tier).ustx(), good[2]];
    await rejects(verify(await hexOf(GOOD, { postConditions: loose })), "BAD_POST_CONDITIONS");
    // pool receive condition on the wrong pool principal
    const wrongPool = [good[0], good[1], expectedPostConditions({ ...GOOD, poolId: 2 })[2]];
    await rejects(verify(await hexOf(GOOD, { postConditions: wrongPool })), "BAD_POST_CONDITIONS");
    // DLMM must use lte, eq is rejected (partial fills would abort)
    const dlmm = { ...GOOD, poolId: 3, amount: 1_000_000n, minOut: 2_900_000_000n };
    const dlmmEq = [expectedPostConditions({ ...dlmm, poolId: 1 })[0], ...expectedPostConditions(dlmm).slice(1)];
    await rejects(verify(await hexOf(dlmm, { postConditions: dlmmEq })), "BAD_POST_CONDITIONS");
    // XYK must use eq, lte is rejected
    const xykLte = [expectedPostConditions({ ...GOOD, poolId: 3 })[0], ...good.slice(1)];
    await rejects(verify(await hexOf(GOOD, { postConditions: xykLte })), "BAD_POST_CONDITIONS");
  });
  test("post-conditions naming a different user than the origin", async () => {
    const other = expectedPostConditions(GOOD, "SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE");
    await rejects(verify(await hexOf(GOOD, { postConditions: other })), "BAD_POST_CONDITIONS");
  });
});
