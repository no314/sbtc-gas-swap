// State the relay must keep between requests: per-key nonces, pending sponsored txs (for RBF),
// in-flight origin nonces, and rate-limit counters. Interface plus an in-memory implementation;
// adapters provide Durable Objects (Worker) and a file (Node).
//
// Nonce allocation and the origin reservation are read-modify-write operations. They must be
// atomic per sponsor key, which rules out eventually consistent stores for them: two requests a
// second apart through Cloudflare KV both read the old counter and both sign the same nonce
// (observed 2026-09-30, two transactions at sponsor nonce 5, one of them lost). The interface
// therefore exposes `allocateNonce` and `reserveOriginNonce` as single operations, and the
// adapters route them to one writer.
import { reconcileNonce, type ChainNonces, type LocalNonceState, type Reconciled } from "./nonce.js";
import type { TierName } from "./config.js";

export interface PendingRecord {
  txid: string;
  tier: TierName;
  sponsor: string;
  sponsorNonce: bigint;
  fee: bigint;
  originalTx: string;     // the user-signed hex; re-sponsored on RBF
  broadcastAt: number;    // ms epoch
  bumps: number;
  origin?: string;
  originNonce?: bigint;
}

// A reservation without a txid is a request still running; one with a txid is a broadcast
// transaction. The first kind expires quickly, in case the request died between reserve and
// release; the second lives until the sweep sees the origin nonce executed, or the long TTL.
export interface OriginReservation { txid: string | null; at: number }
export const RESERVE_RUNNING_MS = 2 * 60_000;
export const RESERVE_BROADCAST_MS = 6 * 3_600_000;
export function reservationLive(r: OriginReservation | undefined, now: number): boolean {
  if (!r) return false;
  return now - r.at < (r.txid ? RESERVE_BROADCAST_MS : RESERVE_RUNNING_MS);
}

export interface RelayStore {
  getNonceState(address: string): Promise<LocalNonceState>;
  setNonceState(address: string, s: LocalNonceState): Promise<void>;
  // Atomic: reconcile the local counter with the chain view, take the next nonce, record it as
  // pending and advance the counter, all in one step. The caller releases it if the broadcast fails.
  allocateNonce(address: string, chain: ChainNonces, maxPending: number): Promise<Reconciled>;
  // Undo an allocation whose broadcast failed. `forget` also drops the local counter so the next
  // allocation starts from the chain view (used after BadNonce / ConflictingNonceInMempool).
  releaseNonce(address: string, nonce: bigint, forget: boolean): Promise<void>;
  // Atomic: drop pending nonces at or below the chain's last executed nonce.
  settleNonces(address: string, executedFloor: number): Promise<void>;
  // Atomic: true when no live reservation exists for this origin nonce; records one when true.
  reserveOriginNonce(origin: string, nonce: bigint, now: number): Promise<boolean>;
  // Attach the broadcast txid to a reservation (it then lives until the sweep releases it).
  confirmOriginNonce(origin: string, nonce: bigint, txid: string): Promise<void>;
  releaseOriginNonce(origin: string, nonce: bigint): Promise<void>;
  // Returns the live reservation for an origin nonce, if any (for the refusal message).
  getOriginReservation(origin: string, nonce: bigint, now: number): Promise<OriginReservation | null>;
  // returns true when the request is allowed; counts the request when allowed
  rateLimit(key: string, limitPerHour: number, now: number): Promise<boolean>;
  addPending(r: PendingRecord): Promise<void>;
  listPending(): Promise<PendingRecord[]>;
  removePending(txid: string): Promise<void>;
  replacePending(oldTxid: string, r: PendingRecord): Promise<void>;
}

export const originKey = (origin: string, nonce: bigint) => `${origin}:${nonce.toString()}`;

export class MemoryStore implements RelayStore {
  nonces = new Map<string, LocalNonceState>();
  pending = new Map<string, PendingRecord>();
  hits = new Map<string, number[]>();
  origins = new Map<string, OriginReservation>();
  async getNonceState(a: string) { return this.nonces.get(a) ?? { next: null, pending: [] }; }
  async setNonceState(a: string, s: LocalNonceState) { this.nonces.set(a, s); }
  async allocateNonce(a: string, chain: ChainNonces, maxPending: number) {
    const rec = reconcileNonce(await this.getNonceState(a), chain, maxPending);
    if (rec.nonce !== null) await this.setNonceState(a, { next: rec.nonce + 1n, pending: [...rec.pending, rec.nonce] });
    return rec;
  }
  async releaseNonce(a: string, nonce: bigint, forget: boolean) {
    const st = await this.getNonceState(a);
    const pending = st.pending.filter((n) => n !== nonce);
    const next = forget ? null : st.next === nonce + 1n ? nonce : st.next;
    await this.setNonceState(a, { next, pending });
  }
  async settleNonces(a: string, executedFloor: number) {
    const st = await this.getNonceState(a);
    await this.setNonceState(a, { ...st, pending: st.pending.filter((n) => n > BigInt(executedFloor)) });
  }
  async reserveOriginNonce(origin: string, nonce: bigint, now: number) {
    const k = originKey(origin, nonce);
    if (reservationLive(this.origins.get(k), now)) return false;
    this.origins.set(k, { txid: null, at: now });
    return true;
  }
  async confirmOriginNonce(origin: string, nonce: bigint, txid: string) {
    const k = originKey(origin, nonce);
    const r = this.origins.get(k);
    this.origins.set(k, { txid, at: r?.at ?? Date.now() });
  }
  async releaseOriginNonce(origin: string, nonce: bigint) { this.origins.delete(originKey(origin, nonce)); }
  async getOriginReservation(origin: string, nonce: bigint, now: number) {
    const r = this.origins.get(originKey(origin, nonce));
    return reservationLive(r, now) ? r! : null;
  }
  async rateLimit(key: string, limit: number, now: number) {
    const win = (this.hits.get(key) ?? []).filter((t) => now - t < 3_600_000);
    if (win.length >= limit) { this.hits.set(key, win); return false; }
    win.push(now); this.hits.set(key, win); return true;
  }
  async addPending(r: PendingRecord) { this.pending.set(r.txid, r); }
  async listPending() { return [...this.pending.values()]; }
  async removePending(txid: string) { this.pending.delete(txid); }
  async replacePending(oldTxid: string, r: PendingRecord) { this.pending.delete(oldTxid); this.pending.set(r.txid, r); }
}

// JSON codec for stores that keep strings (KV, files). BigInts as strings.
export function encodeJson(v: unknown): string {
  return JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? `${x.toString()}n` : x));
}
export function decodeJson<T>(s: string): T {
  return JSON.parse(s, (_k, x) => (typeof x === "string" && /^\d+n$/.test(x) ? BigInt(x.slice(0, -1)) : x)) as T;
}
