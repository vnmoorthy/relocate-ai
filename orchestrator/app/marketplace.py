"""Marketplace fan-out: when buyer agent dispatches, fire outbound calls to 7 LIVE
specialists in parallel (or wave-mode if AGENTPHONE_PARALLEL_CAP < 7).

Pattern per /plan-eng-review architecture issue 6 (cap fallback).
"""
from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
from typing import Any

from .agentphone import get_client, AgentPhoneError
from .config import settings
from .integrations.browser_use import submit_usps_coa
from .integrations.moss import retrieve_runbooks_for_specialists
from .integrations.supermemory import recall_user_profile
from .personas import live_personas, Persona, by_id
from .state import state, SpecialistCallContext, MarketplaceEvent
from .ws import ws_broker


log = logging.getLogger(__name__)


def _load_agents_registry() -> dict[str, dict[str, Any]]:
    """Reads agents.json produced by scripts/provision_agents.py.

    Shape: {"agents": [{"agent_id": "pge_shutoff", "agentphone_id": "agt_xxx", "number_id": "num_xxx", "phone_e164": "+1...", "webhook_secret": "whsec_..."}]}
    """
    path = Path(__file__).parent.parent / "agents.json"
    if not path.exists():
        return {}
    data = json.loads(path.read_text())
    return {entry["agent_id"]: entry for entry in data.get("agents", [])}


def pick_specialists(spec: dict[str, Any]) -> list[Persona]:
    """Choose which LIVE specialists to dispatch based on the move spec.

    Conditional rules:
    - has_pets=False → skip vet (it's backlog anyway, but defensive)
    - has_children=False → skip school district (backlog, defensive)
    All 7 LIVE specialists fire by default; this hook lets us scale down later.
    """
    chosen = list(live_personas())
    # In demo: always all 7. Future: filter on spec conditionals.
    return chosen


async def fan_out(event_id: str, spec: dict[str, Any]) -> None:
    """Fire outbound AgentPhone calls to the chosen LIVE specialists in parallel.

    Wave-mode if AGENTPHONE_PARALLEL_CAP < N.
    Each outbound call's transcripts will arrive on per-specialist webhooks.
    """
    registry = _load_agents_registry()
    specialists = pick_specialists(spec)
    cap = settings.agentphone_parallel_cap

    log.info("fan_out event=%s specialists=%d cap=%d", event_id, len(specialists), cap)

    event = state.events.get(event_id)
    if event is None:
        log.error("fan_out: no MarketplaceEvent for %s", event_id)
        return

    # Fire Moss + Supermemory at dispatch (visible sponsor activity on the dashboard).
    # Moss retrieves runbooks per specialist category and stores them on the event for
    # specialists to pick up when their first webhook fires.
    asyncio.create_task(
        retrieve_runbooks_for_specialists(event_id, spec, [p.category for p in specialists])
    )
    homeowner_phone = spec.get("homeowner_phone", settings.demo_homeowner_number)
    asyncio.create_task(recall_user_profile(event_id, homeowner_phone))

    # If SYNTHETIC_MODE: skip AgentPhone entirely; run fake 4-turn conversations via PAVO.
    # Used for rehearsal + backup video recording.
    if settings.synthetic_mode:
        from .synthetic import run_synthetic_fan_out
        log.info("SYNTHETIC_MODE active: skipping AgentPhone, using PAVO direct for fake conversations")
        # Mark all specialists dispatched, then start the synthetic loop.
        for p in specialists:
            ctx = SpecialistCallContext(call_id="synthetic", agent_id=p.agent_id, event_id=event_id)
            event.specialist_calls[p.agent_id] = ctx
            await ws_broker.broadcast({
                "type": "agent_state", "event_id": event_id,
                "agent_id": p.agent_id, "state": "dispatched", "ts": ctx.started_at,
            })
        asyncio.create_task(run_synthetic_fan_out(event_id, spec, specialists))
        return

    # Emit agent_state=dispatched events for the dashboard.
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

    async def _place_one(p: Persona) -> None:
        await ws_broker.broadcast({
            "type": "agent_state",
            "event_id": event_id,
            "agent_id": p.agent_id,
            "state": "calling",
            "ts": event.specialist_calls[p.agent_id].started_at,
        })
        try:
            if p.voice_mode == "browser":
                # Browser Use path runs in-process, not via AgentPhone.
                await _run_browser_specialist(p, event_id, spec)
                return

            entry = registry.get(p.agent_id)
            if entry is None:
                log.warning("specialist %s not provisioned (no agents.json entry)", p.agent_id)
                event.specialist_calls[p.agent_id].state = "error"
                await ws_broker.broadcast({
                    "type": "agent_state", "event_id": event_id,
                    "agent_id": p.agent_id, "state": "error",
                    "ts": event.specialist_calls[p.agent_id].started_at,
                })
                return

            client = get_client()
            to_number = p.counterparty_phone or spec.get(f"{p.agent_id}_target")
            if not to_number:
                log.warning("specialist %s has no counterparty phone", p.agent_id)
                return

            call = await client.create_outbound_call(
                agent_id=entry["agentphone_id"],
                to_number=to_number,
                from_number_id=entry.get("number_id"),
                voice=p.voice,
                metadata={"event_id": event_id, "specialist_id": p.agent_id},
            )
            ctx = event.specialist_calls[p.agent_id]
            ctx.call_id = call.get("id", "unknown")
            ctx.state = "in-progress"
            state.specialist_call_to_agent[ctx.call_id] = p.agent_id
            await ws_broker.broadcast({
                "type": "agent_state", "event_id": event_id,
                "agent_id": p.agent_id, "state": "in-progress",
                "ts": ctx.started_at,
            })
        except AgentPhoneError as e:
            log.error("AgentPhone error for %s: %s", p.agent_id, e)
            event.specialist_calls[p.agent_id].state = "error"
            await ws_broker.broadcast({
                "type": "agent_state", "event_id": event_id,
                "agent_id": p.agent_id, "state": "error",
                "ts": event.specialist_calls[p.agent_id].started_at,
            })

    if cap >= len(specialists):
        await asyncio.gather(*[_place_one(p) for p in specialists])
    else:
        # Wave mode.
        for i in range(0, len(specialists), cap):
            wave = specialists[i:i + cap]
            await asyncio.gather(*[_place_one(p) for p in wave])
            if i + cap < len(specialists):
                await asyncio.sleep(8.0)


async def _run_browser_specialist(p: Persona, event_id: str, spec: dict[str, Any]) -> None:
    """Browser Use specialists (USPS) run via the Browser Use API."""
    log.info("browser specialist %s starting", p.agent_id)
    event = state.events[event_id]
    event.specialist_calls[p.agent_id].state = "in-progress"
    await ws_broker.broadcast({
        "type": "agent_state", "event_id": event_id,
        "agent_id": p.agent_id, "state": "in-progress",
        "ts": event.specialist_calls[p.agent_id].started_at,
    })

    if p.agent_id == "usps_coa":
        result = await submit_usps_coa(
            event_id=event_id,
            old_address=spec.get("origin_address", ""),
            new_address=spec.get("destination_address", ""),
            move_date=spec.get("move_date", ""),
        )
        # Mark closed (Browser Use is fire-and-track; for demo we close immediately
        # after the task is submitted — real result polling happens via webhook).
        event.specialist_calls[p.agent_id].state = "closed"
        event.specialist_calls[p.agent_id].bid = result
        await ws_broker.broadcast({
            "type": "agent_state", "event_id": event_id,
            "agent_id": p.agent_id, "state": "closed",
            "ts": event.specialist_calls[p.agent_id].started_at,
        })
    else:
        # Other browser specialists (DMV, voter, subscriptions) are backlog — not used live.
        log.warning("browser specialist %s not yet wired (backlog)", p.agent_id)
