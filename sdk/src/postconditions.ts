import type { PostCondition } from "@stacks/transactions";
import { POOLS, SBTC } from "./config.js";

export interface PostConditionInputs { user: string; amount: bigint; tier: bigint; minOut: bigint; poolId: number }

// The exact post-condition set for one swap. The relay rejects any transaction whose set differs.
//  1. user sends sBTC: eq amount (XYK, Velar) or lte amount (DLMM, partial fills possible)
//  2. user sends STX eq tier (the network fee, repaid to the sponsor)
//  3. the pool principal sends STX gte min-out to the user
export function expectedPostConditions(i: PostConditionInputs): PostCondition[] {
  const pool = POOLS[i.poolId];
  if (!pool) throw new Error(`unknown pool ${i.poolId}`);
  const asset = `${SBTC.address}.${SBTC.name}::${SBTC.asset}` as const;
  return [
    { type: "ft-postcondition", address: i.user, condition: pool.sbtcCondition, amount: i.amount.toString(), asset } as PostCondition,
    { type: "stx-postcondition", address: i.user, condition: "eq", amount: i.tier.toString() } as PostCondition,
    { type: "stx-postcondition", address: pool.stxSender, condition: "gte", amount: i.minOut.toString() } as PostCondition,
  ];
}
