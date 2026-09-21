// Pinned identities and rules shared by the SDK, the relay, and the dapp.
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
  core: "SP1PFR4V08H1RAZXREBGFFQ59WB739XM8VVGTFSEA.dlmm-core-v-1-1",
  pool: "SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-pool-stx-sbtc-v-2-bps-15",
} as const;

// Small-swap threshold below which DLMM is not worth its runtime cost (bins fold).
export const DLMM_MIN_OUTPUT_USTX = 100_000_000n; // 100 STX

// Amount thresholds for the default tier and slippage (sats).
export const SMALL_SWAP_MAX_SATS = 30_000n;      // up to here: low tier, 10 percent slippage
export const LARGE_SWAP_MIN_SATS = 10_000_000n;  // from here: high tier
