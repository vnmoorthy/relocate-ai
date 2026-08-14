"""Marketplace fan-out: when the buyer dispatches, run the chosen specialists
(11–16 of the 16 configured, depending on household flags) in parallel.

Each persona declares its `voice_mode`:
  - "browser" → Browser Use task against a real web form (runtime-blocked
                pending the protected-secrets v2 migration)
  - "email"   → AgentMail outbound to an allowlisted intake address
  - "mail"    → Lob.com certified-mail letter (runtime-blocked pending a
                customer review + signature workflow)
  - "voice"   → AgentPhone inbound (buyer only; no outbound-voice specialists)

There is no synthetic short-circuit for shipping agents. Either the real
integration runs and returns a real artifact, or the agent reports an honest
needs-user-action/failed outcome that the e2e tests surface.
"""
from __future__ import annotations

import asyncio
import logging
import re
import time
from typing import Any

from .config import settings
from .integrations import agentmail as am
from .integrations import browser_use as bu
from .integrations import lob_mail as lob
from .integrations._common import RecipientNotAllowed
from .integrations.hipaa_pdf import build_hipaa_release_pdf
from .integrations.moss import retrieve_runbooks_for_specialists
from .integrations.supermemory import persist_move, recall_user_profile
from .personas import all_specialists, Persona
from .state import state, SpecialistCallContext
from .ws import ws_broker


log = logging.getLogger(__name__)

TERMINAL_PROVIDER_STATES = frozenset({
    "submitted", "succeeded", "needs-user-action", "failed", "voicemail",
})


class NeedsUserAction(RuntimeError):
    """The provider action cannot safely continue without human intervention."""


# These workflows have legal, medical, or signature boundaries that the
# repository does not yet implement. Keeping the policy at dispatch prevents a
# configured provider key (or a direct adapter mock) from bypassing the guard.
MANDATORY_USER_ACTION: dict[str, str] = {
    "comcast_cancel": (
        "A customer-reviewed, signed cancellation-letter workflow is required "
        "before certified mail can be purchased."
    ),
    "id_card_update": (
        "A customer-reviewed, wet-signed DMV form workflow is required before "
        "certified mail can be purchased."
    ),
    "pcp_transfer": (
        "A secure HIPAA consent and electronic-signature ceremony is required "
        "before medical records can be requested."
    ),
    "pharmacy": (
        "A secure patient-authorized prescription-transfer workflow is required "
        "before pharmacy data can be transmitted."
    ),
}


# Explicit execution prerequisites. These are intentionally narrower than the
# buyer's conversational schema: a task is not allowed to contact a provider
# until every field it actually transmits is present.
REQUIRED_FIELDS: dict[str, tuple[str, ...]] = {
    "pge_shutoff": (
        "origin_address", "move_date", "pge_account_number", "pge_last4_ssn",
    ),
    "comcast_cancel": (
        "origin_address", "move_date", "user_name", "user_email",
        "comcast_account_number", "comcast_authorization_signed",
    ),
    "geico_address": (
        "destination_address", "move_date", "geico_email", "geico_password",
    ),
    "usps_coa": (
        "origin_address", "destination_address", "destination_zip", "move_date",
        "user_email", "usps_verify_card", "usps_verify_exp", "usps_verify_cvv",
    ),
    "spectrum_austin": (
        "destination_address", "move_date", "user_name", "user_email", "user_phone",
    ),
    "mover_quote": (
        "origin_address", "destination_address", "move_date", "user_email",
    ),
    "school_district": (
        "destination_address", "move_date", "user_email", "child_name", "child_grade",
    ),
    "pcp_transfer": (
        "origin_address", "user_name", "user_email", "user_phone", "user_dob",
        "hipaa_authorization_signed", "hipaa_signature_name", "hipaa_signature_date",
    ),
    "vet_transfer": (
        "user_name", "user_email", "pet_name", "pet_species", "vet_email",
    ),
    "gym_cancel": (
        "user_name", "user_email", "move_date", "equinox_member_id",
        "gym_authorization_signed",
    ),
    "pharmacy": (
        "destination_address", "user_name", "user_email", "user_dob",
        "source_pharmacy_name", "source_pharmacy_phone", "rx_numbers",
    ),
    "flight_book": (
        "origin_address", "destination_address", "move_date",
    ),
    "water_board": (
        "origin_address", "move_date", "sfpuc_username", "sfpuc_password",
    ),
    "uscis_ar11": (
        "origin_address", "destination_address", "move_date", "user_name",
        "user_dob", "a_number",
    ),
    "id_card_update": (
        "origin_address", "destination_address", "move_date", "user_name",
        "user_dob", "ca_dl_number", "dmv_authorization_signed",
    ),
    "bank_notify": ("destination_address", "move_date", "user_email"),
}


def missing_prerequisites(agent_id: str, spec: dict[str, Any]) -> list[str]:
    missing: list[str] = []
    for field_name in REQUIRED_FIELDS.get(agent_id, ()):
        value = spec.get(field_name)
        if field_name.endswith("_signed"):
            present = value is True
        else:
            present = value is not None and value != ""
        if not present:
            missing.append(field_name)
    return missing


def _public_artifact_summary(p: Persona, artifact: dict[str, Any]) -> str:
    """Describe an artifact without broadcasting values, tokens, or PII."""
    safe_keys = sorted(k for k in artifact if "token" not in k.lower())
    key_text = ", ".join(safe_keys[:8]) or "provider receipt"
    return f"{p.name}: request submitted; receipt fields: {key_text}"


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
    if new_state in TERMINAL_PROVIDER_STATES:
        ctx.closed_at = time.time()
    state.save_event(event)
    await ws_broker.broadcast({
        "type": "agent_state",
        "event_id": event_id,
        "agent_id": agent_id,
        "state": new_state,
        "ts": time.time(),
    })


async def _mark_needs_user_action(
    event_id: str,
    agent_id: str,
    *,
    blocker_kind: str,
    blockers: list[str],
) -> None:
    event = state.events.get(event_id)
    if event is None or agent_id not in event.specialist_calls:
        return
    ctx = event.specialist_calls[agent_id]
    ctx.terminal_outcome = "needs_user_action"
    ctx.blocker_kind = blocker_kind
    ctx.blockers = blockers
    ctx.bid = {
        "outcome": "needs_user_action",
        "reason": blocker_kind,
        "missing_fields": blockers if blocker_kind == "missing_fields" else [],
    }
    await _emit_agent_state(event_id, agent_id, "needs-user-action")


async def fan_out(event_id: str, spec: dict[str, Any]) -> None:
    """Run every chosen specialist in parallel and store the artifact on the ctx.bid."""
    # USPS needs the bare destination ZIP; derive it from the address so the
    # caller is never asked for a value they already provided. US addresses put
    # the ZIP last, so take the LAST 5-digit group — the first can be a street
    # number ("10600 Menchaca Rd, Austin, TX 78748").
    if spec.get("destination_address") and not spec.get("destination_zip"):
        zip_groups = re.findall(r"\b(\d{5})(?:-\d{4})?\b", str(spec["destination_address"]))
        if zip_groups:
            spec["destination_zip"] = zip_groups[-1]

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
    user_phone = spec.get("user_phone")
    if user_phone:
        asyncio.create_task(recall_user_profile(event_id, user_phone))

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

    # Only provider-ready specialists may execute. Missing prerequisites are an
    # honest NEEDS_USER_ACTION outcome, never a fabricated fallback success.
    ready: list[Persona] = []
    for p in specialists:
        missing = missing_prerequisites(p.agent_id, spec)
        if missing:
            await _mark_needs_user_action(
                event_id,
                p.agent_id,
                blocker_kind="missing_fields",
                blockers=missing,
            )
        else:
            ready.append(p)

    # Run ready specialists concurrently. _run_one captures its own exceptions so
    # one provider cannot crash the wave.
    await asyncio.gather(*[_run_one(p, event_id, spec) for p in ready])
    await finalize_event(event_id)


async def resume_ready_specialists(event_id: str) -> None:
    """Resume field-blocked specialists after a late/corrected spec update."""
    event = state.events.get(event_id)
    if event is None or event.finalized_at is not None:
        return

    personas = {p.agent_id: p for p in pick_specialists(event.spec)}
    ready: list[Persona] = []
    for agent_id, ctx in event.specialist_calls.items():
        if ctx.state != "needs-user-action" or ctx.blocker_kind != "missing_fields":
            continue
        persona = personas.get(agent_id)
        if persona is None:
            continue
        missing = missing_prerequisites(agent_id, event.spec)
        if missing:
            ctx.blockers = missing
            if isinstance(ctx.bid, dict):
                ctx.bid["missing_fields"] = missing
            continue
        ctx.state = "dispatched"
        ctx.terminal_outcome = None
        ctx.blocker_kind = None
        ctx.blockers = []
        ctx.bid = None
        ctx.closed_at = None
        event.awaiting_user_notified = False
        await _emit_agent_state(event_id, agent_id, "dispatched")
        ready.append(persona)

    if ready:
        await asyncio.gather(*[_run_one(p, event_id, event.spec) for p in ready])
    await finalize_event(event_id)


async def _run_one(p: Persona, event_id: str, spec: dict[str, Any]) -> None:
    """Dispatch one specialist to its mode-specific handler.

    Missing/obsolete integrations are terminal NEEDS_USER_ACTION outcomes.
    They are never converted into a fake provider completion.
    """
    await _emit_agent_state(event_id, p.agent_id, "calling")
    policy_reason = MANDATORY_USER_ACTION.get(p.agent_id)
    if policy_reason:
        await _mark_needs_user_action(
            event_id,
            p.agent_id,
            blocker_kind="secure_user_workflow_required",
            blockers=[policy_reason],
        )
        return

    try:
        if p.voice_mode == "browser":
            # The repository's Browser Use adapter is v1. The provider now uses
            # v2 tasks + a protected secrets channel, so fail safely until that
            # migration is implemented and contract-tested.
            raise NeedsUserAction("Browser Use v1 adapter disabled pending v2 migration")
        elif p.voice_mode == "email":
            artifact = await _run_email(p, event_id, spec)
        elif p.voice_mode == "mail":
            artifact = await _run_mail(p, event_id, spec)
        else:
            raise RuntimeError(
                f"specialist {p.agent_id} has unsupported voice_mode={p.voice_mode}"
            )
        if not isinstance(artifact, dict) or not artifact:
            raise RuntimeError(f"provider returned no artifact for {p.agent_id}")

        # A provider receipt proves submission, not downstream completion.
        event = state.events[event_id]
        ctx = event.specialist_calls[p.agent_id]
        ctx.bid = artifact
        ctx.terminal_outcome = "submitted"
        ctx.blocker_kind = None
        ctx.blockers = []
        public_summary = _public_artifact_summary(p, artifact)
        ctx.transcript.append({
            "role": "agent", "text": public_summary,
            "ts": time.time(),
        })
        await ws_broker.broadcast({
            "type": "transcript_turn", "event_id": event_id, "agent_id": p.agent_id,
            "turn": 1, "role": "agent",
            "text": public_summary,
            "ts": time.time(),
        })
        await _emit_agent_state(event_id, p.agent_id, "submitted")
    except NeedsUserAction as e:
        log.warning("specialist %s needs user action: %s", p.agent_id, e)
        await _mark_needs_user_action(
            event_id,
            p.agent_id,
            blocker_kind="integration_unavailable",
            blockers=[str(e)],
        )
    except RecipientNotAllowed as e:
        log.warning("specialist %s blocked by recipient allowlist: %s", p.agent_id, e)
        await _mark_needs_user_action(
            event_id,
            p.agent_id,
            blocker_kind="recipient_not_allowlisted",
            blockers=[str(e)],
        )
    except RuntimeError as e:
        if "_API_KEY missing" in str(e):
            log.warning("specialist %s integration unavailable", p.agent_id)
            await _mark_needs_user_action(
                event_id,
                p.agent_id,
                blocker_kind="integration_unavailable",
                blockers=["provider integration is not configured"],
            )
            return
        log.exception("specialist %s failed", p.agent_id)
        failed_event = state.events.get(event_id)
        if failed_event is not None and p.agent_id in failed_event.specialist_calls:
            ctx = failed_event.specialist_calls[p.agent_id]
            ctx.terminal_outcome = "failed"
            ctx.bid = {"outcome": "failed", "error_type": type(e).__name__}
        await _emit_agent_state(event_id, p.agent_id, "failed")
    except Exception as e:  # noqa: BLE001 — one specialist's failure mustn't kill the wave
        log.exception("specialist %s failed", p.agent_id)
        failed_event = state.events.get(event_id)
        if failed_event is not None and p.agent_id in failed_event.specialist_calls:
            ctx = failed_event.specialist_calls[p.agent_id]
            ctx.terminal_outcome = "failed"
            ctx.bid = {"outcome": "failed", "error_type": type(e).__name__}
        await _emit_agent_state(event_id, p.agent_id, "failed")


async def finalize_event(event_id: str) -> None:
    """Finalize a provider wave exactly once when no user-blocked work remains.

    Repeated calls are safe. NEEDS_USER_ACTION is reported but intentionally does
    not finalize the event, allowing a later secure spec update to resume it.
    """
    event = state.events.get(event_id)
    if event is None or event.finalized_at is not None or event.finalization_started:
        return
    if not event.specialist_calls:
        return

    contexts = list(event.specialist_calls.values())
    if any(ctx.state not in TERMINAL_PROVIDER_STATES for ctx in contexts):
        return

    needs_user = [ctx.agent_id for ctx in contexts if ctx.state == "needs-user-action"]
    if needs_user:
        if not event.awaiting_user_notified:
            event.awaiting_user_notified = True
            await ws_broker.broadcast({
                "type": "event_waiting_for_user",
                "event_id": event_id,
                "agents": needs_user,
                "count": len(needs_user),
                "ts": time.time(),
            })
        return

    # The flag is set before the first await so concurrent webhook/task completions
    # cannot run the finalizer twice in this process.
    event.finalization_started = True
    try:
        failed = [ctx.agent_id for ctx in contexts if ctx.state == "failed"]
        submitted = [
            ctx.agent_id for ctx in contexts if ctx.state in {"submitted", "succeeded"}
        ]
        outcome = "partial_failure" if failed else "submitted"

        result_lines = [
            f"- {ctx.agent_id}: {ctx.terminal_outcome or ctx.state}"
            for ctx in contexts
        ]
        body = (
            "Your Relocate provider-dispatch summary is ready.\n\n"
            + "\n".join(result_lines)
            + "\n\n'Submitted' means the provider accepted a request; it does not "
              "claim the underlying service change is complete.\n"
        )

        email_result: dict[str, Any] | None = None
        user_email = event.spec.get("user_email")
        if user_email:
            try:
                email_result = await am.send_move_package(
                    event_id=event_id,
                    to_email=user_email,
                    subject=f"Relocate provider-dispatch summary ({event_id})",
                    body_markdown=body,
                )
            except RecipientNotAllowed as e:
                # The summary email is best-effort; an unallowlisted recipient
                # must not wedge finalization.
                log.warning("summary email blocked by recipient allowlist: %s", e)

        persist_result: dict[str, Any] | None = None
        user_phone = event.spec.get("user_phone")
        if user_phone:
            persist_result = await persist_move(
                event_id=event_id,
                phone_e164=user_phone,
                spec=event.spec,
                results={ctx.agent_id: ctx.terminal_outcome or ctx.state for ctx in contexts},
            )

        event.final_outcome = outcome
        event.finalized_at = time.time()
        state.save_event(event)
        await ws_broker.broadcast({
            "type": "event_finalized",
            "event_id": event_id,
            "outcome": outcome,
            "summary": {
                "submitted_count": len(submitted),
                "failed_count": len(failed),
                "summary_email_sent": bool(email_result),
                "memory_persisted": bool(persist_result),
            },
            "ts": event.finalized_at,
        })
    except Exception:  # noqa: BLE001 - release the in-process idempotency claim for retry
        event.finalization_started = False
        log.exception("event finalization failed: %s", event_id)
        raise


# ──────────────────────────────────────────────────────────────────────
# Mode-specific dispatchers
# ──────────────────────────────────────────────────────────────────────


async def _run_browser(
    p: Persona,
    event_id: str,
    spec: dict[str, Any],
) -> dict[str, Any] | None:
    """Browser-mode specialists: 8 in the v2.1 roster."""
    await _emit_agent_state(event_id, p.agent_id, "in-progress")
    if p.agent_id == "pge_shutoff":
        return await bu.submit_pge_shutoff(event_id=event_id, spec=spec)
    if p.agent_id == "geico_address":
        return await bu.submit_geico_address(event_id=event_id, spec=spec)
    if p.agent_id == "usps_coa":
        return await bu.submit_usps_coa(event_id=event_id, spec=spec)
    if p.agent_id == "spectrum_austin":
        return await bu.submit_spectrum_order(event_id=event_id, spec=spec)
    if p.agent_id == "flight_book":
        return await bu.submit_flight_search(event_id=event_id, spec=spec)
    if p.agent_id == "water_board":
        return await bu.submit_water_shutoff(event_id=event_id, spec=spec)
    if p.agent_id == "uscis_ar11":
        return await bu.submit_uscis_ar11(event_id=event_id, spec=spec)
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


async def _run_email(
    p: Persona,
    event_id: str,
    spec: dict[str, Any],
) -> dict[str, Any] | None:
    """Email-mode specialists: 6 (mover, school, pcp, vet, gym, bank).

    pcp_transfer is additionally policy-blocked in MANDATORY_USER_ACTION, so at
    runtime only the other five can reach their adapters.
    """
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
            signature_name=spec["hipaa_signature_name"],
            signature_date=spec["hipaa_signature_date"],
        )
        return await am.request_pcp_records(
            event_id=event_id, spec=spec, user_email=user_email, release_pdf_bytes=release_pdf,
        )
    if p.agent_id == "vet_transfer":
        return await am.request_vet_records(event_id=event_id, spec=spec, user_email=user_email)
    if p.agent_id == "gym_cancel":
        return await am.request_gym_cancellation(event_id=event_id, spec=spec, user_email=user_email)
    if p.agent_id == "bank_notify":
        return await am.send_bank_script(event_id=event_id, spec=spec, user_email=user_email)

    raise RuntimeError(f"no email handler for agent {p.agent_id}")


async def _run_mail(p: Persona, event_id: str, spec: dict[str, Any]) -> dict:
    """Mail-mode specialists: 2 in the v2.1 roster (comcast_cancel + id_card_update)."""
    await _emit_agent_state(event_id, p.agent_id, "in-progress")
    if p.agent_id == "comcast_cancel":
        return await lob.send_comcast_cancellation_letter(event_id=event_id, spec=spec)
    if p.agent_id == "id_card_update":
        return await lob.send_dl13a_letter(event_id=event_id, spec=spec)
    raise RuntimeError(f"no mail handler for agent {p.agent_id}")
