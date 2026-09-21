export interface PoolQuote {
    poolId: number;
    in: bigint;
    out: bigint;
    feeSats: bigint;
    impactBips: bigint;
    reserveStx: bigint;
    partial?: boolean;
    reason?: "disabled" | "below-minimum" | "no-liquidity";
}
