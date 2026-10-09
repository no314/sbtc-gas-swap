// Maps relay error codes and on-chain abort codes to actionable text. Copy rules: declarative, no filler.
export interface Explanation { title: string; action: string; retryable: boolean }

const RELAY: Record<string, Explanation> = {
  NOT_SPONSORED_AUTH: { title: "The wallet did not produce a sponsored transaction.", action: "Use a wallet that supports sponsored transactions (Leather does) and try again.", retryable: false },
  WRONG_NETWORK: { title: "The transaction is for another network.", action: "Switch the wallet to mainnet.", retryable: false },
  WRONG_CONTRACT: { title: "The transaction does not call the swap contract.", action: "Rebuild the transaction with the SDK.", retryable: false },
  WRONG_FUNCTION: { title: "The transaction calls another function.", action: "Rebuild the transaction with the SDK.", retryable: false },
  BAD_ARGS: { title: "The transaction arguments are malformed.", action: "Rebuild the transaction with the SDK.", retryable: false },
  UNKNOWN_POOL: { title: "The selected pool is not whitelisted.", action: "Re-quote to select a supported pool.", retryable: true },
  BAD_TIER: { title: "The fee tier is not one of low, mid, high.", action: "Choose a tier from the selector.", retryable: true },
  TIER_TOO_SMALL: { title: "This transaction is too large for the chosen fee tier.", action: "The network needs at least 1 uSTX per byte. Choose the higher tier the relay names.", retryable: true },
  ORIGIN_NONCE_IN_FLIGHT: { title: "This swap is already on its way.", action: "The wallet signed the same nonce twice. Wait for the first one to mine; the page follows it.", retryable: false },
  UPSTREAM_RATE_LIMITED: { title: "The relay was rate-limited by the chain API.", action: "Another relay is tried automatically; retry in a minute if none answers.", retryable: true },
  TIER_BELOW_MIN: { title: "This relay requires a higher fee tier right now.", action: "Choose the tier the relay publishes as its minimum, or another relay.", retryable: true },
  MIN_OUT_BELOW_TIER: { title: "The minimum output would not cover the network fee.", action: "Raise the amount, lower the tier, or lower the slippage.", retryable: true },
  BAD_BIPS: { title: "The integrator fee is above 1 percent.", action: "The integrator must pass 0 to 100 bips.", retryable: false },
  BAD_POST_CONDITIONS: { title: "The wallet changed or dropped the post-conditions.", action: "This wallet cannot be used for sponsored swaps; the relay refuses transactions without the exact protections.", retryable: false },
  INSUFFICIENT_SBTC: { title: "The address does not hold enough sBTC.", action: "Lower the amount.", retryable: true },
  BAD_NONCE: { title: "The account nonce does not match the chain.", action: "Wait for pending transactions to confirm, then rebuild.", retryable: true },
  QUOTE_BELOW_MIN_OUT: { title: "The price moved below the minimum output before sponsoring.", action: "Re-quote and retry, with 2 or 5 percent slippage if it keeps failing.", retryable: true },
  RATE_LIMITED: { title: "Too many requests from this address.", action: "Wait an hour or use another relay.", retryable: true },
  SPONSOR_BUSY: { title: "The sponsor key for this tier has too many pending transactions.", action: "Retry in a few minutes or choose another tier or relay.", retryable: true },
  BROADCAST_FAILED: { title: "The node rejected the sponsored transaction.", action: "Retry; if it repeats, the relay reports the node's reason.", retryable: true },
  BAD_SIGNATURE: { title: "The wallet's signature does not verify.", action: "The signed bytes do not match the signing account. Reconnect the wallet and sign again; if it repeats, the wallet is signing sponsored transactions incorrectly.", retryable: false },
  INTERNAL: { title: "The relay hit an error while processing this transaction.", action: "The relay's message names the step. Retry; if it repeats, report the message to the relay operator.", retryable: true },
  RELAY_UNREACHABLE: { title: "The relay did not answer.", action: "Another relay is tried automatically; retry later if none answers.", retryable: true },
  MALFORMED: { title: "The transaction bytes could not be read.", action: "Rebuild the transaction with the SDK.", retryable: false },
};

// Contract and pool abort codes seen in a mined transaction's result.
const ONCHAIN: Record<string, Explanation> = {
  "u101": { title: "The transaction was not sponsored on chain.", action: "Submit through a relay.", retryable: false },
  "u104": { title: "Minimum output below the tier.", action: "Raise the amount or lower the tier.", retryable: true },
  "u108": { title: "The pool returned less than the minimum output.", action: "Re-quote and retry with more slippage.", retryable: true },
  "u1020": { title: "Bitflow XYK: output below minimum (price moved).", action: "Re-quote and retry with 2 or 5 percent slippage.", retryable: true },
  "u107": { title: "Velar: swap preconditions failed (price moved or amount too small).", action: "Re-quote and retry; amounts under 2 sats cannot route through Velar.", retryable: true },
  "u2003": { title: "Bitflow DLMM: output below minimum (price moved).", action: "Re-quote and retry with 2 or 5 percent slippage.", retryable: true },
};

export function explainRelayError(code: string): Explanation {
  return RELAY[code] ?? { title: `The relay refused the transaction (${code}).`, action: "Retry or use another relay.", retryable: true };
}

// `result` is the tx_result repr from the API, e.g. "(err u1020)"; `status` is abort_by_response / abort_by_post_condition.
export function explainTxFailure(status: string, result?: string): Explanation {
  if (status === "abort_by_post_condition") {
    return { title: "A post-condition aborted the swap: the pool would have paid less than the minimum output.", action: "Re-quote and retry with 2 or 5 percent slippage.", retryable: true };
  }
  const m = result?.match(/\(err (u\d+)\)/);
  if (m && ONCHAIN[m[1]]) return ONCHAIN[m[1]];
  return { title: `The swap aborted on chain (${result ?? status}).`, action: "Re-quote and retry. If it repeats, report the transaction id.", retryable: true };
}
