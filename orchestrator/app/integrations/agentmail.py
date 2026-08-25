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
from ._common import RecipientNotAllowed, safe_call


log = logging.getLogger(__name__)


_INBOX_ID: str | None = None  # cached after first call


def assert_recipients_allowed(recipients: list[str]) -> None:
    """Fail-safe outbound policy: every recipient must be explicitly allowlisted.

    AGENTMAIL_ALLOWED_RECIPIENTS defaults to empty, which blocks every send —
    including to real institutional intake addresses hardcoded in this module.
    """
    allowlist = settings.agentmail_allowlist
    blocked = sorted(
        addr for addr in recipients if addr.strip().lower() not in allowlist
    )
    if blocked:
        raise RecipientNotAllowed(
            "outbound email blocked; add the intended recipient(s) to "
            f"AGENTMAIL_ALLOWED_RECIPIENTS: {', '.join(blocked)}"
        )


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
    # Same demo-routing contract as every specialist send: an override
    # reroutes the message to the operator's inbox, noting who it was for.
    override = settings.agentmail_demo_recipient_override.strip()
    if override and to_email.lower() != override.lower():
        body_markdown = (
            f"[demo routing: this message would be sent to {to_email}]\n\n{body_markdown}"
        )
        subject = f"[demo → {to_email[:60]}] {subject}"
        to_email = override
    if has_key:
        assert_recipients_allowed([to_email])

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
    # Correlate replies: every outbound subject carries the move reference so
    # an emailed answer can be threaded back to its event (see replies.py).
    if event_id and "[ref:" not in subject:
        subject = f"{subject} [ref:{event_id}:{agent_id}]"
    # Demo routing: reroute every send to the operator's own inbox, noting the
    # true intended recipient in the body. The override address still has to
    # pass the allowlist — belt and suspenders.
    override = settings.agentmail_demo_recipient_override.strip()
    if override and [r.lower() for r in recipients] != [override.lower()]:
        intended = ", ".join(recipients)
        body = f"[demo routing: this message would be sent to {intended}]\n\n{body}"
        subject = f"[demo → {intended[:60]}] {subject}"
        recipients = [override]
    elif override:
        # Already addressed to the override (e.g. the mover's own tracker
        # email) — no rerouting happened, so no relabeling either.
        recipients = [override]
    # Enforced before ANY recipient is contacted so a partially-allowlisted
    # multi-recipient send cannot leak the permitted subset.
    assert_recipients_allowed(recipients)
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
    # Ledger every outbound id: the reply poller skips them, so our own tagged
    # sends can never be ingested as replies to themselves.
    from .replies import note_outbound
    for sent in sent_ids:
        note_outbound(str(sent.get("message_id") or ""), event_id)
    return {"messages": sent_ids, "count": len(sent_ids)}


async def send_tracker_link(
    *, event_id: str, user_email: str, spec: dict
) -> dict | None:
    """Email the mover their shareable /move tracking link after a web dispatch.

    Same pipeline as every specialist send: allowlist-enforced, demo-override
    aware, subject ref-tagged — so replying to this email also threads back.
    """
    link = f"{settings.public_site_url.rstrip('/')}/move/#{event_id}"
    origin = spec.get("origin_address", "your origin")
    dest = spec.get("destination_address", "your destination")
    body = (
        f"Your move is dispatched.\n\n"
        f"Route: {origin} -> {dest}\n"
        f"Track every specialist live: {link}\n\n"
        f"Statuses are honest: submitted means a provider accepted the request, "
        f"not that the change is complete. Anything that needs you is flagged "
        f"on the page.\n\n"
        f"Reply to this email and it threads straight back into your move.\n\n"
        f"- Relocate\n"
    )
    return await _send_via_agentmail(
        event_id=event_id,
        agent_id="concierge",
        to=user_email,
        subject="Your Relocate move is dispatched - track it live",
        body=body,
    )


def _city_of(address: str) -> str:
    """Best-effort city segment of a US-style address for a search query."""
    parts = [seg.strip() for seg in str(address).split(",") if seg.strip()]
    if len(parts) >= 3:
        return parts[-2].rsplit(" ", 1)[0] if any(c.isdigit() for c in parts[-2]) else parts[-2]
    return parts[0] if parts else str(address)


async def send_flight_options(
    *, event_id: str, spec: dict, user_email: str
) -> dict | None:
    """Agent #13 — flight_book. Emails the prepared moving-day flight search.

    No fares are quoted (that would be fabrication without a live search);
    the artifact is a real, personalized deeplink the user clicks to see live
    prices. Booking stays with the user by design.
    """
    from urllib.parse import quote_plus

    origin_city = _city_of(spec.get("origin_address", ""))
    dest_city = _city_of(spec.get("destination_address", ""))
    move_date = spec.get("move_date", "")
    query = f"one way flights from {origin_city} to {dest_city} on {move_date}"
    search_url = f"https://www.google.com/travel/flights?q={quote_plus(query)}"
    pet_note = (
        "- You told us about a pet: in-cabin pet spots are capped per flight "
        "and often bookable only BY PHONE — call the airline right after "
        "picking a flight.\n"
        if spec.get("has_pets") else ""
    )
    kids_note = (
        "- Booking for the family: seat-selection rules differ by fare — "
        "check the airline's seat policy for your fare class before paying "
        "for seats together (Basic Economy often blocks free selection).\n"
        if spec.get("has_children") else ""
    )
    body = (
        f"Your moving-day flight search is set up:\n\n"
        f"  {search_url}\n\n"
        f"That link opens live prices for {origin_city} -> {dest_city} on "
        f"{move_date} (one-way). We read those city names off the addresses "
        f"you gave us — adjust the airports on the page if they are not the "
        f"ones you want.\n\n"
        f"Booking notes:\n"
        f"- One-way fares move most in the 3-6 weeks before the date; set the "
        f"price-tracking toggle on that page and Google emails you drops.\n"
        f"{pet_note}{kids_note}"
        f"- We never book or pay on your behalf: flights need your passport "
        f"name and your card, so the final click is always yours.\n"
    )
    result = await _send_via_agentmail(
        event_id=event_id,
        agent_id="flight_book",
        to=user_email,
        subject=f"Flight search prepared: {origin_city} to {dest_city}, {move_date}",
        body=body,
    )
    if result is not None:
        result["search_url"] = search_url
    return result


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
        f"Customer contact: {user_email}\n\n"
        f"Thanks,\nRelocate on behalf of the customer\n"
    )
    return await _send_via_agentmail(
        event_id=event_id,
        agent_id="mover_quote",
        to=recipients,
        subject=subject,
        body=body,
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
        f"Customer contact: {user_email}\n\n"
        f"Thank you,\nRelocate on behalf of the family\n"
    )
    return await _send_via_agentmail(
        event_id=event_id,
        agent_id="school_district",
        to="enroll@austinisd.org",
        subject=subject,
        body=body,
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
        f"Customer contact: {user_email}\n\n"
        f"Thank you,\nRelocate on behalf of the patient\n"
    )
    return await _send_via_agentmail(
        event_id=event_id,
        agent_id="pcp_transfer",
        to="records@onemedical.com",
        subject=subject,
        body=body,
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
        f"Customer contact: {user_email}\n\n"
        f"Thank you,\nRelocate on behalf of the owner\n"
    )
    return await _send_via_agentmail(
        event_id=event_id,
        agent_id="vet_transfer",
        to=vet_email,
        subject=subject,
        body=body,
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
        f"Customer contact: {user_email}\n\n"
        f"Thank you,\nRelocate on behalf of the member\n"
    )
    return await _send_via_agentmail(
        event_id=event_id,
        agent_id="gym_cancel",
        to="memberservices@equinox.com",
        subject=subject,
        body=body,
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

    subject = "Your Relocate move — live tracker + what still needs you"

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

    tracker_link = f"{settings.public_site_url.rstrip('/')}/move/#{event_id}"

    body_text = f"""{greeting}

Thanks for the call. Track every specialist live here:

  {tracker_link}

Some low-risk tasks may be running, but the tasks listed below are paused. \
Relocate deliberately did not ask for these sensitive fields over the phone.

You can reply to this email — replies thread straight into your move's \
timeline. But NEVER send passwords, payment cards, SSN digits, prescription \
numbers, or account credentials by email: tasks requiring those values remain \
paused until Relocate's secure intake is available, and a separate email lists \
the ready-to-use scripts we prepared for each paused task.

==============================================================
FIELDS BLOCKING TASKS (do not send these by email):
==============================================================

{chr(10).join(field_lines) if field_lines else "  (all collected — nothing pending)"}

==============================================================
WHICH SPECIALISTS ARE WAITING ON WHICH FIELDS:
==============================================================

{chr(10).join(blocked_lines) if blocked_lines else "  (no specialists blocked)"}

No sensitive-data intake link is included because that service is not yet \
implemented. Your tracker labels affected tasks "Needs you"; it will never \
claim they are complete.

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
        f"Customer contact: {user_email}\n\n"
        f"Thank you,\nRelocate on behalf of the patient\n"
    )
    return await _send_via_agentmail(
        event_id=event_id,
        agent_id="pharmacy",
        to="customer.service@cvs.com",
        subject=subject,
        body=body,
    )
