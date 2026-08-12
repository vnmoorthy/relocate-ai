"""Pre-seed Supermemory with an unmistakably synthetic prior move.

When the buyer agent answers the inbound call, it queries Supermemory for prior move
history keyed by phone number. If a record exists, the agent can say "I see you moved
from Berkeley to San Francisco last year — same carriers?" — that's a real-world recall
demo, not a stub.

This writes to an external service. The explicit confirmation flag prevents a
developer from mutating a shared account while running ordinary setup checks.

Run intentionally before a demo:
    uv run python scripts/seed_supermemory.py --confirm-write
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx  # noqa: E402
from app.config import settings  # noqa: E402


DEMO_PHONE = settings.demo_homeowner_number
DEMO_NAME = "Demo Mover"
DEMO_EMAIL = "demo.mover@example.com"


async def main() -> None:
    if "--confirm-write" not in sys.argv:
        print("Refusing to write to Supermemory without --confirm-write.")
        print(f"Synthetic lookup key would be: {DEMO_PHONE}")
        sys.exit(2)
    if not settings.supermemory_api_key:
        print("FATAL: SUPERMEMORY_API_KEY not set")
        sys.exit(1)

    documents = [
        {
            "label": "prior_move_2025",
            "content": (
                f"Synthetic demo user: {DEMO_NAME} ({DEMO_EMAIL}, phone {DEMO_PHONE}). "
                "Prior move completed on 2025-09-12: Berkeley CA -> San Francisco CA, "
                "2-bedroom, no pets, 1 adult. "
                "Carriers used: PG&E (electric), Comcast (internet), Geico (auto insurance), "
                "USPS Change of Address filed, mover Atlas Moving & Storage. "
                "All identifiers in this record are synthetic: USPS DEMO-USPS-0001, "
                "Geico DEMO-POLICY-0001, PG&E DEMO-PGE-0001, Comcast DEMO-XFINITY-0001. "
                "Preferred install window: 8am-noon weekdays. Bank: Wells Fargo. "
                "PCP: One Medical SF. Pharmacy: CVS Embarcadero. "
                "This is seeded demonstration content, not evidence of a completed move."
            ),
            "metadata": {
                "user_phone": DEMO_PHONE,
                "user_email": DEMO_EMAIL,
                "user_name": DEMO_NAME,
                "synthetic": True,
                "event_type": "prior_move",
                "completed_at": "2025-09-12",
                "origin": "Berkeley CA",
                "destination": "San Francisco CA",
                "carriers": "PG&E, Comcast, Geico, USPS, Atlas Moving",
            },
        },
        {
            "label": "preferences",
            "content": (
                f"Synthetic demo user {DEMO_NAME} (phone {DEMO_PHONE}) preferences: "
                "prefers Comcast retention department over general line. "
                "Geico policies should be updated at least 2 weeks before move date. "
                "USPS COA always filed first (forwarding kicks in 7-10 business days). "
                "Mover preferences: licensed, bonded, no Mayflower/Allied (prior bad experience). "
                "Install windows always 8am-noon (works from home, can be flexible)."
            ),
            "metadata": {
                "user_phone": DEMO_PHONE,
                "user_name": DEMO_NAME,
                "synthetic": True,
                "event_type": "preferences",
            },
        },
    ]

    async with httpx.AsyncClient(
        timeout=15.0,
        headers={"Authorization": f"Bearer {settings.supermemory_api_key}"},
    ) as client:
        for doc in documents:
            print(f"Seeding: {doc['label']}…", end=" ", flush=True)
            r = await client.post(
                "https://api.supermemory.ai/v3/documents",
                json={"content": doc["content"], "metadata": doc["metadata"]},
            )
            r.raise_for_status()
            data = r.json()
            print(f"OK ({data.get('id')}, {data.get('status')})")

        # Quick search round-trip to confirm recall works
        print()
        print("Verifying recall via /v3/search…")
        r = await client.post(
            "https://api.supermemory.ai/v3/search",
            json={"q": f"user_phone:{DEMO_PHONE} prior_move", "limit": 3},
        )
        r.raise_for_status()
        d = r.json()
        results = d.get("results") or d.get("chunks") or d.get("data") or []
        print(f"Search returned {len(results) if isinstance(results, list) else '?'} hits")
        if isinstance(results, list) and results:
            sample = str(results[0])[:200]
            print(f"  first hit: {sample}")


if __name__ == "__main__":
    asyncio.run(main())
