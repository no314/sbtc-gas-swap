import { ChainClient } from "../src/client/chain.js";
export declare function fakeNode(overrides?: Record<string, () => unknown>): {
    client: ChainClient;
    calls: string[];
};
