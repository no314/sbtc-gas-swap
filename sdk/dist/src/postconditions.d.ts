import type { PostCondition } from "@stacks/transactions";
export interface PostConditionInputs {
    user: string;
    amount: bigint;
    tier: bigint;
    minOut: bigint;
    poolId: number;
}
export declare function expectedPostConditions(i: PostConditionInputs): PostCondition[];
