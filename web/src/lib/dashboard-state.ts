import type {
  AgentState,
  FieldsCollectedEvent,
  PavoTier,
  SponsorEvent,
  WSEvent,
} from "./types";

export type DashboardConnection =
  | "connecting"
  | "live"
  | "reconnecting"
  | "demo"
  | "offline";

export interface TranscriptLine {
  role: string;
  text: string;
  ts: number;
  turn: number;
  tier?: string;
}

export interface DashboardState {
  transcripts: Record<string, TranscriptLine[]>;
  agentStates: Record<string, { state: string; sinceTs: number }>;
  routingDecisions: Array<{
    agent_id: string;
    tier: string;
    reason: string;
    turn: number;
    ts: number;
  }>;
  routingDecisionCount: number;
  tierCounts: Partial<Record<PavoTier, number>>;
  pavoCents: number;
  baselineCents: number | null;
  sponsorEvents: Array<{ sponsor: string; action: string; detail?: string; ts: number }>;
  collectedFields: Record<string, string | number | boolean>;
  connection: DashboardConnection;
  connected: boolean;
  eventId: string | null;
  demoMode: boolean;
  completed: boolean;
  completionSummary: Record<string, unknown> | null;
  waitingForUserAgents: string[];
  finalized: boolean;
  finalOutcome: "submitted" | "partial_failure" | null;
  finalSummary: Record<string, unknown> | null;
  protocolErrors: number;
}

const MAX_TRANSCRIPT_TURNS = 12;
const MAX_RECENT_DECISIONS = 100;
const MAX_SPONSOR_EVENTS = 40;
const MAX_RECONNECT_DELAY_MS = 30_000;

export function reconnectDelay(attempt: number): number {
  return Math.min(MAX_RECONNECT_DELAY_MS, 1000 * 2 ** Math.max(0, attempt));
}

export function createDashboardState(
  connection: DashboardConnection = "connecting",
  eventId: string | null = null,
): DashboardState {
  return {
    transcripts: {},
    agentStates: {},
    routingDecisions: [],
    routingDecisionCount: 0,
    tierCounts: {},
    pavoCents: 0,
    baselineCents: null,
    sponsorEvents: [],
    collectedFields: {},
    connection,
    connected: connection === "live",
    eventId,
    demoMode: connection === "demo",
    completed: false,
    completionSummary: null,
    waitingForUserAgents: [],
    finalized: false,
    finalOutcome: null,
    finalSummary: null,
    protocolErrors: 0,
  };
}

export function withConnection(
  state: DashboardState,
  connection: DashboardConnection,
): DashboardState {
  return {
    ...state,
    connection,
    connected: connection === "live",
    demoMode: connection === "demo",
  };
}

export function applyDashboardEvent(state: DashboardState, event: WSEvent): DashboardState {
  const nextState =
    state.eventId && state.eventId !== event.event_id
      ? createDashboardState(state.connection, event.event_id)
      : state.eventId
        ? state
        : { ...state, eventId: event.event_id };

  switch (event.type) {
    case "transcript_turn": {
      const previous = nextState.transcripts[event.agent_id] ?? [];
      const transcript = [
        ...previous,
        {
          role: event.role,
          text: event.text,
          ts: event.ts,
          turn: event.turn,
          tier: event.pavo_tier,
        },
      ].slice(-MAX_TRANSCRIPT_TURNS);
      return {
        ...nextState,
        transcripts: { ...nextState.transcripts, [event.agent_id]: transcript },
      };
    }
    case "routing_decision": {
      const tierCounts = {
        ...nextState.tierCounts,
        [event.tier]: (nextState.tierCounts[event.tier] ?? 0) + 1,
      };
      return {
        ...nextState,
        routingDecisions: [
          {
            agent_id: event.agent_id,
            tier: event.tier,
            reason: event.reason,
            turn: event.turn,
            ts: event.ts,
          },
          ...nextState.routingDecisions,
        ].slice(0, MAX_RECENT_DECISIONS),
        routingDecisionCount: nextState.routingDecisionCount + 1,
        tierCounts,
      };
    }
    case "agent_state":
      return {
        ...nextState,
        agentStates: {
          ...nextState.agentStates,
          [event.agent_id]: { state: event.state, sinceTs: event.ts },
        },
      };
    case "cost_update":
      return {
        ...nextState,
        pavoCents: event.pavo_cents,
        baselineCents: event.baseline_cents,
      };
    case "event_complete":
      return {
        ...nextState,
        completed: true,
        completionSummary: event.summary,
      };
    case "event_waiting_for_user":
      return {
        ...nextState,
        waitingForUserAgents: event.agents,
        finalized: false,
        finalOutcome: null,
        finalSummary: null,
      };
    case "event_finalized":
      return {
        ...nextState,
        waitingForUserAgents: [],
        finalized: true,
        finalOutcome: event.outcome,
        finalSummary: event.summary,
      };
    case "sponsor_event":
      return {
        ...nextState,
        sponsorEvents: [
          {
            sponsor: event.sponsor,
            action: event.action,
            detail: event.detail,
            ts: event.ts,
          },
          ...nextState.sponsorEvents,
        ].slice(0, MAX_SPONSOR_EVENTS),
      };
    case "fields_collected":
      return applyFields(nextState, event);
  }
}

function applyFields(state: DashboardState, event: FieldsCollectedEvent): DashboardState {
  return {
    ...state,
    collectedFields: { ...state.collectedFields, ...event.values },
  };
}

export function dashboardEventKey(event: WSEvent): string {
  const agentId = "agent_id" in event ? event.agent_id : "dashboard";
  const turn = "turn" in event ? event.turn : "none";
  const action = event.type === "sponsor_event" ? event.action : "none";
  return [event.event_id, event.type, agentId, turn, action, event.ts].join(":");
}

const EVENT_TYPES = new Set([
  "transcript_turn",
  "routing_decision",
  "agent_state",
  "cost_update",
  "event_complete",
  "event_waiting_for_user",
  "event_finalized",
  "sponsor_event",
  "fields_collected",
]);
const AGENT_STATES = new Set<AgentState>([
  "dispatched",
  "calling",
  "in-progress",
  "submitted",
  "succeeded",
  "needs-user-action",
  "failed",
  "closed",
  "voicemail",
  "error",
]);
const PAVO_TIERS = new Set<PavoTier>([
  "gemma-local",
  "gemini-flash",
  "claude-haiku",
  "claude-opus",
  "fallback-mock",
]);
const ROLES = new Set(["agent", "counterparty", "user"]);
const SPONSORS = new Set<SponsorEvent["sponsor"]>([
  "stripe",
  "agentmail",
  "browser_use",
  "sponge",
  "supermemory",
  "moss",
  "lob",
]);

export function parseDashboardEvent(raw: unknown): WSEvent | null {
  if (!isRecord(raw) || typeof raw.type !== "string" || !EVENT_TYPES.has(raw.type)) return null;
  if (typeof raw.event_id !== "string" || raw.event_id.length === 0 || !isFiniteNumber(raw.ts)) {
    return null;
  }

  switch (raw.type) {
    case "transcript_turn":
      return typeof raw.agent_id === "string" &&
        isNonNegativeInteger(raw.turn) &&
        typeof raw.role === "string" &&
        ROLES.has(raw.role) &&
        typeof raw.text === "string" &&
        (raw.pavo_tier === undefined ||
          (typeof raw.pavo_tier === "string" && PAVO_TIERS.has(raw.pavo_tier as PavoTier)))
        ? (raw as unknown as WSEvent)
        : null;
    case "routing_decision":
      return typeof raw.agent_id === "string" &&
        isNonNegativeInteger(raw.turn) &&
        typeof raw.tier === "string" &&
        PAVO_TIERS.has(raw.tier as PavoTier) &&
        typeof raw.reason === "string" &&
        isFiniteNumber(raw.complexity)
        ? (raw as unknown as WSEvent)
        : null;
    case "agent_state":
      return typeof raw.agent_id === "string" &&
        typeof raw.state === "string" &&
        AGENT_STATES.has(raw.state as AgentState)
        ? (raw as unknown as WSEvent)
        : null;
    case "cost_update":
      return isNonNegativeNumber(raw.pavo_cents) &&
        (raw.baseline_cents === null || isNonNegativeNumber(raw.baseline_cents))
        ? (raw as unknown as WSEvent)
        : null;
    case "event_complete":
      return isRecord(raw.summary) ? (raw as unknown as WSEvent) : null;
    case "event_waiting_for_user":
      return Array.isArray(raw.agents) &&
        raw.agents.every((agent) => typeof agent === "string") &&
        isNonNegativeInteger(raw.count) &&
        raw.count === raw.agents.length
        ? (raw as unknown as WSEvent)
        : null;
    case "event_finalized":
      return (raw.outcome === "submitted" || raw.outcome === "partial_failure") &&
        isFinalSummary(raw.summary)
        ? (raw as unknown as WSEvent)
        : null;
    case "sponsor_event":
      return typeof raw.sponsor === "string" &&
        SPONSORS.has(raw.sponsor as SponsorEvent["sponsor"]) &&
        typeof raw.action === "string" &&
        (raw.detail === undefined || typeof raw.detail === "string")
        ? (raw as unknown as WSEvent)
        : null;
    case "fields_collected":
      return isNonNegativeInteger(raw.turn) &&
        Array.isArray(raw.fields) &&
        raw.fields.every((field) => typeof field === "string") &&
        isFieldValues(raw.values)
        ? (raw as unknown as WSEvent)
        : null;
    default:
      return null;
  }
}

export function parseDashboardMessage(data: unknown): WSEvent | null {
  if (typeof data !== "string") return null;
  try {
    return parseDashboardEvent(JSON.parse(data));
  } catch {
    return null;
  }
}

export type SponsorStatus = "reported" | "fallback" | "error" | "idle" | "demo";

export function sponsorStatus(
  event: { action: string } | undefined,
  demoMode: boolean,
): SponsorStatus {
  if (!event) return "idle";
  if (event.action === "error" || event.action.endsWith("_error")) return "error";
  if (event.action === "stubbed" || event.action.includes("fallback")) return "fallback";
  return demoMode ? "demo" : "reported";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isFieldValues(value: unknown): value is Record<string, string | number | boolean> {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (field) => typeof field === "string" || typeof field === "number" || typeof field === "boolean",
    )
  );
}

function isFinalSummary(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNonNegativeInteger(value.submitted_count) &&
    isNonNegativeInteger(value.failed_count) &&
    typeof value.summary_email_sent === "boolean" &&
    typeof value.memory_persisted === "boolean"
  );
}
