import { type TierName } from "./config.js";
export interface RelayInfoLike {
    minTier: TierName;
}
export declare function defaultTier(amountSats: bigint, relay: RelayInfoLike): TierName;
export declare function defaultSlippageBips(amountSats: bigint): bigint;
export declare function minOutFor(quoteOut: bigint, slippageBips: bigint): bigint;
