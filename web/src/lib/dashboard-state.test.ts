import assert from "node:assert/strict";
import test from "node:test";

import {
  applyDashboardEvent,
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

test("a new event id resets prior customer session state", () => {
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
  state = applyDashboardEvent(state, routingEvent("evt-2", 1, 3));

  assert.equal(state.eventId, "evt-2");
  assert.equal(state.routingDecisionCount, 1);
  assert.deepEqual(state.collectedFields, {});
  assert.equal(state.connection, "live");
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

test("demo timeline is sorted, conditional, finalized, and uses submitted terminal states", () => {
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
      (event) =>
        event.type === "agent_state" &&
        event.agent_id !== "buyer" &&
        event.state === "submitted",
    ),
  );
  assert.ok(
    events.some(
      (event) => event.type === "agent_state" && event.agent_id === "buyer" && event.state === "closed",
    ),
  );
  const finalized = events.find((event) => event.type === "event_finalized");
  assert.ok(finalized && finalized.type === "event_finalized");
  assert.equal(finalized.summary?.submitted_count, 16);
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
