import { LARGE_SWAP_MIN_SATS, SMALL_SWAP_MAX_SATS, TIER_NAMES, type TierName } from "./config.js";

export interface RelayInfoLike { minTier: TierName }

const rank = (t: TierName) => TIER_NAMES.indexOf(t);

// Amount rule (proportionality) then the relay's minimum (fee-market safety).
export function defaultTier(amountSats: bigint, relay: RelayInfoLike): TierName {
  const byAmount: TierName = amountSats <= SMALL_SWAP_MAX_SATS ? "low" : amountSats >= LARGE_SWAP_MIN_SATS ? "high" : "mid";
  return rank(byAmount) >= rank(relay.minTier) ? byAmount : relay.minTier;
}

export function defaultSlippageBips(amountSats: bigint): bigint {
  return amountSats <= SMALL_SWAP_MAX_SATS ? 1_000n : 100n;
}

export function minOutFor(quoteOut: bigint, slippageBips: bigint): bigint {
  if (slippageBips < 0n || slippageBips >= 10_000n) throw new Error("slippage must be 0..9999 bips");
  return (quoteOut * (10_000n - slippageBips)) / 10_000n;
}
