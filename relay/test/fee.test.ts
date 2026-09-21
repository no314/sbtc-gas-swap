import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computeFee, marketFee, minTierFor, bumpFee, type FeeInputs } from "../src/core/fee.js";
import { POLICY, TIERS } from "../src/core/config.js";

const base: FeeInputs = { tier: TIERS.mid, estimateUstx: 5_000n, byteLength: 420, feeFactor: 1, floorUstx: 3_000n, minPerByte: 1n };
// The shipped policy: low bids the market rate, mid opens at twice low, high opens at 80 percent of the tier.
const tiered = (tierName: "low" | "mid" | "high", over: Partial<FeeInputs> = {}) =>
  computeFee({ ...base, tier: TIERS[tierName], tierName, firstBid: POLICY.firstBid, ...over });

describe("computeFee", () => {
  test("uses the node estimate times the factor when above the floors", () => {
    assert.equal(computeFee({ ...base, estimateUstx: 8_000n }), 8_000n);
    assert.equal(computeFee({ ...base, estimateUstx: 8_000n, feeFactor: 1.5 }), 12_000n);
  });
  test("never bids below the absolute floor or the per-byte floor", () => {
    assert.equal(computeFee({ ...base, estimateUstx: 100n }), 3_000n);
    assert.equal(computeFee({ ...base, estimateUstx: 100n, floorUstx: 0n, byteLength: 4_500 }), 4_500n);
  });
  test("never bids above the tier: the rebate must cover the fee", () => {
    assert.equal(computeFee({ ...base, tier: TIERS.low, estimateUstx: 50_000n }), TIERS.low);
    assert.equal(computeFee({ ...base, tier: TIERS.mid, estimateUstx: 5_000_000n }), TIERS.mid);
  });
  test("rounds fractional factors down to whole uSTX", () => {
    assert.equal(computeFee({ ...base, estimateUstx: 3_333n, feeFactor: 1.1 }), 3_666n);
  });
  test("rejects non-positive factor", () => {
    assert.throws(() => computeFee({ ...base, feeFactor: 0 }));
  });
});

describe("computeFee with the per-tier first bid", () => {
  test("low is unchanged: the market rate, capped at the low tier", () => {
    assert.equal(tiered("low", { estimateUstx: 100n }), 3_000n);      // the floor
    assert.equal(tiered("low", { estimateUstx: 8_000n }), 8_000n);    // the estimate
    assert.equal(tiered("low", { estimateUstx: 50_000n }), TIERS.low); // the cap
  });
  test("mid opens at twice what low would bid", () => {
    assert.equal(tiered("mid", { estimateUstx: 100n }), 6_000n);      // 2 x the 3000 floor
    assert.equal(tiered("mid", { estimateUstx: 8_000n }), 16_000n);   // 2 x the estimate
  });
  test("mid measures against the low tier's capped bid, not an uncapped market rate", () => {
    // A market at 40000 means low bids its own tier (10000), so the doubling rule asks for 20000.
    // The market rate still wins, but the rule never asks for 80000.
    assert.equal(tiered("mid", { estimateUstx: 40_000n }), 40_000n);
    // Between the two: the market asks 15000, the doubling rule asks 20000, the rule wins.
    assert.equal(tiered("mid", { estimateUstx: 15_000n }), 20_000n);
  });
  test("mid never opens below the market rate when the market is above 2x low", () => {
    assert.equal(tiered("mid", { estimateUstx: 60_000n }), 60_000n);
  });
  test("high opens at 80 percent of the tier", () => {
    assert.equal(tiered("high", { estimateUstx: 100n }), 800_000n);
    assert.equal(tiered("high", { estimateUstx: 8_000n }), 800_000n);
  });
  test("high still follows the market when the market is above 80 percent of the tier", () => {
    assert.equal(tiered("high", { estimateUstx: 900_000n }), 900_000n);
  });
  test("no tier ever bids above its own tier", () => {
    for (const t of ["low", "mid", "high"] as const) {
      assert.ok(tiered(t, { estimateUstx: 9_000_000n }) <= TIERS[t]);
    }
  });
  test("high leaves room for three RBF bumps inside the tier", () => {
    let fee = tiered("high", { estimateUstx: 3_000n });
    const seen: bigint[] = [];
    for (let i = 0; i < 5; i++) {
      const next = bumpFee(fee, TIERS.high, POLICY.rbfBumpBips);
      if (next === null) break;
      seen.push(next);
      fee = next;
    }
    assert.deepEqual(seen, [880_000n, 968_000n, 1_000_000n]);
  });
  test("without a first-bid policy the old behaviour is kept", () => {
    assert.equal(computeFee({ ...base, tier: TIERS.high, estimateUstx: 3_000n }), 3_000n);
  });
});

describe("marketFee", () => {
  test("is the uncapped market rate, before any tier rule", () => {
    assert.equal(marketFee({ ...base, estimateUstx: 5_000_000n }), 5_000_000n);
    assert.equal(marketFee({ ...base, estimateUstx: 0n }), 3_000n);
  });
});

describe("minTierFor", () => {
  test("is the lowest tier whose value covers the factored estimate", () => {
    assert.equal(minTierFor(5_000n, 1), "low");
    assert.equal(minTierFor(10_000n, 1), "low");
    assert.equal(minTierFor(10_001n, 1), "mid");
    assert.equal(minTierFor(60_000n, 2), "high");
  });
  test("is high when even the high tier cannot cover it (relay should pause)", () => {
    assert.equal(minTierFor(2_000_000n, 1), null);
  });
});

describe("bumpFee (RBF)", () => {
  test("adds the bump but stays within the tier", () => {
    assert.equal(bumpFee(10_000n, TIERS.mid, 1_000n), 11_000n);
    assert.equal(bumpFee(95_000n, TIERS.mid, 1_000n), TIERS.mid);
  });
  test("a fee already at the tier cannot be bumped", () => {
    assert.equal(bumpFee(TIERS.mid, TIERS.mid, 1_000n), null);
  });
  test("always strictly increases when possible (mempool replacement rule)", () => {
    assert.equal(bumpFee(5n, TIERS.low, 1_000n), 6n);
  });
});
