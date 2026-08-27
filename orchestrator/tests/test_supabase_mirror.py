"""Supabase mirror: correct rows, and never able to break a dispatch.

SQLite stays the source of truth. This mirror exists so move data lives in a
real database that survives the laptop — but a Supabase outage, a bad key or
a schema drift must never turn a working specialist into a failed one.
"""

from __future__ import annotations

import asyncio
from collections.abc import Iterator

import pytest

from app.config import settings
from app.integrations import supabase_store
from app.state import MarketplaceEvent, SpecialistCallContext


@pytest.fixture(autouse=True)
def _configured(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setattr(settings, "supabase_url", "https://project.supabase.co")
    monkeypatch.setattr(settings, "supabase_service_key", "test-service-key")
    yield


def _event() -> MarketplaceEvent:
    event = MarketplaceEvent(
        id="mkt_mirror1", homeowner_call_id="web_x",
        spec={
            "origin_address": "950 Howard St, San Francisco, CA",
            "destination_address": "4700 Duval St, Austin, TX",
            "move_date": "2027-05-06",
            "user_email": "mover@test.invalid",
        },
        origin_channel="demo",
    )
    ctx = SpecialistCallContext(
        call_id="c", agent_id="mover_quote", event_id=event.id, state="submitted",
    )
    ctx.bid = {"intended": 3, "count": 1, "messages": [{"message_id": "m1"}]}
    ctx.terminal_outcome = "submitted"
    event.specialist_calls["mover_quote"] = ctx
    event.replies.append({
        "message_id": "<abc@mail>", "from": "quotes@uhaul.com",
        "from_domain": "uhaul.com", "subject": "Re: quote", "agent_id": "mover_quote",
        "quote": {"total_display": "$2,980"}, "received_at": 1_700_000_000.0,
    })
    return event


def test_rows_carry_the_facts_the_tracker_shows(monkeypatch: pytest.MonkeyPatch) -> None:
    sent: dict[str, list] = {}

    async def fake_upsert(table: str, rows: list) -> bool:
        sent[table] = rows
        return True

    monkeypatch.setattr(supabase_store, "_upsert", fake_upsert)
    asyncio.run(supabase_store.mirror_event(_event()))

    move = sent["moves"][0]
    assert move["id"] == "mkt_mirror1"
    assert move["origin_channel"] == "demo"
    # Outbound counts messages that actually left, matching the tracker's
    # headline. `intended` is 3 here; crediting it would report two sends that
    # never happened.
    assert move["outbound_requests"] == 1
    assert move["replies_received"] == 1
    assert move["started_at"].endswith("+00:00")

    specialist = sent["move_specialists"][0]
    assert specialist["agent_id"] == "mover_quote"
    assert specialist["state"] == "submitted"

    reply = sent["move_replies"][0]
    assert reply["from_domain"] == "uhaul.com"
    assert reply["quote"] == {"total_display": "$2,980"}


def test_children_are_skipped_when_the_parent_write_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Foreign keys point at moves; writing children first would just error."""
    calls: list[str] = []

    async def failing_parent(table: str, rows: list) -> bool:
        calls.append(table)
        return table != "moves"

    monkeypatch.setattr(supabase_store, "_upsert", failing_parent)
    asyncio.run(supabase_store.mirror_event(_event()))
    assert calls == ["moves"]


def test_a_broken_mirror_never_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    """State saves sit on hot paths; the mirror must swallow everything."""

    class Boom:
        def __init__(self, *a, **k) -> None: ...
        async def __aenter__(self):
            raise RuntimeError("supabase unreachable")
        async def __aexit__(self, *a): ...

    monkeypatch.setattr(supabase_store.httpx, "AsyncClient", Boom)
    assert asyncio.run(supabase_store._upsert("moves", [{"id": "x"}])) is False


def test_disabled_without_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "supabase_service_key", "")
    assert supabase_store.enabled() is False
    # And a mirror call is a no-op rather than an error.
    asyncio.run(supabase_store.mirror_event(_event()))


def test_artifact_prose_is_not_mirrored(monkeypatch: pytest.MonkeyPatch) -> None:
    """Prepared documents carry long bodies; the mirror keeps receipts only."""
    sent: dict[str, list] = {}

    async def fake_upsert(table: str, rows: list) -> bool:
        sent[table] = rows
        return True

    monkeypatch.setattr(supabase_store, "_upsert", fake_upsert)
    event = _event()
    event.specialist_calls["mover_quote"].bid = {
        "kind": "prepared_section", "title": "Housing", "body": "x" * 5000,
    }
    asyncio.run(supabase_store.mirror_event(event))
    artifact = sent["move_specialists"][0]["artifact"]
    assert "body" not in artifact and artifact["title"] == "Housing"
