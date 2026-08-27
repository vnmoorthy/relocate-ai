import assert from "node:assert/strict";
import test from "node:test";

import {
  applyDashboardEvent,
  withJitter,
  createDashboardState,
  dashboardEventKey,
  parseDashboardEvent,
  parseDashboardMessage,
  reconnectDelay,
  replayAgeLabel,
  sponsorStatus,
} from "./dashboard-state.ts";
import { buildDemoTimeline } from "./demo-replay.ts";
import { publicFeedText, redactDisplayText } from "./privacy.ts";
import { isPreparedOutcome } from "./types.ts";
import type { RoutingDecisionEvent, WSEvent } from "./types.ts";

function routingEvent(eventId: string, turn: number, ts = turn): RoutingDecisionEvent {
  return {
    type: "routing_decision",
    event_id: eventId,
    agent_id: "buyer",
    turn,
    tier: "gemma-local",
    reason: "unit-test",
    complexity: 0.1,
    ts,
  };
}

test("runtime parser accepts the protocol and rejects malformed payloads", () => {
  const valid = routingEvent("evt-1", 1);
  assert.deepEqual(parseDashboardEvent(valid), valid);
  assert.deepEqual(parseDashboardMessage(JSON.stringify(valid)), valid);
  assert.equal(parseDashboardMessage("not-json"), null);
  assert.equal(parseDashboardEvent({ ...valid, tier: "invented-model" }), null);
  assert.equal(parseDashboardEvent({ ...valid, complexity: "hard" }), null);
  assert.equal(parseDashboardEvent({ type: "agent_state", event_id: "evt", ts: 1 }), null);
  assert.notEqual(
    parseDashboardEvent({
      type: "agent_state",
      event_id: "evt",
      agent_id: "mover_quote",
      state: "submitted",
      ts: 1,
    }),
    null,
  );
  assert.equal(
    parseDashboardEvent({
      type: "event_waiting_for_user",
      event_id: "evt",
      agents: ["bank_notify"],
      count: 2,
      ts: 1,
    }),
    null,
  );
  assert.notEqual(
    parseDashboardEvent({
      type: "event_finalized",
      event_id: "evt",
      outcome: "partial_failure",
      summary: {
        submitted_count: 3,
        failed_count: 1,
        summary_email_sent: true,
        memory_persisted: false,
      },
      ts: 2,
    }),
    null,
  );
  assert.equal(
    parseDashboardEvent({
      type: "event_finalized",
      event_id: "evt",
      outcome: "submitted",
      summary: { submitted_count: 3, failed_count: 0 },
      ts: 2,
    }),
    null,
  );
});

test("a concurrent event id cannot steal the stage from an active move", () => {
  let state = createDashboardState("live");
  state = applyDashboardEvent(state, routingEvent("evt-1", 1));
  state = applyDashboardEvent(state, {
    type: "fields_collected",
    event_id: "evt-1",
    turn: 1,
    fields: ["user_email"],
    values: { user_email: "private@example.com" },
    ts: 2,
  });
  // Someone else dispatches evt-2 seconds later — the pinned move stays up.
  state = applyDashboardEvent(state, routingEvent("evt-2", 1, 3));

  assert.equal(state.eventId, "evt-1");
  assert.equal(state.routingDecisionCount, 1);
  assert.deepEqual(state.collectedFields, { user_email: "private@example.com" });
});

test("a finalized event releases the stage to the next event id", () => {
  let state = createDashboardState("live");
  state = applyDashboardEvent(state, routingEvent("evt-1", 1));
  state = applyDashboardEvent(state, {
    type: "event_finalized",
    event_id: "evt-1",
    outcome: "submitted",
    summary: { submitted_count: 4, failed_count: 0 },
    ts: 5,
  } as unknown as Parameters<typeof applyDashboardEvent>[1]);
  state = applyDashboardEvent(state, routingEvent("evt-2", 1, 6));

  assert.equal(state.eventId, "evt-2");
  assert.deepEqual(state.collectedFields, {});
});

test("a silent pinned event yields the stage after the takeover window", () => {
  let state = createDashboardState("live");
  state = applyDashboardEvent(state, routingEvent("evt-1", 1, 10));
  // 119s of silence: still pinned.
  state = applyDashboardEvent(state, routingEvent("evt-2", 1, 129));
  assert.equal(state.eventId, "evt-1");
  // 120s+: the new move takes over.
  state = applyDashboardEvent(state, routingEvent("evt-2", 1, 130));
  assert.equal(state.eventId, "evt-2");
});

test("withJitter stays within ±30% and is deterministic under injected random", () => {
  assert.equal(withJitter(1000, () => 0), 700);
  assert.equal(withJitter(1000, () => 1), 1300);
  assert.equal(withJitter(1000, () => 0.5), 1000);
});

test("cumulative counts survive recent-feed limits and completion is represented", () => {
  let state = createDashboardState("live");
  for (let turn = 1; turn <= 125; turn += 1) {
    state = applyDashboardEvent(state, routingEvent("evt-count", turn));
  }
  state = applyDashboardEvent(state, {
    type: "event_complete",
    event_id: "evt-count",
    summary: { succeeded: 12, needs_user_action: 2, failed: 1 },
    ts: 200,
  });

  assert.equal(state.routingDecisionCount, 125);
  assert.equal(state.routingDecisions.length, 100);
  assert.equal(state.tierCounts["gemma-local"], 125);
  assert.equal(state.completed, true);
  assert.deepEqual(state.completionSummary, { succeeded: 12, needs_user_action: 2, failed: 1 });
});

test("waiting and finalized events preserve submitted versus succeeded semantics", () => {
  let state = createDashboardState("live");
  state = applyDashboardEvent(state, {
    type: "agent_state",
    event_id: "evt-final",
    agent_id: "usps_coa",
    state: "submitted",
    ts: 1,
  });
  state = applyDashboardEvent(state, {
    type: "event_waiting_for_user",
    event_id: "evt-final",
    agents: ["bank_notify"],
    count: 1,
    ts: 2,
  });
  assert.deepEqual(state.waitingForUserAgents, ["bank_notify"]);
  assert.equal(state.completed, false);

  state = applyDashboardEvent(state, {
    type: "event_finalized",
    event_id: "evt-final",
    outcome: "submitted",
    summary: {
      submitted_count: 1,
      failed_count: 0,
      summary_email_sent: true,
      memory_persisted: true,
    },
    ts: 3,
  });
  assert.equal(state.finalized, true);
  assert.equal(state.finalOutcome, "submitted");
  assert.equal(state.completed, false);
  assert.deepEqual(state.waitingForUserAgents, []);
  assert.equal(state.agentStates.usps_coa.state, "submitted");
});

test("submitted and succeeded remain distinct terminal outcomes", () => {
  let state = createDashboardState("live");
  state = applyDashboardEvent(state, {
    type: "agent_state",
    event_id: "evt-outcomes",
    agent_id: "mover_quote",
    state: "submitted",
    ts: 1,
  });
  state = applyDashboardEvent(state, {
    type: "agent_state",
    event_id: "evt-outcomes",
    agent_id: "flight_book",
    state: "succeeded",
    ts: 2,
  });

  assert.equal(state.agentStates.mover_quote.state, "submitted");
  assert.equal(state.agentStates.flight_book.state, "succeeded");
  assert.notEqual(state.agentStates.mover_quote.state, state.agentStates.flight_book.state);
});

test("a missing cost baseline is valid and remains unmeasured", () => {
  const event = {
    type: "cost_update" as const,
    event_id: "evt-cost",
    pavo_cents: 0.25,
    baseline_cents: null,
    ts: 1,
  };
  assert.deepEqual(parseDashboardEvent(event), event);

  const state = applyDashboardEvent(createDashboardState("live"), event);
  assert.equal(state.pavoCents, 0.25);
  assert.equal(state.baselineCents, null);
  assert.equal(parseDashboardEvent({ ...event, pavo_cents: -1 }), null);
  assert.equal(parseDashboardEvent({ ...event, baseline_cents: -1 }), null);
});

test("event keys deduplicate exact retries without collapsing separate events", () => {
  const first = routingEvent("evt-key", 1, 10);
  const duplicate = { ...first };
  const next = routingEvent("evt-key", 2, 11);
  assert.equal(dashboardEventKey(first), dashboardEventKey(duplicate));
  assert.notEqual(dashboardEventKey(first), dashboardEventKey(next));
});

test("sponsor status is derived from received events and current mode", () => {
  assert.equal(sponsorStatus(undefined, false), "idle");
  assert.equal(sponsorStatus({ action: "receipt_sent" }, false), "reported");
  assert.equal(sponsorStatus({ action: "receipt_sent" }, true), "demo");
  assert.equal(sponsorStatus({ action: "stubbed" }, false), "fallback");
  assert.equal(sponsorStatus({ action: "playbook_fallback" }, false), "fallback");
  assert.equal(sponsorStatus({ action: "error" }, false), "error");
});

test("demo timeline is sorted, conditional, finalized, and uses honest terminal states", () => {
  const timeline = buildDemoTimeline();
  assert.ok(timeline.length > 0);
  assert.deepEqual(
    timeline.map((item) => item.at_ms),
    timeline.map((item) => item.at_ms).toSorted((a, b) => a - b),
  );
  assert.ok(timeline.some((item) => item.event.type === "fields_collected"));
  assert.equal(timeline.at(-1)?.event.type, "event_finalized");

  const events = timeline.map((item) => item.event);
  const agentIds = new Set(
    events.flatMap((event) => ("agent_id" in event ? [event.agent_id] : [])),
  );
  // The replay covers the whole roster: 28 specialists + buyer, with the
  // conditional ones present because DEMO_SPEC sets every household flag.
  assert.ok(agentIds.has("school_district"));
  assert.ok(agentIds.has("uscis_ar11"));
  assert.ok(agentIds.has("vet_transfer"));
  assert.ok(agentIds.has("geico_address"));
  // Prepared specialists animate too, or the stage would sit half idle while
  // the copy claims 28 dispatch.
  assert.ok(agentIds.has("housing_search"));
  assert.ok(agentIds.has("landlord_notice"));
  assert.ok(agentIds.has("fx_planning"));
  assert.equal(agentIds.size, 29);
  assert.ok(
    events.some(
      (event) => event.type === "agent_state" && event.agent_id === "buyer" && event.state === "closed",
    ),
  );

  // Terminal-state table: 10 submitted, 14 prepared, 3 handoffs, 1 failed.
  const terminal = new Map<string, string>();
  for (const event of events) {
    if (
      event.type === "agent_state" &&
      event.agent_id !== "buyer" &&
      (event.state === "submitted" ||
        event.state === "prepared" ||
        event.state === "needs-user-action" ||
        event.state === "failed")
    ) {
      terminal.set(event.agent_id, event.state);
    }
  }
  assert.equal(terminal.size, 28);
  assert.equal(terminal.get("spectrum_austin"), "failed");
  assert.equal(terminal.get("uscis_ar11"), "needs-user-action");
  assert.equal(terminal.get("pcp_transfer"), "needs-user-action");
  assert.equal(terminal.get("gym_cancel"), "needs-user-action");
  // A specialist that contacted a counterparty and one that contacted nobody
  // must not share a terminal state, in the replay any more than live.
  assert.equal(terminal.get("pge_shutoff"), "submitted");
  assert.equal(terminal.get("housing_search"), "prepared");
  assert.equal(terminal.get("bank_notify"), "prepared");
  assert.equal(terminal.get("flight_book"), "prepared");
  const terminalCounts = {
    submitted: 0, prepared: 0, "needs-user-action": 0, failed: 0,
  } as Record<string, number>;
  for (const state of terminal.values()) terminalCounts[state] += 1;
  // 10 provider-facing submitted, 14 prepared, 3 handoffs, 1 failure.
  assert.equal(terminalCounts.submitted, 10);
  assert.equal(terminalCounts.prepared, 14);
  assert.equal(terminalCounts["needs-user-action"], 3);
  assert.equal(terminalCounts.failed, 1);

  // The signature/consent handoffs surface as an explicit waiting event.
  const waiting = events.find((event) => event.type === "event_waiting_for_user");
  assert.ok(waiting && waiting.type === "event_waiting_for_user");
  assert.deepEqual(
    [...waiting.agents].toSorted(),
    ["gym_cancel", "pcp_transfer", "uscis_ar11"],
  );
  assert.equal(waiting.count, 3);

  const finalized = events.find((event) => event.type === "event_finalized");
  assert.ok(finalized && finalized.type === "event_finalized");
  assert.equal(finalized.outcome, "partial_failure");
  // submitted_count is provider acceptances only — prepared work is not one.
  assert.equal(finalized.summary?.submitted_count, 10);
  assert.equal(finalized.summary?.failed_count, 1);
});

test("demo timeline pacing: ~60s stage arc with no dead air and a mid-run failure", () => {
  const timeline = buildDemoTimeline();

  // Finalization lands in the 55–65s window.
  const finalAt = timeline.at(-1)?.at_ms ?? 0;
  assert.ok(finalAt >= 55_000 && finalAt <= 65_000, `final event at ${finalAt}ms`);

  // No stretch longer than 5s where nothing changes on screen.
  for (let i = 1; i < timeline.length; i++) {
    const gap = timeline[i].at_ms - timeline[i - 1].at_ms;
    assert.ok(gap <= 5000, `dead air of ${gap}ms before index ${i}`);
  }

  // The spectrum failure lands mid-run, while other specialists are still open,
  // so failure isolation is visible on stage.
  const failedAt = timeline.find(
    (item) =>
      item.event.type === "agent_state" &&
      item.event.agent_id === "spectrum_austin" &&
      item.event.state === "failed",
  )?.at_ms;
  assert.ok(typeof failedAt === "number");
  const terminalAfterFailure = timeline.filter(
    (item) =>
      item.event.type === "agent_state" &&
      item.event.agent_id !== "buyer" &&
      item.event.agent_id !== "spectrum_austin" &&
      (item.event.state === "submitted" || item.event.state === "needs-user-action") &&
      item.at_ms > failedAt,
  );
  assert.ok(terminalAfterFailure.length >= 12, "most specialists outlive the failure");

  // Deterministic between loops.
  assert.deepEqual(buildDemoTimeline(), timeline);
});

test("display redaction hides common identifiers", () => {
  const redacted = redactDisplayText(
    "Email private@example.com, account 5512-4419-08, tracking 9407 1118 9899 9988 8772 65, event_id=evt_secret_123, home 123 Main St",
  );
  assert.equal(redacted.includes("private@example.com"), false);
  assert.equal(redacted.includes("5512-4419-08"), false);
  assert.equal(redacted.includes("9407 1118"), false);
  assert.equal(redacted.includes("evt_secret_123"), false);
  assert.equal(redacted.includes("123 Main St"), false);
  assert.equal(
    publicFeedText("Patient Alex Example", false, "Live content hidden."),
    "Live content hidden.",
  );
  assert.equal(
    publicFeedText("Synthetic message for demo@example.com", true, "hidden"),
    "Synthetic message for [email redacted]",
  );
});

test("reconnect backoff is bounded", () => {
  assert.equal(reconnectDelay(0), 1000);
  assert.equal(reconnectDelay(3), 8000);
  assert.equal(reconnectDelay(20), 30_000);
});

test("prepared is a state of its own, and terminal_outcome rides along", () => {
  assert.notEqual(
    parseDashboardEvent({
      type: "agent_state",
      event_id: "evt",
      agent_id: "housing_search",
      state: "prepared",
      ts: 1,
    }),
    null,
  );
  assert.notEqual(
    parseDashboardEvent({
      type: "agent_state",
      event_id: "evt",
      agent_id: "housing_search",
      state: "submitted",
      terminal_outcome: "prepared_for_user",
      ts: 1,
    }),
    null,
  );
  assert.equal(
    parseDashboardEvent({
      type: "agent_state",
      event_id: "evt",
      agent_id: "housing_search",
      state: "submitted",
      terminal_outcome: 7,
      ts: 1,
    }),
    null,
  );

  // The outcome has to survive into state, or the console cannot tell a
  // provider acceptance from a document prepared for the customer.
  let state = createDashboardState("live");
  state = applyDashboardEvent(state, {
    type: "agent_state",
    event_id: "evt-prepared",
    agent_id: "housing_search",
    state: "submitted",
    terminal_outcome: "prepared_for_user",
    ts: 1,
  });
  state = applyDashboardEvent(state, {
    type: "agent_state",
    event_id: "evt-prepared",
    agent_id: "mover_quote",
    state: "submitted",
    ts: 2,
  });
  assert.equal(state.agentStates.housing_search.terminalOutcome, "prepared_for_user");
  assert.equal(state.agentStates.mover_quote.terminalOutcome, null);
  assert.equal(isPreparedOutcome("submitted", "prepared_for_user"), true);
  assert.equal(isPreparedOutcome("prepared", null), true);
  assert.equal(isPreparedOutcome("submitted", "submitted"), false);
  assert.equal(isPreparedOutcome("needs-user-action", "prepared_for_user"), false);
});

test("a stage built from replay alone is marked as replay until a live event lands", () => {
  const bootstrap = (agentId: string, ts: number): WSEvent => ({
    type: "agent_state",
    event_id: "evt-replay",
    agent_id: agentId,
    state: "submitted",
    ts,
    bootstrap: true,
  });

  let state = createDashboardState("live");
  assert.equal(state.replayedAt, null);
  state = applyDashboardEvent(state, bootstrap("pge_shutoff", 1_000));
  state = applyDashboardEvent(state, bootstrap("usps_coa", 1_200));
  // The stage is populated, so the counters render — but nothing here is
  // happening now, and replayedAt is what lets the page say so.
  assert.equal(state.eventId, "evt-replay");
  assert.equal(state.lastEventTs, null);
  assert.equal(state.replayedAt, 1_200);

  state = applyDashboardEvent(state, {
    type: "agent_state",
    event_id: "evt-replay",
    agent_id: "mover_quote",
    state: "in-progress",
    ts: 1_500,
  });
  assert.equal(state.replayedAt, null);
  assert.equal(state.lastEventTs, 1_500);
});

test("replay age is stated in words, and clock skew never reads as the future", () => {
  assert.equal(replayAgeLabel(1_000, 1_000), "just now");
  assert.equal(replayAgeLabel(1_000, 900), "just now");
  assert.equal(replayAgeLabel(1_000, 1_089), "just now");
  assert.equal(replayAgeLabel(1_000, 1_000 + 60 * 5), "5m ago");
  assert.equal(replayAgeLabel(1_000, 1_000 + 3600 * 2), "2h ago");
  assert.equal(replayAgeLabel(1_000, 1_000 + 86_400 * 3), "3d ago");
});

test("demo routing reaches the public swarm, so its counter stops saying submitted", () => {
  // The stage counts "N submitted" straight off the feed, and the feed is the
  // only place it could learn that this deployment rewrites every recipient
  // to its own inbox. Without the flag the marketing page credited the swarm
  // with provider acceptances the tracker beside it denied.
  const frame = {
    type: "agent_state",
    event_id: "evt-demoroute",
    agent_id: "mover_quote",
    state: "submitted",
    terminal_outcome: "submitted",
    demo_routing: true,
    ts: 3,
  };
  assert.notEqual(parseDashboardEvent(frame), null);
  // A non-boolean is rejected rather than coerced, like every other field.
  assert.equal(parseDashboardEvent({ ...frame, demo_routing: "yes" }), null);

  let state = createDashboardState("live");
  state = applyDashboardEvent(state, frame as never);
  assert.equal(state.agentStates.mover_quote.demoRouting, true);
  assert.equal(
    isPreparedOutcome(
      state.agentStates.mover_quote.state,
      state.agentStates.mover_quote.terminalOutcome,
      state.agentStates.mover_quote.demoRouting,
    ),
    true,
  );

  // Normal routing is untouched: a real submission is still a submission.
  let normal = createDashboardState("live");
  normal = applyDashboardEvent(normal, { ...frame, demo_routing: false } as never);
  assert.equal(normal.agentStates.mover_quote.demoRouting, false);
  assert.equal(isPreparedOutcome("submitted", "submitted", false), false);
});
