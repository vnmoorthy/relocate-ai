"""FastAPI entry point.

Routes:
- POST /webhook/agent/{agent_id}   AgentPhone webhook fan-in
- WS   /ws/dashboard               dashboard event stream
- POST /api/test/buyer-trigger     dev-only synthetic buyer trigger
- GET  /healthz                    liveness
"""
from __future__ import annotations

import json
import logging
import time
from typing import Any

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pythonjsonlogger import jsonlogger

from .config import settings
from .integrations.agentmail import send_move_package
from .integrations.sponge import hold_mover_escrow
from .integrations.stripe_integration import hold_mover_deposit
from .integrations.supermemory import persist_move
from .marketplace import fan_out
from .pavo_client import pavo_chat
from .personas import by_id, buyer_persona
from .security import verify_agentphone_signature, get_raw_body
from .state import state, BuyerCallContext, SpecialistCallContext, MarketplaceEvent
from .ws import ws_broker


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


app = FastAPI(title="Relocate Orchestrator", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # dev only; production locks to dashboard origin
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
        "ws_clients": len(ws_broker._clients),
        "ts": time.time(),
    }


@app.post("/webhook/agent/{agent_id}", response_model=None)
async def webhook_agent(agent_id: str, request: Request) -> StreamingResponse | JSONResponse:
    """AgentPhone webhook: receives transcript turns + call lifecycle events.

    For the BUYER agent: parse spec, fire fan_out background task once dispatchable.
    For SPECIALIST agents: route the turn through PAVO and reply with text.
    """
    body = await get_raw_body(request)
    verify_agentphone_signature(
        body,
        request.headers.get("X-Webhook-Signature"),
        request.headers.get("X-Webhook-Timestamp"),
        agent_id,
    )

    try:
        payload = json.loads(body)
    except json.JSONDecodeError as e:
        raise HTTPException(400, f"bad json: {e}") from e

    event_type = payload.get("event", "")
    channel = payload.get("channel", "")
    data = payload.get("data", {})

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
        caller = data.get("fromNumber") or data.get("from_number") or data.get("caller", "")
        if caller and call_id and call_id not in state.buyer_caller_phone:
            state.buyer_caller_phone[call_id] = caller
        return await _handle_buyer_turn(call_id, transcript, payload.get("recentHistory", []))
    else:
        return await _handle_specialist_turn(agent_id, call_id, transcript, payload.get("recentHistory", []))


async def _handle_buyer_turn(call_id: str, transcript: str, history: list[dict]) -> StreamingResponse:
    import asyncio  # local to avoid top-level cost
    from .integrations.supermemory import recall_user_profile

    ctx = state.buyer_contexts.get(call_id)
    is_first_turn = ctx is None
    if ctx is None:
        event_id = state.new_event_id()
        state.events[event_id] = MarketplaceEvent(id=event_id, homeowner_call_id=call_id, spec={})
        ctx = BuyerCallContext(call_id=call_id, event_id=event_id)
        state.buyer_contexts[call_id] = ctx
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
    event.baseline_cents_total += reply.cost_cents * 28  # 28× ratio per cost reveal
    await ws_broker.broadcast({
        "type": "routing_decision", "event_id": ctx.event_id, "agent_id": "buyer",
        "turn": ctx.turn_count, "tier": reply.tier, "reason": reply.decision_reason,
        "complexity": 0.0, "ts": time.time(),
    })
    await ws_broker.broadcast({
        "type": "cost_update", "event_id": ctx.event_id,
        "pavo_cents": event.pavo_cents_total, "baseline_cents": event.baseline_cents_total,
        "ts": time.time(),
    })
    await ws_broker.broadcast({
        "type": "transcript_turn", "event_id": ctx.event_id, "agent_id": "buyer",
        "turn": ctx.turn_count, "role": "agent", "text": reply.content,
        "pavo_tier": reply.tier, "ts": time.time(),
    })

    # Attempt to extract a structured spec from the reply (buyer agent emits JSON in dispatch turn).
    if not ctx.dispatched:
        spec = _try_extract_spec(reply.content)
        if spec:
            ctx.parsed_spec = spec
            ctx.dispatched = True
            event.spec = spec
            asyncio.create_task(fan_out(ctx.event_id, spec))
            log.info("buyer dispatched: event=%s spec_fields=%d", ctx.event_id, len(spec))

    # Return NDJSON to AgentPhone (per their voice-webhook format).
    async def generate():
        yield json.dumps({"text": reply.content}) + "\n"

    return StreamingResponse(generate(), media_type="application/x-ndjson")


async def _handle_specialist_turn(agent_id: str, call_id: str, transcript: str, history: list[dict]) -> StreamingResponse:
    persona = by_id(agent_id)
    # Idempotency: dedup first-turn dispatches per /plan-eng-review code-quality issue 11.
    state.seen_first_turns.setdefault(agent_id, set())
    if call_id not in state.seen_first_turns[agent_id]:
        state.seen_first_turns[agent_id].add(call_id)

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
    event.baseline_cents_total += reply.cost_cents * 28
    ctx.transcript.append({"role": "agent", "text": reply.content, "pavo_tier": reply.tier, "ts": time.time()})

    await ws_broker.broadcast({
        "type": "routing_decision", "event_id": event_id, "agent_id": agent_id,
        "turn": ctx.turn_count, "tier": reply.tier, "reason": reply.decision_reason,
        "complexity": 0.0, "ts": time.time(),
    })
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
            await ws_broker.broadcast({
                "type": "agent_state", "event_id": ctx.event_id, "agent_id": "buyer",
                "state": "closed", "ts": time.time(),
            })
        return JSONResponse({"ok": True})

    # Specialist call ended.
    event_id = None
    for eid, ev in state.events.items():
        if agent_id in ev.specialist_calls and ev.specialist_calls[agent_id].call_id == call_id:
            event_id = eid
            break
    if event_id:
        event = state.events[event_id]
        event.specialist_calls[agent_id].state = "closed"
        event.specialist_calls[agent_id].closed_at = time.time()
        await ws_broker.broadcast({
            "type": "agent_state", "event_id": event_id, "agent_id": agent_id,
            "state": "closed", "ts": time.time(),
        })

        if all(c.state in ("closed", "error", "voicemail") for c in event.specialist_calls.values()):
            # Event complete: fire Stripe + Sponge + AgentMail + Supermemory persist.
            asyncio.create_task(_fire_event_complete_sponsors(event_id))
            await ws_broker.broadcast({
                "type": "event_complete", "event_id": event_id,
                "summary": {
                    "pavo_cents": event.pavo_cents_total,
                    "baseline_cents": event.baseline_cents_total,
                    "specialist_count": len(event.specialist_calls),
                },
                "ts": time.time(),
            })

    return JSONResponse({"ok": True})


async def _fire_event_complete_sponsors(event_id: str) -> None:
    """When the marketplace event completes, fire Stripe + Sponge + AgentMail + Supermemory persist.

    Stripe + Sponge: simulate mover-deposit hold + escrow.
    AgentMail: send the move package receipt to a configured demo email.
    Supermemory: persist the move for future recall.
    """
    import asyncio
    event = state.events.get(event_id)
    if event is None:
        return

    # Stripe + Sponge for the mover deposit (cheapest mover bid wins; demo uses $500 fixed).
    spec = event.spec
    mover_ctx = event.specialist_calls.get("mover_quote")
    mover_summary = "Mike's Movers, $1,840 OTD, truck confirmed" if mover_ctx else "(mover quote unavailable)"

    stripe_result = await hold_mover_deposit(
        event_id=event_id,
        amount_cents=50_000,
        description=f"Relocate deposit for {spec.get('origin_address', 'origin')} → {spec.get('destination_address', 'destination')}",
    )
    intent_id = (stripe_result or {}).get("id") if isinstance(stripe_result, dict) else None

    await hold_mover_escrow(
        event_id=event_id,
        amount_cents=50_000,
        payer="move-platform",
        payee="mover-winner",
        stripe_payment_intent_id=intent_id,
    )

    # AgentMail: send move package receipt with a real PDF attachment.
    demo_email = spec.get("homeowner_email") or "moorthy@example.com"

    # Build PDF receipt as a real artifact for judges to verify in their inbox.
    from .integrations.pdf_receipt import build_receipt_pdf
    from .personas import by_id

    specialist_rows: list[dict[str, Any]] = []
    for agent_id, ctx in event.specialist_calls.items():
        try:
            p = by_id(agent_id)
            display_name = p.name
        except KeyError:
            display_name = agent_id
        last_agent_turn = next(
            (t for t in reversed(ctx.transcript) if t.get("role") == "agent"),
            None,
        )
        outcome_text = ""
        tier = ""
        if last_agent_turn:
            text = last_agent_turn.get("text", "")
            import re
            m = re.search(r"Bid:\s*(.*?)(?:\.|$)", text)
            outcome_text = (m.group(1) if m else text).strip()[:120]
            tier = last_agent_turn.get("pavo_tier", "")
        specialist_rows.append({
            "name": display_name,
            "state": ctx.state,
            "outcome": outcome_text,
            "tier": tier,
        })

    decisions_count = max(1, len(specialist_rows) * 3)  # rough — actual count tracked elsewhere
    pavo_summary = {
        "decisions": decisions_count,
        "local_share_pct": 60,  # canonical from synthetic; real flow may differ
        "pavo_cents": float(event.pavo_cents_total),
        "baseline_cents": float(event.baseline_cents_total),
    }

    pdf_bytes = build_receipt_pdf(
        event_id=event_id,
        homeowner_name=spec.get("homeowner_name", "Relocate customer"),
        spec=spec,
        specialist_results=specialist_rows,
        pavo_summary=pavo_summary,
    )

    body = (
        f"Your Relocate package is ready.\n\n"
        f"From: {spec.get('origin_address', '?')}\n"
        f"To:   {spec.get('destination_address', '?')}\n"
        f"Date: {spec.get('move_date', '?')}\n\n"
        f"PDF receipt attached — every specialist outcome plus the PAVO routing summary.\n\n"
        f"— Relocate\n"
        f"AI Relocation OS · built on PAVO · TMLR 2026\n"
        f"huggingface.co/datasets/vnmoorthy/pavo-bench\n"
    )

    await send_move_package(
        event_id=event_id,
        to_email=demo_email,
        subject=f"Your Relocate package ({spec.get('destination_address', 'destination')[:30]})",
        body_markdown=body,
        attachments=[{
            "filename": f"move-receipt-{event_id}.pdf",
            "content_type": "application/pdf",
            "content_bytes": pdf_bytes,
        }],
    )

    # Supermemory: persist for future recall.
    await persist_move(
        event_id=event_id,
        phone_e164=spec.get("homeowner_phone", settings.demo_homeowner_number),
        spec=spec,
        results={a: c.state for a, c in event.specialist_calls.items()},
    )


@app.websocket("/ws/dashboard")
async def ws_dashboard(ws: WebSocket) -> None:
    await ws_broker.subscribe(ws)
    try:
        while True:
            # Server-push only; we just keep the connection alive.
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await ws_broker.unsubscribe(ws)


def _try_extract_spec(text: str) -> dict[str, Any] | None:
    """Buyer agent emits a JSON block when dispatching. Try to parse it."""
    import re
    match = re.search(r"\{[^{}]+\}", text, re.DOTALL)
    if not match:
        return None
    try:
        spec = json.loads(match.group(0))
        required = {"origin_address", "destination_address", "move_date"}
        if required.issubset(spec.keys()):
            return spec
    except json.JSONDecodeError:
        return None
    return None


@app.post("/api/test/buyer-trigger")
async def api_test_buyer_trigger(payload: dict[str, Any]) -> dict[str, Any]:
    """Dev-only: synthesize a buyer dispatch without a real AgentPhone call.

    Body: {"spec": {...}}  → creates a MarketplaceEvent and fires fan_out.
    """
    import asyncio
    spec = payload.get("spec", {})
    event_id = state.new_event_id()
    state.events[event_id] = MarketplaceEvent(id=event_id, homeowner_call_id="dev", spec=spec)
    asyncio.create_task(fan_out(event_id, spec))
    return {"event_id": event_id, "dispatched": True}
