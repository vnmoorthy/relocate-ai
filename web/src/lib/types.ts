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
  sponsor: "stripe" | "agentmail" | "browser_use" | "sponge" | "supermemory" | "moss";
  action: string; // e.g., "charge_held", "receipt_sent", "form_submitted"
  detail?: string;
  ts: number;
}

// All 12 agents — strict-completion roster (down from 16 after auditing which
// tasks can be 100% real). Removed agents required SSN/bank-login/DMV-identity
// verification that can't be legally automated.
// Order = clockwise burst sequence starting at the top (-90°).
export const ALL_AGENTS = [
  { id: "buyer", name: "Concierge", category: "concierge", live: true },
  { id: "pge_shutoff", name: "PG&E Shutoff", category: "utility", live: true },
  { id: "comcast_cancel", name: "Comcast Cancel", category: "utility", live: true },
  { id: "geico_address", name: "Geico", category: "insurance", live: true },
  { id: "spectrum_austin", name: "Spectrum Austin", category: "utility", live: true },
  { id: "usps_coa", name: "USPS COA", category: "postal", live: true },
  { id: "mover_quote", name: "Mover Quotes", category: "mover", live: true },
  { id: "school_district", name: "AISD Enrollment", category: "school", live: true },
  { id: "pcp_transfer", name: "PCP Transfer", category: "medical", live: true },
  { id: "vet_transfer", name: "Vet Transfer", category: "vet", live: true },
  { id: "gym_cancel", name: "Gym Cancel", category: "gym", live: true },
  { id: "pharmacy", name: "Pharmacy", category: "pharmacy", live: true },
] as const;

// Backwards-compat alias for any old consumers.
export const LIVE_AGENTS = ALL_AGENTS;

export type AgentId = (typeof ALL_AGENTS)[number]["id"];
