/**
 * Live-backend discovery + public intake contract for the static site.
 *
 * The public build cannot carry a secret, so it never talks to the
 * authenticated dashboard socket. Instead it looks for an operator-published
 * discovery file next to the page:
 *
 *   GET <discovery source>/live.json  →  {"api": "https://some-host"}
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
/**
 * Where the current API endpoint is published, most-fresh first.
 *
 * The backend runs behind a tunnel whose URL rotates. Neither source is
 * instant — Pages has to rebuild, and raw.githubusercontent sets
 * cache-control: max-age=300 — so this is redundancy, not speed: whichever
 * source has already caught up wins, because a stale endpoint fails the
 * healthz probe below and falls through to the next one.
 */
const DISCOVERY_SOURCES = [
  "https://raw.githubusercontent.com/vnmoorthy/relocate-ai/main/web/public/live.json",
  `${BASE_PATH}/live.json`,
];

async function fetchEndpoint(url: string): Promise<string | null> {
  try {
    const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return parseLiveConfig(await res.json());
  } catch {
    return null;
  }
}

async function discoverOnce(): Promise<string | null> {
  const seen = new Set<string>();
  for (const source of DISCOVERY_SOURCES) {
    const api = await fetchEndpoint(source);
    // A stale source is common mid-rotation; only a reachable backend counts.
    if (api && !seen.has(api)) {
      seen.add(api);
      if (await isHealthy(api)) return api;
    }
  }
  return null;
}

const DISCOVERY_RETRY_DELAYS_MS = [1000, 2000];

/**
 * Live-backend discovery with short in-call retries: a one-shot probe let a
 * single 3-second tunnel blip lock the page into simulation mode until a
 * manual reload. A deployment genuinely without live.json still resolves
 * null after the retries and the simulation fallback shows as before.
 */
export async function discoverLiveApi(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  const first = await discoverOnce();
  if (first) return first;
  for (const delayMs of DISCOVERY_RETRY_DELAYS_MS) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    const api = await discoverOnce();
    if (api) return api;
  }
  return null;
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
  // ── Optional household detail ───────────────────────────────────────────
  // Never required, never validated hard: each one is dropped from the wire
  // payload when blank, and the server drops anything it doesn't like. They
  // exist because a specialist can only file a real request when it has them
  // (child name + grade → school enrollment, pet + vet email → vet records).
  /** Who is moving. */
  userName?: string;
  userPhone?: string;
  // ── Act-on-my-behalf ────────────────────────────────────────────────────
  // One authorization, given once, is what lets the email-rail specialists
  // send stop-service and cancellation notices without handing each task
  // back. Account numbers identify the accounts; no passwords, ever.
  authorizeProviders?: boolean;
  pgeAccountNumber?: string;
  comcastAccountNumber?: string;
  gymMemberId?: string;
  /** Only sent when hasChildren. */
  childName?: string;
  /** Only sent when hasChildren. */
  childGrade?: string;
  /** Only sent when hasPets. */
  petName?: string;
  /** Only sent when hasPets. Free text ("dog"). */
  petSpecies?: string;
  /** Only sent when hasPets. */
  vetEmail?: string;
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
  authorize_providers?: boolean;
  /** Honeypot — a human submission always carries "". */
  website: string;
  /**
   * Present only when the dispatch was started from the signed-in demo
   * workspace (/app), so the backend can tag the move to it. The public
   * homepage form never sends one.
   */
  demo_token?: string;
  // Optional detail. A key is present only when it carries a non-empty value
  // AND the matching household flag is on — an unchecked box never leaks the
  // text someone typed before unchecking it.
  user_name?: string;
  user_phone?: string;
  child_name?: string;
  child_grade?: string;
  pet_name?: string;
  pet_species?: string;
  vet_email?: string;
  pge_account_number?: string;
  comcast_account_number?: string;
  equinox_member_id?: string;
}

type OptionalPayloadKey =
  | "user_name"
  | "user_phone"
  | "child_name"
  | "child_grade"
  | "pet_name"
  | "pet_species"
  | "vet_email"
  | "pge_account_number"
  | "comcast_account_number"
  | "equinox_member_id";

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

/**
 * Wire payload for the intake POST. `demoToken` is optional and blank-safe:
 * an empty or whitespace-only token leaves the key off entirely, so a public
 * submission is byte-identical to what it was before the workspace existed.
 */
export function buildStartMovePayload(
  input: StartMoveInput,
  honeypot = "",
  demoToken = "",
): StartMovePayload {
  const payload: StartMovePayload = {
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
  if (demoToken.trim()) payload.demo_token = demoToken.trim();
  addOptional(payload, "user_name", input.userName);
  addOptional(payload, "user_phone", input.userPhone);
  // Account numbers are only useful with the authorization, and the
  // authorization is only meaningful when the customer actually granted it.
  if (input.authorizeProviders) {
    payload.authorize_providers = true;
    addOptional(payload, "pge_account_number", input.pgeAccountNumber);
    addOptional(payload, "comcast_account_number", input.comcastAccountNumber);
    addOptional(payload, "equinox_member_id", input.gymMemberId);
  }
  if (input.hasChildren) {
    addOptional(payload, "child_name", input.childName);
    addOptional(payload, "child_grade", input.childGrade);
  }
  if (input.hasPets) {
    addOptional(payload, "pet_name", input.petName);
    addOptional(payload, "pet_species", input.petSpecies);
    addOptional(payload, "vet_email", input.vetEmail);
  }
  return payload;
}

/** Add an optional field only when it carries something. Blank → key absent. */
function addOptional(payload: StartMovePayload, key: OptionalPayloadKey, value: string | undefined): void {
  const trimmed = value?.trim();
  if (trimmed) payload[key] = trimmed;
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
