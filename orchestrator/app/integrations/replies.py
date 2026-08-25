"""Inbound reply ingestion — closes the request → response loop.

Every outbound specialist email carries ``[ref:<event_id>]`` in its subject
(added in ``_send_via_agentmail``). This module polls the AgentMail inbox,
correlates replies back to their move via that tag, attaches them to the
event, and broadcasts so the dashboard and the public move page update live.

Honesty rules carried over:
- A reply is recorded as received — it is never auto-actioned, never used to
  flip a specialist to "completed". Reading and deciding stays with the user.
- Only redacted facts (sender domain, subject line, timestamp) ever reach the
  public surfaces; full bodies stay server-side.
- Dedupe is durable: seen message ids live in the SQLite mail ledger, so a
  restart never re-announces old replies.
"""
from __future__ import annotations

import asyncio
import logging
import re
import time
from typing import Any

from ..config import settings
from ..persistence import persistence
from ..state import state
from ..ws import ws_broker

log = logging.getLogger(__name__)

_REF_RE = re.compile(r"\[ref:(mkt_[0-9a-f]{4,})\]")
_ADDR_RE = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
POLL_INTERVAL_S = 45
# First poll looks back this far; afterwards a high-water mark (with overlap)
# keeps listings small. The ledger makes overlap harmless.
_FIRST_LOOKBACK_S = 7 * 24 * 3600
_OVERLAP_S = 300

_seen_ids: set[str] = set()
_high_water: float = 0.0


def note_outbound(message_id: str, event_id: str | None) -> None:
    """Ledger an id we just sent so polling never re-ingests our own mail."""
    if not message_id:
        return
    _seen_ids.add(message_id)
    persistence.record_mail(message_id, "outbound", event_id)


def extract_ref(subject: str | None) -> str | None:
    if not subject:
        return None
    m = _REF_RE.search(subject)
    return m.group(1) if m else None


def summarize_reply(msg: dict[str, Any]) -> dict[str, Any]:
    """Reduce a raw inbound message to what the event stores.

    The stored record is the operator-visible artifact; the public snapshot
    redacts it further (domain + subject only).
    """
    raw_sender = str(msg.get("from") or "")
    # Senders arrive as either "addr@x.com" or "Display Name <addr@x.com>".
    addr_match = _ADDR_RE.search(raw_sender)
    sender = addr_match.group(0).lower() if addr_match else raw_sender
    domain = sender.rsplit("@", 1)[-1] if "@" in sender else ""
    preview = str(msg.get("preview") or msg.get("text") or "")[:400]
    return {
        "message_id": str(msg.get("message_id") or ""),
        "from": sender,
        "from_domain": domain,
        "subject": str(msg.get("subject") or "")[:200],
        "preview": preview,
        "received_at": float(msg.get("timestamp") or time.time()),
    }


def _list_inbox_sync(after_epoch: float) -> list[dict[str, Any]]:
    """Blocking SDK call — run via asyncio.to_thread."""
    from datetime import datetime, timezone

    from agentmail import AgentMail

    from .agentmail import _resolve_inbox

    client = AgentMail(api_key=settings.agentmail_api_key)
    inbox_id = _resolve_inbox(client)
    page = client.inboxes.messages.list(
        inbox_id,
        limit=50,
        after=datetime.fromtimestamp(after_epoch, tz=timezone.utc),
        ascending=False,
    )
    out: list[dict[str, Any]] = []
    for item in getattr(page, "messages", None) or []:
        ts = getattr(item, "timestamp", None)
        out.append({
            "message_id": getattr(item, "message_id", None) or getattr(item, "id", ""),
            "from": getattr(item, "from_", None) or getattr(item, "from_address", ""),
            "subject": getattr(item, "subject", "") or "",
            "preview": getattr(item, "preview", "") or "",
            "timestamp": ts.timestamp() if hasattr(ts, "timestamp") else time.time(),
            "labels": list(getattr(item, "labels", None) or []),
        })
    return out


async def ingest_once() -> int:
    """One poll cycle. Returns how many new replies were attached."""
    global _high_water
    after = (_high_water - _OVERLAP_S) if _high_water else (time.time() - _FIRST_LOOKBACK_S)
    messages = await asyncio.to_thread(_list_inbox_sync, after)
    attached = 0
    for msg in messages:
        mid = str(msg.get("message_id") or "")
        if not mid or mid in _seen_ids:
            continue
        _seen_ids.add(mid)
        ts = float(msg.get("timestamp") or 0.0)
        _high_water = max(_high_water, ts)
        ref = extract_ref(msg.get("subject"))
        event = state.events.get(ref) if ref else None
        if event is None:
            # Not a correlated reply (or our own outbound, already in the
            # ledger). Remember the id so it is never re-parsed.
            persistence.record_mail(mid, "ignored", None)
            continue
        reply = summarize_reply(msg)
        event.replies.append(reply)
        state.save_event(event)
        persistence.record_mail(mid, "inbound", event.id)
        attached += 1
        log.info("reply attached: event=%s from=%s", event.id, reply["from_domain"])
        await ws_broker.broadcast({
            "type": "reply_received",
            "event_id": event.id,
            "from_domain": reply["from_domain"],
            "subject": reply["subject"],
            "received_at": reply["received_at"],
            "ts": time.time(),
        })
    return attached


async def reply_poll_loop() -> None:
    """Background task started from the app lifespan when AgentMail is configured."""
    _seen_ids.update(persistence.load_mail_ids())
    log.info("reply poller up: interval=%ss ledger=%d ids", POLL_INTERVAL_S, len(_seen_ids))
    while True:
        try:
            await ingest_once()
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # provider hiccups must never kill the loop
            log.warning("reply poll failed (will retry): %s", exc)
        await asyncio.sleep(POLL_INTERVAL_S)
