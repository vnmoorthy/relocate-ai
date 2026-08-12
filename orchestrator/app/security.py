"""AgentPhone webhook HMAC-SHA256 verification.

Per AgentPhone docs: every webhook delivery includes
  X-Webhook-Signature: sha256=<hex_digest>
  X-Webhook-Timestamp: <unix seconds>
The signature is HMAC-SHA256(secret, timestamp + "." + raw_body). Timestamp must
be within 5 minutes, and X-Webhook-ID is process-locally deduplicated.

Each agent has its own webhook secret (returned by POST /agents/{id}/webhook). We
load secrets from agents.json after provisioning (see scripts/provision_agents.py).
"""
from __future__ import annotations

import hashlib
import hmac
import json
import threading
import time
from collections import OrderedDict
from pathlib import Path

from fastapi import HTTPException, Request


_SECRETS: dict[str, str] = {}  # agent_id -> webhook_secret
_SECRETS_MTIME_NS: int | None = None

# Process-local replay protection. Durable dedupe belongs in the future event
# store; this bounded cache still protects a single running instance and uses
# AgentPhone's stable X-Webhook-ID rather than a body hash.
_WEBHOOK_DELIVERIES: OrderedDict[tuple[str, str], tuple[str, float]] = OrderedDict()
_SEEN_LOCK = threading.Lock()
_REPLAY_TTL_SECONDS = 600
_MAX_SEEN_WEBHOOKS = 10_000


def _load_secrets() -> None:
    global _SECRETS_MTIME_NS
    path = Path(__file__).parent.parent / "agents.json"
    try:
        mtime_ns = path.stat().st_mtime_ns
    except FileNotFoundError:
        _SECRETS.clear()
        _SECRETS_MTIME_NS = None
        return
    if _SECRETS_MTIME_NS == mtime_ns:
        return

    data = json.loads(path.read_text())
    refreshed: dict[str, str] = {}
    for entry in data.get("agents", []):
        if entry.get("webhook_secret"):
            refreshed[entry["agent_id"]] = entry["webhook_secret"]
    _SECRETS.clear()
    _SECRETS.update(refreshed)
    _SECRETS_MTIME_NS = mtime_ns


def _begin_webhook(agent_id: str, webhook_id: str, now: float) -> bool:
    """Atomically claim processing. False means completed or already in flight."""
    cutoff = now - _REPLAY_TTL_SECONDS
    key = (agent_id, webhook_id)
    with _SEEN_LOCK:
        while _WEBHOOK_DELIVERIES:
            _, (_, seen_at) = next(iter(_WEBHOOK_DELIVERIES.items()))
            if seen_at >= cutoff:
                break
            _WEBHOOK_DELIVERIES.popitem(last=False)
        if key in _WEBHOOK_DELIVERIES:
            return False
        _WEBHOOK_DELIVERIES[key] = ("processing", now)
        while len(_WEBHOOK_DELIVERIES) > _MAX_SEEN_WEBHOOKS:
            _WEBHOOK_DELIVERIES.popitem(last=False)
    return True


def complete_agentphone_webhook(agent_id: str, webhook_id: str) -> None:
    """Mark a successfully processed delivery as completed for retry dedupe."""
    key = (agent_id, webhook_id)
    with _SEEN_LOCK:
        if key in _WEBHOOK_DELIVERIES:
            _WEBHOOK_DELIVERIES[key] = ("completed", time.time())
            _WEBHOOK_DELIVERIES.move_to_end(key)


def release_agentphone_webhook(agent_id: str, webhook_id: str) -> None:
    """Release a failed delivery so AgentPhone's retry can process it again."""
    key = (agent_id, webhook_id)
    with _SEEN_LOCK:
        status = _WEBHOOK_DELIVERIES.get(key)
        if status and status[0] == "processing":
            del _WEBHOOK_DELIVERIES[key]


def verify_agentphone_signature(
    body: bytes,
    signature_header: str | None,
    timestamp_header: str | None,
    webhook_id_header: str | None,
    agent_id: str,
    max_age_seconds: int = 300,
) -> bool:
    """Verify AgentPhone's timestamp-bound HMAC and claim its delivery ID.

    Returns False for an already-processed, otherwise-valid delivery so callers
    can acknowledge retries without repeating side effects.
    """
    _load_secrets()
    secret = _SECRETS.get(agent_id)
    if not secret:
        raise HTTPException(401, "webhook secret is not configured for this agent")

    if not signature_header or not timestamp_header or not webhook_id_header:
        raise HTTPException(401, "missing webhook authentication headers")

    try:
        ts = int(timestamp_header)
    except ValueError as e:
        raise HTTPException(401, "bad timestamp") from e

    now = time.time()
    if abs(now - ts) > max_age_seconds:
        raise HTTPException(401, "stale webhook")

    signed_payload = timestamp_header.encode("ascii") + b"." + body
    expected = "sha256=" + hmac.new(
        secret.encode(), signed_payload, hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected, signature_header):
        raise HTTPException(401, "bad webhook signature")
    return _begin_webhook(agent_id, webhook_id_header, now)


async def get_raw_body(request: Request) -> bytes:
    """Cache the raw body so we can read it for HMAC AND parse JSON downstream."""
    if not hasattr(request.state, "_raw_body"):
        request.state._raw_body = await request.body()
    return request.state._raw_body
