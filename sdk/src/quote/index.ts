import type { ChainClient } from "../client/chain.js";
import { splitFees, type FeeSplit } from "./fees.js";
import { quoteXyk, type XykState } from "./xyk.js";
import { quoteVelar, type VelarState } from "./velar.js";
import { quoteDlmm, type DlmmState } from "./dlmm.js";
import { selectPool } from "./select.js";
import type { PoolQuote } from "./types.js";
export * from "./types.js";
export { quoteXyk, quoteVelar, quoteDlmm, selectPool, splitFees };
export type { XykState, VelarState, DlmmState };

export interface QuoteRequest { amountSats: bigint; integratorBips?: bigint; dlmmBinsAhead?: number }
export interface QuoteResult {
  fees: FeeSplit;
  quotes: PoolQuote[];                       // every pool that answered
  unavailable: { poolId: number; error: string }[];   // pools whose read failed: shown as unavailable, never as 0
  best: PoolQuote;
  readAt: number;                            // Date.now() when the reads finished
}

export interface PoolStates {
  xyk?: XykState; velar?: VelarState; dlmm?: DlmmState;
  unavailable?: { poolId: number; error: string }[];
  readAt: number;
}

// Reads all whitelisted pools once. A failed read is recorded, never turned into a zero.
export async function readPoolStates(client: ChainClient, dlmmBinsAhead = 3): Promise<PoolStates> {
  const settled = await Promise.allSettled([client.readXykState(), client.readVelarState(), client.readDlmmState(dlmmBinsAhead)]);
  const out: PoolStates = { unavailable: [], readAt: Date.now() };
  if (settled[0].status === "fulfilled") out.xyk = settled[0].value; else out.unavailable!.push({ poolId: 1, error: msg(settled[0].reason) });
  if (settled[1].status === "fulfilled") out.velar = settled[1].value; else out.unavailable!.push({ poolId: 2, error: msg(settled[1].reason) });
  if (settled[2].status === "fulfilled") out.dlmm = settled[2].value; else out.unavailable!.push({ poolId: 3, error: msg(settled[2].reason) });
  return out;
}

// Pure: quotes from one snapshot, so a UI can re-quote on every keystroke without spending reads.
export function quoteFromStates(states: PoolStates, r: QuoteRequest): QuoteResult {
  const fees = splitFees(r.amountSats, r.integratorBips ?? 0n);
  const quotes: PoolQuote[] = [];
  if (states.xyk) quotes.push(quoteXyk(states.xyk, fees.net));
  if (states.velar) quotes.push(quoteVelar(states.velar, fees.net));
  if (states.dlmm) quotes.push(quoteDlmm(states.dlmm, fees.net));
  const best = selectPool(quotes, 0n);
  return { fees, quotes, unavailable: states.unavailable ?? [], best, readAt: states.readAt };
}

// Reads all whitelisted pools, quotes the net input through each, picks the best.
export async function quoteAllPools(client: ChainClient, r: QuoteRequest): Promise<QuoteResult> {
  return quoteFromStates(await readPoolStates(client, r.dlmmBinsAhead ?? 3), r);
}

const msg = (e: unknown) => (e as Error)?.message ?? String(e);
