import type { PoolQuote } from "./types.js";
export interface XykState {
    xBalance: bigint;
    yBalance: bigint;
    protocolFeeBips: bigint;
    providerFeeBips: bigint;
    enabled: boolean;
}
export declare function quoteXyk(s: XykState, inSats: bigint): PoolQuote;
export declare function impact(dx: bigint, dy: bigint, x: bigint, y: bigint): bigint;
