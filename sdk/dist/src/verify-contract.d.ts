import type { ChainClient } from "./client/chain.js";
export declare function structureHash(source: string): Promise<string>;
export declare const PINNED_STRUCTURE_HASH = "5702f09a5ab584d56d7e803b94143d1c51327c5a95f2a2309df4e604215ed608";
export interface ContractVerification {
    ok: boolean;
    liveHash: string;
    pinnedHash: string;
    publishHeight?: number;
    error?: string;
}
export declare function verifyContract(client: ChainClient, pinned?: string): Promise<ContractVerification>;
