// Verifies the reviewed contract source against the SDK's pinned structure-hash literal, and that
// the hash is invariant under reformatting (the property the "contract verified" reader line
// claims). Runs in Node with no browser; the SDK's structureHash is the one the app uses live.
import { readFileSync } from "node:fs";
import { structureHash, PINNED_STRUCTURE_HASH } from "@no314/sbtc-gas-swap";

const src = readFileSync(new URL("../../contracts/contracts/sbtc-gas-swap-v1.clar", import.meta.url), "utf8");
const EXPECTED = "5702f09a5ab584d56d7e803b94143d1c51327c5a95f2a2309df4e604215ed608";

let fail = 0;
const check = (name, ok, extra = "") => { if (!ok) fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  (" + extra + ")" : ""}`); };

check("SDK pin equals the literal this app was built against", PINNED_STRUCTURE_HASH === EXPECTED, PINNED_STRUCTURE_HASH);
const h = await structureHash(src);
check("reviewed source hashes to the pin", h === EXPECTED, h);
const reformatted = src.replace(/\n/g, "\n    ").replace(/ \(/g, "   (").replace(/\)\n/g, ")\n\n");
check("hash stable under reformatting (indent, paren spacing, blank lines)", (await structureHash(reformatted)) === EXPECTED);
const recommented = src.replace(/;;[^\n]*/g, ";; comment text changed");
check("hash ignores comment text by design", (await structureHash(recommented)) === EXPECTED);
const edited = src + "\n(define-constant EXTRA u1)";
check("an edited source does not match", (await structureHash(edited)) !== EXPECTED);

console.log(fail ? `\n${fail} failed` : "\nall hash checks passed");
process.exit(fail ? 1 : 0);
