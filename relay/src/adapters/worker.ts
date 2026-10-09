// Cloudflare Worker adapter. Secrets and settings come from the Worker environment. State that
// must be consistent (sponsor nonces, pending records, in-flight origin nonces) lives in Durable
// Objects: one `TierState` instance per tier plus one named `origins`. Each instance is a single
// writer with strongly consistent storage, so two requests for the same tier are serialised and the
// second one sees the first one's write. KV is eventually consistent and keeps only the rate-limit
// windows, where a lost update costs nothing. Cron Trigger runs the RBF sweep. See docs/operator-guide.md.
import { DurableObject } from "cloudflare:workers";
import { executeRbf, type RelayDeps } from "../core/relay.js";
import { route } from "../core/http.js";
import { keysFromEnv, policyFromEnv, type RelayEnv } from "../core/env.js";
import { makeRelayChain } from "../chain/client.js";
import { TIER_NAMES, type TierName } from "../core/config.js";
import { decodeJson, encodeJson, originKey, reservationLive, type OriginReservation, type PendingRecord, type RelayStore } from "../core/store.js";
import { reconcileNonce, type ChainNonces, type LocalNonceState, type Reconciled } from "../core/nonce.js";

interface Env extends RelayEnv { RELAY_KV: KVNamespace; TIER_STATE: DurableObjectNamespace<TierState> }

// One instance per tier ("low", "mid", "high") holds that key's nonce state and pending records;
// the instance named "origins" holds the origin-nonce reservations for every tier, since a twin can
// arrive on a different tier than the first submission. Values cross the RPC boundary as the same
// JSON codec the stores use (bigints as "123n" strings).
export class TierState extends DurableObject<Env> {
  private async read<T>(key: string): Promise<T | undefined> {
    const s = await this.ctx.storage.get<string>(key);
    return s === undefined ? undefined : decodeJson<T>(s);
  }
  private async write(key: string, v: unknown) { await this.ctx.storage.put(key, encodeJson(v)); }

  // --- nonce state (one sponsor key per tier instance)
  async getNonceState(): Promise<string> { return encodeJson((await this.read<LocalNonceState>("nonce")) ?? { next: null, pending: [] }); }
  async setNonceState(s: string): Promise<void> { await this.write("nonce", decodeJson<LocalNonceState>(s)); }
  async allocateNonce(chainJson: string, maxPending: number): Promise<string> {
    const local = (await this.read<LocalNonceState>("nonce")) ?? { next: null, pending: [] };
    const rec = reconcileNonce(local, decodeJson<ChainNonces>(chainJson), maxPending);
    if (rec.nonce !== null) await this.write("nonce", { next: rec.nonce + 1n, pending: [...rec.pending, rec.nonce] });
    return encodeJson(rec);
  }
  async releaseNonce(nonceStr: string, forget: boolean): Promise<void> {
    const nonce = BigInt(nonceStr);
    const st = (await this.read<LocalNonceState>("nonce")) ?? { next: null, pending: [] };
    const pending = st.pending.filter((n) => n !== nonce);
    const next = forget ? null : st.next === nonce + 1n ? nonce : st.next;
    await this.write("nonce", { next, pending });
  }
  async settleNonces(executedFloor: number): Promise<void> {
    const st = (await this.read<LocalNonceState>("nonce")) ?? { next: null, pending: [] };
    await this.write("nonce", { ...st, pending: st.pending.filter((n) => n > BigInt(executedFloor)) });
  }

  // --- pending records
  async addPending(json: string): Promise<void> { const r = decodeJson<PendingRecord>(json); await this.write(`pending:${r.txid}`, r); }
  async listPending(): Promise<string[]> {
    const m = await this.ctx.storage.list<string>({ prefix: "pending:" });
    return [...m.values()];
  }
  async removePending(txid: string): Promise<void> { await this.ctx.storage.delete(`pending:${txid}`); }
  async replacePending(oldTxid: string, json: string): Promise<void> { await this.removePending(oldTxid); await this.addPending(json); }

  // --- origin reservations (the "origins" instance)
  async reserveOriginNonce(key: string, now: number): Promise<boolean> {
    const r = await this.read<OriginReservation>(`origin:${key}`);
    if (reservationLive(r, now)) return false;
    await this.write(`origin:${key}`, { txid: null, at: now } satisfies OriginReservation);
    return true;
  }
  async confirmOriginNonce(key: string, txid: string, now: number): Promise<void> {
    const r = await this.read<OriginReservation>(`origin:${key}`);
    await this.write(`origin:${key}`, { txid, at: r?.at ?? now } satisfies OriginReservation);
  }
  async releaseOriginNonce(key: string): Promise<void> { await this.ctx.storage.delete(`origin:${key}`); }
  async getOriginReservation(key: string, now: number): Promise<string | null> {
    const r = await this.read<OriginReservation>(`origin:${key}`);
    return reservationLive(r, now) ? encodeJson(r) : null;
  }
}

class DoStore implements RelayStore {
  private readonly tierOf: Record<string, TierName>;
  constructor(private env: Env, keys: Record<TierName, { address: string }>) {
    this.tierOf = Object.fromEntries(TIER_NAMES.map((t) => [keys[t].address, t]));
  }
  private tier(address: string): DurableObjectStub<TierState> {
    const t = this.tierOf[address];
    if (!t) throw new Error(`no tier for sponsor address ${address}`);
    return this.env.TIER_STATE.get(this.env.TIER_STATE.idFromName(t));
  }
  private origins(): DurableObjectStub<TierState> { return this.env.TIER_STATE.get(this.env.TIER_STATE.idFromName("origins")); }
  private all(): DurableObjectStub<TierState>[] { return TIER_NAMES.map((t) => this.env.TIER_STATE.get(this.env.TIER_STATE.idFromName(t))); }

  async getNonceState(a: string) { return decodeJson<LocalNonceState>(await this.tier(a).getNonceState()); }
  async setNonceState(a: string, s: LocalNonceState) { await this.tier(a).setNonceState(encodeJson(s)); }
  async allocateNonce(a: string, chain: ChainNonces, maxPending: number) { return decodeJson<Reconciled>(await this.tier(a).allocateNonce(encodeJson(chain), maxPending)); }
  async releaseNonce(a: string, nonce: bigint, forget: boolean) { await this.tier(a).releaseNonce(nonce.toString(), forget); }
  async settleNonces(a: string, executedFloor: number) { await this.tier(a).settleNonces(executedFloor); }
  async reserveOriginNonce(origin: string, nonce: bigint, now: number) { return this.origins().reserveOriginNonce(originKey(origin, nonce), now); }
  async confirmOriginNonce(origin: string, nonce: bigint, txid: string) { await this.origins().confirmOriginNonce(originKey(origin, nonce), txid, Date.now()); }
  async releaseOriginNonce(origin: string, nonce: bigint) { await this.origins().releaseOriginNonce(originKey(origin, nonce)); }
  async getOriginReservation(origin: string, nonce: bigint, now: number) {
    const s = await this.origins().getOriginReservation(originKey(origin, nonce), now);
    return s ? decodeJson<OriginReservation>(s) : null;
  }
  // rate limits stay in KV: a lost update under-counts by one request, which is acceptable
  async rateLimit(key: string, limit: number, now: number) {
    const k = `rl:${key}`;
    const win = (decodeJson<number[]>((await this.env.RELAY_KV.get(k)) ?? "[]")).filter((t) => now - t < 3_600_000);
    if (win.length >= limit) return false;
    win.push(now);
    await this.env.RELAY_KV.put(k, encodeJson(win), { expirationTtl: 3_600 });
    return true;
  }
  async addPending(r: PendingRecord) { await this.tier(r.sponsor).addPending(encodeJson(r)); }
  async listPending() {
    const out: PendingRecord[] = [];
    for (const stub of this.all()) for (const s of await stub.listPending()) out.push(decodeJson<PendingRecord>(s));
    return out;
  }
  async removePending(txid: string) { for (const stub of this.all()) await stub.removePending(txid); }
  async replacePending(oldTxid: string, r: PendingRecord) { await this.removePending(oldTxid); await this.addPending(r); }
}

function depsFor(env: Env): RelayDeps {
  const keys = keysFromEnv(env);
  return {
    chain: makeRelayChain({ baseUrl: env.STACKS_API_URL, apiKey: env.HIRO_API_KEY }),
    keys,
    store: new DoStore(env, keys),
    policy: policyFromEnv(env),
    now: () => Date.now(),
  };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    return route(req, depsFor(env), { contractId: env.CONTRACT_ID ?? "SP2BM6AQSMQ04CX8KDE62QBFVZTDZ2ZX80GZJSBZ4.sbtc-gas-swap-v1", termsUrl: env.TERMS_URL });
  },
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(executeRbf(depsFor(env)).then((r) => console.log("rbf sweep", JSON.stringify(r))));
  },
};
