// Per-sponsor-key nonce reconciliation. Pure. State persistence is the adapter's job.
export interface ChainNonces {
  lastExecuted: number | null;   // last_executed_tx_nonce
  lastMempool: number | null;    // last_mempool_tx_nonce
  possibleNext: number;          // possible_next_nonce
  missing: number[];             // detected_missing_nonces
}
export interface LocalNonceState {
  next: bigint | null;           // next nonce this relay intends to use
  pending: bigint[];             // nonces broadcast and not yet seen executed
}
export interface Reconciled {
  nonce: bigint | null;
  pending: bigint[];
  fillingGap: boolean;
  reason?: "SPONSOR_BUSY";
}

export function reconcileNonce(local: LocalNonceState, chain: ChainNonces, maxPending: number): Reconciled {
  const executedFloor = chain.lastExecuted === null ? -1 : chain.lastExecuted;
  const pending = local.pending.filter((n) => n > BigInt(executedFloor)).sort((a, b) => (a < b ? -1 : 1));
  if (chain.missing.length > 0) {
    const gap = BigInt(Math.min(...chain.missing));
    return { nonce: gap, pending, fillingGap: true };
  }
  if (pending.length >= maxPending) return { nonce: null, pending, fillingGap: false, reason: "SPONSOR_BUSY" };
  const chainNext = BigInt(chain.possibleNext);
  const nonce = local.next === null || local.next < chainNext ? chainNext : local.next;
  return { nonce, pending, fillingGap: false };
}
