"""Buyer field schema — the single source of truth for what the concierge collects.

Every field the 28 specialists need from `spec` is declared here, classified by:
  - tier: CORE (gates dispatch) | CONDITIONAL (gates which agents fire) |
          OPTIONAL (collect on call if natural) | PII (always follow-up email)
  - voice_safe: True if it's OK to say out loud over the phone
  - agent_ids: which specialists need it
  - ask_phrasing: how the buyer should ask, in plain spoken English
  - validate: regex/callable that decides if a string value looks valid

The buyer's system prompt is *partially generated* from this schema (the
ASK_PHRASING_BLOCK below) so the prompt and the orchestrator can never drift.
The orchestrator's `_handle_buyer_turn` uses `is_dispatch_ready()` to decide
when to fire the swarm, and `pending_pii_fields()` to decide what to put in
the post-call follow-up email.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Callable, Literal


FieldTier = Literal["core", "conditional", "optional", "pii"]


@dataclass(frozen=True)
class BuyerField:
    name: str
    tier: FieldTier
    voice_safe: bool
    agent_ids: tuple[str, ...]
    ask_phrasing: str          # what the buyer might naturally say
    plain_label: str           # what the follow-up email calls it
    example: str               # used in few-shot prompt
    validate: Callable[[str], bool] = lambda v: bool(v and v.strip())


def _is_date(v: str) -> bool:
    return bool(re.match(r"^\d{4}-\d{2}-\d{2}$", v.strip()))


def _is_email(v: str) -> bool:
    return bool(re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", v.strip()))


def _is_bool(v: str | bool) -> bool:
    if isinstance(v, bool):
        return True
    return v.strip().lower() in ("true", "false", "yes", "no", "1", "0")


# Speech recognition emits no punctuation, so a dictated address arrives as
# "1420 Pine Street Philadelphia" — no comma, no ZIP. A street-suffix word is
# the third acceptable shape: it only appears when a street was actually named,
# and the extraction regex upstream is the strict gatekeeper for structure.
_STREET_SUFFIX_HINT = re.compile(
    r"\b(?:Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Drive|Dr|Lane|Ln|Way|"
    r"Court|Ct|Place|Pl|Terrace|Ter|Circle|Cir|Parkway|Pkwy|Highway|Hwy)\b\.?",
    re.IGNORECASE,
)


def _is_address(v: str) -> bool:
    # Heuristic: a street number, plus one structural hint — a comma, a ZIP,
    # or a street-suffix word.
    s = v.strip()
    if not re.search(r"\d", s):
        return False
    return ("," in s) or bool(re.search(r"\b\d{5}\b", s)) or bool(_STREET_SUFFIX_HINT.search(s))


def _is_dob(v: str) -> bool:
    return bool(re.match(r"^\d{4}-\d{2}-\d{2}$", v.strip()))


def _digits(v: str, min_len: int) -> bool:
    return bool(re.match(rf"^\d{{{min_len},}}$", re.sub(r"\D", "", v)))


# ────────────────────────────────────────────────────────────────────
# The full schema (declared in collection order — the buyer follows it)
# ────────────────────────────────────────────────────────────────────


BUYER_FIELDS: list[BuyerField] = [
    # ─── CORE (4): dispatch happens after these ─────────────────────
    BuyerField(
        name="origin_address",
        tier="core", voice_safe=True,
        agent_ids=("pge_shutoff", "comcast_cancel", "geico_address", "usps_coa",
                   "mover_quote", "pcp_transfer", "vet_transfer", "gym_cancel"),
        ask_phrasing="Where are you moving from?",
        plain_label="Origin address (street, city, ZIP)",
        example="123 Main Street, San Francisco, CA 94103",
        validate=_is_address,
    ),
    BuyerField(
        name="destination_address",
        tier="core", voice_safe=True,
        agent_ids=("geico_address", "usps_coa", "spectrum_austin", "mover_quote",
                   "school_district", "pcp_transfer", "vet_transfer", "pharmacy"),
        ask_phrasing="And where to?",
        plain_label="Destination address (street, city, ZIP)",
        example="456 Oak Avenue, Austin, TX 78701",
        validate=_is_address,
    ),
    BuyerField(
        name="move_date",
        tier="core", voice_safe=True,
        agent_ids=("pge_shutoff", "comcast_cancel", "geico_address", "usps_coa",
                   "spectrum_austin", "mover_quote", "school_district",
                   "gym_cancel", "pharmacy"),
        ask_phrasing="When's the move?",
        plain_label="Move date",
        example="2026-05-31",
        validate=_is_date,
    ),
    BuyerField(
        name="user_email",
        tier="core", voice_safe=True,
        agent_ids=("mover_quote", "school_district", "pcp_transfer", "vet_transfer",
                   "gym_cancel", "pharmacy"),  # used as reply-to on every email
        ask_phrasing="What's the best email to send everything to?",
        plain_label="Reply-to email",
        example="you@example.com",
        validate=_is_email,
    ),
    # ─── CONDITIONAL (3): gate which agents fire ───────────────────
    BuyerField(
        name="has_pets",
        tier="conditional", voice_safe=True,
        agent_ids=("vet_transfer",),
        ask_phrasing="Any pets?",
        plain_label="Pets in the household?",
        example="true",
        validate=_is_bool,
    ),
    BuyerField(
        name="has_children",
        tier="conditional", voice_safe=True,
        agent_ids=("school_district",),
        ask_phrasing="Any kids in school?",
        plain_label="Children needing school enrollment?",
        example="false",
        validate=_is_bool,
    ),
    BuyerField(
        name="has_car",
        tier="conditional", voice_safe=True,
        agent_ids=("geico_address", "id_card_update"),
        ask_phrasing="Do you drive — meaning, an auto policy to update?",
        plain_label="Auto policy to update?",
        example="true",
        validate=_is_bool,
    ),
    BuyerField(
        name="has_visa",
        tier="conditional", voice_safe=True,
        agent_ids=("uscis_ar11",),
        ask_phrasing="One quick question — are you on a US visa or green card?",
        plain_label="On a US visa or green card (USCIS AR-11 required within 10 days)",
        example="false",
        validate=_is_bool,
    ),
    # ─── OPTIONAL (8): collect on call if it flows naturally ───────
    BuyerField(
        name="user_name",
        tier="optional", voice_safe=True,
        agent_ids=("comcast_cancel", "school_district", "pcp_transfer", "gym_cancel"),
        ask_phrasing="And your name — first and last?",
        plain_label="Your full name (for letters/emails)",
        example="Jane Smith",
    ),
    BuyerField(
        name="service_authorization_signed",
        tier="optional", voice_safe=False,
        agent_ids=("pge_shutoff", "comcast_cancel", "gym_cancel"),
        ask_phrasing="(emailed) Authorize Relocate to contact your providers",
        plain_label="Authorization for Relocate to act on your behalf",
        example="true",
        validate=_is_bool,
    ),
    BuyerField(
        name="work_address",
        tier="optional", voice_safe=True,
        agent_ids=("housing_search", "commute_route"),
        ask_phrasing="Where will you be working — the office address, roughly?",
        plain_label="Work address at the destination",
        example="500 W 2nd St, Austin, TX 78701",
        validate=_is_address,
    ),
    BuyerField(
        name="household_size",
        tier="optional", voice_safe=True,
        agent_ids=("mover_quote",),
        ask_phrasing="What size place — one-bed, two-bed?",
        plain_label="Bedrooms (mover quote precision)",
        example="2",
    ),
    BuyerField(
        name="pet_name",
        tier="optional", voice_safe=True,
        agent_ids=("vet_transfer",),
        ask_phrasing="What's the pet's name?",
        plain_label="Pet name",
        example="Captain",
    ),
    BuyerField(
        name="pet_species",
        tier="optional", voice_safe=True,
        agent_ids=("vet_transfer",),
        ask_phrasing="Dog, cat, something else?",
        plain_label="Pet species",
        example="dog",
    ),
    BuyerField(
        name="vet_email",
        tier="optional", voice_safe=True,
        agent_ids=("vet_transfer",),
        ask_phrasing="Do you know your current vet's email — or want me to look it up later?",
        plain_label="Current vet's email (records destination)",
        example="info@sfpetclinic.com",
        validate=_is_email,
    ),
    BuyerField(
        name="child_name",
        tier="optional", voice_safe=True,
        agent_ids=("school_district",),
        ask_phrasing="What's your kid's name and grade?",
        plain_label="Child's name",
        example="Sam",
    ),
    BuyerField(
        name="child_grade",
        tier="optional", voice_safe=True,
        agent_ids=("school_district",),
        ask_phrasing="What grade are they in?",
        plain_label="Child's current grade",
        example="3",
    ),
    BuyerField(
        name="child_previous_school",
        tier="optional", voice_safe=True,
        agent_ids=("school_district",),
        ask_phrasing="Which school are they at now?",
        plain_label="Child's current school",
        example="Alvarado Elementary, SFUSD",
    ),
    # ─── PII-GATED (11): never voice; follow-up email or secure form
    BuyerField(
        name="pge_account_number",
        tier="pii", voice_safe=False,
        agent_ids=("pge_shutoff",),
        ask_phrasing="(emailed) Your PG&E account number — it's on any bill",
        plain_label="PG&E account number (printed on your bill)",
        example="1234567890",
        validate=lambda v: _digits(v, 6),
    ),
    BuyerField(
        name="pge_last4_ssn",
        tier="pii", voice_safe=False,
        agent_ids=("pge_shutoff",),
        ask_phrasing="(emailed) Last 4 of SSN for PG&E identity verification",
        plain_label="Last 4 of SSN on the PG&E account",
        example="1234",
        validate=lambda v: _digits(v, 4),
    ),
    BuyerField(
        name="comcast_account_number",
        tier="pii", voice_safe=False,
        agent_ids=("comcast_cancel",),
        ask_phrasing="(emailed) Your Comcast account number",
        plain_label="Comcast account number",
        example="8771203456789012",
        validate=lambda v: _digits(v, 6),
    ),
    BuyerField(
        name="geico_email",
        tier="pii", voice_safe=False,
        agent_ids=("geico_address",),
        ask_phrasing="(emailed) Geico login email — we'll send a link to start, you log in once",
        plain_label="Geico login email",
        example="you@example.com",
        validate=_is_email,
    ),
    BuyerField(
        name="geico_password",
        tier="pii", voice_safe=False,
        agent_ids=("geico_address",),
        ask_phrasing="(emailed via secure session — never typed in chat)",
        plain_label="Geico password (secure session only)",
        example="(never logged)",
    ),
    BuyerField(
        name="equinox_member_id",
        tier="pii", voice_safe=False,
        agent_ids=("gym_cancel",),
        ask_phrasing="(emailed) Your Equinox member ID — on the back of your card",
        plain_label="Equinox member ID",
        example="EQX-1234567",
    ),
    BuyerField(
        name="source_pharmacy_name",
        tier="pii", voice_safe=False,
        agent_ids=("pharmacy",),
        ask_phrasing="(emailed) Your current pharmacy name",
        plain_label="Current pharmacy name",
        example="Walgreens SF Castro",
    ),
    BuyerField(
        name="source_pharmacy_phone",
        tier="pii", voice_safe=False,
        agent_ids=("pharmacy",),
        ask_phrasing="(emailed) Your current pharmacy phone",
        plain_label="Current pharmacy phone",
        example="+14155550199",
    ),
    BuyerField(
        name="rx_numbers",
        tier="pii", voice_safe=False,
        agent_ids=("pharmacy",),
        ask_phrasing="(emailed) RX numbers to transfer (comma-separated)",
        plain_label="Prescription numbers to transfer",
        example="RX-100200300, RX-100200301",
    ),
    BuyerField(
        name="user_dob",
        tier="pii", voice_safe=False,
        agent_ids=("pcp_transfer", "pharmacy"),
        ask_phrasing="(emailed) Date of birth — for HIPAA records request",
        plain_label="Date of birth (YYYY-MM-DD)",
        example="1990-01-01",
        validate=_is_dob,
    ),
    BuyerField(
        name="usps_verify_card",
        tier="pii", voice_safe=False,
        agent_ids=("usps_coa",),
        ask_phrasing="(emailed) USPS charges $1.10 to verify identity — use a prepaid Visa for safety",
        plain_label="Card for USPS $1.10 verification (prepaid recommended)",
        example="(secure entry only)",
    ),
    BuyerField(
        name="usps_verify_exp",
        tier="pii", voice_safe=False,
        agent_ids=("usps_coa",),
        ask_phrasing="(secure entry only) card expiry for the USPS verification charge",
        plain_label="Card expiry for USPS verification (secure entry only)",
        example="(secure entry only)",
    ),
    BuyerField(
        name="usps_verify_cvv",
        tier="pii", voice_safe=False,
        agent_ids=("usps_coa",),
        ask_phrasing="(secure entry only) card CVV for the USPS verification charge",
        plain_label="Card CVV for USPS verification (secure entry only)",
        example="(secure entry only)",
    ),
    BuyerField(
        name="destination_zip",
        tier="pii", voice_safe=False,
        agent_ids=("usps_coa",),
        ask_phrasing="(derived) destination ZIP — taken from the destination address when present",
        plain_label="Destination ZIP code",
        example="78701",
        validate=lambda v: _digits(v, 5),
    ),
    # ─── Signed-authorization gates. These are consent artifacts, not data
    # entry: they can only become true through a secure signature workflow
    # that is not built yet. Declaring them here lets fields_blocking() and
    # the follow-up email name exactly why an agent is paused.
    BuyerField(
        name="comcast_authorization_signed",
        tier="pii", voice_safe=False,
        agent_ids=("comcast_cancel",),
        ask_phrasing="(secure workflow — cannot be granted by phone or email)",
        plain_label="Signed Comcast cancellation authorization (secure workflow required)",
        example="false",
        validate=_is_bool,
    ),
    BuyerField(
        name="hipaa_authorization_signed",
        tier="pii", voice_safe=False,
        agent_ids=("pcp_transfer",),
        ask_phrasing="(secure workflow — cannot be granted by phone or email)",
        plain_label="Signed HIPAA records-release authorization (secure workflow required)",
        example="false",
        validate=_is_bool,
    ),
    BuyerField(
        name="hipaa_signature_name",
        tier="pii", voice_safe=False,
        agent_ids=("pcp_transfer",),
        ask_phrasing="(secure workflow) printed name on the HIPAA release signature",
        plain_label="Printed name on the HIPAA release (secure workflow required)",
        example="(secure entry only)",
    ),
    BuyerField(
        name="hipaa_signature_date",
        tier="pii", voice_safe=False,
        agent_ids=("pcp_transfer",),
        ask_phrasing="(secure workflow) date of the HIPAA release signature",
        plain_label="HIPAA release signature date (secure workflow required)",
        example="(secure entry only)",
    ),
    BuyerField(
        name="gym_authorization_signed",
        tier="pii", voice_safe=False,
        agent_ids=("gym_cancel",),
        ask_phrasing="(secure workflow — cannot be granted by phone or email)",
        plain_label="Signed gym-cancellation authorization (secure workflow required)",
        example="false",
        validate=_is_bool,
    ),
    BuyerField(
        name="dmv_authorization_signed",
        tier="pii", voice_safe=False,
        agent_ids=("id_card_update",),
        ask_phrasing="(secure workflow — cannot be granted by phone or email)",
        plain_label="Wet-signed DMV form authorization (secure workflow required)",
        example="false",
        validate=_is_bool,
    ),
    # ─── v2.1 PII for the 5 newly-added agents ─────────────────────
    BuyerField(
        name="a_number",
        tier="pii", voice_safe=False,
        agent_ids=("uscis_ar11",),
        ask_phrasing="(emailed) Your USCIS A-number (on visa/green card)",
        plain_label="USCIS A-number (9 digits, starts with A)",
        example="A123456789",
    ),
    BuyerField(
        name="sfpuc_username",
        tier="pii", voice_safe=False,
        agent_ids=("water_board",),
        ask_phrasing="(emailed) SFPUC MyAccount username",
        plain_label="SFPUC MyAccount username",
        example="you@example.com",
    ),
    BuyerField(
        name="sfpuc_password",
        tier="pii", voice_safe=False,
        agent_ids=("water_board",),
        ask_phrasing="(secure session) SFPUC MyAccount password",
        plain_label="SFPUC MyAccount password (secure session only)",
        example="(never logged)",
    ),
    BuyerField(
        name="ca_dl_number",
        tier="pii", voice_safe=False,
        agent_ids=("id_card_update",),
        ask_phrasing="(emailed) Your CA driver's license number",
        plain_label="CA driver's license number (for the DL-13A letter)",
        example="N0123456",
    ),
    BuyerField(
        name="bank_name",
        tier="optional", voice_safe=True,
        agent_ids=("bank_notify",),
        ask_phrasing="Which bank — Chase, BofA, somewhere else?",
        plain_label="Your bank's name (for the call script)",
        example="Chase",
    ),
    BuyerField(
        name="bank_phone",
        tier="pii", voice_safe=False,
        agent_ids=("bank_notify",),
        ask_phrasing="(emailed) Your bank's customer-service number",
        plain_label="Bank customer-service number (on the back of your card)",
        example="+18009359935",
    ),
    # Airports — derived from origin/destination in most cases; collect on call
    # only if the customer mentions a non-default airport.
    BuyerField(
        name="origin_airport",
        tier="optional", voice_safe=True,
        agent_ids=("flight_book",),
        ask_phrasing="Flying out of SFO, or somewhere else?",
        plain_label="Origin airport (IATA, e.g. SFO)",
        example="SFO",
    ),
    BuyerField(
        name="destination_airport",
        tier="optional", voice_safe=True,
        agent_ids=("flight_book",),
        ask_phrasing="Flying into AUS, or somewhere else?",
        plain_label="Destination airport (IATA, e.g. AUS)",
        example="AUS",
    ),
]


# ────────────────────────────────────────────────────────────────────
# Helpers — what the orchestrator and prompt-builder both call
# ────────────────────────────────────────────────────────────────────


def by_name(name: str) -> BuyerField | None:
    for f in BUYER_FIELDS:
        if f.name == name:
            return f
    return None


def fields_by_tier(tier: FieldTier) -> list[BuyerField]:
    return [f for f in BUYER_FIELDS if f.tier == tier]


def is_dispatch_ready(collected: dict) -> bool:
    """We dispatch as soon as all 4 CORE fields are in (validated)."""
    for f in fields_by_tier("core"):
        v = collected.get(f.name)
        if v is None or v == "" or v is False:
            return False
        if isinstance(v, str) and not f.validate(v):
            return False
    return True


def voice_pending(collected: dict) -> list[BuyerField]:
    """Voice-safe fields the buyer should still ask about, in priority order."""
    out: list[BuyerField] = []
    for f in BUYER_FIELDS:
        if not f.voice_safe:
            continue
        if f.name in collected:
            continue
        # Skip optional pet/child fields when the conditional is False.
        if f.name in ("pet_name", "pet_species", "vet_email") and not collected.get("has_pets"):
            continue
        if f.name in ("child_name", "child_grade", "child_previous_school") and not collected.get("has_children"):
            continue
        out.append(f)
    return out


def pending_pii_fields(collected: dict) -> list[BuyerField]:
    """PII fields that still need a follow-up email."""
    pii = fields_by_tier("pii")
    return [f for f in pii if f.name not in collected]


def affected_agents_for_field(field_name: str) -> tuple[str, ...]:
    f = by_name(field_name)
    return f.agent_ids if f else ()


def fields_blocking(agent_id: str, collected: dict) -> list[str]:
    """Which fields are still missing that this agent needs?"""
    missing: list[str] = []
    for f in BUYER_FIELDS:
        if agent_id in f.agent_ids and f.name not in collected:
            missing.append(f.name)
    return missing


# ────────────────────────────────────────────────────────────────────
# Prompt-generation: build the schema doc embedded in the buyer prompt
# ────────────────────────────────────────────────────────────────────


def schema_block_for_prompt() -> str:
    """Generate the FIELD COLLECTION ORDER section the buyer system prompt embeds.

    Keeping the schema in code (not hand-written in the prompt) prevents drift
    between what the buyer thinks it collects and what the orchestrator dispatches on.
    """
    lines = ["FIELD COLLECTION ORDER — collect in this priority:\n"]

    lines.append("  CORE (always collect first — dispatch as soon as you have all four):")
    for f in fields_by_tier("core"):
        lines.append(f"    • {f.name:24s} — ask: \"{f.ask_phrasing}\"")
    lines.append("")
    lines.append("  CONDITIONAL (1 quick question each — these gate which agents fire):")
    for f in fields_by_tier("conditional"):
        lines.append(f"    • {f.name:24s} — ask: \"{f.ask_phrasing}\"")
    lines.append("")
    lines.append("  OPTIONAL on-call (collect if user stays on the line — skip rest if call ends):")
    for f in fields_by_tier("optional"):
        lines.append(f"    • {f.name:24s} — ask: \"{f.ask_phrasing}\"")
    lines.append("")
    lines.append("  PII-GATED (NEVER ask over voice — sent in a secure follow-up email instead):")
    for f in fields_by_tier("pii"):
        lines.append(f"    • {f.name:24s} — {f.ask_phrasing}")
    return "\n".join(lines)


def dispatch_json_example() -> str:
    """A canonical JSON dispatch block the buyer should emit when CORE is in.

    The buyer is taught to emit exactly this shape; TTS skips JSON blocks so
    the caller never hears it.
    """
    example = {
        f.name: (True if f.example == "true" else
                 False if f.example == "false" else
                 int(f.example) if f.example.isdigit() else
                 f.example)
        for f in BUYER_FIELDS
        if f.voice_safe and f.example != "(never logged)" and f.example != "(secure entry only)"
    }
    import json as _json
    return _json.dumps(example, indent=2)


# ────────────────────────────────────────────────────────────────────
# Question planning — the concierge asks for what is missing, batched
# ────────────────────────────────────────────────────────────────────
# A 2B model cannot reliably track which of eight fields it already holds,
# and re-asking for an answer the caller just gave is the single most
# irritating thing a voice agent does. So the *question* is authored here,
# deterministically, from what is actually collected — the model supplies
# only the acknowledgement. Fields are grouped the way people answer them
# ("from A to B on the 3rd" is one breath, not three), which is what makes
# a full brief collectable in two turns instead of five.

# Each group is (fields, phrase-if-all-missing, per-field noun). The noun
# list is what makes the question shrink as answers arrive: when the caller
# has already said "one dog, no kids, a car", the household ask narrows to
# the visa alone instead of reciting all four back at them.
_QUESTION_GROUPS: tuple[tuple[tuple[str, ...], str, dict[str, str]], ...] = (
    (("origin_address", "destination_address"),
     "where you're moving from and where to",
     {"origin_address": "where you're moving from",
      "destination_address": "where you're moving to"}),
    (("move_date",), "roughly when", {"move_date": "roughly when"}),
    (("user_email",), "the best email for you",
     {"user_email": "the best email for you"}),
    # Pets/kids/car/visa ride together: people rattle all four off in one
    # breath, and splitting the visa out cost a whole extra turn for a field
    # that carries a 10-day USCIS deadline.
    (("has_pets", "has_children", "has_car", "has_visa"),
     "whether you have pets, kids, a car, or a US visa",
     {"has_pets": "pets", "has_children": "kids", "has_car": "a car",
      "has_visa": "a US visa"}),
)


def _join(parts: list[str]) -> str:
    if len(parts) == 1:
        return parts[0]
    return ", ".join(parts[:-1]) + " or " + parts[-1]


def _group_phrase(fields: tuple[str, ...], whole: str, nouns: dict[str, str],
                  missing: set[str]) -> str:
    absent = [f for f in fields if f in missing]
    if len(absent) == len(fields):
        return whole
    parts = [nouns[f] for f in absent]
    # The household group's nouns are bare ("pets", "a car"), so they need
    # the carrier verb the whole-group phrase supplies.
    if fields[0].startswith("has_"):
        return "whether you have " + _join(parts)
    return _join(parts)


def blocking_fields(collected: dict) -> list[str]:
    """CORE + CONDITIONAL field names still missing — what gates dispatch."""
    missing: list[str] = []
    for f in BUYER_FIELDS:
        if f.tier not in ("core", "conditional"):
            continue
        v = collected.get(f.name)
        if f.name not in collected or v is None or v == "":
            missing.append(f.name)
            continue
        # A False conditional is a real answer; an unvalidated string is not.
        if isinstance(v, str) and not f.validate(v):
            missing.append(f.name)
    return missing


def next_question(collected: dict) -> str | None:
    """One spoken question covering the next two groups of missing fields.

    None when nothing is missing — the caller has told us everything and the
    only correct thing to say is that we're starting.
    """
    missing = set(blocking_fields(collected))
    if not missing:
        return None
    phrases = [
        _group_phrase(fields, whole, nouns, missing)
        for fields, whole, nouns in _QUESTION_GROUPS
        if any(f in missing for f in fields)
    ]
    # Two groups per breath: enough to be efficient, few enough to answer.
    phrases = phrases[:2]
    if len(phrases) == 1:
        return f"What's {phrases[0]}?" if phrases[0].startswith("the ") \
            else f"Can you tell me {phrases[0]}?"
    return f"Can you tell me {phrases[0]}, and {phrases[1]}?"
