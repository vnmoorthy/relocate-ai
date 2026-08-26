import assert from "node:assert/strict";
import test from "node:test";

import {
  cityFromAddress,
  formatMoveDate,
  mergeMoveTasks,
  moveAgentName,
  moveIdFromHash,
  moveSnapshotUrl,
  moveTaskCounts,
  parseMoveSnapshot,
  quoteTotalValue,
  replyLine,
  shortMoveRef,
  sortQuotedReplies,
  taskLine,
  type MoveReply,
  type MoveSpecialistSnapshot,
} from "./move-page.ts";

function specialist(overrides: Partial<MoveSpecialistSnapshot>): MoveSpecialistSnapshot {
  return {
    agent_id: "usps_coa",
    state: "dispatched",
    terminal_outcome: null,
    blocker_kind: null,
    closed_at: null,
    did: null,
    actionUrl: null,
    playbookTitle: null,
    playbookDelivered: false,
    ...overrides,
  };
}

function reply(overrides: Partial<MoveReply>): MoveReply {
  // Quote comparison only accepts replies attributed to a quote-soliciting
  // specialist, which is what a real mover reply carries.
  return {
    fromDomain: "uhaul.com",
    receivedAt: null,
    agentId: "mover_quote",
    quote: null,
    ...overrides,
  };
}

test("move id comes from the hash and rejects anything unsafe", () => {
  assert.equal(moveIdFromHash("#mkt_abc123"), "mkt_abc123");
  assert.equal(moveIdFromHash("mkt_abc123"), "mkt_abc123");
  assert.equal(moveIdFromHash("#Mkt-2026_x"), "Mkt-2026_x");
  assert.equal(moveIdFromHash(""), null);
  assert.equal(moveIdFromHash("#"), null);
  assert.equal(moveIdFromHash("#has spaces"), null);
  assert.equal(moveIdFromHash("#semi;colon"), null);
  assert.equal(moveIdFromHash("#" + "x".repeat(101)), null);
});

test("snapshot URL derives from the API origin and encodes the id", () => {
  assert.equal(
    moveSnapshotUrl("https://relay.example.org", "mkt_abc123"),
    "https://relay.example.org/api/public/move/mkt_abc123",
  );
  assert.equal(
    moveSnapshotUrl("https://relay.example.org/v1", "a b"),
    "https://relay.example.org/v1/api/public/move/a%20b",
  );
});

test("short move ref strips the mkt_ prefix and truncates", () => {
  assert.equal(shortMoveRef("mkt_abc123"), "abc123");
  assert.equal(shortMoveRef("mkt_0123456789abcdef"), "01234567");
  assert.equal(shortMoveRef("plainid"), "plainid");
});

test("city derives from the segment before the state/zip", () => {
  assert.equal(cityFromAddress("123 Main St, San Francisco, CA 94103"), "San Francisco");
  assert.equal(cityFromAddress("500 W 2nd St, Austin, TX 78701, USA"), "Austin");
  assert.equal(cityFromAddress("123 Main St, Austin, TX"), "Austin");
  assert.equal(cityFromAddress("San Francisco, CA"), "San Francisco");
  assert.equal(cityFromAddress("123 Main St, Austin TX 78701"), "Austin");
  assert.equal(cityFromAddress("123 Main St, San Francisco"), "San Francisco");
});

test("city falls back to the full string when unparseable", () => {
  assert.equal(cityFromAddress("Austin"), "Austin");
  assert.equal(cityFromAddress("  78701  "), "78701");
  assert.equal(cityFromAddress(""), "");
});

test("move date formats without timezone drift", () => {
  assert.equal(formatMoveDate("2026-09-15"), "Sep 15, 2026");
  assert.equal(formatMoveDate("2026-01-01"), "Jan 1, 2026");
  assert.equal(formatMoveDate("soon"), "soon");
  assert.equal(formatMoveDate(""), "");
});

test("snapshot parsing validates the contract and tolerates gaps", () => {
  const snapshot = parseMoveSnapshot({
    event_id: "mkt_abc123",
    route: {
      origin_address: "123 Main St, San Francisco, CA 94103",
      destination_address: "500 W 2nd St, Austin, TX 78701",
      move_date: "2026-09-15",
    },
    flags: { has_pets: true, has_children: false, has_car: true, has_visa: false },
    specialists: [
      {
        agent_id: "usps_coa",
        state: "submitted",
        terminal_outcome: "submitted",
        blocker_kind: null,
        closed_at: 123.4,
      },
      { agent_id: "", state: "submitted" },
      { agent_id: "pge_shutoff", state: 42 },
      "garbage",
    ],
    dispatched: true,
    finalized: false,
    final_outcome: null,
    ts: 1700000000,
  });
  assert.ok(snapshot);
  assert.equal(snapshot.event_id, "mkt_abc123");
  assert.equal(snapshot.route.move_date, "2026-09-15");
  assert.equal(snapshot.flags.has_pets, true);
  assert.equal(snapshot.flags.has_visa, false);
  assert.equal(snapshot.specialists.length, 1);
  assert.equal(snapshot.specialists[0].agent_id, "usps_coa");
  assert.equal(snapshot.specialists[0].closed_at, 123.4);
  assert.equal(snapshot.dispatched, true);
  assert.equal(snapshot.finalized, false);
});

test("snapshot parsing rejects fundamentally broken payloads", () => {
  assert.equal(parseMoveSnapshot(null), null);
  assert.equal(parseMoveSnapshot("nope"), null);
  assert.equal(parseMoveSnapshot({}), null);
  assert.equal(parseMoveSnapshot({ event_id: "" }), null);
  assert.equal(parseMoveSnapshot([]), null);
});

test("snapshot parsing defaults missing route/flags/specialists", () => {
  const snapshot = parseMoveSnapshot({ event_id: "mkt_x" });
  assert.ok(snapshot);
  assert.equal(snapshot.route.origin_address, "");
  assert.equal(snapshot.flags.has_car, false);
  assert.deepEqual(snapshot.specialists, []);
  assert.equal(snapshot.dispatched, false);
  assert.equal(snapshot.final_outcome, null);
});

test("task copy maps blockers first, then states, honestly", () => {
  assert.equal(
    taskLine("needs-user-action", "secure_user_workflow_required"),
    "Needs your signature or consent — we hand this to you with a playbook.",
  );
  assert.equal(
    taskLine("needs-user-action", "recipient_not_allowlisted"),
    "Outbound email is locked on this deployment until a recipient allowlist is set.",
  );
  assert.equal(taskLine("failed", "integration_unavailable"), "This provider path is gated on this deployment.");
  assert.equal(taskLine("needs-user-action", "missing_fields"), "Needs a few more details from you.");
  assert.equal(taskLine("needs-user-action", "orchestrator_restart"), "Interrupted mid-run — flagged for a re-check.");
  assert.equal(taskLine("submitted", null), "Request submitted — provider acceptance, not completion.");
  assert.equal(taskLine("failed", null), "Provider errored — shown honestly, never relabeled.");
  assert.equal(taskLine("error", null), "Provider errored — shown honestly, never relabeled.");
  assert.equal(taskLine("in-progress", null), "Working…");
  assert.equal(taskLine("calling", null), "Working…");
  assert.equal(taskLine("dispatched", null), "Queued");
  assert.equal(taskLine("idle", null), "Queued");
  assert.equal(taskLine("dispatched", "unknown_blocker"), "Queued");
});

test("a prepared playbook wins the user-action line; blocker copy is the fallback", () => {
  assert.equal(
    taskLine("needs-user-action", "secure_user_workflow_required", "PG&E shutoff call script", true),
    "Prepared: PG&E shutoff call script — sent to your inbox.",
  );
  assert.equal(
    taskLine("needs-user-action", null, "AR-11 address letter", true),
    "Prepared: AR-11 address letter — sent to your inbox.",
  );
  assert.equal(
    taskLine("needs-user-action", "secure_user_workflow_required", null),
    "Needs your signature or consent — we hand this to you with a playbook.",
  );
  // A playbook only explains a user-action row — other states keep their copy.
  assert.equal(
    taskLine("submitted", null, "PG&E shutoff call script"),
    "Request submitted — provider acceptance, not completion.",
  );
  assert.equal(taskLine("dispatched", null, "PG&E shutoff call script"), "Queued");
});

test("merge overlays live states over the snapshot and keeps roster order", () => {
  const tasks = mergeMoveTasks(
    [
      specialist({ agent_id: "mover_quote", state: "in-progress" }),
      specialist({ agent_id: "usps_coa", state: "dispatched" }),
      specialist({ agent_id: "buyer", state: "in-progress" }),
      specialist({
        agent_id: "uscis_ar11",
        state: "needs-user-action",
        blocker_kind: "secure_user_workflow_required",
      }),
    ],
    {
      usps_coa: { state: "submitted" },
      buyer: { state: "closed" },
      mystery_agent: { state: "failed" },
    },
  );

  assert.deepEqual(
    tasks.map((task) => task.agentId),
    ["usps_coa", "mover_quote", "uscis_ar11", "mystery_agent"],
  );
  assert.equal(tasks.find((t) => t.agentId === "usps_coa")?.state, "submitted");
  assert.equal(tasks.find((t) => t.agentId === "usps_coa")?.name, "USPS");
  assert.equal(tasks.find((t) => t.agentId === "mystery_agent")?.name, "mystery_agent");
  assert.equal(
    tasks.find((t) => t.agentId === "uscis_ar11")?.line,
    "Needs your signature or consent — we hand this to you with a playbook.",
  );
  assert.ok(!tasks.some((task) => task.agentId === "buyer"));
});

test("a blocker survives only while its state holds", () => {
  const base = [
    specialist({
      agent_id: "bank_notify",
      state: "needs-user-action",
      blocker_kind: "recipient_not_allowlisted",
    }),
  ];
  const unchanged = mergeMoveTasks(base, { bank_notify: { state: "needs-user-action" } });
  assert.equal(unchanged[0].blockerKind, "recipient_not_allowlisted");
  const changed = mergeMoveTasks(base, { bank_notify: { state: "submitted" } });
  assert.equal(changed[0].blockerKind, null);
  assert.equal(changed[0].line, "Request submitted — provider acceptance, not completion.");
});

test("merge threads the playbook through and shows the prepared line", () => {
  const base = [
    specialist({
      agent_id: "pge_shutoff",
      state: "needs-user-action",
      blocker_kind: "secure_user_workflow_required",
      playbookTitle: "PG&E shutoff call script",
      playbookDelivered: true,
    }),
    specialist({ agent_id: "usps_coa", state: "needs-user-action" }),
  ];
  const tasks = mergeMoveTasks(base, {});
  assert.equal(tasks[0].playbookTitle, "PG&E shutoff call script");
  assert.equal(tasks[0].line, "Prepared: PG&E shutoff call script — sent to your inbox.");
  // No playbook → the generic user-action copy still applies.
  assert.equal(tasks[1].playbookTitle, null);
  assert.equal(tasks[1].line, "Waiting on you — check your summary email for the handoff.");

  // Like the blocker, the playbook survives only while its state holds.
  const held = mergeMoveTasks(base, { pge_shutoff: { state: "needs-user-action" } });
  assert.equal(held[0].playbookTitle, "PG&E shutoff call script");
  const moved = mergeMoveTasks(base, { pge_shutoff: { state: "submitted" } });
  assert.equal(moved[0].playbookTitle, null);
  assert.equal(moved[0].line, "Request submitted — provider acceptance, not completion.");
});

test("counts keep submitted, done, action, failed, and working distinct", () => {
  const counts = moveTaskCounts([
    { state: "submitted" },
    { state: "submitted" },
    { state: "succeeded" },
    { state: "needs-user-action" },
    { state: "failed" },
    { state: "error" },
    { state: "in-progress" },
    { state: "calling" },
    { state: "dispatched" },
    { state: "voicemail" },
    { state: "closed" },
  ]);
  assert.deepEqual(counts, {
    total: 11,
    submitted: 2,
    done: 1,
    action: 1,
    failed: 2,
    working: 5,
  });
});

test("parseMoveSnapshot: replies keep domain+time, drop malformed rows", () => {
  const snap = parseMoveSnapshot({
    event_id: "mkt_x",
    specialists: [],
    replies: [
      { from_domain: "uhaul.com", received_at: 1700000000 },
      { from_domain: "pods.com" },
      { received_at: 5 },
      "junk",
    ],
  });
  assert.ok(snap);
  assert.deepEqual(snap.replies, [
    { fromDomain: "uhaul.com", receivedAt: 1700000000, agentId: null, quote: null },
    { fromDomain: "pods.com", receivedAt: null, agentId: null, quote: null },
  ]);
});

test("parseMoveSnapshot: missing replies array degrades to empty", () => {
  const snap = parseMoveSnapshot({ event_id: "mkt_x", specialists: [] });
  assert.ok(snap);
  assert.deepEqual(snap.replies, []);
});

test("parseMoveSnapshot: playbook_title survives only as a non-empty string", () => {
  const snap = parseMoveSnapshot({
    event_id: "mkt_x",
    specialists: [
      {
        agent_id: "pge_shutoff",
        state: "needs-user-action",
        playbook_title: "PG&E shutoff call script",
      },
      { agent_id: "usps_coa", state: "submitted", playbook_title: "" },
      { agent_id: "bank_notify", state: "dispatched", playbook_title: 42 },
      { agent_id: "gym_cancel", state: "dispatched" },
    ],
  });
  assert.ok(snap);
  assert.equal(snap.specialists[0].playbookTitle, "PG&E shutoff call script");
  assert.equal(snap.specialists[1].playbookTitle, null);
  assert.equal(snap.specialists[2].playbookTitle, null);
  assert.equal(snap.specialists[3].playbookTitle, null);
});

test("parseMoveSnapshot: reply agent_id + quote validate defensively", () => {
  const snap = parseMoveSnapshot({
    event_id: "mkt_x",
    specialists: [],
    replies: [
      {
        from_domain: "uhaul.com",
        received_at: 1700000000,
        agent_id: "mover_quote",
        quote: { total_display: "$3,150", deposit_display: "$500", availability: true },
      },
      // No deposit, availability anything-but-true → false.
      {
        from_domain: "pods.com",
        agent_id: "",
        quote: { total_display: "$2,900", deposit_display: null, availability: "yes" },
      },
      // Malformed quotes degrade to null, never throw.
      { from_domain: "a.com", agent_id: 7, quote: "garbage" },
      { from_domain: "b.com", quote: { deposit_display: "$100", availability: true } },
      { from_domain: "c.com", quote: { total_display: "", availability: true } },
      { from_domain: "d.com", quote: { total_display: 3150 } },
      { from_domain: "e.com", quote: [] },
    ],
  });
  assert.ok(snap);
  assert.deepEqual(snap.replies[0], {
    fromDomain: "uhaul.com",
    receivedAt: 1700000000,
    agentId: "mover_quote",
    quote: { totalDisplay: "$3,150", depositDisplay: "$500", availability: true },
  });
  assert.deepEqual(snap.replies[1].quote, {
    totalDisplay: "$2,900",
    depositDisplay: null,
    availability: false,
  });
  assert.equal(snap.replies[1].agentId, null);
  for (const row of snap.replies.slice(2)) {
    assert.equal(row.quote, null);
    assert.equal(row.agentId, null);
  }
});

test("reply line leads with quote facts when extracted, generic otherwise", () => {
  assert.equal(
    replyLine(null),
    "Emailed a response to your move — the full message is in your inbox.",
  );
  assert.equal(
    replyLine({ totalDisplay: "$3,150", depositDisplay: null, availability: false }),
    "Quoted $3,150 — full message in your inbox.",
  );
  assert.equal(
    replyLine({ totalDisplay: "$3,150", depositDisplay: "$500", availability: true }),
    "Quoted $3,150 · deposit $500 · availability confirmed — full message in your inbox.",
  );
  assert.equal(
    replyLine({ totalDisplay: "$2,900", depositDisplay: null, availability: true }),
    "Quoted $2,900 · availability confirmed — full message in your inbox.",
  );
});

test("reply agent labels map only known roster ids", () => {
  assert.equal(moveAgentName("mover_quote"), "Movers");
  assert.equal(moveAgentName("usps_coa"), "USPS");
  assert.equal(moveAgentName("mystery_agent"), null);
  assert.equal(moveAgentName(null), null);
});

test("quote totals parse as money and sort cheapest-first, unparseable last", () => {
  assert.equal(quoteTotalValue("$3,150"), 3150);
  assert.equal(quoteTotalValue("$3,150.50"), 3150.5);
  assert.equal(quoteTotalValue("2900"), 2900);
  assert.equal(quoteTotalValue("call for pricing"), null);
  assert.equal(quoteTotalValue(""), null);
  assert.equal(quoteTotalValue("$3,150-ish"), null);

  const quote = (totalDisplay: string) => ({
    totalDisplay,
    depositDisplay: null,
    availability: false,
  });
  const sorted = sortQuotedReplies([
    reply({ fromDomain: "pricey.com", quote: quote("$4,000") }),
    reply({ fromDomain: "no-quote.com" }),
    reply({ fromDomain: "vague.com", quote: quote("call us") }),
    reply({ fromDomain: "cheap.com", quote: quote("$2,900") }),
    reply({ fromDomain: "mid.com", quote: quote("$3,150.50") }),
  ]);
  assert.deepEqual(
    sorted.map((row) => row.fromDomain),
    ["cheap.com", "mid.com", "pricey.com", "vague.com"],
  );
});

test("fewer than two quotes yields nothing to compare", () => {
  const one = sortQuotedReplies([
    reply({ fromDomain: "no-quote.com" }),
    reply({
      fromDomain: "solo.com",
      quote: { totalDisplay: "$3,150", depositDisplay: null, availability: false },
    }),
  ]);
  assert.equal(one.length, 1);
  assert.equal(sortQuotedReplies([reply({})]).length, 0);
});

test("parseMoveSnapshot: public_ref parsed, malformed degrades to empty", () => {
  const withRef = parseMoveSnapshot({
    event_id: "mkt_x",
    public_ref: "pub_abc123",
    specialists: [],
  });
  assert.ok(withRef);
  assert.equal(withRef.public_ref, "pub_abc123");

  const withoutRef = parseMoveSnapshot({ event_id: "mkt_x", specialists: [] });
  assert.ok(withoutRef);
  assert.equal(withoutRef.public_ref, "");

  const badRef = parseMoveSnapshot({ event_id: "mkt_x", public_ref: 42, specialists: [] });
  assert.ok(badRef);
  assert.equal(badRef.public_ref, "");
});

test("taskLine claims an inbox delivery only when one actually happened", () => {
  assert.equal(
    taskLine("needs-user-action", "missing_fields", "PG&E shutoff call script", true),
    "Prepared: PG&E shutoff call script — sent to your inbox.",
  );
  assert.equal(
    taskLine("needs-user-action", "missing_fields", "PG&E shutoff call script", false),
    "Prepared: PG&E shutoff call script — emailing it to you.",
  );
});

test("taskLine does not call a customer-facing email a provider acceptance", () => {
  assert.equal(
    taskLine("submitted", null, null, false, "prepared_for_user"),
    "Prepared for you — the final step is yours.",
  );
  assert.equal(
    taskLine("submitted", null, null, false, "submitted"),
    "Request submitted — provider acceptance, not completion.",
  );
});

test("sortQuotedReplies compares only mover-quote replies", () => {
  const base = { fromDomain: "x.com", receivedAt: 1 };
  const quote = (total: string) => ({
    totalDisplay: total,
    depositDisplay: null,
    availability: false,
  });
  const sorted = sortQuotedReplies([
    { ...base, agentId: "school_district", quote: quote("$95") },
    { ...base, agentId: "mover_quote", quote: quote("$3,420") },
    { ...base, agentId: null, quote: quote("$10") },
    { ...base, agentId: "mover_quote", quote: quote("$2,980") },
  ] as MoveReply[]);
  assert.equal(sorted.length, 2);
  assert.equal(sorted[0].quote.totalDisplay, "$2,980");
  assert.equal(sorted[1].quote.totalDisplay, "$3,420");
});

test("parseMoveSnapshot reads playbook_delivered strictly", () => {
  const snap = parseMoveSnapshot({
    event_id: "mkt_x",
    specialists: [
      { agent_id: "pge_shutoff", state: "needs-user-action",
        playbook_title: "PG&E shutoff call script", playbook_delivered: true },
      { agent_id: "usps_coa", state: "needs-user-action",
        playbook_title: "USPS change-of-address walkthrough" },
    ],
  });
  assert.ok(snap);
  assert.equal(snap.specialists[0].playbookDelivered, true);
  assert.equal(snap.specialists[1].playbookDelivered, false);
});

test("taskLine: a submitted specialist says who it actually asked", () => {
  // "Request submitted" reads identically whether one provider was emailed
  // or twelve; the server's own account is more honest and more useful.
  assert.equal(
    taskLine("submitted", null, null, false, "submitted", "Requested from 3 providers"),
    "Requested from 3 providers — awaiting their reply.",
  );
  assert.equal(
    taskLine("submitted", null, null, false, "prepared_for_user", "Sent to your inbox"),
    "Sent to your inbox — the final step is yours.",
  );
  // Without a server account, the honest generic wording still stands.
  assert.equal(
    taskLine("submitted", null, null, false, "submitted", null),
    "Request submitted — provider acceptance, not completion.",
  );
});

test("parseMoveSnapshot: proof-of-work counters default to zero", () => {
  const full = parseMoveSnapshot({
    event_id: "mkt_x",
    specialists: [],
    outbound_requests: 6,
    replies_received: 2,
  });
  assert.ok(full);
  assert.equal(full.outboundRequests, 6);
  assert.equal(full.repliesReceived, 2);

  const bare = parseMoveSnapshot({ event_id: "mkt_x", specialists: [] });
  assert.ok(bare);
  assert.equal(bare.outboundRequests, 0);
  assert.equal(bare.repliesReceived, 0);
});
