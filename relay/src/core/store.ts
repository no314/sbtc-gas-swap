// State the relay must keep between requests: per-key nonces, pending sponsored txs (for RBF),
// and rate-limit counters. Interface plus an in-memory implementation; adapters provide KV and file.
import type { LocalNonceState } from "./nonce.js";
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
}

export interface RelayStore {
  getNonceState(address: string): Promise<LocalNonceState>;
  setNonceState(address: string, s: LocalNonceState): Promise<void>;
  // returns true when the request is allowed; counts the request when allowed
  rateLimit(key: string, limitPerHour: number, now: number): Promise<boolean>;
  addPending(r: PendingRecord): Promise<void>;
  listPending(): Promise<PendingRecord[]>;
  removePending(txid: string): Promise<void>;
  replacePending(oldTxid: string, r: PendingRecord): Promise<void>;
}

export class MemoryStore implements RelayStore {
  nonces = new Map<string, LocalNonceState>();
  pending = new Map<string, PendingRecord>();
  hits = new Map<string, number[]>();
  async getNonceState(a: string) { return this.nonces.get(a) ?? { next: null, pending: [] }; }
  async setNonceState(a: string, s: LocalNonceState) { this.nonces.set(a, s); }
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
