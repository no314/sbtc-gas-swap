import { BIPS_DENOM, FEE_BIPS, MAX_INTEGRATOR_BIPS } from "../config.js";
// Mirrors sbtc-gas-swap-v1 quote-fees exactly (integer floors).
export function splitFees(amountSats, integratorBips) {
    if (amountSats <= 0n)
        throw new Error("amount must be positive");
    if (integratorBips < 0n || integratorBips > MAX_INTEGRATOR_BIPS)
        throw new Error(`integrator bips must be 0..${MAX_INTEGRATOR_BIPS}`);
    const serviceFee = (amountSats * FEE_BIPS) / BIPS_DENOM;
    const integratorFee = (amountSats * integratorBips) / BIPS_DENOM;
    return { serviceFee, integratorFee, net: amountSats - serviceFee - integratorFee };
}
//# sourceMappingURL=fees.js.map