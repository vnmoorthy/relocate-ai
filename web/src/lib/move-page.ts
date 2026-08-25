/**
 * Pure helpers for the shareable /move tracking page.
 *
 * The page is a static export served under a basePath, so the move id rides
 * in the URL hash (/move/#mkt_abc123) and every byte of backend data is
 * treated as untrusted input: the snapshot is validated field-by-field and
 * anything malformed degrades to a safe default instead of throwing.
 */

import { ALL_AGENTS } from "./types.ts";

// ── Move id (URL hash) ────────────────────────────────────────────────────

const MOVE_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;

/** "#mkt_abc123" (or "mkt_abc123") → "mkt_abc123"; anything unsafe → null. */
export function moveIdFromHash(hash: string): string | null {
  const raw = (hash.startsWith("#") ? hash.slice(1) : hash).trim();
  return MOVE_ID_RE.test(raw) ? raw : null;
}

/** Snapshot endpoint for one move. */
export function moveSnapshotUrl(api: string, eventId: string): string {
  return `${api}/api/public/move/${encodeURIComponent(eventId)}`;
}

/** Short reference for the kicker: strips the mkt_ prefix, keeps 8 chars. */
export function shortMoveRef(eventId: string): string {
  const bare = eventId.replace(/^mkt_/, "");
  return bare.slice(0, 8);
}

// ── Route display ─────────────────────────────────────────────────────────

const STATE_ZIP_RE = /^[A-Za-z]{2}\.?\s+\d{5}(?:-\d{4})?$/;
const STATE_RE = /^[A-Za-z]{2}\.?$/;
const ZIP_RE = /^\d{5}(?:-\d{4})?$/;
const COUNTRY_RE = /^(?:usa|u\.s\.a\.?|us|united states(?: of america)?)$/i;

function isRegionToken(part: string): boolean {
  return (
    STATE_ZIP_RE.test(part) || STATE_RE.test(part) || ZIP_RE.test(part) || COUNTRY_RE.test(part)
  );
}

/**
 * Best-effort city from a US-style address: the comma segment before the
 * trailing state/zip/country tokens. Falls back to the full string.
 */
export function cityFromAddress(address: string): string {
  const full = address.trim();
  const parts = full
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return full;
  let index = parts.length - 1;
  while (index > 0 && isRegionToken(parts[index])) index -= 1;
  const candidate = parts[index]
    .replace(/\s+[A-Za-z]{2}\.?\s+\d{5}(?:-\d{4})?$/, "")
    .replace(/\s+\d{5}(?:-\d{4})?$/, "")
    .trim();
  return candidate || full;
}

/** "2026-09-15" → "Sep 15, 2026" (UTC-safe); anything else passes through. */
export function formatMoveDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return value.trim();
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(date.getTime())) return value.trim();
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

// ── Snapshot (GET /api/public/move/{event_id}) ────────────────────────────

export interface MoveSpecialistSnapshot {
  agent_id: string;
  state: string;
  terminal_outcome: string | null;
  blocker_kind: string | null;
  closed_at: number | null;
  /** Title of a prepared script/letter/checklist already emailed to the user. */
  playbookTitle: string | null;
}

/** Deterministic quote facts extracted from a provider's emailed reply. */
export interface MoveReplyQuote {
  totalDisplay: string;
  depositDisplay: string | null;
  availability: boolean;
}

export interface MoveReply {
  fromDomain: string;
  receivedAt: number | null;
  /** Which specialist's outreach this reply answers, when the backend knows. */
  agentId: string | null;
  quote: MoveReplyQuote | null;
}

export interface MoveSnapshot {
  event_id: string;
  route: { origin_address: string; destination_address: string; move_date: string };
  flags: { has_pets: boolean; has_children: boolean; has_car: boolean; has_visa: boolean };
  specialists: MoveSpecialistSnapshot[];
  replies: MoveReply[];
  dispatched: boolean;
  finalized: boolean;
  final_outcome: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Non-empty string → itself; anything else → null. */
function asNonEmptyStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Quote facts from a reply; null unless the shape (and total) is sound. */
function parseReplyQuote(raw: unknown): MoveReplyQuote | null {
  if (!isRecord(raw)) return null;
  const totalDisplay = asNonEmptyStringOrNull(raw.total_display);
  if (!totalDisplay) return null;
  return {
    totalDisplay,
    depositDisplay: asNonEmptyStringOrNull(raw.deposit_display),
    availability: raw.availability === true,
  };
}

/** Validate the untrusted snapshot payload. Null only when fundamentally broken. */
export function parseMoveSnapshot(raw: unknown): MoveSnapshot | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.event_id !== "string" || raw.event_id.length === 0) return null;

  const route = isRecord(raw.route) ? raw.route : {};
  const flags = isRecord(raw.flags) ? raw.flags : {};

  const specialists: MoveSpecialistSnapshot[] = [];
  if (Array.isArray(raw.specialists)) {
    for (const item of raw.specialists) {
      if (!isRecord(item)) continue;
      if (typeof item.agent_id !== "string" || item.agent_id.length === 0) continue;
      if (typeof item.state !== "string" || item.state.length === 0) continue;
      specialists.push({
        agent_id: item.agent_id,
        state: item.state,
        terminal_outcome: typeof item.terminal_outcome === "string" ? item.terminal_outcome : null,
        blocker_kind: typeof item.blocker_kind === "string" ? item.blocker_kind : null,
        closed_at:
          typeof item.closed_at === "number" && Number.isFinite(item.closed_at)
            ? item.closed_at
            : null,
        playbookTitle: asNonEmptyStringOrNull(item.playbook_title),
      });
    }
  }

  const replies: MoveReply[] = [];
  if (Array.isArray(raw.replies)) {
    for (const item of raw.replies) {
      if (!isRecord(item)) continue;
      if (typeof item.from_domain !== "string") continue;
      replies.push({
        fromDomain: item.from_domain,
        receivedAt:
          typeof item.received_at === "number" && Number.isFinite(item.received_at)
            ? item.received_at
            : null,
        agentId: asNonEmptyStringOrNull(item.agent_id),
        quote: parseReplyQuote(item.quote),
      });
    }
  }

  return {
    event_id: raw.event_id,
    route: {
      origin_address: asString(route.origin_address),
      destination_address: asString(route.destination_address),
      move_date: asString(route.move_date),
    },
    flags: {
      has_pets: flags.has_pets === true,
      has_children: flags.has_children === true,
      has_car: flags.has_car === true,
      has_visa: flags.has_visa === true,
    },
    specialists,
    replies,
    dispatched: raw.dispatched === true,
    finalized: raw.finalized === true,
    final_outcome: typeof raw.final_outcome === "string" ? raw.final_outcome : null,
  };
}

// ── Task copy — honest one-liners ─────────────────────────────────────────

const BLOCKER_LINES: Record<string, string> = {
  secure_user_workflow_required:
    "Needs your signature or consent — we hand this to you with a playbook.",
  recipient_not_allowlisted:
    "Outbound email is locked on this deployment until a recipient allowlist is set.",
  integration_unavailable: "This provider path is gated on this deployment.",
  missing_fields: "Needs a few more details from you.",
  orchestrator_restart: "Interrupted mid-run — flagged for a re-check.",
};

/**
 * One-line human explanation for a task row. On a user-action row a prepared
 * playbook wins (the system already emailed a script for it); blocker copy is
 * the fallback, then plain state copy.
 */
export function taskLine(
  state: string,
  blockerKind: string | null,
  playbookTitle: string | null = null,
): string {
  if (state === "needs-user-action" && playbookTitle) {
    return `Prepared: ${playbookTitle} — sent to your inbox.`;
  }
  if (blockerKind && BLOCKER_LINES[blockerKind]) return BLOCKER_LINES[blockerKind];
  switch (state) {
    case "submitted":
      return "Request submitted — provider acceptance, not completion.";
    case "succeeded":
      return "Done.";
    case "failed":
    case "error":
      return "Provider errored — shown honestly, never relabeled.";
    case "needs-user-action":
      return "Waiting on you — check your summary email for the handoff.";
    case "in-progress":
    case "calling":
      return "Working…";
    case "voicemail":
      return "Reached voicemail — flagged for follow-up.";
    case "closed":
      return "Ended — outcome not reported.";
    default:
      return "Queued";
  }
}

/** One-line summary for a reply row: quote facts when extracted, generic otherwise. */
export function replyLine(quote: MoveReplyQuote | null): string {
  if (!quote) return "Emailed a response to your move — the full message is in your inbox.";
  let facts = `Quoted ${quote.totalDisplay}`;
  if (quote.depositDisplay) facts += ` · deposit ${quote.depositDisplay}`;
  if (quote.availability) facts += " · availability confirmed";
  return `${facts} — full message in your inbox.`;
}

// ── Snapshot + live-overlay merge ─────────────────────────────────────────

export interface MoveTaskView {
  agentId: string;
  name: string;
  category: string;
  state: string;
  blockerKind: string | null;
  playbookTitle: string | null;
  line: string;
}

const AGENT_META = new Map<string, (typeof ALL_AGENTS)[number]>(
  ALL_AGENTS.map((agent) => [agent.id, agent]),
);
const AGENT_ORDER = new Map<string, number>(ALL_AGENTS.map((agent, index) => [agent.id, index]));

/** Display name for a known roster agent; null for unknown/absent ids. */
export function moveAgentName(agentId: string | null): string | null {
  return (agentId && AGENT_META.get(agentId)?.name) || null;
}

/**
 * Snapshot specialists overlaid with live agent_state events (overlay wins —
 * it is strictly newer than the snapshot). The concierge ("buyer") is not a
 * per-move task. A blocker — and the playbook prepared for it — survives only
 * while the state it explained holds.
 */
export function mergeMoveTasks(
  specialists: MoveSpecialistSnapshot[],
  overlay: Record<string, { state: string }>,
): MoveTaskView[] {
  const byId = new Map<
    string,
    { state: string; blockerKind: string | null; playbookTitle: string | null }
  >();
  for (const specialist of specialists) {
    if (specialist.agent_id === "buyer") continue;
    byId.set(specialist.agent_id, {
      state: specialist.state,
      blockerKind: specialist.blocker_kind,
      playbookTitle: specialist.playbookTitle,
    });
  }
  for (const [agentId, live] of Object.entries(overlay)) {
    if (agentId === "buyer") continue;
    const base = byId.get(agentId);
    const stateHolds = base !== undefined && base.state === live.state;
    byId.set(agentId, {
      state: live.state,
      blockerKind: stateHolds ? base.blockerKind : null,
      playbookTitle: stateHolds ? base.playbookTitle : null,
    });
  }

  const tasks: MoveTaskView[] = [...byId.entries()].map(([agentId, task]) => {
    const meta = AGENT_META.get(agentId);
    return {
      agentId,
      name: meta?.name ?? agentId,
      category: meta?.category ?? "specialist",
      state: task.state,
      blockerKind: task.blockerKind,
      playbookTitle: task.playbookTitle,
      line: taskLine(task.state, task.blockerKind, task.playbookTitle),
    };
  });
  tasks.sort(
    (a, b) =>
      (AGENT_ORDER.get(a.agentId) ?? ALL_AGENTS.length) -
        (AGENT_ORDER.get(b.agentId) ?? ALL_AGENTS.length) ||
      a.agentId.localeCompare(b.agentId),
  );
  return tasks;
}

// ── Quote comparison ──────────────────────────────────────────────────────

/** "$3,150.50" → 3150.5; anything that doesn't parse cleanly → null. */
export function quoteTotalValue(totalDisplay: string): number | null {
  const bare = totalDisplay.replace(/[$,\s]/g, "");
  return /^\d+(?:\.\d+)?$/.test(bare) ? Number(bare) : null;
}

/**
 * Replies that carry a quote, cheapest first. Unparseable totals sort last;
 * ties keep arrival order (Array.prototype.sort is stable).
 */
export function sortQuotedReplies(
  replies: MoveReply[],
): Array<MoveReply & { quote: MoveReplyQuote }> {
  return replies
    .filter((reply): reply is MoveReply & { quote: MoveReplyQuote } => reply.quote !== null)
    .sort((a, b) => {
      const left = quoteTotalValue(a.quote.totalDisplay);
      const right = quoteTotalValue(b.quote.totalDisplay);
      if (left === null && right === null) return 0;
      if (left === null) return 1;
      if (right === null) return -1;
      return left - right;
    });
}

// ── Progress counts ───────────────────────────────────────────────────────

export interface MoveTaskCounts {
  total: number;
  working: number;
  submitted: number;
  action: number;
  failed: number;
  done: number;
}

/**
 * Honest buckets: submitted stays distinct from done (provider acceptance is
 * not completion), failed is never relabeled, and everything non-terminal
 * counts as working.
 */
export function moveTaskCounts(tasks: Array<{ state: string }>): MoveTaskCounts {
  const counts: MoveTaskCounts = {
    total: tasks.length,
    working: 0,
    submitted: 0,
    action: 0,
    failed: 0,
    done: 0,
  };
  for (const task of tasks) {
    switch (task.state) {
      case "submitted":
        counts.submitted += 1;
        break;
      case "succeeded":
        counts.done += 1;
        break;
      case "needs-user-action":
        counts.action += 1;
        break;
      case "failed":
      case "error":
        counts.failed += 1;
        break;
      default:
        counts.working += 1;
        break;
    }
  }
  return counts;
}
