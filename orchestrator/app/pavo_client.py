"""Mac-side client to the proprietary PAVO server on Lambda.

The server runs at PAVO_BASE_URL (Lambda A100, alongside vLLM serving Gemma 2-2b-it).
It exposes /v1/chat/completions which does routing + completion in one round trip.

Response shape:
  {
    "content": "<assistant text>",
    "x_pavo_tier": "gemma-local" | "gemini-flash" | "claude-opus",
    "x_pavo_cost_cents": <float>,
    "x_pavo_latency_ms": <int>,
    "x_pavo_decision_reason": "<short string>"
  }

Fallback: if PAVO is unreachable and Anthropic is configured, route the turn
directly to Claude Haiku (reported as tier "claude-haiku" with
decision_reason "pavo-server-fallback"). If neither real provider is
available, fail explicitly rather than fabricating a reply.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass

import anthropic
import httpx
from anthropic import AsyncAnthropic
from anthropic.types import MessageParam

from .config import settings


log = logging.getLogger(__name__)


@dataclass
class PavoReply:
    content: str
    tier: str
    cost_cents: float
    latency_ms: int
    decision_reason: str = ""
    fallback_used: bool = False


class PavoUnavailableError(RuntimeError):
    """No configured, real completion provider could serve the request."""


_anthropic: AsyncAnthropic | None = None


def _ant() -> AsyncAnthropic:
    global _anthropic
    if _anthropic is None:
        _anthropic = AsyncAnthropic(api_key=settings.anthropic_api_key)
    return _anthropic


async def pavo_chat(
    messages: list[dict[str, str]],
    *,
    role_hint: str,
    max_tokens: int = 220,
    prior_tier: str | None = None,
) -> PavoReply:
    """Route a turn through PAVO + return the assistant content with tier metadata.

    role_hint: 'buyer' | 'buyer-extract' | 'contractor-<category>' | 'dispatcher'
    """
    t0 = time.perf_counter()
    url = settings.pavo_base_url.rstrip("/") + "/chat/completions"
    body = {
        "messages": messages,
        "role_hint": role_hint,
        "max_tokens": max_tokens,
        "prior_tier": prior_tier,
    }
    try:
        # Wider than PAVO's own 20s upstream budget on purpose: a client
        # timeout tighter than the server's guarantees we abandon completions
        # the server is still legitimately waiting on, and fall through to the
        # fallback for no reason.
        async with httpx.AsyncClient(timeout=30.0) as c:
            r = await c.post(
                url,
                json=body,
                headers={"Authorization": f"Bearer {settings.pavo_api_key}"},
            )
            r.raise_for_status()
            data = r.json()
            return PavoReply(
                content=data["content"].strip(),
                tier=data.get("x_pavo_tier", "gemma-local"),
                cost_cents=float(data.get("x_pavo_cost_cents", 0.001)),
                latency_ms=int(data.get("x_pavo_latency_ms", int((time.perf_counter() - t0) * 1000))),
                decision_reason=data.get("x_pavo_decision_reason", ""),
            )
    except (httpx.HTTPError, KeyError, ValueError) as e:
        # Fallback to direct Claude Haiku so the demo doesn't die.
        log.warning("PAVO server unreachable (%s); falling back to Claude Haiku direct.", e)
        try:
            return await _fallback_claude_haiku(messages, max_tokens, t0)
        except (anthropic.APIError, httpx.HTTPError, KeyError, ValueError) as fe:
            # An exhausted provider chain is a known failure, not a crash.
            # Raised untyped, it escaped every caller as a bare 500 — which
            # also loses the CORS headers, so the browser could only report it
            # as a network blip and invite a retry that cannot succeed.
            raise PavoUnavailableError(
                f"PAVO failed ({e}) and the fallback provider failed ({fe})"
            ) from fe


# Note: When PAVO server is reachable, tier in response will be one of:
#   "gemma-local" | "gemini-flash" | "claude-opus"
# This client doesn't care about the tier — it just passes the metadata through.


async def _fallback_claude_haiku(messages: list[dict[str, str]], max_tokens: int, t0: float) -> PavoReply:
    if not settings.anthropic_api_key:
        raise PavoUnavailableError(
            "PAVO is unavailable and no real fallback completion provider is configured"
        )
    api_messages: list[MessageParam] = []
    system_prompt = ""
    for message in messages:
        role = message["role"]
        if role == "system":
            system_prompt = message["content"]
        elif role == "user":
            api_messages.append({"role": "user", "content": message["content"]})
        elif role == "assistant":
            api_messages.append({"role": "assistant", "content": message["content"]})

    if system_prompt:
        msg = await _ant().messages.create(
            model="claude-haiku-4-5",
            max_tokens=max_tokens,
            messages=api_messages,
            system=system_prompt,
        )
    else:
        msg = await _ant().messages.create(
            model="claude-haiku-4-5",
            max_tokens=max_tokens,
            messages=api_messages,
        )
    text = "".join(b.text for b in msg.content if b.type == "text").strip()
    if not text:
        raise PavoUnavailableError("the fallback completion provider returned no text")
    cost = msg.usage.input_tokens / 1_000_000 + msg.usage.output_tokens / 200_000
    return PavoReply(
        content=text,
        tier="claude-haiku",
        cost_cents=cost * 100,
        latency_ms=int((time.perf_counter() - t0) * 1000),
        decision_reason="pavo-server-fallback",
        fallback_used=True,
    )
