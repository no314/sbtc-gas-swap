import { POOLS, SBTC } from "./config.js";
// The exact post-condition set for one swap. The relay rejects any transaction whose set differs.
//  1. user sends sBTC: eq amount (XYK, Velar) or lte amount (DLMM, partial fills possible)
//  2. user sends STX eq tier (the rebate to the sponsor)
//  3. the pool principal sends STX gte min-out to the user
export function expectedPostConditions(i) {
    const pool = POOLS[i.poolId];
    if (!pool)
        throw new Error(`unknown pool ${i.poolId}`);
    const asset = `${SBTC.address}.${SBTC.name}::${SBTC.asset}`;
    return [
        { type: "ft-postcondition", address: i.user, condition: pool.sbtcCondition, amount: i.amount.toString(), asset },
        { type: "stx-postcondition", address: i.user, condition: "eq", amount: i.tier.toString() },
        { type: "stx-postcondition", address: pool.stxSender, condition: "gte", amount: i.minOut.toString() },
    ];
}
//# sourceMappingURL=postconditions.js.map