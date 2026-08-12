"""PAVO routing and completion service.

The repository contains a transparent heuristic router (``route.py``) and provider
adapters for a local OpenAI-compatible vLLM server, Gemini, and Anthropic.  The
service deliberately fails when every configured provider fails; it never turns a
provider outage into a fabricated completion.
"""
from __future__ import annotations

import logging
import os
import secrets
import time
import uuid
from contextlib import asynccontextmanager
from typing import Any, Literal

import httpx
from anthropic import AsyncAnthropic
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field, field_validator, model_validator

try:  # Package import in tests and deployed modules.
    from .route import Tier, route_turn
except ImportError:  # ``uvicorn app:app`` from the pavo_server directory.
    from route import Tier, route_turn


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("pavo_server")


SERVICE_VERSION = "1.0.0"
PAVO_API_KEY = os.environ.get("PAVO_API_KEY", "").strip()
VLLM_URL = os.environ.get("VLLM_URL", "http://localhost:8001/v1/chat/completions")
VLLM_MODEL = os.environ.get("VLLM_MODEL", "google/gemma-2-2b-it")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()
ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-opus-4-1")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "").strip()
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")

# Pricing is configuration, not product truth. Providers can change it without a
# source release; operators must set the current values in deployment config.
LOCAL_USD_PER_MILLION = float(os.environ.get("LOCAL_USD_PER_MILLION", "0"))
ANTHROPIC_INPUT_USD_PER_MILLION = float(os.environ.get("ANTHROPIC_INPUT_USD_PER_MILLION", "15"))
ANTHROPIC_OUTPUT_USD_PER_MILLION = float(os.environ.get("ANTHROPIC_OUTPUT_USD_PER_MILLION", "75"))
GEMINI_INPUT_USD_PER_MILLION = float(os.environ.get("GEMINI_INPUT_USD_PER_MILLION", "0.10"))
GEMINI_OUTPUT_USD_PER_MILLION = float(os.environ.get("GEMINI_OUTPUT_USD_PER_MILLION", "0.40"))

_http: httpx.AsyncClient | None = None
_anthropic: AsyncAnthropic | None = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    global _http, _anthropic
    _http = httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=5.0))
    if ANTHROPIC_API_KEY:
        _anthropic = AsyncAnthropic(api_key=ANTHROPIC_API_KEY)
    try:
        yield
    finally:
        if _http is not None:
            await _http.aclose()
        if _anthropic is not None:
            await _anthropic.close()
        _http = None
        _anthropic = None


app = FastAPI(title="PAVO server", version=SERVICE_VERSION, lifespan=lifespan)


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str = Field(min_length=1, max_length=20_000)

    @field_validator("content")
    @classmethod
    def content_must_not_be_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("message content must not be blank")
        return value


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=64)
    role_hint: str = Field(default="contractor-generic", min_length=1, max_length=128)
    max_tokens: int = Field(default=220, ge=1, le=4096)
    prior_tier: Tier | None = None

    @field_validator("role_hint")
    @classmethod
    def normalize_role_hint(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("role_hint must not be blank")
        return value

    @model_validator(mode="after")
    def require_user_message(self) -> ChatRequest:
        if not any(message.role == "user" for message in self.messages):
            raise ValueError("at least one user message is required")
        if sum(len(message.content) for message in self.messages) > 100_000:
            raise ValueError("combined message content is too large")
        return self


class ChatResponse(BaseModel):
    content: str
    x_pavo_tier: Tier
    x_pavo_cost_cents: float = Field(ge=0)
    x_pavo_latency_ms: int = Field(ge=0)
    x_pavo_decision_reason: str
    x_pavo_request_id: str


def _check_auth(authorization: str | None) -> None:
    if not PAVO_API_KEY:
        raise HTTPException(503, "PAVO_API_KEY is not configured")
    scheme, separator, credential = (authorization or "").partition(" ")
    valid = separator == " " and scheme.lower() == "bearer" and secrets.compare_digest(credential, PAVO_API_KEY)
    if not valid:
        raise HTTPException(401, "invalid PAVO API key", headers={"WWW-Authenticate": "Bearer"})


def _client() -> httpx.AsyncClient:
    if _http is None:
        # Direct function tests can run without entering FastAPI lifespan.
        raise RuntimeError("PAVO HTTP client is not initialized")
    return _http


def _ant() -> AsyncAnthropic:
    if _anthropic is None:
        raise RuntimeError("Anthropic provider is not configured")
    return _anthropic


@app.get("/healthz")
async def healthz() -> dict[str, Any]:
    """Process liveness only; does not disclose internal provider URLs."""
    return {"status": "ok", "version": SERVICE_VERSION, "router": "heuristic-v1"}


@app.get("/readyz")
async def readyz() -> dict[str, Any]:
    """Configuration readiness. Provider reachability belongs in monitoring."""
    if not PAVO_API_KEY:
        raise HTTPException(503, "PAVO_API_KEY is not configured")
    return {
        "status": "ready",
        "providers": {
            "local": True,
            "gemini": bool(GEMINI_API_KEY),
            "anthropic": bool(ANTHROPIC_API_KEY),
        },
    }


@app.get("/v1/models")
async def models(authorization: str | None = Header(None)) -> dict[str, Any]:
    _check_auth(authorization)
    return {
        "object": "list",
        "data": [
            {"id": "pavo-auto", "object": "model", "owned_by": "relocate"},
            {"id": "gemma-local", "object": "model", "owned_by": "local"},
            {"id": "gemini-flash", "object": "model", "owned_by": "google", "available": bool(GEMINI_API_KEY)},
            {"id": "claude-opus", "object": "model", "owned_by": "anthropic", "available": bool(ANTHROPIC_API_KEY)},
        ],
    }


@app.post("/v1/chat/completions", response_model=ChatResponse)
async def chat(req: ChatRequest, authorization: str | None = Header(None)) -> ChatResponse:
    _check_auth(authorization)
    request_id = f"pavo_{uuid.uuid4().hex[:16]}"
    t0 = time.perf_counter()

    messages = [message.model_dump() for message in req.messages]
    last_user = next(message.content for message in reversed(req.messages) if message.role == "user")
    history_depth = sum(message.role != "system" for message in req.messages)
    decision = route_turn(
        transcript=last_user,
        history_depth=history_depth,
        role_hint=req.role_hint,
        prior_tier=req.prior_tier,
    )

    errors: list[str] = []
    text = ""
    cost_cents = 0.0
    actual_tier = decision.tier
    for candidate in _provider_chain(decision.tier):
        try:
            if candidate == "gemma-local":
                text, cost_cents = await _call_vllm(messages, req.max_tokens)
            elif candidate == "gemini-flash":
                text, cost_cents = await _call_gemini(messages, req.max_tokens)
            else:
                text, cost_cents = await _call_claude(messages, req.max_tokens)
            actual_tier = candidate
            break
        except Exception as exc:  # noqa: BLE001 -- provider SDKs expose unrelated error hierarchies.
            errors.append(candidate)
            log.warning("request_id=%s provider=%s failed error_type=%s", request_id, candidate, type(exc).__name__)
    else:
        log.error("request_id=%s all completion providers failed attempted=%s", request_id, errors)
        raise HTTPException(503, "all configured completion providers are unavailable")

    reason = decision.reason
    if actual_tier != decision.tier:
        reason = f"{reason} | provider-fallback:{decision.tier}->{actual_tier}"
    latency_ms = int((time.perf_counter() - t0) * 1000)
    log.info(
        "request_id=%s route_tier=%s actual_tier=%s history=%d latency_ms=%d",
        request_id,
        decision.tier,
        actual_tier,
        history_depth,
        latency_ms,
    )
    return ChatResponse(
        content=text,
        x_pavo_tier=actual_tier,
        x_pavo_cost_cents=cost_cents,
        x_pavo_latency_ms=latency_ms,
        x_pavo_decision_reason=reason,
        x_pavo_request_id=request_id,
    )


def _provider_chain(selected: Tier) -> list[Tier]:
    """Return a deterministic, configured fallback chain without duplicates."""
    available: list[Tier] = ["gemma-local"]
    if GEMINI_API_KEY:
        available.append("gemini-flash")
    if ANTHROPIC_API_KEY:
        available.append("claude-opus")
    return [selected, *(tier for tier in available if tier != selected)]


async def _call_vllm(messages: list[dict[str, str]], max_tokens: int) -> tuple[str, float]:
    response = await _client().post(
        VLLM_URL,
        json={
            "model": VLLM_MODEL,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": 0.4,
        },
    )
    response.raise_for_status()
    data = response.json()
    text = data["choices"][0]["message"]["content"].strip()
    if not text:
        raise RuntimeError("local provider returned an empty completion")
    usage = data.get("usage", {})
    total_tokens = usage.get("prompt_tokens", 0) + usage.get("completion_tokens", 0)
    return text, total_tokens * LOCAL_USD_PER_MILLION / 1_000_000 * 100


async def _call_claude(messages: list[dict[str, str]], max_tokens: int) -> tuple[str, float]:
    system_messages = [message["content"] for message in messages if message["role"] == "system"]
    non_system = [message for message in messages if message["role"] != "system"]
    kwargs: dict[str, Any] = {
        "model": ANTHROPIC_MODEL,
        "max_tokens": max_tokens,
        "messages": non_system,
    }
    if system_messages:
        kwargs["system"] = "\n\n".join(system_messages)
    response = await _ant().messages.create(**kwargs)
    text = "".join(block.text for block in response.content if block.type == "text").strip()
    if not text:
        raise RuntimeError("Anthropic returned an empty completion")
    cost_usd = (
        response.usage.input_tokens * ANTHROPIC_INPUT_USD_PER_MILLION
        + response.usage.output_tokens * ANTHROPIC_OUTPUT_USD_PER_MILLION
    ) / 1_000_000
    return text, cost_usd * 100


async def _call_gemini(messages: list[dict[str, str]], max_tokens: int) -> tuple[str, float]:
    if not GEMINI_API_KEY:
        raise RuntimeError("Gemini provider is not configured")
    system_messages = [message["content"] for message in messages if message["role"] == "system"]
    contents = [
        {
            "role": "user" if message["role"] == "user" else "model",
            "parts": [{"text": message["content"]}],
        }
        for message in messages
        if message["role"] != "system"
    ]
    body: dict[str, Any] = {
        "contents": contents,
        "generationConfig": {"maxOutputTokens": max_tokens, "temperature": 0.4},
    }
    if system_messages:
        body["systemInstruction"] = {"parts": [{"text": "\n\n".join(system_messages)}]}

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
    response = await _client().post(
        url,
        params={"key": GEMINI_API_KEY},
        json=body,
        headers={"Content-Type": "application/json"},
    )
    response.raise_for_status()
    data = response.json()
    candidates = data.get("candidates") or []
    parts = (candidates[0].get("content") or {}).get("parts") if candidates else None
    if not parts:
        finish_reason = candidates[0].get("finishReason") if candidates else "no-candidate"
        raise RuntimeError(f"Gemini returned no completion ({finish_reason})")
    text = "".join(part.get("text", "") for part in parts).strip()
    if not text:
        raise RuntimeError("Gemini returned an empty completion")
    usage = data.get("usageMetadata", {})
    cost_usd = (
        usage.get("promptTokenCount", 0) * GEMINI_INPUT_USD_PER_MILLION
        + usage.get("candidatesTokenCount", 0) * GEMINI_OUTPUT_USD_PER_MILLION
    ) / 1_000_000
    return text, cost_usd * 100
