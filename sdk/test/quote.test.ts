import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { quoteXyk, type XykState } from "../src/quote/xyk.js";
import { quoteVelar, type VelarState } from "../src/quote/velar.js";
import { quoteDlmm, type DlmmBin, type DlmmState } from "../src/quote/dlmm.js";
import { splitFees } from "../src/quote/fees.js";
import { selectPool, DLMM_MIN_OUTPUT_USTX } from "../src/quote/select.js";

// Recorded mainnet state, tip 8923977, 2026-09-05 (docs/mainnet-sources/fixtures/pools-8923977.json).
// Expected outputs computed independently in Python from the deployed contracts' formulas.
const xyk: XykState = { xBalance: 44_730_224n, yBalance: 136_671_025_817n, protocolFeeBips: 10n, providerFeeBips: 40n, enabled: true };
const velar: VelarState = { reserveStx: 212_869_098_374n, reserveSbtc: 69_663_360n, feeNum: 9970n, feeDen: 10_000n };

describe("splitFees", () => {
  test("floors both fees; net is the remainder", () => {
    assert.deepEqual(splitFees(30_000n, 100n), { serviceFee: 150n, integratorFee: 300n, net: 29_550n });
    assert.deepEqual(splitFees(199n, 100n), { serviceFee: 0n, integratorFee: 1n, net: 198n });
    assert.deepEqual(splitFees(1n, 100n), { serviceFee: 0n, integratorFee: 0n, net: 1n });
  });
  test("rejects bips above 100 and amount 0", () => {
    assert.throws(() => splitFees(1000n, 101n));
    assert.throws(() => splitFees(0n, 0n));
  });
});

describe("quoteXyk matches xyk-core-v-1-2 arithmetic", () => {
  const cases: [bigint, bigint][] = [[1n, 3_055n], [3n, 9_166n], [100n, 305_544n], [331n, 1_008_291n], [1_000n, 3_040_106n], [30_000n, 91_144_400n], [1_000_000n, 2_974_018_687n]];
  for (const [inSats, out] of cases) test(`${inSats} sats -> ${out} uSTX`, () => assert.equal(quoteXyk(xyk, inSats).out, out));
  test("reports the fee floor effect and impact", () => {
    const q = quoteXyk(xyk, 100n);
    assert.equal(q.feeSats, 0n);
    const big = quoteXyk(xyk, 1_000_000n);
    assert.equal(big.feeSats, 5_000n);
    assert.ok(big.impactBips > 200n && big.impactBips < 250n, `impact ${big.impactBips}`);
  });
  test("disabled pool quotes nothing", () => {
    assert.equal(quoteXyk({ ...xyk, enabled: false }, 1000n).out, 0n);
  });
});

describe("quoteVelar matches univ2-pool-0070 arithmetic", () => {
  const cases: [bigint, bigint][] = [[2n, 3_055n], [3n, 6_111n], [100n, 302_512n], [331n, 1_008_370n], [1_000n, 3_046_471n], [30_000n, 91_356_234n], [1_000_000n, 3_003_529_717n]];
  for (const [inSats, out] of cases) test(`${inSats} sats -> ${out} uSTX`, () => assert.equal(quoteVelar(velar, inSats).out, out));
  test("1 sat is below Velar's minimum (adjusted input 0)", () => {
    assert.equal(quoteVelar(velar, 1n).out, 0n);
    assert.equal(quoteVelar(velar, 1n).reason, "below-minimum");
  });
});

describe("quoteDlmm matches dlmm-core-v-1-1 swap-y-for-x walked across bins", () => {
  // bin price = sats per uSTX scaled by 1e8 (x = STX, y = sBTC). 32,643 -> about 326 sats per STX.
  const bin = (id: number, price: bigint, x: bigint, y: bigint): DlmmBin => ({ binId: id, price, xBalance: x, yBalance: y });
  const state: DlmmState = {
    activeBinId: 340,
    feeBips: 50n, // protocol 25 + provider 25 + variable 0
    bins: [bin(340, 32_643n, 10_000_000n, 500n), bin(341, 32_692n, 50_000_000n, 0n), bin(342, 32_741n, 50_000_000n, 0n)],
  };
  test("single bin, no cap: dx = (in - fee) * SCALE / price, floored", () => {
    const q = quoteDlmm(state, 1_000n);
    assert.equal(q.out, 3_048_126n);
    assert.equal(q.in, 1_000n);
    assert.equal(q.binsUsed, 1);
    assert.equal(q.partial, false);
  });
  test("crosses into the next bin when the active bin's STX is exhausted", () => {
    const q = quoteDlmm(state, 5_000n);
    assert.equal(q.binsUsed, 2);
    assert.equal(q.in, 5_000n);
    assert.equal(q.out, 15_233_696n);
  });
  test("partial fill when all known bins run out: in < requested", () => {
    const q = quoteDlmm({ ...state, bins: [bin(340, 32_643n, 10_000_000n, 0n)] }, 5_000n);
    assert.equal(q.in, 3_281n);
    assert.equal(q.out, 10_000_000n);
    assert.equal(q.partial, true);
  });
  test("an empty active bin is skipped without consuming input", () => {
    const q = quoteDlmm({ ...state, bins: [bin(340, 32_643n, 0n, 0n), bin(341, 32_692n, 50_000_000n, 0n)] }, 1_000n);
    assert.equal(q.out, 3_043_558n);
    assert.equal(q.binsUsed, 2);
  });
});

describe("selectPool", () => {
  const quotes = [
    // outputs above the 100 STX DLMM threshold
    { poolId: 1, out: 911_444_000n, reserveStx: 136_671_025_817n },
    { poolId: 2, out: 913_562_340n, reserveStx: 212_869_098_374n },
    { poolId: 3, out: 915_000_000n, reserveStx: 1_298_977_172_826n },
  ];
  test("picks the highest output", () => {
    assert.equal(selectPool(quotes, 0n).poolId, 3);
  });
  test("excludes DLMM below the small-swap threshold even when it quotes best", () => {
    const small = quotes.map((q) => ({ ...q, out: q.out / 10n }));
    assert.ok(small[2].out < DLMM_MIN_OUTPUT_USTX);
    assert.equal(selectPool(small, 0n).poolId, 2);
  });
  test("ties break by STX reserve", () => {
    const tied = [{ poolId: 1, out: 10n, reserveStx: 5n }, { poolId: 2, out: 10n, reserveStx: 7n }];
    assert.equal(selectPool(tied, 0n).poolId, 2);
  });
  test("ignores zero quotes and reports when nothing is quotable", () => {
    assert.throws(() => selectPool([{ poolId: 1, out: 0n, reserveStx: 1n }], 0n));
  });
});
