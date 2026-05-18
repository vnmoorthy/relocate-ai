#!/usr/bin/env bash
# Relocate launcher — one-shot demo prep.
# Usage: ./run.sh [--no-tunnel] [--no-ngrok] [--skip-preflight]
#
# What this does, in order:
#   1. Open SSH tunnel to Lambda (ports 8000, 8001) if not already open
#   2. Start ngrok tunneling localhost:8000 for AgentPhone webhooks (skipped if --no-ngrok)
#   3. Run pre-flight smoke tests (skipped if --skip-preflight)
#   4. Start the FastAPI orchestrator on port 8000 in a background tmux session
#   5. Start the Next.js dashboard on port 3000 in a background tmux session
#   6. Print connection info + tail commands
#
# Stop everything: ./run.sh stop

set -euo pipefail

# Resolve repo root regardless of cwd.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ORCH="$REPO_ROOT/orchestrator"
WEB="$REPO_ROOT/web"

LAMBDA_HOST="${LAMBDA_HOST:-ubuntu@163.192.32.38}"
LAMBDA_KEY="${LAMBDA_KEY:-$HOME/.ssh/lambda_hackathon}"

color() { printf "\033[%sm%s\033[0m\n" "$1" "$2"; }
ok()   { color "32" "✓ $1"; }
warn() { color "33" "⚠ $1"; }
err()  { color "31" "✗ $1"; }
step() { echo ""; color "1;36" "▶ $1"; }

# -------- stop mode --------
if [[ "${1:-}" == "stop" ]]; then
  step "Stopping orchestrator + dashboard + tunnel"
  pkill -f "uvicorn app.main:app" 2>/dev/null && ok "orchestrator stopped" || warn "orchestrator not running"
  pkill -f "next dev" 2>/dev/null && ok "dashboard stopped" || warn "dashboard not running"
  pkill -f "ssh.*-L 8000.*$LAMBDA_HOST" 2>/dev/null && ok "tunnel closed" || warn "tunnel not open"
  pkill -f "ngrok http" 2>/dev/null && ok "ngrok stopped" || warn "ngrok not running"
  exit 0
fi

# -------- flags --------
WITH_TUNNEL=1
WITH_NGROK=1
WITH_PREFLIGHT=1
for arg in "$@"; do
  case "$arg" in
    --no-tunnel) WITH_TUNNEL=0 ;;
    --no-ngrok) WITH_NGROK=0 ;;
    --skip-preflight) WITH_PREFLIGHT=0 ;;
    *) err "Unknown flag: $arg"; exit 1 ;;
  esac
done

# -------- 1. SSH tunnel --------
if [[ "$WITH_TUNNEL" == "1" ]]; then
  step "1/5 SSH tunnel to Lambda (ports 8000, 8001)"
  if pgrep -f "ssh.*-L 8000.*$LAMBDA_HOST" >/dev/null; then
    ok "tunnel already open"
  else
    if [[ ! -f "$LAMBDA_KEY" ]]; then
      err "SSH key not found at $LAMBDA_KEY"; exit 1
    fi
    # Tunnel: Mac:8002 → Lambda:8000 (PAVO) and Mac:8001 → Lambda:8001 (Ollama).
    # Mac:8000 is reserved for the local orchestrator (AgentPhone hits it via ngrok).
    ssh -i "$LAMBDA_KEY" \
      -L 8002:localhost:8000 \
      -L 8001:localhost:8001 \
      -N -f \
      -o ServerAliveInterval=20 \
      -o ExitOnForwardFailure=yes \
      -o StrictHostKeyChecking=accept-new \
      "$LAMBDA_HOST"
    sleep 1
    if curl -sf --max-time 5 http://localhost:8002/healthz >/dev/null; then
      ok "tunnel open (PAVO healthz reachable on localhost:8002)"
    else
      err "tunnel did not come up — check $LAMBDA_HOST + $LAMBDA_KEY"; exit 1
    fi
  fi
fi

# -------- 2. ngrok --------
if [[ "$WITH_NGROK" == "1" ]]; then
  step "2/5 ngrok tunneling localhost:8000 for AgentPhone webhooks"
  if ! command -v ngrok >/dev/null; then
    warn "ngrok not installed — skipping. Install: brew install ngrok"
  elif pgrep -f "ngrok http" >/dev/null; then
    ok "ngrok already running"
  else
    nohup ngrok http 8000 --log=stdout > /tmp/move-ngrok.log 2>&1 & disown
    sleep 3
    URL=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['tunnels'][0]['public_url'])" 2>/dev/null || echo "")
    if [[ -n "$URL" ]]; then
      ok "ngrok URL: $URL"
      echo "  ➜ Set PUBLIC_BASE_URL=$URL in $ORCH/.env if AgentPhone webhooks aren't already configured."
    else
      warn "ngrok started but couldn't read tunnel URL"
    fi
  fi
fi

# -------- 3. preflight --------
if [[ "$WITH_PREFLIGHT" == "1" ]]; then
  step "3/5 Pre-flight smoke tests"
  bash "$ORCH/tests/preflight.sh" || warn "some pre-flight checks failed — see output above"
fi

# -------- 4. orchestrator --------
step "4/5 Starting orchestrator (FastAPI on :8000)"
# Port plan: orchestrator owns Mac:8000 (ngrok publishes this for AgentPhone webhooks).
# PAVO server on Lambda:8000 reaches Mac as localhost:8002 via the SSH tunnel above.
# Ollama on Lambda:8001 reaches Mac as localhost:8001.
if pgrep -f "uvicorn app.main:app" >/dev/null; then
  warn "orchestrator already running — restart with: ./run.sh stop && ./run.sh"
else
  cd "$ORCH"
  nohup uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 > /tmp/move-orchestrator.log 2>&1 & disown
  sleep 2
  if curl -sf --max-time 3 http://localhost:8000/healthz >/dev/null; then
    ok "orchestrator up: http://localhost:8000/healthz"
  else
    err "orchestrator failed to start — check /tmp/move-orchestrator.log"
  fi
fi

# -------- 5. dashboard --------
step "5/5 Starting dashboard (Next.js on :3000)"
if pgrep -f "next dev" >/dev/null; then
  warn "dashboard already running"
else
  cd "$WEB"
  nohup pnpm dev > /tmp/move-dashboard.log 2>&1 & disown
  sleep 3
  ok "dashboard up: http://localhost:3000"
fi

# -------- summary --------
echo ""
color "1;32" "╔═══════════════════════════════════════════════════════════╗"
color "1;32" "║                Relocate is alive.                              ║"
color "1;32" "╚═══════════════════════════════════════════════════════════╝"
echo ""
echo "Dashboard:    http://localhost:3000"
echo "Orchestrator: http://localhost:8000/healthz   (also published via ngrok for AgentPhone)"
echo "PAVO server:  http://localhost:8002/healthz   (via SSH tunnel → Lambda:8000)"
echo "Ollama:       http://localhost:8001/api/tags  (via SSH tunnel → Lambda:8001)"
echo ""
echo "Tail logs:"
echo "  tail -f /tmp/move-orchestrator.log"
echo "  tail -f /tmp/move-dashboard.log"
echo "  tail -f /tmp/move-ngrok.log"
echo ""
echo "Trigger a synthetic dispatch (no AgentPhone needed):"
echo '  curl -X POST http://localhost:8000/api/test/buyer-trigger -H "Content-Type: application/json" \'
echo '    -d "{\"spec\":{\"origin_address\":\"123 Main St SF\",\"destination_address\":\"456 Oak Austin\",\"move_date\":\"2026-05-31\"}}"'
echo ""
echo "Stop everything: ./run.sh stop"
