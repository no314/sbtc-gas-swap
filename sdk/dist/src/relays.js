// Sponsor relay discovery and submission. Relays are independent operators running relay/ from
// this repo; the static list at docs/sponsors.json is the seed, each relay's /v1/info is the truth.
import { TIER_NAMES } from "./config.js";
export const DEFAULT_SPONSORS_URL = "https://stackslabs.github.io/sbtc-gas-swap/sponsors.json";
export class RelayClient {
    f;
    sponsorsUrl;
    fixed;
    timeoutMs;
    constructor(o = {}) {
        this.f = o.fetch ?? globalThis.fetch.bind(globalThis);
        this.sponsorsUrl = o.sponsorsUrl ?? DEFAULT_SPONSORS_URL;
        this.fixed = o.relays;
        this.timeoutMs = o.timeoutMs ?? 8_000;
    }
    async get(url, init) {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
        try {
            const res = await this.f(url, { ...init, signal: ctrl.signal });
            const text = await res.text();
            if (!res.ok)
                throw Object.assign(new Error(`${res.status} from ${url}`), { status: res.status, body: text });
            return JSON.parse(text);
        }
        finally {
            clearTimeout(t);
        }
    }
    async listUrls() {
        if (this.fixed)
            return this.fixed;
        const r = await this.get(this.sponsorsUrl + `?_=${Date.now()}`);
        return r.relays.map((x) => x.url.replace(/\/$/, ""));
    }
    // Every known relay with its live info; failures are kept so the UI can say which is down.
    async discover() {
        const urls = await this.listUrls();
        return Promise.all(urls.map(async (url) => {
            try {
                const info = await this.get(`${url}/v1/info`);
                return { url, info: { ...info, url } };
            }
            catch (e) {
                return { url, error: e.message };
            }
        }));
    }
    // Relays that accept `tier`, best first: lowest minTier, then lowest quoted fee for the tier.
    static rank(candidates, tier) {
        const rank = (t) => TIER_NAMES.indexOf(t);
        return candidates
            .flatMap((c) => (c.info ? [c.info] : []))
            .filter((i) => rank(i.minTier) <= rank(tier))
            .sort((a, b) => rank(a.minTier) - rank(b.minTier) || Number(BigInt(a.feeEstimate[tier] ?? 0) - BigInt(b.feeEstimate[tier] ?? 0)));
    }
    // POST the user-signed hex to relays in order until one accepts.
    async submit(signedTxHex, relays) {
        const attempts = [];
        for (const r of relays) {
            try {
                const res = await this.get(`${r.url}/v1/sponsor`, {
                    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tx: signedTxHex }),
                });
                return { ok: true, txid: res.txid, relay: r.url, fee: res.fee, tier: res.tier, sponsor: res.sponsor, sponsoredTx: res.sponsoredTx };
            }
            catch (e) {
                const body = e.body;
                let code = "RELAY_UNREACHABLE", message = e.message;
                if (body) {
                    try {
                        const j = JSON.parse(body);
                        code = j.code ?? code;
                        message = j.message ?? message;
                    }
                    catch {
                        message = body.slice(0, 200);
                    }
                }
                attempts.push({ relay: r.url, code, message });
                // A verdict about the transaction itself is final; another relay will say the same.
                if (FINAL_CODES.has(code))
                    break;
            }
        }
        return { ok: false, attempts };
    }
}
const FINAL_CODES = new Set(["NOT_SPONSORED_AUTH", "WRONG_NETWORK", "WRONG_CONTRACT", "WRONG_FUNCTION", "BAD_ARGS", "UNKNOWN_POOL", "BAD_TIER", "MIN_OUT_BELOW_TIER", "BAD_BIPS", "BAD_POST_CONDITIONS", "INSUFFICIENT_SBTC", "MALFORMED"]);
//# sourceMappingURL=relays.js.map