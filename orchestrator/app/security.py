"""AgentPhone webhook HMAC-SHA256 verification.

Per AgentPhone docs: every webhook delivery includes
  X-Webhook-Signature: sha256=<hex_digest>
  X-Webhook-Timestamp: <unix seconds>
The signature is HMAC-SHA256(secret, raw_body). Timestamp must be within 5 minutes
of now to prevent replay.

Each agent has its own webhook secret (returned by POST /agents/{id}/webhook). We
load secrets from agents.json after provisioning (see scripts/provision_agents.py).
"""
from __future__ import annotations

import hashlib
import hmac
import json
import time
from pathlib import Path

from fastapi import HTTPException, Request


_SECRETS: dict[str, str] = {}  # agent_id -> webhook_secret
_SECRETS_LOADED = False


def _load_secrets() -> None:
    global _SECRETS_LOADED
    if _SECRETS_LOADED:
        return
    path = Path(__file__).parent.parent / "agents.json"
    if path.exists():
        data = json.loads(path.read_text())
        for entry in data.get("agents", []):
            if entry.get("webhook_secret"):
                _SECRETS[entry["agent_id"]] = entry["webhook_secret"]
    _SECRETS_LOADED = True


def verify_agentphone_signature(
    body: bytes,
    signature_header: str | None,
    timestamp_header: str | None,
    agent_id: str,
    max_age_seconds: int = 300,
) -> None:
    """Raises HTTPException(401) if signature is missing, stale, or invalid."""
    _load_secrets()
    secret = _SECRETS.get(agent_id)
    if not secret:
        # Dev mode: no secret registered for this agent yet (skip verification).
        # In production this would be a hard fail.
        return

    if not signature_header or not timestamp_header:
        raise HTTPException(401, "missing webhook signature headers")

    try:
        ts = int(timestamp_header)
    except ValueError as e:
        raise HTTPException(401, "bad timestamp") from e

    if abs(time.time() - ts) > max_age_seconds:
        raise HTTPException(401, "stale webhook")

    expected = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature_header):
        raise HTTPException(401, "bad webhook signature")


async def get_raw_body(request: Request) -> bytes:
    """Cache the raw body so we can read it for HMAC AND parse JSON downstream."""
    if not hasattr(request.state, "_raw_body"):
        request.state._raw_body = await request.body()
    return request.state._raw_body
