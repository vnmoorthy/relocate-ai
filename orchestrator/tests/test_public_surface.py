"""Public website surface: redacted live feed + rate-limited web intake."""

from __future__ import annotations

import asyncio
from collections.abc import Iterator
from typing import Any
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from app import main
from app.public_feed import redact_public_event
from app.state import state
from app.ws import ws_broker


@pytest.fixture(autouse=True)
def _clean() -> Iterator[None]:
    state.buyer_contexts.clear()
    state.events.clear()
    main._intake_hits.clear()
    main._intake_global.clear()
    yield
    state.buyer_contexts.clear()
    state.events.clear()


def test_redaction_blanks_text_and_identifiers_but_keeps_state() -> None:
    assert redact_public_event({
        "type": "agent_state", "event_id": "e", "agent_id": "vet_transfer",
        "state": "submitted", "ts": 1.0, "secret_extra": "x",
    }) == {"type": "agent_state", "event_id": "e", "agent_id": "vet_transfer",
           "state": "submitted", "ts": 1.0}
    turn = redact_public_event({
        "type": "transcript_turn", "event_id": "e", "agent_id": "buyer", "turn": 2,
        "role": "user", "text": "my SSN is 123-45-6789", "ts": 1.0,
    })
    assert turn is not None and turn["text"] == "" and turn["role"] == "user"
    fields = redact_public_event({
        "type": "fields_collected", "event_id": "e", "turn": 1,
        "fields": ["user_email"], "values": {"user_email": "real@person.com"}, "ts": 1.0,
    })
    assert fields is not None and fields["values"] == {"user_email": "[collected]"}
    sponsor = redact_public_event({
        "type": "sponsor_event", "event_id": "e", "sponsor": "AgentMail", "kind": "receipt",
        "status": "reported", "detail": "msg_abc123 to jane@x.com", "ts": 1.0,
    })
    assert sponsor is not None and sponsor["detail"] == "[redacted]"
    assert redact_public_event({"type": "unknown_internal", "payload": "x"}) is None


def test_public_ws_receives_redacted_mirror_without_a_token() -> None:
    client = TestClient(main.app)
    with client.websocket_connect("/ws/public") as ws:
        asyncio.run(ws_broker.broadcast({
            "type": "transcript_turn", "event_id": "e", "agent_id": "buyer", "turn": 1,
            "role": "agent", "text": "private words", "ts": 1.0,
        }))
        received = ws.receive_json()
    assert received["type"] == "transcript_turn"
    assert received["text"] == ""


def test_public_intake_is_closed_by_default_and_opens_with_flag(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = TestClient(main.app)
    body = {
        "origin_address": "742 Valencia St, San Francisco, CA 94110",
        "destination_address": "1901 Barton Springs Rd, Austin, TX 78704",
        "move_date": "2030-09-30", "user_email": "mover@test.invalid",
        "has_pets": True, "has_children": False, "has_car": True, "has_visa": False,
        "website": "",
    }
    assert client.post("/api/public/start-move", json=body).status_code == 503

    fanouts: list[str] = []

    async def fake_fan_out(event_id: str, _spec: dict[str, Any]) -> None:
        fanouts.append(event_id)

    monkeypatch.setattr(main.settings, "enable_public_intake", True)
    monkeypatch.setattr(main, "fan_out", fake_fan_out)
    monkeypatch.setattr(main.ws_broker, "broadcast", AsyncMock())

    # honeypot
    assert client.post("/api/public/start-move", json={**body, "website": "bot"}).status_code == 400
    # invalid date
    assert client.post("/api/public/start-move", json={**body, "move_date": "soon"}).status_code == 400

    resp = client.post("/api/public/start-move", json=body)
    assert resp.status_code == 200
    event_id = resp.json()["event_id"]
    assert event_id in state.events
    assert state.events[event_id].spec["has_pets"] is True
    ctx = state.buyer_contexts[f"web_{event_id[4:]}"]
    assert ctx.dispatched is True and ctx.call_ended is True
    assert fanouts == [event_id]


def test_public_intake_rate_limits_per_ip(monkeypatch: pytest.MonkeyPatch) -> None:
    client = TestClient(main.app)
    monkeypatch.setattr(main.settings, "enable_public_intake", True)
    monkeypatch.setattr(main, "fan_out", AsyncMock())
    monkeypatch.setattr(main.ws_broker, "broadcast", AsyncMock())
    body = {
        "origin_address": "1 A St, San Francisco, CA 94110",
        "destination_address": "2 B St, Austin, TX 78704",
        "move_date": "2030-09-30", "user_email": "m@test.invalid", "website": "",
    }
    codes = [client.post("/api/public/start-move", json=body).status_code for _ in range(6)]
    assert codes[:5] == [200] * 5 and codes[5] == 429


def test_public_move_snapshot_is_redacted(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.state import MarketplaceEvent, SpecialistCallContext

    client = TestClient(main.app)
    event = MarketplaceEvent(
        id="mkt_snapshot1", homeowner_call_id="web_x",
        spec={
            "origin_address": "1 A St, SF, CA 94110", "destination_address": "2 B St, Austin, TX 78704",
            "move_date": "2030-09-30", "user_email": "secret@person.com", "user_phone": "+14155550100",
            "has_pets": True,
        },
    )
    event.specialist_calls["mover_quote"] = SpecialistCallContext(
        call_id="pending", agent_id="mover_quote", event_id=event.id,
        state="needs-user-action", terminal_outcome="needs_user_action",
        blocker_kind="recipient_not_allowlisted",
        blockers=["outbound email blocked: customer.service@uhaul.com"],
        bid={"outcome": "needs_user_action"},
    )
    state.events[event.id] = event

    assert client.get("/api/public/move/mkt_snapshot1").status_code == 503
    monkeypatch.setattr(main.settings, "enable_public_intake", True)
    assert client.get("/api/public/move/mkt_nope").status_code == 404
    body = client.get("/api/public/move/mkt_snapshot1").json()
    assert body["route"]["origin_address"].startswith("1 A St")
    assert body["specialists"][0]["blocker_kind"] == "recipient_not_allowlisted"
    dumped = str(body)
    assert "secret@person.com" not in dumped
    assert "+1415" not in dumped
    assert "uhaul" not in dumped  # raw blocker strings never leave the server


def test_public_intake_accepts_optional_household_details(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = TestClient(main.app)
    monkeypatch.setattr(main.settings, "enable_public_intake", True)
    monkeypatch.setattr(main, "fan_out", AsyncMock())
    monkeypatch.setattr(main.ws_broker, "broadcast", AsyncMock())
    resp = client.post("/api/public/start-move", json={
        "origin_address": "742 Valencia St, San Francisco, CA 94110",
        "destination_address": "1901 Barton Springs Rd, Austin, TX 78704",
        "move_date": "2030-10-15", "user_email": "mover@test.invalid",
        "has_pets": True, "has_children": True,
        "child_name": "Sam", "child_grade": "3",
        "pet_name": "Biscuit", "pet_species": "dog", "vet_email": "records@vet.invalid",
        "user_name": "Jane Smith",
        "vet_email_bogus": "ignored", "bank_name": "",
        "website": "",
    })
    assert resp.status_code == 200
    spec = state.events[resp.json()["event_id"]].spec
    assert spec["child_name"] == "Sam" and spec["pet_species"] == "dog"
    assert spec["vet_email"] == "records@vet.invalid"
    assert "bank_name" not in spec  # empty strings are dropped, not stored
