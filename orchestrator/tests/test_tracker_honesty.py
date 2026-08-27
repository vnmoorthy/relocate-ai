"""The tracker may only claim what the system can prove.

"Submitted" on this product means a provider ACCEPTED a request. These tests
pin the three ways that claim used to be made without proof: prepared
artifacts broadcast as submitted work, intended recipients counted as sends,
and demo routing — which reroutes every outbound message to the operator's own
inbox — reported as contact with real providers.
"""

from __future__ import annotations

import asyncio
from collections.abc import Iterator
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from app import main, marketplace
from app.config import settings
from app.personas import by_id
from app.public_feed import redact_public_event
from app.state import MarketplaceEvent, SpecialistCallContext, state
from app.ws import ws_broker


SPEC = {
    "origin_address": "950 Howard St, San Francisco, CA 94103",
    "destination_address": "4700 Duval St, Austin, TX 78751",
    "move_date": "2027-10-20",
    "user_email": "mover@test.invalid",
}


@pytest.fixture(autouse=True)
def _clean(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    state.events.clear()
    main._snapshot_hits.clear()
    monkeypatch.setattr(settings, "enable_public_intake", True)
    yield
    state.events.clear()


def _event(event_id: str = "mkt_honest") -> MarketplaceEvent:
    event = MarketplaceEvent(id=event_id, homeowner_call_id="call", spec=dict(SPEC))
    state.events[event_id] = event
    return event


def _call(
    event: MarketplaceEvent, agent_id: str, *, state_: str, outcome: str, bid: dict,
) -> SpecialistCallContext:
    ctx = SpecialistCallContext(
        call_id="c", agent_id=agent_id, event_id=event.id, state=state_,
    )
    ctx.terminal_outcome = outcome
    ctx.bid = bid
    event.specialist_calls[agent_id] = ctx
    return ctx


def _snapshot(event_id: str) -> dict:
    res = TestClient(main.app).get(f"/api/public/move/{event_id}")
    assert res.status_code == 200, res.text
    return res.json()


# ── prepared work is not provider acceptance ──────────────────────────


def test_agent_state_broadcasts_carry_the_outcome_not_just_the_state(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`state` is a lifecycle marker; `terminal_outcome` is the claim.

    A surface that sees only "submitted" cannot tell a request a provider took
    from a document we wrote — and it was labelling both as accepted.
    """
    persona = by_id("housing_search")
    event = _event("mkt_prepared_wire")
    event.specialist_calls[persona.agent_id] = SpecialistCallContext(
        call_id="pending", agent_id=persona.agent_id, event_id=event.id,
    )
    sent: list[dict] = []

    async def capture(payload: dict) -> None:
        sent.append(payload)

    monkeypatch.setattr(ws_broker, "broadcast", capture)
    asyncio.run(marketplace._run_one(persona, event.id, dict(SPEC)))

    states = [m for m in sent if m["type"] == "agent_state" and m["state"] == "submitted"]
    assert states and states[-1]["terminal_outcome"] == "prepared_for_user"
    # And it survives the public projector, which drops unlisted keys.
    public = redact_public_event(dict(states[-1]))
    assert public is not None and public["terminal_outcome"] == "prepared_for_user"

    # The public transcript line must not borrow provider vocabulary either.
    summary = [m for m in sent if m["type"] == "transcript_turn"][-1]["text"]
    assert "request submitted" not in summary
    assert "prepared for you" in summary.lower()


def test_bootstrap_replay_carries_the_outcome_too() -> None:
    """A viewer who connects after dispatch gets the same truth as one who
    watched it happen live."""
    event = _event("mkt_bootstrap")
    _call(event, "housing_search", state_="submitted",
          outcome="prepared_for_user", bid={"kind": "prepared_section"})

    msg = main._bootstrap_messages()[0]
    assert msg["state"] == "submitted"
    assert msg["terminal_outcome"] == "prepared_for_user"


def test_workspace_counts_prepared_separately_from_submitted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The workspace chip reads "Submitted" as provider acceptance. Prepared
    artifacts reached nobody, so they get their own count."""
    monkeypatch.setattr(settings, "demo_username", "demo")
    monkeypatch.setattr(settings, "demo_password", "onlyfordemopurposes")
    main._demo_login_hits.clear()

    event = _event("mkt_ws_counts")
    event.origin_channel = "demo"
    _call(event, "housing_search", state_="submitted",
          outcome="prepared_for_user", bid={"kind": "prepared_section"})
    _call(event, "flight_book", state_="submitted",
          outcome="prepared_for_user", bid={"count": 1, "intended": 1})
    _call(event, "spectrum_austin", state_="submitted",
          outcome="submitted", bid={"count": 1, "intended": 1})

    client = TestClient(main.app)
    token = client.post(
        "/api/public/demo-login",
        json={"username": "demo", "password": "onlyfordemopurposes"},
    ).json()["token"]
    body = client.get(
        "/api/public/demo/moves", headers={"Authorization": f"Bearer {token}"},
    ).json()

    counts = body["moves"][0]["counts"]
    assert counts["submitted"] == 1
    assert counts["prepared"] == 2


def test_finalized_summary_does_not_inflate_submitted_with_prepared(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    event = _event("mkt_final_counts")
    _call(event, "housing_search", state_="submitted",
          outcome="prepared_for_user", bid={"kind": "prepared_section"})
    _call(event, "spectrum_austin", state_="submitted",
          outcome="submitted", bid={"count": 1, "intended": 1})
    sent: list[dict] = []

    async def capture(payload: dict) -> None:
        sent.append(payload)

    monkeypatch.setattr(ws_broker, "broadcast", capture)
    monkeypatch.setattr(marketplace.am, "send_move_package", AsyncMock(return_value=None))
    asyncio.run(marketplace.finalize_event(event.id))

    summary = [m for m in sent if m["type"] == "event_finalized"][-1]["summary"]
    assert summary["submitted_count"] == 1
    assert summary["prepared_count"] == 1


# ── the headline number counts proof, not intent ──────────────────────


def test_outbound_counts_messages_that_left_not_recipients_addressed() -> None:
    """`intended` is who the request was addressed to; `count` is what left.

    safe_call swallows a per-recipient failure, so a 1-of-3 fan-out used to
    read exactly like a complete one — a failure laundered into green.
    """
    event = _event("mkt_partial")
    _call(event, "mover_quote", state_="submitted", outcome="submitted",
          bid={"count": 1, "intended": 3, "messages": [{"message_id": "m1"}]})

    body = _snapshot(event.id)
    assert body["outbound_requests"] == 1
    assert body["demo_routing"] is False
    did = body["specialists"][0]["did"]
    assert did == "Requested from 1 of 3 providers"


def test_a_send_that_never_happened_claims_nothing() -> None:
    event = _event("mkt_nosend")
    _call(event, "mover_quote", state_="submitted", outcome="submitted",
          bid={"count": 0, "intended": 3, "messages": []})
    _call(event, "flight_book", state_="submitted", outcome="prepared_for_user",
          bid={"count": 0, "intended": 1, "messages": []})

    body = _snapshot(event.id)
    assert body["outbound_requests"] == 0
    assert [s["did"] for s in body["specialists"]] == [None, None]


# ── demo routing contacted nobody ─────────────────────────────────────


def test_demo_routing_reports_zero_providers_contacted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Every send is rewritten to the operator's own inbox, so no provider was
    contacted however many messages went out. The tracker is told, because it
    cannot infer it."""
    monkeypatch.setattr(
        settings, "agentmail_demo_recipient_override", "operator@test.invalid",
    )
    event = _event("mkt_demoroute")
    _call(event, "mover_quote", state_="submitted", outcome="submitted",
          bid={"count": 1, "intended": 3,
               "messages": [{"to": "operator@test.invalid"}]})

    body = _snapshot(event.id)
    assert body["demo_routing"] is True
    assert body["outbound_requests"] == 0
    did = body["specialists"][0]["did"]
    assert "no provider was contacted" in did
    assert not did.startswith("Requested from")


def test_a_reply_from_the_demo_inbox_is_flagged_as_self_routed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """These are this deployment answering itself. Badging one "LOWEST"
    beside a real quote would dress operator-written text up as a market."""
    monkeypatch.setattr(
        settings, "agentmail_demo_recipient_override", "operator@test.invalid",
    )
    event = _event("mkt_selfreply")
    event.replies.append({
        "message_id": "m1", "from": "operator@test.invalid",
        "from_domain": "test.invalid", "received_at": 1_700_000_000.0,
    })
    event.replies.append({
        "message_id": "m2", "from": "quotes@uhaul.com",
        "from_domain": "uhaul.com", "received_at": 1_700_000_001.0,
    })

    body = _snapshot(event.id)
    assert [r["self_routed"] for r in body["replies"]] == [True, False]


def test_a_rerouted_playbook_digest_is_not_reported_as_delivered(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A provider receipt proves the message was accepted, not that it reached
    the customer — demo routing rewrites the recipient. "Sent to your inbox"
    over an inbox that never received it is the plainest form of the lie."""
    from app.playbooks import build_playbook

    event = _event("mkt_digest_reroute")
    ctx = SpecialistCallContext(
        call_id="pending", agent_id="pge_shutoff", event_id=event.id,
        state="needs-user-action",
    )
    ctx.playbook = build_playbook("pge_shutoff", SPEC)
    event.specialist_calls["pge_shutoff"] = ctx

    async def fake_send(**kwargs):  # noqa: ANN003
        # What the real send returns once the override has rewritten `to`.
        return {"message_id": "msg_digest", "to": "operator@test.invalid"}

    monkeypatch.setattr(ws_broker, "broadcast", AsyncMock())
    monkeypatch.setattr(marketplace.am, "send_move_package", fake_send)
    monkeypatch.setattr(marketplace, "_send_prepared_documents", AsyncMock())
    asyncio.run(marketplace.finalize_event(event.id))

    assert event.playbook_digest_sent is False
    assert event.playbook_digest_rerouted is True

    specialist = _snapshot(event.id)["specialists"][0]
    assert specialist["playbook_delivered"] is False
    assert specialist["playbook_delivery"] == "rerouted"


def test_demo_routing_leaves_no_submitted_chip_in_the_workspace(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The move-list chip and the tracker must agree.

    On a demo-routing deployment the tracker already says "no provider was
    contacted" on the row itself — while the list beside it still counted the
    same specialist under "Submitted", whose chip means provider acceptance.
    Two screens, one system, opposite claims.
    """
    monkeypatch.setattr(settings, "demo_username", "demo")
    monkeypatch.setattr(settings, "demo_password", "onlyfordemopurposes")
    monkeypatch.setattr(
        settings, "agentmail_demo_recipient_override", "operator@test.invalid",
    )
    main._demo_login_hits.clear()

    event = _event("mkt_ws_demoroute")
    event.origin_channel = "demo"
    _call(event, "spectrum_austin", state_="submitted",
          outcome="submitted", bid={"count": 1, "intended": 1})
    _call(event, "mover_quote", state_="submitted",
          outcome="submitted", bid={"count": 1, "intended": 3})
    _call(event, "housing_search", state_="submitted",
          outcome="prepared_for_user", bid={"kind": "prepared_section"})

    client = TestClient(main.app)
    token = client.post(
        "/api/public/demo-login",
        json={"username": "demo", "password": "onlyfordemopurposes"},
    ).json()["token"]
    counts = client.get(
        "/api/public/demo/moves", headers={"Authorization": f"Bearer {token}"},
    ).json()["moves"][0]["counts"]

    assert counts["submitted"] == 0
    assert counts["prepared"] == 3


def test_demo_routing_never_claims_the_digest_reached_the_reader(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Under demo routing the digest went to the operator's inbox.

    `_send_playbook_digest` now records that as a reroute, but every move
    dispatched before that check existed still carries
    playbook_digest_sent=True — and the tracker rendered it as
    "sent to your inbox" on seven rows of a move that reached nobody. The
    snapshot has to override the stored flag, not trust it.
    """
    monkeypatch.setattr(
        settings, "agentmail_demo_recipient_override", "operator@test.invalid",
    )
    event = _event("mkt_stale_digest")
    # Exactly what a pre-fix move looks like on disk.
    event.playbook_digest_sent = True
    ctx = _call(event, "pge_shutoff", state_="needs-user-action",
                outcome="needs_user_action", bid={})
    ctx.playbook = {"title": "PG&E shutoff call script"}

    task = _snapshot(event.id)["specialists"][0]
    assert task["playbook_delivered"] is False
    assert task["playbook_delivery"] == "rerouted"


def test_normal_routing_still_reports_a_real_delivery(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The override above must not swallow the honest case."""
    monkeypatch.setattr(settings, "agentmail_demo_recipient_override", "")
    event = _event("mkt_real_digest")
    event.playbook_digest_sent = True
    ctx = _call(event, "pge_shutoff", state_="needs-user-action",
                outcome="needs_user_action", bid={})
    ctx.playbook = {"title": "PG&E shutoff call script"}

    task = _snapshot(event.id)["specialists"][0]
    assert task["playbook_delivered"] is True
    assert task["playbook_delivery"] == "delivered"


def test_demo_routing_rides_the_public_feed_so_the_swarm_can_see_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The public stage counts "N submitted" straight off the feed.

    demo_routing is deployment-wide, and the feed carries nothing else the
    stage could read it from — so without it on the frame the marketing page
    credited provider acceptances that the tracker beside it denies.
    """
    monkeypatch.setattr(
        settings, "agentmail_demo_recipient_override", "operator@test.invalid",
    )
    persona = by_id("mover_quote")
    event = _event("mkt_feed_demoroute")
    event.specialist_calls[persona.agent_id] = SpecialistCallContext(
        call_id="pending", agent_id=persona.agent_id, event_id=event.id,
    )
    sent: list[dict] = []

    async def capture(payload: dict) -> None:
        sent.append(payload)

    monkeypatch.setattr(ws_broker, "broadcast", capture)
    asyncio.run(marketplace._emit_agent_state(event.id, persona.agent_id, "submitted"))

    frame = [m for m in sent if m["type"] == "agent_state"][-1]
    assert frame["demo_routing"] is True
    # And it survives the public projector, which drops unlisted keys.
    public = redact_public_event(dict(frame))
    assert public is not None and public["demo_routing"] is True

    # The subscribe-time replay says the same thing to a late viewer.
    assert main._bootstrap_messages()[0]["demo_routing"] is True


def test_normal_routing_states_it_plainly_on_the_wire(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """False, not absent: a missing flag would be indistinguishable from an
    old build, and the stage would have to guess."""
    monkeypatch.setattr(settings, "agentmail_demo_recipient_override", "")
    persona = by_id("mover_quote")
    event = _event("mkt_feed_normal")
    event.specialist_calls[persona.agent_id] = SpecialistCallContext(
        call_id="pending", agent_id=persona.agent_id, event_id=event.id,
    )
    sent: list[dict] = []

    async def capture(payload: dict) -> None:
        sent.append(payload)

    monkeypatch.setattr(ws_broker, "broadcast", capture)
    asyncio.run(marketplace._emit_agent_state(event.id, persona.agent_id, "submitted"))

    assert [m for m in sent if m["type"] == "agent_state"][-1]["demo_routing"] is False
