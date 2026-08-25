"""Prepared next-step artifacts for user-blocked specialists.

When a specialist cannot act without the user (missing credentials, a
signature ceremony, a policy-gated provider), the honest terminal state is
needs-user-action — but "you do it" is not a product. Each blocked agent now
prepares the exact artifact the user needs: a call script filled with their
move details, a cancellation letter ready to sign, a step-by-step filing
walkthrough. One digest email delivers them all.

Rules:
- Deterministic templates only. No LLM, no invented facts: values come from
  the move spec verbatim; anything unknown is an explicit <placeholder>.
- Titles are static per agent and safe for the public move page. Bodies may
  contain the user's own addresses/dates and travel only by email (and the
  authenticated dashboard) — never through a public surface.
- Institution phone numbers below are public main lines; every script tells
  the user to verify the number before calling.
"""
from __future__ import annotations

from typing import Any, Callable


def _g(spec: dict[str, Any], key: str, placeholder: str) -> str:
    value = spec.get(key)
    if value in (None, "", False):
        return f"<{placeholder}>"
    return str(value)


def _sig_block(spec: dict[str, Any]) -> str:
    return (
        f"Signature: ______________________  Date: ____________\n"
        f"Printed name: {_g(spec, 'user_name', 'your full legal name')}\n"
    )


def _route(spec: dict[str, Any]) -> tuple[str, str, str]:
    return (
        _g(spec, "origin_address", "your current address"),
        _g(spec, "destination_address", "your new address"),
        _g(spec, "move_date", "your move date"),
    )


def _pge(spec: dict[str, Any]) -> dict[str, str]:
    origin, _dest, date = _route(spec)
    return {
        "title": "PG&E shutoff call script",
        "body": (
            f"Call PG&E residential: 1-877-660-6789 (verify current number at pge.com).\n"
            f"Best window: weekdays 8-10am Pacific.\n\n"
            f"Say: \"I'm moving out and need to stop service at {origin} "
            f"effective {date}.\"\n\n"
            f"Have ready:\n"
            f"1. Account number: {_g(spec, 'pge_account_number', 'on any PG&E bill, top right')}\n"
            f"2. Last 4 of SSN for identity check\n"
            f"3. Forwarding address for the final bill: "
            f"{_g(spec, 'destination_address', 'your new address')}\n\n"
            f"Ask for: a stop-service confirmation number. Write it down — "
            f"that number is your proof.\n"
        ),
    }


def _water(spec: dict[str, Any]) -> dict[str, str]:
    origin, _dest, date = _route(spec)
    return {
        "title": "SFPUC water stop-service script",
        "body": (
            f"Call SFPUC customer service: 415-551-3000 (verify at sfpuc.gov), "
            f"or use My Account at myaccount-water.sfpuc.org.\n\n"
            f"Say: \"Please stop water service at {origin} effective {date}.\"\n\n"
            f"Have ready:\n"
            f"1. Account number or the service address exactly as billed\n"
            f"2. Forwarding address for the closing bill\n\n"
            f"Ask for: the final-read date and a confirmation number.\n"
        ),
    }


def _comcast(spec: dict[str, Any]) -> dict[str, str]:
    origin, _dest, date = _route(spec)
    name = _g(spec, "user_name", "your full name")
    return {
        "title": "Comcast cancellation letter (ready to sign)",
        "body": (
            f"Fastest path: call 1-800-934-6489 and say \"cancel service\" — "
            f"retention will push; the script below also works verbatim on the phone.\n\n"
            f"--- letter / script ---\n"
            f"To: Comcast/Xfinity Customer Service\n"
            f"I am cancelling all Xfinity services at {origin} effective {date}. "
            f"Account holder: {name}. Account number: "
            f"{_g(spec, 'comcast_account_number', 'on your Xfinity bill or app')}.\n"
            f"Please confirm the cancellation date, any equipment I must return, "
            f"and the address of the nearest return location in writing.\n\n"
            f"{_sig_block(spec)}"
            f"--- end ---\n\n"
            f"Equipment note: return the modem/router within the return "
            f"window Comcast states when you cancel (commonly 14 days) — "
            f"confirm the exact deadline on the call, since an unreturned-"
            f"equipment fee follows it.\n"
        ),
    }


def _spectrum(spec: dict[str, Any]) -> dict[str, str]:
    _origin, dest, date = _route(spec)
    return {
        "title": "Spectrum setup checklist",
        "body": (
            f"New-service line: 1-855-860-9068 (verify at spectrum.com).\n\n"
            f"1. Confirm serviceability for {dest} at spectrum.com/address\n"
            f"2. Schedule installation ON or AFTER {date} — self-install kit "
            f"ships free if the address is pre-wired\n"
            f"3. Ask for the current new-customer promo price IN WRITING and "
            f"the price after the promo ends\n"
            f"4. Decline the modem rental if you own a compatible modem "
            f"(check spectrum.net/modems)\n"
        ),
    }


def _geico(spec: dict[str, Any]) -> dict[str, str]:
    _origin, dest, date = _route(spec)
    return {
        "title": "Geico address-change script",
        "body": (
            f"Call 1-800-841-3000 or use geico.com > policy > address change.\n\n"
            f"Say: \"I'm moving to {dest} on {date} and need my auto policy "
            f"re-rated for the new garaging address.\"\n\n"
            f"Know before you call:\n"
            f"1. Texas requires new proof-of-insurance for registration — ask "
            f"for updated ID cards immediately\n"
            f"2. Your premium WILL change with the ZIP — ask for the new "
            f"figure before confirming\n"
            f"3. If you're keeping a CA vehicle registered briefly, ask how "
            f"dual-state garaging affects coverage\n"
        ),
    }


def _usps(spec: dict[str, Any]) -> dict[str, str]:
    origin, dest, date = _route(spec)
    return {
        "title": "USPS change-of-address walkthrough",
        "body": (
            f"Go to movers.usps.com (the ONLY official site — anything else "
            f"charging more than $1.10 is a middleman).\n\n"
            f"1. Choose 'permanent' forwarding\n"
            f"2. Old address: {origin}\n"
            f"3. New address: {dest}\n"
            f"4. Start date: {date}\n"
            f"5. Identity verification is $1.10 on a card matching one of the "
            f"two addresses\n\n"
            f"You'll get an email confirmation code — keep it; you need it to "
            f"edit the order later. First-class mail forwards for 12 months.\n"
        ),
    }


def _gym(spec: dict[str, Any]) -> dict[str, str]:
    _origin, dest, date = _route(spec)
    return {
        "title": "Gym cancellation letter (ready to sign)",
        "body": (
            f"Most clubs (including Equinox) accept relocation cancellations "
            f"with proof of a move beyond a radius — your new lease or a "
            f"utility bill works.\n\n"
            f"--- letter ---\n"
            f"To: Membership Services\n"
            f"I am relocating to {dest} on {date} and request cancellation of "
            f"my membership (member ID: "
            f"{_g(spec, 'equinox_member_id', 'on your membership app or key tag')}) "
            f"under the relocation provision of my agreement. Proof of "
            f"relocation is enclosed. Please confirm the final billing date in "
            f"writing.\n\n"
            f"{_sig_block(spec)}"
            f"--- end ---\n\n"
            f"Send from the email on your membership account; ask for written "
            f"confirmation of the last charge.\n"
        ),
    }


def _pharmacy(spec: dict[str, Any]) -> dict[str, str]:
    _origin, dest, _date = _route(spec)
    return {
        "title": "Prescription transfer request (needs your signature)",
        "body": (
            f"Prescription transfers are pharmacy-to-pharmacy: pick your new "
            f"pharmacy near {dest} first, then THEY pull the scripts.\n\n"
            f"1. Choose a pharmacy near the new address and create a profile\n"
            f"2. Give them: {_g(spec, 'source_pharmacy_name', 'your current pharmacy name')}, "
            f"phone {_g(spec, 'source_pharmacy_phone', 'current pharmacy phone')}, "
            f"and your Rx numbers "
            f"({_g(spec, 'rx_numbers', 'on each bottle label')})\n"
            f"3. Controlled substances may transfer only once or not at all — "
            f"ask your prescriber for a new script sent directly\n"
            f"4. Refill anything due within 2 weeks BEFORE the move\n"
        ),
    }


def _pcp(spec: dict[str, Any]) -> dict[str, str]:
    return {
        "title": "Medical records request (HIPAA form ready)",
        "body": (
            f"Your current clinic must release records with a signed HIPAA "
            f"authorization. Most have their own form; this text works for a "
            f"written request:\n\n"
            f"--- request ---\n"
            f"I, {_g(spec, 'user_name', 'your full legal name')} "
            f"(DOB {_g(spec, 'user_dob', 'date of birth')}), authorize the "
            f"release of my complete medical record to my new provider or to "
            f"me directly, in electronic form where available.\n\n"
            f"{_sig_block(spec)}"
            f"--- end ---\n\n"
            f"Under HIPAA they must respond within 30 days; electronic copies "
            f"of electronic records must be provided at reasonable cost. Ask "
            f"for the immunization list separately — schools need it fast.\n"
        ),
    }


def _dmv(spec: dict[str, Any]) -> dict[str, str]:
    _origin, dest, date = _route(spec)
    return {
        "title": "DMV change-of-address checklist",
        "body": (
            f"Two separate obligations when moving CA -> TX:\n\n"
            f"1. CALIFORNIA (within 10 days of moving): file a DMV change of "
            f"address at dmv.ca.gov/coa — free, online, keeps your CA record "
            f"clean\n"
            f"2. TEXAS (within 90 days of {date}): new residents surrender the "
            f"CA license and take the TX license at any DPS office — book at "
            f"public.txdpsscheduler.com. Bring: proof of identity, 2 proofs of "
            f"TX residency at {dest} (lease + utility bill), and proof of TX "
            f"vehicle insurance\n"
            f"3. Vehicle: TX requires inspection + registration within 30 days "
            f"of establishing residency\n"
        ),
    }


def _uscis(spec: dict[str, Any]) -> dict[str, str]:
    origin, dest, date = _route(spec)
    return {
        "title": "USCIS AR-11 filing walkthrough",
        "body": (
            f"Non-citizens must file Form AR-11 within 10 days of moving — "
            f"it's free and takes 5 minutes online.\n\n"
            f"1. Go to uscis.gov/ar-11 and use the ONLINE filing (instant "
            f"confirmation, unlike paper)\n"
            f"2. Old address: {origin}\n"
            f"3. New address: {dest}, effective {date}\n"
            f"4. A-Number: {_g(spec, 'a_number', 'on your green card / EAD, starts with A-')}\n"
            f"5. If you have a pending case, ALSO update the address on the "
            f"case itself (the AR-11 alone does not move pending-case mail)\n\n"
            f"Save the confirmation number — it is your proof of compliance.\n"
        ),
    }


def _flight(spec: dict[str, Any]) -> dict[str, str]:
    _origin, _dest, date = _route(spec)
    return {
        "title": "Flight watch checklist",
        "body": (
            f"One-way SFO/OAK -> AUS around {date}:\n\n"
            f"1. Set alerts now on Google Flights for SFO-AUS and OAK-AUS "
            f"(one-way, your party size)\n"
            f"2. Nonstops: Alaska, Southwest, United (SFO); Southwest (OAK) — "
            f"verify current schedules\n"
            f"3. Book 3-6 weeks out for the best one-way fares; moving-day "
            f"flexibility of +/-1 day typically saves the most\n"
            f"4. If flying with a pet in cabin, book by PHONE — pet spots per "
            f"flight are capped and sell out\n"
        ),
    }


def _mover(spec: dict[str, Any]) -> dict[str, str]:
    origin, dest, date = _route(spec)
    return {
        "title": "Mover quote comparison guide",
        "body": (
            f"For {origin} -> {dest} on {date}, compare quotes on:\n\n"
            f"1. OUT-THE-DOOR total (fuel, stairs, shuttle fees included?)\n"
            f"2. Binding vs non-binding estimate — binding protects you\n"
            f"3. Valuation coverage: 60c/lb is the free default and near-"
            f"worthless; price full-value protection\n"
            f"4. Deposit size (over 20% is a flag) and cancellation terms\n"
            f"5. FMCSA number — verify it at safer.fmcsa.dot.gov\n"
        ),
    }


def _school(spec: dict[str, Any]) -> dict[str, str]:
    _origin, dest, _date = _route(spec)
    return {
        "title": "School enrollment checklist",
        "body": (
            f"Enrolling {_g(spec, 'child_name', 'your child')} "
            f"({_g(spec, 'child_grade', 'grade')}) near {dest}:\n\n"
            f"1. Confirm the zoned campus for the exact address on the "
            f"district's school finder\n"
            f"2. Gather: birth certificate, immunization record, proof of "
            f"residency (lease/utility), prior transcript or report card\n"
            f"3. Texas requires a vaccine record on file within 30 days — "
            f"request it from your current pediatrician NOW (slowest item)\n"
            f"4. Register online first if the district supports it; the campus "
            f"visit then only verifies documents\n"
        ),
    }


def _vet(spec: dict[str, Any]) -> dict[str, str]:
    _origin, dest, _date = _route(spec)
    return {
        "title": "Vet records transfer request",
        "body": (
            f"Moving {_g(spec, 'pet_name', 'your pet')} "
            f"({_g(spec, 'pet_species', 'pet')}) to {dest}:\n\n"
            f"1. Email {_g(spec, 'vet_email', 'your current vet')} requesting "
            f"complete records + vaccine certificates as PDF\n"
            f"2. Rabies certificate must travel WITH the pet — keep a copy on "
            f"your phone\n"
            f"3. If flying: airlines require a health certificate issued "
            f"within 10 days of travel — book that vet visit accordingly\n"
            f"4. Refill any pet medication before the move\n"
        ),
    }


def _bank(spec: dict[str, Any]) -> dict[str, str]:
    _origin, dest, date = _route(spec)
    return {
        "title": "Bank address-update call script",
        "body": (
            f"Update every institution BEFORE {date} — a mismatched billing "
            f"address is the #1 cause of declined cards mid-move.\n\n"
            f"Say: \"Please update my mailing and billing address to {dest} "
            f"effective {date}.\"\n\n"
            f"Checklist: primary bank, credit cards, brokerage, payroll "
            f"(direct-deposit stub address), IRS (Form 8822 if you expect "
            f"mail), and any BNPL accounts.\n"
        ),
    }


_BUILDERS: dict[str, Callable[[dict[str, Any]], dict[str, str]]] = {
    "pge_shutoff": _pge,
    "water_board": _water,
    "comcast_cancel": _comcast,
    "spectrum_austin": _spectrum,
    "geico_address": _geico,
    "usps_coa": _usps,
    "gym_cancel": _gym,
    "pharmacy": _pharmacy,
    "pcp_transfer": _pcp,
    "id_card_update": _dmv,
    "uscis_ar11": _uscis,
    "flight_book": _flight,
    "mover_quote": _mover,
    "school_district": _school,
    "vet_transfer": _vet,
    "bank_notify": _bank,
}


def build_playbook(agent_id: str, spec: dict[str, Any]) -> dict[str, str] | None:
    """Return {"title", "body"} for a blocked specialist, or None if unknown."""
    builder = _BUILDERS.get(agent_id)
    if builder is None:
        return None
    return builder(spec)
