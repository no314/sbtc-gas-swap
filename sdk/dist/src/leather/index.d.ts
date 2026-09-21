import { ChainClient } from "../client/chain.js";
import { RelayClient, type RelayInfo } from "../relays.js";
import { type TierName } from "../config.js";
import type { BaseSwapQuote, GetSwapExecutionDataParams, GetSwapQuotesParams, GetTargetProviderAssetsParams, SponsoredStacksContractCallSwapExecutionData, SwapProviderAsset, SwapProviderService } from "./types.js";
export * from "./types.js";
export declare const PROVIDER_ID = "sbtc-gas-swap";
export declare const EXECUTION_TYPE = "sponsored-stacks-contract-call";
export interface SbtcGasSwapQuote extends BaseSwapQuote {
    executionType: typeof EXECUTION_TYPE;
    providerId: typeof PROVIDER_ID;
    providerQuoteData: {
        poolId: number;
        tier: TierName;
        tierUstx: string;
        quoteOutUstx: string;
        userReceivesUstx: string;
        serviceFeeSats: string;
        integratorFeeSats: string;
        netSats: string;
        relays: RelayInfo[];
        readAt: number;
    };
}
export interface SbtcGasSwapProviderOptions {
    chain?: ChainClient;
    relays?: RelayClient;
    integrator?: string;
    integratorBips?: bigint;
    assetIds?: {
        sbtc: string;
        stx: string;
    };
}
export declare class SbtcGasSwapProvider implements SwapProviderService {
    readonly providerId = "sbtc-gas-swap";
    private readonly chain;
    private readonly relays;
    private readonly integrator?;
    private readonly integratorBips;
    private readonly ids;
    constructor(o?: SbtcGasSwapProviderOptions);
    getBaseProviderAssets(): Promise<SwapProviderAsset[]>;
    getTargetProviderAssets(p: GetTargetProviderAssetsParams): Promise<SwapProviderAsset[]>;
    getSwapQuotes(p: GetSwapQuotesParams): Promise<SbtcGasSwapQuote[]>;
    getSwapExecutionData(p: GetSwapExecutionDataParams<SbtcGasSwapQuote>): Promise<SponsoredStacksContractCallSwapExecutionData>;
    submitSigned(signedTxHex: string, relays: RelayInfo[]): Promise<import("../relays.js").SubmitFail | import("../relays.js").SubmitOk>;
}
