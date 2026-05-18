"""Moss — semantic retrieval of runbooks per specialist call.

Real Moss API (from usemoss/moss): two creds (project_id + project_key), async client.

For Relocate: index utility-cancellation runbooks + city-specific procedures, then at
specialist-dispatch time query "{category} {origin_city}" to retrieve the most
relevant runbook, which is appended to the specialist's system prompt as extra context.

Setup (one-time, before demo):
  1. Sign up at moss.dev, get project_id + project_key.
  2. Create index "move-runbooks".
  3. Upsert runbook docs via `moss_client.upsert()` — see scripts/seed_moss.py.
"""
from __future__ import annotations

import logging

from ..config import settings
from ._common import safe_call


log = logging.getLogger(__name__)


async def retrieve_runbook(event_id: str, query: str, top_k: int = 1) -> dict | None:
    """Semantic-search the Relocate runbooks index. Returns the top-K docs and their scores."""
    has_key = bool(settings.moss_project_id) and bool(settings.moss_project_key)

    async def _do() -> dict:
        # Lazy import — moss SDK only required when key is set.
        from moss import MossClient, QueryOptions  # type: ignore[import-not-found]

        client = MossClient(settings.moss_project_id, settings.moss_project_key)
        await client.load_index(settings.moss_index_name)
        result = await client.query(
            settings.moss_index_name,
            query,
            QueryOptions(top_k=top_k, alpha=0.8),
        )
        return {
            "docs": [
                {"text": d.text, "score": getattr(d, "score", None)}
                for d in result.docs
            ],
            "query": query,
        }

    return await safe_call(
        event_id=event_id,
        sponsor="moss",
        action="runbook_retrieved",
        has_key=has_key,
        real_call=_do,
        stub_detail=f"would retrieve top-{top_k} for: {query[:80]}",
    )


async def retrieve_runbooks_for_specialists(
    event_id: str,
    spec: dict,
    specialist_categories: list[str],
) -> dict[str, str]:
    """For each specialist about to fire, retrieve its top runbook from Moss.

    Returns: dict mapping category -> retrieved runbook text (or empty string in stub mode).
    """
    runbooks: dict[str, str] = {}
    origin_city = spec.get("origin_city", "San Francisco")
    for cat in specialist_categories:
        q = f"{cat} {origin_city} runbook procedures"
        res = await retrieve_runbook(event_id, q, top_k=1)
        if res and res.get("docs"):
            runbooks[cat] = res["docs"][0]["text"]
        else:
            runbooks[cat] = ""
    return runbooks
