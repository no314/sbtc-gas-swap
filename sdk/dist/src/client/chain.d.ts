import { type ClarityValue } from "@stacks/transactions";
import type { XykState } from "../quote/xyk.js";
import type { VelarState } from "../quote/velar.js";
import type { DlmmState } from "../quote/dlmm.js";
export interface ChainClientOptions {
    baseUrl?: string;
    apiKey?: string;
    fetch?: typeof fetch;
    minSpacingMs?: number;
    retries?: number;
    sender?: string;
    cacheBust?: boolean;
}
export declare class ChainError extends Error {
    status?: number | undefined;
    body?: string | undefined;
    constructor(message: string, status?: number | undefined, body?: string | undefined);
}
export declare class ChainClient {
    readonly baseUrl: string;
    private readonly f;
    private readonly apiKey?;
    private readonly spacing;
    private readonly retries;
    private readonly sender;
    private readonly cacheBust;
    private last;
    constructor(o?: ChainClientOptions);
    request(path: string, init?: RequestInit): Promise<Response>;
    json<T>(path: string, init?: RequestInit): Promise<T>;
    callRead(contract: string, fn: string, args: ClarityValue[], sender?: string): Promise<ClarityValue>;
    readXykState(): Promise<XykState>;
    readVelarState(): Promise<VelarState>;
    readDlmmState(binsAhead?: number): Promise<DlmmState>;
    getSbtcBalance(address: string): Promise<bigint>;
    getStxBalance(address: string): Promise<bigint>;
    getNonces(address: string): Promise<{
        lastExecuted: number | null;
        lastMempool: number | null;
        possibleNext: number;
        missing: number[];
    }>;
    getContractSource(contract: string): Promise<{
        source: string;
        publishHeight: number;
    }>;
    estimateFee(payloadHex: string, estimatedLen: number): Promise<{
        low: bigint;
        mid: bigint;
        high: bigint;
    } | null>;
    broadcast(txHex: string): Promise<{
        txid: string;
    } | {
        error: string;
        reason: string;
        reason_data?: unknown;
        txid?: string;
    }>;
    getTransaction(txid: string): Promise<{
        tx_status: string;
        tx_result?: {
            repr: string;
        };
        fee_rate?: string;
        block_height?: number;
    } | null>;
    getInfo(): Promise<{
        stacks_tip_height: number;
        burn_block_height: number;
        network_id: number;
    }>;
}
