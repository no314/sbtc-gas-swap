// Pure domain helpers, tests first (static-first-architecture). No DOM, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseAmount, fmtSats, fmtBtc, fmtStx, fmtUstx, fmtBoth, pctToBips, bipsToPct, parseSlippagePct,
  parseReceived, parseSwapResult, parseSwapInput, ledgerLines, txOutcome, shortTxid, shortPrincipal, fmtBips, fmtStamp,
  originNonceFromHex, swapTxs,
} from "../src/amounts.js";
import { createRequire } from "node:module";
// @stacks/transactions is the SDK's dependency; the app only vendors a browser bundle of it.
const { makeContractCall, PostConditionMode, Cl, deserializeTransaction } = createRequire(new URL("../../sdk/package.json", import.meta.url))("@stacks/transactions");

test("parseAmount: sats accept digits with grouping, reject fractions and zero", () => {
  assert.deepEqual(parseAmount("5000", "sats"), { sats: 5000n });
  assert.deepEqual(parseAmount("5,000", "sats"), { sats: 5000n });
  assert.deepEqual(parseAmount(" 30 ", "sats"), { sats: 30n });
  assert.equal(parseAmount("0", "sats").error, "The swap amount must be above zero.");
  assert.equal(parseAmount("12.5", "sats").error, "Sats are whole numbers; switch the unit to BTC for fractions.");
  assert.equal(parseAmount("", "sats").error, null);
  assert.equal(parseAmount("abc", "sats").error, "Enter a number.");
});

test("parseAmount: BTC accepts up to 8 decimals and converts exactly", () => {
  assert.deepEqual(parseAmount("0.00005", "btc"), { sats: 5000n });
  assert.deepEqual(parseAmount("0.00000001", "btc"), { sats: 1n });
  assert.deepEqual(parseAmount("1", "btc"), { sats: 100_000_000n });
  assert.deepEqual(parseAmount("0.1", "btc"), { sats: 10_000_000n });
  assert.deepEqual(parseAmount(".5", "btc"), { sats: 50_000_000n });
  assert.equal(parseAmount("0.000000001", "btc").error, "BTC has at most 8 decimals.");
  assert.equal(parseAmount("0", "btc").error, "The swap amount must be above zero.");
});

test("formatting shows both units, mono-ready strings, no em dash", () => {
  assert.equal(fmtSats(5000n), "5,000 sats");
  assert.equal(fmtBtc(5000n), "0.00005000 BTC");
  assert.equal(fmtBtc(123_456_789n), "1.23456789 BTC");
  assert.equal(fmtBoth(5000n), "5,000 sats (0.00005000 BTC)");
  assert.equal(fmtStx(15_236_789n), "15.236789 STX");
  assert.equal(fmtStx(10_000n), "0.01 STX");
  assert.equal(fmtStx(1_000_000n), "1 STX");
  assert.equal(fmtUstx(15_236_789n), "15,236,789 uSTX");
  assert.equal(fmtBips(50n), "0.5%");
  assert.equal(fmtBips(1000n), "10%");
  assert.equal(fmtBips(7n), "0.07%");
  assert.equal(fmtStamp(new Date(2026, 8, 5, 14, 3, 9)), "14:03:09");
});

test("slippage: percent text to bips within 0.1 to 99 percent", () => {
  assert.equal(parseSlippagePct("10"), 1000n);
  assert.equal(parseSlippagePct("1"), 100n);
  assert.equal(parseSlippagePct("2.5"), 250n);
  assert.equal(parseSlippagePct("0.1"), 10n);
  assert.equal(parseSlippagePct("99"), 9900n);
  assert.equal(parseSlippagePct("0.05"), null);
  assert.equal(parseSlippagePct("0"), null);
  assert.equal(parseSlippagePct("99.5"), null);
  assert.equal(parseSlippagePct("100"), null);
  assert.equal(parseSlippagePct("1.234"), null);
  assert.equal(parseSlippagePct("x"), null);
  assert.equal(pctToBips("2"), 200n);
  assert.equal(bipsToPct(1000n), "10");
  assert.equal(bipsToPct(250n), "2.5");
  assert.equal(bipsToPct(10n), "0.1");
});

test("parseReceived reads the received field of the contract's ok tuple", () => {
  const repr = "(ok (tuple (integrator-fee u0) (pool-id u1) (rebate u10000) (received u15236789) (service-fee u25)))";
  assert.equal(parseReceived(repr), 15_236_789n);
  assert.equal(parseReceived("(err u1020)"), null);
  assert.equal(parseReceived(undefined), null);
});

test("txOutcome classifies pending, success and aborts without inventing zeros", () => {
  assert.deepEqual(txOutcome(null), { kind: "pending" });
  assert.deepEqual(txOutcome({ tx_status: "pending" }), { kind: "pending" });
  const ok = txOutcome({ tx_status: "success", block_height: 8923990, tx_result: { repr: "(ok (tuple (received u15236789) (rebate u10000)))" } });
  assert.equal(ok.kind, "success"); assert.equal(ok.received, 15_236_789n); assert.equal(ok.blockHeight, 8923990);
  const okNoParse = txOutcome({ tx_status: "success", block_height: 1, tx_result: { repr: "(ok true)" } });
  assert.equal(okNoParse.kind, "success"); assert.equal(okNoParse.received, null); assert.equal(okNoParse.result, null);
  const abort = txOutcome({ tx_status: "abort_by_response", tx_result: { repr: "(err u1020)" } });
  assert.deepEqual(abort, { kind: "abort", status: "abort_by_response", repr: "(err u1020)" });
  const dropped = txOutcome({ tx_status: "dropped_replace_by_fee" });
  assert.deepEqual(dropped, { kind: "abort", status: "dropped_replace_by_fee", repr: undefined });
});

test("short forms keep the hex prefix and a plain ellipsis glyph", () => {
  const t = "ab".repeat(32);
  assert.equal(shortTxid(t), "0xabababababab…");
  assert.equal(shortTxid("0x" + t), "0xabababababab…");
  assert.equal(shortPrincipal("SP2BM6AQSMQ04CX8KDE62QBFVZTDZ2ZX80GZJSBZ4"), "SP2BM…SBZ4");
  assert.equal(shortPrincipal("SP2BM6AQSMQ04CX8KDE62QBFVZTDZ2ZX80GZJSBZ4.sbtc-gas-swap-v1"), "SP2BM…SBZ4.sbtc-gas-swap-v1");
});

// The mined result tuple, field order as the contract emits it. Every ledger figure comes from
// here or from the call's own arguments, never from the quote.
const MINED = "(ok (tuple (integrator-fee u10) (pool-id u1) (rebate u1000000) (received u2485366) (service-fee u5)))";

test("parseSwapResult reads all five fields of the ok tuple and refuses anything else", () => {
  assert.deepEqual(parseSwapResult(MINED), { received: 2_485_366n, rebate: 1_000_000n, serviceFee: 5n, integratorFee: 10n, poolId: 1n });
  assert.equal(parseSwapResult("(err u1020)"), null);
  assert.equal(parseSwapResult("(ok true)"), null);
  // a tuple missing a field is not this contract's result
  assert.equal(parseSwapResult("(ok (tuple (received u1) (rebate u2)))"), null);
});

test("parseSwapInput reads the sBTC amount from the call's first argument", () => {
  const tx = { contract_call: { function_name: "swap-sbtc-for-gas", function_args: [{ name: "amount", repr: "u1000", type: "uint" }, { name: "tier", repr: "u1000000" }] } };
  assert.equal(parseSwapInput(tx), 1000n);
  assert.equal(parseSwapInput({ contract_call: { function_args: [] } }), null);
  assert.equal(parseSwapInput({}), null);
});

test("ledgerLines lays out both ledgers so each column sums to its total", () => {
  const tx = { tx_status: "success", block_height: 9040558, tx_result: { repr: MINED }, contract_call: { function_args: [{ repr: "u1000" }] } };
  const o = txOutcome(tx);
  const L = ledgerLines(o);
  // sBTC side: input minus the two fees equals what went into the pool
  assert.deepEqual(L.sbtc.rows.map((r) => [r.label, r.sign, r.value]), [
    ["Swap amount", "", 1000n], ["Default provider fee", "-", 5n], ["Integrator fee (stx.fan)", "-", 10n],
  ]);
  assert.deepEqual(L.sbtc.total, { label: "Into the pool", value: 985n });
  assert.equal(L.sbtc.rows[0].value - L.sbtc.rows[1].value - L.sbtc.rows[2].value, L.sbtc.total.value);
  // STX side: from the pool minus the network fee equals what the user keeps
  assert.deepEqual(L.stx.rows.map((r) => [r.label, r.sign, r.value]), [
    ["From the pool", "", 2_485_366n], ["Network fee (sponsor)", "-", 1_000_000n],
  ]);
  assert.deepEqual(L.stx.total, { label: "You keep", value: 1_485_366n });
  assert.equal(L.stx.rows[0].value - L.stx.rows[1].value, L.stx.total.value);
});

test("ledgerLines is null when the result or the input did not parse", () => {
  assert.equal(ledgerLines(txOutcome({ tx_status: "success", block_height: 1, tx_result: { repr: "(ok true)" } })), null);
  assert.equal(ledgerLines(txOutcome({ tx_status: "pending" })), null);
  // result present but no call args (an unusual API answer): no ledger rather than a wrong one
  assert.equal(ledgerLines(txOutcome({ tx_status: "success", block_height: 1, tx_result: { repr: MINED } })), null);
});

test("originNonceFromHex: reads the origin nonce of a real sponsored call, with or without 0x", async () => {
  for (const nonce of [0n, 5n, 4_294_967_297n]) {
    const tx = await makeContractCall({
      contractAddress: "SP2BM6AQSMQ04CX8KDE62QBFVZTDZ2ZX80GZJSBZ4", contractName: "sbtc-gas-swap-v1", functionName: "swap-sbtc-for-gas",
      functionArgs: [Cl.uint(1000), Cl.uint(10000), Cl.uint(10000), Cl.uint(1), Cl.none(), Cl.uint(0)],
      postConditionMode: PostConditionMode.Deny, postConditions: [], sponsored: true, fee: 0n, nonce, network: "mainnet",
      senderKey: "7287ba251d44a4d3fd9276c88ce34c5c52a038955b4cf3de1a4f2b9f3d8b5b9101",
    });
    const hex = tx.serialize();
    assert.equal(originNonceFromHex(hex), nonce);
    assert.equal(originNonceFromHex("0x" + hex), nonce);
    assert.equal(BigInt(deserializeTransaction(hex).auth.spendingCondition.nonce), nonce);
  }
  assert.equal(originNonceFromHex("abcd"), null);
  assert.equal(originNonceFromHex(null), null);
});

test("swapTxs: the original txid, when mined, is the result", () => {
  const me = "SP16YF6XPB6RNBVJ6KJF28162XQMPJVAWWJYZD279";
  const t = { tx_id: "0x" + "aa".repeat(32), sender_address: me, nonce: 1, tx_status: "success", block_height: 10 };
  const r = swapTxs("aa".repeat(32), me, 1n, { direct: t });
  assert.equal(r.current, t); assert.equal(r.replaced, false); assert.equal(r.confirmedTwin, null); assert.deepEqual(r.pendingTwins, []);
});
test("swapTxs: a confirmed transaction at the same origin and nonce under another txid is the result; the original is kept and marked replaced", () => {
  const me = "SP16YF6XPB6RNBVJ6KJF28162XQMPJVAWWJYZD279";
  const twin = { tx_id: "0x" + "bb".repeat(32), sender_address: me, nonce: 1, tx_status: "success", block_height: 10 };
  const r = swapTxs("aa".repeat(32), me, 1n, { direct: null, addressTxs: [twin] });
  assert.equal(r.original, null); assert.equal(r.current, twin); assert.equal(r.replaced, true); assert.equal(r.confirmedTwin, twin);
  // the direct read may still be pending while the twin mined: the twin wins
  const pend = { tx_id: "0x" + "aa".repeat(32), sender_address: me, nonce: 1, tx_status: "pending" };
  const r2 = swapTxs("aa".repeat(32), me, 1n, { direct: pend, addressTxs: [twin] });
  assert.equal(r2.current, twin); assert.equal(r2.replaced, true); assert.equal(r2.original, pend);
});
test("swapTxs: another sender, another nonce, or an unknown origin never counts", () => {
  const me = "SP16YF6XPB6RNBVJ6KJF28162XQMPJVAWWJYZD279";
  const other = { tx_id: "0x" + "bb".repeat(32), sender_address: "SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE", nonce: 1, tx_status: "success", block_height: 10 };
  const otherNonce = { tx_id: "0x" + "cc".repeat(32), sender_address: me, nonce: 2, tx_status: "success", block_height: 10 };
  const r = swapTxs("aa".repeat(32), me, 1n, { addressTxs: [other, otherNonce] });
  assert.equal(r.current, null); assert.equal(r.replaced, false); assert.deepEqual(r.pendingTwins, []);
  const mine = { tx_id: "0x" + "bb".repeat(32), sender_address: me, nonce: 1, tx_status: "success", block_height: 10 };
  assert.equal(swapTxs("aa".repeat(32), null, null, { addressTxs: [mine] }).current, null);
});
test("swapTxs: twins still in the mempool are listed as pending; the status stays pending", () => {
  const me = "SP16YF6XPB6RNBVJ6KJF28162XQMPJVAWWJYZD279";
  const orig = { tx_id: "0x" + "aa".repeat(32), sender_address: me, nonce: 1, tx_status: "pending" };
  const twin = { tx_id: "0x" + "bb".repeat(32), sender_address: me, nonce: 1, tx_status: "pending" };
  const r = swapTxs("aa".repeat(32), me, 1n, { direct: orig, mempoolTxs: [orig, twin] });
  assert.equal(r.current, orig); assert.deepEqual(r.pendingTwins, [twin]); assert.equal(txOutcome(r.current).kind, "pending");
});
