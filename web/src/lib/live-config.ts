/**
 * Live-backend discovery + public intake contract for the static site.
 *
 * The public build cannot carry a secret, so it never talks to the
 * authenticated dashboard socket. Instead it looks for an operator-published
 * discovery file next to the page:
 *
 *   GET ${BASE_PATH}/live.json  →  {"api": "https://some-host"}
 *
 * A 404 (the file is simply absent from /public) means "no live backend" and
 * the dashboard stays in its labeled simulation. When the file is present the
 * advertised host is treated as untrusted input: it must be an https URL, it
 * must answer /healthz with {"status":"ok"} within 3s, and only then does the
 * page upgrade to the token-less public feed (wss://host/ws/public) and show
 * the web-intake form (POST /api/public/start-move).
 *
 * Everything here is side-effect free except `discoverLiveApi`, which never
 * throws — a broken or missing discovery file degrades to simulation.
 */

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const HEALTH_TIMEOUT_MS = 3000;
const MAX_DETAIL_CHARS = 240;

// ── Discovery ─────────────────────────────────────────────────────────────

/**
 * Validate the untrusted discovery payload. Returns the normalized API origin
 * (https, no credentials, no query/hash, no trailing slash) or null.
 */
export function parseLiveConfig(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) return null;
  const api = (raw as { api?: unknown }).api;
  if (typeof api !== "string") return null;
  return normalizeApiUrl(api);
}

function normalizeApiUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (url.search || url.hash) return null;
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${path}`;
}

/** Token-less public event feed: https://host[/prefix] → wss://host[/prefix]/ws/public */
export function publicWsUrl(api: string): string {
  return `${api.replace(/^https:/, "wss:")}/ws/public`;
}

/** Web-intake endpoint. */
export function startMoveUrl(api: string): string {
  return `${api}/api/public/start-move`;
}

async function isHealthy(api: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const res = await fetch(`${api}/healthz`, {
      signal: controller.signal,
      cache: "no-store",
      mode: "cors",
    });
    if (!res.ok) return false;
    const body: unknown = await res.json();
    return (
      typeof body === "object" &&
      body !== null &&
      (body as { status?: unknown }).status === "ok"
    );
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve the live API origin for this page load, or null when the site
 * should stay in simulation. Never throws.
 */
export async function discoverLiveApi(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  try {
    const res = await fetch(`${BASE_PATH}/live.json?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const api = parseLiveConfig(await res.json());
    if (!api) return null;
    return (await isHealthy(api)) ? api : null;
  } catch {
    return null;
  }
}

// ── Web intake ────────────────────────────────────────────────────────────

export interface StartMoveInput {
  origin: string;
  destination: string;
  /** YYYY-MM-DD, as produced by <input type="date"> */
  moveDate: string;
  email: string;
  hasPets: boolean;
  hasChildren: boolean;
  hasCar: boolean;
  hasVisa: boolean;
}

export type StartMoveField = "origin" | "destination" | "moveDate" | "email";
export type StartMoveErrors = Partial<Record<StartMoveField, string>>;

/** Wire shape of POST /api/public/start-move. */
export interface StartMovePayload {
  origin_address: string;
  destination_address: string;
  move_date: string;
  user_email: string;
  has_pets: boolean;
  has_children: boolean;
  has_car: boolean;
  has_visa: boolean;
  /** Honeypot — a human submission always carries "". */
  website: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

/** True for a syntactically valid, real calendar date in YYYY-MM-DD form. */
export function isValidMoveDate(value: string): boolean {
  const match = DATE_RE.exec(value.trim());
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** Client-side validation. An empty result means the form may be submitted. */
export function validateStartMove(input: StartMoveInput): StartMoveErrors {
  const errors: StartMoveErrors = {};
  if (!input.origin.trim()) errors.origin = "Tell us where you're moving from.";
  if (!input.destination.trim()) errors.destination = "Tell us where you're moving to.";
  if (!input.moveDate.trim()) errors.moveDate = "Pick a move date.";
  else if (!isValidMoveDate(input.moveDate)) errors.moveDate = "That date doesn't look right.";
  if (!input.email.trim()) errors.email = "We need an email to hand back to you.";
  else if (!isValidEmail(input.email)) errors.email = "That email doesn't look right.";
  return errors;
}

export function buildStartMovePayload(input: StartMoveInput, honeypot = ""): StartMovePayload {
  return {
    origin_address: input.origin.trim(),
    destination_address: input.destination.trim(),
    move_date: input.moveDate.trim(),
    user_email: input.email.trim(),
    has_pets: input.hasPets,
    has_children: input.hasChildren,
    has_car: input.hasCar,
    has_visa: input.hasVisa,
    website: honeypot,
  };
}

/** Pull a human-readable `detail` out of an error body, if the server sent one. */
function detailFrom(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const detail = (body as { detail?: unknown }).detail;
  if (typeof detail === "string" && detail.trim()) {
    return detail.trim().slice(0, MAX_DETAIL_CHARS);
  }
  // FastAPI validation errors arrive as [{loc, msg, type}, ...]
  if (Array.isArray(detail)) {
    const first = detail.find(
      (item): item is { msg: string } =>
        typeof item === "object" && item !== null && typeof (item as { msg?: unknown }).msg === "string",
    );
    if (first) return first.msg.slice(0, MAX_DETAIL_CHARS);
  }
  return null;
}

/** Plain-language message for a non-2xx intake response. */
export function startMoveErrorMessage(status: number, body: unknown): string {
  if (status === 429) {
    return "Too many dispatches from here right now. Give it a minute and try again.";
  }
  if (status === 503) {
    return "Web intake is paused right now. Call the concierge line instead.";
  }
  const detail = detailFrom(body);
  if (status === 400) {
    return detail ?? "Something in the form was rejected. Check the fields and try again.";
  }
  if (status >= 500) {
    return "The dispatcher hit an error on its side. Try again in a moment.";
  }
  return detail ?? `The dispatcher returned an unexpected response (HTTP ${status}). Try again in a moment.`;
}
