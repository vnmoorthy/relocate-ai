#!/usr/bin/env bash
# Publish the current tunnel URL so the deployed site can find the backend.
#
# The site reads raw.githubusercontent first, which serves a pushed file within
# seconds — so this closes the gap a tunnel rotation opens without waiting for
# a Pages rebuild. Safe to run repeatedly; it no-ops when nothing changed.
set -euo pipefail
cd "$(dirname "$0")/.."
URL="$(cat "$HOME/.relocate/runtime/tunnel-url" 2>/dev/null || true)"
[ -n "$URL" ] || { echo "no tunnel URL yet"; exit 0; }
CURRENT="$(cat web/public/live.json 2>/dev/null || true)"
NEW="{\"api\": \"$URL\"}"
[ "$CURRENT" = "$NEW" ] && { echo "endpoint unchanged: $URL"; exit 0; }
printf '%s' "$NEW" > web/public/live.json
git add web/public/live.json
git commit -q -m "chore: republish live.json after tunnel rotation"
git push -q origin main
echo "published: $URL"
