export declare const NETWORK: "mainnet";
export declare const CHAIN_ID = 1;
export declare const CONTRACT: {
    readonly address: "SP2BM6AQSMQ04CX8KDE62QBFVZTDZ2ZX80GZJSBZ4";
    readonly name: "sbtc-gas-swap-v1";
    readonly fn: "swap-sbtc-for-gas";
};
export declare const SBTC: {
    readonly address: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4";
    readonly name: "sbtc-token";
    readonly asset: "sbtc-token";
};
export declare const TIERS: {
    readonly low: 10000n;
    readonly mid: 100000n;
    readonly high: 1000000n;
};
export type TierName = keyof typeof TIERS;
export declare const TIER_NAMES: TierName[];
export declare function tierNameOf(value: bigint): TierName | undefined;
export declare const FEE_BIPS = 50n;
export declare const MAX_INTEGRATOR_BIPS = 100n;
export declare const BIPS_DENOM = 10000n;
export interface PoolSpec {
    id: number;
    name: string;
    stxSender: string;
    sbtcCondition: "eq" | "lte";
}
export declare const POOLS: Record<number, PoolSpec>;
export declare const XYK: {
    readonly core: "SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.xyk-core-v-1-2";
    readonly pool: "SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.xyk-pool-sbtc-stx-v-1-1";
    readonly stxWrapper: "SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.token-stx-v-1-2";
};
export declare const VELAR: {
    readonly pool: "SP20X3DC5R091J8B6YPQT638J8NR1W83KN6TN5BJY.univ2-pool-v1_0_0-0070";
    readonly fees: "SP20X3DC5R091J8B6YPQT638J8NR1W83KN6TN5BJY.univ2-fees-v1_0_0-0070";
    readonly wstx: "SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.wstx";
};
export declare const DLMM: {
    readonly router: "SP1PFR4V08H1RAZXREBGFFQ59WB739XM8VVGTFSEA.dlmm-swap-router-v-1-1";
    readonly core: "SP1PFR4V08H1RAZXREBGFFQ59WB739XM8VVGTFSEA.dlmm-core-v-1-1";
    readonly pool: "SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-pool-stx-sbtc-v-2-bps-15";
};
export declare const DLMM_MIN_OUTPUT_USTX = 100000000n;
export declare const SMALL_SWAP_MAX_SATS = 30000n;
export declare const LARGE_SWAP_MIN_SATS = 10000000n;
