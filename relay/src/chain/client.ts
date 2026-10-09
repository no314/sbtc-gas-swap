// RelayChain over the SDK's ChainClient: the relay reads the chain exactly the way integrators do.
import { ChainClient, quoteXyk, quoteVelar, quoteDlmm } from "@no314/sbtc-gas-swap";
import type { RelayChain } from "../core/relay.js";

export function makeRelayChain(o: { baseUrl?: string; apiKey?: string; fetch?: typeof fetch }): RelayChain & { client: ChainClient } {
  const client = new ChainClient({ baseUrl: o.baseUrl, apiKey: o.apiKey, fetch: o.fetch, minSpacingMs: 0, retries: 2 }); // 429/5xx backoff 1 s then 2 s: under the SDK's 8 s relay timeout
  return {
    client,
    getSbtcBalance: (a) => client.getSbtcBalance(a),
    getNonces: (a) => client.getNonces(a),
    async quotePool(poolId, net) {
      const n = BigInt(net);
      if (poolId === 1) return quoteXyk(await client.readXykState(), n);
      if (poolId === 2) return quoteVelar(await client.readVelarState(), n);
      return quoteDlmm(await client.readDlmmState(3), n);
    },
    broadcast: (hex) => client.broadcast(hex),
  };
}
