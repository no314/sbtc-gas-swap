# sponsors.json

A directory of known sponsor relays, published at `https://stx.fan/zero_to/sbtc-gas/sponsors.json` by [`scripts/publish-stx-fan.sh`](../scripts/publish-stx-fan.sh). The SDK reads it, then asks each relay's `/v1/info` for the truth (sponsor addresses, minimum tier, fees). Listing is not an endorsement and not a gate: the contract pays any relay that co-signs, listed or not.

Format:

```json
{
  "updated": "2026-09-05",
  "relays": [
    { "url": "https://sbtc-gas-relay.example.workers.dev", "operator": "Example Labs", "since": "2026-09-05" }
  ]
}
```

To be listed: run a relay per the [operator guide](operator-guide.md), confirm `/v1/info` answers publicly, and open a pull request adding one entry to `docs/sponsors.json`. The file reaches stx.fan on the next publish run. Entries whose `/v1/info` stops answering for a week are removed in a pull request.
