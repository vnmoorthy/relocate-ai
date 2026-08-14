"""Durable single-node state: save/reload round-trips and restart recovery.

The default suite runs with persistence disabled (conftest blanks
DATABASE_PATH); these tests open an explicit temporary database against the
process-global singleton and close it again on the way out.
"""

from __future__ import annotations

import time
from collections.abc import Iterator
from pathlib import Path

import pytest

from app import security
from app.persistence import persistence
from app.state import AppState, BuyerCallContext, MarketplaceEvent, SpecialistCallContext, state


@pytest.fixture()
def db(tmp_path: Path) -> Iterator[Path]:
    path = tmp_path / "relocate-test.db"
    state.buyer_contexts.clear()
    state.events.clear()
    security._WEBHOOK_DELIVERIES.clear()
    persistence.open(str(path))
    yield path
    persistence.close()
    state.buyer_contexts.clear()
    state.events.clear()
    security._WEBHOOK_DELIVERIES.clear()


def _reopen(path: Path) -> None:
    """Simulate a process restart: drop the connection and the working set."""
    persistence.close()
    state.buyer_contexts.clear()
    state.events.clear()
    persistence.open(str(path))


def test_event_and_context_survive_restart(db: Path) -> None:
    event = MarketplaceEvent(
        id="mkt_persist", homeowner_call_id="call_persist",
        spec={"origin_address": "123 Main St, SF, CA 94103"},
    )
    event.specialist_calls["mover_quote"] = SpecialistCallContext(
        call_id="pending", agent_id="mover_quote", event_id=event.id,
        state="submitted", terminal_outcome="submitted",
        bid={"messages": [{"message_id": "msg_1"}]},
    )
    state.events[event.id] = event
    state.save_event(event)
    ctx = BuyerCallContext(
        call_id="call_persist", event_id=event.id, dispatched=True,
        collected={"origin_address": "123 Main St, SF, CA 94103"},
    )
    state.buyer_contexts[ctx.call_id] = ctx
    state.save_context(ctx)

    _reopen(db)
    events, contexts, recovered = state.load_from_persistence()

    assert (events, contexts, recovered) == (1, 1, 0)
    loaded = state.events["mkt_persist"]
    assert loaded.spec["origin_address"].startswith("123")
    call = loaded.specialist_calls["mover_quote"]
    assert call.state == "submitted"
    assert call.bid == {"messages": [{"message_id": "msg_1"}]}
    assert state.buyer_contexts["call_persist"].dispatched is True


def test_in_flight_specialists_recover_as_needs_user_action(db: Path) -> None:
    event = MarketplaceEvent(id="mkt_crash", homeowner_call_id="call_crash", spec={})
    event.specialist_calls["vet_transfer"] = SpecialistCallContext(
        call_id="pending", agent_id="vet_transfer", event_id=event.id,
        state="in-progress",
    )
    event.specialist_calls["bank_notify"] = SpecialistCallContext(
        call_id="pending", agent_id="bank_notify", event_id=event.id,
        state="needs-user-action", terminal_outcome="needs_user_action",
    )
    state.events[event.id] = event
    state.save_event(event)

    _reopen(db)
    _, _, recovered = state.load_from_persistence()

    assert recovered == 1
    crashed = state.events["mkt_crash"].specialist_calls["vet_transfer"]
    assert crashed.state == "needs-user-action"
    assert crashed.terminal_outcome == "needs_user_action"
    assert crashed.blocker_kind == "orchestrator_restart"
    untouched = state.events["mkt_crash"].specialist_calls["bank_notify"]
    assert untouched.blocker_kind is None


def test_completed_webhook_dedupe_survives_restart_but_in_flight_does_not(db: Path) -> None:
    now = time.time()
    assert security._begin_webhook("buyer", "wh_done", now) == "claimed"
    security.complete_agentphone_webhook("buyer", "wh_done")
    assert security._begin_webhook("buyer", "wh_open", now) == "claimed"

    security._WEBHOOK_DELIVERIES.clear()  # simulate restart of the in-memory cache
    restored = security.load_webhook_deliveries_from_persistence()

    assert restored == 1
    assert security._begin_webhook("buyer", "wh_done", time.time()) == "completed"
    # The interrupted delivery must stay retryable after a crash.
    assert security._begin_webhook("buyer", "wh_open", time.time()) == "claimed"


def test_unknown_fields_in_old_rows_are_ignored(db: Path) -> None:
    persistence.save_event("mkt_future", {
        "id": "mkt_future", "homeowner_call_id": "c", "spec": {},
        "some_future_field": 42, "specialist_calls": {},
    })
    fresh = AppState()
    events, _, _ = fresh.load_from_persistence()
    assert events == 1
    assert fresh.events["mkt_future"].spec == {}


def test_disabled_persistence_is_a_noop() -> None:
    assert persistence.enabled is False
    event = MarketplaceEvent(id="mkt_noop", homeowner_call_id="c", spec={})
    state.save_event(event)  # must not raise
    assert persistence.load_events() == {}
