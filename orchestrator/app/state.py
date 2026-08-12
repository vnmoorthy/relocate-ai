"""In-memory state for the demo. Redis post-MVP.

Two main entities:
- BuyerCallContext: per-inbound-call state (judge → buyer agent).
- MarketplaceEvent: aggregate of all 7 LIVE specialist outcomes for one move.

Pattern per /plan-eng-review architecture issue 5 (buyer agent state schema).
"""
from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from typing import Any


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
    # Track which fields came in on which turn for the dashboard timeline.
    collection_history: list[dict[str, Any]] = field(default_factory=list)
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
    started_at: float = field(default_factory=time.time)
    finalization_started: bool = False
    finalized_at: float | None = None
    final_outcome: str | None = None
    awaiting_user_notified: bool = False


class AppState:
    """Process-local state. Webhook idempotency via seen_call_ids per specialist."""
    def __init__(self) -> None:
        self.buyer_contexts: dict[str, BuyerCallContext] = {}
        self.events: dict[str, MarketplaceEvent] = {}
        # specialist_call_id -> agent_id  (dedup webhook retries)
        self.specialist_call_to_agent: dict[str, str] = {}
        # agent_id -> set of call_ids we've seen first-turn for (idempotency)
        self.seen_first_turns: dict[str, set[str]] = {}
        # buyer call_id -> caller phone number (E.164) — used for Supermemory recall lookup
        self.buyer_caller_phone: dict[str, str] = {}

    def new_event_id(self) -> str:
        return f"mkt_{uuid.uuid4().hex[:10]}"


state = AppState()
