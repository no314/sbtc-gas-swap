#!/usr/bin/env bash
# Build the demo app and stage it into the stx.fan repo at zero_to/gas/.
#
#   bash scripts/publish-stx-fan.sh [path-to-stx-fan-clone]
#
# Default target: ../stx-fan, the sibling clone of github.com/no314/stx-fan.
# Copies the built app, which already contains the disclaimer page and sponsors.json (the build
# copies docs/sponsors.json into it). Commits nothing: review the diff in the stx-fan clone and
# push from there.
#
# What lands on stx.fan:
#   zero_to/gas/index.html        the demo app
#   zero_to/gas/disclaimer.html   the terms the relay publishes as termsUrl
#   zero_to/gas/sponsors.json     the relay directory; the app reads it relative to itself
#   zero_to/gas/assets/           hashed js and css
# Everything else (contract, relay, SDK, docs) lives in the source repo and needs no website.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO=$(pwd)
TARGET=${1:-"$REPO/../stx-fan"}
DEST="$TARGET/zero_to/gas"

[ -d "$TARGET" ] || { echo "no stx-fan clone at $TARGET"; echo "clone it first: git clone git@github.com:no314/stx-fan.git $TARGET"; exit 1; }

echo "==> build sdk"
(cd sdk && npm ci --no-audit --no-fund && npm run build)
echo "==> build app"
(cd app && npm ci --no-audit --no-fund && npm run build)

echo "==> verify the built app against fixtures"
(cd app && npm run verify)

echo "==> stage into $DEST"
mkdir -p "$DEST"
# deploy.html is a local-only Ledger deploy page: neither it nor its chunk is published.
rsync -a --delete --exclude deploy.html --exclude "assets/deploy-*.js" "$REPO/app/dist/" "$DEST/"

echo
echo "staged:"
find "$DEST" -type f | sed "s#$TARGET/#  #"
echo
echo "Next: cd $TARGET && git add zero_to/gas && git commit && git push"
echo "Live at https://stx.fan/zero_to/gas/ once pushed."
