export interface MoneyLike {
    amount: bigint;
    decimals: number;
    symbol: string;
}
export type CryptoAssetId = string;
export type StacksProtocol = string;
export interface SwapProviderAsset {
    providerId: string;
    providerAssetId: string;
    assetId: CryptoAssetId;
}
export interface ExecutionConstraint {
    kind: string;
    message: string;
}
export interface BaseSwapQuote {
    executionType: string;
    providerId: string;
    baseAsset: CryptoAssetId;
    targetAsset: CryptoAssetId;
    baseAmount: MoneyLike;
    targetAmount: MoneyLike;
    dexPath: StacksProtocol[];
    assetPath: CryptoAssetId[];
    isExecutable: boolean;
    executionConstraints: ExecutionConstraint[];
    createdAt: number;
}
export interface GetTargetProviderAssetsParams {
    baseProviderAsset: SwapProviderAsset;
}
export interface GetSwapQuotesParams {
    baseAsset: CryptoAssetId;
    baseProviderAsset: SwapProviderAsset;
    targetAsset: CryptoAssetId;
    targetProviderAsset: SwapProviderAsset;
    baseAmount: MoneyLike;
}
export interface AccountRequestLike {
    stacksAddress: string;
}
export interface GetSwapExecutionDataParams<Q extends BaseSwapQuote = BaseSwapQuote> {
    request: AccountRequestLike;
    quote: Q;
    slippagePercentage: number;
}
export interface BaseSwapExecutionData {
    executionType: string;
    providerId: string;
}
export interface StacksContractCallSwapExecutionData extends BaseSwapExecutionData {
    executionType: "stacks-contract-call";
    contractAddress: string;
    contractName: string;
    functionName: string;
    functionArgs: unknown[];
    postConditions: unknown[];
    postConditionMode?: unknown;
}
export interface SponsoredStacksContractCallSwapExecutionData extends BaseSwapExecutionData {
    executionType: "sponsored-stacks-contract-call";
    contractAddress: string;
    contractName: string;
    functionName: string;
    functionArgs: unknown[];
    postConditions: unknown[];
    postConditionMode: "deny";
    sponsored: true;
    fee: 0;
    relays: {
        url: string;
        sponsor: string;
        minTier: string;
    }[];
    tier: {
        name: string;
        ustx: string;
    };
    fees: {
        serviceFeeSats: string;
        integratorFeeSats: string;
        netSats: string;
    };
    minOutUstx: string;
    poolId: number;
}
export interface SwapProviderService {
    providerId: string;
    getBaseProviderAssets(signal?: AbortSignal): Promise<SwapProviderAsset[]>;
    getTargetProviderAssets(params: GetTargetProviderAssetsParams, signal?: AbortSignal): Promise<SwapProviderAsset[]>;
    getSwapQuotes(params: GetSwapQuotesParams, signal?: AbortSignal): Promise<BaseSwapQuote[]>;
    getSwapExecutionData(params: GetSwapExecutionDataParams, signal?: AbortSignal): Promise<BaseSwapExecutionData>;
}
