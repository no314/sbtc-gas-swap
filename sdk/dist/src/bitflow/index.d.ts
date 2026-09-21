import { ChainClient } from "../client/chain.js";
import { RelayClient } from "../relays.js";
import { type SwapCall } from "../build.js";
import type { TierName } from "../config.js";
export interface SponsoredRouteInput {
    user: string;
    amountSats: bigint;
    integrator?: string;
    integratorBips?: bigint;
    tier?: TierName;
    slippageBips?: bigint;
    chain?: ChainClient;
    relays?: RelayClient;
}
export interface SponsoredRoute {
    call: SwapCall;
    quoteOutUstx: bigint;
    userReceivesUstx: bigint;
    relays: string[];
    submit: (signedTxHex: string) => ReturnType<RelayClient["submit"]>;
}
export declare function getSponsoredRoute(i: SponsoredRouteInput): Promise<SponsoredRoute>;
