// Mirrors the WebSocket protocol locked in /plan-eng-review.

export type AgentState =
  | "dispatched"
  | "calling"
  | "in-progress"
  | "submitted"
  | "succeeded"
  | "needs-user-action"
  | "failed"
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
  | EventWaitingForUserEvent
  | EventFinalizedEvent
  | SponsorEvent
  | FieldsCollectedEvent
  | ReplyReceivedEvent;

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
  /** Optional measured/configured counterfactual. Null means no baseline exists. */
  baseline_cents: number | null;
  ts: number;
}

export interface EventCompleteEvent {
  type: "event_complete";
  event_id: string;
  summary: Record<string, unknown>;
  ts: number;
}

export interface EventWaitingForUserEvent {
  type: "event_waiting_for_user";
  event_id: string;
  agents: string[];
  count: number;
  ts: number;
}

export interface EventFinalizedEvent {
  type: "event_finalized";
  event_id: string;
  outcome: "submitted" | "partial_failure";
  summary: {
    submitted_count: number;
    failed_count: number;
    summary_email_sent: boolean;
    memory_persisted: boolean;
  };
  ts: number;
}

export interface SponsorEvent {
  type: "sponsor_event";
  event_id: string;
  sponsor: "stripe" | "agentmail" | "browser_use" | "sponge" | "supermemory" | "moss" | "lob";
  action: string;
  detail?: string;
  ts: number;
}

// Emitted when an emailed reply is correlated back to a move. The public
// mirror carries only the sender's domain and arrival time — never content.
export interface ReplyReceivedEvent {
  type: "reply_received";
  event_id: string;
  from_domain: string;
  received_at: number;
  ts: number;
}

// Emitted each time the buyer extracts a new field. Lets the dashboard show
// a live "fields-collected" progress strip.
export interface FieldsCollectedEvent {
  type: "fields_collected";
  event_id: string;
  turn: number;
  fields: string[];
  values: Record<string, string | number | boolean>;
  ts: number;
}

// v2 roster — 17 agents (1 buyer + 16 specialists).
//
// Provider acceptance is represented as `submitted`, not `succeeded`.
// Some agents (uscis_ar11, id_card_update, bank_notify) hand off the final
// click to the customer because federal/state law or bank security can require
// the account holder's signature or identity verification.
//
// Removed in v2: wells_fargo direct-login (replaced by bank_notify script),
// subscriptions (consumer credentials too fragile),
// ca_voter (CA DL identity bar).
//
// Order = clockwise burst sequence starting at the top (-90°).
export type AgentMode = "voice" | "browser" | "email" | "mail";

// Display names kept short (single-line at narrow card widths). Categories
// stay full-word for the SUBTITLE row in the AgentCell.
export const ALL_AGENTS = [
  { id: "buyer", name: "Concierge", category: "concierge", mode: "voice" as AgentMode, live: true },
  { id: "pge_shutoff", name: "PG&E", category: "electric", mode: "browser" as AgentMode, live: true },
  { id: "water_board", name: "Water", category: "water", mode: "browser" as AgentMode, live: true },
  { id: "comcast_cancel", name: "Comcast", category: "internet", mode: "mail" as AgentMode, live: true },
  { id: "geico_address", name: "Geico", category: "insurance", mode: "browser" as AgentMode, live: true },
  { id: "spectrum_austin", name: "Spectrum", category: "internet", mode: "browser" as AgentMode, live: true },
  { id: "usps_coa", name: "USPS", category: "postal", mode: "browser" as AgentMode, live: true },
  { id: "mover_quote", name: "Movers", category: "mover", mode: "email" as AgentMode, live: true },
  { id: "flight_book", name: "Flights", category: "flight", mode: "browser" as AgentMode, live: true },
  { id: "school_district", name: "AISD", category: "school", mode: "email" as AgentMode, live: true },
  { id: "pcp_transfer", name: "PCP", category: "medical", mode: "email" as AgentMode, live: true },
  { id: "vet_transfer", name: "Vet", category: "vet", mode: "email" as AgentMode, live: true },
  { id: "gym_cancel", name: "Gym", category: "fitness", mode: "email" as AgentMode, live: true },
  { id: "pharmacy", name: "Pharmacy", category: "pharmacy", mode: "browser" as AgentMode, live: true },
  { id: "uscis_ar11", name: "USCIS", category: "immigration", mode: "browser" as AgentMode, live: true },
  { id: "id_card_update", name: "DMV", category: "dl card", mode: "mail" as AgentMode, live: true },
  { id: "bank_notify", name: "Bank", category: "bank", mode: "email" as AgentMode, live: true },
] as const;

// Backwards-compat alias for any old consumers.
export const LIVE_AGENTS = ALL_AGENTS;

export type AgentId = (typeof ALL_AGENTS)[number]["id"];
