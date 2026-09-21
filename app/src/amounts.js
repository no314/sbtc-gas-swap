// Pure amount, slippage and transaction-result helpers. No DOM, no network, so the same
// file runs in Node (test/amounts.test.mjs) and in the page. Glossary terms (PROMPT.md
// section 2) are used verbatim: swap amount, tier, network fee, default provider fee,
// integrator fee, net input, quote, min-out, slippage. The contract's own field names stay
// as deployed: rebate, service-fee, integrator-fee.

const SATS_PER_BTC = 100_000_000n;
const USTX_PER_STX = 1_000_000n;

// Text plus unit ("sats" | "btc") to sats. Returns { sats } or { error } (error null when empty).
export function parseAmount(text, unit) {
  const t = String(text ?? "").trim().replace(/,/g, "");
  if (t === "") return { error: null };
  if (unit === "sats") {
    if (/^\d+\.\d+$/.test(t)) return { error: "Sats are whole numbers; switch the unit to BTC for fractions." };
    if (!/^\d+$/.test(t)) return { error: "Enter a number." };
    const sats = BigInt(t);
    if (sats === 0n) return { error: "The swap amount must be above zero." };
    return { sats };
  }
  if (!/^(\d+)?(\.\d+)?$/.test(t) || t === ".") return { error: "Enter a number." };
  const [whole = "0", frac = ""] = t.split(".");
  if (frac.length > 8) return { error: "BTC has at most 8 decimals." };
  const sats = BigInt(whole || "0") * SATS_PER_BTC + BigInt((frac + "00000000").slice(0, 8));
  if (sats === 0n) return { error: "The swap amount must be above zero." };
  return { sats };
}

const group = (n) => BigInt(n).toLocaleString("en-US");

export const fmtSats = (sats) => `${group(sats)} sats`;
export function fmtBtc(sats) {
  const s = BigInt(sats);
  const whole = s / SATS_PER_BTC, frac = s % SATS_PER_BTC;
  return `${whole}.${frac.toString().padStart(8, "0")} BTC`;
}
export const fmtBoth = (sats) => `${fmtSats(sats)} (${fmtBtc(sats)})`;
export function fmtStx(ustx) {
  const u = BigInt(ustx);
  const whole = u / USTX_PER_STX, frac = u % USTX_PER_STX;
  const f = frac.toString().padStart(6, "0").replace(/0+$/, "");
  return `${group(whole)}${f ? "." + f : ""} STX`;
}
export const fmtUstx = (ustx) => `${group(ustx)} uSTX`;
export const fmtStxBoth = (ustx) => `${fmtStx(ustx)} (${fmtUstx(ustx)})`;
export function fmtBips(bips) {
  const b = BigInt(bips);
  const whole = b / 100n, frac = b % 100n;
  const f = frac.toString().padStart(2, "0").replace(/0+$/, "");
  return `${whole}${f ? "." + f : ""}%`;
}
export const fmtStamp = (d) => [d.getHours(), d.getMinutes(), d.getSeconds()].map((x) => String(x).padStart(2, "0")).join(":");

// Slippage is entered in percent with at most two decimals, 0.1 to 99 percent.
export function parseSlippagePct(text) {
  const t = String(text ?? "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const bips = pctToBips(t);
  if (bips < 10n || bips > 9900n) return null;
  return bips;
}
export function pctToBips(text) {
  const [whole = "0", frac = ""] = String(text).split(".");
  return BigInt(whole || "0") * 100n + BigInt((frac + "00").slice(0, 2));
}
export const bipsToPct = (bips) => fmtBips(bips).replace(/%$/, "");

// tx_result.repr of a successful swap: "(ok (tuple ... (received uN) ...))".
export function parseReceived(repr) {
  const m = String(repr ?? "").match(/\(received u(\d+)\)/);
  return m ? BigInt(m[1]) : null;
}

// One classification for the poll loop. A missing or pending transaction is pending;
// success carries the parsed received amount (null when unparseable, never 0).
export function txOutcome(tx) {
  if (!tx || !tx.tx_status || tx.tx_status === "pending") return { kind: "pending" };
  if (tx.tx_status === "success") return { kind: "success", received: parseReceived(tx.tx_result && tx.tx_result.repr), blockHeight: tx.block_height };
  return { kind: "abort", status: tx.tx_status, repr: tx.tx_result && tx.tx_result.repr };
}

export const normTxid = (t) => String(t ?? "").replace(/^0x/i, "").toLowerCase();
export const shortTxid = (t) => `0x${normTxid(t).slice(0, 12)}…`;
export function shortPrincipal(p) {
  const [addr, name] = String(p).split(".");
  return `${addr.slice(0, 5)}…${addr.slice(-4)}${name ? "." + name : ""}`;
}
export const explorerTx = (t) => `https://explorer.hiro.so/txid/0x${normTxid(t)}?chain=mainnet`;
export const explorerAddr = (a) => `https://explorer.hiro.so/address/${a}?chain=mainnet`;
