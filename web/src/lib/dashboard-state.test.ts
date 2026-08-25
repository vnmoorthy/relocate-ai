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
  sponsorStatus,
} from "./dashboard-state.ts";
import { buildDemoTimeline } from "./demo-replay.ts";
import { publicFeedText, redactDisplayText } from "./privacy.ts";
import type { RoutingDecisionEvent } from "./types.ts";

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
  // YC demo roster: full household flags → all 16 specialists + buyer.
  assert.ok(agentIds.has("school_district"));
  assert.ok(agentIds.has("uscis_ar11"));
  assert.ok(agentIds.has("vet_transfer"));
  assert.ok(agentIds.has("geico_address"));
  assert.equal(agentIds.size, 17);
  assert.ok(
    events.some(
      (event) => event.type === "agent_state" && event.agent_id === "buyer" && event.state === "closed",
    ),
  );

  // Terminal-state table: 12 submitted, 3 needs-user-action handoffs, 1 failed.
  const terminal = new Map<string, string>();
  for (const event of events) {
    if (
      event.type === "agent_state" &&
      event.agent_id !== "buyer" &&
      (event.state === "submitted" || event.state === "needs-user-action" || event.state === "failed")
    ) {
      terminal.set(event.agent_id, event.state);
    }
  }
  assert.equal(terminal.size, 16);
  assert.equal(terminal.get("spectrum_austin"), "failed");
  assert.equal(terminal.get("uscis_ar11"), "needs-user-action");
  assert.equal(terminal.get("pcp_transfer"), "needs-user-action");
  assert.equal(terminal.get("gym_cancel"), "needs-user-action");
  const terminalCounts = { submitted: 0, "needs-user-action": 0, failed: 0 } as Record<string, number>;
  for (const state of terminal.values()) terminalCounts[state] += 1;
  assert.equal(terminalCounts.submitted, 12);
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
  assert.equal(finalized.summary?.submitted_count, 12);
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
