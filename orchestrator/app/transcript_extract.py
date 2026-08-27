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
# A date only becomes the move date when the caller ties it to moving, and
# never when it is anchored to some other event in the same breath. Without
# both tests, "my daughter's birthday is 6/12/2026, so we'd like to move after
# that" shipped 6/12 to real movers.
_MOVE_CONTEXT_RE = re.compile(
    r"\b(mov(?:e|es|ed|ing)|relocat\w*|move[-\s]?in|move[-\s]?out|"
    r"closing|handover|hand[-\s]?over)\b",
    re.IGNORECASE,
)
# No trailing \b on the group: "starts"/"expires" must still match.
_DATE_DISQUALIFIER_RE = re.compile(
    r"\b(?:birthdays?|anniversar\w*|born|wedding|vacations?|holidays?|flights?"
    r"|lease\b[^.]{0,25}\b(?:start|end|expir|renew|up)\w*"
    r"|escrow\b[^.]{0,20}\bclos\w*|clos\w*\b[^.]{0,20}\bescrow)",
    re.IGNORECASE,
)
# How far from the date we look for those cues (characters, both directions).
_DATE_CONTEXT_WINDOW = 60

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
# The state is optional on purpose: people say "950 Howard Street, San
# Francisco" out loud far more often than they recite the state, and
# requiring it silently dropped the origin of most spoken moves. The city
# segment must be capitalised, which keeps "123 Main Street, please" from
# reading as an address.
_ADDRESS_RE = re.compile(
    r"\b(\d{1,6}(?:\s+[A-Za-z0-9'.]+){1,5}\s+" + _STREET_SUFFIX + r"\.?"
    # City as 1-3 capitalised words: greedy enough for "San Francisco",
    # and it cannot run on through the lowercase "to" that follows it in
    # "…, San Francisco to 4700 Duval Street".
    r"(?:\s*,\s*[A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+){0,2})"
    r"(?:\s*,\s*[A-Z]{2})?"
    r"(?:\s+\d{5}(?:-\d{4})?)?)(?=[\s,.;!?]|$)",
)


# Nobody says "@" out loud. Speech recognition renders a dictated address as
# "moorthy at example dot com", which the plain email regex cannot see — and
# user_email is a CORE field, so losing it stalls dispatch on a call where the
# caller plainly gave their address. The domain must carry at least one dot
# (spoken or literal), which is what keeps ordinary prepositions out: "meet me
# at the store" and "I'm at 950 Howard Street" have no dotted domain.
_SPOKEN_EMAIL_RE = re.compile(
    r"\b(?P<local>[A-Za-z0-9_+-]+(?:\s+(?:dot|period)\s+[A-Za-z0-9_+-]+)*)"
    r"\s+at\s+"
    r"(?P<domain>[A-Za-z0-9-]+(?:(?:\s+(?:dot|period)\s+|\.)[A-Za-z0-9-]+)+)",
    re.IGNORECASE,
)
_SPOKEN_DOT_RE = re.compile(r"\s+(?:dot|period)\s+", re.IGNORECASE)


def _spoken_email(text: str) -> str | None:
    """A dictated address like "jane dot smith at gmail dot com" -> an address."""
    m = _SPOKEN_EMAIL_RE.search(text)
    if not m:
        return None
    local = _SPOKEN_DOT_RE.sub(".", m.group("local")).strip()
    domain = _SPOKEN_DOT_RE.sub(".", m.group("domain")).strip()
    candidate = f"{local}@{domain}".lower()
    # Round-trip through the strict regex so nothing malformed escapes.
    return candidate if _EMAIL_RE.fullmatch(candidate) else None


def extract_email(text: str) -> str | None:
    """The caller's email, written or dictated. Written form always wins."""
    m = _EMAIL_RE.search(text)
    if m:
        return m.group(0).lower()
    return _spoken_email(text)


def _iter_dates(text: str):
    """(span, iso_date) for every fully-specified date. Never guesses a year."""
    for m in _ISO_DATE_RE.finditer(text):
        yield m.span(), f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    for m in _US_DATE_RE.finditer(text):
        yield m.span(), f"{m.group(3)}-{int(m.group(1)):02d}-{int(m.group(2)):02d}"
    for m in _SPOKEN_DATE_RE.finditer(text):
        if not m.group(3):
            continue  # no year — never inferred
        day = int(m.group(2))
        if 1 <= day <= 31:
            yield m.span(), f"{m.group(3)}-{_MONTHS[m.group(1).lower()]:02d}-{day:02d}"


def extract_date(text: str) -> str | None:
    """The caller's MOVE date → YYYY-MM-DD, or None.

    A date is accepted only when moving language sits beside it and no
    competing event (a birthday, a lease term, a flight) does. Ambiguity
    resolves to None: the concierge asking again is free, while a wrong date
    ships to real movers and utilities.
    """
    candidates = list(_iter_dates(text))
    # One date in an utterance that is plainly about moving is unambiguous
    # wherever the word "moving" sits — people say the whole brief in one
    # breath ("moving from A to B on the 20th"), and a fixed character window
    # around the date misses it. With several dates, the tight window decides
    # which one is the move, so the caller is asked rather than guessed at.
    single = len({iso for _span, iso in candidates}) == 1
    accepted: set[str] = set()
    for (start, end), iso in candidates:
        window = (
            text if single
            else text[max(0, start - _DATE_CONTEXT_WINDOW):end + _DATE_CONTEXT_WINDOW]
        )
        if not _MOVE_CONTEXT_RE.search(window):
            continue
        if _DATE_DISQUALIFIER_RE.search(window):
            continue
        accepted.add(iso)
    # Exactly one unambiguous candidate, or nothing.
    return accepted.pop() if len(accepted) == 1 else None


# The cue must sit IMMEDIATELY before the address (the `$` anchor), so
# ordinary filler cannot vote: "I have to move from <addr>" reads `from`,
# not the `to` in "have to". Longest-match alternation puts multiword cues
# ahead of the bare prepositions they contain.
_ORIGIN_CUE_RE = re.compile(
    r"\b(?:from|out of|leaving|currently (?:at|in)|i'?m at|we'?re at|"
    r"live at|living at|old (?:place|address|home)(?: is)?)\s*[:,]?\s*$",
    re.IGNORECASE,
)
_DEST_CUE_RE = re.compile(
    r"\b(?:to|into|new (?:place|address|home|house|apartment)(?: is| at)?|"
    r"moving to|headed to)\s*[:,]?\s*$",
    re.IGNORECASE,
)


def extract_addresses(text: str) -> list[tuple[int, str]]:
    """(start_offset, address) for each full street address, in order."""
    return [
        (m.start(1), re.sub(r"\s+", " ", m.group(1)).strip(" ,."))
        for m in _ADDRESS_RE.finditer(text)
    ]


def _direction_of(text: str, start: int) -> str | None:
    """"origin" | "destination" | None, from the cue adjacent to the address."""
    before = text[:start]
    if _ORIGIN_CUE_RE.search(before):
        return "origin"
    if _DEST_CUE_RE.search(before):
        return "destination"
    return None


# Household facts, from how people actually answer. A 2B model drops these
# constantly, and each miss costs another round-trip on the call — so they are
# read deterministically from the caller's own words instead.
_HOUSEHOLD_CUES: dict[str, str] = {
    "has_pets": r"pets?|dogs?|cats?|puppy|puppies|kitten|kitty",
    "has_children": r"kids?|child|children|son|daughter|toddler|baby|babies",
    "has_car": r"cars?|vehicles?|truck|suv|van\b|motorbike|motorcycle",
    "has_visa": r"visas?|green\s?card|h-?1-?b|work permit|sponsorship",
}
# Negation immediately before the noun: "no kids", "don't have a car",
# "without pets". Anchored to the end so it only reads the adjacent phrase.
_NEGATION_RE = re.compile(
    r"\b(?:no|not|none|without|don'?t have|do not have|dont have|"
    r"haven'?t got|nope,?)\s+(?:any\s+|a\s+|an\s+)?$",
    re.IGNORECASE,
)


def extract_household(text: str) -> dict[str, bool]:
    """Household flags the caller stated outright.

    Only what was actually said: a flag appears when the noun appears, and is
    False when a negation sits immediately before it. Silence stays silent —
    an absent flag means "not mentioned", never "no".
    """
    found: dict[str, bool] = {}
    for field, pattern in _HOUSEHOLD_CUES.items():
        for m in re.finditer(rf"\b(?:{pattern})\b", text, re.IGNORECASE):
            before = text[max(0, m.start() - 28):m.start()]
            positive = not _NEGATION_RE.search(before)
            # A positive mention wins over an earlier negative one: "no kids,
            # well actually one kid" ends up True.
            if field not in found or positive:
                found[field] = positive
    return found


def backstop_fields(transcript: str, collected: dict[str, Any]) -> dict[str, Any]:
    """CORE fields recoverable verbatim from this utterance and still missing.

    Fills gaps only — an already-collected value is never touched, so model
    extraction (which understands corrections) always has the last word.
    Address order: "from A to B" is the overwhelming spoken convention, so
    the first unclaimed address fills origin, the second destination — unless
    the utterance clearly marks the single address as the new place.
    """
    out: dict[str, Any] = {}
    # Household flags the caller stated outright. Each one recovered here is a
    # question the concierge does not have to ask again.
    for field, value in extract_household(transcript).items():
        if field not in collected:
            out[field] = value
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
        found = extract_addresses(transcript)
        labelled = [(_direction_of(transcript, start), addr) for start, addr in found]
        explicit = {
            direction: addr for direction, addr in labelled if direction is not None
        }
        if explicit:
            # An adjacent cue is authoritative in either direction.
            if need_origin and "origin" in explicit:
                out["origin_address"] = explicit["origin"]
            if need_dest and "destination" in explicit:
                out["destination_address"] = explicit["destination"]
            # "A to B" cues only B — the caller does not say "from" out loud
            # nearly as often as they say "to". With exactly two addresses in
            # one breath, the uncued one is the other end by elimination.
            if len(found) == 2:
                claimed = set(explicit.values())
                remaining = [addr for _start, addr in found if addr not in claimed]
                if len(remaining) == 1:
                    if need_origin and "origin_address" not in out and "destination" in explicit:
                        out["origin_address"] = remaining[0]
                    elif need_dest and "destination_address" not in out and "origin" in explicit:
                        out["destination_address"] = remaining[0]
        elif len(found) >= 2:
            # No cues, but two addresses in one breath: "A ... B" is the
            # overwhelming spoken order (from, then to).
            if need_origin:
                out["origin_address"] = found[0][1]
            if need_dest:
                out["destination_address"] = found[1][1]
        # A lone address with NO directional cue is deliberately dropped:
        # guessing its slot risks dispatching a move INTO the home the
        # caller is leaving, and the concierge can simply ask.
    return out
