import { describe, it, expect, beforeEach } from "vitest";
import { Cl, cvToValue } from "@stacks/transactions";

// Under test: the simnet build of sbtc-gas-swap-v1 (real sbtc-token, mock pools,
// mock sponsor). scripts/build-simnet-variant.mjs proves the two builds differ only
// in the listed substitutions; tests/variant.test.ts asserts that.

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const user = accounts.get("wallet_1")!;
const sponsor = accounts.get("wallet_2")!;
const integrator = accounts.get("wallet_3")!;
const stranger = accounts.get("wallet_4")!;

const SBTC = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";
const C = "sbtc-gas-swap-v1-simnet";
const XYK = `${deployer}.mock-xyk-core`;
const VELAR = `${deployer}.mock-velar-pool`;
const DLMM = `${deployer}.mock-dlmm-router`;

const TIER_LOW = 10_000n, TIER_MID = 100_000n, TIER_HIGH = 1_000_000n;
const POOL_XYK = 1, POOL_VELAR = 2, POOL_DLMM = 3;
const ERR = {
  NOT_OWNER: 100, NOT_SPONSORED: 101, BAD_AMOUNT: 102, BAD_TIER: 103, MIN_OUT_BELOW_TIER: 104,
  UNKNOWN_POOL: 105, BAD_BIPS: 106, NET_ZERO: 107, RECEIVED_BELOW_MIN: 108, SAME_PRINCIPAL: 109,
};

function stx(addr: string): bigint {
  return simnet.getAssetsMap().get("STX")?.get(addr) ?? 0n;
}
function sbtc(addr: string): bigint {
  return simnet.getAssetsMap().get(".sbtc-token.sbtc-token")?.get(addr) ?? 0n;
}
function setSponsor(who: string | null) {
  const arg = who ? Cl.some(Cl.principal(who)) : Cl.none();
  expect(simnet.callPublicFn("mock-sponsor", "set-sponsor", [arg], deployer).result).toBeOk(Cl.bool(true));
}
function quoteXyk(net: bigint): bigint {
  return BigInt(cvToValue(simnet.callReadOnlyFn("mock-xyk-core", "quote-dy", [Cl.uint(net)], user).result) as string);
}
function quoteVelar(net: bigint): bigint {
  return BigInt(cvToValue(simnet.callReadOnlyFn("mock-velar-pool", "quote-out", [Cl.uint(net)], user).result) as string);
}
function quoteDlmm(net: bigint): { in: bigint; out: bigint } {
  const v = cvToValue(simnet.callReadOnlyFn("mock-dlmm-router", "quote", [Cl.uint(net)], user).result) as any;
  return { in: BigInt(v.in.value), out: BigInt(v.out.value) };
}
function swap(opts: {
  amount: bigint; tier?: bigint; minOut: bigint; pool?: number;
  integrator?: string | null; bips?: bigint; sender?: string;
}) {
  return simnet.callPublicFn(C, "swap-sbtc-for-gas", [
    Cl.uint(opts.amount),
    Cl.uint(opts.tier ?? TIER_MID),
    Cl.uint(opts.minOut),
    Cl.uint(opts.pool ?? POOL_XYK),
    opts.integrator ? Cl.some(Cl.principal(opts.integrator)) : Cl.none(),
    Cl.uint(opts.bips ?? 0n),
  ], opts.sender ?? user);
}
const fees = (amount: bigint, bips: bigint) => {
  const service = (amount * 50n) / 10_000n;
  const integ = (amount * bips) / 10_000n;
  return { service, integ, net: amount - service - integ };
};

beforeEach(() => {
  // Mock pools pay STX from their own balance.
  for (const pool of [XYK, VELAR, DLMM]) simnet.transferSTX(10_000_000_000_000n, pool, deployer);
  setSponsor(sponsor);
});

describe("configuration", () => {
  it("exposes immutable rate, tiers and pools; owner and fee-recipient start as the deployer", () => {
    const cfg = cvToValue(simnet.callReadOnlyFn(C, "get-config", [], user).result) as any;
    expect(BigInt(cfg["fee-bips"].value)).toBe(50n);
    expect(BigInt(cfg["max-integrator-bips"].value)).toBe(100n);
    expect(cfg.tiers.value.map((t: any) => BigInt(t.value))).toEqual([TIER_LOW, TIER_MID, TIER_HIGH]);
    expect(cfg.pools.value.map((t: any) => BigInt(t.value))).toEqual([1n, 2n, 3n]);
    expect(cfg.owner.value).toBe(deployer);
    expect(cfg["fee-recipient"].value).toBe(deployer);
  });

  it("simnet wallets start with sBTC and the user has no STX in the zero-gas scenario", () => {
    expect(sbtc(user)).toBe(1_000_000_000n);
    simnet.transferSTX(stx(user), stranger, user);
    expect(stx(user)).toBe(0n);
  });
});

describe("owner functions", () => {
  it("rejects a non-owner", () => {
    expect(simnet.callPublicFn(C, "set-fee-recipient", [Cl.principal(stranger)], stranger).result).toBeErr(Cl.uint(ERR.NOT_OWNER));
    expect(simnet.callPublicFn(C, "transfer-ownership", [Cl.principal(stranger)], stranger).result).toBeErr(Cl.uint(ERR.NOT_OWNER));
  });
  it("owner changes the fee recipient and it takes effect on the next swap", () => {
    expect(simnet.callPublicFn(C, "set-fee-recipient", [Cl.principal(stranger)], deployer).result).toBeOk(Cl.bool(true));
    expect(cvToValue(simnet.callReadOnlyFn(C, "get-fee-recipient", [], user).result)).toBe(stranger);
    const before = sbtc(stranger);
    swap({ amount: 30_000n, minOut: TIER_MID });
    expect(sbtc(stranger) - before).toBe(150n);
  });
  it("ownership transfer revokes the previous owner", () => {
    expect(simnet.callPublicFn(C, "transfer-ownership", [Cl.principal(stranger)], deployer).result).toBeOk(Cl.bool(true));
    expect(simnet.callPublicFn(C, "set-fee-recipient", [Cl.principal(deployer)], deployer).result).toBeErr(Cl.uint(ERR.NOT_OWNER));
    expect(simnet.callPublicFn(C, "set-fee-recipient", [Cl.principal(deployer)], stranger).result).toBeOk(Cl.bool(true));
  });
});

describe("quote-fees arithmetic (integer floors)", () => {
  const cases: [bigint, bigint, bigint, bigint][] = [
    // amount, bips, service-fee, integrator-fee
    [1n, 0n, 0n, 0n],
    [199n, 0n, 0n, 0n],          // 199 * 50 / 10000 = 0.995 -> 0
    [200n, 0n, 1n, 0n],          // first sat of service fee
    [201n, 100n, 1n, 2n],
    [30_000n, 0n, 150n, 0n],
    [30_000n, 100n, 150n, 300n],
    [10_000_000n, 50n, 50_000n, 50_000n],
  ];
  for (const [amount, bips, service, integ] of cases) {
    it(`amount ${amount} bips ${bips} -> service ${service}, integrator ${integ}`, () => {
      const r = cvToValue(simnet.callReadOnlyFn(C, "quote-fees", [Cl.uint(amount), Cl.uint(bips)], user).result) as any;
      expect(BigInt(r.value["service-fee"].value)).toBe(service);
      expect(BigInt(r.value["integrator-fee"].value)).toBe(integ);
      expect(BigInt(r.value.net.value)).toBe(amount - service - integ);
    });
  }
  it("rejects integrator bips above 100", () => {
    expect(simnet.callReadOnlyFn(C, "quote-fees", [Cl.uint(1000n), Cl.uint(101n)], user).result).toBeErr(Cl.uint(ERR.BAD_BIPS));
  });
});

describe("swap argument validation", () => {
  it("refuses an unsponsored call", () => {
    setSponsor(null);
    expect(swap({ amount: 30_000n, minOut: TIER_MID }).result).toBeErr(Cl.uint(ERR.NOT_SPONSORED));
  });
  it("refuses amount 0", () => {
    expect(swap({ amount: 0n, minOut: TIER_MID }).result).toBeErr(Cl.uint(ERR.BAD_AMOUNT));
  });
  it("refuses a tier outside low, mid, high", () => {
    expect(swap({ amount: 30_000n, tier: 50_000n, minOut: 50_000n }).result).toBeErr(Cl.uint(ERR.BAD_TIER));
    expect(swap({ amount: 30_000n, tier: 0n, minOut: 1n }).result).toBeErr(Cl.uint(ERR.BAD_TIER));
  });
  it("refuses min-out below the tier", () => {
    expect(swap({ amount: 30_000n, tier: TIER_MID, minOut: TIER_MID - 1n }).result).toBeErr(Cl.uint(ERR.MIN_OUT_BELOW_TIER));
  });
  it("refuses an unknown pool id", () => {
    expect(swap({ amount: 30_000n, minOut: TIER_MID, pool: 0 }).result).toBeErr(Cl.uint(ERR.UNKNOWN_POOL));
    expect(swap({ amount: 30_000n, minOut: TIER_MID, pool: 4 }).result).toBeErr(Cl.uint(ERR.UNKNOWN_POOL));
  });
  it("refuses integrator bips above 100 even without an integrator", () => {
    expect(swap({ amount: 30_000n, minOut: TIER_MID, bips: 101n }).result).toBeErr(Cl.uint(ERR.BAD_BIPS));
    expect(swap({ amount: 30_000n, minOut: TIER_MID, integrator, bips: 101n }).result).toBeErr(Cl.uint(ERR.BAD_BIPS));
  });
  it("refuses when the sponsor is the user", () => {
    setSponsor(user);
    expect(swap({ amount: 30_000n, minOut: TIER_MID }).result).toBeErr(Cl.uint(ERR.SAME_PRINCIPAL));
  });
  it("net input is always positive for any positive amount (ERR_NET_ZERO is defensive)", () => {
    // 1 sat with the maximum integrator rate still nets 1 sat: fees floor to 0.
    const r = cvToValue(simnet.callReadOnlyFn(C, "quote-fees", [Cl.uint(1n), Cl.uint(100n)], user).result) as any;
    expect(BigInt(r.value.net.value)).toBe(1n);
  });
});

describe("swap through Bitflow XYK (pool 1)", () => {
  it("moves exactly a, b, c and the swapped STX; the contract holds nothing", () => {
    const amount = 30_000n, bips = 100n;
    const f = fees(amount, bips);
    const quote = quoteXyk(f.net);
    const minOut = (quote * 9n) / 10n;
    const b = { user: { stx: stx(user), sbtc: sbtc(user) }, sponsor: stx(sponsor), fee: sbtc(deployer), integ: sbtc(integrator), pool: sbtc(XYK) };

    const r = swap({ amount, minOut, integrator, bips });
    expect(r.result).toBeOk(Cl.tuple({
      received: Cl.uint(quote), rebate: Cl.uint(TIER_MID), "service-fee": Cl.uint(f.service),
      "integrator-fee": Cl.uint(f.integ), "pool-id": Cl.uint(POOL_XYK),
    }));

    expect(sbtc(user)).toBe(b.user.sbtc - amount);
    expect(sbtc(deployer) - b.fee).toBe(f.service);
    expect(sbtc(integrator) - b.integ).toBe(f.integ);
    expect(sbtc(XYK) - b.pool).toBe(f.net);
    expect(stx(user)).toBe(b.user.stx + quote - TIER_MID);
    expect(stx(sponsor) - b.sponsor).toBe(TIER_MID);
    expect(stx(`${deployer}.${C}`)).toBe(0n);
    expect(sbtc(`${deployer}.${C}`)).toBe(0n);
    expect(BigInt(cvToValue(simnet.callReadOnlyFn("mock-xyk-core", "get-calls", [], user).result) as string)).toBe(1n);

    const prints = r.events.filter(e => e.event === "print_event").map(e => Cl.prettyPrint(Cl.deserialize((e.data as any).raw_value ?? (e.data as any).value)));
    expect(prints.some(p => p.includes("swap-sbtc-for-gas") && p.includes(`sponsor: '${sponsor}`))).toBe(true);
  });

  it("works for a user with zero STX: the pool output funds the rebate", () => {
    simnet.transferSTX(stx(user), stranger, user);
    expect(stx(user)).toBe(0n);
    const amount = 1_000n;
    const quote = quoteXyk(fees(amount, 0n).net);
    const r = swap({ amount, tier: TIER_LOW, minOut: TIER_LOW });
    expect(r.result).toBeOk(Cl.tuple({
      received: Cl.uint(quote), rebate: Cl.uint(TIER_LOW), "service-fee": Cl.uint(5n),
      "integrator-fee": Cl.uint(0n), "pool-id": Cl.uint(POOL_XYK),
    }));
    expect(stx(user)).toBe(quote - TIER_LOW);
  });

  it("without an integrator, integrator-bips is ignored and nothing goes to anyone else", () => {
    const amount = 30_000n;
    const b = sbtc(integrator);
    const quote = quoteXyk(fees(amount, 0n).net);
    const r = swap({ amount, minOut: TIER_MID, integrator: null, bips: 100n });
    expect(r.result).toBeOk(Cl.tuple({
      received: Cl.uint(quote), rebate: Cl.uint(TIER_MID), "service-fee": Cl.uint(150n),
      "integrator-fee": Cl.uint(0n), "pool-id": Cl.uint(POOL_XYK),
    }));
    expect(sbtc(integrator)).toBe(b);
  });

  it("pays the high tier when chosen and the output covers it", () => {
    const amount = 1_000_000n;
    const quote = quoteXyk(fees(amount, 0n).net);
    expect(quote).toBeGreaterThan(TIER_HIGH);
    const before = stx(sponsor);
    expect(swap({ amount, tier: TIER_HIGH, minOut: TIER_HIGH }).result.type).toBe("ok");
    expect(stx(sponsor) - before).toBe(TIER_HIGH);
  });

  it("propagates the pool's minimum-received error when min-out is above the quote", () => {
    const amount = 30_000n;
    const quote = quoteXyk(fees(amount, 0n).net);
    expect(swap({ amount, minOut: quote + 1n }).result).toBeErr(Cl.uint(1020));
    expect(BigInt(cvToValue(simnet.callReadOnlyFn("mock-xyk-core", "get-calls", [], user).result) as string)).toBe(0n);
  });

  it("sub-200 sat swaps carry no service fee and still pay the rebate", () => {
    const amount = 199n;
    const quote = quoteXyk(199n);
    expect(quote).toBeGreaterThan(TIER_LOW);
    const feeBefore = sbtc(deployer);
    expect(swap({ amount, tier: TIER_LOW, minOut: TIER_LOW }).result.type).toBe("ok");
    expect(sbtc(deployer)).toBe(feeBefore);
  });
});

describe("swap through Velar (pool 2)", () => {
  it("routes to the Velar mock and reads amt-out from its tuple", () => {
    const amount = 30_000n;
    const f = fees(amount, 0n);
    const quote = quoteVelar(f.net);
    const b = { stx: stx(user), sbtc: sbtc(user), pool: sbtc(VELAR) };
    const r = swap({ amount, minOut: (quote * 9n) / 10n, pool: POOL_VELAR });
    expect(r.result).toBeOk(Cl.tuple({
      received: Cl.uint(quote), rebate: Cl.uint(TIER_MID), "service-fee": Cl.uint(150n),
      "integrator-fee": Cl.uint(0n), "pool-id": Cl.uint(POOL_VELAR),
    }));
    expect(sbtc(user)).toBe(b.sbtc - amount);
    expect(sbtc(VELAR) - b.pool).toBe(f.net);
    expect(stx(user)).toBe(b.stx + quote - TIER_MID);
    expect(BigInt(cvToValue(simnet.callReadOnlyFn("mock-velar-pool", "get-calls", [], user).result) as string)).toBe(1n);
  });
  it("propagates Velar's single precondition error", () => {
    const quote = quoteVelar(fees(30_000n, 0n).net);
    expect(swap({ amount: 30_000n, minOut: quote + 1n, pool: POOL_VELAR }).result).toBeErr(Cl.uint(107));
  });
});

describe("swap through Bitflow DLMM (pool 3)", () => {
  it("routes to the DLMM mock and reads out from its tuple", () => {
    const amount = 1_000_000n;
    const f = fees(amount, 0n);
    const q = quoteDlmm(f.net);
    expect(q.in).toBe(f.net);
    const b = { stx: stx(user), sbtc: sbtc(user) };
    const r = swap({ amount, minOut: (q.out * 9n) / 10n, pool: POOL_DLMM });
    expect(r.result).toBeOk(Cl.tuple({
      received: Cl.uint(q.out), rebate: Cl.uint(TIER_MID), "service-fee": Cl.uint(f.service),
      "integrator-fee": Cl.uint(0n), "pool-id": Cl.uint(POOL_DLMM),
    }));
    expect(sbtc(user)).toBe(b.sbtc - amount);
    expect(stx(user)).toBe(b.stx + q.out - TIER_MID);
  });
  it("partial fill: when bins run out the user keeps the unswapped sBTC (post-condition must be lte, not eq)", () => {
    simnet.callPublicFn("mock-dlmm-router", "set-capacity", [Cl.uint(100_000n)], deployer);
    const amount = 1_000_000n;
    const f = fees(amount, 0n);
    const q = quoteDlmm(f.net);
    expect(q.in).toBe(100_000n);
    const b = sbtc(user);
    const r = swap({ amount, minOut: TIER_MID, pool: POOL_DLMM });
    expect(r.result.type).toBe("ok");
    expect(b - sbtc(user)).toBe(f.service + q.in);
  });
  it("propagates the router's minimum-received error", () => {
    const q = quoteDlmm(fees(1_000_000n, 0n).net);
    expect(swap({ amount: 1_000_000n, minOut: q.out + 1n, pool: POOL_DLMM }).result).toBeErr(Cl.uint(2003));
  });
});
