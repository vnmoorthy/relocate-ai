#!/usr/bin/env bash
# Side-effect-free verification harness.
#
# What it does:
#   1. Runs the deterministic PAVO policy tests.
#   2. Verifies the 29-agent roster across backend, frontend, and docs.
#   3. Exercises all 28 specialist dispatch paths with provider boundaries mocked.
#
# It never loads real credentials, starts a public server, sends mail, submits a
# form, or creates a payment. Live-provider acceptance is separately gated and
# excluded from this command.
set -euo pipefail

cd "$(dirname "$0")/orchestrator"

echo "==> Static analysis"
uv run ruff check app tests scripts ../pavo_server

echo "==> Type analysis"
uv run mypy

echo "==> Side-effect-free test suite"
RUN_PROVIDER_ACCEPTANCE=0 PROVIDER_ACCEPTANCE_ACK= \
  uv run pytest -q tests ../pavo_server/tests -m "not provider_acceptance"

echo "==> Verification passed; no external provider calls were made."
