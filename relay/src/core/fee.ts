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

// The network's admission floor for this transaction (stacks-node: fee >= length * MINIMUM_TX_FEE_RATE_PER_BYTE).
export function admissionFloor(byteLength: number, minPerByte: bigint): bigint {
  return BigInt(byteLength) * minPerByte;
}

// Whether the tier can carry an admissible fee at all. A tier below the floor cannot be sponsored
// at any bid: the node would refuse the transaction, or the sponsor would pay more than the tier repays.
// Unreachable with the current contract call (about 680 bytes against a 10000 uSTX low tier); a guard.
export function tierCoversFloor(tierName: TierName, byteLength: number, minPerByte: bigint): boolean {
  return admissionFloor(byteLength, minPerByte) <= TIERS[tierName];
}

// Lowest tier that covers the admission floor, or null when none does.
export function lowestAdmissibleTier(byteLength: number, minPerByte: bigint): TierName | null {
  return TIER_NAMES.find((t) => tierCoversFloor(t, byteLength, minPerByte)) ?? null;
}

// min(max(opening bid, admission floor), tier). Callers check tierCoversFloor first.
export function computeFee(i: FeeInputs): bigint {
  const tier = TIERS[i.tierName];
  let fee = i.openingBid[i.tierName];
  const perByte = admissionFloor(i.byteLength, i.minPerByte);
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
