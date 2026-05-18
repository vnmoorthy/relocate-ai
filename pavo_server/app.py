"""Lambda-side PAVO server: routing + completion in one endpoint.

Runs on the Lambda A100 box (129.146.122.8) alongside vLLM serving Gemma 2-2b-it
on localhost:8001. Listens on 0.0.0.0:8000.

Endpoint:
  POST /v1/chat/completions
    Authorization: Bearer <PAVO_API_KEY>
    Body: {"messages": [...], "role_hint": "...", "max_tokens": N, "prior_tier": "..."}
    Response: {"content": "...", "x_pavo_tier": "...", "x_pavo_cost_cents": N,
               "x_pavo_latency_ms": N, "x_pavo_decision_reason": "..."}

The router (route.py) is the only PAVO-proprietary part — trained on the 50K-turn
PAVO-Bench dataset. The completion paths are thin wrappers around vLLM (local) and
the Anthropic Messages API (cloud).
"""
from __future__ import annotations

import logging
import os
import time
from typing import Any

import httpx
from anthropic import AsyncAnthropic
from fastapi import FastAPI, Header, HTTPException, Request
from pydantic import BaseModel

from route import route_turn


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("pavo_server")


PAVO_API_KEY = os.environ.get("PAVO_API_KEY", "local-shared-secret")
VLLM_URL = os.environ.get("VLLM_URL", "http://localhost:8001/v1/chat/completions")
VLLM_MODEL = os.environ.get("VLLM_MODEL", "google/gemma-2-2b-it")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")


app = FastAPI(title="PAVO server", version="0.1.0")
_anthropic: AsyncAnthropic | None = None


def _ant() -> AsyncAnthropic:
    global _anthropic
    if _anthropic is None:
        _anthropic = AsyncAnthropic(api_key=ANTHROPIC_API_KEY)
    return _anthropic


class ChatRequest(BaseModel):
    messages: list[dict[str, str]]
    role_hint: str = "contractor-generic"
    max_tokens: int = 220
    prior_tier: str | None = None


class ChatResponse(BaseModel):
    content: str
    x_pavo_tier: str
    x_pavo_cost_cents: float
    x_pavo_latency_ms: int
    x_pavo_decision_reason: str


def _check_auth(authorization: str | None) -> None:
    expected = f"Bearer {PAVO_API_KEY}"
    if authorization != expected:
        raise HTTPException(401, "invalid PAVO API key")


@app.get("/healthz")
async def healthz() -> dict[str, Any]:
    return {"status": "ok", "vllm_url": VLLM_URL, "model": VLLM_MODEL}


@app.post("/v1/chat/completions", response_model=ChatResponse)
async def chat(req: ChatRequest, authorization: str | None = Header(None)) -> ChatResponse:
    _check_auth(authorization)
    t0 = time.perf_counter()

    last_user = next((m["content"] for m in reversed(req.messages) if m["role"] == "user"), "")
    history_depth = len([m for m in req.messages if m["role"] != "system"])

    decision = route_turn(
        transcript=last_user,
        history_depth=history_depth,
        role_hint=req.role_hint,
        prior_tier=req.prior_tier,
    )
    tier = decision.tier
    reason = decision.reason

    try:
        if tier == "gemma-local":
            text, cost_cents = await _call_vllm(req.messages, req.max_tokens)
        elif tier == "gemini-flash":
            text, cost_cents = await _call_gemini(req.messages, req.max_tokens)
        else:  # claude-opus
            text, cost_cents = await _call_claude("claude-opus-4-7", req.messages, req.max_tokens)
    except Exception as e:
        # Degrade: try Gemini Flash as fallback regardless of tier decision.
        log.warning("tier=%s failed (%s), falling back to gemini-flash", tier, e)
        try:
            text, cost_cents = await _call_gemini(req.messages, req.max_tokens)
            tier = "gemini-flash"
            reason = f"{reason} | fallback-from-error"
        except Exception as e2:
            # Final fallback: gemma local.
            log.warning("gemini fallback also failed (%s), using gemma-local", e2)
            text, cost_cents = await _call_vllm(req.messages, req.max_tokens)
            tier = "gemma-local"
            reason = f"{reason} | double-fallback"

    latency_ms = int((time.perf_counter() - t0) * 1000)
    log.info("route tier=%s history=%d reason=%s latency_ms=%d", tier, history_depth, reason, latency_ms)
    return ChatResponse(
        content=text,
        x_pavo_tier=tier,
        x_pavo_cost_cents=cost_cents,
        x_pavo_latency_ms=latency_ms,
        x_pavo_decision_reason=reason,
    )


async def _call_vllm(messages: list[dict[str, str]], max_tokens: int) -> tuple[str, float]:
    async with httpx.AsyncClient(timeout=20.0) as c:
        r = await c.post(
            VLLM_URL,
            json={
                "model": VLLM_MODEL,
                "messages": messages,
                "max_tokens": max_tokens,
                "temperature": 0.4,
            },
        )
        r.raise_for_status()
        data = r.json()
        text = data["choices"][0]["message"]["content"].strip()
        usage = data.get("usage", {})
        in_tok = usage.get("prompt_tokens", 0)
        out_tok = usage.get("completion_tokens", 0)
        # Effectively free on owned A100; track for fairness.
        cost_cents = (in_tok + out_tok) * 0.000002 * 100
        return text, cost_cents


async def _call_claude(model: str, messages: list[dict[str, str]], max_tokens: int) -> tuple[str, float]:
    if not ANTHROPIC_API_KEY:
        raise RuntimeError("ANTHROPIC_API_KEY not set on Lambda; cannot escalate to cloud")
    sys_msg = next((m["content"] for m in messages if m["role"] == "system"), None)
    non_sys = [m for m in messages if m["role"] != "system"]
    kwargs: dict[str, Any] = {
        "model": model,
        "max_tokens": max_tokens,
        "messages": [{"role": m["role"], "content": m["content"]} for m in non_sys],
    }
    if sys_msg:
        kwargs["system"] = sys_msg
    msg = await _ant().messages.create(**kwargs)
    text = "".join(b.text for b in msg.content if b.type == "text").strip()
    in_per_dollar = {"claude-opus-4-7": 66_666}[model]
    out_per_dollar = {"claude-opus-4-7": 13_333}[model]
    cost = msg.usage.input_tokens / in_per_dollar + msg.usage.output_tokens / out_per_dollar
    return text, cost * 100


async def _call_gemini(messages: list[dict[str, str]], max_tokens: int) -> tuple[str, float]:
    """Call Google Gemini API (Generative Language).

    Gemini 2.0 Flash pricing (per 1M tokens, as of 2025): $0.10 input, $0.40 output.
    """
    if not GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY not set on Lambda; cannot use gemini-flash tier")

    # Convert OpenAI-style messages to Gemini's "contents" + "systemInstruction" shape.
    sys_msg = next((m["content"] for m in messages if m["role"] == "system"), None)
    contents = []
    for m in messages:
        if m["role"] == "system":
            continue
        gemini_role = "user" if m["role"] == "user" else "model"
        contents.append({"role": gemini_role, "parts": [{"text": m["content"]}]})

    body: dict[str, Any] = {
        "contents": contents,
        "generationConfig": {
            "maxOutputTokens": max_tokens,
            "temperature": 0.4,
            # Disable Gemini 2.5 Flash "thinking" — for voice agents we need fast direct
            # replies, not reasoning traces that burn the token budget before any reply.
            "thinkingConfig": {"thinkingBudget": 0},
        },
    }
    if sys_msg:
        body["systemInstruction"] = {"parts": [{"text": sys_msg}]}

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}"
    async with httpx.AsyncClient(timeout=15.0) as c:
        r = await c.post(url, json=body, headers={"Content-Type": "application/json"})
        r.raise_for_status()
        data = r.json()
        candidates = data.get("candidates", [])
        if not candidates:
            raise RuntimeError(f"Gemini returned no candidates: {data}")
        cand = candidates[0]
        content = cand.get("content", {})
        parts = content.get("parts", [])
        if not parts:
            # Likely hit max_tokens during thinking — return a placeholder so the call doesn't fail.
            raise RuntimeError(f"Gemini returned no parts (finishReason={cand.get('finishReason')}). Increase max_tokens or set thinkingBudget=0.")
        text = parts[0]["text"].strip()
        usage = data.get("usageMetadata", {})
        in_tok = usage.get("promptTokenCount", 0)
        out_tok = usage.get("candidatesTokenCount", 0)
        # Gemini 2.0 Flash: $0.10/1M in, $0.40/1M out
        cost = in_tok * 0.10 / 1_000_000 + out_tok * 0.40 / 1_000_000
        return text, cost * 100
