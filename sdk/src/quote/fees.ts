import { BIPS_DENOM, FEE_BIPS, MAX_INTEGRATOR_BIPS } from "../config.js";

// serviceFee carries the contract's service-fee field verbatim. Show it to users as the
// "default provider fee"; the three user-facing names are network fee (the tier, repaid to the
// sponsor in STX), default provider fee (50 bips of the input, in sBTC), and integrator fee.
export interface FeeSplit { serviceFee: bigint; integratorFee: bigint; net: bigint }

// Mirrors sbtc-gas-swap-v1 quote-fees exactly (integer floors).
export function splitFees(amountSats: bigint, integratorBips: bigint): FeeSplit {
  if (amountSats <= 0n) throw new Error("amount must be positive");
  if (integratorBips < 0n || integratorBips > MAX_INTEGRATOR_BIPS) throw new Error(`integrator bips must be 0..${MAX_INTEGRATOR_BIPS}`);
  const serviceFee = (amountSats * FEE_BIPS) / BIPS_DENOM;
  const integratorFee = (amountSats * integratorBips) / BIPS_DENOM;
  return { serviceFee, integratorFee, net: amountSats - serviceFee - integratorFee };
}
