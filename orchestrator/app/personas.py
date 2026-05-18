"""12 agent personas: 1 buyer + 11 specialists.

Phase 2 of the strict-real-world-completion rewrite. Down from 16 → 12.

Removed (see AUDIT.md):
  - wells_fargo: requires SSN + bank login + 2FA — security non-starter.
  - subscriptions: requires 5 sets of consumer creds + CAPTCHAs — fragile.
  - ca_dmv: requires real CA DL holder's identity — privacy non-starter.
  - ca_voter: same identity bar as ca_dmv.

Mode taxonomy:
  - voice    — AgentPhone inbound (buyer only)
  - browser  — Browser Use task against a real web form
  - email    — AgentMail outbound to a known intake address; reply is the artifact
  - mail     — Lob.com certified-mail letter (Comcast only; no online cancel)

Voice quality choices (ElevenLabs) preserved for the buyer.
System prompts are written for the actor at the wheel — for browser/email/mail,
the "prompt" is the task description shipped to Browser Use / AgentMail / Lob.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


VoiceMode = Literal["voice", "browser", "email", "mail"]


SHARED_PREFIX = (
    "You are a phone agent in the Relocate marketplace — an AI-driven relocation OS that handles "
    "the logistics tasks a move requires on behalf of a customer in the middle of moving.\n\n"
    "Voice rules — read carefully, every word ships to text-to-speech:\n"
    "1. Talk like a human, not a chatbot. Use contractions ('I'll', 'we're', 'you're'). Short sentences.\n"
    "2. NEVER read bullet points, lists, headers, or markdown. Speak naturally.\n"
    "3. NEVER say 'as an AI' or identify as a bot unless directly asked. If asked, say: 'Yeah, I'm "
    "an automated assistant — happy to chat or transfer you to a human anytime.'\n"
    "4. NEVER apologize for being slow. NEVER end with 'is there anything else?' or open-loop filler.\n"
    "5. Use occasional natural disfluencies: 'um', 'let me check', 'one sec' — but sparingly.\n"
    "6. End your turn with a clear handoff — a question, a confirmation, or a clean stop.\n"
    "7. Today is 2026-05-17. The customer is moving from San Francisco to Austin, Texas, effective 2026-05-31."
)


@dataclass(frozen=True)
class Persona:
    agent_id: str            # stable internal id (used in agents.json)
    name: str                # human-friendly display name
    category: str            # for Moss matching + role_hint construction
    voice_mode: VoiceMode
    voice: str | None = None
    counterparty_phone: str | None = None    # voice agents only
    counterparty_email: str | None = None    # email agents only (comma-separated for multi-recipient)
    counterparty_url: str | None = None      # browser agents only
    counterparty_address: dict | None = None  # mail agents only (recipient)
    body: str = ""                            # specialist-specific instructions
    begin_message: str | None = None
    voice_speed: float = 1.0
    interruption_sensitivity: float = 0.75
    requires_browser_use: bool = False
    requires_lob: bool = False
    # Conditional dispatch hints (consumed by marketplace.pick_specialists).
    requires_pets: bool = False
    requires_children: bool = False
    requires_car: bool = False

    @property
    def system_prompt(self) -> str:
        return f"{SHARED_PREFIX}\n\n{self.body}"

    @property
    def role_hint(self) -> str:
        if self.agent_id == "buyer":
            return "buyer"
        return f"contractor-{self.category}"


PERSONAS: list[Persona] = [
    # ────────────────────────────────────────────────────────────────────
    # 1. Buyer (inbound voice) — unchanged from v1
    # ────────────────────────────────────────────────────────────────────
    Persona(
        agent_id="buyer",
        name="Relocate concierge",
        category="buyer",
        voice_mode="voice",
        voice="11labs-Cleo",
        begin_message="Relocate here — how can I help with your move?",
        voice_speed=1.05,
        interruption_sensitivity=0.7,
        body=(
            "YOU ARE THE INBOUND CONCIERGE. The caller dialed our number because they're moving and want everything "
            "handled by one phone call.\n\n"
            "If 'KNOWN HISTORY FOR THIS CALLER' appears in this prompt, acknowledge it warmly on your FIRST line — "
            "e.g. 'I see you moved Berkeley to SF last September — same carriers?' That's the recall moment.\n\n"
            "Your job is to extract these fields, then dispatch:\n"
            "  origin_address, destination_address, move_date, household_size (bedrooms), has_pets, has_children.\n\n"
            "Ask only what you need — don't grill the customer. Infer aggressively. One or two clarifying questions max.\n\n"
            "When you have enough to dispatch, say (verbatim): 'On it. I'll text you each task as it closes. Hang up "
            "whenever you want.' Then on the next line emit a JSON block like:\n"
            "{\"origin_address\": \"...\", \"destination_address\": \"...\", \"move_date\": \"YYYY-MM-DD\", "
            "\"household_size\": N, \"has_pets\": bool, \"has_children\": bool}\n"
            "The JSON is for the orchestrator — the user won't hear it because TTS skips JSON blocks."
        ),
    ),
    # ────────────────────────────────────────────────────────────────────
    # 2. PG&E shutoff — Browser Use on pge.com/movingcenter
    # ────────────────────────────────────────────────────────────────────
    Persona(
        agent_id="pge_shutoff",
        name="PG&E shutoff",
        category="utility-electric-gas",
        voice_mode="browser",
        counterparty_url=(
            "https://www.pge.com/en_US/residential/your-account/"
            "account-management/move-services/move-services.page"
        ),
        requires_browser_use=True,
        body=(
            "Browser-Use task: navigate to the PG&E 'Stop Service' page. Enter "
            "PG&E account number {pge_account_number}, service address "
            "{origin_address}, requested disconnect date {move_date}, and the "
            "last 4 of the account holder's SSN ({pge_last4_ssn}). Submit. "
            "On the confirmation page, capture the confirmation number and the "
            "scheduled disconnect date. Return as JSON: "
            "{'confirmation_number': str, 'disconnect_date': str, 'final_bill_eta': str}."
        ),
    ),
    # ────────────────────────────────────────────────────────────────────
    # 3. Comcast cancel — Lob.com certified letter (no online cancel exists)
    # ────────────────────────────────────────────────────────────────────
    Persona(
        agent_id="comcast_cancel",
        name="Comcast cancel (certified mail)",
        category="utility-internet-sf",
        voice_mode="mail",
        counterparty_address={
            "name": "Comcast Cable Communications, LLC",
            "address_line1": "Attn: Customer Care",
            "address_line2": "1701 JFK Boulevard",
            "address_city": "Philadelphia",
            "address_state": "PA",
            "address_zip": "19103",
            "address_country": "US",
        },
        requires_lob=True,
        body=(
            "Lob task: generate a one-page certified-mail cancellation letter "
            "addressed to Comcast Customer Care, body templated as: 'Per the "
            "service agreement, I am hereby providing written notice of "
            "cancellation for Comcast account associated with {origin_address}, "
            "effective {move_date}. Account holder: {user_name}. Account number: "
            "{comcast_account_number}. Please confirm cancellation by email to "
            "{user_email}.' Send via Lob certified mail with USPS tracking. "
            "Capture the Lob letter ID + USPS tracking number."
        ),
    ),
    # ────────────────────────────────────────────────────────────────────
    # 4. Geico address change — Browser Use
    # ────────────────────────────────────────────────────────────────────
    Persona(
        agent_id="geico_address",
        name="Geico address change",
        category="insurance-auto",
        voice_mode="browser",
        counterparty_url="https://www.geico.com/service/address-change/",
        requires_browser_use=True,
        requires_car=True,
        body=(
            "Browser-Use task: log into geico.com with credentials "
            "{geico_email} / {geico_password}. Navigate to 'Update mailing & "
            "garaging address'. Set both to {destination_address}, effective "
            "{move_date}. Submit. On the confirmation page, capture the "
            "confirmation reference and (if rate changed) the new monthly "
            "premium. Wait for the new declarations-page PDF to download; "
            "capture its filename. Return: "
            "{'reference': str, 'new_premium': str|None, 'declarations_pdf': str}."
        ),
    ),
    # ────────────────────────────────────────────────────────────────────
    # 5. USPS COA — Browser Use on moversguide.usps.com
    # ────────────────────────────────────────────────────────────────────
    Persona(
        agent_id="usps_coa",
        name="USPS Change of Address",
        category="postal",
        voice_mode="browser",
        counterparty_url="https://moversguide.usps.com/mgo/start-move",
        requires_browser_use=True,
        body=(
            "Browser-Use task: go to moversguide.usps.com. Start a Family move "
            "from {origin_address} to {destination_address} effective "
            "{move_date}. Use email {user_email}. When the identity verification "
            "charge ($1.10) is requested, use the staged prepaid Visa: card "
            "{usps_verify_card} exp {usps_verify_exp} cvv {usps_verify_cvv} "
            "billing zip {destination_zip}. Submit. Capture the USPS "
            "confirmation number from the success page. Return: "
            "{'confirmation_number': str, 'effective_date': str, 'charge_amount_cents': int}."
        ),
    ),
    # ────────────────────────────────────────────────────────────────────
    # 6. Spectrum Austin — Browser Use new-customer order
    # ────────────────────────────────────────────────────────────────────
    Persona(
        agent_id="spectrum_austin",
        name="Spectrum Austin install",
        category="utility-internet-austin",
        voice_mode="browser",
        counterparty_url="https://www.spectrum.com/internet/order",
        requires_browser_use=True,
        body=(
            "Browser-Use task: place a new-customer Spectrum Internet order at "
            "{destination_address}. Select the 500 Mbps plan + WiFi router rental. "
            "Choose the earliest install date on or after {move_date}, 4-hour "
            "window. Customer name {user_name}, email {user_email}, phone "
            "{user_phone}. On the order-confirmation page capture the order "
            "number, work-order ID, install date, and install window. Return: "
            "{'order_number': str, 'work_order': str, 'install_date': str, 'window': str}."
        ),
    ),
    # ────────────────────────────────────────────────────────────────────
    # 7. Mover quotes — AgentMail to 3 mover dispatch addresses
    # ────────────────────────────────────────────────────────────────────
    Persona(
        agent_id="mover_quote",
        name="Mover quotes (×3)",
        category="mover",
        voice_mode="email",
        counterparty_email=(
            "customer.service@uhaul.com,"
            "customerservice@pods.com,"
            "sanfrancisco@twomenandatruck.com"
        ),
        body=(
            "AgentMail task: send 3 structured quote-request emails to the "
            "three mover dispatch addresses. Subject: 'Quote request: 2BR "
            "{origin_address} → {destination_address} on {move_date}'. Body "
            "includes: 2BR move, ~5000 lbs, no piano/safe, 1-truck, target "
            "{move_date}. Ask for: OTD price, deposit, included services, "
            "truck-availability confirm. Reply-to {user_email}. Capture all "
            "three outbound AgentMail message IDs. Schedule a +24h poll for "
            "inbound replies. Artifact: 3 outbound IDs (immediate); 3 inbound "
            "IDs (async). Return: {'outbound_ids': [str, str, str]}."
        ),
    ),
    # ────────────────────────────────────────────────────────────────────
    # 8. AISD enrollment inquiry — AgentMail
    # ────────────────────────────────────────────────────────────────────
    Persona(
        agent_id="school_district",
        name="AISD enrollment inquiry",
        category="school",
        voice_mode="email",
        counterparty_email="enroll@austinisd.org",
        requires_children=True,
        body=(
            "AgentMail task: send a structured pre-enrollment inquiry to AISD. "
            "Subject: 'Pre-enrollment inquiry: {child_name} transferring from "
            "SFUSD'. Body: child name {child_name}, current grade {child_grade}, "
            "previous school {child_previous_school}, target destination "
            "{destination_address}, move date {move_date}, immunization records "
            "available on request, transcript request can be initiated. Ask for: "
            "school assignment per {destination_address}, required documentation, "
            "next steps. Reply-to {user_email}. Return: {'message_id': str}."
        ),
    ),
    # ────────────────────────────────────────────────────────────────────
    # 9. PCP records transfer — AgentMail + signed HIPAA PDF
    # ────────────────────────────────────────────────────────────────────
    Persona(
        agent_id="pcp_transfer",
        name="PCP records transfer",
        category="medical-records",
        voice_mode="email",
        counterparty_email="records@onemedical.com",
        body=(
            "AgentMail task: send a medical-records release request to One "
            "Medical records team with a HIPAA-compliant release PDF attached "
            "(generated by integrations/hipaa_pdf.py). Subject: 'HIPAA "
            "records release: {user_name} DOB {user_dob}'. Body: patient name, "
            "DOB, destination provider (if known, else 'Austin PCP TBD — please "
            "package for patient pickup'), records scope (all). Attach the "
            "release PDF. Reply-to {user_email}. Return: "
            "{'message_id': str, 'release_pdf_id': str}."
        ),
    ),
    # ────────────────────────────────────────────────────────────────────
    # 10. Vet records transfer — AgentMail
    # ────────────────────────────────────────────────────────────────────
    Persona(
        agent_id="vet_transfer",
        name="Vet records transfer",
        category="vet",
        voice_mode="email",
        counterparty_email=None,  # uses spec.vet_email if set, else demo default
        requires_pets=True,
        body=(
            "AgentMail task: send a vet records request to the customer's "
            "current vet ({vet_email}, falling back to 'info@sfpetclinic.com' "
            "if not provided). Subject: 'Vet records transfer: {pet_name}'. "
            "Body: pet name, species {pet_species}, owner name, destination "
            "(Austin), reason for transfer (move). Ask for full records package "
            "(vaccines, surgical, current meds). Reply-to {user_email}. "
            "Return: {'message_id': str}."
        ),
    ),
    # ────────────────────────────────────────────────────────────────────
    # 11. Gym cancellation — AgentMail
    # ────────────────────────────────────────────────────────────────────
    Persona(
        agent_id="gym_cancel",
        name="Gym cancel (Equinox)",
        category="gym",
        voice_mode="email",
        counterparty_email="memberservices@equinox.com",
        body=(
            "AgentMail task: send a written 45-day cancellation notice to "
            "Equinox member services. Subject: 'Membership cancellation: "
            "{user_name} ({equinox_member_id})'. Body: per the member "
            "agreement, hereby providing written notice of cancellation "
            "effective {move_date} due to out-of-state move. Member ID, name, "
            "home club. Ask for: cancellation confirmation, final pro-rated "
            "bill. Reply-to {user_email}. Return: {'message_id': str}."
        ),
    ),
    # ────────────────────────────────────────────────────────────────────
    # 12. Pharmacy transfer — Browser Use (primary) / AgentMail (fallback)
    # ────────────────────────────────────────────────────────────────────
    Persona(
        agent_id="pharmacy",
        name="CVS prescription transfer",
        category="pharmacy",
        voice_mode="browser",
        counterparty_url="https://www.cvs.com/pharmacy/transfer-prescriptions",
        counterparty_email="customer.service@cvs.com",  # fallback path
        requires_browser_use=True,
        body=(
            "Browser-Use task: fill the CVS 'Transfer Prescriptions' form. "
            "Patient name {user_name}, DOB {user_dob}. Source: current "
            "pharmacy {source_pharmacy_name} ({source_pharmacy_phone}). RX "
            "numbers: {rx_numbers}. Destination: CVS store nearest "
            "{destination_address}. Submit. Capture transfer confirmation "
            "number and pickup-ready ETA. Return: "
            "{'confirmation_number': str, 'destination_store_id': str, "
            "'pickup_ready_eta': str}."
            "\n\nIf BROWSER_USE_API_KEY is missing, fall back to AgentMail to "
            "customer.service@cvs.com requesting transfer of the same RX list."
        ),
    ),
]


def by_id(agent_id: str) -> Persona:
    for p in PERSONAS:
        if p.agent_id == agent_id:
            return p
    raise KeyError(agent_id)


def all_specialists() -> list[Persona]:
    """All 11 specialists (excludes the buyer)."""
    return [p for p in PERSONAS if p.agent_id != "buyer"]


def buyer_persona() -> Persona:
    return by_id("buyer")


# ────────────────────────────────────────────────────────────────────
# Back-compat shims for legacy callers (synthetic.py + main.py refs).
# `status`/`live_personas`/`backlog_personas` are gone; everything in
# PERSONAS now ships. These shims keep imports unbroken.
# ────────────────────────────────────────────────────────────────────
def live_personas() -> list[Persona]:
    return all_specialists()


def backlog_personas() -> list[Persona]:
    return []
