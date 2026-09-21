import { Cl } from "@stacks/transactions";
import { CONTRACT, MAX_INTEGRATOR_BIPS, NETWORK, POOLS, TIERS } from "./config.js";
import { minOutFor } from "./defaults.js";
import { expectedPostConditions } from "./postconditions.js";
import { splitFees } from "./quote/fees.js";
export class SwapBuildError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}
export function buildSwapCall(i) {
    if (i.amountSats <= 0n)
        throw new SwapBuildError("BAD_AMOUNT", "amount must be positive");
    const bips = i.integratorBips ?? 0n;
    if (bips < 0n || bips > MAX_INTEGRATOR_BIPS)
        throw new SwapBuildError("BAD_BIPS", `integrator bips must be 0..${MAX_INTEGRATOR_BIPS}`);
    if (!POOLS[i.poolId])
        throw new SwapBuildError("UNKNOWN_POOL", `pool ${i.poolId}`);
    const tierUstx = TIERS[i.tier];
    const minOut = minOutFor(i.quoteOut, i.slippageBips);
    if (minOut < tierUstx) {
        throw new SwapBuildError("MIN_OUT_BELOW_TIER", `minimum output ${minOut} uSTX is below the ${i.tier} tier rebate of ${tierUstx} uSTX: raise the amount, lower the tier, or lower the slippage`);
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
//# sourceMappingURL=build.js.map