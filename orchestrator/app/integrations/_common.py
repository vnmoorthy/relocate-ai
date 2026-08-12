"""Shared utilities for sponsor integrations.

DRY error-handling pattern per /plan-eng-review code-quality issue 8:
  - All integrations wrap in try/except.
  - On success, emit `sponsor_event` to dashboard with action + detail.
  - On failure, log + emit `sponsor_event` with action='error' + detail; do NOT raise.
  - On missing API key, emit `sponsor_event` with action='stubbed' so the dashboard
    still lights up that sponsor's card.
"""
from __future__ import annotations

import logging
import time
from typing import Any, Awaitable, Callable

from ..ws import ws_broker


log = logging.getLogger(__name__)


def _result_shape(result: Any) -> str | None:
    """Return useful integration telemetry without values, tokens, or PII."""
    if result is None:
        return None
    if isinstance(result, dict):
        keys = sorted(str(key) for key in result.keys())
        return f"result keys: {', '.join(keys[:12])}"
    if isinstance(result, (list, tuple, set)):
        return f"result items: {len(result)}"
    return f"result type: {type(result).__name__}"


async def emit_sponsor_event(
    *,
    event_id: str,
    sponsor: str,
    action: str,
    detail: str | None = None,
) -> None:
    """Push a sponsor_event to all dashboard subscribers."""
    await ws_broker.broadcast({
        "type": "sponsor_event",
        "event_id": event_id,
        "sponsor": sponsor,
        "action": action,
        # Callers may operate on account/medical/payment data. Sponsor telemetry
        # exposes only an explicit non-secret summary, never raw task prompts.
        "detail": detail,
        "ts": time.time(),
    })


async def safe_call(
    *,
    event_id: str,
    sponsor: str,
    action: str,
    has_key: bool,
    real_call: Callable[[], Awaitable[Any]],
    stub_detail: str = "no API key — running in stub mode",
) -> Any:
    """Run a sponsor's real API call, or stub it if no key.

    Always emits a sponsor_event to the dashboard (so the sponsor card lights up
    regardless of whether the call hit the real API or got stubbed).
    """
    if not has_key:
        await emit_sponsor_event(
            event_id=event_id,
            sponsor=sponsor,
            action="not_configured",
            detail="provider integration is not configured",
        )
        return None
    try:
        result = await real_call()
        await emit_sponsor_event(
            event_id=event_id,
            sponsor=sponsor,
            action=action,
            detail=_result_shape(result),
        )
        return result
    except Exception as e:  # broad on purpose — demo must not die on sponsor failure
        log.exception("sponsor %s.%s failed", sponsor, action)
        await emit_sponsor_event(
            event_id=event_id,
            sponsor=sponsor,
            action="error",
            detail=f"{type(e).__name__}; provider details redacted",
        )
        return None
