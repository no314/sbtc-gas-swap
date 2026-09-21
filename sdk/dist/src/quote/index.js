import { splitFees } from "./fees.js";
import { quoteXyk } from "./xyk.js";
import { quoteVelar } from "./velar.js";
import { quoteDlmm } from "./dlmm.js";
import { selectPool } from "./select.js";
export * from "./types.js";
export { quoteXyk, quoteVelar, quoteDlmm, selectPool, splitFees };
// Reads all whitelisted pools once. A failed read is recorded, never turned into a zero.
export async function readPoolStates(client, dlmmBinsAhead = 3) {
    const settled = await Promise.allSettled([client.readXykState(), client.readVelarState(), client.readDlmmState(dlmmBinsAhead)]);
    const out = { unavailable: [], readAt: Date.now() };
    if (settled[0].status === "fulfilled")
        out.xyk = settled[0].value;
    else
        out.unavailable.push({ poolId: 1, error: msg(settled[0].reason) });
    if (settled[1].status === "fulfilled")
        out.velar = settled[1].value;
    else
        out.unavailable.push({ poolId: 2, error: msg(settled[1].reason) });
    if (settled[2].status === "fulfilled")
        out.dlmm = settled[2].value;
    else
        out.unavailable.push({ poolId: 3, error: msg(settled[2].reason) });
    return out;
}
// Pure: quotes from one snapshot, so a UI can re-quote on every keystroke without spending reads.
export function quoteFromStates(states, r) {
    const fees = splitFees(r.amountSats, r.integratorBips ?? 0n);
    const quotes = [];
    if (states.xyk)
        quotes.push(quoteXyk(states.xyk, fees.net));
    if (states.velar)
        quotes.push(quoteVelar(states.velar, fees.net));
    if (states.dlmm)
        quotes.push(quoteDlmm(states.dlmm, fees.net));
    const best = selectPool(quotes, 0n);
    return { fees, quotes, unavailable: states.unavailable ?? [], best, readAt: states.readAt };
}
// Reads all whitelisted pools, quotes the net input through each, picks the best.
export async function quoteAllPools(client, r) {
    return quoteFromStates(await readPoolStates(client, r.dlmmBinsAhead ?? 3), r);
}
const msg = (e) => e?.message ?? String(e);
//# sourceMappingURL=index.js.map