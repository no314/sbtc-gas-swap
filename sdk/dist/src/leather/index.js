// Leather swap provider for sponsored sBTC to STX gas swaps. Mirrors the SwapProviderService
// contract of leather-io/mono PR #2554; see types.ts for what is mirrored and what is proposed.
import { ChainClient } from "../client/chain.js";
import { RelayClient } from "../relays.js";
import { quoteAllPools } from "../quote/index.js";
import { defaultSlippageBips, defaultTier } from "../defaults.js";
import { buildSwapCall } from "../build.js";
import { TIERS } from "../config.js";
export * from "./types.js";
export const PROVIDER_ID = "sbtc-gas-swap";
export const EXECUTION_TYPE = "sponsored-stacks-contract-call";
export class SbtcGasSwapProvider {
    providerId = PROVIDER_ID;
    chain;
    relays;
    integrator;
    integratorBips;
    ids;
    constructor(o = {}) {
        this.chain = o.chain ?? new ChainClient();
        this.relays = o.relays ?? new RelayClient();
        this.integrator = o.integrator;
        this.integratorBips = o.integratorBips ?? 0n;
        this.ids = o.assetIds ?? { sbtc: "sbtc", stx: "stx" };
    }
    async getBaseProviderAssets() {
        return [{ providerId: PROVIDER_ID, providerAssetId: "sbtc", assetId: this.ids.sbtc }];
    }
    async getTargetProviderAssets(p) {
        if (p.baseProviderAsset.assetId !== this.ids.sbtc)
            return [];
        return [{ providerId: PROVIDER_ID, providerAssetId: "stx", assetId: this.ids.stx }];
    }
    async getSwapQuotes(p) {
        if (p.baseAsset !== this.ids.sbtc || p.targetAsset !== this.ids.stx)
            return [];
        const amountSats = p.baseAmount.amount;
        if (amountSats <= 0n)
            return [];
        const [q, candidates] = await Promise.all([
            quoteAllPools(this.chain, { amountSats, integratorBips: this.integrator ? this.integratorBips : 0n }),
            this.relays.discover(),
        ]);
        const live = candidates.flatMap((c) => (c.info ? [c.info] : []));
        const minTier = lowestMinTier(live);
        const tier = defaultTier(amountSats, { minTier });
        const relays = RelayClient.rank(candidates, tier);
        const tierUstx = TIERS[tier];
        const constraints = [];
        if (relays.length === 0)
            constraints.push({ kind: "no-sponsor", message: "no relay accepts this tier right now" });
        if (q.best.out <= tierUstx)
            constraints.push({ kind: "amount-too-small", message: "output does not cover the sponsor rebate" });
        return [{
                executionType: EXECUTION_TYPE,
                providerId: PROVIDER_ID,
                baseAsset: p.baseAsset,
                targetAsset: p.targetAsset,
                baseAmount: p.baseAmount,
                targetAmount: { amount: q.best.out > tierUstx ? q.best.out - tierUstx : 0n, decimals: 6, symbol: "STX" },
                dexPath: [poolProtocol(q.best.poolId)],
                assetPath: [p.baseAsset, p.targetAsset],
                isExecutable: constraints.length === 0,
                executionConstraints: constraints,
                createdAt: q.readAt,
                providerQuoteData: {
                    poolId: q.best.poolId, tier, tierUstx: tierUstx.toString(),
                    quoteOutUstx: q.best.out.toString(), userReceivesUstx: (q.best.out - tierUstx).toString(),
                    serviceFeeSats: q.fees.serviceFee.toString(), integratorFeeSats: q.fees.integratorFee.toString(), netSats: q.fees.net.toString(),
                    relays, readAt: q.readAt,
                },
            }];
    }
    async getSwapExecutionData(p) {
        const d = p.quote.providerQuoteData;
        const amountSats = p.quote.baseAmount.amount;
        const slippageBips = p.slippagePercentage > 0 ? BigInt(Math.round(p.slippagePercentage * 100)) : defaultSlippageBips(amountSats);
        const call = buildSwapCall({
            user: p.request.stacksAddress, amountSats, tier: d.tier, poolId: d.poolId, quoteOut: BigInt(d.quoteOutUstx),
            slippageBips, integrator: this.integrator, integratorBips: this.integrator ? this.integratorBips : 0n,
        });
        const [contractAddress, contractName] = call.contract.split(".");
        return {
            executionType: EXECUTION_TYPE,
            providerId: PROVIDER_ID,
            contractAddress, contractName,
            functionName: call.functionName,
            functionArgs: call.functionArgs,
            postConditions: call.postConditions,
            postConditionMode: "deny",
            sponsored: true,
            fee: 0,
            relays: d.relays.map((r) => ({ url: r.url, sponsor: r.sponsors[d.tier], minTier: r.minTier })),
            tier: { name: d.tier, ustx: d.tierUstx },
            fees: { serviceFeeSats: call.fees.serviceFee.toString(), integratorFeeSats: call.fees.integratorFee.toString(), netSats: call.fees.net.toString() },
            minOutUstx: call.minOut.toString(),
            poolId: d.poolId,
        };
    }
    // What the execution strategy does after the wallet signed: POST to relays in order.
    async submitSigned(signedTxHex, relays) {
        return this.relays.submit(signedTxHex, relays);
    }
}
function lowestMinTier(relays) {
    const order = ["low", "mid", "high"];
    let best = "high";
    for (const r of relays)
        if (order.indexOf(r.minTier) < order.indexOf(best))
            best = r.minTier;
    return relays.length ? best : "low";
}
function poolProtocol(poolId) {
    return poolId === 2 ? "velar" : "bitflow";
}
//# sourceMappingURL=index.js.map