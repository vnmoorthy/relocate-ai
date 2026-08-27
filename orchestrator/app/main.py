"""FastAPI entry point.

Routes:
- POST /webhook/agent/{agent_id}   AgentPhone webhook fan-in
- WS   /ws/dashboard               dashboard event stream
- POST /api/test/buyer-trigger     dev-only synthetic buyer trigger
- GET  /healthz                    liveness
"""
from __future__ import annotations

import asyncio
import hmac
import json
import logging
import re
import time
import uuid
from contextlib import asynccontextmanager, suppress
from typing import Any, AsyncIterator

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse, JSONResponse
from pythonjsonlogger import jsonlogger

from .config import settings
from .marketplace import (
    _SELF_DELIVERED_AGENTS,
    fan_out,
    finalize_event,
    resume_ready_specialists,
)
from .pavo_client import PavoReply, PavoUnavailableError, pavo_chat
from .persistence import persistence
from .personas import by_id, buyer_system_prompt
from .demo_auth import (
    enabled as demo_enabled,
    issue_token,
    valid_token,
    verify_access_key,
    verify_credentials,
)
from .public_feed import public_ref, redact_public_event
from .security import (
    complete_agentphone_webhook,
    get_raw_body,
    load_webhook_deliveries_from_persistence,
    release_agentphone_webhook,
    verify_agentphone_signature,
)
from .state import state, BuyerCallContext, MarketplaceEvent
from .ws import public_broker, ws_broker


# Structured JSON logging per /plan-eng-review code-quality issue 10.
def _setup_logging() -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(jsonlogger.JsonFormatter(
        "%(asctime)s %(levelname)s %(name)s %(message)s",
        rename_fields={"asctime": "ts", "levelname": "level", "name": "logger"},
    ))
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(settings.log_level.upper())


_setup_logging()
log = logging.getLogger(__name__)


@asynccontextmanager
async def _lifespan(_app: FastAPI) -> AsyncIterator[None]:
    persistence.open(settings.database_path)
    if persistence.enabled:
        state.load_from_persistence()
        restored = load_webhook_deliveries_from_persistence()
        if restored:
            log.info("webhook dedupe records restored: %d", restored)
    poller: asyncio.Task | None = None
    if settings.agentmail_api_key and settings.agentmail_api_key != "REPLACE_ME":
        from .integrations.replies import reply_poll_loop
        poller = asyncio.create_task(reply_poll_loop())
    yield
    if poller is not None:
        poller.cancel()
        with suppress(asyncio.CancelledError):
            await poller
    persistence.close()


app = FastAPI(title="Relocate Orchestrator", version="0.9.0", lifespan=_lifespan)
# Every dashboard broadcast is mirrored, redacted, to the unauthenticated public feed.
ws_broker.mirror = (public_broker, redact_public_event)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthz")
async def healthz() -> dict[str, Any]:
    return {
        "status": "ok",
        "events": len(state.events),
        "active_buyer_calls": len(state.buyer_contexts),
        "ws_clients": ws_broker.client_count,
        "ts": time.time(),
    }


@app.post("/webhook/agent/{agent_id}", response_model=None)
async def webhook_agent(agent_id: str, request: Request) -> StreamingResponse | JSONResponse:
    """AgentPhone webhook: receives transcript turns + call lifecycle events.

    For the BUYER agent: parse spec, fire fan_out background task once dispatchable.
    For SPECIALIST agents: route the turn through PAVO and reply with text.
    """
    body = await get_raw_body(request)
    webhook_id = request.headers.get("X-Webhook-ID")
    claim = verify_agentphone_signature(
        body,
        request.headers.get("X-Webhook-Signature"),
        request.headers.get("X-Webhook-Timestamp"),
        webhook_id,
        agent_id,
    )
    if claim == "completed":
        return JSONResponse({"ok": True, "duplicate": True})
    if claim == "in_flight":
        # The first delivery is still processing. A 409 keeps the vendor
        # retrying: if the in-flight attempt fails and is released, a 200 here
        # would have permanently swallowed this delivery.
        return JSONResponse({"ok": False, "in_flight": True}, status_code=409)

    assert webhook_id is not None  # verified above
    try:
        response = await _process_agentphone_webhook(agent_id, body)
    except Exception:
        # Authentication succeeded, but business processing did not. Release the
        # delivery so AgentPhone's retry is not incorrectly acknowledged/lost.
        release_agentphone_webhook(agent_id, webhook_id)
        raise
    complete_agentphone_webhook(agent_id, webhook_id)
    return response


async def _process_agentphone_webhook(
    agent_id: str,
    body: bytes,
) -> StreamingResponse | JSONResponse:
    """Parse and process one already-authenticated AgentPhone delivery."""

    try:
        payload = json.loads(body)
    except json.JSONDecodeError as e:
        raise HTTPException(400, f"bad json: {e}") from e
    if not isinstance(payload, dict):
        raise HTTPException(400, "webhook payload must be a JSON object")

    event_type = payload.get("event", "")
    channel = payload.get("channel", "")
    data = payload.get("data", {})
    if not isinstance(data, dict):
        raise HTTPException(400, "webhook data must be an object")

    log.info("webhook agent=%s event=%s channel=%s", agent_id, event_type, channel)

    if channel != "voice":
        # SMS / other channels not implemented in MVP.
        return JSONResponse({"ok": True})

    if event_type == "agent.call_ended":
        return await _handle_call_ended(agent_id, data)

    # Otherwise: agent.message (transcript turn).
    transcript = data.get("transcript", "")
    call_id = data.get("callId", "")

    if agent_id == "buyer":
        # Capture the caller's E.164 number for Supermemory recall lookup.
        caller = (
            data.get("from")
            or data.get("fromNumber")
            or data.get("from_number")
            or data.get("caller", "")
        )
        if caller and call_id and call_id not in state.buyer_caller_phone:
            state.buyer_caller_phone[call_id] = caller
        history = payload.get("recentHistory", [])
        return await _handle_buyer_turn(
            call_id,
            transcript,
            history if isinstance(history, list) else [],
        )
    else:
        history = payload.get("recentHistory", [])
        return await _handle_specialist_turn(
            agent_id,
            call_id,
            transcript,
            history if isinstance(history, list) else [],
        )


_QUESTION_RE = re.compile(r"[^.!?]*\?")
# Distinctive enough that ordinary acknowledgement never trips it, and it
# survives the model paraphrasing the rest of the closing.
_CLOSING_TELL = "tracking link"
_CLOSING = (
    "On it. You'll get an email with a live tracking link in a minute — "
    "there's a spot on that page to add your account numbers if you want "
    "those cancelled too. Hang up whenever."
)


_MONTH_NAMES = (
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
)
# "Austin, TX 78751" -> the city is the last part that is not a state+ZIP tail.
_STATE_ZIP_RE = re.compile(r"^[A-Z]{2}(\s+\d{5}(-\d{4})?)?$")


def _city_of(address: str) -> str | None:
    """The city a caller would recognise, or None rather than a wrong guess."""
    parts = [p.strip() for p in address.split(",")[1:] if p.strip()]
    for part in reversed(parts):
        if not _STATE_ZIP_RE.match(part):
            return part
    return None


def _route_ack(collected: dict[str, Any]) -> str:
    """Echo the route back, because hearing it repeated is what tells a caller
    they were understood. Anything we cannot say confidently we leave out — a
    wrong city read back is worse than a plain acknowledgement."""
    origin = _city_of(str(collected.get("origin_address", "")))
    dest = _city_of(str(collected.get("destination_address", "")))
    when = ""
    raw = str(collected.get("move_date", ""))
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", raw)
    if m:
        when = f", {_MONTH_NAMES[int(m.group(2)) - 1]} {int(m.group(3))}"
    if origin and dest:
        return f"{origin} to {dest}{when}. Got it."
    return "Got it."


def _deterministic_turn(transcript: str, ctx: BuyerCallContext) -> PavoReply | None:
    """A first turn the backstop can answer alone, or None to ask the model.

    Returns a PavoReply carrying no content: every field is already recoverable
    from the caller's own words, so _steer_reply supplies the closing and the
    model has nothing left to contribute. The turn costs nothing and answers
    immediately, which matters because this is the turn the caller is waiting
    on. Restricted to the first turn on purpose — the backstop fills gaps and
    never overrides, so a later correction ("no, make it the 22nd") must reach
    the model.
    """
    from .buyer_schema import blocking_fields
    from .transcript_extract import backstop_fields

    if ctx.turn_count != 1 or ctx.dispatched or ctx.collected:
        return None
    probe = dict(ctx.collected)
    probe.update(backstop_fields(transcript, probe))
    if blocking_fields(probe):
        return None
    return PavoReply(
        content=_route_ack(probe),
        tier="deterministic",
        cost_cents=0.0,
        latency_ms=0,
        decision_reason="every field recoverable from the caller's own words",
    )


def _steer_reply(voice_reply: str, ctx: BuyerCallContext) -> str:
    """Keep the model's acknowledgement; author the question ourselves.

    The model writes its reply before the deterministic backstop has merged
    this turn's fields, so left alone it asks for the email the caller just
    gave. Here the model keeps what it is good at — sounding human, echoing
    back what it heard — and the schema decides what is actually still
    missing. When nothing is missing the question is replaced outright by
    the closing line, so a caller who says everything in one breath is never
    interrogated for fields already in hand.
    """
    from .buyer_schema import next_question

    ack = _QUESTION_RE.sub("", voice_reply).strip()
    question = next_question(ctx.collected)
    if question is None:
        # Already-dispatched turns are ordinary conversation, not intake.
        if ctx.dispatched:
            return voice_reply
        # The prompt teaches the model this closing, so on a one-breath brief
        # it often says it unprompted. Appending ours then made the caller sit
        # through the whole thing twice. If it already closed, let it stand.
        if _CLOSING_TELL in ack.lower():
            return ack
        return f"{ack} {_CLOSING}".strip()
    if not ack:
        return question
    return f"{ack} {question}"


async def _run_buyer_turn(
    call_id: str, transcript: str, history: list[dict],
) -> dict[str, Any]:
    """One concierge turn: route it, extract fields, dispatch when ready.

    Channel-agnostic on purpose. AgentPhone drives this over a webhook and the
    browser mic drives it over /api/public/concierge/turn — same prompt, same
    extraction, same dispatch rules, so the product does not depend on a phone
    number existing.
    """
    from .integrations.supermemory import recall_user_profile

    ctx = state.buyer_contexts.get(call_id)
    is_first_turn = ctx is None
    if ctx is None:
        event_id = state.new_event_id()
        state.events[event_id] = MarketplaceEvent(id=event_id, homeowner_call_id=call_id, spec={})
        ctx = BuyerCallContext(call_id=call_id, event_id=event_id)
        state.buyer_contexts[call_id] = ctx
        state.save_event(state.events[event_id])
        state.save_context(ctx)
        await ws_broker.broadcast({
            "type": "agent_state", "event_id": event_id, "agent_id": "buyer",
            "state": "in-progress", "ts": ctx.started_at,
        })

    ctx.turn_count += 1

    await ws_broker.broadcast({
        "type": "transcript_turn", "event_id": ctx.event_id, "agent_id": "buyer",
        "turn": ctx.turn_count, "role": "user", "text": transcript, "ts": time.time(),
    })

    # First-turn: pull Supermemory recall context (prior move history) and surface it to the buyer.
    # This is the live "we remember your last move" demo moment.
    recall_context = ""
    if is_first_turn:
        try:
            caller_phone = state.buyer_caller_phone.get(call_id) or settings.demo_homeowner_number
            recall = await recall_user_profile(ctx.event_id, caller_phone)
            if recall:
                snippets = []
                results = recall.get("results") if isinstance(recall, dict) else None
                if isinstance(results, list):
                    for r in results[:2]:
                        if isinstance(r, dict):
                            chunks = r.get("chunks") or []
                            for c in chunks[:1]:
                                content = c.get("content") if isinstance(c, dict) else None
                                if content:
                                    snippets.append(content[:240])
                if snippets:
                    recall_context = "\n\nKNOWN HISTORY FOR THIS CALLER (from Supermemory — use to personalize):\n" + "\n".join(f"- {s}" for s in snippets)
        except Exception as e:
            log.warning("supermemory recall failed: %s", e)

    system_prompt = buyer_system_prompt() + recall_context
    messages = [{"role": "system", "content": system_prompt}]
    for h in history[-6:]:
        messages.append({
            "role": "user" if h.get("direction") == "inbound" else "assistant",
            "content": h.get("content", ""),
        })
    messages.append({"role": "user", "content": transcript})

    # A complete brief in one breath needs no model at all. The deterministic
    # backstop already holds every field, so next_question() returns None and
    # the spoken reply is fully determined before the model is asked anything.
    # Calling a 2B model with a 15KB prompt to produce a line we already know
    # cost ~13 seconds of silence at the exact moment the caller is waiting to
    # hear that it worked. First turn only: a later turn may be a correction,
    # and the backstop fills gaps rather than overriding, so only the model
    # understands those.
    reply = _deterministic_turn(transcript, ctx)
    if reply is None:
        try:
            reply = await pavo_chat(
                messages,
                role_hint="buyer-extract" if not ctx.dispatched else "buyer",
                max_tokens=300,
            )
        except PavoUnavailableError as e:
            # Every completion provider is down. Say so: this turn was NOT
            # recorded, and the buyer agent we announced as in-progress above
            # has to reach a terminal state instead of sitting there looking
            # alive.
            log.warning("concierge turn abandoned, no completion provider: %s", e)
            await ws_broker.broadcast({
                "type": "agent_state", "event_id": ctx.event_id, "agent_id": "buyer",
                "state": "failed", "terminal_outcome": "failed", "ts": time.time(),
            })
            raise HTTPException(
                503, "the concierge is unavailable — this turn was not recorded"
            ) from e

    # Cost ticker update.
    event = state.events[ctx.event_id]
    event.pavo_cents_total += reply.cost_cents
    routing_decision = {
        "type": "routing_decision", "event_id": ctx.event_id, "agent_id": "buyer",
        "turn": ctx.turn_count, "tier": reply.tier, "reason": reply.decision_reason,
        "complexity": 0.0, "ts": time.time(),
    }
    event.routing_decisions.append(routing_decision)
    await ws_broker.broadcast(routing_decision)
    await ws_broker.broadcast({
        "type": "cost_update", "event_id": ctx.event_id,
        "pavo_cents": event.pavo_cents_total, "baseline_cents": event.baseline_cents_total,
        "ts": time.time(),
    })
    # ── v2: incremental field collection ────────────────────────────────
    # Every turn the buyer may emit a JSON block with any subset of the
    # full schema. We merge into ctx.collected, broadcast which fields
    # arrived this turn, and dispatch the moment all CORE fields are in.
    new_fields = _extract_and_merge_fields(reply.content, ctx, transcript)
    # Deterministic backstop: the 2B model drops fields stochastically, so
    # high-structure CORE values are also recovered verbatim from the
    # caller's own utterance — gaps only, the model's extraction wins.
    new_fields.update(_merge_backstop_fields(transcript, ctx))
    voice_reply = _steer_reply(_strip_machine_json(reply.content), ctx)
    await ws_broker.broadcast({
        "type": "transcript_turn", "event_id": ctx.event_id, "agent_id": "buyer",
        "turn": ctx.turn_count, "role": "agent", "text": voice_reply,
        "pavo_tier": reply.tier, "ts": time.time(),
    })
    if new_fields:
        state.save_context(ctx)
        event_for_fields = state.events.get(ctx.event_id)
        if event_for_fields is not None:
            state.save_event(event_for_fields)
        await ws_broker.broadcast({
            "type": "fields_collected",
            "event_id": ctx.event_id,
            "turn": ctx.turn_count,
            "fields": list(new_fields.keys()),
            "values": _safe_field_display(new_fields),
            "ts": time.time(),
        })

    if not ctx.dispatched:
        from .buyer_schema import fields_by_tier, is_dispatch_ready
        conditionals_ready = all(
            f.name in ctx.collected for f in fields_by_tier("conditional")
        )
        # Mid-call we wait for the household questions so conditional
        # specialists aren't skipped prematurely; _finalize_buyer_call
        # dispatches with whatever is confirmed once the call has ended.
        if is_dispatch_ready(ctx.collected) and conditionals_ready:
            _dispatch_fan_out(ctx)

    elif new_fields:
        # Late/corrected fields have already been merged into event.spec. Resume
        # only specialists whose complete prerequisites are now present.
        asyncio.create_task(resume_ready_specialists(ctx.event_id))

    if ctx.call_ended:
        # This turn was still in flight when agent.call_ended was processed;
        # its fields have merged now, so re-run the end-of-call logic.
        _finalize_buyer_call(ctx)

    # Spoken text only — the machine-readable JSON block must never reach TTS.
    return {
        "text": voice_reply,
        "event_id": ctx.event_id,
        "collected": sorted(ctx.collected),
        "dispatched": ctx.dispatched,
        "turn": ctx.turn_count,
    }


async def _handle_buyer_turn(
    call_id: str, transcript: str, history: list[dict],
) -> StreamingResponse:
    """AgentPhone's view of a concierge turn: NDJSON with the spoken text."""
    result = await _run_buyer_turn(call_id, transcript, history)

    async def generate():
        yield json.dumps({"text": result["text"]}) + "\n"

    return StreamingResponse(generate(), media_type="application/x-ndjson")


def _dispatch_fan_out(ctx: BuyerCallContext) -> None:
    """Build the spec from collected fields and fire the specialist fan-out."""
    spec = dict(ctx.collected)
    dispatch_phone = state.buyer_caller_phone.get(ctx.call_id)
    if dispatch_phone:
        spec.setdefault("user_phone", dispatch_phone)
    ctx.parsed_spec = spec
    ctx.dispatched = True
    event = state.events.get(ctx.event_id)
    if event is not None:
        event.spec = spec
        state.save_event(event)
    state.save_context(ctx)
    asyncio.create_task(fan_out(ctx.event_id, spec))
    log.info("buyer dispatched: event=%s fields=%d", ctx.event_id, len(spec))


def _finalize_buyer_call(ctx: BuyerCallContext) -> None:
    """End-of-call dispatch and follow-up. Safe to run repeatedly.

    Called when agent.call_ended arrives AND again after any late in-flight
    buyer turn merges its fields: AgentPhone posts call_ended the moment the
    caller hangs up, while the final agent.message turn is often still awaiting
    its completion — so the first run may see an incomplete spec. Unanswered
    pets/children/visa questions skip their conditional specialists; an
    unanswered car question keeps the car agents, which land as honest
    needs-user-action handoffs.
    """
    if not ctx.dispatched:
        from .buyer_schema import fields_by_tier, is_dispatch_ready
        if is_dispatch_ready(ctx.collected):
            _dispatch_fan_out(ctx)
            log.info(
                "buyer dispatched at call end with unanswered household "
                "questions: event=%s", ctx.event_id,
            )
        else:
            # A silent no-op here would hide a real product failure: the call
            # ended, extraction fell short, and there is no channel to reach
            # the caller. Surface it loudly for the operator.
            missing = [
                f.name for f in fields_by_tier("core") if not ctx.collected.get(f.name)
            ]
            log.warning(
                "call ended NOT dispatchable: event=%s missing_core=%s "
                "collected=%s — nothing dispatched, caller has no tracker",
                ctx.event_id, missing, sorted(ctx.collected),
            )
    if ctx.dispatched and not ctx.followup_sent and not ctx.followup_in_progress:
        ctx.followup_in_progress = True
        asyncio.create_task(_send_buyer_followup(ctx))


async def _send_buyer_followup(ctx: BuyerCallContext) -> bool:
    """Post-call: email the caller a structured form for the PII-gated fields
    the buyer correctly didn't ask for over voice. Each missing field corresponds
    to a specialist that's currently BLOCKED awaiting that detail."""
    try:
        from .buyer_schema import pending_pii_fields, fields_blocking
        from .integrations.agentmail import send_buyer_followup_form
        from .marketplace import REQUIRED_FIELDS, pick_specialists
        spec = ctx.parsed_spec or ctx.collected
        to_email = spec.get("user_email") or settings.demo_email_recipient
        # Recompute the selection from the spec rather than reading
        # event.specialist_calls: fan_out may still be mid-announce when this
        # task runs, and a partial snapshot would under-report missing fields.
        selected_ids = {p.agent_id for p in pick_specialists(spec)}
        missing = [
            field for field in pending_pii_fields(ctx.collected)
            if selected_ids.intersection(field.agent_ids)
        ]
        # Per-specialist breakdown: which selected agents are blocked on what.
        per_agent: list[dict[str, Any]] = []
        for agent_id in sorted(REQUIRED_FIELDS):
            if agent_id not in selected_ids:
                continue
            blocked = fields_blocking(agent_id, ctx.collected)
            if blocked:
                per_agent.append({"agent_id": agent_id, "missing_fields": blocked})
        await send_buyer_followup_form(
            event_id=ctx.event_id,
            to_email=to_email,
            user_name=spec.get("user_name", ""),
            missing_fields=missing,
            blocked_agents=per_agent,
        )
        log.info("buyer followup sent: event=%s to=%s missing=%d",
                 ctx.event_id, to_email, len(missing))
        ctx.followup_sent = True
        return True
    except Exception as e:
        log.exception("buyer followup email failed: %s", e)
        return False
    finally:
        ctx.followup_in_progress = False
        state.save_context(ctx)


def _merge_backstop_fields(transcript: str, ctx) -> dict:
    """Validate + merge transcript-backstop CORE fields (see transcript_extract)."""
    from .buyer_schema import by_name
    from .transcript_extract import backstop_fields

    merged: dict = {}
    for k, v in backstop_fields(transcript, ctx.collected).items():
        field = by_name(k)
        if field is None:
            continue
        # Household flags arrive as booleans; everything else is a string the
        # caller actually said, and still has to validate.
        if not isinstance(v, bool) and not field.validate(v):
            continue
        ctx.collected[k] = v
        merged[k] = v
        ctx.collection_history.append({
            "turn": ctx.turn_count,
            "field": k,
            "value": v,
            "previous": None,
            "source": "transcript_backstop",
            "ts": time.time(),
        })
    if merged:
        log.info(
            "transcript backstop recovered fields the model missed: %s",
            sorted(merged),
        )
    return merged


def _extract_and_merge_fields(text: str, ctx, transcript: str) -> dict:
    """Validate and merge changed voice-safe fields, including corrections.

    ``transcript`` is the caller's own utterance for this turn — the evidence
    the model's emission is checked against.

    Guard against example regurgitation: small models sometimes copy the
    prompt's DISPATCH JSON SHAPE example wholesale, "collecting" values the
    caller never said. A block whose string values match three or more schema
    examples is treated as a copied example and those values are dropped; a
    genuine caller coincidentally matching one example (a bank named Chase, a
    dog) still merges normally.
    """
    from .buyer_schema import by_name
    from .transcript_extract import extract_household, mentions_a_time
    changed: dict = {}
    # Match every {...} block in the reply (buyer may emit one or several).
    for raw in re.findall(r"\{[^{}]+\}", text, re.DOTALL):
        try:
            block = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if not isinstance(block, dict):
            continue
        validated: list[tuple[str, Any, Any]] = []
        for k, v in block.items():
            field = by_name(k)
            if field is None or not field.voice_safe:
                continue
            if isinstance(v, (dict, list)):
                continue
            try:
                if field.tier == "conditional":
                    if not field.validate(v):
                        continue
                    if isinstance(v, str):
                        v = v.strip().lower() in ("true", "yes", "1")
                elif field.name == "household_size" and isinstance(v, int):
                    if v <= 0:
                        continue
                elif not isinstance(v, str) or not field.validate(v):
                    continue
            except (AttributeError, TypeError, ValueError):
                continue
            validated.append((k, v, field))

        example_matches = {
            k for k, v, field in validated
            if field.tier != "conditional"
            # str(): household_size arrives as an int and slipped a string-only
            # comparison, so the example's "2" merged as a stated fact.
            and str(v).strip().lower() == str(field.example).strip().lower()
        }
        # CORE values (route, date, email) are high-entropy: one exact match
        # against the prompt's example is regurgitation with near-certainty,
        # and merging it dispatches real emails with wrong facts (observed
        # live: the example date shipped in a mover quote). Low-entropy fields
        # keep the >=3 coincidence threshold.
        core_examples = {
            k for k, v, field in validated
            if k in example_matches and field.tier == "core"
        }
        if len(example_matches) >= 3 or core_examples:
            dropped = example_matches if len(example_matches) >= 3 else core_examples
            log.warning(
                "dropping %d example-regurgitated fields from buyer emission: %s",
                len(dropped), sorted(dropped),
            )
            validated = [item for item in validated if item[0] not in dropped]

        # Corroboration, not value-matching, is what separates a heard fact
        # from an invented one. The prompt's household example (pets yes, kids
        # no, car yes) is also the modal American household, so comparing
        # against the example would drop the commonest truthful answer — while
        # an unguarded boolean silently answers a question the concierge then
        # never asks, and dispatches (or cancels) a real specialist on it.
        said_about = extract_household(transcript)
        uncorroborated = {
            k for k, _v, field in validated
            if (field.tier == "conditional" and k not in said_about)
            or (k == "move_date" and not mentions_a_time(transcript))
        }
        if uncorroborated:
            log.warning(
                "dropping %d fields the caller did not mention this turn: %s",
                len(uncorroborated), sorted(uncorroborated),
            )
            validated = [item for item in validated if item[0] not in uncorroborated]

        for k, v, _field in validated:
            previous = ctx.collected.get(k)
            if k in ctx.collected and previous == v:
                continue
            ctx.collected[k] = v
            changed[k] = v
            ctx.collection_history.append({
                "turn": ctx.turn_count,
                "field": k,
                "value": v,
                "previous": previous,
                "ts": time.time(),
            })
    event = state.events.get(ctx.event_id)
    if event is not None and changed:
        event.spec.update(changed)
        if ctx.parsed_spec is not None:
            ctx.parsed_spec.update(changed)
    return changed


# Anything that is written-only. Speech synthesis either reads these aloud
# literally ("grinning face", "backtick backtick") or garbles them, and the
# browser concierge speaks every reply.
_EMOJI_RE = re.compile(
    "[" "\U0001F300-\U0001FAFF" "\U00002600-\U000027BF"
    "\U0001F1E6-\U0001F1FF" "\U0000FE00-\U0000FE0F" "\U00002190-\U000021FF"
    "\U00002B00-\U00002BFF" "]+"
)


def _strip_machine_json(text: str) -> str:
    """Reduce a model reply to what is safe to speak aloud.

    Removes the machine JSON block, any code fence the model wrapped it in,
    and emoji — all of which are meant for the orchestrator or the eye, never
    for text-to-speech.
    """
    spoken = re.sub(r"```[\s\S]*?```", "", text)      # closed fences
    spoken = re.sub(r"```\w*", "", spoken)             # an unterminated one
    spoken = re.sub(r"\{[^{}]+\}", "", spoken, flags=re.DOTALL)
    spoken = _EMOJI_RE.sub("", spoken)
    spoken = re.sub(r"[ \t]{2,}", " ", spoken)
    spoken = re.sub(r"\n{3,}", "\n\n", spoken).strip()
    return spoken or "Got it."


def _safe_field_display(fields: dict[str, Any]) -> dict[str, Any]:
    """Expose collection progress while withholding every field value.

    Even booleans can reveal sensitive household or immigration information,
    so the event bus receives presence markers only.
    """
    return {key: "[collected]" for key in fields}


async def _handle_specialist_turn(agent_id: str, call_id: str, transcript: str, history: list[dict]) -> StreamingResponse:
    persona = by_id(agent_id)
    # Find the event this specialist belongs to.
    event_id = None
    for eid, ev in state.events.items():
        if agent_id in ev.specialist_calls and ev.specialist_calls[agent_id].call_id == call_id:
            event_id = eid
            break

    if event_id is None:
        log.warning("specialist webhook with no matching event: agent=%s call=%s", agent_id, call_id)
        return StreamingResponse(
            iter([json.dumps({"text": "Sorry, I think there's a routing error. Goodbye."}) + "\n"]),
            media_type="application/x-ndjson",
        )

    event = state.events[event_id]
    ctx = event.specialist_calls[agent_id]
    ctx.turn_count += 1
    ctx.transcript.append({"role": "counterparty", "text": transcript, "ts": time.time()})

    await ws_broker.broadcast({
        "type": "transcript_turn", "event_id": event_id, "agent_id": agent_id,
        "turn": ctx.turn_count, "role": "counterparty", "text": transcript, "ts": time.time(),
    })

    messages = [{"role": "system", "content": persona.system_prompt}]
    for h in history[-6:]:
        messages.append({
            "role": "user" if h.get("direction") == "inbound" else "assistant",
            "content": h.get("content", ""),
        })
    messages.append({"role": "user", "content": transcript})

    reply = await pavo_chat(messages, role_hint=persona.role_hint, max_tokens=220)

    event.pavo_cents_total += reply.cost_cents
    ctx.transcript.append({"role": "agent", "text": reply.content, "pavo_tier": reply.tier, "ts": time.time()})

    routing_decision = {
        "type": "routing_decision", "event_id": event_id, "agent_id": agent_id,
        "turn": ctx.turn_count, "tier": reply.tier, "reason": reply.decision_reason,
        "complexity": 0.0, "ts": time.time(),
    }
    event.routing_decisions.append(routing_decision)
    await ws_broker.broadcast(routing_decision)
    await ws_broker.broadcast({
        "type": "cost_update", "event_id": event_id,
        "pavo_cents": event.pavo_cents_total, "baseline_cents": event.baseline_cents_total,
        "ts": time.time(),
    })
    await ws_broker.broadcast({
        "type": "transcript_turn", "event_id": event_id, "agent_id": agent_id,
        "turn": ctx.turn_count, "role": "agent", "text": reply.content,
        "pavo_tier": reply.tier, "ts": time.time(),
    })

    return StreamingResponse(
        iter([json.dumps({"text": reply.content}) + "\n"]),
        media_type="application/x-ndjson",
    )


async def _handle_call_ended(agent_id: str, data: dict[str, Any]) -> JSONResponse:
    call_id = data.get("callId", "")
    if agent_id == "buyer":
        # Mark the marketplace event homeowner-side done; specialists continue independently.
        ctx = state.buyer_contexts.get(call_id)
        if ctx:
            ctx.call_ended = True
            state.save_context(ctx)
            await ws_broker.broadcast({
                "type": "agent_state", "event_id": ctx.event_id, "agent_id": "buyer",
                "state": "closed", "ts": time.time(),
            })
            # The in-call path holds dispatch until the household questions are
            # answered; once the call ends, dispatch whatever CORE-complete
            # spec exists and send the follow-up email. A buyer turn that was
            # still awaiting its completion when the caller hung up re-runs
            # this after its fields merge (see _handle_buyer_turn), so a
            # core-complete call can never silently produce nothing.
            _finalize_buyer_call(ctx)
        return JSONResponse({"ok": True})

    # Specialist call ended.
    event_id = None
    for eid, ev in state.events.items():
        if agent_id in ev.specialist_calls and ev.specialist_calls[agent_id].call_id == call_id:
            event_id = eid
            break
    if event_id:
        event = state.events[event_id]
        specialist_ctx = event.specialist_calls[agent_id]
        if specialist_ctx.bid:
            specialist_ctx.state = "submitted"
            specialist_ctx.terminal_outcome = "submitted"
        else:
            specialist_ctx.state = "needs-user-action"
            specialist_ctx.terminal_outcome = "needs_user_action"
            specialist_ctx.blocker_kind = "call_ended_without_artifact"
            specialist_ctx.blockers = ["provider call ended without a verifiable artifact"]
        specialist_ctx.closed_at = time.time()
        state.save_event(event)
        await ws_broker.broadcast({
            "type": "agent_state", "event_id": event_id, "agent_id": agent_id,
            "state": specialist_ctx.state, "ts": time.time(),
        })
        await finalize_event(event_id)

    return JSONResponse({"ok": True})


@app.websocket("/ws/dashboard")
async def ws_dashboard(ws: WebSocket) -> None:
    """Authenticated dashboard stream.

    Browser clients cannot set an Authorization header on WebSockets, so the
    token may instead ride in the Sec-WebSocket-Protocol offer as
    ``bearer.<token>`` alongside the ``relocate-dashboard`` protocol name.
    Query-string tokens are deliberately not accepted — they leak into access
    logs and browser history.
    """
    expected = settings.dashboard_api_token
    offered: list[str] = ws.scope.get("subprotocols") or []
    subprotocol_token = next(
        (p[len("bearer."):] for p in offered if p.startswith("bearer.")), "",
    )
    supplied = _bearer_token(ws.headers.get("authorization")) or subprotocol_token
    if not expected or not supplied or not hmac.compare_digest(supplied, expected):
        await ws.close(code=1008, reason="dashboard authentication required")
        return
    # Echo the protocol name (never the token) so browser handshakes succeed.
    selected = "relocate-dashboard" if "relocate-dashboard" in offered else None
    await ws_broker.subscribe(ws, subprotocol=selected)
    await _send_bootstrap(ws)
    try:
        while True:
            # Server-push only; we just keep the connection alive.
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await ws_broker.unsubscribe(ws)


def _bootstrap_messages() -> list[dict[str, Any]]:
    """Current-state replay for a fresh WS subscriber.

    Without this, a viewer who connects after dispatch (or after a restart)
    stares at a blank swarm until the next live event. Shapes are identical
    to live agent_state / event_finalized broadcasts, so both the dashboard
    and the redacted public page consume them unchanged.
    """
    if not state.events:
        return []
    event = max(state.events.values(), key=lambda e: e.started_at)
    msgs: list[dict[str, Any]] = [
        {
            "type": "agent_state", "event_id": event.id, "agent_id": agent_id,
            "state": ctx.state, "terminal_outcome": ctx.terminal_outcome,
            "demo_routing": bool(settings.agentmail_demo_recipient_override.strip()),
            "ts": ctx.closed_at or ctx.started_at,
            "bootstrap": True,
        }
        for agent_id, ctx in event.specialist_calls.items()
    ]
    return msgs


async def _send_bootstrap(ws: WebSocket, *, public: bool = False) -> None:
    try:
        for msg in _bootstrap_messages():
            if public:
                # Same projector as every live public payload — the direct
                # send must never become an unredacted side door if the
                # bootstrap set ever grows beyond agent_state.
                projected = redact_public_event(msg)
                if projected is None:
                    continue
                msg = projected
            await asyncio.wait_for(ws.send_text(json.dumps(msg)), timeout=2.0)
    except Exception:  # noqa: BLE001 - a failed bootstrap is just a blank stage
        pass


def _bearer_token(value: str | None) -> str:
    if not value:
        return ""
    scheme, _, token = value.partition(" ")
    return token.strip() if scheme.lower() == "bearer" else ""


@app.websocket("/ws/public")
async def ws_public(ws: WebSocket) -> None:
    """Unauthenticated, redacted live feed for the public website.

    Carries state/routing/cost events with every free-text and identifier
    field blanked server-side (see public_feed.py). Read-only; capped.
    """
    if public_broker.at_capacity:
        await ws.close(code=1013, reason="public feed at capacity")
        return
    await public_broker.subscribe(ws)
    await _send_bootstrap(ws, public=True)
    try:
        while True:
            await ws.receive_text()  # clients never send; this just detects close
    except WebSocketDisconnect:
        pass
    finally:
        await public_broker.unsubscribe(ws)


# ── Public web intake ──────────────────────────────────────────────────
# A browser visitor starts a real move without calling. Gated by
# ENABLE_PUBLIC_INTAKE, honeypot-checked, and rate-limited per client IP and
# globally. Outbound side effects remain governed by the usual allowlists.
_INTAKE_PER_IP_MIN = 12
_INTAKE_PER_IP_HOUR = 40
_INTAKE_GLOBAL_HOUR = 200
_intake_hits: dict[str, list[float]] = {}
_INTAKE_DEDUPE_S = 600
_recent_intakes: dict[str, tuple[str, float]] = {}  # dedupe_key -> (event_id, ts)
_intake_global: list[float] = []


def _client_ip(request: Request) -> str:
    """Caller address for rate limits and intake dedupe.

    ``X-Forwarded-For`` is caller-controlled unless a trusted proxy sets it,
    so honoring it is a deployment decision (TRUST_PROXY_HEADERS), not a
    default assumption.
    """
    if settings.trust_proxy_headers:
        # Cloudflare overwrites this on every request, so a caller cannot
        # forge it through the edge.
        connecting = request.headers.get("cf-connecting-ip", "").strip()
        if connecting:
            return connecting[:64]
        forwarded = request.headers.get("x-forwarded-for", "")
        if forwarded:
            # The RIGHTMOST entry is the one our own trusted proxy appended;
            # everything left of it is whatever the caller sent. Reading the
            # leftmost let one client mint a fresh rate-limit bucket per
            # request simply by changing a header.
            return forwarded.split(",")[-1].strip()[:64]
    return (request.client.host if request.client else "unknown")[:64]


def _intake_rate_limited(ip: str, now: float) -> bool:
    minute, hour = now - 60, now - 3600
    global _intake_global
    _intake_global = [t for t in _intake_global if t > hour]
    if len(_intake_global) >= _INTAKE_GLOBAL_HOUR:
        return True
    _sweep_hits(_intake_hits, hour)
    hits = [t for t in _intake_hits.get(ip, []) if t > hour]
    if len(hits) >= _INTAKE_PER_IP_HOUR or sum(1 for t in hits if t > minute) >= _INTAKE_PER_IP_MIN:
        _intake_hits[ip] = hits
        return True
    hits.append(now)
    _intake_hits[ip] = hits
    _intake_global.append(now)
    return False


@app.post("/api/public/start-move")
async def api_public_start_move(request: Request, payload: dict[str, Any]) -> dict[str, Any]:
    if not settings.enable_public_intake:
        raise HTTPException(503, "public intake is not enabled on this deployment")
    if str(payload.get("website", "")).strip():
        raise HTTPException(400, "rejected")  # honeypot
    ip = _client_ip(request)
    if _intake_rate_limited(ip, time.time()):
        raise HTTPException(429, "too many requests — try again in a minute")

    from .buyer_schema import by_name
    spec: dict[str, Any] = {}
    for name in ("origin_address", "destination_address", "move_date", "user_email"):
        field = by_name(name)
        value = str(payload.get(name, "")).strip()[:200]
        if field is None or not value or not field.validate(value):
            raise HTTPException(400, f"{name} is missing or invalid")
        spec[name] = value
    for flag in ("has_pets", "has_children", "has_car", "has_visa"):
        spec[flag] = bool(payload.get(flag, False))

    # One authorization, given once, is what lets the email-rail specialists
    # act without handing every task back. It is recorded only when the
    # customer explicitly grants it, and it is never inferred.
    if payload.get("authorize_providers") is True:
        spec["service_authorization_signed"] = True

    # Optional household details. Supplying them unblocks the specialists that
    # need them (school enrollment, vet records) exactly as the voice concierge
    # does when the caller volunteers the same facts. Anything invalid is
    # dropped rather than rejected — the move still dispatches.
    for name in (
        "user_name", "user_phone", "work_address", "household_size", "child_name", "child_grade",
        "pge_account_number", "comcast_account_number", "equinox_member_id",
        "pet_name", "pet_species", "vet_email", "bank_name",
    ):
        raw = payload.get(name)
        if raw is None:
            continue
        value = str(raw).strip()[:120]
        if not value:
            continue
        field = by_name(name)
        if field is None or not field.validate(value):
            continue
        spec[name] = value

    # Same route+date+email from anyone within the window = the same move; a
    # client retry after a network error returns the original tracker instead
    # of dispatching (and emailing) everything twice.
    # Keyed on the CLIENT too: a content-only key would hand this move's
    # tracker id (a capability) to anyone else who could guess the same four
    # values. A genuine client retry comes from the same address and still
    # dedupes.
    dedupe_key = "|".join(
        [ip] + [
            spec[k].lower()
            for k in ("origin_address", "destination_address", "move_date", "user_email")
        ]
    )
    now = time.time()
    for cached_key, (cached_id, cached_at) in list(_recent_intakes.items()):
        if cached_at < now - _INTAKE_DEDUPE_S:
            _recent_intakes.pop(cached_key, None)
    cached = _recent_intakes.get(dedupe_key)
    if cached is not None:
        log.info("public intake deduped: event=%s ip=%s", cached[0], ip)
        return {"event_id": cached[0], "dispatched": True, "deduplicated": True}

    event_id = state.new_event_id()
    _recent_intakes[dedupe_key] = (event_id, now)
    call_id = f"web_{event_id[4:]}"
    # A move started from the gated product page belongs to that workspace;
    # everything else stays out of its list.
    channel = "demo" if valid_token(str(payload.get("demo_token") or "")) else "web"
    state.events[event_id] = MarketplaceEvent(
        id=event_id, homeowner_call_id=call_id, spec=spec, origin_channel=channel,
    )
    ctx = BuyerCallContext(
        call_id=call_id, event_id=event_id, collected=dict(spec), parsed_spec=spec,
        dispatched=True, call_ended=True, followup_sent=True,  # web intake has no voice follow-up
    )
    state.buyer_contexts[call_id] = ctx
    state.save_event(state.events[event_id])
    state.save_context(ctx)
    await ws_broker.broadcast({
        "type": "agent_state", "event_id": event_id, "agent_id": "buyer",
        "state": "closed", "ts": time.time(),
    })
    await ws_broker.broadcast({
        "type": "fields_collected", "event_id": event_id, "turn": 1,
        "fields": list(spec.keys()), "values": _safe_field_display(spec), "ts": time.time(),
    })
    asyncio.create_task(fan_out(event_id, spec))
    asyncio.create_task(_email_tracker_link(event_id, spec))
    log.info("public intake dispatched: event=%s ip=%s", event_id, ip)
    return {"event_id": event_id, "dispatched": True}


async def _email_tracker_link(event_id: str, spec: dict[str, Any]) -> None:
    """Best-effort tracker-link email to the mover after a web dispatch.

    Allowlist/override policy applies unchanged; a blocked or failed send is
    logged, never fabricated, and never fails the intake response.
    """
    user_email = str(spec.get("user_email") or "").strip()
    if not user_email or not settings.agentmail_api_key:
        return
    try:
        from .integrations.agentmail import send_tracker_link
        await send_tracker_link(event_id=event_id, user_email=user_email, spec=spec)
        log.info("tracker link emailed: event=%s", event_id)
    except Exception as exc:
        log.warning("tracker link email not sent (event=%s): %s", event_id, exc)


_SNAPSHOT_PER_IP_MIN = 120
# Both hit maps key on client identity, so an adversary (or a busy CDN) can
# mint entries without bound. Sweep expired keys once the map gets large.
_HITS_MAP_SOFT_CAP = 4096


def _sweep_hits(hits: dict[str, list[float]], older_than: float) -> None:
    if len(hits) < _HITS_MAP_SOFT_CAP:
        return
    for key in [k for k, v in hits.items() if not v or max(v) <= older_than]:
        hits.pop(key, None)
_snapshot_hits: dict[str, list[float]] = {}


@app.get("/api/public/move/{event_id}")
async def api_public_move_snapshot(event_id: str, request: Request) -> dict[str, Any]:
    """Redacted snapshot of one move for its shareable /move page.

    Exposes the route and per-task honest states only — never emails, phone
    numbers, transcripts, provider artifacts, or raw blocker strings. Event
    ids are unguessable; the page is a tracking link, like a parcel page.
    """
    if not settings.enable_public_intake:
        raise HTTPException(503, "public move pages are not enabled on this deployment")
    ip = _client_ip(request)
    now = time.time()
    _sweep_hits(_snapshot_hits, now - 60)
    hits = [t for t in _snapshot_hits.get(ip, []) if t > now - 60]
    if len(hits) >= _SNAPSHOT_PER_IP_MIN:
        raise HTTPException(429, "too many requests")
    hits.append(now)
    _snapshot_hits[ip] = hits

    event = state.events.get(event_id)
    if event is None:
        raise HTTPException(404, "unknown move")
    # Demo routing rewrites every outbound recipient to the operator's own
    # inbox (see config.agentmail_demo_recipient_override), so on such a
    # deployment NO provider was contacted, however many messages went out.
    # The tracker cannot infer that — it is told.
    demo_routing = bool(settings.agentmail_demo_recipient_override.strip())

    def _portal_url(ctx) -> str | None:  # noqa: ANN001
        """Public portal page for a task the customer has to finish."""
        if ctx.state != "needs-user-action":
            return None
        try:
            persona = by_id(ctx.agent_id)
        except Exception:  # noqa: BLE001 - unknown agent ids simply have no door
            return None
        url = getattr(persona, "counterparty_url", None)
        return url if isinstance(url, str) and url.startswith("https://") else None

    def _did(ctx) -> str | None:  # noqa: ANN001
        """What this specialist actually did, in the user's terms.

        Deliberately blunt: a specialist that contacted nobody must not read
        like one that did.
        """
        bid = ctx.bid if isinstance(ctx.bid, dict) else {}
        if ctx.state == "needs-user-action":
            return None
        if bid.get("kind") == "prepared_section":
            return "Prepared for you"
        intended = bid.get("intended")
        if isinstance(intended, int) and intended > 0:
            # `intended` is how many counterparties the request was ADDRESSED
            # to; `count` is how many messages actually left. Reporting intent
            # as delivery credited providers nobody reached — a partially
            # failed fan-out read exactly like a complete one.
            sent = bid.get("count")
            sent = sent if isinstance(sent, int) and sent > 0 else 0
            if demo_routing:
                return (
                    f"Prepared for {intended} provider"
                    + ("s" if intended > 1 else "")
                    + " — demo routing, no provider was contacted"
                )
            if ctx.agent_id in _SELF_DELIVERED_AGENTS:
                return "Sent to your inbox" if sent else None
            if not sent:
                return None
            if sent < intended:
                return f"Requested from {sent} of {intended} providers"
            return f"Requested from {sent} provider" + ("s" if sent > 1 else "")
        if bid.get("letter_id") or bid.get("tracking_number"):
            return "Certified letter created"
        return None

    specialists = [
        {
            "agent_id": agent_id,
            "did": _did(ctx),
            "state": ctx.state,
            "terminal_outcome": ctx.terminal_outcome,
            "blocker_kind": ctx.blocker_kind,
            "closed_at": ctx.closed_at,
            # The exact page to finish this task on. A blocked specialist that
            # only says "needs you" is a dead end; the door is public
            # information, so hand it over.
            "action_url": _portal_url(ctx),
            # Field NAMES only — never values. Lets the tracker ask for
            # exactly what a blocked specialist is waiting on instead of
            # guessing, which left tasks blocked on a name nobody asked for.
            "missing_fields": (
                [str(f) for f in ctx.bid.get("missing_fields", [])]
                if ctx.blocker_kind == "missing_fields" and isinstance(ctx.bid, dict)
                else []
            ),
            # Static per-agent title only — playbook BODIES carry the user's
            # own details and travel by email, never through this endpoint.
            "playbook_title": (ctx.playbook or {}).get("title"),
            # Only true once the digest actually reached the address the
            # customer gave — the tracker must not claim an inbox delivery
            # that never happened. Demo routing overrides the stored flag
            # outright: every recipient was rewritten to the operator's inbox,
            # so no digest can have reached the reader, and moves dispatched
            # before that flag existed still carry playbook_digest_sent=True.
            "playbook_delivered": bool(
                ctx.playbook and event.playbook_digest_sent and not demo_routing
            ),
            # Why it is not delivered, when it is not: "rerouted" is a send
            # that succeeded to someone else (demo routing), which is neither
            # a delivery nor a pending one.
            "playbook_delivery": (
                None if not ctx.playbook
                else "rerouted" if (
                    demo_routing
                    or (event.playbook_digest_rerouted and not event.playbook_digest_sent)
                )
                else "delivered" if event.playbook_digest_sent
                else "pending"
            ),
        }
        for agent_id, ctx in event.specialist_calls.items()
    ]
    override_address = settings.agentmail_demo_recipient_override.strip().lower()
    replies = [
        {
            "from_domain": str(r.get("from_domain") or ""),
            "received_at": r.get("received_at"),
            "agent_id": r.get("agent_id"),
            # A reply that came from the demo-routing inbox is this deployment
            # answering itself. Badging it "LOWEST" beside a real quote would
            # dress operator-written text up as a market.
            "self_routed": bool(
                override_address
                and str(r.get("from") or "").strip().lower() == override_address
            ),
            # Quote figures are the user's own marketplace data (no sender
            # PII); the raw reply body still never leaves the inbox.
            "quote": (
                {
                    "total_display": str(q.get("total_display") or ""),
                    "deposit_display": q.get("deposit_display"),
                    "availability": bool(q.get("availability")),
                }
                if isinstance(q := r.get("quote"), dict)
                else None
            ),
        }
        for r in event.replies
    ]
    # Headline proof of work, so it counts proof: messages that actually left,
    # not recipients we addressed. Under demo routing none of them reached a
    # provider at all, so the honest figure is zero and `demo_routing` says why.
    outbound = 0 if demo_routing else sum(
        int((c.bid or {}).get("count") or 0)
        for c in event.specialist_calls.values()
        if isinstance(c.bid, dict) and c.agent_id not in _SELF_DELIVERED_AGENTS
    )
    return {
        "event_id": event.id,
        # Headline proof of work: requests that left the building, and answers
        # that came back.
        "outbound_requests": outbound,
        # True when this deployment reroutes all outbound mail to the operator
        # (see above). The tracker must not claim any provider was contacted.
        "demo_routing": demo_routing,
        "replies_received": len(event.replies),
        # The live public feed emits this alias instead of the real id (which
        # is a capability — see public_feed.public_ref). A tracker page that
        # already holds the real id learns its alias here, and nowhere else.
        "public_ref": public_ref(event.id),
        "route": {
            "origin_address": str(event.spec.get("origin_address", "")),
            "destination_address": str(event.spec.get("destination_address", "")),
            "move_date": str(event.spec.get("move_date", "")),
        },
        "flags": {k: bool(event.spec.get(k)) for k in ("has_pets", "has_children", "has_car", "has_visa")},
        "specialists": specialists,
        "replies": replies,
        "dispatched": bool(specialists),
        "finalized": event.finalized_at is not None,
        "final_outcome": event.final_outcome,
        "ts": now,
    }


@app.post("/webhook/twilio/voice", response_model=None)
async def webhook_twilio_voice(request: Request) -> Response:
    """One turn of a phone call, spoken through Twilio.

    Twilio does the speech-to-text and the speaking; this endpoint only
    translates. The transcript runs through the same concierge core an
    AgentPhone call or a browser microphone uses, so the three rails cannot
    drift apart.
    """
    from .integrations.twilio_voice import (
        build_action_url,
        gather_twiml,
        verify_signature,
    )

    if not settings.twilio_auth_token:
        raise HTTPException(503, "twilio rail is not configured")
    form = await request.form()
    params = {k: str(v) for k, v in form.items()}
    action_url = build_action_url(settings.public_base_url)
    if not verify_signature(
        auth_token=settings.twilio_auth_token,
        url=action_url,
        params=params,
        signature=request.headers.get("X-Twilio-Signature"),
    ):
        # Unsigned traffic is not Twilio and must never drive a call.
        raise HTTPException(403, "invalid twilio signature")

    call_sid = params.get("CallSid", "")
    if not call_sid:
        raise HTTPException(400, "CallSid is required")
    call_id = f"twl_{call_sid}"
    transcript = (params.get("SpeechResult") or "").strip()
    caller = params.get("From", "")
    if caller and call_id not in state.buyer_caller_phone:
        state.buyer_caller_phone[call_id] = caller

    if not transcript:
        # First leg, or the caller said nothing — open the conversation.
        ctx = state.buyer_contexts.get(call_id)
        opening = (
            "Relocate here. Where are you moving from, and where to?"
            if ctx is None
            else "Still there? Tell me a bit more about the move."
        )
        return Response(
            content=gather_twiml(say=opening, action_url=action_url),
            media_type="application/xml",
        )

    history = _twilio_history.setdefault(call_id, [])
    result = await _run_buyer_turn(call_id, transcript, list(history))
    history.append({"direction": "inbound", "content": transcript})
    history.append({"direction": "outbound", "content": result["text"]})
    del history[:-12]
    return Response(
        content=gather_twiml(say=result["text"], action_url=action_url),
        media_type="application/xml",
    )


@app.post("/webhook/twilio/status", response_model=None)
async def webhook_twilio_status(request: Request) -> dict[str, Any]:
    """Call ended: dispatch what was confirmed, exactly like a hang-up."""
    from .integrations.twilio_voice import build_action_url, verify_signature

    if not settings.twilio_auth_token:
        raise HTTPException(503, "twilio rail is not configured")
    form = await request.form()
    params = {k: str(v) for k, v in form.items()}
    if not verify_signature(
        auth_token=settings.twilio_auth_token,
        url=build_action_url(settings.public_base_url).replace("/voice", "/status"),
        params=params,
        signature=request.headers.get("X-Twilio-Signature"),
    ):
        raise HTTPException(403, "invalid twilio signature")
    call_id = f"twl_{params.get('CallSid', '')}"
    ctx = state.buyer_contexts.get(call_id)
    if ctx is None:
        return {"ok": True, "unknown_call": True}
    ctx.call_ended = True
    state.save_context(ctx)
    _twilio_history.pop(call_id, None)
    await ws_broker.broadcast({
        "type": "agent_state", "event_id": ctx.event_id, "agent_id": "buyer",
        "state": "closed", "ts": time.time(),
    })
    _finalize_buyer_call(ctx)
    return {"ok": True, "event_id": ctx.event_id, "dispatched": ctx.dispatched}


# Per-call turn history for the Twilio rail. AgentPhone sends history with
# each webhook; Twilio does not, so it is kept here for the call's lifetime.
_twilio_history: dict[str, list[dict[str, str]]] = {}


_CONCIERGE_PER_IP_MIN = 40
_concierge_hits: dict[str, list[float]] = {}


@app.post("/api/public/concierge/turn")
async def api_concierge_turn(request: Request, payload: dict[str, Any]) -> dict[str, Any]:
    """One spoken turn with the concierge, from a browser microphone.

    The product's promise is "brief it once and the swarm goes" — that should
    not require owning a phone number. Speech-to-text happens in the browser;
    what arrives here is the same transcript AgentPhone would have posted, and
    it runs the same concierge core, so a browser session dispatches exactly
    like a phone call does.
    """
    if not settings.enable_public_intake:
        raise HTTPException(503, "public intake is not enabled on this deployment")
    ip = _client_ip(request)
    now = time.time()
    _sweep_hits(_concierge_hits, now - 60)
    hits = [ts for ts in _concierge_hits.get(ip, []) if ts > now - 60]
    if len(hits) >= _CONCIERGE_PER_IP_MIN:
        raise HTTPException(429, "slow down a moment")
    hits.append(now)
    _concierge_hits[ip] = hits

    transcript = str(payload.get("transcript") or "").strip()[:600]
    if not transcript:
        raise HTTPException(400, "transcript is required")
    call_id = str(payload.get("call_id") or "").strip()[:64]
    if not call_id or not re.fullmatch(r"web_[A-Za-z0-9]{6,32}", call_id):
        call_id = f"web_{uuid.uuid4().hex[:12]}"

    history = payload.get("history")
    turns = []
    if isinstance(history, list):
        for item in history[-6:]:
            if isinstance(item, dict) and item.get("content"):
                turns.append({
                    "direction": "inbound" if item.get("role") == "user" else "outbound",
                    "content": str(item["content"])[:600],
                })

    result = await _run_buyer_turn(call_id, transcript, turns)

    # A move briefed through the gated workspace belongs to it.
    event = state.events.get(result["event_id"])
    if event is not None and event.origin_channel != "demo":
        event.origin_channel = (
            "demo" if valid_token(str(payload.get("demo_token") or "")) else "web"
        )
        state.save_event(event)
    result["call_id"] = call_id
    return result


@app.post("/api/public/concierge/end")
async def api_concierge_end(request: Request, payload: dict[str, Any]) -> dict[str, Any]:
    """Hang up: dispatch whatever is confirmed and send the follow-up.

    Mirrors agent.call_ended so a browser session ends exactly the way a phone
    call does — including dispatching a CORE-complete spec the caller never
    finished answering household questions for.
    """
    if not settings.enable_public_intake:
        raise HTTPException(503, "public intake is not enabled on this deployment")
    call_id = str(payload.get("call_id") or "").strip()[:64]
    ctx = state.buyer_contexts.get(call_id)
    if ctx is None:
        raise HTTPException(404, "unknown session")
    ctx.call_ended = True
    state.save_context(ctx)
    await ws_broker.broadcast({
        "type": "agent_state", "event_id": ctx.event_id, "agent_id": "buyer",
        "state": "closed", "ts": time.time(),
    })
    _finalize_buyer_call(ctx)
    return {
        "event_id": ctx.event_id,
        "dispatched": ctx.dispatched,
        "collected": sorted(ctx.collected),
    }


_DEMO_LOGIN_PER_IP_MIN = 8
_demo_login_hits: dict[str, list[float]] = {}


@app.post("/api/public/demo-login")
async def api_demo_login(request: Request, payload: dict[str, Any]) -> dict[str, Any]:
    """Exchange the demo workspace credentials for a signed, expiring token.

    The product page is a static export and cannot hold a secret, so the
    password lives here and only a token ever reaches the browser.
    """
    if not demo_enabled():
        raise HTTPException(503, "demo access is not enabled on this deployment")
    ip = _client_ip(request)
    now = time.time()
    _sweep_hits(_demo_login_hits, now - 60)
    hits = [t for t in _demo_login_hits.get(ip, []) if t > now - 60]
    if len(hits) >= _DEMO_LOGIN_PER_IP_MIN:
        raise HTTPException(429, "too many attempts — wait a minute")
    hits.append(now)
    _demo_login_hits[ip] = hits

    # A private access link is an alternative to typing credentials, not a
    # weaker one: same rate limit, same signed session, same workspace.
    access_key = str(payload.get("access_key") or "")
    username = str(payload.get("username") or "")
    password = str(payload.get("password") or "")
    if not (verify_access_key(access_key) or verify_credentials(username, password)):
        raise HTTPException(401, "invalid credentials")
    token, expires_at = issue_token(now)
    log.info("demo workspace login: ip=%s", ip)
    return {"token": token, "expires_at": expires_at}


def _require_demo_token(request: Request) -> None:
    if not demo_enabled():
        raise HTTPException(503, "demo access is not enabled on this deployment")
    if not valid_token(_bearer_token(request.headers.get("authorization"))):
        raise HTTPException(401, "sign in to the demo workspace")


@app.get("/api/public/demo/moves")
async def api_demo_moves(request: Request) -> dict[str, Any]:
    """Moves created through the gated product page, newest first.

    Scoped to origin_channel == "demo" on purpose: the credentials are
    published to reviewers, so real callers' moves must never appear here.
    """
    _require_demo_token(request)
    # Demo routing rewrites every outbound recipient to the operator's own
    # inbox, so on such a deployment nothing was submitted to anybody — the
    # same fact the tracker reports as demo_routing and as "no provider was
    # contacted". The chip must not say otherwise.
    demo_routing = bool(settings.agentmail_demo_recipient_override.strip())
    moves: list[dict[str, Any]] = []
    for event in state.events.values():
        if event.origin_channel != "demo":
            continue
        # A concierge session that was abandoned mid-brief created an event but
        # never dispatched. Listing those as empty "Origin -> Destination"
        # rows is noise, not history.
        if not event.specialist_calls:
            continue
        # "prepared" is broken out of "submitted" on purpose: the workspace
        # renders the submitted chip as provider acceptance, and a prepared
        # artifact reached no counterparty at all.
        counts = {
            "submitted": 0, "prepared": 0, "action": 0,
            "failed": 0, "working": 0, "done": 0,
        }
        for ctx in event.specialist_calls.values():
            if ctx.state == "submitted":
                if demo_routing or ctx.terminal_outcome == "prepared_for_user":
                    counts["prepared"] += 1
                else:
                    counts["submitted"] += 1
            elif ctx.state == "succeeded":
                counts["done"] += 1
            elif ctx.state == "needs-user-action":
                counts["action"] += 1
            elif ctx.state in ("failed", "error"):
                counts["failed"] += 1
            else:
                counts["working"] += 1
        counts["total"] = len(event.specialist_calls)
        moves.append({
            "event_id": event.id,
            "public_ref": public_ref(event.id),
            "route": {
                "origin_address": str(event.spec.get("origin_address", "")),
                "destination_address": str(event.spec.get("destination_address", "")),
                "move_date": str(event.spec.get("move_date", "")),
            },
            "counts": counts,
            "started_at": event.started_at,
            "finalized": event.finalized_at is not None,
        })
    moves.sort(key=lambda m: float(m["started_at"]), reverse=True)  # type: ignore[arg-type]
    return {"moves": moves[:50]}


_UNLOCK_PER_IP_MIN = 12
_unlock_hits: dict[str, list[float]] = {}

# Account identifiers a customer can supply after the fact to let blocked
# specialists run. Passwords are deliberately absent: a portal login is not
# something this product asks for, and a specialist that needs one stays
# blocked rather than pretending otherwise.
_UNLOCKABLE_FIELDS = (
    "pge_account_number",
    "comcast_account_number",
    "equinox_member_id",
    "user_name",
    "user_phone",
    "work_address",
    "vet_email",
    "child_name",
    "child_grade",
)


@app.post("/api/public/move/{event_id}/details")
async def api_move_add_details(
    event_id: str, request: Request, payload: dict[str, Any],
) -> dict[str, Any]:
    """Add the details a blocked specialist was waiting on, and let it run.

    A spoken call never asks for account numbers — reading a long identifier
    aloud is error-prone, and the concierge is designed not to. This is where
    they land afterwards, typed and exact, so the work the swarm could not do
    during the call happens without the customer doing it themselves.
    """
    if not settings.enable_public_intake:
        raise HTTPException(503, "public move pages are not enabled on this deployment")
    ip = _client_ip(request)
    now = time.time()
    _sweep_hits(_unlock_hits, now - 60)
    hits = [ts for ts in _unlock_hits.get(ip, []) if ts > now - 60]
    if len(hits) >= _UNLOCK_PER_IP_MIN:
        raise HTTPException(429, "too many requests")
    hits.append(now)
    _unlock_hits[ip] = hits

    event = state.events.get(event_id)
    if event is None:
        raise HTTPException(404, "unknown move")
    if event.finalized_at is not None:
        raise HTTPException(409, "this move is already finalized")

    from .buyer_schema import by_name

    added: list[str] = []
    for name in _UNLOCKABLE_FIELDS:
        raw = payload.get(name)
        if raw is None:
            continue
        value = str(raw).strip()[:120]
        if not value:
            continue
        field = by_name(name)
        if field is None or not field.validate(value):
            continue
        event.spec[name] = value
        added.append(name)

    if payload.get("authorize_providers") is True:
        event.spec["service_authorization_signed"] = True
        added.append("service_authorization_signed")

    if not added:
        raise HTTPException(400, "nothing usable was supplied")

    state.save_event(event)
    log.info("move details added: event=%s fields=%s", event_id, sorted(added))
    # Whatever is now unblocked runs on its own.
    asyncio.create_task(resume_ready_specialists(event_id))
    return {"event_id": event_id, "accepted": sorted(added)}


def _require_dev_trigger_access(request: Request) -> None:
    if settings.app_env.lower() == "production" or not settings.enable_dev_trigger:
        raise HTTPException(404, "not found")
    expected = settings.admin_api_token
    if not expected:
        raise HTTPException(503, "dev trigger is enabled but ADMIN_API_TOKEN is not configured")
    supplied = _bearer_token(request.headers.get("authorization"))
    if not supplied or not hmac.compare_digest(supplied, expected):
        raise HTTPException(401, "invalid bearer token")


@app.post("/api/test/buyer-trigger")
async def api_test_buyer_trigger(request: Request, payload: dict[str, Any]) -> dict[str, Any]:
    """Dev-only: synthesize a buyer dispatch without a real AgentPhone call.

    Body: {"spec": {...}}  → creates a MarketplaceEvent and fires fan_out.
    """
    _require_dev_trigger_access(request)
    spec = payload.get("spec", {})
    if not isinstance(spec, dict):
        raise HTTPException(400, "spec must be an object")
    event_id = state.new_event_id()
    state.events[event_id] = MarketplaceEvent(id=event_id, homeowner_call_id="dev", spec=spec)
    asyncio.create_task(fan_out(event_id, spec))
    return {"event_id": event_id, "dispatched": True}
