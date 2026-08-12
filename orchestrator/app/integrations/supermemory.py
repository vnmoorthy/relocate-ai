"""Supermemory — persist user move context across sessions.

Fires at start of buyer call: looks up the user by phone number, recalls their
prior move history (if any), and feeds it back into the buyer agent's first
utterance. For the demo, we pre-seed the user with a fake "prior move" so the
buyer agent can demonstrate recall.
"""
from __future__ import annotations

import httpx

from ..config import settings
from ._common import safe_call


SUPERMEMORY_BASE = "https://api.supermemory.ai/v3"  # adjust to actual


async def recall_user_profile(event_id: str, phone_e164: str) -> dict | None:
    """Look up the user's prior context by phone number."""
    has_key = bool(settings.supermemory_api_key)

    async def _do() -> dict:
        async with httpx.AsyncClient(timeout=5.0) as c:
            r = await c.post(
                f"{SUPERMEMORY_BASE}/search",
                headers={"Authorization": f"Bearer {settings.supermemory_api_key}"},
                json={
                    "q": f"user_phone:{phone_e164} move_history",
                    "limit": 5,
                },
            )
            r.raise_for_status()
            return r.json()

    return await safe_call(
        event_id=event_id,
        sponsor="supermemory",
        action="user_profile_recalled",
        has_key=has_key,
        real_call=_do,
        stub_detail=f"would recall profile for {phone_e164}",
    )


async def persist_move(event_id: str, phone_e164: str, spec: dict, results: dict) -> dict | None:
    """Persist observed workflow states for later recall.

    Real endpoint per probe: POST /v3/documents (NOT /memories — the docs were renamed).
    Returns {"id": "...", "status": "queued"}.
    """
    has_key = bool(settings.supermemory_api_key)

    async def _do() -> dict:
        content = (
            "Relocate workflow status snapshot. Submitted means a provider accepted "
            "a request; needs_user_action means no provider action was claimed. "
            f"Origin: {spec.get('origin_address', '?')}. "
            f"Destination: {spec.get('destination_address', '?')}. "
            f"Relocate date: {spec.get('move_date', '?')}. "
            f"Household: {spec.get('household_size', '?')}BR. "
            f"Specialist outcomes: {results}. "
        )
        async with httpx.AsyncClient(timeout=8.0) as c:
            r = await c.post(
                f"{SUPERMEMORY_BASE}/documents",
                headers={"Authorization": f"Bearer {settings.supermemory_api_key}"},
                json={
                    "content": content,
                    "metadata": {
                        "user_id": phone_e164,
                        "event_id": event_id,
                        "origin": spec.get("origin_address"),
                        "destination": spec.get("destination_address"),
                        "move_date": spec.get("move_date"),
                    },
                },
            )
            r.raise_for_status()
            return r.json()  # {"id": "...", "status": "queued"}

    return await safe_call(
        event_id=event_id,
        sponsor="supermemory",
        action="move_persisted",
        has_key=has_key,
        real_call=_do,
        stub_detail=f"would persist move for {phone_e164}",
    )
