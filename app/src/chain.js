// Chain reads behind one module (Zero to Claiming pattern). Everything here is a read through the
// SDK; signing lives in the step components. A snapshot is one stamped read of every pool's state,
// the Stacks tip, and the user's sBTC balance. Quotes for any amount are then computed locally
// from the snapshot with the SDK's own pool formulas, so typing an amount never spends a read;
// only the explicit Refresh control (and the fresh read before signing) touches the node.
import {
  quoteXyk, quoteVelar, quoteDlmm, selectPool, splitFees, quoteAllPools, verifyContract, RelayClient, POOLS, TIER_NAMES,
} from "@no314/sbtc-gas-swap";

const settle = (p) => p.then((v) => ({ ok: true, v }), (e) => ({ ok: false, e: (e && e.message) || String(e) }));

export async function readSnapshot(clients, account) {
  const c = clients.chain;
  const [xyk, velar, dlmm, info, bal] = await Promise.all([
    settle(c.readXykState()), settle(c.readVelarState()), settle(c.readDlmmState(3)),
    settle(c.getInfo()), account ? settle(c.getSbtcBalance(account)) : Promise.resolve(null),
  ]);
  const states = {};
  const unavailable = [];
  [[1, xyk], [2, velar], [3, dlmm]].forEach(([id, r]) => { if (r.ok) states[id] = r.v; else unavailable.push({ poolId: id, error: r.e }); });
  return {
    states, unavailable,
    tip: info.ok ? info.v.stacks_tip_height : null,
    tipError: info.ok ? null : info.e,
    balance: bal && bal.ok ? bal.v : null,
    balanceError: bal ? (bal.ok ? null : bal.e) : null,
    readAt: new Date(),
  };
}

// Same result shape as the SDK's quoteAllPools, computed from a snapshot instead of fresh reads.
export function quoteFromSnapshot(snap, amountSats) {
  const fees = splitFees(amountSats, 0n);
  const quotes = [];
  if (snap.states[1]) quotes.push(quoteXyk(snap.states[1], fees.net));
  if (snap.states[2]) quotes.push(quoteVelar(snap.states[2], fees.net));
  if (snap.states[3]) quotes.push(quoteDlmm(snap.states[3], fees.net));
  let best = null, error = null;
  try { best = selectPool(quotes, 0n); } catch (e) { error = e.message; }
  return { fees, quotes, unavailable: snap.unavailable, best, error };
}

// Fresh quote for one pool right before signing; null when that pool did not answer.
export async function freshQuoteFor(clients, amountSats, poolId) {
  const q = await quoteAllPools(clients.chain, { amountSats }).catch(() => null);
  if (!q) return { quote: null, best: null, unavailable: [{ poolId, error: "no pool answered" }] };
  return { quote: q.quotes.find((p) => p.poolId === poolId) || null, best: q.best || null, unavailable: q.unavailable, readAt: new Date() };
}

export const verify = (clients) => verifyContract(clients.chain);

export async function discoverRelays(clients) {
  const candidates = await clients.relay.discover().catch((e) => [{ url: "-", error: e.message }]);
  const infos = candidates.filter((c) => c.info).map((c) => c.info);
  const minTier = infos.length ? TIER_NAMES.find((t) => infos.some((i) => i.minTier === t)) : null;
  return { candidates, infos, minTier, readAt: new Date() };
}
export const rankRelays = (relays, tier) => RelayClient.rank(relays.candidates, tier);

export const poolName = (id) => (POOLS[id] ? POOLS[id].name : `pool ${id}`);
export const poolPrincipal = (id) => (POOLS[id] ? POOLS[id].stxSender : "-");
