import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fakeNode } from "./helpers.js";
import { RelayClient } from "../src/relays.js";
import { SbtcGasSwapProvider, EXECUTION_TYPE } from "../src/leather/index.js";
const relayFetch = (async (url) => {
    if (url.endsWith("/v1/info"))
        return new Response(JSON.stringify({
            contract: "SP2BM6AQSMQ04CX8KDE62QBFVZTDZ2ZX80GZJSBZ4.sbtc-gas-swap-v1", network: "mainnet",
            sponsors: { low: "SP1", mid: "SP2", high: "SP3" }, minTier: "low", feeEstimate: { low: "3000", mid: "5000", high: "9000" },
            feeFactor: 1, maxPerOriginPerHour: 5, version: "0.1.0",
        }));
    return new Response("{}", { status: 404 });
});
const base = { providerId: "sbtc-gas-swap", providerAssetId: "sbtc", assetId: "sbtc" };
const target = { providerId: "sbtc-gas-swap", providerAssetId: "stx", assetId: "stx" };
describe("SbtcGasSwapProvider (Leather SwapProviderService shape)", () => {
    const provider = () => new SbtcGasSwapProvider({
        chain: fakeNode().client, relays: new RelayClient({ fetch: relayFetch, relays: ["https://relay.example"] }),
        integrator: "SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE", integratorBips: 100n,
    });
    test("offers sBTC as base and STX as the only target", async () => {
        const p = provider();
        assert.deepEqual(await p.getBaseProviderAssets(), [base]);
        assert.deepEqual(await p.getTargetProviderAssets({ baseProviderAsset: base }), [target]);
        assert.deepEqual(await p.getTargetProviderAssets({ baseProviderAsset: target }), []);
    });
    test("quotes a gas-size swap: low tier, target amount is output minus the rebate", async () => {
        const [q] = await provider().getSwapQuotes({ baseAsset: "sbtc", baseProviderAsset: base, targetAsset: "stx", targetProviderAsset: target, baseAmount: { amount: 30000n, decimals: 8, symbol: "sBTC" } });
        assert.equal(q.executionType, EXECUTION_TYPE);
        assert.equal(q.isExecutable, true);
        assert.equal(q.providerQuoteData.tier, "low");
        assert.equal(q.providerQuoteData.integratorFeeSats, "300");
        assert.equal(BigInt(q.providerQuoteData.quoteOutUstx) - 10000n, q.targetAmount.amount);
        assert.equal(q.providerQuoteData.relays.length, 1);
    });
    test("execution data is a sponsored deny-mode call with six args, three post-conditions and the relay list", async () => {
        const p = provider();
        const [q] = await p.getSwapQuotes({ baseAsset: "sbtc", baseProviderAsset: base, targetAsset: "stx", targetProviderAsset: target, baseAmount: { amount: 30000n, decimals: 8, symbol: "sBTC" } });
        const d = await p.getSwapExecutionData({ request: { stacksAddress: "SP227DXSVTHZZKF3B9N38G5GGG03N1Z4V86ZC3JVH" }, quote: q, slippagePercentage: 0 });
        assert.equal(d.sponsored, true);
        assert.equal(d.fee, 0);
        assert.equal(d.postConditionMode, "deny");
        assert.equal(d.functionArgs.length, 6);
        assert.equal(d.postConditions.length, 3);
        assert.equal(d.relays[0].url, "https://relay.example");
        assert.equal(d.tier.name, "low");
        assert.equal(BigInt(d.minOutUstx), (BigInt(q.providerQuoteData.quoteOutUstx) * 9000n) / 10000n);
    });
    test("a pair it does not serve yields no quotes", async () => {
        assert.deepEqual(await provider().getSwapQuotes({ baseAsset: "stx", baseProviderAsset: target, targetAsset: "sbtc", targetProviderAsset: base, baseAmount: { amount: 1n, decimals: 6, symbol: "STX" } }), []);
    });
});
//# sourceMappingURL=leather.test.js.map