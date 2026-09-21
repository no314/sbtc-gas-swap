import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { reconcileNonce, type ChainNonces, type LocalNonceState } from "../src/core/nonce.js";

const chain = (o: Partial<ChainNonces> = {}): ChainNonces => ({
  lastExecuted: 9, lastMempool: 12, possibleNext: 13, missing: [], ...o,
});

describe("reconcileNonce", () => {
  test("fresh key: takes the chain's next nonce", () => {
    const r = reconcileNonce({ next: null, pending: [] }, chain(), 20);
    assert.equal(r.nonce, 13n);
  });
  test("local counter ahead of chain view: keeps local (Hiro lags a broadcast by seconds)", () => {
    const r = reconcileNonce({ next: 15n, pending: [13n, 14n] }, chain(), 20);
    assert.equal(r.nonce, 15n);
  });
  test("chain ahead of local (another operator instance used the key): jumps forward", () => {
    const r = reconcileNonce({ next: 11n, pending: [] }, chain(), 20);
    assert.equal(r.nonce, 13n);
  });
  test("a gap reported by the API is filled first", () => {
    const r = reconcileNonce({ next: 15n, pending: [] }, chain({ missing: [11] }), 20);
    assert.equal(r.nonce, 11n);
    assert.equal(r.fillingGap, true);
  });
  test("pending list is pruned below lastExecuted", () => {
    const r = reconcileNonce({ next: 15n, pending: [5n, 9n, 13n, 14n] }, chain(), 20);
    assert.deepEqual(r.pending, [13n, 14n]);
  });
  test("refuses when pending count reaches the cap", () => {
    const pending = Array.from({ length: 20 }, (_, i) => 13n + BigInt(i));
    const r = reconcileNonce({ next: 33n, pending }, chain({ lastMempool: 32, possibleNext: 33 }), 20);
    assert.equal(r.nonce, null);
    assert.equal(r.reason, "SPONSOR_BUSY");
  });
  test("after a BadNonce the caller re-reconciles with fresh chain data", () => {
    const r = reconcileNonce({ next: 13n, pending: [] }, chain({ lastExecuted: 13, lastMempool: 13, possibleNext: 14 }), 20);
    assert.equal(r.nonce, 14n);
  });
});
