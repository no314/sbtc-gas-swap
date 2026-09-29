// Pinned identities and rules. Everything the relay verifies against lives here.
// Values verified against deployed sources on 2026-09-05 (docs/mainnet-sources).

export const NETWORK = "mainnet" as const;
export const CHAIN_ID = 0x00000001;

export const CONTRACT = {
  // Set after mainnet deploy (docs/contract.md). The deployer is fixed already.
  address: "SP2BM6AQSMQ04CX8KDE62QBFVZTDZ2ZX80GZJSBZ4",
  name: "sbtc-gas-swap-v1",
  fn: "swap-sbtc-for-gas",
} as const;

export const SBTC = {
  address: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4",
  name: "sbtc-token",
  asset: "sbtc-token",
} as const;

export const TIERS = {
  low: 10_000n,
  mid: 100_000n,
  high: 1_000_000n,
} as const;
export type TierName = keyof typeof TIERS;
export const TIER_NAMES: TierName[] = ["low", "mid", "high"];

export function tierNameOf(value: bigint): TierName | undefined {
  return TIER_NAMES.find((t) => TIERS[t] === value);
}

export const FEE_BIPS = 50n;
export const MAX_INTEGRATOR_BIPS = 100n;
export const BIPS_DENOM = 10_000n;

export interface PoolSpec {
  id: number;
  name: string;
  // The principal that sends STX to the user; the post-condition is placed on it.
  stxSender: string;
  // sBTC leaves the user for exactly amount (eq) or at most amount (lte, partial fills).
  sbtcCondition: "eq" | "lte";
}

export const POOLS: Record<number, PoolSpec> = {
  1: {
    id: 1,
    name: "bitflow-xyk",
    stxSender: "SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.xyk-pool-sbtc-stx-v-1-1",
    sbtcCondition: "eq",
  },
  2: {
    id: 2,
    name: "velar-univ2-70",
    stxSender: "SP20X3DC5R091J8B6YPQT638J8NR1W83KN6TN5BJY.univ2-pool-v1_0_0-0070",
    sbtcCondition: "eq",
  },
  3: {
    id: 3,
    name: "bitflow-dlmm-v2",
    stxSender: "SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-pool-stx-sbtc-v-2-bps-15",
    sbtcCondition: "lte",
  },
};

export const XYK = {
  core: "SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.xyk-core-v-1-2",
  pool: "SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.xyk-pool-sbtc-stx-v-1-1",
  stxWrapper: "SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.token-stx-v-1-2",
} as const;
export const VELAR = {
  pool: "SP20X3DC5R091J8B6YPQT638J8NR1W83KN6TN5BJY.univ2-pool-v1_0_0-0070",
  fees: "SP20X3DC5R091J8B6YPQT638J8NR1W83KN6TN5BJY.univ2-fees-v1_0_0-0070",
  wstx: "SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.wstx",
} as const;
export const DLMM = {
  router: "SP1PFR4V08H1RAZXREBGFFQ59WB739XM8VVGTFSEA.dlmm-swap-router-v-1-1",
  pool: "SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-pool-stx-sbtc-v-2-bps-15",
} as const;

// Relay policy defaults. Operators override through environment (see operator guide).
// There is no fee estimator. The node's estimate is not a market price: a handful of mispriced
// mempool transactions pull its middle and high values up by orders of magnitude (observed
// 2026-09-29: 17 transactions in the mempool, contract-call p75 of 1051 STX, estimates of
// 632 / 632717 / 712364 uSTX for a swap that clears at 3000). A relay that trusted it refused every
// user. Instead each tier opens at a fixed bid and the replace-by-fee ladder climbs on the tier's
// schedule, never above the tier the user repays. Per-tier sponsor keys keep the queues apart.
export const POLICY: {
  openingBid: Record<TierName, bigint>; minTier: TierName; minFeePerByte: bigint; maxPendingPerKey: number;
  perOriginPerHour: number; globalPerHour: number; rbfAfterSeconds: Record<TierName, number>; rbfBumpBips: bigint;
} = {
  // Opening bid per tier, uSTX. Low opens at what clears within a block today. Mid opens at twice
  // that. High opens at 80 percent of its tier, which leaves three bumps inside the tier.
  openingBid: { low: 3_000n, mid: 6_000n, high: 800_000n },
  minTier: "low",                 // the lowest tier this operator sponsors; a policy, not an estimate
  minFeePerByte: 1n,              // network admission floor, uSTX per byte
  maxPendingPerKey: 20,           // network chaining limit is 25; keep headroom
  perOriginPerHour: 5,
  globalPerHour: 500,
  // How long a transaction may sit before its fee is bumped 10 percent. Low and mid wait 30 minutes.
  // High waits one sweep interval, so it reaches the user's full tier as soon as possible; the
  // margin there is meant for the miner, not the sponsor.
  rbfAfterSeconds: { low: 30 * 60, mid: 30 * 60, high: 10 * 60 },
  rbfBumpBips: 1_000n,            // +10 percent per bump, never above the tier
};

export const ERROR_CODES = [
  "NOT_SPONSORED_AUTH",
  "WRONG_NETWORK",
  "WRONG_CONTRACT",
  "WRONG_FUNCTION",
  "BAD_ARGS",
  "UNKNOWN_POOL",
  "BAD_TIER",
  "TIER_BELOW_MIN",
  "MIN_OUT_BELOW_TIER",
  "BAD_BIPS",
  "BAD_POST_CONDITIONS",
  "INSUFFICIENT_SBTC",
  "BAD_NONCE",
  "QUOTE_BELOW_MIN_OUT",
  "RATE_LIMITED",
  "SPONSOR_BUSY",
  "BROADCAST_FAILED",
  "MALFORMED",
  "BAD_SIGNATURE",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export class RelayError extends Error {
  constructor(public code: ErrorCode, message: string, public status = 400) {
    super(message);
  }
}
