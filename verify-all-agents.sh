#!/usr/bin/env bash
# Real-API verification harness. RUN ONLY WHEN YOU MEAN IT — costs money.
#
# What it does:
#   1. Boots the orchestrator on a free port.
#   2. POSTs a buyer-trigger that exercises every shipping agent.
#   3. Asserts all 11 specialists close with a real artifact, or fails loudly.
#
# Required env (set in orchestrator/.env or export before running):
#   AGENTPHONE_API_KEY      — already in .env
#   AGENTMAIL_API_KEY       — already in .env
#   BROWSERUSE_API_KEY      — required for pge/geico/usps/spectrum/pharmacy
#   LOB_API_KEY             — required for comcast_cancel
#   E2E_USER_EMAIL          — optional; defaults to vnarasingamoorthy@gmail.com
#   E2E_PGE_ACCOUNT,
#   E2E_PGE_LAST4,
#   E2E_GEICO_EMAIL,
#   E2E_GEICO_PASSWORD,
#   E2E_USPS_CARD,
#   E2E_USPS_EXP,
#   E2E_USPS_CVV            — staged real creds for the browser-mode agents
set -euo pipefail

cd "$(dirname "$0")/orchestrator"

if [[ -z "${BROWSERUSE_API_KEY:-}" || "${BROWSERUSE_API_KEY}" == "REPLACE_ME" ]]; then
  echo "BROWSER_USE_API_KEY missing — pge/geico/usps/spectrum/pharmacy will fail." >&2
  echo "Acquire one at https://browser-use.com and export BROWSERUSE_API_KEY." >&2
  exit 2
fi

if [[ -z "${LOB_API_KEY:-}" ]]; then
  echo "LOB_API_KEY missing — comcast_cancel will fail." >&2
  echo "Acquire one at https://lob.com and export LOB_API_KEY." >&2
  exit 2
fi

echo "==> Roster consistency"
uv run pytest tests/test_roster_consistency.py -q

echo "==> End-to-end real API test (this WILL spend money)"
RUN_E2E=1 uv run pytest tests/test_e2e_real.py -q -s

echo "==> All agents passed. Artifacts in evidence/."
