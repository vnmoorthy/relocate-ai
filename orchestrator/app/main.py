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
from contextlib import asynccontextmanager, suppress
from typing import Any, AsyncIterator

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pythonjsonlogger import jsonlogger

from .config import settings
from .marketplace import fan_out, finalize_event, resume_ready_specialists
from .pavo_client import pavo_chat
from .persistence import persistence
from .personas import by_id, buyer_persona
from .public_feed import redact_public_event
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


async def _handle_buyer_turn(call_id: str, transcript: str, history: list[dict]) -> StreamingResponse:
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

    buyer = buyer_persona()
    system_prompt = buyer.system_prompt + recall_context
    messages = [{"role": "system", "content": system_prompt}]
    for h in history[-6:]:
        messages.append({
            "role": "user" if h.get("direction") == "inbound" else "assistant",
            "content": h.get("content", ""),
        })
    messages.append({"role": "user", "content": transcript})

    reply = await pavo_chat(
        messages,
        role_hint="buyer-extract" if not ctx.dispatched else "buyer",
        max_tokens=300,
    )

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
    new_fields = _extract_and_merge_fields(reply.content, ctx)
    # Deterministic backstop: the 2B model drops fields stochastically, so
    # high-structure CORE values are also recovered verbatim from the
    # caller's own utterance — gaps only, the model's extraction wins.
    new_fields.update(_merge_backstop_fields(transcript, ctx))
    voice_reply = _strip_machine_json(reply.content)
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

    # Return spoken text only. The machine-readable JSON block must never reach TTS.
    async def generate():
        yield json.dumps({"text": voice_reply}) + "\n"

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
        if field is None or not field.validate(v):
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


def _extract_and_merge_fields(text: str, ctx) -> dict:
    """Validate and merge changed voice-safe fields, including corrections.

    Guard against example regurgitation: small models sometimes copy the
    prompt's DISPATCH JSON SHAPE example wholesale, "collecting" values the
    caller never said. A block whose string values match three or more schema
    examples is treated as a copied example and those values are dropped; a
    genuine caller coincidentally matching one example (a bank named Chase, a
    dog) still merges normally.
    """
    from .buyer_schema import by_name
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
            if isinstance(v, str) and field.tier != "conditional"
            and v.strip() == field.example
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


def _strip_machine_json(text: str) -> str:
    """Remove flat machine JSON blocks from the text returned to voice TTS."""
    spoken = re.sub(r"\{[^{}]+\}", "", text, flags=re.DOTALL)
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
            "state": ctx.state, "ts": ctx.closed_at or ctx.started_at,
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
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()[:64]
    return (request.client.host if request.client else "unknown")[:64]


def _intake_rate_limited(ip: str, now: float) -> bool:
    minute, hour = now - 60, now - 3600
    global _intake_global
    _intake_global = [t for t in _intake_global if t > hour]
    if len(_intake_global) >= _INTAKE_GLOBAL_HOUR:
        return True
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

    # Optional household details. Supplying them unblocks the specialists that
    # need them (school enrollment, vet records) exactly as the voice concierge
    # does when the caller volunteers the same facts. Anything invalid is
    # dropped rather than rejected — the move still dispatches.
    for name in (
        "user_name", "user_phone", "household_size", "child_name", "child_grade",
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
    dedupe_key = "|".join(
        spec[k].lower() for k in ("origin_address", "destination_address", "move_date", "user_email")
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
    state.events[event_id] = MarketplaceEvent(id=event_id, homeowner_call_id=call_id, spec=spec)
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
    hits = [t for t in _snapshot_hits.get(ip, []) if t > now - 60]
    if len(hits) >= _SNAPSHOT_PER_IP_MIN:
        raise HTTPException(429, "too many requests")
    hits.append(now)
    _snapshot_hits[ip] = hits

    event = state.events.get(event_id)
    if event is None:
        raise HTTPException(404, "unknown move")
    specialists = [
        {
            "agent_id": agent_id,
            "state": ctx.state,
            "terminal_outcome": ctx.terminal_outcome,
            "blocker_kind": ctx.blocker_kind,
            "closed_at": ctx.closed_at,
            # Static per-agent title only — playbook BODIES carry the user's
            # own details and travel by email, never through this endpoint.
            "playbook_title": (ctx.playbook or {}).get("title"),
        }
        for agent_id, ctx in event.specialist_calls.items()
    ]
    replies = [
        {
            "from_domain": str(r.get("from_domain") or ""),
            "received_at": r.get("received_at"),
            "agent_id": r.get("agent_id"),
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
    return {
        "event_id": event.id,
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
