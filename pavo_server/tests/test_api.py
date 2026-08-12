from __future__ import annotations

from fastapi.testclient import TestClient

from pavo_server import app as service


def test_health_does_not_disclose_provider_url() -> None:
    with TestClient(service.app) as client:
        response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json()["router"] == "heuristic-v1"
    assert "vllm_url" not in response.json()


def test_chat_fails_closed_when_key_is_unconfigured(monkeypatch) -> None:
    monkeypatch.setattr(service, "PAVO_API_KEY", "")
    with TestClient(service.app) as client:
        response = client.post(
            "/v1/chat/completions",
            headers={"Authorization": "Bearer anything"},
            json={"messages": [{"role": "user", "content": "Hello"}]},
        )
    assert response.status_code == 503


def test_chat_rejects_invalid_payload_before_provider_call(monkeypatch) -> None:
    monkeypatch.setattr(service, "PAVO_API_KEY", "a-secure-test-key")
    with TestClient(service.app) as client:
        response = client.post(
            "/v1/chat/completions",
            headers={"Authorization": "Bearer a-secure-test-key"},
            json={"messages": [{"role": "system", "content": "Only a system prompt"}]},
        )
    assert response.status_code == 422


def test_models_requires_auth(monkeypatch) -> None:
    monkeypatch.setattr(service, "PAVO_API_KEY", "a-secure-test-key")
    with TestClient(service.app) as client:
        unauthorized = client.get("/v1/models")
        authorized = client.get("/v1/models", headers={"Authorization": "Bearer a-secure-test-key"})
    assert unauthorized.status_code == 401
    assert authorized.status_code == 200
    assert authorized.json()["data"][0]["id"] == "pavo-auto"


def test_successful_chat_reports_actual_fallback_provider(monkeypatch) -> None:
    monkeypatch.setattr(service, "PAVO_API_KEY", "a-secure-test-key")
    monkeypatch.setattr(service, "GEMINI_API_KEY", "configured-for-routing")

    async def local_failure(messages, max_tokens):
        raise RuntimeError("local unavailable")

    async def gemini_success(messages, max_tokens):
        return "Provider-backed response", 0.25

    monkeypatch.setattr(service, "_call_vllm", local_failure)
    monkeypatch.setattr(service, "_call_gemini", gemini_success)

    with TestClient(service.app) as client:
        response = client.post(
            "/v1/chat/completions",
            headers={"Authorization": "Bearer a-secure-test-key"},
            json={
                "messages": [{"role": "user", "content": "Hello"}],
                "role_hint": "contractor-generic",
            },
        )
    assert response.status_code == 200
    body = response.json()
    assert body["content"] == "Provider-backed response"
    assert body["x_pavo_tier"] == "gemini-flash"
    assert "provider-fallback" in body["x_pavo_decision_reason"]
    assert body["x_pavo_request_id"].startswith("pavo_")


def test_all_provider_failures_are_not_fabricated(monkeypatch) -> None:
    monkeypatch.setattr(service, "PAVO_API_KEY", "a-secure-test-key")
    monkeypatch.setattr(service, "GEMINI_API_KEY", "")
    monkeypatch.setattr(service, "ANTHROPIC_API_KEY", "")

    async def local_failure(messages, max_tokens):
        raise RuntimeError("local unavailable")

    monkeypatch.setattr(service, "_call_vllm", local_failure)
    with TestClient(service.app) as client:
        response = client.post(
            "/v1/chat/completions",
            headers={"Authorization": "Bearer a-secure-test-key"},
            json={"messages": [{"role": "user", "content": "Hello"}]},
        )
    assert response.status_code == 503
    assert "completion" not in response.json()
