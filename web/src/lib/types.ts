// Mirrors the WebSocket protocol locked in /plan-eng-review.

export type AgentState =
  | "dispatched"
  | "calling"
  | "in-progress"
  | "closed"
  | "voicemail"
  | "error";

export type PavoTier = "gemma-local" | "gemini-flash" | "claude-haiku" | "claude-opus" | "fallback-mock";

export type WSEvent =
  | TranscriptTurnEvent
  | RoutingDecisionEvent
  | AgentStateEvent
  | CostUpdateEvent
  | EventCompleteEvent
  | SponsorEvent;

export interface TranscriptTurnEvent {
  type: "transcript_turn";
  event_id: string;
  agent_id: string;
  turn: number;
  role: "agent" | "counterparty" | "user";
  text: string;
  pavo_tier?: PavoTier;
  ts: number;
}

export interface RoutingDecisionEvent {
  type: "routing_decision";
  event_id: string;
  agent_id: string;
  turn: number;
  tier: PavoTier;
  reason: string;
  complexity: number;
  ts: number;
}

export interface AgentStateEvent {
  type: "agent_state";
  event_id: string;
  agent_id: string;
  state: AgentState;
  ts: number;
}

export interface CostUpdateEvent {
  type: "cost_update";
  event_id: string;
  pavo_cents: number;
  baseline_cents: number;
  ts: number;
}

export interface EventCompleteEvent {
  type: "event_complete";
  event_id: string;
  summary: Record<string, unknown>;
  ts: number;
}

export interface SponsorEvent {
  type: "sponsor_event";
  event_id: string;
  sponsor: "stripe" | "agentmail" | "browser_use" | "sponge" | "supermemory" | "moss" | "lob";
  action: string; // e.g., "charge_held", "receipt_sent", "form_submitted"
  detail?: string;
  ts: number;
}

// v2 roster — 12 agents (1 buyer + 11 specialists). See AGENT_COUNT.md.
// Removed in v2: wells_fargo, subscriptions, ca_dmv, ca_voter (see AUDIT.md
// for the four-question test verdicts).
// Order = clockwise burst sequence starting at the top (-90°).
export type AgentMode = "voice" | "browser" | "email" | "mail";

export const ALL_AGENTS = [
  { id: "buyer", name: "Concierge", category: "concierge", mode: "voice" as AgentMode, live: true },
  { id: "pge_shutoff", name: "PG&E Shutoff", category: "utility", mode: "browser" as AgentMode, live: true },
  { id: "comcast_cancel", name: "Comcast Cancel", category: "utility", mode: "mail" as AgentMode, live: true },
  { id: "geico_address", name: "Geico", category: "insurance", mode: "browser" as AgentMode, live: true },
  { id: "spectrum_austin", name: "Spectrum Austin", category: "utility", mode: "browser" as AgentMode, live: true },
  { id: "usps_coa", name: "USPS COA", category: "postal", mode: "browser" as AgentMode, live: true },
  { id: "mover_quote", name: "Mover Quotes", category: "mover", mode: "email" as AgentMode, live: true },
  { id: "school_district", name: "AISD Enrollment", category: "school", mode: "email" as AgentMode, live: true },
  { id: "pcp_transfer", name: "PCP Transfer", category: "medical", mode: "email" as AgentMode, live: true },
  { id: "vet_transfer", name: "Vet Transfer", category: "vet", mode: "email" as AgentMode, live: true },
  { id: "gym_cancel", name: "Gym Cancel", category: "gym", mode: "email" as AgentMode, live: true },
  { id: "pharmacy", name: "Pharmacy", category: "pharmacy", mode: "browser" as AgentMode, live: true },
] as const;

// Backwards-compat alias for any old consumers.
export const LIVE_AGENTS = ALL_AGENTS;

export type AgentId = (typeof ALL_AGENTS)[number]["id"];
