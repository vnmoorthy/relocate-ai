/**
 * Pure helpers for the shareable /move tracking page.
 *
 * The page is a static export served under a basePath, so the move id rides
 * in the URL hash (/move/#mkt_abc123) and every byte of backend data is
 * treated as untrusted input: the snapshot is validated field-by-field and
 * anything malformed degrades to a safe default instead of throwing.
 */

import { ALL_AGENTS, isPreparedOutcome } from "./types.ts";

// ── Move id (URL hash) ────────────────────────────────────────────────────

const MOVE_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;

/** "#mkt_abc123" (or "mkt_abc123") → "mkt_abc123"; anything unsafe → null. */
export function moveIdFromHash(hash: string): string | null {
  const raw = (hash.startsWith("#") ? hash.slice(1) : hash).trim();
  return MOVE_ID_RE.test(raw) ? raw : null;
}

/** Snapshot endpoint for one move. */
/** Endpoint for supplying the details a blocked specialist is waiting on. */
export function moveDetailsUrl(api: string, eventId: string): string {
  return `${api}/api/public/move/${encodeURIComponent(eventId)}/details`;
}

/**
 * Specialists that a customer could unblock right now by typing an account
 * number — the ones a spoken call deliberately never asks for.
 *
 * Only tasks blocked on missing fields qualify: a signature or a portal login
 * is not something a text box can fix, and offering it would be a lie.
 */
/**
 * Fields a customer can reasonably type to unblock work. Passwords, payment
 * cards and signature flags are deliberately absent: a text box cannot stand
 * in for a portal login or a signature, and offering one would promise work
 * the swarm still could not do.
 */
export const ASKABLE_FIELDS: Record<string, { label: string; hint: string }> = {
  pge_account_number: { label: "PG&E account number", hint: "Top of any PG&E bill" },
  comcast_account_number: {
    label: "Comcast account number",
    hint: "On your bill or in the Xfinity app",
  },
  equinox_member_id: { label: "Gym member ID", hint: "On your membership card or app" },
  user_name: { label: "Your full name", hint: "As it appears on the account" },
  user_phone: { label: "Your phone", hint: "For provider callbacks" },
  work_address: { label: "Work address", hint: "For the commute and housing briefs" },
  vet_email: { label: "Your vet's email", hint: "Where records should be requested" },
  child_name: { label: "Child's name", hint: "For the school enrolment inquiry" },
  child_grade: { label: "Child's grade", hint: "Entering grade at the new school" },
};

/** Tasks whose every missing field is something we can honestly ask for. */
export function unlockableTasks(tasks: MoveTaskView[]): MoveTaskView[] {
  return tasks.filter(
    (task) =>
      task.state === "needs-user-action" &&
      task.blockerKind === "missing_fields" &&
      task.missingFields.length > 0 &&
      task.missingFields.every(
        (field) => field in ASKABLE_FIELDS || field === "service_authorization_signed",
      ),
  );
}

/** The distinct inputs to render for a set of unlockable tasks. */
export function askableFieldsFor(tasks: MoveTaskView[]): string[] {
  const seen = new Set<string>();
  for (const task of tasks) {
    for (const field of task.missingFields) {
      if (field in ASKABLE_FIELDS) seen.add(field);
    }
  }
  return [...seen];
}

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
  /** What this specialist actually did — "Requested from 3 providers",
   *  "Prepared for you", "Sent to your inbox". Null when it did nothing
   *  because it is blocked on the user. */
  did: string | null;
  /** Public page where the user finishes this task themselves. */
  actionUrl: string | null;
  /** Field NAMES this specialist is waiting on (never values). */
  missingFields: string[];
  /** Title of a prepared script/letter/checklist already emailed to the user. */
  playbookTitle: string | null;
  /** True only once the digest email actually returned a provider receipt. */
  playbookDelivered: boolean;
  /**
   * Why that digest is not with the reader, when it is not: "rerouted" is a
   * send that succeeded to somebody else (demo routing), which is neither a
   * delivery nor a send still to come. Null on deployments that do not state
   * it, where playbookDelivered is the whole story.
   */
  playbookDelivery: PlaybookDelivery | null;
}

/** The states the server distinguishes for a prepared digest. */
export type PlaybookDelivery = "delivered" | "pending" | "rerouted";

function asPlaybookDelivery(value: unknown): PlaybookDelivery | null {
  return value === "delivered" || value === "pending" || value === "rerouted" ? value : null;
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
  /**
   * True when this reply came from the deployment's own demo inbox rather
   * than from a counterparty. It is still a real message, but it is not a
   * provider's bid and must never be ranked against one.
   */
  selfRouted: boolean;
  quote: MoveReplyQuote | null;
}

export interface MoveSnapshot {
  event_id: string;
  /**
   * Opaque alias this move is published under on the public live feed. The
   * real event id is a capability (it unlocks this snapshot), so the feed
   * never carries it — live events are matched on this instead.
   */
  public_ref: string;
  route: { origin_address: string; destination_address: string; move_date: string };
  flags: { has_pets: boolean; has_children: boolean; has_car: boolean; has_visa: boolean };
  specialists: MoveSpecialistSnapshot[];
  /** Requests that actually left the building, and answers that came back. */
  outboundRequests: number;
  repliesReceived: number;
  replies: MoveReply[];
  dispatched: boolean;
  finalized: boolean;
  final_outcome: string | null;
  /** Server ts (epoch seconds) this snapshot describes; 0 when unstated. */
  ts: number;
  /**
   * True when the deployment reroutes every outbound message to its own demo
   * inbox. Nothing reaches a provider then, so no copy on this page may claim
   * one was contacted. Absent on deployments that do not send the flag, which
   * is the honest default: normal routing.
   */
  demoRouting: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Non-empty string → itself; anything else → null. */
/** Only an https URL is ever rendered as a link the user can click. */
function asHttpsUrlOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

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
        missingFields: Array.isArray(item.missing_fields)
          ? item.missing_fields.filter((f): f is string => typeof f === "string")
          : [],
        did: asNonEmptyStringOrNull(item.did),
        actionUrl: asHttpsUrlOrNull(item.action_url),
        playbookTitle: asNonEmptyStringOrNull(item.playbook_title),
        playbookDelivered: item.playbook_delivered === true,
        playbookDelivery: asPlaybookDelivery(item.playbook_delivery),
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
        selfRouted: item.self_routed === true,
        quote: parseReplyQuote(item.quote),
      });
    }
  }

  return {
    event_id: raw.event_id,
    public_ref: typeof raw.public_ref === "string" ? raw.public_ref : "",
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
    outboundRequests:
      typeof raw.outbound_requests === "number" && Number.isFinite(raw.outbound_requests)
        ? raw.outbound_requests
        : 0,
    repliesReceived:
      typeof raw.replies_received === "number" && Number.isFinite(raw.replies_received)
        ? raw.replies_received
        : 0,
    replies,
    dispatched: raw.dispatched === true,
    finalized: raw.finalized === true,
    final_outcome: typeof raw.final_outcome === "string" ? raw.final_outcome : null,
    ts: typeof raw.ts === "number" && Number.isFinite(raw.ts) ? raw.ts : 0,
    demoRouting: raw.demo_routing === true,
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
 *
 * `demoRouting` reroutes every honest claim about delivery: on a deployment
 * that collapses all outbound mail into its own demo inbox, nothing reached
 * the provider and nothing reached the reader either, and every line here has
 * to say so rather than describe the send that was attempted.
 */
export function taskLine(
  state: string,
  blockerKind: string | null,
  playbookTitle: string | null = null,
  playbookDelivered = false,
  terminalOutcome: string | null = null,
  did: string | null = null,
  demoRouting = false,
  playbookDelivery: PlaybookDelivery | null = null,
): string {
  if (state === "needs-user-action" && playbookTitle) {
    // A digest that went somewhere else is not on its way to the reader, and
    // "emailing it to you" would be a stall dressed up as progress.
    if (playbookDelivery === "rerouted" || (playbookDelivery === null && demoRouting)) {
      return `Prepared: ${playbookTitle} — demo routing sent it to the operator's inbox, not yours.`;
    }
    return playbookDelivered
      ? `Prepared: ${playbookTitle} — sent to your inbox.`
      : `Prepared: ${playbookTitle} — emailing it to you.`;
  }
  if (blockerKind && BLOCKER_LINES[blockerKind]) return BLOCKER_LINES[blockerKind];
  // The server's own account of a self-delivered specialist: its one email
  // went to the customer, never to a provider.
  if (did === "Sent to your inbox") {
    return demoRouting
      ? "Prepared for you — demo routing sent it to the operator's inbox, not yours."
      : "Sent to your inbox — the final step is yours.";
  }
  // Prepared work reached no counterparty at all, whichever way the server
  // said so. It is terminal, but it is not a submission.
  if (isPreparedOutcome(state, terminalOutcome)) {
    return "Prepared for you — the final step is yours.";
  }
  switch (state) {
    case "submitted":
      // The server reports how many providers this specialist asked. Anything
      // vaguer reads as work that did not happen — and under demo routing the
      // ask itself never left the deployment.
      if (did && did.startsWith("Requested from")) {
        return `${did} — awaiting their reply.`;
      }
      // The server states the rest in its own words — a partial fan-out, or a
      // request demo routing never let out of the building. Its account is
      // more truthful than any generic line this page could substitute.
      if (did) return `${did}.`;
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
  playbookDelivered: boolean;
  playbookDelivery: PlaybookDelivery | null;
  terminalOutcome: string | null;
  /** The server's own account of what this specialist did. */
  did: string | null;
  /** Public page where the user finishes this task themselves. */
  actionUrl: string | null;
  /** Field names this task is waiting on (never values). */
  missingFields: string[];
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
 * One live agent_state event, as the pages keep it: the state, when the
 * server said it, and the honest outcome behind it. `ts` is what makes a
 * later snapshot comparable to it (see pruneMoveOverlay).
 */
export interface MoveOverlayEntry {
  state: string;
  ts: number;
  terminalOutcome: string | null;
}

/**
 * Overlay entries still worth keeping across a snapshot refresh: only the
 * ones the snapshot cannot already know about. Wiping the overlay would roll
 * a task back to a state the server has already superseded; keeping all of it
 * would pin a stale live state over a fresher snapshot.
 */
export function pruneMoveOverlay(
  overlay: Record<string, MoveOverlayEntry>,
  snapshotTs: number,
): Record<string, MoveOverlayEntry> {
  const kept: Record<string, MoveOverlayEntry> = {};
  for (const [agentId, live] of Object.entries(overlay)) {
    if (live.ts > snapshotTs) kept[agentId] = live;
  }
  return kept;
}

/**
 * States a specialist never leaves. A snapshot where every task is terminal
 * is the only one worth trusting as final — anything else means the page is
 * still watching a move that has not settled.
 */
const TERMINAL_TASK_STATES = new Set([
  "submitted",
  "prepared",
  "succeeded",
  "needs-user-action",
  "failed",
  "error",
  "closed",
  "voicemail",
]);

export function isTerminalTaskState(state: string): boolean {
  return TERMINAL_TASK_STATES.has(state);
}

/**
 * Whether this row may claim a provider accepted its request.
 *
 * Two ways it may not. The outcome itself can say so (`isPreparedOutcome`),
 * and demo routing can: it rewrites every outbound recipient to the
 * deployment's own inbox, so on such a deployment NOTHING was submitted to
 * anybody, whatever lifecycle state the specialist reached. The server says
 * exactly that in its own `did` line ("no provider was contacted") — a
 * SUBMITTED badge and a submitted tally beside that sentence contradict it.
 */
export function taskIsPrepared(
  state: string,
  terminalOutcome: string | null | undefined,
  demoRouting = false,
): boolean {
  return isPreparedOutcome(state, terminalOutcome, demoRouting);
}

/**
 * Snapshot specialists overlaid with live agent_state events (overlay wins —
 * it is strictly newer than the snapshot). The concierge ("buyer") is not a
 * per-move task. A blocker — and the playbook prepared for it — survives only
 * while the state it explained holds.
 */
export function mergeMoveTasks(
  specialists: MoveSpecialistSnapshot[],
  overlay: Record<string, MoveOverlayEntry>,
  demoRouting = false,
): MoveTaskView[] {
  const byId = new Map<
    string,
    {
      state: string;
      blockerKind: string | null;
      playbookTitle: string | null;
      playbookDelivered: boolean;
      playbookDelivery: PlaybookDelivery | null;
      terminalOutcome: string | null;
      did: string | null;
      actionUrl: string | null;
      missingFields: string[];
    }
  >();
  for (const specialist of specialists) {
    if (specialist.agent_id === "buyer") continue;
    byId.set(specialist.agent_id, {
      state: specialist.state,
      blockerKind: specialist.blocker_kind,
      playbookTitle: specialist.playbookTitle,
      playbookDelivered: specialist.playbookDelivered,
      playbookDelivery: specialist.playbookDelivery,
      terminalOutcome: specialist.terminal_outcome,
      did: specialist.did,
      actionUrl: specialist.actionUrl,
      missingFields: specialist.missingFields,
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
      playbookDelivered: stateHolds ? base.playbookDelivered : false,
      playbookDelivery: stateHolds ? base.playbookDelivery : null,
      // The live event carries its own outcome; only fall back to the
      // snapshot's when the state it described still holds. Without this a
      // prepared specialist would spend the live window labelled SUBMITTED.
      terminalOutcome: live.terminalOutcome ?? (stateHolds ? base.terminalOutcome : null),
      did: stateHolds ? base.did : null,
      actionUrl: stateHolds ? base.actionUrl : null,
      missingFields: stateHolds ? base.missingFields : [],
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
      playbookDelivered: task.playbookDelivered,
      playbookDelivery: task.playbookDelivery,
      terminalOutcome: task.terminalOutcome,
      did: task.did,
      actionUrl: task.actionUrl,
      missingFields: task.missingFields,
      line: taskLine(
        task.state,
        task.blockerKind,
        task.playbookTitle,
        task.playbookDelivered,
        task.terminalOutcome,
        task.did,
        demoRouting,
        task.playbookDelivery,
      ),
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
/**
 * Only replies to a quote-soliciting specialist may be compared. A dollar
 * figure in a school or vet reply is not a moving bid, and ranking it (or
 * badging it "Lowest") would present unrelated numbers as competing quotes.
 */
const QUOTE_AGENTS = new Set(["mover_quote"]);

export function sortQuotedReplies(
  replies: MoveReply[],
): Array<MoveReply & { quote: MoveReplyQuote }> {
  return replies
    .filter(
      (reply): reply is MoveReply & { quote: MoveReplyQuote } =>
        reply.quote !== null &&
        reply.agentId !== null &&
        QUOTE_AGENTS.has(reply.agentId) &&
        // A message the deployment sent to itself is not a competing bid, and
        // badging it "Lowest" would present our own numbers as a mover's.
        !reply.selfRouted,
    )
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
  prepared: number;
  action: number;
  failed: number;
  done: number;
}

/**
 * Honest buckets: submitted stays distinct from done (provider acceptance is
 * not completion), prepared stays distinct from submitted (nobody was
 * contacted at all), failed is never relabeled, and everything non-terminal
 * counts as working.
 */
export function moveTaskCounts(
  tasks: Array<{ state: string; terminalOutcome?: string | null }>,
  demoRouting = false,
): MoveTaskCounts {
  const counts: MoveTaskCounts = {
    total: tasks.length,
    working: 0,
    submitted: 0,
    prepared: 0,
    action: 0,
    failed: 0,
    done: 0,
  };
  for (const task of tasks) {
    if (taskIsPrepared(task.state, task.terminalOutcome, demoRouting)) {
      counts.prepared += 1;
      continue;
    }
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
