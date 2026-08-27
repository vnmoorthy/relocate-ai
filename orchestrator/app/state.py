"""Runtime state with durable single-node persistence.

The working set lives in memory for speed; every meaningful mutation is
mirrored to SQLite (see persistence.py) so a restart recovers events, buyer
contexts, and webhook idempotency records. Specialists that were mid-flight at
the moment of a crash are surfaced honestly as needs-user-action on recovery —
never silently resumed, never relabeled as complete. Multiple orchestrator
replicas remain unsupported (single-node store; roadmap in STATUS.md).

Two main entities:
- BuyerCallContext: per-inbound-call state for the buyer concierge.
- MarketplaceEvent: aggregate of every dispatched specialist outcome for one move.
"""
from __future__ import annotations

import logging
import time
import uuid
from dataclasses import asdict, dataclass, field, fields
from typing import Any

from .persistence import persistence


log = logging.getLogger(__name__)

# States that may not survive a restart as-is: work that was queued or running
# when the process died cannot be trusted to have completed.
_IN_FLIGHT_SPECIALIST_STATES = frozenset({"dispatched", "calling", "in-progress"})


def _filtered_kwargs(cls: type, data: dict[str, Any]) -> dict[str, Any]:
    """Ignore unknown keys so older databases load into newer dataclasses."""
    names = {f.name for f in fields(cls)}
    return {k: v for k, v in data.items() if k in names}


@dataclass
class BuyerCallContext:
    """Persists between AgentPhone webhook invocations for the inbound buyer call."""
    call_id: str                    # AgentPhone call ID
    event_id: str                   # Marketplace event we created for this call
    turn_count: int = 0             # for PAVO history depth
    parsed_spec: dict[str, Any] | None = None  # extracted move spec
    dispatched: bool = False        # True once fan-out has fired (idempotency)
    started_at: float = field(default_factory=time.time)
    # v2 field-collection state — the buyer emits partial JSON each turn;
    # the orchestrator merges them here and dispatches on CORE-complete.
    collected: dict[str, Any] = field(default_factory=dict)
    # Everything the caller has said this call, in order. The deterministic
    # backstop reads the JOIN of these, not the latest utterance alone: the
    # browser recognizer splits one spoken brief across turns at every pause,
    # so "I'm moving from A" and "to B on the 15th" arrive separately — and
    # per-utterance extraction then rejects the date for lacking moving
    # language, which lives one turn earlier.
    caller_utterances: list[str] = field(default_factory=list)
    # Track which fields came in on which turn for the dashboard timeline.
    collection_history: list[dict[str, Any]] = field(default_factory=list)
    # True once agent.call_ended has been observed. Late in-flight turns check
    # this to re-run end-of-call dispatch/follow-up after their fields merge.
    call_ended: bool = False
    # True after the post-call follow-up email is sent (idempotency).
    followup_sent: bool = False
    followup_in_progress: bool = False


@dataclass
class SpecialistCallContext:
    """Per-outbound-specialist-call state."""
    call_id: str
    agent_id: str
    event_id: str
    # dispatched|calling|in-progress|submitted|succeeded|needs-user-action|failed
    state: str = "dispatched"
    terminal_outcome: str | None = None
    blocker_kind: str | None = None
    blockers: list[str] = field(default_factory=list)
    turn_count: int = 0
    transcript: list[dict[str, Any]] = field(default_factory=list)
    bid: dict[str, Any] | None = None
    # Prepared next-step artifact for user-blocked work (playbooks.py).
    # Title is public-page safe; body travels only by email/authed surfaces.
    playbook: dict[str, str] | None = None
    started_at: float = field(default_factory=time.time)
    closed_at: float | None = None


@dataclass
class MarketplaceEvent:
    """One move's worth of specialist activity."""
    id: str
    homeowner_call_id: str
    spec: dict[str, Any]
    specialist_calls: dict[str, SpecialistCallContext] = field(default_factory=dict)  # agent_id -> ctx
    pavo_cents_total: float = 0.0
    # Populated only when a measured/configured counterfactual exists.
    baseline_cents_total: float | None = None
    routing_decisions: list[dict[str, Any]] = field(default_factory=list)
    # Inbound email replies correlated to this move (see integrations/replies.py).
    replies: list[dict[str, Any]] = field(default_factory=list)
    # "voice" | "web" | "demo". The gated product workspace lists only its own
    # moves, so a shared demo credential never exposes real callers' moves.
    origin_channel: str = "web"
    started_at: float = field(default_factory=time.time)
    # Set only when the provider returned a receipt. The tracker's "sent to
    # your inbox" line is gated on this — a failed send must never be
    # reported to the user as delivered.
    playbook_digest_sent: bool = False
    # Demo routing sends the digest to the operator's inbox instead of the
    # customer's. The send succeeded, but "sent to your inbox" would be false,
    # so the reroute is recorded separately rather than folded into "sent".
    playbook_digest_rerouted: bool = False
    prepared_docs_sent: bool = False
    arrival_pack_sent: bool = False
    finalization_started: bool = False
    finalized_at: float | None = None
    final_outcome: str | None = None
    awaiting_user_notified: bool = False


class AppState:
    """In-memory working set mirrored to SQLite on mutation."""
    def __init__(self) -> None:
        self.buyer_contexts: dict[str, BuyerCallContext] = {}
        self.events: dict[str, MarketplaceEvent] = {}
        # buyer call_id -> caller phone number (E.164) — used for Supermemory recall lookup
        self.buyer_caller_phone: dict[str, str] = {}

    def new_event_id(self) -> str:
        return f"mkt_{uuid.uuid4().hex[:10]}"

    # ── durability ───────────────────────────────────────────────────────
    def save_event(self, event: MarketplaceEvent) -> None:
        persistence.save_event(event.id, asdict(event))
        # Write through to Supabase when configured. Never blocking, never
        # able to fail a dispatch — see integrations/supabase_store.
        from .integrations import supabase_store

        if supabase_store.enabled():
            supabase_store.schedule(supabase_store.mirror_event(event))

    def save_context(self, ctx: BuyerCallContext) -> None:
        persistence.save_buyer_context(ctx.call_id, asdict(ctx))
        from .integrations import supabase_store

        if supabase_store.enabled():
            supabase_store.schedule(supabase_store.mirror_context(ctx))

    def load_from_persistence(self) -> tuple[int, int, int]:
        """Rebuild the working set from SQLite after a restart.

        Specialists that were in flight when the process died are marked
        needs-user-action with an explicit restart blocker: their provider
        outcome is unknown, and an unknown outcome is never reported as done.
        Returns (events, contexts, recovered_in_flight) counts.
        """
        recovered_in_flight = 0
        for event_id, data in persistence.load_events().items():
            calls_data = data.pop("specialist_calls", {}) or {}
            event = MarketplaceEvent(**_filtered_kwargs(MarketplaceEvent, data))
            event.specialist_calls = {}
            event_recovered = 0
            for agent_id, call in calls_data.items():
                ctx = SpecialistCallContext(
                    **_filtered_kwargs(SpecialistCallContext, call),
                )
                if ctx.state in _IN_FLIGHT_SPECIALIST_STATES:
                    ctx.state = "needs-user-action"
                    ctx.terminal_outcome = "needs_user_action"
                    ctx.blocker_kind = "orchestrator_restart"
                    ctx.blockers = [
                        "the orchestrator restarted while this specialist was "
                        "in flight; its provider outcome is unverified",
                    ]
                    ctx.closed_at = time.time()
                    event_recovered += 1
                event.specialist_calls[agent_id] = ctx
            self.events[event_id] = event
            if event_recovered:
                recovered_in_flight += event_recovered
                self.save_event(event)
        for call_id, data in persistence.load_buyer_contexts().items():
            buyer_ctx = BuyerCallContext(**_filtered_kwargs(BuyerCallContext, data))
            self.buyer_contexts[call_id] = buyer_ctx
        if self.events or self.buyer_contexts:
            log.info(
                "state recovered from persistence: events=%d contexts=%d "
                "in_flight_marked_needs_user_action=%d",
                len(self.events), len(self.buyer_contexts), recovered_in_flight,
            )
        return len(self.events), len(self.buyer_contexts), recovered_in_flight


state = AppState()
