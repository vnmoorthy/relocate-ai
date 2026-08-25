"""Public, unauthenticated live feed: a redacted projection of dashboard events.

The authenticated dashboard stream carries transcript text and provider
artifact details. The public website cannot hold a secret, so it subscribes to
this projection instead: same event shapes, with every free-text or identifier
field blanked server-side. Nothing here depends on the client behaving.
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
from typing import Any

from .config import settings

_TEXT_HIDDEN = ""  # the dashboard renders its own "transcript hidden" placeholder

# Public event alias. The real event id is a capability: whoever holds it can
# read that move's snapshot (/api/public/move/{id}), which carries the mover's
# street addresses. The public feed therefore never emits the real id — it
# emits an unlinkable HMAC alias, and only the snapshot (fetched with the real
# id, which travels by email to the mover) reveals the pairing, so a tracker
# page can still follow its own live events.
#
# A blank PUBLIC_REF_SECRET falls back to a per-process key: aliases then
# rotate on restart, which is self-healing (tracker pages resync from the
# snapshot on reconnect) and never weaker than a configured key.
_FALLBACK_SECRET = secrets.token_hex(32)


def public_ref(event_id: str) -> str:
    """Opaque, stable-per-secret alias for an event id. Not reversible."""
    if not event_id:
        return ""
    key = (settings.public_ref_secret or _FALLBACK_SECRET).encode()
    return "pub_" + hmac.new(key, event_id.encode(), hashlib.sha256).hexdigest()[:16]

# Event types that are safe to mirror once projected by `redact_public_event`.
_PASSTHROUGH_KEYS: dict[str, tuple[str, ...]] = {
    # "bootstrap" marks a current-state replay rather than a live transition:
    # the client uses it to avoid letting a stale replay overwrite fresher
    # live state or reset its event-pinning clock.
    "agent_state": ("type", "event_id", "agent_id", "state", "ts", "bootstrap"),
    "routing_decision": ("type", "event_id", "agent_id", "tier", "reason", "complexity", "turn", "ts"),
    "cost_update": ("type", "event_id", "pavo_cents", "baseline_cents", "decisions", "tier_counts", "ts"),
    "event_waiting_for_user": ("type", "event_id", "agents", "count", "ts"),
    "event_finalized": ("type", "event_id", "outcome", "summary", "ts"),
}


def _aliased(payload: dict[str, Any]) -> dict[str, Any]:
    """Swap the real event id for its public alias."""
    if "event_id" in payload:
        payload["event_id"] = public_ref(str(payload["event_id"] or ""))
    return payload


def redact_public_event(event: dict[str, Any]) -> dict[str, Any] | None:
    """Return a public-safe copy of a dashboard event, or None to drop it.

    Every returned payload carries the event's public ALIAS in ``event_id``,
    never the real id — see ``public_ref``.
    """
    kind = event.get("type")
    if kind in _PASSTHROUGH_KEYS:
        return _aliased({k: event[k] for k in _PASSTHROUGH_KEYS[kind] if k in event})
    if kind == "fields_collected":
        fields = [str(f) for f in event.get("fields", [])]
        return _aliased({
            "type": kind,
            "event_id": event.get("event_id"),
            "turn": event.get("turn"),
            "fields": fields,
            # Values are already "[collected]" placeholders upstream; keep the
            # shape but never trust that — re-mask here.
            "values": {f: "[collected]" for f in fields},
            "ts": event.get("ts"),
        })
    if kind == "transcript_turn":
        return _aliased({
            "type": kind,
            "event_id": event.get("event_id"),
            "agent_id": event.get("agent_id"),
            "turn": event.get("turn"),
            "role": event.get("role"),
            # Dashboard events carry the tier as pavo_tier; keep that key so
            # the public swarm can color turns by tier too.
            "pavo_tier": event.get("pavo_tier"),
            "text": _TEXT_HIDDEN,
            "ts": event.get("ts"),
        })
    if kind == "reply_received":
        # An emailed reply exists for this move. The public surface learns the
        # sender's domain and when it arrived — never the subject or body.
        return _aliased({
            "type": kind,
            "event_id": event.get("event_id"),
            "from_domain": str(event.get("from_domain") or ""),
            "received_at": event.get("received_at"),
            "ts": event.get("ts"),
        })
    if kind == "sponsor_event":
        return _aliased({
            "type": kind,
            "event_id": event.get("event_id"),
            "sponsor": event.get("sponsor"),
            "kind": event.get("kind"),
            "status": event.get("status"),
            "agent_id": event.get("agent_id"),
            "detail": "[redacted]",
            "ts": event.get("ts"),
        })
    return None
