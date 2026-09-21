import { CONTRACT } from "./config.js";
export async function structureHash(source) {
    const noComments = source.replace(/;;[^\n]*/g, "");
    const tokens = noComments.match(/\(|\)|\{|\}|[^\s(){}]+/g) ?? [];
    // Tokens are joined with U+0001 so token boundaries stay part of the hash; same as contracts/scripts/build-simnet-variant.mjs.
    const data = new TextEncoder().encode(tokens.join("\u0001"));
    const digest = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
// Filled in by scripts/pin-contract after the mainnet deploy; empty means "not yet deployed".
export const PINNED_STRUCTURE_HASH = "5702f09a5ab584d56d7e803b94143d1c51327c5a95f2a2309df4e604215ed608";
export async function verifyContract(client, pinned = PINNED_STRUCTURE_HASH) {
    try {
        const { source, publishHeight } = await client.getContractSource(`${CONTRACT.address}.${CONTRACT.name}`);
        const liveHash = await structureHash(source);
        return { ok: liveHash === pinned, liveHash, pinnedHash: pinned, publishHeight };
    }
    catch (e) {
        // A failed read is unavailable, never "verified" and never "mismatch".
        return { ok: false, liveHash: "", pinnedHash: pinned, error: e.message };
    }
}
//# sourceMappingURL=verify-contract.js.map