import type { PoolQuote } from "./types.js";
export interface VelarState {
    reserveStx: bigint;
    reserveSbtc: bigint;
    feeNum: bigint;
    feeDen: bigint;
}
export declare function quoteVelar(s: VelarState, inSats: bigint): PoolQuote;
