import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { admissibleTiers, admissionFloor, sponsoredByteLength } from "../src/admission.js";
import { makeContractCall, PostConditionMode } from "@stacks/transactions";
import { buildSwapCall } from "../src/build.js";

async function buildUnsignedSwap() {
  const call = buildSwapCall({ user: "SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE", amountSats: 30_000n, tier: "mid", poolId: 1, quoteOut: 91_144_400n, slippageBips: 1_000n, integrator: "SP3PCJ68JW050YKQ9106JP11TXWS46163HX7NG6XH", integratorBips: 100n });
  return makeContractCall({
    contractAddress: call.contract.split(".")[0], contractName: call.contract.split(".")[1], functionName: call.functionName,
    functionArgs: call.functionArgs, postConditions: call.postConditions, postConditionMode: PostConditionMode.Deny,
    sponsored: true, fee: 0n, nonce: 0n, network: "mainnet",
    senderKey: "7287ba251d44a4d3fd9276c88ce34c5c52a038955b4cf3de1a4f2b9f3d8b5b9101",
  });
}

describe("admission", () => {
  test("every tier covers the floor for a real swap transaction", async () => {
    const tx = await buildUnsignedSwap();
    const len = sponsoredByteLength(tx);
    assert.ok(len > 500 && len < 900, `unexpected length ${len}`);
    assert.equal(admissionFloor(len), BigInt(len));
    assert.deepEqual(admissibleTiers(len), ["low", "mid", "high"]);
  });
  test("tiers drop out as the floor passes their value", () => {
    assert.deepEqual(admissibleTiers(10_000), ["low", "mid", "high"]);
    assert.deepEqual(admissibleTiers(10_001), ["mid", "high"]);
    assert.deepEqual(admissibleTiers(100_001), ["high"]);
    assert.deepEqual(admissibleTiers(1_000_001), []);
    assert.deepEqual(admissibleTiers(700, 20n), ["mid", "high"]);
  });
});
