// Velar univ2-pool-v1_0_0-0070 swap with univ2-fees-0070: token0 = wstx, token1 = sBTC.
// amt-in-adjusted = amt-in * 9970 / 10000; out = r_out * adj / (r_in + adj). Verified 2026-09-05.
import type { PoolQuote } from "./types.js";
import { impact } from "./xyk.js";

export interface VelarState { reserveStx: bigint; reserveSbtc: bigint; feeNum: bigint; feeDen: bigint }

export function quoteVelar(s: VelarState, inSats: bigint): PoolQuote {
  const base: PoolQuote = { poolId: 2, in: inSats, out: 0n, feeSats: 0n, impactBips: 0n, reserveStx: s.reserveStx };
  if (inSats <= 0n || s.reserveStx === 0n || s.reserveSbtc === 0n) return { ...base, reason: "no-liquidity" };
  const adj = (inSats * s.feeNum) / s.feeDen;
  if (adj === 0n) return { ...base, reason: "below-minimum" };
  const out = (s.reserveStx * adj) / (s.reserveSbtc + adj);
  return { ...base, out, feeSats: inSats - adj, impactBips: impact(adj, out, s.reserveSbtc, s.reserveStx) };
}
