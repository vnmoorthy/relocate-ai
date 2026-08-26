/**
 * Shared-demo session + workspace helpers for the login-gated product surface
 * (/app).
 *
 * What this is NOT: per-user authentication. The deployment publishes ONE set
 * of demo credentials, the server verifies them, and everyone who signs in
 * lands in the same workspace and sees the same moves. The page says so in
 * plain words — nothing here should be described as a user account.
 *
 * The password never lives in this bundle: the form posts what was typed to
 * POST /api/public/demo-login and the server decides. What comes back is an
 * opaque token plus a server-stated expiry, held in sessionStorage (tab-scoped,
 * gone when the tab closes) and treated as untrusted input on the way back in.
 *
 * Everything here is DOM-free and side-effect free except the four storage
 * wrappers, which take the store as an argument so they stay testable.
 */

import type { MoveTaskCounts } from "./move-page.ts";

/** sessionStorage key holding the serialized session. */
export const DEMO_SESSION_KEY = "relocate-demo";

/** A token is opaque; anything longer than this is junk, not a credential. */
const MAX_TOKEN_CHARS = 4096;
const MAX_DETAIL_CHARS = 240;

export interface DemoSession {
  /** Opaque bearer token minted by the backend. */
  token: string;
  /** Epoch SECONDS, exactly as the server stated it. */
  expiresAt: number;
}

// ── Endpoints ─────────────────────────────────────────────────────────────

/** POST — exchanges the published demo credentials for a token. */
export function demoLoginUrl(api: string): string {
  return `${api}/api/public/demo-login`;
}

/** GET — the workspace's moves, newest first once sorted. */
export function demoMovesUrl(api: string): string {
  return `${api}/api/public/demo/moves`;
}

/** Authorization header for the token-gated demo endpoints. */
export function bearerHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

// ── Session ───────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate a `{token, expires_at}` payload — the login response and the
 * stored session share this shape, so one parser guards both doors.
 */
export function parseDemoLogin(raw: unknown): DemoSession | null {
  if (!isRecord(raw)) return null;
  const token = raw.token;
  const expiresAt = raw.expires_at;
  if (typeof token !== "string") return null;
  if (token.length === 0 || token.length > MAX_TOKEN_CHARS) return null;
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) return null;
  return { token, expiresAt };
}

/** Stored form of a session — the same wire shape it arrived in. */
export function serializeSession(session: DemoSession): string {
  return JSON.stringify({ token: session.token, expires_at: session.expiresAt });
}

/** Stored string → session; malformed JSON or shape → null (treated as signed out). */
export function parseStoredSession(raw: string | null): DemoSession | null {
  if (!raw) return null;
  try {
    return parseDemoLogin(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

/**
 * A session is usable only while the server-stated expiry is still ahead of
 * now. An expired session is exactly as good as no session.
 */
export function isSessionActive(session: DemoSession | null, nowSeconds: number): boolean {
  if (session === null || !Number.isFinite(nowSeconds)) return false;
  return session.expiresAt > nowSeconds;
}

/** Epoch seconds — the unit `expires_at` is stated in. */
export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** The slice of the Storage API this module needs. */
export interface SessionStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Tab-scoped store, or null when there is no DOM / storage is blocked
 * (Safari private mode throws on access rather than returning null).
 */
export function demoSessionStore(): SessionStore | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Restore a live session; an expired one is dropped from the store on the way out. */
export function loadDemoSession(store: SessionStore | null, now: number): DemoSession | null {
  if (!store) return null;
  let raw: string | null;
  try {
    raw = store.getItem(DEMO_SESSION_KEY);
  } catch {
    return null;
  }
  const session = parseStoredSession(raw);
  if (session === null) return null;
  if (!isSessionActive(session, now)) {
    clearDemoSession(store);
    return null;
  }
  return session;
}

export function saveDemoSession(store: SessionStore | null, session: DemoSession): void {
  if (!store) return;
  try {
    store.setItem(DEMO_SESSION_KEY, serializeSession(session));
  } catch {
    // A full or blocked store costs the page a reload-survivable session,
    // nothing more — the in-memory session still works for this visit.
  }
}

export function clearDemoSession(store: SessionStore | null): void {
  if (!store) return;
  try {
    store.removeItem(DEMO_SESSION_KEY);
  } catch {
    // Nothing to do — signing out already dropped the in-memory session.
  }
}

// ── Login form ────────────────────────────────────────────────────────────

/** Client-side check only. Null means "let the server decide". */
export function validateDemoLogin(username: string, password: string): string | null {
  if (!username.trim()) return "Enter the demo username.";
  if (!password) return "Enter the demo password.";
  return null;
}

/** Pull a human-readable `detail` string out of an error body, if present. */
function detailFrom(body: unknown): string | null {
  if (!isRecord(body)) return null;
  const detail = body.detail;
  if (typeof detail === "string" && detail.trim()) {
    return detail.trim().slice(0, MAX_DETAIL_CHARS);
  }
  return null;
}

export const DEMO_UNREACHABLE_MESSAGE =
  "Couldn't reach the Relocate backend just now. Check your connection and try again.";

/**
 * Plain-language message for a non-2xx sign-in. Never blames the reader and
 * never guesses at a cause the server did not state.
 */
export function demoLoginErrorMessage(status: number, body: unknown): string {
  if (status === 401) {
    // Name the most common cause. A phone keyboard capitalises the first
    // letter, and "check them and try again" sends the user round the same
    // loop without telling them what to look at.
    return "Those credentials weren't accepted — they're case-sensitive, and all lowercase.";
  }
  if (status === 429) {
    return "Too many sign-in attempts from this connection. Give it a minute and try again.";
  }
  if (status === 503) {
    return "Demo access is switched off on this deployment right now.";
  }
  if (status >= 500) {
    return "The backend hit an error on its side. Try again in a moment.";
  }
  return detailFrom(body) ?? `The backend returned an unexpected response (HTTP ${status}).`;
}

// ── Workspace move list (GET /api/public/demo/moves) ──────────────────────

export interface DemoMoveSummary {
  /** Real move id — the capability that opens the snapshot and the deep link. */
  eventId: string;
  /** Alias the public live feed publishes this move under. */
  publicRef: string;
  route: { originAddress: string; destinationAddress: string; moveDate: string };
  counts: MoveTaskCounts;
  /** Epoch seconds, or null when the backend did not state one. */
  startedAt: number | null;
  finalized: boolean;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Non-negative whole number, or 0. Never invents a count the API didn't send. */
function asCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function parseCounts(raw: unknown): MoveTaskCounts {
  const counts = isRecord(raw) ? raw : {};
  return {
    total: asCount(counts.total),
    working: asCount(counts.working),
    submitted: asCount(counts.submitted),
    action: asCount(counts.action),
    failed: asCount(counts.failed),
    done: asCount(counts.done),
  };
}

/**
 * Validate the untrusted `{moves:[…]}` payload. Rows without a usable event id
 * are dropped rather than rendered as a broken link; a payload that is not a
 * move list at all yields an empty array (the caller already treats a non-2xx
 * response as an error).
 */
export function parseDemoMoves(raw: unknown): DemoMoveSummary[] {
  if (!isRecord(raw) || !Array.isArray(raw.moves)) return [];
  const moves: DemoMoveSummary[] = [];
  for (const item of raw.moves) {
    if (!isRecord(item)) continue;
    if (typeof item.event_id !== "string" || item.event_id.length === 0) continue;
    const route = isRecord(item.route) ? item.route : {};
    moves.push({
      eventId: item.event_id,
      publicRef: asString(item.public_ref),
      route: {
        originAddress: asString(route.origin_address),
        destinationAddress: asString(route.destination_address),
        moveDate: asString(route.move_date),
      },
      counts: parseCounts(item.counts),
      startedAt:
        typeof item.started_at === "number" && Number.isFinite(item.started_at)
          ? item.started_at
          : null,
      finalized: item.finalized === true,
    });
  }
  return moves;
}

/**
 * Newest first. Moves without a start time sort last and keep their arrival
 * order (Array.prototype.sort is stable) — an unknown time is not a new time.
 */
export function sortDemoMoves(moves: DemoMoveSummary[]): DemoMoveSummary[] {
  return [...moves].sort((a, b) => {
    if (a.startedAt === null && b.startedAt === null) return 0;
    if (a.startedAt === null) return 1;
    if (b.startedAt === null) return -1;
    return b.startedAt - a.startedAt;
  });
}

/**
 * The count figures worth showing on a list row, in the tracker's palette.
 * A zero bucket is left out entirely — a row of zeros reads as data when it
 * is really the absence of it. Working is deliberately absent: the row already
 * states the task total, and "working" is everything not yet terminal.
 */
export interface DemoCountChip {
  key: "submitted" | "action" | "failed" | "done";
  label: string;
  value: number;
  /** CSS custom property reference — same palette as the /move tracker. */
  color: string;
}

const CHIP_SPEC: Array<{ key: DemoCountChip["key"]; label: string; color: string }> = [
  { key: "submitted", label: "Submitted", color: "var(--tier-haiku)" },
  { key: "action", label: "Need you", color: "var(--amber)" },
  { key: "failed", label: "Failed", color: "var(--red)" },
  { key: "done", label: "Done", color: "var(--mint)" },
];

export function demoCountChips(counts: MoveTaskCounts): DemoCountChip[] {
  return CHIP_SPEC.filter((spec) => counts[spec.key] > 0).map((spec) => ({
    ...spec,
    value: counts[spec.key],
  }));
}

// ── Access links ──────────────────────────────────────────────────────────
// A link of the form …/app/?k=KEY signs a reviewer straight in, so the
// password never has to be printed on a public page. The key is redeemed
// once and removed from the URL immediately: a key sitting in the address
// bar survives screen-shares, screenshots and the back button.

const ACCESS_KEY_PARAM = "k";

/** True when this page load carries a non-empty access key. */
export function hasAccessKey(search?: string): boolean {
  const query = search ?? (typeof window === "undefined" ? "" : window.location.search);
  return (new URLSearchParams(query).get(ACCESS_KEY_PARAM) ?? "").trim().length > 0;
}

/**
 * Read the access key and strip it from the visible URL and history.
 * Returns null when there is none.
 */
export function takeAccessKey(): string | null {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const key = url.searchParams.get(ACCESS_KEY_PARAM);
  if (!key) return null;
  url.searchParams.delete(ACCESS_KEY_PARAM);
  try {
    window.history.replaceState(null, "", url.toString());
  } catch {
    // A blocked history API is not a reason to refuse the sign-in.
  }
  return key.trim() || null;
}
