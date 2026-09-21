// Bitflow integration surface. Bitflow's aggregator enumerates routes client side and executes
// through openContractCall; this module gives it a route whose execution is sponsored.
// See docs/bitflow-integration.md. Bitflow passes its own principal as `integrator` to earn c.
import { ChainClient } from "../client/chain.js";
import { RelayClient } from "../relays.js";
import { quoteAllPools } from "../quote/index.js";
import { defaultSlippageBips, defaultTier } from "../defaults.js";
import { buildSwapCall, type SwapCall } from "../build.js";
import type { TierName } from "../config.js";

export interface SponsoredRouteInput {
  user: string; amountSats: bigint; integrator?: string; integratorBips?: bigint; tier?: TierName; slippageBips?: bigint;
  chain?: ChainClient; relays?: RelayClient;
}
export interface SponsoredRoute {
  call: SwapCall;                 // hand to `request('stx_callContract', call)`
  quoteOutUstx: bigint;
  userReceivesUstx: bigint;
  relays: string[];
  submit: (signedTxHex: string) => ReturnType<RelayClient["submit"]>;
}

export async function getSponsoredRoute(i: SponsoredRouteInput): Promise<SponsoredRoute> {
  const chain = i.chain ?? new ChainClient();
  const relayClient = i.relays ?? new RelayClient();
  const [q, candidates] = await Promise.all([
    quoteAllPools(chain, { amountSats: i.amountSats, integratorBips: i.integrator ? (i.integratorBips ?? 0n) : 0n }),
    relayClient.discover(),
  ]);
  const live = candidates.flatMap((c) => (c.info ? [c.info] : []));
  const minTier = live.length ? live.map((r) => r.minTier).sort((a, b) => ["low", "mid", "high"].indexOf(a) - ["low", "mid", "high"].indexOf(b))[0] : "low";
  const tier = i.tier ?? defaultTier(i.amountSats, { minTier });
  const ranked = RelayClient.rank(candidates, tier);
  const call = buildSwapCall({
    user: i.user, amountSats: i.amountSats, tier, poolId: q.best.poolId, quoteOut: q.best.out,
    slippageBips: i.slippageBips ?? defaultSlippageBips(i.amountSats), integrator: i.integrator, integratorBips: i.integrator ? (i.integratorBips ?? 0n) : 0n,
  });
  return {
    call, quoteOutUstx: q.best.out, userReceivesUstx: q.best.out - call.tierUstx, relays: ranked.map((r) => r.url),
    submit: (hex) => relayClient.submit(hex, ranked),
  };
}
