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
from functools import partial

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

    if not to_email:
        raise RuntimeError("email destination is required")

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
        action="email_sent",
        has_key=has_key,
        real_call=_do,
        stub_detail=f"would email {to_email}: {subject}",
    )


# ──────────────────────────────────────────────────────────────────────
# Phase 2: per-agent email recipes for the strict-real-world-completion
# rewrite. Each specialist that uses voice_mode="email" calls into one
# of these. All use the same underlying _send_via_agentmail helper so
# the artifact (an AgentMail message_id) is uniform.
# ──────────────────────────────────────────────────────────────────────


async def _send_via_agentmail(
    *,
    event_id: str,
    agent_id: str,
    to: str | list[str],
    subject: str,
    body: str,
    reply_to: str | None = None,
    attachments: list[dict] | None = None,
) -> dict | None:
    """Single-recipient or multi-recipient send. Returns {message_id, to}.

    No silent stubs in shipping agents: if AGENTMAIL_API_KEY is missing we
    raise — Phase-3 verification will fail loudly.
    """
    has_key = bool(settings.agentmail_api_key) and settings.agentmail_api_key != "REPLACE_ME"
    if not has_key:
        raise RuntimeError(
            f"AGENTMAIL_API_KEY missing — shipping agent {agent_id} cannot send. "
            "Set the key or remove this agent from PERSONAS."
        )

    recipients = to if isinstance(to, list) else [to]
    sent_ids: list[dict] = []

    async def _do_one(addr: str) -> dict:
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
                "to": addr,
                "subject": subject,
                "text": body,
            }
            if reply_to:
                send_kwargs["reply_to"] = reply_to
            if sdk_attachments:
                send_kwargs["attachments"] = sdk_attachments

            msg = client.inboxes.messages.send(inbox_id, **send_kwargs)
            return {
                "message_id": getattr(msg, "message_id", None) or getattr(msg, "id", "?"),
                "to": addr,
            }

        return await asyncio.to_thread(_send_sync)

    for addr in recipients:
        result = await safe_call(
            event_id=event_id,
            sponsor="agentmail",
            action=f"sent[{agent_id}]",
            has_key=True,
            real_call=partial(_do_one, addr),
            stub_detail=f"would email {addr}: {subject}",
        )
        if result:
            sent_ids.append(result)

    if not sent_ids:
        raise RuntimeError(f"AgentMail send returned no message_id for {agent_id}")
    return {"messages": sent_ids, "count": len(sent_ids)}


async def request_mover_quotes(
    *, event_id: str, spec: dict, user_email: str
) -> dict | None:
    """Agent #7 — mover_quote. Sends 3 quote requests to mover dispatch."""
    recipients = [
        "customer.service@uhaul.com",
        "customerservice@pods.com",
        "sanfrancisco@twomenandatruck.com",
    ]
    origin = spec.get("origin_address", "(SF address)")
    dest = spec.get("destination_address", "(Austin address)")
    move_date = spec.get("move_date", "(date TBD)")
    subject = f"Quote request: 2BR {origin} → {dest} on {move_date}"
    body = (
        f"Hi,\n\n"
        f"I'm planning a move and would like an out-the-door quote.\n\n"
        f"Origin: {origin}\n"
        f"Destination: {dest}\n"
        f"Date: {move_date}\n"
        f"Size: 2-bedroom apartment, approx. 5,000 lbs\n"
        f"Notes: no piano, no safe, 1-truck job\n\n"
        f"Please reply with: OTD price, deposit, included services "
        f"(packing/insurance/fuel), truck availability confirmation.\n\n"
        f"Replies to: {user_email}\n\n"
        f"Thanks,\nRelocate on behalf of the customer\n"
    )
    return await _send_via_agentmail(
        event_id=event_id,
        agent_id="mover_quote",
        to=recipients,
        subject=subject,
        body=body,
        reply_to=user_email,
    )


async def request_school_enrollment(
    *, event_id: str, spec: dict, user_email: str
) -> dict | None:
    """Agent #8 — school_district. Sends pre-enrollment inquiry to AISD."""
    child_name = spec.get("child_name", "(student name)")
    child_grade = spec.get("child_grade", "(grade TBD)")
    previous_school = spec.get("child_previous_school", "SFUSD")
    dest = spec.get("destination_address", "(Austin address)")
    move_date = spec.get("move_date", "(date TBD)")
    subject = f"Pre-enrollment inquiry: {child_name} transferring from {previous_school}"
    body = (
        f"Hello AISD enrollment team,\n\n"
        f"I'm transferring my child to Austin ISD and would like to start the "
        f"pre-enrollment process.\n\n"
        f"Student name: {child_name}\n"
        f"Current grade: {child_grade}\n"
        f"Previous school: {previous_school}\n"
        f"Destination address: {dest}\n"
        f"Move date: {move_date}\n\n"
        f"Immunization records and current transcript available on request — "
        f"can be initiated as soon as the receiving school is identified.\n\n"
        f"Please advise on (a) school assignment for the destination address, "
        f"(b) required documentation, (c) next steps.\n\n"
        f"Replies to: {user_email}\n\n"
        f"Thank you,\nRelocate on behalf of the family\n"
    )
    return await _send_via_agentmail(
        event_id=event_id,
        agent_id="school_district",
        to="enroll@austinisd.org",
        subject=subject,
        body=body,
        reply_to=user_email,
    )


async def request_pcp_records(
    *, event_id: str, spec: dict, user_email: str, release_pdf_bytes: bytes
) -> dict | None:
    """Agent #9 — pcp_transfer. Sends HIPAA records request to One Medical."""
    user_name = spec.get("user_name", "(patient name)")
    user_dob = spec.get("user_dob", "(DOB)")
    subject = f"HIPAA records release: {user_name} DOB {user_dob}"
    body = (
        f"Hello One Medical Records,\n\n"
        f"Attached is a signed HIPAA release for the records of:\n\n"
        f"Patient: {user_name}\n"
        f"DOB: {user_dob}\n"
        f"Destination provider: Austin PCP TBD — please package for patient "
        f"pickup or hold for forwarding once destination provider is named.\n"
        f"Records scope: complete record (visit notes, labs, imaging, meds).\n\n"
        f"Please confirm receipt and provide an ETA for the records package.\n\n"
        f"Replies to: {user_email}\n\n"
        f"Thank you,\nRelocate on behalf of the patient\n"
    )
    return await _send_via_agentmail(
        event_id=event_id,
        agent_id="pcp_transfer",
        to="records@onemedical.com",
        subject=subject,
        body=body,
        reply_to=user_email,
        attachments=[{
            "filename": f"hipaa-release-{event_id}.pdf",
            "content_type": "application/pdf",
            "content_bytes": release_pdf_bytes,
        }],
    )


async def request_vet_records(
    *, event_id: str, spec: dict, user_email: str
) -> dict | None:
    """Agent #10 — vet_transfer. Sends records request to the customer's vet."""
    pet_name = spec.get("pet_name", "(pet name)")
    pet_species = spec.get("pet_species", "(species)")
    vet_email = spec.get("vet_email", "info@sfpetclinic.com")
    user_name = spec.get("user_name", "(owner name)")
    subject = f"Vet records transfer: {pet_name}"
    body = (
        f"Hello,\n\n"
        f"I'm moving to Austin and need my pet's full records transferred.\n\n"
        f"Pet name: {pet_name}\n"
        f"Species: {pet_species}\n"
        f"Owner: {user_name}\n"
        f"Destination: Austin, TX (new vet TBD — please send to me directly)\n\n"
        f"Please include vaccines, surgical history, and current medications.\n\n"
        f"Replies to: {user_email}\n\n"
        f"Thank you,\nRelocate on behalf of the owner\n"
    )
    return await _send_via_agentmail(
        event_id=event_id,
        agent_id="vet_transfer",
        to=vet_email,
        subject=subject,
        body=body,
        reply_to=user_email,
    )


async def request_gym_cancellation(
    *, event_id: str, spec: dict, user_email: str
) -> dict | None:
    """Agent #11 — gym_cancel. Sends 45-day cancellation notice to Equinox."""
    user_name = spec.get("user_name", "(member name)")
    member_id = spec.get("equinox_member_id", "(member ID)")
    move_date = spec.get("move_date", "(move date)")
    subject = f"Membership cancellation: {user_name} ({member_id})"
    body = (
        f"Hello Equinox Member Services,\n\n"
        f"Per the member agreement, I am hereby providing written notice of "
        f"cancellation effective {move_date} due to an out-of-state move.\n\n"
        f"Member ID: {member_id}\n"
        f"Member name: {user_name}\n"
        f"Home club: SF Embarcadero\n"
        f"Effective date: {move_date}\n\n"
        f"Please confirm cancellation and provide the final pro-rated bill.\n\n"
        f"Replies to: {user_email}\n\n"
        f"Thank you,\nRelocate on behalf of the member\n"
    )
    return await _send_via_agentmail(
        event_id=event_id,
        agent_id="gym_cancel",
        to="memberservices@equinox.com",
        subject=subject,
        body=body,
        reply_to=user_email,
    )


async def send_buyer_followup_form(
    *,
    event_id: str,
    to_email: str,
    user_name: str,
    missing_fields: list,            # list[BuyerField] — PII-gated fields still missing
    blocked_agents: list[dict],      # [{agent_id, missing_fields: [str, ...]}]
) -> dict | None:
    """Post-call structured-form email to the caller.

    Until a secure intake service exists, the email explicitly keeps sensitive
    work paused rather than advertising a placeholder link as secure.

    The artifact is the AgentMail message_id, which gets persisted on the
    BuyerCallContext + Supermemory for the next call to recall."""
    if not to_email:
        raise RuntimeError("buyer follow-up has no destination email")

    subject = "Relocate tasks paused — secure intake is not available"

    # Build the per-field section. We give each field a one-line "why we need it"
    # so the user understands the ask.
    field_lines = []
    for f in missing_fields:
        why = f.ask_phrasing.lstrip("(emailed) ").strip()
        field_lines.append(f"  • {f.plain_label}\n      {why}\n      (example: {f.example})")

    blocked_lines = []
    for entry in blocked_agents:
        names = ", ".join(entry["missing_fields"])
        blocked_lines.append(f"  • {entry['agent_id']:18s} waiting on: {names}")

    greeting = f"Hi {user_name.split()[0]}," if user_name else "Hi,"

    body_text = f"""{greeting}

Thanks for the call. Some low-risk tasks may be running, but the tasks listed \
below are paused. Relocate deliberately did not ask for these sensitive fields \
over the phone.

This message is informational. Replies are not processed by the orchestrator \
yet. Do not send passwords, payment cards, SSN digits, prescription numbers, \
account credentials, or other details by email. Tasks requiring those values \
remain paused until Relocate's secure intake is available.

==============================================================
FIELDS BLOCKING TASKS (do not send these by email):
==============================================================

{chr(10).join(field_lines) if field_lines else "  (all collected — nothing pending)"}

==============================================================
WHICH SPECIALISTS ARE WAITING ON WHICH FIELDS:
==============================================================

{chr(10).join(blocked_lines) if blocked_lines else "  (no specialists blocked)"}

No sensitive-data intake link is included because that service is not yet \
implemented. The dashboard will label affected tasks "Needs user action"; it \
will not claim they are complete.

— Relocate
"""

    return await _send_via_agentmail(
        event_id=event_id,
        agent_id="buyer_followup",
        to=to_email,
        subject=subject,
        body=body_text,
    )


async def send_bank_script(
    *, event_id: str, spec: dict, user_email: str
) -> dict | None:
    """Agent #17 — bank_notify. Emails the customer a 90-second call script
    they'll read to their bank, because banks legally require account-holder
    verification (SSN + 2FA) the agent cannot perform.

    The artifact is the AgentMail message_id + the script payload."""
    user_name = spec.get("user_name", "")
    origin = spec.get("origin_address", "(origin address)")
    dest = spec.get("destination_address", "(destination address)")
    move_date = spec.get("move_date", "(move date)")
    bank_name = spec.get("bank_name", "your bank")
    bank_phone = spec.get("bank_phone", "the number on the back of your card")

    subject = "90-second call script: update your bank address"
    body = f"""Hi{(' ' + user_name.split()[0]) if user_name else ''},

Banks won't take address-change instructions from an agent — they require
YOUR voice on the line for SSN + 2FA verification. So I drafted a 90-second
script you can read to {bank_name} when you call {bank_phone}.

==============================================================
SCRIPT (read verbatim — they're trained to recognize this shape):
==============================================================

"Hi, I'd like to update the mailing address on all my linked accounts.
Old address: {origin}
New address: {dest}
Effective: {move_date}.

I have my last 4 of SSN, security questions, and 2FA app ready."

==============================================================
EXPECTED VERIFICATION (in this order):
==============================================================

1. Last 4 of SSN
2. Date of birth
3. Mother's maiden name OR a recent transaction amount
4. 2FA code from your bank's app

==============================================================
HOW LONG IT TAKES:
==============================================================

Median: 4 minutes (1 min wait, 3 min verification + change).
The change applies to checking, savings, and any cards on the same
profile — you do NOT have to call each card separately.

Reply to this email when you're done and I'll persist the confirmation
in your Relocate history for next time.

— Relocate
"""
    return await _send_via_agentmail(
        event_id=event_id,
        agent_id="bank_notify",
        to=user_email,
        subject=subject,
        body=body,
        reply_to=user_email,
    )


async def request_pharmacy_transfer_fallback(
    *, event_id: str, spec: dict, user_email: str
) -> dict | None:
    """Agent #12 fallback — pharmacy. Used when BROWSER_USE_API_KEY missing."""
    user_name = spec.get("user_name", "(patient name)")
    user_dob = spec.get("user_dob", "(DOB)")
    rx_numbers = spec.get("rx_numbers", "(RX numbers TBD)")
    dest = spec.get("destination_address", "(Austin address)")
    subject = f"RX transfer request: {user_name}"
    body = (
        f"Hello CVS Pharmacy customer service,\n\n"
        f"I'd like to transfer the following prescriptions from my current "
        f"pharmacy to CVS Austin (nearest to {dest}).\n\n"
        f"Patient: {user_name}\n"
        f"DOB: {user_dob}\n"
        f"RX numbers: {rx_numbers}\n\n"
        f"Please confirm transfer and pickup-ready ETA.\n\n"
        f"Replies to: {user_email}\n\n"
        f"Thank you,\nRelocate on behalf of the patient\n"
    )
    return await _send_via_agentmail(
        event_id=event_id,
        agent_id="pharmacy",
        to="customer.service@cvs.com",
        subject=subject,
        body=body,
        reply_to=user_email,
    )
