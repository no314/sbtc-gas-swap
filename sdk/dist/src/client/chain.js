// Chain reads over the Stacks node RPC (/v2) with Hiro extended endpoints where the node has none.
// One gate: every request goes through `request()`, which spaces calls, retries with backoff,
// and never caches a failure. Fetch is injectable so tests and the relay can substitute.
import { Cl, cvToValue } from "@stacks/transactions";
import { CONTRACT, DLMM, SBTC, VELAR, XYK } from "../config.js";
export class ChainError extends Error {
    status;
    body;
    constructor(message, status, body) {
        super(message);
        this.status = status;
        this.body = body;
    }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export class ChainClient {
    baseUrl;
    f;
    apiKey;
    spacing;
    retries;
    sender;
    cacheBust;
    last = 0;
    constructor(o = {}) {
        this.baseUrl = (o.baseUrl ?? "https://api.hiro.so").replace(/\/$/, "");
        this.f = o.fetch ?? globalThis.fetch.bind(globalThis);
        this.apiKey = o.apiKey;
        this.spacing = o.minSpacingMs ?? 250;
        this.retries = o.retries ?? 2;
        this.sender = o.sender ?? CONTRACT.address;
        this.cacheBust = o.cacheBust ?? true;
    }
    async request(path, init = {}) {
        const wait = this.last + this.spacing - Date.now();
        if (wait > 0)
            await sleep(wait);
        let url = this.baseUrl + path;
        if (this.cacheBust && (!init.method || init.method === "GET"))
            url += (url.includes("?") ? "&" : "?") + `_=${Date.now()}`;
        const headers = { accept: "application/json", ...(init.headers ?? {}) };
        if (this.apiKey)
            headers["x-api-key"] = this.apiKey;
        let lastErr;
        for (let attempt = 0; attempt <= this.retries; attempt++) {
            this.last = Date.now();
            try {
                const res = await this.f(url, { ...init, headers });
                if (res.status === 429 || res.status >= 500) {
                    lastErr = new ChainError(`${res.status} from ${path}`, res.status, await res.text().catch(() => ""));
                    await sleep(1_000 * 2 ** attempt);
                    continue;
                }
                return res;
            }
            catch (e) {
                lastErr = e;
                await sleep(500 * 2 ** attempt);
            }
        }
        throw lastErr instanceof Error ? lastErr : new ChainError(String(lastErr));
    }
    async json(path, init) {
        const res = await this.request(path, init);
        const text = await res.text();
        if (!res.ok)
            throw new ChainError(`${res.status} from ${path}: ${text.slice(0, 200)}`, res.status, text);
        return JSON.parse(text);
    }
    // --- read-only calls
    async callRead(contract, fn, args, sender = this.sender) {
        const [addr, name] = contract.split(".");
        const body = JSON.stringify({ sender, arguments: args.map((a) => Cl.serialize(a)) });
        const r = await this.json(`/v2/contracts/call-read/${addr}/${name}/${fn}`, { method: "POST", headers: { "content-type": "application/json" }, body });
        if (!r.okay || !r.result)
            throw new ChainError(`call-read ${name}.${fn} failed: ${r.cause ?? "no result"}`);
        return Cl.deserialize(r.result);
    }
    async readXykState() {
        const v = unwrap(await this.callRead(XYK.pool, "get-pool", []));
        return {
            xBalance: big(v["x-balance"]), yBalance: big(v["y-balance"]),
            protocolFeeBips: big(v["x-protocol-fee"]), providerFeeBips: big(v["x-provider-fee"]),
            enabled: bool(v["pool-status"]),
        };
    }
    async readVelarState() {
        const pool = unwrap(await this.callRead(VELAR.pool, "get-pool", []));
        const fees = unwrap(await this.callRead(VELAR.fees, "get-fees", []));
        const swapFee = fees["swap-fee"].value;
        return { reserveStx: big(pool.reserve0), reserveSbtc: big(pool.reserve1), feeNum: big(swapFee.num), feeDen: big(swapFee.den) };
    }
    // Reads the active bin and `binsAhead` bins above it. Each bin is one call-read.
    async readDlmmState(binsAhead = 3) {
        const info = unwrap(await this.callRead(DLMM.pool, "get-pool-for-swap", [Cl.bool(false)]));
        const activeBinId = Number(big(info["active-bin-id"]));
        const binStep = big(info["bin-step"]);
        const initialPrice = big(info["initial-price"]);
        const feeBips = big(info["protocol-fee"]) + big(info["provider-fee"]) + big(info["variable-fee"]);
        const factorsCv = unwrap(await this.callRead(DLMM.core, "get-bin-factors-by-step", [Cl.uint(binStep)]));
        const factors = factorsCv.value.map((x) => BigInt(x.value));
        const bins = [];
        for (let id = activeBinId; id <= Math.min(activeBinId + binsAhead, 500); id++) {
            const unsigned = id + 500;
            const bal = unwrap(await this.callRead(DLMM.pool, "get-bin-balances", [Cl.uint(unsigned)]));
            const price = (initialPrice * factors[unsigned]) / 100000000n;
            bins.push({ binId: id, price, xBalance: big(bal["x-balance"]), yBalance: big(bal["y-balance"]) });
        }
        return { activeBinId, feeBips, bins };
    }
    async getSbtcBalance(address) {
        const v = await this.callRead(`${SBTC.address}.${SBTC.name}`, "get-balance", [Cl.principal(address)], address);
        return big(cvToValue(v));
    }
    async getStxBalance(address) {
        const r = await this.json(`/v2/accounts/${address}?proof=0`);
        return BigInt(r.balance);
    }
    // Hiro extended: mempool-aware nonces. Falls back to the node account nonce.
    async getNonces(address) {
        try {
            const r = await this.json(`/extended/v1/address/${address}/nonces`);
            return { lastExecuted: r.last_executed_tx_nonce, lastMempool: r.last_mempool_tx_nonce, possibleNext: r.possible_next_nonce, missing: r.detected_missing_nonces ?? [] };
        }
        catch {
            const r = await this.json(`/v2/accounts/${address}?proof=0`);
            return { lastExecuted: r.nonce - 1, lastMempool: null, possibleNext: r.nonce, missing: [] };
        }
    }
    async getContractSource(contract) {
        const [addr, name] = contract.split(".");
        const r = await this.json(`/v2/contracts/source/${addr}/${name}?proof=0`);
        return { source: r.source, publishHeight: r.publish_height };
    }
    async estimateFee(payloadHex, estimatedLen) {
        const res = await this.request(`/v2/fees/transaction`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ transaction_payload: payloadHex.replace(/^0x/, ""), estimated_len: estimatedLen }),
        });
        if (res.status === 400)
            return null; // NoEstimateAvailable for a contract the node has not seen
        const text = await res.text();
        if (!res.ok)
            throw new ChainError(`${res.status} from /v2/fees/transaction`, res.status, text);
        const r = JSON.parse(text);
        const [l, m, h] = r.estimations;
        return { low: BigInt(l.fee), mid: BigInt(m.fee), high: BigInt(h.fee) };
    }
    async broadcast(txHex) {
        const res = await this.request(`/v2/transactions`, {
            method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tx: txHex.replace(/^0x/, "") }),
        });
        const text = await res.text();
        if (res.ok)
            return { txid: text.replace(/"/g, "").replace(/^0x/, "") };
        try {
            return JSON.parse(text);
        }
        catch {
            return { error: "broadcast failed", reason: text };
        }
    }
    // Hiro extended tx view; null while the API has not indexed the txid yet.
    async getTransaction(txid) {
        const res = await this.request(`/extended/v1/tx/0x${txid.replace(/^0x/, "")}`);
        if (res.status === 404)
            return null;
        const text = await res.text();
        if (!res.ok)
            throw new ChainError(`${res.status} from /extended/v1/tx`, res.status, text);
        return JSON.parse(text);
    }
    async getInfo() {
        return this.json(`/v2/info`);
    }
}
// --- helpers: unwrap (ok ...) / tuples produced by cvToValue-like access on ClarityValues
function unwrap(cv) {
    const c = cv;
    if (c.type === "ok" || c.type === "err") {
        if (c.type === "err")
            throw new ChainError(`contract returned err ${JSON.stringify(cvToValue(c.value))}`);
        return unwrap(c.value);
    }
    if (c.type === "some")
        return unwrap(c.value);
    if (c.type === "tuple")
        return c.value;
    if (c.type === "list")
        return c;
    return c;
}
function big(cv) {
    if (typeof cv === "bigint")
        return cv;
    if (typeof cv === "string" || typeof cv === "number")
        return BigInt(cv);
    return BigInt(cv.value);
}
function bool(cv) { return cv.type === "true" || cv === true; }
//# sourceMappingURL=chain.js.map