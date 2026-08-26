"""Twilio as a second telephony rail.

The concierge core is shared with AgentPhone and the browser mic, so what
matters here is the translation layer: only genuinely-signed requests may
drive a call, the TwiML is well-formed, and a hang-up dispatches exactly
like every other rail.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app import main
from app.config import settings
from app.integrations.twilio_voice import gather_twiml, hangup_twiml, verify_signature
from app.state import state


TOKEN = "test-twilio-token"
BASE = "http://testserver"
VOICE_URL = f"{BASE}/webhook/twilio/voice"


def _sign(url: str, params: dict[str, str]) -> str:
    payload = url + "".join(f"{k}{params[k]}" for k in sorted(params))
    digest = hmac.new(TOKEN.encode(), payload.encode(), hashlib.sha1).digest()
    return base64.b64encode(digest).decode("ascii")


@pytest.fixture(autouse=True)
def _rail_on(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setattr(settings, "twilio_auth_token", TOKEN)
    monkeypatch.setattr(settings, "public_base_url", BASE)
    state.buyer_contexts.clear()
    state.events.clear()
    main._twilio_history.clear()
    yield
    state.buyer_contexts.clear()
    state.events.clear()
    main._twilio_history.clear()


def test_unsigned_requests_cannot_drive_a_call() -> None:
    client = TestClient(main.app)
    params = {"CallSid": "CA1", "From": "+14155550100"}
    assert client.post("/webhook/twilio/voice", data=params).status_code == 403
    assert client.post(
        "/webhook/twilio/voice", data=params,
        headers={"X-Twilio-Signature": "forged"},
    ).status_code == 403


def test_rail_is_off_when_no_token_is_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "twilio_auth_token", "")
    client = TestClient(main.app)
    assert client.post("/webhook/twilio/voice", data={"CallSid": "CA1"}).status_code == 503


def test_signature_covers_the_exact_parameters() -> None:
    params = {"CallSid": "CA1", "SpeechResult": "moving to Austin"}
    good = _sign(VOICE_URL, params)
    assert verify_signature(auth_token=TOKEN, url=VOICE_URL, params=params, signature=good)
    # One altered parameter invalidates it.
    tampered = dict(params, SpeechResult="moving to Denver")
    assert not verify_signature(
        auth_token=TOKEN, url=VOICE_URL, params=tampered, signature=good,
    )


def test_first_leg_opens_the_conversation() -> None:
    client = TestClient(main.app)
    params = {"CallSid": "CA_open", "From": "+14155550100"}
    res = client.post(
        "/webhook/twilio/voice", data=params,
        headers={"X-Twilio-Signature": _sign(VOICE_URL, params)},
    )
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("application/xml")
    assert "<Gather" in res.text and "Where are you moving from" in res.text
    # The caller's number is captured for recall, as on the AgentPhone rail.
    assert state.buyer_caller_phone["twl_CA_open"] == "+14155550100"


def test_a_spoken_turn_runs_the_shared_concierge_core(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The rail must not re-implement the concierge — only translate."""
    seen: dict[str, object] = {}

    async def fake_turn(call_id: str, transcript: str, history: list[dict]):
        seen["call_id"] = call_id
        seen["transcript"] = transcript
        return {"text": "SF to Austin, got it. Best email?", "event_id": "mkt_1",
                "collected": [], "dispatched": False, "turn": 1}

    monkeypatch.setattr(main, "_run_buyer_turn", fake_turn)
    client = TestClient(main.app)
    params = {"CallSid": "CA_turn", "SpeechResult": "San Francisco to Austin"}
    res = client.post(
        "/webhook/twilio/voice", data=params,
        headers={"X-Twilio-Signature": _sign(VOICE_URL, params)},
    )
    assert res.status_code == 200
    assert seen["call_id"] == "twl_CA_turn"
    assert seen["transcript"] == "San Francisco to Austin"
    assert "SF to Austin, got it." in res.text


def test_twiml_escapes_what_the_model_says() -> None:
    """A reply containing markup must not break the document Twilio parses."""
    xml = gather_twiml(say='Moving to "Smith & Co" <today>', action_url=VOICE_URL)
    assert "&amp;" in xml and "&lt;today&gt;" in xml
    assert xml.startswith("<?xml")
    assert "<Redirect" in xml  # silence must not dead-end the call
    assert "<Hangup/>" in hangup_twiml("Talk soon.")
