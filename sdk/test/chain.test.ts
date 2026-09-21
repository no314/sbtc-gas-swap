import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { quoteAllPools } from "../src/quote/index.js";

import { fakeNode } from "./helpers.js";

describe("ChainClient reads", () => {
  test("XYK state", async () => {
    const { client } = fakeNode();
    const s = await client.readXykState();
    assert.equal(s.xBalance, 44_730_224n);
    assert.equal(s.providerFeeBips, 40n);
    assert.equal(s.enabled, true);
  });
  test("Velar state including the fee fraction", async () => {
    const { client } = fakeNode();
    const s = await client.readVelarState();
    assert.equal(s.reserveStx, 212_869_098_374n);
    assert.equal(s.feeNum, 9970n);
  });
  test("DLMM state: prices come from initial-price times the bin factor", async () => {
    const { client, calls } = fakeNode();
    const s = await client.readDlmmState(1);
    assert.equal(s.activeBinId, 340);
    assert.equal(s.feeBips, 50n);
    assert.equal(s.bins.length, 2);
    assert.equal(s.bins[0].price, (19_610n * 166_460_000n) / 100_000_000n);
    assert.equal(calls.filter((c) => c.includes("get-bin-balances")).length, 2);
  });
  test("sBTC balance, nonces, fee estimate, broadcast", async () => {
    const { client } = fakeNode();
    assert.equal(await client.getSbtcBalance("SP227DXSVTHZZKF3B9N38G5GGG03N1Z4V86ZC3JVH"), 123_456n);
    assert.equal((await client.getNonces("SP227DXSVTHZZKF3B9N38G5GGG03N1Z4V86ZC3JVH")).possibleNext, 5);
    assert.deepEqual(await client.estimateFee("00", 400), { low: 1000n, mid: 5000n, high: 9000n });
    const b = await client.broadcast("00");
    assert.equal((b as any).txid, "ab".repeat(32));
  });
  test("a call-read failure surfaces as an error, never as a zero", async () => {
    const { client } = fakeNode({ "xyk-pool-sbtc-stx-v-1-1/get-pool": () => ({ okay: false, cause: "Runtime(...)" }) });
    await assert.rejects(client.readXykState(), /call-read/);
  });
});

describe("quoteAllPools", () => {
  test("quotes every pool it can read and selects the best; a failed pool read is reported, not zeroed", async () => {
    const { client } = fakeNode({ "univ2-pool-v1_0_0-0070/get-pool": () => ({ okay: false, cause: "down" }) });
    const q = await quoteAllPools(client, { amountSats: 30_000n, integratorBips: 0n });
    assert.equal(q.fees.net, 29_850n);
    assert.equal(q.quotes.find((x) => x.poolId === 1)?.out, 90_692_795n); // net 29,850 sats through XYK
    assert.equal(q.unavailable.length, 1);
    assert.equal(q.unavailable[0].poolId, 2);
    assert.equal(q.best.poolId, 1); // DLMM excluded below 100 STX
  });
  test("DLMM wins for a large swap when it quotes best", async () => {
    const { client } = fakeNode();
    const q = await quoteAllPools(client, { amountSats: 100_000_000n, integratorBips: 0n });
    assert.equal(q.best.poolId, 3);
    assert.ok(q.best.out > 100_000_000n);
  });
});
