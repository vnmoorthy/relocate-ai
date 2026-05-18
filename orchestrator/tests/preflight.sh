#!/usr/bin/env bash
# Pre-flight smoke tests — run BEFORE stage at ~16:30 PT.
# Each test reads .env and probes one integration. Prints PASS / FAIL with a one-line reason.
# Exit 0 if everything PASSES; 1 if anything fails (so we can use `&&` to gate rehearsal).
#
# Usage:
#   bash orchestrator/tests/preflight.sh
#   or
#   uv run bash orchestrator/tests/preflight.sh   (loads .env via direnv if installed)

set -uo pipefail

# Load .env from the orchestrator directory.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

PASS=0
FAIL=0

check() {
  local name="$1"
  local cmd="$2"
  if eval "$cmd" >/tmp/preflight-last.log 2>&1; then
    printf "  \033[32m✓ PASS\033[0m  %-30s\n" "$name"
    PASS=$((PASS + 1))
  else
    printf "  \033[31m✗ FAIL\033[0m  %-30s  %s\n" "$name" "$(tail -1 /tmp/preflight-last.log)"
    FAIL=$((FAIL + 1))
  fi
}

echo ""
echo "=== Relocate preflight ==="
echo ""

# Lambda PAVO server
PAVO_URL="${PAVO_BASE_URL:-http://129.146.122.8:8000/v1}"
PAVO_HOST="${PAVO_URL%/v1*}"
check "PAVO /healthz reachable" \
  "curl -fsS --max-time 5 http://localhost:8002/healthz | grep -q '\"status\":\"ok\"'"

# vLLM endpoint
check "vLLM /v1/models reachable" \
  "curl -fsS --max-time 5 -H 'Authorization: Bearer dummy' http://localhost:8001/api/tags | grep -q gemma"

# AgentPhone
if [[ -n "${AGENTPHONE_API_KEY:-}" && "$AGENTPHONE_API_KEY" != "ap_REPLACE_ME" ]]; then
  check "AgentPhone API auth" \
    "curl -fsS --max-time 5 -H 'Authorization: Bearer $AGENTPHONE_API_KEY' ${AGENTPHONE_BASE_URL:-https://api.agentphone.ai/v1}/agents?limit=1"
else
  printf "  \033[33m⊘ SKIP\033[0m  AgentPhone API auth                 (AGENTPHONE_API_KEY unset)\n"
fi

# Stripe (test mode)
if [[ -n "${STRIPE_SECRET_KEY:-}" && "$STRIPE_SECRET_KEY" != sk_test_REPLACE_ME ]]; then
  check "Stripe API auth" \
    "curl -fsS --max-time 5 -u $STRIPE_SECRET_KEY: https://api.stripe.com/v1/charges?limit=1 | grep -q '\"object\":'"
else
  printf "  \033[33m⊘ SKIP\033[0m  Stripe API auth                     (STRIPE_SECRET_KEY unset)\n"
fi

# Orchestrator local
check "Orchestrator /healthz reachable" \
  "curl -fsS --max-time 5 http://localhost:8000/healthz | grep -q '\"status\":\"ok\"'"

# Anthropic fallback
if [[ -n "${ANTHROPIC_API_KEY:-}" && "$ANTHROPIC_API_KEY" != "sk-ant-REPLACE_ME" ]]; then
  check "Anthropic API auth" \
    "curl -fsS --max-time 5 https://api.anthropic.com/v1/models -H \"x-api-key: $ANTHROPIC_API_KEY\" -H 'anthropic-version: 2023-06-01' | grep -q claude"
else
  printf "  \033[33m⊘ SKIP\033[0m  Anthropic API auth                  (ANTHROPIC_API_KEY unset)\n"
fi

# AgentMail / Browser Use / Supermemory / Moss / sponge — auth checks vary; we only
# verify the env var is set, since each sponsor has its own auth endpoint.
for sponsor in AGENTMAIL BROWSERUSE SUPERMEMORY MOSS SPONGE; do
  var="${sponsor}_API_KEY"
  val="${!var:-}"
  if [[ -n "$val" && "$val" != "REPLACE_ME" ]]; then
    printf "  \033[32m✓ PASS\033[0m  %-30s  key present\n" "${sponsor} key set"
    PASS=$((PASS + 1))
  else
    printf "  \033[33m⊘ SKIP\033[0m  %-30s  (${var} unset)\n" "${sponsor} key set"
  fi
done

echo ""
echo "--- Pre-flight summary: $PASS passed, $FAIL failed ---"
echo ""

if [[ "$FAIL" -gt 0 ]]; then
  echo "BLOCK ship until all critical FAILs are resolved."
  exit 1
fi
exit 0
