// Node adapter for Docker or bare metal. Same core, state in one JSON file. Settings from the environment.
import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { executeRbf, type RelayDeps } from "../core/relay.js";
import { route } from "../core/http.js";
import { keysFromEnv, policyFromEnv } from "../core/env.js";
import { makeRelayChain } from "../chain/client.js";
import { decodeJson, encodeJson, MemoryStore } from "../core/store.js";

class FileStore extends MemoryStore {
  constructor(private path: string) {
    super();
    if (existsSync(path)) {
      const d = decodeJson<{ nonces: [string, any][]; pending: [string, any][]; hits: [string, number[]][] }>(readFileSync(path, "utf8"));
      this.nonces = new Map(d.nonces); this.pending = new Map(d.pending); this.hits = new Map(d.hits);
    }
  }
  private flush() {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, encodeJson({ nonces: [...this.nonces], pending: [...this.pending], hits: [...this.hits] }));
  }
  async setNonceState(a: string, s: any) { await super.setNonceState(a, s); this.flush(); }
  async rateLimit(k: string, l: number, n: number) { const r = await super.rateLimit(k, l, n); this.flush(); return r; }
  async addPending(r: any) { await super.addPending(r); this.flush(); }
  async removePending(t: string) { await super.removePending(t); this.flush(); }
  async replacePending(o: string, r: any) { await super.replacePending(o, r); this.flush(); }
}

const env = process.env as Record<string, string | undefined>;
const deps: RelayDeps = {
  chain: makeRelayChain({ baseUrl: env.STACKS_API_URL, apiKey: env.HIRO_API_KEY }),
  keys: keysFromEnv(env),
  store: new FileStore(env.STATE_FILE ?? "./state/relay-state.json"),
  policy: policyFromEnv(env),
  now: () => Date.now(),
};
const opts = { contractId: env.CONTRACT_ID ?? "SP2BM6AQSMQ04CX8KDE62QBFVZTDZ2ZX80GZJSBZ4.sbtc-gas-swap-v1", termsUrl: env.TERMS_URL };
const port = Number(env.PORT ?? 8787);

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = Buffer.concat(chunks);
  const request = new Request(`http://localhost${req.url}`, { method: req.method, headers: req.headers as any, body: body.length ? body : undefined });
  const response = await route(request, deps, opts);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, () => console.log(`sbtc-gas-relay listening on ${port}`));

setInterval(() => executeRbf(deps).then((r) => console.log("rbf sweep", JSON.stringify(r))).catch((e) => console.error("rbf", e)), 10 * 60_000);
