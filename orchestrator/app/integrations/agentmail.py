"""AgentMail — sends the move-package receipt email to the homeowner.

Real AgentMail SDK pattern (per docs.agentmail.to/quickstart):
  from agentmail import AgentMail
  client = AgentMail(api_key=...)
  ib = client.inboxes.list().inboxes[0]   # reuse existing
  client.inboxes.messages.send(ib.inbox_id, to=..., subject=..., text=...)

The inbox_id IS the from-address (e.g., vnarasingamoorthy@agentmail.to). We cache
the inbox_id on first use and reuse it; if none exists, we create one.
"""
from __future__ import annotations

import asyncio
import logging

from ..config import settings
from ._common import safe_call


log = logging.getLogger(__name__)


_INBOX_ID: str | None = None  # cached after first call


def _resolve_inbox(client) -> str:
    """Return the inbox_id we'll send from. Cached after first call."""
    global _INBOX_ID
    if _INBOX_ID:
        return _INBOX_ID
    resp = client.inboxes.list()
    inboxes = getattr(resp, "inboxes", [])
    if inboxes:
        _INBOX_ID = inboxes[0].inbox_id
    else:
        ib = client.inboxes.create(display_name="Relocate")
        _INBOX_ID = ib.inbox_id
    log.info("AgentMail inbox: %s", _INBOX_ID)
    return _INBOX_ID


async def send_move_package(
    event_id: str,
    to_email: str,
    subject: str,
    body_markdown: str,
    attachments: list[dict] | None = None,
    html: str | None = None,
) -> dict | None:
    """Send the move-package receipt email via AgentMail.

    attachments: optional list of dicts with keys:
      - filename: str
      - content_type: str (e.g. "application/pdf")
      - content_bytes: bytes (will be base64-encoded)

    The SDK is synchronous, so we run it in a thread executor.
    """
    has_key = bool(settings.agentmail_api_key) and settings.agentmail_api_key != "REPLACE_ME"

    # Fall back to the configured demo recipient when caller passes a placeholder.
    if not to_email or "example.com" in to_email:
        to_email = settings.demo_email_recipient

    async def _do() -> dict:
        def _send_sync():
            import base64
            from agentmail import AgentMail
            from agentmail.attachments.types.send_attachment import SendAttachment

            client = AgentMail(api_key=settings.agentmail_api_key)
            inbox_id = _resolve_inbox(client)

            sdk_attachments = None
            if attachments:
                sdk_attachments = [
                    SendAttachment(
                        filename=a["filename"],
                        content_type=a.get("content_type", "application/octet-stream"),
                        content=base64.b64encode(a["content_bytes"]).decode("ascii"),
                    )
                    for a in attachments
                    if a.get("content_bytes")
                ]

            send_kwargs: dict = {
                "to": to_email,
                "subject": subject,
                "text": body_markdown,
            }
            if html:
                send_kwargs["html"] = html
            if sdk_attachments:
                send_kwargs["attachments"] = sdk_attachments

            msg = client.inboxes.messages.send(inbox_id, **send_kwargs)
            return {
                "inbox_id": inbox_id,
                "message_id": getattr(msg, "message_id", None) or getattr(msg, "id", "?"),
                "to": to_email,
                "subject": subject,
                "attachments": [a["filename"] for a in (attachments or [])],
            }

        # Run the sync SDK call in a thread executor (don't block the asyncio loop).
        return await asyncio.to_thread(_send_sync)

    return await safe_call(
        event_id=event_id,
        sponsor="agentmail",
        action="receipt_sent",
        has_key=has_key,
        real_call=_do,
        stub_detail=f"would email {to_email}: {subject}",
    )
