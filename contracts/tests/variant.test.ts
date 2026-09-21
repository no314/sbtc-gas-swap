import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { build, verify, structureHash, SUBSTITUTIONS } from "../scripts/build-simnet-variant.mjs";

const source = readFileSync("contracts/sbtc-gas-swap-v1.clar", "utf8");
const generated = readFileSync("contracts/sbtc-gas-swap-v1-simnet.clar", "utf8");

describe("simnet variant is the mainnet contract with only the listed substitutions", () => {
  it("regenerating from source reproduces the committed variant", () => {
    expect(build(source)).toBe(generated);
  });
  it("reversing the substitutions restores the source structure hash", () => {
    expect(verify(source, generated)).toBe(structureHash(source));
  });
  it("every mainnet token substituted appears in the source exactly where expected", () => {
    for (const [from] of SUBSTITUTIONS) expect(source.includes(from)).toBe(true);
    expect(source.match(/tx-sponsor\?/g)?.length).toBe(1);
  });
  it("structure hash is formatting independent", () => {
    const reformatted = source.replace(/\n\s+/g, "\n").replace(/\(\s+/g, "(");
    expect(structureHash(reformatted)).toBe(structureHash(source));
  });
  it("mainnet source contains no em dash", () => {
    expect(source.includes("—")).toBe(false);
  });
});
