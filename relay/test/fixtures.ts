// Builds user-signed sponsored swap transactions the way the SDK and wallets do,
// so verification tests run against real wire bytes, not hand-written objects.
import {
  Cl,
  makeContractCall,
  Pc,
  PostConditionMode,
  type PostCondition,
  type StacksTransactionWire,
} from "@stacks/transactions";
import { CONTRACT, POOLS, SBTC, TIERS } from "../src/core/config.js";

// Deterministic throwaway keys. Never funded, never used outside tests.
export const USER_KEY = "7287ba251d44a4d3fd9276c88ce34c5c52a038955b4cf3de1a4f2b9f3d8b5b9101";
export const USER_ADDRESS = "SP227DXSVTHZZKF3B9N38G5GGG03N1Z4V86ZC3JVH";
export const USER_KEY_TESTNET_ADDRESS = "ST227DXSVTHZZKF3B9N38G5GGG03N1Z4V85S1MSPX";

export interface SwapArgs {
  amount: bigint;
  tier: bigint;
  minOut: bigint;
  poolId: number;
  integrator?: string;
  integratorBips?: bigint;
}

export function expectedPostConditions(a: SwapArgs, user = USER_ADDRESS): PostCondition[] {
  const pool = POOLS[a.poolId];
  const sbtcId = `${SBTC.address}.${SBTC.name}::${SBTC.asset}` as const;
  const sbtcOut = pool?.sbtcCondition === "lte"
    ? Pc.principal(user).willSendLte(a.amount).ft(sbtcId as any, SBTC.asset)
    : Pc.principal(user).willSendEq(a.amount).ft(sbtcId as any, SBTC.asset);
  return [
    sbtcOut,
    Pc.principal(user).willSendEq(a.tier).ustx(),
    Pc.principal(pool?.stxSender ?? user).willSendGte(a.minOut).ustx(),
  ];
}

export function swapFunctionArgs(a: SwapArgs) {
  return [
    Cl.uint(a.amount),
    Cl.uint(a.tier),
    Cl.uint(a.minOut),
    Cl.uint(a.poolId),
    a.integrator ? Cl.some(Cl.principal(a.integrator)) : Cl.none(),
    Cl.uint(a.integratorBips ?? 0n),
  ];
}

export interface BuildOverrides {
  sponsored?: boolean;
  network?: "mainnet" | "testnet";
  contractAddress?: string;
  contractName?: string;
  functionName?: string;
  functionArgs?: ReturnType<typeof swapFunctionArgs>;
  postConditions?: PostCondition[];
  postConditionMode?: PostConditionMode;
  nonce?: bigint;
  fee?: bigint;
  senderKey?: string;
}

export async function buildUserSignedSwap(a: SwapArgs, o: BuildOverrides = {}): Promise<StacksTransactionWire> {
  return makeContractCall({
    contractAddress: o.contractAddress ?? CONTRACT.address,
    contractName: o.contractName ?? CONTRACT.name,
    functionName: o.functionName ?? CONTRACT.fn,
    functionArgs: o.functionArgs ?? swapFunctionArgs(a),
    senderKey: o.senderKey ?? USER_KEY,
    network: o.network ?? "mainnet",
    sponsored: o.sponsored ?? true,
    fee: o.fee ?? 0n,
    nonce: o.nonce ?? 0n,
    postConditionMode: o.postConditionMode ?? PostConditionMode.Deny,
    postConditions: o.postConditions ?? expectedPostConditions(a),
  });
}

export const GOOD: SwapArgs = { amount: 30_000n, tier: TIERS.mid, minOut: 81_000_000n, poolId: 1 };
export const GOOD_WITH_INTEGRATOR: SwapArgs = { ...GOOD, integrator: "SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE", integratorBips: 100n };
