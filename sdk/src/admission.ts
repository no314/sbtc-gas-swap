// Network admission for a sponsored swap. stacks-node refuses a transaction whose fee is below
// `serialized length × MINIMUM_TX_FEE_RATE_PER_BYTE` (1 uSTX per byte), and a relay never bids
// above the tier the user repays. So a tier can only be sponsored when it covers that floor. With
// the current contract call (about 680 bytes once the sponsor has signed) every tier does; these
// helpers let an integrator grey a tier out before the wallet opens if that ever changes, and the
// relay refuses such a transaction with TIER_TOO_SMALL as the backstop.
import { estimateTransactionByteLength, type StacksTransactionWire } from "@stacks/transactions";
import { TIERS, TIER_NAMES, type TierName } from "./config.js";

export const MIN_FEE_PER_BYTE = 1n;
export const SPONSOR_SIG_BYTES = 66; // the relay's signature; the placeholder already counts most of it

// Serialized length of the transaction once the sponsor has signed it. Signing does not change the
// length of what the wallet returns (signature fields are fixed size), so this is known before signing.
export function sponsoredByteLength(tx: StacksTransactionWire): number {
  return estimateTransactionByteLength(tx) + SPONSOR_SIG_BYTES;
}

export function admissionFloor(byteLength: number, minPerByte = MIN_FEE_PER_BYTE): bigint {
  return BigInt(byteLength) * minPerByte;
}

// Tiers whose value covers the admission floor, in order. Empty when none does.
export function admissibleTiers(byteLength: number, minPerByte = MIN_FEE_PER_BYTE): TierName[] {
  const floor = admissionFloor(byteLength, minPerByte);
  return TIER_NAMES.filter((t) => TIERS[t] >= floor);
}
