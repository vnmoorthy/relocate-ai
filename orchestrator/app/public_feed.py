"""Public, unauthenticated live feed: a redacted projection of dashboard events.

The authenticated dashboard stream carries transcript text and provider
artifact details. The public website cannot hold a secret, so it subscribes to
this projection instead: same event shapes, with every free-text or identifier
field blanked server-side. Nothing here depends on the client behaving.
"""
from __future__ import annotations

from typing import Any

_TEXT_HIDDEN = ""  # the dashboard renders its own "transcript hidden" placeholder

# Event types that are safe to mirror once projected by `redact_public_event`.
_PASSTHROUGH_KEYS: dict[str, tuple[str, ...]] = {
    "agent_state": ("type", "event_id", "agent_id", "state", "ts"),
    "routing_decision": ("type", "event_id", "agent_id", "tier", "reason", "complexity", "turn", "ts"),
    "cost_update": ("type", "event_id", "pavo_cents", "baseline_cents", "decisions", "tier_counts", "ts"),
    "event_waiting_for_user": ("type", "event_id", "agents", "count", "ts"),
    "event_finalized": ("type", "event_id", "outcome", "summary", "ts"),
}


def redact_public_event(event: dict[str, Any]) -> dict[str, Any] | None:
    """Return a public-safe copy of a dashboard event, or None to drop it."""
    kind = event.get("type")
    if kind in _PASSTHROUGH_KEYS:
        return {k: event[k] for k in _PASSTHROUGH_KEYS[kind] if k in event}
    if kind == "fields_collected":
        fields = [str(f) for f in event.get("fields", [])]
        return {
            "type": kind,
            "event_id": event.get("event_id"),
            "turn": event.get("turn"),
            "fields": fields,
            # Values are already "[collected]" placeholders upstream; keep the
            # shape but never trust that — re-mask here.
            "values": {f: "[collected]" for f in fields},
            "ts": event.get("ts"),
        }
    if kind == "transcript_turn":
        return {
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
        }
    if kind == "reply_received":
        # An emailed reply exists for this move. The public surface learns the
        # sender's domain and when it arrived — never the subject or body.
        return {
            "type": kind,
            "event_id": event.get("event_id"),
            "from_domain": str(event.get("from_domain") or ""),
            "received_at": event.get("received_at"),
            "ts": event.get("ts"),
        }
    if kind == "sponsor_event":
        return {
            "type": kind,
            "event_id": event.get("event_id"),
            "sponsor": event.get("sponsor"),
            "kind": event.get("kind"),
            "status": event.get("status"),
            "agent_id": event.get("agent_id"),
            "detail": "[redacted]",
            "ts": event.get("ts"),
        }
    return None
