// Wallet and transaction bridge, adapted from Zero to Signing's src/lib.js. Uses the vendored,
// pinned known-good bundles in src/vendor/ (they speak SIP-030 JSON-RPC and serialize v7
// post-condition objects). The registry versions of @stacks/connect are NOT interchangeable
// with these files: the vendored copies are the ones whose post-condition handling was observed
// against Leather, and a sponsored swap without its exact post-conditions is refused by the relay.
import { connect, request, disconnect, setSelectedProviderId } from "./vendor/connect.js";
import { cvToHex, hexToCV, ClarityType } from "./vendor/transactions.js";

// Installed-wallet detection from the WBIP provider registry plus legacy globals.
// Three tiers (stacks-dapp-architecture "Wallet capability"):
//   verified  Leather: post-condition enforcement observed on a deny-mode call, and the
//             sponsored flag returns { transaction } hex without broadcasting.
//   untested  Xverse, Asigna, Fordefi: the @stacks/connect compatibility table lists
//             postConditions support, or sponsored calls are plausible, but nobody has
//             observed a sponsored swap from them. Offered so operators can try; the relay
//             refuses any transaction lacking the exact post-conditions, so a wallet that
//             drops them cannot get sponsored and the user loses nothing but time.
//   blocked   anything else detected: shown inert.
function tierOf(text) {
  if (/leather/i.test(text)) return "verified";
  if (/xverse|asigna|fordefi/i.test(text)) return "untested";
  return "blocked";
}
function detectWallets() {
  const out = new Map();
  const reg = [...(Array.isArray(window.wbip_providers) ? window.wbip_providers : []), ...(Array.isArray(window.webbtc_stx_providers) ? window.webbtc_stx_providers : [])];
  for (const p of reg) { if (p && p.id && !out.has(p.id)) out.set(p.id, { id: p.id, name: p.name || p.id, icon: p.icon || null }); }
  if (window.LeatherProvider && ![...out.keys()].some((id) => /leather/i.test(id))) out.set("LeatherProvider", { id: "LeatherProvider", name: "Leather", icon: null });
  if (window.XverseProviders && ![...out.keys()].some((id) => /xverse/i.test(id))) out.set("XverseProviders.StacksProvider", { id: "XverseProviders.StacksProvider", name: "Xverse Wallet", icon: null });
  const list = [...out.values()];
  for (const w of list) { w.tier = tierOf(`${w.id} ${w.name}`); w.supported = w.tier !== "blocked"; }
  const order = { verified: 0, untested: 1, blocked: 2 };
  return list.sort((a, b) => order[a.tier] - order[b.tier]);
}

// Known-wallet catalog for the selector: always shown, merged with what is installed.
const WALLET_CATALOG = [
  { key: "leather", name: "Leather",         match: /leather/i, install: "https://leather.io",        tier: "verified" },
  { key: "xverse",  name: "Xverse",          match: /xverse/i,  install: "https://www.xverse.app",    tier: "untested" },
  { key: "asigna",  name: "Asigna Multisig", match: /asigna/i,  install: "https://asigna.io",         tier: "untested" },
  { key: "fordefi", name: "Fordefi",         match: /fordefi/i, install: "https://www.fordefi.com",   tier: "untested" },
];
function walletCatalog() {
  const detected = detectWallets();
  const rows = WALLET_CATALOG.map((c) => {
    const hit = detected.find((w) => c.match.test(`${w.id} ${w.name}`));
    return { key: c.key, name: hit ? hit.name : c.name, id: hit ? hit.id : null, installed: !!hit, tier: c.tier, supported: !!hit && c.tier !== "blocked", install: c.install };
  });
  for (const w of detected) {
    if (!WALLET_CATALOG.some((c) => c.match.test(`${w.id} ${w.name}`))) rows.push({ key: w.id, name: w.name, id: w.id, installed: true, tier: "blocked", supported: false, install: null });
  }
  return rows;
}

// Wallet BNS name (mainnet), reused from Zero to Signing: BNS-V2 on-chain reads through the
// read API, then the bnsv2.com API as a fallback. Display only.
const BNSV2_ID = "SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF.BNS-V2";
async function resolveBnsName(addr, api, fetchImpl = fetch) {
  if (!addr) return null;
  const [BNS, C] = BNSV2_ID.split(".");
  const dec = (h) => { h = String(h).replace(/^0x/, ""); let s = ""; for (let i = 0; i < h.length; i += 2) s += String.fromCharCode(parseInt(h.substr(i, 2), 16)); return s; };
  const nameFromTuple = (tupleCv) => { const t = tupleCv.value; const nm = dec(t.name.value), ns = dec(t.namespace.value); return (nm && ns) ? `${nm}.${ns}` : null; };
  async function callRO(fn, args) {
    const r = await fetchImpl(`${api}/v2/contracts/call-read/${BNS}/${C}/${fn}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sender: addr, arguments: args }) });
    if (!r.ok) throw new Error("api " + r.status);
    const j = await r.json(); if (!j.okay) throw new Error("read failed"); return hexToCV(j.result);
  }
  try {
    const { principalCV } = await import("./vendor/transactions.js");
    const p = await callRO("get-primary", [cvToHex(principalCV(addr))]);
    if (p.type === ClarityType.ResponseOk && p.value.type === ClarityType.OptionalSome) return nameFromTuple(p.value.value);
    return null;
  } catch (e) {
    try {
      const j = await fetchImpl(`https://api.bnsv2.com/names/address/${addr}/valid`).then((r) => r.json());
      const first = j && j.names && j.names[0];
      return first && (first.full_name || (first.name_string && first.namespace_string ? `${first.name_string}.${first.namespace_string}` : null)) || null;
    } catch (e2) { return null; }
  }
}

window.SGLib = { connect, request, disconnect, setSelectedProviderId, detectWallets, walletCatalog, cvToHex, hexToCV, ClarityType, resolveBnsName };
