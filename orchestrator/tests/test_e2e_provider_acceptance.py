"""Explicitly gated acceptance path for enabled external-provider submissions.

Ordinary ``pytest`` runs skip this module. Running it requires two independent
environment gates plus an ignored/out-of-repository JSON spec. The current
Loop-1 policy permits five AgentMail workflows; Browser Use v1, Lob purchase,
medical, pharmacy, and identity-bound workflows remain blocked. The test must
only be used with accounts, recipients, and identities the operator is
authorized to exercise.

Required gates::

    RUN_PROVIDER_ACCEPTANCE=1
    PROVIDER_ACCEPTANCE_ACK=I_ACCEPT_EXTERNAL_SIDE_EFFECTS

The safer mocked E2E suite remains the normal CI gate.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from app import marketplace
from app.config import settings
from app.personas import all_specialists, by_id
from app.state import MarketplaceEvent, state
from app.ws import ws_broker


_RUN_ENABLED = os.environ.get("RUN_PROVIDER_ACCEPTANCE") == "1"
_ACK_ENABLED = os.environ.get("PROVIDER_ACCEPTANCE_ACK") == "I_ACCEPT_EXTERNAL_SIDE_EFFECTS"

pytestmark = [
    pytest.mark.provider_acceptance,
    pytest.mark.skipif(
        not (_RUN_ENABLED and _ACK_ENABLED),
        reason="external acceptance requires RUN_PROVIDER_ACCEPTANCE=1 and the explicit acknowledgement gate",
    ),
]

_SUBMITTED_EMAIL_AGENTS = {
    "bank_notify",
    "gym_cancel",
    "mover_quote",
    "school_district",
    "vet_transfer",
}

_FIXED_EMAIL_TARGETS = {
    "customer.service@uhaul.com",
    "customerservice@pods.com",
    "sanfrancisco@twomenandatruck.com",
    "enroll@austinisd.org",
    "memberservices@equinox.com",
}


def _load_authorized_spec() -> dict:
    path_value = os.environ.get("PROVIDER_ACCEPTANCE_SPEC_PATH", "")
    assert path_value, "PROVIDER_ACCEPTANCE_SPEC_PATH must name an ignored or out-of-repository JSON file"
    path = Path(path_value).expanduser().resolve()
    assert path.is_file(), f"acceptance spec does not exist: {path}"
    repository_root = Path(__file__).resolve().parents[2]
    if path.is_relative_to(repository_root):
        import subprocess

        ignored = subprocess.run(
            ["git", "-C", str(repository_root), "check-ignore", "--quiet", str(path)],
            check=False,
        )
        assert ignored.returncode == 0, "an in-repository acceptance spec must be gitignored"
    spec = json.loads(path.read_text())
    assert spec.get("provider_acceptance") is True, "spec must opt in with provider_acceptance=true"

    expected_recipient = os.environ.get("PROVIDER_ACCEPTANCE_RECIPIENT", "").strip().lower()
    assert expected_recipient, "PROVIDER_ACCEPTANCE_RECIPIENT is required"
    actual_recipient = str(spec.get("user_email") or spec.get("homeowner_email") or "").lower()
    assert actual_recipient == expected_recipient, "spec recipient must match the independently supplied allowlist"

    for flag in ("has_pets", "has_children", "has_car", "has_visa"):
        assert spec.get(flag) is True, f"{flag}=true is required to exercise all specialists"

    allowed_targets = {
        value.strip().lower()
        for value in os.environ.get("PROVIDER_ACCEPTANCE_EMAIL_ALLOWLIST", "").split(",")
        if value.strip()
    }
    expected_targets = _FIXED_EMAIL_TARGETS | {
        expected_recipient,
        str(spec.get("vet_email") or "").strip().lower(),
    }
    assert "" not in expected_targets, "the authorized spec must include vet_email"
    missing_targets = expected_targets - allowed_targets
    assert not missing_targets, (
        "PROVIDER_ACCEPTANCE_EMAIL_ALLOWLIST must explicitly include every outbound target: "
        f"{sorted(missing_targets)}"
    )
    # The runtime enforces its own fail-safe allowlist; the acceptance run must
    # declare the same targets there or every send blocks as needs-user-action.
    missing_runtime = expected_targets - set(settings.agentmail_allowlist)
    assert not missing_runtime, (
        "AGENTMAIL_ALLOWED_RECIPIENTS must include every outbound target for the "
        f"runtime allowlist: {sorted(missing_runtime)}"
    )
    return spec


def _assert_sandbox_configuration() -> None:
    assert settings.agentmail_api_key and settings.agentmail_api_key != "REPLACE_ME"
    assert os.environ.get("AGENTMAIL_SANDBOX_CONFIRMED") == "1", (
        "set AGENTMAIL_SANDBOX_CONFIRMED=1 only after confirming the configured account is isolated for testing"
    )


@pytest.mark.asyncio
async def test_enabled_email_submissions_and_policy_blocks(monkeypatch: pytest.MonkeyPatch) -> None:
    _assert_sandbox_configuration()
    spec = _load_authorized_spec()
    event_id = "mkt_provider_acceptance"
    event = MarketplaceEvent(id=event_id, homeowner_call_id="provider_acceptance", spec=spec)
    state.events[event_id] = event

    # Keep provider acceptance output local. Moss/Supermemory are unrelated to
    # the specialist artifact contract and are disabled for this run.
    monkeypatch.setattr(ws_broker, "broadcast", AsyncMock())
    monkeypatch.setattr(marketplace, "retrieve_runbooks_for_specialists", AsyncMock(return_value=None))
    monkeypatch.setattr(marketplace, "recall_user_profile", AsyncMock(return_value=None))

    try:
        await marketplace.fan_out(event_id, spec)
        expected = {persona.agent_id for persona in all_specialists()}
        assert len(expected) == 16
        assert set(event.specialist_calls) == expected

        for agent_id, context in event.specialist_calls.items():
            if agent_id in _SUBMITTED_EMAIL_AGENTS:
                assert by_id(agent_id).voice_mode == "email"
                assert context.state == "submitted", f"{agent_id} did not reach submitted"
                assert context.terminal_outcome == "submitted"
                artifact = context.bid or {}
                messages = artifact.get("messages") or []
                assert messages and all(item.get("message_id") for item in messages), (
                    f"{agent_id} returned no AgentMail message ids"
                )
            else:
                assert context.state == "needs-user-action", (
                    f"{agent_id} bypassed the Loop-1 provider safety policy"
                )
                assert context.terminal_outcome == "needs_user_action"
    finally:
        state.events.pop(event_id, None)
