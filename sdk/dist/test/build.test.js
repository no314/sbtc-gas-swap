import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { deserializeTransaction, makeContractCall, PostConditionMode, AuthType } from "@stacks/transactions";
import { defaultTier, defaultSlippageBips, minOutFor } from "../src/defaults.js";
import { expectedPostConditions } from "../src/postconditions.js";
import { buildSwapCall, SwapBuildError } from "../src/build.js";
import { TIERS } from "../src/config.js";
const relay = { minTier: "low" };
const USER = "SP227DXSVTHZZKF3B9N38G5GGG03N1Z4V86ZC3JVH";
describe("defaultTier", () => {
    test("amount thresholds: low up to 30,000 sats, mid between, high from 0.1 BTC", () => {
        assert.equal(defaultTier(1n, relay), "low");
        assert.equal(defaultTier(30000n, relay), "low");
        assert.equal(defaultTier(30001n, relay), "mid");
        assert.equal(defaultTier(9999999n, relay), "mid");
        assert.equal(defaultTier(10000000n, relay), "high");
    });
    test("never below the relay's published minimum", () => {
        assert.equal(defaultTier(100n, { minTier: "mid" }), "mid");
        assert.equal(defaultTier(100n, { minTier: "high" }), "high");
        assert.equal(defaultTier(10000000n, { minTier: "low" }), "high");
    });
});
describe("defaultSlippageBips", () => {
    test("10 percent for gas-size swaps, 1 percent above 30,000 sats", () => {
        assert.equal(defaultSlippageBips(30000n), 1000n);
        assert.equal(defaultSlippageBips(30001n), 100n);
    });
});
describe("minOutFor", () => {
    test("floors quote times (1 - slippage)", () => {
        assert.equal(minOutFor(91144400n, 1000n), 82029960n);
        assert.equal(minOutFor(1000001n, 100n), 990000n);
    });
    test("rejects slippage outside 0 to 9999 bips", () => {
        assert.throws(() => minOutFor(1n, 10000n));
        assert.throws(() => minOutFor(1n, -1n));
    });
});
describe("buildSwapCall", () => {
    const base = { user: USER, amountSats: 30000n, tier: "mid", poolId: 1, quoteOut: 91144400n, slippageBips: 1000n };
    test("produces a SIP-030 stx_callContract request with sponsored true, fee 0, deny mode and the exact post-conditions", async () => {
        const call = buildSwapCall(base);
        assert.equal(call.contract, "SP2BM6AQSMQ04CX8KDE62QBFVZTDZ2ZX80GZJSBZ4.sbtc-gas-swap-v1");
        assert.equal(call.functionName, "swap-sbtc-for-gas");
        assert.equal(call.sponsored, true);
        assert.equal(call.fee, 0);
        assert.equal(call.postConditionMode, "deny");
        assert.equal(call.network, "mainnet");
        assert.equal(call.functionArgs.length, 6);
        assert.deepEqual(call.postConditions, expectedPostConditions({ user: USER, amount: 30000n, tier: TIERS.mid, minOut: 82029960n, poolId: 1 }));
        assert.equal(call.minOut, 82029960n);
        // the same params serialize through stacks.js into a valid sponsored transaction
        const tx = await makeContractCall({
            contractAddress: call.contract.split(".")[0], contractName: call.contract.split(".")[1], functionName: call.functionName,
            functionArgs: call.functionArgs, postConditions: call.postConditions, postConditionMode: PostConditionMode.Deny,
            sponsored: true, fee: 0n, nonce: 0n, network: "mainnet",
            senderKey: "7287ba251d44a4d3fd9276c88ce34c5c52a038955b4cf3de1a4f2b9f3d8b5b9101",
        });
        const d = deserializeTransaction(tx.serialize());
        assert.equal(d.auth.authType, AuthType.Sponsored);
        assert.equal(d.postConditions.values.length, 3);
    });
    test("carries the integrator and bips into the args and the fee split", () => {
        const call = buildSwapCall({ ...base, integrator: "SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE", integratorBips: 100n });
        assert.equal(call.fees.integratorFee, 300n);
        assert.equal(call.fees.serviceFee, 150n);
    });
    test("DLMM uses the lte sBTC post-condition", () => {
        const call = buildSwapCall({ ...base, poolId: 3, amountSats: 1000000n, quoteOut: 3000000000n, slippageBips: 100n });
        assert.equal(call.postConditions[0].condition, "lte");
    });
    test("refuses when min-out would be below the tier, and says what to change", () => {
        assert.throws(() => buildSwapCall({ ...base, amountSats: 3n, quoteOut: 9000n, tier: "mid" }), (e) => e instanceof SwapBuildError && e.code === "MIN_OUT_BELOW_TIER");
    });
    test("refuses bad bips, unknown pool, zero amount", () => {
        assert.throws(() => buildSwapCall({ ...base, integrator: USER, integratorBips: 101n }), (e) => e.code === "BAD_BIPS");
        assert.throws(() => buildSwapCall({ ...base, poolId: 7 }), (e) => e.code === "UNKNOWN_POOL");
        assert.throws(() => buildSwapCall({ ...base, amountSats: 0n }), (e) => e.code === "BAD_AMOUNT");
    });
});
//# sourceMappingURL=build.test.js.map