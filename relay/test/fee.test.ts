import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computeFee, acceptedTiers, bumpFee, type FeeInputs } from "../src/core/fee.js";
import { POLICY, TIERS } from "../src/core/config.js";

const base: FeeInputs = { tierName: "mid", openingBid: POLICY.openingBid, byteLength: 420, minPerByte: 1n };
const at = (tierName: FeeInputs["tierName"], over: Partial<FeeInputs> = {}) => computeFee({ ...base, tierName, ...over });

describe("computeFee", () => {
  test("each tier opens at its fixed bid; the shipped policy is 3000 / 6000 / 800000", () => {
    assert.equal(at("low"), 3_000n);
    assert.equal(at("mid"), 6_000n);
    assert.equal(at("high"), 800_000n);
  });
  test("takes no estimate: the inputs have no such field", () => {
    assert.deepEqual(Object.keys(base).sort(), ["byteLength", "minPerByte", "openingBid", "tierName"]);
  });
  test("never bids below the per-byte admission floor", () => {
    assert.equal(at("low", { byteLength: 4_500 }), 4_500n);
    assert.equal(at("low", { byteLength: 600, minPerByte: 10n }), 6_000n);
  });
  test("never bids above the tier: the rebate must cover the fee", () => {
    assert.equal(at("low", { openingBid: { ...POLICY.openingBid, low: 50_000n } }), TIERS.low);
    assert.equal(at("mid", { openingBid: { ...POLICY.openingBid, mid: 5_000_000n } }), TIERS.mid);
    assert.equal(at("low", { byteLength: 20_000 }), TIERS.low);
    for (const t of ["low", "mid", "high"] as const) assert.ok(at(t) <= TIERS[t]);
  });
  test("a bid at the tier leaves no room for a replacement", () => {
    assert.equal(bumpFee(at("high", { openingBid: { ...POLICY.openingBid, high: TIERS.high } }), TIERS.high, POLICY.rbfBumpBips), null);
  });
  test("high leaves room for three bumps inside the tier", () => {
    let fee = at("high");
    const seen: bigint[] = [];
    for (let i = 0; i < 5; i++) {
      const next = bumpFee(fee, TIERS.high, POLICY.rbfBumpBips);
      if (next === null) break;
      seen.push(next);
      fee = next;
    }
    assert.deepEqual(seen, [880_000n, 968_000n, 1_000_000n]);
  });
});

describe("acceptedTiers", () => {
  test("is every tier at or above the operator's minimum, in order", () => {
    assert.deepEqual(acceptedTiers("low"), ["low", "mid", "high"]);
    assert.deepEqual(acceptedTiers("mid"), ["mid", "high"]);
    assert.deepEqual(acceptedTiers("high"), ["high"]);
  });
});

describe("bumpFee (RBF)", () => {
  test("adds the bump but stays within the tier", () => {
    assert.equal(bumpFee(6_000n, TIERS.mid, 1_000n), 6_600n);
    assert.equal(bumpFee(95_000n, TIERS.mid, 1_000n), TIERS.mid);
  });
  test("a fee already at the tier cannot be bumped", () => {
    assert.equal(bumpFee(TIERS.mid, TIERS.mid, 1_000n), null);
  });
  test("always strictly increases when possible (mempool replacement rule)", () => {
    assert.equal(bumpFee(5n, TIERS.low, 1_000n), 6n);
  });
  test("low and mid ladders from the shipped opening bids", () => {
    assert.equal(bumpFee(3_000n, TIERS.low, POLICY.rbfBumpBips), 3_300n);
    assert.equal(bumpFee(6_000n, TIERS.mid, POLICY.rbfBumpBips), 6_600n);
  });
});
