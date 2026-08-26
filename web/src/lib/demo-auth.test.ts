import assert from "node:assert/strict";
import test from "node:test";

import {
  DEMO_SESSION_KEY,
  bearerHeaders,
  clearDemoSession,
  demoCountChips,
  demoLoginErrorMessage,
  demoLoginUrl,
  demoMovesUrl,
  isSessionActive,
  loadDemoSession,
  parseDemoLogin,
  parseDemoMoves,
  parseStoredSession,
  saveDemoSession,
  serializeSession,
  sortDemoMoves,
  validateDemoLogin,
  type DemoSession,
  type SessionStore,
  hasAccessKey,
} from "./demo-auth.ts";
import { buildStartMovePayload, type StartMoveInput } from "./live-config.ts";
import type { MoveTaskCounts } from "./move-page.ts";

/** In-memory stand-in for sessionStorage. */
function memoryStore(seed: Record<string, string> = {}): SessionStore & { data: Record<string, string> } {
  const data: Record<string, string> = { ...seed };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

/** A store that throws on every operation — Safari private mode, roughly. */
function hostileStore(): SessionStore {
  return {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  };
}

const SESSION: DemoSession = { token: "opaque-token", expiresAt: 2_000 };

function counts(overrides: Partial<MoveTaskCounts> = {}): MoveTaskCounts {
  return { total: 0, working: 0, submitted: 0, action: 0, failed: 0, done: 0, ...overrides };
}

// ── Endpoints ─────────────────────────────────────────────────────────────

test("demo endpoints derive from the discovered API origin", () => {
  assert.equal(demoLoginUrl("https://relay.example.org"), "https://relay.example.org/api/public/demo-login");
  assert.equal(demoMovesUrl("https://relay.example.org"), "https://relay.example.org/api/public/demo/moves");
  assert.equal(demoMovesUrl("https://relay.example.org/v1"), "https://relay.example.org/v1/api/public/demo/moves");
  assert.deepEqual(bearerHeaders("abc"), { authorization: "Bearer abc" });
});

// ── Login payload ─────────────────────────────────────────────────────────

test("login response is validated field by field", () => {
  assert.deepEqual(parseDemoLogin({ token: "t", expires_at: 1750000000 }), {
    token: "t",
    expiresAt: 1750000000,
  });
  // Extra keys are ignored, not trusted.
  assert.deepEqual(parseDemoLogin({ token: "t", expires_at: 5, role: "admin" }), {
    token: "t",
    expiresAt: 5,
  });
});

test("login response rejects anything that is not a token plus an expiry", () => {
  assert.equal(parseDemoLogin(null), null);
  assert.equal(parseDemoLogin("token"), null);
  assert.equal(parseDemoLogin([]), null);
  assert.equal(parseDemoLogin({}), null);
  assert.equal(parseDemoLogin({ token: "", expires_at: 5 }), null);
  assert.equal(parseDemoLogin({ token: 42, expires_at: 5 }), null);
  assert.equal(parseDemoLogin({ token: "t" }), null);
  assert.equal(parseDemoLogin({ token: "t", expires_at: "5" }), null);
  assert.equal(parseDemoLogin({ token: "t", expires_at: Number.NaN }), null);
  assert.equal(parseDemoLogin({ token: "t", expires_at: Number.POSITIVE_INFINITY }), null);
  assert.equal(parseDemoLogin({ token: "x".repeat(4097), expires_at: 5 }), null);
});

// ── Session lifecycle ─────────────────────────────────────────────────────

test("a session round-trips through the store in its wire shape", () => {
  assert.equal(serializeSession(SESSION), '{"token":"opaque-token","expires_at":2000}');
  assert.deepEqual(parseStoredSession(serializeSession(SESSION)), SESSION);
});

test("a corrupt or absent stored session reads as signed out", () => {
  assert.equal(parseStoredSession(null), null);
  assert.equal(parseStoredSession(""), null);
  assert.equal(parseStoredSession("not json"), null);
  assert.equal(parseStoredSession("{}"), null);
  assert.equal(parseStoredSession('{"token":"t"}'), null);
});

test("expiry is a hard edge: the stated second is already gone", () => {
  assert.equal(isSessionActive(SESSION, 1_999), true);
  assert.equal(isSessionActive(SESSION, 2_000), false);
  assert.equal(isSessionActive(SESSION, 2_001), false);
  assert.equal(isSessionActive(null, 1_999), false);
  assert.equal(isSessionActive(SESSION, Number.NaN), false);
});

test("store, restore, and sign out", () => {
  const store = memoryStore();
  saveDemoSession(store, SESSION);
  assert.equal(store.data[DEMO_SESSION_KEY], serializeSession(SESSION));
  assert.deepEqual(loadDemoSession(store, 1_000), SESSION);
  clearDemoSession(store);
  assert.equal(DEMO_SESSION_KEY in store.data, false);
  assert.equal(loadDemoSession(store, 1_000), null);
});

test("an expired stored session reads as signed out and is dropped", () => {
  const store = memoryStore({ [DEMO_SESSION_KEY]: serializeSession(SESSION) });
  assert.equal(loadDemoSession(store, 2_001), null);
  assert.equal(DEMO_SESSION_KEY in store.data, false, "expired session is cleared, not left behind");
});

test("a corrupt stored session is reported as signed out", () => {
  const store = memoryStore({ [DEMO_SESSION_KEY]: "{oops" });
  assert.equal(loadDemoSession(store, 1_000), null);
});

test("a missing or blocked store never throws", () => {
  assert.equal(loadDemoSession(null, 1_000), null);
  saveDemoSession(null, SESSION);
  clearDemoSession(null);
  const hostile = hostileStore();
  assert.equal(loadDemoSession(hostile, 1_000), null);
  saveDemoSession(hostile, SESSION);
  clearDemoSession(hostile);
});

// ── Form + error copy ─────────────────────────────────────────────────────

test("login form only checks that both fields were filled in", () => {
  assert.equal(validateDemoLogin("relocate", "hunter2"), null);
  assert.equal(validateDemoLogin("  ", "hunter2"), "Enter the demo username.");
  assert.equal(validateDemoLogin("relocate", ""), "Enter the demo password.");
});

test("sign-in errors are specific and never blame the reader", () => {
  assert.match(demoLoginErrorMessage(401, { detail: "invalid credentials" }), /weren't accepted/);
  assert.match(demoLoginErrorMessage(429, null), /Too many sign-in attempts/);
  assert.match(demoLoginErrorMessage(503, null), /switched off/);
  assert.match(demoLoginErrorMessage(500, null), /error on its side/);
  // An unexpected status falls back to the server's own words when it sent any.
  assert.equal(demoLoginErrorMessage(418, { detail: "teapot" }), "teapot");
  assert.match(demoLoginErrorMessage(418, null), /HTTP 418/);
});

// ── Workspace move list ───────────────────────────────────────────────────

const MOVES_BODY = {
  moves: [
    {
      event_id: "mkt_older",
      public_ref: "pub_older",
      route: { origin_address: "1 A St, Austin, TX 78701", destination_address: "2 B St, Denver, CO 80202", move_date: "2026-09-15" },
      counts: { submitted: 3, action: 1, failed: 0, working: 2, done: 1, total: 7 },
      started_at: 1000,
      finalized: false,
    },
    {
      event_id: "mkt_newer",
      public_ref: "pub_newer",
      route: { origin_address: "3 C St", destination_address: "4 D St", move_date: "2026-10-01" },
      counts: { submitted: 0, action: 0, failed: 0, working: 0, done: 0, total: 0 },
      started_at: 2000,
      finalized: true,
    },
  ],
};

test("workspace move list is validated row by row", () => {
  const moves = parseDemoMoves(MOVES_BODY);
  assert.equal(moves.length, 2);
  assert.equal(moves[0].eventId, "mkt_older");
  assert.equal(moves[0].publicRef, "pub_older");
  assert.equal(moves[0].route.destinationAddress, "2 B St, Denver, CO 80202");
  assert.deepEqual(moves[0].counts, counts({ submitted: 3, action: 1, working: 2, done: 1, total: 7 }));
  assert.equal(moves[0].startedAt, 1000);
  assert.equal(moves[1].finalized, true);
});

test("malformed move rows degrade instead of throwing", () => {
  assert.deepEqual(parseDemoMoves(null), []);
  assert.deepEqual(parseDemoMoves({}), []);
  assert.deepEqual(parseDemoMoves({ moves: "nope" }), []);
  // A row without a usable id is dropped; the rest of the list survives.
  const moves = parseDemoMoves({ moves: [null, { event_id: "" }, { event_id: "mkt_ok" }] });
  assert.equal(moves.length, 1);
  assert.equal(moves[0].eventId, "mkt_ok");
  // Missing route/counts read as empty, never as invented numbers.
  assert.deepEqual(moves[0].counts, counts());
  assert.equal(moves[0].route.originAddress, "");
  assert.equal(moves[0].startedAt, null);
  assert.equal(moves[0].finalized, false);
});

test("counts never invent a number the API did not send", () => {
  const [move] = parseDemoMoves({
    moves: [{ event_id: "mkt_x", counts: { submitted: "3", action: -2, failed: 1.7, done: null, total: 4 } }],
  });
  assert.deepEqual(move.counts, counts({ failed: 1, total: 4 }));
});

test("moves sort newest first, unknown start times last", () => {
  const sorted = sortDemoMoves(parseDemoMoves(MOVES_BODY));
  assert.deepEqual(sorted.map((move) => move.eventId), ["mkt_newer", "mkt_older"]);

  const undated = parseDemoMoves({
    moves: [
      { event_id: "mkt_a" },
      { event_id: "mkt_dated", started_at: 5 },
      { event_id: "mkt_b" },
    ],
  });
  assert.deepEqual(
    sortDemoMoves(undated).map((move) => move.eventId),
    ["mkt_dated", "mkt_a", "mkt_b"],
  );
});

test("sorting leaves the caller's array untouched", () => {
  const moves = parseDemoMoves(MOVES_BODY);
  sortDemoMoves(moves);
  assert.deepEqual(moves.map((move) => move.eventId), ["mkt_older", "mkt_newer"]);
});

test("only non-zero buckets become count figures, in tracker order", () => {
  assert.deepEqual(demoCountChips(counts()), []);
  assert.deepEqual(
    demoCountChips(counts({ submitted: 3, action: 1, failed: 0, done: 2, working: 4, total: 10 })),
    [
      { key: "submitted", label: "Submitted", color: "var(--tier-haiku)", value: 3 },
      { key: "action", label: "Need you", color: "var(--amber)", value: 1 },
      { key: "done", label: "Done", color: "var(--mint)", value: 2 },
    ],
  );
});

// ── Demo token on the intake payload ──────────────────────────────────────

const INTAKE: StartMoveInput = {
  origin: "1 A St",
  destination: "2 B St",
  moveDate: "2026-09-15",
  email: "mover@example.com",
  hasPets: false,
  hasChildren: false,
  hasCar: false,
  hasVisa: false,
};

test("a signed-in dispatch carries the demo token; a public one does not", () => {
  assert.equal(buildStartMovePayload(INTAKE).demo_token, undefined);
  assert.equal(buildStartMovePayload(INTAKE, "", "").demo_token, undefined);
  assert.equal(buildStartMovePayload(INTAKE, "", "   ").demo_token, undefined);
  assert.equal(buildStartMovePayload(INTAKE, "", "tok").demo_token, "tok");
  // The token rides alongside the intake fields, it does not replace any.
  assert.equal(buildStartMovePayload(INTAKE, "", "tok").user_email, "mover@example.com");
});

test("hasAccessKey: detects the access-link parameter", () => {
  assert.equal(hasAccessKey("?k=abc123"), true);
  assert.equal(hasAccessKey("?other=1"), false);
  assert.equal(hasAccessKey(""), false);
  // An empty ?k= is not a key: treating it as one would strand the page on
  // the "opening your workspace" screen with nothing to redeem.
  assert.equal(hasAccessKey("?k="), false);
  assert.equal(hasAccessKey("?k=%20"), false);
});
