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
    from app.public_feed import public_ref

    assert redact_public_event({
        "type": "agent_state", "event_id": "e", "agent_id": "vet_transfer",
        "state": "submitted", "ts": 1.0, "secret_extra": "x",
    }) == {"type": "agent_state", "event_id": public_ref("e"), "agent_id": "vet_transfer",
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
    main._recent_intakes.clear()

    def body(i: int) -> dict:
        return {
            "origin_address": "1 A St, San Francisco, CA 94110",
            "destination_address": "2 B St, Austin, TX 78704",
            "move_date": "2030-09-30", "user_email": f"m{i}@test.invalid", "website": "",
        }

    codes = [
        client.post("/api/public/start-move", json=body(i)).status_code
        for i in range(main._INTAKE_PER_IP_MIN + 1)
    ]
    assert codes[:-1] == [200] * main._INTAKE_PER_IP_MIN and codes[-1] == 429


def test_public_intake_dedupes_identical_retry(monkeypatch: pytest.MonkeyPatch) -> None:
    client = TestClient(main.app)
    monkeypatch.setattr(main.settings, "enable_public_intake", True)
    monkeypatch.setattr(main, "fan_out", AsyncMock())
    monkeypatch.setattr(main, "_email_tracker_link", AsyncMock())
    monkeypatch.setattr(main.ws_broker, "broadcast", AsyncMock())
    main._recent_intakes.clear()
    body = {
        "origin_address": "1 A St, San Francisco, CA 94110",
        "destination_address": "2 B St, Austin, TX 78704",
        "move_date": "2030-09-30", "user_email": "same@test.invalid", "website": "",
    }
    first = client.post("/api/public/start-move", json=body).json()
    second = client.post("/api/public/start-move", json=body).json()
    assert second["event_id"] == first["event_id"]
    assert second.get("deduplicated") is True
    # Only ONE event was dispatched.
    assert len([e for e in state.events.values() if e.id == first["event_id"]]) == 1


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


def test_snapshot_replies_expose_domain_and_time_only(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.config import settings
    from app.state import MarketplaceEvent

    monkeypatch.setattr(settings, "enable_public_intake", True)
    client = TestClient(main.app)
    event = MarketplaceEvent(id="mkt_reply1", homeowner_call_id="call", spec={})
    event.replies.append({
        "message_id": "msg_1",
        "from": "quotes@uhaul.com",
        "from_domain": "uhaul.com",
        "subject": "Re: Quote [ref:mkt_reply1]",
        "preview": "OTD price $2,850 — call me at 555-0100",
        "received_at": 1_700_000_000.0,
    })
    state.events[event.id] = event

    body = client.get("/api/public/move/mkt_reply1").json()

    assert body["replies"] == [{
        "from_domain": "uhaul.com", "received_at": 1_700_000_000.0,
        "agent_id": None, "self_routed": False, "quote": None,
    }]
    dumped = str(body)
    assert "quotes@" not in dumped and "2,850" not in dumped and "msg_1" not in dumped


def test_public_feed_never_emits_the_real_event_id() -> None:
    """The real id is a capability: it unlocks /api/public/move/{id}, which
    carries the mover's street addresses. Every public projection — including
    the bootstrap replay a fresh anonymous socket receives — must carry the
    opaque alias instead."""
    from app.public_feed import public_ref

    real = "mkt_capability1"
    projections = [
        {"type": "agent_state", "event_id": real, "agent_id": "vet_transfer",
         "state": "submitted", "ts": 1.0},
        {"type": "transcript_turn", "event_id": real, "agent_id": "buyer", "turn": 1,
         "role": "user", "text": "private", "ts": 1.0},
        {"type": "fields_collected", "event_id": real, "turn": 1,
         "fields": ["user_email"], "values": {"user_email": "x@y.com"}, "ts": 1.0},
        {"type": "reply_received", "event_id": real, "from_domain": "uhaul.com",
         "received_at": 1.0, "ts": 1.0},
        {"type": "sponsor_event", "event_id": real, "sponsor": "agentmail",
         "kind": "receipt", "status": "reported", "agent_id": "a", "detail": "msg", "ts": 1.0},
        {"type": "event_finalized", "event_id": real, "outcome": "submitted",
         "summary": {"submitted_count": 1}, "ts": 1.0},
    ]
    for payload in projections:
        out = redact_public_event(payload)
        assert out is not None, payload["type"]
        assert real not in str(out), payload["type"]
        assert out["event_id"] == public_ref(real), payload["type"]


def test_snapshot_publishes_the_alias_so_a_tracker_can_correlate(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.config import settings
    from app.public_feed import public_ref
    from app.state import MarketplaceEvent

    monkeypatch.setattr(settings, "enable_public_intake", True)
    client = TestClient(main.app)
    event = MarketplaceEvent(id="mkt_alias1", homeowner_call_id="call", spec={})
    state.events[event.id] = event

    body = client.get("/api/public/move/mkt_alias1").json()

    assert body["public_ref"] == public_ref("mkt_alias1")
    assert body["public_ref"].startswith("pub_")


def test_intake_dedupe_does_not_hand_a_tracker_to_another_client(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The dedupe key is scoped to the client.

    A content-only key would return the victim's event_id — the tracker
    capability — to anyone able to guess route+date+email.
    """
    client = TestClient(main.app)
    monkeypatch.setattr(main.settings, "enable_public_intake", True)
    monkeypatch.setattr(main, "fan_out", AsyncMock())
    monkeypatch.setattr(main, "_email_tracker_link", AsyncMock())
    monkeypatch.setattr(main.ws_broker, "broadcast", AsyncMock())
    main._recent_intakes.clear()
    main._intake_hits.clear()
    main._intake_global.clear()
    body = {
        "origin_address": "1 A St, San Francisco, CA 94110",
        "destination_address": "2 B St, Austin, TX 78704",
        "move_date": "2030-09-30", "user_email": "victim@test.invalid", "website": "",
    }

    victim = client.post("/api/public/start-move", json=body).json()
    # Same content, different client address.
    attacker = client.post(
        "/api/public/start-move", json=body, headers={"X-Forwarded-For": "203.0.113.9"},
    ).json()

    assert attacker["event_id"] != victim["event_id"]
    assert attacker.get("deduplicated") is not True


def test_details_endpoint_unblocks_specialists(monkeypatch: pytest.MonkeyPatch) -> None:
    """A spoken call never asks for account numbers, so they arrive later.

    Supplying them must actually start the work, not just store the value —
    otherwise the customer typed them for nothing.
    """
    from app.config import settings
    from app.state import MarketplaceEvent, SpecialistCallContext

    monkeypatch.setattr(settings, "enable_public_intake", True)
    resumed: list[str] = []

    async def fake_resume(event_id: str) -> None:
        resumed.append(event_id)

    monkeypatch.setattr(main, "resume_ready_specialists", fake_resume)
    client = TestClient(main.app)
    main._unlock_hits.clear()

    event = MarketplaceEvent(
        id="mkt_unlock1", homeowner_call_id="web_x",
        spec={"origin_address": "1 A St, SF, CA 94103", "move_date": "2030-01-01"},
    )
    event.specialist_calls["pge_shutoff"] = SpecialistCallContext(
        call_id="pending", agent_id="pge_shutoff", event_id=event.id,
        state="needs-user-action", blocker_kind="missing_fields",
    )
    state.events[event.id] = event

    res = client.post(
        "/api/public/move/mkt_unlock1/details",
        json={"pge_account_number": "1234567890", "authorize_providers": True},
    )

    assert res.status_code == 200
    assert set(res.json()["accepted"]) == {
        "pge_account_number", "service_authorization_signed",
    }
    assert event.spec["pge_account_number"] == "1234567890"
    assert event.spec["service_authorization_signed"] is True
    assert resumed == ["mkt_unlock1"]
    # The values never come back out on a public surface.
    assert "1234567890" not in str(client.get("/api/public/move/mkt_unlock1").json())


def test_details_endpoint_rejects_junk_and_unknown_moves(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.config import settings

    monkeypatch.setattr(settings, "enable_public_intake", True)
    client = TestClient(main.app)
    main._unlock_hits.clear()

    assert client.post(
        "/api/public/move/mkt_nope/details", json={"pge_account_number": "1"},
    ).status_code == 404

    from app.state import MarketplaceEvent

    state.events["mkt_empty"] = MarketplaceEvent(
        id="mkt_empty", homeowner_call_id="w", spec={},
    )
    # A password is never an accepted field, so this supplies nothing usable.
    assert client.post(
        "/api/public/move/mkt_empty/details", json={"geico_password": "hunter2"},
    ).status_code == 400


def test_a_caller_cannot_mint_rate_limit_buckets_from_a_header(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """X-Forwarded-For is caller-controlled up to the trusted proxy.

    Cloudflare APPENDS the true visitor address, so the leftmost entry is
    whatever the client sent — reading it let one actor reset every per-IP
    limit at will simply by changing a header.
    """
    from app.config import settings
    from tests.test_loop1_backend_core import _request

    monkeypatch.setattr(settings, "trust_proxy_headers", True)

    spoofed = _request(b"{}", {"x-forwarded-for": "203.0.113.7, 9.9.9.9"})
    assert main._client_ip(spoofed) == "9.9.9.9"

    # Cloudflare overwrites this one on every request, so it wins outright.
    both = _request(b"{}", {
        "x-forwarded-for": "203.0.113.7", "cf-connecting-ip": "9.9.9.9",
    })
    assert main._client_ip(both) == "9.9.9.9"

    monkeypatch.setattr(settings, "trust_proxy_headers", False)
    assert main._client_ip(spoofed) != "203.0.113.7"
