// Mainnet smoke test: one real sponsored swap at dust size, end to end, without a wallet.
// The only place a user key touches code in this repo. It comes from the environment, never from a file.
//
//   DUST_USER_KEY=<hex private key of a throwaway account holding a few hundred sats of sBTC> \
//   RELAYS=https://sbtc-gas-relay.<sub>.workers.dev \
//   AMOUNT_SATS=1000 TIER=low SLIPPAGE_BIPS=1000 [HIRO_API_KEY=...] [API=https://api.hiro.so] \
//   npm run dust-swap
//
// Prints the quote, the built call, the relay response and polls the transaction until it is mined,
// then compares the on-chain result with the quote to the uSTX. Exit code 0 only on a mined success.

import { getAddressFromPrivateKey, makeContractCall, PostConditionMode } from "@stacks/transactions";
import { ChainClient } from "../src/client/chain.js";
import { quoteAllPools } from "../src/quote/index.js";
import { buildSwapCall } from "../src/build.js";
import { RelayClient } from "../src/relays.js";
import { defaultSlippageBips, defaultTier } from "../src/defaults.js";
import { verifyContract } from "../src/verify-contract.js";
import { explainRelayError, explainTxFailure } from "../src/explain.js";
import type { TierName } from "../src/config.js";

async function main() {
  const key = process.env.DUST_USER_KEY;
  if (!key) throw new Error("DUST_USER_KEY is required");
  const relays = (process.env.RELAYS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (relays.length === 0) throw new Error("RELAYS is required (comma separated relay base URLs)");
  const amountSats = BigInt(process.env.AMOUNT_SATS ?? "1000");
  const user = getAddressFromPrivateKey(key, "mainnet");
  const chain = new ChainClient({ baseUrl: process.env.API, apiKey: process.env.HIRO_API_KEY });
  const relayClient = new RelayClient({ relays });

  console.log("user", user);
  const v = await verifyContract(chain);
  console.log("contract verification", v.ok ? "ok" : `FAILED ${v.error ?? `${v.liveHash} != ${v.pinnedHash}`}`);
  if (!v.ok) process.exit(2);

  const balance = await chain.getSbtcBalance(user);
  console.log("sBTC balance sats", balance.toString());
  if (balance < amountSats) throw new Error("insufficient sBTC");

  const q = await quoteAllPools(chain, { amountSats, integratorBips: 0n });
  for (const x of q.quotes) console.log(`pool ${x.poolId}: out ${x.out} uSTX, fee ${x.feeSats} sats, impact ${x.impactBips} bips${x.reason ? `, ${x.reason}` : ""}`);
  for (const u of q.unavailable) console.log(`pool ${u.poolId}: unavailable (${u.error})`);
  console.log("best pool", q.best.poolId, "out", q.best.out.toString());

  const candidates = await relayClient.discover();
  for (const c of candidates) console.log("relay", c.url, c.info ? `minTier ${c.info.minTier} fees ${JSON.stringify(c.info.feeEstimate)}` : `unreachable: ${c.error}`);
  const minTier = candidates.flatMap((c) => (c.info ? [c.info.minTier] : []))[0] ?? "low";
  const tier = (process.env.TIER as TierName | undefined) ?? defaultTier(amountSats, { minTier });
  const slippageBips = process.env.SLIPPAGE_BIPS ? BigInt(process.env.SLIPPAGE_BIPS) : defaultSlippageBips(amountSats);
  const call = buildSwapCall({ user, amountSats, tier, poolId: q.best.poolId, quoteOut: q.best.out, slippageBips });
  console.log("call", { tier, minOut: call.minOut.toString(), fees: call.fees, poolId: q.best.poolId });

  const nonces = await chain.getNonces(user);
  const [contractAddress, contractName] = call.contract.split(".");
  const tx = await makeContractCall({
    contractAddress, contractName, functionName: call.functionName, functionArgs: call.functionArgs,
    postConditions: call.postConditions, postConditionMode: PostConditionMode.Deny,
    sponsored: true, fee: 0n, nonce: BigInt(nonces.possibleNext), network: "mainnet", senderKey: key,
  });
  const hex = tx.serialize();
  console.log("signed sponsored tx bytes", hex.length / 2);

  const ranked = RelayClient.rank(candidates, tier);
  const r = await relayClient.submit(hex, ranked);
  if (!r.ok) {
    for (const a of r.attempts) console.log("relay", a.relay, a.code, a.message, "->", explainRelayError(a.code).action);
    process.exit(3);
  }
  console.log("sponsored by", r.relay, "sponsor", r.sponsor, "fee", r.fee, "txid", r.txid);

  // poll
  const deadline = Date.now() + 20 * 60_000;
  while (Date.now() < deadline) {
    await new Promise((res) => setTimeout(res, 10_000));
    const res = await chain.request(`/extended/v1/tx/0x${r.txid}`);
    if (res.status === 404) { console.log("pending (not indexed yet)"); continue; }
    const j = (await res.json()) as any;
    if (j.tx_status === "pending") { console.log("pending in mempool"); continue; }
    console.log("status", j.tx_status, "result", j.tx_result?.repr, "fee", j.fee_rate, "block", j.block_height);
    if (j.tx_status === "success") {
      const m = String(j.tx_result?.repr).match(/received u(\d+)/);
      const received = m ? BigInt(m[1]) : null;
      console.log("received uSTX", received?.toString(), "quoted", q.best.out.toString(), received === q.best.out ? "EXACT MATCH" : `delta ${received !== null ? received - q.best.out : "?"}`);
      process.exit(0);
    }
    const e = explainTxFailure(j.tx_status, j.tx_result?.repr);
    console.log(e.title, e.action);
    process.exit(4);
  }
  console.log("timed out waiting for the transaction");
  process.exit(5);
}

main().catch((e) => { console.error(e); process.exit(1); });
