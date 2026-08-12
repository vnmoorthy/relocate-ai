#!/usr/bin/env bash
# Safe configuration and local-service preflight for Relocate.
#
# Default: validates tools and configuration without calling vendor APIs.
# Optional:
#   --check-services   probe local orchestrator/PAVO/Ollama health endpoints
#   --live-config      treat missing live-provider configuration as a failure

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ORCH_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$ORCH_ROOT/.env"

CHECK_SERVICES=0
LIVE_CONFIG=0
for arg in "$@"; do
  case "$arg" in
    --check-services) CHECK_SERVICES=1 ;;
    --live-config) LIVE_CONFIG=1 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

PASS=0
WARN=0
FAIL=0

pass() { printf "  \033[32m✓ PASS\033[0m  %-32s %s\n" "$1" "${2:-}"; PASS=$((PASS + 1)); }
warn() { printf "  \033[33m⚠ WARN\033[0m  %-32s %s\n" "$1" "${2:-}"; WARN=$((WARN + 1)); }
fail() { printf "  \033[31m✗ FAIL\033[0m  %-32s %s\n" "$1" "${2:-}"; FAIL=$((FAIL + 1)); }

configured() {
  local value="${1:-}"
  [[ -n "$value" && "$value" != *REPLACE* && "$value" != *CHANGE_ME* && "$value" != *PLACEHOLDER* ]]
}

check_tool() {
  if command -v "$1" >/dev/null 2>&1; then
    pass "$1 installed" "$(command -v "$1")"
  else
    fail "$1 installed" "required for local development"
  fi
}

check_integration_key() {
  local label="$1"
  local value="$2"
  local live_required="${3:-0}"
  if configured "$value"; then
    pass "$label configured"
  elif [[ "$LIVE_CONFIG" == "1" && "$live_required" == "1" ]]; then
    fail "$label configured" "required for the live-provider acceptance path"
  else
    warn "$label configured" "not set; the related integration is unavailable"
  fi
}

check_token() {
  local label="$1"
  local value="$2"
  local required="${3:-1}"
  if configured "$value" && [[ ${#value} -ge 32 ]]; then
    pass "$label configured" "length >= 32"
  elif [[ "$required" == "1" ]]; then
    fail "$label configured" "generate a distinct random value with at least 32 characters"
  else
    warn "$label configured" "not required while the related route is disabled"
  fi
}

probe_json_status() {
  local label="$1"
  local url="$2"
  local expected="$3"
  if curl -fsS --max-time 5 "$url" 2>/dev/null \
      | grep -q '"status"[[:space:]]*:[[:space:]]*"'"$expected"'"'; then
    pass "$label reachable" "$url"
  else
    fail "$label reachable" "$url"
  fi
}

echo
echo "=== Relocate preflight (no vendor calls) ==="
echo

check_tool curl
check_tool uv
check_tool node
check_tool pnpm

if [[ -f "$ENV_FILE" ]]; then
  pass "orchestrator/.env present"
  if [[ -n "$(find "$ENV_FILE" -perm -077 -print -quit 2>/dev/null)" ]]; then
    warn "orchestrator/.env permissions" "contains group/other permissions; use chmod 600"
  else
    pass "orchestrator/.env permissions" "owner-only"
  fi
else
  warn "orchestrator/.env present" "copy .env.example for local services"
fi

if configured "${AGENTPHONE_API_KEY:-}"; then
  pass "AgentPhone key configured"
  if [[ -f "$ORCH_ROOT/agents.json" ]] \
      && grep -q '"agent_id"[[:space:]]*:[[:space:]]*"buyer"' "$ORCH_ROOT/agents.json" \
      && grep -q '"webhook_secret"' "$ORCH_ROOT/agents.json"; then
    pass "AgentPhone registry present" "buyer webhook secret found"
  elif [[ "$LIVE_CONFIG" == "1" ]]; then
    fail "AgentPhone registry present" "provision and review orchestrator/agents.json"
  else
    warn "AgentPhone registry present" "inbound webhooks remain fail-closed without it"
  fi
elif [[ "$LIVE_CONFIG" == "1" ]]; then
  fail "AgentPhone key configured" "required for inbound voice"
else
  warn "AgentPhone key configured" "not set; inbound voice is unavailable"
fi

PAVO_KEY="${PAVO_API_KEY:-}"
check_token "PAVO shared key" "$PAVO_KEY"
check_token "Dashboard API token" "${DASHBOARD_API_TOKEN:-}"

if [[ "${ENABLE_DEV_TRIGGER:-false}" == "true" ]]; then
  if [[ "${APP_ENV:-development}" == "production" ]]; then
    fail "Development trigger policy" "ENABLE_DEV_TRIGGER must be false in production"
  else
    check_token "Admin API token" "${ADMIN_API_TOKEN:-}"
  fi
else
  pass "Development trigger disabled"
  if configured "${ADMIN_API_TOKEN:-}" && [[ ${#ADMIN_API_TOKEN} -lt 32 ]]; then
    warn "Admin API token" "configured value is shorter than 32 characters"
  fi
fi

for token_pair in \
  "$PAVO_KEY:${DASHBOARD_API_TOKEN:-}" \
  "$PAVO_KEY:${ADMIN_API_TOKEN:-}" \
  "${DASHBOARD_API_TOKEN:-}:${ADMIN_API_TOKEN:-}"; do
  left="${token_pair%%:*}"
  right="${token_pair#*:}"
  if configured "$left" && configured "$right" && [[ "$left" == "$right" ]]; then
    fail "Service token separation" "PAVO, dashboard, and admin tokens must all differ"
  fi
done

if [[ "${CORS_ALLOWED_ORIGINS:-}" == *"*"* ]]; then
  fail "CORS allowlist" "wildcard origins are not permitted"
else
  pass "CORS allowlist" "explicit origins only"
fi

PAVO_URL="${PAVO_BASE_URL:-http://127.0.0.1:8765/v1}"
case "$PAVO_URL" in
  https://*) pass "PAVO transport" "HTTPS" ;;
  http://127.0.0.1:*|http://localhost:*|http://pavo:*) pass "PAVO transport" "private/local HTTP" ;;
  *) fail "PAVO transport" "public PAVO endpoints must use HTTPS or private networking" ;;
esac

check_integration_key "AgentMail" "${AGENTMAIL_API_KEY:-}" 1
check_integration_key "Browser Use" "${BROWSERUSE_API_KEY:-}"
check_integration_key "Gemini" "${GEMINI_API_KEY:-}"
check_integration_key "Lob" "${LOB_API_KEY:-}"
check_integration_key "Supermemory" "${SUPERMEMORY_API_KEY:-}"
check_integration_key "Sponge" "${SPONGE_API_KEY:-}"

if [[ "$LIVE_CONFIG" == "1" ]] && configured "${LOB_API_KEY:-}" \
    && [[ "${LOB_API_KEY}" != test_* ]]; then
  fail "Lob test-mode key" "live Lob keys are forbidden in the acceptance path"
fi

if configured "${STRIPE_SECRET_KEY:-}"; then
  if [[ "${STRIPE_TEST_MODE:-true}" != "true" || "${STRIPE_SECRET_KEY}" != sk_test_* ]]; then
    fail "Stripe test-mode guard" "use STRIPE_TEST_MODE=true and an sk_test_ key"
  else
    pass "Stripe test-mode guard"
  fi
else
  warn "Stripe configured" "not set; the experimental sponsor adapter is unavailable"
fi

if configured "${MOSS_PROJECT_ID:-}" && configured "${MOSS_PROJECT_KEY:-}"; then
  pass "Moss credentials configured"
else
  warn "Moss credentials configured" "optional; requires both project id and key"
fi

if [[ "$CHECK_SERVICES" == "1" ]]; then
  echo
  echo "--- local service probes ---"
  PAVO_HEALTH="${PAVO_URL%/v1}/healthz"
  PAVO_READY="${PAVO_URL%/v1}/readyz"
  probe_json_status "PAVO liveness" "$PAVO_HEALTH" "ok"
  probe_json_status "PAVO readiness" "$PAVO_READY" "ready"
  probe_json_status "Orchestrator liveness" "http://127.0.0.1:${PORT:-8000}/healthz" "ok"

  VLLM_ENDPOINT="${VLLM_URL:-http://127.0.0.1:11434/v1/chat/completions}"
  VLLM_ORIGIN="${VLLM_ENDPOINT%%/v1/*}"
  if curl -fsS --max-time 5 "$VLLM_ORIGIN/api/tags" 2>/dev/null | grep -q '"models"'; then
    pass "Ollama reachable" "$VLLM_ORIGIN"
  else
    warn "Ollama reachable" "$VLLM_ORIGIN (PAVO cloud tiers may still work)"
  fi
fi

echo
echo "--- preflight summary: $PASS passed, $WARN warnings, $FAIL failed ---"
echo

if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
