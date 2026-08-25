"""Prepared-artifact specialists: honest outcomes, safe rendering, one email.

These 12 cover what customers say they worry about first (housing, transport,
carrier, landlord, money, people, first week). None can be transacted for the
customer, so the contract is: produce a personalized section, batch it into a
single arrival pack, and never claim a counterparty was involved.
"""

from __future__ import annotations

import asyncio
import string
from collections.abc import Iterator
from unittest.mock import AsyncMock

import pytest

from app import marketplace
from app.personas import all_specialists, by_id
from app.prepared import SECTIONS, build_section, render
from app.prepared_sections import PLAYBOOKS
from app.state import MarketplaceEvent, SpecialistCallContext, state
from app.ws import ws_broker


ALLOWED_PLACEHOLDERS = {
    "origin_address", "destination_address", "move_date", "user_email", "user_name",
    "household_size", "work_address", "destination_airport", "origin_airport",
    "child_name", "child_grade", "pet_name", "pet_species", "bank_name", "user_dob",
    "has_pets", "has_children", "has_car", "has_visa",
}
SPEC = {
    "origin_address": "950 Howard St, San Francisco, CA 94103",
    "destination_address": "4700 Duval St, Austin, TX 78751",
    "move_date": "2026-10-20",
    "user_email": "mover@test.invalid",
    "user_name": "Moorthy",
}


@pytest.fixture(autouse=True)
def _isolated() -> Iterator[None]:
    state.events.clear()
    yield
    state.events.clear()


def test_every_prepared_specialist_has_registered_content() -> None:
    prepared = [p for p in all_specialists() if p.voice_mode == "prepared"]
    assert len(prepared) == 12
    for persona in prepared:
        assert persona.agent_id in SECTIONS, persona.agent_id
        assert persona.agent_id in PLAYBOOKS, persona.agent_id


def test_content_uses_only_known_placeholders() -> None:
    """A stray brace or unknown key would raise at send time, mid-dispatch."""
    for agent_id, (title, body) in SECTIONS.items():
        fields = {f for _, f, _, _ in string.Formatter().parse(body) if f}
        assert fields <= ALLOWED_PLACEHOLDERS, (agent_id, fields - ALLOWED_PLACEHOLDERS)
        assert title and len(body) > 200, agent_id
    for agent_id, (title, body) in PLAYBOOKS.items():
        fields = {f for _, f, _, _ in string.Formatter().parse(body) if f}
        assert fields <= ALLOWED_PLACEHOLDERS, (agent_id, fields - ALLOWED_PLACEHOLDERS)


def test_unknown_values_render_as_visible_placeholders() -> None:
    """A gap must be visible to the customer, never silently blank."""
    out = render("Route {origin_address} -> {destination_address}, work {work_address}", SPEC)
    assert "950 Howard St" in out and "4700 Duval St" in out
    assert "<work address>" in out
    # Every section renders against a bare spec without raising.
    for agent_id in SECTIONS:
        section = build_section(agent_id, {})
        assert section is not None and section["body"], agent_id


def test_prepared_specialist_never_claims_provider_acceptance(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    persona = by_id("housing_search")
    event = MarketplaceEvent(id="mkt_prep1", homeowner_call_id="call", spec=dict(SPEC))
    event.specialist_calls[persona.agent_id] = SpecialistCallContext(
        call_id="pending", agent_id=persona.agent_id, event_id=event.id,
    )
    state.events[event.id] = event
    monkeypatch.setattr(ws_broker, "broadcast", AsyncMock())

    asyncio.run(marketplace._run_one(persona, event.id, dict(SPEC)))

    ctx = event.specialist_calls[persona.agent_id]
    assert ctx.state == "submitted"
    assert ctx.terminal_outcome == "prepared_for_user"
    assert ctx.bid is not None and ctx.bid["kind"] == "prepared_section"
    assert "4700 Duval St" in ctx.bid["body"]


def test_arrival_pack_is_one_email_and_idempotent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Twelve specialists mailing separately would bury the customer."""
    event = MarketplaceEvent(id="mkt_prep2", homeowner_call_id="call", spec=dict(SPEC))
    for agent_id in ("housing_search", "commute_route", "grocery_setup"):
        ctx = SpecialistCallContext(
            call_id="c", agent_id=agent_id, event_id=event.id, state="submitted",
        )
        ctx.bid = {"kind": "prepared_section", **build_section(agent_id, SPEC)}  # type: ignore[dict-item]
        event.specialist_calls[agent_id] = ctx
    state.events[event.id] = event
    sent: list[dict] = []

    async def fake_send(**kwargs):  # noqa: ANN003
        sent.append(kwargs)
        return {"message_id": "msg_pack"}

    monkeypatch.setattr(marketplace.am, "send_move_package", fake_send)

    asyncio.run(marketplace._send_arrival_pack(event))
    asyncio.run(marketplace._send_arrival_pack(event))

    assert len(sent) == 1
    assert "3 things ready" in sent[0]["subject"]
    body = sent[0]["body_markdown"]
    assert "never books, signs, or pays" in body
    assert event.arrival_pack_sent is True


def test_arrival_pack_is_not_marked_sent_without_a_receipt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    event = MarketplaceEvent(id="mkt_prep3", homeowner_call_id="call", spec=dict(SPEC))
    ctx = SpecialistCallContext(
        call_id="c", agent_id="grocery_setup", event_id=event.id, state="submitted",
    )
    ctx.bid = {"kind": "prepared_section", **build_section("grocery_setup", SPEC)}  # type: ignore[dict-item]
    event.specialist_calls["grocery_setup"] = ctx
    state.events[event.id] = event

    async def no_receipt(**_kwargs):  # noqa: ANN003
        return None

    monkeypatch.setattr(marketplace.am, "send_move_package", no_receipt)
    asyncio.run(marketplace._send_arrival_pack(event))
    assert event.arrival_pack_sent is False
