// The relay's one job, as a pure-ish orchestration over injected dependencies:
// verify -> policy -> preflight -> reserve nonce -> co-sign -> broadcast -> record.
import { sponsorTransaction, type StacksTransactionWire } from "@stacks/transactions";
import { POLICY, RelayError, TIERS, TIER_NAMES, type TierName } from "./config.js";
import { verifySponsoredSwap, type VerifiedSwap } from "./verify.js";
import { acceptedTiers, admissionFloor, bumpFee, computeFee, lowestAdmissibleTier, tierCoversFloor } from "./fee.js";
import type { ChainNonces } from "./nonce.js";
import type { PendingRecord, RelayStore } from "./store.js";
export type { PendingRecord } from "./store.js";

export interface RelayChain {
  getSbtcBalance(address: string): Promise<bigint>;
  getNonces(address: string): Promise<ChainNonces>;
  quotePool(poolId: number, netSats: number | bigint): Promise<{ out: bigint; in: bigint }>;
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

  // policy: does this operator sponsor this tier at all (a setting, not an estimate)
  if (!acceptedTiers(d.policy.minTier).includes(v.tierName)) {
    throw new RelayError("TIER_BELOW_MIN", `tier ${v.tierName} below this relay's minimum ${d.policy.minTier}`, 409);
  }
  // rate limits, checked before any chain read the request could trigger
  const now = d.now();
  if (!(await d.store.rateLimit(`origin:${v.origin}`, d.policy.perOriginPerHour, now))) throw new RelayError("RATE_LIMITED", `more than ${d.policy.perOriginPerHour} requests per hour from ${v.origin}`, 429);
  if (!(await d.store.rateLimit("global", d.policy.globalPerHour, now))) throw new RelayError("RATE_LIMITED", "relay hourly capacity reached", 429);

  // one sponsored transaction per origin nonce. The chain's view of the origin lags a broadcast by
  // seconds, so a second submission in that window (double click, retry after a timeout) would pass
  // the nonce check below and end up as a twin at the same sponsor nonce. The reservation is the
  // relay's own memory of what it has in flight; it is released on any failure and when the sweep
  // sees the origin nonce executed.
  if (!(await d.store.reserveOriginNonce(v.origin, v.originNonce, now))) {
    const r = await d.store.getOriginReservation(v.origin, v.originNonce, now);
    throw new RelayError("ORIGIN_NONCE_IN_FLIGHT", r?.txid
      ? `nonce ${v.originNonce} of ${v.origin} is already sponsored and pending as ${r.txid}`
      : `nonce ${v.originNonce} of ${v.origin} is being sponsored by another request right now`, 409);
  }
  try {
    return await sponsorReserved(v, txHex, key, d, now);
  } catch (e) {
    await d.store.releaseOriginNonce(v.origin, v.originNonce);
    throw e;
  }
}

async function sponsorReserved(v: VerifiedSwap, txHex: string, key: SponsorKey, d: RelayDeps, now: number): Promise<SponsorResult> {
  // preflight: everything that would make the sponsor pay for an abort
  const balance = await d.chain.getSbtcBalance(v.origin);
  if (balance < v.amount) throw new RelayError("INSUFFICIENT_SBTC", `${v.origin} holds ${balance} sats, swap needs ${v.amount}`);
  const userNonces = await d.chain.getNonces(v.origin);
  if (BigInt(userNonces.possibleNext) !== v.originNonce) throw new RelayError("BAD_NONCE", `origin nonce ${v.originNonce}, chain expects ${userNonces.possibleNext}`, 409);
  const quote = await d.chain.quotePool(v.poolId, v.net);
  if (quote.out < v.minOut) throw new RelayError("QUOTE_BELOW_MIN_OUT", `pool ${v.poolId} now quotes ${quote.out} uSTX, below min-out ${v.minOut}`, 409);

  const byteLength = v.byteLength + SPONSOR_SIG_BYTES;
  if (!tierCoversFloor(v.tierName, byteLength, d.policy.minFeePerByte)) {
    const next = lowestAdmissibleTier(byteLength, d.policy.minFeePerByte);
    throw new RelayError("TIER_TOO_SMALL", `a ${byteLength}-byte transaction needs at least ${admissionFloor(byteLength, d.policy.minFeePerByte)} uSTX to be admitted; the ${v.tierName} tier (${TIERS[v.tierName]}) cannot cover it${next ? `, choose ${next}` : ""}`);
  }
  const fee = computeFee({ tierName: v.tierName, openingBid: d.policy.openingBid, byteLength, minPerByte: d.policy.minFeePerByte });

  // take a sponsor nonce (atomic in the store), sign, broadcast; one reconcile-and-retry on a nonce conflict
  let attempt = 0;
  while (true) {
    const chainNonces = await d.chain.getNonces(key.address);
    const rec = await d.store.allocateNonce(key.address, chainNonces, d.policy.maxPendingPerKey);
    if (rec.nonce === null) throw new RelayError("SPONSOR_BUSY", `sponsor ${key.address} has ${rec.pending.length} pending transactions`, 503);
    const signed = await sponsorTransaction({ transaction: v.tx, sponsorPrivateKey: key.privateKey, fee, sponsorNonce: rec.nonce, network: "mainnet" });
    const hex = signed.serialize();
    const res = await d.chain.broadcast(hex);
    if ("txid" in res && res.txid) {
      await d.store.addPending({ txid: res.txid, tier: v.tierName, sponsor: key.address, sponsorNonce: rec.nonce, fee, originalTx: txHex, broadcastAt: now, bumps: 0, origin: v.origin, originNonce: v.originNonce });
      await d.store.confirmOriginNonce(v.origin, v.originNonce, res.txid);
      return { txid: res.txid, sponsoredTx: hex, fee: fee.toString(), tier: v.tierName, sponsor: key.address };
    }
    const reason = (res as any).reason as string;
    const nonceConflict = reason === "BadNonce" || reason === "ConflictingNonceInMempool";
    // give the nonce back; after a nonce conflict also forget the local counter so the chain view wins
    await d.store.releaseNonce(key.address, rec.nonce, nonceConflict);
    if (nonceConflict && attempt === 0) { attempt++; continue; }
    throw new RelayError("BROADCAST_FAILED", `node rejected the transaction: ${reason} ${JSON.stringify((res as any).reason_data ?? "")}`, 502);
  }
}

export interface RelayInfo {
  contract: string; network: "mainnet"; sponsors: Record<TierName, string>; minTier: TierName;
  // The opening bid per tier. Kept under this name for SDK compatibility; it is a policy, not an estimate.
  feeEstimate: Record<TierName, string>; maxPerOriginPerHour: number; termsUrl?: string; version: string;
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
  const feeEstimate = {} as Record<TierName, string>;
  const maxFee = {} as Record<TierName, string>;
  const pending = {} as Record<TierName, number>;
  for (const t of TIER_NAMES) {
    feeEstimate[t] = computeFee({ tierName: t, openingBid: d.policy.openingBid, byteLength: 616, minPerByte: d.policy.minFeePerByte }).toString();
    maxFee[t] = TIERS[t].toString();
    pending[t] = (await d.store.getNonceState(d.keys[t].address)).pending.length;
  }
  return {
    contract, network: "mainnet",
    sponsors: { low: d.keys.low.address, mid: d.keys.mid.address, high: d.keys.high.address },
    minTier: d.policy.minTier,
    feeEstimate, maxPerOriginPerHour: d.policy.perOriginPerHour, termsUrl, version: "0.2.0", pending,
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
    const n = nonces[r.sponsor];
    await d.store.settleNonces(r.sponsor, n?.lastExecuted ?? -1);
    if (r.origin && r.originNonce !== undefined) await d.store.releaseOriginNonce(r.origin, r.originNonce);
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
