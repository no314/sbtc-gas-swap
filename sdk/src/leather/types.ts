// Structural mirrors of the Leather swap provider contract as of leather-io/mono PR #2554
// (head adedaac5d, 2026-08-31, branch feat/swaps), files:
//   packages/services/src/swap/swap-provider.interface.ts
//   packages/models/src/swap/swap.model.ts
// Mirrored on purpose: this package must not depend on the mono packages. When integrating,
// replace these with the real imports; the shapes are field-compatible. Money is reduced to
// { amount: bigint; decimals: number; symbol: string } here; mono's Money carries a BigNumber.

export interface MoneyLike { amount: bigint; decimals: number; symbol: string }

export type CryptoAssetId = string;              // mono: CryptoAssetId ("stx", "sbtc" ...)
export type StacksProtocol = string;             // mono: StacksProtocol ("bitflow" | "velar" ...)

export interface SwapProviderAsset {
  providerId: string;
  providerAssetId: string;
  assetId: CryptoAssetId;
}

export interface ExecutionConstraint { kind: string; message: string }

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

export interface GetTargetProviderAssetsParams { baseProviderAsset: SwapProviderAsset }
export interface GetSwapQuotesParams {
  baseAsset: CryptoAssetId;
  baseProviderAsset: SwapProviderAsset;
  targetAsset: CryptoAssetId;
  targetProviderAsset: SwapProviderAsset;
  baseAmount: MoneyLike;
}
export interface AccountRequestLike { stacksAddress: string }
export interface GetSwapExecutionDataParams<Q extends BaseSwapQuote = BaseSwapQuote> {
  request: AccountRequestLike;
  quote: Q;
  slippagePercentage: number;   // mono: BigNumber percent, e.g. 1 for 1 percent
}

export interface BaseSwapExecutionData { executionType: string; providerId: string }

// mono's existing type
export interface StacksContractCallSwapExecutionData extends BaseSwapExecutionData {
  executionType: "stacks-contract-call";
  contractAddress: string;
  contractName: string;
  functionName: string;
  functionArgs: unknown[];
  postConditions: unknown[];
  postConditionMode?: unknown;
}

// PROPOSED addition to swapExecutionTypes: the same call, built with sponsored: true and fee 0,
// then POSTed to a relay instead of broadcast. The strategy for this type lives in
// packages/state/src/swap/strategies/execution-type/execution-type.ts (see docs/leather-integration.md).
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
  // Relays that accept this tier, best first. The strategy posts the signed hex to them in order.
  relays: { url: string; sponsor: string; minTier: string }[];
  // Line items for the review screen.
  tier: { name: string; ustx: string };
  fees: { serviceFeeSats: string; integratorFeeSats: string; netSats: string };
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
