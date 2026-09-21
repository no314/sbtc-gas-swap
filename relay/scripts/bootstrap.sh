#!/usr/bin/env bash
# One-shot relay bootstrap for an operator's Mac or Linux box. Idempotent: rerun after any step fails.
# Runs from anywhere: cd's into relay/. Needs Node 22+, npm, network. Pauses for pastes and funding.
#
#   bash relay/scripts/bootstrap.sh
#
# Steps: build sdk + relay, test, wrangler login, KV namespace, keygen (prints addresses), wait for
# funding, secrets, deploy, verify /v1/info. Secrets are pasted into wrangler prompts, never into files.
set -euo pipefail
cd "$(dirname "$0")/.."
RELAY_DIR=$(pwd)
say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "missing: $1"; exit 1; }; }
need node; need npm
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 22 ] || { echo "Node 22 or later required, found $(node -v)"; exit 1; }

say "1/8 Build SDK and relay, run tests"
(cd ../sdk && npm ci --no-audit --no-fund && npm run build)
npm ci --no-audit --no-fund
npm test

say "2/8 Cloudflare login (a browser tab opens; click Allow)"
# wrangler whoami exits 0 even when logged out, so test its text. wrangler login must run with a TTY.
if npx wrangler whoami 2>&1 | grep -qi "not authenticated"; then
  echo "If no browser tab opens, copy the URL wrangler prints into Firefox."
  npx wrangler login
fi
npx wrangler whoami 2>&1 | grep -qi "not authenticated" && { echo "login did not complete"; exit 1; }
npx wrangler whoami 2>&1 | grep -iE "logged in|account" | head -3

say "3/8 KV namespace"
if grep -q REPLACE_WITH_KV_NAMESPACE_ID wrangler.toml; then
  # Do not capture wrangler's output: a piped stdout makes it non-interactive and it refuses to run.
  if ! npx wrangler kv namespace list 2>/dev/null | grep -qE '"title": "(sbtc-gas-relay-)?RELAY_KV"'; then
    npx wrangler kv namespace create RELAY_KV
  fi
  ID=$(npx wrangler kv namespace list 2>/dev/null | node -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{ const j=JSON.parse(s.slice(s.indexOf("["))); const n=j.find(x=>x.title==="RELAY_KV"||x.title==="sbtc-gas-relay-RELAY_KV"); if(n) console.log(n.id); });')
  [ -n "$ID" ] || { echo "could not read the namespace id from 'wrangler kv namespace list'; paste it into wrangler.toml manually"; exit 1; }
  sed -i.bak "s/REPLACE_WITH_KV_NAMESPACE_ID/$ID/; /preview_id = \"local\"/d" wrangler.toml && rm -f wrangler.toml.bak
  echo "wrangler.toml updated with KV id $ID"
else
  echo "KV namespace already configured"
fi

say "4/8 Sponsor keys"
echo "If you already generated and stored keys, answer n and skip to funding."
read -r -p "Generate three new sponsor keys now? [y/N] " GEN
if [[ "${GEN:-n}" =~ ^[Yy]$ ]]; then
  npm run keygen
  echo
  echo "Save the seed phrase (restores all three accounts in Leather) and the three keys in your password manager NOW."
  read -r -p "Saved? [y/N] " SAVED
  [[ "${SAVED:-n}" =~ ^[Yy]$ ]] || { echo "Save the keys first, then rerun."; exit 1; }
fi

say "5/8 Fund the three sponsor addresses"
echo "Send STX from your wallet: suggested 2 STX to LOW, 5 STX to MID, 10 STX to HIGH."
echo "Wait until the transfers are confirmed (explorer.hiro.so, search each address)."
read -r -p "Funded and confirmed? [y/N] " FUNDED
[[ "${FUNDED:-n}" =~ ^[Yy]$ ]] || { echo "Fund first, then rerun; steps 1 to 4 are skipped automatically."; exit 1; }

say "6/8 Secrets (paste each value when asked; input is hidden)"
for S in SPONSOR_KEY_LOW SPONSOR_KEY_MID SPONSOR_KEY_HIGH; do
  echo "-> $S"; npx wrangler secret put "$S"
done
read -r -p "Set HIRO_API_KEY too? Optional; anonymous access works. [y/N] " HK
if [[ "${HK:-n}" =~ ^[Yy]$ ]]; then npx wrangler secret put HIRO_API_KEY; fi

say "7/8 Deploy"
npm run build
npx wrangler deploy
read -r -p "Relay URL printed by wrangler deploy (Enter for https://sbtc-gas-relay.labs2.workers.dev): " URL
URL=${URL:-https://sbtc-gas-relay.labs2.workers.dev}

say "8/8 Verify"
echo "Relay URL: ${URL:-unknown}"
if [ -n "${URL:-}" ]; then
  curl -sS "$URL/healthz"; echo
  curl -sS "$URL/v1/info" | (command -v jq >/dev/null && jq . || cat); echo
  echo "Expected: sponsors show your three addresses, minTier low, feeEstimate values between 3000 and the tier."
  echo "Next: add \"$URL\" to docs/sponsors.json, then run the dust swap from sdk/ (see docs/operator-guide.md step 10)."
fi
