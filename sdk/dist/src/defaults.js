import { LARGE_SWAP_MIN_SATS, SMALL_SWAP_MAX_SATS, TIER_NAMES } from "./config.js";
const rank = (t) => TIER_NAMES.indexOf(t);
// Amount rule (proportionality) then the relay's minimum (fee-market safety).
export function defaultTier(amountSats, relay) {
    const byAmount = amountSats <= SMALL_SWAP_MAX_SATS ? "low" : amountSats >= LARGE_SWAP_MIN_SATS ? "high" : "mid";
    return rank(byAmount) >= rank(relay.minTier) ? byAmount : relay.minTier;
}
export function defaultSlippageBips(amountSats) {
    return amountSats <= SMALL_SWAP_MAX_SATS ? 1000n : 100n;
}
export function minOutFor(quoteOut, slippageBips) {
    if (slippageBips < 0n || slippageBips >= 10000n)
        throw new Error("slippage must be 0..9999 bips");
    return (quoteOut * (10000n - slippageBips)) / 10000n;
}
//# sourceMappingURL=defaults.js.map