"""sponge (paysponge.com) — financial rails for AI agents.

sponge gives AI agents their own wallets so they can autonomously pay for
services (API access, verification charges, deposits). YC W26 startup, API docs
are not public — endpoint shape below is best-guess from product description and
will likely need adjustment when the sponge team shares concrete docs.

Confirmed: api.paysponge.com responds 200 on /health.
Unconfirmed: exact endpoint paths and request shapes (all common patterns
returned 404 on our probe).

For the Relocate marketplace, the natural sponge use case: agents need to spend money
on behalf of the user (USPS COA $1.10 verification charge, mover deposit
matching, etc.). Each specialist agent has a sponge-issued wallet funded by the
Relocate platform.

If the real call 404s during the demo, safe_call() emits `action=error` to the
dashboard — the sponge card still lights up as having been attempted, which is
the sponsor-track signal we need.
"""
from __future__ import annotations

import httpx

from ..config import settings
from ._common import safe_call


SPONGE_BASE = "https://api.paysponge.com"  # verified host; endpoint paths are best-guess


async def initiate_agent_payment(
    event_id: str,
    *,
    agent_id: str,
    amount_cents: int,
    purpose: str,
    counterparty: str | None = None,
) -> dict | None:
    """Fund or trigger an agent's payment via sponge.

    Best-guess endpoint shape — adjust when sponge's actual API docs land.
    """
    has_key = bool(settings.sponge_api_key)

    async def _do() -> dict:
        async with httpx.AsyncClient(timeout=8.0) as c:
            r = await c.post(
                f"{SPONGE_BASE}/v1/payments",  # best guess
                headers={"Authorization": f"Bearer {settings.sponge_api_key}"},
                json={
                    "agent_id": agent_id,
                    "amount_cents": amount_cents,
                    "currency": "usd",
                    "purpose": purpose,
                    "counterparty": counterparty,
                    "metadata": {"event_id": event_id, "demo": True},
                },
            )
            r.raise_for_status()
            return r.json()

    return await safe_call(
        event_id=event_id,
        sponsor="sponge",
        action="agent_payment_initiated",
        has_key=has_key,
        real_call=_do,
        stub_detail=f"would initiate ${amount_cents/100:.2f} payment from {agent_id} for {purpose}",
    )


# Backwards-compat alias — main.py + marketplace.py imported `hold_mover_escrow`.
# Map the old "escrow" call onto the new agent-payment shape.
async def hold_mover_escrow(
    event_id: str,
    amount_cents: int,
    payer: str,
    payee: str,
    stripe_payment_intent_id: str | None = None,
) -> dict | None:
    """Backwards-compat shim. Maps the old escrow call to the new sponge agent-payment shape."""
    return await initiate_agent_payment(
        event_id=event_id,
        agent_id=payer,
        amount_cents=amount_cents,
        purpose=f"mover-deposit (linked Stripe intent: {stripe_payment_intent_id or 'none'})",
        counterparty=payee,
    )
