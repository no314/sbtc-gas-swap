// Bitflow xyk-core-v-1-2 swap-x-for-y, x = sBTC, y = STX. Verified against deployed source 2026-09-05.
import type { PoolQuote } from "./types.js";
const BPS = 10_000n;

export interface XykState {
  xBalance: bigint; yBalance: bigint; protocolFeeBips: bigint; providerFeeBips: bigint; enabled: boolean;
}

export function quoteXyk(s: XykState, inSats: bigint): PoolQuote {
  const base: PoolQuote = { poolId: 1, in: inSats, out: 0n, feeSats: 0n, impactBips: 0n, reserveStx: s.yBalance };
  if (!s.enabled) return { ...base, reason: "disabled" };
  if (inSats <= 0n || s.xBalance === 0n || s.yBalance === 0n) return { ...base, reason: "no-liquidity" };
  const feeProtocol = (inSats * s.protocolFeeBips) / BPS;
  const feeProvider = (inSats * s.providerFeeBips) / BPS;
  const dx = inSats - feeProtocol - feeProvider;
  const dy = (s.yBalance * dx) / (s.xBalance + dx);
  return { ...base, out: dy, feeSats: feeProtocol + feeProvider, impactBips: impact(dx, dy, s.xBalance, s.yBalance) };
}

// Impact in bips: 1 - (executed price / marginal price), marginal price = y/x.
export function impact(dx: bigint, dy: bigint, x: bigint, y: bigint): bigint {
  if (dx === 0n || y === 0n) return 0n;
  const marginalOut = (y * dx) / x;
  if (marginalOut === 0n) return 0n;
  return ((marginalOut - dy) * 10_000n) / marginalOut;
}
