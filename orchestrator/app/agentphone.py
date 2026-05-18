"""Thin async REST client for AgentPhone v1 API.

Endpoints we touch:
- POST /agents                              — create agent persona
- POST /agents/{agent_id}/webhook           — register webhook URL
- POST /numbers                             — buy a phone number
- POST /calls                               — place outbound call
- GET  /calls/{call_id}                     — read call state
"""
from __future__ import annotations

import logging
from typing import Any

import httpx

from .config import settings


log = logging.getLogger(__name__)


class AgentPhoneError(Exception):
    pass


class AgentPhoneClient:
    def __init__(self, api_key: str | None = None, base_url: str | None = None) -> None:
        self.api_key = api_key or settings.agentphone_api_key
        self.base_url = (base_url or settings.agentphone_base_url).rstrip("/")
        self._client = httpx.AsyncClient(
            base_url=self.base_url,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            timeout=30.0,
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def _post(self, path: str, json: dict[str, Any]) -> dict[str, Any]:
        r = await self._client.post(path, json=json)
        if r.status_code >= 400:
            log.error("AgentPhone POST %s failed: %d %s", path, r.status_code, r.text[:500])
            raise AgentPhoneError(f"POST {path} -> {r.status_code}: {r.text[:500]}")
        return r.json()

    async def _get(self, path: str) -> dict[str, Any]:
        r = await self._client.get(path)
        if r.status_code >= 400:
            raise AgentPhoneError(f"GET {path} -> {r.status_code}: {r.text[:500]}")
        return r.json()

    # ---- agents ----
    async def create_agent(
        self,
        *,
        name: str,
        system_prompt: str,
        voice_mode: str = "webhook",
        voice: str | None = None,
        begin_message: str | None = None,
        model_tier: str = "turbo",
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "name": name,
            "voiceMode": voice_mode,
            "systemPrompt": system_prompt,
            "modelTier": model_tier,
        }
        if begin_message:
            body["beginMessage"] = begin_message
        if voice:
            body["voice"] = voice
        return await self._post("/agents", body)

    async def set_agent_webhook(
        self,
        agent_id: str,
        url: str,
        timeout: int = 30,
        context_limit: int = 5,
    ) -> dict[str, Any]:
        """Returns {id, url, secret, status, ...} — store the secret for HMAC verify."""
        return await self._post(
            f"/agents/{agent_id}/webhook",
            {"url": url, "timeout": timeout, "contextLimit": context_limit},
        )

    # ---- numbers ----
    async def buy_number(
        self,
        agent_id: str,
        country: str = "US",
        area_code: str | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"agentId": agent_id, "country": country}
        if area_code:
            body["areaCode"] = area_code
        return await self._post("/numbers", body)

    # ---- calls ----
    async def create_outbound_call(
        self,
        *,
        agent_id: str,
        to_number: str,
        from_number_id: str | None = None,
        initial_greeting: str | None = None,
        system_prompt: str | None = None,
        voice: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"agentId": agent_id, "toNumber": to_number}
        if from_number_id:
            body["fromNumberId"] = from_number_id
        if initial_greeting:
            body["initialGreeting"] = initial_greeting
        if system_prompt:
            body["systemPrompt"] = system_prompt
        if voice:
            body["voice"] = voice
        if metadata:
            body["metadata"] = metadata
        return await self._post("/calls", body)

    async def get_call(self, call_id: str) -> dict[str, Any]:
        return await self._get(f"/calls/{call_id}")


_client: AgentPhoneClient | None = None


def get_client() -> AgentPhoneClient:
    global _client
    if _client is None:
        _client = AgentPhoneClient()
    return _client
