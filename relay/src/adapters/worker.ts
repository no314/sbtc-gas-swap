// Cloudflare Worker adapter. Secrets and settings come from the Worker environment; state lives in KV.
// Cron Trigger runs the RBF sweep. See docs/operator-guide.md.
import { executeRbf, type RelayDeps } from "../core/relay.js";
import { route } from "../core/http.js";
import { keysFromEnv, policyFromEnv, type RelayEnv } from "../core/env.js";
import { makeRelayChain } from "../chain/client.js";
import { decodeJson, encodeJson, type PendingRecord, type RelayStore } from "../core/store.js";
import type { LocalNonceState } from "../core/nonce.js";

interface Env extends RelayEnv { RELAY_KV: KVNamespace }

class KvStore implements RelayStore {
  constructor(private kv: KVNamespace) {}
  async getNonceState(a: string) { const s = await this.kv.get(`nonce:${a}`); return s ? decodeJson<LocalNonceState>(s) : { next: null, pending: [] }; }
  async setNonceState(a: string, s: LocalNonceState) { await this.kv.put(`nonce:${a}`, encodeJson(s)); }
  async rateLimit(key: string, limit: number, now: number) {
    const k = `rl:${key}`;
    const win = (decodeJson<number[]>((await this.kv.get(k)) ?? "[]")).filter((t) => now - t < 3_600_000);
    if (win.length >= limit) return false;
    win.push(now);
    await this.kv.put(k, encodeJson(win), { expirationTtl: 3_700 });
    return true;
  }
  async addPending(r: PendingRecord) { await this.kv.put(`pending:${r.txid}`, encodeJson(r), { expirationTtl: 3 * 24 * 3600 }); }
  async listPending() {
    const out: PendingRecord[] = [];
    let cursor: string | undefined;
    do {
      const l = await this.kv.list({ prefix: "pending:", cursor });
      for (const k of l.keys) { const v = await this.kv.get(k.name); if (v) out.push(decodeJson<PendingRecord>(v)); }
      cursor = l.list_complete ? undefined : l.cursor;
    } while (cursor);
    return out;
  }
  async removePending(txid: string) { await this.kv.delete(`pending:${txid}`); }
  async replacePending(oldTxid: string, r: PendingRecord) { await this.removePending(oldTxid); await this.addPending(r); }
}

function depsFor(env: Env): RelayDeps {
  return {
    chain: makeRelayChain({ baseUrl: env.STACKS_API_URL, apiKey: env.HIRO_API_KEY }),
    keys: keysFromEnv(env),
    store: new KvStore(env.RELAY_KV),
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
