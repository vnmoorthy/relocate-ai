"""Side-effect-free end-to-end tests for specialist fan-out.

The old test launched the service against live vendor APIs and could send
email, submit forms, or buy certified mail. These tests exercise the complete
16-specialist orchestration path with every provider boundary mocked. They
assert durable in-process outcomes, not merely a final UI state.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from unittest.mock import AsyncMock

import pytest

from app import marketplace
from app.personas import all_specialists, by_id
from app.state import MarketplaceEvent, SpecialistCallContext, state
from app.ws import ws_broker


ALL_CONDITIONS_SPEC = {
    "origin_address": "100 Test Street, San Francisco, CA 94103",
    "destination_address": "200 Example Avenue, Austin, TX 78701",
    "destination_zip": "78701",
    "move_date": "2030-01-15",
    "household_size": 2,
    "has_pets": True,
    "has_children": True,
    "has_car": True,
    "has_visa": True,
    "user_name": "Demo Mover",
    "user_email": "demo.mover@example.com",
    "user_phone": "+14155550100",
    "pge_account_number": "test-pge-account",
    "pge_last4_ssn": "0000",
    "comcast_account_number": "test-comcast-account",
    "comcast_authorization_signed": True,
    "geico_email": "demo.mover@example.com",
    "geico_password": "test-only-password",
    "usps_verify_card": "4111111111111111",
    "usps_verify_exp": "12/30",
    "usps_verify_cvv": "123",
    "child_name": "Demo Child",
    "child_grade": "5",
    "hipaa_authorization_signed": True,
    "hipaa_signature_name": "Demo Mover",
    "hipaa_signature_date": "2030-01-01",
    "pet_name": "Demo Pet",
    "pet_species": "dog",
    "vet_email": "records@example.com",
    "equinox_member_id": "EQX-TEST",
    "gym_authorization_signed": True,
    "source_pharmacy_name": "Test Pharmacy",
    "source_pharmacy_phone": "+14155550199",
    "rx_numbers": "RX-TEST",
    "user_dob": "1990-01-01",
    "a_number": "A000000000",
    "sfpuc_username": "demo.mover@example.com",
    "sfpuc_password": "test-only-password",
    "ca_dl_number": "D0000000",
    "dmv_authorization_signed": True,
}


@pytest.fixture(autouse=True)
async def _isolated_state() -> AsyncIterator[None]:
    """Keep the process-global demo state isolated between tests."""
    state.buyer_contexts.clear()
    state.events.clear()
    state.buyer_caller_phone.clear()
    yield
    state.buyer_contexts.clear()
    state.events.clear()
    state.buyer_caller_phone.clear()


def _event(event_id: str, spec: dict | None = None) -> MarketplaceEvent:
    event = MarketplaceEvent(
        id=event_id,
        homeowner_call_id="call_mocked",
        spec=dict(spec or ALL_CONDITIONS_SPEC),
    )
    state.events[event_id] = event
    return event


@pytest.mark.asyncio
async def test_all_sixteen_specialists_report_honest_terminal_state(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    event_id = "mkt_mocked_all"
    event = _event(event_id)
    broadcasts = AsyncMock()
    runbook_lookup = AsyncMock(return_value=None)
    profile_lookup = AsyncMock(return_value=None)

    async def mocked_provider(persona, received_event_id: str, spec: dict) -> dict:
        assert received_event_id == event_id
        assert spec == ALL_CONDITIONS_SPEC
        return {
            "artifact_id": f"mock:{persona.voice_mode}:{persona.agent_id}",
            "provider": "mock",
            "verified": True,
        }

    monkeypatch.setattr(ws_broker, "broadcast", broadcasts)
    monkeypatch.setattr(marketplace, "retrieve_runbooks_for_specialists", runbook_lookup)
    monkeypatch.setattr(marketplace, "recall_user_profile", profile_lookup)
    monkeypatch.setattr(marketplace, "_run_browser", mocked_provider)
    monkeypatch.setattr(marketplace, "_run_email", mocked_provider)
    monkeypatch.setattr(marketplace, "_run_mail", mocked_provider)

    await marketplace.fan_out(event_id, dict(ALL_CONDITIONS_SPEC))
    await asyncio.sleep(0)  # allow the mocked sponsor lookup tasks to finish

    expected = {persona.agent_id for persona in all_specialists()}
    assert len(expected) == 16
    assert set(event.specialist_calls) == expected
    policy_blocked = {
        persona.agent_id for persona in all_specialists()
        if persona.voice_mode == "browser"
    } | set(marketplace.MANDATORY_USER_ACTION)
    submitted = expected - policy_blocked

    assert {
        agent_id for agent_id, context in event.specialist_calls.items()
        if context.state == "needs-user-action"
    } == policy_blocked
    assert {
        agent_id for agent_id, context in event.specialist_calls.items()
        if context.state == "submitted"
    } == submitted
    assert all(context.closed_at is not None for context in event.specialist_calls.values())
    artifact_ids = {
        context.bid["artifact_id"]
        for agent_id, context in event.specialist_calls.items()
        if agent_id in submitted and context.bid is not None
    }
    assert artifact_ids == {
        f"mock:{by_id(agent_id).voice_mode}:{agent_id}" for agent_id in submitted
    }
    for agent_id in policy_blocked:
        bid = event.specialist_calls[agent_id].bid
        assert bid and bid["outcome"] == "needs_user_action"

    emitted = [call.args[0] for call in broadcasts.await_args_list]
    assert not [item for item in emitted if item.get("state") == "error"]
    for agent_id in expected:
        states = [
            item["state"]
            for item in emitted
            if item.get("type") == "agent_state" and item.get("agent_id") == agent_id
        ]
        terminal = "needs-user-action" if agent_id in policy_blocked else "submitted"
        assert states == ["dispatched", "calling", terminal]

    runbook_lookup.assert_awaited_once()
    profile_lookup.assert_awaited_once()


def test_conditional_roster_excludes_inapplicable_specialists() -> None:
    spec = {
        "origin_address": "100 Test Street",
        "destination_address": "200 Example Avenue",
        "move_date": "2030-01-15",
        "has_pets": False,
        "has_children": False,
        "has_car": False,
        "has_visa": False,
    }
    chosen = {persona.agent_id for persona in marketplace.pick_specialists(spec)}
    assert "vet_transfer" not in chosen
    assert "school_district" not in chosen
    assert "geico_address" not in chosen
    assert "id_card_update" not in chosen
    assert "uscis_ar11" not in chosen
    assert chosen == {
        persona.agent_id
        for persona in all_specialists()
        if not (
            persona.requires_pets
            or persona.requires_children
            or persona.requires_car
            or persona.requires_visa
        )
    }


@pytest.mark.asyncio
async def test_missing_provider_key_never_becomes_a_playbook_success(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    event_id = "mkt_mocked_fallback"
    event = _event(event_id)
    persona = by_id("mover_quote")
    event.specialist_calls[persona.agent_id] = SpecialistCallContext(
        call_id="pending",
        agent_id=persona.agent_id,
        event_id=event_id,
    )
    async def missing_provider(*_args, **_kwargs):
        raise RuntimeError("AGENTMAIL_API_KEY missing — mocked provider is disabled")

    monkeypatch.setattr(marketplace, "_run_email", missing_provider)
    monkeypatch.setattr(ws_broker, "broadcast", AsyncMock())

    await marketplace._run_one(persona, event_id, dict(ALL_CONDITIONS_SPEC))

    context = event.specialist_calls[persona.agent_id]
    assert context.state == "needs-user-action"
    assert context.bid == {
        "outcome": "needs_user_action",
        "reason": "integration_unavailable",
        "missing_fields": [],
    }
    assert context.transcript == []


@pytest.mark.asyncio
async def test_unexpected_provider_failure_is_visible(monkeypatch: pytest.MonkeyPatch) -> None:
    event_id = "mkt_mocked_error"
    event = _event(event_id)
    persona = by_id("mover_quote")
    event.specialist_calls[persona.agent_id] = SpecialistCallContext(
        call_id="pending",
        agent_id=persona.agent_id,
        event_id=event_id,
    )

    async def failed_provider(*_args, **_kwargs):
        raise ValueError("mocked provider failure")

    monkeypatch.setattr(marketplace, "_run_email", failed_provider)
    monkeypatch.setattr(ws_broker, "broadcast", AsyncMock())

    await marketplace._run_one(persona, event_id, dict(ALL_CONDITIONS_SPEC))

    context = event.specialist_calls[persona.agent_id]
    assert context.state == "failed"
    assert context.bid == {"outcome": "failed", "error_type": "ValueError"}
