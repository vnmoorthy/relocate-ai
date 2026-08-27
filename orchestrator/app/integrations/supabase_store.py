"""Mirror move state into Supabase Postgres.

Why a mirror and not a replacement: SQLite is the orchestrator's source of
truth and it is proven — swapping it out wholesale days before a demo would
risk the thing that currently works. This writes through to Supabase on every
save, so the data lives in a real cloud database that survives the laptop,
while a Supabase outage or a bad key can never break a dispatch.

Every failure here is logged and swallowed. Nothing in this module is allowed
to make a specialist look like it failed when it did not.

Access is via the service key over PostgREST. Row-level security is on with no
policies, so the public anon key can read nothing — the mirror is server-side
only, which is why the browser never talks to Supabase directly.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

from ..config import settings

log = logging.getLogger(__name__)

_TIMEOUT = 10.0


def enabled() -> bool:
    return bool(settings.supabase_url.strip() and settings.supabase_service_key.strip())


def _headers() -> dict[str, str]:
    key = settings.supabase_service_key.strip()
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        # Upsert semantics: a move is saved many times over its life.
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }


async def _upsert(table: str, rows: list[dict[str, Any]]) -> bool:
    """POST rows to PostgREST. Returns False on any failure, never raises."""
    if not enabled() or not rows:
        return False
    url = f"{settings.supabase_url.rstrip('/')}/rest/v1/{table}"
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            res = await client.post(url, headers=_headers(), json=rows)
        if res.status_code >= 300:
            log.warning(
                "supabase upsert %s failed: %s %s", table, res.status_code, res.text[:200],
            )
            return False
        return True
    except Exception as exc:  # noqa: BLE001 - the mirror must never break a dispatch
        log.warning("supabase upsert %s errored: %s", table, exc)
        return False


def _iso(ts: float | None) -> str | None:
    if not ts:
        return None
    from datetime import datetime, timezone

    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


def _move_row(event: Any) -> dict[str, Any]:
    spec = event.spec or {}
    # Same arithmetic as the public tracker (main.py): count messages that
    # actually left, and none at all under demo routing, where every recipient
    # is rewritten to the operator's own inbox.
    outbound = 0 if settings.agentmail_demo_recipient_override.strip() else sum(
        int((c.bid or {}).get("count") or 0)
        for c in event.specialist_calls.values()
        if isinstance(c.bid, dict)
    )
    return {
        "id": event.id,
        "origin_channel": getattr(event, "origin_channel", "web"),
        "origin_address": str(spec.get("origin_address") or "") or None,
        "destination_address": str(spec.get("destination_address") or "") or None,
        "move_date": str(spec.get("move_date") or "") or None,
        "user_email": str(spec.get("user_email") or "") or None,
        "outbound_requests": outbound,
        "replies_received": len(event.replies),
        "started_at": _iso(event.started_at),
        "finalized_at": _iso(event.finalized_at),
        "final_outcome": event.final_outcome,
        "spec": spec,
    }


def _specialist_rows(event: Any) -> list[dict[str, Any]]:
    rows = []
    for agent_id, ctx in event.specialist_calls.items():
        bid = ctx.bid if isinstance(ctx.bid, dict) else None
        rows.append({
            "move_id": event.id,
            "agent_id": agent_id,
            "state": ctx.state,
            "terminal_outcome": ctx.terminal_outcome,
            "blocker_kind": ctx.blocker_kind,
            "playbook_title": (ctx.playbook or {}).get("title"),
            "missing_fields": list((bid or {}).get("missing_fields") or []),
            # The artifact can carry a prepared document body; keep the receipt
            # fields and drop the prose.
            "artifact": {
                k: v for k, v in (bid or {}).items() if k not in ("body", "text")
            } or None,
            "closed_at": _iso(ctx.closed_at),
        })
    return rows


def _reply_rows(event: Any) -> list[dict[str, Any]]:
    rows = []
    for reply in event.replies:
        message_id = str(reply.get("message_id") or "")
        if not message_id:
            continue
        rows.append({
            "message_id": message_id,
            "move_id": event.id,
            "agent_id": reply.get("agent_id"),
            "from_address": reply.get("from"),
            "from_domain": reply.get("from_domain"),
            "subject": reply.get("subject"),
            "quote": reply.get("quote"),
            "received_at": _iso(reply.get("received_at")),
        })
    return rows


async def mirror_event(event: Any) -> None:
    """Write one move and its children. Parent first — the children reference it."""
    if not enabled():
        return
    if not await _upsert("moves", [_move_row(event)]):
        return  # children would violate the foreign key
    await _upsert("move_specialists", _specialist_rows(event))
    await _upsert("move_replies", _reply_rows(event))


async def mirror_context(ctx: Any) -> None:
    if not enabled():
        return
    await _upsert("buyer_contexts", [{
        "call_id": ctx.call_id,
        "move_id": ctx.event_id,
        "channel": "voice" if ctx.call_id.startswith(("simcall_", "twl_")) else "web",
        "turn_count": ctx.turn_count,
        "dispatched": ctx.dispatched,
        "call_ended": ctx.call_ended,
        "collected": ctx.collected,
        "started_at": _iso(ctx.started_at),
    }])


def schedule(coro: Any) -> None:
    """Fire a mirror write without blocking the caller.

    State saves happen on hot paths (every turn, every specialist
    transition); the mirror must never add latency to them, and a mirror
    that is down must never stall a dispatch.
    """
    try:
        asyncio.get_running_loop().create_task(coro)
    except RuntimeError:
        # No loop (tests, sync startup) — drop it rather than block.
        coro.close()
