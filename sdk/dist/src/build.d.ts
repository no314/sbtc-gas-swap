import { type ClarityValue, type PostCondition } from "@stacks/transactions";
import { NETWORK, type TierName } from "./config.js";
import { type FeeSplit } from "./quote/fees.js";
export type BuildErrorCode = "BAD_AMOUNT" | "BAD_BIPS" | "UNKNOWN_POOL" | "MIN_OUT_BELOW_TIER";
export declare class SwapBuildError extends Error {
    code: BuildErrorCode;
    constructor(code: BuildErrorCode, message: string);
}
export interface BuildSwapInput {
    user: string;
    amountSats: bigint;
    tier: TierName;
    poolId: number;
    quoteOut: bigint;
    slippageBips: bigint;
    integrator?: string;
    integratorBips?: bigint;
}
export interface SwapCall {
    contract: `${string}.${string}`;
    functionName: string;
    functionArgs: ClarityValue[];
    postConditions: PostCondition[];
    postConditionMode: "deny";
    sponsored: true;
    fee: 0;
    network: typeof NETWORK;
    minOut: bigint;
    tierUstx: bigint;
    fees: FeeSplit;
}
export declare function buildSwapCall(i: BuildSwapInput): SwapCall;
