import { impact } from "./xyk.js";
export function quoteVelar(s, inSats) {
    const base = { poolId: 2, in: inSats, out: 0n, feeSats: 0n, impactBips: 0n, reserveStx: s.reserveStx };
    if (inSats <= 0n || s.reserveStx === 0n || s.reserveSbtc === 0n)
        return { ...base, reason: "no-liquidity" };
    const adj = (inSats * s.feeNum) / s.feeDen;
    if (adj === 0n)
        return { ...base, reason: "below-minimum" };
    const out = (s.reserveStx * adj) / (s.reserveSbtc + adj);
    return { ...base, out, feeSats: inSats - adj, impactBips: impact(adj, out, s.reserveSbtc, s.reserveStx) };
}
//# sourceMappingURL=velar.js.map