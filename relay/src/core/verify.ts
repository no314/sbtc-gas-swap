// Pure verification of a user-signed sponsored swap. No network, no clock.
// Input: transaction hex as the wallet returned it. Output: the parsed swap or a RelayError.

import {
  AddressHashMode,
  AddressVersion,
  AuthType,
  ClarityType,
  PayloadType,
  PostConditionMode,
  addressFromVersionHash,
  addressToString,
  deserializeTransaction,
  estimateTransactionByteLength,
  wireToPostCondition,
  type ClarityValue,
  type PostCondition,
  type StacksTransactionWire,
} from "@stacks/transactions";
import {
  BIPS_DENOM, CHAIN_ID, CONTRACT, FEE_BIPS, MAX_INTEGRATOR_BIPS, POOLS, RelayError, SBTC, TIERS, tierNameOf,
  type TierName,
} from "./config.js";

export interface VerifiedSwap {
  tx: StacksTransactionWire;
  origin: string;
  originNonce: bigint;
  amount: bigint;
  tier: bigint;
  tierName: TierName;
  minOut: bigint;
  poolId: number;
  integrator?: string;
  integratorBips: bigint;
  serviceFee: bigint;
  integratorFee: bigint;
  net: bigint;
  byteLength: number;
}

const ZERO_SIG = /^0*$/;

export async function verifySponsoredSwap(hex: string): Promise<VerifiedSwap> {
  let tx: StacksTransactionWire;
  try {
    if (!/^(0x)?[0-9a-fA-F]+$/.test(hex)) throw new Error("not hex");
    tx = deserializeTransaction(hex);
  } catch (e) {
    throw new RelayError("MALFORMED", `cannot deserialize transaction: ${(e as Error).message}`);
  }

  if (tx.auth.authType !== AuthType.Sponsored) {
    throw new RelayError("NOT_SPONSORED_AUTH", "transaction must use sponsored auth with fee 0");
  }
  const sponsorCond = tx.auth.sponsorSpendingCondition as any;
  if (sponsorCond && sponsorCond.signature && !ZERO_SIG.test(sponsorCond.signature.data ?? "")) {
    throw new RelayError("NOT_SPONSORED_AUTH", "transaction already carries a sponsor signature");
  }
  if (tx.chainId !== CHAIN_ID) {
    throw new RelayError("WRONG_NETWORK", `chain id ${tx.chainId}, expected mainnet ${CHAIN_ID}`);
  }

  const origin = tx.auth.spendingCondition as any;
  if (origin.hashMode !== AddressHashMode.P2PKH && origin.hashMode !== AddressHashMode.P2WPKH) {
    throw new RelayError("MALFORMED", "only single-signature origins are supported in v1");
  }
  const originAddress = addressToString(addressFromVersionHash(AddressVersion.MainnetSingleSig, origin.signer));
  const originNonce = BigInt(origin.nonce);

  if (tx.payload.payloadType !== PayloadType.ContractCall) {
    throw new RelayError("WRONG_CONTRACT", "payload is not a contract call");
  }
  const payload = tx.payload as any;
  const contractAddress = addressToString(payload.contractAddress);
  const contractName: string = payload.contractName.content;
  const functionName: string = payload.functionName.content;
  if (contractAddress !== CONTRACT.address || contractName !== CONTRACT.name) {
    throw new RelayError("WRONG_CONTRACT", `call to ${contractAddress}.${contractName}, expected ${CONTRACT.address}.${CONTRACT.name}`);
  }
  if (functionName !== CONTRACT.fn) {
    throw new RelayError("WRONG_FUNCTION", `call to ${functionName}, expected ${CONTRACT.fn}`);
  }

  const args = parseArgs(payload.functionArgs as ClarityValue[]);
  const tierName = tierNameOf(args.tier);
  if (!tierName) throw new RelayError("BAD_TIER", `tier ${args.tier} is not one of ${Object.values(TIERS).join(", ")}`);
  if (args.minOut < args.tier) throw new RelayError("MIN_OUT_BELOW_TIER", `min-out ${args.minOut} below tier ${args.tier}`);
  const pool = POOLS[args.poolId];
  if (!pool) throw new RelayError("UNKNOWN_POOL", `pool id ${args.poolId}`);
  if (args.integratorBips > MAX_INTEGRATOR_BIPS) throw new RelayError("BAD_BIPS", `integrator bips ${args.integratorBips} above ${MAX_INTEGRATOR_BIPS}`);
  if (args.amount === 0n) throw new RelayError("BAD_ARGS", "amount is 0");

  const serviceFee = (args.amount * FEE_BIPS) / BIPS_DENOM;
  const effectiveBips = args.integrator ? args.integratorBips : 0n;
  const integratorFee = (args.amount * effectiveBips) / BIPS_DENOM;
  const net = args.amount - serviceFee - integratorFee;

  if (tx.postConditionMode !== PostConditionMode.Deny) {
    throw new RelayError("BAD_POST_CONDITIONS", "post-condition mode must be deny");
  }
  const actual = (tx.postConditions.values as any[]).map((w) => normalize(wireToPostCondition(w)));
  const expected = expectedPostConditions({ user: originAddress, amount: args.amount, tier: args.tier, minOut: args.minOut, poolId: args.poolId }).map(normalize);
  if (!sameSet(actual, expected)) {
    throw new RelayError("BAD_POST_CONDITIONS", `post-conditions must be exactly: ${expected.join(" | ")}; got: ${actual.join(" | ")}`);
  }

  return {
    tx,
    origin: originAddress,
    originNonce,
    amount: args.amount,
    tier: args.tier,
    tierName,
    minOut: args.minOut,
    poolId: args.poolId,
    integrator: args.integrator,
    integratorBips: args.integratorBips,
    serviceFee,
    integratorFee,
    net,
    byteLength: estimateTransactionByteLength(tx),
  };
}

interface ParsedArgs {
  amount: bigint; tier: bigint; minOut: bigint; poolId: number; integrator?: string; integratorBips: bigint;
}

function parseArgs(args: ClarityValue[]): ParsedArgs {
  if (args.length !== 6) throw new RelayError("BAD_ARGS", `expected 6 arguments, got ${args.length}`);
  const uint = (cv: ClarityValue, name: string): bigint => {
    if (cv.type !== ClarityType.UInt) throw new RelayError("BAD_ARGS", `${name} must be uint`);
    return BigInt((cv as any).value);
  };
  const amount = uint(args[0], "amount");
  const tier = uint(args[1], "tier");
  const minOut = uint(args[2], "min-out");
  const poolBig = uint(args[3], "pool-id");
  const integratorCv = args[4];
  let integrator: string | undefined;
  if (integratorCv.type === ClarityType.OptionalSome) {
    const inner = (integratorCv as any).value as ClarityValue;
    if (inner.type !== ClarityType.PrincipalStandard && inner.type !== ClarityType.PrincipalContract) {
      throw new RelayError("BAD_ARGS", "integrator must be a principal");
    }
    integrator = (inner as any).value as string;
  } else if (integratorCv.type !== ClarityType.OptionalNone) {
    throw new RelayError("BAD_ARGS", "integrator must be (optional principal)");
  }
  const integratorBips = uint(args[5], "integrator-bips");
  if (poolBig > 1_000n) throw new RelayError("UNKNOWN_POOL", `pool id ${poolBig}`);
  return { amount, tier, minOut, poolId: Number(poolBig), integrator, integratorBips };
}

export interface PostConditionInputs {
  user: string; amount: bigint; tier: bigint; minOut: bigint; poolId: number;
}

// The exact post-condition set the wallet must have signed. Shared with the SDK by contract.
export function expectedPostConditions(i: PostConditionInputs): PostCondition[] {
  const pool = POOLS[i.poolId];
  if (!pool) throw new RelayError("UNKNOWN_POOL", `pool id ${i.poolId}`);
  const asset = `${SBTC.address}.${SBTC.name}::${SBTC.asset}`;
  return [
    { type: "ft-postcondition", address: i.user, condition: pool.sbtcCondition, amount: i.amount.toString(), asset } as PostCondition,
    { type: "stx-postcondition", address: i.user, condition: "eq", amount: i.tier.toString() } as PostCondition,
    { type: "stx-postcondition", address: pool.stxSender, condition: "gte", amount: i.minOut.toString() } as PostCondition,
  ];
}

function normalize(pc: PostCondition): string {
  const p = pc as any;
  const amount = BigInt(p.amount ?? 0).toString();
  return [p.type, p.address, p.condition, amount, p.asset ?? ""].join("~");
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort(), sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}
