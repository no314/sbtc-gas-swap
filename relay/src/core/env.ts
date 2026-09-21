// Environment to RelayDeps pieces shared by both adapters.
import { getAddressFromPrivateKey } from "@stacks/transactions";
import { POLICY, type TierName } from "./config.js";
import type { Policy, SponsorKey } from "./relay.js";

export interface RelayEnv {
  SPONSOR_KEY_LOW?: string; SPONSOR_KEY_MID?: string; SPONSOR_KEY_HIGH?: string;
  HIRO_API_KEY?: string; STACKS_API_URL?: string; FEE_FACTOR?: string; FEE_FLOOR_USTX?: string;
  PER_ORIGIN_PER_HOUR?: string; GLOBAL_PER_HOUR?: string; MAX_PENDING_PER_KEY?: string; TERMS_URL?: string; CONTRACT_ID?: string;
  MID_FIRST_BID_MULTIPLE?: string; HIGH_FIRST_BID_PCT?: string;
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
  return {
    ...POLICY,
    feeFactor: env.FEE_FACTOR ? Number(env.FEE_FACTOR) : POLICY.feeFactor,
    feeFloorUstx: env.FEE_FLOOR_USTX ? BigInt(env.FEE_FLOOR_USTX) : POLICY.feeFloorUstx,
    perOriginPerHour: env.PER_ORIGIN_PER_HOUR ? Number(env.PER_ORIGIN_PER_HOUR) : POLICY.perOriginPerHour,
    globalPerHour: env.GLOBAL_PER_HOUR ? Number(env.GLOBAL_PER_HOUR) : POLICY.globalPerHour,
    maxPendingPerKey: env.MAX_PENDING_PER_KEY ? Number(env.MAX_PENDING_PER_KEY) : POLICY.maxPendingPerKey,
    rbfAfterSeconds: {
      low: env.RBF_AFTER_SECONDS_LOW ? Number(env.RBF_AFTER_SECONDS_LOW) : POLICY.rbfAfterSeconds.low,
      mid: env.RBF_AFTER_SECONDS_MID ? Number(env.RBF_AFTER_SECONDS_MID) : POLICY.rbfAfterSeconds.mid,
      high: env.RBF_AFTER_SECONDS_HIGH ? Number(env.RBF_AFTER_SECONDS_HIGH) : POLICY.rbfAfterSeconds.high,
    },
    firstBid: {
      multipleOfLow: {
        ...POLICY.firstBid.multipleOfLow,
        mid: env.MID_FIRST_BID_MULTIPLE ? Number(env.MID_FIRST_BID_MULTIPLE) : POLICY.firstBid.multipleOfLow.mid,
      },
      pctOfTier: {
        ...POLICY.firstBid.pctOfTier,
        high: env.HIGH_FIRST_BID_PCT ? Number(env.HIGH_FIRST_BID_PCT) : POLICY.firstBid.pctOfTier.high,
      },
    },
  };
}
