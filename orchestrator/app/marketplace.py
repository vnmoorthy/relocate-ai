"""Marketplace fan-out: when buyer dispatches, run the 11 specialists in parallel.

Each persona declares its `voice_mode`:
  - "browser" → Browser Use task against a real web form
  - "email"   → AgentMail outbound to a known intake address
  - "mail"    → Lob.com certified-mail letter
  - "voice"   → AgentPhone outbound (currently only the buyer is inbound voice;
                no shipping specialists are outbound voice in v2)

There is no `SYNTHETIC_MODE` short-circuit for shipping agents anymore. Either
the real integration runs and returns a real artifact, or the agent fails and
the e2e test surfaces it. (Synthetic mode is preserved as a separate dev path
for dashboard rehearsal only — it is NOT used to make shipping artifacts.)
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from pathlib import Path
from typing import Any

from .config import settings
from .integrations import agentmail as am
from .integrations import browser_use as bu
from .integrations import lob_mail as lob
from .integrations.hipaa_pdf import build_hipaa_release_pdf
from .integrations.moss import retrieve_runbooks_for_specialists
from .integrations.supermemory import recall_user_profile
from .personas import all_specialists, Persona, by_id
from .state import state, SpecialistCallContext
from .ws import ws_broker


log = logging.getLogger(__name__)


def _load_agents_registry() -> dict[str, dict[str, Any]]:
    """agents.json shape: {"agents": [{"agent_id": ..., "agentphone_id": ..., ...}]}"""
    path = Path(__file__).parent.parent / "agents.json"
    if not path.exists():
        return {}
    data = json.loads(path.read_text())
    return {entry["agent_id"]: entry for entry in data.get("agents", [])}


def pick_specialists(spec: dict[str, Any]) -> list[Persona]:
    """Choose which of the 16 specialists to dispatch for this move spec.

    Conditional rules (from persona.requires_*):
      - requires_pets    AND not has_pets    → skip
      - requires_children AND not has_children → skip
      - requires_car     AND not has_car     → skip
      - requires_visa    AND not has_visa    → skip (USCIS AR-11 only for visa holders)
    """
    has_pets = bool(spec.get("has_pets"))
    has_children = bool(spec.get("has_children"))
    has_car = spec.get("has_car", True)  # default yes (most customers)
    has_visa = bool(spec.get("has_visa"))  # default no (most are citizens)

    chosen: list[Persona] = []
    for p in all_specialists():
        if p.requires_pets and not has_pets:
            continue
        if p.requires_children and not has_children:
            continue
        if p.requires_car and not has_car:
            continue
        if p.requires_visa and not has_visa:
            continue
        chosen.append(p)
    return chosen


async def _emit_agent_state(event_id: str, agent_id: str, new_state: str) -> None:
    """Update SpecialistCallContext.state + broadcast."""
    event = state.events.get(event_id)
    if event is None:
        return
    ctx = event.specialist_calls.get(agent_id)
    if ctx is None:
        return
    ctx.state = new_state
    if new_state == "closed":
        ctx.closed_at = time.time()
    await ws_broker.broadcast({
        "type": "agent_state",
        "event_id": event_id,
        "agent_id": agent_id,
        "state": new_state,
        "ts": time.time(),
    })


async def fan_out(event_id: str, spec: dict[str, Any]) -> None:
    """Run every chosen specialist in parallel and store the artifact on the ctx.bid."""
    specialists = pick_specialists(spec)
    log.info("fan_out event=%s specialists=%d", event_id, len(specialists))

    event = state.events.get(event_id)
    if event is None:
        log.error("fan_out: no MarketplaceEvent for %s", event_id)
        return

    # Fire Moss + Supermemory at dispatch (visible sponsor activity).
    asyncio.create_task(
        retrieve_runbooks_for_specialists(event_id, spec, [p.category for p in specialists])
    )
    homeowner_phone = spec.get("homeowner_phone", settings.demo_homeowner_number)
    asyncio.create_task(recall_user_profile(event_id, homeowner_phone))

    # Create SpecialistCallContext + announce dispatched for every chosen specialist.
    for p in specialists:
        ctx = SpecialistCallContext(call_id="pending", agent_id=p.agent_id, event_id=event_id)
        event.specialist_calls[p.agent_id] = ctx
        await ws_broker.broadcast({
            "type": "agent_state",
            "event_id": event_id,
            "agent_id": p.agent_id,
            "state": "dispatched",
            "ts": ctx.started_at,
        })

    # Run every specialist concurrently. _run_one captures its own exceptions and
    # marks the ctx as error — one specialist failing must not crash the wave.
    await asyncio.gather(*[_run_one(p, event_id, spec) for p in specialists])


async def _run_one(p: Persona, event_id: str, spec: dict[str, Any]) -> None:
    """Dispatch one specialist to its mode-specific handler."""
    await _emit_agent_state(event_id, p.agent_id, "calling")
    try:
        if p.voice_mode == "browser":
            artifact = await _run_browser(p, event_id, spec)
        elif p.voice_mode == "email":
            artifact = await _run_email(p, event_id, spec)
        elif p.voice_mode == "mail":
            artifact = await _run_mail(p, event_id, spec)
        else:
            raise RuntimeError(
                f"specialist {p.agent_id} has unsupported voice_mode={p.voice_mode}"
            )
        # Stamp the artifact on the ctx + close.
        event = state.events[event_id]
        ctx = event.specialist_calls[p.agent_id]
        ctx.bid = artifact
        ctx.transcript.append({
            "role": "agent", "text": f"Bid: {json.dumps(artifact)[:240]}",
            "pavo_tier": "fallback-mock", "ts": time.time(),
        })
        await ws_broker.broadcast({
            "type": "transcript_turn", "event_id": event_id, "agent_id": p.agent_id,
            "turn": 1, "role": "agent",
            "text": f"Bid: {json.dumps(artifact)[:240]}",
            "ts": time.time(),
        })
        await _emit_agent_state(event_id, p.agent_id, "closed")
    except Exception as e:  # noqa: BLE001 — one specialist's failure mustn't kill the wave
        log.exception("specialist %s failed", p.agent_id)
        event = state.events.get(event_id)
        if event and p.agent_id in event.specialist_calls:
            event.specialist_calls[p.agent_id].bid = {"error": f"{type(e).__name__}: {str(e)[:240]}"}
        await _emit_agent_state(event_id, p.agent_id, "error")


# ──────────────────────────────────────────────────────────────────────
# Mode-specific dispatchers
# ──────────────────────────────────────────────────────────────────────


async def _run_browser(p: Persona, event_id: str, spec: dict[str, Any]) -> dict:
    """Browser-mode specialists: 5 in the v2 roster."""
    await _emit_agent_state(event_id, p.agent_id, "in-progress")
    if p.agent_id == "pge_shutoff":
        return await bu.submit_pge_shutoff(event_id=event_id, spec=spec)
    if p.agent_id == "geico_address":
        return await bu.submit_geico_address(event_id=event_id, spec=spec)
    if p.agent_id == "usps_coa":
        return await bu.submit_usps_coa(event_id=event_id, spec=spec)
    if p.agent_id == "spectrum_austin":
        return await bu.submit_spectrum_order(event_id=event_id, spec=spec)
    if p.agent_id == "pharmacy":
        # Primary path: Browser Use. Fallback: AgentMail to CVS customer service.
        try:
            return await bu.submit_cvs_transfer(event_id=event_id, spec=spec)
        except Exception as e:
            log.warning("pharmacy browser path failed (%s); falling back to AgentMail", e)
            user_email = spec.get("user_email", settings.demo_email_recipient)
            return await am.request_pharmacy_transfer_fallback(
                event_id=event_id, spec=spec, user_email=user_email,
            )
    raise RuntimeError(f"no browser handler for agent {p.agent_id}")


async def _run_email(p: Persona, event_id: str, spec: dict[str, Any]) -> dict:
    """Email-mode specialists: 5 in the v2 roster (mover, school, pcp, vet, gym)."""
    await _emit_agent_state(event_id, p.agent_id, "in-progress")
    user_email = spec.get("user_email", settings.demo_email_recipient)

    if p.agent_id == "mover_quote":
        return await am.request_mover_quotes(event_id=event_id, spec=spec, user_email=user_email)
    if p.agent_id == "school_district":
        return await am.request_school_enrollment(event_id=event_id, spec=spec, user_email=user_email)
    if p.agent_id == "pcp_transfer":
        release_pdf = await asyncio.to_thread(
            build_hipaa_release_pdf,
            patient_name=spec.get("user_name", "(patient)"),
            patient_dob=spec.get("user_dob", "(DOB)"),
            patient_address=spec.get("origin_address", "(origin)"),
            patient_phone=spec.get("user_phone", "(phone)"),
            patient_email=user_email,
            current_provider_name="One Medical SF",
            current_provider_address="One Medical SF — current provider on file",
        )
        return await am.request_pcp_records(
            event_id=event_id, spec=spec, user_email=user_email, release_pdf_bytes=release_pdf,
        )
    if p.agent_id == "vet_transfer":
        return await am.request_vet_records(event_id=event_id, spec=spec, user_email=user_email)
    if p.agent_id == "gym_cancel":
        return await am.request_gym_cancellation(event_id=event_id, spec=spec, user_email=user_email)

    raise RuntimeError(f"no email handler for agent {p.agent_id}")


async def _run_mail(p: Persona, event_id: str, spec: dict[str, Any]) -> dict:
    """Mail-mode specialists: 1 in the v2 roster (comcast_cancel via Lob)."""
    await _emit_agent_state(event_id, p.agent_id, "in-progress")
    if p.agent_id == "comcast_cancel":
        return await lob.send_comcast_cancellation_letter(event_id=event_id, spec=spec)
    raise RuntimeError(f"no mail handler for agent {p.agent_id}")
