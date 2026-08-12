from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import time
from typing import Any

import pytest
from fastapi import HTTPException
from fastapi.responses import JSONResponse
from starlette.requests import Request

from app import main, marketplace, security
from app.personas import by_id
from app.state import BuyerCallContext, MarketplaceEvent, SpecialistCallContext, state


@pytest.fixture(autouse=True)
def _clean_process_state() -> None:
    state.buyer_contexts.clear()
    state.events.clear()
    state.specialist_call_to_agent.clear()
    state.seen_first_turns.clear()
    state.buyer_caller_phone.clear()
    security._WEBHOOK_DELIVERIES.clear()


def _signed_headers(body: bytes, secret: str, webhook_id: str) -> dict[str, str]:
    timestamp = str(int(time.time()))
    signature = hmac.new(
        secret.encode(), timestamp.encode() + b"." + body, hashlib.sha256,
    ).hexdigest()
    return {
        "x-webhook-signature": f"sha256={signature}",
        "x-webhook-timestamp": timestamp,
        "x-webhook-id": webhook_id,
    }


def _request(body: bytes, headers: dict[str, str]) -> Request:
    delivered = False

    async def receive() -> dict[str, Any]:
        nonlocal delivered
        if delivered:
            return {"type": "http.request", "body": b"", "more_body": False}
        delivered = True
        return {"type": "http.request", "body": body, "more_body": False}

    raw_headers = [(key.encode(), value.encode()) for key, value in headers.items()]
    scope = {
        "type": "http",
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/webhook/agent/buyer",
        "raw_path": b"/webhook/agent/buyer",
        "query_string": b"",
        "headers": raw_headers,
        "client": ("127.0.0.1", 1),
        "server": ("test", 80),
    }
    return Request(scope, receive)


def test_agentphone_signature_binds_timestamp_and_dedupes_webhook_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    secret = "test-secret"
    body = b'{"event":"agent.message"}'
    headers = _signed_headers(body, secret, "wh_1")
    monkeypatch.setattr(security, "_load_secrets", lambda: None)
    security._SECRETS.clear()
    security._SECRETS["buyer"] = secret

    assert security.verify_agentphone_signature(
        body,
        headers["x-webhook-signature"],
        headers["x-webhook-timestamp"],
        headers["x-webhook-id"],
        "buyer",
    ) is True
    security.complete_agentphone_webhook("buyer", "wh_1")
    assert security.verify_agentphone_signature(
        body,
        headers["x-webhook-signature"],
        headers["x-webhook-timestamp"],
        headers["x-webhook-id"],
        "buyer",
    ) is False

    body_only = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    with pytest.raises(HTTPException, match="bad webhook signature"):
        security.verify_agentphone_signature(
            body, body_only, headers["x-webhook-timestamp"], "wh_2", "buyer",
        )


def test_failed_webhook_processing_releases_id_for_provider_retry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    secret = "test-secret"
    body = json.dumps({"event": "agent.message", "channel": "voice", "data": {}}).encode()
    headers = _signed_headers(body, secret, "wh_retry")
    monkeypatch.setattr(security, "_load_secrets", lambda: None)
    security._SECRETS.clear()
    security._SECRETS["buyer"] = secret
    calls = 0

    async def process(_agent_id: str, _body: bytes) -> JSONResponse:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("transient failure")
        return JSONResponse({"ok": True})

    monkeypatch.setattr(main, "_process_agentphone_webhook", process)

    with pytest.raises(RuntimeError, match="transient failure"):
        asyncio.run(main.webhook_agent("buyer", _request(body, headers)))
    response = asyncio.run(main.webhook_agent("buyer", _request(body, headers)))

    assert calls == 2
    assert response.status_code == 200
    assert security._WEBHOOK_DELIVERIES[("buyer", "wh_retry")][0] == "completed"


def test_buyer_followup_marks_sent_only_after_success_and_retries_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.integrations import agentmail

    event = MarketplaceEvent(
        id="event-followup",
        homeowner_call_id="call-followup",
        spec={"user_email": "mover@test.invalid"},
    )
    state.events[event.id] = event
    ctx = BuyerCallContext(
        call_id="call-followup",
        event_id=event.id,
        dispatched=True,
        parsed_spec=event.spec,
        collected=event.spec.copy(),
    )
    state.buyer_contexts[ctx.call_id] = ctx
    attempts = 0

    async def send(**_kwargs: Any) -> dict[str, str]:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise RuntimeError("mail unavailable")
        return {"message_id": "msg_1"}

    monkeypatch.setattr(agentmail, "send_buyer_followup_form", send)

    async def scenario() -> None:
        await main._handle_call_ended("buyer", {"callId": ctx.call_id})
        await asyncio.sleep(0)
        assert ctx.followup_sent is False
        assert ctx.followup_in_progress is False
        await main._handle_call_ended("buyer", {"callId": ctx.call_id})
        await asyncio.sleep(0)

    asyncio.run(scenario())
    assert attempts == 2
    assert ctx.followup_sent is True
    assert ctx.followup_in_progress is False


def test_field_corrections_sync_event_and_sensitive_values_are_not_broadcast() -> None:
    event = MarketplaceEvent(id="event-fields", homeowner_call_id="call-fields", spec={})
    state.events[event.id] = event
    ctx = BuyerCallContext(call_id="call-fields", event_id=event.id, turn_count=1)
    state.buyer_contexts[ctx.call_id] = ctx

    first = main._extract_and_merge_fields(
        '{"origin_address":"123 Main St, SF, CA 94103",'
        '"user_email":"first@test.invalid","pge_last4_ssn":"1234"}',
        ctx,
    )
    corrected = main._extract_and_merge_fields(
        '{"origin_address":"456 Oak St, SF, CA 94107",'
        '"user_email":"second@test.invalid"}',
        ctx,
    )

    assert first["origin_address"].startswith("123")
    assert "pge_last4_ssn" not in ctx.collected
    assert corrected["origin_address"].startswith("456")
    assert event.spec["origin_address"].startswith("456")
    assert event.spec["user_email"] == "second@test.invalid"
    assert main._safe_field_display(corrected) == {
        "origin_address": "[collected]",
        "user_email": "[collected]",
    }


def test_browser_adapter_and_missing_fields_are_needs_user_action() -> None:
    persona = by_id("pge_shutoff")
    spec = {
        "origin_address": "123 Main St, SF, CA 94103",
        "move_date": "2026-09-01",
        "pge_account_number": "account",
        "pge_last4_ssn": "1234",
    }
    event = MarketplaceEvent(id="event-browser", homeowner_call_id="call", spec=spec)
    event.specialist_calls[persona.agent_id] = SpecialistCallContext(
        call_id="pending", agent_id=persona.agent_id, event_id=event.id,
    )
    state.events[event.id] = event

    asyncio.run(marketplace._run_one(persona, event.id, spec))

    ctx = event.specialist_calls[persona.agent_id]
    assert ctx.state == "needs-user-action"
    assert ctx.terminal_outcome == "needs_user_action"
    assert ctx.blocker_kind == "integration_unavailable"
    assert ctx.transcript == []
    assert marketplace.missing_prerequisites("pge_shutoff", {}) == [
        "origin_address", "move_date", "pge_account_number", "pge_last4_ssn",
    ]


def test_sensitive_workflows_never_reach_provider_adapters(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from unittest.mock import AsyncMock

    browser = AsyncMock(return_value={"task_id": "must-not-run"})
    email = AsyncMock(return_value={"message_id": "must-not-run"})
    mail = AsyncMock(return_value={"letter_id": "must-not-run"})
    monkeypatch.setattr(marketplace, "_run_browser", browser)
    monkeypatch.setattr(marketplace, "_run_email", email)
    monkeypatch.setattr(marketplace, "_run_mail", mail)
    monkeypatch.setattr(marketplace.ws_broker, "broadcast", AsyncMock())

    event = MarketplaceEvent(id="event-policy", homeowner_call_id="call", spec={})
    state.events[event.id] = event
    for agent_id in marketplace.MANDATORY_USER_ACTION:
        event.specialist_calls[agent_id] = SpecialistCallContext(
            call_id="pending", agent_id=agent_id, event_id=event.id,
        )

    async def scenario() -> None:
        for agent_id in marketplace.MANDATORY_USER_ACTION:
            await marketplace._run_one(by_id(agent_id), event.id, {})

    asyncio.run(scenario())

    browser.assert_not_awaited()
    email.assert_not_awaited()
    mail.assert_not_awaited()
    for context in event.specialist_calls.values():
        assert context.state == "needs-user-action"
        assert context.terminal_outcome == "needs_user_action"
        assert context.blocker_kind == "secure_user_workflow_required"
        assert context.bid and context.bid["outcome"] == "needs_user_action"


def test_buyer_followup_does_not_invite_unimplemented_reply_or_intake(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.integrations import agentmail

    captured: dict[str, Any] = {}

    async def send(**kwargs: Any) -> dict[str, str]:
        captured.update(kwargs)
        return {"message_id": "msg-safe"}

    monkeypatch.setattr(agentmail, "_send_via_agentmail", send)
    result = asyncio.run(agentmail.send_buyer_followup_form(
        event_id="event-safe-followup",
        to_email="mover@test.invalid",
        user_name="Demo Mover",
        missing_fields=[],
        blocked_agents=[{"agent_id": "pcp_transfer", "missing_fields": ["user_dob"]}],
    ))

    assert result == {"message_id": "msg-safe"}
    body = captured["body"].lower()
    assert "replies are not processed" in body
    assert "reply to this email" not in body
    assert "reply any time" not in body
    assert "relocate.example/secure" not in body
    assert "reply_to" not in captured
    assert "paused" in captured["subject"].lower()


def test_hipaa_pdf_requires_explicit_signature_and_escapes_markup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.integrations import hipaa_pdf

    base = {
        "patient_name": "<script>alert(1)</script>",
        "patient_dob": "1990-01-01",
        "patient_address": "1 Main & 2nd",
        "patient_phone": "+15555550123",
        "patient_email": "patient@test.invalid",
        "current_provider_name": "<b>Untrusted Provider</b>",
        "current_provider_address": "1 <i>Clinic</i> Way",
    }
    with pytest.raises(ValueError, match="signature_name"):
        hipaa_pdf.build_hipaa_release_pdf(
            **base, signature_name=" ", signature_date="2030-01-01",
        )
    with pytest.raises(ValueError, match="signature_date"):
        hipaa_pdf.build_hipaa_release_pdf(
            **base, signature_name="Demo Mover", signature_date=" ",
        )

    paragraph_inputs: list[str] = []
    original_paragraph = hipaa_pdf.Paragraph

    def recording_paragraph(text: str, *args: Any, **kwargs: Any) -> Any:
        paragraph_inputs.append(text)
        return original_paragraph(text, *args, **kwargs)

    monkeypatch.setattr(hipaa_pdf, "Paragraph", recording_paragraph)
    pdf = hipaa_pdf.build_hipaa_release_pdf(
        **base,
        records_scope="Labs <img src='x'/>",
        purpose="Care & follow-up",
        signature_name="<b>Demo Mover</b>",
        signature_date="2030-01-01",
    )

    assert pdf.startswith(b"%PDF")
    joined = "\n".join(paragraph_inputs)
    assert "<script>" not in joined
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in joined
    assert "<b>Untrusted Provider</b>" not in joined
    assert "&lt;b&gt;Untrusted Provider&lt;/b&gt;" in joined
    assert "<img" not in joined
    assert "&lt;img" in joined


def test_receipt_pdf_handles_absent_counterfactual() -> None:
    from app.integrations.pdf_receipt import build_receipt_pdf

    pdf = build_receipt_pdf(
        event_id="event-no-baseline",
        homeowner_name="Demo Mover",
        spec={},
        specialist_results=[],
        pavo_summary={"decisions": 1, "local_share_pct": 100, "pavo_cents": 1.0},
    )
    assert pdf.startswith(b"%PDF")


def test_finalizer_is_idempotent_and_uses_only_observed_outcomes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    event = MarketplaceEvent(
        id="event-final",
        homeowner_call_id="call-final",
        spec={"user_email": "mover@test.invalid", "user_phone": "+15555550123"},
    )
    event.specialist_calls["mover_quote"] = SpecialistCallContext(
        call_id="pending",
        agent_id="mover_quote",
        event_id=event.id,
        state="submitted",
        terminal_outcome="submitted",
        bid={"messages": [{"message_id": "msg_1"}]},
    )
    state.events[event.id] = event
    email_bodies: list[str] = []
    persists = 0
    broadcasts: list[dict[str, Any]] = []

    async def send_summary(**kwargs: Any) -> dict[str, str]:
        email_bodies.append(kwargs["body_markdown"])
        return {"message_id": "summary_1"}

    async def persist(**_kwargs: Any) -> dict[str, str]:
        nonlocal persists
        persists += 1
        return {"id": "memory_1"}

    async def broadcast(payload: dict[str, Any]) -> None:
        broadcasts.append(payload)

    monkeypatch.setattr(marketplace.am, "send_move_package", send_summary)
    monkeypatch.setattr(marketplace, "persist_move", persist)
    monkeypatch.setattr(marketplace.ws_broker, "broadcast", broadcast)

    async def scenario() -> None:
        await marketplace.finalize_event(event.id)
        await marketplace.finalize_event(event.id)

    asyncio.run(scenario())

    assert len(email_bodies) == 1
    assert persists == 1
    assert "$1,840" not in email_bodies[0]
    assert "submitted" in email_bodies[0]
    assert event.final_outcome == "submitted"
    assert [item["type"] for item in broadcasts] == ["event_finalized"]


def test_no_fabricated_baseline_or_raw_field_values_are_emitted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[dict[str, Any]] = []

    async def broadcast(payload: dict[str, Any]) -> None:
        events.append(payload)

    class Reply:
        content = (
            'Thanks. {"origin_address":"123 Main St, SF, CA 94103",'
            '"destination_address":"456 Oak St, Austin, TX 78701",'
            '"move_date":"2026-09-01","user_email":"mover@test.invalid",'
            '"has_pets":false,"has_children":false,"has_car":false,"has_visa":false}'
        )
        tier = "gemma-local"
        cost_cents = 1.0
        decision_reason = "test"

    async def pavo(*_args: Any, **_kwargs: Any) -> Reply:
        return Reply()

    async def no_fanout(_event_id: str, _spec: dict[str, Any]) -> None:
        return None

    monkeypatch.setattr(main.ws_broker, "broadcast", broadcast)
    monkeypatch.setattr(main, "pavo_chat", pavo)
    monkeypatch.setattr(main, "fan_out", no_fanout)

    async def consume() -> None:
        response = await main._handle_buyer_turn("call-cost", "moving", [])
        saw_chunk = False
        async for _chunk in response.body_iterator:  # type: ignore[union-attr]
            saw_chunk = True
        assert saw_chunk

    asyncio.run(consume())

    cost = next(event for event in events if event["type"] == "cost_update")
    fields = next(event for event in events if event["type"] == "fields_collected")
    assert cost["pavo_cents"] == 1.0
    assert cost["baseline_cents"] is None
    assert set(fields["values"].values()) == {"[collected]"}
    assert all("@" not in str(value) for value in fields["values"].values())


def test_dev_trigger_requires_nonproduction_enablement_and_bearer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request = _request(b"{}", {"authorization": "Bearer correct"})
    monkeypatch.setattr(main.settings, "app_env", "development")
    monkeypatch.setattr(main.settings, "enable_dev_trigger", False)
    monkeypatch.setattr(main.settings, "admin_api_token", "correct")
    with pytest.raises(HTTPException) as disabled:
        main._require_dev_trigger_access(request)
    assert disabled.value.status_code == 404

    monkeypatch.setattr(main.settings, "enable_dev_trigger", True)
    main._require_dev_trigger_access(request)
