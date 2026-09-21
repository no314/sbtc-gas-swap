import { Cl } from "@stacks/transactions";
import { ChainClient } from "../src/client/chain.js";

export // A fake node: answers call-read by function name with shape-correct Clarity values.
function fakeNode(overrides: Record<string, () => unknown> = {}) {
  const calls: string[] = [];
  const ok = (cv: any) => ({ okay: true, result: Cl.serialize(Cl.ok(cv)) });
  const answers: Record<string, () => unknown> = {
    "xyk-pool-sbtc-stx-v-1-1/get-pool": () => ok(Cl.tuple({
      "x-balance": Cl.uint(44_730_224n), "y-balance": Cl.uint(136_671_025_817n),
      "x-protocol-fee": Cl.uint(10), "x-provider-fee": Cl.uint(40), "pool-status": Cl.bool(true),
    })),
    "univ2-pool-v1_0_0-0070/get-pool": () => ok(Cl.tuple({ reserve0: Cl.uint(212_869_098_374n), reserve1: Cl.uint(69_663_360n) })),
    "univ2-fees-v1_0_0-0070/get-fees": () => ok(Cl.tuple({ "swap-fee": Cl.tuple({ num: Cl.uint(9970), den: Cl.uint(10_000) }) })),
    "dlmm-pool-stx-sbtc-v-2-bps-15/get-pool-for-swap": () => ok(Cl.tuple({
      "active-bin-id": Cl.int(340), "bin-step": Cl.uint(15), "initial-price": Cl.uint(19_610),
      "protocol-fee": Cl.uint(25), "provider-fee": Cl.uint(25), "variable-fee": Cl.uint(0),
    })),
    "dlmm-core-v-1-1/get-bin-factors-by-step": () => ok(Cl.some(Cl.list(Array.from({ length: 1001 }, (_, i) => Cl.uint(i === 840 ? 166_460_000n : i === 841 ? 166_710_000n : 100_000_000n))))),
    "dlmm-pool-stx-sbtc-v-2-bps-15/get-bin-balances": () => ok(Cl.tuple({ "x-balance": Cl.uint(50_000_000_000n), "y-balance": Cl.uint(0), "bin-shares": Cl.uint(1) })),
    "sbtc-token/get-balance": () => ok(Cl.uint(123_456n)),
    ...overrides,
  };
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push(url);
    const m = url.match(/call-read\/[^/]+\/([^/]+)\/([^/?]+)/);
    if (m) {
      const key = `${m[1]}/${m[2]}`;
      const a = answers[key];
      if (!a) return new Response(JSON.stringify({ okay: false, cause: `no fixture for ${key}` }), { status: 200 });
      return new Response(JSON.stringify(a()), { status: 200 });
    }
    if (url.includes("/extended/v1/address/") && url.includes("/nonces")) {
      return new Response(JSON.stringify({ last_executed_tx_nonce: 4, last_mempool_tx_nonce: null, possible_next_nonce: 5, detected_missing_nonces: [] }));
    }
    if (url.includes("/v2/accounts/")) return new Response(JSON.stringify({ balance: "0x0", nonce: 5 }));
    if (url.includes("/v2/fees/transaction")) return new Response(JSON.stringify({ estimations: [{ fee: 1000 }, { fee: 5000 }, { fee: 9000 }] }));
    if (url.includes("/v2/transactions")) return new Response(JSON.stringify("0x" + "ab".repeat(32)));
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  return { client: new ChainClient({ fetch: fetchImpl, minSpacingMs: 0, retries: 0 }), calls };
}

