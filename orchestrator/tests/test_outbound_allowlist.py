"""Runtime outbound-email allowlist: fail-safe by default.

AGENTMAIL_ALLOWED_RECIPIENTS defaults to empty, which blocks every AgentMail
send — including the institutional intake addresses hardcoded in the adapters.
These tests never contact the network: the allowlist raises before any SDK use.
"""

from __future__ import annotations

import asyncio
from collections.abc import Iterator
from unittest.mock import AsyncMock

import pytest

from app import marketplace
from app.config import settings
from app.integrations import agentmail
from app.integrations._common import RecipientNotAllowed
from app.personas import by_id
from app.state import MarketplaceEvent, SpecialistCallContext, state
from app.ws import ws_broker


@pytest.fixture(autouse=True)
def _isolated_state() -> Iterator[None]:
    state.buyer_contexts.clear()
    state.events.clear()
    state.buyer_caller_phone.clear()
    yield
    state.buyer_contexts.clear()
    state.events.clear()
    state.buyer_caller_phone.clear()


def test_empty_allowlist_blocks_every_send(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "agentmail_allowed_recipients", "")
    with pytest.raises(RecipientNotAllowed):
        agentmail.assert_recipients_allowed(["someone@example.com"])


def test_allowlist_match_is_case_insensitive_and_names_blocked_addresses(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        settings, "agentmail_allowed_recipients", "Demo@Example.com, other@example.com",
    )
    agentmail.assert_recipients_allowed(["demo@example.com", "OTHER@EXAMPLE.COM"])
    with pytest.raises(RecipientNotAllowed, match="third@example.com"):
        agentmail.assert_recipients_allowed(["demo@example.com", "third@example.com"])


def test_send_via_agentmail_blocks_before_any_provider_call(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "agentmail_api_key", "test-key-not-real")
    monkeypatch.setattr(settings, "agentmail_allowed_recipients", "")
    with pytest.raises(RecipientNotAllowed):
        asyncio.run(agentmail._send_via_agentmail(
            event_id="event-allowlist",
            agent_id="mover_quote",
            to=["customer.service@uhaul.com"],
            subject="subject",
            body="body",
        ))


def test_unallowlisted_recipient_is_an_honest_needs_user_action(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    persona = by_id("mover_quote")
    event = MarketplaceEvent(id="event-allow", homeowner_call_id="call", spec={})
    event.specialist_calls[persona.agent_id] = SpecialistCallContext(
        call_id="pending", agent_id=persona.agent_id, event_id=event.id,
    )
    state.events[event.id] = event

    async def blocked(*_args: object, **_kwargs: object) -> None:
        raise RecipientNotAllowed("outbound email blocked: customer.service@uhaul.com")

    monkeypatch.setattr(marketplace, "_run_email", blocked)
    monkeypatch.setattr(ws_broker, "broadcast", AsyncMock())

    asyncio.run(marketplace._run_one(persona, event.id, {}))

    ctx = event.specialist_calls[persona.agent_id]
    assert ctx.state == "needs-user-action"
    assert ctx.terminal_outcome == "needs_user_action"
    assert ctx.blocker_kind == "recipient_not_allowlisted"


def test_fan_out_derives_destination_zip_from_address(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    spec = {
        "origin_address": "123 Main St, San Francisco, CA 94103",
        # Five-digit street number: the LAST 5-digit group must win, not the first.
        "destination_address": "10600 Menchaca Rd, Austin, TX 78748",
        "move_date": "2030-01-15",
        "user_email": "mover@test.invalid",
    }
    event = MarketplaceEvent(id="event-zip", homeowner_call_id="call", spec=spec)
    state.events[event.id] = event

    monkeypatch.setattr(marketplace, "retrieve_runbooks_for_specialists", AsyncMock())
    monkeypatch.setattr(marketplace, "recall_user_profile", AsyncMock())
    monkeypatch.setattr(ws_broker, "broadcast", AsyncMock())

    asyncio.run(marketplace.fan_out(event.id, spec))

    assert spec["destination_zip"] == "78748"


def test_demo_override_reroutes_to_owner_and_notes_intended(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, object] = {}

    async def fake_safe_call(**kwargs):  # noqa: ANN003
        captured.update(kwargs)
        return {"message_id": "msg_demo"}

    monkeypatch.setattr(settings, "agentmail_api_key", "test-key-not-real")
    monkeypatch.setattr(settings, "agentmail_allowed_recipients", "owner@example.com")
    monkeypatch.setattr(settings, "agentmail_demo_recipient_override", "owner@example.com")
    monkeypatch.setattr(agentmail, "safe_call", fake_safe_call)

    result = asyncio.run(agentmail._send_via_agentmail(
        event_id="event-demo", agent_id="mover_quote",
        to=["customer.service@uhaul.com", "customerservice@pods.com"],
        subject="Quote request", body="Hello",
    ))
    # Two institutional recipients collapse into ONE send to the owner.
    assert result == {"count": 1, "messages": [{"message_id": "msg_demo"}]}


def test_demo_override_must_itself_be_allowlisted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "agentmail_api_key", "test-key-not-real")
    monkeypatch.setattr(settings, "agentmail_allowed_recipients", "")
    monkeypatch.setattr(settings, "agentmail_demo_recipient_override", "owner@example.com")
    with pytest.raises(RecipientNotAllowed):
        asyncio.run(agentmail._send_via_agentmail(
            event_id="event-demo2", agent_id="mover_quote",
            to=["customer.service@uhaul.com"], subject="s", body="b",
        ))


def test_move_package_respects_demo_override(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    async def fake_safe_call(**kwargs):  # noqa: ANN003
        captured.update(kwargs)
        return {"message_id": "msg_pkg"}

    monkeypatch.setattr(settings, "agentmail_api_key", "test-key-not-real")
    monkeypatch.setattr(settings, "agentmail_allowed_recipients", "owner@example.com")
    monkeypatch.setattr(settings, "agentmail_demo_recipient_override", "owner@example.com")
    monkeypatch.setattr(agentmail, "safe_call", fake_safe_call)

    result = asyncio.run(agentmail.send_move_package(
        event_id="event-pkg", to_email="customer@example.net",
        subject="Digest", body_markdown="Body",
    ))
    assert result == {"message_id": "msg_pkg"}
