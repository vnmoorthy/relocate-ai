#!/usr/bin/env bash
# Local Relocate launcher.
#
# Usage:
#   ./run.sh [--external-pavo] [--ngrok] [--skip-preflight]
#   ./run.sh stop
#
# The default path starts a local PAVO API on :8765, the orchestrator on :8000,
# and the Next.js dashboard on :3000. It never opens a public tunnel unless
# --ngrok is supplied. Provider credentials remain in orchestrator/.env and are
# not copied into generated files.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ORCH_ROOT="$REPO_ROOT/orchestrator"
WEB_ROOT="$REPO_ROOT/web"
RUNTIME_DIR="${TMPDIR:-/tmp}/relocate-${UID}"
mkdir -p "$RUNTIME_DIR"

PAVO_LOG="$RUNTIME_DIR/pavo.log"
ORCH_LOG="$RUNTIME_DIR/orchestrator.log"
WEB_LOG="$RUNTIME_DIR/web.log"
NGROK_LOG="$RUNTIME_DIR/ngrok.log"

color() { printf "\033[%sm%s\033[0m\n" "$1" "$2"; }
ok() { color "32" "✓ $1"; }
warn() { color "33" "⚠ $1"; }
err() { color "31" "✗ $1" >&2; }
step() { printf "\n"; color "1;36" "▶ $1"; }

pid_file() { printf "%s/%s.pid" "$RUNTIME_DIR" "$1"; }

stop_managed_process() {
  local name="$1"
  local file
  file="$(pid_file "$name")"
  if [[ ! -f "$file" ]]; then
    warn "$name has no managed PID file"
    return
  fi
  local pid
  pid="$(<"$file")"
  if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid"
    for _ in {1..20}; do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.1
    done
    if kill -0 "$pid" 2>/dev/null; then
      warn "$name did not stop after 2s; leaving PID $pid running"
      return
    fi
    ok "$name stopped"
  else
    warn "$name PID is no longer running"
  fi
  rm -f "$file"
}

if [[ "${1:-}" == "stop" ]]; then
  step "Stopping processes launched by run.sh"
  stop_managed_process ngrok
  stop_managed_process web
  stop_managed_process orchestrator
  stop_managed_process pavo
  exit 0
fi

START_LOCAL_PAVO=1
START_NGROK=0
RUN_PREFLIGHT=1
for arg in "$@"; do
  case "$arg" in
    --external-pavo) START_LOCAL_PAVO=0 ;;
    --ngrok) START_NGROK=1 ;;
    --skip-preflight) RUN_PREFLIGHT=0 ;;
    *) err "Unknown option: $arg"; exit 2 ;;
  esac
done

if [[ ! -f "$ORCH_ROOT/.env" ]]; then
  err "Missing orchestrator/.env. Copy orchestrator/.env.example and replace every placeholder."
  exit 1
fi

set -a
# shellcheck disable=SC1091
source "$ORCH_ROOT/.env"
set +a

if [[ "$RUN_PREFLIGHT" == "1" ]]; then
  step "Validating local tools and configuration"
  bash "$ORCH_ROOT/tests/preflight.sh"
fi

wait_for_health() {
  local url="$1"
  for _ in {1..30}; do
    if curl -fsS --max-time 2 "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

start_managed() {
  local name="$1"
  local log_file="$2"
  shift 2
  nohup "$@" >"$log_file" 2>&1 &
  local service_pid=$!
  printf "%s\n" "$service_pid" >"$(pid_file "$name")"
}

if [[ "$START_LOCAL_PAVO" == "1" ]]; then
  step "Starting local PAVO API on :8765"
  if curl -fsS --max-time 2 http://127.0.0.1:8765/healthz >/dev/null 2>&1; then
    warn "PAVO is already reachable; run.sh will not manage that process"
  else
    start_managed pavo "$PAVO_LOG" \
      env \
      PAVO_API_KEY="$PAVO_API_KEY" \
      VLLM_URL="${VLLM_URL:-http://127.0.0.1:11434/v1/chat/completions}" \
      VLLM_MODEL="${VLLM_MODEL:-gemma2:2b}" \
      GEMINI_API_KEY="${GEMINI_API_KEY:-}" \
      GEMINI_MODEL="${GEMINI_MODEL:-gemini-2.0-flash}" \
      ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}" \
      uv run --project "$ORCH_ROOT" uvicorn pavo_server.app:app \
        --app-dir "$REPO_ROOT" --host 127.0.0.1 --port 8765
    if wait_for_health http://127.0.0.1:8765/healthz; then
      ok "PAVO ready"
    else
      err "PAVO failed to become healthy; inspect $PAVO_LOG"
      exit 1
    fi
  fi
  EFFECTIVE_PAVO_URL="http://127.0.0.1:8765/v1"
else
  EFFECTIVE_PAVO_URL="${PAVO_BASE_URL:-}"
  if [[ -z "$EFFECTIVE_PAVO_URL" ]]; then
    err "--external-pavo requires PAVO_BASE_URL in orchestrator/.env"
    exit 1
  fi
fi

step "Starting orchestrator on :${PORT:-8000}"
if curl -fsS --max-time 2 "http://127.0.0.1:${PORT:-8000}/healthz" >/dev/null 2>&1; then
  warn "Orchestrator is already reachable; run.sh will not manage that process"
else
  start_managed orchestrator "$ORCH_LOG" \
    env PAVO_BASE_URL="$EFFECTIVE_PAVO_URL" PAVO_API_KEY="$PAVO_API_KEY" \
    uv run --directory "$ORCH_ROOT" uvicorn app.main:app \
      --host 127.0.0.1 --port "${PORT:-8000}"
  if wait_for_health "http://127.0.0.1:${PORT:-8000}/healthz"; then
    ok "Orchestrator ready"
  else
    err "Orchestrator failed to become healthy; inspect $ORCH_LOG"
    exit 1
  fi
fi

step "Starting dashboard on :3000"
if curl -fsS --max-time 2 http://127.0.0.1:3000 >/dev/null 2>&1; then
  warn "Dashboard is already reachable; run.sh will not manage that process"
else
  start_managed web "$WEB_LOG" pnpm --dir "$WEB_ROOT" dev
  if wait_for_health http://127.0.0.1:3000; then
    ok "Dashboard ready"
  else
    err "Dashboard failed to become healthy; inspect $WEB_LOG"
    exit 1
  fi
fi

if [[ "$START_NGROK" == "1" ]]; then
  step "Starting explicit ngrok tunnel for the orchestrator"
  if ! command -v ngrok >/dev/null 2>&1; then
    err "ngrok is not installed"
    exit 1
  fi
  start_managed ngrok "$NGROK_LOG" ngrok http "${PORT:-8000}" --log=stdout
  sleep 2
  PUBLIC_URL="$(curl -fsS --max-time 3 http://127.0.0.1:4040/api/tunnels 2>/dev/null \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["tunnels"][0]["public_url"])' 2>/dev/null || true)"
  if [[ -n "$PUBLIC_URL" ]]; then
    warn "Public tunnel enabled: $PUBLIC_URL"
    warn "Update PUBLIC_BASE_URL and run scripts/update_webhooks.py intentionally."
  else
    err "ngrok started but its public URL was not available; inspect $NGROK_LOG"
  fi
fi

if [[ "$RUN_PREFLIGHT" == "1" ]]; then
  step "Checking local service health"
  PAVO_BASE_URL="$EFFECTIVE_PAVO_URL" bash "$ORCH_ROOT/tests/preflight.sh" --check-services
fi

printf "\n"
color "1;32" "Relocate local services are ready."
printf "Dashboard:    http://127.0.0.1:3000\n"
printf "Orchestrator: http://127.0.0.1:%s/healthz\n" "${PORT:-8000}"
printf "PAVO:         %s/healthz\n" "${EFFECTIVE_PAVO_URL%/v1}"
printf "Logs:         %s\n" "$RUNTIME_DIR"
printf "Stop:         ./run.sh stop\n"
