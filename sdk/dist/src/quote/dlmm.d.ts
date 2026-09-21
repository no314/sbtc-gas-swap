import type { PoolQuote } from "./types.js";
export declare const PRICE_SCALE = 100000000n;
export declare const FEE_SCALE = 10000n;
export declare const ROUTER_MAX_BINS = 350;
export interface DlmmBin {
    binId: number;
    price: bigint;
    xBalance: bigint;
    yBalance: bigint;
}
export interface DlmmState {
    activeBinId: number;
    feeBips: bigint;
    bins: DlmmBin[];
}
export interface DlmmQuote extends PoolQuote {
    binsUsed: number;
    partial: boolean;
}
export declare function quoteDlmm(s: DlmmState, inSats: bigint): DlmmQuote;
