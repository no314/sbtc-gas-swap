#!/usr/bin/env node
// After the mainnet deploy is mined: fetches the live source, computes its structure hash, compares it
// with the reviewed source, and prints the values to paste into docs/contract.md (Deployment table).
//   [API=https://api.hiro.so] node scripts/pin-contract.mjs
import { readFileSync } from "node:fs";
import { structureHash } from "./build-simnet-variant.mjs";
const api = process.env.API ?? "https://api.hiro.so";
const id = "SP2BM6AQSMQ04CX8KDE62QBFVZTDZ2ZX80GZJSBZ4/sbtc-gas-swap-v1";
const r = await fetch(`${api}/v2/contracts/source/${id}?proof=0`);
if (!r.ok) throw new Error(`${r.status} from /v2/contracts/source: ${await r.text()}`);
const { source, publish_height } = await r.json();
const live = structureHash(source);
const reviewed = structureHash(readFileSync(new URL("../contracts/sbtc-gas-swap-v1.clar", import.meta.url), "utf8"));
console.log({ publish_height, liveStructureHash: live, reviewedStructureHash: reviewed, match: live === reviewed });
if (live !== reviewed) process.exit(1);
console.log("Paste publish_height into docs/contract.md; PINNED_STRUCTURE_HASH in sdk/src/verify-contract.ts already equals the reviewed hash.");
