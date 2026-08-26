import type { WSEvent } from "./types";

/**
 * Demo replay — fake WSEvent timeline used when no live orchestrator is reachable
 * (e.g. on the static GitHub Pages deploy). Every value is intentionally synthetic,
 * and the UI labels the entire sequence as a demo replay.
 *
 * Real orchestrator + buyer call always wins; this only kicks in after the WebSocket
 * fails to connect within `FALLBACK_DELAY_MS` (see ws-client.ts).
 *
 * The timeline is a ~60-second stage arc:
 *   ~0–7s    buyer call, field collection, buyer close
 *   ~8–17s   staggered specialist fan-out
 *   ~9–44s   interleaved specialist transcript turns
 *   ~27s     spectrum_austin fails (isolated — the other 15 keep working)
 *   ~28–45s  terminal cascade: 12 submitted, 3 needs-user-action
 *   ~46s     event_waiting_for_user (the three signature/consent handoffs)
 *   ~57s     event_finalized (partial_failure: 12 submitted, 1 failed)
 * Cost ticks fire every 2s from 8s to 54s so no stretch goes visually dead.
 *
 * Terminal states mirror the runtime policy (see DEMO_SCRIPT.md narration rules):
 * government filings, medical releases, and membership cancellations that need the
 * user's own signature end as needs-user-action handoffs — never "filed".
 */

const EVENT_ID = "mkt_demo_replay";

const DEMO_SPEC = {
  origin_address: "123 Main St, San Francisco, CA",
  destination_address: "456 Oak St, Austin, TX",
  move_date: "2026-05-31",
  user_email: "demo.customer@example.com",
  household_size: 3,
  has_pets: true,
  has_children: true,
  has_car: true,
  has_visa: true,
} as const;

// Agents and their representative dialogue per mode
type Step = { role: "counterparty" | "agent"; text: string; tier?: "gemma-local" | "gemini-flash" | "claude-opus" };

const SCRIPTS: Record<string, Step[]> = {
  pge_shutoff: [
    { role: "counterparty", text: "pge.com Stop Service portal loaded." },
    { role: "agent", text: "Filling account 5512-4419-08, disconnect date May 31.", tier: "gemma-local" },
    { role: "counterparty", text: "Identity verified. Submit?" },
    { role: "agent", text: "Stop-service request submitted for May 31 — PG&E will email the final-bill confirmation.", tier: "gemini-flash" },
  ],
  water_board: [
    { role: "counterparty", text: "SFPUC MyAccount session opened." },
    { role: "agent", text: "Selecting Stop Service, May 31 final meter read.", tier: "gemma-local" },
    { role: "counterparty", text: "Final reading scheduled. Confirmation?" },
    { role: "agent", text: "Stop-service request submitted — SFPUC lists the final meter read for May 31.", tier: "gemma-local" },
  ],
  comcast_cancel: [
    { role: "counterparty", text: "Lob certified-mail draft generated." },
    { role: "agent", text: "Letter addressed to Comcast Customer Care, Philadelphia.", tier: "gemma-local" },
    { role: "counterparty", text: "Mailpiece submitted. USPS tracking: 9407 1118 9899 9988 8772 65." },
    { role: "agent", text: "Cancellation letter is in the mail via certified post — the tracking info lands in your inbox.", tier: "gemma-local" },
  ],
  geico_address: [
    { role: "counterparty", text: "Geico self-service portal loaded." },
    { role: "agent", text: "Old garage 123 Main St SF, new garage 456 Oak Austin TX.", tier: "gemma-local" },
    { role: "counterparty", text: "TX rate quoted: $142/mo (was $186). Accept?" },
    { role: "agent", text: "Address change submitted — Geico quoted $142/mo in Texas; nothing is bound until you approve.", tier: "gemini-flash" },
  ],
  spectrum_austin: [
    { role: "counterparty", text: "Spectrum new-service order page open." },
    { role: "agent", text: "Internet Ultra 500, install May 31 at 456 Oak Austin.", tier: "gemma-local" },
    { role: "counterparty", text: "502 from the order portal — session dropped before checkout." },
    { role: "agent", text: "Provider portal returned an error — retry scheduled; other specialists unaffected.", tier: "gemma-local" },
  ],
  usps_coa: [
    { role: "counterparty", text: "moversguide.usps.com loaded." },
    { role: "agent", text: "Old SF address, new Austin address, family move, May 31.", tier: "gemma-local" },
    { role: "counterparty", text: "$1.10 identity-verification charge approved." },
    { role: "agent", text: "Change-of-address request submitted — USPS will email the forwarding confirmation.", tier: "gemma-local" },
  ],
  mover_quote: [
    { role: "counterparty", text: "Email sent to Atlas, Bay Area, Mayflower." },
    { role: "agent", text: "Atlas replied: $1,840 OTD, $500 deposit, truck confirmed.", tier: "gemini-flash" },
    { role: "counterparty", text: "Bay Area: $2,140 OTD. Mayflower: $1,910." },
    { role: "agent", text: "Three quotes in — Atlas leads at $1,840 OTD; no mover is booked until you pick one.", tier: "gemini-flash" },
  ],
  flight_book: [
    { role: "counterparty", text: "Google Flights SFO→AUS, May 31, 1 passenger." },
    { role: "agent", text: "Top 3: United $187 / 3h25m nonstop, Alaska $174 1-stop, SW $159 1-stop.", tier: "gemini-flash" },
    { role: "counterparty", text: "Pick top 3 sorted by price-duration tradeoff." },
    { role: "agent", text: "Top three fares shortlisted with booking links — no ticket is purchased without you.", tier: "gemini-flash" },
  ],
  school_district: [
    { role: "counterparty", text: "AISD transfer office, this is Tara." },
    { role: "agent", text: "Initiating enrollment, child grade 4 transferring from SFUSD.", tier: "gemma-local" },
    { role: "counterparty", text: "Need immunization records + transcript. Records request sent?" },
    { role: "agent", text: "Enrollment request opened with AISD — records checklist routed to your inbox.", tier: "gemma-local" },
  ],
  pcp_transfer: [
    { role: "counterparty", text: "One Medical records team, this is Devon." },
    { role: "agent", text: "Requesting records transfer to an Austin PCP for a relocating patient.", tier: "gemma-local" },
    { role: "counterparty", text: "We need a signed patient authorization before any records move." },
    { role: "agent", text: "Records-release form prepared — awaiting your signature; nothing moves without it.", tier: "claude-opus" },
  ],
  vet_transfer: [
    { role: "counterparty", text: "SF Pet Clinic — pet's name?" },
    { role: "agent", text: "Captain, golden retriever, all vaccines current.", tier: "gemma-local" },
    { role: "counterparty", text: "Records sent to destination clinic." },
    { role: "agent", text: "Records request submitted to SF Pet Clinic — Captain's file routes to your Austin vet.", tier: "gemma-local" },
  ],
  gym_cancel: [
    { role: "counterparty", text: "Equinox SF — cancellations need the member's written notice." },
    { role: "agent", text: "Drafting written cancellation, effective May 31, relocation clause cited.", tier: "gemma-local" },
    { role: "counterparty", text: "We can only process it with the member's signed authorization." },
    { role: "agent", text: "Written cancellation drafted, relocation clause cited — waiting on your signature.", tier: "claude-opus" },
  ],
  pharmacy: [
    { role: "counterparty", text: "cvs.com Transfer Prescriptions form open." },
    { role: "agent", text: "3 active scripts → CVS Austin store 8842, pickup by May 31.", tier: "gemma-local" },
    { role: "counterparty", text: "Transfer queued. Confirmation?" },
    { role: "agent", text: "Transfer request submitted for 3 prescriptions — the Austin store will confirm pickup.", tier: "gemma-local" },
  ],
  uscis_ar11: [
    { role: "counterparty", text: "uscis.gov/ar-11 form loaded." },
    { role: "agent", text: "A-number, name, old/new address, move date filled.", tier: "gemini-flash" },
    { role: "counterparty", text: "Signature step reached — pause for user." },
    { role: "agent", text: "AR-11 prepared — awaiting your signature; nothing is filed without it.", tier: "claude-opus" },
  ],
  id_card_update: [
    { role: "counterparty", text: "Lob certified-mail draft for DL-13A." },
    { role: "agent", text: "Letter to CA DMV Address Change Unit, PO Box 942869 Sacramento.", tier: "gemma-local" },
    { role: "counterparty", text: "Mailpiece accepted, USPS tracking 7019 0140 0000 9388 4471." },
    { role: "agent", text: "DL-13A letter mailed certified to the CA DMV — tracking info sent to your inbox.", tier: "gemma-local" },
  ],
  bank_notify: [
    { role: "counterparty", text: "AgentMail composing playbook to customer@example.com." },
    { role: "agent", text: "90-second bank script: number, exact wording, expected verification.", tier: "gemma-local" },
    { role: "counterparty", text: "AgentMail returned message_id <m07a91…@agentmail.to>." },
    { role: "agent", text: "90-second call script emailed — your bank requires you on the line; the script gives exact wording.", tier: "gemma-local" },
  ],
};

// Honest terminal states, mirroring the runtime policy: signature/consent-gated
// workflows hand off to the user; one synthetic provider failure stays isolated.
type TerminalState = "submitted" | "needs-user-action" | "failed";
const TERMINAL_STATES: Record<string, TerminalState> = {
  spectrum_austin: "failed",
  pcp_transfer: "needs-user-action",
  gym_cancel: "needs-user-action",
  uscis_ar11: "needs-user-action",
};

// Per-agent gap between transcript turns (ms). Hand-tuned so turns interleave
// across the whole run and terminal states cascade from ~28s to ~45s instead of
// landing in one burst. spectrum_austin runs fastest so its failure hits mid-run
// (~27s) while every other specialist is still visibly working.
const TURN_GAPS_MS: Record<string, number> = {
  pge_shutoff: 6200,
  water_board: 7400,
  comcast_cancel: 6800,
  geico_address: 8200,
  spectrum_austin: 4900,
  usps_coa: 7000,
  mover_quote: 7800,
  flight_book: 6500,
  school_district: 8400,
  pcp_transfer: 8000,
  vet_transfer: 7200,
  gym_cancel: 8600,
  pharmacy: 6600,
  uscis_ar11: 8800,
  id_card_update: 7600,
  bank_notify: 8300,
};

// Sponsor/artifact fires spread across the run (not front-loaded) so the
// artifacts panel keeps moving through the middle of the demo.
const SPONSOR_FIRES: Array<{ at_ms: number; sponsor: string; action: string; detail: string }> = [
  { at_ms: 1800, sponsor: "supermemory", action: "user_profile_recalled", detail: "Prior move Berkeley→SF Sept 2025" },
  { at_ms: 9200, sponsor: "browser_use", action: "task_started", detail: "pge.com/stop-service" },
  { at_ms: 14800, sponsor: "agentmail", action: "outreach_sent", detail: "atlas-moving.com, bayareamovers.com, mayflower.com" },
  { at_ms: 21500, sponsor: "lob", action: "mailpiece_created", detail: "Comcast cancellation letter, USPS tracking 940711…" },
  { at_ms: 26900, sponsor: "browser_use", action: "task_error", detail: "spectrum.com order portal returned 502; retry scheduled" },
  { at_ms: 33800, sponsor: "agentmail", action: "receipt_sent", detail: "Move package PDF → customer@example.com" },
  { at_ms: 40200, sponsor: "lob", action: "mailpiece_created", detail: "CA DMV DL-13A letter, USPS tracking 701901…" },
  { at_ms: 48500, sponsor: "supermemory", action: "move_persisted", detail: "doc_id=TfdMnS737z4n1tBQxKtrM" },
];

// Fan-out pacing
const FAN_OUT_AT = 7600;
const FAN_STAGGER_MS = 620;
const FIRST_TURN_DELAY_MS = 1500;
const CLOSE_AFTER_LAST_TURN_MS = 1400;

// Late-run beats
const WAITING_FOR_USER_AT = 46200;
const FINALIZED_AT = 57000;

/**
 * Generate the full event timeline for a demo replay. Returns events keyed by
 * relative ms. ws-client.ts schedules them on setTimeout. Fully deterministic:
 * the same timeline is produced on every loop.
 */
export function buildDemoTimeline(): Array<{ at_ms: number; event: WSEvent }> {
  const out: Array<{ at_ms: number; event: WSEvent }> = [];
  const t0_buyer = 500;

  out.push(
    {
      at_ms: 0,
      event: {
        type: "agent_state",
        event_id: EVENT_ID,
        agent_id: "buyer",
        state: "calling",
        ts: 0,
      },
    },
    {
      at_ms: 300,
      event: {
        type: "agent_state",
        event_id: EVENT_ID,
        agent_id: "buyer",
        state: "in-progress",
        ts: 0,
      },
    },
  );

  // Buyer turns (concierge → caller exchange before fan-out)
  const buyerTurns: Array<{ role: "user" | "agent"; text: string; tier?: "gemma-local" }> = [
    { role: "user", text: "Moving SF to Austin May 31 — two adults, one kid, one dog, one car, and I need my AR-11 updated." },
    { role: "agent", text: "Got it — full roster: pets, kids, car, visa. What email should confirmations hit?", tier: "gemma-local" },
    { role: "user", text: DEMO_SPEC.user_email },
    { role: "agent", text: "Dispatching the specialists now. Hang up whenever — I'll keep working.", tier: "gemma-local" },
  ];
  for (let i = 0; i < buyerTurns.length; i++) {
    const t = buyerTurns[i];
    out.push({
      at_ms: t0_buyer + i * 1500,
      event: {
        type: "transcript_turn",
        event_id: EVENT_ID,
        agent_id: "buyer",
        turn: i + 1,
        role: t.role === "user" ? "user" : "agent",
        text: t.text,
        pavo_tier: t.tier,
        ts: 0,
      },
    });
    if (t.role === "agent" && t.tier) {
      out.push({
        at_ms: t0_buyer + i * 1500 + 50,
        event: {
          type: "routing_decision",
          event_id: EVENT_ID,
          agent_id: "buyer",
          turn: i + 1,
          tier: t.tier,
          reason: "buyer-extract early turn",
          complexity: 0.1,
          ts: 0,
        },
      });
    }
  }

  out.push(
    {
      at_ms: 2600,
      event: {
        type: "fields_collected",
        event_id: EVENT_ID,
        turn: 2,
        fields: [
          "origin_address",
          "destination_address",
          "move_date",
          "household_size",
          "has_pets",
          "has_children",
          "has_car",
          "has_visa",
        ],
        values: {
          origin_address: DEMO_SPEC.origin_address,
          destination_address: DEMO_SPEC.destination_address,
          move_date: DEMO_SPEC.move_date,
          household_size: DEMO_SPEC.household_size,
          has_pets: DEMO_SPEC.has_pets,
          has_children: DEMO_SPEC.has_children,
          has_car: DEMO_SPEC.has_car,
          has_visa: DEMO_SPEC.has_visa,
        },
        ts: 0,
      },
    },
    {
      at_ms: 4300,
      event: {
        type: "fields_collected",
        event_id: EVENT_ID,
        turn: 3,
        fields: ["user_email"],
        values: { user_email: DEMO_SPEC.user_email },
        ts: 0,
      },
    },
    {
      at_ms: 6800,
      event: {
        type: "agent_state",
        event_id: EVENT_ID,
        agent_id: "buyer",
        state: "closed",
        ts: 0,
      },
    },
  );

  // After the buyer wraps, fan out: specialists dispatch in a staggered cascade
  // (~8–17s) so the stage fills visibly instead of all at once.
  const SPECIALIST_IDS = Object.keys(SCRIPTS).filter((agentId) => {
    if (agentId === "school_district") return DEMO_SPEC.has_children;
    if (agentId === "uscis_ar11") return DEMO_SPEC.has_visa;
    if (agentId === "geico_address" || agentId === "id_card_update") return DEMO_SPEC.has_car;
    if (agentId === "vet_transfer") return DEMO_SPEC.has_pets;
    return true;
  });
  for (let i = 0; i < SPECIALIST_IDS.length; i++) {
    const agent_id = SPECIALIST_IDS[i];
    const offset = FAN_OUT_AT + i * FAN_STAGGER_MS;
    out.push({
      at_ms: offset,
      event: {
        type: "agent_state",
        event_id: EVENT_ID,
        agent_id,
        state: "dispatched",
        ts: 0,
      },
    });
    out.push({
      at_ms: offset + 650,
      event: {
        type: "agent_state",
        event_id: EVENT_ID,
        agent_id,
        state: "in-progress",
        ts: 0,
      },
    });

    // Stream that specialist's 4-turn conversation, interleaved with the others
    const script = SCRIPTS[agent_id];
    const turnGap = TURN_GAPS_MS[agent_id] ?? 7000;
    let lastTurnAt = offset + FIRST_TURN_DELAY_MS;
    for (let j = 0; j < script.length; j++) {
      const step = script[j];
      const tt = offset + FIRST_TURN_DELAY_MS + j * turnGap;
      lastTurnAt = tt;
      out.push({
        at_ms: tt,
        event: {
          type: "transcript_turn",
          event_id: EVENT_ID,
          agent_id,
          turn: j + 1,
          role: step.role,
          text: step.text,
          pavo_tier: step.tier,
          ts: 0,
        },
      });
      if (step.role === "agent" && step.tier) {
        out.push({
          at_ms: tt + 60,
          event: {
            type: "routing_decision",
            event_id: EVENT_ID,
            agent_id,
            turn: j + 1,
            tier: step.tier,
            reason: tierReason(step.tier),
            complexity: tierComplexity(step.tier),
            ts: 0,
          },
        });
      }
    }

    // Close with the agent's honest terminal state
    out.push({
      at_ms: lastTurnAt + CLOSE_AFTER_LAST_TURN_MS,
      event: {
        type: "agent_state",
        event_id: EVENT_ID,
        agent_id,
        state: TERMINAL_STATES[agent_id] ?? "submitted",
        ts: 0,
      },
    });
  }

  // Sponsor fires scattered across the timeline
  for (const s of SPONSOR_FIRES) {
    out.push({
      at_ms: s.at_ms,
      event: {
        type: "sponsor_event",
        event_id: EVENT_ID,
        sponsor: s.sponsor as never,
        action: s.action,
        detail: s.detail,
        ts: 0,
      },
    });
  }

  // Cost updates — tick every 2s from fan-out through the closing beats so the
  // late timeline never goes fully idle.
  const COST_TICKS = 24;
  const COST_TICK_INTERVAL_MS = 2000;
  const COST_TICKS_START_AT = 8000;
  for (let i = 0; i < COST_TICKS; i++) {
    out.push({
      at_ms: COST_TICKS_START_AT + i * COST_TICK_INTERVAL_MS,
      event: {
        type: "cost_update",
        event_id: EVENT_ID,
        pavo_cents: 0.0008 * (i + 1),
        baseline_cents: null,
        ts: 0,
      },
    });
  }

  // The three signature/consent handoffs surface as an explicit waiting banner
  // before the run finalizes — matching the live orchestrator's sequence.
  const waitingAgents = SPECIALIST_IDS.filter(
    (agentId) => TERMINAL_STATES[agentId] === "needs-user-action",
  );
  if (waitingAgents.length > 0) {
    out.push({
      at_ms: WAITING_FOR_USER_AT,
      event: {
        type: "event_waiting_for_user",
        event_id: EVENT_ID,
        agents: waitingAgents,
        count: waitingAgents.length,
        ts: 0,
      },
    });
  }

  const submittedCount = SPECIALIST_IDS.filter(
    (agentId) => (TERMINAL_STATES[agentId] ?? "submitted") === "submitted",
  ).length;
  const failedCount = SPECIALIST_IDS.filter(
    (agentId) => TERMINAL_STATES[agentId] === "failed",
  ).length;
  out.push({
    at_ms: FINALIZED_AT,
    event: {
      type: "event_finalized",
      event_id: EVENT_ID,
      outcome: failedCount > 0 ? "partial_failure" : "submitted",
      summary: {
        submitted_count: submittedCount,
        failed_count: failedCount,
        summary_email_sent: false,
        memory_persisted: false,
      },
      ts: 0,
    },
  });

  return out.sort((a, b) => a.at_ms - b.at_ms);
}

function tierReason(tier: string): string {
  if (tier === "gemma-local") return "early-call greeting; clamp to gemma-local";
  if (tier === "gemini-flash") return "medium pattern (pricing/specifics/confirmation)";
  if (tier === "claude-opus") return "hard pattern (legal/policy/signature)";
  return "no-anthropic-fallback";
}
function tierComplexity(tier: string): number {
  if (tier === "gemma-local") return 0.18;
  if (tier === "gemini-flash") return 0.52;
  return 0.84;
}
