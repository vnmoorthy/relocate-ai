"""When every completion provider is down, say so.

An exhausted provider chain used to escape as a bare 500 — which also loses
the CORS headers, so the browser could only report it as a network blip and
invite a retry that cannot succeed. A stall must be reported, not dressed up
as progress.
"""

from __future__ import annotations

import asyncio
from collections.abc import Iterator
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi.testclient import TestClient

from app import main, pavo_client
from app.config import settings
from app.pavo_client import PavoUnavailableError
from app.state import state


ORIGIN = "http://localhost:3000"


@pytest.fixture(autouse=True)
def _clean(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    state.events.clear()
    state.buyer_contexts.clear()
    main._concierge_hits.clear()
    monkeypatch.setattr(settings, "enable_public_intake", True)
    yield
    state.events.clear()
    state.buyer_contexts.clear()


def test_a_failing_fallback_provider_raises_the_typed_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """anthropic's errors are not httpx errors, so a 401 from an invalid key
    escaped the class the module promises to fail with."""
    import anthropic

    async def dead_fallback(*_a: object, **_kw: object) -> None:
        raise anthropic.AuthenticationError(
            "invalid key",
            response=httpx.Response(401, request=httpx.Request("POST", "http://x")),
            body=None,
        )

    async def dead_pavo(*_a: object, **_kw: object) -> None:
        raise httpx.ReadTimeout("")

    monkeypatch.setattr(pavo_client, "_fallback_claude_haiku", dead_fallback)
    monkeypatch.setattr(httpx.AsyncClient, "post", dead_pavo)

    with pytest.raises(PavoUnavailableError):
        asyncio.run(pavo_client.pavo_chat(
            [{"role": "user", "content": "hi"}], role_hint="buyer",
        ))


def test_concierge_turn_reports_the_outage_with_cors_headers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """503, not 500: an HTTPException is handled inside the middleware stack,
    so CORSMiddleware still attaches its header and the browser can read the
    status instead of guessing."""
    async def unavailable(*_a: object, **_kw: object) -> None:
        raise PavoUnavailableError("no provider")

    monkeypatch.setattr(main, "pavo_chat", unavailable)
    monkeypatch.setattr(main.ws_broker, "broadcast", AsyncMock())

    res = TestClient(main.app).post(
        "/api/public/concierge/turn",
        json={"transcript": "hi", "call_id": "web_outage01"},
        headers={"Origin": ORIGIN},
    )
    assert res.status_code == 503
    assert res.headers["access-control-allow-origin"] == ORIGIN
    # The caller has to be told the turn was not recorded, not just that
    # something broke — otherwise they retry into a loop that cannot succeed.
    assert "not recorded" in res.json()["detail"]


def test_an_abandoned_turn_does_not_leave_a_buyer_agent_looking_alive(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The buyer is broadcast as in-progress before the completion call. A
    turn that dies there must reach a terminal state, or the swarm shows a
    phantom agent working forever."""
    async def unavailable(*_a: object, **_kw: object) -> None:
        raise PavoUnavailableError("no provider")

    sent: list[dict] = []

    async def capture(payload: dict) -> None:
        sent.append(payload)

    monkeypatch.setattr(main, "pavo_chat", unavailable)
    monkeypatch.setattr(main.ws_broker, "broadcast", capture)

    TestClient(main.app).post(
        "/api/public/concierge/turn",
        json={"transcript": "hi", "call_id": "web_outage02"},
    )

    buyer_states = [
        m for m in sent if m.get("type") == "agent_state" and m.get("agent_id") == "buyer"
    ]
    assert buyer_states[0]["state"] == "in-progress"
    assert buyer_states[-1]["state"] == "failed"
