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
from datetime import datetime, timezone
from typing import Any

from ..config import settings
from ..persistence import persistence
from ..state import state
from ..ws import ws_broker

log = logging.getLogger(__name__)

_REF_RE = re.compile(r"\[ref:(mkt_[0-9a-f]{4,})(?::([a-z_]+))?\]")
_ADDR_RE = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_MONEY_RE = re.compile(r"\$\s*([0-9][\d,]*(?:\.\d{2})?)")
_TOTAL_RE = re.compile(
    r"(?:out[-\s]the[-\s]door|otd|total|all[-\s]in|price|quote)\D{0,30}"
    r"\$\s*([0-9][\d,]*(?:\.\d{2})?)",
    re.IGNORECASE,
)
# Both phrasings appear in the wild: "deposit: $300" and "$300 deposit".
_DEPOSIT_RE = re.compile(
    r"deposit\D{0,30}\$\s*([0-9][\d,]*(?:\.\d{2})?)"
    r"|\$\s*([0-9][\d,]*(?:\.\d{2})?)\s*(?:\w+\s+)?deposit",
    re.IGNORECASE,
)
_AVAILABILITY_RE = re.compile(r"\b(?:confirmed?|available|availability)\b", re.IGNORECASE)
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


def extract_ref(subject: str | None) -> tuple[str, str | None] | None:
    """(event_id, agent_id|None) from a tagged subject, or None."""
    if not subject:
        return None
    m = _REF_RE.search(subject)
    return (m.group(1), m.group(2)) if m else None


def parse_quote(text: str) -> dict[str, Any] | None:
    """Deterministic quote extraction from a counterparty's reply text.

    Regex-only on purpose: an extracted number is either literally present in
    the email or absent — nothing is inferred. Returns None when no dollar
    amount appears at all.
    """
    if not text:
        return None
    amounts = _MONEY_RE.findall(text)
    if not amounts:
        return None
    labeled = _TOTAL_RE.search(text)
    if labeled:
        total = labeled.group(1)
    else:
        # No labeled total: the largest amount is the best candidate.
        total = max(amounts, key=lambda a: float(a.replace(",", "")))
    deposit = _DEPOSIT_RE.search(text)
    deposit_amount = (deposit.group(1) or deposit.group(2)) if deposit else None
    return {
        "total_display": f"${total}",
        "deposit_display": f"${deposit_amount}" if deposit_amount else None,
        "availability": bool(_AVAILABILITY_RE.search(text)),
    }


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
        ts_epoch = ts.timestamp() if isinstance(ts, datetime) else time.time()
        out.append({
            "message_id": getattr(item, "message_id", None) or getattr(item, "id", ""),
            "from": getattr(item, "from_", None) or getattr(item, "from_address", ""),
            "subject": getattr(item, "subject", "") or "",
            "preview": getattr(item, "preview", "") or "",
            "timestamp": ts_epoch,
            "labels": list(getattr(item, "labels", None) or []),
        })
    return out


def _get_message_text_sync(message_id: str) -> str:
    """Blocking SDK fetch of one message's full text — run via to_thread."""
    from agentmail import AgentMail

    from .agentmail import _resolve_inbox

    client = AgentMail(api_key=settings.agentmail_api_key)
    inbox_id = _resolve_inbox(client)
    msg = client.inboxes.messages.get(inbox_id, message_id)
    return str(getattr(msg, "text", None) or getattr(msg, "preview", None) or "")


async def ingest_once() -> int:
    """One poll cycle. Returns how many new replies were attached."""
    global _high_water
    after = (_high_water - _OVERLAP_S) if _high_water else (time.time() - _FIRST_LOOKBACK_S)
    # A hung provider call must never wedge the poll loop silently.
    messages = await asyncio.wait_for(asyncio.to_thread(_list_inbox_sync, after), timeout=30)
    attached = 0
    for msg in messages:
        mid = str(msg.get("message_id") or "")
        if not mid or mid in _seen_ids:
            continue
        _seen_ids.add(mid)
        ts = float(msg.get("timestamp") or 0.0)
        _high_water = max(_high_water, ts)
        ref = extract_ref(msg.get("subject"))
        event = state.events.get(ref[0]) if ref else None
        if event is None:
            # Not a correlated reply (or our own outbound, already in the
            # ledger). Remember the id so it is never re-parsed.
            persistence.record_mail(mid, "ignored", None)
            continue
        reply = summarize_reply(msg)
        reply["agent_id"] = ref[1] if ref else None
        # Fetch the full body for quote extraction — the listing only carries
        # a preview. Best-effort: a fetch failure degrades to preview parsing.
        full_text = str(msg.get("preview") or "")
        try:
            full_text = await asyncio.wait_for(
                asyncio.to_thread(_get_message_text_sync, mid), timeout=20,
            ) or full_text
        except Exception as exc:  # noqa: BLE001
            log.warning("full-body fetch failed for %s: %s", mid, exc)
        reply["quote"] = parse_quote(full_text)
        event.replies.append(reply)
        # Thread the reply onto the specialist that solicited it, so the
        # dashboard artifact shows the inbound half of the exchange.
        agent_ctx = event.specialist_calls.get(reply.get("agent_id") or "")
        if agent_ctx is not None and isinstance(agent_ctx.bid, dict):
            agent_ctx.bid["replies_received"] = int(agent_ctx.bid.get("replies_received") or 0) + 1
        state.save_event(event)
        persistence.record_mail(mid, "inbound", event.id)
        await _forward_reply_to_user(event, reply, full_text)
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


async def _forward_reply_to_user(event: Any, reply: dict[str, Any], full_text: str) -> None:
    """Forward an ingested reply to the mover's own inbox.

    The move page tells the user "the full message is in your inbox" — this
    is what makes that sentence true. Best-effort: allowlist blocks and
    provider failures are logged and never fail ingestion. Never forwards the
    user's own messages back at them (echo guard).
    """
    user_email = str(event.spec.get("user_email") or "").strip()
    sender = str(reply.get("from") or "").strip()
    if not user_email or sender.lower() == user_email.lower():
        return
    agent_hint = reply.get("agent_id") or "your move"
    try:
        from .agentmail import _send_via_agentmail

        await _send_via_agentmail(
            event_id=event.id,
            agent_id="concierge",
            to=user_email,
            # The original subject keeps its [ref:] tag, so replying to this
            # forward threads straight back into the same move.
            subject=f"Reply from {reply.get('from_domain') or 'counterparty'}: "
                    f"{str(reply.get('subject') or '')[:120]}",
            body=(
                f"{sender} replied to the {agent_hint} request:\n\n"
                f"{full_text[:4000]}\n\n"
                f"--\nForwarded by Relocate. Reply to this email to continue "
                f"the thread on your move.\n"
            ),
        )
        log.info("reply forwarded to user: event=%s from=%s", event.id, reply.get("from_domain"))
    except Exception as exc:  # noqa: BLE001 - forwarding must never fail ingestion
        log.warning("reply forward failed (event=%s): %s", event.id, exc)


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
