// The relay's one job, as a pure-ish orchestration over injected dependencies:
// verify -> policy -> preflight -> reserve nonce -> co-sign -> broadcast -> record.
import { serializePayload, sponsorTransaction, type StacksTransactionWire } from "@stacks/transactions";
import { POLICY, RelayError, TIERS, TIER_NAMES, type TierName } from "./config.js";
import { verifySponsoredSwap, type VerifiedSwap } from "./verify.js";
import { bumpFee, computeFee, minTierFor } from "./fee.js";
import { reconcileNonce, type ChainNonces } from "./nonce.js";
import type { PendingRecord, RelayStore } from "./store.js";
export type { PendingRecord } from "./store.js";

export interface RelayChain {
  getSbtcBalance(address: string): Promise<bigint>;
  getNonces(address: string): Promise<ChainNonces>;
  quotePool(poolId: number, netSats: number | bigint): Promise<{ out: bigint; in: bigint }>;
  estimateFee(payloadHex: string, estimatedLen: number): Promise<{ low: bigint; mid: bigint; high: bigint } | null>;
  broadcast(txHex: string): Promise<{ txid: string } | { error: string; reason: string; reason_data?: unknown }>;
}
export interface SponsorKey { privateKey: string; address: string }
export type Policy = typeof POLICY;
export interface RelayDeps {
  chain: RelayChain;
  keys: Record<TierName, SponsorKey>;
  store: RelayStore;
  policy: Policy;
  now: () => number;
}

export interface SponsorResult { txid: string; sponsoredTx: string; fee: string; tier: TierName; sponsor: string }

const SPONSOR_SIG_BYTES = 66; // the placeholder condition already counts; the estimate is close enough

export async function handleSponsor(txHex: string, d: RelayDeps): Promise<SponsorResult> {
  const v = await verifySponsoredSwap(txHex);
  const key = d.keys[v.tierName];

  // policy: is this tier acceptable at the current fee level
  const estimate = await estimateFor(v, d);
  const minTier = minTierFor(estimate, d.policy.feeFactor);
  if (minTier === null || TIER_NAMES.indexOf(v.tierName) < TIER_NAMES.indexOf(minTier)) {
    throw new RelayError("TIER_BELOW_MIN", `tier ${v.tierName} below the current minimum ${minTier ?? "none (fees above the high tier)"}`, 409);
  }
  // rate limits, checked before any chain read the request could trigger
  const now = d.now();
  if (!(await d.store.rateLimit(`origin:${v.origin}`, d.policy.perOriginPerHour, now))) throw new RelayError("RATE_LIMITED", `more than ${d.policy.perOriginPerHour} requests per hour from ${v.origin}`, 429);
  if (!(await d.store.rateLimit("global", d.policy.globalPerHour, now))) throw new RelayError("RATE_LIMITED", "relay hourly capacity reached", 429);

  // preflight: everything that would make the sponsor pay for an abort
  const balance = await d.chain.getSbtcBalance(v.origin);
  if (balance < v.amount) throw new RelayError("INSUFFICIENT_SBTC", `${v.origin} holds ${balance} sats, swap needs ${v.amount}`);
  const userNonces = await d.chain.getNonces(v.origin);
  if (BigInt(userNonces.possibleNext) !== v.originNonce) throw new RelayError("BAD_NONCE", `origin nonce ${v.originNonce}, chain expects ${userNonces.possibleNext}`, 409);
  const quote = await d.chain.quotePool(v.poolId, v.net);
  if (quote.out < v.minOut) throw new RelayError("QUOTE_BELOW_MIN_OUT", `pool ${v.poolId} now quotes ${quote.out} uSTX, below min-out ${v.minOut}`, 409);

  const fee = computeFee({ tier: v.tier, tierName: v.tierName, estimateUstx: estimate, byteLength: v.byteLength + SPONSOR_SIG_BYTES, feeFactor: d.policy.feeFactor, floorUstx: d.policy.feeFloorUstx, minPerByte: d.policy.minFeePerByte, firstBid: d.policy.firstBid });

  // reserve a sponsor nonce, sign, broadcast; one reconcile-and-retry on a nonce conflict
  let attempt = 0;
  while (true) {
    const local = await d.store.getNonceState(key.address);
    const chainNonces = await d.chain.getNonces(key.address);
    const rec = reconcileNonce(local, chainNonces, d.policy.maxPendingPerKey);
    if (rec.nonce === null) throw new RelayError("SPONSOR_BUSY", `sponsor ${key.address} has ${rec.pending.length} pending transactions`, 503);
    const signed = await sponsorTransaction({ transaction: v.tx, sponsorPrivateKey: key.privateKey, fee, sponsorNonce: rec.nonce, network: "mainnet" });
    const hex = signed.serialize();
    const res = await d.chain.broadcast(hex);
    if ("txid" in res && res.txid) {
      await d.store.setNonceState(key.address, { next: rec.nonce + 1n, pending: [...rec.pending, rec.nonce] });
      await d.store.addPending({ txid: res.txid, tier: v.tierName, sponsor: key.address, sponsorNonce: rec.nonce, fee, originalTx: txHex, broadcastAt: now, bumps: 0, origin: v.origin });
      return { txid: res.txid, sponsoredTx: hex, fee: fee.toString(), tier: v.tierName, sponsor: key.address };
    }
    const reason = (res as any).reason as string;
    if ((reason === "BadNonce" || reason === "ConflictingNonceInMempool") && attempt === 0) {
      attempt++;
      // forget the local counter; the chain view wins on the retry
      await d.store.setNonceState(key.address, { next: null, pending: rec.pending });
      continue;
    }
    throw new RelayError("BROADCAST_FAILED", `node rejected the transaction: ${reason} ${JSON.stringify((res as any).reason_data ?? "")}`, 502);
  }
}

async function estimateFor(v: VerifiedSwap, d: RelayDeps): Promise<bigint> {
  const payloadHex = serializePayload(v.tx.payload);
  const est = await d.chain.estimateFee(payloadHex, v.byteLength + SPONSOR_SIG_BYTES).catch(() => null);
  return est ? est.mid : d.policy.feeFloorUstx;
}

export interface RelayInfo {
  contract: string; network: "mainnet"; sponsors: Record<TierName, string>; minTier: TierName | "none";
  feeEstimate: Record<TierName, string>; feeFactor: number; maxPerOriginPerHour: number; termsUrl?: string; version: string;
  pending: Record<TierName, number>;
  // What each tier opens at and how fast it is bumped, so a user can see what the tier buys.
  feePolicy: {
    firstBid: Record<TierName, string>;
    rbfAfterSeconds: Record<TierName, number>;
    rbfBumpBips: string;
    maxFee: Record<TierName, string>;
  };
}

export async function buildInfo(d: RelayDeps, contract = "SP2BM6AQSMQ04CX8KDE62QBFVZTDZ2ZX80GZJSBZ4.sbtc-gas-swap-v1", termsUrl?: string): Promise<RelayInfo> {
  // Estimate with a representative payload length; the per-tier fee is that estimate capped at the tier.
  const est = await d.chain.estimateFee("", d.policy.estimatedLengthBytes).catch(() => null);
  const mid = est ? est.mid : d.policy.feeFloorUstx;
  const feeEstimate = {} as Record<TierName, string>;
  const maxFee = {} as Record<TierName, string>;
  const pending = {} as Record<TierName, number>;
  for (const t of TIER_NAMES) {
    feeEstimate[t] = computeFee({ tier: TIERS[t], tierName: t, estimateUstx: mid, byteLength: d.policy.estimatedLengthBytes, feeFactor: d.policy.feeFactor, floorUstx: d.policy.feeFloorUstx, minPerByte: d.policy.minFeePerByte, firstBid: d.policy.firstBid }).toString();
    maxFee[t] = TIERS[t].toString();
    pending[t] = (await d.store.getNonceState(d.keys[t].address)).pending.length;
  }
  return {
    contract, network: "mainnet",
    sponsors: { low: d.keys.low.address, mid: d.keys.mid.address, high: d.keys.high.address },
    minTier: minTierFor(mid, d.policy.feeFactor) ?? "none",
    feeEstimate, feeFactor: d.policy.feeFactor, maxPerOriginPerHour: d.policy.perOriginPerHour, termsUrl, version: "0.1.0", pending,
    feePolicy: { firstBid: feeEstimate, rbfAfterSeconds: d.policy.rbfAfterSeconds, rbfBumpBips: d.policy.rbfBumpBips.toString(), maxFee },
  };
}

// --- RBF planning (pure). The adapter runs it on a schedule and executes the plan.
export interface RbfPlan {
  done: PendingRecord[];                                   // executed on chain: drop
  bump: { record: PendingRecord; newFee: bigint }[];       // re-sponsor at the same nonce with a higher fee
  stuck: PendingRecord[];                                  // fee at the tier and still pending: operator attention
}
export function planRbf(pending: PendingRecord[], noncesBySponsor: Record<string, ChainNonces>, now: number, policy: Policy): RbfPlan {
  const plan: RbfPlan = { done: [], bump: [], stuck: [] };
  for (const r of pending) {
    const n = noncesBySponsor[r.sponsor];
    if (n && n.lastExecuted !== null && BigInt(n.lastExecuted) >= r.sponsorNonce) { plan.done.push(r); continue; }
    if (now - r.broadcastAt < policy.rbfAfterSeconds[r.tier] * 1000) continue;
    const newFee = bumpFee(r.fee, TIERS[r.tier], policy.rbfBumpBips);
    if (newFee === null) plan.stuck.push(r); else plan.bump.push({ record: r, newFee });
  }
  return plan;
}

export async function executeRbf(d: RelayDeps): Promise<{ bumped: number; done: number; stuck: number }> {
  const pending = await d.store.listPending();
  const sponsors = [...new Set(pending.map((p) => p.sponsor))];
  const nonces: Record<string, ChainNonces> = {};
  for (const s of sponsors) nonces[s] = await d.chain.getNonces(s);
  const plan = planRbf(pending, nonces, d.now(), d.policy);
  for (const r of plan.done) {
    await d.store.removePending(r.txid);
    const st = await d.store.getNonceState(r.sponsor);
    await d.store.setNonceState(r.sponsor, { ...st, pending: st.pending.filter((n) => n !== r.sponsorNonce) });
  }
  let bumped = 0;
  for (const { record, newFee } of plan.bump) {
    const key = d.keys[record.tier];
    const v = await verifySponsoredSwap(record.originalTx);
    const signed = await sponsorTransaction({ transaction: v.tx, sponsorPrivateKey: key.privateKey, fee: newFee, sponsorNonce: record.sponsorNonce, network: "mainnet" });
    const res = await d.chain.broadcast(signed.serialize());
    if ("txid" in res && res.txid) {
      await d.store.replacePending(record.txid, { ...record, txid: res.txid, fee: newFee, bumps: record.bumps + 1, broadcastAt: d.now() });
      bumped++;
    }
  }
  return { bumped, done: plan.done.length, stuck: plan.stuck.length };
}
