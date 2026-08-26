/**
 * Browser-side concierge: the same voice agent the phone line runs, driven by
 * the microphone in this tab.
 *
 * Speech recognition and synthesis are the browser's own engines — audio never
 * leaves the device; only the resulting transcript is posted to the
 * orchestrator, which runs the identical prompt, extraction and dispatch rules
 * an AgentPhone call would. This is deliberately NOT presented as the phone
 * line: it is the same concierge with a different microphone.
 *
 * Everything here is DOM-free and unit-testable; the React component owns the
 * engines themselves.
 */

// ── API shapes ────────────────────────────────────────────────────────────

export interface ConciergeTurn {
  callId: string;
  text: string;
  eventId: string;
  collected: string[];
  dispatched: boolean;
  turn: number;
}

export interface ConciergeEnd {
  eventId: string;
  dispatched: boolean;
  collected: string[];
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export function conciergeTurnUrl(api: string): string {
  return `${api}/api/public/concierge/turn`;
}

export function conciergeEndUrl(api: string): string {
  return `${api}/api/public/concierge/end`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** Validate an untrusted turn response. Null when fundamentally unusable. */
export function parseConciergeTurn(raw: unknown): ConciergeTurn | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.call_id !== "string" || raw.call_id.length === 0) return null;
  if (typeof raw.text !== "string") return null;
  return {
    callId: raw.call_id,
    text: raw.text,
    eventId: typeof raw.event_id === "string" ? raw.event_id : "",
    collected: stringList(raw.collected),
    dispatched: raw.dispatched === true,
    turn: typeof raw.turn === "number" && Number.isFinite(raw.turn) ? raw.turn : 0,
  };
}

export function parseConciergeEnd(raw: unknown): ConciergeEnd | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.event_id !== "string" || raw.event_id.length === 0) return null;
  return {
    eventId: raw.event_id,
    dispatched: raw.dispatched === true,
    collected: stringList(raw.collected),
  };
}

// ── Conversation state ────────────────────────────────────────────────────

const MAX_HISTORY_TURNS = 12;

/** Append a turn, keeping the tail the API actually reads. */
export function appendTurn(history: ChatTurn[], turn: ChatTurn): ChatTurn[] {
  if (!turn.content.trim()) return history;
  return [...history, turn].slice(-MAX_HISTORY_TURNS);
}

// ── What the swarm still needs ────────────────────────────────────────────

/** CORE fields gate dispatch; the conditionals decide which specialists run. */
export const CORE_FIELDS = [
  "origin_address",
  "destination_address",
  "move_date",
  "user_email",
] as const;

export const CONDITIONAL_FIELDS = ["has_pets", "has_children", "has_car", "has_visa"] as const;

const FIELD_LABELS: Record<string, string> = {
  origin_address: "where you're moving from",
  destination_address: "where you're moving to",
  move_date: "your move date",
  user_email: "your email",
  has_pets: "Pets",
  has_children: "Kids",
  has_car: "Car",
  has_visa: "Visa",
  user_name: "Your name",
  work_address: "Work address",
};

/** Human label for a field name; falls back to a readable form of the name. */
export function fieldLabel(name: string): string {
  return FIELD_LABELS[name] ?? name.replace(/_/g, " ");
}

/** CORE fields still missing, in the order the concierge asks for them. */
export function missingCoreFields(collected: string[]): string[] {
  const have = new Set(collected);
  return CORE_FIELDS.filter((name) => !have.has(name));
}

/**
 * Why a hang-up did not dispatch, in the user's words.
 * Only ever derived from what the API reported as collected.
 */
export function missingSummary(collected: string[]): string {
  const missing = missingCoreFields(collected).map(fieldLabel);
  if (missing.length === 0) return "";
  if (missing.length === 1) return `Still need ${missing[0]}.`;
  const last = missing[missing.length - 1];
  return `Still need ${missing.slice(0, -1).join(", ")} and ${last}.`;
}

// ── Speech engines (capability detection only; the component drives them) ──

export interface SpeechCapableWindow {
  SpeechRecognition?: unknown;
  webkitSpeechRecognition?: unknown;
  speechSynthesis?: unknown;
}

export interface SpeechSupport {
  recognition: boolean;
  synthesis: boolean;
}

/** What this browser can actually do. Injectable for tests. */
export function detectSpeechSupport(win: SpeechCapableWindow | undefined): SpeechSupport {
  if (!win) return { recognition: false, synthesis: false };
  return {
    recognition: Boolean(win.SpeechRecognition ?? win.webkitSpeechRecognition),
    synthesis: Boolean(win.speechSynthesis),
  };
}

/** Plain-language explanation for a SpeechRecognition error code. */
export function recognitionErrorMessage(code: string): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "This tab can't use the microphone. Allow mic access in your browser's site settings, then start again.";
    case "no-speech":
      return "Didn't catch anything — try again, a little closer to the mic.";
    case "audio-capture":
      return "No microphone found. Check that one is connected and selected.";
    case "network":
      return "The browser's speech service couldn't be reached. Check your connection, or type instead.";
    case "aborted":
      return "";
    default:
      return "Speech recognition stopped unexpectedly. You can keep going by typing.";
  }
}
