"""Stripe — real test-mode PaymentIntent for the mover deposit.

Fires when the marketplace picks a winning mover bid (~1:05 of demo).
Test mode: no actual money moves, real API call, real receipt UI.
"""
from __future__ import annotations

from typing import Any

from ..config import settings
from ._common import safe_call


async def hold_mover_deposit(event_id: str, amount_cents: int, description: str) -> dict[str, Any] | None:
    """Create a PaymentIntent in Stripe test mode for the mover deposit.

    Returns: the Stripe PaymentIntent dict, or None on failure/stub.
    """
    has_key = bool(settings.stripe_secret_key) and settings.stripe_secret_key != "sk_test_REPLACE_ME"

    async def _do() -> dict[str, Any]:
        import stripe  # imported lazily so the orchestrator boots even if stripe is missing
        stripe.api_key = settings.stripe_secret_key
        intent = await _async_create_intent(amount_cents, description, event_id)
        return {"id": intent.id, "amount": intent.amount, "status": intent.status}

    return await safe_call(
        event_id=event_id,
        sponsor="stripe",
        action="payment_intent_held",
        has_key=has_key,
        real_call=_do,
        stub_detail=f"would hold ${amount_cents/100:.2f} for {description}",
    )


async def _async_create_intent(amount_cents: int, description: str, event_id: str):
    """Wrap stripe sync SDK in a thread executor — stripe-python has limited async support."""
    import asyncio
    import stripe
    return await asyncio.to_thread(
        stripe.PaymentIntent.create,
        amount=amount_cents,
        currency="usd",
        description=description,
        metadata={"event_id": event_id, "demo": "true"},
        # No confirm — we just want a held intent for the demo (no card collection flow on stage).
    )
