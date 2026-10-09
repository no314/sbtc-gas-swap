// Maps relay error codes and on-chain abort codes to actionable text. Copy rules: declarative, no filler.
export interface Explanation { title: string; action: string; retryable: boolean }

const RELAY: Record<string, Explanation> = {
  NOT_SPONSORED_AUTH: { title: "The wallet signed an ordinary transaction, not a sponsored one.", action: "Use a wallet that supports sponsored transactions, such as Leather, and sign again.", retryable: false },
  WRONG_NETWORK: { title: "The wallet signed for another network.", action: "Switch the wallet to mainnet.", retryable: false },
  WRONG_CONTRACT: { title: "The transaction does not call the swap contract.", action: "Rebuild the transaction with the SDK.", retryable: false },
  WRONG_FUNCTION: { title: "The transaction calls another function.", action: "Rebuild the transaction with the SDK.", retryable: false },
  BAD_ARGS: { title: "The transaction arguments are malformed.", action: "Rebuild the transaction with the SDK.", retryable: false },
  UNKNOWN_POOL: { title: "The selected pool is not whitelisted.", action: "Re-quote to select a supported pool.", retryable: true },
  BAD_TIER: { title: "The fee tier is not one of low, mid, high.", action: "Choose a tier from the selector.", retryable: true },
  TIER_TOO_SMALL: { title: "This transaction is too large for the fee level you chose.", action: "Choose the higher level the sponsor names.", retryable: true },
  ORIGIN_NONCE_IN_FLIGHT: { title: "This swap is already on its way.", action: "You submitted it twice. Wait for the first one; this page follows it.", retryable: false },
  UPSTREAM_RATE_LIMITED: { title: "The sponsor service hit a limit reading the chain.", action: "The page tries another service; retry in a minute if none answers.", retryable: true },
  TIER_BELOW_MIN: { title: "This sponsor needs a higher fee level right now.", action: "Choose the level it names, or another service.", retryable: true },
  MIN_OUT_BELOW_TIER: { title: "Your minimum would not cover the network fee.", action: "Raise the amount, lower the fee level, or lower the slippage.", retryable: true },
  BAD_BIPS: { title: "The integrator fee is above 1 percent.", action: "The integrator must pass 0 to 100 bips.", retryable: false },
  BAD_POST_CONDITIONS: { title: "The wallet changed or dropped the limits on the transaction.", action: "This wallet cannot be used for sponsored swaps.", retryable: false },
  INSUFFICIENT_SBTC: { title: "Your wallet holds less sBTC than the amount.", action: "Lower the amount.", retryable: true },
  BAD_NONCE: { title: "Your wallet has an earlier transaction still pending.", action: "Wait for it to confirm, then sign again.", retryable: true },
  QUOTE_BELOW_MIN_OUT: { title: "The price fell below your minimum before the sponsor could sign.", action: "Quote again; use 2 or 5 percent slippage if it keeps failing.", retryable: true },
  RATE_LIMITED: { title: "Too many requests from this wallet.", action: "Wait an hour, or use another service.", retryable: true },
  SPONSOR_BUSY: { title: "The sponsor for this fee level has too many transactions waiting.", action: "Retry in a few minutes, or choose another level or service.", retryable: true },
  BROADCAST_FAILED: { title: "The network rejected the transaction.", action: "Retry; the message above gives the network's reason.", retryable: true },
  BAD_SIGNATURE: { title: "The wallet's signature does not match your account.", action: "Reconnect the wallet and sign again. If it repeats, the wallet has a bug in how it signs sponsored transactions.", retryable: false },
  INTERNAL: { title: "The sponsor service failed while handling this transaction.", action: "Retry. If it repeats, send the message above to the service operator.", retryable: true },
  RELAY_UNREACHABLE: { title: "The sponsor service did not answer.", action: "The page tries another; retry later if none answers.", retryable: true },
  MALFORMED: { title: "The signed transaction could not be read.", action: "Sign again.", retryable: false },
};

// Contract and pool abort codes seen in a mined transaction's result.
const ONCHAIN: Record<string, Explanation> = {
  "u101": { title: "The transaction was not sponsored on chain.", action: "Submit through a relay.", retryable: false },
  "u104": { title: "Your minimum is below the network fee.", action: "Raise the amount or lower the fee level.", retryable: true },
  "u108": { title: "The pool paid less than your minimum because the price moved.", action: "Quote again and retry with more slippage.", retryable: true },
  "u1020": { title: "The pool paid less than your minimum because the price moved (Bitflow XYK).", action: "Quote again and retry with 2 or 5 percent slippage.", retryable: true },
  "u107": { title: "Velar refused the swap: the price moved, or the amount is too small.", action: "Quote again and retry; Velar cannot swap amounts under 2 sats.", retryable: true },
  "u2003": { title: "The pool paid less than your minimum because the price moved (Bitflow DLMM).", action: "Quote again and retry with 2 or 5 percent slippage.", retryable: true },
};

export function explainRelayError(code: string): Explanation {
  return RELAY[code] ?? { title: `The relay refused the transaction (${code}).`, action: "Retry or use another relay.", retryable: true };
}

// `result` is the tx_result repr from the API, e.g. "(err u1020)"; `status` is abort_by_response / abort_by_post_condition.
export function explainTxFailure(status: string, result?: string): Explanation {
  if (status === "abort_by_post_condition") {
    return { title: "A post-condition stopped the swap: the pool would have paid less than your minimum.", action: "Quote again and retry with 2 or 5 percent slippage.", retryable: true };
  }
  const m = result?.match(/\(err (u\d+)\)/);
  if (m && ONCHAIN[m[1]]) return ONCHAIN[m[1]];
  return { title: `The swap did not go through (${result ?? status}).`, action: "Quote again and retry. If it repeats, report the transaction id.", retryable: true };
}
