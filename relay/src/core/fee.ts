// Fee policy. Pure.
import { TIERS, TIER_NAMES, type TierName } from "./config.js";

// Per-tier first bid. The market floor (estimate, per-byte, absolute floor) is the same for every
// tier; these raise the opening bid so a user who paid for a higher tier gets the fee they paid for.
export interface FirstBidPolicy {
  // Multiple of what the low tier would bid right now. 1 means "the market rate".
  multipleOfLow: Record<TierName, number>;
  // Percent of the tier itself. 0 means "not applied". Whichever rule is higher wins.
  pctOfTier: Record<TierName, number>;
}

export interface FeeInputs {
  tier: bigint;          // the rebate the user pays; the fee never exceeds it
  estimateUstx: bigint;  // node estimate (middle) for this payload, or 0 when unavailable
  byteLength: number;    // serialized length including the sponsor signature
  feeFactor: number;     // operator dial, > 0
  floorUstx: bigint;     // absolute floor
  minPerByte: bigint;    // network admission floor per byte
  tierName?: TierName;   // required for the first-bid rules below
  firstBid?: FirstBidPolicy;
}

export function applyFactor(value: bigint, factor: number): bigint {
  if (!(factor > 0)) throw new Error("feeFactor must be positive");
  const scaled = BigInt(Math.round(factor * 1_000_000));
  return (value * scaled) / 1_000_000n;
}

// What the market asks for this payload, before any tier rule and before the tier cap.
export function marketFee(i: FeeInputs): bigint {
  let fee = applyFactor(i.estimateUstx, i.feeFactor);
  const perByte = BigInt(i.byteLength) * i.minPerByte;
  if (fee < perByte) fee = perByte;
  if (fee < i.floorUstx) fee = i.floorUstx;
  return fee;
}

export function computeFee(i: FeeInputs): bigint {
  const market = marketFee(i);
  let fee = market;
  if (i.tierName && i.firstBid) {
    // The low tier's own bid is the yardstick for "2x low": market rate, capped at the low tier.
    const lowBid = market < TIERS.low ? market : TIERS.low;
    const byMultiple = applyFactor(lowBid, Math.max(1, i.firstBid.multipleOfLow[i.tierName] ?? 1));
    const pct = i.firstBid.pctOfTier[i.tierName] ?? 0;
    const byPct = pct > 0 ? (i.tier * BigInt(Math.round(pct * 100))) / 10_000n : 0n;
    if (fee < byMultiple) fee = byMultiple;
    if (fee < byPct) fee = byPct;
  }
  if (fee > i.tier) fee = i.tier;
  return fee;
}

// Lowest tier that covers the factored estimate; null when none does.
export function minTierFor(estimateUstx: bigint, feeFactor: number): TierName | null {
  const need = applyFactor(estimateUstx, feeFactor);
  for (const t of TIER_NAMES) if (TIERS[t] >= need) return t;
  return null;
}

// Replace-by-fee needs a strictly higher total fee. Returns null when the tier is exhausted.
export function bumpFee(current: bigint, tier: bigint, bumpBips: bigint): bigint | null {
  if (current >= tier) return null;
  let next = current + (current * bumpBips) / 10_000n;
  if (next <= current) next = current + 1n;
  if (next > tier) next = tier;
  return next;
}
