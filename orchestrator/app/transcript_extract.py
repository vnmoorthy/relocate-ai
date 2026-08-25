"""Deterministic backstop extraction from the caller's own words.

The local model emits per-turn partial JSON, but a 2B model drops fields
stochastically — one run misses the addresses, the next misses the date.
This backstop regex-parses the raw caller transcript for the high-structure
CORE fields (street addresses, dates, emails) and fills ONLY what the model
did not collect. Values come verbatim from the caller's utterance, so the
honesty contract holds: nothing here is inferred or invented, and the model's
own extraction (which handles corrections) always wins over the backstop.
"""
from __future__ import annotations

import re
from typing import Any

_MONTHS = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11,
    "december": 12, "jan": 1, "feb": 2, "mar": 3, "apr": 4, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "sept": 9, "oct": 10, "nov": 11, "dec": 12,
}

_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_ISO_DATE_RE = re.compile(r"\b(20\d{2})-(\d{1,2})-(\d{1,2})\b")
_US_DATE_RE = re.compile(r"\b(\d{1,2})/(\d{1,2})/(20\d{2})\b")
_SPOKEN_DATE_RE = re.compile(
    r"\b(" + "|".join(_MONTHS) + r")\.?\s+(\d{1,2})(?:st|nd|rd|th)?"
    r"(?:\s*,?\s*(20\d{2}))?\b",
    re.IGNORECASE,
)
# "123 Main Street, San Francisco, CA 94103" — number + street words +
# optional suffix, then a comma-separated city and a 2-letter state, ZIP
# optional. Deliberately strict: a partial hit is worse than no hit.
_STREET_SUFFIX = (
    r"(?:Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Drive|Dr|Lane|Ln|Way|"
    r"Court|Ct|Place|Pl|Terrace|Ter|Circle|Cir|Parkway|Pkwy|Highway|Hwy)"
)
_ADDRESS_RE = re.compile(
    r"\b(\d{1,6}(?:\s+[A-Za-z0-9'.]+){1,5}\s+" + _STREET_SUFFIX + r"\.?"
    r"(?:\s*,\s*[A-Za-z .'-]{2,40})"
    r"(?:\s*,\s*[A-Z]{2})"
    r"(?:\s+\d{5}(?:-\d{4})?)?)",
    re.IGNORECASE,
)


def extract_email(text: str) -> str | None:
    m = _EMAIL_RE.search(text)
    return m.group(0).lower() if m else None


def extract_date(text: str) -> str | None:
    """Caller-spoken date → YYYY-MM-DD, or None. Never guesses a year."""
    m = _ISO_DATE_RE.search(text)
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    m = _US_DATE_RE.search(text)
    if m:
        return f"{m.group(3)}-{int(m.group(1)):02d}-{int(m.group(2)):02d}"
    m = _SPOKEN_DATE_RE.search(text)
    if m and m.group(3):
        month = _MONTHS[m.group(1).lower()]
        day = int(m.group(2))
        if 1 <= day <= 31:
            return f"{m.group(3)}-{month:02d}-{day:02d}"
    return None


def extract_addresses(text: str) -> list[str]:
    """Full street addresses in utterance order, cleaned of trailing junk."""
    return [re.sub(r"\s+", " ", m).strip(" ,.") for m in _ADDRESS_RE.findall(text)]


def backstop_fields(transcript: str, collected: dict[str, Any]) -> dict[str, str]:
    """CORE fields recoverable verbatim from this utterance and still missing.

    Fills gaps only — an already-collected value is never touched, so model
    extraction (which understands corrections) always has the last word.
    Address order: "from A to B" is the overwhelming spoken convention, so
    the first unclaimed address fills origin, the second destination — unless
    the utterance clearly marks the single address as the new place.
    """
    out: dict[str, str] = {}
    if not collected.get("user_email"):
        email = extract_email(transcript)
        if email:
            out["user_email"] = email
    if not collected.get("move_date"):
        date = extract_date(transcript)
        if date:
            out["move_date"] = date
    need_origin = not collected.get("origin_address")
    need_dest = not collected.get("destination_address")
    if need_origin or need_dest:
        addresses = extract_addresses(transcript)
        if len(addresses) >= 2:
            if need_origin:
                out["origin_address"] = addresses[0]
            if need_dest:
                out["destination_address"] = addresses[1]
        elif len(addresses) == 1:
            lower = transcript.lower()
            addr_pos = lower.find(addresses[0].lower()[:12])
            marker = lower[max(0, addr_pos - 40):addr_pos if addr_pos > 0 else 0]
            is_destination = any(
                k in marker for k in ("to ", "new place", "new address", "moving into", "destination")
            )
            if is_destination and need_dest:
                out["destination_address"] = addresses[0]
            elif not is_destination and need_origin:
                out["origin_address"] = addresses[0]
    return out
