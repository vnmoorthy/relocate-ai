import assert from "node:assert/strict";
import test from "node:test";

import {
  cityFromAddress,
  formatMoveDate,
  mergeMoveTasks,
  moveIdFromHash,
  moveSnapshotUrl,
  moveTaskCounts,
  parseMoveSnapshot,
  shortMoveRef,
  taskLine,
  type MoveSpecialistSnapshot,
} from "./move-page.ts";

function specialist(overrides: Partial<MoveSpecialistSnapshot>): MoveSpecialistSnapshot {
  return {
    agent_id: "usps_coa",
    state: "dispatched",
    terminal_outcome: null,
    blocker_kind: null,
    closed_at: null,
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
