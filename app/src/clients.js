// One gate for every read and every relay call. The SDK's ChainClient and RelayClient do the
// work (spacing, retries, ranking, submission); this module only decides which fetch they use.
// Live mode: the read API from ?api= (default api.hiro.so, reads only, never what the wallet
// signs) and the relays listed in the docs site's sponsors.json. Fixture mode (?fixture=<name>):
// every response comes from src/fixtures.js through the clients' injected fetch, so the whole
// app runs with zero network requests and the harness asserts exactly that.
import { ChainClient, RelayClient, DEFAULT_SPONSORS_URL } from "@no314/sbtc-gas-swap";
import { FIXTURES, FIXTURE_RELAY, makeFixtureFetch } from "./fixtures.js";
import CONTRACT_SOURCE from "../../contracts/contracts/sbtc-gas-swap-v1.clar?raw";

export const API_DEFAULT = "https://api.hiro.so";
export { DEFAULT_SPONSORS_URL };

export function makeClients(api, fixtureName) {
  const fx = fixtureName && FIXTURES[fixtureName];
  if (fx) {
    const f = makeFixtureFetch(fx, CONTRACT_SOURCE);
    return {
      fixture: fx, fixtureName,
      chain: new ChainClient({ baseUrl: api || API_DEFAULT, fetch: f, minSpacingMs: 0, retries: 0 }),
      relay: new RelayClient({ fetch: f, relays: [FIXTURE_RELAY] }),
    };
  }
  return {
    fixture: null, fixtureName: null,
    chain: new ChainClient({ baseUrl: api || API_DEFAULT }),
    relay: new RelayClient(),
  };
}
