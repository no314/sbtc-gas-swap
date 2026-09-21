#!/usr/bin/env node
// Deploys contracts/sbtc-gas-swap-v1.clar to mainnet from the deployer key in the environment.
// Run on a machine that reaches api.hiro.so. The key is read from DEPLOYER_KEY and never written anywhere.
//
//   DEPLOYER_KEY=<hex> [FEE_USTX=300000] [API=https://api.hiro.so] node scripts/deploy-mainnet.mjs
//
// Prints the txid. Then run scripts/pin-contract.mjs once it is mined.
import { readFileSync } from "node:fs";
import { makeContractDeploy, broadcastTransaction, getAddressFromPrivateKey, ClarityVersion, PostConditionMode } from "@stacks/transactions";

const key = process.env.DEPLOYER_KEY;
if (!key) throw new Error("DEPLOYER_KEY is required");
const expected = "SP2BM6AQSMQ04CX8KDE62QBFVZTDZ2ZX80GZJSBZ4";
const address = getAddressFromPrivateKey(key, "mainnet");
if (address !== expected) throw new Error(`key derives ${address}, expected the deployer ${expected}`);
const codeBody = readFileSync(new URL("../contracts/sbtc-gas-swap-v1.clar", import.meta.url), "utf8");
const tx = await makeContractDeploy({
  contractName: "sbtc-gas-swap-v1",
  codeBody,
  clarityVersion: ClarityVersion.Clarity3,
  senderKey: key,
  network: "mainnet",
  fee: BigInt(process.env.FEE_USTX ?? "300000"),
  postConditionMode: PostConditionMode.Deny,
  postConditions: [],
  client: process.env.API ? { baseUrl: process.env.API } : undefined,
});
const res = await broadcastTransaction({ transaction: tx, network: "mainnet", client: process.env.API ? { baseUrl: process.env.API } : undefined });
console.log(JSON.stringify(res, null, 2));
