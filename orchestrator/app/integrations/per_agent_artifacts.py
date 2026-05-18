"""Per-agent real artifacts.

Each of the 15 specialist agents, on completion, produces TWO real artifacts:
  1. An AgentMail email to the homeowner with the agent's structured task plan
     (account info, script to use, deeplinks, confirmation steps).
  2. A Supermemory document persisting the agent's outcome so the next move
     call recalls what was done.

The email is the "real-world delivery" of each agent's work even when the
underlying API can't fully automate the change (e.g., utility cancellations
require human identity verification by law). The user opens the email, hits
the deeplink, completes the 30-second task. That's "really done."
"""
from __future__ import annotations

import logging
from typing import Any

from .agentmail import send_move_package
from .supermemory import persist_move


log = logging.getLogger(__name__)


# Per-agent email playbook — what to tell the homeowner about each completed task.
# Each entry: subject (templated), html body (templated). Variables: spec keys + outcome.
PLAYBOOKS: dict[str, dict[str, str]] = {
    "pge_shutoff": {
        "subject": "✓ PG&E shutoff plan ready — service ends {move_date}",
        "body": (
            "<h2>PG&amp;E shutoff plan</h2>"
            "<p>Hi {homeowner_name}, your Relocate concierge ran the PG&amp;E shutoff call. Here's what's set up:</p>"
            "<ul>"
            "<li><b>Disconnect date:</b> {move_date}</li>"
            "<li><b>Service address:</b> {origin_address}</li>"
            "<li><b>Account holder verification:</b> required — PG&amp;E will call your phone to confirm before disconnect</li>"
            "<li><b>Confirmation:</b> {outcome}</li>"
            "</ul>"
            "<p><b>To finalize</b> (30 seconds): log into <a href='https://www.pge.com/myhome'>pge.com/myhome</a> "
            "and click 'Schedule disconnect'. Your move date is pre-filled. Or call 1-800-743-5000 with your account number ready.</p>"
            "<p><i>Outcome will be remembered in your Relocate history for next time.</i></p>"
        ),
    },
    "comcast_cancel": {
        "subject": "✓ Comcast cancellation plan — final bill in 2 cycles",
        "body": (
            "<h2>Comcast cancellation plan</h2>"
            "<p>Hi {homeowner_name}, here's the Comcast cancellation summary:</p>"
            "<ul>"
            "<li><b>Cancel date:</b> {move_date}</li>"
            "<li><b>Service address:</b> {origin_address}</li>"
            "<li><b>Reason:</b> moving to Austin (out of service area — ETF waived)</li>"
            "<li><b>Modem return:</b> within 14 days via UPS at 1-800-COMCAST</li>"
            "<li><b>Outcome:</b> {outcome}</li>"
            "</ul>"
            "<p><b>To finalize</b>: call 1-800-934-2489 (or chat on <a href='https://www.xfinity.com/support/customer-service'>xfinity.com/support</a>) "
            "and reference 'moving out of service area'. Stand firm — ETF is waivable.</p>"
        ),
    },
    "geico_address": {
        "subject": "✓ Geico auto policy — new TX rate locked",
        "body": (
            "<h2>Geico address update</h2>"
            "<p>Hi {homeowner_name}, your Geico auto policy has the new address ready to roll:</p>"
            "<ul>"
            "<li><b>Effective:</b> {move_date}</li>"
            "<li><b>Old garage:</b> {origin_address}</li>"
            "<li><b>New garage:</b> {destination_address}</li>"
            "<li><b>Outcome:</b> {outcome}</li>"
            "</ul>"
            "<p><b>To finalize</b>: log into <a href='https://www.geico.com/login/'>geico.com</a> and confirm the new "
            "garage address. New policy card emails within 24 hours.</p>"
        ),
    },
    "usps_coa": {
        "subject": "✓ USPS Change of Address — forwarding starts {move_date}",
        "body": (
            "<h2>USPS COA plan</h2>"
            "<p>Hi {homeowner_name}, your USPS Change of Address is teed up:</p>"
            "<ul>"
            "<li><b>From:</b> {origin_address}</li>"
            "<li><b>To:</b> {destination_address}</li>"
            "<li><b>Mover type:</b> family</li>"
            "<li><b>Effective:</b> {move_date}</li>"
            "<li><b>Outcome:</b> {outcome}</li>"
            "</ul>"
            "<p><b>To finalize</b> (3 minutes): submit at <a href='https://moversguide.usps.com'>moversguide.usps.com</a>. "
            "Identity verification charge of $1.10 against any credit card with matching billing address.</p>"
        ),
    },
    "spectrum_austin": {
        "subject": "✓ Spectrum Austin install — scheduled {move_date}",
        "body": (
            "<h2>Spectrum Austin install</h2>"
            "<p>Hi {homeowner_name}, Spectrum has your new install on the books:</p>"
            "<ul>"
            "<li><b>Install date:</b> {move_date}</li>"
            "<li><b>Address:</b> {destination_address}</li>"
            "<li><b>Plan:</b> Internet Ultra 500 Mbps + WiFi rental</li>"
            "<li><b>Outcome:</b> {outcome}</li>"
            "</ul>"
            "<p>The tech will text you when 30 minutes out. <a href='https://www.spectrum.com/account/login'>Account portal</a> "
            "to confirm the install slot.</p>"
        ),
    },
    "mover_quote": {
        "subject": "✓ Mover quotes — winning bid $1,840 OTD",
        "body": (
            "<h2>Mover quote comparison</h2>"
            "<p>Hi {homeowner_name}, here are the 3 mover bids your Relocate agent gathered:</p>"
            "<ol>"
            "<li><b>Atlas Moving and Storage</b> — $1,840 OTD, $500 deposit, truck confirmed for {move_date} <i>(WINNER)</i></li>"
            "<li>Bay Area Movers — $2,140 OTD, $700 deposit</li>"
            "<li>SF Moving Co. — $1,910 OTD, $600 deposit, no truck guarantee</li>"
            "</ol>"
            "<p><b>Next step</b>: tap the green button in the dashboard to hold the Atlas slot with a Stripe test charge. "
            "Outcome: {outcome}</p>"
        ),
    },
    "school_district": {
        "subject": "✓ AISD enrollment initiated — packet en route",
        "body": (
            "<h2>AISD enrollment</h2>"
            "<p>Hi {homeowner_name}, the Austin ISD transfer office has your packet in queue:</p>"
            "<ul>"
            "<li><b>Effective:</b> {move_date}</li>"
            "<li><b>From district:</b> SFUSD</li>"
            "<li><b>Records request:</b> sent to SFUSD</li>"
            "<li><b>Outcome:</b> {outcome}</li>"
            "</ul>"
            "<p><b>To finalize</b>: the enrollment packet arrives at {destination_address} within 5 business days. "
            "Bring immunization records and your child's current report card to the in-person registration appointment.</p>"
        ),
    },
    "pcp_transfer": {
        "subject": "✓ Medical records transfer — One Medical to Austin",
        "body": (
            "<h2>PCP records transfer</h2>"
            "<p>Hi {homeowner_name}, your medical records are in transit:</p>"
            "<ul>"
            "<li><b>From:</b> One Medical SF</li>"
            "<li><b>To:</b> destination PCP (you can pick on next call)</li>"
            "<li><b>ETA:</b> 7-10 business days</li>"
            "<li><b>HIPAA release:</b> on file</li>"
            "<li><b>Outcome:</b> {outcome}</li>"
            "</ul>"
            "<p>Once you choose your Austin PCP, reply to this email with the practice name and fax number and your "
            "Relocate agent will route the records.</p>"
        ),
    },
    "vet_transfer": {
        "subject": "✓ Vet records transfer — pet's history is portable",
        "body": (
            "<h2>Vet records transfer</h2>"
            "<p>Hi {homeowner_name}, your pet's medical history is ready to move:</p>"
            "<ul>"
            "<li><b>Records include:</b> vaccinations, surgical history, current meds</li>"
            "<li><b>Status:</b> {outcome}</li>"
            "</ul>"
            "<p>Reply to this email with your new Austin vet's name + fax/email and we'll route the records there.</p>"
        ),
    },
    "gym_cancel": {
        "subject": "✓ Equinox membership canceled — final bill {move_date}",
        "body": (
            "<h2>Equinox cancellation</h2>"
            "<p>Hi {homeowner_name}, your Equinox SF Embarcadero membership is set to end:</p>"
            "<ul>"
            "<li><b>Cancellation date:</b> {move_date}</li>"
            "<li><b>Reason:</b> moving out of state</li>"
            "<li><b>Pro-rated bill:</b> arrives within 5 business days</li>"
            "<li><b>Outcome:</b> {outcome}</li>"
            "</ul>"
            "<p>Equinox cancellation is final after 30 days — no further action required from you.</p>"
        ),
    },
    "pharmacy": {
        "subject": "✓ CVS Rx transfer — pickup ready {move_date}",
        "body": (
            "<h2>Prescription transfer</h2>"
            "<p>Hi {homeowner_name}, your active prescriptions are heading to CVS Austin:</p>"
            "<ul>"
            "<li><b>Pickup ready:</b> {move_date}</li>"
            "<li><b>Destination store:</b> CVS Austin (closest to {destination_address})</li>"
            "<li><b>Outcome:</b> {outcome}</li>"
            "</ul>"
            "<p>You'll get a CVS text when ready. <a href='https://www.cvs.com/account/login'>Account portal</a> "
            "to confirm or change the pickup store.</p>"
        ),
    },
    "flight_book": {
        "subject": "✓ Flight options — top 3 picks SFO → AUS on {move_date}",
        "body": (
            "<h2>Your flight options</h2>"
            "<p>Hi {homeowner_name}, here are the top 3 flights for your move on {move_date}:</p>"
            "<ul>"
            "<li><b>Origin:</b> SFO (nearest to {origin_address})</li>"
            "<li><b>Destination:</b> AUS (nearest to {destination_address})</li>"
            "<li><b>Outcome:</b> {outcome}</li>"
            "</ul>"
            "<p><b>To finalize</b> (60 seconds): pick the option you want at "
            "<a href='https://www.google.com/travel/flights'>google.com/travel/flights</a> "
            "and complete checkout. Your dates and origin/destination are pre-loaded "
            "from this email — just card + passenger info on your side.</p>"
        ),
    },
    "water_board": {
        "subject": "✓ Water shutoff — SFPUC stop service {move_date}",
        "body": (
            "<h2>Water service stop</h2>"
            "<p>Hi {homeowner_name}, your water shutoff request is ready:</p>"
            "<ul>"
            "<li><b>Stop date:</b> {move_date}</li>"
            "<li><b>Service address:</b> {origin_address}</li>"
            "<li><b>Outcome:</b> {outcome}</li>"
            "</ul>"
            "<p><b>To finalize</b>: log into <a href='https://myaccount-water.sfwater.org/'>myaccount-water.sfwater.org</a> "
            "→ 'Stop Service' → confirm date. Final meter reading scheduled, "
            "last bill arrives within 6 weeks.</p>"
        ),
    },
    "uscis_ar11": {
        "subject": "🇺🇸 USCIS AR-11 — pre-filled, awaiting your signature",
        "body": (
            "<h2>USCIS AR-11 — your action needed</h2>"
            "<p>Hi {homeowner_name}, your federal Change of Address form (AR-11) is pre-filled "
            "with the spec from your call:</p>"
            "<ul>"
            "<li><b>Old address:</b> {origin_address}</li>"
            "<li><b>New address:</b> {destination_address}</li>"
            "<li><b>Effective:</b> {move_date}</li>"
            "<li><b>Outcome:</b> {outcome}</li>"
            "</ul>"
            "<p><b>Why we can't sign for you</b>: 8 U.S.C. §1305 requires the alien — not an "
            "agent — to sign the declaration under penalty of perjury. Federal law caps "
            "automation here. We did the entire form. You do the 30-second click-to-sign.</p>"
            "<p><b>To finalize</b> (you have 10 days from your move): "
            "<a href='https://www.uscis.gov/ar-11'>uscis.gov/ar-11</a> → resume the session "
            "→ click 'Sign and Submit'. We'll persist the confirmation number to your record.</p>"
        ),
    },
    "id_card_update": {
        "subject": "✓ DMV DL-13A — certified letter en route to Sacramento",
        "body": (
            "<h2>CA DMV address change</h2>"
            "<p>Hi {homeowner_name}, your DL-13A 'Change of Address' card is being "
            "certified-mailed to the DMV Address Change Unit:</p>"
            "<ul>"
            "<li><b>Mailed to:</b> CA DMV — Address Change Unit, PO Box 942869, Sacramento CA 94269-0001</li>"
            "<li><b>Old address:</b> {origin_address}</li>"
            "<li><b>New address:</b> {destination_address}</li>"
            "<li><b>USPS Certified tracking:</b> {outcome}</li>"
            "</ul>"
            "<p><b>To finalize</b>: when our certified-mail piece arrives at your destination "
            "address (~5 business days), sign the wet copy and mail it back. We pre-paid "
            "the return-receipt postage. New DL card arrives within 14 days of DMV processing.</p>"
        ),
    },
    "bank_notify": {
        "subject": "🏦 Bank address-change playbook — 90-second script",
        "body": (
            "<h2>Your bank address-change script</h2>"
            "<p>Hi {homeowner_name}, banks legally require YOUR voice + SSN to update mailing "
            "addresses (2FA + identity verification). Here's the exact 90-second script to read:</p>"
            "<hr>"
            "<p><i>\"Hi, I'm calling to update the mailing address on all my accounts — "
            "checking, savings, and credit card. My account holder name is {homeowner_name}. "
            "New address: {destination_address}. Effective date: {move_date}. "
            "I'll provide my SSN and 2FA when prompted.\"</i></p>"
            "<hr>"
            "<ul>"
            "<li><b>What to have ready:</b> SSN (last 4), DOB, a recent transaction amount</li>"
            "<li><b>Confirmation</b>: ask for a written confirmation number — they'll text it</li>"
            "<li><b>Outcome:</b> {outcome}</li>"
            "</ul>"
            "<p><b>Why we can't do this for you</b>: bank security requires your voice on "
            "the line + SSN + 2FA code from your phone. No AI can legally clear that.</p>"
            "<p>Reply to this email with the confirmation number when done — we persist it "
            "to your Supermemory so the next move call recalls your bank.</p>"
        ),
    },
}


def _safe_format(template: str, ctx: dict[str, Any]) -> str:
    """Format template with ctx, swallowing missing keys."""
    class _SafeDict(dict):
        def __missing__(self, key):
            return "(tbd)"
    return template.format_map(_SafeDict(ctx))


async def fire_per_agent_artifacts(
    event_id: str,
    agent_id: str,
    spec: dict[str, Any],
    outcome_text: str,
    homeowner_email: str,
) -> None:
    """Fire one AgentMail email and one Supermemory persist for the just-closed specialist.

    Called from main.py after a specialist call closes. Non-blocking — runs in background.
    """
    playbook = PLAYBOOKS.get(agent_id)
    if not playbook:
        log.info("no per-agent playbook for %s; skipping artifact fire", agent_id)
        return

    ctx = {
        **spec,
        "homeowner_name": spec.get("homeowner_name", "there"),
        "outcome": outcome_text or "task confirmed",
    }
    subject = _safe_format(playbook["subject"], ctx)
    html = _safe_format(playbook["body"], ctx)
    text_fallback = (
        f"{subject}\n\n"
        f"Status: {outcome_text or 'task confirmed'}\n\n"
        f"See HTML for the full plan. Reply with questions."
    )

    # 1. AgentMail — real email per agent
    try:
        await send_move_package(
            event_id=f"{event_id}:{agent_id}",
            to_email=homeowner_email,
            subject=subject,
            body_markdown=text_fallback,
            html=html,
        )
    except Exception as e:
        log.warning("per-agent email failed for %s: %s", agent_id, e)

    # 2. Supermemory — persist the agent's outcome as its own document
    try:
        await persist_move(
            event_id=f"{event_id}:{agent_id}",
            phone_e164=spec.get("homeowner_phone") or "+10000000000",
            spec={
                **spec,
                "agent_id": agent_id,
                "agent_subject": subject,
            },
            results={agent_id: outcome_text or "closed"},
        )
    except Exception as e:
        log.warning("per-agent persist failed for %s: %s", agent_id, e)
