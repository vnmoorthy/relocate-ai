"""The gated product surface: credential gate, token integrity, scoping.

The credentials are published to reviewers, so the two properties that
matter are (a) the password never has to reach the browser, and (b) a
holder of those credentials sees only moves created through the workspace
— never a real caller's move.
"""

from __future__ import annotations

import time
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app import demo_auth, main
from app.config import settings
from app.state import MarketplaceEvent, SpecialistCallContext, state


@pytest.fixture(autouse=True)
def _demo_enabled(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setattr(settings, "demo_username", "demo")
    monkeypatch.setattr(settings, "demo_password", "onlyfordemopurposes")
    main._demo_login_hits.clear()
    state.events.clear()
    yield
    state.events.clear()
    main._demo_login_hits.clear()


def _login(client: TestClient) -> str:
    res = client.post(
        "/api/public/demo-login",
        json={"username": "demo", "password": "onlyfordemopurposes"},
    )
    assert res.status_code == 200, res.text
    return res.json()["token"]


def test_login_issues_a_token_and_rejects_bad_credentials() -> None:
    client = TestClient(main.app)
    body = client.post(
        "/api/public/demo-login",
        json={"username": "demo", "password": "onlyfordemopurposes"},
    ).json()
    assert body["token"] and body["expires_at"] > time.time()
    # The password is never echoed back to the browser in any form.
    assert "onlyfordemopurposes" not in str(body)

    for bad in ({"username": "demo", "password": "wrong"},
                {"username": "someone", "password": "onlyfordemopurposes"},
                {}):
        assert client.post("/api/public/demo-login", json=bad).status_code == 401


def test_gate_is_closed_when_no_password_is_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "demo_password", "")
    client = TestClient(main.app)
    assert client.post(
        "/api/public/demo-login", json={"username": "demo", "password": ""},
    ).status_code == 503
    assert client.get("/api/public/demo/moves").status_code == 503


def test_token_must_be_signed_and_unexpired() -> None:
    client = TestClient(main.app)
    token = _login(client)
    ok = client.get(
        "/api/public/demo/moves", headers={"Authorization": f"Bearer {token}"},
    )
    assert ok.status_code == 200

    tampered = token[:-1] + ("a" if token[-1] != "a" else "b")
    assert client.get(
        "/api/public/demo/moves", headers={"Authorization": f"Bearer {tampered}"},
    ).status_code == 401
    assert client.get("/api/public/demo/moves").status_code == 401
    # An expired token is refused even though its signature is genuine.
    expired, _ = demo_auth.issue_token(now=time.time() - settings.demo_session_hours * 3600 - 60)
    assert demo_auth.valid_token(expired) is False


def test_workspace_lists_only_its_own_moves() -> None:
    client = TestClient(main.app)
    token = _login(client)

    private = MarketplaceEvent(
        id="mkt_realcaller", homeowner_call_id="call",
        spec={"origin_address": "1 Private Way, SF, CA 94103"},
        origin_channel="voice",
    )
    private.specialist_calls["mover_quote"] = SpecialistCallContext(
        call_id="c", agent_id="mover_quote", event_id=private.id, state="submitted",
    )
    demo = MarketplaceEvent(
        id="mkt_demoworkspace", homeowner_call_id="web",
        spec={"origin_address": "2 Demo St, SF, CA 94103"},
        origin_channel="demo",
    )
    demo.specialist_calls["mover_quote"] = SpecialistCallContext(
        call_id="c", agent_id="mover_quote", event_id=demo.id, state="submitted",
    )
    state.events[private.id] = private
    state.events[demo.id] = demo

    body = client.get(
        "/api/public/demo/moves", headers={"Authorization": f"Bearer {token}"},
    ).json()

    ids = [m["event_id"] for m in body["moves"]]
    assert ids == ["mkt_demoworkspace"]
    # The real caller's address must not leak through this surface at all.
    assert "1 Private Way" not in str(body)
    row = body["moves"][0]
    assert row["counts"]["submitted"] == 1 and row["counts"]["total"] == 1
    assert row["public_ref"].startswith("pub_")


def test_login_is_rate_limited() -> None:
    client = TestClient(main.app)
    codes = [
        client.post(
            "/api/public/demo-login", json={"username": "demo", "password": "wrong"},
        ).status_code
        for _ in range(main._DEMO_LOGIN_PER_IP_MIN + 1)
    ]
    assert codes[-1] == 429


def test_abandoned_briefs_do_not_clutter_the_workspace() -> None:
    """A concierge session left mid-brief creates an event with no specialists.

    Those showed up as empty "Origin -> Destination · 0 TASKS" rows, which
    reads as broken product rather than as an abandoned draft.
    """
    client = TestClient(main.app)
    token = _login(client)

    abandoned = MarketplaceEvent(
        id="mkt_abandoned", homeowner_call_id="web_x", spec={}, origin_channel="demo",
    )
    dispatched = MarketplaceEvent(
        id="mkt_real", homeowner_call_id="web_y",
        spec={"origin_address": "1 A St, SF, CA 94103"}, origin_channel="demo",
    )
    dispatched.specialist_calls["mover_quote"] = SpecialistCallContext(
        call_id="c", agent_id="mover_quote", event_id=dispatched.id, state="submitted",
    )
    state.events[abandoned.id] = abandoned
    state.events[dispatched.id] = dispatched

    body = client.get(
        "/api/public/demo/moves", headers={"Authorization": f"Bearer {token}"},
    ).json()

    assert [m["event_id"] for m in body["moves"]] == ["mkt_real"]
