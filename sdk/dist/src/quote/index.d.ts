import type { ChainClient } from "../client/chain.js";
import { splitFees, type FeeSplit } from "./fees.js";
import { quoteXyk, type XykState } from "./xyk.js";
import { quoteVelar, type VelarState } from "./velar.js";
import { quoteDlmm, type DlmmState } from "./dlmm.js";
import { selectPool } from "./select.js";
import type { PoolQuote } from "./types.js";
export * from "./types.js";
export { quoteXyk, quoteVelar, quoteDlmm, selectPool, splitFees };
export type { XykState, VelarState, DlmmState };
export interface QuoteRequest {
    amountSats: bigint;
    integratorBips?: bigint;
    dlmmBinsAhead?: number;
}
export interface QuoteResult {
    fees: FeeSplit;
    quotes: PoolQuote[];
    unavailable: {
        poolId: number;
        error: string;
    }[];
    best: PoolQuote;
    readAt: number;
}
export interface PoolStates {
    xyk?: XykState;
    velar?: VelarState;
    dlmm?: DlmmState;
    unavailable?: {
        poolId: number;
        error: string;
    }[];
    readAt: number;
}
export declare function readPoolStates(client: ChainClient, dlmmBinsAhead?: number): Promise<PoolStates>;
export declare function quoteFromStates(states: PoolStates, r: QuoteRequest): QuoteResult;
export declare function quoteAllPools(client: ChainClient, r: QuoteRequest): Promise<QuoteResult>;
