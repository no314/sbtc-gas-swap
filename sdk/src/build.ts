import { Cl, type ClarityValue, type PostCondition } from "@stacks/transactions";
import { CONTRACT, MAX_INTEGRATOR_BIPS, NETWORK, POOLS, TIERS, type TierName } from "./config.js";
import { minOutFor } from "./defaults.js";
import { expectedPostConditions } from "./postconditions.js";
import { splitFees, type FeeSplit } from "./quote/fees.js";

export type BuildErrorCode = "BAD_AMOUNT" | "BAD_BIPS" | "UNKNOWN_POOL" | "MIN_OUT_BELOW_TIER";
export class SwapBuildError extends Error {
  constructor(public code: BuildErrorCode, message: string) { super(message); }
}

export interface BuildSwapInput {
  user: string;             // the origin address that will sign
  amountSats: bigint;
  tier: TierName;
  poolId: number;
  quoteOut: bigint;         // fresh quote for the net input through poolId
  slippageBips: bigint;
  integrator?: string;
  integratorBips?: bigint;
}

// Shape of a SIP-030 stx_callContract request (what @stacks/connect `request` takes),
// plus the derived numbers the UI shows. Leather returns the signed hex without broadcasting
// when `sponsored` is true.
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

export function buildSwapCall(i: BuildSwapInput): SwapCall {
  if (i.amountSats <= 0n) throw new SwapBuildError("BAD_AMOUNT", "amount must be positive");
  const bips = i.integratorBips ?? 0n;
  if (bips < 0n || bips > MAX_INTEGRATOR_BIPS) throw new SwapBuildError("BAD_BIPS", `integrator bips must be 0..${MAX_INTEGRATOR_BIPS}`);
  if (!POOLS[i.poolId]) throw new SwapBuildError("UNKNOWN_POOL", `pool ${i.poolId}`);
  const tierUstx = TIERS[i.tier];
  const minOut = minOutFor(i.quoteOut, i.slippageBips);
  if (minOut < tierUstx) {
    throw new SwapBuildError("MIN_OUT_BELOW_TIER",
      `minimum output ${minOut} uSTX is below the ${i.tier} network fee of ${tierUstx} uSTX: raise the amount, lower the tier, or lower the slippage`);
  }
  const fees = splitFees(i.amountSats, i.integrator ? bips : 0n);
  return {
    contract: `${CONTRACT.address}.${CONTRACT.name}`,
    functionName: CONTRACT.fn,
    functionArgs: [
      Cl.uint(i.amountSats), Cl.uint(tierUstx), Cl.uint(minOut), Cl.uint(i.poolId),
      i.integrator ? Cl.some(Cl.principal(i.integrator)) : Cl.none(), Cl.uint(bips),
    ],
    postConditions: expectedPostConditions({ user: i.user, amount: i.amountSats, tier: tierUstx, minOut, poolId: i.poolId }),
    postConditionMode: "deny",
    sponsored: true,
    fee: 0,
    network: NETWORK,
    minOut,
    tierUstx,
    fees,
  };
}
