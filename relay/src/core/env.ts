// Environment to RelayDeps pieces shared by both adapters.
import { getAddressFromPrivateKey } from "@stacks/transactions";
import { POLICY, type TierName } from "./config.js";
import type { Policy, SponsorKey } from "./relay.js";

export interface RelayEnv {
  SPONSOR_KEY_LOW?: string; SPONSOR_KEY_MID?: string; SPONSOR_KEY_HIGH?: string;
  HIRO_API_KEY?: string; STACKS_API_URL?: string; TERMS_URL?: string; CONTRACT_ID?: string;
  OPENING_BID_LOW?: string; OPENING_BID_MID?: string; OPENING_BID_HIGH?: string; MIN_TIER?: string;
  PER_ORIGIN_PER_HOUR?: string; GLOBAL_PER_HOUR?: string; MAX_PENDING_PER_KEY?: string;
  RBF_AFTER_SECONDS_LOW?: string; RBF_AFTER_SECONDS_MID?: string; RBF_AFTER_SECONDS_HIGH?: string;
}

export function keysFromEnv(env: RelayEnv): Record<TierName, SponsorKey> {
  const mk = (name: string, v?: string): SponsorKey => {
    if (!v || !/^[0-9a-fA-F]{64}(01)?$/.test(v)) throw new Error(`${name} must be a 64 or 66 hex char private key`);
    return { privateKey: v, address: getAddressFromPrivateKey(v, "mainnet") };
  };
  return { low: mk("SPONSOR_KEY_LOW", env.SPONSOR_KEY_LOW), mid: mk("SPONSOR_KEY_MID", env.SPONSOR_KEY_MID), high: mk("SPONSOR_KEY_HIGH", env.SPONSOR_KEY_HIGH) };
}

export function policyFromEnv(env: RelayEnv): Policy {
  const big = (v: string | undefined, d: bigint) => (v ? BigInt(v) : d);
  const num = (v: string | undefined, d: number) => (v ? Number(v) : d);
  const minTier = env.MIN_TIER === "low" || env.MIN_TIER === "mid" || env.MIN_TIER === "high" ? env.MIN_TIER : POLICY.minTier;
  return {
    ...POLICY,
    openingBid: {
      low: big(env.OPENING_BID_LOW, POLICY.openingBid.low),
      mid: big(env.OPENING_BID_MID, POLICY.openingBid.mid),
      high: big(env.OPENING_BID_HIGH, POLICY.openingBid.high),
    },
    minTier,
    perOriginPerHour: num(env.PER_ORIGIN_PER_HOUR, POLICY.perOriginPerHour),
    globalPerHour: num(env.GLOBAL_PER_HOUR, POLICY.globalPerHour),
    maxPendingPerKey: num(env.MAX_PENDING_PER_KEY, POLICY.maxPendingPerKey),
    rbfAfterSeconds: {
      low: num(env.RBF_AFTER_SECONDS_LOW, POLICY.rbfAfterSeconds.low),
      mid: num(env.RBF_AFTER_SECONDS_MID, POLICY.rbfAfterSeconds.mid),
      high: num(env.RBF_AFTER_SECONDS_HIGH, POLICY.rbfAfterSeconds.high),
    },
  };
}
