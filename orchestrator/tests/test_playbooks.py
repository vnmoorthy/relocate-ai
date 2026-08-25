"""Playbooks: every blocked specialist prepares a concrete, honest artifact.

Invariants:
- every specialist agent has a builder; titles are static and PII-free
- spec values appear verbatim; absent values become explicit <placeholders>
- a blocked run attaches the playbook to the ctx and the wave emails ONE digest
- the public snapshot exposes the title only — never a body
"""

from __future__ import annotations

import asyncio
from collections.abc import Iterator
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from app import main, marketplace
from app.config import settings
from app.personas import all_specialists
from app.playbooks import _BUILDERS, build_playbook
from app.state import MarketplaceEvent, SpecialistCallContext, state
from app.ws import ws_broker


SPEC = {
    "origin_address": "588 Mission St, San Francisco, CA 94105",
    "destination_address": "2200 S Lamar Blvd, Austin, TX 78704",
    "move_date": "2026-10-15",
    "user_email": "mover@test.invalid",
    "user_name": "Moorthy",
}


@pytest.fixture(autouse=True)
def _isolated() -> Iterator[None]:
    state.buyer_contexts.clear()
    state.events.clear()
    yield
    state.buyer_contexts.clear()
    state.events.clear()


def test_every_specialist_can_prepare_something_when_blocked() -> None:
    """No specialist may dead-end. Provider-facing ones have hand-written
    builders; prepared ones fall back to their generated checklist."""
    for persona in all_specialists():
        pb = build_playbook(persona.agent_id, SPEC)
        assert pb is not None, f"{persona.agent_id} has no playbook"
        assert pb["title"] and len(pb["body"]) > 80, persona.agent_id


def test_playbooks_personalize_and_placeholder_honestly() -> None:
    for agent_id in _BUILDERS:
        pb = build_playbook(agent_id, SPEC)
        assert pb is not None and pb["title"] and len(pb["body"]) > 80, agent_id
        # Titles are static labels — they must never embed spec values.
        assert "Mission St" not in pb["title"] and "Moorthy" not in pb["title"]
    filled = build_playbook("pge_shutoff", SPEC)
    assert filled is not None and "588 Mission St" in filled["body"]
    empty = build_playbook("pge_shutoff", {})
    assert empty is not None and "<your current address>" in empty["body"]
    assert build_playbook("nonexistent_agent", SPEC) is None


def test_blocked_specialist_attaches_playbook(monkeypatch: pytest.MonkeyPatch) -> None:
    event = MarketplaceEvent(id="mkt_pb1", homeowner_call_id="call", spec=dict(SPEC))
    event.specialist_calls["pge_shutoff"] = SpecialistCallContext(
        call_id="pending", agent_id="pge_shutoff", event_id=event.id,
    )
    state.events[event.id] = event
    monkeypatch.setattr(ws_broker, "broadcast", AsyncMock())

    asyncio.run(marketplace._mark_needs_user_action(
        event.id, "pge_shutoff",
        blocker_kind="missing_fields", blockers=["pge_account_number"],
    ))

    ctx = event.specialist_calls["pge_shutoff"]
    assert ctx.playbook is not None
    assert ctx.playbook["title"] == "PG&E shutoff call script"
    assert "588 Mission St" in ctx.playbook["body"]


def test_digest_emails_once_with_every_playbook(monkeypatch: pytest.MonkeyPatch) -> None:
    event = MarketplaceEvent(id="mkt_pb2", homeowner_call_id="call", spec=dict(SPEC))
    for agent_id in ("pge_shutoff", "gym_cancel"):
        ctx = SpecialistCallContext(
            call_id="pending", agent_id=agent_id, event_id=event.id,
            state="needs-user-action",
        )
        ctx.playbook = build_playbook(agent_id, SPEC)
        event.specialist_calls[agent_id] = ctx
    state.events[event.id] = event
    monkeypatch.setattr(ws_broker, "broadcast", AsyncMock())
    sent: list[dict] = []

    async def fake_send(**kwargs):  # noqa: ANN003
        sent.append(kwargs)
        return {"message_id": "msg_digest"}

    monkeypatch.setattr(marketplace.am, "send_move_package", fake_send)

    asyncio.run(marketplace.finalize_event(event.id))
    asyncio.run(marketplace.finalize_event(event.id))  # idempotent

    assert len(sent) == 1
    body = sent[0]["body_markdown"]
    assert "PG&E shutoff call script" in body
    assert "Gym cancellation letter" in body
    assert "2 ready-to-use scripts" in sent[0]["subject"]
    # Not finalized — the work still belongs to the user.
    assert event.finalized_at is None


def test_snapshot_exposes_title_never_body(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "enable_public_intake", True)
    client = TestClient(main.app)
    event = MarketplaceEvent(id="mkt_pb3", homeowner_call_id="call", spec=dict(SPEC))
    ctx = SpecialistCallContext(
        call_id="pending", agent_id="pge_shutoff", event_id=event.id,
        state="needs-user-action",
    )
    ctx.playbook = build_playbook("pge_shutoff", SPEC)
    event.specialist_calls["pge_shutoff"] = ctx
    state.events[event.id] = event

    body = client.get("/api/public/move/mkt_pb3").json()

    row = body["specialists"][0]
    assert row["playbook_title"] == "PG&E shutoff call script"
    dumped = str(body)
    assert "588 Mission St" not in dumped.replace(
        str(body["route"]), ""
    )  # route is the only sanctioned address surface
    assert "877-660-6789" not in dumped  # playbook body content stays out


def test_unsigned_hipaa_draft_renders_without_signature() -> None:
    from app.integrations.hipaa_pdf import build_hipaa_release_pdf

    pdf = build_hipaa_release_pdf(
        patient_name="Demo Mover", patient_dob="1990-01-01",
        patient_address="1 Main St", patient_phone="+15555550123",
        patient_email="patient@test.invalid",
        current_provider_name="Clinic", current_provider_address="1 Clinic Way",
        unsigned_draft=True,
    )
    assert pdf.startswith(b"%PDF")
    with pytest.raises(ValueError, match="forbids"):
        build_hipaa_release_pdf(
            patient_name="x", patient_dob="x", patient_address="x",
            patient_phone="x", patient_email="x",
            current_provider_name="x", current_provider_address="x",
            unsigned_draft=True, signature_name="sneaky",
        )


def test_prepared_documents_email_attaches_gated_drafts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    event = MarketplaceEvent(id="mkt_docs1", homeowner_call_id="call", spec=dict(SPEC))
    for agent_id in ("comcast_cancel", "id_card_update", "pcp_transfer"):
        ctx = SpecialistCallContext(
            call_id="pending", agent_id=agent_id, event_id=event.id,
            state="needs-user-action",
        )
        ctx.blocker_kind = "secure_user_workflow_required"
        event.specialist_calls[agent_id] = ctx
    state.events[event.id] = event
    sent: list[dict] = []

    async def fake_send(**kwargs):  # noqa: ANN003
        sent.append(kwargs)
        return {"count": 1, "messages": [{"message_id": "msg_docs"}]}

    monkeypatch.setattr(marketplace.am, "_send_via_agentmail", fake_send)

    asyncio.run(marketplace._send_prepared_documents(event))

    assert len(sent) == 1
    names = [a["filename"] for a in sent[0]["attachments"]]
    assert "comcast-cancellation-letter.html" in names
    assert "dmv-dl13a-change-of-address.html" in names
    assert "hipaa-release-DRAFT-unsigned.pdf" in names
    # The rendered Comcast letter is personalized from the spec.
    comcast = next(a for a in sent[0]["attachments"] if a["filename"].startswith("comcast"))
    assert b"588 Mission St" in comcast["content_bytes"]


def test_tracker_only_claims_delivery_after_a_receipt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Review finding: the tracker said "sent to your inbox" whether or not
    the digest email ever went (AgentMail suppression made that real once)."""
    monkeypatch.setattr(settings, "enable_public_intake", True)
    client = TestClient(main.app)
    event = MarketplaceEvent(id="mkt_deliv1", homeowner_call_id="call", spec=dict(SPEC))
    ctx = SpecialistCallContext(
        call_id="pending", agent_id="pge_shutoff", event_id=event.id,
        state="needs-user-action",
    )
    ctx.playbook = build_playbook("pge_shutoff", SPEC)
    event.specialist_calls["pge_shutoff"] = ctx
    state.events[event.id] = event

    row = client.get("/api/public/move/mkt_deliv1").json()["specialists"][0]
    assert row["playbook_title"] == "PG&E shutoff call script"
    assert row["playbook_delivered"] is False

    event.playbook_digest_sent = True
    row = client.get("/api/public/move/mkt_deliv1").json()["specialists"][0]
    assert row["playbook_delivered"] is True


def test_digest_and_documents_are_not_resent_after_a_resume(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """resume_ready_specialists clears awaiting_user_notified so a later wave
    can re-announce; the digest and documents must still go exactly once."""
    event = MarketplaceEvent(id="mkt_resend", homeowner_call_id="call", spec=dict(SPEC))
    ctx = SpecialistCallContext(
        call_id="pending", agent_id="pge_shutoff", event_id=event.id,
        state="needs-user-action",
    )
    ctx.playbook = build_playbook("pge_shutoff", SPEC)
    event.specialist_calls["pge_shutoff"] = ctx
    state.events[event.id] = event
    monkeypatch.setattr(ws_broker, "broadcast", AsyncMock())
    sent: list[dict] = []

    async def fake_send(**kwargs):  # noqa: ANN003
        sent.append(kwargs)
        return {"message_id": "msg_digest"}

    monkeypatch.setattr(marketplace.am, "send_move_package", fake_send)

    asyncio.run(marketplace.finalize_event(event.id))
    assert len(sent) == 1
    assert event.playbook_digest_sent is True

    # A resume re-opens the announcement, but not the mailbox.
    event.awaiting_user_notified = False
    asyncio.run(marketplace.finalize_event(event.id))
    assert len(sent) == 1


def test_self_delivered_agents_do_not_claim_provider_acceptance(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """flight_book and bank_notify email the CUSTOMER; reporting them as
    "submitted — provider acceptance" would overstate what happened."""
    from app.personas import by_id

    persona = by_id("flight_book")
    event = MarketplaceEvent(id="mkt_selfdel", homeowner_call_id="call", spec=dict(SPEC))
    event.specialist_calls[persona.agent_id] = SpecialistCallContext(
        call_id="pending", agent_id=persona.agent_id, event_id=event.id,
    )
    state.events[event.id] = event
    monkeypatch.setattr(ws_broker, "broadcast", AsyncMock())

    async def fake_email(*_args: object, **_kwargs: object) -> dict:
        return {"message_id": "msg_flight", "search_url": "https://example.invalid"}

    monkeypatch.setattr(marketplace, "_run_email", fake_email)

    asyncio.run(marketplace._run_one(persona, event.id, dict(SPEC)))

    ctx = event.specialist_calls[persona.agent_id]
    assert ctx.state == "submitted"
    assert ctx.terminal_outcome == "prepared_for_user"
