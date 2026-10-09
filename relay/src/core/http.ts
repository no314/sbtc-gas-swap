// Framework-free HTTP handling shared by the Worker and Node adapters.
import { RelayError } from "./config.js";
import { ChainError } from "@no314/sbtc-gas-swap";
import { buildInfo, handleSponsor, type RelayDeps } from "./relay.js";

const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...CORS } });

export async function route(req: Request, deps: RelayDeps, opts: { contractId: string; termsUrl?: string }): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  try {
    if (req.method === "GET" && url.pathname === "/healthz") return json({ ok: true });
    if (req.method === "GET" && url.pathname === "/v1/info") return json(await buildInfo(deps, opts.contractId, opts.termsUrl));
    if (req.method === "POST" && url.pathname === "/v1/sponsor") {
      let body: { tx?: unknown };
      try { body = (await req.json()) as { tx?: unknown }; } catch { throw new RelayError("MALFORMED", "body must be JSON {\"tx\": hex}"); }
      if (typeof body.tx !== "string" || body.tx.length > 200_000) throw new RelayError("MALFORMED", "tx must be a hex string");
      return json(await handleSponsor(body.tx, deps));
    }
    return json({ code: "NOT_FOUND", message: `${req.method} ${url.pathname}` }, 404);
  } catch (e) {
    if (e instanceof RelayError) return json({ code: e.code, message: e.message }, e.status);
    if (e instanceof ChainError && e.status === 429) {
      // The chain API refused the relay's own reads (2026-09-29: every INTERNAL was this). A relay
      // condition, not a verdict on the transaction: the SDK moves on or retries.
      console.error("relay UPSTREAM_RATE_LIMITED", e.message, (e.body ?? "").slice(0, 300));
      return json({ code: "UPSTREAM_RATE_LIMITED", message: `the chain API rate-limited the relay: ${e.message}` }, 503);
    }
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.error("relay INTERNAL", msg, e instanceof Error ? e.stack : "", e instanceof ChainError ? (e.body ?? "").slice(0, 300) : "");
    // The message names the failing step (a chain read, KV, signing); it never contains key material.
    return json({ code: "INTERNAL", message: `internal error: ${msg}`.slice(0, 500) }, 500);
  }
}
