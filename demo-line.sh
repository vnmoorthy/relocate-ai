#!/usr/bin/env bash
# Relocate demo phone line supervisor.
#
# Keeps every link of the inbound-call chain alive while this script runs:
#   caffeinate (no Mac sleep) → Ollama (model pinned warm) → run.sh stack
#   → cloudflared tunnel → AgentPhone webhook pointed at the current tunnel URL.
#
# If the tunnel URL changes, the AgentPhone webhook is re-pointed automatically.
# If a service dies, it is restarted. State + log live in the runtime dir.
#
# Usage:  ./demo-line.sh          (foreground; Ctrl-C stops supervision)
#         nohup ./demo-line.sh &  (background)
# The phone line dies when this Mac is off, offline, or this script stops.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ORCH_ROOT="$REPO_ROOT/orchestrator"
# Persistent location: temp purges kill whatever lives under TMPDIR.
RUNTIME_DIR="${RELOCATE_RUNTIME_DIR:-$HOME/.relocate/runtime}"
mkdir -p "$RUNTIME_DIR"
LOG="$RUNTIME_DIR/demo-line.log"
TUNNEL_LOG="$RUNTIME_DIR/cloudflared.log"
URL_STATE="$RUNTIME_DIR/tunnel-url"
MODEL="${VLLM_MODEL:-gemma2:2b}"

ts() { date "+%Y-%m-%d %H:%M:%S"; }
note() { printf "%s %s\n" "$(ts)" "$1" | tee -a "$LOG"; }

# ── keep the Mac awake while we supervise ────────────────────────────────
caffeinate -dims -w $$ &
note "caffeinate attached (Mac will not sleep while demo-line runs; lid must stay open unless on external power+display)"

ensure_ollama() {
  if ! curl -fsS --max-time 3 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
    note "ollama down — starting"
    OLLAMA_KEEP_ALIVE=24h nohup ollama serve >"$RUNTIME_DIR/ollama.log" 2>&1 &
    sleep 3
  fi
  curl -fsS --max-time 120 http://127.0.0.1:11434/v1/chat/completions \
    -H 'Content-Type: application/json' \
    -d "{\"model\":\"$MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"OK\"}],\"max_tokens\":2}" \
    >/dev/null 2>&1 && return 0
  note "WARN: model warm-up failed"
  return 1
}

ensure_stack() {
  if ! curl -fsS --max-time 3 http://127.0.0.1:8000/healthz >/dev/null 2>&1; then
    note "orchestrator down — starting stack via run.sh"
    (cd "$REPO_ROOT" && ./run.sh --skip-preflight >>"$LOG" 2>&1)
  fi
}

TUNNEL_FAILS=0

ensure_tunnel() {
  if ! pgrep -f "cloudflared tunnel --url" >/dev/null 2>&1; then
    note "cloudflared down — starting tunnel"
    : >"$TUNNEL_LOG"
    nohup cloudflared tunnel --url http://127.0.0.1:8000 >>"$TUNNEL_LOG" 2>&1 &
    sleep 15
    TUNNEL_FAILS=0
  fi
  TUNNEL_URL="$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$TUNNEL_LOG" | tail -1)"
  if [ -z "$TUNNEL_URL" ]; then
    note "WARN: no tunnel URL yet"
    return 1
  fi
  if curl -fsS --max-time 20 "$TUNNEL_URL/healthz" >/dev/null 2>&1; then
    TUNNEL_FAILS=0
    return 0
  fi
  # A quick tunnel gets a NEW random hostname every restart, and the public
  # site only learns it when live.json is committed and Pages rebuilds. So
  # rotate only when the tunnel itself is at fault — never because the
  # origin happens to be restarting, and not on a single transient blip.
  if ! curl -fsS --max-time 3 http://127.0.0.1:8000/healthz >/dev/null 2>&1; then
    note "tunnel unhealthy because the origin is down — keeping $TUNNEL_URL"
    return 1
  fi
  TUNNEL_FAILS=$((TUNNEL_FAILS + 1))
  if [ "$TUNNEL_FAILS" -lt 5 ]; then
    note "WARN: tunnel check failed ($TUNNEL_FAILS/5) with a healthy origin — not rotating yet"
    return 1
  fi
  note "tunnel broken across $TUNNEL_FAILS checks with a healthy origin — restarting cloudflared"
  pkill -f "cloudflared tunnel --url" 2>/dev/null
  TUNNEL_FAILS=0
  sleep 2
  return 1
}

point_webhook() {
  local last=""
  [ -f "$URL_STATE" ] && last="$(cat "$URL_STATE")"
  if [ "$TUNNEL_URL" != "$last" ]; then
    note "tunnel URL changed ($last -> $TUNNEL_URL) — re-pointing AgentPhone webhook"
    python3 - "$TUNNEL_URL" <<'PYEOF'
import re, sys, pathlib
p = pathlib.Path("orchestrator/.env")
t = p.read_text()
t = re.sub(r"^PUBLIC_BASE_URL=.*$", f"PUBLIC_BASE_URL={sys.argv[1]}", t, flags=re.M)
p.write_text(t)
PYEOF
    if (cd "$ORCH_ROOT" && uv run python scripts/update_webhooks.py >>"$LOG" 2>&1); then
      printf "%s" "$TUNNEL_URL" >"$URL_STATE"
      note "webhook now -> $TUNNEL_URL/webhook/agent/buyer"
      # Self-heal: publish the new endpoint so the deployed site reconnects
      # without anyone noticing. Propagation takes a few minutes (Pages
      # rebuild, or raw's 300s cache), and the site re-probes every 60s, so
      # it comes back on its own.
      if "$REPO_ROOT/scripts/republish-endpoint.sh" >>"$LOG" 2>&1; then
        note "endpoint republished — public site reconnects on its own within a few minutes"
      else
        note "ACTION NEEDED: could not republish automatically — run ./scripts/republish-endpoint.sh"
      fi
    else
      note "ERROR: webhook update failed (will retry next cycle)"
    fi
  fi
}

note "=== demo-line supervisor started (no number attached to the buyer agent) ==="
cd "$REPO_ROOT"
while true; do
  ensure_ollama
  ensure_stack
  if ensure_tunnel; then
    point_webhook
  fi
  sleep 15
done
