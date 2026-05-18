"""Lob.com — real certified-mail letters.

Used by agent #3 (comcast_cancel). Comcast has no working online
cancellation flow; sending a certified-mail letter is the canonical
written-notice channel under their terms.

Lob REST: https://docs.lob.com/#tag/Letters
  POST https://api.lob.com/v1/letters
    auth: HTTP Basic (api_key, no password)
    body multipart with: to, from, file (HTML or PDF), mail_type=usps_first_class
                         extra_service=certified for tracking
"""
from __future__ import annotations

import base64
import logging
from typing import Any

import httpx

from ..config import settings
from ._common import emit_sponsor_event


log = logging.getLogger(__name__)


LOB_BASE = "https://api.lob.com/v1"


def _has_key() -> bool:
    return bool(getattr(settings, "lob_api_key", "")) and settings.lob_api_key != "REPLACE_ME"


def _require_key(agent_id: str) -> None:
    if not _has_key():
        raise RuntimeError(
            f"LOB_API_KEY missing — shipping agent {agent_id} cannot send. "
            "Set the key or remove this agent from PERSONAS."
        )


# Lob return-address (one-time setup; ships from Relocate's HQ on file).
DEFAULT_FROM_ADDRESS = {
    "name": "Relocate",
    "address_line1": "1234 Market Street",
    "address_line2": "Suite 100",
    "address_city": "San Francisco",
    "address_state": "CA",
    "address_zip": "94103",
    "address_country": "US",
}


async def send_certified_letter(
    *,
    event_id: str,
    agent_id: str,
    to_address: dict,
    body_html: str,
    description: str,
    from_address: dict | None = None,
) -> dict[str, Any]:
    """Mail a one-page certified letter via Lob.

    Returns: {letter_id, tracking_number, expected_delivery_date, url}.
    Raises on Lob errors — no silent stubs.
    """
    _require_key(agent_id)

    from_addr = from_address or DEFAULT_FROM_ADDRESS
    payload = {
        "description": description,
        "to": to_address,
        "from": from_addr,
        "file": body_html,
        "color": False,
        "mail_type": "usps_first_class",
        "extra_service": "certified",
        "metadata[event_id]": event_id,
        "metadata[agent_id]": agent_id,
    }

    auth_header = "Basic " + base64.b64encode(
        f"{settings.lob_api_key}:".encode("ascii")
    ).decode("ascii")

    await emit_sponsor_event(
        event_id=event_id, sponsor="lob",
        action=f"started[{agent_id}]", detail=description[:160],
    )

    async with httpx.AsyncClient(
        timeout=30.0,
        headers={"Authorization": auth_header},
    ) as c:
        r = await c.post(f"{LOB_BASE}/letters", data=payload)
        if r.status_code >= 400:
            log.error("Lob letters POST failed: %d %s", r.status_code, r.text[:400])
            r.raise_for_status()
        data = r.json()

    artifact = {
        "letter_id": data.get("id"),
        "tracking_number": data.get("tracking_number"),
        "expected_delivery_date": data.get("expected_delivery_date"),
        "url": data.get("url"),  # PDF preview URL Lob hosts
    }
    if not artifact["letter_id"]:
        raise RuntimeError(f"Lob letter creation returned no id for {agent_id}")

    await emit_sponsor_event(
        event_id=event_id, sponsor="lob",
        action=f"sent[{agent_id}]", detail=str(artifact)[:160],
    )
    return artifact


# ──────────────────────────────────────────────────────────────────────
# Per-agent helper
# ──────────────────────────────────────────────────────────────────────


COMCAST_LETTER_HTML = """
<html>
<head><style>
  body {{ font-family: Helvetica, Arial, sans-serif; font-size: 11pt; line-height: 1.4; margin: 1in; }}
  .header {{ margin-bottom: 24pt; }}
  .recipient {{ margin-bottom: 24pt; }}
  .subject {{ font-weight: bold; margin-bottom: 12pt; }}
  .body p {{ margin-bottom: 12pt; }}
  .signature {{ margin-top: 36pt; }}
</style></head>
<body>
  <div class="header">
    <div>{from_name}</div>
    <div>{from_line1}</div>
    <div>{from_city}, {from_state} {from_zip}</div>
    <div style="margin-top:6pt;">{today}</div>
  </div>
  <div class="recipient">
    <div>Comcast Cable Communications, LLC</div>
    <div>Attn: Customer Care</div>
    <div>1701 JFK Boulevard</div>
    <div>Philadelphia, PA 19103</div>
  </div>
  <div class="subject">Re: Written notice of cancellation — account at {origin_address}</div>
  <div class="body">
    <p>To whom it may concern,</p>
    <p>Per the service agreement, I am hereby providing written notice of
    cancellation for the Comcast account associated with the service address
    listed above, effective {move_date}.</p>
    <p>Account holder: {user_name}<br/>
    Account number: {comcast_account_number}<br/>
    Service address: {origin_address}<br/>
    Effective cancellation date: {move_date}</p>
    <p>Reason for cancellation: moving out of Comcast's service area.</p>
    <p>Please confirm cancellation by email to <strong>{user_email}</strong>.
    I will return any rented equipment within the 14-day return window.</p>
    <p>Thank you.</p>
  </div>
  <div class="signature">
    <p>Sincerely,</p>
    <p style="margin-top:24pt;">{user_name}</p>
  </div>
</body>
</html>
"""


async def send_comcast_cancellation_letter(
    *, event_id: str, spec: dict
) -> dict[str, Any]:
    """Agent #3 — Comcast certified-mail cancellation."""
    import datetime as _dt
    today = _dt.date.today().strftime("%B %d, %Y")
    body = COMCAST_LETTER_HTML.format(
        from_name=DEFAULT_FROM_ADDRESS["name"],
        from_line1=DEFAULT_FROM_ADDRESS["address_line1"],
        from_city=DEFAULT_FROM_ADDRESS["address_city"],
        from_state=DEFAULT_FROM_ADDRESS["address_state"],
        from_zip=DEFAULT_FROM_ADDRESS["address_zip"],
        today=today,
        origin_address=spec.get("origin_address", "(origin address)"),
        move_date=spec.get("move_date", "(move date)"),
        user_name=spec.get("user_name", "(account holder)"),
        comcast_account_number=spec.get("comcast_account_number", "(account number)"),
        user_email=spec.get("user_email", "(reply email)"),
    )
    return await send_certified_letter(
        event_id=event_id,
        agent_id="comcast_cancel",
        to_address={
            "name": "Comcast Cable Communications, LLC",
            "address_line1": "Attn: Customer Care",
            "address_line2": "1701 JFK Boulevard",
            "address_city": "Philadelphia",
            "address_state": "PA",
            "address_zip": "19103",
            "address_country": "US",
        },
        body_html=body,
        description=f"Comcast cancellation — {spec.get('origin_address', 'origin')}",
    )
