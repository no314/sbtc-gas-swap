export interface PoolQuote {
  poolId: number;
  in: bigint;            // sats the pool would take (equals input except DLMM partial fills)
  out: bigint;           // uSTX to the user, 0 when not quotable
  feeSats: bigint;       // pool fee charged on the input
  impactBips: bigint;    // price impact versus the marginal price before the trade
  reserveStx: bigint;    // for tie-breaking and display
  partial?: boolean;
  reason?: "disabled" | "below-minimum" | "no-liquidity";
}
