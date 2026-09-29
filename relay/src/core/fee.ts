// Fee policy. Pure. No fee estimator: the node's estimate is not a market price (see relay.md).
// Each tier opens at a fixed bid the operator set, and the replace-by-fee ladder climbs from
// there on the tier's own schedule, never above the tier. The per-tier sponsor keys keep a
// low-tier queue from standing in front of a high-tier transaction.
import { TIERS, TIER_NAMES, type TierName } from "./config.js";

export interface FeeInputs {
  tierName: TierName;
  openingBid: Record<TierName, bigint>;  // operator policy, uSTX per tier
  byteLength: number;                     // serialized length including the sponsor signature
  minPerByte: bigint;                     // network admission floor per byte
}

// min(max(opening bid, admission floor), tier)
export function computeFee(i: FeeInputs): bigint {
  const tier = TIERS[i.tierName];
  let fee = i.openingBid[i.tierName];
  const perByte = BigInt(i.byteLength) * i.minPerByte;
  if (fee < perByte) fee = perByte;
  if (fee > tier) fee = tier;
  return fee;
}

// Tiers at or above the operator's minimum, in order.
export function acceptedTiers(minTier: TierName): TierName[] {
  return TIER_NAMES.slice(TIER_NAMES.indexOf(minTier));
}

// Replace-by-fee needs a strictly higher total fee. Returns null when the tier is exhausted.
export function bumpFee(current: bigint, tier: bigint, bumpBips: bigint): bigint | null {
  if (current >= tier) return null;
  let next = current + (current * bumpBips) / 10_000n;
  if (next <= current) next = current + 1n;
  if (next > tier) next = tier;
  return next;
}
